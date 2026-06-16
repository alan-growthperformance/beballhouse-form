export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GHL_API_KEY = process.env.GHL_API_KEY;

  try {
    const body = req.body;
    const { name, phone, postal, freq, level, price, solo, manque, source, dispo, type, lang, session } = body;

    // Split name into first/last
    const nameParts = (name || '').trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Build GHL contact payload
    const contact = {
      firstName,
      lastName,
      phone: phone || '',
      postalCode: postal || '',
      source: 'BeBall House Form',
      tags: ['BeBall House', session || 'Open Gym #02', type === 'retour' ? 'Retour' : 'Nouveau'],
      customFields: [
        { key: 'frequence_jeu', field_value: freq || '' },
        { key: 'niveau', field_value: level || '' },
        { key: 'budget_session', field_value: price || '' },
        { key: 'vient_avec', field_value: solo || '' },
        { key: 'manque_bruxelles', field_value: manque || '' },
        { key: 'source_decouverte', field_value: source || '' },
        { key: 'disponibilite', field_value: dispo || '' },
        { key: 'langue_formulaire', field_value: lang || 'fr' },
        { key: 'session_inscrite', field_value: session || 'Open Gym #02' },
        { key: 'type_inscription', field_value: type || 'nouveau' },
      ]
    };

    const ghlRes = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contact)
    });

    const ghlData = await ghlRes.json();

    if (!ghlRes.ok) {
      console.error('GHL error:', ghlData);
      return res.status(500).json({ error: 'GHL error', details: ghlData });
    }

    return res.status(200).json({ success: true, contactId: ghlData.contact?.id });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
