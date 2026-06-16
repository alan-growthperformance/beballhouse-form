import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const buf = await buffer(req);
    const hmac = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET);
    
    // Verify Stripe signature
    const parts = sig.split(',');
    const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
    const payload = `${timestamp}.${buf.toString()}`;
    hmac.update(payload);
    const expectedSig = 'v1=' + hmac.digest('hex');
    const receivedSig = parts.find(p => p.startsWith('v1='));
    
    if (expectedSig !== receivedSig) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    event = JSON.parse(buf.toString());
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    // Increment payment count in Vercel env (via a simple KV approach)
    const currentCount = parseInt(process.env.PAYMENT_COUNT || '0');
    const newCount = currentCount + 1;
    
    console.log(`✅ Payment confirmed! Total: ${newCount}/20`);
    
    // Store in a simple fetch to our own counter endpoint
    await fetch(`${process.env.BASE_URL}/api/payment-count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: newCount })
    }).catch(e => console.error('Count update failed:', e));
  }

  return res.status(200).json({ received: true });
}
