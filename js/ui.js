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

export function updateRoundScreen(round, teams, roundLabel) {
  document.getElementById('round-title').textContent = roundLabel;
  const roundName = document.getElementById('round-name-label');
  if (roundName) roundName.textContent = `${round.icon} ${round.name}`;
  document.getElementById('round-icon').textContent = round.icon;
  document.getElementById('round-description').textContent = round.desc;
  document.getElementById('round-team1-name').textContent = teams[0].name;
  document.getElementById('round-team2-name').textContent = teams[1].name;
  document.getElementById('round-team1-score').textContent = teams[0].score;
  document.getElementById('round-team2-score').textContent = teams[1].score;
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

export function showTurnResult(teamName, score) {
  document.getElementById('turn-result').textContent =
    `${teamName} a trouvé ${score} carte(s) !`;
}

export function showRoundEnd(roundNum, teams) {
  document.getElementById('round-end-title').textContent = `Fin de la manche ${roundNum}`;
  document.getElementById('end-team1-name').textContent = teams[0].name;
  document.getElementById('end-team2-name').textContent = teams[1].name;
  document.getElementById('end-team1-score').textContent = teams[0].score;
  document.getElementById('end-team2-score').textContent = teams[1].score;
}

export function showFinalScreen(teams) {
  document.getElementById('final-team1-name').textContent = teams[0].name;
  document.getElementById('final-team2-name').textContent = teams[1].name;
  document.getElementById('final-team1-score').textContent = teams[0].score;
  document.getElementById('final-team2-score').textContent = teams[1].score;

  const diff = teams[0].score - teams[1].score;
  let winnerText;
  if (diff > 0) winnerText = `🎉 ${teams[0].name} gagne !`;
  else if (diff < 0) winnerText = `🎉 ${teams[1].name} gagne !`;
  else winnerText = "🤝 Égalité parfaite !";

  document.getElementById('winner').textContent = winnerText;
}

export function renderThemeButtons(themes, selectedThemes, container) {
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
    });
    container.appendChild(btn);
  });
}

export function renderPlayerList(players, assignMode, teams, playerAssignments, onRemove, onTeamChange) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  const teamColors = ['var(--brand)', 'var(--good)'];

  players.forEach((name, index) => {
    const li = document.createElement('li');
    const teamIndex = assignMode === 'chosen'
      ? (Number.isInteger(playerAssignments[name]) ? playerAssignments[name] : 0)
      : (index % teams.length);

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = teamColors[teamIndex] || 'var(--muted)';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name';
    nameSpan.textContent = name;

    if (assignMode === 'chosen') {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'team-chip team-' + teamIndex;
      chip.textContent = teams[teamIndex]?.name || `Équipe ${teamIndex + 1}`;
      chip.addEventListener('click', () => {
        const nextTeam = (teamIndex + 1) % teams.length;
        onTeamChange(name, nextTeam);
      });
      li.appendChild(swatch);
      li.appendChild(nameSpan);
      li.appendChild(chip);
    } else {
      const teamLabel = document.createElement('span');
      teamLabel.className = 'player-team-label';
      teamLabel.textContent = teams[teamIndex]?.name || `Équipe ${teamIndex + 1}`;
      li.appendChild(swatch);
      li.appendChild(nameSpan);
      li.appendChild(teamLabel);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => onRemove(name));
    li.appendChild(removeBtn);

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

export function renderAssignMode(mode) {
  document.querySelectorAll('[data-assign]').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.assign === mode);
  });

  const note = document.getElementById('assign-mode-note');
  if (note) {
    note.textContent = mode === 'chosen'
      ? "Tapez sur l'équipe d'un joueur pour la changer."
      : "Répartition automatique, un joueur sur deux, dans l'ordre d'ajout.";
  }
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

export function renderPlayerStats(playerStats, teams) {
  const container = document.getElementById('player-stats');
  // Sort players by score descending
  const allPlayers = [];
  teams.forEach(team => {
    team.players.forEach(p => {
      allPlayers.push({ name: p, team: team.name, found: playerStats[p]?.found || 0 });
    });
  });
  allPlayers.sort((a, b) => b.found - a.found);

  container.innerHTML = `
    <h3>📊 Statistiques joueurs</h3>
    <table>
      <tr><th>Joueur</th><th>Équipe</th><th>Trouvés</th></tr>
      ${allPlayers.map(p => `<tr><td>${p.name}</td><td>${p.team}</td><td>${p.found}</td></tr>`).join('')}
    </table>
  `;
}
