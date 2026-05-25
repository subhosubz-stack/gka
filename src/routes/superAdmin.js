import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/adminAccess.js';
import { getAllSettings, setSetting } from '../services/platformConfig.js';
import { DEFAULT_PLATFORM_BRANDING } from '../constants/platform.js';
import { getSuperAdminAnalytics, parseMeta, isUserBanned } from '../services/adminAnalytics.js';
import { fulfillPaidPayment } from './payments.js';

const router = express.Router();
router.use(protect, requireSuperAdmin);

router.get('/analytics', async (req, res) => {
  try {
    const data = await getSuperAdminAnalytics();
    return res.json(data);
  } catch (err) {
    console.error('analytics', err.message);
    return res.status(500).json({ error: 'Analytics failed.' });
  }
});

router.get('/overview', async (req, res) => {
  try {
    const data = await getSuperAdminAnalytics();
    return res.json({ metrics: data.totals, charts: data });
  } catch (err) {
    return res.status(500).json({ error: 'Overview failed.' });
  }
});

router.get('/properties', async (req, res) => {
  const { status, q } = req.query;
  try {
    let sql = `
      SELECT p.*, o.full_name AS owner_name, o.email AS owner_email,
        (SELECT COUNT(*)::int FROM property_favorites pf WHERE pf.property_id = p.id) AS wishlist_count
      FROM properties p
      LEFT JOIN profiles o ON p.owner_id = o.id
      WHERE 1=1`;
    const params = [];
    if (status) {
      params.push(status);
      sql += ` AND p.status = $${params.length}`;
    }
    if (q) {
      params.push(`%${String(q).trim()}%`);
      sql += ` AND (p.title ILIKE $${params.length} OR p.city ILIKE $${params.length})`;
    }
    sql += ` ORDER BY p.created_at DESC LIMIT 500`;
    const r = await pool.query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load properties.' });
  }
});

router.patch('/properties/:id', async (req, res) => {
  const { status, display_rank, nearest_college, verified } = req.body;
  if (!status && display_rank === undefined && !nearest_college && verified === undefined) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }
  try {
    const rankVal =
      display_rank === '' || display_rank == null ? null : parseInt(display_rank, 10);
    const r = await pool.query(
      `UPDATE properties SET
         status = COALESCE($1, status),
         display_rank = COALESCE($2, display_rank),
         nearest_college = COALESCE($3, nearest_college),
         verified = COALESCE($4, verified),
         updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [
        status || null,
        Number.isFinite(rankVal) ? rankVal : null,
        nearest_college || null,
        verified == null ? null : !!verified,
        req.params.id
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property not found.' });
    return res.json({ success: true, property: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Property update failed.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, full_name, email, phone, role, verification_status, admin_tier,
             created_at, metadata,
        (SELECT COUNT(*)::int FROM property_favorites pf WHERE pf.user_id = profiles.id) AS wishlist_count,
        (SELECT COUNT(*)::int FROM payments pay WHERE pay.user_id = profiles.id) AS payment_count,
        (SELECT COUNT(*)::int FROM conversation_messages cm WHERE cm.sender_id = profiles.id) AS messages_sent
      FROM profiles
      ORDER BY created_at DESC LIMIT 500
    `);
    const rows = r.rows.map((u) => ({
      ...u,
      banned: isUserBanned(u),
      metadata: parseMeta(u)
    }));
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load users.' });
  }
});

router.patch('/users/:id', async (req, res) => {
  const { banned, role, verification_status } = req.body;
  try {
    const cur = await pool.query('SELECT * FROM profiles WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'User not found.' });
    const meta = parseMeta(cur.rows[0]);
    if (banned !== undefined) {
      meta.banned = !!banned;
      meta.account_banned = !!banned;
      if (banned) meta.banned_at = new Date().toISOString();
      else {
        delete meta.banned_at;
        delete meta.banned_reason;
      }
    }
    const r = await pool.query(
      `UPDATE profiles SET
         metadata = $1::jsonb,
         role = COALESCE($2, role),
         verification_status = COALESCE($3, verification_status),
         updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [
        JSON.stringify(meta),
        role || null,
        verification_status || null,
        req.params.id
      ]
    );
    return res.json({ success: true, user: { ...r.rows[0], banned: isUserBanned(r.rows[0]) } });
  } catch (err) {
    return res.status(500).json({ error: 'User update failed.' });
  }
});

router.get('/wishlists', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT pf.id, pf.created_at,
        p.id AS property_id, p.title, p.city, p.nearest_college, p.monthly_rent, p.status AS property_status,
        u.id AS student_id, u.full_name AS student_name, u.email AS student_email, u.phone AS student_phone
      FROM property_favorites pf
      JOIN properties p ON pf.property_id = p.id
      JOIN profiles u ON pf.user_id = u.id
      ORDER BY pf.created_at DESC LIMIT 1000
    `);
    const summary = await pool.query(`
      SELECT p.title, p.id, COUNT(pf.id)::int AS saves
      FROM property_favorites pf
      JOIN properties p ON p.id = pf.property_id
      GROUP BY p.id, p.title
      ORDER BY saves DESC LIMIT 30
    `);
    return res.json({ entries: r.rows, top_properties: summary.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load wishlists.' });
  }
});

router.get('/payments', async (req, res) => {
  const { status } = req.query;
  try {
    let sql = `
      SELECT pay.*, u.full_name AS user_name, u.email AS user_email,
             p.title AS property_title
      FROM payments pay
      LEFT JOIN profiles u ON pay.user_id = u.id
      LEFT JOIN properties p ON pay.property_id = p.id
      WHERE 1=1`;
    const params = [];
    if (status) {
      params.push(status);
      sql += ` AND pay.status = $${params.length}`;
    }
    sql += ` ORDER BY pay.created_at DESC LIMIT 500`;
    const r = await pool.query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load payments.' });
  }
});

router.post('/payments/:id/approve', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM payments WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Payment not found.' });
    const payment = r.rows[0];
    if (payment.status === 'paid') {
      return res.json({ success: true, payment, message: 'Already paid.' });
    }
    const updated = await pool.query(
      `UPDATE payments SET status = 'paid', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [payment.id]
    );
    await fulfillPaidPayment(updated.rows[0]);
    return res.json({ success: true, payment: updated.rows[0] });
  } catch (err) {
    console.error('payment approve', err.message);
    return res.status(500).json({ error: 'Payment approval failed.' });
  }
});

router.post('/payments/:id/reject', async (req, res) => {
  const { reason } = req.body;
  try {
    const r = await pool.query(
      `UPDATE payments SET status = 'cancelled',
         metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [JSON.stringify({ admin_reject_reason: reason || 'Rejected by admin' }), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Payment not found.' });
    return res.json({ success: true, payment: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Payment reject failed.' });
  }
});

router.get('/conversations', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.*,
        p.title as property_title,
        t.full_name as tenant_name, t.email as tenant_email,
        o.full_name as owner_name
      FROM conversations c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN profiles t ON c.tenant_id = t.id
      LEFT JOIN profiles o ON c.owner_id = o.id
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT 200
    `);
    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT m.*, pr.full_name as sender_name, pr.role as sender_role
       FROM conversation_messages m
       LEFT JOIN profiles pr ON m.sender_id = pr.id
       WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load messages.' });
  }
});

router.get('/settings/branding', async (req, res) => {
  const settings = await getAllSettings();
  return res.json({
    logo_url: settings.logo_url || DEFAULT_PLATFORM_BRANDING.logo_url,
    favicon_url: settings.favicon_url || DEFAULT_PLATFORM_BRANDING.favicon_url,
    site_name: settings.site_name || DEFAULT_PLATFORM_BRANDING.site_name,
    tagline: settings.tagline || 'Verified student housing platform',
    support_email: settings.support_email || DEFAULT_PLATFORM_BRANDING.support_email,
    support_whatsapp: settings.support_whatsapp || DEFAULT_PLATFORM_BRANDING.support_whatsapp,
    hero_image_url: settings.hero_image_url || ''
  });
});

router.put('/settings/branding', async (req, res) => {
  const { logo_url, favicon_url, site_name, tagline, support_email, support_whatsapp, hero_image_url } =
    req.body;
  try {
    if (logo_url != null) await setSetting('logo_url', logo_url, 'Brand logo URL');
    if (favicon_url != null) await setSetting('favicon_url', favicon_url, 'Favicon URL');
    if (site_name != null) await setSetting('site_name', site_name, 'Site name');
    if (tagline != null) await setSetting('tagline', tagline, 'Site tagline');
    if (support_email != null) await setSetting('support_email', support_email, 'Support email');
    if (support_whatsapp != null) await setSetting('support_whatsapp', support_whatsapp, 'WhatsApp');
    if (hero_image_url != null) await setSetting('hero_image_url', hero_image_url, 'Hero image URL');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not save branding.' });
  }
});

router.get('/settings/platform', async (req, res) => {
  const settings = await getAllSettings();
  return res.json(settings);
});

router.put('/settings/platform', async (req, res) => {
  const body = req.body || {};
  try {
    for (const [key, value] of Object.entries(body)) {
      if (value != null) await setSetting(key, value, `Platform: ${key}`);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not save settings.' });
  }
});

router.post('/broadcast', async (req, res) => {
  const { title, body, roles = [], user_ids = [] } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required.' });

  try {
    let q = `SELECT id FROM profiles WHERE role != 'admin'`;
    const params = [];
    if (roles.length) {
      params.push(roles);
      q += ` AND role = ANY($${params.length})`;
    }
    if (user_ids.length) {
      params.push(user_ids);
      q += ` AND id = ANY($${params.length})`;
    } else if (!roles.length) {
      return res.status(400).json({ error: 'Select at least one role.' });
    }

    const users = await pool.query(q, params);
    let sent = 0;
    for (const u of users.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, title, body, type, metadata)
         VALUES ($1, $2, $3, 'admin_broadcast', $4)`,
        [u.id, title, body, JSON.stringify({ roles, user_ids })]
      );
      sent += 1;
    }

    await pool.query(
      `INSERT INTO admin_broadcasts (admin_id, title, body, target_roles, target_user_ids, sent_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, title, body, roles, user_ids, sent]
    );

    return res.json({ success: true, sent_count: sent });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Broadcast failed.' });
  }
});

export default router;
