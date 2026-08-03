// ===== APP — Point d'entrée =====
// Orchestre les modules et gère les événements

import { loadThemes } from './themes.js';
import { game, ROUNDS, resetGame, buildDeck, startNewRound, getCurrentCard, cardFound, cardPassed, switchTeam, isRoundOver, isGameOver, nextRound, getCardsRemaining, addPlayer, removePlayer, assignTeamsRoundRobin, getCurrentPlayer, advancePlayer, getActiveRound, setPlayerTeam, syncChosenTeams, canPass, getPlannedTeamSizes } from './game.js';
import { showScreen, updateTimer, showCard, updateRoundScreen, updateTurnInfo, updateGameHeader, showTurnResult, showRoundEnd, showFinalScreen, renderThemeButtons, renderPlayerList, updateCurrentPlayer, renderPlayerStats, renderRoundsSelector, renderAssignMode, applyTeamAccent, showResumeOption, renderSoundSetting, renderRules, showPauseOverlay, showPauseCountdown, hidePause, showPuppetConfirm, setRoundsNextEnabled, renderThemeEditor, showThemeEditError, renderCustomThemes } from './ui.js';
import { getCustomThemes, saveCustomTheme, deleteCustomTheme, generateWithAI, getQuota } from './library.js';
import { saveGame, loadSavedGame, clearSavedGame, restoreInto } from './persistence.js';
import { playTick, playBuzzer, unlockAudio, isSoundEnabled, setSoundEnabled } from './sound.js';

let THEMES = {};
let aiGeneratedWords = [];
let pendingResume = null;
let resumeCountdown = null;
let settingsReturn = 'home';   // d'où on a ouvert les paramètres, pour savoir où revenir
let pausedAuto = false;        // la pause en cours vient-elle d'un passage en arrière-plan
let puppetAnswer = null;       // réponse à la question d'effectif en mode simple (null / true / false)
let editingThemeId = null;     // thème maison ouvert dans la fiche d'édition

// ===== INIT =====
async function init() {
  THEMES = await loadThemes();

  // Merge custom themes from localStorage
  const customThemes = getCustomThemes();
  Object.assign(THEMES, customThemes);

  game.selectedThemes = new Set();

  const container = document.getElementById('theme-selector');
  renderThemeButtons(THEMES, game.selectedThemes, container);

  refreshResumeOption();
  renderFeedbackSettings();
  setupListeners();
}

// ===== REPRISE DE PARTIE =====
function refreshResumeOption() {
  pendingResume = loadSavedGame();
  showResumeOption(pendingResume ? describeSavedGame(pendingResume) : null);
}

// Résumé affiché sous le bouton « Reprendre la partie », sur deux lignes :
//   Manche 1 sur 3 · tour en cours, 30 s restantes
//   Équipe 1 : 2  —  Équipe 2 : 0
function describeSavedGame(snapshot) {
  const s = snapshot.state;
  const tour = s.turnActive && s.timeLeft > 0
    ? ` · tour en cours, ${s.timeLeft} s restante${s.timeLeft > 1 ? 's' : ''}`
    : '';
  const situation = `Manche ${s.currentRound + 1} sur ${s.activeRounds.length}${tour}`;
  const score = `${s.teams[0].name} : ${s.teams[0].score}  —  ${s.teams[1].name} : ${s.teams[1].score}`;
  return `${situation}\n${score}`;
}

function resumeGame() {
  if (!pendingResume) return;
  restoreInto(game, pendingResume);
  pendingResume = null;
  showResumeOption(null);

  if (game.turnActive && game.timeLeft > 0 && getCurrentCard()) {
    // Interruption en plein tour : on réaffiche le jeu figé, puis on repasse par le sas 3·2·1
    renderTurn();
    startResumeCountdown();
  } else if (isRoundOver()) {
    // Le paquet était épuisé : on reprend à l'écran de fin de manche
    endRound();
  } else {
    showRoundScreen();
  }
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
  puppetAnswer = null;
  renderRoundsSelector(ROUNDS, game.activeRounds, getPlannedTeamSizes(), onRoundToggle);
  refreshPuppetGate();
  showScreen('screen-rounds');
}

// Manches optionnelles sélectionnées qui exigent un effectif minimum par équipe
function selectedRoundsWithMinimum() {
  return [...document.querySelectorAll('#rounds-optional .round-pill.active')]
    .filter(pill => ROUNDS[parseInt(pill.dataset.roundIndex, 10)]?.minPerTeam);
}

// En mode simple, l'app ignore les effectifs : il faut demander à l'utilisateur.
function needsPuppetConfirm() {
  if (getPlannedTeamSizes() !== null) return false;
  return selectedRoundsWithMinimum().length > 0;
}

function refreshPuppetGate() {
  const besoin = needsPuppetConfirm();
  showPuppetConfirm(besoin, puppetAnswer);
  setRoundsNextEnabled(!besoin || puppetAnswer === true);
}

function onRoundToggle() {
  if (!needsPuppetConfirm()) puppetAnswer = null;
  refreshPuppetGate();
}

function collectActiveRounds() {
  // Mandatory rounds (always 0,1,2)
  const mandatory = [0, 1, 2];
  // Optional rounds from active pills
  const optional = [...document.querySelectorAll('#rounds-optional .round-pill.active')]
    .map(pill => parseInt(pill.dataset.roundIndex, 10));

  const selected = [...mandatory, ...optional].sort((a, b) => a - b);

  // Filet de sécurité : une manche à effectif minimum ne passe jamais si l'effectif est connu et insuffisant
  const sizes = getPlannedTeamSizes();
  const plusPetiteEquipe = sizes ? Math.min(...sizes) : null;
  game.activeRounds = selected.filter(index => {
    const round = ROUNDS[index];
    return !(round.minPerTeam && plusPetiteEquipe !== null && plusPetiteEquipe < round.minPerTeam);
  });
}

function setupListeners() {
  // Home → Mode (step 1)
  document.getElementById('btn-start').addEventListener('click', () => showScreen('screen-mode'));

  // Reprendre une partie interrompue
  document.getElementById('btn-resume').addEventListener('click', resumeGame);

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

  // Confirmation d'effectif pour les manches qui l'exigent (mode simple)
  document.querySelectorAll('[data-puppet]').forEach(pill => {
    pill.addEventListener('click', () => {
      if (pill.dataset.puppet === 'oui') {
        puppetAnswer = true;
      } else {
        // Non : on désélectionne la manche, sinon l'utilisateur reste bloqué sans issue visible
        selectedRoundsWithMinimum().forEach(p => p.classList.remove('active'));
        puppetAnswer = null;
      }
      refreshPuppetGate();
    });
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

  // Son : préférence mémorisée d'une partie à l'autre. La vibration l'accompagne
  // toujours, sans réglage : elle n'existe pas sur iOS et un bouton sans effet
  // sur la moitié des téléphones embrouille plus qu'il n'aide.
  document.querySelectorAll('[data-sound]').forEach(pill => {
    pill.addEventListener('click', () => {
      const on = pill.dataset.sound === 'on';
      setSoundEnabled(on);
      renderSoundSetting(on);
      if (on) unlockAudio();
    });
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

  // Pause
  document.getElementById('btn-pause').addEventListener('click', () => pauseTurn(false));
  document.addEventListener('visibilitychange', onAppHidden);
  document.getElementById('btn-resume-turn').addEventListener('click', startResumeCountdown);
  document.getElementById('btn-quit-game').addEventListener('click', quitToHome);
  document.getElementById('btn-abandon-game').addEventListener('click', abandonGame);

  // Paramètres — accessibles depuis l'accueil et depuis la pause
  document.getElementById('btn-settings').addEventListener('click', () => openSettings('home'));
  document.getElementById('btn-pause-settings').addEventListener('click', () => openSettings('pause'));
  document.getElementById('btn-settings-back').addEventListener('click', closeSettings);

  // Next turn
  document.getElementById('btn-next-turn').addEventListener('click', onNextTurn);

  // Restart
  document.getElementById('btn-restart').addEventListener('click', () => {
    refreshResumeOption();
    showScreen('screen-home');
  });

  // ===== RÈGLES DU JEU =====
  document.getElementById('btn-rules').addEventListener('click', () => {
    renderRules(ROUNDS);
    showScreen('screen-rules');
  });

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
    refreshQuotaDisplay();
    showScreen('screen-ai-create');
  });

  // Création d'un thème entièrement manuel
  document.getElementById('btn-create-manual').addEventListener('click', () => {
    document.getElementById('manual-theme-name').value = '';
    document.getElementById('manual-theme-error').textContent = '';
    showScreen('screen-manual-create');
  });
  document.getElementById('btn-manual-create').addEventListener('click', createManualTheme);
  document.getElementById('manual-theme-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createManualTheme();
  });

  // Fiche d'un thème maison
  document.getElementById('btn-add-theme-card').addEventListener('click', addThemeCard);
  document.getElementById('theme-card-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addThemeCard();
  });
  document.getElementById('btn-theme-back').addEventListener('click', closeThemeEditor);
  document.getElementById('btn-theme-done').addEventListener('click', closeThemeEditor);

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
  const header = document.getElementById('custom-input-header');
  if (header) header.textContent = label;
  const sizeLabel = document.getElementById('batch-size-label');
  if (sizeLabel) sizeLabel.textContent = customEntry.batchSize;
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
  saveGame(game);
  showRoundScreen();
}

// Affiche l'écran de début de tour sans toucher au paquet (utilisé aussi à la reprise)
function showRoundScreen() {
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
  game.turnActive = true;
  unlockAudio();   // le clic sur « Lancer le tour » est le geste qui autorise l'audio
  saveGame(game);
  runTurn();
}

// Affiche l'écran de jeu dans son état courant, sans lancer le chrono.
function renderTurn() {
  const round = getActiveRound();
  applyTeamAccent(game.teams[game.currentTeam].color);
  updateGameHeader(`${getRoundLabel()} · ${round.name}`, game.teams[game.currentTeam].name);
  displayCurrentCard();
  updatePassButton();
  updateTimer(game.timeLeft);
  showScreen('screen-game');
}

// Affiche le tour et lance le chrono.
function runTurn() {
  renderTurn();
  stopTimer();
  game.timerInterval = setInterval(() => {
    game.timeLeft--;
    updateTimer(game.timeLeft);
    saveGame(game);   // le chrono est figé à la seconde près si l'app se ferme
    if (game.timeLeft <= 0) {
      playBuzzer();
      endTurn();
    } else if (game.timeLeft <= 5) {
      playTick();
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
  saveGame(game);
  displayCurrentCard();
}

function onPass() {
  if (!canPass()) return;
  cardPassed();
  saveGame(game);
  updatePassButton();
  displayCurrentCard();
}

function updatePassButton() {
  const btn = document.getElementById('btn-pass');
  const allowed = canPass();
  btn.disabled = !allowed;
  btn.style.opacity = allowed ? '1' : '0.35';
}

// ===== PARAMÈTRES =====
// Réglages de l'appareil, valables pour toutes les parties : ils ne font pas
// partie de la configuration d'une partie et sont accessibles à tout moment.
function renderFeedbackSettings() {
  renderSoundSetting(isSoundEnabled());
}

function openSettings(from) {
  settingsReturn = from;
  renderFeedbackSettings();
  showScreen('screen-settings');
}

function closeSettings() {
  if (settingsReturn === 'pause') {
    // On retourne au jeu, toujours en pause, avec le même motif qu'avant le détour
    showScreen('screen-game');
    showPause(pausedAuto);
  } else {
    showScreen('screen-home');
  }
}

// ===== PAUSE =====
// Le chrono est gelé et le jeu passe sous un voile flouté : la carte n'est plus lisible.

function stopTimer() {
  clearInterval(game.timerInterval);
  game.timerInterval = null;
}

function isTurnRunning() {
  return game.turnActive && game.timerInterval !== null;
}

function showPause(auto) {
  pausedAuto = auto;
  const titre = auto ? '⏸ Mise en pause automatique' : '⏸ Pause';
  const info = auto
    ? `L'application a été quittée — le chrono s'est arrêté à ${game.timeLeft} s.`
    : `${getRoundLabel()} · il reste ${game.timeLeft} s`;
  showPauseOverlay(titre, info, game.teams);
}

function pauseTurn(auto = false) {
  if (!isTurnRunning()) return;
  stopTimer();
  saveGame(game);
  showPause(auto);
}

// Écran verrouillé, appel entrant, changement d'application : le navigateur gèlerait
// le chrono de façon imprévisible. On met la partie en pause franchement, et on le dit.
function onAppHidden() {
  if (!document.hidden) return;

  if (resumeCountdown) {
    // Interruption pendant le décompte de reprise : retour au panneau de pause
    clearInterval(resumeCountdown);
    resumeCountdown = null;
    showPause(true);
    return;
  }

  pauseTurn(true);
}

// Sas de reprise : 3 · 2 · 1 avant que le chrono reparte, le temps que le joueur
// retrouve ses esprits. La carte reste floutée jusqu'au départ.
function startResumeCountdown() {
  clearInterval(resumeCountdown);
  let n = 3;
  showPauseCountdown(n);
  playTick();

  resumeCountdown = setInterval(() => {
    n--;
    if (n > 0) {
      showPauseCountdown(n);
      playTick();
    } else {
      clearInterval(resumeCountdown);
      resumeCountdown = null;
      hidePause();
      runTurn();
    }
  }, 1000);
}

// Quitter sans rien perdre : la partie reste proposée à la reprise depuis l'accueil.
function quitToHome() {
  stopTimer();
  clearInterval(resumeCountdown);
  resumeCountdown = null;
  hidePause();
  saveGame(game);
  refreshResumeOption();
  showScreen('screen-home');
}

// Arrêter pour de bon : la partie est effacée, rien ne sera proposé à l'accueil.
function abandonGame() {
  if (!confirm("Abandonner la partie ? Les scores seront perdus.")) return;
  stopTimer();
  clearInterval(resumeCountdown);
  resumeCountdown = null;
  hidePause();
  game.turnActive = false;
  clearSavedGame();
  refreshResumeOption();
  showScreen('screen-home');
}

function endTurn() {
  stopTimer();
  game.turnActive = false;
  if (game.nominativeMode) {
    const player = getCurrentPlayer();
    showTurnResult(`${player} (${game.teams[game.currentTeam].name})`, game.turnScore);
    advancePlayer();
  } else {
    showTurnResult(game.teams[game.currentTeam].name, game.turnScore);
  }
  switchTeam();
  saveGame(game);
  showScreen('screen-turn-end');
}

function onNextTurn() {
  if (isRoundOver()) {
    endRound();
  } else {
    showRoundScreen();
  }
}

function endRound() {
  stopTimer();
  game.turnActive = false;
  saveGame(game);
  showRoundEnd(`${game.currentRound + 1}/${game.activeRounds.length}`, game.teams);

  const btnNext = document.getElementById('btn-next-round');
  if (isGameOver()) {
    btnNext.textContent = "Voir les résultats 🏆";
    btnNext.onclick = () => {
      clearSavedGame();
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
function refreshThemeSelector() {
  renderThemeButtons(THEMES, game.selectedThemes, document.getElementById('theme-selector'));
}

function renderCustomThemesList() {
  renderCustomThemes(getCustomThemes(), openThemeEditor, confirmDeleteTheme);
}

function confirmDeleteTheme(id) {
  const themes = getCustomThemes();
  if (!themes[id]) return;
  if (!confirm(`Supprimer le thème "${themes[id].name}" et toutes ses cartes ?`)) return;

  deleteCustomTheme(id);
  delete THEMES[id];
  game.selectedThemes.delete(id);   // sinon le thème resterait coché et amputerait le paquet
  refreshThemeSelector();
  renderCustomThemesList();
}

// Crée un thème vide puis enchaîne directement sur sa fiche, où on ajoute les cartes.
// L'icône ✍️ le distingue des thèmes générés par l'IA (✨) dans la sélection.
function createManualTheme() {
  const champ = document.getElementById('manual-theme-name');
  const erreur = document.getElementById('manual-theme-error');
  const nom = champ.value.trim();

  if (nom.length < 2) {
    erreur.textContent = 'Donne un nom d’au moins 2 caractères.';
    return;
  }

  const id = 'manual_' + Date.now();
  const theme = { id, name: nom, icon: '✍️', words: [] };
  saveCustomTheme(id, theme);
  THEMES[id] = theme;
  refreshThemeSelector();
  erreur.textContent = '';
  openThemeEditor(id);
}

// ===== FICHE D'UN THÈME MAISON =====
function openThemeEditor(id) {
  const themes = getCustomThemes();
  if (!themes[id]) return;
  editingThemeId = id;
  showThemeEditError('');
  document.getElementById('theme-card-input').value = '';
  renderThemeEditor(themes[id], removeThemeCard);
  showScreen('screen-theme-edit');
}

// Rien à sauvegarder ici : chaque ajout et chaque suppression est déjà écrit.
// Le bouton « Terminer » et la flèche retour font donc exactement la même chose.
function closeThemeEditor() {
  editingThemeId = null;
  renderCustomThemesList();
  showScreen('screen-library');
}

function currentEditedTheme() {
  return getCustomThemes()[editingThemeId] || null;
}

function persistEditedTheme(theme) {
  saveCustomTheme(editingThemeId, theme);
  THEMES[editingThemeId] = theme;
  refreshThemeSelector();
  renderThemeEditor(theme, removeThemeCard);
}

function addThemeCard() {
  const input = document.getElementById('theme-card-input');
  const brut = input.value.trim();
  const theme = currentEditedTheme();
  if (!theme) return;

  if (brut.length < 2) {
    showThemeEditError('Une carte doit faire au moins 2 caractères.');
    return;
  }
  const normalise = brut.toLocaleLowerCase();
  if (theme.words.some(mot => mot.toLocaleLowerCase() === normalise)) {
    showThemeEditError('Cette carte est déjà dans le thème.');
    return;
  }

  theme.words.push(brut);
  persistEditedTheme(theme);
  showThemeEditError('');
  input.value = '';
  input.focus();
}

function removeThemeCard(index) {
  const theme = currentEditedTheme();
  if (!theme) return;
  theme.words.splice(index, 1);
  persistEditedTheme(theme);
  showThemeEditError('');
}

// ===== QUOTA DE GÉNÉRATION IA =====
function refreshQuotaDisplay() {
  const quota = getQuota();
  const ligne = document.getElementById('ai-quota');
  if (ligne) {
    ligne.textContent = quota.restant > 0
      ? `${quota.restant} génération(s) restante(s) aujourd'hui, sur ${quota.max}.`
      : `Limite atteinte : ${quota.max} générations par jour. Réessaie demain.`;
  }
  const bouton = document.getElementById('btn-generate');
  if (bouton) bouton.disabled = quota.restant <= 0;
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
    refreshQuotaDisplay();   // remet le bouton dans le bon état et met le compteur à jour
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
  refreshThemeSelector();

  alert(`Thème "${themeName}" sauvegardé ! Il apparaîtra dans la sélection de thèmes.`);
  showScreen('screen-library');
  renderCustomThemesList();
}

// ===== QUIT (global for HTML onclick) =====
window.confirmQuit = function() {
  if (confirm("Quitter la partie ? Tu pourras la reprendre depuis l'accueil.")) {
    quitToHome();
  }
};

window.showScreen = showScreen;

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ===== LAUNCH =====
init();
