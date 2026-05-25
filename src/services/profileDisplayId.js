import pool from '../db.js';
import { generateDisplayId } from '../utils/displayId.js';

export async function ensureUserDisplayId(user) {
  if (!user?.id) return user;
  if (user.display_id) return user;

  const displayId = generateDisplayId(user.role || 'tenant');
  await pool.query('UPDATE profiles SET display_id = $1 WHERE id = $2', [displayId, user.id]);
  return { ...user, display_id: displayId };
}
