import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { createRazorpayOrder, verifyPaymentSignature, isRazorpayConfigured, getPublicKeyId } from '../services/razorpay.js';
import { getContactUnlockPrice } from '../services/pricing.js';
import { getSetting } from '../services/platformConfig.js';
import { activateStayAfterPayment } from '../services/stayBinding.js';

const router = express.Router();

function paymentMeta(payment) {
  if (!payment.metadata) return {};
  if (typeof payment.metadata === 'object') return payment.metadata;
  try {
    return JSON.parse(payment.metadata);
  } catch {
    return {};
  }
}

export async function fulfillPaidPayment(payment) {
  const userId = payment.user_id;
  const meta = paymentMeta(payment);

  if (payment.purpose === 'contact_unlock' && payment.property_id) {
    const days = parseInt(await getSetting('contact_unlock_days', '30'), 10);
    await pool.query(
      `INSERT INTO contact_unlocks (user_id, property_id, payment_id, expires_at, is_active)
       VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval, true)
       ON CONFLICT (user_id, property_id) DO UPDATE SET
         payment_id = $3, expires_at = NOW() + ($4 || ' days')::interval, is_active = true`,
      [userId, payment.property_id, payment.id, String(days)]
    );
    await pool.query(
      `INSERT INTO conversations (tenant_id, owner_id, property_id, status, last_message)
       SELECT $1, p.owner_id, $2, 'preset_only', 'Inquiry started after contact unlock'
       FROM properties p WHERE p.id = $2
       ON CONFLICT (tenant_id, owner_id, property_id) DO NOTHING`,
      [userId, payment.property_id]
    );
  }

  if (payment.purpose === 'listing_fee' && payment.property_id) {
    await pool.query(
      `UPDATE properties SET status = 'approved', verified = true, updated_at = NOW() WHERE id = $1`,
      [payment.property_id]
    );
    await pool.query(
      `UPDATE profiles SET onboarding_step = 'onboarded_owner', updated_at = NOW()
       WHERE id = $1 AND role IN ('owner', 'broker')`,
      [userId]
    );
    if (meta.visibility_boost) {
      await pool.query(
        `INSERT INTO property_boosts (property_id, payment_id, boost_type, is_active, ends_at)
         VALUES ($1, $2, 'visibility', true, NOW() + INTERVAL '30 days')`,
        [payment.property_id, payment.id]
      );
    }
  }

  if (payment.purpose === 'premium_listing' && payment.property_id) {
    await pool.query(
      `UPDATE properties SET status = 'approved', listing_type = 'premium', is_premium = true, verified = true, updated_at = NOW() WHERE id = $1`,
      [payment.property_id]
    );
  }

  if (payment.purpose === 'visibility_boost' && payment.property_id) {
    await pool.query(
      `INSERT INTO property_boosts (property_id, payment_id, boost_type, is_active, ends_at)
       VALUES ($1, $2, 'visibility', true, NOW() + INTERVAL '30 days')`,
      [payment.property_id, payment.id]
    );
  }

  if (payment.purpose === 'lock_request_fee' && meta.lock_request_id) {
    await pool.query(
      `UPDATE property_lock_requests SET payment_id = $1, updated_at = NOW() WHERE id = $2`,
      [payment.id, meta.lock_request_id]
    );
  }

  if (payment.purpose === 'roommate_unlock' && meta.target_user_id) {
    await pool.query(
      `INSERT INTO roommate_contact_unlocks (user_id, target_user_id, payment_id, expires_at, is_active)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 days', true)
       ON CONFLICT (user_id, target_user_id) DO UPDATE SET expires_at = NOW() + INTERVAL '30 days', is_active = true`,
      [userId, meta.target_user_id, payment.id]
    );
  }

  if (payment.purpose === 'rent') {
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'rent_payment')`,
      [
        userId,
        'Rent payment received',
        `Rent payment of ₹${payment.amount} recorded. Awaiting landlord confirmation.`
      ]
    );
  }

  if (payment.purpose === 'stay_binding') {
    const bookingId = meta.booking_id;
    if (bookingId) {
      await activateStayAfterPayment(bookingId, payment.id);
    }
  }
}

// GET /api/payments/config
router.get('/config', async (req, res) => {
  return res.json({
    razorpayKeyId: getPublicKeyId(),
    razorpayConfigured: isRazorpayConfigured()
  });
});

// POST /api/payments/create-order
router.post('/create-order', protect, async (req, res) => {
  let { property_id } = req.body;
  const { purpose: rawPurpose, amount, target_user_id, lock_request_id, visibility_boost, booking_id } = req.body;
  const purpose = rawPurpose === 'rent_payment' ? 'rent' : rawPurpose;

  try {
    let finalAmount = parseFloat(amount);
    let meta = { purpose: purpose || 'other' };

    if (purpose === 'contact_unlock' && property_id) {
      const prop = await pool.query('SELECT listing_type FROM properties WHERE id = $1', [property_id]);
      if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found.' });
      finalAmount = await getContactUnlockPrice(prop.rows[0].listing_type);
    }

    if (purpose === 'roommate_unlock' && target_user_id) {
      finalAmount = parseFloat(await getSetting('roommate_unlock_inr', '29'));
      meta.target_user_id = target_user_id;
    }

    if (purpose === 'stay_binding') {
      const bookingId = req.body.booking_id;
      if (!bookingId) return res.status(400).json({ error: 'booking_id is required for stay binding payment.' });
      const bk = await pool.query(
        `SELECT tb.*, p.security_deposit
         FROM tenant_bookings tb
         JOIN properties p ON tb.property_id = p.id
         WHERE tb.id = $1 AND tb.tenant_id = $2 AND tb.binding_state = 'awaiting_payment'`,
        [bookingId, req.user.id]
      );
      if (bk.rows.length === 0) {
        return res.status(400).json({ error: 'No pending binding payment for this stay.' });
      }
      const row = bk.rows[0];
      finalAmount =
        parseFloat(row.monthly_rent || 0) + parseFloat(row.security_deposit || 0);
      meta.booking_id = bookingId;
      property_id = row.property_id;
    }

    if (isNaN(finalAmount) || finalAmount < 0) {
      return res.status(400).json({ error: 'Valid payment amount is required.' });
    }

    if (finalAmount === 0) {
      const insertQuery = `
        INSERT INTO payments (user_id, property_id, amount, purpose, status, provider, metadata)
        VALUES ($1, $2, 0, $3, 'paid', 'free', $4)
        RETURNING *
      `;
      const ins = await pool.query(insertQuery, [
        req.user.id,
        property_id || null,
        purpose || 'other',
        JSON.stringify(meta)
      ]);
      const payment = ins.rows[0];
      await fulfillPaidPayment(payment);
      return res.json({ success: true, free: true, payment });
    }

    if (!isRazorpayConfigured()) {
      return res.status(503).json({ error: 'Payment gateway not configured.' });
    }

    const insertQuery = `
      INSERT INTO payments (user_id, property_id, amount, purpose, status, provider, metadata)
      VALUES ($1, $2, $3, $4, 'created', 'razorpay', $5)
      RETURNING *
    `;
    const ins = await pool.query(insertQuery, [
      req.user.id,
      property_id || null,
      finalAmount,
      purpose || 'other',
      JSON.stringify({ ...meta, lock_request_id, visibility_boost: !!visibility_boost })
    ]);
    const payment = ins.rows[0];

    const rzOrder = await createRazorpayOrder({
      amountInr: finalAmount,
      receipt: `gka_${payment.id.replace(/-/g, '').slice(0, 20)}`,
      notes: { purpose, user_id: req.user.id, property_id: property_id || '' }
    });

    await pool.query(
      `UPDATE payments SET provider_order_id = $1, updated_at = NOW() WHERE id = $2`,
      [rzOrder.id, payment.id]
    );

    return res.json({
      success: true,
      razorpayKeyId: getPublicKeyId(),
      order: {
        id: rzOrder.id,
        amount: rzOrder.amount,
        currency: rzOrder.currency
      },
      paymentId: payment.id,
      amountInr: finalAmount,
      purpose
    });
  } catch (err) {
    console.error('Create payment order error:', err);
    return res.status(500).json({ error: err.message || 'Failed to initiate payment.' });
  }
});

// POST /api/payments/verify
router.post('/verify', protect, async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    provider_order_id,
    provider_payment_id,
    success = true
  } = req.body;

  const orderId = razorpay_order_id || provider_order_id;
  const payId = razorpay_payment_id || provider_payment_id;

  if (!orderId) {
    return res.status(400).json({ error: 'Razorpay order id is required.' });
  }

  try {
    const checkPay = await pool.query(
      'SELECT * FROM payments WHERE provider_order_id = $1 AND user_id = $2',
      [orderId, req.user.id]
    );
    if (checkPay.rows.length === 0) {
      return res.status(404).json({ error: 'Payment record not found.' });
    }

    const payment = checkPay.rows[0];

    if (success && razorpay_signature && payId) {
      const valid = verifyPaymentSignature({
        orderId,
        paymentId: payId,
        signature: razorpay_signature
      });
      if (!valid) {
        return res.status(400).json({ error: 'Invalid payment signature.' });
      }
    }

    const payStatus = success ? 'paid' : 'failed';
    const result = await pool.query(
      `UPDATE payments SET status = $1, provider_payment_id = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [payStatus, payId || payment.provider_payment_id, payment.id]
    );
    const updatedPay = result.rows[0];

    if (updatedPay.status === 'paid') {
      await fulfillPaidPayment(updatedPay);
    }

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'payment_receipt')`,
      [
        req.user.id,
        'Payment update',
        `Payment of ₹${updatedPay.amount} for ${updatedPay.purpose} is ${payStatus}.`
      ]
    );

    let unlockDetails = null;
    if (updatedPay.purpose === 'contact_unlock' && updatedPay.property_id && payStatus === 'paid') {
      const prop = await pool.query(
        `SELECT p.title, pf.full_name AS owner_name, pf.phone AS owner_phone, pf.email AS owner_email
         FROM properties p LEFT JOIN profiles pf ON p.owner_id = pf.id WHERE p.id = $1`,
        [updatedPay.property_id]
      );
      unlockDetails = prop.rows[0];
    }

    return res.json({ success: true, payment: updatedPay, unlockDetails });
  } catch (err) {
    console.error('Verify payment error:', err);
    return res.status(500).json({ error: err.message || 'Payment verification failed.' });
  }
});

router.get('/history', protect, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve payments.' });
  }
});

export default router;
