// api/payment-count.js
// Renvoie la session actuellement "active" (voir lib/sessions.js) et son
// état de remplissage. Le formulaire (index.html) interroge cet endpoint
// pour savoir quelle session afficher, et pour savoir s'il doit basculer
// automatiquement sur la session suivante.

import { getActiveSession } from '../lib/sessions.js';

export default async function handler(req, res) {
  const debug = req.query?.debug === '1';

  try {
    const active = await getActiveSession();
    return res.status(200).json({
      session: active.id,
      sessionLabel: active.label,
      count: active.count,
      max: active.maxSpots,
      open: active.open,
      ...(debug ? { paidTag: active.paidTag } : {})
    });
  } catch (err) {
    console.error('Payment count error:', err.message);
    // En cas d'erreur GHL, on ne bloque jamais les inscriptions par erreur :
    // on renvoie "open: true" pour laisser le formulaire ouvert.
    return res.status(200).json({
      session: null, sessionLabel: null, count: 0, max: null, open: true,
      ...(debug ? { debug_error: true, catch_error: err.message } : {})
    });
  }
}
