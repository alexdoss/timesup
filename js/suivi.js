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

import { game, ROUNDS, getRoundScores, getRoundHistory } from './game.js';

const ROUTE = '/api/session';
const CLE = 'timesup_suivi';

// L'organisateur republie le même état à intervalle régulier, sans changer de
// version. L'invité n'y voit aucun changement, mais l'horodatage du serveur
// rajeunit — c'est ce qui rend une coupure détectable entre deux tours, là où
// rien ne bouge pendant des minutes tout à fait normalement.
const BATTEMENT_MS = 15000;

let etat = lireStockage();
let battement = null;

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

// Appelé quand la partie démarre à partir d'une session de saisie partagée :
// le code et le jeton sont ceux de cette session, elle sert maintenant à suivre.
export function activerSuivi(code, jeton) {
  if (!code || !jeton) return;
  etat = { code, jeton, version: 0 };
  ecrireStockage();
  relancerBattement();
}

export function couperSuivi() {
  etat = null;
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
// etape : 'attente' | 'tour' | 'pause' | 'entre-tours' | 'fin-manche' | 'fin-partie'
function resume(etape) {
  const manche = ROUNDS[game.activeRounds[game.currentRound]];
  const scoresManche = getRoundScores();
  const enTour = etape === 'tour' || etape === 'pause';

  const paquet = {
    etape,
    manche: manche ? {
      numero: game.currentRound + 1,
      sur: game.activeRounds.length,
      nom: manche.name,
      icone: manche.icon
    } : null,
    equipes: game.teams.map((equipe, index) => ({
      nom: equipe.name,
      couleur: equipe.color,
      partie: equipe.score,
      manche: scoresManche[index]
    })),
    tour: enTour ? {
      equipe: game.turnTeam,
      joueur: game.nominativeMode ? game.turnPlayer : null,
      duree: game.turnTime,
      // Le temps restant AU MOMENT de la publication. L'invité le rejoue à
      // partir de l'heure du serveur, sans jamais consulter sa propre horloge.
      restant: game.timeLeft
    } : null
  };

  if (etape === 'fin-manche' || etape === 'fin-partie') paquet.historique = historique();
  return paquet;
}

let etapeCourante = 'attente';

async function envoyer(battementSeul) {
  if (!etat) return;
  if (!battementSeul) etat.version++;
  ecrireStockage();

  try {
    await fetch(ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'publier',
        code: etat.code,
        jeton: etat.jeton,
        v: etat.version,
        etat: resume(etapeCourante)
      })
    });
  } catch {
    // Hors ligne : les invités s'en apercevront d'eux-mêmes, faute de battement.
    // La partie, elle, continue sans rien savoir de cet échec.
  }
}

// Le seul point d'entrée depuis le jeu. Sans session active, ne fait rien —
// ce qui permet d'appeler cette fonction partout sans se soucier du mode de partie.
export function publierEtat(etape) {
  if (!etat) return;
  etapeCourante = etape;
  if (!battement) relancerBattement();
  envoyer(false);
}
