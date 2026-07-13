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
    btn.className = 'btn-theme active';
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
