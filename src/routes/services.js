import express from 'express';
import pool from '../db.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { SERVICE_CATALOG } from '../constants/servicesCatalog.js';

const router = express.Router();

async function ensureServicesSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      service_key text NOT NULL,
      service_label text,
      status text DEFAULT 'active',
      provider_name text,
      plan_name text,
      notes text,
      metadata jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW(),
      UNIQUE(student_id, service_key)
    );
  `);
}

router.get('/catalog', async (req, res) => {
  return res.json({ services: SERVICE_CATALOG });
});

router.get('/me', protect, restrictTo('tenant'), async (req, res) => {
  try {
    await ensureServicesSchema();
    const result = await pool.query(
      `SELECT service_key, service_label, status, provider_name, plan_name, notes, metadata, created_at, updated_at
       FROM student_services WHERE student_id = $1 ORDER BY created_at ASC`,
      [req.user.id]
    );
    return res.json({ services: result.rows, catalog: SERVICE_CATALOG });
  } catch (err) {
    console.error('services/me', err.message);
    return res.status(500).json({ error: 'Could not load your services.' });
  }
});

router.post('/onboard', protect, restrictTo('tenant'), async (req, res) => {
  const keys = Array.isArray(req.body?.services) ? req.body.services : [];
  if (!keys.length) {
    return res.status(400).json({ error: 'Select at least one service.' });
  }

  const validKeys = new Set(SERVICE_CATALOG.map((s) => s.key));
  const chosen = keys.filter((k) => validKeys.has(k));
  if (!chosen.length) {
    return res.status(400).json({ error: 'Invalid service selection.' });
  }

  try {
    await ensureServicesSchema();
    for (const key of chosen) {
      const item = SERVICE_CATALOG.find((s) => s.key === key);
      await pool.query(
        `INSERT INTO student_services (student_id, service_key, service_label, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (student_id, service_key)
         DO UPDATE SET service_label = EXCLUDED.service_label, status = 'active', updated_at = NOW()`,
        [req.user.id, key, item?.label || key]
      );
    }

    const result = await pool.query(
      `SELECT service_key, service_label, status, provider_name, plan_name, created_at
       FROM student_services WHERE student_id = $1 ORDER BY created_at ASC`,
      [req.user.id]
    );

    return res.json({ success: true, services: result.rows });
  } catch (err) {
    console.error('services/onboard', err.message);
    return res.status(500).json({ error: 'Could not save service preferences.' });
  }
});

router.patch('/:serviceKey', protect, restrictTo('tenant'), async (req, res) => {
  const { serviceKey } = req.params;
  const valid = SERVICE_CATALOG.some((s) => s.key === serviceKey);
  if (!valid) return res.status(400).json({ error: 'Unknown service.' });

  const { status, provider_name, plan_name, notes } = req.body;

  try {
    await ensureServicesSchema();
    const result = await pool.query(
      `UPDATE student_services
       SET status = COALESCE($3, status),
           provider_name = COALESCE($4, provider_name),
           plan_name = COALESCE($5, plan_name),
           notes = COALESCE($6, notes),
           updated_at = NOW()
       WHERE student_id = $1 AND service_key = $2
       RETURNING *`,
      [req.user.id, serviceKey, status || null, provider_name || null, plan_name || null, notes || null]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Service not enrolled yet.' });
    }
    return res.json({ service: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed.' });
  }
});

export default router;
