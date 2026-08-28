// ===== APP — Point d'entrée =====
// Orchestre les modules et gère les événements

import { loadThemes } from './themes.js';
import { game, ROUNDS, shuffle, resetGame, replayGame, buildDeck, startNewRound, getCurrentCard, cardFound, cardPassed, switchTeam, isRoundOver, isGameOver, nextRound, getCardsRemaining, addPlayer, removePlayer, assignTeamsRoundRobin, getCurrentPlayer, advancePlayer, getActiveRound, syncChosenTeams, canPass, getPlannedTeamSizes, beginTurn, closeTurn, reporterLeTempsRestant, uncountCard, countCard, getRoundScores, getSessionScores, playerExists, recordRound, getRoundHistory, getPlayerBreakdown, appliquerTourDistant } from './game.js';
import { showScreen, updateTimer, showCard, updateRoundScreen, updateTurnInfo, updateGameHeader, showTurnResult, showRoundEnd, showFinalScreen, renderThemeButtons, renderPlayerList, updateCurrentPlayer, renderPlayerStats, renderRoundsSelector, applyTeamAccent, showResumeOption, renderSoundSetting, renderRules, showPauseOverlay, showPauseCountdown, hidePause, showPuppetConfirm, setRoundsNextEnabled, renderThemeEditor, showThemeEditError, renderCustomThemes, showDialog,
         afficherInvitation, afficherPartageSuivi, afficherInscription, renderInscrits,
         renderSession, renderBoutonMesCartes, renderSaisieLocale,
         showSaisieError, renderRepartition,
         afficherEquipes, masquerEquipes, afficherBoutonEquipes, showChoices } from './ui.js';
import { activerSuivi, couperSuivi, publierEtat, reprendreVersion, sessionSuivie } from './suivi.js';
import { ouvrirSession, ouvrirSuiviSeul, ouvrirInscription, sessionCourante, oublierSession,
         adresseInvitation, adresseLisible,
         inscrire, deposerCartes, retirerJoueur, fermerSession, relancerSession, lireEtat,
         confierTour, lireTour, reprendreTour, suivreEtat,
         suivre, arreterSuivi, reprendreSession } from './session.js';
import { creerQrSvg } from './qr.js';
import { creerSablier, svgSablier } from './sablier.js';
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
let turnEndTitle = '';         // titre du récapitulatif de tour (temps écoulé / plus de cartes)
let turnEndLabel = '';         // qui vient de jouer, conservé pour les re-rendus après correction
let editingThemeId = null;     // thème maison ouvert dans la fiche d'édition
let saisieMode = 'partagee';   // 'partagee' (QR) ou 'sequentielle' (on se passe le téléphone)
let moiJoueur = null;          // l'organisateur, inscrit dans sa propre session
let saisieLocale = null;       // saisie en cours sur cet appareil (organisateur ou joueur sans téléphone)
let repartition = [];          // joueurs revenus de la session, pour l'écran des équipes
let joueursAttendus = 6;       // prévision d'effectif, pour dimensionner le paquet
let modeRejeu = false;         // session ouverte pour rejouer : équipes et réglages déjà faits
let listeJoueurs = [];         // liste fermée des joueurs attendus, en cas de rejeu
let rejeuThemes = false;       // rejeu d'une partie à thèmes : on revient choisir le paquet
let inscriptionRefusee = false;// l'organisateur préfère taper les prénoms lui-même

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

// Remet l'assistant en accord avec l'état réel avant chaque nouvelle partie.
// Sans ça, une partie reprise puis abandonnée laisse ses réglages dans `game`
// pendant que les écrans affichent encore autre chose : on croit choisir des
// thèmes prédéfinis et on se retrouve sur la saisie partagée.
function preparerNouvellePartie() {
  // Aucune tuile n'est pré-sélectionnée : choisir, c'est avancer. Une tuile
  // déjà allumée laisserait croire qu'il reste quelque chose à valider.
  document.querySelectorAll('[data-source]').forEach(tuile => tuile.classList.remove('active'));
  document.querySelectorAll('[data-mode]').forEach(tuile => tuile.classList.remove('active'));

  saisieMode = 'partagee';
  repartition = [];
  moiJoueur = null;
  modeRejeu = false;
  listeJoueurs = [];
  inscriptionRefusee = false;
  // L'écran des thèmes redevient une étape de l'assistant : sans ça, un rejeu
  // quitté par la croix laisserait « C'est parti » à la place de « Suivant ».
  quitterLeRejeuDesThemes();
  oublierSession();
  // Une nouvelle configuration abandonne la partie précédente : ceux qui la
  // suivaient ne doivent pas recevoir les états d'une partie qui n'est plus la leur.
  couperSuivi();

  updateSimpleCustomBlock();
  refreshThemeSelector();
  showScreen('screen-mode');
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

  // Le lien avec les téléphones des joueurs ne survit pas au rechargement : il
  // vit en mémoire, alors que le code et le jeton, eux, sont dans le stockage
  // du suivi. Sans cette reprise, plus aucun tour n'est confié et l'organisateur
  // se retrouve à pouvoir lancer le tour d'un autre depuis son propre appareil.
  const suivie = sessionSuivie();
  if (suivie) reprendreSession(suivie.code, suivie.jeton);

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
  renderPlayerList(game.players, (name) => {
    removePlayer(name);
    // Un prénom retiré ne doit pas réapparaître sur l'écran des équipes
    repartition = repartition.filter(j => j.prenom !== name);
    refreshPlayerList();
  });
}

// Effectifs par équipe, ou null quand l'app ne peut pas les connaître : mode
// simple, ou saisie partagée où les joueurs ne se sont pas encore inscrits.
// null déclenche la question posée à l'organisateur pour la manche pantin.
function effectifsConnus() {
  // Les équipes viennent d'être formées à la main : ce sont les vrais chiffres,
  // quel que soit le parcours qui a fourni les prénoms.
  if (game.nominativeMode && repartition.length > 0) {
    return game.teams.map((_, index) => repartition.filter(j => j.equipe === index).length);
  }
  if (saisiePartagee() && repartition.length > 0) {
    // Mode simple : on connaît le nombre de joueurs, pas leur répartition —
    // on suppose des équipes aussi équilibrées que possible.
    return [Math.ceil(repartition.length / 2), Math.floor(repartition.length / 2)];
  }
  return getPlannedTeamSizes();
}

function openRoundsStep() {
  puppetAnswer = null;
  renderRoundsSelector(ROUNDS, game.activeRounds, effectifsConnus(), onRoundToggle);
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
  if (effectifsConnus() !== null) return false;
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

  // Filet de sécurité : une manche à effectif minimum ne passe jamais si l'effectif
  // est connu et insuffisant. En saisie partagée il ne l'est pas encore — la
  // vérification a lieu au lancement, une fois tout le monde inscrit.
  const sizes = effectifsConnus();
  const plusPetiteEquipe = sizes ? Math.min(...sizes) : null;
  game.activeRounds = selected.filter(index => {
    const round = ROUNDS[index];
    return !(round.minPerTeam && plusPetiteEquipe !== null && plusPetiteEquipe < round.minPerTeam);
  });
}

function setupListeners() {
  // Home → Mode (step 1)
  document.getElementById('btn-start').addEventListener('click', preparerNouvellePartie);

  // Reprendre une partie interrompue
  document.getElementById('btn-resume').addEventListener('click', resumeGame);

  // Mode tiles selection
  // On cible [data-source] et non .mode-tile : le choix de saisie partagée
  // réutilise la même apparence, mais ne doit pas changer le type de partie.
  // Le choix du type de partie vaut validation : il n'y a plus rien à régler
  // sur cet écran depuis que la saisie passe toujours par le QR code, donc plus
  // de raison de demander un « Suivant » après avoir choisi.
  document.querySelectorAll('[data-source]').forEach(tile => {
    tile.addEventListener('click', () => {
      // Aucune tuile ne reste allumée : le clic est une action, pas un état.
      // Une tuile qui garde sa surbrillance au retour laisserait croire qu'il
      // reste quelque chose à valider.
      document.querySelectorAll('[data-source]').forEach(t => t.classList.remove('active'));
      game.cardSource = tile.dataset.source;
      // Les cartes perso passent toujours par le QR code : le repli « on se
      // passe le téléphone » reste offert depuis l'écran de session, y compris
      // si le réseau manque. Un choix de moins à faire en début de partie.
      saisieMode = 'partagee';
      updateSimpleCustomBlock();
      etapeApresTypeDePartie();
    });
  });

  // Themes → Players (step)
  document.getElementById('btn-next-step').addEventListener('click', () => {
    if (game.selectedThemes.size === 0) {
      showDialog({
        title: 'Aucun thème sélectionné',
        message: "Choisis au moins un thème : c'est lui qui fournit les cartes de la partie.",
        confirmLabel: 'Compris'
      });
      return;
    }
    // En rejeu, ce bouton lance la partie : équipes et manches sont déjà réglées
    if (rejeuThemes) {
      quitterLeRejeuDesThemes();
      buildDeck(THEMES);
      beginRound();
      return;
    }
    updateWizardLabels();
    showScreen('screen-jeu-mode');
  });

  // Add player
  const playerInput = document.getElementById('player-name-input');
  document.getElementById('btn-add-player').addEventListener('click', () => {
    const name = playerInput.value.trim();
    const erreur = document.getElementById('player-error');
    erreur.textContent = '';

    if (!name) return playerInput.focus();

    // Sans ce message, le clic ne faisait rien et personne ne comprenait pourquoi
    if (playerExists(name)) {
      erreur.textContent = `Il y a déjà un ${name} dans la partie. Ajoute une initiale pour les distinguer.`;
      playerInput.select();
      return;
    }

    addPlayer(name);
    playerInput.value = '';
    refreshPlayerList();
    playerInput.focus();
  });

  // Add player on Enter
  playerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('btn-add-player').click();
    }
  });

  // Comment on joue : avec ou sans les prénoms. Choisir vaut avancer.
  document.querySelectorAll('[data-mode]').forEach(tuile => {
    tuile.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach(t => t.classList.remove('active'));
      game.nominativeMode = (tuile.dataset.mode === 'nominatif');
      updateSimpleCustomBlock();
      etapeApresModeDeJeu();
    });
  });

  // Les noms d'équipes vivent sur l'écran des équipes : les changer redessine
  // la répartition, dont chaque bouton porte le nom de son équipe.
  document.getElementById('team1-name').addEventListener('input', () => {
    syncTeamNamesFromInputs();
    afficherRepartition();
  });
  document.getElementById('team2-name').addEventListener('input', () => {
    syncTeamNamesFromInputs();
    afficherRepartition();
  });

  // Les joueurs → les équipes
  document.getElementById('btn-next-players').addEventListener('click', () => {
    if (game.players.length < 4) {
      showDialog({
        title: 'Pas assez de joueurs',
        message: "Il faut au moins 4 joueurs pour jouer avec les noms. Sinon, reviens en arrière et choisis « Juste deux équipes ».",
        confirmLabel: 'Compris'
      });
      return;
    }
    ouvrirEcranDesEquipes();
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

  // Ouverture de session : réglage du nombre de cartes
  document.getElementById('btn-joueurs-moins').addEventListener('click', () => reglerJoueursSession(-1));
  document.getElementById('btn-joueurs-plus').addEventListener('click', () => reglerJoueursSession(1));
  document.getElementById('btn-cartes-moins').addEventListener('click', () => reglerCartesSession(-1));
  document.getElementById('btn-cartes-plus').addEventListener('click', () => reglerCartesSession(1));
  document.getElementById('btn-ouvrir-session').addEventListener('click', demarrerSessionPartagee);

  // Session partagée — écran de l'organisateur
  document.getElementById('session-adresse').addEventListener('click', partagerLien);

  // Inscription des joueurs par QR, parties à thèmes en mode nominatif
  document.getElementById('inscription-adresse').addEventListener('click', partagerLien);
  document.getElementById('btn-inscription-suivant').addEventListener('click', terminerLesInscriptions);
  document.getElementById('btn-inscription-manuel').addEventListener('click', basculerEnSaisieManuelle);
  document.getElementById('btn-inscription-moi-ok').addEventListener('click', inscrireOrganisateur);
  document.getElementById('inscription-moi-prenom').addEventListener('keypress', e => {
    if (e.key === 'Enter') inscrireOrganisateur();
  });
  document.getElementById('btn-inscription-sanstel').addEventListener('click', () => {
    document.getElementById('inscription-ajout-bloc').style.display = '';
    document.getElementById('inscription-erreur').textContent = '';
    document.getElementById('inscription-ajout-prenom').focus();
  });
  document.getElementById('btn-inscription-ajout-ok')
    .addEventListener('click', inscrireJoueurSansTelephone);
  document.getElementById('inscription-ajout-prenom').addEventListener('keypress', e => {
    if (e.key === 'Enter') inscrireJoueurSansTelephone();
  });
  document.getElementById('btn-inscription-retour').addEventListener('click', () => {
    arreterSuivi();
    oublierSession();
    showScreen('screen-jeu-mode');
  });

  // Partage du suivi, parties à thèmes
  document.getElementById('suivi-partage-adresse').addEventListener('click', partagerLien);
  document.getElementById('btn-suivi-partage-lancer').addEventListener('click', lancerAvecSuivi);
  // Revenir en arrière abandonne le code : personne ne l'a encore utilisé, et
  // le laisser ouvert ferait suivre une partie que l'organisateur reconfigure.
  document.getElementById('btn-suivi-partage-retour').addEventListener('click', () => {
    oublierSession();
    showScreen('screen-config');
  });
  document.getElementById('btn-mes-cartes').addEventListener('click', () => ouvrirSaisieLocale('organisateur'));
  document.getElementById('btn-session-sanstel').addEventListener('click', () => ouvrirSaisieLocale('sansTel'));
  document.getElementById('btn-session-lancer').addEventListener('click', terminerSaisieEtConfigurer);
  document.getElementById('btn-session-abandon').addEventListener('click', abandonnerSessionPartagee);

  // Saisie sur cet appareil
  document.getElementById('btn-saisie-ajouter').addEventListener('click', ajouterCarteLocale);
  document.getElementById('saisie-carte').addEventListener('keypress', e => {
    if (e.key === 'Enter') ajouterCarteLocale();
  });
  document.getElementById('btn-saisie-fini').addEventListener('click', finirSaisieLocale);
  document.getElementById('btn-saisie-retour').addEventListener('click', () => showScreen('screen-session'));
  document.getElementById('btn-saisie-visibilite').addEventListener('click', () => {
    const champ = document.getElementById('saisie-carte');
    champ.type = champ.type === 'password' ? 'text' : 'password';
  });

  // Répartition des équipes après une session partagée
  document.getElementById('btn-repartition-melanger').addEventListener('click', melangerRepartition);
  document.getElementById('btn-repartition-jouer').addEventListener('click', validerRepartition);

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
  document.getElementById('btn-reprendre-tour').addEventListener('click', reprendreLeTourIci);

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

  // Composition des équipes, consultable avant de lancer un tour
  document.getElementById('btn-retour-correction')
    .addEventListener('click', revenirALaCorrection);
  document.getElementById('btn-retour-correction-manche')
    .addEventListener('click', revenirALaCorrection);

  document.getElementById('btn-voir-equipes').addEventListener('click', () => afficherEquipes(game.teams));
  document.getElementById('btn-equipes-fermer').addEventListener('click', masquerEquipes);
  document.getElementById('equipes-overlay').addEventListener('click', event => {
    if (event.target.id === 'equipes-overlay') masquerEquipes();
  });

  // Next turn
  document.getElementById('btn-next-turn').addEventListener('click', onNextTurn);

  // Rejouer avec les mêmes joueurs : mêmes équipes, mêmes réglages, le cumul continue
  document.getElementById('btn-replay').addEventListener('click', () => {
    replayGame();

    // En cartes perso, il faut de NOUVELLES cartes : sans ça on rejouerait le
    // paquet à l'identique, que tout le monde connaît déjà par cœur.
    if (saisiePartagee()) {
      // La partie précédente est close. Sans cette coupure, ses battements
      // continuaient de publier sur l'ancien code, mais sur un état déjà remis
      // à zéro : les invités voyaient leur écran de résultats se vider.
      couperSuivi();
      modeRejeu = true;
      listeJoueurs = game.players.length ? [...game.players] : repartition.map(j => j.prenom);
      ouvrirReglageSession();
      return;
    }

    // Thèmes prédéfinis : on repasse par le choix du paquet. Rejouer les mêmes
    // thèmes sans rien demander, c'est enchaîner sur des mots déjà vus — et
    // c'était le seul endroit du jeu où l'on ne pouvait pas en changer.
    // Les équipes et les manches, elles, ne bougent pas.
    ouvrirChoixDesThemesEnRejeu();
  });

  // Nouvelle partie : retour à l'accueil, le cumul de la soirée s'arrête là
  document.getElementById('btn-restart').addEventListener('click', () => {
    couperSuivi();
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
// Les deux parcours comptent cinq étapes ; seule la deuxième diffère —
// le choix des thèmes, ou la saisie des cartes par les joueurs eux-mêmes.
// Le parcours n'a plus un nombre d'étapes fixe : les prénoms n'existent qu'en
// mode nominatif, et le paquet vient soit de thèmes, soit d'une saisie partagée.
// On construit donc la liste des écrans réellement traversés, et on numérote.
function updateWizardLabels() {
  const etapes = ['mode'];
  if (game.cardSource === 'themes') etapes.push('themes');
  else etapes.push('session');
  etapes.push('jeumode');
  if (game.nominativeMode) etapes.push('players');
  etapes.push('equipes', 'rounds', 'config');

  const total = etapes.length;
  document.querySelectorAll('[data-step]').forEach(el => {
    const rang = etapes.indexOf(el.dataset.step);
    if (rang >= 0) el.textContent = `Étape ${rang + 1}/${total}`;
  });
}

function updateCardsCountLabel() {
  const label = document.getElementById('cards-count-label');
  const hint = document.getElementById('cards-count-hint');
  const preset = document.getElementById('cards-preset');
  const stepper = document.getElementById('cards-stepper');

  // En saisie partagée, ce réglage a déjà été fait à l'ouverture de la session :
  // on masque le champ entier plutôt que d'offrir deux endroits pour le même choix.
  const champ = document.getElementById('cards-count-field');
  if (champ) champ.style.display = saisiePartagee() ? 'none' : '';

  if (game.cardSource === 'custom') {
    label.textContent = 'Cartes saisies par joueur';
    preset.style.display = 'none';
    stepper.style.display = '';
    const input = document.getElementById('cards-stepper-input');
    if (!input.value || parseInt(input.value) < 3) input.value = 5;
    // En saisie partagée, la valeur qui fait foi est celle réglée à l'ouverture
    // de la session : ne pas la réécrire depuis ce champ, qui est masqué.
    if (saisiePartagee()) input.value = game.numCards;
    else game.numCards = parseInt(input.value);
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
  const partagee = game.cardSource === 'custom' && saisieMode === 'partagee';
  block.style.display = (game.cardSource === 'custom' && !game.nominativeMode && !partagee) ? '' : 'none';
  updateBlocJoueurs();
}

// En saisie partagée et en mode nominatif, les prénoms arrivent avec les scans :
// l'organisateur n'a plus à taper la liste des joueurs.
function saisiePartagee() {
  return game.cardSource === 'custom' && saisieMode === 'partagee';
}

function joueursViennentDesScans() {
  return saisiePartagee() && game.nominativeMode;
}

// L'écran des joueurs ne sert plus qu'à la saisie manuelle des prénoms : quand
// ils viennent des scans, l'assistant passe directement aux équipes, où la
// liste des inscrits est de toute façon sous les yeux.
function updateBlocJoueurs() {
  const bloc = document.getElementById('nominatif-block');
  if (bloc) bloc.style.display = game.nominativeMode ? '' : 'none';
}

// ===== NAVIGATION DE L'ASSISTANT =====
// Un écran = une décision. L'écran des équipes est le seul point de passage
// obligé après le mode de jeu : c'est lui qui précède toujours les manches.

// Après « comment on joue » : les prénoms, ou directement les équipes.
function etapeApresModeDeJeu() {
  // Les prénoms viennent des scans : leur nombre est déjà figé, et c'est ici
  // qu'on peut encore renoncer aux prénoms. Dans le parcours manuel, la liste
  // n'est pas encore saisie — le contrôle attend l'écran des joueurs.
  if (game.nominativeMode && joueursViennentDesScans() && repartition.length < 4) {
    showDialog({
      title: 'Pas assez de joueurs',
      message: `Jouer avec les noms demande au moins 4 joueurs, et ${repartition.length} ont saisi leurs cartes. Choisis « Juste deux équipes » pour jouer quand même.`,
      confirmLabel: 'Compris'
    });
    game.nominativeMode = true;
    return;
  }

  updateWizardLabels();
  updateCardsCountLabel();

  // Partie à thèmes en mode nominatif : plutôt que de taper dix prénoms sur son
  // téléphone, l'organisateur fait scanner un code. Le repli manuel reste offert.
  if (game.nominativeMode && game.cardSource === 'themes'
      && !inscriptionRefusee && !sessionCourante()) {
    ouvrirInscriptionDesJoueurs();
    return;
  }

  if (!game.nominativeMode) {
    // Aucun prénom ne sert plus : on efface ce qu'une configuration
    // précédente aurait laissé, sinon les équipes resteraient peuplées.
    game.players = [];
    game.playerAssignments = {};
    game.teams[0].players = [];
    game.teams[1].players = [];
    // `repartition` n'est pas vidée : sans les prénoms, elle reste la seule
    // trace du nombre de personnes qui ont scanné — ce dont les manches à
    // effectif minimum ont besoin pour se verrouiller toutes seules.
    ouvrirEcranDesEquipes();
    return;
  }
  // Les prénoms viennent des scans : rien à saisir, on répartit directement.
  if (joueursViennentDesScans()) {
    ouvrirEcranDesEquipes();
    return;
  }
  refreshPlayerList();
  updateBlocJoueurs();
  showScreen('screen-players');
}

// L'écran des équipes : les noms toujours, la répartition seulement s'il y a
// des prénoms à répartir.
function ouvrirEcranDesEquipes() {
  syncTeamNamesFromInputs();
  // La liste vient des scans quand il y en a eu, de la saisie manuelle sinon.
  // Dans ce second cas elle est reconstruite à chaque passage : l'organisateur
  // a pu revenir ajouter ou retirer un prénom. On garde les équipes déjà
  // attribuées, sans quoi un ajout tardif rebattrait tout son travail.
  if (game.nominativeMode && !joueursViennentDesScans()) {
    // On reprend la fiche entière de ceux qu'on connaît déjà, pas seulement leur
    // équipe : elle porte aussi l'identifiant de leur téléphone, sans lequel on
    // ne saurait plus à qui confier leur tour.
    const connus = new Map(repartition.map(j => [j.prenom, j]));
    repartition = game.players.map((prenom, index) =>
      connus.get(prenom) || { prenom, equipe: index % game.teams.length });
  }
  document.getElementById('bloc-repartition').style.display =
    game.nominativeMode ? '' : 'none';
  document.getElementById('equipes-hint').textContent = game.nominativeMode
    ? 'Nomme-les, et répartis les joueurs.'
    : "Deux équipes s'affrontent. Donne-leur un nom si tu veux.";
  afficherRepartition();
  updateWizardLabels();
  showScreen('screen-repartition');
}

// L'écran précédant les manches est toujours celui des équipes.
window.handleBackFromRounds = function() {
  ouvrirEcranDesEquipes();
};

window.handleBackFromEquipes = function() {
  if (game.nominativeMode && !joueursViennentDesScans()) {
    refreshPlayerList();
    updateBlocJoueurs();
    showScreen('screen-players');
    return;
  }
  showScreen('screen-jeu-mode');
};

window.handleBackFromPlayers = function() {
  showScreen('screen-jeu-mode');
};

window.handleBackFromJeuMode = function() {
  showScreen(game.cardSource === 'themes' ? 'screen-themes' : 'screen-mode');
};

// ===== SAISIE PARTAGÉE (QR CODE) =====
// Le nombre de cartes se règle ici, avant d'ouvrir la session : les invités
// doivent connaître leur consigne dès leur premier scan. En saisie séquentielle,
// ce réglage reste à l'étape « Déroulement ».

// En dessous, une manche se termine trop vite pour que la partie ait du goût.
const PAQUET_MINIMUM = 30;
const JOUEURS_MIN = 4;
const JOUEURS_MAX = 30;   // doit rester égal à MAX_JOUEURS dans api/session.js
const CARTES_MIN = 3;
const CARTES_MAX = 15;

// Plutôt que de signaler un paquet trop court, on empêche d'y descendre :
// le minimum par joueur découle du nombre de joueurs annoncé.
function minimumCartesParJoueur() {
  return Math.max(CARTES_MIN, Math.ceil(PAQUET_MINIMUM / joueursAttendus));
}

function etapeApresTypeDePartie() {
  updateWizardLabels();
  updateCardsCountLabel();
  updateSimpleCustomBlock();
  if (game.cardSource === 'themes') {
    showScreen('screen-themes');
  } else if (saisieMode === 'partagee') {
    // La saisie des cartes passe avant tout le reste : les joueurs commencent
    // pendant que l'organisateur n'a encore rien réglé.
    ouvrirReglageSession();
  } else {
    showScreen('screen-jeu-mode');
  }
}

function ouvrirReglageSession() {
  // game.numCards vaut 30 par défaut (taille de paquet du mode thèmes) : hors
  // de la plage acceptable pour une saisie individuelle, on repart de 5.
  if (game.numCards < CARTES_MIN || game.numCards > CARTES_MAX) game.numCards = 5;

  // En rejeu, l'effectif est connu : on le propose plutôt qu'une estimation.
  // On le ramène dans les bornes du réglage — à moins de 4 joueurs réels, mieux
  // vaut proposer 4 que de laisser l'estimation périmée de la partie précédente.
  if (modeRejeu && listeJoueurs.length > 0) {
    joueursAttendus = Math.max(JOUEURS_MIN, Math.min(JOUEURS_MAX, listeJoueurs.length));
  }

  rafraichirReglageSession();
  showScreen('screen-session-ouvrir');
}

function rafraichirReglageSession() {
  // Réduire le nombre de joueurs relève d'office les cartes par joueur
  const minimum = minimumCartesParJoueur();
  game.numCards = Math.max(minimum, Math.min(CARTES_MAX, game.numCards));

  document.getElementById('session-joueurs-valeur').textContent = joueursAttendus;
  document.getElementById('session-cartes-valeur').textContent = game.numCards;
  document.getElementById('session-cartes-estimation').textContent =
    `${joueursAttendus * game.numCards} cartes dans le paquet`;

  // Les bornes se voient : un bouton éteint explique mieux qu'un message d'erreur
  document.getElementById('btn-joueurs-moins').disabled = joueursAttendus <= JOUEURS_MIN;
  document.getElementById('btn-joueurs-plus').disabled = joueursAttendus >= JOUEURS_MAX;
  document.getElementById('btn-cartes-moins').disabled = game.numCards <= minimum;
  document.getElementById('btn-cartes-plus').disabled = game.numCards >= CARTES_MAX;
}

function reglerCartesSession(delta) {
  game.numCards = Math.max(minimumCartesParJoueur(), Math.min(CARTES_MAX, game.numCards + delta));
  rafraichirReglageSession();
}

// Prévision, pas contrainte : le paquet réel dépendra de qui scanne vraiment.
// Elle sert à dimensionner le paquet avant d'ouvrir la session.
function reglerJoueursSession(delta) {
  joueursAttendus = Math.max(JOUEURS_MIN, Math.min(JOUEURS_MAX, joueursAttendus + delta));
  rafraichirReglageSession();
}

// L'organisateur ouvre une session, les invités scannent, chacun saisit sur son
// téléphone. Le nombre de cartes par joueur vient de l'étape « Déroulement ».

async function demarrerSessionPartagee() {
  // En rejeu, l'organisateur reste inscrit sous le même identifiant : il n'a ni
  // à se renommer, ni à se réinscrire, juste à ressaisir ses cartes.
  if (!modeRejeu) moiJoueur = null;
  repartition = [];

  try {
    // En rejeu, on recycle la session de la soirée plutôt que d'en ouvrir une
    // neuve : le code ne change pas, personne ne rescanne, et le téléphone des
    // invités découvre tout seul qu'une nouvelle partie commence.
    // Partie neuve : le mode de jeu n'est pas encore choisi, la page des invités
    // demande simplement le prénom.
    const recyclable = modeRejeu && !!sessionCourante();
    const session = recyclable
      ? { ...sessionCourante(), ...(await relancerSession(game.numCards)) }
      : await ouvrirSession(game.numCards, modeRejeu ? listeJoueurs : []);

    afficherInvitation(
      creerQrSvg(adresseInvitation(), { taille: 190 }),
      session.code,
      adresseLisible(),
      `${session.cartesParJoueur} cartes chacun`
    );
    renderBoutonMesCartes(0, session.cartesParJoueur, false);
    showScreen('screen-session');
    suivre(surEtatSession, surPanneSession);
  } catch (err) {
    // Pas de réseau, ou stockage non configuré : on propose le repli sans détour
    const basculer = await showDialog({
      title: 'Saisie à plusieurs indisponible',
      message: `${err.message} Vous pouvez saisir les cartes en vous passant le téléphone.`,
      confirmLabel: 'Se passer le téléphone',
      cancelLabel: 'Revenir en arrière'
    });
    if (basculer) basculerEnSequentiel();
    else showScreen('screen-jeu-mode');
  }
}

// Repli vers la saisie sur un seul appareil. On repasse par l'étape des joueurs :
// en mode nominatif, leur liste n'a jamais été saisie puisqu'elle devait venir
// des scans — sans ce retour, l'organisateur se retrouverait sans aucun nom.
function basculerEnSequentiel() {
  arreterSuivi();
  oublierSession();
  saisieMode = 'sequentielle';
  repartition = [];
  updateSimpleCustomBlock();
  updateWizardLabels();
  showScreen('screen-jeu-mode');
}

function surEtatSession(etat) {
  renderSession(etat, confirmerRetraitJoueur, modeRejeu);
  const moi = moiJoueur ? etat.joueurs.find(j => j.id === moiJoueur.id) : null;
  renderBoutonMesCartes(moi ? moi.nbCartes : 0, etat.cartesParJoueur, !!moi?.fini);
}

// Partage du lien d'invitation. navigator.share ouvre le menu natif du téléphone
// — messages, WhatsApp, mail… — mais n'existe ni sur tous les navigateurs, ni
// sur ordinateur : on retombe alors sur une copie dans le presse-papier, puis
// sur l'affichage du lien en clair si même ça est refusé.
async function partagerLien() {
  const session = sessionCourante();
  if (!session) return;

  const lien = adresseInvitation();

  // On ne transmet que l'adresse, sans texte d'accompagnement : c'est le système
  // qui décide quoi faire de ce qu'on lui donne, et beaucoup de téléphones
  // collent le texte devant l'adresse — y compris quand l'utilisateur choisit
  // « Copier ». Le code d'accès est déjà dans l'adresse, rien n'est perdu.
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Rush', url: lien });
      return;
    } catch (err) {
      // L'utilisateur a fermé le menu de partage : ce n'est pas une erreur
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(lien);
    showDialog({
      title: 'Lien copié',
      message: 'Colle-le dans ta messagerie pour inviter les autres joueurs.',
      confirmLabel: 'Parfait'
    });
  } catch {
    showDialog({
      title: 'Lien à recopier',
      message: lien,
      confirmLabel: 'Compris'
    });
  }
}

function surPanneSession() {
  const compteur = document.getElementById('session-compteur');
  if (compteur) compteur.textContent = '📡 Connexion perdue — nouvelle tentative…';
}

async function confirmerRetraitJoueur(joueur) {
  const inscriptionSeule = !!sessionCourante()?.inscription;
  const partir = await showDialog({
    title: `Retirer ${joueur.prenom} ?`,
    message: inscriptionSeule
      ? `${joueur.prenom} ne jouera pas cette partie. Il pourra s'inscrire à nouveau avec le même code.`
      : `Ses ${joueur.nbCartes} carte(s) déjà envoyées seront abandonnées. Il pourra rejoindre à nouveau avec le même code.`,
    confirmLabel: 'Retirer',
    cancelLabel: 'Attendre encore',
    danger: true
  });
  if (!partir) return;

  try {
    await retirerJoueur(joueur.id);
    if (moiJoueur && moiJoueur.id === joueur.id) moiJoueur = null;
    const etat = await lireEtatSansAttendre();
    if (inscriptionSeule) surEtatInscription(etat);
    else surEtatSession(etat);
  } catch (err) {
    showDialog({ title: 'Retrait impossible', message: err.message, confirmLabel: 'Compris' });
  }
}

// Rafraîchissement immédiat, sans attendre le prochain tour du suivi
function lireEtatSansAttendre() {
  return lireEtat();
}

// ===== Saisie sur cet appareil =====
// Deux cas : l'organisateur saisit ses propres cartes (en clair, c'est son
// téléphone), ou un joueur sans téléphone emprunte l'appareil (cartes masquées).

async function ouvrirSaisieLocale(role) {
  const session = sessionCourante();
  const organisateur = role === 'organisateur';

  saisieLocale = {
    role,
    id: organisateur ? moiJoueur?.id || null : null,
    prenom: organisateur ? moiJoueur?.prenom || '' : '',
    cartes: [],
    masque: !organisateur,
    cible: session.cartesParJoueur,
    // Le prénom est demandé à tout le monde, organisateur compris : le mode de
    // jeu n'est pas encore choisi, et il servira à la répartition des équipes.
    demanderPrenom: true
  };

  document.getElementById('saisie-label-prenom').textContent =
    organisateur ? 'Ton prénom' : 'Son prénom';
  document.getElementById('saisie-label-liste').textContent =
    organisateur ? 'Qui es-tu ?' : 'Qui saisit sur cet appareil ?';

  const champ = document.getElementById('saisie-prenom');
  champ.value = saisieLocale.prenom;
  champ.placeholder = organisateur ? 'Ton prénom' : 'Son prénom';
  await rendreChoixPrenomLocal();
  document.getElementById('saisie-carte').type = saisieLocale.masque ? 'password' : 'text';
  document.getElementById('saisie-carte').value = '';
  showSaisieError('');
  rafraichirSaisieLocale();
  showScreen('screen-saisie-locale');
}

// En rejeu, les prénoms sont connus d'avance : l'organisateur les choisit dans
// la liste, exactement comme les invités sur leur téléphone. Sans ça il était le
// seul à devoir retaper le sien, au risque d'une faute qui le dédoublerait.
// Qui, de la liste ou du champ libre, doit être visible. Appelé à chaque
// rafraîchissement, donc sans le moindre appel réseau.
function ajusterBlocsPrenom() {
  const parListe = listeJoueurs.length > 0 && !saisieLocale.prenom && !saisieLocale.id;
  document.getElementById('saisie-bloc-liste').style.display = parListe ? '' : 'none';
  document.getElementById('saisie-bloc-prenom').style.display =
    (saisieLocale.demanderPrenom && !parListe) ? '' : 'none';
  return parListe;
}

async function rendreChoixPrenomLocal() {
  if (!ajusterBlocsPrenom()) return;

  // Qui est déjà inscrit, et où en est-il ? En rejeu, tout le monde reste
  // inscrit d'une partie à l'autre : un joueur déjà là mais sans cartes n'est
  // pas « pris », il attend simplement qu'on ressaisisse pour lui.
  let connus = new Map();
  try {
    const etat = await lireEtatSansAttendre();
    (etat?.joueurs || []).forEach(j => connus.set(j.prenom.toLocaleLowerCase(), j));
  } catch {
    // Sans réseau, on propose toute la liste : le serveur tranchera
  }

  const liste = document.getElementById('saisie-liste-prenoms');
  liste.innerHTML = '';
  listeJoueurs.forEach(prenom => {
    const existant = connus.get(prenom.toLocaleLowerCase());
    const termine = !!existant?.fini;

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = termine ? `${prenom} ✓` : prenom;
    bouton.disabled = termine;
    bouton.addEventListener('click', () => {
      document.getElementById('saisie-prenom').value = prenom;
      saisieLocale.prenom = prenom;
      // Ce joueur existe déjà : on reprend son identifiant au lieu de créer un
      // doublon. Ses cartes seront simplement redéposées sous le même nom.
      if (existant) saisieLocale.id = existant.id;
      showSaisieError('');
      // Le choix fait, la liste laisse la place au prénom retenu
      rafraichirSaisieLocale();
      document.getElementById('saisie-carte').focus();
    });
    liste.appendChild(bouton);
  });
}

function rafraichirSaisieLocale() {
  const organisateur = saisieLocale.role === 'organisateur';
  renderSaisieLocale({
    titre: organisateur ? 'Tes cartes' : 'Saisie sur cet appareil',
    note: organisateur
      ? "C'est ton téléphone : tes cartes s'affichent en clair. Ton prénom te placera dans une équipe, comme les autres joueurs."
      : 'Passe ton téléphone à ce joueur. Ses cartes restent masquées pendant qu\'il tape.',
    cartes: saisieLocale.cartes,
    cible: saisieLocale.cible,
    masque: saisieLocale.masque,
    demanderPrenom: saisieLocale.demanderPrenom
  }, retirerCarteLocale);

  // Une fois inscrit — ou choisi dans la liste fermée d'un rejeu — le prénom se
  // fige : le changer créerait un second joueur au lieu de renommer le premier.
  const fige = !!saisieLocale.id || (listeJoueurs.length > 0 && !!saisieLocale.prenom);
  const champ = document.getElementById('saisie-prenom');
  champ.readOnly = fige;
  champ.title = fige ? 'Ton prénom est enregistré dans la partie' : '';
  ajusterBlocsPrenom();
}

// Inscrit le joueur s'il ne l'est pas encore, puis pousse ses cartes.
// Les invités font exactement cela au fil de leur frappe : sans ça,
// l'organisateur restait invisible dans la salle d'attente jusqu'à sa
// validation, puis y apparaissait d'un coup, déjà terminé.
async function synchroniserSaisieLocale(fini) {
  const prenom = document.getElementById('saisie-prenom').value.trim();
  if (!prenom) return false;

  try {
    if (!saisieLocale.id) {
      const reponse = await inscrire(prenom, saisieLocale.role);
      saisieLocale.id = reponse.idJoueur;
      saisieLocale.prenom = prenom;
      if (saisieLocale.role === 'organisateur') moiJoueur = { id: reponse.idJoueur, prenom };
    }
    await deposerCartes(saisieLocale.id, saisieLocale.cartes, fini);
    rafraichirSaisieLocale();
    return true;
  } catch (err) {
    // Prénom déjà pris : on corrige sur place plutôt que d'ouvrir une boîte
    if (err.details?.motif === 'prenom-pris') {
      showSaisieError(err.message);
      return false;
    }
    showDialog({ title: 'Envoi impossible', message: err.message, confirmLabel: 'Réessayer' });
    return false;
  }
}

async function ajouterCarteLocale() {
  const champ = document.getElementById('saisie-carte');
  const mot = champ.value.trim();
  showSaisieError('');

  if (mot.length < 2) return showSaisieError('Une carte doit faire au moins 2 caractères.');
  if (saisieLocale.cartes.some(m => m.toLocaleLowerCase() === mot.toLocaleLowerCase())) {
    return showSaisieError('Cette carte a déjà été saisie.');
  }
  if (saisieLocale.cartes.length >= saisieLocale.cible) {
    return showSaisieError(`${saisieLocale.cible} cartes suffisent.`);
  }
  // Le prénom précède la première carte : c'est lui qui inscrit le joueur,
  // et donc ce qui le rend visible aux autres pendant qu'il tape.
  if (!saisieLocale.id && !document.getElementById('saisie-prenom').value.trim()) {
    if (listeJoueurs.length > 0) {
      return showSaisieError(saisieLocale.role === 'organisateur'
        ? 'Touche ton prénom dans la liste avant de saisir tes cartes.'
        : 'Touche le prénom de ce joueur dans la liste.');
    }
    return showSaisieError(saisieLocale.role === 'organisateur'
      ? "Indique d'abord ton prénom : les autres verront que tu saisis tes cartes."
      : "Indique d'abord son prénom.");
  }

  saisieLocale.cartes.push(mot);
  champ.value = '';
  champ.focus();
  rafraichirSaisieLocale();
  await synchroniserSaisieLocale(false);
}

async function retirerCarteLocale(index) {
  saisieLocale.cartes.splice(index, 1);
  rafraichirSaisieLocale();
  await synchroniserSaisieLocale(false);
}

async function finirSaisieLocale() {
  const prenom = document.getElementById('saisie-prenom').value.trim();

  if (prenom.length < 1) {
    return showSaisieError(saisieLocale.role === 'organisateur'
      ? 'Indique ton prénom : il servira à te placer dans une équipe.'
      : 'Indique le prénom de ce joueur.');
  }

  // L'inscription a déjà eu lieu à la première carte : il ne reste qu'à
  // marquer la saisie terminée.
  if (!(await synchroniserSaisieLocale(true))) return;
  showScreen('screen-session');
  surEtatSession(await lireEtatSansAttendre());
}

// ===== Lancement =====
// La vérification tardive des effectifs a disparu : la répartition des équipes
// précède désormais l'étape des manches, qui verrouille elle-même les manches
// trop exigeantes, comme dans une partie ordinaire.

// ===== LES DOUBLONS DU PAQUET =====
// Deux joueurs ont eu la même idée : la carte sortira deux fois dans la même
// manche, et la seconde se devine en une seconde. On le dit à l'organisateur
// avant de figer le paquet — jamais en citant les mots, il joue lui aussi.

// « 4 mots ont été écrits 2 fois, 1 mot 3 fois. »
function phraseDesDoublons(compte) {
  const morceaux = compte.occurrences.map(({ fois, mots }, rang) => {
    const pluriel = mots > 1;
    const sujet = `${mots} mot${pluriel ? 's' : ''}`;
    // Seul le premier morceau porte le verbe : la suite s'y accroche.
    return rang === 0
      ? `${sujet} ${pluriel ? 'ont' : 'a'} été écrit${pluriel ? 's' : ''} ${fois} fois`
      : `${sujet} ${fois} fois`;
  });
  return `${morceaux.join(', ')}. `
    + `Il reste ${compte.uniques} mots différents sur ${compte.saisies} cartes saisies.`;
}

// Ne garder qu'un exemplaire de chaque mot. La comparaison ignore la casse et
// les espaces, comme la page des invités : « Plage » et « plage » sont le même
// mot, et deux joueurs les écriront différemment.
function sansLesDoublons(cartes) {
  const vues = new Set();
  return cartes.filter(carte => {
    const cle = String(carte).trim().toLowerCase();
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
}

// Remplacer les exemplaires en trop par des mots tirés des thèmes officiels,
// déjà chargés : le paquet garde sa taille et rien ne dépend du réseau. Ces
// cartes-là ne viennent de personne — c'est le prix de la taille conservée.
function avecDesMotsAuHasard(cartes) {
  const gardees = sansLesDoublons(cartes);
  const manquantes = cartes.length - gardees.length;
  if (manquantes === 0) return gardees;

  const dejaPris = new Set(gardees.map(c => String(c).trim().toLowerCase()));
  const vivier = [];
  Object.values(THEMES).forEach(theme => {
    (theme.words || []).forEach(mot => {
      const cle = String(mot).trim().toLowerCase();
      if (!dejaPris.has(cle)) { dejaPris.add(cle); vivier.push(mot); }
    });
  });
  return gardees.concat(shuffle(vivier).slice(0, manquantes));
}

// Compte les occurrences du paquet reçu. Le comptage se fait ici, et non sur le
// serveur : une fois la session fermée, l'app détient les cartes de toute façon.
// Elle n'en montre aucune — l'organisateur joue, et lire les doublons lui
// donnerait des cartes d'avance.
function compterLesDoublons(cartes) {
  const parMot = new Map();
  cartes.forEach(carte => {
    const cle = String(carte).trim().toLowerCase();
    if (cle) parMot.set(cle, (parMot.get(cle) || 0) + 1);
  });

  const parNombre = new Map();
  parMot.forEach(fois => {
    if (fois > 1) parNombre.set(fois, (parNombre.get(fois) || 0) + 1);
  });

  return {
    occurrences: [...parNombre.entries()]
      .map(([fois, mots]) => ({ fois, mots }))
      .sort((a, b) => a.fois - b.fois),
    saisies: cartes.length,
    uniques: parMot.size,
    enTrop: cartes.length - parMot.size
  };
}

// Renvoie le paquet à jouer : inchangé, nettoyé, ou complété au hasard.
// Rien à décider quand il n'y a pas de doublon — la boîte ne s'ouvre pas.
//
// Il n'y a délibérément pas d'option « rouvrir la saisie » : redemander leurs
// cartes aux joueurs n'offre aucune garantie que la seconde fournée soit
// meilleure, et fait recommencer tout le monde pour rien.
async function paquetSansMauvaiseSurprise(cartes) {
  const compte = compterLesDoublons(cartes);
  if (!compte.enTrop) return cartes;

  const choix = await showChoices({
    title: `😅 ${compte.enTrop} carte${compte.enTrop > 1 ? 's' : ''} en trop`,
    message: phraseDesDoublons(compte),
    choices: [
      { libelle: "🧹 Ne garder qu'un exemplaire", valeur: 'nettoyer', principal: true },
      { libelle: '🎲 Remplacer par des mots au hasard', valeur: 'hasard' },
      { libelle: 'Avancer sans rien changer', valeur: 'avancer' }
    ]
  });

  if (choix === 'nettoyer') return sansLesDoublons(cartes);
  if (choix === 'hasard') return avecDesMotsAuHasard(cartes);
  return cartes;
}

// Tout le monde a saisi : on fige le paquet, puis on reprend la configuration.
// Fermer est irréversible : on vérifie l'effectif AVANT, sinon un refus
// laisserait une session close que plus personne ne pourrait rejoindre.
async function terminerSaisieEtConfigurer() {
  try {
    // Contrôle avant de fermer, car la fermeture est irréversible : si moins de
    // joueurs que prévu ont scanné, le paquet est plus maigre qu'annoncé.
    const etat = await lireEtat();
    if (etat.total < PAQUET_MINIMUM) {
      const manque = joueursAttendus - etat.joueurs.length;
      const continuer = await showDialog({
        title: `Le paquet ne fait que ${etat.total} cartes`,
        message: manque > 0
          ? `Tu attendais ${joueursAttendus} joueurs, ${etat.joueurs.length} ont saisi les leurs. Il manque ${manque} personne(s). Les manches passeront très vite.`
          : `Il en faudrait au moins ${PAQUET_MINIMUM} pour que les manches ne passent pas trop vite.`,
        confirmLabel: 'Lancer quand même',
        cancelLabel: 'Attendre les autres'
      });
      if (!continuer) return;
    }

    // La session de saisie change de métier : elle servait à collecter les
    // cartes, elle sert maintenant aux invités à suivre la partie. On retient
    // le code avant `oublierSession()`, qui efface tout un peu plus bas.
    const sessionFinie = sessionCourante();
    const resultat = await fermerSession();
    arreterSuivi();
    if (sessionFinie) activerSuivi(sessionFinie.code, sessionFinie.jeton);
    // Le paquet arrive tel que les joueurs l'ont écrit, doublons compris :
    // l'organisateur décide de ce qu'on en fait avant que la partie s'ouvre.
    game.customCards = await paquetSansMauvaiseSurprise(resultat.cartes);

    // En rejeu, équipes et réglages n'ont pas bougé : on relance directement
    if (modeRejeu) {
      modeRejeu = false;
      // La session n'est pas oubliée : c'est celle de la soirée, et le rejeu
      // suivant la recyclera encore. Une partie vraiment neuve l'efface,
      // depuis preparerNouvellePartie().
      buildDeck(THEMES);
      beginRound();
      return;
    }

    // Le paquet est figé et l'effectif enfin connu : les étapes suivantes
    // raisonnent dessus comme dans une partie ordinaire.
    repartition = resultat.joueurs.map((j, index) => ({ ...j, equipe: index % game.teams.length }));
    updateBlocJoueurs();
    updateWizardLabels();
    showScreen('screen-jeu-mode');
  } catch (err) {
    if (err.statut === 409 && err.details?.enAttente) {
      return showDialog({
        title: 'Des joueurs saisissent encore',
        message: `On attend : ${err.details.enAttente.join(', ')}.`,
        confirmLabel: 'Compris'
      });
    }
    showDialog({ title: 'Impossible de continuer', message: err.message, confirmLabel: 'Réessayer' });
  }
}

function afficherRepartition() {
  renderRepartition(repartition, game.teams, joueur => {
    joueur.equipe = (joueur.equipe + 1) % game.teams.length;
    afficherRepartition();
  });
}

function melangerRepartition() {
  repartition = shuffle(repartition).map((j, index) => ({ ...j, equipe: index % game.teams.length }));
  afficherRepartition();
}

// Valide la répartition et passe aux manches. Une équipe vide bloquerait la
// partie bien plus loin, sur un message obscur : on la refuse ici.
function validerRepartition() {
  syncTeamNamesFromInputs();

  // En mode simple il n'y a personne à répartir : seuls les noms comptent.
  if (!game.nominativeMode) {
    openRoundsStep();
    return;
  }

  const vides = game.teams
    .map((equipe, index) => ({ equipe, nombre: repartition.filter(j => j.equipe === index).length }))
    .filter(t => t.nombre === 0);

  if (vides.length > 0) {
    return showDialog({
      title: 'Une équipe est vide',
      message: `${vides.map(t => t.equipe.name).join(' et ')} n'a aucun joueur. Répartis-les avant de continuer.`,
      confirmLabel: 'Compris'
    });
  }

  game.players = repartition.map(j => j.prenom);
  game.playerAssignments = {};
  // Qui tient un AUTRE téléphone que celui-ci, et lequel. Deux exclusions :
  // les prénoms tapés à la main, qui n'ont pas d'identifiant, et l'organisateur
  // lui-même — il joue sur cet appareil, lui confier son tour reviendrait à le
  // faire attendre un téléphone qu'il a déjà en main.
  game.playerPhones = {};
  repartition.forEach(j => {
    game.playerAssignments[j.prenom] = j.equipe;
    if (j.id && j.role !== 'organisateur') game.playerPhones[j.prenom] = j.id;
  });
  game.assignMode = 'chosen';
  // Les équipes sont peuplées maintenant, et non plus seulement au lancement :
  // les invités doivent pouvoir les consulter pendant que la configuration
  // se poursuit. `startGame()` refait l'opération, qui est sans effet de bord.
  syncChosenTeams();
  publierEtat('configuration');
  openRoundsStep();
}

// Repli en cours de session : on abandonne la saisie partagée pour l'appareil unique
async function abandonnerSessionPartagee() {
  const basculer = await showDialog({
    title: 'Se passer le téléphone ?',
    message: "La session en cours sera abandonnée, et les cartes déjà envoyées perdues. Chacun saisira à son tour sur cet appareil, et tu reprendras la configuration depuis les équipes.",
    confirmLabel: 'Basculer',
    cancelLabel: 'Rester ici',
    danger: true
  });
  if (!basculer) return;
  basculerEnSequentiel();
}

// ===== CUSTOM CARDS ENTRY =====
let customEntry = { playerIndex: 0, playerList: [], currentCards: [], batchSize: 0, currentTarget: 0 };

function onPlayClicked() {
  if (game.cardSource === 'custom') {
    if (saisieMode === 'partagee') {
      // Cartes saisies, équipes formées : il n'y a plus qu'à jouer.
      // La session n'est pas oubliée : c'est celle de la soirée, et « Rejouer »
      // la recyclera pour que personne n'ait à rescanner. Une partie vraiment
      // neuve l'efface, depuis preparerNouvellePartie().
      startGame();
    } else {
      startCustomCardsEntry();
    }
  } else {
    // Thèmes prédéfinis : avant de lancer, proposer un code de suivi à ceux qui
    // veulent regarder. Une seule fois par soirée — une session déjà ouverte
    // sert aussi bien aux parties suivantes.
    if (!preparerLancement()) return;
    if (sessionCourante()) { lancerLaPartie(); return; }
    proposerLeSuivi();
  }
}

// ===== INSCRIPTION DES JOUEURS PAR QR (parties à thèmes, mode nominatif) =====
// Les prénoms arrivent des téléphones. La même session servira ensuite à suivre
// la partie : le code donné ici est celui de toute la soirée.

const MINIMUM_JOUEURS = 4;

async function ouvrirInscriptionDesJoueurs() {
  try {
    const session = await ouvrirInscription();
    afficherInscription(
      creerQrSvg(adresseInvitation(), { taille: 190 }),
      session.code,
      adresseLisible()
    );
    moiJoueur = null;
    document.getElementById('inscription-ajout-bloc').style.display = 'none';
    document.getElementById('inscription-erreur').textContent = '';
    document.getElementById('inscription-moi-prenom').value = '';
    renderInscrits([], MINIMUM_JOUEURS, confirmerRetraitJoueur, corrigerSonPrenom);
    updateWizardLabels();
    showScreen('screen-inscription');
    suivre(surEtatInscription, surPanneInscription);
  } catch (err) {
    // Pas de réseau : on retombe sur la saisie des prénoms à la main, qui
    // fonctionne hors ligne. Le suivi sera reproposé avant le lancement.
    await showDialog({
      title: 'Inscription par QR indisponible',
      message: `${err.message} Tu peux saisir les prénoms toi-même.`,
      confirmLabel: 'Saisir les prénoms'
    });
    basculerEnSaisieManuelle();
  }
}

function surEtatInscription(etat) {
  repartition = etat.joueurs.map((j, index) => ({
    ...j, equipe: index % game.teams.length
  }));
  renderInscrits(etat.joueurs, MINIMUM_JOUEURS, confirmerRetraitJoueur, corrigerSonPrenom);
}

function surPanneInscription() {
  // Coupure passagère : on garde la dernière liste plutôt que de la vider
}

// L'organisateur se nomme dans le champ offert d'emblée. Corriger son prénom
// revient à se retirer puis se réinscrire : la session ne sait pas renommer,
// et c'est un geste assez rare pour ne pas mériter une action de plus côté serveur.
async function inscrireOrganisateur() {
  const champ = document.getElementById('inscription-moi-prenom');
  const erreur = document.getElementById('inscription-erreur');
  const prenom = champ.value.trim();
  if (!prenom) return;

  try {
    if (moiJoueur) {
      await retirerJoueur(moiJoueur.id);
      moiJoueur = null;
    }
    const inscrit = await inscrire(prenom, 'organisateur');
    moiJoueur = { id: inscrit.idJoueur, prenom: inscrit.prenom };
    champ.value = '';
    erreur.textContent = '';
    surEtatInscription(await lireEtatSansAttendre());
  } catch (err) {
    erreur.textContent = err.message;
    surEtatInscription(await lireEtatSansAttendre());
  }
}

// Le crayon remet le champ, garni du prénom actuel.
function corrigerSonPrenom(joueur) {
  const champ = document.getElementById('inscription-moi-prenom');
  document.getElementById('inscription-moi-ligne').style.display = 'none';
  document.getElementById('inscription-moi-champ').style.display = '';
  champ.value = joueur.prenom;
  champ.focus();
  champ.select();
}

// Un joueur sans téléphone : c'est l'organisateur qui le nomme.
async function inscrireJoueurSansTelephone() {
  const champ = document.getElementById('inscription-ajout-prenom');
  const erreur = document.getElementById('inscription-erreur');
  const prenom = champ.value.trim();
  if (!prenom) return;

  try {
    await inscrire(prenom, 'sansTel');
    champ.value = '';
    erreur.textContent = '';
    document.getElementById('inscription-ajout-bloc').style.display = 'none';
    surEtatInscription(await lireEtatSansAttendre());
  } catch (err) {
    erreur.textContent = err.message;
  }
}

// L'organisateur renonce au QR : les prénoms se tapent, comme avant.
function basculerEnSaisieManuelle() {
  arreterSuivi();
  oublierSession();
  inscriptionRefusee = true;
  repartition = [];
  updateWizardLabels();
  refreshPlayerList();
  updateBlocJoueurs();
  showScreen('screen-players');
}

// Tout le monde est inscrit : la session se ferme aux nouveaux venus et change
// de métier — elle sert désormais à suivre la partie.
async function terminerLesInscriptions() {
  try {
    const session = sessionCourante();
    const resultat = await fermerSession();
    arreterSuivi();
    repartition = resultat.joueurs.map((j, index) => ({
      ...j, equipe: index % game.teams.length
    }));
    game.players = repartition.map(j => j.prenom);
    if (session) activerSuivi(session.code, session.jeton);
    ouvrirEcranDesEquipes();
  } catch (err) {
    showDialog({ title: 'Impossible de continuer', message: err.message, confirmLabel: 'Réessayer' });
  }
}

// ===== SUIVI D'UNE PARTIE À THÈMES =====
// Rien à saisir : la session ne sert qu'à donner un code aux spectateurs.

async function proposerLeSuivi() {
  const partager = await showDialog({
    title: '👀 Partager le suivi ?',
    message: "Ceux qui n'ont pas le téléphone en main peuvent suivre les scores et le chrono depuis le leur.",
    confirmLabel: 'Oui, montrer le code',
    cancelLabel: 'Non, lancer directement'
  });
  if (!partager) { lancerLaPartie(); return; }

  try {
    const session = await ouvrirSuiviSeul();
    afficherPartageSuivi(
      creerQrSvg(adresseInvitation(), { taille: 190 }),
      session.code,
      adresseLisible()
    );
    showScreen('screen-suivi-partage');
  } catch (err) {
    // Pas de réseau, ou stockage non configuré : la partie n'a pas à en pâtir.
    // On le dit, et on lance — le suivi est un supplément, pas une condition.
    await showDialog({
      title: 'Suivi indisponible',
      message: `${err.message} La partie peut commencer sans.`,
      confirmLabel: 'Lancer la partie'
    });
    lancerLaPartie();
  }
}

// ===== REJEU D'UNE PARTIE À THÈMES =====
// Le même écran que dans l'assistant, mais en bout de course : ni étape, ni
// retour en arrière, et « Suivant » devient « C'est parti ». Les équipes et les
// manches ne sont pas rejouées, elles n'ont pas changé.

function majBoutonRejeuThemes(themes) {
  const bouton = document.getElementById('btn-next-step');
  const pret = themes.size > 0;
  bouton.disabled = !pret;
  document.getElementById('themes-hint').textContent = pret
    ? 'Prêt à lancer, avec un paquet tout neuf.'
    : 'Choisis au moins un thème : le paquet sera renouvelé.';
}

function ouvrirChoixDesThemesEnRejeu() {
  rejeuThemes = true;
  // Les invités attendaient les résultats : leur dire que ça repart, sinon ils
  // resteraient sur le tableau de la partie précédente jusqu'au premier tour.
  publierEtat('configuration');

  document.getElementById('themes-etape').style.display = 'none';
  document.getElementById('btn-themes-retour').style.display = 'none';
  document.getElementById('themes-titre').textContent = 'Une nouvelle partie';
  document.getElementById('btn-next-step').textContent = "C'est parti ! 🚀";

  refreshThemeSelector();
  majBoutonRejeuThemes(game.selectedThemes);
  showScreen('screen-themes');
}

// Retour à l'assistant : l'écran des thèmes redevient une étape parmi d'autres.
function quitterLeRejeuDesThemes() {
  if (!rejeuThemes) return;
  rejeuThemes = false;
  document.getElementById('themes-etape').style.display = '';
  document.getElementById('btn-themes-retour').style.display = '';
  document.getElementById('themes-titre').textContent = 'Choisis tes thèmes';
  document.getElementById('themes-hint').textContent = 'Sélectionne un ou plusieurs thèmes';
  const bouton = document.getElementById('btn-next-step');
  bouton.textContent = 'Suivant ▶️';
  bouton.disabled = false;
}

// L'organisateur a montré le code : la session change de métier, elle sert
// maintenant à publier l'état de la partie.
function lancerAvecSuivi() {
  const session = sessionCourante();
  if (session) activerSuivi(session.code, session.jeton);
  lancerLaPartie();
}

function startCustomCardsEntry() {
  collectActiveRounds();
  syncTeamNamesFromInputs();
  if (game.nominativeMode) {
    if (game.players.length < 4) {
      showDialog({
        title: 'Pas assez de joueurs',
        message: "Il faut au moins 4 joueurs pour jouer avec les noms. Sinon, passe en mode sans les noms.",
        confirmLabel: 'Compris'
      });
      return;
    }
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
  if (raw.length < 2) {
    showDialog({ title: 'Carte trop courte', message: 'Une carte doit faire au moins 2 caractères.', confirmLabel: 'Compris' });
    return;
  }
  if (customEntry.currentCards.length >= customEntry.currentTarget) return;
  const norm = raw.toLocaleLowerCase();
  const allExisting = [...game.customCards, ...customEntry.currentCards].map(c => c.toLocaleLowerCase());
  if (allExisting.includes(norm)) {
    showDialog({ title: 'Carte en double', message: 'Cette carte a déjà été saisie pour cette partie.', confirmLabel: 'Compris' });
    return;
  }
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
// Les contrôles sont séparés du lancement : sur une partie à thèmes, la
// proposition de partager le suivi s'intercale entre les deux, et elle ne doit
// pas s'afficher pour une configuration qui sera de toute façon refusée.
function preparerLancement() {
  collectActiveRounds();
  syncTeamNamesFromInputs();
  if (game.nominativeMode) {
    if (game.assignMode === 'chosen') syncChosenTeams();
    else assignTeamsRoundRobin();
    if (game.teams.some(team => team.players.length === 0)) {
      showDialog({
        title: 'Une équipe est vide',
        message: "Chaque équipe doit compter au moins un joueur. Change l'équipe d'un joueur avant de lancer.",
        confirmLabel: 'Compris'
      });
      return false;
    }
  }
  return true;
}

function lancerLaPartie() {
  resetGame();
  buildDeck(THEMES);
  beginRound();
}

function startGame() {
  if (preparerLancement()) lancerLaPartie();
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
  updateRoundScreen(round, game.teams, getRoundLabel(), getRoundScores(),
                    libelleRestantes(getCardsRemaining()), libelleReport());
  updateTurnInfo(game.teams[game.currentTeam].name);
  updateCurrentPlayer(game.nominativeMode ? getCurrentPlayer() : null);
  afficherBoutonEquipes(game.nominativeMode && game.teams.some(e => e.players.length > 0));
  afficherRetourCorrection();
  repartirLEcranDeLancement(true);
  showScreen('screen-round');
  // Le tout premier écran de la partie n'est pas « entre deux tours »
  publierEtat(game.currentRound === 0 && getRoundScores().every(s => s === 0)
    ? 'attente' : 'entre-tours');
  confierLeTourSiPossible();
}

// ===== LE TOUR JOUÉ DEPUIS LE TÉLÉPHONE DU JOUEUR =====
// Quand celui qui doit faire deviner a un téléphone dans la session, on lui
// confie le paquet : il jouera dessus. Sinon rien ne change, l'organisateur
// mène le tour depuis son appareil comme il l'a toujours fait.

let tourConfieA = null;      // idJoueur du tour en cours, ou null

function telephoneDuJoueurCourant() {
  if (!game.nominativeMode || !sessionCourante()) return null;
  const joueur = getCurrentPlayer();
  return joueur ? (game.playerPhones?.[joueur] || null) : null;
}

async function confierLeTourSiPossible() {
  arreterLeGuet();
  tourConfieA = null;
  const idJoueur = telephoneDuJoueurCourant();
  afficherAttenteDuJoueur(null);
  if (!idJoueur) return;

  const round = getActiveRound();
  try {
    await confierTour(
      idJoueur,
      game.deck.slice(game.currentCardIndex),
      // Une manche ouverte sur un report se joue sur ce qu'il restait, pas sur
      // un tour plein : le téléphone doit partir avec la bonne durée.
      game.reportTemps > 0 ? game.reportTemps : game.turnTime,
      { numero: game.currentRound + 1, sur: game.activeRounds.length,
        nom: round.name, icone: round.icon, regle: round.desc },
      game.reportTemps > 0
    );
    tourConfieA = idJoueur;
    afficherAttenteDuJoueur(getCurrentPlayer());
    guetterLeRetourDuTour();
  } catch {
    // Réseau absent : le tour se jouera ici, comme avant. Rien à dire au joueur.
  }
}

// L'organisateur attend que le joueur lance : son bouton cède la place à une
// mention, et à la porte de sortie s'il ne répond pas.
function afficherAttenteDuJoueur(prenom) {
  const bouton = document.getElementById('btn-start-turn');
  const attente = document.getElementById('attente-du-joueur');
  // La mention et la porte de sortie ne sont plus dans le même bloc : l'une
  // prend la place du bouton de lancement, l'autre vit en bas de l'écran.
  const mention = document.getElementById('attente-joueur-nom');
  bouton.style.display = prenom ? 'none' : '';
  attente.style.display = prenom ? '' : 'none';
  mention.style.display = prenom ? '' : 'none';
  if (prenom) {
    mention.textContent = `📱 ${prenom} lance depuis son téléphone`;
  } else {
    afficherTourDistant(false);
  }
}

// Le tour a démarré ailleurs. L'organisateur n'a plus rien à décider : il
// devient un spectateur comme les autres, et voit le même sablier qu'eux.
function afficherTourDistant(actif) {
  if (!actif) {
    document.getElementById('bloc-tour-distant').style.display = 'none';
    document.getElementById('bloc-comptage-distant').style.display = 'none';
  }
  // La mention ne se rallume que si l'on attend encore quelqu'un : elle n'est
  // plus protégée par un bloc parent, un affichage systématique la ferait
  // réapparaître avec un texte périmé.
  const attendUnJoueur = document.getElementById('attente-du-joueur').style.display !== 'none';
  document.getElementById('attente-joueur-nom').style.display =
    (!actif && attendUnJoueur) ? '' : 'none';
  // Le reste de l'écran de lancement n'a plus lieu d'être pendant le tour.
  // « C'est au tour de » et le prénom du joueur en font partie : le bloc du
  // tour distant dit déjà qui fait deviner, deux lignes plus bas.
  ['round-header', 'round-scores', 'bloc-tour-a-venir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = actif ? 'none' : '';
  });
  // Pendant le tour d'un autre, l'écran ne porte plus qu'un sablier : réparti
  // sur toute la hauteur, il se retrouverait collé en haut.
  repartirLEcranDeLancement(!actif);
  // La composition des équipes suit sa propre règle : elle n'existe qu'en mode
  // nominatif. La rétablir sans condition la ferait apparaître en mode simple.
  if (actif) document.getElementById('btn-voir-equipes').style.display = 'none';
  else afficherBoutonEquipes(game.nominativeMode && game.teams.some(e => e.players.length > 0));
  if (!actif) sablierDistant.oublier();
}

// Le joueur ne répond pas : l'organisateur récupère le tour sur son appareil.
//
// Deux précautions. D'abord on demande confirmation : le geste coupe le tour de
// quelqu'un d'autre au milieu d'une partie, il ne doit pas partir sur un doigt
// posé de travers. Ensuite, si le tour avait déjà démarré là-bas, on reprend le
// temps qu'il restait au joueur — repartir d'un tour plein lui offrirait des
// secondes qu'il n'avait plus.
async function reprendreLeTourIci() {
  const qui = getCurrentPlayer();
  const enCours = sablierDistant.actif();
  const restant = enCours ? sablierDistant.restant() : 0;

  const confirme = await showDialog({
    title: 'Reprendre ce tour ici ?',
    message: enCours
      ? `Le tour de ${qui} s'arrêtera sur son téléphone. Il reprendra ici, avec les ${restant} s qu'il lui restait.`
      : `${qui} ne pourra plus lancer depuis son téléphone : le tour se jouera sur cet appareil.`,
    confirmLabel: 'Reprendre le tour',
    cancelLabel: 'Le laisser jouer',
    danger: true
  });
  if (!confirme) return;

  arreterLeGuet();
  // Marquer le tour comme repris plutôt que l'effacer : c'est ce qui permet au
  // téléphone du joueur de rendre les cartes qu'il avait trouvées. Elles ne
  // vivent que chez lui, et il ne les envoie qu'en apprenant qu'il est dessaisi.
  try { await reprendreTour(); } catch { /* le tour expirera tout seul */ }
  tourConfieA = null;

  // Dire tout de suite que ce tour est fini. Sans ça, le dernier état publié
  // reste le tour en cours pendant qu'on va chercher le décompte du joueur :
  // le sablier continue de couler sur tous les écrans — y compris celui du
  // joueur qu'on vient de dessaisir, qui regarde son propre tour s'écouler
  // alors que plus personne ne joue.
  //
  // Reprendre son numéro de version d'abord : pendant son tour c'est lui qui
  // publiait, et une publication au numéro inférieur est rejetée en silence.
  try { reprendreVersion((await suivreEtat()).suivi?.v); } catch { /* au prochain coup */ }
  afficherTourDistant(false);
  publierEtat('entre-tours');

  const rendu = enCours ? await attendreLeComptageDuJoueur(qui) : null;
  try { await reprendreTour(true); } catch { /* la clé expirera d'elle-même */ }

  // Ses cartes comptent : on les applique comme un tour rendu normalement.
  // Le temps qu'il indique fait foi sur celui qu'on avait estimé — il tenait
  // le chrono, nous le reconstituions.
  if (rendu) appliquerTourDistant(rendu.trouvees);
  const secondes = rendu ? rendu.restant : restant;

  // Le même mécanisme que le report entre deux manches : le prochain tour lancé
  // ici partira de ces secondes-là, et l'écran de lancement l'annonce.
  if (secondes > 0) reporterLeTempsRestant(secondes);
  afficherTourDistant(false);
  afficherAttenteDuJoueur(null);
  saveGame(game);
  // On redessine l'écran de lancement sans repasser par showRoundScreen : celui-ci
  // reconfierait le tour au téléphone qu'on vient justement de dessaisir.
  updateRoundScreen(getActiveRound(), game.teams, getRoundLabel(), getRoundScores(),
                    libelleRestantes(getCardsRemaining()), libelleReport());
  // Et on le dit à tout le monde. Sans cette publication, le dernier état connu
  // des autres téléphones reste le tour qu'on vient d'interrompre : son décompte
  // finit à zéro chez eux pendant que l'écran de l'organisateur annonce le temps
  // repris. Deux écrans, deux vérités.
  //
  publierEtat('entre-tours');

  if (rendu && rendu.trouvees.length) {
    await showDialog({
      title: `${rendu.trouvees.length} carte(s) récupérée(s)`,
      message: `Ce que ${qui} avait trouvé est compté. Le tour reprend ici avec ${secondes} s.`,
      confirmLabel: 'Compris'
    });
  } else if (enCours && !rendu) {
    await showDialog({
      title: 'Son téléphone n\'a pas répondu',
      message: `Impossible de récupérer ce que ${qui} avait trouvé : ces cartes ne sont pas comptées. Le tour reprend ici avec ${secondes} s.`,
      confirmLabel: 'Compris'
    });
  }
}

// Entre la reprise et le lancement, on laisse au téléphone du joueur le temps
// de rendre son décompte. Il vérifie toutes les deux secondes et demie qu'il
// tient encore le tour : quelques secondes suffisent donc, sauf s'il est éteint
// ou hors réseau — le cas même qui pousse à reprendre un tour.
const ATTENTE_COMPTAGE_MS = 7000;

async function attendreLeComptageDuJoueur(qui) {
  const mention = document.getElementById('attente-joueur-nom');
  mention.textContent = `⏳ On récupère le décompte de ${qui}…`;
  const bouton = document.getElementById('btn-reprendre-tour');
  bouton.disabled = true;

  const limite = Date.now() + ATTENTE_COMPTAGE_MS;
  try {
    while (Date.now() < limite) {
      let tour;
      try { ({ tour } = await lireTour()); } catch { tour = null; }
      if (tour?.rendu) return tour.rendu;
      await new Promise(r => setTimeout(r, 600));
    }
  } finally {
    bouton.disabled = false;
  }
  return null;
}

// L'organisateur attend que le tour lui revienne. C'est sa seule interrogation
// pendant qu'un autre joue : le sablier des invités, lui, tourne tout seul.
const RYTHME_GUET_MS = 2000;
let guetDuTour = null;

function arreterLeGuet() {
  clearInterval(guetDuTour);
  guetDuTour = null;
}

// Le même sablier que celui des invités : pendant qu'un autre joue,
// l'organisateur ne décide plus rien, il regarde comme eux.
const sablierDistant = creerSablier({
  prefixe: 'org',
  chrono: 'distant-chrono',
  blocChrono: 'distant-bloc-chrono',
  manche: 'distant-manche',
  qui: 'distant-qui',
  mention: 'distant-mention',
  restantes: 'distant-restantes'
});
document.getElementById('distant-bloc-chrono')
  .insertAdjacentHTML('beforeend', svgSablier('org'));

// L'écran de lancement occupe toute la hauteur ; le sablier d'un tour joué
// ailleurs, non. C'est le même écran, mais pas le même contenu.
function repartirLEcranDeLancement(reparti) {
  const bloc = document.querySelector('#screen-round .round-content');
  if (bloc) bloc.classList.toggle('reparti', reparti);
}

// L'écran de lancement ne change pas : c'est le même tour, avec un temps plus
// court. Une ligne suffit à le dire — sans elle, le chrono partirait à 12 s
// sans que personne comprenne pourquoi.
function libelleReport() {
  const s = game.reportTemps;
  // « Écourté » sonnerait comme une punition : c'est l'inverse, l'équipe a
  // gagné ce temps en vidant le paquet. Formulation neutre, qui vaut aussi
  // bien pour une équipe que pour un joueur nommé.
  // Le « s » de secondes est ce qui distingue cette ligne de « Cartes
  // restantes », deux lignes au-dessus : les deux parlent de ce qui reste,
  // l'une en secondes, l'autre en cartes.
  return s > 0 ? `⏱️ Temps restant : ${s} s` : '';
}

// Le libellé du paquet restant, comme sur la page des invités.
function libelleRestantes(n) {
  if (typeof n !== 'number') return '';
  if (n <= 0) return 'Plus de cartes';
  if (n === 1) return 'Dernière carte !';
  return `Cartes restantes : ${n}`;
}

function guetterLeRetourDuTour() {
  arreterLeGuet();
  guetDuTour = setInterval(async () => {
    if (!tourConfieA) return arreterLeGuet();
    let tour;
    try { ({ tour } = await lireTour()); } catch { return; }

    // Le tour a disparu du serveur : il a expiré, ou l'organisateur l'a repris
    // depuis un autre écran. On rend la main à cet appareil.
    if (!tour) {
      arreterLeGuet();
      tourConfieA = null;
      afficherAttenteDuJoueur(null);
      return;
    }
    if (!tour.rendu) return suivreLeTourDistant();

    arreterLeGuet();
    tourConfieA = null;
    afficherTourDistant(false);
    // Reprendre le compte du joueur avant de publier quoi que ce soit : le
    // sien a pris de l'avance pendant son tour.
    try { reprendreVersion((await suivreEtat()).suivi?.v); } catch { /* on publiera au prochain coup */ }
    appliquerLeTourRendu(tour.rendu);
  }, RYTHME_GUET_MS);
}

// Le joueur a lancé : on lit l'état qu'il publie, exactement comme un invité.
// Une seule publication au départ suffit à faire tourner le sablier.
async function suivreLeTourDistant() {
  let reponse;
  try { reponse = await suivreEtat(); } catch { return; }
  // Le tour a pu revenir pendant cette lecture. Sans ce contrôle, une réponse
  // partie avant la reprise revenait après coup et réaffichait le tour distant
  // par-dessus l'écran de lancement : l'organisateur restait devant l'écran
  // précédent, sans son bouton.
  if (!tourConfieA) return;
  const suivi = reponse.suivi;
  // « pause » compte aussi : le joueur a arrêté son chrono, et le sablier doit
  // se figer ici comme chez lui. Sans ça il continuerait de couler.
  const etape = suivi?.etat?.etape;
  const enTour = (etape === 'tour' || etape === 'pause') && !!suivi.etat.tour;
  // Le tour est fini, le joueur compte : le sablier n'a plus rien à décompter.
  const enComptage = etape === 'comptage' && !!suivi.etat.tour;
  afficherTourDistant(enTour || enComptage);
  document.getElementById('bloc-tour-distant').style.display = enTour ? '' : 'none';
  document.getElementById('bloc-comptage-distant').style.display = enComptage ? '' : 'none';
  if (enTour) {
    sablierDistant.ancrer(suivi.etat, suivi.publieA, reponse.serveur, libelleRestantes);
  }
  if (enComptage) {
    sablierDistant.oublier();
    const T = (id, texte) => { document.getElementById(id).textContent = texte; };
    const m = suivi.etat.manche;
    const surLePaquet = suivi.etat.tour.raison === 'paquet';
    T('dc-manche', m ? `Manche ${m.numero}/${m.sur} · ${m.icone} ${m.nom}` : '');
    T('dc-emoji', surLePaquet ? '🃏' : '⏰');
    T('dc-titre', surLePaquet ? 'Fin du tour !' : 'Temps écoulé !');
    T('dc-qui', `${suivi.etat.tour.joueur} compte ses cartes`);
  }
}

// Le joueur a rendu son tour : on le rejoue ici, puis la partie enchaîne
// exactement comme après un tour mené depuis cet appareil.
function appliquerLeTourRendu(rendu) {
  appliquerTourDistant(rendu.trouvees);
  // Même règle qu'à la fin d'un tour joué ici : le joueur qui a vidé le paquet
  // avant la fin du temps garde la main sur la manche suivante. Les secondes
  // viennent de son téléphone — c'est lui qui tenait le chrono.
  const reporte = isRoundOver() ? reporterLeTempsRestant(rendu.restant) : 0;
  if (!reporte) {
    if (game.nominativeMode) advancePlayer();
    switchTeam();
  }
  saveGame(game);
  afficherAttenteDuJoueur(null);
  onNextTurn();
}

function startTurn() {
  beginTurn();
  unlockAudio();   // le clic sur « Lancer le tour » est le geste qui autorise l'audio
  saveGame(game);
  publierEtat('tour');
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
    // Paquet épuisé : on passe quand même par le récapitulatif du tour, sinon
    // le dernier tour de chaque manche serait le seul non corrigeable.
    endTurn(true);
    return;
  }
  showCard(word, getCardsRemaining());
}

function onFound() {
  cardFound();
  saveGame(game);
  publierEtat('tour');
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
  // Le chrono est arrêté : `game.timeLeft` ne bouge plus, et les battements
  // republieront donc la même valeur figée jusqu'à la reprise.
  publierEtat('pause');
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
      publierEtat('tour');
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
async function abandonGame() {
  const confirme = await showDialog({
    title: 'Abandonner la partie ?',
    message: "Les scores seront perdus et la partie ne pourra plus être reprise.",
    confirmLabel: 'Abandonner',
    cancelLabel: 'Continuer à jouer',
    danger: true
  });
  if (!confirme) return;
  stopTimer();
  clearInterval(resumeCountdown);
  resumeCountdown = null;
  hidePause();
  game.turnActive = false;
  clearSavedGame();
  // Plus de partie, plus rien à publier : les invités verront le silence
  couperSuivi();
  refreshResumeOption();
  showScreen('screen-home');
}

// paquetVide : le tour s'arrête faute de cartes, pas faute de temps
function endTurn(paquetVide = false) {
  stopTimer();
  closeTurn();

  turnEndTitle = paquetVide ? '🃏 Plus de cartes !' : '⏰ Temps écoulé !';
  const teamName = game.teams[game.turnTeam].name;
  turnEndLabel = game.nominativeMode && game.turnPlayer
    ? `${game.turnPlayer} (${teamName})`
    : teamName;

  // Paquet vidé avant la fin du temps : la même équipe, et le même joueur,
  // enchaînent sur la manche suivante avec ce qui reste au chrono. On ne passe
  // donc la main ni à l'équipe suivante ni au joueur suivant.
  const reporte = paquetVide ? reporterLeTempsRestant() : 0;
  if (!reporte) {
    if (game.nominativeMode) advancePlayer();
    switchTeam();
  }
  saveGame(game);
  publierEtat('entre-tours');
  renderTurnEnd();
  showScreen('screen-turn-end');
}

// Récapitulatif du tour, rejoué à chaque correction pour que le score suive
function renderTurnEnd() {
  showTurnResult(
    {
      title: turnEndTitle,
      teamName: turnEndLabel,
      score: game.turnScore,
      found: game.turnFound || [],
      missed: game.turnMissed || []
    },
    onUncountCard,
    onCountCard
  );
}

// Une correction change le score : les invités doivent voir la même chose que
// l'organisateur, sans quoi ils garderaient un total démenti à l'écran suivant.
function onUncountCard(word) {
  if (!uncountCard(word)) return;
  saveGame(game);
  publierEtat('entre-tours');
  renderTurnEnd();
}

function onCountCard(word) {
  if (!countCard(word)) return;
  saveGame(game);
  publierEtat('entre-tours');
  renderTurnEnd();
}

// Revenir sur le comptage du tour qui vient de s'achever. Le « Suivant » de cet
// écran se clique vite, souvent avant d'avoir vu qu'une carte manquait.
function revenirALaCorrection() {
  if (!game.turnCorrigeable) return;
  renderTurnEnd();
  showScreen('screen-turn-end');
}

function afficherRetourCorrection() {
  const visible = !!game.turnCorrigeable;
  ['btn-retour-correction', 'btn-retour-correction-manche'].forEach(id => {
    const bouton = document.getElementById(id);
    if (bouton) bouton.style.display = visible ? '' : 'none';
  });
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
  // Le score de la manche est figé avant la sauvegarde : une coupure sur cet
  // écran ne doit pas faire disparaître la ligne qu'on vient d'afficher.
  recordRound();
  saveGame(game);
  publierEtat('fin-manche');
  showRoundEnd(`${game.currentRound + 1}/${game.activeRounds.length}`, game.teams, getRoundHistory());
  afficherRetourCorrection();

  const btnNext = document.getElementById('btn-next-round');
  if (isGameOver()) {
    btnNext.textContent = "Voir les résultats 🏆";
    btnNext.onclick = () => {
      clearSavedGame();
      // Le cumul de la soirée n'est affiché qu'à partir de la deuxième partie
      const session = game.gamesPlayed > 0
        ? { totals: getSessionScores(), parties: game.gamesPlayed + 1 }
        : null;
      publierEtat('fin-partie');
      showFinalScreen(game.teams, session, getRoundHistory());
      if (game.nominativeMode) {
        renderPlayerStats(getPlayerBreakdown(), game.teams, getRoundHistory(),
                          session ? session.parties : 0);
      } else {
        document.getElementById('player-stats').innerHTML = '';
      }
      showScreen('screen-final');
    };
  } else {
    btnNext.textContent = 'Manche suivante ▶️';
    btnNext.onclick = () => {
      nextRound();
      beginRound();
    };
  }

  showScreen('screen-round-end');
}

// ===== LIBRARY FUNCTIONS =====
function refreshThemeSelector() {
  renderThemeButtons(THEMES, game.selectedThemes, document.getElementById('theme-selector'),
                     rejeuThemes ? majBoutonRejeuThemes : null);
}

function renderCustomThemesList() {
  renderCustomThemes(getCustomThemes(), openThemeEditor, confirmDeleteTheme);
}

async function confirmDeleteTheme(id) {
  const themes = getCustomThemes();
  if (!themes[id]) return;

  const theme = themes[id];
  const confirme = await showDialog({
    title: `Supprimer « ${theme.name} » ?`,
    message: `Ses ${theme.words.length} carte(s) seront effacées définitivement. Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
    cancelLabel: 'Garder ce thème',
    danger: true
  });
  if (!confirme) return;

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

  if (!themeName) {
    showDialog({ title: 'Nom manquant', message: "Donne un nom à ton thème avant de lancer la génération.", confirmLabel: 'Compris' });
    return;
  }

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

  showDialog({
    title: 'Thème enregistré',
    message: `« ${themeName} » rejoint ta bibliothèque et apparaît dès maintenant dans la sélection des thèmes.`,
    confirmLabel: 'Parfait'
  });
  showScreen('screen-library');
  renderCustomThemesList();
}

// ===== QUIT (global for HTML onclick) =====
window.confirmQuit = async function() {
  const confirme = await showDialog({
    title: 'Quitter la partie ?',
    message: "Rien n'est perdu : tu pourras la reprendre depuis l'accueil, là où tu t'es arrêté.",
    confirmLabel: 'Quitter',
    cancelLabel: 'Continuer à jouer'
  });
  if (confirme) quitToHome();
};

window.showScreen = showScreen;

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ===== LAUNCH =====
init();
