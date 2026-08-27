// ===== GAME ENGINE =====
// Gère l'état du jeu, le timer, les manches et le score

export const ROUNDS = [
  { id: 'describe', name: "Description libre", icon: "💬", desc: "Le joueur parle librement, sans prononcer le mot inscrit sur la carte.", optional: false },
  { id: 'one-word', name: "Un mot", icon: "🔤", desc: "Le joueur ne peut utiliser qu'un seul mot pour faire deviner la carte.", optional: false },
  { id: 'mime', name: "Mime", icon: "🎭", desc: "Le joueur fait deviner la carte uniquement par des gestes, sans parler.", optional: false },
  { id: 'freeze', name: "Pose figée", icon: "🗿", desc: "Le joueur prend une pose immobile pour faire deviner la carte.", optional: true },
  // minPerTeam : un joueur qui manipule, un partenaire qui sert de pantin, au moins un devineur
  { id: 'puppet', name: "Faire bouger un partenaire", icon: "🕺", desc: "Le joueur fait bouger un de ses partenaires sans lui parler.", optional: true, minPerTeam: 3 }
];

export const game = {
  teams: [
    { name: "Équipe 1", score: 0, players: [], currentPlayerIndex: 0, color: "#d6336c" },
    { name: "Équipe 2", score: 0, players: [], currentPlayerIndex: 0, color: "#33c26a" }
  ],
  players: [],             // liste de tous les joueurs
  playerStats: {},         // { playerName: { found: 0, parManche: { <indice de manche>: n } } }
  // Même forme que playerStats, mais pour les parties DÉJÀ terminées de la série
  sessionPlayerStats: {},  // { playerName: { found: 0, parManche: { <indice> : n } } }
  playerAssignments: {},   // { playerName: teamIndex }
  // { playerName: idJoueur } — qui possède un téléphone dans la session, et
  // lequel. C'est ce qui permet de lui confier son tour. Un joueur absent de
  // cette table joue depuis l'appareil de l'organisateur, comme avant.
  playerPhones: {},
  nominativeMode: true,    // true = avec noms de joueurs
  cardSource: 'themes',    // 'themes' | 'custom'
  customCards: [],         // cartes saisies manuellement en mode custom
  selectedThemes: new Set(),
  activeRounds: [0, 1, 2],
  assignMode: 'random',
  startingTeam: 0,         // équipe tirée au sort qui ouvre la partie (les manches suivantes alternent)
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
  turnFound: [],           // cartes comptées pendant le tour, corrigeables à la fin
  turnMissed: [],          // cartes vues mais non comptées (passées, ou à l'écran au buzzer)
  turnTeam: 0,             // équipe qui joue le tour en cours
  turnPlayer: null,        // joueur qui fait deviner (mode nominatif)
  roundStartScores: [0, 0],// scores au début de la manche, pour isoler le score de la manche
  roundHistory: [],        // score de chaque manche terminée, dans l'ordre où elles ont été jouées
  sessionScores: [0, 0],   // total des parties déjà terminées avec les mêmes équipes
  gamesPlayed: 0,          // nombre de parties déjà terminées dans la série en cours
  timerInterval: null,
  timeLeft: 0,
  // Secondes gagnées par l'équipe qui a vidé le paquet avant la fin du temps :
  // elles ouvrent la manche suivante au lieu d'être perdues. Voir reporterLeTempsRestant().
  reportTemps: 0,
  turnDuree: 0,            // durée réelle du tour en cours : un tour reporté est plus court
  turnActive: false,       // un tour est en cours (sert à reprendre une partie interrompue en plein tour)
  // Le tour qui vient de s'achever est encore corrigeable : ses cartes trouvées
  // et passées sont toujours en mémoire. Elles s'effacent au tour suivant, et
  // corriger après un changement de manche imputerait les points à la mauvaise.
  turnCorrigeable: false
};

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// keepSession : conserve le cumul de la série en cours (« Rejouer avec les mêmes joueurs »).
export function resetGame({ keepSession = false } = {}) {
  game.teams[0].score = 0;
  game.teams[1].score = 0;
  game.teams[0].currentPlayerIndex = 0;
  game.teams[1].currentPlayerIndex = 0;
  game.currentRound = 0;
  // Tirage au sort : sans ça l'équipe 1 ouvrait systématiquement la partie
  game.startingTeam = Math.random() < 0.5 ? 0 : 1;
  game.currentTeam = game.startingTeam;
  game.turnActive = false;
  game.turnFound = [];
  game.turnMissed = [];
  game.turnTeam = game.startingTeam;
  game.turnPlayer = null;
  game.roundStartScores = [0, 0];
  game.roundHistory = [];
  game.reportTemps = 0;
  game.turnDuree = 0;
  if (!keepSession) {
    game.sessionScores = [0, 0];
    game.gamesPlayed = 0;
    game.sessionPlayerStats = {};
  }
  // Reset player stats
  game.playerStats = {};
  game.players.forEach(p => {
    game.playerStats[p] = { found: 0, parManche: {} };
  });
}

// Rebat l'ordre de passage à l'intérieur de chaque équipe.
// Sans ça, celui qui ouvre ouvre toujours — il hérite d'un paquet intact, donc
// des mots les plus faciles — et celui qui ferme récupère chaque fois les restes.
function melangerOrdreDesJoueurs() {
  game.teams.forEach(team => {
    if (team.players.length < 2) return;
    const ouvreur = team.players[0];
    const melange = shuffle(team.players);
    // Un tirage peut redonner le même ouvreur : à deux joueurs, une fois sur
    // deux. On le décale, pour que le premier change à coup sûr.
    if (melange[0] === ouvreur) melange.push(melange.shift());
    team.players = melange;
  });
}

// Nouvelle partie avec les mêmes équipes : le score de la partie qui s'achève
// rejoint le cumul de la série, puis tout le reste repart de zéro.
export function replayGame() {
  game.sessionScores = [
    (game.sessionScores[0] || 0) + game.teams[0].score,
    (game.sessionScores[1] || 0) + game.teams[1].score
  ];
  game.gamesPlayed = (game.gamesPlayed || 0) + 1;

  // Même chose joueur par joueur, et manche par manche : resetGame remet
  // playerStats à zéro, donc ce qui a été marqué doit être mis de côté ici,
  // avant l'effacement. Les indices de manche restent comparables d'une partie
  // à l'autre : « Rejouer » reconduit les mêmes réglages, donc les mêmes manches.
  const cumulJoueurs = {};
  const noms = new Set([...Object.keys(game.sessionPlayerStats || {}),
                        ...Object.keys(game.playerStats || {})]);
  noms.forEach(nom => {
    const avant = game.sessionPlayerStats?.[nom] || { found: 0, parManche: {} };
    const partie = game.playerStats?.[nom] || { found: 0, parManche: {} };
    const parManche = { ...(avant.parManche || {}) };
    Object.entries(partie.parManche || {}).forEach(([manche, n]) => {
      parManche[manche] = (parManche[manche] || 0) + n;
    });
    cumulJoueurs[nom] = { found: (avant.found || 0) + (partie.found || 0), parManche };
  });

  // L'équipe qui vient d'ouvrir ne rouvre pas : sur une soirée entière, un
  // tirage au sort finirait par la faire commencer plusieurs fois d'affilée.
  const ouvreurPrecedent = game.startingTeam;
  resetGame({ keepSession: true });
  game.sessionPlayerStats = cumulJoueurs;
  game.startingTeam = 1 - ouvreurPrecedent;
  game.currentTeam = game.startingTeam;
  game.turnTeam = game.startingTeam;

  melangerOrdreDesJoueurs();
}

// Refuse les doublons sans tenir compte de la casse : « Marc » et « marc »
// seraient indistinguables dans les équipes et les statistiques.
export function playerExists(name) {
  const repere = String(name ?? '').trim().toLocaleLowerCase();
  return game.players.some(p => p.toLocaleLowerCase() === repere);
}

export function addPlayer(name) {
  if (name && !playerExists(name)) {
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

// Effectifs prévus par équipe, tels qu'ils seront au lancement de la partie.
// Renvoie null en mode simple : l'app ne connaît pas les effectifs réels.
export function getPlannedTeamSizes() {
  if (!game.nominativeMode) return null;

  const sizes = game.teams.map(() => 0);
  if (game.assignMode === 'chosen') {
    game.players.forEach(player => {
      const chosen = game.playerAssignments[player];
      const safe = Number.isInteger(chosen) && chosen >= 0 && chosen < sizes.length ? chosen : 0;
      sizes[safe]++;
    });
  } else {
    game.players.forEach((_, index) => {
      sizes[index % sizes.length]++;
    });
  }
  return sizes;
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
  if (game.cardSource === 'custom') {
    const shuffled = shuffle([...game.customCards]);
    game.masterDeck = shuffled;
    return;
  }
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
  // Changer de manche ferme la correction : les points iraient à la nouvelle
  game.turnCorrigeable = false;
  game.deck = shuffle([...game.masterDeck]);
  game.currentCardIndex = 0;
  // Repère pour isoler ce qui sera marqué pendant cette manche
  game.roundStartScores = game.teams.map(team => team.score);
}

// Points marqués depuis le début de la manche en cours
export function getRoundScores() {
  return game.teams.map((team, index) => team.score - (game.roundStartScores?.[index] || 0));
}

// Cumul de la série en cours, partie courante comprise
export function getSessionScores() {
  return game.teams.map((team, index) => (game.sessionScores?.[index] || 0) + team.score);
}

// Fige le score de la manche qui s'achève. On écrit à l'indice de la manche
// plutôt que d'ajouter en fin de liste : réafficher l'écran de fin de manche
// (reprise après coupure) réécrit alors la même case au lieu d'en créer une seconde.
export function recordRound() {
  if (!Array.isArray(game.roundHistory)) game.roundHistory = [];
  game.roundHistory[game.currentRound] = getRoundScores();
}

// Les manches déjà jouées, avec leur intitulé : [{ round, scores: [e1, e2] }]
export function getRoundHistory() {
  return (game.roundHistory || [])
    .map((scores, index) => ({
      round: ROUNDS[game.activeRounds[index]],
      scores: scores || [0, 0]
    }))
    .filter(ligne => ligne.round);
}

// Un joueur par ligne, groupés par équipe, avec le détail manche par manche.
// L'ordre suit les équipes : le tableau montre des formations, pas un classement.
//
// Deux échelles, comme pour les équipes : la partie qui s'achève, et la série
// entière (partie courante comprise, sur le modèle de getSessionScores).
// C'est l'affichage qui choisit laquelle montrer.
export function getPlayerBreakdown() {
  const manches = (game.roundHistory || []).length;
  const lignes = [];
  game.teams.forEach((team, indexEquipe) => {
    team.players.forEach(nom => {
      const partie = game.playerStats?.[nom] || {};
      const avant = game.sessionPlayerStats?.[nom] || {};
      const parManche = partie.parManche || {};
      const avantParManche = avant.parManche || {};
      lignes.push({
        name: nom,
        team: indexEquipe,
        perRound: Array.from({ length: manches }, (_, i) => parManche[i] || 0),
        total: partie.found || 0,
        seriePerRound: Array.from({ length: manches },
          (_, i) => (avantParManche[i] || 0) + (parManche[i] || 0)),
        serieTotal: (avant.found || 0) + (partie.found || 0)
      });
    });
  });
  return lignes;
}

export function getCurrentCard() {
  if (game.currentCardIndex >= game.deck.length) return null;
  return game.deck[game.currentCardIndex];
}

// ===== TOUR DE JEU =====
// L'équipe et le joueur du tour sont figés à son ouverture : à la fin du tour
// l'équipe active a déjà changé, et c'est bien celle qui a joué qu'on corrige.

export function beginTurn() {
  game.turnCorrigeable = false;   // le tour précédent n'est plus rattrapable
  game.turnScore = 0;
  game.passCount = 0;
  game.turnFound = [];
  game.turnMissed = [];
  game.turnTeam = game.currentTeam;
  game.turnPlayer = getCurrentPlayer();
  // Une manche ouverte sur un report reprend le temps qui restait, pas un tour
  // plein. Le report ne sert qu'une fois : on le consomme ici.
  game.timeLeft = game.reportTemps > 0 ? game.reportTemps : game.turnTime;
  game.reportTemps = 0;
  // La durée réelle, pour le sablier des invités : un tour reporté est plus
  // court, et son décompte doit partir plein plutôt qu'à moitié entamé.
  game.turnDuree = game.timeLeft;
  game.turnActive = true;
}

// Le paquet s'est vidé avant la fin du temps : l'équipe garde la main sur la
// manche suivante, avec les secondes qu'il lui restait. Aller vite doit
// rapporter quelque chose — sinon le temps gagné est simplement perdu, et
// l'équipe suivante repart avec un tour plein.
//
// Rien à reporter sur la dernière manche : la partie s'achève avec elle.
// Renvoie les secondes reportées, 0 s'il n'y a rien à reporter.
//
// `secondes` n'est fourni que pour un tour joué sur le téléphone d'un joueur :
// c'est lui qui tenait le chrono, et il renvoie ce qu'il restait avec son
// comptage. Sur cet appareil-ci, c'est `game.timeLeft` qui fait foi.
export function reporterLeTempsRestant(secondes = game.timeLeft) {
  const restant = Math.max(0, Math.floor(Number(secondes) || 0));
  if (restant <= 0 || isGameOver()) return 0;
  game.reportTemps = restant;
  return restant;
}

// Clôture du tour : la carte restée à l'écran a été vue, elle est rattrapable,
// et elle retourne dans le paquet. Sans ça, l'équipe suivante héritait toujours
// de celle sur laquelle on venait de sécher — après en avoir entendu toutes les
// descriptions. Elle démarrait donc chaque tour sur la carte la plus dure.
export function closeTurn() {
  game.turnActive = false;
  game.turnCorrigeable = true;
  const carte = getCurrentCard();
  if (!carte) return;
  rememberMissed(carte);
  remettreCarteEnJeu();
}

// Nombre de cartes qui doivent défiler avant qu'une carte remise en jeu au
// hasard puisse réapparaître. À zéro, elle pouvait revenir exactement à sa
// place : le joueur appuyait sur « Passer » et rien ne bougeait.
const ECART_MINIMUM = 2;

// Replace la carte courante dans le paquet, selon le réglage du joueur.
function remettreCarteEnJeu() {
  const carte = game.deck[game.currentCardIndex];
  if (carte === undefined) return;

  if (game.passReplace === 'random') {
    game.deck.splice(game.currentCardIndex, 1);
    placerAuHasard(carte);
  } else {
    // En bas du paquet : l'original reste dans la partie déjà consommée
    game.deck.push(carte);
    game.currentCardIndex++;
  }
}

// Insère une carte quelque part dans ce qu'il reste à jouer, jamais tout de
// suite : l'écart minimum évite qu'elle revienne sous le nez du joueur.
function placerAuHasard(carte) {
  const plusTot = Math.min(game.currentCardIndex + ECART_MINIMUM, game.deck.length);
  const choix = game.deck.length - plusTot + 1;
  game.deck.splice(plusTot + Math.floor(Math.random() * choix), 0, carte);
}

// Une carte qui revient en jeu revient de la même façon, quelle qu'en soit la
// raison — passée pendant le tour, ou décomptée à la correction. Sans ça,
// l'organisateur qui avait choisi « au hasard » voyait ses cartes corrigées
// atterrir en bas du paquet, sans que rien ne l'explique.
function remettreEnJeu(carte) {
  if (game.passReplace === 'random') placerAuHasard(carte);
  else game.deck.push(carte);
}

// Crée la fiche à la volée : en saisie partagée les joueurs arrivent après
// resetGame, et une partie sauvegardée avant cette version n'a pas de parManche.
function statsDe(nom) {
  let stats = game.playerStats[nom];
  if (!stats) {
    stats = { found: 0, parManche: {} };
    game.playerStats[nom] = stats;
  }
  if (!stats.parManche) stats.parManche = {};
  return stats;
}

function creditTurn(word) {
  game.teams[game.turnTeam].score++;
  game.turnScore++;
  if (game.turnPlayer) {
    const stats = statsDe(game.turnPlayer);
    stats.found++;
    stats.parManche[game.currentRound] = (stats.parManche[game.currentRound] || 0) + 1;
  }
  game.turnFound.push(word);
}

function debitTurn() {
  const team = game.teams[game.turnTeam];
  if (team) team.score = Math.max(0, team.score - 1);
  game.turnScore = Math.max(0, game.turnScore - 1);
  if (game.turnPlayer) {
    const stats = statsDe(game.turnPlayer);
    stats.found = Math.max(0, stats.found - 1);
    stats.parManche[game.currentRound] = Math.max(0, (stats.parManche[game.currentRound] || 0) - 1);
  }
}

function rememberMissed(word) {
  if (!word) return;
  if (game.turnMissed.includes(word) || game.turnFound.includes(word)) return;
  game.turnMissed.push(word);
}

// Retire une carte de ce qu'il reste à jouer, sans toucher à l'historique déjà consommé.
function removeFromDeck(word) {
  const position = game.deck.indexOf(word, game.currentCardIndex);
  if (position !== -1) game.deck.splice(position, 1);
}

export function cardFound() {
  creditTurn(game.deck[game.currentCardIndex]);
  game.currentCardIndex++;
}

// Correction en fin de tour — le paquet suit toujours la vérité :
// une carte décomptée redevient à jouer, une carte rattrapée en sort.
export function uncountCard(word) {
  const position = game.turnFound.indexOf(word);
  if (position === -1) return false;
  game.turnFound.splice(position, 1);
  debitTurn();
  game.turnMissed.push(word);
  remettreEnJeu(word);
  return true;
}

export function countCard(word) {
  const position = game.turnMissed.indexOf(word);
  if (position === -1) return false;
  game.turnMissed.splice(position, 1);
  creditTurn(word);
  removeFromDeck(word);
  return true;
}

// Le tour a été joué sur le téléphone d'un joueur. On le rejoue ici, carte par
// carte, pour que l'état de la partie reste tenu à un seul endroit : le paquet,
// les scores et les statistiques suivent le même chemin que pour un tour local.
export function appliquerTourDistant(trouvees) {
  beginTurn();
  (trouvees || []).forEach(mot => {
    const position = game.deck.indexOf(mot, game.currentCardIndex);
    // Carte inconnue ou déjà consommée : on n'invente pas de point.
    if (position === -1) return;
    // On l'amène devant avant de la compter. L'ordre du paquet d'ici n'est pas
    // celui qu'avait le joueur — il a pu passer des cartes, qui repartent au
    // fond de son exemplaire à lui.
    game.deck.splice(position, 1);
    game.deck.splice(game.currentCardIndex, 0, mot);
    cardFound();
  });
  closeTurn();
  // La correction a déjà eu lieu sur le téléphone du joueur : la reproposer
  // ici reviendrait à rouvrir un comptage déjà arbitré.
  game.turnCorrigeable = false;
}

export function cardPassed() {
  rememberMissed(game.deck[game.currentCardIndex]);
  remettreCarteEnJeu();
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
  // On ne touche pas à l'équipe active : la rotation continue par-dessus le
  // changement de manche. Ouvrir une manche est un avantage, il ne doit pas
  // revenir toujours à la même équipe. Le tour qui vient de s'achever a déjà
  // passé la main à l'équipe suivante.
}

export function getCardsRemaining() {
  return game.deck.length - game.currentCardIndex;
}

export function getActiveRound() {
  return ROUNDS[game.activeRounds[game.currentRound]];
}
