/** HTML page access rules — keep in sync with JS/gka-route-guard.js */

export const ROLE_HOME = {
  tenant: '/tenant-dashboard.html',
  owner: '/owner-dashboard.html',
  broker: '/broker-dashboard.html',
  admin: '/admin-dashboard.html'
};

export const PAGE_ACCESS = {
  'index.html': { public: true },
  'login.html': { public: true },
  'signup.html': { public: true },
  'coming-soon.html': { public: true },
  'discover.html': { public: true },
  'listing.html': { public: true },
  'product-tour.html': { auth: true },

  'role-select.html': { auth: true },
  'support.html': { roles: ['tenant', 'owner', 'broker'] },
  'verify-account.html': { auth: true },

  'tenant-dashboard.html': { roles: ['tenant'] },
  'tenant-search-dashboard.html': { roles: ['tenant'] },
  'tenant-match.html': { roles: ['tenant'] },
  'tenant-tiffin.html': { roles: ['tenant'] },
  'tenant-wishlist.html': { roles: ['tenant'] },
  'tenant-chats.html': { roles: ['tenant'] },
  'tenant-resident-dashboard.html': { roles: ['tenant'] },
  'services/services-onboarding.html': { roles: ['tenant'] },
  'services/services-dashboard.html': { roles: ['tenant'] },

  'owner-dashboard.html': { roles: ['owner'] },
  'owner-onboarding.html': { roles: ['owner', 'broker'] },

  'broker-dashboard.html': { roles: ['broker'] },
  'broker-onboarding.html': { roles: ['broker'] },

  'admin-dashboard.html': { roles: ['admin'] },
  'super-admin/index.html': { roles: ['admin'], adminTier: 'super' },
  'property-admin/index.html': { roles: ['admin'], adminTier: 'property' }
};

export function normalizePagePath(urlPath) {
  let p = (urlPath || '/').split('?')[0].replace(/\\/g, '/');
  if (p.endsWith('/')) p = p.slice(0, -1) || '/';
  if (p === '/' || p === '') return 'index.html';
  const trimmed = p.startsWith('/') ? p.slice(1) : p;
  return trimmed.includes('/') ? trimmed : trimmed;
}

export function getPageRule(urlPath) {
  const key = normalizePagePath(urlPath);
  if (PAGE_ACCESS[key]) return { key, rule: PAGE_ACCESS[key] };
  const base = key.split('/').pop();
  if (PAGE_ACCESS[base]) return { key: base, rule: PAGE_ACCESS[base] };
  return { key, rule: null };
}
