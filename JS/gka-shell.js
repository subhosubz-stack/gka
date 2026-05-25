/**
 * Top bar tools: notifications (all roles except admin), wishlist + chats (tenant).
 */
(function () {
  function pathPrefix() {
    const p = window.location.pathname || '';
    return p.includes('/services/') ? '../' : '';
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('gka_user') || 'null');
    } catch {
      return null;
    }
  }

  function mount(slot) {
    if (!slot) return;
    const user = getUser();
    if (!user?.id) return;
    if (user.role === 'admin') return;

    slot.classList.add('gka-shell-slot');
    slot.innerHTML = '';

    if (window.GKAProfileBadge) {
      const idSlot = document.createElement('div');
      idSlot.className = 'gka-shell-id-wrap';
      GKAProfileBadge.mount(idSlot, user);
      slot.appendChild(idSlot);
    }

    if (window.GKANotify) {
      GKANotify.mountBell(slot);
    }

    if (user.role === 'tenant') {
      const pre = pathPrefix();
      const wish = document.createElement('a');
      wish.href = `${pre}tenant-wishlist.html`;
      wish.className = 'gka-shell-btn';
      wish.innerHTML = '<i class="fa-solid fa-heart"></i> Wishlist';
      slot.appendChild(wish);

      const chats = document.createElement('a');
      chats.href = `${pre}tenant-chats.html`;
      chats.className = 'gka-shell-btn';
      chats.innerHTML = '<i class="fa-solid fa-comments"></i> Messages';
      slot.appendChild(chats);
    }

    if (user.role === 'owner') {
      const chats = document.createElement('a');
      chats.href = 'owner-dashboard.html#ownerChatInbox';
      chats.className = 'gka-shell-btn';
      chats.innerHTML = '<i class="fa-solid fa-comments"></i> Messages';
      slot.appendChild(chats);
    }

    if (user.role === 'broker') {
      const chats = document.createElement('a');
      chats.href = 'broker-dashboard.html#brokerChatInbox';
      chats.className = 'gka-shell-btn';
      chats.innerHTML = '<i class="fa-solid fa-comments"></i> Messages';
      slot.appendChild(chats);
    }
  }

  function init() {
    document.querySelectorAll('.gka-shell-slot[data-auto], .gka-shell-slot:empty').forEach(mount);
    document.querySelectorAll('[data-gka-shell]').forEach((el) => mount(el));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GKAShell = { mount };
})();
