// ===== PAGE DES INVITÉS =====
// Servie à l'adresse /rejoindre.html, c'est ce qu'ouvre le QR code.
// Volontairement autonome : elle ne charge ni le moteur de jeu, ni les thèmes,
// ni le service worker. Un invité qui n'a jamais installé Rush doit voir un
// champ de saisie en une seconde, même sur un réseau de salle des fêtes.

import { creerSablier, svgSablier } from './sablier.js';
import { playFound } from './sound.js';

const ROUTE = '/api/session';
const STOCKAGE = 'timesup_rejoint';
const DELAI_ENVOI_MS = 700;      // on attend une pause de frappe avant d'envoyer

// État local, seule source de vérité de l'écran
let session = {
  code: null,
  idJoueur: null,
  prenom: '',
  cartes: [],
  cartesParJoueur: 5,
  mode: 'simple',
  fini: false
};

let minuterieEnvoi = null;
let envoiEnCours = false;
let envoiEnAttente = false;

// ===== Accès au serveur =====

async function appeler(action, donnees = {}) {
  const reponse = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...donnees })
  });

  let corps = {};
  try { corps = await reponse.json(); } catch { /* réponse vide ou illisible */ }

  if (!reponse.ok) {
    const erreur = new Error(corps.error || 'Le service est indisponible.');
    erreur.statut = reponse.status;
    erreur.details = corps;
    throw erreur;
  }
  return corps;
}

// ===== Mémoire locale =====
// Les cartes sont écrites sur le téléphone à chaque frappe : si l'invité verrouille
// son écran, reçoit un appel ou perd le réseau, il ne perd rien.

function sauvegarder() {
  try {
    localStorage.setItem(STOCKAGE, JSON.stringify(session));
  } catch { /* stockage plein : la saisie continue, sans filet */ }
}

function relire() {
  try {
    const brut = localStorage.getItem(STOCKAGE);
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

function oublier() {
  try { localStorage.removeItem(STOCKAGE); } catch { /* rien à faire */ }
}

// ===== Navigation =====

function montrer(id) {
  document.querySelectorAll('.screen').forEach(e => e.classList.toggle('active', e.id === id));
  // Quitter l'écran du prénom coupe la veille des arrivées : un seul endroit
  // pour l'arrêter vaut mieux qu'un oubli dans une des sorties.
  if (id !== 'screen-prenom') arreterLaVeille();
}

function bloquer(emoji, titre, texte, libelleBouton, action) {
  document.getElementById('message-emoji').textContent = emoji;
  document.getElementById('message-titre').textContent = titre;
  document.getElementById('message-texte').textContent = texte;

  const bouton = document.getElementById('btn-message');
  bouton.style.display = libelleBouton ? '' : 'none';
  bouton.textContent = libelleBouton || '';
  bouton.onclick = action || null;

  montrer('screen-message');
}

// Traduit une erreur du serveur en écran compréhensible
function surErreur(err, secours) {
  if (err.statut === 404) {
    return bloquer('🔍', 'Code inconnu',
      `Aucune partie ne porte le code ${session.code}. Vérifie-le sur le téléphone de l'organisateur.`,
      'Saisir un autre code', repartirDuCode);
  }
  if (err.statut === 409) {
    return bloquer('🚪', 'La partie a démarré', err.message, null, null);
  }
  if (err.statut === 503) {
    return bloquer('⌛', 'Service indisponible', err.message, 'Réessayer', secours || repartirDuCode);
  }
  return bloquer('⚠️', 'Impossible de continuer', err.message, 'Réessayer', secours || repartirDuCode);
}

function repartirDuCode() {
  oublier();
  session = { code: null, idJoueur: null, prenom: '', cartes: [], cartesParJoueur: 5, mode: 'simple', fini: false };
  document.getElementById('champ-code').value = '';
  document.getElementById('erreur-code').textContent = '';
  codeEnCours = false;
  dessinerCases();
  montrer('screen-code');
}

// ===== Étape 1 : le code, en quatre cases =====
// Les cases ne sont qu'un affichage : le champ reste seul maître de la valeur.
// C'est ce qui permet au collage, au clavier du téléphone et aux scénarios de
// test de continuer à s'adresser à lui seul.

let codeEnCours = false;

function dessinerCases() {
  const valeur = document.getElementById('champ-code').value;
  const cases = document.querySelectorAll('#code-cases .code-case');
  cases.forEach((c, i) => {
    c.textContent = valeur[i] || '';
    c.classList.toggle('pleine', i < valeur.length);
    c.classList.toggle('active', i === valeur.length);
  });
}

function refuserLeCode(message) {
  const cases = document.getElementById('code-cases');
  document.getElementById('erreur-code').textContent = message;
  cases.classList.add('faux');
  setTimeout(() => cases.classList.remove('faux'), 400);
}

// ===== REJOUER DANS LA MÊME SOIRÉE =====
// L'organisateur recycle sa session au lieu d'en ouvrir une neuve : le code ne
// change pas, personne ne rescanne. Le numéro de partie est ce qui distingue
// « celle que j'ai déjà jouée » de « une nouvelle vient de commencer ».

const numeroDePartie = etat => Number(etat?.partie) || 1;
let partieCourante = 1;

function nouvellePartieDisponible(etat) {
  return etat.ouverte === true
    && numeroDePartie(etat) > (Number(session.partie) || 1)
    && etat.joueurs.some(j => j.id === session.idJoueur);
}

function proposerRejeu(etat) {
  arreterAttente();
  partieCourante = numeroDePartie(etat);
  session.cartesParJoueur = etat.cartesParJoueur;
  document.getElementById('rejouer-question').textContent =
    `Tu rejoues, ${session.prenom} ?`;
  montrer('screen-rejouer');
}

function accepterRejeu() {
  session.cartes = [];
  session.fini = false;
  session.partie = partieCourante;
  sauvegarder();
  reinitialiserSuivi();
  ouvrirSaisie();
}

// Tout ce que l'écran de suivi retient d'une partie : les repères de progression
// et les blocs affichés. Sans cette remise à zéro, un invité qui ressaisit ses
// cartes retrouvait le tableau de scores de la partie précédente au lieu de la
// salle d'attente — la page continuait de guetter une relance déjà arrivée.
function reinitialiserSuivi() {
  saisieClose = false;
  guetterRelance = false;
  sablier.oublier();
  derniereComposition = null;
  dernierResultat = null;
  equipesConnues = null;
  monTour = null;
  ['bloc-resultats', 'bloc-lancement', 'bloc-tour', 'bloc-comptage', 'bloc-a-toi', 'btn-voir-equipes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  ['attente-joueurs', 'attente-total'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  const entete = document.getElementById('attente-titre');
  if (entete) entete.parentElement.style.display = '';
}

// « Ce n'est pas moi » : le téléphone a changé de mains. On oublie l'identité
// retenue et on repart de la liste des prénoms.
async function refuserIdentite() {
  const code = session.code;
  oublier();
  session = { code, idJoueur: null, prenom: '', cartes: [],
              cartesParJoueur: session.cartesParJoueur, mode: session.mode, fini: false };
  await validerCode(code);
}

async function quitterLaPartie() {
  const bouton = document.getElementById('btn-rejouer-quitter');
  if (bouton.dataset.confirme !== '1') {
    bouton.dataset.confirme = '1';
    bouton.textContent = 'Confirmer : je quitte la partie';
    return;
  }
  try {
    await appeler('retirer', { code: session.code, idJoueur: session.idJoueur, soiMeme: true });
  } catch {
    // Le serveur n'a pas pu retirer le joueur : l'organisateur le fera à la main
  }
  const code = session.code;
  oublier();
  bloquer('👋', 'À bientôt',
    'Tu as quitté la partie. Tu peux revenir en saisissant le code.',
    'Revenir', () => { repartirDuCode(); document.getElementById('champ-code').value = code; });
}

// ===== Étape 1 : le code =====

function codeDepuisAdresse() {
  const params = new URLSearchParams(window.location.search);
  const brut = (params.get('c') || params.get('code') || '').toUpperCase().trim();
  return /^[A-Z0-9]{4}$/.test(brut) ? brut : null;
}

async function validerCode(code) {
  session.code = code;
  document.getElementById('rappel-code').textContent = code;

  try {
    const etat = await appeler('etat', { code });
    session.cartesParJoueur = etat.cartesParJoueur;
    session.mode = etat.mode;
    partieCourante = numeroDePartie(etat);

    // Partie à thèmes : il n'y a pas de cartes à saisir, donc pas de prénom à
    // donner. On entre directement en spectateur.
    if (etat.suiviSeul) return entrerEnSpectateur();

    // Inscription : on donne son prénom, et rien d'autre.
    session.inscription = etat.inscription === true;

    if (!etat.ouverte) {
      return bloquer('🚪', 'La partie a démarré',
        "Cette partie est déjà lancée. Demande à l'organisateur d'en ouvrir une nouvelle.", null, null);
    }

    montrer('screen-prenom');
    afficherChoixPrenom(etat);
  } catch (err) {
    // Se tromper de code est l'erreur la plus courante de tout le parcours, et
    // c'est un caractère à corriger : on refuse sur place, on vide les cases et
    // on rend la main. Un écran bloquant pour une faute de frappe forçait un
    // aller-retour pour rien.
    if (err.statut === 404 && ecranActif() === 'screen-code') {
      session.code = null;
      refuserLeCode('Aucune partie ne porte ce code.');
      const champ = document.getElementById('champ-code');
      setTimeout(() => {
        champ.value = '';
        dessinerCases();
        champ.focus();
      }, 420);
      return;
    }
    surErreur(err);
  }
}

// ===== INSCRIT SANS CARTES — partie jouée avec des thèmes prédéfinis =====
// Le prénom est donné, il n'y a rien d'autre à saisir. Suivre la partie est un
// choix : un téléphone rangé n'interroge plus le serveur du tout.

// ===== SPECTATEUR — partie jouée avec des thèmes prédéfinis =====
// Personne ne saisit de cartes : il n'y a ni prénom à donner, ni identifiant à
// obtenir. On ouvre donc l'écran de suivi tout de suite, et on lit d'emblée
// l'état publié — la liste des joueurs, elle, restera vide.
function entrerEnSpectateur() {
  session.idJoueur = null;
  session.prenom = '';
  session.spectateur = true;
  sauvegarder();

  saisieClose = true;
  document.getElementById('attente-titre').textContent = 'Configuration de la partie en cours';
  document.getElementById('attente-sous').textContent =
    "L'organisateur prépare la partie. Elle démarre juste après.";
  document.getElementById('attente-roue').style.display = '';
  ['attente-joueurs', 'attente-total'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  ouvrirAttente();
}

// ===== Étape 2 : le prénom =====
// Deux formes selon la partie : saisie libre pour une partie neuve, choix dans
// une liste quand on rejoue avec les mêmes joueurs. Le choix évite les doublons,
// les fautes de frappe, et permet à l'organisateur de savoir qui manque.

// Qui a déjà rejoint. C'est la seule confirmation d'être dans la bonne partie
// avant d'avoir tout saisi — sans elle, l'invité donne son prénom puis cinq
// cartes sans savoir. L'état publié porte déjà les prénoms : rien de plus n'est
// demandé au serveur que ce qui l'était déjà.

const COULEURS_PASTILLE = ['#6D28D9', '#EF4444', '#22C55E', '#F59E0B', '#3B82F6', '#EC4899'];

// Une couleur tirée du prénom, pas du rang : elle ne change pas quand
// quelqu'un d'autre arrive avant.
function couleurDe(prenom) {
  let somme = 0;
  for (const c of prenom) somme += c.codePointAt(0);
  return COULEURS_PASTILLE[somme % COULEURS_PASTILLE.length];
}

let dejaVus = new Set();

function afficherLesArrivees(joueurs) {
  const bloc = document.getElementById('bloc-deja-la');
  const zone = document.getElementById('deja-la-gens');

  if (!joueurs.length) {
    bloc.style.display = 'none';
    zone.innerHTML = '';
    dejaVus = new Set();
    return;
  }

  bloc.style.display = '';
  document.getElementById('deja-la-titre').textContent =
    joueurs.length === 1 ? '1 joueur déjà là' : `${joueurs.length} joueurs déjà là`;

  zone.innerHTML = '';
  joueurs.forEach(j => {
    const prenom = j.prenom;
    const un = document.createElement('div');
    un.className = 'deja-un' + (dejaVus.size && !dejaVus.has(prenom) ? ' neuf' : '');

    const pastille = document.createElement('span');
    pastille.className = 'deja-pastille';
    pastille.style.background = couleurDe(prenom);
    pastille.textContent = prenom[0].toLocaleUpperCase();

    un.appendChild(pastille);
    un.appendChild(document.createTextNode(prenom));
    zone.appendChild(un);
  });

  dejaVus = new Set(joueurs.map(j => j.prenom));
}

// On regarde qui arrive tant que l'écran du prénom est ouvert. Le rythme est
// lâche : personne ne remplit ce champ en moins de quelques secondes.
let veilleArrivees = null;

function veillerAuxArrivees() {
  arreterLaVeille();
  veilleArrivees = setInterval(async () => {
    if (ecranActif() !== 'screen-prenom') return arreterLaVeille();
    try {
      const etat = await appeler('etat', { code: session.code });
      const attendus = etat.attendus || [];
      if (attendus.length > 0) return majListePrenoms(etat, attendus);
      afficherLesArrivees(etat.joueurs || []);
    } catch {
      // Le réseau qui hoquette ne doit pas vider la liste sous les yeux.
    }
  }, 4000);
}

function arreterLaVeille() {
  if (veilleArrivees) clearInterval(veilleArrivees);
  veilleArrivees = null;
}

function ecranActif() {
  const actif = document.querySelector('.screen.active');
  return actif ? actif.id : null;
}

function afficherChoixPrenom(etat) {
  const attendus = etat.attendus || [];
  const parListe = attendus.length > 0;

  document.getElementById('titre-prenom').textContent = parListe
    ? 'Qui es-tu ?'
    : "Comment tu t'appelles ?";
  document.getElementById('bloc-liste-prenoms').style.display = parListe ? '' : 'none';
  document.getElementById('bloc-saisie-prenom').style.display = parListe ? 'none' : '';
  // Rien à expliquer sur une saisie libre : la liste des arrivées montre déjà
  // que les prénoms se voient, et l'équipe n'est pas le choix du joueur.
  // La liste fermée, elle, a besoin qu'on dise pourquoi on touche un prénom
  // au lieu d'écrire le sien.
  document.getElementById('note-prenom').textContent = parListe
    ? "Cette partie rejoue avec les mêmes joueurs. Touche ton prénom pour saisir tes nouvelles cartes."
    : '';

  // La liste fermée porte déjà les prénoms et coche ceux qui sont arrivés :
  // afficher les arrivées à côté dirait deux fois la même chose.
  afficherLesArrivees(parListe ? [] : (etat.joueurs || []));

  veillerAuxArrivees();

  if (!parListe) {
    document.getElementById('champ-prenom').focus();
    return;
  }
  majListePrenoms(etat, attendus);
}

function majListePrenoms(etat, attendus) {
  const pris = new Set((etat.joueurs || []).map(j => j.prenom.toLocaleLowerCase()));
  const liste = document.getElementById('liste-prenoms');
  liste.innerHTML = '';

  attendus.forEach(prenom => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    const dejaLa = pris.has(prenom.toLocaleLowerCase());
    bouton.textContent = dejaLa ? `${prenom} ✓` : prenom;
    bouton.disabled = dejaLa;
    bouton.addEventListener('click', () => rejoindreAvec(prenom));
    liste.appendChild(bouton);
  });

  const restants = attendus.length - pris.size;
  document.getElementById('erreur-liste').textContent = restants > 0
    ? ''
    : 'Tout le monde a déjà rejoint.';
}

function validerPrenom() {
  const champ = document.getElementById('champ-prenom');
  const prenom = champ.value.trim();

  if (prenom.length < 1) {
    document.getElementById('erreur-prenom').textContent = 'Indique ton prénom pour continuer.';
    return;
  }
  rejoindreAvec(prenom);
}

async function rejoindreAvec(prenom) {
  const champ = document.getElementById('champ-prenom');
  const erreur = document.getElementById('erreur-prenom');
  const erreurListe = document.getElementById('erreur-liste');
  erreur.textContent = '';
  erreurListe.textContent = '';

  try {
    const reponse = await appeler('rejoindre', { code: session.code, prenom });
    session.idJoueur = reponse.idJoueur;
    session.prenom = reponse.prenom;
    session.cartesParJoueur = reponse.cartesParJoueur;
    session.mode = reponse.mode;
    session.cartes = [];
    session.fini = false;
    // Le numéro de la partie pour laquelle ces cartes sont saisies : c'est lui
    // qui permettra de reconnaître qu'une nouvelle partie a commencé.
    session.partie = partieCourante;
    sauvegarder();
    reinitialiserSuivi();
    // Partie à thèmes : rien à saisir. On demande seulement si ce téléphone
    // doit suivre la partie, ou rester dans une poche jusqu'au tour de son
    // propriétaire — s'inscrire et regarder sont deux choses différentes.
    // Partie à thèmes : rien à saisir, et rien à décider non plus. On suit la
    // partie, point. Celui qui ne veut pas regarder pose son téléphone.
    if (session.inscription) return ouvrirAttente();
    ouvrirSaisie();
  } catch (err) {
    // Quelqu'un a pris cette place entre l'affichage et le tap : on rafraîchit
    // la liste plutôt que de laisser un bouton qui ne marche plus.
    if (err.details?.motif === 'prenom-pris' || err.details?.motif === 'hors-liste') {
      try {
        const etat = await appeler('etat', { code: session.code });
        if ((etat.attendus || []).length > 0) {
          afficherChoixPrenom(etat);
          erreurListe.textContent = err.message;
          return;
        }
      } catch { /* on retombe sur le message simple */ }
      erreur.textContent = err.message;
      champ.select();
      return;
    }
    surErreur(err);
  }
}

// ===== Étape 3 : les cartes =====

// Sert à n'animer le compteur que quand il monte : retirer une carte ne mérite
// pas la même fête que d'en ajouter une.
let dernierCompte = 0;

function ouvrirSaisie() {
  document.getElementById('titre-cartes').textContent = `${session.prenom}, tes cartes`;
  rendreCartes();
  montrer('screen-cartes');
  document.getElementById('champ-carte').focus();
}

function rendreCartes() {
  const liste = document.getElementById('liste-cartes');
  liste.innerHTML = '';

  session.cartes.forEach((mot, index) => {
    const ligne = document.createElement('li');

    const nom = document.createElement('span');
    nom.className = 'player-name';
    nom.textContent = mot;

    const retirer = document.createElement('button');
    retirer.className = 'btn-remove';
    retirer.type = 'button';
    retirer.textContent = '✕';
    retirer.title = `Retirer « ${mot} »`;
    retirer.addEventListener('click', () => {
      session.cartes.splice(index, 1);
      surChangement();
    });

    ligne.append(nom, retirer);
    liste.appendChild(ligne);
  });

  const n = session.cartes.length;
  const cible = session.cartesParJoueur;

  // Le chiffre porte la progression, le reste de la phrase l'accompagne.
  // Le texte complet ne change pas : « 0 / 5 cartes », puis « 5 cartes — c'est bon ! »
  const compteur = document.getElementById('compteur-cartes');
  compteur.innerHTML = '';
  const chiffre = document.createElement('span');
  chiffre.className = 'cpt-n';
  chiffre.textContent = String(n);
  compteur.append(chiffre, document.createTextNode(
    n >= cible ? ` cartes — c'est bon !` : ` / ${cible} cartes`));
  if (n > dernierCompte) chiffre.classList.add('pousse');
  dernierCompte = n;

  const grains = document.getElementById('grains-cartes');
  if (grains.children.length !== cible) {
    grains.innerHTML = '';
    for (let i = 0; i < cible; i++) {
      const grain = document.createElement('span');
      grain.className = 'grain';
      grains.appendChild(grain);
    }
  }
  [...grains.children].forEach((g, i) => g.classList.toggle('plein', i < n));

  // Le bouton dit ce qu'il reste à faire tant qu'il ne peut rien faire.
  const bouton = document.getElementById('btn-terminer');
  const reste = cible - n;
  bouton.disabled = reste > 0;
  bouton.textContent = reste > 0
    ? `Encore ${reste} carte${reste > 1 ? 's' : ''}`
    : `✅ Envoyer mes ${cible} cartes`;

  // Le compte atteint, on ferme l'ajout plutôt que de refuser après coup.
  // Retirer une carte reste possible, et rouvre l'ajout.
  const complet = n >= cible;
  document.getElementById('btn-ajouter').disabled = complet;
  document.getElementById('champ-carte').disabled = complet;
}

function ajouterCarte() {
  const champ = document.getElementById('champ-carte');
  const erreur = document.getElementById('erreur-carte');
  const mot = champ.value.trim();
  erreur.textContent = '';

  if (mot.length < 2) {
    erreur.textContent = 'Une carte doit faire au moins 2 caractères.';
    return;
  }
  if (session.cartes.some(m => m.toLocaleLowerCase() === mot.toLocaleLowerCase())) {
    erreur.textContent = 'Tu as déjà saisi cette carte.';
    return;
  }
  if (session.cartes.length >= session.cartesParJoueur) {
    erreur.textContent = `L'organisateur en demande ${session.cartesParJoueur}, c'est complet.`;
    return;
  }

  session.cartes.push(mot);
  champ.value = '';
  champ.focus();
  playFound();
  surChangement();
}

// Toute modification : on enregistre localement tout de suite, on envoie après
// une courte pause. Inutile d'appeler le serveur à chaque lettre.
function surChangement() {
  session.fini = false;
  sauvegarder();
  rendreCartes();
  afficherEtatEnvoi('attente');
  clearTimeout(minuterieEnvoi);
  minuterieEnvoi = setTimeout(() => envoyer(false), DELAI_ENVOI_MS);
}

function afficherEtatEnvoi(etat) {
  const zone = document.getElementById('etat-envoi');
  zone.className = 'etat-envoi ' + etat;
  zone.textContent = {
    attente: '…',
    envoi: 'Envoi…',
    ok: 'Enregistré ✓',
    horsligne: '📡 Hors ligne — tes cartes sont gardées sur ce téléphone'
  }[etat] || '';
}

// On renvoie toujours la liste complète : le serveur remplace, il ne fusionne pas.
// Un envoi perdu est donc sans conséquence, le suivant rétablit la vérité.
async function envoyer(fini) {
  if (!session.idJoueur) return false;

  if (envoiEnCours) { envoiEnAttente = true; return false; }
  envoiEnCours = true;
  afficherEtatEnvoi('envoi');

  try {
    await appeler('deposer', {
      code: session.code,
      idJoueur: session.idJoueur,
      cartes: session.cartes,
      fini
    });
    afficherEtatEnvoi('ok');
    return true;
  } catch (err) {
    if (err.statut === 404) {
      // Retiré par l'organisateur : il faut refaire une entrée
      oublier();
      bloquer('👋', 'Tu as été retiré de la partie',
        "L'organisateur t'a retiré. Tu peux rejoindre à nouveau avec le même code.",
        'Rejoindre à nouveau', () => validerCode(session.code));
      return false;
    }
    if (err.statut === 409) {
      bloquer('🚪', 'La partie a démarré', err.message, null, null);
      return false;
    }
    afficherEtatEnvoi('horsligne');
    return false;
  } finally {
    envoiEnCours = false;
    if (envoiEnAttente) { envoiEnAttente = false; envoyer(fini); }
  }
}

async function terminer() {
  clearTimeout(minuterieEnvoi);
  const bouton = document.getElementById('btn-terminer');
  bouton.disabled = true;

  const envoye = await envoyer(true);
  bouton.disabled = false;

  if (!envoye) return;   // le message d'erreur est déjà affiché

  session.fini = true;
  sauvegarder();
  // Plus d'écran de confirmation à part : on atterrit sur le suivi, qui porte
  // le rappel des cartes envoyées et le seul geste encore possible — modifier.
  ouvrirAttente();
}

// ===== SALLE D'ATTENTE =====
// La même vue que celle de l'organisateur, en lecture seule : chacun voit qui
// a fini et qui est encore en train de saisir. Rien n'y est modifiable, et le
// bouton de retrait réservé à l'organisateur n'y figure pas.

const RYTHME_ATTENTE_MS = 2000;
let minuterieAttente = null;

function ouvrirAttente() {
  montrer('screen-attente');
  rafraichirAttente();
  clearInterval(minuterieAttente);
  minuterieAttente = setInterval(rafraichirAttente, RYTHME_ATTENTE_MS);
}


// Un téléphone rangé dans une poche n'a aucune raison d'interroger le serveur
document.addEventListener('visibilitychange', () => {
  // On se fie à l'écran affiché, jamais à la minuterie : en partant en veille
  // on la vide, et s'en servir comme témoin rendait la relance inatteignable.
  if (!document.getElementById('screen-attente').classList.contains('active')) return;
  if (document.hidden) {
    clearInterval(minuterieAttente);
    minuterieAttente = null;
  } else {
    ouvrirAttente();
  }
});

// Tant que la saisie est ouverte on lit la liste des joueurs ; une fois close,
// elle ne bougera plus et c'est l'état publié par l'organisateur qui devient
// intéressant — les équipes, puis la partie.
let saisieClose = false;
// La partie est finie : la seule chose intéressante devient « une nouvelle
// commence-t-elle ? ». On interroge donc la session, plus l'état publié.
let guetterRelance = false;

async function rafraichirAttente() {
  try {
    if (guetterRelance) {
      const etat = await appeler('etat', { code: session.code });
      if (nouvellePartieDisponible(etat)) proposerRejeu(etat);
      return;
    }
    if (!saisieClose) {
      const etat = await appeler('etat', { code: session.code });
      rendreAttente(etat);
      if (etat.ouverte !== false) return;
      saisieClose = true;
    }
    const reponse = await appeler('suivre', { code: session.code });
    rendreConfiguration(reponse.suivi, reponse.serveur);
    // Un tour ne se confie qu'entre deux tours : inutile d'aller le chercher
    // pendant qu'un autre joue ou qu'on regarde des résultats. Ça épargne une
    // requête sur deux à chaque invité, et autant au stockage.
    if (avantUnTour) await guetterMonTour();
  } catch {
    // Coupure passagère : on garde le dernier affichage plutôt que de le vider
  }
}

function arreterAttente() {
  clearInterval(minuterieAttente);
  minuterieAttente = null;
}

// Les moments où l'organisateur voit son écran de début de tour. L'invité voit
// le même, sans le bouton « Lancer le tour » qui reste à la main de l'organisateur.
// « interruption » en fait partie : le tour a été coupé et reprend sur le
// téléphone de l'organisateur. Ce qui s'affiche est bien l'écran de lancement —
// même joueur, temps restant — avec un mot de plus pour dire ce qui s'est passé.
const ETAPES_LANCEMENT = ['attente', 'entre-tours', 'interruption'];

// Les moments où le chrono tourne chez l'organisateur
const ETAPES_TOUR = ['tour', 'pause'];
// … et ceux où il montre un tableau de résultats
const ETAPES_RESULTAT = ['fin-manche', 'fin-partie'];

// L'organisateur poursuit sa configuration, puis la partie s'enchaîne.
// Vrai quand la partie est entre deux tours : c'est le seul moment où un tour
// peut m'être confié.
let avantUnTour = false;
// Le dernier état lu, avec son numéro de version : celui qui joue son tour
// publie à partir de là, sans quoi sa publication serait tenue pour périmée.
let dernierSuiviRecu = null;

function rendreConfiguration(suivi, heureServeur) {
  if (suivi) dernierSuiviRecu = suivi;
  const etat = suivi?.etat;
  const etape = etat?.etape;
  // Le tour m'est confié : mon écran « à toi » remplace le miroir du lancement.
  // Sans cette condition, chaque lecture affichait le miroir avant que la
  // vérification du tour ne le masque à nouveau — d'où un clignotement en bas
  // de l'écran, à chaque cycle.
  const aMoi = !!monTour;
  const enAttenteDeTour = ETAPES_LANCEMENT.includes(etape) && !!etat?.manche;
  const enLancement = enAttenteDeTour && !aMoi;
  avantUnTour = enAttenteDeTour;
  // Mon tour est rendu, mais l'organisateur ne l'a pas encore appliqué : l'état
  // publié dit toujours qu'il est en cours. Le montrer m'annoncerait en train de
  // faire deviner alors que j'ai fini — le temps d'une lecture, mais on le voit.
  const monTourFini = monTourRendu && etat?.tour?.joueur === session.prenom;
  // Le comptage fait partie de mon tour : oublier ici que je l'ai rendu me
  // ramènerait, deux secondes plus tard, le miroir « je compte mes cartes »
  // pour un comptage déjà envoyé. On n'oublie qu'une fois la partie repartie.
  if (!ETAPES_TOUR.includes(etape) && etape !== 'comptage') monTourRendu = false;
  const enTour = ETAPES_TOUR.includes(etape) && !!etat?.tour && !monTourFini;
  // Le tour est fini, mais pas encore compté : ni sablier, ni résultats.
  const enComptage = etape === 'comptage' && !!etat?.tour && !monTourFini;
  const enResultat = ETAPES_RESULTAT.includes(etape);
  // Dès la partie finie, on guette la suivante plutôt que l'état publié —
  // mais seulement quand il y a de nouvelles cartes à ressaisir. Sur une partie
  // à thèmes, rien à resaisir : la session n'est jamais relancée, et c'est la
  // publication suivante qui annonce la partie d'après. Guetter une relance qui
  // n'arrivera pas laisserait ces téléphones figés sur le dernier score.
  const aDesCartesARessaisir = !session.spectateur && !session.inscription;
  if (etape === 'fin-partie' && aDesCartesARessaisir) guetterRelance = true;

  // L'en-tête « configuration en cours » cède la place dès que la partie tourne
  // Mon écran de lancement ne survit pas à mon tour : dès que le paquet n'est
  // plus entre mes mains, il cède la place à ce que voient les autres. Sans ce
  // ménage à chaque lecture, il restait affiché par-dessus le sablier une fois
  // le tour joué, et donnait à croire qu'on pouvait le relancer.
  if (!monTour) document.getElementById('bloc-a-toi').style.display = 'none';

  const enJeu = enLancement || enTour || enResultat || enComptage || aMoi;
  // Le rappel des cartes envoyées ne vaut que pendant l'attente, tant qu'il
  // porte le seul geste encore possible : « Modifier ». Ici la saisie est close
  // par définition — l'organisateur prépare la partie, ou elle a commencé — et
  // le ruban n'apprend plus rien à personne.
  document.getElementById('ruban-cartes').style.display = 'none';
  document.getElementById('attente-roue').style.display = enJeu ? 'none' : '';
  document.getElementById('attente-titre').parentElement.style.display = enJeu ? 'none' : '';
  // Rien à montrer alors que la partie tourne : c'est l'instant entre mon
  // comptage envoyé et sa prise en compte par l'organisateur. L'en-tête gardait
  // les mots de la salle d'attente — « Configuration de la partie en cours » —
  // qui sont faux depuis longtemps à ce moment-là.
  // Montrer directement le lancement du tour suivant serait plus agréable, mais
  // il n'existe pas encore : la dernière publication est celle du tour qui vient
  // de finir, sans le prochain joueur ni les scores à jour. On patiente donc une
  // lecture ou deux, en le disant simplement.
  if (!enJeu && etape && etape !== 'configuration') {
    document.getElementById('attente-titre').textContent =
      monTourFini ? 'Tour enregistré' : 'La partie continue';
    document.getElementById('attente-sous').textContent = 'Le tour suivant arrive.';
  }
  document.getElementById('bloc-lancement').style.display = enLancement ? '' : 'none';
  document.getElementById('bloc-tour').style.display = enTour ? '' : 'none';
  document.getElementById('bloc-comptage').style.display = enComptage ? '' : 'none';
  document.getElementById('bloc-resultats').style.display = enResultat ? '' : 'none';
  // Le bandeau se met à jour à chaque lecture, quel que soit l'état montré en
  // dessous : c'est ce qui lui permet de ne jamais mentir.
  rendreBandeau(etat);
  if (enLancement) rendreLancement(etat);
  if (enComptage) rendreComptage(etat);
  if (enResultat) rendreResultats(etat);
  // Le paquet qui fond est, avec le chrono, la seule chose qui bouge pendant
  // le tour : le sablier partagé porte les deux.
  if (enTour) sablier.ancrer(etat, suivi.publieA, heureServeur, libelleRestantes);
  else sablier.oublier();

  const equipes = suivi?.etat?.equipes || [];
  const nommees = equipes.filter(e => (e.joueurs || []).length > 0);
  const bouton = document.getElementById('btn-voir-equipes');
  // Masqué pendant le tour, pendant le comptage qui le clôt, sur les résultats,
  // et quand c'est à moi de jouer : l'écran doit rester lisible et ne montrer
  // qu'une chose à la fois.
  bouton.style.display =
    (nommees.length && !enTour && !enComptage && !enResultat && !aMoi) ? '' : 'none';
  equipesConnues = nommees.length ? equipes : null;

  // L'organisateur peut revenir sur sa répartition. Si la fenêtre est ouverte
  // à cet instant, la laisser telle quelle afficherait une composition périmée
  // sans que rien ne le signale : on la redessine — mais seulement si elle a
  // vraiment changé. Redessiner à chaque réponse ramènerait une liste de vingt
  // joueurs en haut toutes les deux secondes, sous les doigts de qui la fait défiler.
  const signature = JSON.stringify(nommees.map(e => [e.nom, e.joueurs]));
  const aChange = signature !== derniereComposition;
  derniereComposition = signature;

  if (aChange && document.getElementById('equipes-overlay').style.display !== 'none') {
    afficherEquipes();
  }
}

let derniereComposition = null;

// ===== LES RÉSULTATS =====
// Le même tableau que celui de l'organisateur : une ligne par manche jouée, le
// total, puis — en fin de partie — le cumul des parties et le détail par joueur.

function ligneScore(libelle, valeurs, classe) {
  const tr = document.createElement('tr');
  if (classe) tr.className = classe;
  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = libelle;
  tr.appendChild(th);
  valeurs.forEach(valeur => {
    const td = document.createElement('td');
    td.className = 'score';
    td.textContent = valeur;
    tr.appendChild(td);
  });
  return tr;
}

let dernierResultat = null;

function rendreResultats(etat) {
  // Ne redessiner que sur un vrai changement. Sans cette garde, le tiroir des
  // joueurs était reconstruit à chaque lecture et se refermait tout seul toutes
  // les deux secondes, sous les doigts de celui qui venait de l'ouvrir.
  const signature = JSON.stringify([
    etat.etape, etat.historique, etat.cumul, etat.joueurs,
    etat.equipes.map(e => [e.nom, e.partie, e.manche])
  ]);
  if (signature === dernierResultat) return;
  dernierResultat = signature;

  const finale = etat.etape === 'fin-partie';
  const [e1, e2] = etat.equipes;
  const manches = etat.historique || [];

  document.getElementById('resultats-emoji').textContent = finale ? '🏆' : (etat.manche?.icone || '📊');
  document.getElementById('resultats-titre').textContent = finale
    ? 'Fin de la partie !'
    : `Fin de la manche ${etat.manche?.numero}/${etat.manche?.sur}`;

  const vainqueur = document.getElementById('resultats-vainqueur');
  if (finale) {
    const ecart = e1.partie - e2.partie;
    vainqueur.textContent = ecart === 0
      ? '🤝 Égalité parfaite !'
      : `🎉 ${(ecart > 0 ? e1 : e2).nom} gagne !`;
    vainqueur.style.display = '';
  } else {
    vainqueur.style.display = 'none';
  }

  document.getElementById('resultats-eq1').textContent = e1.nom;
  document.getElementById('resultats-eq2').textContent = e2.nom;

  const corps = document.getElementById('resultats-scores');
  corps.innerHTML = '';
  manches.forEach((m, i) => {
    // Hors fin de partie, la dernière ligne est celle qui vient de s'achever
    const enCours = !finale && i === manches.length - 1;
    corps.appendChild(ligneScore(`${m.icone} ${m.nom}`, m.scores,
      enCours ? 'manche-en-cours' : 'manche-passee'));
  });
  corps.appendChild(ligneScore(finale ? 'Cette partie' : 'Total partie',
    [e1.partie, e2.partie], 'score-total'));
  if (etat.cumul) {
    corps.appendChild(ligneScore(`Cumul des ${etat.cumul.parties} parties`,
      etat.cumul.totaux, 'score-cumul'));
  }

  rendreJoueurs(finale ? (etat.joueurs || []) : [], manches, etat.equipes,
                etat.cumul ? etat.cumul.parties : 0);
}

// Le détail par joueur, replié : l'écran reste court même à dix joueurs
// et cinq manches, et le résumé donne déjà le meilleur sans qu'on ouvre.
// parties : nombre de parties de la série, 0 s'il n'y en a qu'une
// Même règle que côté organisateur : dès la deuxième partie, les mêmes
// colonnes portent le cumul de la série au lieu du score de la seule partie.
function rendreJoueurs(joueurs, manches, equipes, parties = 0) {
  const boite = document.getElementById('resultats-joueurs');
  boite.innerHTML = '';
  if (!joueurs.length) return;

  const serie = parties > 1;
  const manchesDe = j => (serie ? j.serieParManche : j.parManche) || j.parManche || [];
  const totalDe = j => (serie ? j.serieTotal : j.total) ?? j.total;
  const meilleur = [...joueurs].sort((a, b) => totalDe(b) - totalDe(a))[0];
  const tiroir = document.createElement('details');
  tiroir.className = 'drawer';
  tiroir.id = 'resultats-tiroir-joueurs';

  const resume = document.createElement('summary');
  // Même libellé que chez l'organisateur : en série, le nombre de parties
  // prend la place du score, et dit à quelle échelle lire le tableau.
  resume.textContent = serie
    ? `📊 Les joueurs — ${meilleur.nom} en tête (${parties} parties)`
    : `📊 Les joueurs — ${meilleur.nom} en tête avec ${meilleur.total}`;
  tiroir.appendChild(resume);

  const table = document.createElement('table');
  table.className = 'table-joueurs';

  const thead = document.createElement('thead');
  const enTete = document.createElement('tr');
  const cellule = (balise, texte, titre) => {
    const el = document.createElement(balise);
    el.textContent = texte;
    if (titre) el.title = titre;
    return el;
  };
  enTete.appendChild(cellule('th', 'Joueur'));
  manches.forEach(m => enTete.appendChild(cellule('th', m.icone, m.nom)));
  // Le libellé ne bouge pas, l'infobulle dit de quelle échelle il s'agit
  enTete.appendChild(cellule('th', 'Tot.',
    serie ? `Cumul des ${parties} parties` : 'Total de la partie'));
  thead.appendChild(enTete);
  table.appendChild(thead);

  const corps = document.createElement('tbody');
  joueurs.forEach((joueur, index) => {
    const tr = document.createElement('tr');
    // Un trait sépare les deux équipes : les joueurs sont groupés, pas classés
    if (index > 0 && joueurs[index - 1].equipe !== joueur.equipe) tr.className = 'change-equipe';

    const nom = document.createElement('th');
    const puce = document.createElement('span');
    puce.className = 'puce-equipe';
    // La couleur vient de l'état courant, pas d'une variable renseignée ailleurs :
    // un invité qui arrive directement sur la fin de partie doit la voir aussi.
    puce.style.background = equipes?.[joueur.equipe]?.couleur || 'transparent';
    nom.appendChild(puce);
    // textContent : les prénoms viennent du téléphone des autres invités
    nom.appendChild(document.createTextNode(joueur.nom));
    if (joueur.nom.toLocaleLowerCase() === (session.prenom || '').toLocaleLowerCase()) {
      nom.classList.add('moi');
    }
    tr.appendChild(nom);

    manchesDe(joueur).forEach(v => tr.appendChild(cellule('td', String(v))));
    const total = cellule('td', String(totalDe(joueur)));
    total.className = 'total-joueur';
    tr.appendChild(total);
    corps.appendChild(tr);
  });
  table.appendChild(corps);

  const boiteTable = document.createElement('div');
  boiteTable.className = 'boite-joueurs';
  boiteTable.appendChild(table);
  tiroir.appendChild(boiteTable);
  boite.appendChild(tiroir);
}

// ===== LE CHRONO DU TOUR =====
// Tenu par le module partagé : la page de l'organisateur affiche le même.
const sablier = creerSablier({
  prefixe: 'inv',
  chrono: 'tour-chrono',
  blocChrono: 'tour-bloc-chrono',
  manche: 'tour-manche',
  qui: 'tour-qui',
  mention: 'tour-mention',
  restantes: 'tour-restantes'
});
document.getElementById('tour-bloc-chrono').insertAdjacentHTML('beforeend', svgSablier('inv'));

// Ce qu'il reste dans le paquet de la manche. Le même libellé que chez
// l'organisateur, avec un mot pour la fin : c'est là que ça devient un enjeu.
function libelleRestantes(n) {
  if (typeof n !== 'number') return '';
  if (n <= 0) return 'Plus de cartes';
  if (n === 1) return 'Dernière carte !';
  return `Cartes restantes : ${n}`;
}

// ===== MON TOUR =====
// L'organisateur confie le paquet au téléphone du joueur qui doit faire
// deviner. Tant qu'il n'est pas à moi, je ne reçois que l'information qu'un
// tour est en cours — jamais les mots.

let monTour = null;   // le paquet reçu, quand le tour m'est confié

async function guetterMonTour() {
  if (!session.idJoueur) return;
  try {
    const reponse = await appeler('lireTour', {
      code: session.code, idJoueur: session.idJoueur
    });
    const tour = reponse.tour;
    // `mots` n'arrive qu'au joueur concerné : sa présence suffit à savoir
    // que c'est mon tour, sans comparer d'identifiants.
    const pourMoi = !!tour && Array.isArray(tour.mots) && !tour.rendu;
    if (!pourMoi) {
      monTour = null;
      afficherMonTour(false);
      return;
    }
    if (!monTour || monTour.confieA !== tour.confieA) {
      monTour = tour;
      rendreMonTour(tour);
    }
    afficherMonTour(true);
  } catch {
    // Coupure passagère : on garde l'écran en place
  }
}

// Mon écran de lancement prend la place de celui que voient les autres.
function afficherMonTour(actif) {
  document.getElementById('bloc-a-toi').style.display = actif ? '' : 'none';
  if (!actif) return;
  ['bloc-lancement', 'bloc-tour', 'bloc-resultats', 'btn-voir-equipes']
    .forEach(id => { document.getElementById(id).style.display = 'none'; });
  document.getElementById('attente-titre').parentElement.style.display = 'none';
  document.getElementById('attente-roue').style.display = 'none';
}

function rendreMonTour(tour) {
  const T = (id, texte) => { document.getElementById(id).textContent = texte; };
  const m = tour.manche || {};
  T('atoi-titre', `À toi, ${session.prenom} !`);
  T('atoi-icone', m.icone || '🎯');
  T('atoi-manche', m.numero ? `Manche ${m.numero}/${m.sur} — ${m.nom}` : (m.nom || ''));
  T('atoi-regle', m.regle || '');
  T('atoi-reste', libelleRestantes(tour.mots.length));
  // Son équipe a vidé le paquet à la manche précédente : ce tour reprend les
  // secondes gagnées. Sans ce mot, il lance et voit un chrono bien plus bas
  // que d'habitude sans comprendre pourquoi. Même libellé que sur l'écran de
  // l'organisateur, au mot près : les deux appareils sont côte à côte.
  T('atoi-duree', tour.reporte ? `⏱️ Temps restant : ${tour.duree} s` : '');

  // Le score de la manche vient du suivi, déjà reçu : rien à redemander.
  const equipes = equipesConnues || [];
  const mienne = equipes.find(e => (e.joueurs || []).includes(session.prenom));
  T('atoi-equipe', mienne ? `pour ${mienne.nom}` : '');
  if (mienne?.couleur) {
    document.getElementById('atoi-equipe').style.color = mienne.couleur;
  }
  T('atoi-eq1', equipes[0] ? `${equipes[0].nom} ${equipes[0].manche}` : '');
  T('atoi-eq2', equipes[1] ? `${equipes[1].manche} ${equipes[1].nom}` : '');
}

// ===== JOUER SON TOUR =====
// Tout se passe en local : le paquet est arrivé d'un bloc, le chrono tourne
// ici, et rien n'est demandé au serveur pendant le tour. Une coupure réseau
// n'interrompt donc pas la partie de celui qui joue.

let partieEnCours = null;   // { mots, index, trouvees, manquees, restant, minuterie }
// Rendu, mais pas encore appliqué par l'organisateur : ce qui est publié parle
// encore de mon tour, et il ne faut pas le rejouer à l'écran.
let monTourRendu = false;

function lancerMonTour() {
  if (!monTour) return;
  arreterAttente();   // plus rien à écouter : c'est moi qui mène
  partieEnCours = {
    mots: [...monTour.mots],
    index: 0,
    trouvees: [],
    manquees: [],
    restant: monTour.duree || 40,
    enPause: false,
    minuterie: null
  };

  const m = monTour.manche || {};
  document.getElementById('mon-round-label').textContent =
    m.numero ? `Manche ${m.numero}` : (m.nom || '');
  const equipes = equipesConnues || [];
  const mienne = equipes.find(e => (e.joueurs || []).includes(session.prenom));
  document.getElementById('mon-team-label').textContent = mienne ? mienne.nom : '';

  montrer('screen-mon-tour');
  peindreMonTour();
  demarrerMonChrono();
  surveillerQueLeTourEstToujoursAMoi();
  publierMonDepart();
}

// ===== LE TOUR PEUT M'ÊTRE RETIRÉ EN COURS DE ROUTE =====
// L'organisateur dispose d'une porte de sortie : si le joueur ne répond pas, il
// reprend le tour sur son appareil. Le serveur cesse alors de reconnaître ce
// téléphone — mais lui n'en sait rien, et continuerait à faire deviner dans son
// coin. Deux personnes sur le même tour, chacune sûre de le tenir.
//
// Rien ne peut être poussé jusqu'ici : c'est donc à ce téléphone de vérifier.
// Toutes les cinq secondes suffisent — le geste est rare, et la question coûte
// une seule lecture de clé.
const RYTHME_VERIFICATION_MS = 2500;
let verificationDuTour = null;

function surveillerQueLeTourEstToujoursAMoi() {
  clearInterval(verificationDuTour);
  verificationDuTour = setInterval(async () => {
    if (!partieEnCours) return arreterLaVerification();
    let tour;
    try { ({ tour } = await appeler('lireTour', { code: session.code, idJoueur: session.idJoueur })); }
    catch { return; }   // coupure passagère : on ne coupe surtout pas le tour pour ça
    if (!tour || tour.idJoueur !== session.idJoueur || tour.repris) monTourMEstRetire();
  }, RYTHME_VERIFICATION_MS);
}

function arreterLaVerification() {
  clearInterval(verificationDuTour);
  verificationDuTour = null;
}

// L'organisateur a repris le tour. Ce qui a été trouvé jusqu'ici doit compter :
// ces cartes ne vivent que sur ce téléphone, et l'organisateur les attend. On
// les envoie avant toute chose, puis on rend la main.
async function monTourMEstRetire() {
  if (!partieEnCours) return;
  const p = partieEnCours;
  arreterLaVerification();
  clearInterval(p.minuterie);
  partieEnCours = null;
  monTour = null;
  monTourRendu = false;
  afficherMonTour(false);

  try {
    await appeler('rendreTour', {
      code: session.code, idJoueur: session.idJoueur,
      trouvees: p.trouvees,
      manquees: p.manquees.concat(p.mots.slice(p.index)),
      restant: Math.max(0, Math.round(p.restant))
    });
  } catch {
    // Rien ne part : l'organisateur repartira sans ces cartes, et le dira.
  }

  // Retour direct au suivi, sans écran intermédiaire ni bouton à presser : ce
  // joueur redevient un spectateur parmi les autres, et rien ne justifie de lui
  // demander de le confirmer. La partie continue sans lui, il la regarde.
  ouvrirAttente();
}

// Ce que les autres voient de mon tour. Le chrono ne demande qu'une
// publication au départ — chacun décompte chez lui à partir de l'heure du
// serveur. Mais tout ce qui n'est pas le simple écoulement du temps doit être
// dit : une pause, une reprise, une carte trouvée. Sans quoi leur sablier
// continuerait de couler pendant que le mien est arrêté.
let maVersionSuivi = 0;
let maDuree = 40;

async function publierMonEtat(etape) {
  const etat = dernierSuiviRecu?.etat;
  if (!etat || !partieEnCours) return;
  const mienne = (equipesConnues || []).findIndex(e => (e.joueurs || []).includes(session.prenom));
  maVersionSuivi += 1;
  try {
    await appeler('publier', {
      code: session.code, idJoueur: session.idJoueur,
      v: maVersionSuivi,
      etat: {
        ...etat,
        etape,
        restantes: partieEnCours.mots.length - partieEnCours.index,
        aVenir: null,
        tour: {
          equipe: mienne >= 0 ? mienne : 0,
          joueur: session.prenom,
          duree: maDuree,
          restant: Math.max(0, Math.round(partieEnCours.restant)),
          // Pourquoi le tour s'est arrêté : les autres doivent lire la bonne
          // raison, et « temps écoulé » serait faux sur un paquet vidé.
          raison: partieEnCours.paquetVide ? 'paquet' : 'temps'
        }
      }
    });
  } catch (err) {
    // 403 : le serveur ne reconnaît plus ce tour comme le nôtre. L'organisateur
    // l'a repris sur son appareil. Continuer à jouer ferait deviner deux
    // personnes en même temps, chacune persuadée de tenir le tour.
    if (err.statut === 403) return monTourMEstRetire();
    // Le tour se joue quand même : les autres verront le résultat à la fin
  }
}

function publierMonDepart() {
  maVersionSuivi = Number(dernierSuiviRecu?.v) || 0;
  maDuree = partieEnCours.restant;
  return publierMonEtat('tour');
}

function peindreMonTour() {
  const p = partieEnCours;
  document.getElementById('mon-timer').textContent = p.restant;
  document.getElementById('mon-card-word').textContent = p.mots[p.index] ?? '';
  document.getElementById('mon-cards-left').textContent = p.mots.length - p.index;
}

function demarrerMonChrono() {
  clearInterval(partieEnCours.minuterie);
  partieEnCours.minuterie = setInterval(() => {
    const p = partieEnCours;
    if (!p || p.enPause) return;
    p.restant -= 1;
    if (p.restant <= 0) {
      p.restant = 0;
      peindreMonTour();
      finirMonTour();
      return;
    }
    peindreMonTour();
  }, 1000);
}

function monMotCourant() {
  return partieEnCours.mots[partieEnCours.index];
}

function monTourTrouve() {
  const p = partieEnCours;
  if (!p || p.enPause || p.index >= p.mots.length) return;
  p.trouvees.push(monMotCourant());
  p.index += 1;
  if (p.index >= p.mots.length) return finirMonTour();
  peindreMonTour();
  // Le paquet qui fond est la seule autre chose que les spectateurs voient
  // bouger : sans cette publication, leur compteur resterait figé tout le tour.
  publierMonEtat('tour');
}

// Passer remet la carte plus loin : le paquet ne rétrécit pas, contrairement
// à « Trouvé ». C'est la règle du jeu, appliquée ici en local.
function monTourPasse() {
  const p = partieEnCours;
  if (!p || p.enPause || p.index >= p.mots.length) return;
  const carte = p.mots.splice(p.index, 1)[0];
  p.mots.push(carte);
  peindreMonTour();
}

function basculerMaPause() {
  const p = partieEnCours;
  if (!p) return;
  p.enPause = !p.enPause;
  document.getElementById('mon-pause-overlay').style.display = p.enPause ? '' : 'none';
  document.getElementById('screen-mon-tour').classList.toggle('paused', p.enPause);
  // Le dire aux autres, sinon leur sablier coule pendant que le mien est arrêté
  publierMonEtat(p.enPause ? 'pause' : 'tour');
}

// Fin du tour : ce qui n'a pas été trouvé rejoint les cartes manquées, et on
// passe au comptage. Rien n'est envoyé avant que le joueur ait validé — c'est
// lui qui arbitre son tour, et personne ne le rouvrira après.
function finirMonTour() {
  const p = partieEnCours;
  if (!p) return;
  clearInterval(p.minuterie);
  p.minuterie = null;
  p.manquees = p.mots.slice(p.index);
  p.paquetVide = p.index >= p.mots.length;
  // Le dire aux autres : sans ça leur sablier continue de couler alors que le
  // tour est fini, et ils finissent par lire « temps écoulé » à tort.
  publierMonEtat('comptage');
  montrer('screen-mon-comptage');
  rendreMonComptage();
}

// ===== MON COMPTAGE =====
// Le même écran que chez l'organisateur : deux tiroirs, une carte se déplace de
// l'un à l'autre. Le paquet n'a pas à suivre ici — c'est l'organisateur qui le
// tient, et il appliquera la liste validée.

function rendreMonComptage() {
  const p = partieEnCours;
  if (!p) return;
  const T = (id, texte) => { document.getElementById(id).textContent = texte; };

  T('mon-fin-titre', p.paquetVide ? '🃏 Plus de cartes !' : '⏰ Temps écoulé !');
  const n = p.trouvees.length;
  T('mon-fin-resultat', `${n} carte${n > 1 ? 's' : ''} trouvée${n > 1 ? 's' : ''}`);
  T('mon-resume-comptees', `✅ Cartes comptées (${p.trouvees.length})`);
  T('mon-resume-manquees', `↩️ Cartes non comptées (${p.manquees.length})`);

  remplirListeComptage('mon-liste-comptees', p.trouvees, '✕', mot => {
    p.trouvees.splice(p.trouvees.indexOf(mot), 1);
    p.manquees.push(mot);
    rendreMonComptage();
  });
  remplirListeComptage('mon-liste-manquees', p.manquees, '✓', mot => {
    p.manquees.splice(p.manquees.indexOf(mot), 1);
    p.trouvees.push(mot);
    rendreMonComptage();
  });
}

function remplirListeComptage(id, mots, libelle, surClic) {
  const liste = document.getElementById(id);
  liste.innerHTML = '';
  mots.forEach(mot => {
    const li = document.createElement('li');
    const nom = document.createElement('span');
    nom.className = 'player-name';
    // textContent : ces mots viennent du paquet, jamais interprétés en HTML
    nom.textContent = mot;
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = libelle;
    bouton.addEventListener('click', () => surClic(mot));
    li.append(nom, bouton);
    liste.appendChild(li);
  });
}

// Le comptage est arbitré : le tour part vers l'organisateur, qui l'appliquera.
async function validerMonComptage() {
  const p = partieEnCours;
  if (!p) return;
  const bouton = document.getElementById('btn-mon-comptage-valider');
  bouton.disabled = true;
  // Le comptage part : ce tour ne peut plus nous être retiré, plus rien à guetter.
  arreterLaVerification();
  try {
    await appeler('rendreTour', {
      code: session.code, idJoueur: session.idJoueur,
      trouvees: p.trouvees, manquees: p.manquees,
      // Le paquet vidé avant la fin du temps : les secondes qui restaient
      // ouvrent la manche suivante, pour la même équipe. C'est ce téléphone
      // qui tenait le chrono, personne d'autre ne connaît ce nombre.
      restant: p.paquetVide ? Math.max(0, Math.round(p.restant)) : 0
    });
  } catch {
    // Hors ligne : le tour est joué, l'organisateur reprendra la main
  }
  bouton.disabled = false;
  partieEnCours = null;
  monTour = null;
  monTourRendu = true;
  afficherMonTour(false);
  ouvrirAttente();
}

// Le tour s'est arrêté, celui qui faisait deviner arbitre son comptage. On dit
// la bonne raison — un paquet vidé n'est pas un temps écoulé — et on montre le
// score de la manche, en prévenant qu'il ne comprend pas encore ce tour-ci.
function rendreComptage(etat) {
  const T = (id, texte) => { document.getElementById(id).textContent = texte; };
  const surLePaquet = etat.tour.raison === 'paquet';

  // La manche et le score sont dans le bandeau : cet écran dit seulement ce
  // qu'on attend, et de qui.
  T('comptage-emoji', surLePaquet ? '🃏' : '⏰');
  T('comptage-titre', surLePaquet ? 'Fin du tour !' : 'Temps écoulé !');
  T('comptage-qui', `${etat.tour.joueur} compte ses cartes`);
}

// ===== LE BANDEAU =====
// Le seul endroit de l'écran de suivi qui affiche la manche et le score. Il
// est rendu à chaque lecture, quel que soit l'état montré en dessous : c'est
// ce qui permet aux six états de ne plus répéter la même chose.

function rendreBandeau(etat) {
  const T = (id, texte) => { document.getElementById(id).textContent = texte; };
  const m = etat?.manche;
  const equipes = etat?.equipes || [];
  const score = document.getElementById('suivi-score');

  if (!m || equipes.length < 2) {
    // Avant que la partie tourne, il n'y a pas de manche ni de score : le
    // bandeau se contente de rappeler dans quelle partie on est.
    T('suivi-manche', session.code ? `Partie ${session.code}` : '');
    score.style.display = 'none';
    T('suivi-total', '');
    return;
  }

  const [e1, e2] = equipes;
  T('suivi-manche', `Manche ${m.numero}/${m.sur}`);
  T('suivi-eq1', e1.nom);
  T('suivi-eq2', e2.nom);
  T('suivi-s1', e1.manche);
  T('suivi-s2', e2.manche);
  T('suivi-total', `Total de la partie : ${e1.partie} – ${e2.partie}`);
  score.style.display = '';
}

// Le même écran que celui de l'organisateur au début d'un tour. On ne reprend
// pas son bouton « Lancer le tour » : le départ reste à sa main.
function rendreLancement(etat) {
  const m = etat.manche;
  const T = (id, texte) => { document.getElementById(id).textContent = texte; };

  // Le tour précédent a été coupé par l'organisateur, pas achevé. Le dire :
  // sinon on voit un tour disparaître et le même joueur annoncé à nouveau.
  T('lancement-interruption', etat.etape === 'interruption'
    ? "⏸️ Tour interrompu — il reprend sur le téléphone de l'organisateur"
    : '');

  // Le numéro de manche et le score sont dans le bandeau, au-dessus : ici on
  // décrit seulement la manche qu'on s'apprête à jouer.
  T('lancement-nom', `${m.icone} ${m.nom}`);
  T('lancement-icone', m.icone);
  T('lancement-regle', m.regle || '');

  // Le temps repris d'abord, les cartes ensuite : le même ordre et les mêmes
  // mots que sur l'écran de l'organisateur, dont celui-ci est le miroir.
  T('lancement-report', etat.report > 0 ? `⏱️ Temps restant : ${etat.report} s` : '');
  T('lancement-restantes', libelleRestantes(etat.restantes));

  // `aVenir` et non `tour` : entre deux tours, `tour` désignerait encore
  // l'équipe qui vient de finir, pas celle qui s'apprête à jouer.
  const suivant = etat.aVenir;
  const equipe = suivant ? etat.equipes[suivant.equipe] : null;
  T('lancement-tour', equipe ? `🎯 C'est au tour de : ${equipe.nom}` : '');
  T('lancement-joueur', suivant?.joueur ? `${suivant.joueur} fait deviner` : '');
  if (equipe?.couleur) {
    document.getElementById('lancement-tour').style.color = equipe.couleur;
  }
}

let equipesConnues = null;

function afficherEquipes() {
  if (!equipesConnues) return;
  const contenu = document.getElementById('equipes-contenu');
  contenu.innerHTML = '';

  equipesConnues.forEach(equipe => {
    const bloc = document.createElement('div');
    bloc.className = 'equipe-bloc';

    const titre = document.createElement('h4');
    titre.textContent = equipe.nom;
    titre.style.color = equipe.couleur;
    bloc.appendChild(titre);

    const liste = document.createElement('ul');
    (equipe.joueurs || []).forEach(joueur => {
      const item = document.createElement('li');
      // textContent : les prénoms viennent du téléphone des autres invités
      item.textContent = joueur;
      // On souligne le sien : c'est la première chose qu'on cherche
      if (joueur.toLocaleLowerCase() === (session.prenom || '').toLocaleLowerCase()) {
        item.className = 'moi';
      }
      liste.appendChild(item);
    });
    bloc.appendChild(liste);
    contenu.appendChild(bloc);
  });

  document.getElementById('equipes-overlay').style.display = '';
}

function masquerEquipes() {
  document.getElementById('equipes-overlay').style.display = 'none';
}

// Au-delà de trois prénoms la phrase devient une liste qu'on ne lit plus :
// on repasse au compte, qui dit la même chose en un coup d'œil.
function titreDeLAttente(enRetard, inscriptionSeule) {
  if (!enRetard.length) return 'Tout le monde est prêt';
  if (enRetard.length > 3) {
    return inscriptionSeule
      ? `En attente de ${enRetard.length} joueurs`
      : `On attend ${enRetard.length} joueurs`;
  }
  const noms = enRetard.length === 1
    ? enRetard[0]
    : `${enRetard.slice(0, -1).join(', ')} et ${enRetard[enRetard.length - 1]}`;
  return `On attend ${noms}`;
}

function rendreAttente(etat) {
  // Une session fermée veut dire que le paquet est figé — pas que la partie a
  // commencé : l'organisateur enchaîne sur les équipes, les manches et les
  // réglages. Le libellé reste vague à dessein : selon le parcours il règle
  // tout, ou seulement un thème en rejeu, et la phrase doit valoir pour les deux.
  const configEnCours = etat.ouverte === false;
  // Sur une partie à thèmes, personne ne saisit de cartes : on attend seulement
  // que les derniers joueurs se soient inscrits.
  const inscriptionSeule = etat.inscription === true;

  // Le bandeau n'a encore ni manche ni score : il rappelle le code de la partie.
  rendreBandeau(null);

  // Nommer ceux qu'on attend plutôt que les compter : c'est ce qui permet de
  // les relancer à voix haute, la seule action utile à ce moment-là. Et les
  // grains montrent où chacun en est, donc nommer ne revient pas à accuser.
  const enRetard = (etat.joueurs || []).filter(j => !j.fini).map(j => j.prenom);
  document.getElementById('attente-titre').textContent =
    configEnCours ? 'Configuration de la partie en cours'
                  : titreDeLAttente(enRetard, inscriptionSeule);
  document.getElementById('attente-sous').textContent = configEnCours
    ? "L'organisateur prépare la partie. Elle démarre juste après."
    : (!enRetard.length
        ? "La partie démarre quand l'organisateur la lance."
        : (inscriptionSeule
            ? "On attend que tout le monde se soit inscrit."
            : (enRetard.length === 1
                ? 'Il saisit encore ses cartes.'
                : 'Ils saisissent encore leurs cartes.')));
  document.getElementById('attente-roue').style.display = configEnCours ? '' : 'none';

  // Le ruban ne concerne que celui qui a saisi des cartes, et seulement tant
  // que la saisie est ouverte : il porte alors le seul geste encore possible,
  // « Modifier ». Une fois le paquet figé, il n'apprend plus rien et occupe
  // l'écran par-dessus ce que l'organisateur est en train de préparer.
  const ruban = document.getElementById('ruban-cartes');
  const aDesCartes = !inscriptionSeule && session.fini && !configEnCours;
  ruban.style.display = aDesCartes ? '' : 'none';
  if (aDesCartes) {
    document.getElementById('ruban-texte').textContent =
      `Tes ${session.cartes.length} cartes sont arrivées`;
    document.getElementById('btn-modifier').style.display = '';
  }

  // Le décompte des cartes n'a plus d'objet une fois la saisie close : il ne
  // bougerait plus, et l'écran doit dire qu'on attend, pas afficher un bilan.
  document.getElementById('attente-joueurs').style.display = configEnCours ? 'none' : '';
  document.getElementById('attente-total').style.display = configEnCours ? 'none' : '';
  // En configuration, c'est rendreConfiguration() qui décide d'afficher le bouton
  if (configEnCours) return;
  document.getElementById('btn-voir-equipes').style.display = 'none';

  const liste = document.getElementById('attente-joueurs');
  liste.innerHTML = '';

  if (!etat.joueurs.length) {
    const vide = document.createElement('div');
    vide.className = 'connecte vide';
    vide.textContent = "Personne n'a encore rejoint";
    liste.appendChild(vide);
  }

  // Ordre alphabétique, et non celui du stockage : rien ne garantit que le
  // serveur rende les joueurs toujours dans le même ordre, et une liste qui se
  // réordonne toutes les deux secondes serait illisible.
  const ordonnes = [...etat.joueurs].sort((a, b) => a.prenom.localeCompare(b.prenom, 'fr'));

  ordonnes.forEach(joueur => {
    const ligne = document.createElement('div');
    ligne.className = 'connecte' + (joueur.fini ? ' fini' : '');

    const qui = document.createElement('span');
    qui.className = 'qui';
    // textContent : les prénoms viennent du téléphone des autres invités
    qui.textContent = `${joueur.fini ? '●' : '○'} ${joueur.prenom} `;
    if (joueur.id === session.idJoueur) {
      const marque = document.createElement('span');
      marque.className = 'sans-tel';
      marque.textContent = '· toi';
      qui.appendChild(marque);
    }

    ligne.appendChild(qui);
    // Sans cartes à saisir, il n'y a rien à décompter : le prénom suffit.
    // Sinon, les grains de l'écran de saisie : l'invité vient d'en remplir
    // autant sur son propre téléphone, il n'y a rien à lui expliquer.
    if (!inscriptionSeule) {
      const grains = document.createElement('span');
      grains.className = 'grains';
      const cible = etat.cartesParJoueur || 0;
      for (let i = 0; i < cible; i++) {
        const grain = document.createElement('span');
        grain.className = 'grain' + (i < joueur.nbCartes ? ' plein' : '');
        grains.appendChild(grain);
      }
      ligne.appendChild(grains);
    }
    liste.appendChild(ligne);
  });

  const prets = etat.joueurs.filter(j => j.fini).length;
  document.getElementById('attente-total').textContent = inscriptionSeule
    ? `${etat.joueurs.length} joueur(s) inscrit(s)`
    : (configEnCours
        ? `${etat.total} cartes dans le paquet`
        : `${prets} joueur(s) sur ${etat.joueurs.length} ont terminé · ${etat.total} cartes`);
}

// Revenir modifier repasse le joueur en saisie : côté organisateur, le
// lancement se rebloque aussitôt.
async function modifier() {
  arreterAttente();
  session.fini = false;
  sauvegarder();
  await envoyer(false);
  ouvrirSaisie();
}

// ===== Reprise après une coupure =====

async function reprendre(sauvegarde) {
  session = { ...session, ...sauvegarde };
  document.getElementById('rappel-code').textContent = session.code;

  try {
    const etat = await appeler('etat', { code: session.code });
    session.cartesParJoueur = etat.cartesParJoueur;
    partieCourante = numeroDePartie(etat);

    // Le joueur existe-t-il toujours ? L'organisateur a pu le retirer.
    if (!etat.joueurs.some(j => j.id === session.idJoueur)) {
      oublier();
      return validerCode(session.code);
    }
    // Celui qui avait rangé son téléphone le rallume : une nouvelle partie a pu
    // commencer entre-temps, et il doit pouvoir la rejoindre d'ici.
    if (nouvellePartieDisponible(etat)) return proposerRejeu(etat);

    // Partie à thèmes : ce joueur est inscrit et n'a rien à saisir. Que la
    // partie soit lancée ou non, ce qui l'intéresse est de la suivre.
    session.inscription = etat.inscription === true;
    if (session.inscription) {
      sauvegarder();
      return ouvrirAttente();
    }

    // La partie est lancée, et ce joueur en fait partie : son téléphone lui
    // sert maintenant à la suivre et à jouer son tour. Le bloquer ici — ce que
    // faisait l'app quand la page ne servait qu'à saisir des cartes — le
    // mettrait dehors pour un simple rafraîchissement.
    if (!etat.ouverte) {
      session.fini = true;
      sauvegarder();
      return ouvrirAttente();
    }

    if (session.fini) {
      ouvrirAttente();
    } else {
      ouvrirSaisie();
      envoyer(false);   // on resynchronise ce qui n'avait peut-être pas été envoyé
    }
  } catch (err) {
    // Hors ligne à la reprise : on laisse saisir, l'envoi se fera au retour du réseau
    if (err.statut === undefined) {
      ouvrirSaisie();
      afficherEtatEnvoi('horsligne');
      return;
    }
    surErreur(err);
  }
}

// ===== Démarrage =====

function brancherEvenements() {
  const champCode = document.getElementById('champ-code');
  champCode.addEventListener('input', () => {
    champCode.value = champCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    document.getElementById('erreur-code').textContent = '';
    dessinerCases();
    // Quatre caractères : il n'y a plus rien à attendre du joueur.
    if (champCode.value.length === 4) lancerLeCode();
  });

  // Le clic reste possible — clavier, lecteur d'écran — et sert de garde-fou
  // au cas où la saisie automatique n'aurait pas eu lieu.
  document.getElementById('btn-code').addEventListener('click', lancerLeCode);

  function lancerLeCode() {
    if (codeEnCours) return;
    const code = champCode.value.trim();
    if (code.length !== 4) {
      refuserLeCode('Le code fait 4 caractères.');
      return;
    }
    codeEnCours = true;
    champCode.blur();
    validerCode(code).finally(() => { codeEnCours = false; });
  }

  document.getElementById('btn-prenom').addEventListener('click', validerPrenom);
  document.getElementById('champ-prenom').addEventListener('keypress', e => {
    if (e.key === 'Enter') validerPrenom();
  });

  document.getElementById('btn-ajouter').addEventListener('click', ajouterCarte);
  document.getElementById('champ-carte').addEventListener('keypress', e => {
    if (e.key === 'Enter') ajouterCarte();
  });

  document.getElementById('btn-terminer').addEventListener('click', terminer);

  // Mon tour, joué depuis ce téléphone
  document.getElementById('btn-atoi-lancer').addEventListener('click', lancerMonTour);
  document.getElementById('btn-mon-found').addEventListener('click', monTourTrouve);
  document.getElementById('btn-mon-pass').addEventListener('click', monTourPasse);
  document.getElementById('btn-mon-pause').addEventListener('click', basculerMaPause);
  document.getElementById('btn-mon-reprendre').addEventListener('click', basculerMaPause);
  document.getElementById('btn-mon-comptage-valider')
    .addEventListener('click', validerMonComptage);
  document.getElementById('btn-rejouer-oui').addEventListener('click', accepterRejeu);
  document.getElementById('btn-rejouer-autre').addEventListener('click', refuserIdentite);
  document.getElementById('btn-rejouer-quitter').addEventListener('click', quitterLaPartie);
  document.getElementById('btn-voir-equipes').addEventListener('click', afficherEquipes);
  document.getElementById('btn-equipes-fermer').addEventListener('click', masquerEquipes);
  document.getElementById('equipes-overlay').addEventListener('click', e => {
    if (e.target.id === 'equipes-overlay') masquerEquipes();
  });
  document.getElementById('btn-modifier').addEventListener('click', modifier);

  // Le réseau revient : on renvoie ce qui n'était pas passé
  window.addEventListener('online', () => {
    if (session.idJoueur && !session.fini) envoyer(false);
  });
}

async function demarrer() {
  brancherEvenements();

  const code = codeDepuisAdresse();
  const sauvegarde = relire();

  // Un spectateur n'a pas d'identifiant : c'est le code qui le ramène au suivi.
  if (sauvegarde?.spectateur && (!code || sauvegarde.code === code)) {
    session = { ...session, ...sauvegarde };
    return validerCode(sauvegarde.code);
  }
  // Une saisie en cours sur cette même partie : on la reprend là où elle s'est arrêtée
  if (sauvegarde?.idJoueur && (!code || sauvegarde.code === code)) {
    return reprendre(sauvegarde);
  }
  if (sauvegarde) oublier();

  if (code) return validerCode(code);

  montrer('screen-code');
  dessinerCases();
  document.getElementById('champ-code').focus();
}

demarrer();
