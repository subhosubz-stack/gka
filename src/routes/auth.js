import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { issueToken, setAuthCookie, serializeUser } from '../utils/authSession.js';
import { getAdminTier, getPropertyAdminEmail, getSuperAdminEmail } from '../services/adminTier.js';
import { verifyGoogleIdToken, isGoogleAuthConfigured } from '../services/googleAuth.js';
import { ensureCoreSchema } from '../services/ensureSchema.js';
import { ensureUserDisplayId } from '../services/profileDisplayId.js';
import { isUserBanned, parseMeta } from '../services/adminAnalytics.js';
import {
  saveVerificationCode,
  verifyCode,
  sendEmailOtp,
  sendSmsOtp,
  getVerificationStatus,
  markEmailVerified,
  markPhoneVerified,
  isDevVerificationMode,
  startPreSignupSession,
  getPreSignupSession,
  sendPreSignupEmailOtp,
  confirmPreSignupEmail,
  sendPreSignupPhoneOtp,
  confirmPreSignupPhone,
  assertPreSignupReady,
  consumePreSignupSession
} from '../services/verification.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'gka_fallback_secret_32_chars_long';

async function authResponse(res, user) {
  const withId = await ensureUserDisplayId(user);
  const token = issueToken(withId);
  setAuthCookie(res, token);
  return res.json({ token, user: serializeUser(withId) });
}

// GET /api/auth/config — public auth UI config
router.get('/config', (req, res) => {
  return res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    googleEnabled: isGoogleAuthConfigured(),
    verificationDevMode: isDevVerificationMode()
  });
});

// --- Pre-signup verification (before account exists) ---

router.post('/pre-signup/start', async (req, res) => {
  const { email, phone } = req.body;
  if (!email || !phone) {
    return res.status(400).json({ error: 'Email and phone are required.' });
  }

  try {
    const emailLower = email.trim().toLowerCase();
    const phoneNorm = String(phone).trim();
    const existing = await pool.query('SELECT id FROM profiles WHERE email = $1', [emailLower]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const session = await startPreSignupSession({ email: emailLower, phone: phoneNorm });
    return res.json({
      success: true,
      session_id: session.id,
      email_verified: !!session.email_verified,
      phone_verified: !!session.phone_verified
    });
  } catch (err) {
    console.error('Pre-signup start error:', err);
    return res.status(500).json({ error: err.message || 'Could not start verification.' });
  }
});

router.get('/pre-signup/status/:sessionId', async (req, res) => {
  try {
    const session = await getPreSignupSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Verification session not found.' });
    if (session.expired) return res.status(410).json({ error: 'Verification session expired.' });
    return res.json({
      success: true,
      email: session.email,
      phone: session.phone,
      email_verified: !!session.email_verified,
      phone_verified: !!session.phone_verified,
      can_signup: !!session.email_verified
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load verification status.' });
  }
});

router.post('/pre-signup/send-email', async (req, res) => {
  const { session_id, full_name } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id is required.' });
  try {
    const result = await sendPreSignupEmailOtp(session_id, full_name);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to send email code.' });
  }
});

router.post('/pre-signup/verify-email', async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) {
    return res.status(400).json({ error: 'session_id and code are required.' });
  }
  try {
    const result = await confirmPreSignupEmail(session_id, code);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ success: true, email_verified: true });
  } catch (err) {
    return res.status(500).json({ error: 'Email verification failed.' });
  }
});

router.post('/pre-signup/send-phone', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id is required.' });
  try {
    const result = await sendPreSignupPhoneOtp(session_id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to send SMS code.' });
  }
});

router.post('/pre-signup/verify-phone', async (req, res) => {
  const { session_id, code } = req.body;
  if (!session_id || !code) {
    return res.status(400).json({ error: 'session_id and code are required.' });
  }
  try {
    const result = await confirmPreSignupPhone(session_id, code);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ success: true, phone_verified: true });
  } catch (err) {
    return res.status(500).json({ error: 'Phone verification failed.' });
  }
});

// POST /signup
router.post('/signup', async (req, res) => {
  const { email, password, full_name, phone, metadata = {}, session_id } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

    if (!session_id) {
    return res.status(400).json({ error: 'Verify your email before signing up.' });
  }

  try {
    const emailLower = email.trim().toLowerCase();
    const phoneNorm = phone ? String(phone).trim() : null;

    const preCheck = await assertPreSignupReady(session_id, emailLower);
    if (!preCheck.ok) {
      return res.status(400).json({ error: preCheck.error });
    }
    
    // Check if user already exists
    const checkUser = await pool.query('SELECT * FROM profiles WHERE email = $1', [emailLower]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    let parsedMetadata = {};
    if (metadata) {
      if (typeof metadata === 'string') {
        try {
          parsedMetadata = JSON.parse(metadata);
        } catch (_) {}
      } else if (typeof metadata === 'object') {
        parsedMetadata = metadata;
      }
    }

    const finalFullName = full_name || parsedMetadata.full_name || 'GharKaAdda User';
    const finalPhone = phone || parsedMetadata.phone || null;
    let finalRole = parsedMetadata.role || 'tenant';
    if (finalRole === 'admin') finalRole = 'tenant';
    const finalOnboardingStep = parsedMetadata.onboarding_step || 'account_created';

    const insertQuery = `
      INSERT INTO profiles (
        full_name, email, password_hash, role, onboarding_step, phone, metadata,
        email_verified, phone_verified
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      finalFullName,
      emailLower,
      passwordHash,
      finalRole,
      finalOnboardingStep,
      finalPhone,
      JSON.stringify(parsedMetadata)
    ]);

    const user = result.rows[0];
    await consumePreSignupSession(session_id);

    const profile = user;
    profile.email_verified = true;
    profile.phone_verified = true;

    return authResponse(res, profile);

  } catch (err) {
    console.error('Registration Error:', err);
    if (err.code === 'DB_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return res.status(503).json({
        error: 'Cannot reach the database. Check DATABASE_URL in .env and that your PostgreSQL host is online.'
      });
    }
    return res.status(500).json({ error: err.message || 'Server encountered an unexpected database issue.' });
  }
});

async function issueAdminSession(res, emailLower, { password, displayName, tier }) {
  await ensureCoreSchema();
  let result = await pool.query('SELECT * FROM profiles WHERE email = $1', [emailLower]);
  let user = result.rows[0];
  const adminTier = tier || getAdminTier(emailLower) || 'super';

  if (!user) {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password || '', salt);
    result = await pool.query(
      `INSERT INTO profiles (full_name, email, password_hash, role, onboarding_step, verification_status, admin_tier, metadata)
       VALUES ($1, $2, $3, 'admin', 'role_selected', 'verified', $4, $5)
       RETURNING *`,
      [
        displayName || 'GKA Admin',
        emailLower,
        passwordHash,
        adminTier,
        JSON.stringify({ admin_tier: adminTier })
      ]
    );
    user = result.rows[0];
  } else {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password || '', salt);
    await pool.query(
      `UPDATE profiles SET role = 'admin', onboarding_step = 'role_selected', verification_status = 'verified',
         admin_tier = $2, password_hash = $3,
         email_verified = true, phone_verified = true,
         metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb, updated_at = now()
       WHERE id = $1`,
      [user.id, adminTier, passwordHash, JSON.stringify({ admin_tier: adminTier })]
    );
    user.role = 'admin';
    user.admin_tier = adminTier;
    user.password_hash = passwordHash;
  }

  user.email_verified = true;
  user.phone_verified = true;
  return authResponse(res, user);
}

// POST /api/auth/google — Google Sign-In (ID token)
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Google credential is required.' });
  }

  try {
    const googleUser = await verifyGoogleIdToken(credential);
    if (!googleUser.email_verified) {
      return res.status(400).json({ error: 'Google email is not verified.' });
    }

    let result = await pool.query(
      'SELECT * FROM profiles WHERE auth_user_id = $1 OR email = $2',
      [googleUser.sub, googleUser.email]
    );
    let user = result.rows[0];

    if (user) {
      await pool.query(
        `UPDATE profiles SET
           auth_provider = 'google',
           auth_user_id = $1,
           email_verified = true,
           full_name = COALESCE(NULLIF(full_name, ''), $2),
           avatar_url = COALESCE(avatar_url, $3),
           updated_at = NOW()
         WHERE id = $4`,
        [googleUser.sub, googleUser.full_name, googleUser.picture, user.id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO profiles (
           full_name, email, password_hash, role, onboarding_step, phone,
           auth_provider, auth_user_id, email_verified, avatar_url, metadata
         ) VALUES ($1, $2, NULL, 'tenant', 'account_created', NULL, 'google', $3, true, $4, '{}')
         RETURNING *`,
        [googleUser.full_name, googleUser.email, googleUser.sub, googleUser.picture]
      );
      user = result.rows[0];
    }

    const fresh = await pool.query('SELECT * FROM profiles WHERE id = $1', [user.id]);
    return authResponse(res, fresh.rows[0]);
  } catch (err) {
    console.error('Google auth error:', err);
    return res.status(401).json({ error: err.message || 'Google sign-in failed.' });
  }
});

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    await ensureCoreSchema();
    const emailLower = email.trim().toLowerCase();
    const superEmail = getSuperAdminEmail();
    const superPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
    const propertyEmail = getPropertyAdminEmail();
    const propertyPassword = process.env.PROPERTY_ADMIN_PASSWORD || '';

    const result = await pool.query('SELECT * FROM profiles WHERE email = $1', [emailLower]);
    const user = result.rows[0];

    if (user?.password_hash) {
      const isMatch = bcrypt.compareSync(password, user.password_hash);
      if (isMatch) {
        if (isUserBanned(user)) {
          return res.status(403).json({ error: 'This account has been suspended by admin.' });
        }
        if (user.role === 'admin') {
          const tier = user.admin_tier || getAdminTier(emailLower);
          if (tier !== 'super' && tier !== 'property') {
            return res.status(403).json({
              error: 'Admin account is not configured. Run: npm run seed:admins'
            });
          }
          user.admin_tier = tier;
        }
        return authResponse(res, user);
      }
    }

    if (!user) {
      if (superEmail && superPassword && emailLower === superEmail && password === superPassword) {
        return issueAdminSession(res, emailLower, {
          password: superPassword,
          displayName: 'GKA Super Admin',
          tier: 'super'
        });
      }
      if (propertyEmail && propertyPassword && emailLower === propertyEmail && password === propertyPassword) {
        return issueAdminSession(res, emailLower, {
          password: propertyPassword,
          displayName: 'GKA Property Admin',
          tier: 'property'
        });
      }
      return res.status(401).json({
        error: 'No account found with this email. Please sign up first.'
      });
    }

    if (!user.password_hash) {
      return res.status(401).json({
        error: 'This account uses Google Sign-In. Click “Continue with Google” above.'
      });
    }

    return res.status(401).json({
      error: 'Incorrect password. Use the password from .env (admin) or your sign-up password.'
    });

  } catch (err) {
    console.error('Login Error:', err);
    if (err.code === 'DB_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return res.status(503).json({
        error: 'Cannot reach the database. Check DATABASE_URL in .env and that your PostgreSQL host is online.'
      });
    }
    return res.status(500).json({ error: err.message || 'Server encountered an unexpected database issue.' });
  }
});

// GET /me
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM profiles WHERE id = $1', [decoded.userId || decoded.id]);
    let user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    user = await ensureUserDisplayId(user);
    const status = await getVerificationStatus(user.id);
    return res.json({
      user: serializeUser({ ...user, ...status })
    });
  } catch (err) {
    console.error('Auth Me Error:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

// POST /select-role
router.post('/select-role', protect, async (req, res) => {
  const { role, broker_type } = req.body;
  const validRoles = ['tenant', 'owner', 'broker'];

  if (role === 'admin') {
    return res.status(403).json({ error: 'Admin access is not available through role selection.' });
  }

  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid or missing role parameter.' });
  }

  try {
    // Merge existing metadata
    const userResult = await pool.query('SELECT metadata FROM profiles WHERE id = $1', [req.user.id]);
    const currentMetadata = userResult.rows[0]?.metadata || {};
    
    if (broker_type) {
      currentMetadata.broker_type = broker_type;
    }

    const updateQuery = `
      UPDATE profiles
      SET role = $1, onboarding_step = 'role_selected', metadata = $2, updated_at = now()
      WHERE id = $3
      RETURNING id, full_name, email, phone, role, onboarding_step
    `;

    await pool.query(updateQuery, [role, JSON.stringify(currentMetadata), req.user.id]);
    const full = await pool.query('SELECT * FROM profiles WHERE id = $1', [req.user.id]);
    const status = await getVerificationStatus(req.user.id);

    return res.json({
      success: true,
      user: serializeUser({ ...full.rows[0], ...status })
    });

  } catch (err) {
    console.error('Select Role Error:', err);
    return res.status(500).json({ error: 'Could not update user role in database.' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({ success: true, message: 'Successfully logged out.' });
});

// --- Verification ---

router.get('/verification/status', protect, async (req, res) => {
  try {
    const status = await getVerificationStatus(req.user.id);
    return res.json({ success: true, ...status });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load verification status.' });
  }
});

router.post('/verification/send-email', protect, async (req, res) => {
  try {
    const u = await pool.query('SELECT email, full_name, email_verified FROM profiles WHERE id = $1', [
      req.user.id
    ]);
    const profile = u.rows[0];
    if (!profile?.email) return res.status(400).json({ error: 'No email on account.' });
    if (profile.email_verified) {
      return res.json({ success: true, message: 'Email already verified.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await saveVerificationCode({
      userId: req.user.id,
      channel: 'email',
      target: profile.email,
      code
    });
    const sent = await sendEmailOtp({ email: profile.email, code, name: profile.full_name });
    if (!sent.sent && !isDevVerificationMode()) {
      return res.status(500).json({ error: sent.error || 'Could not send verification email.' });
    }
    if (!sent.sent && isDevVerificationMode()) {
      console.warn('[GKA] Email OTP (dev):', profile.email, code);
    }
    return res.json({
      success: true,
      message: `Verification code sent to ${profile.email}. Check your inbox.`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to send email code.' });
  }
});

router.post('/verification/verify-email', protect, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Verification code is required.' });

  try {
    const result = await verifyCode({ userId: req.user.id, channel: 'email', code: String(code).trim() });
    if (!result.ok) return res.status(400).json({ error: result.error });

    await markEmailVerified(req.user.id);
    const fresh = await pool.query('SELECT * FROM profiles WHERE id = $1', [req.user.id]);
    return res.json({ success: true, user: serializeUser(fresh.rows[0]) });
  } catch (err) {
    return res.status(500).json({ error: 'Email verification failed.' });
  }
});

router.post('/verification/send-phone', protect, async (req, res) => {
  const { phone } = req.body;
  const target = (phone || req.body.phone_number || '').trim();
  if (!target || target.length < 10) {
    return res.status(400).json({ error: 'Valid phone number is required.' });
  }

  try {
    await pool.query('UPDATE profiles SET phone = $1, updated_at = NOW() WHERE id = $2', [
      target,
      req.user.id
    ]);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await saveVerificationCode({
      userId: req.user.id,
      channel: 'phone',
      target,
      code
    });
    const sent = await sendSmsOtp({ phone: target, code });
    if (!sent.sent && !isDevVerificationMode()) {
      return res.status(500).json({ error: sent.error || 'Could not send SMS.' });
    }
    if (!sent.sent && isDevVerificationMode()) {
      console.warn('[GKA] SMS OTP (dev):', target, code);
    }
    return res.json({ success: true, message: 'Verification code sent via SMS.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to send SMS code.' });
  }
});

router.post('/verification/verify-phone', protect, async (req, res) => {
  const { code, phone } = req.body;
  if (!code) return res.status(400).json({ error: 'Verification code is required.' });

  try {
    const result = await verifyCode({ userId: req.user.id, channel: 'phone', code: String(code).trim() });
    if (!result.ok) return res.status(400).json({ error: result.error });

    await markPhoneVerified(req.user.id, phone || result.target);
    const fresh = await pool.query('SELECT * FROM profiles WHERE id = $1', [req.user.id]);
    return res.json({ success: true, user: serializeUser(fresh.rows[0]) });
  } catch (err) {
    return res.status(500).json({ error: 'Phone verification failed.' });
  }
});

export default router;
