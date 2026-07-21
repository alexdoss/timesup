// ===== GAME ENGINE =====
// Gère l'état du jeu, le timer, les manches et le score

export const ROUNDS = [
  { id: 'describe', name: "Décrivez", icon: "🗣️", desc: "Faites deviner avec autant de mots que vous voulez. Pas le droit de dire le mot !", optional: false },
  { id: 'one-word', name: "Un seul mot", icon: "☝️", desc: "Un seul mot pour faire deviner. Choisissez bien !", optional: false },
  { id: 'mime', name: "Mimez", icon: "🎭", desc: "Mimez sans parler, sans bruit. Que des gestes !", optional: false },
  { id: 'freeze', name: "Pose figée", icon: "🗿", desc: "Prenez une pose immobile pour faire deviner. Pas le droit de bouger ni de parler !", optional: true },
  { id: 'puppet', name: "Faire bouger un partenaire", icon: "🕺", desc: "Faites bouger un coéquipier comme une marionnette, sans lui parler. Il ne sait pas ce qu'il doit faire deviner !", optional: true }
];

export const game = {
  teams: [
    { name: "Équipe 1", score: 0, players: [], currentPlayerIndex: 0 },
    { name: "Équipe 2", score: 0, players: [], currentPlayerIndex: 0 }
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
  game.deck.push(skippedCard);
  game.currentCardIndex++;
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
