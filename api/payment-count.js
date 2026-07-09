// api/payment-count.js
// Compte le nombre de contacts GHL taggés "paye-session-3" pour savoir
// si les 35 places sont prises. Aucune manipulation manuelle nécessaire :
// ce compteur se met à jour tout seul dès qu'un contact reçoit ce tag
// (via Stripe webhook ou via Make pour les virements/paiements manuels).

const GHL_API_KEY = process.env.GHL;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const MAX_SPOTS = 35;
const PAID_TAG = 'paye-session-3';

export default async function handler(req, res) {
  try {
    const searchRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify({
          locationId: GHL_LOCATION_ID,
          filters: [
            { field: 'tags', operator: 'contains', value: PAID_TAG }
          ],
          pageLimit: 1
        })
      }
    );

    if (!searchRes.ok) {
      // En cas d'erreur GHL, on n'affiche jamais "complet" par erreur :
      // on laisse le lien ouvert pour ne pas bloquer les inscriptions.
      return res.status(200).json({ count: 0, max: MAX_SPOTS, open: true });
    }

    const data = await searchRes.json();
    const count = data?.meta?.total ?? (data?.contacts?.length || 0);
    const open = count < MAX_SPOTS;

    return res.status(200).json({ count, max: MAX_SPOTS, open });
  } catch (err) {
    console.error('Payment count error:', err.message);
    return res.status(200).json({ count: 0, max: MAX_SPOTS, open: true });
  }
}
