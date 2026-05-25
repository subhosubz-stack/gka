/** Apply logo / favicon / site name from platform settings (no code deploy needed). */
(function () {
  const API = window.GKA_CONFIG?.API_BASE_URL || '/api';

  function applyBranding(b) {
    if (!b) return;
    if (b.favicon_url) {
      document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((el) => {
        el.href = b.favicon_url;
      });
    }
    if (b.site_name) document.title = document.title.replace(/^[^—]+—\s*/, '') || document.title;
    document.querySelectorAll('img[data-gka-logo], .brand img, .footer-brand img, .auth-brand img').forEach((img) => {
      if (b.logo_url) img.src = b.logo_url;
      if (b.site_name) img.alt = b.site_name;
    });
    document.querySelectorAll('[data-gka-site-name]').forEach((el) => {
      if (b.site_name) el.textContent = b.site_name;
    });
    document.querySelectorAll('[data-gka-tagline]').forEach((el) => {
      if (b.tagline) el.textContent = b.tagline;
    });
  }

  fetch(`${API}/config/public`)
    .then((r) => r.json())
    .then((data) => applyBranding(data.branding))
    .catch(() => {});
})();
