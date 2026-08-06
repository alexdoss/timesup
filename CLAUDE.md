# Rush — jeu de devinettes (repo `timesup`)

PWA mobile-first, **JavaScript vanilla, sans build**, en français.
Une seule dépendance, vendue avec le code et sans étape d'installation : `js/vendor/qrcode.js`
(kazuhikoarase/qrcode-generator, MIT, module ES déjà compilé). Toute autre bibliothèque
doit rester exclue, ou être ajoutée de la même façon : un fichier posé dans `js/vendor/`,
encapsulé derrière un module maison.
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
js/persistence.js  Sauvegarde/reprise de la partie en cours (`timesup_partie_en_cours`)
js/sound.js     Sons générés à la volée (Web Audio) + vibration, réglage du son seulement
js/session.js   Client de /api/session (saisie partagée) : code, jeton, suivi en direct
js/qr.js        Seul fichier qui connaît la bibliothèque QR ; rend un SVG
js/vendor/      Bibliothèques tierces vendues telles quelles (qrcode.js)
rejoindre.html  Page autonome des invités (ce qu'ouvre le QR) — ne charge pas le jeu
js/rejoindre.js Sa logique : code, prénom, cartes, reprise après coupure
api/generate.js Serverless Vercel → Groq (llama-3.3-70b-versatile), génère des cartes
api/session.js  Serverless Vercel → Upstash : sessions de saisie partagée
themes/*.json   Thèmes officiels : { id, name, icon, words[] }
sw.js           Service worker, cache-first sur une liste d'assets figée
scripts/        serve.ps1 (dev + imitation de /api/session), test.ps1,
                deploy.ps1 (publie puis vérifie la production ; `-VerifierSeulement` pour vérifier seul)
tests/          Scénarios pilotés dans Chrome sans fenêtre — `scripts/test.ps1`
```

Règle de séparation à conserver : `game.js` ne touche jamais au DOM, `ui.js` ne contient aucune règle de jeu, `app.js` fait le lien.

Un module ajouté à `js/` doit être importé depuis `app.js` (ES modules natifs, `<script type="module">`) — il n'y a pas de bundler.

## Déroulé d'une partie

Wizard en 5 étapes (4 en mode cartes perso, les libellés sont recalculés par `updateWizardLabels()`) :
mode (thèmes prédéfinis / cartes perso) → thèmes → équipes & joueurs → manches → déroulement.

- 2 équipes, 5 manches possibles (`ROUNDS` dans `game.js`) : les 3 premières sont obligatoires (description, un mot, mime), pose figée et pantin sont optionnelles.
- Mode **nominatif** (joueurs nommés, rotation, stats individuelles, min. 4 joueurs) ou **simple** (équipes seules).
- Mode **cartes perso**, deux façons de saisir (choix sur l'écran du type de partie, `[data-saisie]`) :
  - **partagée** — l'organisateur ouvre une session, les invités scannent un QR et saisissent chacun sur son téléphone. En mode nominatif, l'étape « joueurs » disparaît : les prénoms arrivent avec les scans, et un écran de répartition des équipes prend le relais. Exige du réseau.
  - **séquentielle** — on se passe le téléphone, input en `type="password"` + liste masquée (`••••`). Fonctionne hors ligne, et sert de repli quand la session partagée échoue.
- Le nombre de cartes par joueur vient du réglage « Cartes saisies par joueur » de l'étape *Déroulement* (`game.numCards`, minimum 3, défaut 5) — il n'existe qu'à cet endroit.
- Le même `masterDeck` est rebattu à chaque manche (`startNewRound`), le score est cumulatif.

## Conventions

- **Tout le texte visible est en français** (y compris les emojis dans les libellés de boutons).
- Les couleurs viennent des tokens CSS de `:root` (`--primary`, `--success`, alias `--brand`/`--good`). `applyTeamAccent()` écrit `--accent` à chaque tour pour teinter l'écran aux couleurs de l'équipe active.
- Les thèmes officiels s'ajoutent en créant `themes/xxx.json` **et** en l'ajoutant à `THEME_FILES` (`js/themes.js`) **et** à `ASSETS` (`sw.js`).

## Pièges connus

- **Bumper `CACHE_NAME` dans `sw.js`** (`rush-vNN`) à chaque modification d'un asset listé, sinon les utilisateurs installés gardent l'ancienne version : le fetch est cache-first sans revalidation.
- Les couleurs d'équipe sont codées en dur dans `game.js` (`#d6336c`, `#33c26a`, héritées du proto `rush-app.html`) et **ne correspondent pas** aux tokens `--brand`/`--good` du CSS actuel. Toute retouche de palette doit traiter les deux endroits.
- `api/generate.js` a besoin de `GROQ_API_KEY` (variable d'environnement Vercel). En local sans cette variable, la génération IA renvoie 500 — le reste de l'app fonctionne.
- `api/generate.js` et `api/session.js` ont besoin de `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash, via le Marketplace Vercel). Sans elles : le plafond IA est simplement inactif, mais la **saisie partagée renvoie 503** et l'app bascule sur la saisie séquentielle.
- Ces deux fonctions **dupliquent volontairement** leur dialogue avec le stockage plutôt que de partager un module : chacune doit rester chargeable isolément, ce dont dépendent les scénarios 12 et 18 (le fichier est chargé en Blob avec un `fetch` simulé — un import relatif s'y résoudrait mal).
- L'adresse montrée aux invités sous le QR code est `/rejoindre`, **sans extension** : c'est celle qu'ils recopient à la main. Vercel ne la sert que grâce à la règle `rewrites` de `vercel.json` ; `scripts/serve.ps1` fait la même correspondance en local. Sans l'une des deux, l'adresse affichée renvoie 404 — un défaut invisible en développement. `vercel.json` n'accepte aucune propriété inconnue (pas de clé `comment`), sous peine d'échec du déploiement.
- Les fichiers `.mjs` ne sont pas typés par tous les serveurs, et un navigateur **refuse un module au mauvais type MIME** : les bibliothèques vendues sont rangées en `.js`.
- Plusieurs tuiles partagent la classe `.mode-tile` (type de partie et mode de saisie). Les gestionnaires ciblent `[data-source]` et `[data-saisie]`, jamais la classe — sinon un clic sur l'un efface l'autre.
- Le HTML appelle `showScreen()`, `confirmQuit()`, `handleBackFromPlayers()` et `handleBackFromRounds()` via `onclick` : ces quatre fonctions doivent rester exposées sur `window` depuis `app.js`.
- Les flèches de retour sont écrites en dur dans `index.html`. Après tout déplacement d'écran dans le wizard, **les revérifier une par une** : elles pointent volontiers vers un écran qui n'est plus le précédent, ce qui ne casse rien de visible et passe donc inaperçu. Celles qui dépendent du parcours passent par une fonction (`handleBackFrom…`).
- Servir en HTTP (les modules ES et les `fetch` de thèmes échouent en `file://`) : `pwsh -File scripts/serve.ps1`, qui imite aussi `/api/session` en mémoire — la saisie partagée est donc jouable en local. Pour essayer à deux, ouvrir `/rejoindre.html` dans une fenêtre de navigation privée (stockage séparé).

## Fichiers hors app

`rush-app.html` et `proto-sprint2.html` sont des prototypes autonomes (design de référence), pas du code servi.
`Rush.docx`, `theme people.txt` et le PNG à la racine sont des sources de contenu / specs, pas des assets de l'app.
