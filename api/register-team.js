// api/register-team.js
//
// Inscription d'une ÉQUIPE à l'Open Gym 7 (BBH x TeamBrussels3x3).
//
// Pourquoi ce point d'entrée : avant, le formulaire envoyait 1 appel Make par
// joueur ; Make rangeait un coéquipier dans GHL après une recherche par NOM
// (approximative) et un échec de création y était avalé en silence : des
// coéquipiers disparaissaient sans aucune erreur visible. Ici, toute l'équipe
// est enregistrée en un seul appel, chaque joueur est retrouvé par son EMAIL
// EXACT, et si un joueur échoue le formulaire le sait (et ne propose pas le
// paiement), au lieu de le découvrir après coup dans GHL.
//
// L'opération est idempotente : renvoyer la même équipe met à jour les mêmes
// contacts (par email) et n'ajoute les tags qu'une fois.
//
// Tags posés : open-gym-7-inscrit + equipe-<teamId> (voir lib/open-gym-7.js).
// Le paiement (api/stripe-webhook.js) ajoute ensuite open-gym-7-paye + paye-stripe
// à tous les joueurs qui portent equipe-<teamId>.

import { findContactByEmail, addTags, ghlHeaders, ghlLocationId, ghlBase } from '../lib/ghl.js';
import {
  MAX_SPOTS, TAG_INSCRIT, TAG_TEAM_PREFIX, EVENT_LABEL, FIELD, countPaid,
} from '../lib/open-gym-7.js';

const TEAM_ID_RE = /^[a-z0-9][a-z0-9_-]{2,60}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

// Champs personnalisés : on n'envoie JAMAIS un champ vide (GHL peut refuser une
// valeur vide sur certains types de champs).
function customFields(pairs) {
  return pairs
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([id, value]) => ({ id, field_value: String(value).trim() }));
}

async function upsertPlayer({ player, isLead, teamId, teamName, teamSize, lang, profile }) {
  const fields = customFields([
    [FIELD.event, EVENT_LABEL],
    [FIELD.type, 'equipe'],
    [FIELD.teamName, teamName],
    [FIELD.teamSize, teamSize],
    [FIELD.teamId, teamId],
    [FIELD.level, player.level],
    [FIELD.lang, lang],
    // Questions clientèle : uniquement pour le responsable d'équipe.
    ...(isLead ? [
      [FIELD.freq, profile.freq],
      [FIELD.price, profile.price],
      [FIELD.manque, profile.manque],
      [FIELD.source, profile.source],
      [FIELD.dispo, profile.dispo],
    ] : []),
  ]);
  const postalCode = isLead ? clean(profile.postal) : '';

  const existing = await findContactByEmail(player.email);
  let contactId;

  if (existing) {
    // Contact déjà connu (ex. ancien joueur du 5x5) : on garde son nom et son
    // historique, on ajoute seulement les infos de cette inscription.
    contactId = existing.id;
    const putRes = await fetch(`${ghlBase()}/contacts/${contactId}`, {
      method: 'PUT',
      headers: ghlHeaders(true),
      body: JSON.stringify({ customFields: fields, ...(postalCode ? { postalCode } : {}) }),
    });
    if (!putRes.ok) {
      const detail = (await putRes.text().catch(() => '')).slice(0, 200);
      throw new Error(`mise à jour GHL refusée (${putRes.status}) ${detail}`);
    }
  } else {
    const [firstName, ...rest] = player.name.split(/\s+/);
    const createRes = await fetch(`${ghlBase()}/contacts/`, {
      method: 'POST',
      headers: ghlHeaders(true),
      body: JSON.stringify({
        locationId: ghlLocationId(),
        email: player.email,
        firstName,
        lastName: rest.join(' '),
        ...(postalCode ? { postalCode } : {}),
        customFields: fields,
      }),
    });
    const createData = await createRes.json().catch(() => ({}));
    if (createRes.ok && createData?.contact?.id) {
      contactId = createData.contact.id;
    } else if (createData?.meta?.contactId) {
      // Course : le contact vient d'être créé entre-temps (doublon) : on le réutilise.
      contactId = createData.meta.contactId;
    } else {
      throw new Error(`création GHL refusée (${createRes.status}) ${JSON.stringify(createData).slice(0, 200)}`);
    }
  }

  await addTags(contactId, [TAG_INSCRIT, `${TAG_TEAM_PREFIX}${teamId}`]);
  return contactId;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const teamId = clean(body.teamId);
  const teamName = clean(body.teamName);
  const lang = clean(body.lang);
  const profile = body.profile || {};
  const rawPlayers = Array.isArray(body.players) ? body.players : [];

  // ---- Validation (le formulaire valide déjà, on ne fait pas confiance au client) ----
  if (!TEAM_ID_RE.test(teamId)) return res.status(400).json({ error: 'invalid', field: 'teamId' });
  if (!teamName) return res.status(400).json({ error: 'invalid', field: 'teamName' });
  if (rawPlayers.length < 3 || rawPlayers.length > 4) return res.status(400).json({ error: 'invalid', field: 'players' });

  const players = rawPlayers.map((p) => ({
    name: clean(p?.name),
    email: clean(p?.email).toLowerCase(),
    level: clean(p?.level),
  }));
  for (const p of players) {
    if (!p.name || !EMAIL_RE.test(p.email)) return res.status(400).json({ error: 'invalid', field: 'player' });
  }
  if (new Set(players.map((p) => p.email)).size !== players.length) {
    return res.status(400).json({ error: 'duplicate_emails' });
  }

  // ---- Places restantes (comptées en joueurs payés) ----
  try {
    const paid = await countPaid();
    if (MAX_SPOTS - paid < players.length) {
      return res.status(409).json({ error: 'full', spotsLeft: Math.max(0, MAX_SPOTS - paid) });
    }
  } catch (err) {
    // Comme capacity-3x3.js : une panne GHL ne doit jamais bloquer une inscription.
    console.warn('register-team : comptage des places impossible, on continue :', err.message);
  }

  // ---- Enregistrement : les joueurs en parallèle (rapide, pas de coupure de la fonction),
  // chacun isolé : l'échec de l'un n'empêche pas les autres d'être enregistrés ----
  const results = await Promise.all(players.map(async (player, i) => {
    try {
      const contactId = await upsertPlayer({
        player, isLead: i === 0, teamId, teamName,
        teamSize: players.length, lang, profile,
      });
      return { email: player.email, ok: true, contactId };
    } catch (err) {
      console.error(`register-team ${teamId} : joueur ${i + 1} (${player.email}) en échec :`, err.message);
      return { email: player.email, ok: false, error: err.message };
    }
  }));

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    // 502 : le formulaire affiche une erreur et ne propose PAS le paiement.
    // Renvoyer le même formulaire est sans danger (idempotent).
    return res.status(502).json({ error: 'partial', saved: results.length - failed.length, failed: failed.map((f) => f.email) });
  }
  console.log(`register-team ${teamId} : ${results.length}/${players.length} joueurs enregistrés.`);
  return res.status(200).json({ success: true, teamId, saved: results.length });
}
