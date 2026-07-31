---
description: Publie la version courante en production (bump du cache SW, commit, push, déploiement Vercel)
---

Publie l'état actuel du repo en production. Message de commit souhaité : $ARGUMENTS

Marche à suivre :

1. **Pré-vol** — lance :
   `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Check`

2. **Rends compte en français, en clair** : la branche, la liste des fichiers qui vont partir, si le cache du service worker sera bumpé et vers quelle version, les commits déjà en attente de push. L'utilisateur est PM : décris ce que le changement fait pour le joueur, pas seulement les noms de fichiers.

3. **Arrête-toi et demande confirmation** si le pré-vol montre quoi que ce soit d'inattendu :
   - un fichier qui pourrait contenir une clé ou un secret (`.env`, `*.key`, `*credentials*`)
   - un fichier temporaire (`~$*`) ou un binaire volumineux
   - plus de 20 fichiers modifiés
   - une branche autre que `master`
   - des modifications que la conversation en cours n'explique pas

4. **Publie** :
   `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Message "<message>"`
   Le message vient de $ARGUMENTS. S'il est vide, rédige-le toi-même à partir du diff : en français, à l'impératif, une ligne.

5. **Confirme** : rappelle le commit poussé, que Vercel déploie en ~1 min, et ce qu'il faut aller vérifier sur l'app en ligne.

Si `-Check` signale `RIEN A PUBLIER`, dis-le et n'exécute pas l'étape 4.
