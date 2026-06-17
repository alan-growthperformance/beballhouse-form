// Persistent payment counter using Vercel Blob or simple global
// We use a module-level variable + Vercel's serverless persistence trick

const STORAGE_KEY = 'bbh_payment_count';

// In-memory store (persists within the same serverless instance)
// For true persistence across instances, we use GHL contact count
let memCount = null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const GHL_API_KEY = process.env.GHL_API_KEY;
  const LOCATION_ID = 'IVyJR0QEPnSEV9ZMlpHw';

  try {
    if (req.method === 'GET') {
      // Count contacts tagged "Paiement Confirmé" in GHL
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
        return res.status(200).json({ count: memCount || 0, max: MAX_SPOTS });
      }

      const data = await ghlRes.json();
      // Count contacts with "Paiement Confirmé" tag
      const MAX_SPOTS = 17;
const paid = (data.contacts || []).filter(c => 
        c.tags && c.tags.includes('Paiement Confirmé')
      );
      
      return res.status(200).json({ count: paid.length, max: MAX_SPOTS, open: paid.length < MAX_SPOTS });
    }

    if (req.method === 'POST') {
      const { count } = req.body || {};
      if (count !== undefined) memCount = count;
      
      // Tag the latest contact in GHL as "Paiement Confirmé"
      // First get most recent contact
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
          // Add "Paiement Confirmé" tag
          await fetch(`https://services.leadconnectorhq.com/contacts/${contact.id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${GHL_API_KEY}`,
              'Content-Type': 'application/json',
              'Version': '2021-07-28',
            },
            body: JSON.stringify({
              tags: [...(contact.tags || []), 'Paiement Confirmé', 'Open Gym #02']
            })
          });
        }
      }

      return res.status(200).json({ success: true });
    }

  } catch(err) {
    console.error('Payment count error:', err.message);
    return res.status(200).json({ count: 0, max: MAX_SPOTS, open: true });
  }
}
