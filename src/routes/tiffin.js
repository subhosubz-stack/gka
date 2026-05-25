import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { getSetting } from '../services/platformConfig.js';

const router = express.Router();

router.get('/providers', async (req, res) => {
  return res.json({
    providers: [
      { id: 'homely', name: 'Homely Tiffin', plans: ['Veg Monthly', 'Non-Veg Monthly'] },
      { id: 'campus', name: 'Campus Meals Co.', plans: ['Student Lite', 'Student Pro'] }
    ]
  });
});

router.post('/opt-in', protect, async (req, res) => {
  const { provider_name, plan_name, deal_value } = req.body;
  if (!provider_name) return res.status(400).json({ error: 'provider_name required' });

  try {
    const pct = parseFloat(await getSetting('tiffin_commission_percent', '10'));
    const value = parseFloat(deal_value || 0);
    const commission = Math.round((value * pct) / 100);

    const ins = await pool.query(
      `INSERT INTO tiffin_deals (student_id, provider_name, plan_name, deal_value, commission_value, status)
       VALUES ($1, $2, $3, $4, $5, 'opted_in') RETURNING *`,
      [req.user.id, provider_name, plan_name || null, value, commission]
    );

    return res.json({ success: true, deal: ins.rows[0], commissionValue: commission });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to record tiffin opt-in.' });
  }
});

export default router;
