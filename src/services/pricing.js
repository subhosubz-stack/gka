import pool from '../db.js';

const PROPERTY_TYPE_BASE = {
  pg: 49,
  room: 49,
  flat: 199,
  hostel: 49,
  studio: 99,
  independent_house: 299,
  '1BHK': 199,
  '2BHK': 299,
  '3BHK': 399,
  'Single Room': 49,
  'Shared Pg': 49,
  '1 BHK Flat': 199,
  '2 BHK Flat': 299
};

function normalizePropertyType(type) {
  if (!type) return 'pg';
  const t = String(type).trim();
  if (PROPERTY_TYPE_BASE[t] != null) return t;
  const lower = t.toLowerCase();
  if (lower.includes('3')) return '3BHK';
  if (lower.includes('2')) return '2BHK';
  if (lower.includes('1')) return '1BHK';
  if (lower.includes('pg') || lower.includes('shared')) return 'pg';
  return 'room';
}

export async function countOwnerListings(ownerId, listingType) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM properties
     WHERE owner_id = $1 AND listing_type = $2 AND status != 'archived'`,
    [ownerId, listingType]
  );
  return r.rows[0]?.c || 0;
}

export async function calculateListingFee({ role, listingType, propertyType, ownerId, brokerType, visibilityBoost = false }) {
  const section = listingType === 'premium' ? 'premium' : 'standard';
  const pType = normalizePropertyType(propertyType);
  const typeBase = PROPERTY_TYPE_BASE[pType] || 99;

  let baseFee = typeBase;
  let listingOrdinal = 1;

  if (role === 'owner') {
    listingOrdinal = (await countOwnerListings(ownerId, listingType)) + 1;
    if (section === 'standard') {
      baseFee = listingOrdinal === 1 ? 0 : 49;
    } else {
      baseFee = 99;
    }
  } else if (role === 'broker') {
    const bType = brokerType || 'brokerage_50';
    listingOrdinal = (await countOwnerListings(ownerId, listingType)) + 1;
    if (bType === 'lease_model' || bType === 'lease') {
      baseFee = 99;
    } else {
      baseFee = listingOrdinal === 1 ? 0 : 149;
    }
  }

  const visibilityAddOn = visibilityBoost ? 99 : 0;
  const total = baseFee + visibilityAddOn;

  return {
    baseFee,
    visibilityAddOn,
    total: Math.max(0, total),
    listingOrdinal,
    section,
    propertyType: pType,
    freeListing: total === 0
  };
}

export async function getContactUnlockPrice(listingType) {
  const { getSetting } = await import('./platformConfig.js');
  const isPremium = listingType === 'premium';
  const key = isPremium ? 'contact_unlock_premium_inr' : 'contact_unlock_standard_inr';
  return parseFloat(await getSetting(key, isPremium ? '49' : '29'));
}

export function validateBrokerListingSection(brokerType, listingType) {
  const b = brokerType || 'brokerage_50';
  const lt = listingType === 'premium' ? 'premium' : 'standard';
  if ((b === 'lease_model' || b === 'lease') && lt !== 'premium') {
    return { ok: false, error: 'Lease model brokers may only list in the Premium section (PRD rule).' };
  }
  if ((b === 'brokerage_50' || b === 'broker_50') && lt === 'premium') {
    return { ok: false, error: '50% brokerage brokers may only list in the Standard section (PRD rule).' };
  }
  return { ok: true };
}
