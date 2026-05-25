import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { parseYoutubeVideoId, defaultListingVideoId } from '../utils/youtube.js';
import { calculateListingFee, validateBrokerListingSection } from '../services/pricing.js';
import { createRazorpayOrder, isRazorpayConfigured, getPublicKeyId } from '../services/razorpay.js';
import { isServiceAreaAllowed } from '../utils/geoGuard.js';
import { NEARBY_COLLEGES } from '../constants/platform.js';

const router = express.Router();
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'properties');
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const MEDIA_AGG = `
  COALESCE(
    (SELECT json_agg(pm ORDER BY pm.sort_order ASC, pm.created_at ASC)
     FROM property_media pm WHERE pm.property_id = p.id),
    '[]'::json
  ) as media
`;

async function ensureMediaSchema() {
  try {
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS youtube_url text`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS nearest_college text`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS display_rank int`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_platform_listing boolean DEFAULT false`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS map_address text`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS actual_price numeric`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS offer_price numeric`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS offer_reason text`);
  } catch (_) {}
}

async function savePropertyMedia(propertyId, { youtube_url, media = [], photo_urls = [] }) {
  await pool.query('DELETE FROM property_media WHERE property_id = $1', [propertyId]);

  const videoId = parseYoutubeVideoId(youtube_url) || defaultListingVideoId();
  await pool.query(
    `INSERT INTO property_media (property_id, file_url, file_type, is_cover, sort_order, metadata)
     VALUES ($1, $2, 'youtube', true, 0, $3)`,
    [propertyId, videoId, JSON.stringify({ youtube_url: youtube_url || null, source: 'owner' })]
  );

  const imageUrls = [
    ...photo_urls,
    ...(Array.isArray(media) ? media : []).filter((m) => typeof m === 'string')
  ].filter(Boolean);

  let order = 1;
  for (const url of imageUrls.slice(0, MAX_IMAGES)) {
    await pool.query(
      `INSERT INTO property_media (property_id, file_url, file_type, is_cover, sort_order)
       VALUES ($1, $2, 'image', $3, $4)`,
      [propertyId, url, order === 1, order]
    );
    order += 1;
  }
}

// POST /api/properties/upload-images — base64 multi upload
router.post('/upload-images', protect, async (req, res) => {
  const { files } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No image files provided.' });
  }

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const host = process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`;
    const urls = [];

    for (const file of files.slice(0, MAX_IMAGES)) {
      const raw = file?.data || file?.base64;
      if (!raw || typeof raw !== 'string') continue;

      const match = raw.match(/^data:image\/(\w+);base64,(.+)$/);
      const ext = match ? match[1].replace('jpeg', 'jpg') : 'jpg';
      const b64 = match ? match[2] : raw;
      const buffer = Buffer.from(b64, 'base64');

      if (buffer.length > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: `Each image must be under ${MAX_IMAGE_BYTES / 1024 / 1024}MB.` });
      }

      const fname = `${req.user.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      await fs.writeFile(path.join(UPLOAD_DIR, fname), buffer);
      urls.push(`${host}/uploads/properties/${fname}`);
    }

    if (urls.length === 0) {
      return res.status(400).json({ error: 'Could not process uploaded images.' });
    }

    return res.json({ success: true, urls });
  } catch (err) {
    console.error('Upload images error:', err);
    return res.status(500).json({ error: 'Failed to upload images.' });
  }
});

// GET /api/properties
router.get('/', async (req, res) => {
  try {
    await ensureMediaSchema();
    const {
      city,
      gender_preference,
      property_type,
      min_rent,
      max_rent,
      search,
      verified,
      amenities,
      nearest_college,
      limit = 50
    } = req.query;

    let query = `
      SELECT p.*, pf.full_name as owner_name, pf.avatar_url as owner_avatar,
             ${MEDIA_AGG}
      FROM properties p
      LEFT JOIN profiles pf ON p.owner_id = pf.id
      WHERE p.status = 'approved'
        AND COALESCE(p.availability_status, 'vacant') != 'locked'
    `;
    const params = [];

    if (city) {
      params.push(city);
      query += ` AND p.city ILIKE $${params.length}`;
    }

    if (gender_preference && gender_preference !== 'any') {
      params.push(gender_preference);
      query += ` AND (p.gender_preference = $${params.length} OR p.gender_preference = 'any')`;
    }

    if (property_type) {
      params.push(property_type);
      query += ` AND p.property_type = $${params.length}`;
    }

    if (min_rent) {
      params.push(parseFloat(min_rent));
      query += ` AND p.monthly_rent >= $${params.length}`;
    }

    if (max_rent) {
      params.push(parseFloat(max_rent));
      query += ` AND p.monthly_rent <= $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.title ILIKE $${params.length} OR p.description ILIKE $${params.length} OR p.locality ILIKE $${params.length})`;
    }

    if (verified === 'true') {
      query += ` AND p.verified = true`;
    }

    if (amenities) {
      const list = String(amenities)
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      for (const am of list) {
        params.push(JSON.stringify([am]));
        query += ` AND p.amenities @> $${params.length}::jsonb`;
      }
    }

    let orderBy =
      '(p.display_rank IS NULL) ASC, p.display_rank ASC NULLS LAST, p.is_premium DESC, p.created_at DESC';
    if (nearest_college) {
      params.push(nearest_college);
      orderBy = `(CASE WHEN p.nearest_college = $${params.length} THEN 0 ELSE 1 END), ${orderBy}`;
    }

    query += ` ORDER BY ${orderBy} LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10) || 50);

    const result = await pool.query(query, params);
    return res.json({ properties: result.rows, colleges: NEARBY_COLLEGES });
  } catch (err) {
    console.error('Fetch properties error:', err);
    return res.status(500).json({ error: 'Failed to retrieve properties.' });
  }
});

// GET /api/properties/public/:id — QR / share card (no auth, approved only)
router.get('/public/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await ensureMediaSchema();
    const query = `
      SELECT p.*,
        pf.full_name AS owner_name,
        pf.role AS owner_profile_role,
        bf.full_name AS broker_name,
        bf.role AS broker_profile_role,
        CASE
          WHEN p.is_platform_listing = true THEN 'platform'
          WHEN p.broker_id IS NOT NULL THEN 'broker'
          ELSE 'owner'
        END AS listed_by,
        ${MEDIA_AGG}
      FROM properties p
      LEFT JOIN profiles pf ON p.owner_id = pf.id
      LEFT JOIN profiles bf ON p.broker_id = bf.id
      WHERE p.id = $1 AND p.status = 'approved'
    `;
    const result = await pool.query(query, [id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Listing not found or not published.' });
    }
    const row = result.rows[0];
    return res.json({
      ...row,
      owner_phone: null,
      owner_email: null,
      broker_phone: null,
      broker_email: null
    });
  } catch (err) {
    console.error('Public property card error:', err);
    return res.status(500).json({ error: 'Failed to load listing card.' });
  }
});

// GET /api/properties/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT p.*, pf.full_name as owner_name, pf.phone as owner_phone, pf.email as owner_email, pf.avatar_url as owner_avatar,
             ${MEDIA_AGG}
      FROM properties p
      LEFT JOIN profiles pf ON p.owner_id = pf.id
      WHERE p.id = $1
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Fetch property by ID error:', err);
    return res.status(500).json({ error: 'Failed to retrieve property details.' });
  }
});

// POST /api/properties/calculate-fee
router.post('/calculate-fee', protect, async (req, res) => {
  const { property_type, listing_type = 'regular', visibility_boost = false } = req.body;
  try {
    const prof = await pool.query('SELECT role, metadata FROM profiles WHERE id = $1', [req.user.id]);
    const role = prof.rows[0]?.role;
    const brokerType = prof.rows[0]?.metadata?.broker_type;
    const sectionCheck = validateBrokerListingSection(brokerType, listing_type);
    if (!sectionCheck.ok) return res.status(400).json({ error: sectionCheck.error });

    const fee = await calculateListingFee({
      role,
      listingType: listing_type,
      propertyType: property_type,
      ownerId: req.user.id,
      brokerType,
      visibilityBoost: visibility_boost
    });
    return res.json({ success: true, fee });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/properties
router.post('/', protect, async (req, res) => {
  const {
    title,
    description,
    property_type,
    listing_type = 'regular',
    visibility_boost = false,
    address_line,
    locality,
    city,
    state,
    pincode,
    latitude,
    longitude,
    nearest_college,
    map_address,
    display_rank,
    monthly_rent,
    actual_price,
    offer_price,
    offer_reason,
    security_deposit = 0,
    maintenance_fee = 0,
    brokerage_fee = 0,
    capacity = 1,
    available_beds = 1,
    gender_preference = 'any',
    available_from,
    amenities = [],
    rules = {},
    youtube_url,
    media = [],
    photo_urls = []
  } = req.body;

  if (!title || !property_type || !city || monthly_rent === undefined) {
    return res.status(400).json({ error: 'Title, property type, city, and rent are required fields.' });
  }

  const geo = isServiceAreaAllowed({ city, state, locality, address_line });
  if (!geo.ok) {
    return res.status(400).json({ error: geo.reason, code: 'GEO_NOT_SUPPORTED' });
  }

  try {
    await ensureMediaSchema();

    const prof = await pool.query('SELECT role, metadata FROM profiles WHERE id = $1', [req.user.id]);
    const role = prof.rows[0]?.role;
    const brokerType = prof.rows[0]?.metadata?.broker_type;
    const sectionCheck = validateBrokerListingSection(brokerType, listing_type);
    if (!sectionCheck.ok) return res.status(400).json({ error: sectionCheck.error });

    const feeInfo = await calculateListingFee({
      role,
      listingType: listing_type,
      propertyType: property_type,
      ownerId: req.user.id,
      brokerType,
      visibilityBoost: visibility_boost
    });

    const initialStatus = feeInfo.freeListing ? 'approved' : 'pending';
    const ownerVal = req.user.id;

    const parsedActual = actual_price != null && actual_price !== '' ? parseFloat(actual_price) : null;
    const parsedOffer =
      offer_price != null && offer_price !== ''
        ? parseFloat(offer_price)
        : parseFloat(monthly_rent);
    const rentVal = parsedOffer;

    const insertQuery = `
      INSERT INTO properties (
        owner_id, broker_id, title, description, property_type, listing_type, status,
        address_line, locality, city, state, pincode, latitude, longitude,
        nearest_college, map_address, display_rank,
        monthly_rent, actual_price, offer_price, offer_reason,
        security_deposit, maintenance_fee, brokerage_fee,
        capacity, available_beds, gender_preference, available_from,
        amenities, rules, youtube_url, is_premium, verified, is_platform_listing
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
      )
      RETURNING *
    `;

    const rankVal =
      display_rank === null || display_rank === undefined || display_rank === ''
        ? null
        : parseInt(display_rank, 10);

    const result = await pool.query(insertQuery, [
      ownerVal,
      role === 'broker' ? ownerVal : null,
      title,
      description,
      property_type,
      listing_type,
      initialStatus,
      address_line,
      locality,
      city,
      state,
      pincode,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null,
      nearest_college || null,
      map_address || address_line || null,
      Number.isFinite(rankVal) ? rankVal : null,
      rentVal,
      Number.isFinite(parsedActual) ? parsedActual : null,
      Number.isFinite(parsedOffer) ? parsedOffer : null,
      offer_reason || null,
      parseFloat(security_deposit),
      parseFloat(maintenance_fee),
      parseFloat(brokerage_fee),
      parseInt(capacity),
      parseInt(available_beds),
      gender_preference,
      available_from || null,
      JSON.stringify(amenities),
      JSON.stringify(rules),
      youtube_url || null,
      listing_type === 'premium',
      feeInfo.freeListing,
      !!req.body.is_platform_listing
    ]);

    const property = result.rows[0];
    await savePropertyMedia(property.id, { youtube_url, media, photo_urls });

    await pool.query(
      `UPDATE profiles SET onboarding_step = 'onboarded_owner', updated_at = NOW()
       WHERE id = $1 AND role IN ('owner', 'broker') AND onboarding_step = 'role_selected'`,
      [req.user.id]
    );

    let paymentPayload = null;
    if (!feeInfo.freeListing) {
      if (!isRazorpayConfigured()) {
        return res.status(503).json({ error: 'Listing requires payment but Razorpay is not configured.' });
      }
      const payIns = await pool.query(
        `INSERT INTO payments (user_id, property_id, amount, purpose, status, provider, metadata)
         VALUES ($1, $2, $3, 'listing_fee', 'created', 'razorpay', $4) RETURNING *`,
        [
          req.user.id,
          property.id,
          feeInfo.total,
          JSON.stringify({ visibility_boost, feeInfo })
        ]
      );
      const rz = await createRazorpayOrder({
        amountInr: feeInfo.total,
        receipt: `listing_${property.id.slice(0, 8)}`,
        notes: { property_id: property.id }
      });
      await pool.query(`UPDATE payments SET provider_order_id = $1 WHERE id = $2`, [
        rz.id,
        payIns.rows[0].id
      ]);
      paymentPayload = {
        razorpayKeyId: getPublicKeyId(),
        order: { id: rz.id, amount: rz.amount, currency: rz.currency },
        amountInr: feeInfo.total,
        paymentId: payIns.rows[0].id
      };
    }

    const withMedia = await pool.query(
      `SELECT p.*, ${MEDIA_AGG} FROM properties p WHERE p.id = $1`,
      [property.id]
    );

    return res.status(201).json({
      success: true,
      message: feeInfo.freeListing
        ? 'Property published successfully.'
        : 'Property saved. Complete payment to publish listing.',
      property: withMedia.rows[0] || property,
      listingFee: feeInfo,
      requiresPayment: !feeInfo.freeListing,
      payment: paymentPayload
    });
  } catch (err) {
    console.error('Create property error:', err);
    return res.status(500).json({ error: 'Failed to create property listing.' });
  }
});

// POST /api/properties/:id/favorite
router.post('/:id/favorite', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const checkFavorite = await pool.query(
      'SELECT id FROM property_favorites WHERE user_id = $1 AND property_id = $2',
      [req.user.id, id]
    );

    if (checkFavorite.rows.length > 0) {
      await pool.query(
        'DELETE FROM property_favorites WHERE user_id = $1 AND property_id = $2',
        [req.user.id, id]
      );
      return res.json({ success: true, favorited: false, message: 'Removed from favorites' });
    }

    await pool.query(
      `INSERT INTO property_favorites (user_id, property_id) VALUES ($1, $2)
       ON CONFLICT (user_id, property_id) DO NOTHING`,
      [req.user.id, id]
    );
    return res.json({ success: true, favorited: true, message: 'Added to favorites' });
  } catch (err) {
    console.error('Toggle favorite error:', err);
    return res.status(500).json({ error: 'Could not update favorites.' });
  }
});

export default router;
