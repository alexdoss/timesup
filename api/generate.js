// Plafond par adresse IP et par jour. C'est un garde-fou contre l'abus de l'adresse
// publique, pas la limite affichée au joueur : celle-ci est de 5 par appareil et vit
// dans js/library.js. Une valeur plus haute évite de bloquer plusieurs personnes
// derrière une même connexion (foyer, réseau d'entreprise).
const PLAFOND_IP_PAR_JOUR = 20;

// Vercel KV expose ces variables automatiquement une fois le stockage rattaché au projet.
// Sans elles, le plafond serveur est simplement inactif — la génération continue de marcher.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function jourCourant() {
  return new Date().toISOString().slice(0, 10);
}

function adresseAppelant(req) {
  const entete = req.headers['x-forwarded-for'] || '';
  return entete.split(',')[0].trim() || 'inconnue';
}

async function commandeKV(commande) {
  const reponse = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commande)
  });
  if (!reponse.ok) throw new Error(`KV ${reponse.status}`);
  return reponse.json();
}

// Renvoie { autorise, compte } — et laisse toujours passer si le compteur est indisponible :
// mieux vaut une génération de trop qu'une app cassée par un service tiers en panne.
async function verifierPlafondIP(req) {
  if (!KV_URL || !KV_TOKEN) return { autorise: true, actif: false };

  const cle = `rush:ia:${jourCourant()}:${adresseAppelant(req)}`;
  try {
    const { result } = await commandeKV(['INCR', cle]);
    if (result === 1) {
      await commandeKV(['EXPIRE', cle, 172800]);   // la clé s'efface d'elle-même après 48 h
    }
    return { autorise: result <= PLAFOND_IP_PAR_JOUR, compte: result, actif: true };
  } catch (err) {
    console.error('Compteur KV indisponible, plafond ignoré :', err.message);
    return { autorise: true, actif: false };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY is missing');
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { themeName, comment, count } = req.body;

  if (!themeName || !count) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const plafond = await verifierPlafondIP(req);
  if (!plafond.autorise) {
    return res.status(429).json({
      error: "Trop de générations depuis cette connexion aujourd'hui. Réessaie demain."
    });
  }

  let prompt = `Tu es un assistant pour un jeu de devinettes appelé Rush. Génère exactement ${count} éléments sur le thème "${themeName}".`;

  if (comment) {
    prompt += `\nConsigne supplémentaire de l'utilisateur : ${comment}`;
  }

  prompt += `\n\nRègles à respecter :
- Chaque élément doit être un nom propre, un personnage, un concept ou un objet facilement identifiable en lien avec le thème
- Les éléments doivent pouvoir être devinés par description (phrases), par un seul mot indice, puis par mime
- Pas de doublons
- Variés en difficulté (du facile au difficile)
- Réponds UNIQUEMENT avec une liste JSON (tableau de strings), sans explication ni formatage markdown
Exemple de format : ["élément 1", "élément 2", "élément 3"]`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: 2048
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq API error:', response.status, errorText);
      return res.status(502).json({ error: `Groq ${response.status}: ${errorText}` });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(502).json({ error: "L'IA n'a pas retourné un format valide." });
    }

    const words = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ words: words.map(w => String(w).trim()).filter(w => w.length > 0) });

  } catch (err) {
    console.error('Groq error:', err.message);
    return res.status(502).json({ error: err.message });
  }
}
