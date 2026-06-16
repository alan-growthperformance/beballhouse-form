export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GHL_API_KEY = process.env.GHL_API_KEY;

  try {
    const { name, phone, postal, freq, level, price, solo, manque, source, dispo, type, lang, session } = req.body;

    const nameParts = (name || '').trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const contact = {
      firstName,
      lastName,
      phone: phone || '',
      postalCode: postal || '',
      source: 'BeBall House Form',
      tags: ['BeBall House', session || 'Open Gym #02', type === 'retour' ? 'Retour' : 'Nouveau'],
      customField: {
        frequence_jeu: freq || '',
        niveau: level || '',
        budget_session: price || '',
        vient_avec: solo || '',
        manque_bruxelles: manque || '',
        source_decouverte: source || '',
        disponibilite: dispo || '',
        langue_formulaire: lang || 'fr',
        session_inscrite: session || 'Open Gym #02',
        type_inscription: type || 'nouveau',
      }
    };

    const ghlRes = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contact)
    });

    // Read as text first to avoid JSON parse crash
    const rawText = await ghlRes.text();

    let ghlData = {};
    try { ghlData = JSON.parse(rawText); } catch(e) {
      console.error('GHL non-JSON response:', rawText);
    }

    if (!ghlRes.ok) {
      console.error('GHL error status:', ghlRes.status, rawText);
      return res.status(500).json({ error: 'GHL error', status: ghlRes.status, details: rawText });
    }

    return res.status(200).json({ success: true, contactId: ghlData.contact?.id });

  } catch (err) {
    console.error('Server error:', err.message);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
