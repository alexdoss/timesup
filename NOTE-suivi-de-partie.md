# Note de cadrage — le suivi de partie sur le téléphone des invités

*11 août 2026. Écrite après l'épreuve technique (`proto-suivi-*.html`), qui a validé
le mécanisme. Ce document est un plan de travail, pas une spécification figée.*

## L'objectif

Aujourd'hui, Rush est une app pour une personne que sept autres regardent par-dessus
l'épaule. Les invités sortent leur téléphone pour saisir leurs cartes, puis le rangent.

On leur donne de quoi **suivre la partie** : à qui c'est le tour, le chrono, le score
de la manche et de la partie, les résultats de fin de manche et de fin de partie.

**Hors périmètre :** jouer depuis son téléphone (voir les cartes, appuyer sur
« trouvé »). C'est un chantier d'une autre nature, à décider séparément.

## Ce qui est déjà en place

- `api/session.js` : actions `publier` (organisateur) et `suivre` (invités), une clé
  Redis à part, **une seule commande et ~380 octets par lecture**.
- `scripts/serve.ps1` : les mêmes actions, imitées en mémoire.
- `tests/26-suivi-de-partie.html` : 25 vérifications qui verrouillent le contrat.

Il reste à brancher le jeu dessus.

## Ce que voit l'invité

La page `rejoindre.html` qu'il a déjà ouverte pour saisir ses cartes enchaîne
d'elle-même. Quatre états :

| État | Ce qui s'affiche |
|---|---|
| **Avant le départ** | « Tes cartes sont enregistrées — la partie va commencer » |
| **Pendant un tour** | manche, qui fait deviner, chrono, scores manche + partie |
| **Entre les tours** | l'équipe qui vient de jouer, les scores |
| **Fin de manche / partie** | le détail par manche, le vainqueur |

Trois signaux particuliers :

- **En pause** — le chrono se fige, un bandeau l'annonce.
- **Organisateur silencieux** — après 45 s sans nouvelle, « aucune nouvelle de
  l'organisateur ».
- **Hors ligne** — l'invité réessaie tout seul, sans rien casser.

**Aucun mot du paquet ne transite.** C'est une règle de conception : le contenu des
cartes rendrait le jeu injouable s'il s'affichait chez les joueurs.

## Ce que publie l'organisateur

Un résumé de moins de 4 Ko, à chaque événement :

- début de tour, fin de tour
- carte trouvée ou décomptée (correction de fin de tour comprise)
- mise en pause et reprise
- fin de manche, fin de partie
- **plus un battement toutes les 15 secondes**, même sans changement

Le battement republie le même état **sans changer de numéro de version** : l'invité
n'y voit aucun changement, mais l'horodatage du serveur rajeunit. C'est ce qui rend
une coupure détectable entre deux tours, là où rien ne bouge normalement.

## Les réglages retenus

| | Valeur | Pourquoi |
|---|---|---|
| Rythme de lecture | **5 s** | le délai vient du rythme, pas du réseau ; 2,5 s en moyenne |
| Battement | 15 s | |
| Seuil de silence | 45 s | trois battements manqués ; en dessous, risque de fausse alerte |
| Lecture en veille | suspendue | l'écran éteint n'interroge plus : batterie et facture |

Coût mesuré : ~5 000 commandes par partie de 9 invités et 45 minutes, soit une
centaine de parties par mois dans le forfait gratuit d'Upstash, avant l'économie
de la mise en veille.

## Les trois lots

### Lot 1 — l'app publie (invisible)

Nouveau module `js/suivi.js` : construit le résumé à partir de `game`, publie aux
bons moments, entretient le battement. Branché depuis `app.js`.

**Point de vigilance :** le compteur de version doit être **conservé avec l'état
sauvegardé**. S'il repart à zéro après un rechargement, l'invité voit la version
reculer et croit que rien n'a changé.

Livrable testable, sans effet visible : l'app publie, personne ne lit encore.

### Lot 2 — l'invité regarde

La vue de suivi dans `rejoindre.html` et `js/rejoindre.js` : lecture toutes les
5 secondes, chrono recalculé localement, mise en veille, reprise après coupure.

C'est le lot qui rend la fonction visible.

### Lot 3 — les finitions

Reprise d'une partie interrompue, mode sans les noms, arrivée d'un invité en cours
de partie, fin de partie et « rejouer ».

## Points ouverts

- **Les invités sans saisie partagée** n'ont pas de code de session, donc pas de
  suivi. Faut-il leur permettre de rejoindre en lecture seule ? Reporté.
- **« Rejouer avec les mêmes joueurs »** ouvre une nouvelle session, donc un nouveau
  code : les invités doivent rescanner. Acceptable pour une première version.
- **N'importe qui connaissant le code peut regarder.** Sans conséquence pour un jeu
  de soirée, mais c'est un choix, pas un oubli.

## Ce qui n'est pas nécessaire

Aucun service temps réel — ni Supabase, ni Ably, ni Pusher. L'épreuve a montré que
l'interrogation périodique suffit largement pour un score et un nom de joueur.

**Supabase reste à trancher sur les statistiques et les comptes**, pas sur le temps
réel. Si on l'adopte plus tard, seul le transport change : la forme publier/lire,
elle, ne bouge pas.
