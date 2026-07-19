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
