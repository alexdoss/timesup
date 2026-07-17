export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { themeName, description, count } = req.body;

  if (!themeName || !description || !count) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const prompt = `Génère exactement ${count} éléments pour un jeu de Time's Up sur le thème "${themeName}".
Instructions : ${description}
Règles :
- Chaque élément doit être un nom propre, un personnage, un concept ou un objet facilement identifiable
- Adapté pour être deviné par description, en un mot, puis en mime
- Pas de doublons
- Réponds UNIQUEMENT avec une liste JSON (tableau de strings), sans explication ni formatage markdown.
Exemple de format attendu : ["élément 1", "élément 2", "élément 3"]`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
