import pool from '../db.js';

export async function expireContactUnlocks() {
  const r = await pool.query(
    `UPDATE contact_unlocks SET is_active = false
     WHERE is_active = true AND expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id`
  );
  return r.rowCount || 0;
}

export async function expirePropertyLocks() {
  await pool.query(`
    UPDATE property_lock_requests SET status = 'expired', updated_at = NOW()
    WHERE status = 'accepted' AND lock_end IS NOT NULL AND lock_end < NOW()
  `);
  const r = await pool.query(`
    UPDATE properties SET availability_status = 'vacant', updated_at = NOW()
    WHERE availability_status = 'locked'
      AND NOT EXISTS (
        SELECT 1 FROM property_lock_requests lr
        WHERE lr.property_id = properties.id AND lr.status = 'accepted'
          AND (lr.lock_end IS NULL OR lr.lock_end > NOW())
      )
    RETURNING id
  `);
  return r.rowCount || 0;
}

export function startContactUnlockExpiryJob(intervalMs = 60 * 60 * 1000) {
  const run = async () => {
    try {
      const n = await expireContactUnlocks();
      if (n > 0) console.log(`[GKA] Expired ${n} contact unlock(s)`);
      const locks = await expirePropertyLocks();
      if (locks > 0) console.log(`[GKA] Released ${locks} locked listing(s)`);
    } catch (e) {
      console.error('[GKA] Expiry job error:', e.message);
    }
  };
  run();
  setInterval(run, intervalMs);
}
