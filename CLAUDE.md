# Rush — jeu de devinettes (repo `timesup`)

PWA mobile-first, **JavaScript vanilla, sans build ni dépendances**, en français.
Le repo s'appelle `timesup` mais le produit s'appelle **Rush** (titre, manifest, cache SW).
Déploiement Vercel : les fichiers statiques sont servis tels quels (`outputDirectory: "."`, pas de `buildCommand`), et `api/` fournit les fonctions serverless.

## Architecture

```
index.html      Toutes les vues, en <div class="screen"> masqués/affichés (SPA à écrans)
style.css       Design tokens (:root) + tous les styles
js/app.js       Point d'entrée : listeners, wizard de config, flow de partie, bibliothèque IA
js/game.js      Moteur pur : état `game`, deck, score, manches, règles de passe
js/ui.js        Rendu DOM uniquement (aucune logique de jeu)
js/themes.js    Chargement des thèmes officiels via fetch des JSON
js/library.js   Thèmes perso : localStorage (`timesup_custom_themes`) + appel /api/generate
api/generate.js Serverless Vercel → Groq (llama-3.3-70b-versatile), génère des cartes
themes/*.json   Thèmes officiels : { id, name, icon, words[] }
sw.js           Service worker, cache-first sur une liste d'assets figée
```

Règle de séparation à conserver : `game.js` ne touche jamais au DOM, `ui.js` ne contient aucune règle de jeu, `app.js` fait le lien.

Un module ajouté à `js/` doit être importé depuis `app.js` (ES modules natifs, `<script type="module">`) — il n'y a pas de bundler.

## Déroulé d'une partie

Wizard en 5 étapes (4 en mode cartes perso, les libellés sont recalculés par `updateWizardLabels()`) :
mode (thèmes prédéfinis / cartes perso) → thèmes → équipes & joueurs → manches → déroulement.

- 2 équipes, 5 manches possibles (`ROUNDS` dans `game.js`) : les 3 premières sont obligatoires (description, un mot, mime), pose figée et pantin sont optionnelles.
- Mode **nominatif** (joueurs nommés, rotation, stats individuelles, min. 4 joueurs) ou **simple** (équipes seules).
- Mode **cartes perso** : chaque joueur saisit ses cartes à tour de rôle, input en `type="password"` + liste masquée (`••••`) pour que personne ne lise par-dessus l'épaule.
- Le même `masterDeck` est rebattu à chaque manche (`startNewRound`), le score est cumulatif.

## Conventions

- **Tout le texte visible est en français** (y compris les emojis dans les libellés de boutons).
- Les couleurs viennent des tokens CSS de `:root` (`--primary`, `--success`, alias `--brand`/`--good`). `applyTeamAccent()` écrit `--accent` à chaque tour pour teinter l'écran aux couleurs de l'équipe active.
- Les thèmes officiels s'ajoutent en créant `themes/xxx.json` **et** en l'ajoutant à `THEME_FILES` (`js/themes.js`) **et** à `ASSETS` (`sw.js`).

## Pièges connus

- **Bumper `CACHE_NAME` dans `sw.js`** (`rush-vNN`) à chaque modification d'un asset listé, sinon les utilisateurs installés gardent l'ancienne version : le fetch est cache-first sans revalidation.
- Les couleurs d'équipe sont codées en dur dans `game.js` (`#d6336c`, `#33c26a`, héritées du proto `rush-app.html`) et **ne correspondent pas** aux tokens `--brand`/`--good` du CSS actuel. Toute retouche de palette doit traiter les deux endroits.
- `api/generate.js` a besoin de `GROQ_API_KEY` (variable d'environnement Vercel). En local sans cette variable, la génération IA renvoie 500 — le reste de l'app fonctionne.
- Le HTML appelle `showScreen()`, `confirmQuit()` et `handleBackFromPlayers()` via `onclick` : ces trois fonctions doivent rester exposées sur `window` depuis `app.js`.
- Servir en HTTP (les modules ES et les `fetch` de thèmes échouent en `file://`) : `npx serve .` ou `vercel dev` (nécessaire pour `/api`).

## Fichiers hors app

`rush-app.html` et `proto-sprint2.html` sont des prototypes autonomes (design de référence), pas du code servi.
`Rush.docx`, `theme people.txt` et le PNG à la racine sont des sources de contenu / specs, pas des assets de l'app.
