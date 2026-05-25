import crypto from 'crypto';

const ROLE_PREFIX = {
  tenant: 'TNT',
  owner: 'OWN',
  broker: 'BRK',
  admin: 'ADM',
  property_admin: 'PAD'
};

export function rolePrefix(role) {
  return ROLE_PREFIX[role] || 'USR';
}

export function generateDisplayId(role) {
  const prefix = rolePrefix(role);
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${rand}`;
}

export function formatDisplayId(role, userId) {
  if (!userId) return null;
  const prefix = rolePrefix(role);
  const short = String(userId).replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${prefix}-${short}`;
}

export function parseDisplayId(input) {
  const raw = String(input || '').trim().toUpperCase();
  const m = raw.match(/^(TNT|OWN|BRK|ADM|PAD)-([A-F0-9]{8})$/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const short = m[2].toUpperCase();
  const roleMap = {
    TNT: 'tenant',
    OWN: 'owner',
    BRK: 'broker',
    ADM: 'admin',
    PAD: 'property_admin'
  };
  return { prefix, short, role: roleMap[prefix] || null };
}
