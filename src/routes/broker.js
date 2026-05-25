import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { serializeUser } from '../utils/authSession.js';
import { getVerificationStatus } from '../services/verification.js';

const router = express.Router();

router.get('/conversations', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, p.title AS property_title, p.city AS property_city,
              p.monthly_rent AS property_rent,
              t.full_name AS tenant_name, t.avatar_url AS tenant_avatar,
              o.full_name AS owner_name,
              t.full_name AS peer_name, t.avatar_url AS peer_avatar,
              (
                SELECT pm.file_url FROM property_media pm
                WHERE pm.property_id = p.id AND pm.file_type = 'image'
                ORDER BY pm.sort_order ASC NULLS LAST, pm.created_at ASC
                LIMIT 1
              ) AS property_image
       FROM conversations c
       JOIN properties p ON c.property_id = p.id
       JOIN profiles t ON c.tenant_id = t.id
       JOIN profiles o ON c.owner_id = o.id
       WHERE c.broker_id = $1 OR p.broker_id = $1
       ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC`,
      [req.user.id]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// GET /api/broker/properties (My brokered units)
router.get('/properties', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*,
             COALESCE(
               (SELECT json_agg(pm ORDER BY pm.sort_order ASC, pm.created_at ASC) FROM property_media pm WHERE pm.property_id = p.id),
               '[]'::json
             ) as media
      FROM properties p
      WHERE p.broker_id = $1 OR (p.owner_id = $1)
      ORDER BY p.created_at DESC
    `, [req.user.id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Broker fetch properties error:', err);
    return res.status(500).json({ error: 'Failed to retrieve brokerage property listings.' });
  }
});

// GET /api/broker/leads (Housing search occupants / profiles)
router.get('/leads', protect, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT rp.*, pr.full_name, pr.email, pr.city, pr.onboarding_step, pr.role
      FROM roommate_preferences rp
      JOIN profiles pr ON rp.user_id = pr.id
      WHERE pr.role = 'tenant'
      ORDER BY rp.created_at DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Broker fetch leads error:', err);
    return res.status(500).json({ error: 'Failed to retrieve tenant lead matches.' });
  }
});

// POST /api/broker/unlock-lead (Demonstrates unlocking client contacts securely)
router.post('/unlock-lead', protect, async (req, res) => {
  const { lead_user_id } = req.body;
  if (!lead_user_id) {
    return res.status(400).json({ error: 'lead_user_id is required.' });
  }

  try {
    const leadResult = await pool.query(
      'SELECT id, full_name, email, phone FROM profiles WHERE id = $1',
      [lead_user_id]
    );

    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant profile lead not found.' });
    }

    const lead = leadResult.rows[0];

    // Simply log or record that this broker unlocked this lead (inserting payment log or token debitor)
    return res.json({
      success: true,
      message: 'Successfully unlocked tenant contact details.',
      leadDetails: {
        id: lead.id,
        full_name: lead.full_name,
        email: lead.email,
        phone: lead.phone
      }
    });

  } catch (err) {
    console.error('Unlock lead exception:', err);
    return res.status(500).json({ error: 'Failed to unlock lead contact details.' });
  }
});

// POST /api/broker/onboard (Submit broker onboarding credentials)
router.post('/onboard', protect, async (req, res) => {
  const { agencyName, reraRegisterCode, licensingDocUrl, agentBio } = req.body;
  try {
    const userResult = await pool.query('SELECT metadata FROM profiles WHERE id = $1', [req.user.id]);
    const metadata = userResult.rows[0]?.metadata || {};

    metadata.agencyName = agencyName;
    metadata.reraRegisterCode = reraRegisterCode;
    metadata.licensingDocUrl = licensingDocUrl;
    metadata.agentBio = agentBio;

    const updateQuery = `
      UPDATE profiles
      SET onboarding_step = 'onboarded_broker',
          verification_status = 'admin_verification_required',
          metadata = $1,
          updated_at = now()
      WHERE id = $2
      RETURNING *
    `;

    await pool.query(updateQuery, [JSON.stringify(metadata), req.user.id]);
    const full = await pool.query('SELECT * FROM profiles WHERE id = $1', [req.user.id]);
    const status = await getVerificationStatus(req.user.id);

    return res.json({
      success: true,
      user: serializeUser({ ...full.rows[0], ...status })
    });
  } catch (err) {
    console.error('Broker onboard error:', err);
    return res.status(500).json({ error: 'Failed to save broker onboarding data.' });
  }
});

export default router;
