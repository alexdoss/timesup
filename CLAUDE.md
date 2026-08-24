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
api/generate.js Serverless Vercel → Groq (modèle réglable par `GROQ_MODELE`), génère des cartes
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

Wizard à nombre d'étapes variable : `updateWizardLabels()` construit la liste des écrans
réellement traversés et les numérote. Un écran = une décision.

```
type de partie → thèmes | session de cartes → comment on joue
                                                    ├─ avec les prénoms → les joueurs (saisie
                                                    │    manuelle) ou inscription par QR
                                                    └─ juste deux équipes
                                              → les équipes → manches → déroulement
```

- **« Comment on joue »** (`screen-jeu-mode`) porte le choix nominatif / simple, seul sur son
  écran : choisir vaut avancer, comme pour le type de partie.
- **« Les équipes »** (`screen-repartition`) porte les noms d'équipes **dans les deux modes**, et
  la répartition des joueurs quand il y a des prénoms. C'est le seul point de passage avant les
  manches. Il n'y a plus de réglage « Attribution des équipes » : cet écran *est* l'attribution.
- **« Les joueurs »** (`screen-players`) ne sert plus qu'à la saisie manuelle des prénoms.

- 2 équipes, 5 manches possibles (`ROUNDS` dans `game.js`) : les 3 premières sont obligatoires (description, un mot, mime), pose figée et pantin sont optionnelles.
- Mode **nominatif** (joueurs nommés, rotation, stats individuelles, min. 4 joueurs) ou **simple** (équipes seules).
- Mode **cartes perso**, deux façons de saisir (choix sur l'écran du type de partie, `[data-saisie]`) :
  - **partagée** — l'organisateur ouvre une session, les invités scannent un QR et saisissent chacun sur son téléphone. En mode nominatif, l'étape « joueurs » disparaît : les prénoms arrivent avec les scans, et un écran de répartition des équipes prend le relais. Exige du réseau.
  - **séquentielle** — on se passe le téléphone, input en `type="password"` + liste masquée (`••••`). Fonctionne hors ligne, et sert de repli quand la session partagée échoue.
- Mode **thèmes prédéfinis**, deux façons d'ouvrir une session — jamais les deux :
  - **nominatif** → **inscription par QR** (`ouvrirInscription()`, `inscription: true` côté
    serveur) à la place de la saisie des prénoms : chacun scanne et se nomme. La session reste
    ouverte le temps des inscriptions, ne réclame aucune carte, et `fermer` la clôt sur les seuls
    prénoms. L'invité inscrit se voit demander s'il veut **suivre** ou **ranger son téléphone**.
    Repli manuel si le réseau manque (`basculerEnSaisieManuelle()`, drapeau `inscriptionRefusee`).
  - **simple** → au clic sur « C'est parti », l'app propose de partager un code de suivi
    (`proposerLeSuivi()`). Accepter ouvre une session **« suivi seul »** (`ouvrirSuiviSeul()`,
    `suiviSeul: true`) : elle naît close, et l'invité entre **directement en spectateur**
    (`entrerEnSpectateur()`), sans prénom donc sans identité.
  - La proposition de partage n'apparaît que si aucune session n'existe déjà : après une
    inscription, le code a déjà été donné.
- « **Rejouer** » sur une partie à thèmes ramène au choix du paquet (`rejeuThemes`), pas directement
  au jeu : mêmes équipes, mêmes manches, thèmes rechoisis — les précédents restent cochés. L'écran
  perd son numéro d'étape et sa flèche de retour, et « Suivant » devient « C'est parti ».
  Y arriver publie l'étape `configuration`, qui remet les spectateurs sur l'écran d'attente.
- Le nombre de cartes par joueur vient du réglage « Cartes saisies par joueur » de l'étape *Déroulement* (`game.numCards`, minimum 3, défaut 5) — il n'existe qu'à cet endroit.
- Le même `masterDeck` est rebattu à chaque manche (`startNewRound`), le score est cumulatif.
- Trois échelles de score coexistent : la **manche** (`getRoundScores`), la **partie** (`team.score`)
  et la **soirée** (`getSessionScores`, cumul des parties enchaînées par « Rejouer »). L'écran de
  lancement de tour affiche manche + partie, la fin de manche et la fin de partie détaillent chaque
  manche jouée (`recordRound` / `getRoundHistory`), et la fin de partie ajoute le détail par joueur
  et par manche (`getPlayerBreakdown`, replié dans un tiroir). Ce tiroir garde toujours la même
  forme, mais change d'échelle : dès la **deuxième** partie ses colonnes portent le cumul de la
  série au lieu du score de la seule partie (`seriePerRound` / `serieTotal`, alimentés par
  `sessionPlayerStats` que `replayGame()` remplit avant que `resetGame()` n'efface `playerStats`).
  Le résumé du tiroir et l'infobulle de la colonne « Tot. » disent laquelle des deux est affichée.

## Conventions

- **Tout le texte visible est en français** (y compris les emojis dans les libellés de boutons).
- Les couleurs viennent des tokens CSS de `:root` (`--primary`, `--success`, alias `--brand`/`--good`). `applyTeamAccent()` écrit `--accent` à chaque tour pour teinter l'écran aux couleurs de l'équipe active.
- Les thèmes officiels s'ajoutent en créant `themes/xxx.json` **et** en l'ajoutant à `THEME_FILES` (`js/themes.js`) **et** à `ASSETS` (`sw.js`).

## Pièges connus

- **Bumper `CACHE_NAME` dans `sw.js`** (`rush-vNN`) à chaque modification d'un asset listé, sinon les utilisateurs installés gardent l'ancienne version : le fetch est cache-first sans revalidation.
- Les couleurs d'équipe sont codées en dur dans `game.js` (`#d6336c`, `#33c26a`, héritées du proto `rush-app.html`) et **ne correspondent pas** aux tokens `--brand`/`--good` du CSS actuel. Toute retouche de palette doit traiter les deux endroits.
- `api/generate.js` a besoin de `GROQ_API_KEY` (variable d'environnement Vercel). En local sans cette variable, la génération IA renvoie 500 — le reste de l'app fonctionne.
- **Groq déprécie ses modèles régulièrement** (llama-3.3-70b l'a été en août 2026). Le modèle se règle par `GROQ_MODELE` depuis Vercel, sans redéployer ; défaut `openai/gpt-oss-120b`. Les modèles de raisonnement consomment leur budget de jetons à réfléchir : `corpsGroq()` leur impose `reasoning_effort: 'low'` et un budget large, et n'envoie ce paramètre qu'aux modèles qui l'acceptent. La consigne de langue est **explicite** dans le prompt — sans elle, le modèle répondait parfois en anglais. Elle n'est pas codée en dur : `js/library.js` envoie `langue` d'après l'attribut `lang` du document, donc les cartes suivront une future traduction de l'app. La consigne libre du joueur est placée en dernier et annoncée prioritaire : c'est ce qui lui permet de demander une autre langue.
- `api/generate.js` et `api/session.js` ont besoin de `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash, via le Marketplace Vercel). Sans elles : le plafond IA est simplement inactif, mais la **saisie partagée renvoie 503** et l'app bascule sur la saisie séquentielle.
- Ces deux fonctions **dupliquent volontairement** leur dialogue avec le stockage plutôt que de partager un module : chacune doit rester chargeable isolément, ce dont dépendent les scénarios 12 et 18 (le fichier est chargé en Blob avec un `fetch` simulé — un import relatif s'y résoudrait mal).
- L'adresse montrée aux invités sous le QR code est `/rejoindre`, **sans extension** : c'est celle qu'ils recopient à la main. Vercel ne la sert que grâce à la règle `rewrites` de `vercel.json` ; `scripts/serve.ps1` fait la même correspondance en local. Sans l'une des deux, l'adresse affichée renvoie 404 — un défaut invisible en développement. `vercel.json` n'accepte aucune propriété inconnue (pas de clé `comment`), sous peine d'échec du déploiement.
- Les fichiers `.mjs` ne sont pas typés par tous les serveurs, et un navigateur **refuse un module au mauvais type MIME** : les bibliothèques vendues sont rangées en `.js`.
- Plusieurs tuiles partagent la classe `.mode-tile` (type de partie et mode de saisie). Les gestionnaires ciblent `[data-source]` et `[data-saisie]`, jamais la classe — sinon un clic sur l'un efface l'autre.
- Le HTML appelle `showScreen()`, `confirmQuit()`, `handleBackFromPlayers()` et `handleBackFromRounds()` via `onclick` : ces quatre fonctions doivent rester exposées sur `window` depuis `app.js`.
- Les flèches de retour sont écrites en dur dans `index.html`. Après tout déplacement d'écran dans le wizard, **les revérifier une par une** : elles pointent volontiers vers un écran qui n'est plus le précédent, ce qui ne casse rien de visible et passe donc inaperçu. Celles qui dépendent du parcours passent par une fonction (`handleBackFrom…`).
- Servir en HTTP (les modules ES et les `fetch` de thèmes échouent en `file://`) : `pwsh -File scripts/serve.ps1`, qui imite aussi `/api/session` en mémoire — la saisie partagée est donc jouable en local. Pour essayer à deux, ouvrir `/rejoindre.html` dans une fenêtre de navigation privée (stockage séparé).

## Fichiers hors app

`rush-app.html`, `proto-sprint2.html` et `proto-scores.html` sont des prototypes autonomes
(design de référence), pas du code servi.
`Rush.docx`, `theme people.txt` et le PNG à la racine sont des sources de contenu / specs, pas des assets de l'app.
