// api/capacity-3x3.js
// Places restantes pour BBH x TeamBrussels3x3 (24 places fixes, comptées
// via le tag GHL "3x3-paye"). Interrogé par 3x3.html au chargement et
// après chaque tentative d'inscription refusée pour place insuffisante.

import { countByTag } from '../lib/sessions.js';

const MAX_SPOTS = 24;
const PAID_TAG = '3x3-paye';

export default async function handler(req, res) {
  try {
    const count = await countByTag(PAID_TAG);
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
