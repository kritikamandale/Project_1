import { getCurrentUser } from '../auth/auth.js';

const BACKEND_URL = 'https://your-backend.railway.app'; // Should come from config in prod

export async function initiatePayment(planId, interval, gateway = 'razorpay') {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error('You must be logged in to upgrade');

    const token = await user.getIdToken();
    const res = await fetch(`${BACKEND_URL}/api/payment/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        gateway,
        planId,
        interval,
        uid: user.uid,
        email: user.email
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create order');
    }

    const data = await res.json();
    
    // For Stripe, it's a direct URL
    if (gateway === 'stripe' && data.url) {
      chrome.tabs.create({ url: data.url });
      return;
    }

    // For Razorpay, if we are returning a payment link
    if (gateway === 'razorpay' && data.short_url) {
      chrome.tabs.create({ url: data.short_url });
      return;
    }

    // If using standard order, we would need to load checkout.js. 
    // Assuming backend is adjusted to send a payment link for razorpay.
    if (data.id && gateway === 'razorpay') {
      // Fallback: If backend returned order ID, open a hosted checkout page (mocked)
      const checkoutUrl = `${BACKEND_URL}/checkout?order_id=${data.id}&key=${data.key || 'rzp_test'}`;
      chrome.tabs.create({ url: checkoutUrl });
    }

  } catch (err) {
    console.error('Payment initiation error:', err);
    throw err;
  }
}


