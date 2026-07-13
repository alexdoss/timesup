// ===== THEMES LOADER =====
// Charge dynamiquement les thèmes depuis les fichiers JSON

const THEME_FILES = [
  'themes/personnalites.json',
  'themes/monde-fantastique.json',
  'themes/animaux-insectes.json',
  'themes/histoire.json',
  'themes/films-series.json'
];

export async function loadThemes() {
  const themes = {};

  const results = await Promise.all(
    THEME_FILES.map(file =>
      fetch(file).then(r => r.json()).catch(() => null)
    )
  );

  results.forEach(theme => {
    if (theme && theme.id) {
      themes[theme.id] = theme;
    }
  });

  return themes;
}
