// lib/open-gym-7.js
//
// Source UNIQUE pour l'Open Gym 7 (BBH x TeamBrussels3x3) : capacité, tags GHL
// et identifiants des champs personnalisés. Le formulaire d'équipe
// (api/register-team.js), le webhook Stripe (api/stripe-webhook.js) et le
// compteur de places (api/capacity-3x3.js) lisent tous ce fichier : pour changer
// un tag ou la capacité, c'est ici et nulle part ailleurs.
//
// STRUCTURE DES TAGS (volontairement minimale) :
//   open-gym-7-inscrit   -> posé à l'inscription, pour tout le monde (solo et équipe)
//   equipe-<id>          -> posé à l'inscription, uniquement pour les équipes (même id pour les 4 joueurs)
//   open-gym-7-paye      -> posé après paiement (Stripe, ou à la main pour un paiement cash / virement)
//   paye-stripe          -> posé avec open-gym-7-paye quand le paiement vient de Stripe
//   paye-manuel          -> à poser A LA MAIN avec open-gym-7-paye pour un paiement cash / virement
//
// Le compteur de places ne compte que les contacts open-gym-7-paye (donc des
// JOUEURS, pas des paiements : un paiement d'équipe = 4 places).

import { searchContactsByTag } from './sessions.js';

export const MAX_SPOTS = 16;

export const TAG_INSCRIT = 'open-gym-7-inscrit';
export const TAG_PAYE = 'open-gym-7-paye';
export const TAG_PAYE_STRIPE = 'paye-stripe';
export const TAG_TEAM_PREFIX = 'equipe-';

// Ancien tag de paiement du 3x3 (avant la simplification) : encore compté pour
// ne jamais survendre une place déjà payée avec l'ancien système.
const LEGACY_PAID_TAG = '3x3-paye';

export const EVENT_LABEL = 'BBH x TeamBrussels3x3';

// Champs personnalisés GHL (identiques à ceux du scénario Make du formulaire).
export const FIELD = {
  source: '0lIkqUcVZiuFQIsosYwm',
  lang: 'EbR4LlQ91zDRlfjsa4dQ',
  teamSize: 'HhyuJVsiSzscZvTwxgPh',
  freq: 'InYBW0ACpReGL626NhRr',
  level: 'NQS8qlsnoY56eyH0M2tC', // plus_haut_niveau
  type: 'Ns8d1Awrox8kgFnPHMBx',
  teamId: 'UuBiuagadTrFnIh5jeVN',
  manque: 'UvMTTqyAdzlLRIfTqQOB',
  price: 'hjJZ9NrTSacpVxrMwDKV',
  event: 'i2sNmi3zwF6I0aqijr5R',
  dispo: 'nd9MORTOKMCOyGQYXXoz',
  teamName: 'pIllhUNNTbkQT7MNEsX7',
};

// Nombre de JOUEURS qui ont payé (nouveau tag + ancien tag, sans doublon).
export async function countPaid() {
  const [current, legacy] = await Promise.all([
    searchContactsByTag(TAG_PAYE),
    searchContactsByTag(LEGACY_PAID_TAG),
  ]);
  const ids = new Set();
  for (const c of [...current, ...legacy]) ids.add(c.id);
  return ids.size;
}
