import { ALLOWED_CITY_PATTERNS, ALLOWED_STATE_PATTERNS } from '../constants/platform.js';

export function normalizeLocationText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isServiceAreaAllowed({ city, state, locality, address_line } = {}) {
  const blob = [city, state, locality, address_line].map(normalizeLocationText).join(' ');

  if (!blob.trim()) return { ok: false, reason: 'Location is required.' };

  const stateOk = ALLOWED_STATE_PATTERNS.some((s) => blob.includes(s));
  const cityOk = ALLOWED_CITY_PATTERNS.some((c) => blob.includes(c));

  if (stateOk || cityOk) {
    return { ok: true };
  }

  return {
    ok: false,
    reason:
      'GharKaAdda is live in Punjab, Chandigarh & nearby tricity only. Other cities — coming soon.'
  };
}
