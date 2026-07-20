// api/stripe-webhook.js
// Écoute les paiements Stripe réussis et ajoute automatiquement les tags :
//   - paye-session-4
//   - session-4-participant
//   - paye-stripe
// sur le contact GHL dont l'email correspond à celui du payeur.
// Résultat : plus besoin de Make pour les paiements Stripe, tout est automatique.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const GHL_API_KEY = process.env.GHL;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

export const config = {
  api: { bodyParser: false }
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  let event;
  try {
    const rawBody = await buffer(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;

    if (email) {
      try {
        await tagContactByEmail(email);
      } catch (err) {
        console.error('Tagging error:', err.message);
      }
    }
  }

  return res.status(200).json({ received: true });
}

async function tagContactByEmail(email) {
  // 1. Trouver le contact par email
  const searchRes = await fetch(
    `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
    {
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-07-28',
      }
    }
  );
  const searchData = await searchRes.json().catch(() => ({}));
  const foundContact = searchData?.contact;

  if (!foundContact?.id) {
    console.warn('Aucun contact GHL trouvé pour cet email:', email);
    return;
  }

  // IMPORTANT : /contacts/search/duplicate ne renvoie pas forcément la liste
  // complète des tags. On récupère la fiche complète et à jour du contact
  // avant de fusionner, pour ne jamais écraser les tags des sessions précédentes.
  let contact = foundContact;
  const fullContactRes = await fetch(
    `https://services.leadconnectorhq.com/contacts/${foundContact.id}`,
    {
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-07-28',
      }
    }
  );
  const fullContactData = await fullContactRes.json().catch(() => ({}));
  if (fullContactRes.ok && fullContactData?.contact) {
    contact = fullContactData.contact;
  }

  // 2. Ajouter les 3 tags
  const newTags = Array.from(new Set([
    ...(contact.tags || []),
    'paye-session-4',
    'session-4-participant',
    'paye-stripe'
  ]));

  await fetch(`https://services.leadconnectorhq.com/contacts/${contact.id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
    body: JSON.stringify({ tags: newTags })
  });
}
