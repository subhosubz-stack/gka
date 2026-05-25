import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// GET /api/owner/properties (My published/pending properties)
router.get('/properties', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*,
             COALESCE(
               (SELECT json_agg(pm ORDER BY pm.sort_order ASC, pm.created_at ASC) FROM property_media pm WHERE pm.property_id = p.id),
               '[]'::json
             ) as media
      FROM properties p
      WHERE p.owner_id = $1
      ORDER BY p.created_at DESC
    `, [req.user.id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Owner fetch properties error:', err);
    return res.status(500).json({ error: 'Failed to retrieve owner listings.' });
  }
});

// GET /api/owner/properties/:id/students — occupants + KYC for one listing
router.get('/properties/:id/students', protect, async (req, res) => {
  try {
    const prop = await pool.query('SELECT * FROM properties WHERE id = $1 AND owner_id = $2', [
      req.params.id,
      req.user.id
    ]);
    if (!prop.rows.length) return res.status(404).json({ error: 'Property not found.' });

    const bookings = await pool.query(
      `SELECT tb.*, pr.full_name as student_name, pr.email as student_email, pr.phone as student_phone,
              pr.aadhar_front_url, pr.aadhar_back_url
       FROM tenant_bookings tb
       JOIN profiles pr ON tb.tenant_id = pr.id
       WHERE tb.property_id = $1 AND tb.owner_id = $2
       ORDER BY tb.created_at DESC`,
      [req.params.id, req.user.id]
    );

    return res.json({
      property: prop.rows[0],
      students: bookings.rows
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load student records.' });
  }
});

// GET /api/owner/visit-requests (House visits scheduled at owner properties)
router.get('/visit-requests', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vr.*, p.title as property_title, p.address_line, pr.full_name as tenant_name, pr.email as tenant_email, pr.phone as tenant_phone
      FROM property_visit_requests vr
      JOIN properties p ON vr.property_id = p.id
      JOIN profiles pr ON vr.tenant_id = pr.id
      WHERE vr.owner_id = $1
      ORDER BY vr.visit_date DESC
    `, [req.user.id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Owner fetch visits error:', err);
    return res.status(500).json({ error: 'Failed to retrieve tour visits.' });
  }
});

// POST /api/owner/visit-requests/:id/action (Approve or Reject visits)
router.post('/visit-requests/:id/action', protect, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'approved' or 'rejected'

  if (!status || !['approved', 'rejected', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid operation status parameter.' });
  }

  try {
    const checkVisit = await pool.query('SELECT * FROM property_visit_requests WHERE id = $1 AND owner_id = $2', [id, req.user.id]);
    if (checkVisit.rows.length === 0) {
      return res.status(404).json({ error: 'Visit request not found or unauthorized access.' });
    }

    const updateQuery = `
      UPDATE property_visit_requests
      SET status = $1, updated_at = now()
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [status, id]);
    const visit = result.rows[0];

    // Inform tenant about the slot scheduling activity
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'visit_action')`,
      [visit.tenant_id, `House Visit ${status === 'approved' ? 'Confirmed ✔️' : 'Rejected ❌'}`, `The owner has ${status} your visit date slot scheduled on ${visit.visit_date}.`]
    );

    return res.json({ success: true, visit });
  } catch (err) {
    console.error('Update visit action error:', err);
    return res.status(500).json({ error: 'Failed to modify visit request status.' });
  }
});

// GET /api/owner/bookings (Current occupancy reservations)
router.get('/bookings', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tb.*, p.title as property_title, pr.full_name as tenant_name, pr.email as tenant_email, pr.phone as tenant_phone
      FROM tenant_bookings tb
      JOIN properties p ON tb.property_id = p.id
      JOIN profiles pr ON tb.tenant_id = pr.id
      WHERE tb.owner_id = $1
      ORDER BY tb.created_at DESC
    `, [req.user.id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Owner retrieve bookings error:', err);
    return res.status(500).json({ error: 'Failed to retrieve active occupant bookings.' });
  }
});

// POST /api/owner/bookings/:id/action (Approve or Reject student stay lock offer)
router.post('/bookings/:id/action', protect, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'approved' or 'rejected'

  if (!status || !['approved', 'rejected', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid operation status parameter.' });
  }

  try {
    const checkBooking = await pool.query('SELECT * FROM tenant_bookings WHERE id = $1 AND owner_id = $2', [id, req.user.id]);
    if (checkBooking.rows.length === 0) {
      return res.status(404).json({ error: 'Booking stay not found or unauthorized access.' });
    }

    const updateQuery = `
      UPDATE tenant_bookings
      SET status = $1, updated_at = now()
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [status, id]);
    const booking = result.rows[0];

    if (status === 'approved') {
      await pool.query(
        `UPDATE tenant_bookings
         SET status = 'pending', binding_state = 'awaiting_payment', updated_at = now()
         WHERE id = $1`,
        [booking.id]
      );
      await pool.query(
        `INSERT INTO conversations (tenant_id, owner_id, property_id, status, last_message)
         VALUES ($1, $2, $3, 'unlocked', 'Stay confirmed — you can chat freely about rent and maintenance.')
         ON CONFLICT (tenant_id, owner_id, property_id)
         DO UPDATE SET status = 'unlocked', updated_at = now()`,
        [booking.tenant_id, booking.owner_id, booking.property_id]
      );
      await pool.query(
        `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'stay_linked')`,
        [
          booking.tenant_id,
          'Stay approved — Resident Dashboard active',
          'Your landlord approved your stay. Open Resident Dashboard for rent, chat, and maintenance.'
        ]
      );
    }

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'booking_action')`,
      [booking.tenant_id, `Stay Offer Lock ${status === 'approved' ? 'Approved ✔️' : 'Rejected ❌'}`, `Your stay reservation offer was ${status} by the landlord.`]
    );

    return res.json({ success: true, booking });
  } catch (err) {
    console.error('Update booking stay error:', err);
    return res.status(500).json({ error: 'Failed to update booking stay status.' });
  }
});

// GET /api/owner/payments (Retrieve pending receipts submitted by residents)
router.get('/payments', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pm.*, pr.full_name as tenant_name, pr.email as tenant_email, pr.phone as tenant_phone, p.title as property_title
      FROM payments pm
      JOIN profiles pr ON pm.user_id = pr.id
      JOIN properties p ON pm.property_id = p.id
      WHERE p.owner_id = $1
      ORDER BY pm.created_at DESC
    `, [req.user.id]);

    return res.json(result.rows);
  } catch (err) {
    console.error('Owner fetch payments error:', err);
    return res.status(500).json({ error: 'Failed to retrieve rent payments.' });
  }
});

// POST /api/owner/payments/:id/action (Collect rent / verify receipts)
router.post('/payments/:id/action', protect, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'paid' or 'failed' (mapped to 'collected' or 'refused' in UI)

  try {
    const checkPayment = await pool.query(`
      SELECT pm.* FROM payments pm 
      JOIN properties p ON pm.property_id = p.id
      WHERE pm.id = $1 AND p.owner_id = $2
    `, [id, req.user.id]);

    if (checkPayment.rows.length === 0) {
      return res.status(404).json({ error: 'Payment transaction record not found or access unauthorized.' });
    }

    const updateQuery = `
      UPDATE payments
      SET status = $1, updated_at = now()
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [status, id]);
    const payment = result.rows[0];

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'payment_verified')`,
      [payment.user_id, `Payment Verified (${status})`, `The landlord verified your rent payment of INR ${payment.amount} as ${status}.`]
    );

    return res.json({ success: true, payment });
  } catch (err) {
    console.error('Update payment action error:', err);
    return res.status(500).json({ error: 'Failed to confirm rent receipt action.' });
  }
});

// GET /api/owner/tenants — active residents across properties
router.get('/tenants', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT tb.*, p.title as property_title, pr.full_name as tenant_name, pr.email as tenant_email
       FROM tenant_bookings tb
       JOIN properties p ON tb.property_id = p.id
       JOIN profiles pr ON tb.tenant_id = pr.id
       WHERE tb.owner_id = $1 AND tb.status IN ('approved', 'active', 'confirmed')
       ORDER BY tb.created_at DESC`,
      [req.user.id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Owner tenants error:', err);
    return res.status(500).json({ error: 'Failed to load tenants.' });
  }
});

// POST /api/owner/tenants/notify — rent reminder or custom notice
router.post('/tenants/notify', protect, async (req, res) => {
  const { property_id, tenant_ids, message, type = 'custom' } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message body is required.' });
  }

  try {
    let query = `
      SELECT tb.tenant_id FROM tenant_bookings tb
      WHERE tb.owner_id = $1 AND tb.status IN ('approved', 'active', 'confirmed')
    `;
    const params = [req.user.id];

    if (property_id) {
      params.push(property_id);
      query += ` AND tb.property_id = $${params.length}`;
    }

    const bookings = await pool.query(query, params);
    let targets = bookings.rows.map((r) => r.tenant_id);

    if (Array.isArray(tenant_ids) && tenant_ids.length > 0) {
      targets = targets.filter((id) => tenant_ids.includes(id));
    }

    if (targets.length === 0) {
      return res.status(400).json({ error: 'No active tenants matched for this notification.' });
    }

    const title = type === 'rent_reminder' ? 'Monthly rent reminder' : 'Notice from your landlord';
    const trimmedMessage = message.trim();
    for (const tenantId of targets) {
      await pool.query(
        `INSERT INTO notifications (user_id, title, body, type, metadata) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, title, trimmedMessage, type, JSON.stringify({ property_id, from_owner: req.user.id })]
      );
    }

    await pool.query(
      `INSERT INTO tenant_notification_log (owner_id, property_id, notification_type, message, recipient_count, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.user.id,
        property_id || null,
        type,
        trimmedMessage,
        targets.length,
        JSON.stringify({ tenant_ids: targets })
      ]
    );

    return res.json({ success: true, notified_count: targets.length });
  } catch (err) {
    console.error('Tenant notify error:', err);
    return res.status(500).json({ error: 'Failed to send notifications.' });
  }
});

// GET /api/owner/conversations — alias for owner chat inbox
router.get('/conversations', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, p.title as property_title, p.city as property_city,
              p.monthly_rent as property_rent,
              t.full_name as tenant_name, t.avatar_url as tenant_avatar,
              t.full_name as peer_name, t.avatar_url as peer_avatar,
              (
                SELECT pm.file_url FROM property_media pm
                WHERE pm.property_id = p.id AND pm.file_type = 'image'
                ORDER BY pm.sort_order ASC NULLS LAST, pm.created_at ASC
                LIMIT 1
              ) as property_image
       FROM conversations c
       JOIN properties p ON c.property_id = p.id
       JOIN profiles t ON c.tenant_id = t.id
       WHERE c.owner_id = $1
       ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC`,
      [req.user.id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Owner conversations error:', err);
    return res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// GET /api/owner/lock-requests — PRD property lock requests
router.get('/lock-requests', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lr.*, p.title AS property_title, t.full_name AS tenant_name, t.email AS tenant_email
       FROM property_lock_requests lr
       JOIN properties p ON lr.property_id = p.id
       JOIN profiles t ON lr.tenant_id = t.id
       WHERE lr.owner_id = $1
       ORDER BY lr.created_at DESC`,
      [req.user.id]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load lock requests.' });
  }
});

// POST /api/owner/lock-requests/:id/action
router.post('/lock-requests/:id/action', protect, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be accepted or rejected' });
  }

  try {
    const lr = await pool.query(
      'SELECT * FROM property_lock_requests WHERE id = $1 AND owner_id = $2',
      [id, req.user.id]
    );
    if (lr.rows.length === 0) return res.status(404).json({ error: 'Lock request not found.' });

    const lock = lr.rows[0];
    const { getSetting } = await import('../services/platformConfig.js');
    const hideDays = parseInt(await getSetting('lock_request_hide_days', '7'), 10);

    let lockEnd = null;
    if (status === 'accepted') {
      lockEnd = new Date();
      lockEnd.setDate(lockEnd.getDate() + hideDays);
      await pool.query(
        `UPDATE properties SET availability_status = 'locked', updated_at = NOW() WHERE id = $1`,
        [lock.property_id]
      );

      const prop = await pool.query(
        'SELECT monthly_rent, security_deposit FROM properties WHERE id = $1',
        [lock.property_id]
      );
      const rent = prop.rows[0]?.monthly_rent || 0;
      const deposit = prop.rows[0]?.security_deposit || 0;

      const existingBooking = await pool.query(
        `SELECT id FROM tenant_bookings
         WHERE tenant_id = $1 AND property_id = $2 AND status::text NOT IN ('cancelled', 'rejected')`,
        [lock.tenant_id, lock.property_id]
      );
      if (existingBooking.rows.length === 0) {
        await pool.query(
          `INSERT INTO tenant_bookings (tenant_id, owner_id, property_id, monthly_rent, security_deposit, status, binding_state)
           VALUES ($1, $2, $3, $4, $5, 'pending', 'awaiting_payment')`,
          [lock.tenant_id, lock.owner_id, lock.property_id, rent, deposit]
        );
      } else {
        await pool.query(
          `UPDATE tenant_bookings
           SET status = 'pending', binding_state = 'awaiting_payment', updated_at = NOW()
           WHERE id = $1`,
          [existingBooking.rows[0].id]
        );
      }

      await pool.query(
        `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'stay_payment_due')`,
        [
          lock.tenant_id,
          'Owner approved — payment required',
          'Your lock was accepted. Pay security deposit and first month rent in Resident Dashboard to complete binding.'
        ]
      );
    }

    const upd = await pool.query(
      `UPDATE property_lock_requests
       SET status = $1, lock_start = CASE WHEN $1 = 'accepted' THEN NOW() ELSE NULL END,
           lock_end = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, lockEnd, id]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'lock_request_action')`,
      [
        lock.tenant_id,
        status === 'accepted' ? 'Lock request accepted' : 'Lock request declined',
        status === 'accepted'
          ? `Your lock request was accepted. Property hidden for ${hideDays} days.`
          : 'Your lock request was declined by the landlord.'
      ]
    );

    return res.json({ success: true, lockRequest: upd.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update lock request.' });
  }
});

export default router;
