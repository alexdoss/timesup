// ===== UI MODULE =====
// Gère l'affichage et les interactions DOM

export function applyTeamAccent(teamColor) {
  document.documentElement.style.setProperty('--accent', teamColor);
  const teamLabel = document.getElementById('game-team-label');
  if (teamLabel) {
    teamLabel.style.background = teamColor + '22';
  }
}

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

export function showResumeOption(detail) {
  const block = document.getElementById('resume-block');
  const line = document.getElementById('resume-detail');
  if (!block || !line) return;

  if (!detail) {
    block.style.display = 'none';
    line.textContent = '';
    return;
  }

  block.style.display = '';
  line.textContent = detail;
}

export function updateTimer(timeLeft) {
  const el = document.getElementById('timer');
  el.textContent = timeLeft;
  el.classList.remove('warning', 'danger');
  if (timeLeft <= 5) el.classList.add('danger');
  else if (timeLeft <= 10) el.classList.add('warning');
}

export function showCard(word, remaining) {
  document.getElementById('card-word').textContent = word;
  document.getElementById('cards-left').textContent = remaining;
}

// Le grand chiffre montre la manche en cours — celle qui se joue — et le total
// de la partie passe dans le rappel. Au premier tour d'une manche il affiche 0 : voulu.
export function updateRoundScreen(round, teams, roundLabel, roundScores = [0, 0]) {
  document.getElementById('round-title').textContent = roundLabel;
  const roundName = document.getElementById('round-name-label');
  if (roundName) roundName.textContent = `${round.icon} ${round.name}`;
  document.getElementById('round-icon').textContent = round.icon;
  document.getElementById('round-description').textContent = round.desc;
  document.getElementById('round-team1-name').textContent = teams[0].name;
  document.getElementById('round-team2-name').textContent = teams[1].name;
  document.getElementById('round-team1-score').textContent = roundScores[0];
  document.getElementById('round-team2-score').textContent = roundScores[1];
  document.getElementById('round-total').textContent =
    `Total de la partie : ${teams[0].score} – ${teams[1].score}`;
}

export function updateTurnInfo(teamName) {
  document.getElementById('current-team-turn').textContent =
    `🎯 C'est au tour de : ${teamName}`;
}

export function updateGameHeader(roundName, teamName) {
  document.getElementById('game-round-label').textContent = roundName;
  document.getElementById('game-team-label').textContent = teamName;
}

export function showPauseOverlay(title, info, teams) {
  document.getElementById('screen-game').classList.add('paused');
  document.getElementById('pause-overlay').style.display = '';
  document.getElementById('pause-panel').style.display = '';
  document.getElementById('pause-countdown').style.display = 'none';
  document.getElementById('pause-title').textContent = title;
  document.getElementById('pause-info').textContent = info;
  document.getElementById('pause-team1-name').textContent = teams[0].name;
  document.getElementById('pause-team2-name').textContent = teams[1].name;
  document.getElementById('pause-team1-score').textContent = teams[0].score;
  document.getElementById('pause-team2-score').textContent = teams[1].score;
}

export function showPauseCountdown(n) {
  document.getElementById('screen-game').classList.add('paused');
  document.getElementById('pause-overlay').style.display = '';
  document.getElementById('pause-panel').style.display = 'none';
  const el = document.getElementById('pause-countdown');
  el.style.display = '';
  el.textContent = n;
}

export function hidePause() {
  document.getElementById('screen-game').classList.remove('paused');
  document.getElementById('pause-overlay').style.display = 'none';
}

// Une ligne de carte corrigeable : le mot, et le bouton qui le fait changer de tiroir.
function buildCardRow(word, bouton, onAction) {
  const item = document.createElement('li');

  const nom = document.createElement('span');
  nom.className = 'player-name';
  nom.textContent = word;

  const action = document.createElement('button');
  action.type = 'button';
  action.className = bouton.cssClass;
  action.textContent = bouton.icon;
  action.title = bouton.title;
  action.addEventListener('click', () => onAction(word));

  item.appendChild(nom);
  item.appendChild(action);
  return item;
}

// Remplit un tiroir et le masque s'il est vide : un tiroir vide n'apprend rien.
function fillDrawer(prefix, label, words, bouton, onAction) {
  const drawer = document.getElementById(`${prefix}-drawer`);
  const summary = document.getElementById(`${prefix}-summary`);
  const list = document.getElementById(`${prefix}-list`);
  if (!drawer || !summary || !list) return;

  list.innerHTML = '';
  words.forEach(word => list.appendChild(buildCardRow(word, bouton, onAction)));
  summary.textContent = `${label} (${words.length})`;
  drawer.style.display = words.length ? '' : 'none';
  if (!words.length) drawer.open = false;
}

// title    : « Temps écoulé » ou « plus de cartes »
// onRemove : la carte n'aurait pas dû être comptée — onAdd : elle aurait dû l'être
export function showTurnResult({ title, teamName, score, found, missed }, onRemove, onAdd) {
  document.getElementById('turn-end-title').textContent = title;
  document.getElementById('turn-result').textContent =
    `${teamName} a trouvé ${score} carte(s) !`;

  fillDrawer('turn-found', '✅ Cartes comptées', found,
    { icon: '✕', cssClass: 'btn-remove', title: 'Retirer cette carte du score' }, onRemove);
  fillDrawer('turn-missed', '↩️ Cartes non comptées', missed,
    { icon: '＋', cssClass: 'btn-remove btn-recount', title: 'Compter cette carte' }, onAdd);

  const hint = document.getElementById('turn-fix-hint');
  if (hint) hint.style.display = found.length || missed.length ? '' : 'none';
}

// Une ligne du tableau de scores. `ids` nomme les cellules dont les tests et
// le reste de l'app ont besoin ; les lignes de manches n'en ont pas.
function ligneScore(libelle, valeurs, classe = '', ids = []) {
  const tr = document.createElement('tr');
  if (classe) tr.className = classe;

  const th = document.createElement('th');
  th.scope = 'row';
  th.textContent = libelle;
  tr.appendChild(th);

  valeurs.forEach((valeur, index) => {
    const td = document.createElement('td');
    td.className = 'score';
    td.textContent = valeur;
    if (ids[index]) td.id = ids[index];
    tr.appendChild(td);
  });
  return tr;
}

// history : [{ round, scores }] pour chaque manche déjà jouée, la dernière
// étant celle qui vient de s'achever.
export function showRoundEnd(roundNum, teams, history) {
  document.getElementById('round-end-title').textContent = `Fin de la manche ${roundNum}`;
  document.getElementById('end-team1-name').textContent = teams[0].name;
  document.getElementById('end-team2-name').textContent = teams[1].name;

  const corps = document.getElementById('end-scores');
  corps.innerHTML = '';
  history.forEach((ligne, index) => {
    corps.appendChild(ligneScore(
      `${ligne.round.icon} ${ligne.round.name}`,
      ligne.scores,
      index === history.length - 1 ? 'manche-en-cours' : 'manche-passee'
    ));
  });
  corps.appendChild(ligneScore(
    'Total partie', teams.map(equipe => equipe.score),
    'score-total', ['end-team1-score', 'end-team2-score']
  ));
}

// session : { totals, parties } quand plusieurs parties s'enchaînent, sinon null
export function showFinalScreen(teams, session = null, history = []) {
  document.getElementById('final-team1-name').textContent = teams[0].name;
  document.getElementById('final-team2-name').textContent = teams[1].name;

  const corps = document.getElementById('final-scores');
  corps.innerHTML = '';
  history.forEach(ligne => corps.appendChild(
    ligneScore(`${ligne.round.icon} ${ligne.round.name}`, ligne.scores, 'manche-passee')
  ));
  corps.appendChild(ligneScore(
    'Cette partie', teams.map(equipe => equipe.score),
    'score-total', ['final-team1-score', 'final-team2-score']
  ));

  // La ligne de cumul n'a de sens qu'à partir de la deuxième partie : elle est
  // construite dans tous les cas, puis masquée, pour rester interrogeable.
  // « Soirée » supposait qu'on joue le soir : le libellé ne dit plus que le compte.
  const cumul = ligneScore(
    session ? `Cumul des ${session.parties} parties` : 'Cumul des parties',
    session ? session.totals : [0, 0],
    'score-cumul', ['session-team1-score', 'session-team2-score']
  );
  cumul.id = 'session-row';
  cumul.querySelector('th').id = 'session-label';
  if (!session) cumul.style.display = 'none';
  corps.appendChild(cumul);

  const diff = teams[0].score - teams[1].score;
  let winnerText;
  if (diff > 0) winnerText = `🎉 ${teams[0].name} gagne !`;
  else if (diff < 0) winnerText = `🎉 ${teams[1].name} gagne !`;
  else winnerText = "🤝 Égalité parfaite !";

  document.getElementById('winner').textContent = winnerText;
}

// onChange : appelé après chaque clic, pour les écrans dont un bouton dépend
// de la sélection (le rejeu, où « C'est parti » attend un thème).
export function renderThemeButtons(themes, selectedThemes, container, onChange = null) {
  container.innerHTML = '';
  Object.entries(themes).forEach(([key, theme]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.theme = key;

    // Un thème sans carte n'apporterait rien au paquet : on le montre, on l'empêche de partir
    if (theme.words.length === 0) {
      selectedThemes.delete(key);
      btn.className = 'btn-theme';
      btn.textContent = `${theme.icon} ${theme.name} (vide)`;
      btn.disabled = true;
      container.appendChild(btn);
      return;
    }

    btn.className = selectedThemes.has(key) ? 'btn-theme active' : 'btn-theme';
    btn.textContent = `${theme.icon} ${theme.name} (${theme.words.length})`;
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      if (selectedThemes.has(key)) {
        selectedThemes.delete(key);
      } else {
        selectedThemes.add(key);
      }
      if (onChange) onChange(selectedThemes);
    });
    container.appendChild(btn);
  });
}

// La liste des prénoms, sans équipe : c'est l'écran suivant qui les répartit.
// Annoncer une équipe ici la promettrait avant qu'elle ne soit décidée.
export function renderPlayerList(players, onRemove) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';

  players.forEach(name => {
    const li = document.createElement('li');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = 'var(--muted)';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name';
    nameSpan.textContent = name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => onRemove(name));

    li.append(swatch, nameSpan, removeBtn);
    list.appendChild(li);
  });
  document.getElementById('player-count').textContent = `${players.length} joueur(s)`;
}

// teamSizes : effectifs par équipe, ou null si l'app ne les connaît pas (mode simple).
// onToggle(index, actif) : prévient app.js qu'une manche optionnelle a changé d'état.
export function renderRoundsSelector(rounds, activeRounds = [0, 1, 2], teamSizes = null, onToggle = null) {
  const mandatory = document.getElementById('rounds-mandatory');
  const optional = document.getElementById('rounds-optional');
  if (!mandatory || !optional) return;

  mandatory.innerHTML = '';
  optional.innerHTML = '';
  const blocages = [];

  rounds.forEach((round, index) => {
    if (!round.optional) {
      const tag = document.createElement('span');
      tag.className = 'round-tag';
      tag.textContent = `${round.icon} ${round.name}`;
      mandatory.appendChild(tag);
      return;
    }

    // Effectif insuffisant et connu : la manche est verrouillée
    const plusPetiteEquipe = teamSizes ? Math.min(...teamSizes) : null;
    const verrouillee = round.minPerTeam && plusPetiteEquipe !== null && plusPetiteEquipe < round.minPerTeam;

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'round-pill' + (!verrouillee && activeRounds.includes(index) ? ' active' : '');
    pill.dataset.roundIndex = index;
    pill.textContent = `${round.icon} ${round.name}`;
    pill.disabled = !!verrouillee;

    if (verrouillee) {
      blocages.push(`« ${round.name} » demande au moins ${round.minPerTeam} joueurs par équipe. La plus petite en compte ${plusPetiteEquipe}.`);
    } else {
      pill.addEventListener('click', () => {
        pill.classList.toggle('active');
        if (onToggle) onToggle(index, pill.classList.contains('active'));
      });
    }

    optional.appendChild(pill);
  });

  const note = document.getElementById('rounds-note');
  if (note) {
    note.textContent = blocages.join(' ');
    note.style.display = blocages.length ? '' : 'none';
  }
}

// Question posée en mode simple, quand l'app ne peut pas vérifier les effectifs elle-même.
export function showPuppetConfirm(visible, answer) {
  const bloc = document.getElementById('puppet-confirm');
  if (!bloc) return;
  bloc.style.display = visible ? '' : 'none';
  document.querySelectorAll('[data-puppet]').forEach(pill => {
    const value = pill.dataset.puppet === 'oui';
    pill.classList.toggle('active', answer !== null && value === answer);
  });
}

export function setRoundsNextEnabled(enabled) {
  const btn = document.getElementById('btn-next-rounds');
  if (btn) btn.disabled = !enabled;
}

// La liste des manches est construite depuis le moteur : la page de règles
// ne peut pas se désynchroniser si une manche est ajoutée ou renommée.
export function renderRules(rounds) {
  const liste = document.getElementById('rules-rounds');
  if (!liste) return;

  liste.innerHTML = '';
  rounds.forEach(round => {
    const item = document.createElement('li');
    const nom = document.createElement('strong');
    nom.textContent = `${round.icon} ${round.name}`;
    const desc = document.createElement('span');
    desc.textContent = ` — ${round.desc}`;
    item.append(nom, desc);
    liste.appendChild(item);
  });
}

// ===== SESSION DE SAISIE PARTAGÉE =====

// Le QR est dessiné une seule fois, à l'ouverture de la session.
export function afficherInvitation(svgQr, code, adresse, rappel) {
  const bloc = document.getElementById('session-qr');
  bloc.innerHTML = '';
  bloc.appendChild(svgQr);
  document.getElementById('session-code').textContent = code;
  document.getElementById('session-rappel').textContent = rappel;

  // L'adresse sert deux usages : on la lit pour la recopier à la main, et on
  // la touche pour ouvrir le menu de partage du téléphone.
  document.getElementById('session-adresse').textContent = `📤 ${adresse}`;
}

// Inscription : le QR, puis la liste des prénoms qui arrivent. Pas de décompte
// de cartes — les invités ne saisissent rien, ils se nomment.
export function afficherInscription(svgQr, code, adresse) {
  const bloc = document.getElementById('inscription-qr');
  bloc.innerHTML = '';
  bloc.appendChild(svgQr);
  document.getElementById('inscription-code').textContent = code;
  document.getElementById('inscription-adresse').textContent = `📤 ${adresse}`;
}

// L'organisateur a sa propre ligne, en haut : son prénom est le seul qui ne
// peut pas arriver par un scan, et tant qu'il ne l'a pas donné c'est un champ
// de saisie qui occupe la place.
export function renderInscrits(joueurs, minimum, onRetirer, onRenommerMoi) {
  const moi = joueurs.find(j => j.role === 'organisateur') || null;
  const autres = joueurs.filter(j => j !== moi);

  document.getElementById('inscription-moi-champ').style.display = moi ? 'none' : '';
  const ligneMoi = document.getElementById('inscription-moi-ligne');
  ligneMoi.style.display = moi ? '' : 'none';
  ligneMoi.innerHTML = '';
  if (moi) {
    const ligne = document.createElement('div');
    ligne.className = 'connecte fini';
    const qui = document.createElement('span');
    qui.className = 'qui';
    qui.textContent = `● ${moi.prenom} `;
    const marque = document.createElement('span');
    marque.className = 'sans-tel';
    marque.textContent = '· toi';
    qui.appendChild(marque);
    ligne.appendChild(qui);

    const corriger = document.createElement('button');
    corriger.type = 'button';
    corriger.id = 'btn-inscription-moi-corriger';
    corriger.className = 'retirer-joueur';
    corriger.textContent = '✎';
    corriger.title = 'Corriger ton prénom';
    corriger.addEventListener('click', () => onRenommerMoi(moi));
    ligne.appendChild(corriger);
    ligneMoi.appendChild(ligne);
  }

  const liste = document.getElementById('inscription-joueurs');
  liste.innerHTML = '';

  if (autres.length === 0) {
    const vide = document.createElement('div');
    vide.className = 'connecte vide';
    vide.textContent = "Personne n'a encore rejoint";
    liste.appendChild(vide);
  }

  autres.forEach(joueur => {
    const ligne = document.createElement('div');
    ligne.className = 'connecte fini';

    const qui = document.createElement('span');
    qui.className = 'qui';
    // textContent : le prénom vient du téléphone d'un invité
    qui.textContent = `● ${joueur.prenom} `;
    if (joueur.role === 'sansTel') {
      const marque = document.createElement('span');
      marque.className = 'sans-tel';
      marque.textContent = '· sans téléphone';
      qui.appendChild(marque);
    }
    ligne.appendChild(qui);

    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'retirer-joueur';
    retirer.textContent = '✕';
    retirer.title = `Retirer ${joueur.prenom} de la partie`;
    retirer.addEventListener('click', () => onRetirer(joueur));
    ligne.appendChild(retirer);

    liste.appendChild(ligne);
  });

  // Le compte porte sur tout le monde, l'organisateur compris : il joue.
  const manque = minimum - joueurs.length;
  document.getElementById('inscription-compteur').textContent = manque > 0
    ? `${joueurs.length} inscrit(s) — il en faut au moins ${minimum}`
    : `${joueurs.length} joueurs inscrits`;
  document.getElementById('btn-inscription-suivant').disabled = manque > 0;
}

// Le même code, mais pour une partie à thèmes : les invités ne saisissent rien,
// ils viennent seulement regarder. L'écran n'a donc ni liste ni compteur.
export function afficherPartageSuivi(svgQr, code, adresse) {
  const bloc = document.getElementById('suivi-partage-qr');
  bloc.innerHTML = '';
  bloc.appendChild(svgQr);
  document.getElementById('suivi-partage-code').textContent = code;
  document.getElementById('suivi-partage-adresse').textContent = `📤 ${adresse}`;
}

// etat      : la réponse du serveur (qui a fini, jamais quoi)
// onRetirer : l'organisateur retire un joueur qui ne finit pas
// rejeu : la configuration est déjà faite, il ne reste qu'à relancer
export function renderSession(etat, onRetirer, rejeu = false) {
  const liste = document.getElementById('session-joueurs');
  liste.innerHTML = '';

  if (etat.joueurs.length === 0) {
    const vide = document.createElement('div');
    vide.className = 'connecte vide';
    vide.textContent = "Personne n'a encore rejoint";
    liste.appendChild(vide);
  }

  etat.joueurs.forEach(joueur => {
    const ligne = document.createElement('div');
    ligne.className = 'connecte' + (joueur.fini ? ' fini' : '');

    const qui = document.createElement('span');
    qui.className = 'qui';
    qui.textContent = `${joueur.fini ? '●' : '○'} ${joueur.prenom} `;
    if (joueur.role !== 'invite') {
      const marque = document.createElement('span');
      marque.className = 'sans-tel';
      marque.textContent = joueur.role === 'organisateur' ? '· toi' : '· sans téléphone';
      qui.appendChild(marque);
    }

    const compte = document.createElement('span');
    compte.className = 'etat';
    compte.textContent = joueur.fini
      ? `${joueur.nbCartes} cartes ✓`
      : `${joueur.nbCartes}/${etat.cartesParJoueur}…`;

    ligne.append(qui, compte);

    // Sortie de secours : un joueur qui ne finit pas bloquerait toute la soirée
    if (!joueur.fini && joueur.role !== 'organisateur') {
      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'retirer-joueur';
      retirer.textContent = '✕';
      retirer.title = `Retirer ${joueur.prenom} de la partie`;
      retirer.addEventListener('click', () => onRetirer(joueur));
      ligne.appendChild(retirer);
    }

    liste.appendChild(ligne);
  });

  const finis = etat.joueurs.filter(j => j.fini).length;
  document.getElementById('session-compteur').textContent =
    `${etat.joueurs.length} joueur(s) · ${finis} ont fini · ${etat.total} carte(s)`;

  // La configuration ne commence qu'une fois toutes les cartes saisies : le
  // paquet doit être figé avant qu'on se mette d'accord sur le reste.
  const enCours = etat.joueurs.filter(j => !j.fini);
  const bouton = document.getElementById('btn-session-lancer');
  bouton.disabled = etat.total === 0 || enCours.length > 0;

  // En rejeu, on peut aussi attendre ceux qui n'ont pas encore rejoint :
  // la liste des joueurs est connue d'avance.
  const attendus = etat.attendus || [];
  const manquants = attendus.filter(nom =>
    !etat.joueurs.some(j => j.prenom.toLocaleLowerCase() === nom.toLocaleLowerCase()));
  if (rejeu && manquants.length > 0) bouton.disabled = true;

  if (rejeu && manquants.length === 1) {
    bouton.textContent = `⏳ ${manquants[0]} n'a pas encore rejoint`;
  } else if (rejeu && manquants.length > 1) {
    bouton.textContent = `⏳ ${manquants.length} joueurs n'ont pas rejoint`;
  } else if (etat.joueurs.length === 0) {
    bouton.textContent = 'En attente des joueurs…';
  } else if (enCours.length === 1) {
    bouton.textContent = `⏳ ${enCours[0].prenom} saisit ses cartes…`;
  } else if (enCours.length > 1) {
    bouton.textContent = `⏳ ${enCours.length} joueurs saisissent encore…`;
  } else {
    bouton.textContent = rejeu ? `🔄 Rejouer (${etat.total} cartes)` : 'Suivant ▶️';
  }
}

// Rappelle à l'organisateur où il en est de ses propres cartes
export function renderBoutonMesCartes(cartes, cible, fini) {
  const bouton = document.getElementById('btn-mes-cartes');
  if (!bouton) return;
  bouton.textContent = fini
    ? `✍️ Mes cartes (${cartes}) ✓`
    : cartes > 0
      ? `✍️ Saisir mes cartes (${cartes}/${cible})`
      : '✍️ Saisir mes cartes';
}

// Écran de saisie utilisé par l'organisateur et par le joueur sans téléphone.
// masque : les cartes s'affichent en ••••, quand l'appareil n'appartient pas
// à celui qui tape.
export function renderSaisieLocale({ titre, note, cartes, cible, masque, demanderPrenom }, onRetirer) {
  document.getElementById('saisie-titre').textContent = titre;
  document.getElementById('saisie-note').textContent = note;
  document.getElementById('saisie-bloc-prenom').style.display = demanderPrenom ? '' : 'none';
  document.getElementById('btn-saisie-visibilite').style.display = masque ? '' : 'none';

  const liste = document.getElementById('saisie-liste');
  liste.innerHTML = '';
  cartes.forEach((mot, index) => {
    const ligne = document.createElement('li');
    const texte = document.createElement('span');
    texte.className = 'player-name';
    texte.textContent = masque ? '••••••••' : mot;

    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'btn-remove';
    retirer.textContent = '✕';
    retirer.title = 'Retirer cette carte';
    retirer.addEventListener('click', () => onRetirer(index));

    ligne.append(texte, retirer);
    liste.appendChild(ligne);
  });

  document.getElementById('saisie-compteur').textContent =
    cartes.length >= cible ? `${cartes.length} cartes — c'est bon !` : `${cartes.length} / ${cible} cartes`;
  document.getElementById('saisie-jauge').style.width =
    Math.min(100, (cartes.length / cible) * 100) + '%';
  document.getElementById('btn-saisie-fini').disabled = cartes.length < cible;

  // Le compte atteint, on ferme l'ajout plutôt que de refuser après coup : le
  // joueur voyait sinon un message d'erreur pour un geste que rien n'empêchait.
  // Retirer une carte reste possible, et rouvre l'ajout.
  const complet = cartes.length >= cible;
  document.getElementById('btn-saisie-ajouter').disabled = complet;
  document.getElementById('saisie-carte').disabled = complet;
}

export function showSaisieError(message) {
  const el = document.getElementById('saisie-erreur');
  if (el) el.textContent = message || '';
}

// Répartition des équipes, en mode nominatif : les prénoms viennent des scans.
export function renderRepartition(joueurs, teams, onBasculer) {
  const bloc = document.getElementById('repartition-liste');
  bloc.innerHTML = '';

  joueurs.forEach(joueur => {
    const ligne = document.createElement('div');
    ligne.className = 'equipier';

    const nom = document.createElement('span');
    nom.textContent = joueur.prenom;

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = teams[joueur.equipe].name;
    bouton.style.background = teams[joueur.equipe].color;
    bouton.addEventListener('click', () => onBasculer(joueur));

    ligne.append(nom, bouton);
    bloc.appendChild(ligne);
  });
}

// ===== COMPOSITION DES ÉQUIPES =====
// Consultable depuis le début de tour. En lecture seule : déplacer un joueur en
// cours de partie fausserait les points déjà marqués et la rotation.
export function afficherEquipes(teams) {
  const contenu = document.getElementById('equipes-contenu');
  contenu.innerHTML = '';

  teams.forEach(equipe => {
    const bloc = document.createElement('div');
    bloc.className = 'equipe-bloc';

    const titre = document.createElement('h4');
    titre.textContent = equipe.name;
    titre.style.color = equipe.color;
    bloc.appendChild(titre);

    const liste = document.createElement('ul');
    equipe.players.forEach(joueur => {
      const item = document.createElement('li');
      item.textContent = joueur;
      liste.appendChild(item);
    });
    bloc.appendChild(liste);

    contenu.appendChild(bloc);
  });

  document.getElementById('equipes-overlay').style.display = '';
}

export function masquerEquipes() {
  document.getElementById('equipes-overlay').style.display = 'none';
}

// Il n'y a rien à montrer sans les noms : l'app ne connaît que deux équipes
export function afficherBoutonEquipes(visible) {
  const bouton = document.getElementById('btn-voir-equipes');
  if (bouton) bouton.style.display = visible ? '' : 'none';
}

// ===== BOÎTE DE DIALOGUE =====
// Remplace alert() et confirm() : ceux du navigateur sortent du design, et sur
// iPhone ils affichent l'adresse du site en titre, ce qui inquiète les joueurs.
// Renvoie une promesse : true si l'action est confirmée, false sinon.
export function showDialog({ title, message, confirmLabel = 'OK', cancelLabel = null, danger = false }) {
  const overlay = document.getElementById('dialog-overlay');
  const btnOk = document.getElementById('dialog-confirm');
  const btnCancel = document.getElementById('dialog-cancel');
  if (!overlay || !btnOk || !btnCancel) return Promise.resolve(true);

  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-message').textContent = message || '';
  btnOk.textContent = confirmLabel;
  btnOk.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  btnCancel.textContent = cancelLabel || 'Annuler';
  btnCancel.style.display = cancelLabel ? '' : 'none';
  overlay.style.display = '';

  return new Promise(resolve => {
    function fermer(reponse) {
      overlay.style.display = 'none';
      btnOk.onclick = null;
      btnCancel.onclick = null;
      overlay.onclick = null;
      document.removeEventListener('keydown', surTouche);
      resolve(reponse);
    }
    function surTouche(event) {
      if (event.key === 'Escape') fermer(false);
      else if (event.key === 'Enter') fermer(true);
    }

    btnOk.onclick = () => fermer(true);
    btnCancel.onclick = () => fermer(false);
    // Toucher à côté annule — mais seulement quand annuler est une issue proposée
    overlay.onclick = event => {
      if (event.target === overlay && cancelLabel) fermer(false);
    };
    document.addEventListener('keydown', surTouche);
    btnOk.focus();
  });
}

export function renderSoundSetting(enabled) {
  document.querySelectorAll('[data-sound]').forEach(pill => {
    pill.classList.toggle('active', (pill.dataset.sound === 'on') === enabled);
  });
}

export function updateCurrentPlayer(playerName) {
  document.getElementById('current-player').textContent =
    playerName ? `🎤 ${playerName} fait deviner` : '';
}

// Fiche d'un thème maison : ses cartes en clair, avec suppression carte par carte.
// Construit en DOM plutôt qu'en HTML brut : un nom de carte ne peut pas casser l'affichage.
export function renderThemeEditor(theme, onRemove) {
  document.getElementById('theme-edit-title').textContent = `${theme.icon} ${theme.name}`;
  document.getElementById('theme-edit-count').textContent =
    theme.words.length === 0
      ? "Aucune carte pour l'instant"
      : `${theme.words.length} carte(s)`;

  const list = document.getElementById('theme-cards-list');
  list.innerHTML = '';

  theme.words.forEach((mot, index) => {
    const li = document.createElement('li');

    const nom = document.createElement('span');
    nom.className = 'player-name';
    nom.textContent = mot;

    const supprimer = document.createElement('button');
    supprimer.className = 'btn-remove';
    supprimer.textContent = '✕';
    supprimer.title = 'Supprimer cette carte';
    supprimer.addEventListener('click', () => onRemove(index));

    li.appendChild(nom);
    li.appendChild(supprimer);
    list.appendChild(li);
  });
}

export function showThemeEditError(message) {
  const el = document.getElementById('theme-edit-error');
  if (el) el.textContent = message || '';
}

export function renderCustomThemes(themes, onOpen, onDelete) {
  const container = document.getElementById('custom-themes-list');
  container.innerHTML = '';
  const keys = Object.keys(themes);

  if (keys.length === 0) {
    const vide = document.createElement('p');
    vide.className = 'wizard-hint';
    vide.textContent = "Aucun thème personnalisé pour l'instant.";
    container.appendChild(vide);
    return;
  }

  keys.forEach(key => {
    const theme = themes[key];
    const ligne = document.createElement('div');
    ligne.className = 'custom-theme-item';

    const ouvrir = document.createElement('button');
    ouvrir.className = 'custom-theme-open';
    ouvrir.type = 'button';
    ouvrir.textContent = `${theme.icon} ${theme.name} (${theme.words.length} cartes)`;
    ouvrir.addEventListener('click', () => onOpen(key));

    const supprimer = document.createElement('button');
    supprimer.className = 'btn-delete-theme';
    supprimer.type = 'button';
    supprimer.textContent = '🗑️';
    supprimer.title = 'Supprimer ce thème';
    supprimer.addEventListener('click', () => onDelete(key));

    ligne.appendChild(ouvrir);
    ligne.appendChild(supprimer);
    container.appendChild(ligne);
  });
}

function cellule(balise, texte, titre) {
  const el = document.createElement(balise);
  el.textContent = texte;
  if (titre) el.title = titre;
  return el;
}

// Le détail des joueurs, replié : l'écran de fin reste court même à 10 joueurs
// et 5 manches, et le résumé donne déjà le meilleur sans qu'on ouvre.
// joueurs : getPlayerBreakdown() — manches : getRoundHistory()
// parties : nombre de parties de la série, 0 s'il n'y en a qu'une
//
// Dès la deuxième partie, les mêmes colonnes portent le cumul de la série au
// lieu du score de la seule partie qui s'achève. Pas de colonne en plus : le
// tableau garde sa forme, seule l'échelle change — et le résumé l'annonce.
export function renderPlayerStats(joueurs, teams, manches, parties = 0) {
  const container = document.getElementById('player-stats');
  container.innerHTML = '';
  if (!joueurs.length) return;

  const serie = parties > 1;
  const manchesDe = j => (serie ? j.seriePerRound : j.perRound) || j.perRound;
  const totalDe = j => (serie ? j.serieTotal : j.total) ?? j.total;
  const meilleur = [...joueurs].sort((a, b) => totalDe(b) - totalDe(a))[0];

  const tiroir = document.createElement('details');
  tiroir.className = 'drawer';
  tiroir.id = 'stats-joueurs';

  const resume = document.createElement('summary');
  // En série, le nombre de parties prend la place du score : c'est lui qui dit
  // à quelle échelle lire le tableau, et le score se retrouve dedans.
  resume.textContent = serie
    ? `📊 Les joueurs — ${meilleur.name} en tête (${parties} parties)`
    : `📊 Les joueurs — ${meilleur.name} en tête avec ${meilleur.total}`;
  tiroir.appendChild(resume);

  const table = document.createElement('table');
  table.className = 'table-joueurs';

  const thead = document.createElement('thead');
  const enTete = document.createElement('tr');
  enTete.appendChild(cellule('th', 'Joueur'));
  // L'icône seule tient dans la colonne ; le nom complet reste en infobulle
  manches.forEach(m => enTete.appendChild(cellule('th', m.round.icon, m.round.name)));
  // Le libellé ne bouge pas, l'infobulle dit de quelle échelle il s'agit
  enTete.appendChild(cellule('th', 'Tot.',
    serie ? `Cumul des ${parties} parties` : 'Total de la partie'));
  thead.appendChild(enTete);
  table.appendChild(thead);

  const corps = document.createElement('tbody');
  joueurs.forEach((joueur, index) => {
    const tr = document.createElement('tr');
    // Un trait sépare les deux équipes : les joueurs sont groupés, pas classés
    if (index > 0 && joueurs[index - 1].team !== joueur.team) tr.className = 'change-equipe';

    const nom = document.createElement('th');
    const puce = document.createElement('span');
    puce.className = 'puce-equipe';
    // La couleur vient de l'équipe : la coder ici en ferait une troisième copie
    puce.style.background = teams[joueur.team]?.color || 'transparent';
    nom.appendChild(puce);
    // textContent, pas innerHTML : en saisie partagée les prénoms viennent
    // du téléphone des invités et ne doivent jamais être interprétés en HTML
    nom.appendChild(document.createTextNode(joueur.name));
    tr.appendChild(nom);

    manchesDe(joueur).forEach(v => tr.appendChild(cellule('td', String(v))));
    const total = cellule('td', String(totalDe(joueur)));
    total.className = 'total-joueur';
    tr.appendChild(total);
    corps.appendChild(tr);
  });
  table.appendChild(corps);
  const boite = document.createElement('div');
  boite.className = 'boite-joueurs';
  boite.appendChild(table);
  tiroir.appendChild(boite);
  container.appendChild(tiroir);
}
