/**
 * Seed Super Admin + Property Admin from .env into profiles.
 * Usage: npm run seed:admins
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import pool from '../src/db.js';
import { ensureCoreSchema } from '../src/services/ensureSchema.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const ADMINS = [
  {
    email: (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.SUPER_ADMIN_PASSWORD || '',
    tier: 'super',
    name: 'GKA Super Admin'
  },
  {
    email: (process.env.PROPERTY_ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.PROPERTY_ADMIN_PASSWORD || '',
    tier: 'property',
    name: 'GKA Property Admin'
  }
].filter((a) => a.email && a.password);

async function upsertAdmin({ email, password, tier, name }) {
  const hash = bcrypt.hashSync(password, 10);
  const meta = JSON.stringify({ admin_tier: tier, seeded: true });

  const existing = await pool.query('SELECT id, email, role FROM profiles WHERE email = $1', [email]);

  if (existing.rows.length) {
    await pool.query(
      `UPDATE profiles SET
         full_name = $2,
         password_hash = $3,
         role = 'admin',
         admin_tier = $4,
         onboarding_step = 'role_selected',
         verification_status = 'verified',
         email_verified = true,
         phone_verified = true,
         metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
         updated_at = NOW()
       WHERE email = $1`,
      [email, name, hash, tier, meta]
    );
    console.log(`✓ Updated admin: ${email} (${tier})`);
    return;
  }

  await pool.query(
    `INSERT INTO profiles (
       full_name, email, password_hash, role, admin_tier,
       onboarding_step, verification_status, email_verified, phone_verified, metadata
     ) VALUES ($1, $2, $3, 'admin', $4, 'role_selected', 'verified', true, true, $5::jsonb)`,
    [name, email, hash, tier, meta]
  );
  console.log(`✓ Created admin: ${email} (${tier})`);
}

async function main() {
  if (!ADMINS.length) {
    console.error('Set SUPER_ADMIN_* and PROPERTY_ADMIN_* in .env first.');
    process.exit(1);
  }

  await ensureCoreSchema();

  for (const admin of ADMINS) {
    await upsertAdmin(admin);
  }

  console.log('\nDone. Login at http://127.0.0.1:5000/login.html with each email + password.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
