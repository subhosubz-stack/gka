/**
 * Listing QR — scan opens public property card page.
 */
window.GKAListingQR = (function () {
  function cardUrl(propertyId) {
    const origin = window.location.origin;
    return `${origin}/listing.html?id=${encodeURIComponent(propertyId)}`;
  }

  function imageUrl(propertyId, size = 220) {
    const url = cardUrl(propertyId);
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=12&data=${encodeURIComponent(url)}`;
  }

  function renderBlock(propertyId, { title = 'Scan for full listing' } = {}) {
    const url = cardUrl(propertyId);
    const img = imageUrl(propertyId);
    return `
      <div class="gka-qr-block">
        <p class="gka-qr-label">${title}</p>
        <img src="${img}" width="200" height="200" alt="QR code for property listing" class="gka-qr-img">
        <p class="gka-qr-hint">Scan to view rent, amenities, and listing type (owner / broker / platform).</p>
        <a href="${url}" target="_blank" rel="noopener" class="gka-qr-link">Open listing card</a>
      </div>
    `;
  }

  return { cardUrl, imageUrl, renderBlock };
})();
