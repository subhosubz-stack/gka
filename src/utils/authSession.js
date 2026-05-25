import jwt from 'jsonwebtoken';
import { getAdminTier } from '../services/adminTier.js';
import { formatDisplayId } from './displayId.js';

const JWT_SECRET = process.env.JWT_SECRET || 'gka_fallback_secret_32_chars_long';

export function issueToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export function setAuthCookie(res, token) {
  const isProd =
    process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  res.cookie('token', token, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax'
  });
}

export function serializeUser(user) {
  const emailVerified =
    user.email_verified === true ||
    user.auth_provider === 'google' ||
    user.role === 'admin';
  const phoneVerified = true;
  const needsEmail = !emailVerified;
  const needsPhone = false;

  return {
    id: user.id,
    display_id: user.display_id || formatDisplayId(user.role, user.id),
    email: user.email,
    full_name: user.full_name,
    phone: user.phone,
    role: user.role,
    onboarding_step: user.onboarding_step,
    avatar_url: user.avatar_url || null,
    auth_provider: user.auth_provider || 'local',
    email_verified: emailVerified,
    phone_verified: phoneVerified,
    needs_verification: needsEmail || needsPhone,
    needs_email: needsEmail,
    needs_phone: needsPhone,
    admin_tier: user.admin_tier || getAdminTier(user.email) || null
  };
}
