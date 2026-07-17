// ===== APP — Point d'entrée =====
// Orchestre les modules et gère les événements

import { loadThemes } from './themes.js';
import { game, ROUNDS, resetGame, buildDeck, startNewRound, getCurrentCard, cardFound, cardPassed, switchTeam, isRoundOver, isGameOver, nextRound, getCardsRemaining, addPlayer, removePlayer, shuffleTeams, getCurrentPlayer, advancePlayer } from './game.js';
import { showScreen, updateTimer, showCard, updateRoundScreen, updateTurnInfo, updateGameHeader, showTurnResult, showRoundEnd, showFinalScreen, renderThemeButtons, renderPlayerList, renderTeamsPreview, updateCurrentPlayer, renderPlayerStats } from './ui.js';
import { getCustomThemes, saveCustomTheme, deleteCustomTheme, generateWithAI } from './library.js';

let THEMES = {};
let aiGeneratedWords = [];

// ===== INIT =====
async function init() {
  THEMES = await loadThemes();

  // Merge custom themes from localStorage
  const customThemes = getCustomThemes();
  Object.assign(THEMES, customThemes);

  game.selectedThemes = new Set(Object.keys(THEMES));

  const container = document.getElementById('theme-selector');
  renderThemeButtons(THEMES, game.selectedThemes, container);

  setupListeners();
}

function refreshPlayerList() {
  renderPlayerList(game.players, (name) => {
    removePlayer(name);
    refreshPlayerList();
  });
}

function setupListeners() {
  // Home → Themes (step 1)
  document.getElementById('btn-start').addEventListener('click', () => showScreen('screen-themes'));

  // Themes → Players (step 2)
  document.getElementById('btn-next-step').addEventListener('click', () => {
    if (game.selectedThemes.size === 0) {
      alert("Sélectionne au moins un thème !");
      return;
    }
    showScreen('screen-players');
  });

  // Add player
  const playerInput = document.getElementById('player-name-input');
  document.getElementById('btn-add-player').addEventListener('click', () => {
    const name = playerInput.value.trim();
    if (addPlayer(name)) {
      playerInput.value = '';
      refreshPlayerList();
    }
    playerInput.focus();
  });

  // Add player on Enter
  playerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('btn-add-player').click();
    }
  });

  // Players → Config (step 3)
  document.getElementById('btn-next-players').addEventListener('click', () => {
    if (game.players.length < 4) {
      alert("Il faut au moins 4 joueurs !");
      return;
    }
    game.nominativeMode = true;
    shuffleTeams();
    renderTeamsPreview(game.teams, true);
    document.getElementById('btn-shuffle-teams').style.display = '';
    document.getElementById('teams-hint').style.display = '';
    showScreen('screen-config');
  });

  // Skip players (mode rapide)
  document.getElementById('btn-skip-players').addEventListener('click', () => {
    game.nominativeMode = false;
    game.players = [];
    game.teams[0].players = [];
    game.teams[1].players = [];
    document.getElementById('teams-preview').innerHTML = '';
    document.getElementById('btn-shuffle-teams').style.display = 'none';
    document.getElementById('teams-hint').style.display = 'none';
    showScreen('screen-config');
  });

  // Shuffle teams button
  document.getElementById('btn-shuffle-teams').addEventListener('click', () => {
    shuffleTeams();
    renderTeamsPreview(game.teams, true);
  });

  // Timer selector
  document.querySelectorAll('.btn-timer').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-timer').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      game.turnTime = parseInt(btn.dataset.time);
    });
  });

  // Cards selector
  document.querySelectorAll('.btn-cards').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-cards').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      game.numCards = parseInt(btn.dataset.cards);
    });
  });

  // Start game
  document.getElementById('btn-play').addEventListener('click', startGame);

  // Start turn
  document.getElementById('btn-start-turn').addEventListener('click', startTurn);

  // Found / Pass
  document.getElementById('btn-found').addEventListener('click', onFound);
  document.getElementById('btn-pass').addEventListener('click', onPass);

  // Next turn
  document.getElementById('btn-next-turn').addEventListener('click', onNextTurn);

  // Restart
  document.getElementById('btn-restart').addEventListener('click', () => showScreen('screen-home'));

  // ===== LIBRARY =====
  document.getElementById('btn-library').addEventListener('click', () => {
    renderCustomThemesList();
    showScreen('screen-library');
  });

  document.getElementById('btn-create-theme').addEventListener('click', () => {
    aiGeneratedWords = [];
    document.getElementById('ai-theme-name').value = '';
    document.getElementById('ai-prompt').value = '';
    document.getElementById('ai-status').textContent = '';
    document.getElementById('ai-preview').innerHTML = '';
    document.getElementById('ai-preview').classList.remove('visible');
    document.getElementById('btn-save-theme').style.display = 'none';
    showScreen('screen-ai-create');
  });

  // AI card count selector
  document.querySelectorAll('.btn-ai-count').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-ai-count').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Generate with AI
  document.getElementById('btn-generate').addEventListener('click', handleGenerate);

  // Save generated theme
  document.getElementById('btn-save-theme').addEventListener('click', handleSaveTheme);
}

// ===== GAME FLOW =====
function startGame() {
  game.teams[0].name = document.getElementById('team1-name').value || "Équipe 1";
  game.teams[1].name = document.getElementById('team2-name').value || "Équipe 2";
  resetGame();
  buildDeck(THEMES);
  beginRound();
}

function beginRound() {
  startNewRound();
  const round = ROUNDS[game.currentRound];
  updateRoundScreen(round, game.teams);
  updateTurnInfo(game.teams[game.currentTeam].name);
  updateCurrentPlayer(game.nominativeMode ? getCurrentPlayer() : null);
  showScreen('screen-round');
}

function startTurn() {
  game.turnScore = 0;
  game.timeLeft = game.turnTime;

  const roundName = ROUNDS[game.currentRound].name.split(' — ')[0];
  updateGameHeader(roundName, game.teams[game.currentTeam].name);
  displayCurrentCard();
  updateTimer(game.timeLeft);
  showScreen('screen-game');

  game.timerInterval = setInterval(() => {
    game.timeLeft--;
    updateTimer(game.timeLeft);
    if (game.timeLeft <= 0) {
      endTurn();
    }
  }, 1000);
}

function displayCurrentCard() {
  const word = getCurrentCard();
  if (!word) {
    endRound();
    return;
  }
  showCard(word, getCardsRemaining());
}

function onFound() {
  cardFound();
  displayCurrentCard();
}

function onPass() {
  cardPassed();
  displayCurrentCard();
}

function endTurn() {
  clearInterval(game.timerInterval);
  if (game.nominativeMode) {
    const player = getCurrentPlayer();
    showTurnResult(`${player} (${game.teams[game.currentTeam].name})`, game.turnScore);
    advancePlayer();
  } else {
    showTurnResult(game.teams[game.currentTeam].name, game.turnScore);
  }
  switchTeam();
  showScreen('screen-turn-end');
}

function onNextTurn() {
  if (isRoundOver()) {
    endRound();
  } else {
    updateTurnInfo(game.teams[game.currentTeam].name);
    updateCurrentPlayer(game.nominativeMode ? getCurrentPlayer() : null);
    showScreen('screen-round');
  }
}

function endRound() {
  clearInterval(game.timerInterval);
  showRoundEnd(game.currentRound + 1, game.teams);

  const btnNext = document.getElementById('btn-next-round');
  if (isGameOver()) {
    btnNext.textContent = "Voir les résultats 🏆";
    btnNext.onclick = () => {
      showFinalScreen(game.teams);
      if (game.nominativeMode) {
        renderPlayerStats(game.playerStats, game.teams);
      } else {
        document.getElementById('player-stats').innerHTML = '';
      }
      showScreen('screen-final');
    };
  } else {
    btnNext.textContent = "Manche suivante ▶️";
    btnNext.onclick = () => {
      nextRound();
      beginRound();
    };
  }

  showScreen('screen-round-end');
}

// ===== LIBRARY FUNCTIONS =====
function renderCustomThemesList() {
  const container = document.getElementById('custom-themes-list');
  const customThemes = getCustomThemes();
  const keys = Object.keys(customThemes);

  if (keys.length === 0) {
    container.innerHTML = '<p class="wizard-hint">Aucun thème personnalisé. Créez-en un !</p>';
    return;
  }

  container.innerHTML = keys.map(key => {
    const theme = customThemes[key];
    return `<div class="custom-theme-item">
      <span>✨ ${theme.name} <span class="theme-count">(${theme.words.length} cartes)</span></span>
      <button class="btn-delete-theme" data-id="${key}">🗑️</button>
    </div>`;
  }).join('');

  container.querySelectorAll('.btn-delete-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Supprimer le thème "${customThemes[btn.dataset.id].name}" ?`)) {
        deleteCustomTheme(btn.dataset.id);
        delete THEMES[btn.dataset.id];
        renderCustomThemesList();
      }
    });
  });
}

async function handleGenerate() {
  const themeName = document.getElementById('ai-theme-name').value.trim();
  const description = document.getElementById('ai-prompt').value.trim();
  const count = parseInt(document.querySelector('.btn-ai-count.active').dataset.count);

  if (!themeName) { alert("Donne un nom au thème"); return; }
  if (!description) { alert("Décris ce que tu veux comme cartes"); return; }

  const statusEl = document.getElementById('ai-status');
  const previewEl = document.getElementById('ai-preview');
  const btnSave = document.getElementById('btn-save-theme');
  const btnGenerate = document.getElementById('btn-generate');

  statusEl.textContent = "⏳ Génération en cours...";
  btnGenerate.disabled = true;
  previewEl.classList.remove('visible');
  btnSave.style.display = 'none';

  try {
    aiGeneratedWords = await generateWithAI(themeName, description, count);
    statusEl.textContent = `✅ ${aiGeneratedWords.length} cartes générées !`;
    previewEl.innerHTML = aiGeneratedWords.map(w => `<span>${w}</span>`).join(' • ');
    previewEl.classList.add('visible');
    btnSave.style.display = '';
  } catch (err) {
    statusEl.textContent = `❌ Erreur : ${err.message}`;
  } finally {
    btnGenerate.disabled = false;
  }
}

function handleSaveTheme() {
  const themeName = document.getElementById('ai-theme-name').value.trim();
  const id = 'custom_' + Date.now();

  const newTheme = {
    id,
    name: themeName,
    icon: '✨',
    words: aiGeneratedWords
  };

  saveCustomTheme(id, newTheme);
  THEMES[id] = newTheme;

  // Refresh theme buttons in config
  game.selectedThemes = new Set(Object.keys(THEMES));
  const container = document.getElementById('theme-selector');
  renderThemeButtons(THEMES, game.selectedThemes, container);

  alert(`Thème "${themeName}" sauvegardé ! Il apparaîtra dans la sélection de thèmes.`);
  showScreen('screen-library');
  renderCustomThemesList();
}

// ===== QUIT (global for HTML onclick) =====
window.confirmQuit = function() {
  if (confirm("Quitter la partie en cours ?")) {
    clearInterval(game.timerInterval);
    showScreen('screen-home');
  }
};

window.showScreen = showScreen;

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ===== LAUNCH =====
init();
