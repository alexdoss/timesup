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

    montrer('screen-prenom');
    afficherChoixPrenom(etat);
  } catch (err) {
    surErreur(err);
  }
}

// ===== Étape 2 : le prénom =====
// Deux formes selon la partie : saisie libre pour une partie neuve, choix dans
// une liste quand on rejoue avec les mêmes joueurs. Le choix évite les doublons,
// les fautes de frappe, et permet à l'organisateur de savoir qui manque.

function afficherChoixPrenom(etat) {
  const attendus = etat.attendus || [];
  const parListe = attendus.length > 0;

  document.getElementById('bloc-liste-prenoms').style.display = parListe ? '' : 'none';
  document.getElementById('bloc-saisie-prenom').style.display = parListe ? 'none' : '';
  document.getElementById('note-prenom').textContent = parListe
    ? "Cette partie rejoue avec les mêmes joueurs. Touche ton prénom pour saisir tes nouvelles cartes."
    : "Il permet à l'organisateur de savoir qui a fini, et de te placer dans une équipe.";

  if (!parListe) {
    document.getElementById('champ-prenom').focus();
    return;
  }

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
    sauvegarder();
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

function quitterAttente() {
  clearInterval(minuterieAttente);
  minuterieAttente = null;
  montrer('screen-envoye');
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

async function rafraichirAttente() {
  try {
    if (!saisieClose) {
      const etat = await appeler('etat', { code: session.code });
      rendreAttente(etat);
      if (etat.ouverte !== false) return;
      saisieClose = true;
    }
    const reponse = await appeler('suivre', { code: session.code });
    rendreConfiguration(reponse.suivi, reponse.serveur);
  } catch {
    // Coupure passagère : on garde le dernier affichage plutôt que de le vider
  }
}

// Les moments où l'organisateur voit son écran de début de tour. L'invité voit
// le même, sans le bouton « Lancer le tour » qui reste à la main de l'organisateur.
const ETAPES_LANCEMENT = ['attente', 'entre-tours'];

// Les moments où le chrono tourne chez l'organisateur
const ETAPES_TOUR = ['tour', 'pause'];
// … et ceux où il montre un tableau de résultats
const ETAPES_RESULTAT = ['fin-manche', 'fin-partie'];

// L'organisateur poursuit sa configuration, puis la partie s'enchaîne.
function rendreConfiguration(suivi, heureServeur) {
  const etat = suivi?.etat;
  const etape = etat?.etape;
  const enLancement = ETAPES_LANCEMENT.includes(etape) && !!etat?.manche;
  const enTour = ETAPES_TOUR.includes(etape) && !!etat?.tour;
  const enResultat = ETAPES_RESULTAT.includes(etape);

  // L'en-tête « configuration en cours » cède la place dès que la partie tourne
  const enJeu = enLancement || enTour || enResultat;
  document.getElementById('attente-roue').style.display = enJeu ? 'none' : '';
  document.getElementById('attente-titre').parentElement.style.display = enJeu ? 'none' : '';
  document.getElementById('bloc-lancement').style.display = enLancement ? '' : 'none';
  document.getElementById('bloc-tour').style.display = enTour ? '' : 'none';
  document.getElementById('bloc-resultats').style.display = enResultat ? '' : 'none';
  if (enLancement) rendreLancement(etat);
  if (enResultat) rendreResultats(etat);
  if (enTour) ancrerTour(etat, suivi.publieA, heureServeur);
  else ancreTour = null;

  const equipes = suivi?.etat?.equipes || [];
  const nommees = equipes.filter(e => (e.joueurs || []).length > 0);
  const bouton = document.getElementById('btn-voir-equipes');
  // Masqué pendant le tour et sur les résultats : l'écran doit rester lisible
  bouton.style.display = (nommees.length && !enTour && !enResultat) ? '' : 'none';
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

  rendreJoueurs(finale ? (etat.joueurs || []) : [], manches, etat.equipes);
}

// Le détail par joueur, replié : l'écran reste court même à dix joueurs
// et cinq manches, et le résumé donne déjà le meilleur sans qu'on ouvre.
function rendreJoueurs(joueurs, manches, equipes) {
  const boite = document.getElementById('resultats-joueurs');
  boite.innerHTML = '';
  if (!joueurs.length) return;

  const meilleur = [...joueurs].sort((a, b) => b.total - a.total)[0];
  const tiroir = document.createElement('details');
  tiroir.className = 'drawer';
  tiroir.id = 'resultats-tiroir-joueurs';

  const resume = document.createElement('summary');
  resume.textContent = `📊 Les joueurs — ${meilleur.nom} en tête avec ${meilleur.total}`;
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
  enTete.appendChild(cellule('th', 'Tot.'));
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

    (joueur.parManche || []).forEach(v => tr.appendChild(cellule('td', String(v))));
    const total = cellule('td', String(joueur.total));
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
// Point d'ancrage : « il restait X secondes, et je l'ai su à l'instant Y de MA
// propre montre ». Ensuite on ne compte que des écarts locaux, jamais des heures
// absolues — c'est ce qui rend le décompte juste alors que deux téléphones ne
// sont jamais réglés à la même heure.
let ancreTour = null;
const SECONDES_URGENCE = 5;   // le moment où l'app fait tic-tac chez l'organisateur

function ancrerTour(etat, publieA, heureServeur) {
  const tour = etat.tour;
  const gele = etat.etape === 'pause';

  // Ne réancrer que sur une publication nouvelle. L'organisateur ne publie qu'à
  // chaque carte trouvée et toutes les quinze secondes ; sans cette garde, les
  // lectures intermédiaires relisaient le même « il reste 40 s » et remettaient
  // le décompte à son point de départ toutes les deux secondes.
  if (ancreTour && ancreTour.publieA === publieA) {
    ancreTour.gele = gele;
    return;
  }
  // Les deux horodatages viennent du serveur : l'écart entre publication et
  // réponse est mesuré sans qu'aucune montre de téléphone n'intervienne.
  const enRoute = (heureServeur - publieA) / 1000;

  ancreTour = {
    restant: gele ? tour.restant : Math.max(0, tour.restant - enRoute),
    gele,
    publieA,
    recuA: performance.now(),
    duree: tour.duree || 40,
    manche: etat.manche,
    equipe: etat.equipes[tour.equipe],
    joueur: tour.joueur
  };
  peindreChrono();
}

// Le sablier. Repères de la verrerie, en unités du dessin : le bulbe du haut va
// de 12 au col (70), celui du bas du col à 128.
const SABLE_HAUT = 12, SABLE_COL = 70, SABLE_BAS = 128;
const SABLE_TAS = 42;   // hauteur du tas accumulé en bas quand tout est écoulé

function peindreSablier(part, coule) {
  const p = Math.min(1, Math.max(0, part));
  // Surface du sable restant, en haut : elle descend vers le col
  const surface = SABLE_HAUT + (1 - p) * (SABLE_COL - SABLE_HAUT);
  // Niveau du tas, en bas : il monte depuis le fond
  const niveau = SABLE_BAS - (1 - p) * SABLE_TAS;

  const poser = (id, y, hauteur) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('y', y.toFixed(2));
    el.setAttribute('height', Math.max(0, hauteur).toFixed(2));
  };

  poser('sable-haut', surface, SABLE_COL - surface);
  poser('sable-bas', niveau, SABLE_BAS - niveau);
  // Le filet ne coule que tant que le temps s'écoule vraiment
  poser('sable-filet', SABLE_COL, coule ? niveau - SABLE_COL : 0);
}

function peindreChrono() {
  if (!ancreTour) return;
  const a = ancreTour;
  const restant = a.gele
    ? a.restant
    : Math.max(0, a.restant - (performance.now() - a.recuA) / 1000);

  const urgent = restant > 0 && restant <= SECONDES_URGENCE;
  document.getElementById('tour-chrono').textContent = Math.ceil(restant);
  document.getElementById('tour-bloc-chrono').classList.toggle('urgent', urgent && !a.gele);
  peindreSablier(restant / a.duree, !a.gele && restant > 0);

  const T = (id, texte) => { document.getElementById(id).textContent = texte; };
  T('tour-manche', a.manche ? `Manche ${a.manche.numero}/${a.manche.sur} · ${a.manche.nom}` : '');
  T('tour-qui', a.joueur
    ? `${a.equipe?.nom} · ${a.joueur} fait deviner`
    : `Au tour de ${a.equipe?.nom}`);
  if (a.equipe?.couleur) document.getElementById('tour-qui').style.color = a.equipe.couleur;

  // Entre la fin du temps et le moment où l'organisateur passe à la suite,
  // il s'écoule quelques secondes : mieux vaut le dire qu'afficher un zéro nu.
  T('tour-mention', a.gele ? '⏸ Partie en pause' : (restant <= 0 ? '⏰ Temps écoulé !' : ''));
}

// Le décompte tourne en local, sans rien demander au serveur
setInterval(() => {
  if (ancreTour && !ancreTour.gele) peindreChrono();
}, 200);

// Le même écran que celui de l'organisateur au début d'un tour. On ne reprend
// pas son bouton « Lancer le tour » : le départ reste à sa main.
function rendreLancement(etat) {
  const m = etat.manche;
  const T = (id, texte) => { document.getElementById(id).textContent = texte; };

  T('lancement-titre', `Manche ${m.numero}/${m.sur}`);
  T('lancement-nom', `${m.icone} ${m.nom}`);
  T('lancement-icone', m.icone);
  T('lancement-regle', m.regle || '');

  const [e1, e2] = etat.equipes;
  T('lancement-eq1', e1.nom);
  T('lancement-eq2', e2.nom);
  T('lancement-s1', e1.manche);
  T('lancement-s2', e2.manche);
  T('lancement-total', `Total de la partie : ${e1.partie} – ${e2.partie}`);

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

function rendreAttente(etat) {
  // Une session fermée veut dire que le paquet est figé — pas que la partie a
  // commencé : l'organisateur enchaîne sur les équipes, les manches et les
  // réglages. Les vrais écrans de suivi viendront ensuite.
  //
  // À traiter plus tard : en rejeu (« rejouer avec les mêmes joueurs »), la
  // configuration est déjà faite et la partie démarre aussitôt. Ce libellé sera
  // alors faux pendant quelques secondes.
  const configEnCours = etat.ouverte === false;
  document.getElementById('attente-titre').textContent =
    configEnCours ? 'Configuration de la partie en cours' : 'En attente du départ';
  document.getElementById('attente-sous').textContent = configEnCours
    ? "L'organisateur règle les équipes et les manches. La partie démarre juste après."
    : "On attend que tout le monde ait saisi ses cartes.";
  document.getElementById('btn-attente-retour').style.display = configEnCours ? 'none' : '';
  document.getElementById('attente-roue').style.display = configEnCours ? '' : 'none';

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

    const compte = document.createElement('span');
    compte.className = 'etat';
    compte.textContent = joueur.fini
      ? `${joueur.nbCartes} cartes ✓`
      : `${joueur.nbCartes}/${etat.cartesParJoueur}…`;

    ligne.appendChild(qui);
    ligne.appendChild(compte);
    liste.appendChild(ligne);
  });

  const prets = etat.joueurs.filter(j => j.fini).length;
  document.getElementById('attente-total').textContent = configEnCours
    ? `${etat.total} cartes dans le paquet`
    : `${prets} joueur(s) sur ${etat.joueurs.length} ont terminé · ${etat.total} cartes`;
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
  document.getElementById('btn-suivre').addEventListener('click', ouvrirAttente);
  document.getElementById('btn-attente-retour').addEventListener('click', quitterAttente);
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
