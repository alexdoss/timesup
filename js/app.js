// ===== APP — Point d'entrée =====
// Orchestre les modules et gère les événements

import { loadThemes } from './themes.js';
import { game, ROUNDS, resetGame, buildDeck, startNewRound, getCurrentCard, cardFound, cardPassed, switchTeam, isRoundOver, isGameOver, nextRound, getCardsRemaining, addPlayer, removePlayer, assignTeamsRoundRobin, getCurrentPlayer, advancePlayer, getActiveRound, setPlayerTeam, syncChosenTeams, canPass } from './game.js';
import { showScreen, updateTimer, showCard, updateRoundScreen, updateTurnInfo, updateGameHeader, showTurnResult, showRoundEnd, showFinalScreen, renderThemeButtons, renderPlayerList, updateCurrentPlayer, renderPlayerStats, renderRoundsSelector, renderAssignMode, applyTeamAccent } from './ui.js';
import { getCustomThemes, saveCustomTheme, deleteCustomTheme, generateWithAI } from './library.js';

let THEMES = {};
let aiGeneratedWords = [];

// ===== INIT =====
async function init() {
  THEMES = await loadThemes();

  // Merge custom themes from localStorage
  const customThemes = getCustomThemes();
  Object.assign(THEMES, customThemes);

  game.selectedThemes = new Set();

  const container = document.getElementById('theme-selector');
  renderThemeButtons(THEMES, game.selectedThemes, container);

  setupListeners();
}

function getRoundLabel() {
  return `Manche ${game.currentRound + 1}/${game.activeRounds.length}`;
}

function syncTeamNamesFromInputs() {
  game.teams[0].name = document.getElementById('team1-name').value.trim() || "Équipe 1";
  game.teams[1].name = document.getElementById('team2-name').value.trim() || "Équipe 2";
}

function refreshPlayerList() {
  syncTeamNamesFromInputs();
  renderPlayerList(game.players, game.assignMode, game.teams, game.playerAssignments, (name) => {
    removePlayer(name);
    refreshPlayerList();
  }, (playerName, teamIndex) => {
    setPlayerTeam(playerName, teamIndex);
    refreshPlayerList();
  });
}

function openRoundsStep() {
  renderRoundsSelector(ROUNDS, game.activeRounds);
  showScreen('screen-rounds');
}

function collectActiveRounds() {
  // Mandatory rounds (always 0,1,2)
  const mandatory = [0, 1, 2];
  // Optional rounds from active pills
  const optional = [...document.querySelectorAll('#rounds-optional .round-pill.active')]
    .map(pill => parseInt(pill.dataset.roundIndex, 10));

  const selected = [...mandatory, ...optional].sort((a, b) => a - b);
  game.activeRounds = selected;
}

function setupListeners() {
  // Home → Mode (step 1)
  document.getElementById('btn-start').addEventListener('click', () => showScreen('screen-mode'));

  // Mode tiles selection
  document.querySelectorAll('.mode-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      document.querySelectorAll('.mode-tile').forEach(t => t.classList.remove('active'));
      tile.classList.add('active');
      game.cardSource = tile.dataset.source;
    });
  });

  // Mode → next step
  document.getElementById('btn-next-mode').addEventListener('click', () => {
    updateWizardLabels();
    updateCardsCountLabel();
    updateSimpleCustomBlock();
    if (game.cardSource === 'themes') {
      showScreen('screen-themes');
    } else {
      showScreen('screen-players');
    }
  });

  // Themes → Players (step)
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

  // Game mode toggle (Nominatif / Simple)
  document.querySelectorAll('[data-mode]').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const mode = pill.dataset.mode;
      game.nominativeMode = (mode === 'nominatif');
      document.getElementById('nominatif-block').style.display = game.nominativeMode ? '' : 'none';
      updateSimpleCustomBlock();
      document.getElementById('mode-note').textContent = game.nominativeMode
        ? "Chaque joueur est identifié. Rotation et statistiques individuelles."
        : "Mode simple : seules les équipes et les scores sont suivis.";
    });
  });

  // Assign mode toggle
  document.querySelectorAll('[data-assign]').forEach(pill => {
    pill.addEventListener('click', () => {
      game.assignMode = pill.dataset.assign;
      renderAssignMode(game.assignMode);
      refreshPlayerList();
    });
  });

  // Team name changes refresh player list (for dropdowns)
  document.getElementById('team1-name').addEventListener('input', () => {
    syncTeamNamesFromInputs();
    refreshPlayerList();
  });
  document.getElementById('team2-name').addEventListener('input', () => {
    syncTeamNamesFromInputs();
    refreshPlayerList();
  });

  // Players → Rounds (step 3)
  document.getElementById('btn-next-players').addEventListener('click', () => {
    if (game.nominativeMode && game.players.length < 4) {
      alert("Il faut au moins 4 joueurs !");
      return;
    }
    if (!game.nominativeMode) {
      game.players = [];
      game.playerAssignments = {};
      game.teams[0].players = [];
      game.teams[1].players = [];
    }
    syncTeamNamesFromInputs();
    openRoundsStep();
  });

  // Rounds → Config (step 4)
  document.getElementById('btn-next-rounds').addEventListener('click', () => {
    collectActiveRounds();
    updateCardsCountLabel();
    showScreen('screen-config');
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

  // Cards stepper (custom mode)
  const stepInput = document.getElementById('cards-stepper-input');
  const stepMin = 3, stepMax = 20;
  const clampStep = (v) => Math.max(stepMin, Math.min(stepMax, v || stepMin));
  const applyStep = () => {
    game.numCards = clampStep(parseInt(stepInput.value));
    stepInput.value = game.numCards;
    document.getElementById('btn-cards-minus').disabled = game.numCards <= stepMin;
    document.getElementById('btn-cards-plus').disabled = game.numCards >= stepMax;
    updateCustomTotalHint();
  };
  document.getElementById('btn-cards-minus').addEventListener('click', () => {
    stepInput.value = clampStep(parseInt(stepInput.value) - 1);
    applyStep();
  });
  document.getElementById('btn-cards-plus').addEventListener('click', () => {
    stepInput.value = clampStep(parseInt(stepInput.value) + 1);
    applyStep();
  });
  stepInput.addEventListener('input', applyStep);
  stepInput.addEventListener('blur', applyStep);

  // Pass mode selector
  document.getElementById('pass-mode').addEventListener('change', (e) => {
    game.passMode = e.target.value;
    document.getElementById('pass-limit-section').style.display =
      game.passMode === 'limited' ? '' : 'none';
    document.getElementById('pass-replace-section').style.display =
      game.passMode === 'forbidden' ? 'none' : '';
  });

  // Pass limit selector
  document.getElementById('pass-limit').addEventListener('change', (e) => {
    game.passLimit = parseInt(e.target.value);
  });

  // Pass replace selector
  document.getElementById('pass-replace').addEventListener('change', (e) => {
    game.passReplace = e.target.value;
  });

  // Start game
  document.getElementById('btn-play').addEventListener('click', onPlayClicked);

  // Custom cards flow
  document.getElementById('btn-handoff-ready').addEventListener('click', showCustomInput);
  document.getElementById('btn-handoff-launch').addEventListener('click', () => startGame());
  document.getElementById('btn-add-custom-card').addEventListener('click', addCustomCard);
  document.getElementById('custom-card-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCustomCard();
  });
  document.getElementById('btn-toggle-visibility').addEventListener('click', () => {
    const input = document.getElementById('custom-card-input');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('btn-custom-done').addEventListener('click', finishCurrentPlayerEntry);

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
    document.getElementById('ai-comment').value = '';
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

// ===== WIZARD HELPERS =====
function updateWizardLabels() {
  const total = 5;
  const steps = {
    mode: 1,
    themes: game.cardSource === 'themes' ? 2 : null,
    players: game.cardSource === 'themes' ? 3 : 2,
    rounds: game.cardSource === 'themes' ? 4 : 3,
    config: game.cardSource === 'themes' ? 5 : 4
  };
  const totalDisplay = game.cardSource === 'themes' ? 5 : 4;
  document.querySelectorAll('[data-step]').forEach(el => {
    const s = el.dataset.step;
    if (steps[s]) el.textContent = `Étape ${steps[s]}/${totalDisplay}`;
  });
}

function updateCardsCountLabel() {
  const label = document.getElementById('cards-count-label');
  const hint = document.getElementById('cards-count-hint');
  const preset = document.getElementById('cards-preset');
  const stepper = document.getElementById('cards-stepper');

  if (game.cardSource === 'custom') {
    label.textContent = 'Cartes saisies par joueur';
    preset.style.display = 'none';
    stepper.style.display = '';
    const input = document.getElementById('cards-stepper-input');
    if (!input.value || parseInt(input.value) < 3) input.value = 5;
    game.numCards = parseInt(input.value);
    hint.style.display = '';
    updateCustomTotalHint();
  } else {
    label.textContent = 'Nombre de cartes';
    preset.style.display = '';
    stepper.style.display = 'none';
    hint.style.display = 'none';
    const active = document.querySelector('.btn-cards.active');
    if (active) game.numCards = parseInt(active.dataset.cards);
  }
}

function updateCustomTotalHint() {
  const hint = document.getElementById('cards-count-hint');
  if (game.nominativeMode) {
    const nb = game.players.length;
    hint.textContent = `Total du paquet : ${nb} joueurs × ${game.numCards} = ${nb * game.numCards} cartes`;
  } else {
    hint.textContent = `Chaque joueur saisira exactement ${game.numCards} carte(s).`;
  }
}

function updateSimpleCustomBlock() {
  const block = document.getElementById('simple-custom-block');
  block.style.display = (game.cardSource === 'custom' && !game.nominativeMode) ? '' : 'none';
}

window.handleBackFromPlayers = function() {
  showScreen(game.cardSource === 'themes' ? 'screen-themes' : 'screen-mode');
};

// ===== CUSTOM CARDS ENTRY =====
let customEntry = { playerIndex: 0, playerList: [], currentCards: [], batchSize: 0, currentTarget: 0 };

function onPlayClicked() {
  if (game.cardSource === 'custom') {
    startCustomCardsEntry();
  } else {
    startGame();
  }
}

function startCustomCardsEntry() {
  collectActiveRounds();
  syncTeamNamesFromInputs();
  if (game.nominativeMode) {
    if (game.players.length < 4) { alert("Il faut au moins 4 joueurs !"); return; }
    customEntry.playerList = [...game.players];
  } else {
    customEntry.playerList = null; // simple mode: unbounded
  }
  customEntry.batchSize = game.numCards;
  customEntry.playerIndex = 0;
  game.customCards = [];
  showHandoff();
  showScreen('screen-custom-cards');
}

function showHandoff() {
  const isSimple = !game.nominativeMode;
  const handoffLabel = document.getElementById('handoff-player-label');
  const title = document.getElementById('custom-cards-title');
  const hint = document.getElementById('custom-cards-hint');
  const launchBtn = document.getElementById('btn-handoff-launch');

  if (isSimple) {
    const n = customEntry.playerIndex + 1;
    handoffLabel.textContent = customEntry.playerIndex === 0
      ? `Passe le téléphone au premier joueur`
      : `Passe le téléphone au joueur suivant`;
    title.textContent = `Saisisseur ${n}`;
    hint.textContent = `Chacun saisira au moins ${customEntry.batchSize} carte(s).`;
    // Show launch button only if at least one player has entered cards
    launchBtn.style.display = customEntry.playerIndex > 0 ? '' : 'none';
  } else {
    const name = customEntry.playerList[customEntry.playerIndex];
    const total = customEntry.playerList.length;
    handoffLabel.textContent = `Passe le téléphone à ${name}`;
    title.textContent = `Joueur ${customEntry.playerIndex + 1}/${total}`;
    hint.textContent = `Au moins ${customEntry.batchSize} carte(s) à saisir.`;
    launchBtn.style.display = 'none';
  }

  document.getElementById('custom-cards-handoff').style.display = '';
  document.getElementById('custom-cards-input').style.display = 'none';
}

function showCustomInput() {
  customEntry.currentCards = [];
  customEntry.currentTarget = customEntry.batchSize;
  document.getElementById('custom-cards-handoff').style.display = 'none';
  document.getElementById('custom-cards-input').style.display = '';
  const label = game.nominativeMode
    ? `${customEntry.playerList[customEntry.playerIndex]} — tes cartes`
    : `Saisisseur ${customEntry.playerIndex + 1} — tes cartes`;
  document.getElementById('custom-input-header').textContent = label;
  document.getElementById('batch-size-label').textContent = customEntry.batchSize;
  document.getElementById('custom-batch-choice').style.display = 'none';
  refreshCustomCardsUI();
  const input = document.getElementById('custom-card-input');
  input.type = 'password';
  input.value = '';
  input.disabled = false;
  document.getElementById('btn-add-custom-card').disabled = false;
  input.focus();
}

function addCustomCard() {
  const input = document.getElementById('custom-card-input');
  const raw = input.value.trim();
  if (!raw) return;
  if (raw.length < 2) { alert("Trop court"); return; }
  if (customEntry.currentCards.length >= customEntry.currentTarget) return;
  const norm = raw.toLocaleLowerCase();
  const allExisting = [...game.customCards, ...customEntry.currentCards].map(c => c.toLocaleLowerCase());
  if (allExisting.includes(norm)) { alert("Cette carte existe déjà"); return; }
  customEntry.currentCards.push(raw);
  input.value = '';
  input.focus();
  refreshCustomCardsUI();
  if (customEntry.currentCards.length >= customEntry.currentTarget) {
    document.getElementById('custom-batch-choice').style.display = '';
    input.disabled = true;
    document.getElementById('btn-add-custom-card').disabled = true;
  }
}

function refreshCustomCardsUI() {
  const list = document.getElementById('custom-cards-list');
  const n = customEntry.currentCards.length;
  const target = customEntry.currentTarget;
  document.getElementById('custom-progress').textContent = `${n}/${target} carte(s) saisie(s)`;
  list.innerHTML = customEntry.currentCards.map((_, idx) =>
    `<li><span class="card-hidden">••••••••</span><button data-idx="${idx}">🗑️</button></li>`
  ).join('');
  list.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      customEntry.currentCards.splice(parseInt(b.dataset.idx), 1);
      refreshCustomCardsUI();
      if (customEntry.currentCards.length < customEntry.currentTarget) {
        document.getElementById('custom-batch-choice').style.display = 'none';
        document.getElementById('custom-card-input').disabled = false;
        document.getElementById('btn-add-custom-card').disabled = false;
      }
    });
  });
}

function finishCurrentPlayerEntry() {
  game.customCards = game.customCards.concat(customEntry.currentCards);
  customEntry.currentCards = [];
  customEntry.currentTarget = 0;
  customEntry.playerIndex++;

  if (game.nominativeMode) {
    if (customEntry.playerIndex < customEntry.playerList.length) {
      showHandoff();
    } else {
      startGame();
    }
  } else {
    // Simple mode: always propose to hand off or launch
    showHandoff();
  }
}

// ===== GAME FLOW =====
function startGame() {
  collectActiveRounds();
  syncTeamNamesFromInputs();
  if (game.nominativeMode) {
    if (game.assignMode === 'chosen') syncChosenTeams();
    else assignTeamsRoundRobin();
    if (game.teams.some(team => team.players.length === 0)) {
      alert("Chaque équipe doit avoir au moins un joueur.");
      return;
    }
  }
  resetGame();
  buildDeck(THEMES);
  beginRound();
}

function beginRound() {
  startNewRound();
  const round = getActiveRound();
  applyTeamAccent(game.teams[game.currentTeam].color);
  updateRoundScreen(round, game.teams, getRoundLabel());
  updateTurnInfo(game.teams[game.currentTeam].name);
  updateCurrentPlayer(game.nominativeMode ? getCurrentPlayer() : null);
  showScreen('screen-round');
}

function startTurn() {
  game.turnScore = 0;
  game.passCount = 0;
  game.timeLeft = game.turnTime;

  const round = getActiveRound();
  applyTeamAccent(game.teams[game.currentTeam].color);
  updateGameHeader(`${getRoundLabel()} · ${round.name}`, game.teams[game.currentTeam].name);
  displayCurrentCard();
  updatePassButton();
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
  if (!canPass()) return;
  cardPassed();
  updatePassButton();
  displayCurrentCard();
}

function updatePassButton() {
  const btn = document.getElementById('btn-pass');
  const allowed = canPass();
  btn.disabled = !allowed;
  btn.style.opacity = allowed ? '1' : '0.35';
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
    applyTeamAccent(game.teams[game.currentTeam].color);
    updateTurnInfo(game.teams[game.currentTeam].name);
    updateCurrentPlayer(game.nominativeMode ? getCurrentPlayer() : null);
    showScreen('screen-round');
  }
}

function endRound() {
  clearInterval(game.timerInterval);
  showRoundEnd(`${game.currentRound + 1}/${game.activeRounds.length}`, game.teams);

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
  const comment = document.getElementById('ai-comment').value.trim();
  const count = parseInt(document.querySelector('.btn-ai-count.active').dataset.count);

  if (!themeName) { alert("Donne un nom au thème"); return; }

  const statusEl = document.getElementById('ai-status');
  const previewEl = document.getElementById('ai-preview');
  const btnSave = document.getElementById('btn-save-theme');
  const btnGenerate = document.getElementById('btn-generate');

  statusEl.textContent = "⏳ Génération en cours...";
  btnGenerate.disabled = true;
  previewEl.classList.remove('visible');
  btnSave.style.display = 'none';

  try {
    aiGeneratedWords = await generateWithAI(themeName, comment, count);
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

  // Refresh theme buttons in config (keep current selection + add new theme)
  game.selectedThemes.add(id);
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
