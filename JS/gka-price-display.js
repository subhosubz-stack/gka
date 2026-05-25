/**
 * Offer / actual pricing display for listings.
 */
window.GKAPriceDisplay = (function () {
  function effectiveOffer(p) {
    const offer = parseFloat(p.offer_price ?? p.monthly_rent ?? 0);
    const actual = parseFloat(p.actual_price ?? 0);
    return { offer, actual, reason: (p.offer_reason || '').trim() };
  }

  function hasDeal(p) {
    const { offer, actual } = effectiveOffer(p);
    return actual > 0 && offer > 0 && actual > offer;
  }

  function formatPriceHtml(p, opts = {}) {
    const compact = !!opts.compact;
    const { offer, actual, reason } = effectiveOffer(p);
    const showDeal = hasDeal(p);

    if (showDeal) {
      return `<div class="gka-price-deal${compact ? ' is-compact' : ''}">
        <span class="gka-price-actual">₹${actual.toLocaleString('en-IN')}/mo</span>
        <span class="gka-price-offer">₹${offer.toLocaleString('en-IN')}/mo</span>
        ${reason ? `<span class="gka-price-reason">${escapeHtml(reason)}</span>` : ''}
      </div>`;
    }

    const single = offer || actual || 0;
    return `<span class="gka-price-single">₹${single.toLocaleString('en-IN')}/mo</span>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { formatPriceHtml, hasDeal, effectiveOffer };
})();
