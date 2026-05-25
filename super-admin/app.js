(function () {
  const API = window.GKA_CONFIG?.API_BASE_URL || '/api';
  const token = localStorage.getItem('gka_token');
  const user = JSON.parse(localStorage.getItem('gka_user') || '{}');
  if (!token || user.admin_tier !== 'super') {
    location.href = '../login.html';
    return;
  }

  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const toast = document.getElementById('admToast');
  let charts = {};
  let analyticsCache = null;

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${API}/super-admin${path}`, {
      ...opts,
      headers: { ...h, ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  document.querySelectorAll('.adm-nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.adm-nav button').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.adm-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
      const load = btn.dataset.load;
      if (load) window[load]();
    });
  });

  document.getElementById('logoutBtn').onclick = () => {
    localStorage.clear();
    location.href = '../login.html';
  };

  function destroyCharts() {
    Object.values(charts).forEach((c) => c.destroy());
    charts = {};
  }

  function makeChart(id, type, labels, data, label) {
    const ctx = document.getElementById(id);
    if (!ctx || !window.Chart) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type,
      data: {
        labels,
        datasets: [
          {
            label,
            data,
            backgroundColor:
              type === 'line'
                ? 'rgba(122,78,45,0.2)'
                : ['#7a4e2d', '#a67c52', '#c4a882', '#5c3a22', '#d4b896'],
            borderColor: '#7a4e2d',
            fill: type === 'line',
            tension: 0.35
          }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type !== 'line' } } }
    });
  }

  window.loadOverview = async function () {
    const data = await api('/analytics');
    analyticsCache = data;
    const t = data.totals;
    const kpi = document.getElementById('kpiGrid');
    kpi.innerHTML = `
      <div class="adm-kpi"><strong>${t.total_users}</strong><span>Total users</span></div>
      <div class="adm-kpi"><strong>${t.students}</strong><span>Students</span></div>
      <div class="adm-kpi"><strong>${t.owners}</strong><span>Owners</span></div>
      <div class="adm-kpi"><strong>${t.brokers}</strong><span>Brokers</span></div>
      <div class="adm-kpi"><strong>${t.live_properties}</strong><span>Live listings</span></div>
      <div class="adm-kpi"><strong>${t.pending_properties}</strong><span>Pending listings</span></div>
      <div class="adm-kpi"><strong>${t.wishlist_total}</strong><span>Wishlist saves</span></div>
      <div class="adm-kpi"><strong>₹${Number(t.revenue_paid || 0).toLocaleString('en-IN')}</strong><span>Paid revenue</span></div>
      <div class="adm-kpi"><strong>${t.messages_total}</strong><span>Chat messages</span></div>
      <div class="adm-kpi"><strong>${t.bookings_total}</strong><span>Bookings</span></div>
      <div class="adm-kpi"><strong>${data.activity_7d?.signups_7d || 0}</strong><span>Signups (7d)</span></div>
      <div class="adm-kpi"><strong>${data.activity_7d?.payments_7d || 0}</strong><span>Payments (7d)</span></div>
    `;

    destroyCharts();
    makeChart(
      'chartSignups',
      'line',
      data.signups_by_day.map((r) => r.day),
      data.signups_by_day.map((r) => r.count),
      'New users'
    );
    makeChart(
      'chartRoles',
      'doughnut',
      data.users_by_role.map((r) => r.role),
      data.users_by_role.map((r) => r.count),
      'By role'
    );
    makeChart(
      'chartProps',
      'bar',
      data.properties_by_status.map((r) => r.status),
      data.properties_by_status.map((r) => r.count),
      'Listings'
    );
    makeChart(
      'chartRevenue',
      'line',
      data.payments_by_day.map((r) => r.day),
      data.payments_by_day.map((r) => Number(r.paid_amount)),
      'Revenue ₹'
    );

    const top = document.getElementById('topWishlistProps');
    top.innerHTML = `<table class="adm-table"><thead><tr><th>Property</th><th>City</th><th>Saves</th></tr></thead><tbody>${data.wishlist_top_properties
      .slice(0, 10)
      .map(
        (p) =>
          `<tr><td>${p.title}</td><td>${p.city || '—'}</td><td><strong>${p.wishlist_count}</strong></td></tr>`
      )
      .join('')}</tbody></table>`;
  };

  window.loadUsers = async function () {
    const users = await api('/users');
    const el = document.getElementById('usersTable');
    el.innerHTML = users
      .filter((u) => u.role !== 'admin')
      .map(
        (u) => `
      <tr>
        <td>${u.full_name || '—'}<br><small>${u.email}</small></td>
        <td><span class="tag">${u.role}</span></td>
        <td>${u.wishlist_count} / ${u.payment_count} / ${u.messages_sent}</td>
        <td>${u.banned ? '<span class="tag banned">Banned</span>' : '<span class="tag">Active</span>'}</td>
        <td class="adm-actions">
          ${u.banned ? `<button class="adm-btn ok" data-uid="${u.id}" data-ban="0">Unban</button>` : `<button class="adm-btn danger" data-uid="${u.id}" data-ban="1">Ban</button>`}
        </td>
      </tr>`
      )
      .join('');

    el.querySelectorAll('[data-ban]').forEach((btn) => {
      btn.onclick = async () => {
        await api(`/users/${btn.dataset.uid}`, {
          method: 'PATCH',
          body: JSON.stringify({ banned: btn.dataset.ban === '1' })
        });
        showToast('User updated');
        loadUsers();
      };
    });
  };

  window.loadProperties = async function () {
    const status = document.getElementById('propFilter').value;
    const q = document.getElementById('propSearch').value;
    const props = await api(`/properties?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
    const el = document.getElementById('propsTable');
    el.innerHTML = props
      .map(
        (p) => `
      <tr>
        <td><strong>${p.title}</strong><br><small>${p.city} · ${p.nearest_college || '—'}</small></td>
        <td>${p.owner_name || 'Platform'}<br><small>${p.owner_email || ''}</small></td>
        <td><span class="tag">${p.status}</span> · ♥ ${p.wishlist_count}</td>
        <td>₹${p.monthly_rent}</td>
        <td class="adm-actions">
          ${p.status !== 'approved' ? `<button class="adm-btn ok" data-pid="${p.id}" data-act="approved">Approve</button>` : ''}
          ${p.status !== 'archived' ? `<button class="adm-btn danger" data-pid="${p.id}" data-act="archived">Ban/Hide</button>` : ''}
          ${p.status === 'archived' ? `<button class="adm-btn" data-pid="${p.id}" data-act="approved">Restore</button>` : ''}
        </td>
      </tr>`
      )
      .join('');

    el.querySelectorAll('[data-pid]').forEach((btn) => {
      btn.onclick = async () => {
        await api(`/properties/${btn.dataset.pid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: btn.dataset.act })
        });
        showToast('Property updated');
        loadProperties();
      };
    });
  };

  document.getElementById('propFilter').onchange = loadProperties;
  document.getElementById('propSearch').oninput = () => clearTimeout(window._ps) || (window._ps = setTimeout(loadProperties, 400));

  window.loadWishlists = async function () {
    const data = await api('/wishlists');
    document.getElementById('wishTop').innerHTML = data.top_properties
      .map((p) => `<div class="tag" style="margin:4px;">${p.title}: ${p.saves}</div>`)
      .join('');
    document.getElementById('wishTable').innerHTML = data.entries
      .map(
        (e) => `
      <tr>
        <td>${e.student_name}<br><small>${e.student_email}</small></td>
        <td>${e.title}<br><small>${e.city}</small></td>
        <td>${new Date(e.created_at).toLocaleString('en-IN')}</td>
      </tr>`
      )
      .join('');
  };

  window.loadPayments = async function () {
    const st = document.getElementById('payFilter').value;
    const payments = await api(`/payments?status=${encodeURIComponent(st)}`);
    const el = document.getElementById('paymentsTable');
    el.innerHTML = payments
      .map(
        (p) => `
      <tr>
        <td>${p.user_name || '—'}<br><small>${p.user_email}</small></td>
        <td>${p.property_title || '—'}</td>
        <td>₹${p.amount} · ${p.purpose}</td>
        <td><span class="tag ${p.status === 'paid' ? 'paid' : ''}">${p.status}</span></td>
        <td>${new Date(p.created_at).toLocaleString('en-IN')}</td>
        <td class="adm-actions">
          ${p.status !== 'paid' ? `<button class="adm-btn ok" data-pay="${p.id}" data-act="approve">Approve</button>` : ''}
          ${p.status !== 'cancelled' && p.status !== 'paid' ? `<button class="adm-btn danger" data-pay="${p.id}" data-act="reject">Reject</button>` : ''}
        </td>
      </tr>`
      )
      .join('');

    el.querySelectorAll('[data-pay]').forEach((btn) => {
      btn.onclick = async () => {
        const path =
          btn.dataset.act === 'approve'
            ? `/payments/${btn.dataset.pay}/approve`
            : `/payments/${btn.dataset.pay}/reject`;
        await api(path, { method: 'POST', body: JSON.stringify({}) });
        showToast('Payment updated');
        loadPayments();
      };
    });
  };

  document.getElementById('payFilter').onchange = loadPayments;

  window.loadBranding = async function () {
    const b = await api('/settings/branding');
    brandLogo.value = b.logo_url || '';
    brandFavicon.value = b.favicon_url || '';
    brandSite.value = b.site_name || '';
    brandTagline.value = b.tagline || '';
    brandEmail.value = b.support_email || '';
    brandWa.value = b.support_whatsapp || '';
    brandHero.value = b.hero_image_url || '';
    brandPreview.src = b.logo_url || '';
  };

  document.getElementById('saveBrand').onclick = async () => {
    await api('/settings/branding', {
      method: 'PUT',
      body: JSON.stringify({
        logo_url: brandLogo.value,
        favicon_url: brandFavicon.value,
        site_name: brandSite.value,
        tagline: brandTagline.value,
        support_email: brandEmail.value,
        support_whatsapp: brandWa.value,
        hero_image_url: brandHero.value
      })
    });
    brandPreview.src = brandLogo.value;
    showToast('Branding saved — site will pick this up automatically');
  };

  brandLogo.oninput = () => (brandPreview.src = brandLogo.value);

  document.getElementById('savePlatform').onclick = async () => {
    const keys = ['contact_unlock_standard_inr', 'contact_unlock_premium_inr', 'contact_unlock_days', 'visibility_boost_inr'];
    const body = {};
    keys.forEach((k) => {
      const el = document.getElementById('set_' + k);
      if (el) body[k] = el.value;
    });
    await api('/settings/platform', { method: 'PUT', body: JSON.stringify(body) });
    showToast('Platform pricing saved');
  };

  document.getElementById('sendBroadcast').onclick = async () => {
    const roles = [...document.querySelectorAll('.roleTick:checked')].map((c) => c.value);
    const data = await api('/broadcast', {
      method: 'POST',
      body: JSON.stringify({ title: bTitle.value, body: bBody.value, roles })
    });
    showToast(`Sent to ${data.sent_count} users`);
  };

  window.loadSupport = async function () {
    const res = await fetch(`${API}/support/admin`, { headers: h });
    const rows = await res.json();
    const el = document.getElementById('supportInbox');
    if (!rows.length) {
      el.innerHTML = '<p style="color:#77695f;">No support messages yet.</p>';
      return;
    }
    el.innerHTML = rows
      .map(
        (m) => `
      <div style="border:1px solid rgba(122,78,45,.15);border-radius:14px;padding:16px;margin-bottom:12px;background:#fff;">
        <strong>${m.subject}</strong> <span style="font-size:11px;font-weight:800;color:#7a4e2d;">${m.status}</span>
        <p style="font-size:13px;color:#77695f;margin:8px 0;">${m.body}</p>
        <small>${m.user_name || 'User'} · ${m.user_email || ''} · ${m.user_role || ''} · ${new Date(m.created_at).toLocaleString()}</small>
        ${m.admin_reply ? `<p style="margin-top:8px;font-weight:700;">Reply: ${m.admin_reply}</p>` : ''}
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="adm-btn ok reply-support" data-id="${m.id}">Reply & close</button>
          <button type="button" class="adm-btn" data-id="${m.id}" data-status="open">Mark open</button>
        </div>
      </div>`
      )
      .join('');
    el.querySelectorAll('.reply-support').forEach((btn) => {
      btn.onclick = async () => {
        const reply = prompt('Your reply to the user:');
        if (reply == null) return;
        await fetch(`${API}/support/admin/${btn.dataset.id}`, {
          method: 'PATCH',
          headers: h,
          body: JSON.stringify({ admin_reply: reply, status: 'closed' })
        });
        showToast('Reply saved');
        loadSupport();
      };
    });
    el.querySelectorAll('[data-status]').forEach((btn) => {
      if (btn.classList.contains('reply-support')) return;
      btn.onclick = async () => {
        await fetch(`${API}/support/admin/${btn.dataset.id}`, {
          method: 'PATCH',
          headers: h,
          body: JSON.stringify({ status: btn.dataset.status })
        });
        loadSupport();
      };
    });
  };

  window.loadChats = async function () {
    const chats = await api('/conversations');
    const el = document.getElementById('chatList');
    el.innerHTML = chats
      .map(
        (c) =>
          `<button type="button" class="adm-btn" style="width:100%;margin-bottom:8px;text-align:left;" data-cid="${c.id}">${c.property_title || 'Chat'} — ${c.tenant_name} ↔ ${c.owner_name}</button>`
      )
      .join('');
    el.querySelectorAll('[data-cid]').forEach((btn) => {
      btn.onclick = async () => {
        const msgs = await api(`/conversations/${btn.dataset.cid}/messages`);
        document.getElementById('chatMsgs').innerHTML = msgs
          .map((m) => `<p><strong>${m.sender_name}</strong> (${m.sender_role}): ${m.body || m.message || '—'}</p>`)
          .join('');
      };
    });
  };

  async function initPlatformSettings() {
    const s = await api('/settings/platform');
    ['contact_unlock_standard_inr', 'contact_unlock_premium_inr', 'contact_unlock_days', 'visibility_boost_inr'].forEach(
      (k) => {
        const el = document.getElementById('set_' + k);
        if (el && s[k] != null) el.value = s[k];
      }
    );
  }

  loadOverview();
  initPlatformSettings();
})();
