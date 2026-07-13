// ===== APP — Point d'entrée =====
// Orchestre les modules et gère les événements

import { loadThemes } from './themes.js';
import { game, ROUNDS, resetGame, buildDeck, startNewRound, getCurrentCard, cardFound, cardPassed, switchTeam, isRoundOver, isGameOver, nextRound, getCardsRemaining } from './game.js';
import { showScreen, updateTimer, showCard, updateRoundScreen, updateTurnInfo, updateGameHeader, showTurnResult, showRoundEnd, showFinalScreen, renderThemeButtons } from './ui.js';

let THEMES = {};

// ===== INIT =====
async function init() {
  THEMES = await loadThemes();
  game.selectedThemes = new Set(Object.keys(THEMES));

  // Render theme buttons
  const container = document.getElementById('theme-selector');
  renderThemeButtons(THEMES, game.selectedThemes, container);

  // Setup event listeners
  setupListeners();
}

function setupListeners() {
  // Home → Themes (step 1)
  document.getElementById('btn-start').addEventListener('click', () => showScreen('screen-themes'));

  // Themes → Config (step 2)
  document.getElementById('btn-next-step').addEventListener('click', () => {
    if (game.selectedThemes.size === 0) {
      alert("Sélectionne au moins un thème !");
      return;
    }
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
  showTurnResult(game.teams[game.currentTeam].name, game.turnScore);
  switchTeam();
  showScreen('screen-turn-end');
}

function onNextTurn() {
  if (isRoundOver()) {
    endRound();
  } else {
    updateTurnInfo(game.teams[game.currentTeam].name);
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
