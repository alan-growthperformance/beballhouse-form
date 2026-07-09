// api/submit.js
// Reçoit les données du formulaire (index.html) et crée/met à jour le contact
// dans GoHighLevel (GHL) en utilisant l'EMAIL comme identifiant (plus de téléphone).

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name, email, postal,
      freq, level, price, manque, source, dispo,
      type, lang, session
    } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email et nom requis' });
    }

    // 1. Chercher si le contact existe déjà (par email)
    const searchRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
      {
        headers: {
          'Authorization': `Bearer ${GHL_API_KEY}`,
          'Version': '2021-07-28',
        }
      }
    );
    const searchData = await searchRes.json().catch(() => ({}));
    const existingContact = searchData?.contact || null;

    const [firstName, ...rest] = name.trim().split(' ');
    const lastName = rest.join(' ') || '';

    const contactPayload = {
      locationId: GHL_LOCATION_ID,
      email,
      firstName,
      lastName,
      customFields: [
        { key: 'code_postal', field_value: postal || '' },
        { key: 'frequence_jeu', field_value: freq || '' },
        { key: 'niveau', field_value: level || '' },
        { key: 'budget_session', field_value: price || '' },
        { key: 'manque_bruxelles', field_value: manque || '' },
        { key: 'source_decouverte', field_value: source || '' },
        { key: 'disponibilite', field_value: dispo || '' },
        { key: 'langue_formulaire', field_value: lang || '' },
        { key: 'session_inscrite', field_value: session || '' },
        { key: 'type_inscription', field_value: type || '' },
      ],
      tags: ['session-3-inscrit', type === 'retour' ? 'retour' : 'nouveau']
    };

    let contactId;
    if (existingContact?.id) {
      // Mettre à jour le contact existant
      const updateRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/${existingContact.id}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify(contactPayload)
        }
      );
      const updateData = await updateRes.json();
      contactId = existingContact.id;
      if (!updateRes.ok) {
        console.error('GHL update error:', updateData);
      }
    } else {
      // Créer un nouveau contact
      const createRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify(contactPayload)
        }
      );
      const createData = await createRes.json();
      contactId = createData?.contact?.id;
      if (!createRes.ok) {
        console.error('GHL create error:', createData);
        return res.status(502).json({ error: 'Erreur GHL', details: createData });
      }
    }

    return res.status(200).json({ success: true, contactId });
  } catch (err) {
    console.error('Submit error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur', message: err.message });
  }
}
