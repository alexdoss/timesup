// ===== LE SABLIER D'UN TOUR EN COURS =====
// Le même bloc sur deux pages : celle des invités, et celle de l'organisateur
// quand un autre joue depuis son téléphone. Il n'a rien à demander au serveur
// pendant qu'il tourne.
//
// Le principe, qui est tout l'intérêt : une seule publication dit « il restait
// N secondes à cet instant », horodatée par le SERVEUR. Chacun s'y accroche et
// décompte chez lui. Aucune montre de téléphone n'intervient, et une lecture
// espacée — ou manquée — ne décale rien.
//
// Ce module ne connaît que des identifiants d'éléments, construits à partir
// d'un préfixe : les deux pages peuvent donc afficher leur propre exemplaire.

const SECONDES_URGENCE = 10;

// Repères de la verrerie, en unités du dessin : le bulbe du haut va de 12 au
// col (70), celui du bas du col à 128.
const SABLE_HAUT = 12, SABLE_COL = 70, SABLE_BAS = 128;
const SABLE_TAS = 42;   // hauteur du tas accumulé en bas quand tout est écoulé

// Le dessin, identique des deux côtés. Seuls les rectangles bougent : la
// verrerie et les découpes sont posées une fois pour toutes.
export function svgSablier(prefixe) {
  return `
    <svg class="sablier" viewBox="0 0 100 145" aria-hidden="true">
      <defs>
        <clipPath id="${prefixe}-clip-haut"><path d="M14,12 H86 L54,70 H46 Z"/></clipPath>
        <clipPath id="${prefixe}-clip-bas"><path d="M46,70 H54 L86,128 H14 Z"/></clipPath>
      </defs>
      <g clip-path="url(#${prefixe}-clip-haut)">
        <rect id="${prefixe}-sable-haut" class="sable" x="0" width="100" y="12" height="58"/>
      </g>
      <rect id="${prefixe}-sable-filet" class="sable" x="48.6" width="2.8" y="70" height="0"/>
      <g clip-path="url(#${prefixe}-clip-bas)">
        <rect id="${prefixe}-sable-bas" class="sable" x="0" width="100" y="128" height="0"/>
      </g>
      <path class="verre" d="M14,12 H86 L54,70 L86,128 H14 L46,70 Z"/>
      <rect class="socle" x="8" y="6" width="84" height="6" rx="3"/>
      <rect class="socle" x="8" y="128" width="84" height="6" rx="3"/>
    </svg>`;
}

// Crée un sablier attaché à un jeu d'éléments. `prefixe` sert aux rectangles du
// dessin, les autres identifiants sont donnés tels quels.
export function creerSablier({ prefixe, chrono, blocChrono, manche, qui, mention, restantes }) {
  let ancre = null;
  const T = (id, texte) => {
    const el = id && document.getElementById(id);
    if (el) el.textContent = texte;
  };

  function peindreVerre(part, coule) {
    const p = Math.min(1, Math.max(0, part));
    // Surface du sable restant, en haut : elle descend vers le col
    const surface = SABLE_HAUT + (1 - p) * (SABLE_COL - SABLE_HAUT);
    // Niveau du tas, en bas : il monte depuis le fond
    const niveau = SABLE_BAS - (1 - p) * SABLE_TAS;

    const poser = (suffixe, y, hauteur) => {
      const el = document.getElementById(`${prefixe}-${suffixe}`);
      if (!el) return;
      el.setAttribute('y', y.toFixed(2));
      el.setAttribute('height', Math.max(0, hauteur).toFixed(2));
    };

    poser('sable-haut', surface, SABLE_COL - surface);
    poser('sable-bas', niveau, SABLE_BAS - niveau);
    // Le filet ne coule que tant que le temps s'écoule vraiment
    poser('sable-filet', SABLE_COL, coule ? niveau - SABLE_COL : 0);
  }

  function peindre() {
    if (!ancre) return;
    const restant = ancre.gele
      ? ancre.restant
      : Math.max(0, ancre.restant - (performance.now() - ancre.recuA) / 1000);

    const urgent = restant > 0 && restant <= SECONDES_URGENCE;
    T(chrono, Math.ceil(restant));
    const bloc = blocChrono && document.getElementById(blocChrono);
    if (bloc) bloc.classList.toggle('urgent', urgent && !ancre.gele);
    peindreVerre(restant / ancre.duree, !ancre.gele && restant > 0);

    T(manche, ancre.manche ? `Manche ${ancre.manche.numero}/${ancre.manche.sur} · ${ancre.manche.nom}` : '');
    T(qui, ancre.joueur
      ? `${ancre.equipe?.nom} · ${ancre.joueur} fait deviner`
      : `Au tour de ${ancre.equipe?.nom}`);
    const elQui = qui && document.getElementById(qui);
    if (elQui && ancre.equipe?.couleur) elQui.style.color = ancre.equipe.couleur;
    T(restantes, ancre.restantes);

    // Entre la fin du temps et le moment où l'organisateur passe à la suite,
    // il s'écoule quelques secondes : mieux vaut le dire qu'afficher un zéro nu.
    T(mention, ancre.gele ? '⏸ Partie en pause' : (restant <= 0 ? '⏰ Temps écoulé !' : ''));
  }

  // Le décompte tourne en local, sans rien demander au serveur
  setInterval(() => { if (ancre && !ancre.gele) peindre(); }, 200);

  return {
    // etat : l'état publié · publieA et heureServeur : les deux horodatages du serveur
    ancrer(etat, publieA, heureServeur, libelleRestantes) {
      const tour = etat.tour;
      const gele = etat.etape === 'pause';

      // Ne réancrer que sur une publication nouvelle. Sans cette garde, les
      // lectures intermédiaires relisaient le même « il reste 40 s » et
      // remettaient le décompte à son point de départ toutes les deux secondes.
      if (ancre && ancre.publieA === publieA) {
        ancre.gele = gele;
        return;
      }
      // L'écart entre publication et réponse, mesuré par le serveur seul.
      const enRoute = (heureServeur - publieA) / 1000;

      ancre = {
        restant: gele ? tour.restant : Math.max(0, tour.restant - enRoute),
        gele,
        publieA,
        recuA: performance.now(),
        duree: tour.duree || 40,
        manche: etat.manche,
        equipe: etat.equipes[tour.equipe],
        joueur: tour.joueur,
        restantes: libelleRestantes ? libelleRestantes(etat.restantes) : ''
      };
      peindre();
    },
    oublier() { ancre = null; },
    actif() { return !!ancre; },
    // Les secondes qu'il reste vraiment au tour en cours, calculées comme le
    // dessin l'affiche. Sert à l'organisateur qui reprend un tour lancé
    // ailleurs : il doit repartir du temps du joueur, pas d'un tour neuf.
    restant() {
      if (!ancre) return 0;
      const s = ancre.gele
        ? ancre.restant
        : ancre.restant - (performance.now() - ancre.recuA) / 1000;
      return Math.max(0, Math.round(s));
    }
  };
}
