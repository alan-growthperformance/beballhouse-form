// api/stripe-webhook.js
// Écoute les paiements Stripe réussis et ajoute automatiquement les tags :
//   - paye-session-X
//   - session-X-participant
//   - paye-stripe
// sur le contact GHL dont l'email correspond à celui du payeur.
// Résultat : plus besoin de Make pour les paiements Stripe, tout est automatique.
//
// IMPORTANT : X n'est plus codé en dur. On regarde d'abord quels tags
// "session-X-inscrit" le contact a déjà (posés par api/submit.js au moment
// de son inscription) pour tagger la BONNE session, même si le formulaire a
// basculé sur la session suivante entre son inscription et son paiement.
// Si on ne trouve aucun tag d'inscription (ex: paiement offline ajouté à la
// main), on retombe sur la session active du moment.

import Stripe from 'stripe';
import { findSessionFromTags, getActiveSession, searchContactsByTag } from '../lib/sessions.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const GHL_API_KEY = process.env.GHL;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

// BBH x TeamBrussels3x3 (Open Gym 3x3) : événement séparé du 5x5, identifié
// par le MONTANT payé (6€ solo / 20€ équipe), pas par un lien Stripe précis
// -- l'ancien lien 5x5 à 5€ n'est jamais concerné par cette branche.
const AMOUNT_3X3_SOLO = 600;   // 6€ en centimes
const AMOUNT_3X3_TEAM = 2000;  // 20€ en centimes
const TAG_3X3_PAID = '3x3-paye';
const TAG_3X3_PARTICIPANT = '3x3-participant';

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
    const amount = session.amount_total;

    if (amount === AMOUNT_3X3_SOLO || amount === AMOUNT_3X3_TEAM) {
      // Paiement BBH x TeamBrussels3x3 (Open Gym 3x3)
      try {
        await tag3x3Payment(session, amount === AMOUNT_3X3_TEAM);
      } catch (err) {
        console.error('Tagging 3x3 error:', err.message);
      }
    } else if (email) {
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

  // 2. Déterminer la session à taguer : celle pour laquelle ce contact
  // s'est inscrit (tag "session-X-inscrit" déjà présent sur sa fiche).
  // Fallback sur la session active si aucun tag d'inscription trouvé.
  let session = findSessionFromTags(contact.tags || []);
  if (!session) {
    session = await getActiveSession();
  }

  // 3. Ajouter les 3 tags de paiement, fusionnés avec l'existant pour ne
  // jamais écraser les tags des sessions précédentes.
  const newTags = Array.from(new Set([
    ...(contact.tags || []),
    session.paidTag,
    session.participantTag,
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

// ─────────────────────────────────────────────────────────────────────────
// AJOUT POUR BBH x TeamBrussels3x3 (Open Gym 3x3)
// Solo (6€) : on tague simplement le contact qui a payé, comme pour le 5x5.
// Équipe (20€) : un seul paiement (le responsable) doit valider TOUTE
// l'équipe. On passe l'identifiant d'équipe dans l'URL Stripe via
// ?client_reference_id=<teamId> (voir 3x3.html) ; ici on retrouve tous les
// membres tagués "equipe-<teamId>" à l'inscription (api/submit-3x3.js) et on
// les tague tous comme payés.
async function tag3x3Payment(session, isTeam) {
  if (isTeam) {
    const teamId = session.client_reference_id;
    if (!teamId) {
      console.warn('Paiement équipe 3x3 sans client_reference_id : impossible de retrouver l\'équipe, à corriger manuellement dans GHL.');
      return;
    }
    const members = await searchContactsByTag(`equipe-${teamId}`);
    if (members.length === 0) {
      console.warn(`Paiement équipe 3x3 : aucun contact trouvé pour l'équipe ${teamId}.`);
      return;
    }
    for (const member of members) {
      await addTagsToContact(member.id, member.tags || []);
    }
  } else {
    const email = session.customer_details?.email || session.customer_email;
    if (!email) return;
    const contact = await findContactFullByEmail(email);
    if (!contact?.id) {
      console.warn('Paiement solo 3x3 : aucun contact GHL trouvé pour cet email:', email);
      return;
    }
    await addTagsToContact(contact.id, contact.tags || []);
  }
}

async function addTagsToContact(contactId, existingTags) {
  const newTags = Array.from(new Set([...(existingTags || []), TAG_3X3_PAID, TAG_3X3_PARTICIPANT, 'paye-stripe']));
  await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
    body: JSON.stringify({ tags: newTags })
  });
}

async function findContactFullByEmail(email) {
  const searchRes = await fetch(
    `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
    { headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' } }
  );
  const data = await searchRes.json().catch(() => ({}));
  const found = data?.contact || null;
  if (!found?.id) return null;

  const fullRes = await fetch(
    `https://services.leadconnectorhq.com/contacts/${found.id}`,
    { headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' } }
  );
  const fullData = await fullRes.json().catch(() => ({}));
  return (fullRes.ok && fullData?.contact) ? fullData.contact : found;
}
