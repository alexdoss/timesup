# Rush — sujets en attente

*Ce qu'on a volontairement laissé de côté, et pourquoi. Tenu à jour au fil des
sessions. Rien ici n'est bloquant : ce sont des choix reportés, pas des oublis.*

## Idées à trancher

**Suivre une partie sans saisie partagée.** Les parties sur thèmes prédéfinis n'ont
pas de session, donc pas de code, donc pas de suivi. Il faudrait un bouton
« 👀 Suivi de partie » côté organisateur qui ouvre une session à la demande.
Maquetté dans `proto-ecrans-invite.html`, écrans ② et ③.

**Le téléphone qui change de mains, et le joueur qui arrive en cours de soirée.**
Deux exceptions écartées volontairement le 16 août 2026, le temps de traiter le cas
nominal. La première est couverte par « ce n'est pas moi » ; la seconde ne l'est
pas : la liste se referme sur les joueurs de la partie précédente, un nouveau venu
est refusé.

**Se retirer soi-même n'est pas authentifié.** Le bouton « je quitte la partie »
présente l'identifiant du joueur, que `etat` publie déjà à qui possède le code.
N'importe qui connaissant le code pourrait donc retirer n'importe qui. Assumé : le
modèle de confiance est le même pour rejoindre sous un faux nom ou saisir
n'importe quoi. À revoir si Rush sort du cercle des amis.

## Défauts connus, sans gravité

**Le libellé du rejeu.** En « rejouer avec les mêmes joueurs », la configuration est
déjà faite et la partie démarre aussitôt : les invités voient brièvement
« Configuration de la partie en cours », qui est alors faux. Noté en commentaire
dans `js/rejoindre.js`.

**L'organisateur absent n'est pas signalé aux invités.** La détection de silence
existe dans la page d'épreuve (`proto-suivi-invite.html`) mais pas dans la vraie
page invité : si l'organisateur abandonne, l'invité garde son dernier écran sans
être averti.

**L'ordre des joueurs dans la salle d'attente de l'organisateur** suit le stockage,
pas l'ordre d'arrivée ni l'alphabet — il peut donc changer d'un rafraîchissement à
l'autre. Corrigé côté invité, pas côté organisateur.

**`scripts/serve.ps1` plafonne à 30 joueurs en dur**, sans lire la constante de
`api/session.js`. Les deux sont d'accord aujourd'hui, rien ne le garantit demain.

**Les accents dans les prénoms.** « Inès » et « Ines » sont deux joueurs distincts
pour la détection de doublons.

**Les cartes en double entre joueurs** ne sont pas détectées : deux invités peuvent
saisir le même mot. Décision assumée.

## Ménage

**L'exception dans `.vercelignore`** publie encore `proto-suivi-organisateur.html`
et `proto-suivi-invite.html`, mis en ligne pour l'épreuve du mode lecture. À retirer
maintenant que la fonction est mûre — sauf si on veut pouvoir remesurer.

**Les clés de stockage `timesup_*`** portent le nom du dépôt, banni de tout ce que
voient les joueurs. Invisible pour eux, mais incohérent.

**`taillePaquet` et `cartesParJoueur`** sont le même réglage (`game.numCards`) selon
le mode de partie. Deux notions distinctes mériteraient deux champs.

## Chantiers non démarrés

**Plus de deux équipes.** Les couleurs sont codées en dur dans `game.js`, et
plusieurs écrans supposent exactement deux équipes.

**Comptes joueurs et statistiques durables.** Upstash est un stockage éphémère par
nature ; il faudrait une vraie base. Supabase est le candidat — à trancher sur ce
besoin, **pas** sur le temps réel, que l'épreuve du mode lecture a montré inutile.
Voir `NOTE-suivi-de-partie.md`.

**Design Sprint 2.** Quatre décisions ouvertes : barre de navigation basse, pastille
de catégorie, méthode d'intégration des icônes Lucide, retournement des cartes au
toucher ou automatique. Référence : `proto-sprint2.html`.

**Jouer depuis son téléphone.** Voir la note de cadrage du suivi de partie : c'est
un chantier d'une autre nature, qui ferait du réseau une dépendance du cœur du jeu.
