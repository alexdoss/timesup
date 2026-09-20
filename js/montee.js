// ===== LES CHIFFRES QUI MONTENT =====
// Un score qui grimpe jusqu'à sa valeur au lieu de s'afficher d'un coup. Le
// moment où l'on découvre ce qu'on a marqué est le seul de la partie qui ne
// demande aucune action : autant qu'il dure une seconde.
//
// Trois règles, arrêtées dans design-system/recompenses.html :
//
// — UNE MONTÉE DURE TOUJOURS À PEU PRÈS LE MÊME TEMPS, qu'on gagne 6 points ou
//   96. C'est le NOMBRE DE PAS qui est borné, pas l'incrément. Sans cette
//   règle, le cumul d'une soirée défilerait pendant seize secondes.
// — DEUX COMPTEURS LANCÉS ENSEMBLE PARTENT ET ARRIVENT ENSEMBLE, quelle que
//   soit leur amplitude. Sinon l'un finit en attendant l'autre, et l'écran
//   donne l'impression d'un bug.
// — ON N'ANIME JAMAIS UN CHIFFRE QUI N'A PAS CHANGÉ : le mouvement doit
//   signifier quelque chose. Une équipe qui n'a pas marqué s'affiche, immobile.
//
// Ce module ne connaît ni le jeu ni le son : on lui passe des éléments, des
// nombres, et de quoi ponctuer chaque pas s'il y a lieu.

export const DUREE_MONTEE_MS = 1100;
const PAS_MAX = 12;

// Certains ne veulent pas de mouvement, et le système le dit à l'avance. On
// pose alors le chiffre final : l'information arrive, la mise en scène non.
function mouvementRefuse() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Monte plusieurs compteurs d'un seul élan. Chaque entrée : { element, de,
// vers }. Ceux qui ne bougent pas sont posés tels quels, sans animation et
// sans son — c'est la troisième règle.
//
// `surPas` est appelé à chaque pas commun, avec (numéro, total) : c'est par là
// qu'on accroche une note ou une vibration, sans que ce module les connaisse.
// `fini` est appelé une fois, quand tout est arrivé.
export function monterEnsemble(compteurs, { duree = DUREE_MONTEE_MS, surPas, fini } = {}) {
  const vivants = compteurs.filter(c => c.element && c.de !== c.vers);
  // Les immobiles sont posés d'emblée : ils font partie du tableau, ils n'ont
  // simplement rien à raconter.
  compteurs.forEach(c => {
    if (c.element && !vivants.includes(c)) c.element.textContent = c.vers;
  });
  if (!vivants.length) { if (fini) fini(); return; }

  if (mouvementRefuse()) {
    vivants.forEach(c => { c.element.textContent = c.vers; });
    if (fini) fini();
    return;
  }

  // Le plus grand écart décide du nombre de pas, et tous les compteurs le
  // partagent : c'est ce qui les fait arriver ensemble.
  const plusGrandEcart = Math.max(...vivants.map(c => Math.abs(c.vers - c.de)));
  const pas = Math.max(1, Math.min(PAS_MAX, plusGrandEcart));
  const intervalle = duree / pas;

  vivants.forEach(c => { c.element.textContent = c.de; });

  let fait = 0;
  const horloge = setInterval(() => {
    fait++;
    const part = fait / pas;
    vivants.forEach(c => {
      c.element.textContent = Math.round(c.de + (c.vers - c.de) * part);
    });
    if (surPas) surPas(fait, pas);
    if (fait >= pas) {
      clearInterval(horloge);
      // Le dernier pas pose la valeur exacte : l'arrondi pourrait tomber à côté.
      vivants.forEach(c => {
        c.element.textContent = c.vers;
        c.element.classList.remove('monte');
        void c.element.offsetWidth;   // redémarre l'animation CSS
        c.element.classList.add('monte');
      });
      if (fini) fini();
    }
  }, intervalle);
}

// Un seul compteur : le cas courant, écrit par-dessus le précédent.
export function monter(element, de, vers, options) {
  monterEnsemble([{ element, de, vers }], options);
}
