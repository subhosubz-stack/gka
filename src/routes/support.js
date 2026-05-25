import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/adminAccess.js';

const router = express.Router();

async function ensureSupportTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      user_role text,
      user_name text,
      user_email text,
      subject text NOT NULL,
      body text NOT NULL,
      status text DEFAULT 'open',
      admin_reply text,
      replied_at timestamptz,
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_messages_status ON support_messages(status, created_at DESC)
  `);
}

router.post('/', protect, async (req, res) => {
  const { subject, body } = req.body;
  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }
  try {
    await ensureSupportTable();
    const prof = await pool.query(
      'SELECT full_name, email, role FROM profiles WHERE id = $1',
      [req.user.id]
    );
    const p = prof.rows[0] || {};
    const result = await pool.query(
      `INSERT INTO support_messages (user_id, user_role, user_name, user_email, subject, body)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.user.id,
        p.role || req.user.role,
        p.full_name || 'User',
        p.email || '',
        subject.trim(),
        body.trim()
      ]
    );
    return res.json({ success: true, message: result.rows[0] });
  } catch (err) {
    console.error('Support create error:', err.message);
    return res.status(500).json({ error: 'Could not send support message.' });
  }
});

router.get('/me', protect, async (req, res) => {
  try {
    await ensureSupportTable();
    const result = await pool.query(
      `SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load support messages.' });
  }
});

const adminRouter = express.Router();
adminRouter.use(protect, requireSuperAdmin);

adminRouter.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    await ensureSupportTable();
    let sql = `SELECT * FROM support_messages WHERE 1=1`;
    const params = [];
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 200`;
    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load support inbox.' });
  }
});

adminRouter.patch('/:id', async (req, res) => {
  const { status, admin_reply } = req.body;
  try {
    await ensureSupportTable();
    const result = await pool.query(
      `UPDATE support_messages SET
         status = COALESCE($1, status),
         admin_reply = COALESCE($2, admin_reply),
         replied_at = CASE WHEN $2 IS NOT NULL THEN NOW() ELSE replied_at END,
         updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status || null, admin_reply || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Message not found.' });
    return res.json({ success: true, message: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed.' });
  }
});

router.use('/admin', adminRouter);

export default router;
