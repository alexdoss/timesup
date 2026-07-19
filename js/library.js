// ===== LIBRARY MODULE =====
// Gestion des thèmes personnalisés (localStorage + API serveur)

const STORAGE_KEY = 'timesup_custom_themes';

export function getCustomThemes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveCustomTheme(id, theme) {
  const themes = getCustomThemes();
  themes[id] = theme;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
}

export function deleteCustomTheme(id) {
  const themes = getCustomThemes();
  delete themes[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
}

export async function generateWithAI(themeName, comment, count) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themeName, comment, count })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Erreur ${response.status}`);
  }

  return data.words;
}
