import jwt from 'jsonwebtoken';
import pool, { isDatabaseConfigured } from '../db.js';
import { getPageRule } from '../constants/pageAccess.js';
import { isSuperAdmin, isPropertyAdmin } from '../services/adminTier.js';

const JWT_SECRET = process.env.JWT_SECRET || 'gka_fallback_secret_32_chars_long';

function extractToken(req) {
  if (req.headers.authorization?.toLowerCase().startsWith('bearer ')) {
    return req.headers.authorization.slice(7).trim();
  }
  if (req.cookies?.token) return req.cookies.token;
  return null;
}

function loginRedirect(req, res) {
  const next = encodeURIComponent(req.originalUrl || req.path);
  return res.redirect(302, `/login.html?next=${next}`);
}

function roleHomeRedirect(user, res) {
  if (user.role === 'admin') {
    if (isSuperAdmin(user)) return res.redirect(302, '/super-admin/index.html');
    if (isPropertyAdmin(user)) return res.redirect(302, '/property-admin/index.html');
    return res.redirect(302, '/admin-dashboard.html');
  }
  const map = {
    tenant: '/tenant-dashboard.html',
    owner: '/owner-dashboard.html',
    broker: '/broker-dashboard.html'
  };
  return res.redirect(302, map[user.role] || '/login.html');
}

export async function pageGuardMiddleware(req, res, next) {
  const path = req.path || '';
  if (!path.endsWith('.html')) return next();

  const { rule } = getPageRule(path);
  if (!rule) return next();
  if (rule.public) return next();

  const token = extractToken(req);
  if (!token) return loginRedirect(req, res);

  if (!isDatabaseConfigured()) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId || decoded.id;
    const result = await pool.query(
      `SELECT id, email, role, admin_tier, email_verified, phone_verified
       FROM profiles WHERE id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) return loginRedirect(req, res);

    if (rule.auth) return next();

    if (rule.roles?.length && !rule.roles.includes(user.role)) {
      return roleHomeRedirect(user, res);
    }

    if (rule.adminTier === 'super' && !isSuperAdmin(user)) {
      return isPropertyAdmin(user)
        ? res.redirect(302, '/property-admin/index.html')
        : loginRedirect(req, res);
    }

    if (rule.adminTier === 'property' && !isPropertyAdmin(user)) {
      return isSuperAdmin(user)
        ? res.redirect(302, '/super-admin/index.html')
        : loginRedirect(req, res);
    }

    return next();
  } catch {
    return loginRedirect(req, res);
  }
}
