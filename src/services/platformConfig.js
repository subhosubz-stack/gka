import pool from '../db.js';

const DEFAULTS = {
  contact_unlock_standard_inr: '29',
  contact_unlock_premium_inr: '49',
  contact_unlock_days: '30',
  lock_request_hide_days: '7',
  visibility_boost_inr: '99',
  default_listing_youtube_id: 'UfEiKK-iX70',
  max_listing_photos: '12',
  roommate_unlock_inr: '29',
  tiffin_commission_percent: '10'
};

export async function getSetting(key, fallback = null) {
  try {
    const r = await pool.query(`SELECT value FROM platform_settings WHERE key = $1`, [key]);
    if (r.rows.length === 0) return fallback ?? DEFAULTS[key] ?? null;
    const v = r.rows[0].value;
    if (typeof v === 'string') return v.replace(/^"|"$/g, '');
    return String(v);
  } catch {
    return fallback ?? DEFAULTS[key] ?? null;
  }
}

export async function getAllSettings() {
  const r = await pool.query(`SELECT key, value, description FROM platform_settings ORDER BY key`);
  const map = { ...DEFAULTS };
  for (const row of r.rows) {
    let val = row.value;
    if (typeof val === 'string') val = val.replace(/^"|"$/g, '');
    else if (val != null) val = String(val);
    map[row.key] = val;
  }
  return map;
}

export async function setSetting(key, value, description = null) {
  await pool.query(
    `INSERT INTO platform_settings (key, value, description, updated_at)
     VALUES ($1, to_jsonb($2::text), $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = to_jsonb($2::text), description = COALESCE($3, platform_settings.description), updated_at = NOW()`,
    [key, String(value), description]
  );
}
