// ===== SUIVI DE PARTIE =====
// Publie un résumé de la partie pour les invités qui la regardent depuis leur
// téléphone. Ne touche jamais au DOM et ne décide d'aucune règle du jeu : il
// lit l'état et l'envoie.
//
// RÈGLE ABSOLUE : aucun mot du paquet ne doit figurer dans ce qui est publié.
// Les invités liraient les cartes avant qu'on les leur fasse deviner.
//
// Le code, le jeton et le numéro de version vivent dans leur propre entrée de
// stockage, et non dans `game` : une partie peut être reprise après un
// rechargement, et la publication doit reprendre avec elle. Si le numéro de
// version repartait à zéro, l'invité le verrait reculer et croirait que rien
// n'a changé.
//
// Tout échec est silencieux : le suivi est un supplément, il ne doit jamais
// empêcher de jouer. Une partie sans réseau se déroule normalement.

import { game, ROUNDS, getRoundScores, getRoundHistory, getCurrentPlayer,
         getSessionScores, getPlayerBreakdown, getCardsRemaining } from './game.js';

const ROUTE = '/api/session';
const CLE = 'timesup_suivi';

// L'organisateur republie le même état à intervalle régulier, sans changer de
// version. L'invité n'y voit aucun changement, mais l'horodatage du serveur
// rajeunit — c'est ce qui rend une coupure détectable entre deux tours, là où
// rien ne bouge pendant des minutes tout à fait normalement.
const BATTEMENT_MS = 15000;

let etat = lireStockage();
let battement = null;
// Le moment de la partie que les battements rejouent entre deux changements.
// Au repos c'est « configuration » : tant que rien n'a été publié, la partie
// n'a pas commencé.
let etapeCourante = 'configuration';

function lireStockage() {
  try {
    const brut = localStorage.getItem(CLE);
    const lu = brut ? JSON.parse(brut) : null;
    if (lu && lu.code && lu.jeton) return lu;
  } catch {
    // stockage indisponible : on publiera sans mémoire
  }
  return null;
}

function ecrireStockage() {
  try {
    if (etat) localStorage.setItem(CLE, JSON.stringify(etat));
    else localStorage.removeItem(CLE);
  } catch {
    // sans conséquence sur la partie en cours
  }
}

export function suiviActif() {
  return !!etat;
}

// Le code et le jeton de la partie en cours, relus du stockage au chargement.
// Ce sont les seuls à survivre à un rafraîchissement : le client de session,
// lui, repart vide et doit les réadopter pour continuer à parler aux téléphones.
export function sessionSuivie() {
  return etat ? { code: etat.code, jeton: etat.jeton } : null;
}

// Appelé quand la partie démarre à partir d'une session de saisie partagée :
// le code et le jeton sont ceux de cette session, elle sert maintenant à suivre.
export function activerSuivi(code, jeton) {
  if (!code || !jeton) return;
  etat = { code, jeton, version: 0 };
  ecrireStockage();
  // « Configuration », et publiée tout de suite. Deux raisons :
  // — les battements ne doivent pas rejouer l'étape de la partie précédente
  //   (« fin de partie ») sur un état déjà remis à zéro ;
  // — surtout, ils ne doivent pas annoncer « attente », qui est l'écran de
  //   lancement de tour : l'organisateur règle encore ses équipes, et les
  //   invités verraient la partie démarrer avant l'heure.
  publierEtat('configuration');
}

// Pendant qu'un joueur tient le tour, c'est LUI qui publie — et sa numérotation
// prend de l'avance sur la nôtre. Sans reprendre son compte au retour, nos
// propres publications seraient tenues pour périmées et silencieusement
// ignorées : les invités resteraient figés sur le dernier état de son tour.
export function reprendreVersion(v) {
  if (!etat) return;
  const lu = Number(v) || 0;
  if (lu > etat.version) {
    etat.version = lu;
    ecrireStockage();
  }
}

export function couperSuivi() {
  etat = null;
  etapeCourante = 'configuration';
  ecrireStockage();
  if (battement) clearInterval(battement);
  battement = null;
}

function relancerBattement() {
  if (battement) clearInterval(battement);
  battement = setInterval(() => envoyer(true), BATTEMENT_MS);
}

// Les manches déjà jouées, pour les écrans de fin. Ailleurs c'est du poids inutile.
function historique() {
  return getRoundHistory().map(ligne => ({
    nom: ligne.round.name,
    icone: ligne.round.icon,
    scores: ligne.scores
  }));
}

// Le résumé envoyé aux invités.
// etape : 'attente' | 'tour' | 'pause' | 'interruption' | 'entre-tours'
//       | 'comptage' | 'fin-manche' | 'fin-partie'
//
// « interruption » : l'organisateur a repris un tour lancé sur un téléphone. Ce
// n'est pas une fin de tour — le tour reprendra, avec le temps qui restait. Les
// deux se ressemblent de l'extérieur, et les confondre revient à laisser la
// table sans explication devant un tour qui disparaît.
// `celuiQuiVientDeJouer` n'est fourni qu'au comptage. À cet instant le jeu a
// déjà fait tourner les rôles — équipe suivante, joueur suivant — et lire
// l'état du jeu nommerait donc le prochain au lieu de celui qui vient de finir.
// C'est à l'appelant de l'avoir noté avant la rotation.
function resume(etape, celuiQuiVientDeJouer) {
  const manche = ROUNDS[game.activeRounds[game.currentRound]];
  const scoresManche = getRoundScores();
  const enTour = etape === 'tour' || etape === 'pause';
  // Le comptage fait encore partie du tour du point de vue des invités : ils
  // doivent lire « X vérifie ses cartes », pas déjà le lancement du suivant.
  const enComptage = etape === 'comptage';

  const paquet = {
    etape,
    manche: manche ? {
      numero: game.currentRound + 1,
      sur: game.activeRounds.length,
      nom: manche.name,
      icone: manche.icon,
      // La consigne de la manche : les invités doivent la lire eux aussi,
      // c'est elle qui dit ce qui est permis pendant le tour.
      regle: manche.desc
    } : null,
    // Combien de cartes il reste dans le paquet de la manche. Un nombre, jamais
    // un mot : c'est ce qui dit si la manche touche à sa fin, sans rien révéler.
    restantes: getCardsRemaining(),
    // Les secondes reprises de la manche précédente, quand une équipe a vidé le
    // paquet avant la fin du temps. Sans ça, les invités voient un tour se
    // terminer bien plus tôt que prévu sans comprendre pourquoi.
    report: game.reportTemps || 0,
    equipes: game.teams.map((equipe, index) => ({
      nom: equipe.name,
      couleur: equipe.color,
      partie: equipe.score,
      manche: scoresManche[index],
      // Les prénoms, pour que les invités puissent consulter la composition.
      // En mode simple il n'y a personne à nommer.
      joueurs: game.nominativeMode ? [...equipe.players] : []
    })),
    tour: enTour ? {
      equipe: game.turnTeam,
      joueur: game.nominativeMode ? game.turnPlayer : null,
      // La durée réelle du tour, pas le réglage : un tour ouvert sur un report
      // est plus court, et le sablier des invités doit partir plein.
      duree: game.turnDuree || game.turnTime,
      // Le temps restant AU MOMENT de la publication. L'invité le rejoue à
      // partir de l'heure du serveur, sans jamais consulter sa propre horloge.
      restant: game.timeLeft
    } : (enComptage && celuiQuiVientDeJouer ? {
      equipe: celuiQuiVientDeJouer.equipe,
      joueur: celuiQuiVientDeJouer.joueur,
      // Le tour ne tourne plus : ces deux-là n'ont plus de sens ici, mais
      // l'écran des invités attend la même forme.
      duree: 0, restant: 0,
      raison: celuiQuiVientDeJouer.raison
    } : null),
    // Qui s'apprête à jouer, sur l'écran de début de tour. À ne pas confondre
    // avec `tour` : celui-ci décrit le tour en cours, et entre deux tours il
    // désignerait encore celui qui vient de finir.
    // Pendant le comptage non plus : la question n'est pas encore « qui joue
    // ensuite », et l'annoncer ferait défiler le tour suivant trop tôt.
    aVenir: (enTour || enComptage) ? null : {
      equipe: game.currentTeam,
      joueur: game.nominativeMode ? getCurrentPlayer() : null
    }
  };

  if (etape === 'fin-manche' || etape === 'fin-partie') paquet.historique = historique();

  // La fin de partie porte tout ce que voit l'organisateur : le cumul des
  // parties enchaînées, et le détail de chaque joueur manche par manche.
  if (etape === 'fin-partie') {
    if (game.gamesPlayed > 0) {
      paquet.cumul = { totaux: getSessionScores(), parties: game.gamesPlayed + 1 };
    }
    if (game.nominativeMode) {
      paquet.joueurs = getPlayerBreakdown().map(j => ({
        nom: j.name, equipe: j.team,
        parManche: j.perRound, total: j.total,
        // Le cumul de la série : c'est lui qu'affiche l'invité dès la
        // deuxième partie, dans les mêmes colonnes.
        serieParManche: j.seriePerRound, serieTotal: j.serieTotal
      }));
    }
  }
  return paquet;
}

// secondEssai : on ne se resynchronise qu'une fois, pour ne pas boucler si le
// serveur refusait toujours.
async function envoyer(battementSeul, secondEssai = false) {
  if (!etat) return;
  if (!battementSeul) etat.version++;
  ecrireStockage();

  try {
    const reponse = await fetch(ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'publier',
        code: etat.code,
        jeton: etat.jeton,
        v: etat.version,
        etat: resume(etapeCourante, tourQuiSAcheve)
      })
    });

    // Publication ignorée : le serveur détient un numéro plus élevé que le
    // nôtre. C'est arrivé pendant qu'un joueur tenait le tour — c'était lui qui
    // publiait, et son compteur a pris de l'avance. On adopte son numéro et on
    // republie aussitôt.
    //
    // Sans cette reprise, l'organisateur publie dans le vide : la partie avance
    // chez lui, personne n'en sait rien, et le téléphone du joueur suivant
    // n'apprend jamais que son tour l'attend. Le rattraper ici plutôt qu'à
    // chaque endroit qui rend la main — il y en a trop pour les tenir tous.
    //
    // Jamais pour un battement, en revanche : il n'a rien à imposer, il prouve
    // seulement que l'organisateur est toujours là. Le laisser se frayer un
    // chemin lui ferait recouvrir l'écran que le joueur publie pendant son
    // tour — son chrono, puis son comptage — avec un état vieux de quinze
    // secondes. La garde de version protège aussi de ça.
    if (!secondEssai && !battementSeul) {
      const corps = await reponse.json().catch(() => null);
      const detenu = Number(corps?.v) || 0;
      if (corps?.ignore && detenu >= etat.version) {
        etat.version = detenu;
        ecrireStockage();
        return envoyer(battementSeul, true);
      }
    }
  } catch {
    // Hors ligne : les invités s'en apercevront d'eux-mêmes, faute de battement.
    // La partie, elle, continue sans rien savoir de cet échec.
  }
}

// Le seul point d'entrée depuis le jeu. Sans session active, ne fait rien —
// ce qui permet d'appeler cette fonction partout sans se soucier du mode de partie.
// Retenu entre deux publications : les battements republient le même bulletin,
// et pendant tout le comptage ils doivent continuer de nommer celui qui vient
// de jouer, pas de retomber sur l'état du jeu — qui parle déjà du suivant.
let tourQuiSAcheve = null;

export function publierEtat(etape, celuiQuiVientDeJouer) {
  if (!etat) return;
  etapeCourante = etape;
  tourQuiSAcheve = etape === 'comptage' ? (celuiQuiVientDeJouer || tourQuiSAcheve) : null;
  if (!battement) relancerBattement();
  envoyer(false);
}
