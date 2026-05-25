import pool from '../src/db.js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: node scripts/check-user.js <email>');
  process.exit(1);
}

const result = await pool.query(
  `SELECT email, role, (password_hash IS NOT NULL) AS has_password,
          auth_provider, onboarding_step, email_verified, phone_verified
   FROM profiles WHERE email = $1`,
  [email]
);

console.log(result.rows[0] || { found: false });
process.exit(0);
