import pool, { isDatabaseConfigured } from '../db.js';

/** All payment purposes used by the API (must exist on payment_purpose enum). */
export const PAYMENT_PURPOSE_VALUES = [
  'contact_unlock',
  'booking_fee',
  'rent',
  'premium_listing',
  'owner_subscription',
  'broker_plan',
  'lead_fee',
  'listing_fee',
  'visibility_boost',
  'lock_request_fee',
  'roommate_unlock',
  'stay_binding',
  'other'
];

let paymentEnumReady = false;

export async function ensurePaymentPurposeEnum() {
  if (!isDatabaseConfigured() || paymentEnumReady) return;
  try {
    const typeCheck = await pool.query(
      `SELECT 1 FROM pg_type WHERE typname = 'payment_purpose'`
    );
    if (typeCheck.rows.length === 0) {
      paymentEnumReady = true;
      return;
    }

    for (const value of PAYMENT_PURPOSE_VALUES) {
      await pool.query(
        `
        DO $$ BEGIN
          ALTER TYPE payment_purpose ADD VALUE '${value}';
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
        `
      );
    }

    paymentEnumReady = true;
    console.log('[GKA] payment_purpose enum values verified.');
  } catch (err) {
    console.error('[GKA] payment_purpose enum patch failed:', err.message);
  }
}
