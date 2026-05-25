import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export function isGoogleAuthConfigured() {
  return !!process.env.GOOGLE_CLIENT_ID;
}

export async function verifyGoogleIdToken(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('Google Sign-In is not configured. Set GOOGLE_CLIENT_ID in .env');
  }
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  if (!payload?.email) {
    throw new Error('Google account did not return an email.');
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    email_verified: payload.email_verified === true,
    full_name: payload.name || payload.given_name || 'GharKaAdda User',
    picture: payload.picture || null
  };
}
