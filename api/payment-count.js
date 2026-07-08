// Persistent payment counter using GHL contact tags as source of truth
const STORAGE_KEY = 'bbh_payment_count';

// In-memory store (persists within the same serverless instance only)
let memCount = null;

// Session 3 config
const MAX_SPOTS = 35;
const PAID_TAG = 'paye-session-3';
const PARTICIPANT_TAG = 'session-3-participant';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const GHL_API_KEY = process.env.GHL_API_KEY;
  const LOCATION_ID = 'IVyJR0QEPnSEV9ZMlpHw';

  try {
    if (req.method === 'GET') {
      // Count contacts tagged as paid for session 3
      const ghlRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${LOCATION_ID}&limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
          }
        }
      );

      if (!ghlRes.ok) {
        return res.status(200).json({ count: memCount || 0, max: MAX_SPOTS, open: true });
      }

      const data = await ghlRes.json();
      const paid = (data.contacts || []).filter(c =>
        c.tags && c.tags.includes(PAID_TAG)
      );

      return res.status(200).json({
        count: paid.length,
        max: MAX_SPOTS,
        open: paid.length < MAX_SPOTS
      });
    }

    if (req.method === 'POST') {
      const { count } = req.body || {};
      if (count !== undefined) memCount = count;

      // Tag the latest contact in GHL as paid for session 3
      const ghlRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${LOCATION_ID}&limit=1&sortBy=dateAdded&sortOrder=desc`,
        {
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
          }
        }
      );

      if (ghlRes.ok) {
        const data = await ghlRes.json();
        const contact = data.contacts?.[0];
        if (contact?.id) {
          await fetch(`https://services.leadconnectorhq.com/contacts/${contact.id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${GHL_API_KEY}`,
              'Content-Type': 'application/json',
              'Version': '2021-07-28',
            },
            body: JSON.stringify({
              tags: [...(contact.tags || []), PAID_TAG, PARTICIPANT_TAG]
            })
          });
        }
      }

      return res.status(200).json({ success: true });
    }
  } catch (err) {
    console.error('Payment count error:', err.message);
    return res.status(200).json({ count: 0, max: MAX_SPOTS, open: true });
  }
}
