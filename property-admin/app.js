(function () {
  const API = window.GKA_CONFIG?.API_BASE_URL || '/api';
  const token = localStorage.getItem('gka_token');
  const user = JSON.parse(localStorage.getItem('gka_user') || '{}');
  if (!token || user.admin_tier !== 'property') {
    location.href = '../login.html';
    return;
  }

  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const toast = document.getElementById('admToast');
  const editModal = document.getElementById('editModal');
  const editForm = document.getElementById('editForm');
  let editingId = null;

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }

  document.getElementById('logoutBtn').onclick = () => {
    localStorage.clear();
    location.href = '../login.html';
  };

  document.getElementById('editCancel').onclick = () => {
    editModal.style.display = 'none';
    editingId = null;
  };

  const COLLEGES = [
    'CGC UNIVERSITY MOHALI',
    'CHANDIGARH UNIVERSITY',
    'CGC LANDRAN',
    'QUEST GROUP OF COLLEGES',
    'CHITKARA UNIVERSITY'
  ];

  function openEdit(p) {
    editingId = p.id;
    editForm.innerHTML = `
      <input name="title" required placeholder="Title *" value="${esc(p.title)}">
      <input name="city" required placeholder="City *" value="${esc(p.city || 'Mohali')}">
      <input name="locality" placeholder="Locality" value="${esc(p.locality || '')}">
      <input name="address_line" placeholder="Address" value="${esc(p.address_line || '')}">
      <select name="nearest_college">${COLLEGES.map((c) => `<option ${p.nearest_college === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <input name="actual_price" type="number" placeholder="Actual price ₹" value="${p.actual_price || ''}">
      <input name="offer_price" type="number" required placeholder="Offer price ₹" value="${p.offer_price || p.monthly_rent || ''}">
      <input name="offer_reason" placeholder="Offer reason" value="${esc(p.offer_reason || '')}">
      <input name="security_deposit" type="number" placeholder="Deposit" value="${p.security_deposit || 0}">
      <select name="status">
        <option value="pending" ${p.status === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="approved" ${p.status === 'approved' ? 'selected' : ''}>Approved</option>
        <option value="rejected" ${p.status === 'rejected' ? 'selected' : ''}>Rejected</option>
      </select>
      <select name="listing_type">
        <option value="regular" ${p.listing_type !== 'premium' ? 'selected' : ''}>Standard</option>
        <option value="premium" ${p.listing_type === 'premium' ? 'selected' : ''}>Premium</option>
      </select>
      <input name="display_rank" type="number" placeholder="Display rank" value="${p.display_rank ?? ''}">
      <textarea name="description" rows="3" placeholder="Description">${esc(p.description || '')}</textarea>
      <input name="youtube_url" placeholder="YouTube URL" value="${esc(p.youtube_url || '')}">
    `;
    editModal.style.display = 'block';
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  editForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!editingId) return;
    const fd = new FormData(editForm);
    const body = Object.fromEntries(fd.entries());
    body.verified = body.status === 'approved';
    const res = await fetch(`${API}/property-admin/properties/${editingId}`, {
      method: 'PUT',
      headers: h,
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Update failed');
      return;
    }
    showToast('Property updated');
    editModal.style.display = 'none';
    load();
  };

  async function load() {
    const res = await fetch(`${API}/property-admin/dashboard`, { headers: h });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Load failed');
      return;
    }

    const el = document.getElementById('pendingProps');
    el.innerHTML = (data.pending_properties || [])
      .map(
        (p) => `
      <div style="border:1px solid rgba(122,78,45,.15);border-radius:16px;padding:16px;margin:12px 0;background:#fff;">
        <strong>${p.title}</strong> — ${p.city}<br>
        <small>Owner: ${p.owner_name || '—'} · ${p.owner_email || ''}</small><br>
        <small>Rent: ₹${p.offer_price || p.monthly_rent} · ${p.nearest_college || 'No college'}</small>
        <div class="adm-actions" style="margin-top:12px;">
          <button class="adm-btn edit-prop" data-id="${p.id}">Edit</button>
          <button class="adm-btn ok approve" data-id="${p.id}">Approve</button>
          <button class="adm-btn danger reject" data-id="${p.id}">Reject</button>
        </div>
      </div>`
      )
      .join('') || '<p class="gka-sub">No pending listings.</p>';

    el.querySelectorAll('.edit-prop').forEach((btn) => {
      btn.onclick = () => {
        const p = data.pending_properties.find((x) => x.id === btn.dataset.id);
        if (p) openEdit(p);
      };
    });

    el.querySelectorAll('.approve').forEach((btn) => {
      btn.onclick = async () => {
        await fetch(`${API}/property-admin/properties/${btn.dataset.id}/approve`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({})
        });
        showToast('Listing approved');
        load();
      };
    });

    el.querySelectorAll('.reject').forEach((btn) => {
      btn.onclick = async () => {
        const reason = prompt('Reject reason (optional)') || '';
        await fetch(`${API}/property-admin/properties/${btn.dataset.id}/reject`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ reason })
        });
        showToast('Listing rejected');
        load();
      };
    });

    const allEl = document.getElementById('allPropsList');
    allEl.innerHTML = (data.all_properties || [])
      .slice(0, 50)
      .map(
        (p) => `
      <div style="border:1px solid rgba(122,78,45,.12);border-radius:12px;padding:12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <span><strong>${p.title}</strong> · ${p.city} · ${p.status} · ₹${p.offer_price || p.monthly_rent}/mo</span>
        <button type="button" class="adm-btn edit-all" data-id="${p.id}">Edit all fields</button>
      </div>`
      )
      .join('') || '<p class="gka-sub">No properties yet.</p>';

    allEl.querySelectorAll('.edit-all').forEach((btn) => {
      btn.onclick = () => {
        const p = data.all_properties.find((x) => x.id === btn.dataset.id);
        if (p) openEdit(p);
      };
    });

    const tbody = document.getElementById('pendingProfiles');
    tbody.innerHTML = (data.pending_profiles || [])
      .map(
        (p) => `
      <tr>
        <td>${p.full_name}</td>
        <td>${p.email}<br><small>${p.phone || ''}</small></td>
        <td><span class="tag">${p.role}</span></td>
        <td>${p.verification_status}</td>
        <td>
          <button class="adm-btn ok verify-profile" data-id="${p.id}">Verify</button>
          <button class="adm-btn danger reject-profile" data-id="${p.id}">Reject</button>
        </td>
      </tr>`
      )
      .join('') || '<tr><td colspan="5">No pending profiles.</td></tr>';

    tbody.querySelectorAll('.verify-profile').forEach((btn) => {
      btn.onclick = async () => {
        await fetch(`${API}/property-admin/profiles/${btn.dataset.id}/verify`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ status: 'verified' })
        });
        showToast('Profile verified');
        load();
      };
    });

    tbody.querySelectorAll('.reject-profile').forEach((btn) => {
      btn.onclick = async () => {
        await fetch(`${API}/property-admin/profiles/${btn.dataset.id}/verify`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ status: 'rejected' })
        });
        showToast('Profile rejected');
        load();
      };
    });
  }

  document.getElementById('addForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      title: title.value,
      city: city.value,
      locality: locality.value,
      nearest_college: college.value,
      monthly_rent: offerPrice.value,
      offer_price: offerPrice.value,
      actual_price: actualPrice.value || null,
      offer_reason: offerReason.value || null,
      display_rank: rank.value || null,
      description: desc.value,
      property_type: 'room',
      state: 'Punjab'
    };
    const res = await fetch(`${API}/property-admin/properties`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed');
      return;
    }
    showToast('Property added & live');
    e.target.reset();
    city.value = 'Mohali';
    load();
  };

  load();
})();
