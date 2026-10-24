// lib/ghl.js
// Petits appels GHL partagés (recherche par email, ajout de tags).

const GHL_API_KEY = process.env.GHL;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const BASE = 'https://services.leadconnectorhq.com';

export function ghlHeaders(json = false) {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-07-28',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

export const ghlLocationId = () => GHL_LOCATION_ID;
export const ghlBase = () => BASE;

// Retrouve un contact par EMAIL EXACT (pas de recherche approximative par nom).
// Renvoie null si le contact n'existe pas, et LÈVE une erreur si GHL répond mal
// (pour ne pas créer un doublon en croyant que le contact n'existe pas).
export async function findContactByEmail(email) {
  const res = await fetch(
    `${BASE}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
    { headers: ghlHeaders() }
  );
  const data = await res.json().catch(() => ({}));
  if (data?.contact?.id) return data.contact;
  // "Introuvable" peut revenir en 200 vide ou en 4xx selon GHL : on le traite comme
  // "pas de contact" (la création gère elle-même le cas du doublon). Seules les
  // vraies pannes (clé refusée, quota, erreur serveur) sont remontées.
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
    throw new Error(`recherche GHL impossible (${res.status})`);
  }
  return null;
}

// Ajoute des tags SANS jamais écraser les autres. Endpoint "ajouter des tags" de
// GHL d'abord ; repli : lecture de la fiche puis écriture de la liste fusionnée.
export async function addTags(contactId, tags) {
  const addRes = await fetch(`${BASE}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: ghlHeaders(true),
    body: JSON.stringify({ tags }),
  });
  if (addRes.ok) return;

  const fullRes = await fetch(`${BASE}/contacts/${contactId}`, { headers: ghlHeaders() });
  const fullData = await fullRes.json().catch(() => ({}));
  const existing = (fullRes.ok && fullData?.contact?.tags) || [];
  const putRes = await fetch(`${BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: ghlHeaders(true),
    body: JSON.stringify({ tags: Array.from(new Set([...existing, ...tags])) }),
  });
  if (!putRes.ok) {
    const detail = (await putRes.text().catch(() => '')).slice(0, 200);
    throw new Error(`GHL refuse l'ajout de tags au contact ${contactId} (POST ${addRes.status}, PUT ${putRes.status}) ${detail}`);
  }
}
