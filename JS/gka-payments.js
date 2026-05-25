/**
 * Razorpay checkout helper for GharKaAdda (test/live keys from server).
 */
window.GKAPayments = (function () {
  const API = () => window.GKA_CONFIG?.API_BASE_URL || '/api';
  let scriptPromise = null;
  let publicConfig = null;

  function getToken() {
    return localStorage.getItem('gka_token') || localStorage.getItem('gka_auth_token');
  }

  function loadRazorpayScript() {
    if (window.Razorpay) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load Razorpay checkout'));
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  async function loadConfig() {
    if (publicConfig) return publicConfig;
    const res = await fetch(`${API()}/config/public`);
    publicConfig = await res.json();
    return publicConfig;
  }

  async function createOrder(body) {
    const res = await fetch(`${API()}/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create payment order');
    return data;
  }

  async function verifyPayment(payload) {
    const res = await fetch(`${API()}/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment verification failed');
    return data;
  }

  /**
   * Full pay flow: create order → Razorpay modal → verify signature
   */
  async function pay({ purpose, property_id, amount, target_user_id, booking_id, user, onSuccess, onError }) {
    try {
      const orderData = await createOrder({ purpose, property_id, amount, target_user_id, booking_id });
      if (orderData.free) {
        if (onSuccess) onSuccess(orderData);
        return orderData;
      }

      await loadConfig();
      await loadRazorpayScript();

      const cfg = publicConfig || {};
      const key = orderData.razorpayKeyId || cfg.razorpayKeyId;
      if (!key) throw new Error('Razorpay key not configured on server');

      return new Promise((resolve, reject) => {
        const options = {
          key,
          amount: orderData.order.amount,
          currency: orderData.order.currency || 'INR',
          name: 'GharKaAdda',
          description: purpose.replace(/_/g, ' '),
          order_id: orderData.order.id,
          handler: async (response) => {
            try {
              const verified = await verifyPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                success: true
              });
              if (onSuccess) onSuccess(verified);
              resolve(verified);
            } catch (e) {
              if (onError) onError(e.message);
              reject(e);
            }
          },
          prefill: {
            name: user?.full_name || '',
            email: user?.email || ''
          },
          theme: { color: '#7a4e2d' },
          modal: {
            ondismiss: () => reject(new Error('Payment cancelled'))
          }
        };
        const rzp = new window.Razorpay(options);
        rzp.open();
      });
    } catch (e) {
      if (onError) onError(e.message);
      throw e;
    }
  }

  /**
   * Open Razorpay for an order already created by the API (e.g. listing publish).
   */
  async function payWithOrder(paymentPayload, { user, onSuccess, onError } = {}) {
    if (!paymentPayload?.order?.id) {
      throw new Error('Invalid payment order payload');
    }
    try {
      await loadConfig();
      await loadRazorpayScript();
      const key = paymentPayload.razorpayKeyId || publicConfig?.razorpayKeyId;
      if (!key) throw new Error('Razorpay key not configured');

      return new Promise((resolve, reject) => {
        const options = {
          key,
          amount: paymentPayload.order.amount,
          currency: paymentPayload.order.currency || 'INR',
          name: 'GharKaAdda',
          description: 'Listing payment',
          order_id: paymentPayload.order.id,
          handler: async (response) => {
            try {
              const verified = await verifyPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                success: true
              });
              if (onSuccess) onSuccess(verified);
              resolve(verified);
            } catch (e) {
              if (onError) onError(e.message);
              reject(e);
            }
          },
          prefill: { name: user?.full_name || '', email: user?.email || '' },
          theme: { color: '#7a4e2d' },
          modal: { ondismiss: () => reject(new Error('Payment cancelled')) }
        };
        new window.Razorpay(options).open();
      });
    } catch (e) {
      if (onError) onError(e.message);
      throw e;
    }
  }

  return { pay, payWithOrder, createOrder, verifyPayment, loadConfig };
})();
