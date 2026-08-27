// ===== SESSION DE SAISIE PARTAGÉE — CÔTÉ ORGANISATEUR =====
// Dialogue avec /api/session. Ne touche ni au DOM, ni aux règles du jeu :
// app.js s'en sert, ui.js affiche le résultat.
//
// L'état de la session (code, jeton) vit ici et nulle part ailleurs : c'est le
// seul module qui sait comment parler au serveur.

const ROUTE = '/api/session';

// Deux secondes : assez court pour que l'organisateur voie les joueurs arriver,
// assez long pour ne pas vider la batterie ni le quota du stockage.
const PERIODE_RAFRAICHISSEMENT_MS = 2000;

let courante = null;      // { code, jeton, cartesParJoueur, mode }
let minuterie = null;

export function sessionCourante() {
  return courante;
}

export function oublierSession() {
  arreterSuivi();
  courante = null;
}

// Reprise après un rechargement de page. Le code et le jeton, eux, ont survécu
// dans le stockage du suivi ; ce module-ci n'a pas de mémoire, et sans cette
// reprise l'organisateur cesse silencieusement de confier les tours aux
// téléphones : il se retrouve à pouvoir lancer le tour d'un autre depuis le sien.
export function reprendreSession(code, jeton) {
  if (!code || !jeton || courante) return courante;
  courante = { code, jeton };
  return courante;
}

async function appeler(action, donnees = {}) {
  const reponse = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...donnees })
  });

  let corps = {};
  try { corps = await reponse.json(); } catch { /* réponse vide */ }

  if (!reponse.ok) {
    const erreur = new Error(corps.error || 'Le service est indisponible.');
    erreur.statut = reponse.status;
    erreur.details = corps;
    throw erreur;
  }
  return corps;
}

// Le mode de jeu (avec ou sans les noms) est choisi après la saisie : la session
// n'a pas besoin de le connaître, et la page des invités demande le prénom
// dans tous les cas.
// joueursAttendus : liste fermée, quand on rejoue avec les mêmes personnes.
// Les invités choisissent alors leur prénom au lieu de le saisir.
export async function ouvrirSession(cartesParJoueur, joueursAttendus = []) {
  const reponse = await appeler('creer', { cartesParJoueur, joueursAttendus });
  courante = {
    code: reponse.code,
    jeton: reponse.jeton,
    cartesParJoueur: reponse.cartesParJoueur,
    mode: reponse.mode
  };
  return courante;
}

// Partie jouée avec des thèmes prédéfinis : rien à saisir, la session ne sert
// qu'à donner un code aux invités qui veulent regarder. Elle naît close, et la
// page des invités les fait entrer directement en spectateurs.
export async function ouvrirSuiviSeul() {
  const reponse = await appeler('creer', { suiviSeul: true });
  courante = {
    code: reponse.code,
    jeton: reponse.jeton,
    cartesParJoueur: reponse.cartesParJoueur,
    mode: reponse.mode,
    suiviSeul: true
  };
  return courante;
}

// Partie à thèmes en mode nominatif : les invités donnent leur prénom, et rien
// d'autre. La session reste ouverte le temps des inscriptions, puis sert à suivre.
export async function ouvrirInscription() {
  const reponse = await appeler('creer', { inscription: true });
  courante = {
    code: reponse.code,
    jeton: reponse.jeton,
    cartesParJoueur: reponse.cartesParJoueur,
    mode: reponse.mode,
    inscription: true
  };
  return courante;
}

// Adresse à encoder dans le QR code. Construite depuis l'adresse courante :
// aucune configuration à maintenir entre le développement et la production.
export function adresseInvitation(code = courante?.code) {
  return `${window.location.origin}/rejoindre.html?c=${code}`;
}

export function adresseLisible() {
  return `${window.location.host}/rejoindre`;
}

export function lireEtat() {
  return appeler('etat', { code: courante.code });
}

// Un joueur qui n'a pas encore été inscrit n'a pas d'identifiant : c'est
// l'inscription qui lui en donne un.

// L'organisateur s'inscrit lui-même, ou inscrit un joueur qui n'a pas de téléphone.
export function inscrire(prenom, role) {
  return appeler('rejoindre', { code: courante.code, jeton: courante.jeton, prenom, role });
}

export function deposerCartes(idJoueur, cartes, fini) {
  return appeler('deposer', { code: courante.code, idJoueur, cartes, fini });
}

export function retirerJoueur(idJoueur) {
  return appeler('retirer', { code: courante.code, jeton: courante.jeton, idJoueur });
}

// Rejouer avec les mêmes joueurs : la session est recyclée, pas refaite.
// Le code de la soirée ne change pas, donc personne ne rescanne — et le
// téléphone des invités, qui connaît déjà ce code, découvre la nouvelle partie.
export async function relancerSession(cartesParJoueur) {
  const reponse = await appeler('relancer', {
    code: courante.code, jeton: courante.jeton, cartesParJoueur
  });
  courante = { ...courante, cartesParJoueur: reponse.cartesParJoueur };
  return reponse;
}

// ===== Le tour confié à un joueur =====
// Les mots du tour partent vers un seul téléphone, jamais vers le suivi que
// tout le monde lit. Le paquet est prêté d'un coup : le joueur enchaîne les
// cartes sans rien redemander au serveur.

export function confierTour(idJoueur, mots, duree, manche) {
  return appeler('confierTour', {
    code: courante.code, jeton: courante.jeton, idJoueur, mots, duree, manche
  });
}

// Interrogé par l'organisateur pour savoir si le tour lui a été rendu.
export function lireTour() {
  return appeler('lireTour', { code: courante.code, jeton: courante.jeton });
}

// L'état publié, lu par l'organisateur pendant qu'un autre joue : il redevient
// spectateur, et lit la même chose que les invités.
export function suivreEtat() {
  return appeler('suivre', { code: courante.code });
}

// L'organisateur reprend la main : le tour confié n'a plus cours.
export function reprendreTour() {
  return appeler('reprendreTour', { code: courante.code, jeton: courante.jeton });
}

// Ferme la session et récupère enfin les cartes : c'est le seul appel qui les rapatrie.
export function fermerSession() {
  return appeler('fermer', { code: courante.code, jeton: courante.jeton });
}

// ===== Suivi en direct =====
// On interroge le serveur à intervalle régulier plutôt que d'ouvrir une connexion
// permanente : les fonctions de Vercel sont éphémères, elles ne savent pas
// maintenir une connexion ouverte.

export function suivre(surEtat, surErreur) {
  arreterSuivi();
  const tour = async () => {
    try {
      surEtat(await lireEtat());
    } catch (err) {
      if (surErreur) surErreur(err);
    }
  };
  tour();
  minuterie = setInterval(tour, PERIODE_RAFRAICHISSEMENT_MS);
}

export function arreterSuivi() {
  clearInterval(minuterie);
  minuterie = null;
}
