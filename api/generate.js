export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Log pour debug (visible dans Vercel → Logs)
    console.error('GEMINI_API_KEY is missing. Available env vars:', Object.keys(process.env).filter(k => k.startsWith('GEMINI')));
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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 2048
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return res.status(502).json({ error: error?.error?.message || `Gemini error ${response.status}` });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(502).json({ error: "L'IA n'a pas retourné un format valide." });
    }

    const words = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ words: words.map(w => String(w).trim()).filter(w => w.length > 0) });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
