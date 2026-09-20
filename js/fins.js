// ===== LES NEUF FINS =====
// Trois écarts × trois points de vue. Le tableau vit ici plutôt que dans les
// deux pages qui l'affichent : une phrase retouchée doit l'être une seule fois,
// et l'organisateur et les invités ne doivent jamais raconter deux fins
// différentes de la même partie.
//
// Arrêté dans design-system/recompenses.html, où les règles sont expliquées.
// Les deux qui gouvernent ce fichier :
//
// — L'ÉCRAN DE LA TABLE NE PREND JAMAIS PARTI. Il est posé au milieu et regardé
//   par tout le monde : il nomme le vainqueur, il ne s'adresse à personne. D'où
//   le 🏆 sur ses trois lignes, seule répétition tolérée du tableau.
// — UN EMOJI NE SERT QU'UNE FOIS ailleurs : c'est le seul signal qui distingue
//   les fins avant qu'on ait lu la phrase.
//
// Aucun emoji postérieur à 2016, faute de quoi les téléphones qui ne reçoivent
// plus de mises à jour affichent un carré vide. 🥲 (2020) est la seule
// dérogation, assumée : la larme n'a pas d'équivalent plus ancien.

// Les bornes, en points d'écart.
export const ECART_SERRE = 3;    // jusqu'ici : ça s'est joué à quelques cartes
export const ECART_NET = 15;     // au-delà : démonstration

const FINS = {
  // L'égalité parfaite n'a pas de gagnant : les deux téléphones lisent la même
  // chose, et la table ne départage personne.
  egalite: {
    table:   { emoji: '🤝', phrase: "Personne n'a rien lâché" },
    gagnant: { emoji: '🤝', phrase: 'Impossible de vous départager' },
    perdant: { emoji: '🤝', phrase: 'Impossible de vous départager' }
  },
  serre: {
    table:   { emoji: '🏆', phrase: "ça s'est joué à trois cartes" },
    gagnant: { emoji: '😅', phrase: 'de justesse' },
    perdant: { emoji: '🥲', phrase: 'Battus de peu. La revanche ?' }
  },
  net: {
    table:   { emoji: '🏆', phrase: 'Une nette victoire !' },
    gagnant: { emoji: '🎉', phrase: "Vous l'emportez !" },
    perdant: { emoji: '😤', phrase: 'Battus ! Demandez une revanche.' }
  },
  ecrasant: {
    table:   { emoji: '🏆', phrase: 'Démonstration' },
    gagnant: { emoji: '🔥', phrase: "personne n'a rien pu faire" },
    perdant: { emoji: '🙈', phrase: 'Il y a des soirs comme ça' }
  }
};

// Le niveau d'écart, à partir de la différence de points. On prend la valeur
// absolue : l'écart ne dit pas qui gagne, seulement de combien.
export function niveauDEcart(ecart) {
  const n = Math.abs(Number(ecart) || 0);
  if (n === 0) return 'egalite';
  if (n <= ECART_SERRE) return 'serre';
  if (n <= ECART_NET) return 'net';
  return 'ecrasant';
}

// `role` vaut 'table', 'gagnant' ou 'perdant'. Un invité dont on ignore
// l'équipe — mode simple, spectateur, prénom absent des deux équipes — retombe
// sur la version neutre de la table, sans que l'appelant ait à le prévoir.
export function finDePartie(ecart, role = 'table') {
  const niveau = FINS[niveauDEcart(ecart)];
  return niveau[role] || niveau.table;
}
