/**
 * Unified dashboard navigation for tenant, owner, and broker panels.
 */
(function () {
  const NAV = {
    tenant: [
      { href: 'tenant-dashboard.html', label: 'Hub', icon: 'fa-grid-2' },
      { href: 'tenant-wishlist.html', label: 'Wishlist', icon: 'fa-heart' },
      { href: 'tenant-search-dashboard.html', label: 'Find', icon: 'fa-magnifying-glass-location' },
      { href: 'tenant-match.html', label: 'Match', icon: 'fa-people-arrows' },
      { href: 'tenant-resident-dashboard.html', label: 'Resident', icon: 'fa-hotel' },
      { href: 'tenant-chats.html', label: 'Messages', icon: 'fa-comments' },
      { href: 'support.html', label: 'Support', icon: 'fa-headset' }
    ],
    owner: [
      { href: 'owner-dashboard.html', label: 'Dashboard', icon: 'fa-gauge-high' },
      { href: 'owner-onboarding.html', label: 'List property', icon: 'fa-plus' },
      { href: 'owner-dashboard.html#ownerChatInbox', label: 'Messages', icon: 'fa-comments' },
      { href: 'support.html', label: 'Support', icon: 'fa-headset' }
    ],
    broker: [
      { href: 'broker-dashboard.html', label: 'Dashboard', icon: 'fa-gauge-high' },
      { href: 'owner-onboarding.html', label: 'List property', icon: 'fa-plus' },
      { href: 'broker-dashboard.html#brokerChatInbox', label: 'Messages', icon: 'fa-comments' },
      { href: 'support.html', label: 'Support', icon: 'fa-headset' }
    ]
  };

  function pathPrefix() {
    const p = window.location.pathname || '';
    return p.includes('/services/') || p.includes('/super-admin/') || p.includes('/property-admin/')
      ? '../'
      : '';
  }

  function currentPage() {
    const p = (location.pathname || '').replace(/^\//, '');
    return p.split('/').pop() || 'index.html';
  }

  function mount(container) {
    if (!container) return;
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem('gka_user') || 'null');
    } catch {
      user = null;
    }
    const links = NAV[user?.role];
    if (!links) return;

    const pre = pathPrefix();
    const page = currentPage();
    const hash = location.hash || '';

    container.className = 'gka-dash-nav';
    container.innerHTML = links
      .map((item) => {
        const href = pre + item.href;
        const itemPath = item.href.split('#')[0];
        const itemHash = item.href.includes('#') ? '#' + item.href.split('#')[1] : '';
        const active =
          page === itemPath && (!itemHash || hash === itemHash);
        return `<a href="${href}" class="gka-dash-nav-link${active ? ' is-active' : ''}">
          <i class="fa-solid ${item.icon}"></i><span>${item.label}</span>
        </a>`;
      })
      .join('');
  }

  function init() {
    document.querySelectorAll('[data-gka-dash-nav]').forEach(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GKADashboardNav = { mount };
})();
