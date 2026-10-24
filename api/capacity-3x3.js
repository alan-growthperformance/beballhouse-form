// api/capacity-3x3.js
// Places restantes pour l'Open Gym 7 (BBH x TeamBrussels3x3). La capacité et les
// tags sont définis dans lib/open-gym-7.js. On compte des JOUEURS qui ont payé
// (tag open-gym-7-paye, plus l'ancien tag 3x3-paye pour ne rien survendre).
// Interrogé par 3x3.html au chargement et après chaque inscription.

import { MAX_SPOTS, countPaid } from '../lib/open-gym-7.js';

export default async function handler(req, res) {
  try {
    const count = await countPaid();
    return res.status(200).json({
      count,
      max: MAX_SPOTS,
      spotsLeft: Math.max(0, MAX_SPOTS - count),
      open: count < MAX_SPOTS
    });
  } catch (err) {
    console.error('capacity-3x3 error:', err.message);
    // Comme payment-count.js : en cas d'erreur GHL, on ne bloque jamais le
    // formulaire par erreur, on renvoie "open: true".
    return res.status(200).json({ count: 0, max: MAX_SPOTS, spotsLeft: MAX_SPOTS, open: true, error: true });
  }
}
