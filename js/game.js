// ===== GAME ENGINE =====
// Gère l'état du jeu, le timer, les manches et le score

export const ROUNDS = [
  { id: 'describe', name: "Description libre", icon: "💬", desc: "Le joueur parle librement, sans prononcer le mot inscrit sur la carte.", optional: false },
  { id: 'one-word', name: "Un mot", icon: "🔤", desc: "Le joueur ne peut utiliser qu'un seul mot pour faire deviner la carte.", optional: false },
  { id: 'mime', name: "Mime", icon: "🎭", desc: "Le joueur fait deviner la carte uniquement par des gestes, sans parler.", optional: false },
  { id: 'freeze', name: "Pose figée", icon: "🗿", desc: "Le joueur prend une pose immobile pour faire deviner la carte.", optional: true },
  { id: 'puppet', name: "Faire bouger un partenaire", icon: "🕺", desc: "Le joueur fait bouger un de ses partenaires sans lui parler.", optional: true }
];

export const game = {
  teams: [
    { name: "Équipe 1", score: 0, players: [], currentPlayerIndex: 0, color: "#d6336c" },
    { name: "Équipe 2", score: 0, players: [], currentPlayerIndex: 0, color: "#33c26a" }
  ],
  players: [],             // liste de tous les joueurs
  playerStats: {},         // { playerName: { found: 0 } }
  playerAssignments: {},   // { playerName: teamIndex }
  nominativeMode: false,   // true = avec noms de joueurs
  selectedThemes: new Set(),
  activeRounds: [0, 1, 2],
  assignMode: 'random',
  currentTeam: 0,
  currentRound: 0,
  turnTime: 40,
  numCards: 30,
  passMode: 'unlimited',   // 'unlimited' | 'limited' | 'forbidden'
  passLimit: 2,            // max passes par tour (si limited)
  passReplace: 'bottom',   // 'bottom' | 'random'
  passCount: 0,            // compteur de passes dans le tour en cours
  masterDeck: [],
  deck: [],
  currentCardIndex: 0,
  turnScore: 0,
  timerInterval: null,
  timeLeft: 0
};

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function resetGame() {
  game.teams[0].score = 0;
  game.teams[1].score = 0;
  game.teams[0].currentPlayerIndex = 0;
  game.teams[1].currentPlayerIndex = 0;
  game.currentRound = 0;
  game.currentTeam = 0;
  // Reset player stats
  game.playerStats = {};
  game.players.forEach(p => {
    game.playerStats[p] = { found: 0 };
  });
}

export function addPlayer(name) {
  if (name && !game.players.includes(name)) {
    game.players.push(name);
    game.playerAssignments[name] = game.players.length % game.teams.length === 0 ? 1 : 0;
    return true;
  }
  return false;
}

export function removePlayer(name) {
  game.players = game.players.filter(p => p !== name);
  delete game.playerAssignments[name];
  game.teams.forEach(team => {
    team.players = team.players.filter(player => player !== name);
  });
}

export function assignTeamsRoundRobin() {
  game.teams.forEach(team => {
    team.players = [];
    team.currentPlayerIndex = 0;
  });
  game.players.forEach((player, index) => {
    game.teams[index % game.teams.length].players.push(player);
  });
}

export function shuffleTeams() {
  assignTeamsRoundRobin();
}

export function setPlayerTeam(playerName, teamIndex) {
  if (!game.players.includes(playerName)) return;
  const safeTeamIndex = Math.max(0, Math.min(game.teams.length - 1, parseInt(teamIndex, 10) || 0));
  game.playerAssignments[playerName] = safeTeamIndex;
}

export function syncChosenTeams() {
  game.teams.forEach(team => {
    team.players = [];
    team.currentPlayerIndex = 0;
  });
  game.players.forEach(player => {
    const chosenTeam = game.playerAssignments[player];
    const safeTeamIndex = Number.isInteger(chosenTeam) && chosenTeam >= 0 && chosenTeam < game.teams.length
      ? chosenTeam
      : 0;
    game.teams[safeTeamIndex].players.push(player);
  });
}

export function getCurrentPlayer() {
  const team = game.teams[game.currentTeam];
  if (team.players.length === 0) return null;
  return team.players[team.currentPlayerIndex % team.players.length];
}

export function advancePlayer() {
  const team = game.teams[game.currentTeam];
  if (team.players.length === 0) return;
  team.currentPlayerIndex = (team.currentPlayerIndex + 1) % team.players.length;
}

export function buildDeck(themes) {
  let wordPool = [];
  game.selectedThemes.forEach(key => {
    if (themes[key]) {
      wordPool = wordPool.concat(themes[key].words);
    }
  });
  const shuffled = shuffle(wordPool);
  game.masterDeck = shuffled.slice(0, Math.min(game.numCards, shuffled.length));
}

export function startNewRound() {
  game.deck = shuffle([...game.masterDeck]);
  game.currentCardIndex = 0;
}

export function getCurrentCard() {
  if (game.currentCardIndex >= game.deck.length) return null;
  return game.deck[game.currentCardIndex];
}

export function cardFound() {
  game.teams[game.currentTeam].score++;
  game.turnScore++;
  // Track player stats
  const player = getCurrentPlayer();
  if (player && game.playerStats[player]) {
    game.playerStats[player].found++;
  }
  game.currentCardIndex++;
}

export function cardPassed() {
  const skippedCard = game.deck[game.currentCardIndex];
  if (game.passReplace === 'random') {
    // Remove card and insert at random position after currentCardIndex
    game.deck.splice(game.currentCardIndex, 1);
    const minPos = game.currentCardIndex;
    const insertPos = minPos + Math.floor(Math.random() * (game.deck.length - minPos + 1));
    game.deck.splice(insertPos, 0, skippedCard);
  } else {
    // bottom: push to end
    game.deck.push(skippedCard);
    game.currentCardIndex++;
  }
  game.passCount++;
}

export function canPass() {
  if (game.passMode === 'forbidden') return false;
  if (game.passMode === 'limited' && game.passCount >= game.passLimit) return false;
  return true;
}

export function switchTeam() {
  game.currentTeam = game.currentTeam === 0 ? 1 : 0;
}

export function isRoundOver() {
  return game.currentCardIndex >= game.deck.length;
}

export function isGameOver() {
  return game.currentRound >= game.activeRounds.length - 1;
}

export function nextRound() {
  game.currentRound++;
  game.currentTeam = 0;
}

export function getCardsRemaining() {
  return game.deck.length - game.currentCardIndex;
}

export function getActiveRound() {
  return ROUNDS[game.activeRounds[game.currentRound]];
}
