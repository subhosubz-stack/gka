/**
 * URL-level page guard — run in <head> on protected pages (before body paints).
 * Keep PAGE_ACCESS in sync with src/constants/pageAccess.js
 */
(function () {
  'use strict';

  const ROLE_HOME = {
    tenant: '/tenant-dashboard.html',
    owner: '/owner-dashboard.html',
    broker: '/broker-dashboard.html',
    admin: '/admin-dashboard.html'
  };

  const PAGE_ACCESS = {
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

  function pageKey() {
    let p = (location.pathname || '/').replace(/^\//, '').split('?')[0];
    if (!p || p === '') return 'index.html';
    return p;
  }

  function getRule() {
    const key = pageKey();
    if (PAGE_ACCESS[key]) return PAGE_ACCESS[key];
    const base = key.split('/').pop();
    return PAGE_ACCESS[base] || null;
  }

  function adminTierOk(user, tier) {
    if (user?.role !== 'admin') return false;
    const t = user.admin_tier;
    if (tier === 'super') return t === 'super';
    if (tier === 'property') return t === 'property';
    return true;
  }

  function redirect(url) {
    location.replace(url);
    throw new Error('gka-guard-redirect');
  }

  const rule = getRule();
  if (!rule || rule.public) return;

  const token =
    localStorage.getItem('gka_token') || localStorage.getItem('gka_auth_token');
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('gka_user') || 'null');
  } catch {
    user = null;
  }

  if (!token || !user?.id) {
    const next = encodeURIComponent(location.pathname + location.search);
    redirect('/login.html?next=' + next);
  }

  if (rule.roles?.length && !rule.roles.includes(user.role)) {
    if (user.role === 'admin') {
      if (user.admin_tier === 'super') redirect('/super-admin/index.html');
      if (user.admin_tier === 'property') redirect('/property-admin/index.html');
    }
    redirect(ROLE_HOME[user.role] || '/login.html');
  }

  if (rule.adminTier === 'super' && !adminTierOk(user, 'super')) {
    redirect(
      user.admin_tier === 'property'
        ? '/property-admin/index.html'
        : '/admin-dashboard.html'
    );
  }

  if (rule.adminTier === 'property' && !adminTierOk(user, 'property')) {
    redirect(
      user.admin_tier === 'super'
        ? '/super-admin/index.html'
        : '/admin-dashboard.html'
    );
  }

  const apiBase = window.GKA_CONFIG?.API_BASE_URL || '/api';
  fetch(apiBase + '/auth/me', {
    credentials: 'include',
    headers: { Authorization: 'Bearer ' + token }
  })
    .then(function (res) {
      if (!res.ok) {
        localStorage.removeItem('gka_token');
        localStorage.removeItem('gka_auth_token');
        localStorage.removeItem('gka_user');
        const next = encodeURIComponent(location.pathname + location.search);
        redirect('/login.html?next=' + next);
      }
      return res.json();
    })
    .then(function (data) {
      if (!data?.user) return;
      localStorage.setItem('gka_user', JSON.stringify(data.user));
      const u = data.user;
      if (rule.roles?.length && !rule.roles.includes(u.role)) {
        if (u.role === 'admin') {
          if (u.admin_tier === 'super') redirect('/super-admin/index.html');
          if (u.admin_tier === 'property') redirect('/property-admin/index.html');
        }
        redirect(ROLE_HOME[u.role] || '/login.html');
      }
      if (rule.adminTier === 'super' && !adminTierOk(u, 'super')) {
        redirect(
          u.admin_tier === 'property'
            ? '/property-admin/index.html'
            : '/admin-dashboard.html'
        );
      }
      if (rule.adminTier === 'property' && !adminTierOk(u, 'property')) {
        redirect(
          u.admin_tier === 'super'
            ? '/super-admin/index.html'
            : '/admin-dashboard.html'
        );
      }
    })
    .catch(function () {
      localStorage.removeItem('gka_token');
      localStorage.removeItem('gka_auth_token');
      localStorage.removeItem('gka_user');
      const next = encodeURIComponent(location.pathname + location.search);
      redirect('/login.html?next=' + next);
    });
})();
