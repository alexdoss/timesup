// ===== QR CODE =====
// Seul fichier de l'app qui connaît la bibliothèque tierce (js/vendor/qrcode.js).
// Tout le reste passe par creerQrSvg() : changer de bibliothèque un jour ne
// toucherait que ce fichier.
//
// La bibliothèque est distribuée en .mjs ; on la range en .js car c'est la seule
// extension que tous les serveurs typent correctement, et un module reste un
// module quelle que soit son extension.
//
// On dessine nous-mêmes le SVG plutôt que d'utiliser le rendu fourni : le code
// doit rester lisible par un lecteur de QR, donc sombre sur fond blanc, alors
// que Rush est en thème sombre. Et un SVG reste net à toutes les tailles.

import qrcode from './vendor/qrcode.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// La norme impose une zone blanche d'au moins 4 modules autour du code,
// sans laquelle beaucoup de lecteurs échouent.
const MARGE_MODULES = 4;

/**
 * @param {string} texte   ce que le QR encode (une adresse web, ici)
 * @param {object} options taille en pixels, couleur des modules
 * @returns {SVGElement}   un SVG prêt à être inséré dans la page
 */
export function creerQrSvg(texte, { taille = 240, couleur = '#0F172A' } = {}) {
  // 0 : la bibliothèque choisit la plus petite taille qui contient le texte.
  // 'M' : correction d'erreur moyenne — le code reste lisible même un peu abîmé
  // ou partiellement masqué par un doigt.
  const qr = qrcode(0, 'M');
  qr.addData(texte);
  qr.make();

  const modules = qr.getModuleCount();
  const cote = modules + MARGE_MODULES * 2;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cote} ${cote}`);
  svg.setAttribute('width', taille);
  svg.setAttribute('height', taille);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Code QR à scanner pour rejoindre la partie');

  const fond = document.createElementNS(SVG_NS, 'rect');
  fond.setAttribute('width', cote);
  fond.setAttribute('height', cote);
  fond.setAttribute('fill', '#ffffff');
  svg.appendChild(fond);

  // Un seul tracé pour tous les modules sombres : bien plus léger que
  // plusieurs centaines de carrés séparés.
  let trace = '';
  for (let ligne = 0; ligne < modules; ligne++) {
    for (let colonne = 0; colonne < modules; colonne++) {
      if (qr.isDark(ligne, colonne)) {
        trace += `M${colonne + MARGE_MODULES} ${ligne + MARGE_MODULES}h1v1h-1z`;
      }
    }
  }

  const chemin = document.createElementNS(SVG_NS, 'path');
  chemin.setAttribute('d', trace);
  chemin.setAttribute('fill', couleur);
  svg.appendChild(chemin);

  return svg;
}
