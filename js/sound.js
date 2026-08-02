// ===== SOUND MODULE =====
// Sons générés à la volée par le navigateur (aucun fichier audio, fonctionne hors ligne)
// et vibration. Les deux se règlent indépendamment.
// Ne touche ni au DOM, ni aux règles du jeu.
//
// Limites connues : la vibration n'existe pas sur iOS, et le son y est muet
// si l'interrupteur latéral est en mode silencieux.

const KEY_SON = 'timesup_son';
const KEY_VIBRATION = 'timesup_vibration';

let ctx = null;
let soundEnabled = true;
let vibrationEnabled = true;

function readPreference(key) {
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, value ? 'on' : 'off');
  } catch {
    // préférence non mémorisée, sans conséquence sur la partie
  }
}

soundEnabled = readPreference(KEY_SON);
vibrationEnabled = readPreference(KEY_VIBRATION);

export function isSoundEnabled() {
  return soundEnabled;
}

export function setSoundEnabled(value) {
  soundEnabled = !!value;
  writePreference(KEY_SON, soundEnabled);
}

export function isVibrationEnabled() {
  return vibrationEnabled;
}

export function setVibrationEnabled(value) {
  vibrationEnabled = !!value;
  writePreference(KEY_VIBRATION, vibrationEnabled);
}

// Absente sur iOS : le réglage est alors affiché mais désactivé.
export function isVibrationSupported() {
  return typeof navigator.vibrate === 'function';
}

// À appeler depuis un geste utilisateur (un clic) : les navigateurs refusent
// de démarrer l'audio autrement.
export function unlockAudio() {
  if (!soundEnabled) return;
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
  if (!vibrationEnabled) return;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // appareil sans vibreur
  }
}

// Tic sec du décompte, joué à chaque seconde sous les 5 secondes restantes.
export function playTick() {
  if (soundEnabled) {
    unlockAudio();
    tone({ freq: 1250, type: 'triangle', dur: 0.045, gain: 0.22 });
  }
  vibrate(20);
}

// Buzzer de fin de tour : deux notes graves descendantes.
export function playBuzzer() {
  if (soundEnabled) {
    unlockAudio();
    tone({ freq: 210, type: 'sawtooth', dur: 0.30, gain: 0.22 });
    tone({ freq: 155, type: 'sawtooth', dur: 0.55, gain: 0.22, when: 0.28 });
  }
  vibrate([300, 120, 300]);
}
