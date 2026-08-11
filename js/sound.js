// ===== SOUND MODULE =====
// Sons générés à la volée par le navigateur (aucun fichier audio, fonctionne hors ligne),
// accompagnés d'une vibration quand l'appareil sait le faire.
// Ne touche ni au DOM, ni aux règles du jeu.
//
// Limites connues : la vibration n'existe pas sur iOS, et le son y est muet
// si l'interrupteur latéral est en mode silencieux. La vibration n'est donc pas
// réglable — un bouton sans effet sur la moitié des téléphones induit en erreur.

const KEY_SON = 'timesup_son';

let ctx = null;
let soundEnabled = true;

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

export function isSoundEnabled() {
  return soundEnabled;
}

export function setSoundEnabled(value) {
  soundEnabled = !!value;
  writePreference(KEY_SON, soundEnabled);
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

// Un coup de cloche. Ce qui fait entendre du métal plutôt qu'une note, ce sont
// les partiels non harmoniques — des multiples « faux » de la fondamentale —
// et le fait que les plus aigus s'éteignent les premiers.
const PARTIELS = [[1, 1], [2.0, 0.55], [2.41, 0.4], [2.98, 0.28], [4.5, 0.14]];

function bell({ base, dur, gain, when = 0 }) {
  PARTIELS.forEach(([ratio, poids]) => {
    tone({
      freq: base * ratio,
      type: 'sine',
      dur: dur * (1 - (ratio - 1) * 0.13),
      gain: gain * poids,
      when
    });
  });
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
  if (soundEnabled) {
    unlockAudio();
    tone({ freq: 1250, type: 'triangle', dur: 0.045, gain: 0.22 });
  }
  vibrate(20);
}

// Fin de tour : trois coups de cloche, comme la fin d'un round de boxe.
// Il doit couper la parole dans une pièce bruyante sans faire sursauter, et
// surtout ne pas se confondre avec les tics aigus des dernières secondes.
const COUPS = [0, 0.26, 0.52];

export function playBuzzer() {
  if (soundEnabled) {
    unlockAudio();
    COUPS.forEach(when => bell({ base: 760, dur: 0.85, gain: 0.16, when }));
  }
  // La vibration suit les trois coups, au lieu de battre son propre rythme
  vibrate([180, 80, 180, 80, 180]);
}
