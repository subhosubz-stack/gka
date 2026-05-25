import pool, { isDatabaseConfigured } from '../db.js';
import { generateDisplayId } from '../utils/displayId.js';
import { ensurePaymentPurposeEnum } from './ensurePaymentEnums.js';

let schemaReady = false;

/** Lightweight patches so login/admin panels work without a full db:sync run. */
export async function ensureCoreSchema() {
  if (!isDatabaseConfigured() || schemaReady) return;
  try {
    await ensurePaymentPurposeEnum();

    await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_tier text`);
    await pool.query(`
      ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false
    `);
    await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_id text`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_display_id
      ON profiles (display_id) WHERE display_id IS NOT NULL
    `);

    await pool.query(`
      ALTER TABLE tenant_bookings
      ADD COLUMN IF NOT EXISTS binding_state text DEFAULT 'awaiting_owner',
      ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
      ADD COLUMN IF NOT EXISTS binding_payment_id uuid
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stay_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid REFERENCES tenant_bookings(id) ON DELETE CASCADE,
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        member_tenant_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        primary_tenant_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        is_primary boolean DEFAULT false,
        status text DEFAULT 'active',
        created_at timestamptz DEFAULT NOW(),
        UNIQUE(booking_id, member_tenant_id)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_stay_members_booking ON stay_members(booking_id)
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_property_favorites_user_property
      ON property_favorites (user_id, property_id)
    `);

    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS actual_price numeric`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS offer_price numeric`);
    await pool.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS offer_reason text`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        user_role text,
        user_name text,
        user_email text,
        subject text NOT NULL,
        body text NOT NULL,
        status text DEFAULT 'open',
        admin_reply text,
        replied_at timestamptz,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      )
    `);

    const missingIds = await pool.query(
      `SELECT id, role FROM profiles WHERE display_id IS NULL LIMIT 500`
    );
    for (const row of missingIds.rows) {
      const did = generateDisplayId(row.role || 'tenant');
      await pool.query('UPDATE profiles SET display_id = $1 WHERE id = $2', [did, row.id]);
    }

    await pool.query(`
      UPDATE tenant_bookings
      SET binding_state = 'linked'
      WHERE status::text = 'active'
        AND COALESCE(binding_state, '') <> 'linked'
    `);

    schemaReady = true;
    console.log('[GKA] Core schema ready (display_id, stay_members, binding_state).');
  } catch (err) {
    console.error('[GKA] Schema patch failed:', err.message);
  }
}
