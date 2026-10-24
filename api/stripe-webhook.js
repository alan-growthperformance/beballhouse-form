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
import { TAG_PAYE, TAG_PAYE_STRIPE, TAG_TEAM_PREFIX } from '../lib/open-gym-7.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const GHL_API_KEY = process.env.GHL;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

// BBH x TeamBrussels3x3 (Open Gym 3x3) : événement séparé du 5x5, identifié
// par le MONTANT payé pour l'équipe (15€) et par client_reference_id pour le
// solo : le 5€ solo est aussi le prix du 5x5 (même lien Stripe), donc le
// montant seul ne suffit plus. Le formulaire 3x3 ajoute ?client_reference_id=3x3-solo
// au lien solo ; le formulaire 5x5 n'envoie rien et reste sur sa branche.
const AMOUNT_3X3_TEAM = 1500;  // 15€ en centimes
const REF_3X3_SOLO = '3x3-solo';
// Tags 3x3 (Open Gym 7) définis dans lib/open-gym-7.js : après un paiement, chaque
// joueur reçoit open-gym-7-paye + paye-stripe. Rien d'autre.

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

    if (amount === AMOUNT_3X3_TEAM || session.client_reference_id === REF_3X3_SOLO) {
      // Paiement BBH x TeamBrussels3x3 (Open Gym 3x3)
      try {
        await tag3x3Payment(session, amount === AMOUNT_3X3_TEAM);
      } catch (err) {
        // On répond 500 pour que Stripe REJOUE l'événement automatiquement
        // (retries pendant plusieurs jours) au lieu d'oublier le paiement en
        // silence. Le tagging est idempotent : rejouer ne duplique rien.
        console.error('Tagging 3x3 error:', err.message);
        return res.status(500).json({ error: 'tagging_failed', detail: err.message });
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
// Solo (5€) : on tague simplement le contact qui a payé, comme pour le 5x5.
// Équipe (15€) : un seul paiement (le responsable) doit valider TOUTE
// l'équipe. On passe l'identifiant d'équipe dans l'URL Stripe via
// ?client_reference_id=<teamId> (voir 3x3.html) ; ici on retrouve tous les
// membres tagués "equipe-<teamId>" à l'inscription (api/register-team.js) et on
// les tague tous comme payés.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// La recherche GHL par tag passe par un index qui peut avoir quelques
// secondes de retard : un paiement qui arrive 30 s après l'inscription peut
// ne pas encore y retrouver les coéquipiers. On réessaie donc brièvement.
const TEAM_SEARCH_DELAYS_MS = [0, 2000, 4000];

async function findTeamMembers(teamTag) {
  for (const delay of TEAM_SEARCH_DELAYS_MS) {
    if (delay) await sleep(delay);
    const members = await searchContactsByTag(teamTag);
    if (members.length > 0) return members;
  }
  return [];
}

async function tagPayerByEmail(session) {
  const email = session.customer_details?.email || session.customer_email;
  if (!email) return false;
  const contact = await findContactFullByEmail(email);
  if (!contact?.id) return false;
  await addTagsToContact(contact.id, contact.tags || []);
  return true;
}

async function tag3x3Payment(session, isTeam) {
  if (isTeam) {
    const teamId = session.client_reference_id;
    if (!teamId) {
      // Impossible de retrouver l'équipe : on tague au moins le payeur (il
      // reçoit ainsi sa confirmation) et on laisse une trace dans les logs
      // pour compléter les coéquipiers à la main. Rejouer ne servirait à rien.
      console.warn('Paiement équipe 3x3 sans client_reference_id : seul le payeur est tagué, coéquipiers à tagger manuellement dans GHL.');
      await tagPayerByEmail(session);
      return;
    }
    const members = await findTeamMembers(`${TAG_TEAM_PREFIX}${teamId}`);
    if (members.length === 0) {
      // Équipe introuvable (index GHL encore en retard, ou inscription
      // absente) : on tague le payeur pour qu'il ait sa confirmation, puis on
      // échoue volontairement pour que Stripe rejoue l'événement plus tard
      // et que tous les coéquipiers soient taggés à ce moment-là.
      console.warn(`Paiement équipe 3x3 : aucun contact trouvé pour l'équipe ${teamId}.`);
      await tagPayerByEmail(session).catch((err) => console.error('Repli payeur 3x3 impossible:', err.message));
      throw new Error(`aucun contact trouvé pour equipe-${teamId}`);
    }
    // On tague TOUS les membres, même si l'un d'eux échoue, puis on signale
    // les échecs (Stripe rejouera, les membres déjà taggés ne sont pas touchés).
    const failures = [];
    for (const member of members) {
      try {
        await addTagsToContact(member.id, member.tags || []);
      } catch (err) {
        failures.push(`${member.id}: ${err.message}`);
      }
    }
    console.log(`Paiement équipe 3x3 ${teamId} : ${members.length - failures.length}/${members.length} membres taggés.`);
    if (failures.length > 0) {
      throw new Error(`échec du tagging pour ${failures.length} membre(s) : ${failures.join(' | ')}`);
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

// Ajoute les 2 tags de paiement 3x3 (open-gym-7-paye, paye-stripe) sans jamais écraser les autres. On utilise
// d'abord l'endpoint "ajouter des tags" de GHL (pas de lecture-puis-écriture de
// toute la liste : pas de risque d'effacer des tags posés en parallèle, par
// exemple par le scénario Make de paiement). Repli sur l'ancien PUT fusionné.
async function addTagsToContact(contactId, existingTags) {
  const tagsToAdd = [TAG_PAYE, TAG_PAYE_STRIPE];
  const headers = {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  const addRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tags: tagsToAdd })
  });
  if (addRes.ok) return;

  const newTags = Array.from(new Set([...(existingTags || []), ...tagsToAdd]));
  const putRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ tags: newTags })
  });
  if (!putRes.ok) {
    const detail = (await putRes.text().catch(() => '')).slice(0, 200);
    throw new Error(`GHL refuse le tagging du contact ${contactId} (POST tags ${addRes.status}, PUT ${putRes.status}) ${detail}`);
  }
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
