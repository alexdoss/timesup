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

export function updateRoundScreen(round, teams) {
  document.getElementById('round-title').textContent = round.name;
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

export function renderPlayerList(players, onRemove) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  players.forEach(name => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${name}</span><button class="btn-remove" data-player="${name}">✕</button>`;
    li.querySelector('.btn-remove').addEventListener('click', () => onRemove(name));
    list.appendChild(li);
  });
  document.getElementById('player-count').textContent = `${players.length} joueur(s)`;
}

export function renderTeamsPreview(teams, interactive = false) {
  const container = document.getElementById('teams-preview');
  container.innerHTML = teams.map((team, teamIndex) => `
    <div class="team-preview-col">
      <h4>${team.name}</h4>
      <ul>${team.players.map(p => `<li class="${interactive ? 'player-swappable' : ''}" data-player="${p}" data-team="${teamIndex}">${p}</li>`).join('')}</ul>
    </div>
  `).join('');

  if (interactive) {
    container.querySelectorAll('.player-swappable').forEach(li => {
      li.addEventListener('click', () => {
        const playerName = li.dataset.player;
        const fromTeam = parseInt(li.dataset.team);
        const toTeam = fromTeam === 0 ? 1 : 0;

        // Move player
        teams[fromTeam].players = teams[fromTeam].players.filter(p => p !== playerName);
        teams[toTeam].players.push(playerName);

        // Re-render
        renderTeamsPreview(teams, true);
      });
    });
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
