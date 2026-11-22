"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAudioSettings, effectiveGains, type AudioSettings } from "./useAudioSettings";

// ═══ App-wide UI audio — single module-level AudioContext + named play fns ═══
// Everything that isn't game-track audio lives here: ambient pad loop, click
// blip, modal whooshes, finish-screen stings, coin cha-ching, etc.
//
// Two master gain nodes so the two toggles in Profile do what players expect:
//   • _ambientMaster — background ambient loop. Tied to the "App Audio" toggle.
//   • _sfxMaster     — clicks, stings, chimes, coin, tab-tick, whooshes.
//                      Tied to the "SFX" toggle (same one games use).
// Previously everything routed through a single master tied to App Audio, so
// muting the menu music also silenced button clicks — surprising to users.

let _ctx: AudioContext | null = null;
// Ambient signal chain: sources → _ambientBus → EQ (bass + presence shelves)
// → compressor → _ambientMaster → destination. This is the "mastering" every
// mixed track goes through so the thing sounds GLUED (even dynamics) and the
// low end actually reaches cheap earbuds/laptop speakers. Without this chain,
// kicks get eaten by the pad and the whole mix sounds thin on consumer audio.
let _ambientBus:    GainNode | null = null;     // entry point — sources connect here
let _ambientMaster: GainNode | null = null;     // tail — volume toggle
let _sfxMaster:     GainNode | null = null;
// Scalar copies. ensureCtx() reads these when creating the gain nodes, so the
// settings-sync effect must set them BEFORE the first gesture creates _ctx.
let _ambientGain = 0;
let _sfxGain     = 0;

// ── NEPA charge hum — ONE persistent, gated node (never per-socket/frame) ──
// A sine 110Hz + quiet saw 220Hz through a lowpass into a dedicated gain that
// rides into _sfxMaster. Started lazily on the first setNepaChargeIntensity()
// call so the oscillators never spin up for games that don't use them. The
// level tracks the count of actively-charging sockets; _chargeHumLevel is the
// current (pre-duck) target so duckChargeHum() can restore it after a transient.
let _chargeHumGain:    GainNode | null = null;
let _chargeHumOscSine: OscillatorNode | null = null;
let _chargeHumOscSaw:  OscillatorNode | null = null;
let _chargeHumStarted = false;
let _chargeHumLevel = 0;

function ensureCtx(): AudioContext | null {
  if (_ctx) return _ctx;
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try { _ctx = new Ctx(); } catch { return null; }
  if (_ctx && _ctx.state !== "running") {
    _ctx.resume().catch(() => {});
  }

  // ── Ambient mastering chain ────────────────────────────────────────────
  // Bus (sources fan in here) → bass shelf → presence shelf → compressor →
  // output gain. The output gain is what the App Audio toggle controls.
  _ambientBus = _ctx.createGain();
  _ambientBus.gain.value = 1;

  // Bass shelf: +6 dB below ~160 Hz. Makes kicks and sub-pad notes audible
  // on speakers that naturally roll off the low end. Single most impactful
  // EQ move for this content.
  const bassShelf = _ctx.createBiquadFilter();
  bassShelf.type = "lowshelf";
  bassShelf.frequency.value = 160;
  bassShelf.gain.value = 6;

  // Presence shelf: +2 dB above ~2.5 kHz. Gentle sparkle so the upper arp
  // notes and UI sounds that share this chain (none currently, but future-
  // proofed) don't sound muffled after the bass boost.
  const presenceShelf = _ctx.createBiquadFilter();
  presenceShelf.type = "highshelf";
  presenceShelf.frequency.value = 2500;
  presenceShelf.gain.value = 2;

  // Glue compressor: catches transient peaks (kicks) without ducking the
  // pad and arp underneath. Threshold lifted to -14 dB so only the kick
  // peaks get tamed — pad and arp sit below the threshold and pass through
  // at full volume. Softer ratio so the effect is "warming" rather than
  // pumping. Attack 25 ms lets the kick's initial thump through clean.
  const comp = _ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value      = 12;
  comp.ratio.value     = 2.2;
  comp.attack.value    = 0.025;
  comp.release.value   = 0.3;

  _ambientMaster = _ctx.createGain();
  _ambientMaster.gain.value = _ambientGain;

  _ambientBus.connect(bassShelf);
  bassShelf.connect(presenceShelf);
  presenceShelf.connect(comp);
  comp.connect(_ambientMaster);
  _ambientMaster.connect(_ctx.destination);

  // SFX stays a simple single-stage gain — clicks and stings are already
  // mixed carefully by their scheduling code and don't need the same treatment.
  _sfxMaster = _ctx.createGain();
  _sfxMaster.gain.value = _sfxGain;
  _sfxMaster.connect(_ctx.destination);
  return _ctx;
}

// Smooth 100ms ramps — avoids the audible click of an instant gain jump and
// kills any scheduled tails within the same window.
function rampGain(node: GainNode | null, target: number) {
  if (!_ctx || !node) return;
  const now = _ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(target, now + 0.1);
}
function applyAmbientGain(target: number) { _ambientGain = target; rampGain(_ambientMaster, target); }
function applySfxGain(target: number)     { _sfxGain     = target; rampGain(_sfxMaster,     target); }

// ─── Primitive tone helpers (take an explicit output node) ──────────────────

function scheduleSine(ctx: AudioContext, out: AudioNode, freq: number, startAt: number, duration: number, volume: number, sweepTo?: number) {
  if (volume <= 0) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);
  if (sweepTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(sweepTo, startAt + duration);
  }
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(volume, startAt + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  osc.connect(gain); gain.connect(out);
  osc.start(startAt); osc.stop(startAt + duration + 0.02);
}

function scheduleBell(ctx: AudioContext, out: AudioNode, freq: number, startAt: number, duration: number, volume: number) {
  if (volume <= 0) return;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, startAt);
  master.gain.linearRampToValueAtTime(volume, startAt + 0.003);
  master.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  master.connect(out);
  const o1 = ctx.createOscillator();
  o1.type = "sine"; o1.frequency.value = freq;
  o1.connect(master); o1.start(startAt); o1.stop(startAt + duration + 0.02);
  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  g2.gain.value = 0.3;
  o2.type = "triangle"; o2.frequency.value = freq * 2;
  o2.connect(g2); g2.connect(master);
  o2.start(startAt); o2.stop(startAt + duration * 0.8 + 0.02);
}

// ═══ Exported play functions — all SFX, routed through _sfxMaster ═══════════

export function playClick() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  scheduleSine(ctx, _sfxMaster, 1400, ctx.currentTime, 0.08, 0.1, 900);
}

export function playWelcomeChime() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50];  // C5, E5, G5, C6
  notes.forEach((freq, i) => scheduleBell(ctx, _sfxMaster!, freq, now + i * 0.08, 0.5, 0.28));
}

export function playAchievementChime() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  const now = ctx.currentTime;
  scheduleBell(ctx, _sfxMaster, 1568.00, now, 0.7, 0.22);
  scheduleBell(ctx, _sfxMaster, 2093.00, now + 0.06, 0.6, 0.14);
}

export function playLevelUp() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, i) => scheduleBell(ctx, _sfxMaster!, freq, now + i * 0.08, 0.5, 0.2));
}

export function playSaveSuccess() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  const now = ctx.currentTime;
  scheduleBell(ctx, _sfxMaster, 523.25, now,        0.3,  0.16);
  scheduleBell(ctx, _sfxMaster, 698.46, now + 0.08, 0.35, 0.16);
}

export function playRankReveal() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  scheduleBell(ctx, _sfxMaster, 1318.51, ctx.currentTime, 0.45, 0.2);
}

export function playWhooshIn() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  scheduleSine(ctx, _sfxMaster, 200, ctx.currentTime, 0.16, 0.08, 700);
}

export function playWhooshOut() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  scheduleSine(ctx, _sfxMaster, 700, ctx.currentTime, 0.16, 0.08, 200);
}

export function playCoin() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  const now = ctx.currentTime;
  scheduleBell(ctx, _sfxMaster, 2093.00, now,        0.35, 0.2);
  scheduleBell(ctx, _sfxMaster, 2637.02, now + 0.05, 0.4,  0.16);
  scheduleBell(ctx, _sfxMaster, 3135.96, now + 0.12, 0.5,  0.14);
}

export function playTabSwitch() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  scheduleSine(ctx, _sfxMaster, 900, ctx.currentTime, 0.05, 0.06, 1100);
}

// ═══ Challenge AI sound design ═══════════════════════════════════════════════
// Pure synth, no asset files. Each helper is bound to a single moment in
// the wager flow so the game feels alive instead of silent. All routed
// through _sfxMaster so the existing mute toggle covers them.
//
// resumeCtx() guards against a suspended AudioContext — Web Audio can
// suspend on tab-blur, after navigation on iOS Safari, or after long
// idle. resume() is a no-op when already running, so safe to call every
// time. Without this guard sounds silently no-op even when settings
// say SFX is on.
function resumeCtx() {
  if (_ctx && _ctx.state === "suspended") _ctx.resume().catch(() => {});
}

// FIGHT! slam — bass thump + descending whip + sustained bell. Lands on
// the same frame the FIGHT text scales in. Volumes pumped vs initial
// version because the previous 0.18–0.22 peaks were inaudible under
// modest device output levels.
export function playFightSlam() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleSine(ctx, _sfxMaster, 140,  now,        0.40, 0.9,  60);   // low thump
  scheduleSine(ctx, _sfxMaster, 1800, now,        0.20, 0.5,  400);  // high whip
  scheduleBell(ctx, _sfxMaster, 587.33, now + 0.05, 0.7, 0.55);      // sustain
}

// AI rolling — rising arpeggio of short pulses, like a dial spinning up.
// Fires once at the start of the agent-accept wait; ~0.4s total.
export function playAiRolling() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  for (let i = 0; i < 6; i++) {
    scheduleSine(ctx, _sfxMaster, 220 + i * 60, now + i * 0.07, 0.08, 0.22);
  }
}

// Win — bright C-major ascent + sparkle bell at the top. Reward moment.
export function playWin() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C5 E5 G5 C6 E6
  notes.forEach((f, i) => scheduleBell(ctx, _sfxMaster!, f, now + i * 0.09, 0.6, 0.55));
  scheduleBell(ctx, _sfxMaster, 2093.00, now + 0.55, 0.75, 0.45);    // sparkle
}

// Tie — neutral single-note ping with a soft echo. Reads as "settled,
// neither side cleared the other".
export function playTie() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleBell(ctx, _sfxMaster, 783.99, now,        0.55, 0.5);
  scheduleBell(ctx, _sfxMaster, 783.99, now + 0.18, 0.45, 0.4);
}

// Lose — minor descending sequence. Honest, brief, doesn't dwell.
export function playLose() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  const notes = [392.00, 311.13, 246.94, 196.00]; // G4 Eb4 B3 G3
  notes.forEach((f, i) => scheduleBell(ctx, _sfxMaster!, f, now + i * 0.10, 0.65, 0.45));
}

// ─── Noise burst helper (arena impacts/whooshes) ────────────────────────────
// White-noise buffer through a bandpass + gain envelope. freq shapes the
// character: ~500Hz = weighty thud crack, ~2000Hz = airy whoosh.
function scheduleNoise(ctx: AudioContext, out: AudioNode, startAt: number, duration: number, volume: number, freq: number, q = 0.9) {
  if (volume <= 0) return;
  const len = Math.ceil(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(volume, startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  src.connect(bp); bp.connect(gain); gain.connect(out);
  src.start(startAt); src.stop(startAt + duration + 0.02);
}

// ═══ Arena (Challenge AI) SFX kit ═══════════════════════════════════════════

// Fist pump — short airy whoosh with a falling pitch tail. Fires once per
// pump, synced to the fistPump keyframe (3× per shake).
export function playFistPump() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleNoise(ctx, _sfxMaster, now, 0.14, 0.28, 1800, 0.7);
  scheduleSine(ctx, _sfxMaster, 320, now + 0.02, 0.12, 0.18, 140);
}

// Chant tick — ROCK · PAPER · SCISSORS. Pitch rises per word; the last word
// gets a bright octave accent so the reveal lands on a peak.
export function playChantTick(idx: number) {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  const freqs = [440, 554.37, 659.25]; // A4 C#5 E5 — rising A-major
  const f = freqs[Math.min(idx, 2)] ?? 440;
  scheduleBell(ctx, _sfxMaster, f, now, 0.22, idx === 2 ? 0.6 : 0.42);
  if (idx === 2) scheduleBell(ctx, _sfxMaster, f * 2, now + 0.04, 0.3, 0.3);
}

// Reveal slam — the fists open. Heavy: sub thump + mid crack + air.
export function playRevealSlam() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleSine(ctx, _sfxMaster, 130, now, 0.35, 0.85, 55);           // sub thump
  scheduleNoise(ctx, _sfxMaster, now, 0.16, 0.5, 500, 0.8);          // crack
  scheduleNoise(ctx, _sfxMaster, now + 0.01, 0.25, 0.22, 2400, 0.6); // air
}

// Per-round stingers — lighter than the match-end playWin/playLose so five
// rounds don't fatigue. Two notes each; direction tells the story.
export function playRoundWin() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleBell(ctx, _sfxMaster, 659.25, now, 0.3, 0.5);         // E5
  scheduleBell(ctx, _sfxMaster, 987.77, now + 0.09, 0.4, 0.5);  // B5 up
}
export function playRoundLose() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleBell(ctx, _sfxMaster, 349.23, now, 0.3, 0.45);        // F4
  scheduleBell(ctx, _sfxMaster, 261.63, now + 0.10, 0.4, 0.45); // C4 down
}
export function playRoundTie() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleBell(ctx, _sfxMaster, 523.25, now, 0.25, 0.4);        // C5
  scheduleBell(ctx, _sfxMaster, 523.25, now + 0.12, 0.3, 0.3);  // echo
}

// CALLED IT — menacing two-stab minor second + low dread. MARKOV read you;
// it should feel slightly wrong on purpose.
export function playCalledIt() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleSine(ctx, _sfxMaster, 466.16, now, 0.12, 0.5);          // Bb4 stab
  scheduleSine(ctx, _sfxMaster, 493.88, now + 0.11, 0.30, 0.5);   // B4 rub
  scheduleSine(ctx, _sfxMaster, 98, now, 0.3, 0.4, 70);           // low dread
}

// Sudden death — FINAL ROUND banner. Low pedal swell + tritone.
export function playSuddenDeath() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  scheduleSine(ctx, _sfxMaster, 82.41, now, 0.9, 0.6);            // E2 pedal
  scheduleBell(ctx, _sfxMaster, 329.63, now + 0.05, 0.5, 0.45);   // E4
  scheduleBell(ctx, _sfxMaster, 466.16, now + 0.25, 0.7, 0.5);    // Bb4 tritone
}

// ═══ NEPA: Up Light sound design ═════════════════════════════════════════════
// Pure synth one-shots for the blackout-dodging charge game. All routed through
// _sfxMaster (same mute toggle as every other game SFX) and each begins with
// resumeCtx() exactly like playFightSlam. Plus a single persistent "charge hum"
// node controlled by setNepaChargeIntensity() — see the module-level state.

// Lazily build the charge-hum chain the first time it's needed. Idempotent.
function ensureChargeHum() {
  const ctx = _ctx;
  if (!ctx || !_sfxMaster || _chargeHumStarted) return;
  _chargeHumStarted = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 400;
  lp.Q.value = 0.7;
  _chargeHumGain = ctx.createGain();
  _chargeHumGain.gain.value = 0;
  _chargeHumOscSine = ctx.createOscillator();
  _chargeHumOscSine.type = "sine";
  _chargeHumOscSine.frequency.value = 110;
  _chargeHumOscSaw = ctx.createOscillator();
  _chargeHumOscSaw.type = "sawtooth";
  _chargeHumOscSaw.frequency.value = 220;
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.3;
  _chargeHumOscSine.connect(lp);
  _chargeHumOscSaw.connect(sawGain); sawGain.connect(lp);
  lp.connect(_chargeHumGain);
  _chargeHumGain.connect(_sfxMaster);
  try { _chargeHumOscSine.start(); _chargeHumOscSaw.start(); } catch { /* already started */ }
}

// Brief -60% dip then restore, so a riser/cut transient reads clean over the
// hum. Restores to the live _chargeHumLevel (not a constant) so it respects
// whatever intensity is currently set.
function duckChargeHum() {
  const ctx = _ctx;
  if (!ctx || !_chargeHumGain) return;
  const now = ctx.currentTime;
  const ducked = _chargeHumLevel * 0.4;
  _chargeHumGain.gain.cancelScheduledValues(now);
  _chargeHumGain.gain.setValueAtTime(_chargeHumGain.gain.value, now);
  _chargeHumGain.gain.linearRampToValueAtTime(ducked, now + 0.03);
  _chargeHumGain.gain.setValueAtTime(ducked, now + 0.15);
  _chargeHumGain.gain.linearRampToValueAtTime(_chargeHumLevel, now + 0.28);
}

// n = count of actively-charging sockets (0..3). Ramps the hum gain over 120ms
// and nudges the base pitch up per socket. 0 silences it. Never spawns a new
// oscillator — the single node started above is reused for the whole session.
export function setNepaChargeIntensity(n: number) {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  ensureChargeHum();
  if (!_chargeHumGain) return;
  const count = Math.max(0, Math.min(3, Math.floor(n)));
  const level = count === 0 ? 0 : 0.06 * (count / 3);   // cap ~0.06 at 3 sockets
  _chargeHumLevel = level;
  const now = ctx.currentTime;
  _chargeHumGain.gain.cancelScheduledValues(now);
  _chargeHumGain.gain.setValueAtTime(_chargeHumGain.gain.value, now);
  _chargeHumGain.gain.linearRampToValueAtTime(level, now + 0.12);
  if (_chargeHumOscSine) {
    const base = count <= 1 ? 110 : count === 2 ? 123 : 138;
    _chargeHumOscSine.frequency.cancelScheduledValues(now);
    _chargeHumOscSine.frequency.setValueAtTime(_chargeHumOscSine.frequency.value, now);
    _chargeHumOscSine.frequency.linearRampToValueAtTime(base, now + 0.12);
  }
}

// Intro + every relight — low body sweep + ascending C-major bells. Ducks hum.
export function playNepaRiser() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  scheduleSine(ctx, m, 180, now, 0.5, 0.45, 900);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => scheduleBell(ctx, m, f, now + i * 0.07, 0.4, 0.3));
  duckChargeHum();
}

// Plug confirm — short click thump + tiny noise tick.
export function playNepaPlug() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  scheduleSine(ctx, m, 320, now, 0.10, 0.35, 120);
  scheduleNoise(ctx, m, now, 0.04, 0.22, 2000, 1);
}

// Bank — pitch rises with the combo so a streak sounds like it climbs.
export function playNepaBank(combo: number) {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  const f = 1046.5 * Math.pow(2, Math.min(combo, 12) / 12);
  scheduleBell(ctx, m, f, now, 0.3, 0.22);
  scheduleBell(ctx, m, f * 1.5, now + 0.05, 0.35, 0.16);
  scheduleBell(ctx, m, f * 2, now + 0.12, 0.4, 0.14);
  nepaGrooveSidechain();   // bank punches a brief dip in the groove
}

// Milestone combo sparkle (×3 / ×5 / …).
export function playNepaCombo() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  [1568, 2093, 2637].forEach((f, i) => scheduleBell(ctx, m, f, now + i * 0.06, 0.4, 0.18));
}

// THE signature power-down — big detuned drop + noise whoosh. Ducks hum.
export function playNepaCut() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  scheduleSine(ctx, m, 600, now, 0.6, 0.5, 55);
  scheduleSine(ctx, m, 120, now, 0.4, 0.7, 45);
  scheduleNoise(ctx, m, now, 0.25, 0.45, 300, 0.8);
  duckChargeHum();
  nepaGrooveSidechain();   // dip the groove under the transient (blackout wins if it follows)
}

// Reject — no free socket. Short low blip.
export function playNepaReject() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  scheduleSine(ctx, m, 220, now, 0.18, 0.25, 90);
}

// Pre-cut voltage dip — a soft low "vrrm" as the mains sag ~0.5s before NEPA
// takes the light. Single ~90→70Hz sine, 0.25s, through _sfxMaster. Purely a
// cosmetic tell; fired off the schedule read, never touches scoring.
export function playNepaDip() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  scheduleSine(ctx, _sfxMaster, 90, ctx.currentTime, 0.25, 0.22, 70);
}

// Unplug a device mid-charge (wasted). Two-tone drop.
export function playNepaUnplug() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  scheduleSine(ctx, m, 400, now, 0.14, 0.3, 140);
  scheduleSine(ctx, m, 110, now, 0.2, 0.3);
}

// Countdown beep for the final seconds — pass last=true on the very last one.
export function playNepaBeep(last = false) {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  scheduleSine(ctx, m, last ? 1760 : 880, now, 0.08, 0.22);
}

// Game over — long low drone + low root + a resolving bell. Silences the hum.
export function playNepaGameOver() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const m = _sfxMaster;
  const now = ctx.currentTime;
  scheduleSine(ctx, m, 500, now, 0.9, 0.5, 50);
  scheduleSine(ctx, m, 82.41, now, 0.9, 0.5);
  scheduleBell(ctx, m, 392, now + 0.2, 0.6, 0.35);
  setNepaChargeIntensity(0);
}

// ═══ NEPA groove bed — procedural Lagos amapiano/afrobeats loop ═════════════
// A separate bus from ambient AND sfx so the "Music" toggle controls it alone:
//   voices → _nepaGrooveBus → bassShelf → comp → _nepaDuckGain → _nepaGrooveMaster
//          → destination
// _nepaGrooveMaster carries effectiveGains().music (musicOn=false ⇒ silent,
// while SFX on _sfxMaster still play). _nepaDuckGain is the ONLY node that
// performance automation (blackout / relight / intensity / SFX sidechain)
// touches — _nepaGrooveMaster is NEVER ramped for performance, only for the
// settings slider. A Chris-Wilson two-clock lookahead scheduler walks a 2-bar
// (32×16th) loop at 112 BPM; in-flight voices self-stop, so stopping just
// clears the setInterval — no oscillator refs are held, nothing leaks.
let _nepaGrooveBus:    GainNode | null = null;   // sources fan in here
let _nepaDuckGain:     GainNode | null = null;   // performance automation ONLY
let _nepaGrooveMaster: GainNode | null = null;   // music-toggle volume
let _nepaNoiseBuf:     AudioBuffer | null = null; // shared white noise for hats/shakers
let _nepaGrooveBuilt   = false;
let _nepaMusicGain     = 0;                       // scalar mirror of .music
let _nepaTimer: number | null = null;             // setInterval id
let _nepa16thTime      = 0;                        // next step's audio-clock time
let _nepaStep          = 0;                        // 0..31
let _nepaIntensity     = 0;                        // 0 | 1 (final-10s driving mode)
let _nepaWantsPlay     = false;                    // session intent (survives blur)

const NEPA_BPM            = 112;
const NEPA_SEC_PER_16TH   = (60 / NEPA_BPM) / 4;    // 0.1339s
const NEPA_SWING          = NEPA_SEC_PER_16TH * 0.10; // delay odd 16ths ~10%
const NEPA_LOOKAHEAD_MS   = 25;
const NEPA_SCHEDULE_AHEAD = 0.1;

function applyMusicGain(target: number) { _nepaMusicGain = target; rampGain(_nepaGrooveMaster, target); }

// A minor pentatonic log-drum pitches.
const NEPA_A1 = 55.00, NEPA_C2 = 65.41, NEPA_D2 = 73.42, NEPA_E2 = 82.41, NEPA_G2 = 98.00, NEPA_E1 = 41.20;
type NepaLog = { target: number; glideFrom?: number; ghost?: boolean };
// Keyed by the FULL 0..31 step. Hero melody lands OFF the kicks, glides ~35ms.
const NEPA_LOG_TABLE: Record<number, NepaLog> = {
  // bar 1 (steps 0-15)
  2:  { target: NEPA_A1, glideFrom: NEPA_E1 },
  3:  { target: NEPA_A1, ghost: true },
  6:  { target: NEPA_C2, glideFrom: NEPA_A1 },
  10: { target: NEPA_A1 },
  11: { target: NEPA_A1, ghost: true },
  14: { target: NEPA_D2, glideFrom: NEPA_A1 },
  // bar 2 (steps 16-31, s = step-16)
  18: { target: NEPA_A1, glideFrom: NEPA_E1 }, // s2
  19: { target: NEPA_A1, ghost: true },        // s3
  22: { target: NEPA_E2, glideFrom: NEPA_C2 }, // s6
  26: { target: NEPA_G2 },                     // s10
  27: { target: NEPA_E2, ghost: true },        // s11
  30: { target: NEPA_A1, glideFrom: NEPA_D2 }, // s14: D2 → glide down to A1
};

// Build the groove chain + shared noise buffer once. Idempotent (mirrors
// ensureChargeHum). Reads _nepaMusicGain so the master opens at the right level.
function ensureNepaGrooveBus() {
  const ctx = _ctx;
  if (!ctx || _nepaGrooveBuilt) return;
  _nepaGrooveBuilt = true;

  _nepaGrooveBus = ctx.createGain();
  _nepaGrooveBus.gain.value = 1;

  const bassShelf = ctx.createBiquadFilter();
  bassShelf.type = "lowshelf";
  bassShelf.frequency.value = 150;
  bassShelf.gain.value = 6;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value      = 10;
  comp.ratio.value     = 3;
  comp.attack.value    = 0.01;
  comp.release.value   = 0.2;

  _nepaDuckGain = ctx.createGain();
  _nepaDuckGain.gain.value = 1;

  _nepaGrooveMaster = ctx.createGain();
  _nepaGrooveMaster.gain.value = _nepaMusicGain;

  _nepaGrooveBus.connect(bassShelf);
  bassShelf.connect(comp);
  comp.connect(_nepaDuckGain);
  _nepaDuckGain.connect(_nepaGrooveMaster);
  _nepaGrooveMaster.connect(ctx.destination);

  // ONE shared ~0.3s white-noise buffer — every hat/shaker/clap/rim points a
  // fresh (cheap) BufferSource at it; we never allocate a buffer per hit.
  const len = Math.ceil(ctx.sampleRate * 0.3);
  _nepaNoiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = _nepaNoiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

// ── Groove voices — all connect to _nepaGrooveBus; pre-master vols (music gain
//    scales them downstream). Every osc/source calls stop() so none leak. ──

// Shared-noise one-shot through a bandpass — the body of every hat/shaker/rim.
function nepaNoiseHit(ctx: AudioContext, when: number, dur: number, vol: number, freq: number, q: number) {
  const out = _nepaGrooveBus, buf = _nepaNoiseBuf;
  if (!out || !buf || vol <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  src.connect(bp); bp.connect(g); g.connect(out);
  src.start(when); src.stop(when + dur + 0.02);
}

function nepaShaker(ctx: AudioContext, when: number, vol: number) { nepaNoiseHit(ctx, when, 0.025, vol, 7000, 1.5); }
function scheduleNepaShaker(when: number, vol: number) { const ctx = _ctx; if (ctx) nepaShaker(ctx, when, vol); }
function nepaOpenHat(ctx: AudioContext, when: number) { nepaNoiseHit(ctx, when, 0.09, 0.05, 8500, 1.0); }
function nepaRim(ctx: AudioContext, when: number)     { nepaNoiseHit(ctx, when, 0.03, 0.08, 2500, 4); }
function nepaClap(ctx: AudioContext, when: number) {
  nepaNoiseHit(ctx, when, 0.06, 0.12, 1800, 1.2);
  nepaNoiseHit(ctx, when, 0.11, 0.08, 1200, 1.2); // quieter lower layer = body
}

function nepaKick(ctx: AudioContext, when: number) {
  const out = _nepaGrooveBus; if (!out) return;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(95, when);
  osc.frequency.exponentialRampToValueAtTime(48, when + 0.09);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 180; lp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(0.55, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
  osc.connect(lp); lp.connect(g); g.connect(out);
  osc.start(when); osc.stop(when + 0.24);
}

function nepaLogDrum(ctx: AudioContext, when: number, target: number, glideFrom: number | undefined, ghost: boolean) {
  const out = _nepaGrooveBus; if (!out) return;
  const vol = ghost ? 0.09 : 0.22;
  const dur = ghost ? 0.12 : 0.22;
  const from = glideFrom ?? target;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(from, when);
  osc.frequency.exponentialRampToValueAtTime(target, when + 0.035);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  osc.connect(lp); lp.connect(g); g.connect(out);
  osc.start(when); osc.stop(when + dur + 0.02);

  // SUB — sine at the root for weight, same 'when' (full notes only).
  if (!ghost) {
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(from, when);
    sub.frequency.exponentialRampToValueAtTime(target, when + 0.035);
    const subLp = ctx.createBiquadFilter();
    subLp.type = "lowpass"; subLp.frequency.value = 120;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, when);
    sg.gain.linearRampToValueAtTime(0.18, when + 0.004);
    sg.gain.exponentialRampToValueAtTime(0.001, when + dur);
    sub.connect(subLp); subLp.connect(sg); sg.connect(out);
    sub.start(when); sub.stop(when + dur + 0.02);
  }

  // INTENSITY — double the note a quiet octave up.
  if (_nepaIntensity === 1) {
    const oct = ctx.createOscillator();
    oct.type = "sine";
    oct.frequency.setValueAtTime(from * 2, when);
    oct.frequency.exponentialRampToValueAtTime(target * 2, when + 0.035);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, when);
    og.gain.linearRampToValueAtTime(0.06, when + 0.004);
    og.gain.exponentialRampToValueAtTime(0.001, when + dur);
    oct.connect(og); og.connect(out);
    oct.start(when); oct.stop(when + dur + 0.02);
  }
}

// Schedule one 16th step. s = step%16 drives the drum grid; the log drum reads
// the full 0..31 table. Odd steps are swung (delayed ~10% of a 16th).
function scheduleNepaStep(step: number, when: number) {
  const ctx = _ctx; if (!ctx) return;
  const s = step % 16;
  const t = (s % 2 === 1) ? when + NEPA_SWING : when; // swing odd steps

  // KICK — 0,4,8,12 (+ 6,14 when driving)
  if (s === 0 || s === 4 || s === 8 || s === 12) nepaKick(ctx, when);
  if (_nepaIntensity === 1 && (s === 6 || s === 14)) nepaKick(ctx, when);

  // SHAKER — every step; accent on odd (louder); +0.02 accent when driving
  const accent = s % 2 === 1;
  let shakerVol = accent ? 0.05 : 0.03;
  if (_nepaIntensity === 1 && accent) shakerVol += 0.02;
  nepaShaker(ctx, t, shakerVol);

  // OPEN HAT — 2,6,10,14 (+ 0,4,8,12 driving 8ths when intense)
  if (s === 2 || s === 6 || s === 10 || s === 14) nepaOpenHat(ctx, t);
  if (_nepaIntensity === 1 && (s === 0 || s === 4 || s === 8 || s === 12)) nepaOpenHat(ctx, when);

  // CLAP — 4,12 ; RIM tresillo 3-3-2 — 0,6,12
  if (s === 4 || s === 12) nepaClap(ctx, when);
  if (s === 0 || s === 6 || s === 12) nepaRim(ctx, when);

  // LOG DRUM — hero melody keyed by full step
  const log = NEPA_LOG_TABLE[step];
  if (log) nepaLogDrum(ctx, t, log.target, log.glideFrom, !!log.ghost);
}

// Chris-Wilson lookahead: schedule every step whose time falls inside the
// next NEPA_SCHEDULE_AHEAD window, advancing the audio-clock cursor + step.
function nepaScheduler() {
  const ctx = _ctx; if (!ctx) return;
  while (_nepa16thTime < ctx.currentTime + NEPA_SCHEDULE_AHEAD) {
    scheduleNepaStep(_nepaStep, _nepa16thTime);
    _nepa16thTime += NEPA_SEC_PER_16TH;
    _nepaStep = (_nepaStep + 1) % 32;
  }
}

export function startNepaGroove() {
  const ctx = ensureCtx(); if (!ctx) return;
  resumeCtx();
  ensureNepaGrooveBus();
  _nepaWantsPlay = true;
  if (_nepaTimer != null) return;              // no double-start
  _nepaStep = 0;
  _nepa16thTime = ctx.currentTime + 0.1;
  _nepaIntensity = 0;
  if (_nepaDuckGain) {
    _nepaDuckGain.gain.cancelScheduledValues(ctx.currentTime);
    _nepaDuckGain.gain.setValueAtTime(1, ctx.currentTime);
  }
  _nepaTimer = window.setInterval(nepaScheduler, NEPA_LOOKAHEAD_MS);
}

export function stopNepaGroove() {
  _nepaWantsPlay = false;
  if (_nepaTimer != null) { clearInterval(_nepaTimer); _nepaTimer = null; }
  const ctx = _ctx;
  if (ctx && _nepaDuckGain) {
    const now = ctx.currentTime;
    _nepaDuckGain.gain.cancelScheduledValues(now);
    _nepaDuckGain.gain.setValueAtTime(_nepaDuckGain.gain.value, now);
    _nepaDuckGain.gain.linearRampToValueAtTime(0, now + 0.12); // fast fade
  }
  _nepaIntensity = 0;
}

// Internal pause for tab-blur: clears the timer (never run against a suspended
// ctx) + fades the groove, but KEEPS _nepaWantsPlay so onVisible can resume a
// still-active run (the spec's "gate a restart on /games/nepa + playing").
function pauseNepaGroove() {
  if (_nepaTimer != null) { clearInterval(_nepaTimer); _nepaTimer = null; }
  const ctx = _ctx;
  if (ctx && _nepaDuckGain) {
    const now = ctx.currentTime;
    _nepaDuckGain.gain.cancelScheduledValues(now);
    _nepaDuckGain.gain.setValueAtTime(_nepaDuckGain.gain.value, now);
    _nepaDuckGain.gain.linearRampToValueAtTime(0, now + 0.08);
  }
}

// Signature power-down — snap the groove to silence in 0.06s. Keep the
// scheduler RUNNING (don't reset _nepaStep) so it returns dead in phase.
export function nepaGrooveBlackout() {
  const ctx = _ctx; if (!ctx || !_nepaDuckGain) return;
  const now = ctx.currentTime;
  _nepaDuckGain.gain.cancelScheduledValues(now);
  _nepaDuckGain.gain.setValueAtTime(_nepaDuckGain.gain.value, now);
  _nepaDuckGain.gain.linearRampToValueAtTime(0, now + 0.06);
}

// Relight — slam the groove back faster than it died (0.04s) + a 32nd-note
// shaker fill to mark the return.
export function nepaGrooveRelight() {
  const ctx = _ctx; if (!ctx || !_nepaDuckGain) return;
  const now = ctx.currentTime;
  _nepaDuckGain.gain.cancelScheduledValues(now);
  _nepaDuckGain.gain.setValueAtTime(_nepaDuckGain.gain.value, now);
  _nepaDuckGain.gain.linearRampToValueAtTime(1, now + 0.04);
  for (let i = 0; i < 4; i++) scheduleNepaShaker(now + i * (NEPA_SEC_PER_16TH / 2), 0.04 + i * 0.015);
}

// Final-10s driving mode (no tempo change). Edge-guarded by the page.
export function setNepaGrooveIntensity(n: number) { _nepaIntensity = n >= 1 ? 1 : 0; }

// SFX sidechain — brief dip to 0.45 (~180ms) then restore, reusing the
// duckChargeHum ramp shape. On a full blackout the ramp-to-0 cancels this.
function nepaGrooveSidechain() {
  const ctx = _ctx; if (!ctx || !_nepaDuckGain) return;
  const now = ctx.currentTime;
  _nepaDuckGain.gain.cancelScheduledValues(now);
  _nepaDuckGain.gain.setValueAtTime(_nepaDuckGain.gain.value, now);
  _nepaDuckGain.gain.linearRampToValueAtTime(0.45, now + 0.03);
  _nepaDuckGain.gain.setValueAtTime(0.45, now + 0.18);
  _nepaDuckGain.gain.linearRampToValueAtTime(1, now + 0.28);
}

// Longer duck for a sustained voice-over (the full "UP NEPA" meme sample). Dips
// the groove to ~35% for `seconds`, holds, then restores over the final 0.4s.
// Like nepaGrooveSidechain it touches ONLY _nepaDuckGain (never _nepaGroove
// Master); a blackout's ramp-to-0 or a groove (re)start still overrides it.
function duckNepaGrooveForVoice(seconds: number) {
  const ctx = _ctx; if (!ctx || !_nepaDuckGain) return;
  const now = ctx.currentTime;
  const holdEnd = now + Math.max(0.2, seconds - 0.4);
  const restoreAt = now + Math.max(0.3, seconds);
  _nepaDuckGain.gain.cancelScheduledValues(now);
  _nepaDuckGain.gain.setValueAtTime(_nepaDuckGain.gain.value, now);
  _nepaDuckGain.gain.linearRampToValueAtTime(0.35, now + 0.08);
  _nepaDuckGain.gain.setValueAtTime(0.35, holdEnd);
  _nepaDuckGain.gain.linearRampToValueAtTime(1, restoreAt);
}

// ═══ NEPA real-sample voice — the downloaded "UP NEPA" prepaid-meter sound ═══
// A tiny sample player that REUSES the single module AudioContext (ensureCtx)
// — it never constructs a new one. Each url is fetched + decoded exactly once
// and cached; an in-flight guard dedupes concurrent loads. Playback routes
// through _sfxMaster, so the existing SFX mute/volume + iOS unlock already
// cover it. Everything swallows errors — a missing or slow asset must never
// throw into the game loop; at worst a first play is silently skipped.
const _sampleBuffers = new Map<string, AudioBuffer>();
const _sampleLoading = new Map<string, Promise<void>>();

const NEPA_BEEP_URL = "/games/nepa/up-nepa-beep.mp3";  // 1.7s iconic meter beep
const NEPA_FULL_URL = "/games/nepa/up-nepa.mp3";       // 8.8s full meme voice
// Pidgin voice lines (committed mp3s) — the authentic callouts.
const NEPA_VOICE_UP_URL    = "/games/nepa/voice/up.mp3";     // "Up NEPA! dem don bring light"
const NEPA_VOICE_CUT_URL   = "/games/nepa/voice/cut.mp3";    // "Ahhh NEPA don carry light"
const NEPA_VOICE_COMBO_URL = "/games/nepa/voice/combo.mp3";  // "Oya charge am sharp sharp"

async function loadSample(url: string): Promise<void> {
  const ctx = ensureCtx();
  if (!ctx) return;
  if (_sampleBuffers.has(url)) return;
  const inflight = _sampleLoading.get(url);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      _sampleBuffers.set(url, buf);
    } catch {
      /* swallow — never throw into the game */
    } finally {
      _sampleLoading.delete(url);
    }
  })();
  _sampleLoading.set(url, p);
  return p;
}

// Play a cached sample through _sfxMaster. If it isn't decoded yet, kick a load
// and play once ready (best-effort — a missed first play is acceptable). onStart
// fires the moment the buffer actually starts, so the groove duck lands in sync.
function playSample(url: string, onStart?: () => void) {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const start = (buf: AudioBuffer) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(_sfxMaster!);
    try { src.start(); onStart?.(); } catch { /* ignore */ }
  };
  const cached = _sampleBuffers.get(url);
  if (cached) { start(cached); return; }
  loadSample(url).then(() => {
    const buf = _sampleBuffers.get(url);
    if (buf) start(buf);
  }).catch(() => {});
}

// Preload both NEPA voice samples — called on the first user gesture so the
// short beep is decoded well before the first relight.
export function preloadNepaVoice() {
  loadSample(NEPA_BEEP_URL);
  loadSample(NEPA_FULL_URL);
  loadSample(NEPA_VOICE_UP_URL);
  loadSample(NEPA_VOICE_CUT_URL);
  loadSample(NEPA_VOICE_COMBO_URL);
}

// The iconic 1.7s prepaid-meter beep — fires on every relight. Ducks the groove
// ~180ms (reusing the SFX sidechain shape) so the voice cuts through.
export function playUpNepaBeep() {
  playSample(NEPA_BEEP_URL, () => nepaGrooveSidechain());
}

// The full 8.8s "UP NEPA" meme voice — the hype open as a round begins. Ducks
// the groove to ~35% for the sample's duration, then restores, via _nepaDuckGain.
export function playUpNepaFull() {
  playSample(NEPA_FULL_URL, () => duckNepaGrooveForVoice(8.8));
}

// ─── Pidgin voice lines ─── each plays its committed mp3 through _sfxMaster and
// ducks the groove ~2.6s so the line sits on top. The page throttles these so a
// rapid light toggle can't stack them; a not-yet-decoded first play is skipped
// (preloadNepaVoice warms all three on the first gesture).
export function playNepaVoiceUp()    { playSample(NEPA_VOICE_UP_URL,    () => duckNepaGrooveForVoice(2.6)); }
export function playNepaVoiceCut()   { playSample(NEPA_VOICE_CUT_URL,   () => duckNepaGrooveForVoice(2.6)); }
export function playNepaVoiceCombo() { playSample(NEPA_VOICE_COMBO_URL, () => duckNepaGrooveForVoice(2.6)); }

// ═══ Lagos ambience — routed to _sfxMaster so music-muted players still hear it
// GENERATOR "I-pass-my-neighbour" idle + CROWD GROAN on the cut. ═════════════
let _genBuilt    = false;
let _genGain:   GainNode | null = null;
let _genOsc1:   OscillatorNode | null = null;
let _genOsc2:   OscillatorNode | null = null;
let _genNoise:  AudioBufferSourceNode | null = null;
let _genLfo1:   OscillatorNode | null = null;
let _genLfo2:   OscillatorNode | null = null;
const NEPA_GEN_LEVEL = 0.05;

// Persistent gated generator idle: square 52Hz + detuned saw + filtered noise,
// gated by a putt LFO (two summed squares = irregular putt-putt), through a
// 400Hz lowpass into _genGain → _sfxMaster. Idempotent.
function ensureGenerator() {
  const ctx = _ctx;
  if (!ctx || !_sfxMaster || _genBuilt) return;
  _genBuilt = true;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 400; lp.Q.value = 0.7;
  _genGain = ctx.createGain();
  _genGain.gain.value = 0;
  lp.connect(_genGain);
  _genGain.connect(_sfxMaster);

  // Putt gate: base 0.5, two square LFOs (±0.5 each) chop it irregularly.
  const putt = ctx.createGain();
  putt.gain.value = 0.5;
  putt.connect(lp);

  _genOsc1 = ctx.createOscillator();
  _genOsc1.type = "square"; _genOsc1.frequency.value = 52;
  _genOsc1.connect(putt);

  _genOsc2 = ctx.createOscillator();
  _genOsc2.type = "sawtooth"; _genOsc2.frequency.value = 52 * 1.01;
  const o2g = ctx.createGain(); o2g.gain.value = 0.25;
  _genOsc2.connect(o2g); o2g.connect(putt);

  // Looping noise → 300Hz lowpass for mechanical grit.
  const nlen = Math.ceil(ctx.sampleRate * 1.0);
  const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
  const nd = nbuf.getChannelData(0);
  for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
  _genNoise = ctx.createBufferSource();
  _genNoise.buffer = nbuf; _genNoise.loop = true;
  const nlp = ctx.createBiquadFilter();
  nlp.type = "lowpass"; nlp.frequency.value = 300; nlp.Q.value = 0.7;
  const ng = ctx.createGain(); ng.gain.value = 0.04;
  _genNoise.connect(nlp); nlp.connect(ng); ng.connect(putt);

  _genLfo1 = ctx.createOscillator();
  _genLfo1.type = "square"; _genLfo1.frequency.value = 8.5;
  _genLfo2 = ctx.createOscillator();
  _genLfo2.type = "square"; _genLfo2.frequency.value = 9.7;
  const lg1 = ctx.createGain(); lg1.gain.value = 0.5;
  const lg2 = ctx.createGain(); lg2.gain.value = 0.5;
  _genLfo1.connect(lg1); lg1.connect(putt.gain);
  _genLfo2.connect(lg2); lg2.connect(putt.gain);

  try { _genOsc1.start(); _genOsc2.start(); _genNoise.start(); _genLfo1.start(); _genLfo2.start(); } catch { /* already started */ }
}

// Fade the generator in (on / relight) or out (blackout cough). 120ms ramp.
export function setGeneratorOn(on: boolean) {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  ensureGenerator();
  if (!_genGain) return;
  const now = ctx.currentTime;
  const target = on ? NEPA_GEN_LEVEL : 0;
  _genGain.gain.cancelScheduledValues(now);
  _genGain.gain.setValueAtTime(_genGain.gain.value, now);
  _genGain.gain.linearRampToValueAtTime(target, now + 0.12);
}

// Fully stop + tear down the generator (endGame / unmount / blur). Rebuilds on
// the next setGeneratorOn — so no oscillators run after a run ends.
export function stopGenerator() {
  const ctx = _ctx;
  if (_genGain && ctx) {
    const now = ctx.currentTime;
    _genGain.gain.cancelScheduledValues(now);
    _genGain.gain.setValueAtTime(_genGain.gain.value, now);
    _genGain.gain.linearRampToValueAtTime(0, now + 0.1);
  }
  const at = ctx ? ctx.currentTime + 0.15 : 0;
  [_genOsc1, _genOsc2, _genLfo1, _genLfo2].forEach(o => { try { o?.stop(at); } catch { /* not started */ } });
  try { _genNoise?.stop(at); } catch { /* not started */ }
  _genOsc1 = _genOsc2 = _genLfo1 = _genLfo2 = null;
  _genNoise = null;
  _genGain = null;
  _genBuilt = false;
}

// CROWD GROAN "ahhh, NEPA!" — a slow-swelling two-formant filtered-noise sigh
// on the cut. Routed to _sfxMaster. (One-shot buffer; cut edges are rare.)
export function playNepaCrowdGroan() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  const dur = 0.9;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp1 = ctx.createBiquadFilter();
  bp1.type = "bandpass"; bp1.Q.value = 4;
  bp1.frequency.setValueAtTime(700, now);
  bp1.frequency.linearRampToValueAtTime(560, now + dur);
  const bp2 = ctx.createBiquadFilter();
  bp2.type = "bandpass"; bp2.Q.value = 5;
  bp2.frequency.setValueAtTime(1100, now);
  bp2.frequency.linearRampToValueAtTime(950, now + dur);
  const swell = ctx.createGain();
  swell.gain.setValueAtTime(0, now);
  swell.gain.linearRampToValueAtTime(0.14, now + 0.30);  // slow attack
  swell.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(bp1); src.connect(bp2);
  bp1.connect(swell); bp2.connect(swell);
  swell.connect(_sfxMaster);
  src.start(now); src.stop(now + dur + 0.02);
}

// RELIGHT CHEER — a short, brighter crowd "ayyy" when the light returns. Rising
// formants (opposite of the groan's fall), quieter + shorter so it sits under
// the pidgin voice. Routed to _sfxMaster. Cheap one-shot; relight edges are rare.
export function playNepaCrowdCheer() {
  const ctx = _ctx; if (!ctx || !_sfxMaster) return;
  resumeCtx();
  const now = ctx.currentTime;
  const dur = 0.5;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp1 = ctx.createBiquadFilter();
  bp1.type = "bandpass"; bp1.Q.value = 4;
  bp1.frequency.setValueAtTime(600, now);
  bp1.frequency.linearRampToValueAtTime(820, now + dur);   // rising = brighter/up
  const bp2 = ctx.createBiquadFilter();
  bp2.type = "bandpass"; bp2.Q.value = 5;
  bp2.frequency.setValueAtTime(1000, now);
  bp2.frequency.linearRampToValueAtTime(1400, now + dur);
  const swell = ctx.createGain();
  swell.gain.setValueAtTime(0, now);
  swell.gain.linearRampToValueAtTime(0.08, now + 0.12);    // quiet
  swell.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(bp1); src.connect(bp2);
  bp1.connect(swell); bp2.connect(swell);
  swell.connect(_sfxMaster);
  src.start(now); src.stop(now + dur + 0.02);
}

// Called by the hook's visibility handler so the groove pause/resume lives in
// one place and _nepaWantsPlay gating is honoured.
function nepaOnHidden() { pauseNepaGroove(); stopGenerator(); }
function nepaOnVisible(onNepaRoute: boolean) {
  if (_nepaWantsPlay && onNepaRoute) { startNepaGroove(); setGeneratorOn(true); }
}

// ═══ Ambient — arpeggiated C-minor pulse, routed through _ambientMaster ═════
// Previous iteration stacked 3 triangle notes per chord + a soft kick — dense
// and mood-y but static. This version arpeggiates the same harmony so the pad
// has movement without adding drums (which the user's last round found noisy).
//
// Harmony: i → VI → III → VII in C minor (Cm, Ab, Eb, Bb). Each chord is a
// 4-note arpeggio played as 16th notes at ~96 BPM — a bar of forward motion
// every 2.5s — stacked under a held root note for body. Soft lowpass-filtered
// sine bass on beat 1 grounds each chord.

// [root, 3rd, 5th, octave] for each chord in the progression
const AMBIENT_ARPS: [number, number, number, number][] = [
  [130.81, 155.56, 196.00, 261.63],  // Cm  (C3,  Eb3, G3,  C4)
  [103.83, 130.81, 155.56, 207.65],  // Ab  (Ab2, C3,  Eb3, Ab3)
  [155.56, 196.00, 233.08, 311.13],  // Eb  (Eb3, G3,  Bb3, Eb4)
  [116.54, 146.83, 174.61, 233.08],  // Bb  (Bb2, D3,  F3,  Bb3)
];
const BAR_DURATION_SEC = 2.5;
const NOTE_INTERVAL    = BAR_DURATION_SEC / 4;   // quarter-of-bar per note
const WAVE_INTERVAL_MS = BAR_DURATION_SEC * 1000;
// Layer volumes — tuned so all four (pad, root, arp, kick) are individually
// audible. Pad carries the chord, root gives body, arp gives motion, kick
// gives pulse. Earlier values were too shy against the stronger kick.
const ARP_NOTE_VOL     = 0.09;
const ROOT_HOLD_VOL    = 0.06;

function scheduleAmbientWave(ctx: AudioContext, arp: [number, number, number, number], when: number) {
  // Route through the BUS (entry to the mastering chain), not the master
  // directly — otherwise EQ + compressor are bypassed and the signal hits
  // the output raw, which is what the user heard before this refactor.
  const out = _ambientBus;
  if (!out) return;

  // ── PAD (sustained chord) ──────────────────────────────────────────────
  // Three chord tones (root + third + fifth, from the arp's first 3 slots)
  // held across the entire bar. This is the "Cm → Ab → Eb → Bb" you actually
  // HEAR as a progression — chord rings the full 2.5s, crossfades with the
  // next. Without this layer, you only hear the arp notes flashing past.
  // Pad louder than arp — the pad IS the chord, so it should be the most
  // prominent non-kick voice. Sits just under the kick at 0.18.
  const padVol = 0.08;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = arp[i];
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(padVol, when + 0.9);            // 0.9s slow fade in
    gain.gain.setValueAtTime(padVol, when + BAR_DURATION_SEC - 0.7);  // hold until near end
    gain.gain.exponentialRampToValueAtTime(0.001, when + BAR_DURATION_SEC);  // fade out
    osc.connect(gain); gain.connect(out);
    osc.start(when); osc.stop(when + BAR_DURATION_SEC + 0.1);
  }

  // ── ROOT (body) — octave below the arpeggio root ─────────────────────
  const rootOsc = ctx.createOscillator();
  const rootGain = ctx.createGain();
  rootOsc.type = "triangle";
  rootOsc.frequency.value = arp[0] / 2;
  rootGain.gain.setValueAtTime(0, when);
  rootGain.gain.linearRampToValueAtTime(ROOT_HOLD_VOL, when + 0.4);
  rootGain.gain.setValueAtTime(ROOT_HOLD_VOL, when + BAR_DURATION_SEC - 0.4);
  rootGain.gain.exponentialRampToValueAtTime(0.001, when + BAR_DURATION_SEC);
  rootOsc.connect(rootGain); rootGain.connect(out);
  rootOsc.start(when); rootOsc.stop(when + BAR_DURATION_SEC + 0.1);

  // Arpeggiate up the chord as short sine plucks with a gentle tail.
  arp.forEach((freq, i) => {
    const t = when + i * NOTE_INTERVAL;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i === 3 ? "sine" : "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(ARP_NOTE_VOL, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + NOTE_INTERVAL * 0.95);
    osc.connect(gain); gain.connect(out);
    osc.start(t); osc.stop(t + NOTE_INTERVAL + 0.05);
  });

  // Soft kicks on beats 1 and 3 — two per bar at ~48 BPM heartbeat.
  scheduleSoftKick(ctx, when);
  scheduleSoftKick(ctx, when + BAR_DURATION_SEC / 2);
}

// Soft kick tuned to actually be audible on laptop speakers and earbuds.
// Previous version swept 55 → 30 Hz — consumer audio hardware rolls off
// below ~60 Hz so the tail was silent even though it was "playing". Now the
// sweep stays in the 90 → 55 Hz range (always audible), with a 220 Hz
// lowpass that lets just enough body through for the thump to land without
// sounding clicky or harsh. Still soft — 0.18 × master gain (0.6) ≈ 0.11
// peak — felt as pulse, not dance-kick.
function scheduleSoftKick(ctx: AudioContext, when: number) {
  // Kick goes into the bus so the bass shelf (+6 dB at 160 Hz) and compressor
  // both lift it — that's what makes it audible on cheap speakers/earbuds.
  const out = _ambientBus;
  if (!out) return;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(90, when);
  osc.frequency.exponentialRampToValueAtTime(55, when + 0.08);
  filter.type = "lowpass";
  filter.frequency.value = 220;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.18, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
  osc.connect(filter); filter.connect(gain); gain.connect(out);
  osc.start(when); osc.stop(when + 0.35);
}

function isGameplayRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  // Any gameplay surface kills the ambient loop so game audio + the AI
  // wait-state SFX own the channel. Challenge AI was missing here, so
  // the menu hum kept playing under the VS cinematic and into rounds.
  return pathname.startsWith("/games/rhythm")
      || pathname.startsWith("/games/simon")
      || pathname.startsWith("/games/challenge-ai")
      || pathname.startsWith("/games/nepa")
      || pathname.startsWith("/games/stack")
      // The 3D games have their own soundscape (street ambience, crowd, glass).
      // The menu arpeggio playing under them read as a slot machine.
      || pathname.startsWith("/world")
      || pathname.startsWith("/bowling");
}

// ═══ Hook — wires the module-level ctx, installs global listener + loop ════

export function useAppAudio() {
  const loopIdRef   = useRef<number | null>(null);
  const chordIdxRef = useRef(0);

  const settings: AudioSettings & { update: (p: Partial<AudioSettings>) => void } = useAudioSettings();
  // Live mirror of settings for the first-gesture handler below (deps: []), so
  // it applies the CURRENT gains — not the unmuted DEFAULTS captured at mount.
  // Without this, a player who had muted still heard sound on their first tap
  // until they toggled the switch off and on again.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    const g = effectiveGains(settings);
    applyAmbientGain(g.appAudio);
    applySfxGain(g.sfx);
    applyMusicGain(g.music);   // NEPA groove bus — nothing else consumes .music
  }, [settings]);

  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const startAmbientLoop = () => {
    if (loopIdRef.current != null) return;
    const scheduleNext = () => {
      const ctx = _ctx;
      if (!ctx) return;
      if (isGameplayRoute(pathnameRef.current)) return;
      const arp = AMBIENT_ARPS[chordIdxRef.current % AMBIENT_ARPS.length];
      scheduleAmbientWave(ctx, arp, ctx.currentTime + 0.05);
      chordIdxRef.current++;
    };
    scheduleNext();
    loopIdRef.current = window.setInterval(scheduleNext, WAVE_INTERVAL_MS);
  };

  const stopAmbientLoop = () => {
    if (loopIdRef.current != null) {
      clearInterval(loopIdRef.current);
      loopIdRef.current = null;
    }
  };

  useEffect(() => {
    if (!_ctx) return;
    if (isGameplayRoute(pathname)) stopAmbientLoop();
    else startAmbientLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const firstGesture = !_ctx;
      const ctx = ensureCtx();
      if (!ctx) return;
      if (firstGesture) {
        const g = effectiveGains(settingsRef.current); // live value, not the mount-time DEFAULTS
        applyAmbientGain(g.appAudio);
        applySfxGain(g.sfx);
        applyMusicGain(g.music);
        if (g.sfx > 0) playWelcomeChime();             // one-shot: stay silent when muted
        preloadNepaVoice();                            // decode the UP-NEPA voice samples now, so the beep is ready
        // Loop always starts — gain=0 keeps it silent, so unmuting later is
        // instant (matches how the nav/visibility handlers start it too).
        if (!isGameplayRoute(pathnameRef.current)) startAmbientLoop();
      }

      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest("button, [role='button']");
      if (!btn) return;
      const optOut = (btn as HTMLElement).closest("[data-no-click-sound='true']");
      if (optOut) return;
      playClick();
    };
    document.addEventListener("pointerdown", handler);
    return () => {
      document.removeEventListener("pointerdown", handler);
      stopAmbientLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Page Visibility — pause everything when the tab is hidden or the window
  // loses focus. Previously the ambient loop kept running in the background
  // because nothing stopped the setInterval or the already-scheduled Web
  // Audio oscillators, so players heard the pad continue after switching
  // tabs or minimizing the browser. Suspending the AudioContext silences any
  // in-flight nodes cleanly, and clearing the loop prevents new waves from
  // being scheduled while hidden.
  useEffect(() => {
    const onHidden = () => {
      stopAmbientLoop();
      // NEPA: clear the 25ms timer BEFORE suspending so the scheduler never
      // ticks against a suspended ctx; tear the generator down too.
      nepaOnHidden();
      if (_ctx && _ctx.state === "running") {
        _ctx.suspend().catch(() => {});
      }
    };
    const onVisible = () => {
      if (_ctx && _ctx.state === "suspended") {
        _ctx.resume().catch(() => {});
      }
      // Only restart the ambient loop on menu routes — gameplay routes stop
      // it intentionally so game tracks dominate.
      if (_ctx && !isGameplayRoute(pathnameRef.current)) {
        startAmbientLoop();
      }
      // NEPA groove: resume only if a run was active AND we're still on the
      // nepa route (the page owns phase; this is the gated-restart path). Runs
      // after ctx.resume() so the scheduler never starts against a suspended ctx.
      if (_ctx) nepaOnVisible((pathnameRef.current || "").startsWith("/games/nepa"));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") onHidden();
      else onVisible();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    // `blur` / `focus` catch the desktop case where the browser stays visible
    // but a different window takes focus — visibilitychange does not fire
    // there. Safe to double-hook since the handlers are idempotent.
    window.addEventListener("blur", onHidden);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onHidden);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pagehide", onHidden);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
