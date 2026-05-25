import crypto from 'crypto';

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

export function isRazorpayConfigured() {
  return Boolean(KEY_ID && KEY_SECRET);
}

export function getPublicKeyId() {
  return KEY_ID || null;
}

export async function createRazorpayOrder({ amountInr, receipt, notes = {} }) {
  if (!isRazorpayConfigured()) {
    throw new Error('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env');
  }

  const amountPaise = Math.round(parseFloat(amountInr) * 100);
  if (amountPaise < 100) {
    throw new Error('Minimum payment amount is ₹1');
  }

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: receipt || `gka_${Date.now()}`,
      notes
    })
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Razorpay order error:', data);
    throw new Error(data?.error?.description || 'Failed to create Razorpay order');
  }
  return data;
}

export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!KEY_SECRET || !orderId || !paymentId || !signature) return false;
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', KEY_SECRET).update(body).digest('hex');
  return expected === signature;
}
