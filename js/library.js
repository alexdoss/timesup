// ===== LIBRARY MODULE =====
// Gestion des thèmes personnalisés (localStorage + API serveur)

const STORAGE_KEY = 'timesup_custom_themes';
const QUOTA_KEY = 'timesup_quota_ia';

// Limite d'usage côté joueur. Le serveur applique en plus son propre plafond,
// qui lui protège la facture (voir api/generate.js).
export const GENERATIONS_PAR_JOUR = 5;

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

// ===== QUOTA DE GÉNÉRATION =====

function jourCourant() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getQuota() {
  try {
    const brut = JSON.parse(localStorage.getItem(QUOTA_KEY));
    if (brut && brut.jour === jourCourant()) {
      const utilise = Math.max(0, brut.utilise || 0);
      return { utilise, restant: Math.max(0, GENERATIONS_PAR_JOUR - utilise), max: GENERATIONS_PAR_JOUR };
    }
  } catch {
    // compteur illisible : on repart de zéro
  }
  return { utilise: 0, restant: GENERATIONS_PAR_JOUR, max: GENERATIONS_PAR_JOUR };
}

function consommerUneGeneration() {
  const quota = getQuota();
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ jour: jourCourant(), utilise: quota.utilise + 1 }));
  } catch {
    // compteur non mémorisé, sans conséquence sur la génération
  }
}

export async function generateWithAI(themeName, comment, count) {
  const quota = getQuota();
  if (quota.restant <= 0) {
    throw new Error(`Limite atteinte : ${GENERATIONS_PAR_JOUR} générations par jour. Réessaie demain.`);
  }

  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // La langue vient de l'attribut `lang` du document : c'est déjà la langue
    // d'affichage de l'app, et elle suivra d'elle-même une future traduction.
    body: JSON.stringify({
      themeName, comment, count,
      langue: document.documentElement.lang || undefined
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Erreur ${response.status}`);
  }

  // On ne décompte que les générations réellement abouties
  consommerUneGeneration();
  return data.words;
}
