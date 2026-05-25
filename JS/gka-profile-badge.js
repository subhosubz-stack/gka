/**
 * Shows role-specific public ID in shell / dashboards.
 */
window.GKAProfileBadge = (function () {
  const ROLE_LABEL = {
    tenant: 'Tenant ID',
    owner: 'Owner ID',
    broker: 'Broker ID',
    admin: 'Admin ID',
    property_admin: 'Property Admin ID'
  };

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('gka_user') || 'null');
    } catch {
      return null;
    }
  }

  function htmlFor(user) {
    if (!user?.id) return '';
    const label = ROLE_LABEL[user.role] || 'User ID';
    const id = user.display_id || user.id;
    return `<span class="gka-id-badge" title="Your account ID for support and member invites">
      <span class="gka-id-badge-label">${label}</span>
      <code class="gka-id-badge-code">${id}</code>
    </span>`;
  }

  function mount(slot, user) {
    if (!slot) return;
    const u = user || getUser();
    if (!u?.id) return;
    slot.innerHTML = htmlFor(u);
  }

  function injectStyles() {
    if (document.getElementById('gka-id-badge-styles')) return;
    const s = document.createElement('style');
    s.id = 'gka-id-badge-styles';
    s.textContent = `
      .gka-id-badge {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        padding: 8px 12px;
        border-radius: 12px;
        border: 1px solid rgba(122,78,45,.18);
        background: rgba(255,255,255,.75);
        max-width: 100%;
      }
      .gka-id-badge-label {
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
        color: #77695f;
      }
      .gka-id-badge-code {
        font-size: 12px;
        font-weight: 800;
        color: #7a4e2d;
        font-family: ui-monospace, Consolas, monospace;
      }
    `;
    document.head.appendChild(s);
  }

  injectStyles();
  return { mount, htmlFor, getUser };
})();
