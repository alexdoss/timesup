// ===== SOUND MODULE =====
// Sons générés à la volée par le navigateur (aucun fichier audio, fonctionne hors ligne)
// et vibration associée. Ne touche ni au DOM, ni aux règles du jeu.
//
// Limites connues : la vibration n'existe pas sur iOS, et le son y est muet
// si l'interrupteur latéral est en mode silencieux.

const STORAGE_KEY = 'timesup_son';

let ctx = null;
let enabled = true;

try {
  enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
} catch {
  enabled = true;
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(value) {
  enabled = !!value;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // préférence non mémorisée, sans conséquence sur la partie
  }
}

// À appeler depuis un geste utilisateur (un clic) : les navigateurs refusent
// de démarrer l'audio autrement.
export function unlockAudio() {
  if (!enabled) return;
  try {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

// Une note : attaque douce puis extinction naturelle, pour éviter les clics.
function tone({ freq, freq2, type = 'sine', dur, gain = 0.25, when = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // appareil sans vibreur
  }
}

// Tic sec du décompte, joué à chaque seconde sous les 5 secondes restantes.
export function playTick() {
  if (!enabled) return;
  unlockAudio();
  tone({ freq: 1250, type: 'triangle', dur: 0.045, gain: 0.22 });
  vibrate(20);
}

// Buzzer de fin de tour : deux notes graves descendantes.
export function playBuzzer() {
  if (!enabled) return;
  unlockAudio();
  tone({ freq: 210, type: 'sawtooth', dur: 0.30, gain: 0.22 });
  tone({ freq: 155, type: 'sawtooth', dur: 0.55, gain: 0.22, when: 0.28 });
  vibrate([300, 120, 300]);
}
