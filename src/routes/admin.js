import express from 'express';
import pool from '../db.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { getAllSettings, setSetting } from '../services/platformConfig.js';

const router = express.Router();

// Elevate security: admin roles only
router.use(protect, restrictTo('admin'));

// GET /api/admin/metrics (High-level admin dashboard count counters)
router.get('/metrics', async (req, res) => {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM profiles');
    const propertiesApproved = await pool.query("SELECT COUNT(*) FROM properties WHERE status = 'approved'");
    const propertiesPending = await pool.query("SELECT COUNT(*) FROM properties WHERE status = 'pending'");
    const totalPayments = await pool.query("SELECT SUM(amount) FROM payments WHERE status = 'paid'");

    return res.json({
      success: true,
      metrics: {
        total_users: parseInt(usersCount.rows[0].count),
        approved_properties: parseInt(propertiesApproved.rows[0].count),
        pending_properties: parseInt(propertiesPending.rows[0].count),
        total_transactions_volume: parseFloat(totalPayments.rows[0].sum || 0)
      }
    });
  } catch (err) {
    console.error('Admin metrics aggregation error:', err);
    return res.status(500).json({ error: 'Failed to aggregate portal statistics.' });
  }
});

// GET /api/admin/profiles (View catalog of users)
router.get('/profiles', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, full_name, email, phone, role, verification_status, onboarding_step, created_at
      FROM profiles
      ORDER BY created_at DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Admin profiles fetch error:', err);
    return res.status(500).json({ error: 'Failed to retrieve portal user list.' });
  }
});

// POST /api/admin/profiles/:id/verify (Verify or Suspend user account profiles)
router.post('/profiles/:id/verify', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'verified', 'suspended', 'rejected'

  if (!status || !['verified', 'suspended', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid verification status value.' });
  }

  try {
    const checkProfile = await pool.query('SELECT id, email FROM profiles WHERE id = $1', [id]);
    if (checkProfile.rows.length === 0) {
      return res.status(404).json({ error: 'User profile account not found.' });
    }

    const updateQuery = `
      UPDATE profiles
      SET verification_status = $1, updated_at = now()
      WHERE id = $2
      RETURNING id, full_name, email, verification_status
    `;
    const result = await pool.query(updateQuery, [status, id]);

    // Send on-platform system notification alert
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'account_status')`,
      [id, 'Account Verification Status Change', `An administrator has updated your account status to: ${status}.`]
    );

    return res.json({
      success: true,
      message: 'Account profile status modified successfully.',
      profile: result.rows[0]
    });

  } catch (err) {
    console.error('Admin verification update error:', err);
    return res.status(500).json({ error: 'Failed to update user status.' });
  }
});

// GET /api/admin/properties (Review pending, approved or flagged properties list)
router.get('/properties', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, pf.full_name as owner_name, pf.email as owner_email
      FROM properties p
      LEFT JOIN profiles pf ON p.owner_id = pf.id
      ORDER BY p.created_at DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Admin fetch properties error:', err);
    return res.status(500).json({ error: 'Failed to fetch property reviews.' });
  }
});

// POST /api/admin/properties/:id/approve (Admin action for listing approval)
router.post('/properties/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'approved', 'rejected'

  if (!action || !['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action parameter (approved or rejected required).' });
  }

  try {
    const checkProp = await pool.query('SELECT id, owner_id, title FROM properties WHERE id = $1', [id]);
    if (checkProp.rows.length === 0) {
      return res.status(404).json({ error: 'Property listing not found.' });
    }

    const property = checkProp.rows[0];

    const updateQuery = `
      UPDATE properties
      SET status = $1, verified = $2, updated_at = now()
      WHERE id = $3
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [action, action === 'approved', id]);

    // Inform Owner
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'listing_approval')`,
      [property.owner_id, `Property Listing ${action === 'approved' ? 'Approved Live ✨' : 'Rejected'}`, `Your listing "${property.title}" was ${action} by our quality audit team.`]
    );

    return res.json({
      success: true,
      message: `Property has been successfully ${action}.`,
      property: result.rows[0]
    });

  } catch (err) {
    console.error('Property approval action error:', err);
    return res.status(500).json({ error: 'Failed to process property action.' });
  }
});

// GET /api/admin/payments (Review all on-platform rent settlements)
router.get('/payments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pm.*, pr.full_name as tenant_name
      FROM payments pm
      LEFT JOIN profiles pr ON pm.user_id = pr.id
      ORDER BY pm.created_at DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Admin fetch payments error:', err);
    return res.status(500).json({ error: 'Failed to retrieve ledger log.' });
  }
});

// POST /api/admin/payments/:id/verify (Audit and unlock/accept transactions manually)
router.post('/payments/:id/verify', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'paid' (collected), 'failed' (refused)

  try {
    const checkPayment = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
    if (checkPayment.rows.length === 0) {
      return res.status(404).json({ error: 'Payment transfer slip not found.' });
    }

    const updateQuery = `
      UPDATE payments
      SET status = $1, updated_at = now()
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [status, id]);
    const updatedPay = result.rows[0];

    // Post notification receipt
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'payment_verified')`,
      [updatedPay.user_id, 'Rent payout update', `Administration has updated your rent transaction status to: ${status}.`]
    );

    return res.json({ success: true, payment: updatedPay });
  } catch (err) {
    console.error('Admin update transaction error:', err);
    return res.status(500).json({ error: 'Failed to update ledger records.' });
  }
});

// POST /api/admin/properties/:id/toggle-tier (Toggle verified properties as premium/featured placement levels)
router.post('/properties/:id/toggle-tier', async (req, res) => {
  const { id } = req.params;
  const { is_premium } = req.body;

  try {
    const checkProp = await pool.query('SELECT id, is_premium FROM properties WHERE id = $1', [id]);
    if (checkProp.rows.length === 0) {
      return res.status(404).json({ error: 'Listing property not found.' });
    }

    const updateQuery = `
      UPDATE properties
      SET is_premium = $1, updated_at = now()
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [is_premium, id]);
    return res.json({ success: true, property: result.rows[0] });
  } catch (err) {
    console.error('Admin Toggle property placement error:', err);
    return res.status(500).json({ error: 'Failed to switch placement allocation tier.' });
  }
});

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await getAllSettings();
    return res.json({ settings });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load settings.' });
  }
});

// PUT /api/admin/settings
router.put('/settings', async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings object required' });
  }
  try {
    for (const [key, value] of Object.entries(settings)) {
      await setSetting(key, value);
    }
    return res.json({ success: true, settings: await getAllSettings() });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// GET /api/admin/tiffin-deals
router.get('/tiffin-deals', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT td.*, p.full_name AS student_name, p.email AS student_email
       FROM tiffin_deals td JOIN profiles p ON td.student_id = p.id
       ORDER BY td.created_at DESC LIMIT 100`
    );
    const sum = await pool.query(
      `SELECT COALESCE(SUM(commission_value),0)::float AS total_commission, COUNT(*)::int AS deal_count FROM tiffin_deals`
    );
    return res.json({ deals: r.rows, summary: sum.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load tiffin deals.' });
  }
});

export default router;
