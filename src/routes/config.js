import express from 'express';
import { getAllSettings } from '../services/platformConfig.js';
import { getPublicKeyId, isRazorpayConfigured } from '../services/razorpay.js';
import { isGoogleAuthConfigured } from '../services/googleAuth.js';
import { isDevVerificationMode } from '../services/verification.js';
import { isServiceAreaAllowed } from '../utils/geoGuard.js';
import { NEARBY_COLLEGES, DEFAULT_PLATFORM_BRANDING } from '../constants/platform.js';

const router = express.Router();

router.get('/public', async (req, res) => {
  try {
    const settings = await getAllSettings();
    return res.json({
      razorpayKeyId: getPublicKeyId(),
      razorpayConfigured: isRazorpayConfigured(),
      googleClientId: process.env.GOOGLE_CLIENT_ID || null,
      googleEnabled: isGoogleAuthConfigured(),
      verificationDevMode: isDevVerificationMode(),
      colleges: NEARBY_COLLEGES,
      branding: {
        logo_url: settings.logo_url || DEFAULT_PLATFORM_BRANDING.logo_url,
        favicon_url: settings.favicon_url || DEFAULT_PLATFORM_BRANDING.favicon_url,
        site_name: settings.site_name || DEFAULT_PLATFORM_BRANDING.site_name,
        tagline: settings.tagline || 'Verified student housing platform',
        support_email: settings.support_email || DEFAULT_PLATFORM_BRANDING.support_email,
        support_whatsapp: settings.support_whatsapp || DEFAULT_PLATFORM_BRANDING.support_whatsapp
      },
      settings: {
        contactUnlockStandardInr: parseFloat(settings.contact_unlock_standard_inr),
        contactUnlockPremiumInr: parseFloat(settings.contact_unlock_premium_inr),
        contactUnlockDays: parseInt(settings.contact_unlock_days, 10),
        lockHideDays: parseInt(settings.lock_request_hide_days, 10),
        visibilityBoostInr: parseFloat(settings.visibility_boost_inr),
        roommateUnlockInr: parseFloat(settings.roommate_unlock_inr || '29')
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load config.' });
  }
});

router.get('/geo-check', (req, res) => {
  const result = isServiceAreaAllowed({
    city: req.query.city,
    state: req.query.state,
    locality: req.query.locality,
    address_line: req.query.address_line
  });
  return res.json(result);
});

export default router;
