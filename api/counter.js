// Simple in-memory counter using Vercel Edge Config or a global variable
// For production, this uses a persistent counter via a simple approach

let count = 0; // This resets on cold start - we'll use a workaround

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Use Make webhook to track count via GHL contacts
  // Query GHL for contacts with tag "Open Gym #02"
  const GHL_API_KEY = process.env.GHL_API_KEY;
  const LOCATION_ID = 'IVyJR0QEPnSEV9ZMlpHw';

  try {
    if (req.method === 'GET') {
      // Count contacts in GHL with this session tag
      const ghlRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${LOCATION_ID}&query=Open Gym #02&limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
          }
        }
      );

      if (!ghlRes.ok) {
        // Fallback: use env var counter
        const envCount = parseInt(process.env.REGISTRATION_COUNT || '0');
        return res.status(200).json({ count: envCount });
      }

      const data = await ghlRes.json();
      const contactCount = data.contacts?.length || 0;
      return res.status(200).json({ count: contactCount });
    }

    if (req.method === 'POST') {
      // Just acknowledge - counting is done via GHL contacts
      return res.status(200).json({ success: true });
    }

  } catch(err) {
    return res.status(200).json({ count: 0 });
  }
}
