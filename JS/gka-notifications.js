/**
 * Notification bell — all non-admin panels.
 */
window.GKANotify = (function () {
  const API = () => window.GKA_CONFIG?.API_BASE_URL || '/api';

  function token() {
    return localStorage.getItem('gka_token') || localStorage.getItem('gka_auth_token');
  }

  function headers() {
    return { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' };
  }

  async function fetchList() {
    const res = await fetch(`${API()}/notifications`, { headers: headers() });
    if (!res.ok) return [];
    return res.json();
  }

  async function fetchUnreadCount() {
    const res = await fetch(`${API()}/notifications/unread-count`, { headers: headers() });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.count || 0;
  }

  async function markRead(id) {
    await fetch(`${API()}/notifications/${id}/read`, { method: 'POST', headers: headers() });
  }

  async function markAllRead() {
    await fetch(`${API()}/notifications/read-all`, { method: 'POST', headers: headers() });
  }

  function mountBell(container) {
    if (!container || !token()) return;

    const wrap = document.createElement('div');
    wrap.className = 'gka-notify-wrap';
    wrap.innerHTML = `
      <button type="button" class="gka-shell-btn gka-notify-btn" aria-label="Notifications">
        <i class="fa-solid fa-bell"></i>
        <span class="gka-shell-badge gka-notify-count"></span>
      </button>
      <div class="gka-notify-panel" id="gkaNotifyPanel"></div>
    `;
    container.appendChild(wrap);

    const btn = wrap.querySelector('.gka-notify-btn');
    const panel = wrap.querySelector('.gka-notify-panel');
    const badge = wrap.querySelector('.gka-notify-count');

    async function refreshBadge() {
      const n = await fetchUnreadCount();
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.classList.toggle('show', n > 0);
    }

    async function renderPanel() {
      const list = await fetchList();
      if (!list.length) {
        panel.innerHTML = '<p class="gka-notify-empty">No notifications yet.</p>';
        return;
      }
      panel.innerHTML =
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <strong style="font-size:13px;color:#7a4e2d;">Notifications</strong>
          <button type="button" class="gka-shell-btn" style="min-height:32px;padding:0 10px;font-size:11px;" id="gkaMarkAllRead">Mark all read</button>
        </div>` +
        list
          .map(
            (n) => `
          <div class="gka-notify-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
            <strong>${escape(n.title)}</strong>
            ${escape(n.body)}
            <div style="font-size:11px;color:#77695f;margin-top:6px;">${new Date(n.created_at).toLocaleString('en-IN')}</div>
          </div>`
          )
          .join('');

      panel.querySelector('#gkaMarkAllRead')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await markAllRead();
        await renderPanel();
        await refreshBadge();
      });

      panel.querySelectorAll('.gka-notify-item').forEach((el) => {
        el.addEventListener('click', async () => {
          await markRead(el.dataset.id);
          el.classList.remove('unread');
          await refreshBadge();
        });
      });
    }

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const open = panel.classList.toggle('show');
      if (open) await renderPanel();
    });

    document.addEventListener('click', () => panel.classList.remove('show'));

    refreshBadge();
    setInterval(refreshBadge, 60000);

    return { refreshBadge };
  }

  function escape(t) {
    const d = document.createElement('div');
    d.textContent = t || '';
    return d.innerHTML;
  }

  return { mountBell, fetchUnreadCount, refreshBadge: async () => {} };
})();
