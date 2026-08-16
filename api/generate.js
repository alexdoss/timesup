// Plafond par adresse IP et par jour. C'est un garde-fou contre l'abus de l'adresse
// publique, pas la limite affichée au joueur : celle-ci est de 5 par appareil et vit
// dans js/library.js. Une valeur plus haute évite de bloquer plusieurs personnes
// derrière une même connexion (foyer, réseau d'entreprise).
const PLAFOND_IP_PAR_JOUR = 20;

// Vercel KV expose ces variables automatiquement une fois le stockage rattaché au projet.
// Sans elles, le plafond serveur est simplement inactif — la génération continue de marcher.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Groq déprécie ses modèles au fil des mois — llama-3.3-70b l'a été en août 2026.
// La variable d'environnement GROQ_MODELE permet d'en changer depuis Vercel,
// sans redéployer, et de revenir en arrière aussi vite si la qualité se dégrade.
const MODELE_PAR_DEFAUT = 'openai/gpt-oss-120b';

// La langue des cartes suit celle de l'app, transmise par le client depuis
// l'attribut `lang` du document. Ce repli ne sert qu'aux appels qui ne la
// précisent pas : c'est le seul endroit du serveur où une langue est nommée.
const LANGUE_PAR_DEFAUT = 'fr';

// Nommer la langue plutôt que d'envoyer son code : « français » guide mieux un
// modèle que « fr ». Une langue absente de cette table passe par son code, que
// les modèles savent interpréter — ajouter une entrée n'est qu'un confort.
const LANGUES = {
  fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand',
  it: 'italien', pt: 'portugais', nl: 'néerlandais', ca: 'catalan'
};

function nomDeLangue(code) {
  // « fr-CA » et « FR » désignent la même langue que « fr »
  const base = String(code || LANGUE_PAR_DEFAUT).trim().toLowerCase().split('-')[0];
  return LANGUES[base] || base || LANGUES[LANGUE_PAR_DEFAUT];
}

// Les modèles de raisonnement réfléchissent avant de répondre, et cette réflexion
// consomme le même budget de jetons que la réponse. Notre tâche — lister des mots
// sur un thème — n'en demande aucune : on la réduit au minimum, et on élargit le
// budget pour qu'une liste de 40 éléments ne soit jamais tronquée.
function corpsGroq(modele, prompt) {
  const corps = {
    model: modele,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9,
    max_tokens: 4096
  };
  // Envoyé au seul modèle qui l'accepte : Groq refuse les paramètres inconnus
  if (modele.startsWith('openai/gpt-oss')) corps.reasoning_effort = 'low';
  return corps;
}

// Extrait la liste de mots de ce que renvoie le modèle. Trois garde-fous, parce
// que la réponse vient d'un modèle et non d'un contrat : les blocs de réflexion
// qui fuient parfois dans le texte, les clôtures markdown, et tout ce qui n'est
// pas une chaîne dans le tableau.
function extraireListe(texte) {
  const propre = String(texte)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '');

  const debut = propre.indexOf('[');
  const fin = propre.lastIndexOf(']');
  if (debut === -1 || fin <= debut) return null;

  let brut;
  try {
    brut = JSON.parse(propre.slice(debut, fin + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(brut)) return null;

  const mots = brut
    .filter(m => typeof m === 'string')
    .map(m => m.trim())
    .filter(m => m.length > 0);
  return mots.length ? mots : null;
}

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
  // Le modèle se règle depuis Vercel : Groq déprécie et remplace ses modèles
  // régulièrement, et en changer ne doit pas demander un déploiement.
  const modele = process.env.GROQ_MODELE || MODELE_PAR_DEFAUT;

  if (!themeName || !count) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const plafond = await verifierPlafondIP(req);
  if (!plafond.autorise) {
    return res.status(429).json({
      error: "Trop de générations depuis cette connexion aujourd'hui. Réessaie demain."
    });
  }

  const langue = nomDeLangue(req.body.langue);

  let prompt = `Tu es un assistant pour un jeu de devinettes appelé Rush. Génère exactement ${count} éléments sur le thème "${themeName}".`;

  // La consigne de langue est explicite : le prompt est rédigé en français, mais
  // rien n'imposait la langue de la réponse et le modèle basculait en anglais
  // dès que le thème s'y prêtait.
  prompt += `\n\nRègles à respecter :
- Écris tous les éléments en ${langue}, sans aucune exception
- Un nom propre étranger garde son orthographe d'origine ; tout le reste est en ${langue}
- Chaque élément doit être un nom propre, un personnage, un concept ou un objet facilement identifiable en lien avec le thème
- Les éléments doivent pouvoir être devinés par description (phrases), par un seul mot indice, puis par mime
- Pas de doublons
- Variés en difficulté (du facile au difficile)
- Réponds UNIQUEMENT avec un tableau JSON de chaînes, sans explication ni formatage markdown
Forme attendue, à ne pas recopier : ["premier", "deuxième", "troisième"]`;

  // La consigne du joueur vient en dernier et prime : c'est ce qui lui permet
  // de demander une autre langue que celle de l'app.
  if (comment) {
    prompt += `\n\nConsigne du joueur, prioritaire sur les règles ci-dessus : ${comment}`;
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(corpsGroq(modele, prompt))
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq API error:', response.status, errorText);
      return res.status(502).json({ error: `Groq ${response.status}: ${errorText}` });
    }

    const data = await response.json();
    const words = extraireListe(data.choices?.[0]?.message?.content || '');
    if (!words) {
      return res.status(502).json({ error: "L'IA n'a pas retourné un format valide." });
    }
    return res.status(200).json({ words });

  } catch (err) {
    console.error('Groq error:', err.message);
    return res.status(502).json({ error: err.message });
  }
}
