import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/unread-count', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    return res.json({ count: result.rows[0].count });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to count notifications.' });
  }
});

router.post('/read-all', protect, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to mark notifications read.' });
  }
});

// GET /api/notifications (Fetch notification drawer elements)
router.get('/', protect, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Fetch notices error:', err);
    return res.status(500).json({ error: 'Failed to retrieve notification feed.' });
  }
});

// POST /api/notifications/:id/read (Mark notice as read)
router.post('/:id/read', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification notice not found.' });
    }

    return res.json({ success: true, notification: result.rows[0] });
  } catch (err) {
    console.error('Mark notice read error:', err);
    return res.status(500).json({ error: 'Failed to update notification status.' });
  }
});

export default router;
