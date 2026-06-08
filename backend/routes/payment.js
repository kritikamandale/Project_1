const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_fallback',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_fallback',
});

// Helper to update plan in Firestore
async function upgradeUserPlan(uid, planId) {
  if (!uid) return;
  const db = admin.firestore();
  await db.collection('users').doc(uid).update({ plan: planId, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
}

// Create Order (Razorpay) or Checkout Session (Stripe)
router.post('/create-order', express.json(), async (req, res) => {
  try {
    const { gateway, planId, interval, uid, email } = req.body;
    
    // Map plan to amounts (in lowest denomination: paise/cents)
    let amount = 0;
    if (planId === 'pro') amount = interval === 'yearly' ? 149900 : 19900;
    if (planId === 'premium') amount = interval === 'yearly' ? 399900 : 49900;
    
    if (amount === 0) return res.status(400).json({ error: 'Invalid plan configuration' });

    if (gateway === 'stripe') {
      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `Arlo ${planId.toUpperCase()} (${interval})` },
            unit_amount: amount,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.FRONTEND_URL || 'https://Arlo.app'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || 'https://Arlo.app'}/payment-cancel`,
        client_reference_id: uid,
        customer_email: email,
        metadata: { planId, interval, uid },
      });
      return res.json({ id: session.id, url: session.url });
    } else {
      // Create Razorpay payment link
      const options = {
        amount,
        currency: 'INR',
        description: `Arlo ${planId.toUpperCase()} (${interval})`,
        customer: {
          name: uid,
          email: email
        },
        notify: { email: true, sms: false },
        reminder_enable: true,
        notes: { planId, interval, uid }
      };
      const link = await razorpay.paymentLink.create(options);
      // link.short_url is the URL to open
      return res.json(link);
    }
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook for both Stripe and Razorpay
// For Stripe we need raw body to verify signature, but Razorpay can use JSON
// Express handles this differently. Assuming express.json() is applied globally or locally.
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const stripeSig = req.headers['stripe-signature'];
  const rzpSig = req.headers['x-razorpay-signature'];
  
  // Handle Stripe Webhook
  if (stripeSig) {
    try {
      const event = stripe.webhooks.constructEvent(req.body, stripeSig, process.env.STRIPE_WEBHOOK_SECRET);
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        await upgradeUserPlan(session.metadata.uid, session.metadata.planId);
      }
      return res.json({ received: true });
    } catch (err) {
      return res.status(400).send(`Stripe Webhook Error: ${err.message}`);
    }
  }

  // Handle Razorpay Webhook
  if (rzpSig) {
    try {
      // If global express.json() is used, req.body is an object.
      // If express.raw() is used, req.body is a buffer.
      const bodyString = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
      const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_fallback')
                                .update(bodyString)
                                .digest('hex');
                                
      if (expectedSig === rzpSig) {
        const payload = JSON.parse(bodyString);
        if (payload.event === 'payment.captured') {
          const notes = payload.payload.payment.entity.notes;
          await upgradeUserPlan(notes.uid, notes.planId);
        }
        return res.json({ status: 'ok' });
      } else {
        return res.status(400).send('Invalid signature');
      }
    } catch (err) {
      return res.status(400).send(`Razorpay Webhook Error: ${err.message}`);
    }
  }

  res.status(400).send('Unknown webhook provider');
});

// Handle Cancellation logic if needed via backend
router.post('/cancel', express.json(), (req, res) => {
  // Can log the cancellation
  res.json({ status: 'cancelled' });
});

module.exports = router;

