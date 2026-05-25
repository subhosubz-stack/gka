import crypto from 'crypto';
import pool from '../db.js';

const OTP_TTL_MIN = parseInt(process.env.VERIFICATION_OTP_TTL_MIN || '15', 10);
const MAX_ATTEMPTS = 5;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Only true when explicitly enabled in .env — never auto-on in development. */
export function isDevVerificationMode() {
  return process.env.VERIFICATION_DEV_MODE === 'true';
}

async function ensureVerificationSchema() {
  await pool.query(`
    ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      channel text NOT NULL,
      target text NOT NULL,
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts int DEFAULT 0,
      created_at timestamptz DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_verification_user_channel
    ON verification_codes(user_id, channel, created_at DESC)
  `);
}

export async function saveVerificationCode({ userId, channel, target, code }) {
  await ensureVerificationSchema();
  await pool.query(
    `DELETE FROM verification_codes WHERE user_id = $1 AND channel = $2`,
    [userId, channel]
  );
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
  await pool.query(
    `INSERT INTO verification_codes (user_id, channel, target, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, channel, target, hashCode(code), expires]
  );
  return { code, expiresAt: expires, ttlMin: OTP_TTL_MIN };
}

export async function verifyCode({ userId, channel, code }) {
  await ensureVerificationSchema();
  const r = await pool.query(
    `SELECT * FROM verification_codes
     WHERE user_id = $1 AND channel = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, channel]
  );
  if (r.rows.length === 0) {
    return { ok: false, error: 'No verification code found. Request a new one.' };
  }
  const row = r.rows[0];
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, error: 'Code expired. Request a new one.' };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'Too many attempts. Request a new code.' };
  }
  const match = row.code_hash === hashCode(code);
  if (!match) {
    await pool.query(
      `UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1`,
      [row.id]
    );
    return { ok: false, error: 'Invalid code.' };
  }
  await pool.query(`DELETE FROM verification_codes WHERE id = $1`, [row.id]);
  return { ok: true, target: row.target };
}

export async function sendEmailOtp({ email, code, name }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@gharkaadda.com';
  const subject = 'GharKaAdda — Email verification code';
  const text = `Hi ${name || 'there'},\n\nYour GharKaAdda email verification code is: ${code}\n\nValid for ${OTP_TTL_MIN} minutes.\n\n— GharKaAdda`;

  if (!process.env.SMTP_HOST) {
    return { sent: false, dev: true };
  }

  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    await transport.sendMail({ from, to: email, subject, text });
    return { sent: true };
  } catch (e) {
    console.error('[GKA] SMTP error:', e.message);
    return { sent: false, error: e.message };
  }
}

function normalizeE164(phone) {
  const raw = String(phone || '').trim().replace(/[\s\-()]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  if (/^91\d{10}$/.test(raw)) return `+${raw}`;
  if (/^\d{10}$/.test(raw)) return `+91${raw}`;
  return `+${raw}`;
}

function friendlySmsError(raw) {
  if (!raw) return 'Could not send SMS. Please try again.';
  let parsed = null;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    /* plain text */
  }

  const code = parsed?.code;
  const msg = parsed?.message || String(raw);

  if (code === 21659 || /not a twilio phone number/i.test(msg)) {
    return (
      'SMS sender number is not valid in Twilio. In .env set TWILIO_PHONE_FROM to the exact ' +
      'phone number shown under Twilio Console → Phone Numbers (not your personal mobile).'
    );
  }
  if (code === 21608 || /unverified/i.test(msg)) {
    return 'Twilio trial account: verify this mobile number in Twilio Console first, then try again.';
  }
  if (code === 21408 || /permission.*region/i.test(msg)) {
    return 'SMS to India is not enabled on this Twilio number. Enable geo permissions or use an India-capable sender.';
  }
  if (code === 21211 || /invalid.*to/i.test(msg)) {
    return 'Invalid mobile number format. Use a 10-digit Indian number.';
  }

  return msg.length > 160 ? 'Could not send SMS. Check Twilio settings and try again.' : msg;
}

export async function sendSmsOtp({ phone, code }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = normalizeE164(process.env.TWILIO_PHONE_FROM);
  const to = normalizeE164(phone);

  if (!sid || !token || !from) {
    return { sent: false, dev: true };
  }

  if (!to || to.length < 11) {
    return { sent: false, error: 'Invalid mobile number format.' };
  }

  try {
    const body = new URLSearchParams({
      To: to,
      From: from,
      Body: `GharKaAdda verification code: ${code}. Valid ${OTP_TTL_MIN} min.`
    });
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[GKA] Twilio error:', errText);
      return { sent: false, error: friendlySmsError(errText) };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: friendlySmsError(e.message) };
  }
}

export async function getVerificationStatus(userId) {
  await ensureVerificationSchema();
  const r = await pool.query(
    `SELECT email, phone, email_verified, phone_verified, auth_provider FROM profiles WHERE id = $1`,
    [userId]
  );
  const u = r.rows[0];
  if (!u) return null;
  const needsEmail = !u.email_verified;
  return {
    email: u.email,
    phone: u.phone,
    email_verified: !!u.email_verified,
    phone_verified: true,
    auth_provider: u.auth_provider,
    needs_email: needsEmail,
    needs_phone: false,
    needs_verification: needsEmail
  };
}

export async function markEmailVerified(userId) {
  await ensureVerificationSchema();
  await pool.query(
    `UPDATE profiles SET email_verified = true, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function markPhoneVerified(userId, phone) {
  await ensureVerificationSchema();
  await pool.query(
    `UPDATE profiles SET phone_verified = true, phone = COALESCE($2, phone), updated_at = NOW() WHERE id = $1`,
    [userId, phone || null]
  );
}

// --- Pre-signup verification (email + phone before account creation) ---

const PRE_SIGNUP_TTL_MIN = parseInt(process.env.PRE_SIGNUP_SESSION_TTL_MIN || '45', 10);

async function ensurePreSignupSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pre_signup_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      phone text NOT NULL,
      email_verified boolean DEFAULT false,
      phone_verified boolean DEFAULT false,
      expires_at timestamptz NOT NULL,
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pre_signup_email ON pre_signup_sessions(email)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pre_signup_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL REFERENCES pre_signup_sessions(id) ON DELETE CASCADE,
      channel text NOT NULL,
      target text NOT NULL,
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts int DEFAULT 0,
      created_at timestamptz DEFAULT NOW()
    )
  `);
}

async function savePreSignupCode({ sessionId, channel, target, code }) {
  await ensurePreSignupSchema();
  await pool.query(
    `DELETE FROM pre_signup_codes WHERE session_id = $1 AND channel = $2`,
    [sessionId, channel]
  );
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
  await pool.query(
    `INSERT INTO pre_signup_codes (session_id, channel, target, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, channel, target, hashCode(code), expires]
  );
  return code;
}

async function verifyPreSignupCode({ sessionId, channel, code }) {
  await ensurePreSignupSchema();
  const r = await pool.query(
    `SELECT * FROM pre_signup_codes
     WHERE session_id = $1 AND channel = $2
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId, channel]
  );
  if (r.rows.length === 0) {
    return { ok: false, error: 'No verification code found. Request a new one.' };
  }
  const row = r.rows[0];
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, error: 'Code expired. Request a new one.' };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'Too many attempts. Request a new code.' };
  }
  const match = row.code_hash === hashCode(code);
  if (!match) {
    await pool.query(`UPDATE pre_signup_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return { ok: false, error: 'Invalid code.' };
  }
  await pool.query(`DELETE FROM pre_signup_codes WHERE id = $1`, [row.id]);
  return { ok: true, target: row.target };
}

export async function startPreSignupSession({ email, phone }) {
  await ensurePreSignupSchema();
  const emailLower = email.trim().toLowerCase();
  const phoneNorm = phone.trim();
  const expires = new Date(Date.now() + PRE_SIGNUP_TTL_MIN * 60 * 1000);

  await pool.query(`DELETE FROM pre_signup_sessions WHERE email = $1 OR expires_at < NOW()`, [
    emailLower
  ]);

  const result = await pool.query(
    `INSERT INTO pre_signup_sessions (email, phone, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [emailLower, phoneNorm, expires]
  );
  return result.rows[0];
}

export async function getPreSignupSession(sessionId) {
  await ensurePreSignupSchema();
  const r = await pool.query(`SELECT * FROM pre_signup_sessions WHERE id = $1`, [sessionId]);
  const row = r.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return { expired: true };
  return row;
}

export async function sendPreSignupEmailOtp(sessionId, name) {
  const session = await getPreSignupSession(sessionId);
  if (!session || session.expired) {
    return { ok: false, error: 'Verification session expired. Start again.' };
  }
  if (session.email_verified) {
    return { ok: true, already: true, message: 'Email already verified.' };
  }

  const code = generateOtp();
  await savePreSignupCode({ sessionId, channel: 'email', target: session.email, code });
  const sent = await sendEmailOtp({ email: session.email, code, name: name || 'there' });

  if (!sent.sent) {
    if (isDevVerificationMode()) {
      console.warn('[GKA] Email OTP (dev only):', session.email, code);
      return {
        ok: true,
        message: `Email could not be sent. Dev OTP logged on server for ${session.email}.`
      };
    }
    return {
      ok: false,
      error: sent.error || 'Could not send verification email. Check SMTP settings and try again.'
    };
  }

  return {
    ok: true,
    message: `Verification code sent to ${session.email}. Check your inbox (and spam).`
  };
}

export async function confirmPreSignupEmail(sessionId, code) {
  const session = await getPreSignupSession(sessionId);
  if (!session || session.expired) {
    return { ok: false, error: 'Verification session expired. Start again.' };
  }

  const result = await verifyPreSignupCode({ sessionId, channel: 'email', code: String(code).trim() });
  if (!result.ok) return result;

  await pool.query(
    `UPDATE pre_signup_sessions SET email_verified = true, updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  return { ok: true, email_verified: true };
}

export async function sendPreSignupPhoneOtp(sessionId) {
  const session = await getPreSignupSession(sessionId);
  if (!session || session.expired) {
    return { ok: false, error: 'Verification session expired. Start again.' };
  }
  if (!session.email_verified) {
    return { ok: false, error: 'Verify your email first.' };
  }
  if (session.phone_verified) {
    return { ok: true, already: true, message: 'Phone already verified.' };
  }

  const code = generateOtp();
  await savePreSignupCode({ sessionId, channel: 'phone', target: session.phone, code });
  const sent = await sendSmsOtp({ phone: session.phone, code });

  if (!sent.sent) {
    if (isDevVerificationMode()) {
      console.warn('[GKA] SMS OTP (dev only):', session.phone, code);
      return {
        ok: true,
        message: `SMS could not be sent. Dev OTP logged on server for ${session.phone}.`
      };
    }
    return {
      ok: false,
      error: sent.error || 'Could not send SMS. Check Twilio settings and try again.'
    };
  }

  const tail = session.phone.length > 4 ? session.phone.slice(-4) : '****';
  return {
    ok: true,
    message: `Verification code sent via SMS to number ending ${tail}.`
  };
}

export async function confirmPreSignupPhone(sessionId, code) {
  const session = await getPreSignupSession(sessionId);
  if (!session || session.expired) {
    return { ok: false, error: 'Verification session expired. Start again.' };
  }

  const result = await verifyPreSignupCode({ sessionId, channel: 'phone', code: String(code).trim() });
  if (!result.ok) return result;

  await pool.query(
    `UPDATE pre_signup_sessions SET phone_verified = true, updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  return { ok: true, phone_verified: true };
}

export async function assertPreSignupReady(sessionId, email) {
  const session = await getPreSignupSession(sessionId);
  if (!session || session.expired) {
    return { ok: false, error: 'Verification session expired. Verify your email again.' };
  }
  const emailLower = email.trim().toLowerCase();
  if (session.email !== emailLower) {
    return { ok: false, error: 'Email does not match verified session.' };
  }
  if (!session.email_verified) {
    return { ok: false, error: 'Verify your email before creating an account.' };
  }
  return { ok: true, session };
}

export async function consumePreSignupSession(sessionId) {
  await pool.query(`DELETE FROM pre_signup_sessions WHERE id = $1`, [sessionId]);
}
