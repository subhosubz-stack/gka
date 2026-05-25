/**
 * Full property detail drawer (View button on listing cards).
 */
window.GKAPropertyView = (function () {
  let overlay = null;
  let panel = null;
  let content = null;

  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'gka-detail-overlay';
    overlay.id = 'gkaPropertyDetailOverlay';
    overlay.innerHTML = `
      <aside class="gka-detail-panel" id="gkaPropertyDetailPanel">
        <button type="button" class="gka-btn gka-btn-ghost" id="gkaDetailClose" style="margin-bottom:16px;">
          <i class="fa-solid fa-xmark"></i> Close
        </button>
        <div id="gkaDetailContent"></div>
      </aside>
    `;
    document.body.appendChild(overlay);
    content = overlay.querySelector('#gkaDetailContent');
    panel = overlay.querySelector('#gkaPropertyDetailPanel');
    overlay.querySelector('#gkaDetailClose').onclick = close;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function parseAmenities(p) {
    let list = p.amenities;
    if (typeof list === 'string') {
      try {
        list = JSON.parse(list);
      } catch {
        list = [];
      }
    }
    return window.GKAAmenities ? GKAAmenities.normalizeList(list || []) : list || [];
  }

  function parseRules(p) {
    let rules = p.rules;
    if (typeof rules === 'string') {
      try {
        rules = JSON.parse(rules);
      } catch {
        rules = {};
      }
    }
    return rules && typeof rules === 'object' ? rules : {};
  }

  function formatDate(d) {
    if (!d) return 'Immediate';
    try {
      return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return d;
    }
  }

  function render(property, { onUnlock, onLock, onChat } = {}) {
    ensureDom();
    const amenities = parseAmenities(property);
    const rules = parseRules(property);
    const isPremium = property.listing_type === 'premium' || property.is_premium;
    const hero = window.GKAListingMedia
      ? GKAListingMedia.cardHeroHtml(property, { height: 220 })
      : `<div style="height:220px;background:#ddd;border-radius:22px;"></div>`;

    const amenityHtml = amenities.length
      ? amenities
          .map((a) => {
            const meta = (window.GKA_AMENITIES || []).find(
              (x) => x.label === a || x.id === a
            );
            const icon = meta ? `<i class="fa-solid ${meta.icon}"></i> ` : '';
            return `<span>${icon}${a}</span>`;
          })
          .join('')
      : '<span style="color:var(--muted);font-weight:650;">No amenities listed</span>';

    const rulesList = Object.entries(rules)
      .filter(([, v]) => v)
      .map(([k, v]) => `<li><strong>${k.replace(/_/g, ' ')}:</strong> ${v}</li>`)
      .join('');

    content.innerHTML = `
      <div class="gka-detail-hero">${hero}</div>
      <h2 class="gka-title" style="font-size:28px;">${property.title || 'Property'}</h2>
      <p class="gka-sub">${property.description || ''}</p>
      <div class="gka-detail-facts" style="margin-top:16px;">
        <div><strong>Rent</strong><span>${
          window.GKAPriceDisplay
            ? GKAPriceDisplay.formatPriceHtml(property)
            : `₹${parseFloat(property.monthly_rent || 0).toLocaleString()}/mo`
        }</span></div>
        <div><strong>Deposit</strong><span>₹${parseFloat(property.security_deposit || 0).toLocaleString()}</span></div>
        <div><strong>Available from</strong><span>${formatDate(property.available_from)}</span></div>
        <div><strong>Type</strong><span>${property.property_type || '—'}</span></div>
        <div><strong>Near college</strong><span>${property.nearest_college || '—'}</span></div>
        <div><strong>City</strong><span>${property.city || '—'}${property.locality ? ` · ${property.locality}` : ''}</span></div>
        ${
          property.latitude && property.longitude
            ? `<div style="grid-column:1/-1;"><strong>Map</strong><a href="https://www.google.com/maps?q=${property.latitude},${property.longitude}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:800;">Open location</a></div>`
            : ''
        }
        <div><strong>Beds</strong><span>${property.available_beds || 1} / ${property.capacity || 1}</span></div>
        <div><strong>Gender</strong><span>${property.gender_preference || 'any'}</span></div>
        <div><strong>Tier</strong><span>${isPremium ? 'Premium' : 'Standard'}</span></div>
        <div><strong>Listed by</strong><span>${
          property.broker_id
            ? 'Broker'
            : property.is_platform_listing
              ? 'Platform'
              : 'Owner'
        }</span></div>
      </div>
      <div class="gka-detail-section">
        <h4>Amenities & facilities</h4>
        <div class="gka-detail-amenities">${amenityHtml}</div>
      </div>
      ${
        rulesList
          ? `<div class="gka-detail-section"><h4>House rules</h4><ul style="padding-left:18px;color:var(--muted);font-weight:650;font-size:13px;line-height:1.6;">${rulesList}</ul></div>`
          : ''
      }
      ${
        property.id && window.GKAListingQR
          ? `<div class="gka-detail-section">${GKAListingQR.renderBlock(property.id)}</div>`
          : ''
      }
      <div class="gka-detail-section" style="display:grid;gap:10px;">
        <button type="button" class="gka-btn gka-btn-primary" id="gkaDetailUnlock"><i class="fa-solid fa-unlock"></i> Unlock contact</button>
        <button type="button" class="gka-btn gka-btn-ghost" id="gkaDetailLock"><i class="fa-solid fa-handshake"></i> Request lock</button>
        <button type="button" class="gka-btn gka-btn-ghost" id="gkaDetailChat"><i class="fa-solid fa-comments"></i> Message seller</button>
      </div>
    `;

    if (window.GKAListingMedia) {
      GKAListingMedia.bindThumbClicks(content);
    }

    const unlockBtn = content.querySelector('#gkaDetailUnlock');
    const lockBtn = content.querySelector('#gkaDetailLock');
    const chatBtn = content.querySelector('#gkaDetailChat');
    if (unlockBtn && onUnlock) unlockBtn.onclick = () => onUnlock(property);
    if (lockBtn && onLock) lockBtn.onclick = () => onLock(property);
    if (chatBtn && onChat) chatBtn.onclick = () => onChat(property);

    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    if (window.gsap) {
      gsap.fromTo(
        panel,
        { x: 60, opacity: 0.6 },
        { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }
      );
    }
  }

  async function open(propertyId, apiBase, token, handlers = {}) {
    const res = await fetch(`${apiBase}/properties/${propertyId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load property');
    render(data, handlers);
    return data;
  }

  return { open, render, close };
})();
