// ===== SESSION DE SAISIE PARTAGÉE =====
// Point de rendez-vous entre le téléphone de l'organisateur et ceux des invités.
// C'est la seule partie de Rush qui exige du réseau : sans stockage configuré,
// la route répond 503 et l'app bascule sur la saisie « on se passe le téléphone ».
//
// Modèle de données — un hachage Redis par session, `rush:session:<CODE>` :
//   champ "config"  → { creee, cartesParJoueur, mode, jeton, ouverte }
//   champ "j:<id>"  → { prenom, role, cartes: [...], fini, maj }
//
// Un hachage plutôt qu'une seule valeur JSON : chaque joueur écrit dans SON champ.
// Avec une valeur unique, deux invités qui valident en même temps liraient le même
// état et le dernier écraserait le premier — une soirée entière perdrait des cartes.
//
// Ce fichier duplique volontairement une vingtaine de lignes de dialogue avec le
// stockage, présentes aussi dans api/generate.js : chaque fonction serveur reste
// autonome, ce qui permet de la charger et de la tester isolément.

const DUREE_SESSION_S = 2 * 60 * 60;      // au-delà, la session s'efface d'elle-même
const MAX_JOUEURS = 30;   // doit rester égal à JOUEURS_MAX dans js/app.js
const MAX_CARTES = 20;                     // par joueur
const LONGUEUR_CARTE_MAX = 40;
const LONGUEUR_PRENOM_MAX = 20;
const SESSIONS_PAR_IP_PAR_JOUR = 30;       // garde-fou contre la création en boucle

// Alphabet sans caractères confondables (pas de O/0 ni de I/1) : le code est lu
// à voix haute et recopié à la main.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LONGUEUR_CODE = 4;

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// ===== Dialogue avec le stockage =====

async function commandeKV(commande) {
  const reponse = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commande)
  });
  if (!reponse.ok) throw new Error(`KV ${reponse.status}`);
  const { result } = await reponse.json();
  return result;
}

function cleSession(code) {
  return `rush:session:${code}`;
}

// Upstash renvoie HGETALL sous forme de tableau plat [champ, valeur, champ, valeur…]
function enObjet(resultat) {
  if (!resultat) return {};
  if (!Array.isArray(resultat)) return resultat;
  const objet = {};
  for (let i = 0; i < resultat.length; i += 2) objet[resultat[i]] = resultat[i + 1];
  return objet;
}

function analyser(valeur) {
  try {
    return typeof valeur === 'string' ? JSON.parse(valeur) : valeur;
  } catch {
    return null;
  }
}

async function lireSession(code) {
  const brut = enObjet(await commandeKV(['HGETALL', cleSession(code)]));
  const config = analyser(brut.config);
  if (!config) return null;

  const joueurs = {};
  Object.keys(brut)
    .filter(champ => champ.startsWith('j:'))
    .forEach(champ => {
      const joueur = analyser(brut[champ]);
      if (joueur) joueurs[champ.slice(2)] = joueur;
    });

  return { config, joueurs };
}

// ===== Petits utilitaires =====

function jourCourant() {
  return new Date().toISOString().slice(0, 10);
}

function adresseAppelant(req) {
  const entete = req.headers['x-forwarded-for'] || '';
  return entete.split(',')[0].trim() || 'inconnue';
}

function tirerCode() {
  let code = '';
  for (let i = 0; i < LONGUEUR_CODE; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

function tirerIdentifiant() {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 16);
}

function nettoyerPrenom(valeur) {
  return String(valeur ?? '').trim().slice(0, LONGUEUR_PRENOM_MAX);
}

// Les cartes viennent d'un téléphone qu'on ne contrôle pas : on borne tout.
function nettoyerCartes(valeur) {
  if (!Array.isArray(valeur)) return [];
  const vues = new Set();
  const propres = [];
  for (const brut of valeur) {
    const mot = String(brut ?? '').trim().slice(0, LONGUEUR_CARTE_MAX);
    if (mot.length < 2) continue;
    const repere = mot.toLocaleLowerCase();
    if (vues.has(repere)) continue;
    vues.add(repere);
    propres.push(mot);
    if (propres.length >= MAX_CARTES) break;
  }
  return propres;
}

// Vue publique d'un joueur : jamais ses cartes. L'organisateur voit qui a fini,
// pas ce qui a été écrit — les cartes ne descendent qu'au lancement de la partie.
function vuePublique(id, joueur) {
  return {
    id,
    prenom: joueur.prenom,
    role: joueur.role,
    nbCartes: joueur.cartes.length,
    fini: !!joueur.fini
  };
}

async function garderPlafondCreation(req) {
  const cle = `rush:sessions:${jourCourant()}:${adresseAppelant(req)}`;
  try {
    const compte = await commandeKV(['INCR', cle]);
    if (compte === 1) await commandeKV(['EXPIRE', cle, 172800]);
    return compte <= SESSIONS_PAR_IP_PAR_JOUR;
  } catch {
    return true;   // compteur indisponible : on laisse passer plutôt que de bloquer
  }
}

// ===== Actions =====

// Liste fermée de joueurs attendus, utilisée quand on rejoue avec les mêmes
// personnes : les invités choisissent leur prénom au lieu de le retaper.
function nettoyerListe(valeur) {
  if (!Array.isArray(valeur)) return [];
  const vus = new Set();
  const liste = [];
  for (const brut of valeur) {
    const prenom = nettoyerPrenom(brut);
    if (prenom.length < 1) continue;
    const repere = prenom.toLocaleLowerCase();
    if (vus.has(repere)) continue;
    vus.add(repere);
    liste.push(prenom);
    if (liste.length >= MAX_JOUEURS) break;
  }
  return liste;
}

async function creer(req, res) {
  const cartesParJoueur = Math.max(2, Math.min(15, parseInt(req.body.cartesParJoueur, 10) || 5));
  const mode = req.body.mode === 'nominatif' ? 'nominatif' : 'simple';
  const attendus = nettoyerListe(req.body.joueursAttendus);

  // Partie jouée avec des thèmes prédéfinis : personne ne saisit de cartes, la
  // session ne sert qu'à regarder. Elle naît donc close — il n'y a rien à
  // attendre — et les invités qui la rejoignent sont de simples spectateurs.
  const suiviSeul = req.body.suiviSeul === true;

  // Partie à thèmes en mode nominatif : les invités donnent leur prénom, et
  // rien d'autre. La session reste ouverte le temps des inscriptions, mais
  // personne n'y dépose de carte — c'est ce qui la distingue de la saisie
  // partagée, et ce qui permet de la clore sans exiger un paquet.
  const inscription = req.body.inscription === true;

  if (!(await garderPlafondCreation(req))) {
    return res.status(429).json({ error: "Trop de sessions ouvertes depuis cette connexion aujourd'hui." });
  }

  // On retire tant qu'on tombe sur un code déjà pris. Quatre caractères offrent
  // un million de combinaisons : en pratique, le premier tirage suffit.
  let code = null;
  for (let essai = 0; essai < 6 && !code; essai++) {
    const candidat = tirerCode();
    const existe = await commandeKV(['EXISTS', cleSession(candidat)]);
    if (!existe) code = candidat;
  }
  if (!code) {
    return res.status(503).json({ error: "Impossible d'ouvrir une session pour le moment. Réessaie." });
  }

  const jeton = tirerIdentifiant();
  const config = {
    creee: Date.now(), cartesParJoueur, mode, jeton,
    ouverte: !suiviSeul, attendus, partie: 1, suiviSeul, inscription
  };

  await commandeKV(['HSET', cleSession(code), 'config', JSON.stringify(config)]);
  await commandeKV(['EXPIRE', cleSession(code), DUREE_SESSION_S]);

  return res.status(200).json({
    code,
    jeton,
    cartesParJoueur,
    mode,
    attendus,
    suiviSeul,
    inscription,
    expireDans: DUREE_SESSION_S
  });
}

async function rejoindre(req, res, session, code) {
  const role = ['organisateur', 'sansTel'].includes(req.body.role) ? req.body.role : 'invite';

  // Seul l'organisateur peut inscrire quelqu'un à sa place ou se déclarer lui-même
  if (role !== 'invite' && req.body.jeton !== session.config.jeton) {
    return res.status(403).json({ error: 'Action réservée à l\'organisateur.' });
  }

  const prenom = nettoyerPrenom(req.body.prenom);
  if (prenom.length < 1) {
    return res.status(400).json({ error: 'Indique ton prénom.' });
  }

  // Liste fermée : on rejoue avec les mêmes joueurs, personne d'autre n'entre.
  const attendus = session.config.attendus || [];
  if (attendus.length > 0
      && !attendus.some(nom => nom.toLocaleLowerCase() === prenom.toLocaleLowerCase())) {
    return res.status(409).json({
      error: "Cette partie rejoue avec les mêmes joueurs : choisis ton prénom dans la liste.",
      motif: 'hors-liste'
    });
  }

  // Deux « Marc » rendraient la répartition des équipes et les statistiques
  // illisibles : on refuse avant d'inscrire.
  const dejaPris = Object.values(session.joueurs)
    .some(j => j.prenom.toLocaleLowerCase() === prenom.toLocaleLowerCase());
  if (dejaPris) {
    return res.status(409).json({
      error: `Il y a déjà un ${prenom} dans cette partie. Ajoute une initiale pour te distinguer.`,
      motif: 'prenom-pris'
    });
  }
  if (Object.keys(session.joueurs).length >= MAX_JOUEURS) {
    return res.status(409).json({ error: `Cette partie est complète (${MAX_JOUEURS} joueurs).` });
  }

  const idJoueur = tirerIdentifiant();
  const joueur = { prenom, role, cartes: [], fini: false, maj: Date.now() };
  await commandeKV(['HSET', cleSession(code), `j:${idJoueur}`, JSON.stringify(joueur)]);

  return res.status(200).json({
    idJoueur,
    prenom,
    cartesParJoueur: session.config.cartesParJoueur,
    mode: session.config.mode
  });
}

async function deposer(req, res, session, code) {
  const idJoueur = String(req.body.idJoueur || '');
  const existant = session.joueurs[idJoueur];
  if (!existant) {
    return res.status(404).json({ error: "Tu as été retiré de cette partie. Rejoins-la à nouveau." });
  }

  const cartes = nettoyerCartes(req.body.cartes);
  const fini = !!req.body.fini && cartes.length >= session.config.cartesParJoueur;

  const joueur = { ...existant, cartes, fini, maj: Date.now() };
  await commandeKV(['HSET', cleSession(code), `j:${idJoueur}`, JSON.stringify(joueur)]);

  return res.status(200).json({ nbCartes: cartes.length, fini });
}

function etat(req, res, session) {
  const joueurs = Object.entries(session.joueurs).map(([id, j]) => vuePublique(id, j));
  return res.status(200).json({
    cartesParJoueur: session.config.cartesParJoueur,
    mode: session.config.mode,
    attendus: session.config.attendus || [],
    ouverte: session.config.ouverte !== false,
    // Session de suivi seul : rien à saisir, on entre directement en spectateur
    suiviSeul: session.config.suiviSeul === true,
    // Session d'inscription : on donne son prénom, et rien d'autre
    inscription: session.config.inscription === true,
    // Numéro de partie : c'est lui qui dit à un invité qu'une nouvelle a commencé
    partie: Number(session.config.partie) || 1,
    joueurs,
    total: joueurs.reduce((n, j) => n + j.nbCartes, 0),
    tousPrets: joueurs.length > 0 && joueurs.every(j => j.fini)
  });
}

// Retrait d'un joueur : par l'organisateur, ou par le joueur lui-même quand il
// quitte la partie. Sans cette seconde voie, il resterait inscrit sans cartes et
// bloquerait le lancement pour tout le monde.
//
// Se retirer soi-même ne demande que de connaître son propre identifiant. Ce
// n'est pas une preuve solide — `etat` publie les identifiants à qui a le code —
// mais le modèle de confiance est déjà celui-là : quiconque a le code peut
// rejoindre sous un faux nom ou saisir n'importe quoi. Le code se partage dans
// une pièce, entre gens qui jouent ensemble.
async function retirer(req, res, session, code) {
  const soiMeme = req.body.soiMeme === true;
  if (!soiMeme && req.body.jeton !== session.config.jeton) {
    return res.status(403).json({ error: 'Action réservée à l\'organisateur.' });
  }
  const idJoueur = String(req.body.idJoueur || '');
  if (!session.joueurs[idJoueur]) {
    return res.status(404).json({ error: 'Ce joueur ne fait pas partie de la session.' });
  }
  await commandeKV(['HDEL', cleSession(code), `j:${idJoueur}`]);
  return res.status(200).json({ ok: true });
}

// Fermeture : c'est le seul moment où les cartes descendent vers l'organisateur.
async function fermer(req, res, session, code) {
  if (req.body.jeton !== session.config.jeton) {
    return res.status(403).json({ error: 'Action réservée à l\'organisateur.' });
  }

  const joueurs = Object.values(session.joueurs);

  // Session d'inscription : personne ne saisit de carte, il n'y a donc ni
  // attente à surveiller ni paquet à rapatrier. On la clôt sur les prénoms.
  if (session.config.inscription) {
    await commandeKV(['HSET', cleSession(code), 'config',
      JSON.stringify({ ...session.config, ouverte: false })]);
    return res.status(200).json({ cartes: [], joueurs: detailJoueurs(session) });
  }

  const enCours = joueurs.filter(j => !j.fini);
  if (enCours.length > 0) {
    return res.status(409).json({
      error: 'Des joueurs saisissent encore leurs cartes.',
      enAttente: enCours.map(j => j.prenom)
    });
  }

  // Deux joueurs peuvent proposer la même carte : elle sortira deux fois, ce
  // qui ne gêne pas le jeu. On ne dédoublonne pas — le faire supposerait de
  // révéler à un joueur ce qu'un autre a écrit, ou de rétrécir le paquet en silence.
  const cartes = [];
  joueurs.forEach(j => cartes.push(...j.cartes));

  if (cartes.length === 0) {
    return res.status(409).json({ error: 'Aucune carte n\'a été saisie.' });
  }

  const config = { ...session.config, ouverte: false };
  await commandeKV(['HSET', cleSession(code), 'config', JSON.stringify(config)]);

  return res.status(200).json({ cartes, joueurs: detailJoueurs(session) });
}

// L'identifiant accompagne le prénom : c'est lui qui permettra plus tard de
// confier un tour au bon téléphone. Sans lui, l'organisateur ne saurait pas
// qui joindre — un prénom ne désigne aucun appareil.
function detailJoueurs(session) {
  return Object.entries(session.joueurs).map(([id, j]) => ({
    id, prenom: j.prenom, role: j.role, nbCartes: (j.cartes || []).length
  }));
}

// Rejouer avec les mêmes joueurs : la session est recyclée plutôt que refaite.
// Le code reste celui de la soirée, ce qui évite à chacun de rescanner un QR
// entre deux parties — et le téléphone des invités, qui connaît déjà ce code,
// découvre tout seul qu'une nouvelle partie commence.
async function relancer(req, res, session, code) {
  if (req.body.jeton !== session.config.jeton) {
    return res.status(403).json({ error: "Action réservée à l'organisateur." });
  }

  const entrees = Object.entries(session.joueurs);
  if (entrees.length === 0) {
    return res.status(409).json({ error: 'Cette partie n\'a aucun joueur à rappeler.' });
  }

  const cartesParJoueur = Math.max(2, Math.min(MAX_CARTES,
    Number(req.body.cartesParJoueur) || session.config.cartesParJoueur));

  // Le numéro de partie est ce qui permet à un invité de distinguer « la partie
  // que j'ai déjà jouée » de « une nouvelle vient de commencer ».
  const config = {
    ...session.config,
    ouverte: true,
    cartesParJoueur,
    partie: (Number(session.config.partie) || 1) + 1,
    // La liste se referme sur ceux qui étaient là : chacun se reconnaîtra
    attendus: entrees.map(([, j]) => j.prenom)
  };

  // Les cartes repartent à zéro, les joueurs restent inscrits
  for (const [id, joueur] of entrees) {
    await commandeKV(['HSET', cleSession(code), `j:${id}`,
      JSON.stringify({ ...joueur, cartes: [], fini: false, maj: Date.now() })]);
  }
  await commandeKV(['HSET', cleSession(code), 'config', JSON.stringify(config)]);
  // Une soirée dure plus longtemps qu'une partie : on repousse l'expiration
  await commandeKV(['EXPIRE', cleSession(code), DUREE_SESSION_S]);
  // Le suivi de la partie précédente n'a plus lieu d'être, et le repartir de
  // zéro évite que son compteur de version, resté haut, ne fasse rejeter les
  // publications de la nouvelle partie.
  await commandeKV(['DEL', cleSuivi(code)]);

  return res.status(200).json({
    code, partie: config.partie, cartesParJoueur, attendus: config.attendus
  });
}

// ===== Suivi de partie (les invités regardent, ils n'écrivent pas) =====
// Une clé séparée de la session, volontairement : un invité qui suit la partie
// lit une seule petite valeur en une seule commande, au lieu de charger tous
// les joueurs et toutes leurs cartes. À dix invités interrogeant toutes les
// trois secondes pendant trois quarts d'heure, l'écart se compte en milliers
// de commandes.
//
// Rien de ce qui est publié ici n'est secret : n'y mettre aucun mot du paquet,
// sous peine de le rendre lisible par les joueurs eux-mêmes.

const DUREE_SUIVI_S = 3 * 60 * 60;   // une partie tient largement dedans
const TAILLE_SUIVI_MAX = 4096;       // le corps vient d'un navigateur : on le borne

function cleSuivi(code) {
  return `rush:suivi:${code}`;
}

async function publier(req, res, code) {
  // HGET du seul champ utile plutôt que la session entière : publier arrive
  // souvent, et les cartes des joueurs n'ont rien à faire dans cet échange.
  const config = analyser(await commandeKV(['HGET', cleSession(code), 'config']));
  if (!config) {
    return res.status(404).json({ error: 'Aucune partie ne porte ce code.' });
  }
  // L'organisateur publie, et — pendant son tour — le joueur à qui le paquet a
  // été confié. Sans cette seconde voie, les invités n'apprendraient le départ
  // du chrono qu'au retour du tour : personne ne verrait le sablier tourner.
  let autorise = req.body.jeton === config.jeton;
  if (!autorise && req.body.idJoueur) {
    const tour = analyser(await commandeKV(['GET', cleTour(code)]));
    autorise = !!tour && tour.idJoueur === String(req.body.idJoueur) && !tour.rendu;
  }
  if (!autorise) {
    return res.status(403).json({ error: "Action réservée à l'organisateur." });
  }

  const etat = req.body.etat;
  if (!etat || typeof etat !== 'object') {
    return res.status(400).json({ error: 'État de partie manquant.' });
  }

  // L'heure vient du serveur, jamais du téléphone : c'est ce qui permet de
  // mesurer un délai réel entre deux appareils dont les horloges diffèrent.
  const publieA = Date.now();
  const version = Number(req.body.v) || 0;
  const charge = JSON.stringify({ v: version, publieA, etat });
  if (charge.length > TAILLE_SUIVI_MAX) {
    return res.status(413).json({ error: 'État de partie trop volumineux.' });
  }

  // Une publication plus ancienne ne doit jamais écraser une plus récente.
  // Quand les cartes s'enchaînent vite, plusieurs envois sont en vol en même
  // temps et rien ne garantit leur ordre d'arrivée : sans ce contrôle, un
  // « tour en cours » émis avant pouvait recouvrir le « fin de tour » émis
  // après, et les invités restaient sur un écran périmé.
  // Les battements réémettent la même version : ils sont acceptés, c'est ce qui
  // rafraîchit l'horodatage et prouve que l'organisateur est toujours là.
  const actuel = analyser(await commandeKV(['GET', cleSuivi(code)]));
  if (actuel && Number(actuel.v) > version) {
    return res.status(200).json({ v: actuel.v, publieA: actuel.publieA, ignore: true });
  }

  await commandeKV(['SET', cleSuivi(code), charge, 'EX', DUREE_SUIVI_S]);
  return res.status(200).json({ v: version, publieA });
}

async function suivre(req, res, code) {
  const charge = analyser(await commandeKV(['GET', cleSuivi(code)]));
  // `serveur` donne l'heure du serveur : le téléphone s'en sert pour corriger
  // sa propre horloge, sans quoi le décompte qu'il calcule serait faux.
  return res.status(200).json({ suivi: charge, serveur: Date.now() });
}

// ===== Le tour confié à un joueur =====
// Le seul endroit où des mots du paquet transitent. Ils ne vont pas dans le
// suivi — que tout le monde lit — mais dans une clé à part, rendue au seul
// joueur à qui le tour a été confié.
//
// Le paquet est PRÊTÉ, pas interrogé : le joueur reçoit d'un coup les mots de
// son tour et joue en local. Demander la carte suivante au serveur à chaque
// « Trouvé » coûterait un aller-retour — 270 ms en moyenne, dix secondes dans
// le pire cas mesuré — et rendrait le jeu injouable. Effet de bord heureux :
// une coupure réseau en plein tour n'interrompt plus rien.

const DUREE_TOUR_S = 30 * 60;        // un tour dure une minute ; large de reste
const TAILLE_TOUR_MAX = 16384;       // un paquet entier de mots, borné

function cleTour(code) {
  return `rush:tour:${code}`;
}

// L'organisateur confie le tour : à qui, avec quels mots, pour combien de temps.
// Les règles de passe, ramenées à ce que le téléphone doit savoir. On les
// valide ici plutôt que de faire confiance à ce qui arrive : une valeur
// inconnue vaut « illimité », c'est-à-dire ce que faisait l'app avant.
function reglesDePasse(brut) {
  const modes = ['unlimited', 'limited', 'forbidden'];
  const mode = modes.includes(brut?.mode) ? brut.mode : 'unlimited';
  const limite = Math.max(0, Math.min(99, Number(brut?.limite) || 0));
  return {
    mode,
    limite,
    remise: brut?.remise === 'random' ? 'random' : 'bottom'
  };
}

async function confierTour(req, res, code) {
  const config = analyser(await commandeKV(['HGET', cleSession(code), 'config']));
  if (!config) {
    return res.status(404).json({ error: 'Aucune partie ne porte ce code.' });
  }
  if (req.body.jeton !== config.jeton) {
    return res.status(403).json({ error: "Action réservée à l'organisateur." });
  }

  const idJoueur = String(req.body.idJoueur || '');
  const mots = Array.isArray(req.body.mots) ? req.body.mots.map(m => String(m)) : null;
  if (!idJoueur || !mots) {
    return res.status(400).json({ error: 'Tour incomplet.' });
  }

  const charge = JSON.stringify({
    idJoueur,
    mots,
    duree: Number(req.body.duree) || 40,
    // Ce tour reprend les secondes gagnées à la manche précédente : le téléphone
    // le dit au joueur, qui verrait sinon son chrono partir bien plus bas que
    // d'habitude sans savoir pourquoi.
    reporte: req.body.reporte === true,
    manche: req.body.manche || null,
    // Les règles de passe de la partie. Sans elles, le téléphone jouerait avec
    // les siennes — passes illimitées, carte remise en bas — même sur une
    // partie où l'organisateur a interdit de passer.
    passe: reglesDePasse(req.body.passe),
    confieA: Date.now(),
    rendu: null
  });
  if (charge.length > TAILLE_TOUR_MAX) {
    return res.status(413).json({ error: 'Paquet trop volumineux.' });
  }

  await commandeKV(['SET', cleTour(code), charge, 'EX', DUREE_TOUR_S]);
  return res.status(200).json({ confie: true, idJoueur });
}

// Lecture, par le joueur concerné ou par l'organisateur.
// Les mots ne sortent que pour l'un des deux : un autre invité apprend qu'un
// tour est en cours et pour qui, jamais ce qu'il contient.
async function lireTour(req, res, code) {
  const tour = analyser(await commandeKV(['GET', cleTour(code)]));
  if (!tour) return res.status(200).json({ tour: null });

  const config = analyser(await commandeKV(['HGET', cleSession(code), 'config']));
  const organisateur = !!config && req.body.jeton === config.jeton;
  const leSien = String(req.body.idJoueur || '') === tour.idJoueur;

  if (!organisateur && !leSien) {
    return res.status(200).json({
      tour: { idJoueur: tour.idJoueur, confieA: tour.confieA, rendu: !!tour.rendu }
    });
  }
  return res.status(200).json({ tour });
}

// Le joueur rend son tour : ce qu'il a compté, ce qu'il n'a pas compté.
// On écrit dans la même clé plutôt que dans une seconde : l'organisateur
// interroge déjà celle-là, et le tour est une seule chose.
async function rendreTour(req, res, code) {
  const tour = analyser(await commandeKV(['GET', cleTour(code)]));
  if (!tour) {
    return res.status(404).json({ error: "Ce tour n'est plus en cours." });
  }
  if (String(req.body.idJoueur || '') !== tour.idJoueur) {
    return res.status(403).json({ error: "Ce tour n'est pas le tien." });
  }

  const liste = valeur => Array.isArray(valeur) ? valeur.map(m => String(m)) : [];
  tour.rendu = {
    trouvees: liste(req.body.trouvees),
    manquees: liste(req.body.manquees),
    // Secondes restantes quand le paquet s'est vidé avant la fin du temps :
    // elles ouvriront la manche suivante. Seul ce téléphone les connaît, il
    // tenait le chrono.
    restant: Math.max(0, Math.floor(Number(req.body.restant) || 0)),
    renduA: Date.now()
  };
  await commandeKV(['SET', cleTour(code), JSON.stringify(tour), 'EX', DUREE_TOUR_S]);
  return res.status(200).json({ rendu: true });
}

// L'organisateur reprend la main : le tour confié n'a plus cours.
async function reprendreTour(req, res, code) {
  const config = analyser(await commandeKV(['HGET', cleSession(code), 'config']));
  if (!config) {
    return res.status(404).json({ error: 'Aucune partie ne porte ce code.' });
  }
  if (req.body.jeton !== config.jeton) {
    return res.status(403).json({ error: "Action réservée à l'organisateur." });
  }

  // Le tour est MARQUÉ repris, pas effacé. L'effacer couperait la seule voie par
  // laquelle les cartes déjà trouvées peuvent revenir : elles ne vivent que sur
  // le téléphone du joueur, et n'en partent qu'avec son comptage. Il lit cette
  // marque, s'arrête, et rend ce qu'il avait — l'organisateur le récupère.
  //
  // `oublier` efface pour de bon : l'organisateur s'en sert quand il a fini
  // d'attendre, pour que le téléphone du joueur ne reste pas sur un tour mort.
  const tour = analyser(await commandeKV(['GET', cleTour(code)]));
  if (!tour || req.body.oublier === true) {
    await commandeKV(['DEL', cleTour(code)]);
    return res.status(200).json({ repris: true, rendu: tour?.rendu || null });
  }

  tour.repris = Date.now();
  await commandeKV(['SET', cleTour(code), JSON.stringify(tour), 'EX', DUREE_TOUR_S]);
  return res.status(200).json({ repris: true, rendu: tour.rendu || null });
}

// ===== Point d'entrée =====

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!KV_URL || !KV_TOKEN) {
    return res.status(503).json({
      error: "La saisie à plusieurs téléphones n'est pas disponible. Passez par « on se passe le téléphone »."
    });
  }

  const corps = req.body || {};
  const action = corps.action;

  try {
    if (action === 'creer') return await creer(req, res);

    const code = String(corps.code || '').toUpperCase().trim();
    if (code.length !== LONGUEUR_CODE) {
      return res.status(400).json({ error: 'Code de partie invalide.' });
    }

    // Le suivi se traite avant de charger la session : c'est exactement ce qui
    // le rend peu coûteux quand dix invités interrogent en boucle.
    if (action === 'suivre') return await suivre(req, res, code);
    if (action === 'publier') return await publier(req, res, code);

    // Le tour confié se traite ici aussi : il vit dans sa propre clé, et le
    // joueur qui le tient l'interroge sans avoir à charger toute la session.
    if (action === 'confierTour') return await confierTour(req, res, code);
    if (action === 'lireTour') return await lireTour(req, res, code);
    if (action === 'rendreTour') return await rendreTour(req, res, code);
    if (action === 'reprendreTour') return await reprendreTour(req, res, code);

    const session = await lireSession(code);
    if (!session) {
      return res.status(404).json({ error: 'Aucune partie ne porte ce code. Vérifie-le, ou demande-le à l\'organisateur.' });
    }

    // Une session fermée reste lisible un moment : mieux vaut expliquer que
    // la partie a démarré plutôt que de renvoyer « code inconnu ».
    const modifie = ['rejoindre', 'deposer'].includes(action);
    if (modifie && session.config.ouverte === false) {
      return res.status(409).json({ error: 'La partie a déjà démarré sans toi.' });
    }

    switch (action) {
      case 'etat':      return etat(req, res, session);
      case 'rejoindre': return await rejoindre(req, res, session, code);
      case 'deposer':   return await deposer(req, res, session, code);
      case 'retirer':   return await retirer(req, res, session, code);
      case 'fermer':    return await fermer(req, res, session, code);
      case 'relancer':  return await relancer(req, res, session, code);
      default:          return res.status(400).json({ error: 'Action inconnue.' });
    }
  } catch (err) {
    console.error('Session — erreur de stockage :', err.message);
    return res.status(503).json({
      error: "Le service est momentanément indisponible. Réessaie, ou passez par « on se passe le téléphone »."
    });
  }
}
