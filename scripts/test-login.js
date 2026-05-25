import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import pool from '../src/db.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const cases = [
  ['addagharka@gmail.com', process.env.SUPER_ADMIN_PASSWORD],
  ['adi.sxn.2006@proton.me', process.env.PROPERTY_ADMIN_PASSWORD]
];

for (const [email, pw] of cases) {
  const r = await pool.query(
    'SELECT email, role, admin_tier, password_hash FROM profiles WHERE email = $1',
    [email.trim().toLowerCase()]
  );
  const u = r.rows[0];
  if (!u) {
    console.log(email, 'NOT IN DB');
    continue;
  }
  const ok = u.password_hash && bcrypt.compareSync(pw, u.password_hash);
  console.log(JSON.stringify({ email: u.email, role: u.role, admin_tier: u.admin_tier, envPasswordMatch: ok }));
}

process.exit(0);
