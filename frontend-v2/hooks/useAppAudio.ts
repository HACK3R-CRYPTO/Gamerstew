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
  return pathname.startsWith("/games/rhythm") || pathname.startsWith("/games/simon");
}

// ═══ Hook — wires the module-level ctx, installs global listener + loop ════

export function useAppAudio() {
  const loopIdRef   = useRef<number | null>(null);
  const chordIdxRef = useRef(0);

  const settings: AudioSettings & { update: (p: Partial<AudioSettings>) => void } = useAudioSettings();
  useEffect(() => {
    const g = effectiveGains(settings);
    applyAmbientGain(g.appAudio);
    applySfxGain(g.sfx);
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
        const g = effectiveGains(settings);
        applyAmbientGain(g.appAudio);
        applySfxGain(g.sfx);
        playWelcomeChime();
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
}
