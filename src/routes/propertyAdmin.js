import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { requirePropertyAdmin } from '../middleware/adminAccess.js';
import { isServiceAreaAllowed } from '../utils/geoGuard.js';
import { NEARBY_COLLEGES } from '../constants/platform.js';

const router = express.Router();
router.use(protect, requirePropertyAdmin);

/** Property admin only: verify listings, add platform properties, manual profile verification */
router.get('/dashboard', async (req, res) => {
  try {
    const pendingProps = await pool.query(
      `SELECT p.*, pf.full_name AS owner_name, pf.email AS owner_email
       FROM properties p
       LEFT JOIN profiles pf ON p.owner_id = pf.id
       WHERE p.status = 'pending'
       ORDER BY p.created_at DESC LIMIT 100`
    );
    const pendingProfiles = await pool.query(
      `SELECT id, full_name, email, phone, role, verification_status, metadata, created_at
       FROM profiles
       WHERE role IN ('owner', 'broker')
         AND verification_status IS DISTINCT FROM 'verified'
       ORDER BY created_at DESC LIMIT 100`
    );
    const allProps = await pool.query(
      `SELECT p.*, pf.full_name AS owner_name, pf.email AS owner_email
       FROM properties p
       LEFT JOIN profiles pf ON p.owner_id = pf.id
       ORDER BY p.updated_at DESC LIMIT 200`
    );
    return res.json({
      colleges: NEARBY_COLLEGES,
      pending_properties: pendingProps.rows,
      pending_profiles: pendingProfiles.rows,
      all_properties: allProps.rows
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load property admin dashboard.' });
  }
});

router.post('/properties', async (req, res) => {
  const body = req.body;
  const geo = isServiceAreaAllowed({
    city: body.city,
    state: body.state,
    locality: body.locality,
    address_line: body.address_line
  });
  if (!geo.ok) return res.status(400).json({ error: geo.reason, code: 'GEO_NOT_SUPPORTED' });

  try {
    const rankVal =
      body.display_rank === '' || body.display_rank == null
        ? null
        : parseInt(body.display_rank, 10);
    const result = await pool.query(
      `INSERT INTO properties (
         owner_id, title, description, property_type, listing_type, status,
         address_line, locality, city, state, pincode, latitude, longitude,
         nearest_college, map_address, display_rank, monthly_rent, actual_price, offer_price, offer_reason, security_deposit,
         capacity, available_beds, gender_preference, amenities, rules, verified,
         is_platform_listing, is_premium
       ) VALUES (
         $1,$2,$3,$4,$5,'approved',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,true,true,$26
       ) RETURNING *`,
      [
        req.user.id,
        body.title,
        body.description || '',
        body.property_type || 'room',
        body.listing_type || 'regular',
        body.address_line,
        body.locality,
        body.city,
        body.state,
        body.pincode,
        body.latitude ? parseFloat(body.latitude) : null,
        body.longitude ? parseFloat(body.longitude) : null,
        body.nearest_college || null,
        body.map_address || body.address_line,
        Number.isFinite(rankVal) ? rankVal : null,
        parseFloat(body.offer_price || body.monthly_rent || 0),
        body.actual_price != null && body.actual_price !== '' ? parseFloat(body.actual_price) : null,
        parseFloat(body.offer_price || body.monthly_rent || 0),
        body.offer_reason || null,
        parseFloat(body.security_deposit || 0),
        parseInt(body.capacity || 1, 10),
        parseInt(body.available_beds || 1, 10),
        body.gender_preference || 'any',
        JSON.stringify(body.amenities || []),
        JSON.stringify(body.rules || {}),
        body.listing_type === 'premium'
      ]
    );
    return res.json({ success: true, property: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not add platform listing.' });
  }
});

router.post('/properties/:id/approve', async (req, res) => {
  const { display_rank, nearest_college } = req.body;
  try {
    const rankVal =
      display_rank === '' || display_rank == null ? null : parseInt(display_rank, 10);
    const result = await pool.query(
      `UPDATE properties SET status = 'approved', verified = true,
         display_rank = COALESCE($1, display_rank),
         nearest_college = COALESCE($2, nearest_college),
         updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [Number.isFinite(rankVal) ? rankVal : null, nearest_college || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Property not found.' });
    return res.json({ success: true, property: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed.' });
  }
});

router.post('/properties/:id/reject', async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await pool.query(
      `UPDATE properties SET status = 'rejected', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Property not found.' });
    return res.json({ success: true, property: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Reject failed.' });
  }
});

router.get('/properties/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM properties WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Property not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load property.' });
  }
});

router.put('/properties/:id', async (req, res) => {
  const b = req.body;
  if (!b.title || !b.city) {
    return res.status(400).json({ error: 'Title and city are required.' });
  }
  try {
    const rankVal =
      b.display_rank === '' || b.display_rank == null ? null : parseInt(b.display_rank, 10);
    const offerVal = parseFloat(b.offer_price ?? b.monthly_rent ?? 0);
    const actualVal =
      b.actual_price != null && b.actual_price !== '' ? parseFloat(b.actual_price) : null;

    const result = await pool.query(
      `UPDATE properties SET
         title = $1, description = $2, property_type = $3, listing_type = $4, status = $5,
         address_line = $6, locality = $7, city = $8, state = $9, pincode = $10,
         nearest_college = $11, display_rank = $12,
         monthly_rent = $13, actual_price = $14, offer_price = $15, offer_reason = $16,
         security_deposit = $17, maintenance_fee = $18, brokerage_fee = $19,
         capacity = $20, available_beds = $21, gender_preference = $22, available_from = $23,
         amenities = $24::jsonb, rules = $25::jsonb, youtube_url = $26, verified = $27,
         updated_at = NOW()
       WHERE id = $28 RETURNING *`,
      [
        b.title,
        b.description || '',
        b.property_type || 'room',
        b.listing_type || 'regular',
        b.status || 'approved',
        b.address_line || null,
        b.locality || null,
        b.city,
        b.state || 'Punjab',
        b.pincode || null,
        b.nearest_college || null,
        Number.isFinite(rankVal) ? rankVal : null,
        offerVal,
        Number.isFinite(actualVal) ? actualVal : null,
        offerVal,
        b.offer_reason || null,
        parseFloat(b.security_deposit || 0),
        parseFloat(b.maintenance_fee || 0),
        parseFloat(b.brokerage_fee || 0),
        parseInt(b.capacity || 1, 10),
        parseInt(b.available_beds || 1, 10),
        b.gender_preference || 'any',
        b.available_from || null,
        JSON.stringify(b.amenities || []),
        JSON.stringify(b.rules || {}),
        b.youtube_url || null,
        !!b.verified,
        req.params.id
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Property not found.' });
    return res.json({ success: true, property: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Property update failed.' });
  }
});

router.post('/profiles/:id/verify', async (req, res) => {
  const { status = 'verified', note } = req.body;
  try {
    const result = await pool.query(
      `UPDATE profiles SET verification_status = $1,
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
       WHERE id = $3 AND role IN ('owner', 'broker') RETURNING id, full_name, email, role, verification_status`,
      [status, JSON.stringify({ verified_by: 'property_admin', note: note || null }), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Profile not found.' });
    return res.json({ success: true, profile: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Profile verification failed.' });
  }
});

export default router;
