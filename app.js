// ===== BANQUE DE MOTS =====
const WORD_BANK = [
  // Personnalités
  "Albert Einstein", "Beyoncé", "Napoleon", "Cléopâtre", "Mozart",
  "Batman", "Harry Potter", "Mona Lisa", "Astérix", "Zinédine Zidane",
  "Marie Curie", "Bob l'éponge", "Dark Vador", "Pikachu", "Spider-Man",
  "Shakira", "Mbappé", "Gandalf", "James Bond", "Homer Simpson",
  // Objets & Concepts
  "Machine à laver", "Parachute", "Sous-marin", "Pyramide", "Boomerang",
  "Télescope", "Skateboard", "Épouvantail", "Trampoline", "Ascenseur",
  // Actions & Situations
  "Faire du surf", "Marcher sur la Lune", "Gagner au loto", "Rater son bus",
  "Dormir en cours", "Danser la salsa", "Couper un oignon", "Perdre ses clés",
  // Animaux
  "Flamant rose", "Caméléon", "Pingouin", "Kangourou",
  // Lieux
  "Tour Eiffel", "Titanic", "Sahara", "Amazonie",
  // Culture
  "La Joconde", "Game of Thrones", "Tetris", "TikTok"
];

// ===== ÉTAT DU JEU =====
const game = {
  teams: [
    { name: "Équipe 1", score: 0 },
    { name: "Équipe 2", score: 0 }
  ],
  currentTeam: 0,        // 0 ou 1
  currentRound: 0,       // 0, 1, 2
  turnTime: 40,
  numCards: 30,
  deck: [],              // cartes de la manche courante
  currentCardIndex: 0,
  turnScore: 0,
  timerInterval: null,
  timeLeft: 0
};

const ROUNDS = [
  { name: "Manche 1 — Décrivez", icon: "🗣️", desc: "Faites deviner avec autant de mots que vous voulez. Pas le droit de dire le mot !" },
  { name: "Manche 2 — Un seul mot", icon: "☝️", desc: "Un seul mot pour faire deviner. Choisissez bien !" },
  { name: "Manche 3 — Mimez", icon: "🎭", desc: "Mimez sans parler, sans bruit. Que des gestes !" }
];

// ===== NAVIGATION =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== SHUFFLE =====
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== INIT CONFIG =====
document.getElementById('btn-start').addEventListener('click', () => showScreen('screen-config'));

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

// ===== START GAME =====
document.getElementById('btn-play').addEventListener('click', () => {
  game.teams[0].name = document.getElementById('team1-name').value || "Équipe 1";
  game.teams[1].name = document.getElementById('team2-name').value || "Équipe 2";
  game.teams[0].score = 0;
  game.teams[1].score = 0;
  game.currentRound = 0;
  game.currentTeam = 0;

  // Piocher les cartes pour la partie
  const shuffled = shuffle(WORD_BANK);
  game.masterDeck = shuffled.slice(0, game.numCards);

  startRound();
});

// ===== ROUND =====
function startRound() {
  const round = ROUNDS[game.currentRound];
  game.deck = shuffle([...game.masterDeck]);
  game.currentCardIndex = 0;

  document.getElementById('round-title').textContent = round.name;
  document.getElementById('round-icon').textContent = round.icon;
  document.getElementById('round-description').textContent = round.desc;
  document.getElementById('round-team1-name').textContent = game.teams[0].name;
  document.getElementById('round-team2-name').textContent = game.teams[1].name;
  document.getElementById('round-team1-score').textContent = game.teams[0].score;
  document.getElementById('round-team2-score').textContent = game.teams[1].score;

  updateTurnInfo();
  showScreen('screen-round');
}

function updateTurnInfo() {
  document.getElementById('current-team-turn').textContent =
    `🎯 C'est au tour de : ${game.teams[game.currentTeam].name}`;
}

// ===== START TURN =====
document.getElementById('btn-start-turn').addEventListener('click', startTurn);

function startTurn() {
  game.turnScore = 0;
  game.timeLeft = game.turnTime;

  document.getElementById('game-round-label').textContent = ROUNDS[game.currentRound].name.split(' — ')[0];
  document.getElementById('game-team-label').textContent = game.teams[game.currentTeam].name;

  showCard();
  updateTimer();
  showScreen('screen-game');

  game.timerInterval = setInterval(() => {
    game.timeLeft--;
    updateTimer();

    if (game.timeLeft <= 0) {
      endTurn();
    }
  }, 1000);
}

function updateTimer() {
  const el = document.getElementById('timer');
  el.textContent = game.timeLeft;
  el.classList.remove('warning', 'danger');
  if (game.timeLeft <= 5) el.classList.add('danger');
  else if (game.timeLeft <= 10) el.classList.add('warning');
}

function showCard() {
  if (game.currentCardIndex >= game.deck.length) {
    // Plus de cartes → fin de manche
    endRound();
    return;
  }
  document.getElementById('card-word').textContent = game.deck[game.currentCardIndex];
  document.getElementById('cards-left').textContent = game.deck.length - game.currentCardIndex;
}

// ===== FOUND / PASS =====
document.getElementById('btn-found').addEventListener('click', () => {
  game.teams[game.currentTeam].score++;
  game.turnScore++;
  game.currentCardIndex++;
  showCard();
});

document.getElementById('btn-pass').addEventListener('click', () => {
  // Remettre la carte à la fin du deck
  const skippedCard = game.deck[game.currentCardIndex];
  game.deck.push(skippedCard);
  game.currentCardIndex++;
  showCard();
});

// ===== END TURN =====
function endTurn() {
  clearInterval(game.timerInterval);

  document.getElementById('turn-result').textContent =
    `${game.teams[game.currentTeam].name} a trouvé ${game.turnScore} carte(s) !`;

  // Changer d'équipe
  game.currentTeam = game.currentTeam === 0 ? 1 : 0;

  showScreen('screen-turn-end');
}

document.getElementById('btn-next-turn').addEventListener('click', () => {
  if (game.currentCardIndex >= game.deck.length) {
    endRound();
  } else {
    updateTurnInfo();
    showScreen('screen-round');
  }
});

// ===== END ROUND =====
function endRound() {
  clearInterval(game.timerInterval);

  const roundNum = game.currentRound + 1;
  document.getElementById('round-end-title').textContent = `Fin de la manche ${roundNum}`;
  document.getElementById('end-team1-name').textContent = game.teams[0].name;
  document.getElementById('end-team2-name').textContent = game.teams[1].name;
  document.getElementById('end-team1-score').textContent = game.teams[0].score;
  document.getElementById('end-team2-score').textContent = game.teams[1].score;

  const btnNext = document.getElementById('btn-next-round');
  if (game.currentRound >= 2) {
    btnNext.textContent = "Voir les résultats 🏆";
    btnNext.onclick = showFinal;
  } else {
    btnNext.textContent = "Manche suivante ▶️";
    btnNext.onclick = () => {
      game.currentRound++;
      game.currentTeam = 0;
      startRound();
    };
  }

  showScreen('screen-round-end');
}

// ===== FINAL =====
function showFinal() {
  document.getElementById('final-team1-name').textContent = game.teams[0].name;
  document.getElementById('final-team2-name').textContent = game.teams[1].name;
  document.getElementById('final-team1-score').textContent = game.teams[0].score;
  document.getElementById('final-team2-score').textContent = game.teams[1].score;

  const diff = game.teams[0].score - game.teams[1].score;
  let winnerText;
  if (diff > 0) winnerText = `🎉 ${game.teams[0].name} gagne !`;
  else if (diff < 0) winnerText = `🎉 ${game.teams[1].name} gagne !`;
  else winnerText = "🤝 Égalité parfaite !";

  document.getElementById('winner').textContent = winnerText;
  showScreen('screen-final');
}

document.getElementById('btn-restart').addEventListener('click', () => {
  showScreen('screen-home');
});

// ===== QUIT =====
function confirmQuit() {
  if (confirm("Quitter la partie en cours ?")) {
    clearInterval(game.timerInterval);
    showScreen('screen-home');
  }
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
