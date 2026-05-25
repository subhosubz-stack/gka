import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const base = process.env.TEST_API || 'http://127.0.0.1:5000/api';

const cases = [
  ['addagharka@gmail.com', process.env.SUPER_ADMIN_PASSWORD],
  ['adi.sxn.2006@proton.me', process.env.PROPERTY_ADMIN_PASSWORD]
];

for (const [email, password] of cases) {
  try {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const text = await res.text();
    console.log(email, res.status, text.slice(0, 120));
  } catch (e) {
    console.log(email, 'FETCH_FAILED', e.message);
  }
}
