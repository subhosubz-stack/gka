import { isAnyAdmin, isPropertyAdmin, isSuperAdmin } from '../services/adminTier.js';

export function requireAdmin(req, res, next) {
  if (!isAnyAdmin(req.user)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

export function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Super admin access required.' });
  }
  return next();
}

export function requirePropertyAdmin(req, res, next) {
  if (!isPropertyAdmin(req.user)) {
    return res.status(403).json({ error: 'Property admin access required.' });
  }
  return next();
}
