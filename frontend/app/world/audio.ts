// ─── World audio manager (lightweight, HTMLAudio only) ──────────────────────
// Three sounds, all copied into /public/world/audio/ from the real UP NEPA game:
//   cut.mp3       — the pidgin "NEPA carry light" voice, fired on a NEPA CUT
//   up.mp3        — the "UP NEPA" voice, fired on RELIGHT
//   nepa-beat.mp3 — an amapiano loop used as a quiet ambient bed under the world
//
// No Web Audio graph — just a handful of HTMLAudioElements. Browsers block
// autoplay until the first user gesture, so NOTHING starts until armWorldAudio()
// is called (wired in World.tsx to the first tap / key / canvas click). The bed
// only begins then, and it (plus every cue) is wrapped in try/catch so a blocked
// or missing file can never break the world. A mute flag stops/ducks everything.

let cutClip: HTMLAudioElement | null = null;
let upClip: HTMLAudioElement | null = null;
let bed: HTMLAudioElement | null = null;
// Lagos street ambience (traffic/horns/conductors). Drop a looping mp3 at
// /world/audio/road-ambient.mp3 and it auto-plays under the game modes; if the
// file is absent, play() just rejects and it stays silent (safe no-op).
let roadBed: HTMLAudioElement | null = null;
const ROAD_VOLUME = 0.12;

let mounted = true; // false once the world unmounts (hard stop)
let muted = false; // user mute toggle
let armed = false; // a user gesture has happened → playback allowed

const BED_VOLUME = 0.18; // quiet ambient bed
let bedFade = 0; // requestAnimationFrame id for the bed fade ramp

function make(src: string, opts: { loop?: boolean; volume: number }) {
  if (typeof Audio === "undefined") return null;
  try {
    const a = new Audio(src);
    a.preload = "auto";
    a.loop = !!opts.loop;
    a.volume = opts.volume;
    return a;
  } catch {
    return null;
  }
}

function playCue(a: HTMLAudioElement | null) {
  if (!a || !mounted || muted) return;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    /* ignore — audio is a nice-to-have */
  }
}

function fadeBedTo(target: number) {
  if (!bed || typeof requestAnimationFrame === "undefined") return;
  cancelAnimationFrame(bedFade);
  const step = () => {
    if (!bed) return;
    const d = target - bed.volume;
    bed.volume = Math.abs(d) < 0.01 ? target : bed.volume + d * 0.08;
    if (bed.volume !== target) bedFade = requestAnimationFrame(step);
    else if (target === 0) {
      try { bed.pause(); } catch { /* ignore */ }
    }
  };
  bedFade = requestAnimationFrame(step);
}

function startBed() {
  if (!bed || !mounted || muted || !armed) return;
  try {
    bed.volume = 0;
    const p = bed.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    fadeBedTo(BED_VOLUME);
  } catch {
    /* ignore */
  }
}

/** Create the audio elements (idempotent). */
export function initWorldAudio() {
  if (!cutClip) cutClip = make("/world/audio/cut.mp3", { volume: 0.8 });
  if (!upClip) upClip = make("/world/audio/up.mp3", { volume: 0.8 });
  if (!bed) bed = make("/world/audio/nepa-beat.mp3", { loop: true, volume: 0 });
  if (!roadBed) roadBed = make("/world/audio/road-ambient.mp3", { loop: true, volume: ROAD_VOLUME });
}

function startRoad() {
  if (!roadBed || !mounted || muted || !armed) return;
  try {
    roadBed.volume = ROAD_VOLUME;
    const p = roadBed.play();
    if (p && typeof p.catch === "function") p.catch(() => {}); // missing file / blocked → silent
  } catch {
    /* ignore — ambience is a nice-to-have */
  }
}

/** Call on the first user interaction (tap / key / canvas click). Unlocks
 *  autoplay and kicks off the ambient bed. Safe to call repeatedly. */
export function armWorldAudio() {
  if (armed) return;
  armed = true;
  initWorldAudio();
  startBed();
  startRoad();
}

export function playNepaCut() {
  initWorldAudio();
  playCue(cutClip);
}

export function playNepaUp() {
  initWorldAudio();
  playCue(upClip);
}

// ─── Synthesized skill-check SFX (no assets, WebAudio) ───────────────────────
let actx: AudioContext | null = null;
let master: GainNode | null = null; // everything routes through here
let reverb: ConvolverNode | null = null;

// Build a master chain (compressor + a short synthetic reverb) once, so the SFX
// sound produced and glued together instead of harsh raw oscillators.
function buildGraph(ctx: AudioContext) {
  if (master) return;
  master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.14;
  master.connect(comp).connect(ctx.destination);
  reverb = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 0.45);
  const imp = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = imp.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  reverb.buffer = imp;
  const rg = ctx.createGain();
  rg.gain.value = 0.2;
  reverb.connect(rg).connect(master);
}

function ensureCtx(): AudioContext | null {
  if (!armed || muted || !mounted || typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!actx) actx = new Ctor();
    buildGraph(actx);
    return actx;
  } catch {
    return null;
  }
}

// ── Voice helpers: an oscillator or a noise burst, each with an ADSR, optional
// filter + pitch sweep, a stereo pan, and a send to the shared reverb. ──
interface ToneOpts {
  type?: OscillatorType;
  f0: number; f1?: number;
  at: number; dur: number; peak: number;
  attack?: number; lp?: number; q?: number; pan?: number; detune?: number;
}
function tone(ctx: AudioContext, o: ToneOpts) {
  if (!master) return;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f0, o.at);
  if (o.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), o.at + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  let node: AudioNode = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(o.lp, o.at);
    if (o.q) f.Q.value = o.q;
    osc.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(o.peak, o.at + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
  node.connect(g);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = o.pan ?? 0; g.connect(p); p.connect(master); }
  else g.connect(master);
  if (reverb) g.connect(reverb);
  osc.start(o.at);
  osc.stop(o.at + o.dur + 0.05);
}
interface NoiseOpts {
  at: number; dur: number; peak: number;
  bp0?: number; bp1?: number; q?: number; hp?: number; pan?: number;
}
function noiseBurst(ctx: AudioContext, o: NoiseOpts) {
  if (!master) return;
  const n = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  let node: AudioNode = src;
  if (o.bp0) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(o.bp0, o.at);
    if (o.bp1) f.frequency.exponentialRampToValueAtTime(Math.max(1, o.bp1), o.at + o.dur);
    f.Q.value = o.q ?? 1;
    src.connect(f);
    node = f;
  } else if (o.hp) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = o.hp;
    src.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(o.peak, o.at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
  node.connect(g);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = o.pan ?? 0; g.connect(p); p.connect(master); }
  else g.connect(master);
  if (reverb) g.connect(reverb);
  src.start(o.at);
  src.stop(o.at + o.dur + 0.02);
}

/** Phone haptics (a no-op before the first gesture / where unsupported). */
export function haptic(pattern: number | number[]) {
  if (!armed) return; // vibrate is blocked until a user gesture anyway
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

/** Threw the switch / banked a device — a crisp mechanical confirm (click +
 *  woody body + a bell that rises with the combo); PERFECT adds a bright major
 *  arpeggio + a sparkle. `pan` (-1..1) places it toward the device on screen. */
// Each breaker you light plays the next note up a major-pentatonic ladder, so a
// run is a rising tune that only RESOLVES when the last breaker goes on. The ear
// hears how close the street is to done and wants the phrase finished
// (anticipation is half the pleasure; the last note is the release).
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
export function playHit(perfect: boolean, combo = 0, pan = 0, step = -1) {
  haptic(perfect ? 30 : 12);
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const ladder = step >= 0 ? Math.pow(2, LADDER[Math.min(step, LADDER.length - 1)] / 12) * 0.75 : 1;
  const mul = (1 + Math.min(combo, 12) * 0.028) * ladder;
  noiseBurst(ctx, { at: t, dur: 0.025, peak: 0.12, hp: 3500, pan }); // click transient
  tone(ctx, { type: "triangle", f0: 230 * mul, f1: 150 * mul, at: t, dur: 0.1, peak: 0.16, lp: 1400, pan }); // body thunk
  const base = 523.25 * mul;
  tone(ctx, { type: "sine", f0: base, at: t + 0.01, dur: 0.26, peak: 0.16, pan }); // confirm bell
  tone(ctx, { type: "sine", f0: base * 1.5, at: t + 0.03, dur: 0.2, peak: 0.08, pan });
  if (perfect) {
    [659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(ctx, { type: "sine", f0: f * mul, at: t + 0.06 + i * 0.05, dur: 0.22, peak: 0.12, pan }),
    );
    tone(ctx, { type: "sine", f0: 2400 * mul, at: t + 0.05, dur: 0.09, peak: 0.07, pan }); // sparkle
  }
}

/** A mistimed tap — NEPA shocks you: a harsh electric zap (sawtooth sweeping
 *  down + a bandpass crackle + a low thud). */
export function playMiss(pan = 0) {
  haptic([35, 25, 45, 25, 70]);
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  tone(ctx, { type: "sawtooth", f0: 420, f1: 55, at: t, dur: 0.3, peak: 0.2, lp: 2200, q: 6, pan });
  noiseBurst(ctx, { at: t, dur: 0.26, peak: 0.16, bp0: 2600, bp1: 500, q: 3, pan }); // crackle
  tone(ctx, { type: "square", f0: 72, at: t + 0.02, dur: 0.2, peak: 0.14, lp: 400, pan }); // thud
}

/** Generic bank chime (kept for any mode). */
export function playBank(big = false, pan = 0) {
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  noiseBurst(ctx, { at: t, dur: 0.02, peak: 0.1, hp: 4000, pan });
  const f = big ? 784 : 988;
  tone(ctx, { type: "sine", f0: f, at: t, dur: 0.28, peak: big ? 0.2 : 0.15, pan });
  tone(ctx, { type: "sine", f0: f * 1.5, at: t + 0.03, dur: 0.22, peak: 0.08, pan });
}

/** Charge RATCHET — a short blip whose pitch rises with the charge level (Charge's
 *  hold verb). The director fires it at charge milestones so the climb is audible;
 *  `level` 0..1 is the current charge, `warn` reddens the tone near the fry zone. */
export function playChargeTick(level = 0, warn = false, pan = 0) {
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const L = Math.max(0, Math.min(1, level));
  const f = 240 + L * 900; // rises with the charge
  tone(ctx, { type: warn ? "sawtooth" : "square", f0: f, at: t, dur: 0.045, peak: warn ? 0.09 : 0.055, lp: warn ? 2200 : 3200, pan });
  if (warn) noiseBurst(ctx, { at: t, dur: 0.04, peak: 0.05, bp0: 3000, bp1: 1200, q: 2, pan }); // sizzle tell
}

/** FRY — you held the charge too long and cooked the device: a harsh frazzle (a
 *  sawtooth sweep down + a long bandpass sizzle + a low pop). Distinct from the
 *  mistimed-tap zap so a fry reads as "burnt it", not "shocked". */
export function playFry(pan = 0) {
  haptic([50, 20, 80, 20, 120]);
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  tone(ctx, { type: "sawtooth", f0: 520, f1: 60, at: t, dur: 0.5, peak: 0.22, lp: 1800, q: 4, pan });
  noiseBurst(ctx, { at: t, dur: 0.5, peak: 0.18, bp0: 3200, bp1: 300, q: 1.5, pan }); // long sizzle
  tone(ctx, { type: "square", f0: 60, at: t + 0.04, dur: 0.26, peak: 0.16, lp: 300, pan }); // low pop
}

/** WARNING — a breaker is destabilising (Restore triage): two quick rising alarm
 *  beeps. `critical` makes them faster, higher and harsher (the last-second alarm). */
export function playWarn(critical = false, pan = 0) {
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const f = critical ? 880 : 620;
  const gap = critical ? 0.1 : 0.14;
  tone(ctx, { type: critical ? "square" : "triangle", f0: f, at: t, dur: 0.1, peak: 0.1, pan });
  tone(ctx, { type: critical ? "square" : "triangle", f0: f * 1.26, at: t + gap, dur: 0.1, peak: 0.1, pan });
}

/** CLUTCH SAVE — you rescued a dying breaker in the nick of time (Restore): a
 *  bright, satisfying ascending triad with a sparkle on top. */
export function playClutch(pan = 0) {
  haptic([20, 15, 35]);
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  [659.25, 880, 1174.66].forEach((f, i) =>
    tone(ctx, { type: "sine", f0: f, at: t + i * 0.05, dur: 0.26, peak: 0.15, pan }),
  );
  tone(ctx, { type: "sine", f0: 2637, at: t + 0.1, dur: 0.1, peak: 0.07, pan }); // sparkle
}

// ── Reactive music bed ───────────────────────────────────────────────────────
/** Drive the groove bed from a 0..1 level (Restore: swells as light returns). */
export function setBedLevel(x: number) {
  if (!bed || muted || !mounted || !armed) return;
  try {
    if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(bedFade);
    if (bed.paused) {
      const p = bed.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    bed.volume = 0.03 + 0.23 * Math.max(0, Math.min(1, x));
  } catch {
    /* ignore */
  }
}

/** Duck the bed on a blackout, bring it back on relight (Charge). */
export function duckBed(lightOn: boolean) {
  fadeBedTo(lightOn ? BED_VOLUME : 0.04);
}

/** Win — a rising brass-ish fanfare (two detuned saws per note) + a final held
 *  chord + a crowd whoop underneath. Fired when you restore the whole street. */
/** The street reacting to ONE breaker coming on: a short crowd whoop, bigger the
 *  more of the street is lit. (The full fanfare is playCheer, for the win.) */
export function playStreetCheer(level = 0.5, pan = 0) {
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime + 0.06;
  const v = 0.035 + Math.min(1, level) * 0.06;
  noiseBurst(ctx, { at: t, dur: 0.5 + level * 0.3, peak: v, bp0: 600, bp1: 2000 + level * 900, q: 0.8, pan });
  noiseBurst(ctx, { at: t + 0.08, dur: 0.35, peak: v * 0.7, bp0: 1400, bp1: 3200, q: 1.2, pan: -pan * 0.5 });
}

export function playCheer() {
  haptic([30, 50, 30, 50, 120]);
  const ctx = ensureCtx();
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const notes = [392, 523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const at = t + 0.09 + i * 0.1;
    tone(ctx, { type: "sawtooth", f0: f, at, dur: 0.32, peak: 0.1, lp: 2600, detune: -6 });
    tone(ctx, { type: "sawtooth", f0: f, at, dur: 0.32, peak: 0.1, lp: 2600, detune: 6 });
  });
  [523.25, 659.25, 783.99, 1046.5].forEach((f) =>
    tone(ctx, { type: "sawtooth", f0: f, at: t + 0.6, dur: 0.9, peak: 0.07, lp: 3000, detune: (Math.random() - 0.5) * 8 }),
  );
  noiseBurst(ctx, { at: t + 0.05, dur: 1.1, peak: 0.09, bp0: 500, bp1: 2400, q: 0.7 }); // crowd whoop
}

// ── Lagos road sound: horns ──────────────────────────────────────────────────
// A horn is two or three detuned saws held at full level (not a decaying blip),
// through a band-limiting filter, with a fast on/off. Each vehicle type has its
// own voice: the danfo's loud two-note air horn, the taxi's flat single horn,
// the keke's thin beep-beep, and the musical "electric" horn buses fit that
// plays a quick run of notes.
function hornNote(ctx: AudioContext, freqs: number[], at: number, dur: number, peak: number, pan: number, lp = 2600) {
  if (!master) return;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  g.gain.setValueAtTime(peak, at + Math.max(0.02, dur - 0.03));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = lp;
  f.Q.value = 1.2;
  for (const hz of freqs) {
    for (const det of [-9, 8]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz;
      o.detune.value = det;
      o.connect(f);
      o.start(at);
      o.stop(at + dur + 0.03);
    }
  }
  f.connect(g);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); }
  else g.connect(master);
  if (reverb) g.connect(reverb);
}

export type HornKind = "danfo" | "taxi" | "keke" | "electric" | "long";
/** Fire a horn. `vol` 0..1 (distance), `pan` -1..1. */
export function playHorn(kind: HornKind, pan = 0, vol = 1) {
  const ctx = ensureCtx();
  if (!ctx || !master || vol <= 0.02) return;
  const t = ctx.currentTime + 0.01;
  const v = Math.min(1, vol);
  switch (kind) {
    case "danfo": // pa-paaa: two-note air horn, short then long
      hornNote(ctx, [370, 466], t, 0.13, 0.16 * v, pan);
      hornNote(ctx, [370, 466], t + 0.2, 0.42, 0.18 * v, pan);
      break;
    case "long": // an angry lean on the horn
      hornNote(ctx, [349, 440], t, 0.95, 0.19 * v, pan);
      break;
    case "taxi":
      hornNote(ctx, [440, 554], t, 0.11, 0.13 * v, pan, 3200);
      hornNote(ctx, [440, 554], t + 0.17, 0.11, 0.13 * v, pan, 3200);
      break;
    case "keke": // thin, high beep-beep
      hornNote(ctx, [880], t, 0.07, 0.085 * v, pan, 4200);
      hornNote(ctx, [880], t + 0.12, 0.07, 0.085 * v, pan, 4200);
      hornNote(ctx, [880], t + 0.24, 0.1, 0.085 * v, pan, 4200);
      break;
    case "electric": { // the musical horn: a quick run of notes
      const run = [523, 659, 784, 1047, 784, 659, 784];
      run.forEach((hz, i) => hornNote(ctx, [hz, hz * 1.5], t + i * 0.105, 0.1, 0.1 * v, pan, 3800));
      break;
    }
  }
}

// ── Street voices ────────────────────────────────────────────────────────────
// Drivers and conductors shouting. Uses the browser's speech voice (no audio
// files to ship). One voice at a time, with a cooldown, so the road never turns
// into a wall of talk. Returns true if it actually spoke.
let voiceReadyAt = 0;
let cachedVoice: SpeechSynthesisVoice | null | undefined;
function streetVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  const vs = window.speechSynthesis.getVoices();
  if (!vs.length) return null; // not loaded yet; try again next call
  cachedVoice =
    vs.find((v) => /en[-_]NG/i.test(v.lang)) ??
    vs.find((v) => /en[-_](ZA|KE|GH)/i.test(v.lang)) ??
    vs.find((v) => /en[-_]GB/i.test(v.lang)) ??
    vs.find((v) => /^en/i.test(v.lang)) ??
    null;
  return cachedVoice;
}
export function streetShout(text: string, vol = 1, opts: { pitch?: number; rate?: number; gap?: number } = {}): boolean {
  if (!armed || muted || !mounted || typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const now = performance.now();
  if (now < voiceReadyAt || window.speechSynthesis.speaking) return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = streetVoice();
    if (v) u.voice = v;
    u.volume = Math.max(0.1, Math.min(1, vol));
    u.rate = opts.rate ?? 1.18;
    u.pitch = opts.pitch ?? 0.9 + Math.random() * 0.35;
    window.speechSynthesis.speak(u);
    voiceReadyAt = now + (opts.gap ?? 5000);
    return true;
  } catch {
    return false;
  }
}

const DRIVER_SHOUTS = [
  "Comot for road!", "Oga, comot for road o!", "You dey craze? Clear road!", "Shift! Shift! Shift!",
  "Abeg clear for road!", "You wan die? Comot!", "Na your papa road?", "Move! Move! Move!",
];
// The real thing: a recorded "Comot for road!" (see public/world/CREDITS.md).
// Used for most driver shouts; the spoken lines fill in so it never gets stale.
let comotClip: HTMLAudioElement | null | undefined;
/** A driver shouting at whoever is in the road. */
export function driverShout(vol = 1): string | null {
  if (!armed || muted || !mounted) return null;
  if (comotClip === undefined) comotClip = make("/world/audio/comot-for-road.mp3", { volume: 0.9 });
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (comotClip && now >= voiceReadyAt && Math.random() < 0.7) {
    comotClip.volume = Math.max(0.25, Math.min(1, vol)) * 0.9;
    playCue(comotClip);
    voiceReadyAt = now + 4500;
    return "Comot for road!";
  }
  const line = DRIVER_SHOUTS[Math.floor(Math.random() * DRIVER_SHOUTS.length)];
  return streetShout(line, vol, { rate: 1.25, gap: 4500 }) ? line : null;
}
const CALL_TAILS = ["Enter with your change o!", "One more chance!", "No shaking, enter!", "Straight! Straight!", "Hold your change!"];
/** A conductor calling his route: "Oshodi! Oshodi! Oshodi! One more chance!" */
export function conductorCall(route: string, vol = 1): boolean {
  const name = route.replace("CMS", "C M S").toLowerCase();
  const tail = CALL_TAILS[Math.floor(Math.random() * CALL_TAILS.length)];
  return streetShout(`${name}! ${name}! ${name}! ${tail}`, vol, { rate: 1.3, pitch: 1.05 + Math.random() * 0.3, gap: 7000 });
}

/** User mute toggle — ducks the bed and silences cues. */
export function setWorldAudioMuted(v: boolean) {
  muted = v;
  if (muted) {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    fadeBedTo(0);
    try { roadBed?.pause(); } catch { /* ignore */ }
  } else if (armed) {
    startBed();
    startRoad();
  }
}

export function isWorldAudioMuted() {
  return muted;
}

/** Called true on mount, false on unmount — a hard stop that tears everything
 *  down so nothing lingers after leaving /world. */
export function setWorldAudioEnabled(v: boolean) {
  mounted = v;
  if (!v) {
    if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(bedFade);
    for (const a of [cutClip, upClip, bed, roadBed, comotClip ?? null]) {
      try { a?.pause(); } catch { /* ignore */ }
    }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    try { actx?.close(); } catch { /* ignore */ }
    actx = null;
    master = null;
    reverb = null;
    armed = false;
  }
}
