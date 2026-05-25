import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { ensureCoreSchema } from '../services/ensureSchema.js';
import { ensureUserDisplayId } from '../services/profileDisplayId.js';

const JWT_SECRET = process.env.JWT_SECRET || 'gka_fallback_secret_32_chars_long';

export async function protect(req, res, next) {
  let token = null;

  // Check Auth Header
  if (req.headers.authorization && req.headers.authorization.toLowerCase().startsWith('bearer ')) {
    token = req.headers.authorization.substring(7).trim();
  } 
  // Check Cookies
  else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No session token found.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await ensureCoreSchema();

    // Query profile from database
    const result = await pool.query(
      `SELECT id, display_id, email, full_name, phone, role, onboarding_step,
              email_verified, phone_verified, auth_provider, auth_user_id, admin_tier, metadata
       FROM profiles WHERE id = $1`,
      [decoded.userId || decoded.id]
    );

    let user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'User session invalid. Account not found.' });
    }

    user = await ensureUserDisplayId(user);
    req.user = user;
    return next();
  } catch (err) {
    console.error('Authorization Middleware error:', err.message);
    return res.status(401).json({ error: 'Authentication token is expired or invalid.' });
  }
}

// Role specific authorization factories
export function restrictTo(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Requires one of these roles: ${roles.join(', ')}` });
    }
    return next();
  };
}
