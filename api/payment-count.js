// api/payment-count.js
// Compte le nombre de contacts GHL taggés "paye-session-4" pour savoir
// si les 33 places sont prises.
//
// IMPORTANT : on utilise ici l'endpoint POST /contacts/search (recommandé
// par GHL), et non GET /contacts/ (déprécié par GHL, et qui chez toi ne
// renvoyait qu'1 seul contact par appel au lieu de respecter le "limit").
//
// On filtre directement côté GHL sur le tag, et on paginate avec le
// curseur "searchAfter" renvoyé par GHL lui-même (plus fiable que de
// reconstruire un curseur nous-mêmes à partir de dateAdded/id).

const GHL_API_KEY = process.env.GHL;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const MAX_SPOTS = 35;
const PAID_TAG = 'paye-session-4';
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // garde-fou : 10 x 100 = 1000 contacts scannés max

export default async function handler(req, res) {
  const debug = req.query?.debug === '1';

  try {
    let count = 0;
    let searchAfter = undefined;
    let pages = 0;
    let lastResponse = null;

    while (pages < MAX_PAGES) {
      const body = {
        locationId: GHL_LOCATION_ID,
        pageLimit: PAGE_SIZE,
        filters: [
          { field: 'tags', operator: 'contains', value: PAID_TAG }
        ],
        ...(searchAfter ? { searchAfter } : {})
      };

      const searchRes = await fetch(
        'https://services.leadconnectorhq.com/contacts/search',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify(body)
        }
      );

      const data = await searchRes.json().catch(() => ({}));
      lastResponse = data;

      if (!searchRes.ok) {
        // En cas d'erreur GHL, on n'affiche jamais "complet" par erreur :
        // on laisse le lien ouvert pour ne pas bloquer les inscriptions.
        return res.status(200).json({
          count: 0, max: MAX_SPOTS, open: true,
          ...(debug ? { debug_error: true, ghl_status: searchRes.status, ghl_response: data } : {})
        });
      }

      const contacts = data?.contacts || [];
      count += contacts.length;
      pages++;

      // Fin de pagination : plus de résultats, ou moins d'une page pleine
      if (contacts.length === 0 || contacts.length < PAGE_SIZE) break;

      // GHL renvoie un curseur "searchAfter" sur chaque contact,
      // à réutiliser tel quel pour la page suivante.
      const last = contacts[contacts.length - 1];
      if (!last?.searchAfter) break;
      searchAfter = last.searchAfter;

      // On peut arrêter dès qu'on a atteint le seuil, pas besoin d'aller plus loin
      if (count >= MAX_SPOTS) break;
    }

    const open = count < MAX_SPOTS;

    return res.status(200).json({
      count, max: MAX_SPOTS, open,
      ...(debug ? { pages_scanned: pages, ghl_last_response_sample: lastResponse } : {})
    });
  } catch (err) {
    console.error('Payment count error:', err.message);
    return res.status(200).json({
      count: 0, max: MAX_SPOTS, open: true,
      ...(debug ? { debug_error: true, catch_error: err.message } : {})
    });
  }
}
