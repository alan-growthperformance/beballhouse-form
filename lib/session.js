// lib/sessions.js
//
// Source UNIQUE de vérité pour la session active : le Data Store Make
// "session_config" (le même que celui utilisé par les 2 scénarios Make
// du formulaire et du paiement Stripe). Ce fichier ne fait que LIRE ce
// Data Store via l'API REST de Make — il ne définit plus sa propre copie
// de la config, donc plus rien à synchroniser à la main entre deux endroits.
//
// POUR OUVRIR UNE NOUVELLE SESSION : va dans Make → Data Stores →
// "session_config" → modifie l'enregistrement "current" (session_number,
// session_label, max_spots, spots_taken). C'est tout, rien à toucher ici
// ni sur GitHub.
//
// Prérequis Vercel : la variable d'environnement MAKE_API_TOKEN doit être
// définie (un jeton d'API Make avec le scope "datastores:read", généré
// depuis Make → Profil → API).

const MAKE_ZONE = 'eu1';
const MAKE_DATASTORE_ID = '152575';
const MAKE_API_TOKEN = process.env.MAKE_API_TOKEN;
const RECORD_KEY = 'current';

const GHL_API_KEY = process.env.GHL;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // garde-fou : 10 x 100 = 1000 contacts scannés max

// Construit les 3 noms de tags GHL par convention à partir d'un numéro de
// session (ex: 5 -> paye-session-5, session-5-inscrit, session-5-participant).
// C'est la même convention que celle codée en dur dans les 2 scénarios Make.
function tagsForSession(n) {
  return {
    paidTag: `paye-session-${n}`,
    inscritTag: `session-${n}-inscrit`,
    participantTag: `session-${n}-participant`,
  };
}

// Lit l'enregistrement "current" du Data Store Make via l'API REST Make.
async function readSessionRecord() {
  if (!MAKE_API_TOKEN) {
    throw new Error('MAKE_API_TOKEN manquant dans les variables d\'environnement Vercel');
  }

  const url = `https://${MAKE_ZONE}.make.com/api/v2/data-stores/${MAKE_DATASTORE_ID}/data`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Token ${MAKE_API_TOKEN}` }
  });

  if (!res.ok) {
    throw new Error(`Lecture du Data Store Make impossible (${res.status})`);
  }

  const data = await res.json().catch(() => ({}));
  const record = (data.records || []).find(r => r.key === RECORD_KEY);
  if (!record) {
    throw new Error('Enregistrement "current" introuvable dans le Data Store Make');
  }
  return record.data; // { session_number, session_label, max_spots, spots_taken }
}

// Compte les contacts GHL possédant un tag donné (avec pagination).
export async function countByTag(tag) {
  let count = 0;
  let searchAfter = undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const body = {
      locationId: GHL_LOCATION_ID,
      pageLimit: PAGE_SIZE,
      filters: [{ field: 'tags', operator: 'contains', value: tag }],
      ...(searchAfter ? { searchAfter } : {})
    };

    const searchRes = await fetch('https://services.leadconnectorhq.com/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify(body)
    });

    if (!searchRes.ok) {
      throw new Error(`GHL search failed (${searchRes.status}) pour le tag ${tag}`);
    }

    const data = await searchRes.json().catch(() => ({}));
    const contacts = data?.contacts || [];
    count += contacts.length;
    pages++;

    if (contacts.length === 0 || contacts.length < PAGE_SIZE) break;
    const last = contacts[contacts.length - 1];
    if (!last?.searchAfter) break;
    searchAfter = last.searchAfter;
  }

  return count;
}

// Retourne la session "active" : lit le Data Store Make pour connaître le
// numéro/label/quota courant, puis compte les paiements déjà tagués dans
// GHL pour ce numéro (le comptage réel des tags reste la source de vérité
// pour "combien de places prises", plus fiable qu'un simple compteur en cas
// de paiement cash/virement tagué manuellement en dehors de Make).
export async function getActiveSession() {
  const record = await readSessionRecord();
  const n = record.session_number;
  const tags = tagsForSession(n);
  const count = await countByTag(tags.paidTag);

  return {
    id: n,
    label: record.session_label,
    maxSpots: record.max_spots,
    ...tags,
    count,
    open: count < record.max_spots,
  };
}

// À partir des tags déjà présents sur un contact GHL, retrouve le numéro de
// session pour laquelle il s'est inscrit le plus récemment (le plus grand
// numéro dont le tag "session-X-inscrit" est présent). Utilisé par le
// webhook Stripe pour savoir quel tag "paye-session-X" appliquer après un
// paiement, même si le Data Store a basculé sur la session suivante entre
// l'inscription et le paiement.
export function findSessionFromTags(tags = []) {
  const matches = (tags || [])
    .map(t => {
      const m = /^session-(\d+)-inscrit$/.exec(t);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter(n => n !== null);

  if (matches.length === 0) return null;
  const n = Math.max(...matches);
  return { id: n, ...tagsForSession(n) };
}
