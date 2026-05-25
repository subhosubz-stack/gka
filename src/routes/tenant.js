import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import {
  BINDING_LINKED,
  BINDING_AWAITING_PAYMENT,
  BINDING_AWAITING_OWNER,
  addStayMember,
  removeStayMember,
  listStayMembers,
  getPropertyCapacity
} from '../services/stayBinding.js';
import { formatDisplayId } from '../utils/displayId.js';

const router = express.Router();

// GET /api/tenant/preferences (Get matching questionnaire answers)
router.get('/preferences', protect, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM roommate_preferences WHERE user_id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.json({ preference: null });
    }
    return res.json({ preference: result.rows[0] });
  } catch (err) {
    console.error('Fetch preferences error:', err);
    return res.status(500).json({ error: 'Failed to retrieve preferences.' });
  }
});

// POST /api/tenant/preferences (Upsert roommate questionnaire answers)
router.post('/preferences', protect, async (req, res) => {
  const {
    budget_min = 0,
    budget_max = 100000,
    preferred_city,
    preferred_localities = [],
    gender_preference,
    food_preference,
    smoking_preference,
    drinking_preference,
    sleep_schedule,
    cleanliness_level,
    study_preference,
    guest_preference,
    pets_preference
  } = req.body;

  try {
    const checkPref = await pool.query('SELECT id FROM roommate_preferences WHERE user_id = $1', [req.user.id]);
    
    let result;
    if (checkPref.rows.length > 0) {
      const updateQuery = `
        UPDATE roommate_preferences
        SET budget_min = $1, budget_max = $2, preferred_city = $3, preferred_localities = $4,
            gender_preference = $5, food_preference = $6, smoking_preference = $7, drinking_preference = $8,
            sleep_schedule = $9, cleanliness_level = $10, study_preference = $11, guest_preference = $12,
            pets_preference = $13, updated_at = now()
        WHERE user_id = $14
        RETURNING *
      `;
      result = await pool.query(updateQuery, [
        parseFloat(budget_min), parseFloat(budget_max), preferred_city, JSON.stringify(preferred_localities),
        gender_preference, food_preference, smoking_preference, drinking_preference,
        sleep_schedule, cleanliness_level, study_preference, guest_preference, pets_preference,
        req.user.id
      ]);
    } else {
      const insertQuery = `
        INSERT INTO roommate_preferences (
          user_id, budget_min, budget_max, preferred_city, preferred_localities,
          gender_preference, food_preference, smoking_preference, drinking_preference,
          sleep_schedule, cleanliness_level, study_preference, guest_preference, pets_preference
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `;
      result = await pool.query(insertQuery, [
        req.user.id, parseFloat(budget_min), parseFloat(budget_max), preferred_city, JSON.stringify(preferred_localities),
        gender_preference, food_preference, smoking_preference, drinking_preference,
        sleep_schedule, cleanliness_level, study_preference, guest_preference, pets_preference
      ]);
    }

    await pool.query(
      `UPDATE profiles SET onboarding_step = 'onboarded_tenant', updated_at = NOW()
       WHERE id = $1 AND role = 'tenant' AND onboarding_step = 'role_selected'`,
      [req.user.id]
    );

    return res.json({ success: true, preference: result.rows[0] });
  } catch (err) {
    console.error('Save preferences error:', err);
    return res.status(500).json({ error: 'Failed to save roommate matching preferences.' });
  }
});

// GET /api/tenant/roommate-matches (Match recommendation score calculator)
router.get('/roommate-matches', protect, async (req, res) => {
  try {
    // Fetch current user preference
    const userPrefResult = await pool.query('SELECT * FROM roommate_preferences WHERE user_id = $1', [req.user.id]);
    if (userPrefResult.rows.length === 0) {
      return res.status(400).json({ error: 'Please submit your preferences questionnaire first.' });
    }
    const myPref = userPrefResult.rows[0];

    // Query other roommate preferences
    const matchesResult = await pool.query(`
      SELECT rp.*, pr.full_name, pr.email, pr.phone, pr.avatar_url, pr.city
      FROM roommate_preferences rp
      JOIN profiles pr ON rp.user_id = pr.id
      WHERE rp.user_id != $1 AND pr.role = 'tenant'
    `, [req.user.id]);

    const unlockRows = await pool.query(
      `SELECT target_user_id FROM roommate_contact_unlocks
       WHERE user_id = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id]
    );
    const unlockedIds = new Set(unlockRows.rows.map((r) => r.target_user_id));

    const scoredRoommates = matchesResult.rows.map(peer => {
      let score = 0;
      let totalAttributes = 0;

      // Matching properties scoring calculations
      if (myPref.gender_preference && peer.gender_preference) {
        totalAttributes++;
        if (myPref.gender_preference === peer.gender_preference) score += 100;
      }
      if (myPref.food_preference && peer.food_preference) {
        totalAttributes++;
        if (myPref.food_preference === peer.food_preference) score += 100;
      }
      if (myPref.smoking_preference && peer.smoking_preference) {
        totalAttributes++;
        if (myPref.smoking_preference === peer.smoking_preference) score += 100;
      }
      if (myPref.drinking_preference && peer.drinking_preference) {
        totalAttributes++;
        if (myPref.drinking_preference === peer.drinking_preference) score += 100;
      }
      if (myPref.sleep_schedule && peer.sleep_schedule) {
        totalAttributes++;
        if (myPref.sleep_schedule === peer.sleep_schedule) score += 100;
      }
      if (myPref.cleanliness_level && peer.cleanliness_level) {
        totalAttributes++;
        if (myPref.cleanliness_level === peer.cleanliness_level) score += 100;
      }

      const matchPercent = totalAttributes > 0 ? Math.round(score / totalAttributes) : 75;

      const contactUnlocked = unlockedIds.has(peer.user_id);
      return {
        user_id: peer.user_id,
        full_name: peer.full_name,
        avatar_url: peer.avatar_url,
        city: peer.city,
        sleep_schedule: peer.sleep_schedule,
        cleanliness_level: peer.cleanliness_level,
        food_preference: peer.food_preference,
        matchPercentage: matchPercent,
        contactUnlocked,
        email: contactUnlocked ? peer.email : null,
        phone: contactUnlocked ? peer.phone : null
      };
    });

    // Sort matching candidates by proximity score desc
    scoredRoommates.sort((a, b) => b.matchPercentage - a.matchPercentage);

    return res.json(scoredRoommates);
  } catch (err) {
    console.error('Fetch roommate matching matches error:', err);
    return res.status(500).json({ error: 'Failed to search roommate candidates.' });
  }
});

// POST /api/tenant/visit-request (Request house tour visit slot)
router.post('/visit-request', protect, async (req, res) => {
  const { property_id, visit_date, visit_slot, note } = req.body;
  if (!property_id || !visit_date || !visit_slot) {
    return res.status(400).json({ error: 'Property ID, visit date, and timing slot are required.' });
  }

  try {
    // Locate the owner_id of the property
    const propResult = await pool.query('SELECT owner_id FROM properties WHERE id = $1', [property_id]);
    if (propResult.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    const ownerId = propResult.rows[0].owner_id;

    const requestQuery = `
      INSERT INTO property_visit_requests (tenant_id, owner_id, property_id, visit_date, visit_slot, note)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await pool.query(requestQuery, [req.user.id, ownerId, property_id, visit_date, visit_slot, note]);
    
    // Auto-notify owner
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'visit_request')`,
      [ownerId, 'New Visit Schedule Request', `A user scheduled a visit slot for your property on ${visit_date}.`]
    );

    return res.json({ success: true, visit: result.rows[0] });
  } catch (err) {
    console.error('Visit request scheduling error:', err);
    return res.status(500).json({ error: 'Could not schedule visit request.' });
  }
});

// GET /api/tenant/visit-requests
router.get('/visit-requests', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vr.*, p.title as property_title, p.address_line, p.city, pf.full_name as owner_name
      FROM property_visit_requests vr
      JOIN properties p ON vr.property_id = p.id
      JOIN profiles pf ON vr.owner_id = pf.id
      WHERE vr.tenant_id = $1
      ORDER BY vr.visit_date DESC
    `, [req.user.id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Fetch tenant visits error:', err);
    return res.status(500).json({ error: 'Failed to fetch visit requests.' });
  }
});

// GET /api/tenant/favorites (Get saved favorites list)
router.get('/favorites', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (p.id) pf.created_at as favorited_at, p.*
      FROM property_favorites pf
      JOIN properties p ON pf.property_id = p.id
      WHERE pf.user_id = $1
      ORDER BY p.id, pf.created_at DESC
    `, [req.user.id]);
    result.rows.sort((a, b) => new Date(b.favorited_at) - new Date(a.favorited_at));
    return res.json(result.rows);
  } catch (err) {
    console.error('Failed to load favorites:', err);
    return res.status(500).json({ error: 'Could not fetch saved properties.' });
  }
});

// GET /api/tenant/contact-unlock/:propertyId
router.get('/contact-unlock/:propertyId', protect, async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT * FROM contact_unlocks
       WHERE user_id = $1 AND property_id = $2 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id, req.params.propertyId]
    );
    if (existing.rows.length > 0) {
      const prop = await pool.query(
        `SELECT p.title, pf.full_name AS owner_name, pf.phone AS owner_phone, pf.email AS owner_email
         FROM properties p LEFT JOIN profiles pf ON p.owner_id = pf.id WHERE p.id = $1`,
        [req.params.propertyId]
      );
      return res.json({ unlocked: true, unlock: existing.rows[0], property: prop.rows[0] });
    }
    const { getContactUnlockPrice } = await import('../services/pricing.js');
    const prop = await pool.query('SELECT listing_type FROM properties WHERE id = $1', [req.params.propertyId]);
    const amount = await getContactUnlockPrice(prop.rows[0]?.listing_type);
    return res.json({ unlocked: false, requiresPayment: true, amountInr: amount });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check unlock status.' });
  }
});

// POST /api/tenant/unlock-contact — returns unlock if paid, else payment required (use /payments/create-order)
router.post('/unlock-contact', protect, async (req, res) => {
  const { property_id } = req.body;
  if (!property_id) return res.status(400).json({ error: 'property_id is required' });

  try {
    const existing = await pool.query(
      `SELECT * FROM contact_unlocks
       WHERE user_id = $1 AND property_id = $2 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id, property_id]
    );
    if (existing.rows.length === 0) {
      const { getContactUnlockPrice } = await import('../services/pricing.js');
      const prop = await pool.query('SELECT listing_type FROM properties WHERE id = $1', [property_id]);
      const amount = await getContactUnlockPrice(prop.rows[0]?.listing_type);
      return res.status(402).json({
        error: 'Payment required to unlock contact.',
        requiresPayment: true,
        amountInr: amount,
        purpose: 'contact_unlock'
      });
    }

    const propertyDetails = await pool.query(`
      SELECT p.title, pf.full_name as owner_name, pf.email as owner_email, pf.phone as owner_phone
      FROM properties p LEFT JOIN profiles pf ON p.owner_id = pf.id WHERE p.id = $1
    `, [property_id]);

    return res.json({
      success: true,
      unlock: existing.rows[0],
      property: propertyDetails.rows[0]
    });
  } catch (err) {
    console.error('Unlock error:', err);
    return res.status(500).json({ error: 'Failed to unlock contact.' });
  }
});

// POST /api/tenant/lock-request — PRD property lock request (hide listing when accepted)
router.post('/lock-request', protect, async (req, res) => {
  const { property_id, note } = req.body;
  if (!property_id) return res.status(400).json({ error: 'property_id is required' });

  try {
    const prop = await pool.query(
      `SELECT id, owner_id, title, availability_status FROM properties WHERE id = $1 AND status = 'approved'`,
      [property_id]
    );
    if (prop.rows.length === 0) {
      return res.status(404).json({ error: 'Property not available.' });
    }
    if (prop.rows[0].availability_status === 'locked') {
      return res.status(400).json({ error: 'Property is already locked by another tenant.' });
    }

    const dup = await pool.query(
      `SELECT id FROM property_lock_requests WHERE tenant_id = $1 AND property_id = $2 AND status = 'pending'`,
      [req.user.id, property_id]
    );
    if (dup.rows.length > 0) {
      return res.status(400).json({ error: 'You already have a pending lock request for this property.' });
    }

    const ins = await pool.query(
      `INSERT INTO property_lock_requests (tenant_id, owner_id, property_id, status, note)
       VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
      [req.user.id, prop.rows[0].owner_id, property_id, note || null]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'lock_request')`,
      [
        prop.rows[0].owner_id,
        'Property lock request',
        `A tenant requested to lock "${prop.rows[0].title}" for exclusive viewing.`
      ]
    );

    await pool.query(
      `INSERT INTO conversations (tenant_id, owner_id, property_id, status, last_message)
       VALUES ($1, $2, $3, 'preset_only', 'Lock property request sent')
       ON CONFLICT (tenant_id, owner_id, property_id) DO NOTHING`,
      [req.user.id, prop.rows[0].owner_id, property_id]
    );

    const propRent = await pool.query(
      'SELECT monthly_rent, security_deposit FROM properties WHERE id = $1',
      [property_id]
    );
    const { monthly_rent, security_deposit } = propRent.rows[0] || {};
    const existingBooking = await pool.query(
      `SELECT id FROM tenant_bookings
       WHERE tenant_id = $1 AND property_id = $2 AND status::text NOT IN ('cancelled', 'rejected')`,
      [req.user.id, property_id]
    );
    if (existingBooking.rows.length === 0) {
      await pool.query(
        `INSERT INTO tenant_bookings (tenant_id, owner_id, property_id, monthly_rent, security_deposit, status, binding_state)
         VALUES ($1, $2, $3, $4, $5, 'pending', 'awaiting_owner')`,
        [req.user.id, prop.rows[0].owner_id, property_id, monthly_rent, security_deposit]
      );
    }

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'lock_request_sent')`,
      [
        req.user.id,
        'Lock request submitted',
        `Your request for "${prop.rows[0].title}" is pending owner approval. Check Resident Dashboard for status.`
      ]
    );

    return res.json({ success: true, lockRequest: ins.rows[0] });
  } catch (err) {
    console.error('Lock request error:', err);
    return res.status(500).json({ error: 'Failed to submit lock request.' });
  }
});

// POST /api/tenant/book-property
router.post('/book-property', protect, async (req, res) => {
  const { property_id, offered_rent } = req.body;
  if (!property_id) return res.status(400).json({ error: 'property_id is required' });

  try {
    const propRes = await pool.query('SELECT owner_id, monthly_rent, security_deposit FROM properties WHERE id = $1', [property_id]);
    if (propRes.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    const { owner_id, monthly_rent, security_deposit } = propRes.rows[0];

    const bookingQuery = `
      INSERT INTO tenant_bookings (tenant_id, owner_id, property_id, monthly_rent, security_deposit, status, move_in_date)
      VALUES ($1, $2, $3, $4, $5, 'pending', now() + interval '7 days')
      RETURNING *
    `;

    const result = await pool.query(bookingQuery, [
      req.user.id,
      owner_id,
      property_id,
      offered_rent || monthly_rent,
      security_deposit
    ]);

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'booking_alert')`,
      [owner_id, 'New Property Booking Lock Offer', `A student placed a lock booking offer on your property listing template.`]
    );

    await pool.query(
      `INSERT INTO conversations (tenant_id, owner_id, property_id, status, last_message)
       VALUES ($1, $2, $3, 'preset_only', 'Lock request submitted')
       ON CONFLICT (tenant_id, owner_id, property_id) DO NOTHING`,
      [req.user.id, owner_id, property_id]
    );

    return res.json({
      success: true,
      booking: result.rows[0]
    });
  } catch (err) {
    console.error('Booking offer lock error:', err);
    return res.status(500).json({ error: 'Failed to place booking lock offer.' });
  }
});

// GET /api/tenant/stay-overview — tenant ↔ owner link status for Resident Dashboard
router.get('/stay-overview', protect, async (req, res) => {
  try {
    const tenantId = req.user.id;

    const linked = await pool.query(
      `SELECT tb.*, p.title, p.city, p.locality, p.capacity,
              pf.full_name AS owner_name, pf.phone AS owner_phone, pf.email AS owner_email,
              pf.display_id AS owner_display_id
       FROM tenant_bookings tb
       JOIN properties p ON tb.property_id = p.id
       JOIN profiles pf ON tb.owner_id = pf.id
       WHERE tb.tenant_id = $1 AND tb.binding_state = $2
       ORDER BY tb.updated_at DESC
       LIMIT 1`,
      [tenantId, BINDING_LINKED]
    );

    const awaitingPayment = await pool.query(
      `SELECT tb.*, p.title, p.city, p.locality, p.capacity,
              p.security_deposit, pf.full_name AS owner_name, pf.display_id AS owner_display_id
       FROM tenant_bookings tb
       JOIN properties p ON tb.property_id = p.id
       JOIN profiles pf ON tb.owner_id = pf.id
       WHERE tb.tenant_id = $1 AND tb.binding_state = $2
       ORDER BY tb.updated_at DESC
       LIMIT 1`,
      [tenantId, BINDING_AWAITING_PAYMENT]
    );

    const awaitingOwner = await pool.query(
      `SELECT tb.*, p.title, p.city, pf.full_name AS owner_name
       FROM tenant_bookings tb
       JOIN properties p ON tb.property_id = p.id
       JOIN profiles pf ON tb.owner_id = pf.id
       WHERE tb.tenant_id = $1 AND tb.binding_state = $2
       ORDER BY tb.created_at DESC
       LIMIT 1`,
      [tenantId, BINDING_AWAITING_OWNER]
    );

    const pendingLock = await pool.query(
      `SELECT lr.*, p.title AS property_title, p.city, pf.full_name AS owner_name
       FROM property_lock_requests lr
       JOIN properties p ON lr.property_id = p.id
       JOIN profiles pf ON lr.owner_id = pf.id
       WHERE lr.tenant_id = $1 AND lr.status = 'pending'
       ORDER BY lr.created_at DESC
       LIMIT 1`,
      [tenantId]
    );

    let linkStatus = 'none';
    let booking = null;
    if (linked.rows.length > 0) {
      linkStatus = 'active';
      booking = linked.rows[0];
      booking.members = await listStayMembers(booking.id);
      booking.seat_capacity = booking.capacity;
      booking.seats_used = booking.members.length;
    } else if (awaitingPayment.rows.length > 0) {
      linkStatus = 'pending_payment';
      booking = awaitingPayment.rows[0];
      booking.amount_due =
        parseFloat(booking.monthly_rent || 0) + parseFloat(booking.security_deposit || 0);
    } else if (awaitingOwner.rows.length > 0 || pendingLock.rows.length > 0) {
      linkStatus = 'pending';
      booking = awaitingOwner.rows[0] || null;
    }

    return res.json({
      linkStatus,
      booking,
      pendingLockRequest: pendingLock.rows[0] || null,
      tenant_display_id: req.user.display_id || formatDisplayId('tenant', tenantId),
      owner_display_id: booking?.owner_display_id || null
    });
  } catch (err) {
    console.error('Stay overview error:', err);
    return res.status(500).json({ error: 'Failed to load stay status.' });
  }
});

// GET /api/tenant/stay-members
router.get('/stay-members', protect, async (req, res) => {
  try {
    const bk = await pool.query(
      `SELECT * FROM tenant_bookings WHERE tenant_id = $1 AND binding_state = $2 LIMIT 1`,
      [req.user.id, BINDING_LINKED]
    );
    if (bk.rows.length === 0) {
      return res.status(400).json({ error: 'No active linked stay.' });
    }
    const booking = bk.rows[0];
    const members = await listStayMembers(booking.id);
    const capacity = await getPropertyCapacity(booking.property_id);
    return res.json({
      members,
      seats_used: members.length,
      seat_capacity: capacity,
      slots_remaining: Math.max(0, capacity - members.length)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load stay members.' });
  }
});

// POST /api/tenant/stay-members
router.post('/stay-members', protect, async (req, res) => {
  const { member_tenant_id } = req.body;
  if (!member_tenant_id) {
    return res.status(400).json({ error: 'member_tenant_id (Tenant ID) is required.' });
  }

  try {
    const bk = await pool.query(
      `SELECT tb.*, p.title AS property_title FROM tenant_bookings tb
       JOIN properties p ON tb.property_id = p.id
       WHERE tb.tenant_id = $1 AND tb.binding_state = $2 LIMIT 1`,
      [req.user.id, BINDING_LINKED]
    );
    if (bk.rows.length === 0) {
      return res.status(400).json({ error: 'Complete binding payment before adding members.' });
    }

    const result = await addStayMember({
      booking: bk.rows[0],
      primaryTenantId: req.user.id,
      memberDisplayId: member_tenant_id
    });
    if (result.error) return res.status(400).json({ error: result.error });

    const members = await listStayMembers(bk.rows[0].id);
    const capacity = await getPropertyCapacity(bk.rows[0].property_id);
    return res.json({
      success: true,
      members,
      seats_used: members.length,
      seat_capacity: capacity
    });
  } catch (err) {
    console.error('Add stay member error:', err);
    return res.status(500).json({ error: 'Could not add member.' });
  }
});

// DELETE /api/tenant/stay-members/:id
router.delete('/stay-members/:id', protect, async (req, res) => {
  try {
    const bk = await pool.query(
      `SELECT * FROM tenant_bookings WHERE tenant_id = $1 AND binding_state = $2 LIMIT 1`,
      [req.user.id, BINDING_LINKED]
    );
    if (bk.rows.length === 0) {
      return res.status(400).json({ error: 'No active linked stay.' });
    }

    const result = await removeStayMember({
      booking: bk.rows[0],
      primaryTenantId: req.user.id,
      memberRowId: req.params.id
    });
    if (result.error) return res.status(400).json({ error: result.error });

    const members = await listStayMembers(bk.rows[0].id);
    return res.json({ success: true, members });
  } catch (err) {
    return res.status(500).json({ error: 'Could not remove member.' });
  }
});

// GET /api/tenant/active-booking — linked stay only (after payment)
router.get('/active-booking', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT tb.*,
              p.title, p.city, p.locality, p.capacity,
              pf.full_name AS owner_name, pf.phone AS owner_phone, pf.email AS owner_email,
              pf.display_id AS owner_display_id
       FROM tenant_bookings tb
       JOIN properties p ON tb.property_id = p.id
       JOIN profiles pf ON tb.owner_id = pf.id
       WHERE tb.tenant_id = $1 AND tb.binding_state = $2
       ORDER BY tb.updated_at DESC
       LIMIT 1`,
      [req.user.id, BINDING_LINKED]
    );

    if (result.rows.length === 0) {
      return res.json({ booking: null, linkStatus: 'none' });
    }
    return res.json({ booking: result.rows[0], linkStatus: 'active' });
  } catch (err) {
    console.error('Fetch active stay error:', err);
    return res.status(500).json({ error: 'Failed to retrieve active stay.' });
  }
});

// GET /api/tenant/maintenance-requests
router.get('/maintenance-requests', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM maintenance_requests
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `, [req.user.id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Fetch maintenance tickets error:', err);
    return res.status(500).json({ error: 'Failed to fetch tickets.' });
  }
});

// POST /api/tenant/maintenance-requests
router.post('/maintenance-requests', protect, async (req, res) => {
  const { property_id, category, description } = req.body;
  if (!property_id || !description) {
    return res.status(400).json({ error: 'Property ID and ticket category / description are required.' });
  }

  try {
    const propRes = await pool.query('SELECT owner_id FROM properties WHERE id = $1', [property_id]);
    if (propRes.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    const ownerId = propRes.rows[0].owner_id;

    const queryStr = `
      INSERT INTO maintenance_requests (tenant_id, property_id, owner_id, title, description, status)
      VALUES ($1, $2, $3, $4, $5, 'open')
      RETURNING *
    `;
    const result = await pool.query(queryStr, [
      req.user.id,
      property_id,
      ownerId,
      category || 'Maintenance Request',
      description
    ]);

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'maintenance_alert')`,
      [ownerId, 'New Support Ticket Raised', `A resident raised a maintenance support ticket: ${category}.`]
    );

    return res.json({ success: true, ticket: result.rows[0] });
  } catch (err) {
    console.error('Spawn support ticket error:', err);
    return res.status(500).json({ error: 'Failed to create support ticket.' });
  }
});

// POST /api/tenant/bookings/:id/release
router.post('/bookings/:id/release', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE tenant_bookings SET status = 'cancelled', updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stay booking not found or unauthorized access.' });
    }

    const booking = result.rows[0];

    // Mark notification
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'booking_cancelled')`,
      [booking.owner_id, 'Stay Terminated / Booking Released', `The occupant has released their stay booking.`]
    );

    return res.json({ success: true, booking });
  } catch (err) {
    console.error('Release booking error:', err);
    return res.status(500).json({ error: 'Failed to release stay booking.' });
  }
});

export default router;
