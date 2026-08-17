// ===== APP — Point d'entrée =====
// Orchestre les modules et gère les événements

import { loadThemes } from './themes.js';
import { game, ROUNDS, shuffle, resetGame, replayGame, buildDeck, startNewRound, getCurrentCard, cardFound, cardPassed, switchTeam, isRoundOver, isGameOver, nextRound, getCardsRemaining, addPlayer, removePlayer, assignTeamsRoundRobin, getCurrentPlayer, advancePlayer, getActiveRound, setPlayerTeam, syncChosenTeams, canPass, getPlannedTeamSizes, beginTurn, closeTurn, uncountCard, countCard, getRoundScores, getSessionScores, playerExists, recordRound, getRoundHistory, getPlayerBreakdown } from './game.js';
import { showScreen, updateTimer, showCard, updateRoundScreen, updateTurnInfo, updateGameHeader, showTurnResult, showRoundEnd, showFinalScreen, renderThemeButtons, renderPlayerList, updateCurrentPlayer, renderPlayerStats, renderRoundsSelector, renderAssignMode, applyTeamAccent, showResumeOption, renderSoundSetting, renderRules, showPauseOverlay, showPauseCountdown, hidePause, showPuppetConfirm, setRoundsNextEnabled, renderThemeEditor, showThemeEditError, renderCustomThemes, showDialog,
         afficherInvitation, renderSession, renderBoutonMesCartes, renderSaisieLocale,
         showSaisieError, renderRepartition,
         afficherEquipes, masquerEquipes, afficherBoutonEquipes } from './ui.js';
import { activerSuivi, couperSuivi, publierEtat } from './suivi.js';
import { ouvrirSession, sessionCourante, oublierSession, adresseInvitation, adresseLisible,
         inscrire, deposerCartes, retirerJoueur, fermerSession, relancerSession, lireEtat,
         suivre, arreterSuivi } from './session.js';
import { creerQrSvg } from './qr.js';
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
  document.querySelectorAll('[data-mode]').forEach(pastille => {
    pastille.classList.toggle('active',
      (pastille.dataset.mode === 'nominatif') === game.nominativeMode);
  });

  saisieMode = 'partagee';
  repartition = [];
  moiJoueur = null;
  modeRejeu = false;
  listeJoueurs = [];
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

// Effectifs par équipe, ou null quand l'app ne peut pas les connaître : mode
// simple, ou saisie partagée où les joueurs ne se sont pas encore inscrits.
// null déclenche la question posée à l'organisateur pour la manche pantin.
function effectifsConnus() {
  if (saisiePartagee() && repartition.length > 0) {
    // Mode nominatif : les équipes viennent d'être formées, on a les vrais chiffres.
    if (game.nominativeMode) {
      return game.teams.map((_, index) => repartition.filter(j => j.equipe === index).length);
    }
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
    showScreen('screen-players');
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

  // Game mode toggle (Nominatif / Simple)
  document.querySelectorAll('[data-mode]').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const mode = pill.dataset.mode;
      game.nominativeMode = (mode === 'nominatif');
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
    // En saisie partagée, l'effectif est celui des joueurs qui ont scanné ;
    // sinon, celui de la liste saisie à la main. Le mode de jeu étant choisi
    // ici, c'est ici que se vérifie le minimum.
    const effectif = saisiePartagee() ? repartition.length : game.players.length;
    if (game.nominativeMode && effectif < 4) {
      showDialog({
        title: 'Pas assez de joueurs',
        message: saisiePartagee()
          ? `Jouer avec les noms demande au moins 4 joueurs, et ${effectif} ont saisi leurs cartes. Choisis « Simple » pour jouer quand même.`
          : "Il faut au moins 4 joueurs pour jouer avec les noms. Sinon, passe en mode sans les noms.",
        confirmLabel: 'Compris'
      });
      return;
    }
    if (!game.nominativeMode) {
      game.players = [];
      game.playerAssignments = {};
      game.teams[0].players = [];
      game.teams[1].players = [];
    }
    syncTeamNamesFromInputs();

    // En saisie partagée nominative, les équipes se forment maintenant : les
    // manches pourront alors raisonner sur des effectifs exacts.
    if (joueursViennentDesScans()) {
      afficherRepartition();
      showScreen('screen-repartition');
      return;
    }
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

  // Ouverture de session : réglage du nombre de cartes
  document.getElementById('btn-joueurs-moins').addEventListener('click', () => reglerJoueursSession(-1));
  document.getElementById('btn-joueurs-plus').addEventListener('click', () => reglerJoueursSession(1));
  document.getElementById('btn-cartes-moins').addEventListener('click', () => reglerCartesSession(-1));
  document.getElementById('btn-cartes-plus').addEventListener('click', () => reglerCartesSession(1));
  document.getElementById('btn-ouvrir-session').addEventListener('click', demarrerSessionPartagee);

  // Session partagée — écran de l'organisateur
  document.getElementById('session-adresse').addEventListener('click', partagerLien);
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
    // La partie précédente est close. Sans cette coupure, ses battements
    // continuaient de publier sur l'ancien code, mais sur un état déjà remis à
    // zéro : les invités voyaient leur écran de résultats se vider. Le dernier
    // état publié reste en place, et c'est le bon — celui de la partie finie.
    couperSuivi();

    // En cartes perso, il faut de NOUVELLES cartes : sans ça on rejouerait le
    // paquet à l'identique, que tout le monde connaît déjà par cœur.
    if (saisiePartagee()) {
      modeRejeu = true;
      listeJoueurs = game.players.length ? [...game.players] : repartition.map(j => j.prenom);
      ouvrirReglageSession();
      return;
    }

    buildDeck(THEMES);
    beginRound();
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
function updateWizardLabels() {
  const steps = game.cardSource === 'themes'
    ? { mode: 1, themes: 2, players: 3, rounds: 4, config: 5 }
    : { mode: 1, session: 2, players: 3, rounds: 4, config: 5 };

  document.querySelectorAll('[data-step]').forEach(el => {
    const s = el.dataset.step;
    if (steps[s]) el.textContent = `Étape ${steps[s]}/5`;
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

function updateBlocJoueurs() {
  const bloc = document.getElementById('nominatif-block');
  const note = document.getElementById('note-joueurs-partages');
  if (!bloc) return;

  const parLesJoueurs = joueursViennentDesScans();
  bloc.style.display = game.nominativeMode && !parLesJoueurs ? '' : 'none';

  if (note) {
    note.style.display = parLesJoueurs ? '' : 'none';
    if (parLesJoueurs) {
      note.querySelector('p').textContent =
        `📱 ${repartition.length} joueur(s) ont saisi leurs cartes : ${repartition.map(j => j.prenom).join(', ')}. Tu les répartiras en équipes juste avant de jouer.`;
    }
  }

  // Une fois les cartes collectées, revenir en arrière n'a plus de sens :
  // la session est close et le paquet figé.
  const retour = document.querySelector('#screen-players .btn-back');
  if (retour) retour.style.display = saisiePartagee() ? 'none' : '';
}

// L'écran précédant les manches dépend du parcours : en saisie partagée
// nominative, la répartition des équipes s'intercale entre les deux.
window.handleBackFromRounds = function() {
  if (joueursViennentDesScans()) {
    afficherRepartition();
    showScreen('screen-repartition');
  } else {
    showScreen('screen-players');
  }
};

window.handleBackFromPlayers = function() {
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
    showScreen('screen-players');
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
    else showScreen('screen-players');
  }
}

// Repli vers la saisie sur un seul appareil. On repasse par l'étape des joueurs :
// en mode nominatif, leur liste n'a jamais été saisie puisqu'elle devait venir
// des scans — sans ce retour, l'organisateur se retrouverait sans aucun nom.
function basculerEnSequentiel() {
  arreterSuivi();
  oublierSession();
  saisieMode = 'sequentielle';
  updateSimpleCustomBlock();
  showScreen('screen-players');
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
  const partir = await showDialog({
    title: `Retirer ${joueur.prenom} ?`,
    message: `Ses ${joueur.nbCartes} carte(s) déjà envoyées seront abandonnées. Il pourra rejoindre à nouveau avec le même code.`,
    confirmLabel: 'Retirer',
    cancelLabel: 'Attendre encore',
    danger: true
  });
  if (!partir) return;

  try {
    await retirerJoueur(joueur.id);
    if (moiJoueur && moiJoueur.id === joueur.id) moiJoueur = null;
    surEtatSession(await lireEtatSansAttendre());
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
    game.customCards = resultat.cartes;

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
    showScreen('screen-players');
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
  repartition.forEach(j => { game.playerAssignments[j.prenom] = j.equipe; });
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
    startGame();
  }
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
function startGame() {
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
  updateRoundScreen(round, game.teams, getRoundLabel(), getRoundScores());
  updateTurnInfo(game.teams[game.currentTeam].name);
  updateCurrentPlayer(game.nominativeMode ? getCurrentPlayer() : null);
  afficherBoutonEquipes(game.nominativeMode && game.teams.some(e => e.players.length > 0));
  afficherRetourCorrection();
  showScreen('screen-round');
  // Le tout premier écran de la partie n'est pas « entre deux tours »
  publierEtat(game.currentRound === 0 && getRoundScores().every(s => s === 0)
    ? 'attente' : 'entre-tours');
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

  if (game.nominativeMode) advancePlayer();
  switchTeam();
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
        renderPlayerStats(getPlayerBreakdown(), game.teams, getRoundHistory());
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
