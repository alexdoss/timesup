import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing');
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { themeName, comment, count } = req.body;

  if (!themeName || !count) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  // Prompt structuré avec thème + commentaire optionnel
  let prompt = `Tu es un assistant pour le jeu Time's Up. Génère exactement ${count} éléments sur le thème "${themeName}".`;

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
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 2048
      }
    });

    const text = result.response.text();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(502).json({ error: "L'IA n'a pas retourné un format valide." });
    }

    const words = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ words: words.map(w => String(w).trim()).filter(w => w.length > 0) });

  } catch (err) {
    console.error('Gemini error:', err.message);
    return res.status(502).json({ error: err.message });
  }
}
