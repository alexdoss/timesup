// ===== PAGE DES INVITÉS =====
// Servie à l'adresse /rejoindre.html, c'est ce qu'ouvre le QR code.
// Volontairement autonome : elle ne charge ni le moteur de jeu, ni les thèmes,
// ni le service worker. Un invité qui n'a jamais installé Rush doit voir un
// champ de saisie en une seconde, même sur un réseau de salle des fêtes.

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
  montrer('screen-code');
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

    if (!etat.ouverte) {
      return bloquer('🚪', 'La partie a démarré',
        "Cette partie est déjà lancée. Demande à l'organisateur d'en ouvrir une nouvelle.", null, null);
    }

    document.getElementById('note-prenom').textContent =
      "Il permet à l'organisateur de savoir qui a fini, et de te placer dans une équipe.";

    montrer('screen-prenom');
    document.getElementById('champ-prenom').focus();
  } catch (err) {
    surErreur(err);
  }
}

// ===== Étape 2 : le prénom =====

async function validerPrenom() {
  const champ = document.getElementById('champ-prenom');
  const erreur = document.getElementById('erreur-prenom');
  const prenom = champ.value.trim();

  if (prenom.length < 1) {
    erreur.textContent = 'Indique ton prénom pour continuer.';
    return;
  }
  erreur.textContent = '';

  try {
    const reponse = await appeler('rejoindre', { code: session.code, prenom });
    session.idJoueur = reponse.idJoueur;
    session.prenom = reponse.prenom;
    session.cartesParJoueur = reponse.cartesParJoueur;
    session.mode = reponse.mode;
    session.cartes = [];
    session.fini = false;
    sauvegarder();
    ouvrirSaisie();
  } catch (err) {
    // Prénom déjà pris : on corrige sur place, sans écran bloquant
    if (err.details?.motif === 'prenom-pris') {
      erreur.textContent = err.message;
      champ.select();
      return;
    }
    surErreur(err);
  }
}

// ===== Étape 3 : les cartes =====

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
  document.getElementById('compteur-cartes').textContent =
    n >= cible ? `${n} cartes — c'est bon !` : `${n} / ${cible} cartes`;
  document.getElementById('jauge-remplie').style.width = Math.min(100, (n / cible) * 100) + '%';
  document.getElementById('btn-terminer').disabled = n < cible;
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
  document.getElementById('total-envoye').textContent = session.cartes.length;
  montrer('screen-envoye');
}

// Revenir modifier repasse le joueur en saisie : côté organisateur, le
// lancement se rebloque aussitôt.
async function modifier() {
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

    if (!etat.ouverte) {
      return bloquer('🚪', 'La partie a démarré',
        'Cette partie est déjà lancée. Tes cartes sont bien parties.', null, null);
    }
    // Le joueur existe-t-il toujours ? L'organisateur a pu le retirer.
    if (!etat.joueurs.some(j => j.id === session.idJoueur)) {
      oublier();
      return validerCode(session.code);
    }

    if (session.fini) {
      document.getElementById('total-envoye').textContent = session.cartes.length;
      montrer('screen-envoye');
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
  });

  document.getElementById('btn-code').addEventListener('click', () => {
    const code = champCode.value.trim();
    if (code.length !== 4) {
      document.getElementById('erreur-code').textContent = 'Le code fait 4 caractères.';
      return;
    }
    validerCode(code);
  });

  document.getElementById('btn-prenom').addEventListener('click', validerPrenom);
  document.getElementById('champ-prenom').addEventListener('keypress', e => {
    if (e.key === 'Enter') validerPrenom();
  });

  document.getElementById('btn-ajouter').addEventListener('click', ajouterCarte);
  document.getElementById('champ-carte').addEventListener('keypress', e => {
    if (e.key === 'Enter') ajouterCarte();
  });

  document.getElementById('btn-terminer').addEventListener('click', terminer);
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

  // Une saisie en cours sur cette même partie : on la reprend là où elle s'est arrêtée
  if (sauvegarde?.idJoueur && (!code || sauvegarde.code === code)) {
    return reprendre(sauvegarde);
  }
  if (sauvegarde) oublier();

  if (code) return validerCode(code);

  montrer('screen-code');
  document.getElementById('champ-code').focus();
}

demarrer();
