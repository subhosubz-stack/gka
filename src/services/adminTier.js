/** Super admin vs property admin (separate credentials in .env) */

export function getSuperAdminEmail() {
  return (process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

export function getPropertyAdminEmail() {
  return (process.env.PROPERTY_ADMIN_EMAIL || '').trim().toLowerCase();
}

export function getAdminTier(email) {
  const e = (email || '').trim().toLowerCase();
  if (e && e === getSuperAdminEmail()) return 'super';
  if (e && e === getPropertyAdminEmail()) return 'property';
  return null;
}

export function isSuperAdmin(user) {
  return user?.role === 'admin' && getAdminTier(user.email) === 'super';
}

export function isPropertyAdmin(user) {
  return user?.role === 'admin' && getAdminTier(user.email) === 'property';
}

export function isAnyAdmin(user) {
  return user?.role === 'admin' && !!getAdminTier(user.email);
}
