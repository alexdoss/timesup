// ===== PERSISTENCE MODULE =====
// Sauvegarde et restauration de la partie en cours (localStorage).
// Ne touche ni au DOM, ni aux règles du jeu : uniquement de la sérialisation.

const STORAGE_KEY = 'timesup_partie_en_cours';
const SAVE_VERSION = 1;

// Une sauvegarde plus vieille que ça n'est plus proposée (partie oubliée).
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isValidState(state) {
  return !!state
    && Array.isArray(state.teams) && state.teams.length === 2
    && Array.isArray(state.activeRounds) && state.activeRounds.length > 0
    && Array.isArray(state.deck)
    && Number.isInteger(state.currentRound)
    && Number.isInteger(state.currentTeam);
}

export function saveGame(game) {
  try {
    // timerInterval n'est pas sérialisable, selectedThemes est un Set
    const { timerInterval, selectedThemes, ...rest } = game;
    const snapshot = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      state: { ...rest, selectedThemes: [...selectedThemes] }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Stockage plein ou indisponible : la partie continue, sans filet
  }
}

export function loadSavedGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    if (!snapshot || snapshot.version !== SAVE_VERSION) return null;
    if (!isValidState(snapshot.state)) return null;
    if (Date.now() - (snapshot.savedAt || 0) > MAX_AGE_MS) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function clearSavedGame() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // rien à faire
  }
}

export function restoreInto(game, snapshot) {
  const state = snapshot.state;
  Object.keys(state).forEach(key => {
    if (key === 'selectedThemes') return;
    game[key] = state[key];
  });

  // On vide et remplit l'ensemble existant au lieu de le remplacer : les boutons
  // de thèmes retiennent cet objet depuis leur création. Le remplacer les ferait
  // écrire dans un ensemble que plus personne ne lit.
  game.selectedThemes.clear();
  (state.selectedThemes || []).forEach(cle => game.selectedThemes.add(cle));

  game.timerInterval = null;
  return game;
}
