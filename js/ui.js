// ===== UI MODULE =====
// Gère l'affichage et les interactions DOM

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
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
    btn.className = selectedThemes.has(key) ? 'btn-theme active' : 'btn-theme';
    btn.dataset.theme = key;
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

    if (assignMode === 'chosen') {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = teamColors[teamIndex] || 'var(--muted)';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = name;

      const select = document.createElement('select');
      select.className = 'player-team-select';
      teams.forEach((team, tIdx) => {
        const opt = document.createElement('option');
        opt.value = String(tIdx);
        opt.textContent = team.name;
        if (tIdx === teamIndex) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => onTeamChange(name, parseInt(select.value, 10)));

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => onRemove(name));

      li.appendChild(swatch);
      li.appendChild(nameSpan);
      li.appendChild(select);
      li.appendChild(removeBtn);
    } else {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = teamColors[teamIndex] || 'var(--muted)';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = name;

      const teamLabel = document.createElement('span');
      teamLabel.className = 'player-team-label';
      teamLabel.textContent = teams[teamIndex]?.name || `Équipe ${teamIndex + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => onRemove(name));

      li.appendChild(swatch);
      li.appendChild(nameSpan);
      li.appendChild(teamLabel);
      li.appendChild(removeBtn);
    }

    list.appendChild(li);
  });
  document.getElementById('player-count').textContent = `${players.length} joueur(s)`;
}

export function renderRoundsSelector(rounds, activeRounds = [0, 1, 2]) {
  const container = document.getElementById('rounds-list');
  if (!container) return;

  container.innerHTML = '';
  rounds.forEach((round, index) => {
    const label = document.createElement('label');
    label.className = 'chk';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.roundIndex = index;
    input.checked = !round.optional || activeRounds.includes(index);
    input.disabled = !round.optional;

    const copy = document.createElement('span');
    copy.className = 'chk-copy';

    const title = document.createElement('strong');
    title.textContent = `${round.icon} ${round.name}`;

    const desc = document.createElement('small');
    desc.textContent = round.desc;

    copy.appendChild(title);
    copy.appendChild(desc);

    label.appendChild(input);
    label.appendChild(copy);

    if (!round.optional) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Obligatoire';
      label.appendChild(badge);
    }

    container.appendChild(label);
  });
}

export function renderAssignMode(mode) {
  document.querySelectorAll('[data-assign]').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.assign === mode);
  });

  const note = document.getElementById('assign-mode-note');
  if (note) {
    note.textContent = mode === 'chosen'
      ? "Choisissez l'équipe de chaque joueur ci-dessous."
      : "Répartition automatique, un joueur sur deux, dans l'ordre d'ajout.";
  }
}

export function updateCurrentPlayer(playerName) {
  document.getElementById('current-player').textContent =
    playerName ? `🎤 ${playerName} fait deviner` : '';
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
