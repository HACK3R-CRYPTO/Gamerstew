"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAudioSettings, effectiveGains, type AudioSettings } from "./useAudioSettings";

// ═══ App-wide UI audio — single module-level AudioContext + named play fns ═══
// Everything that isn't game-track audio lives here: ambient pad loop, click
// blip, modal whooshes, finish-screen stings, coin cha-ching, etc.
//
// Design choices (why it's shaped this way):
//   • Module-level _ctx — any component can import `playLevelUp()` etc. and
//     trigger a sound without threading a ref through its props. The context
//     is created on the first user gesture (browsers' autoplay policy forbids
//     creating it earlier) and shared from then on.
//   • Single "appAudio" gain — matches the third toggle in profile settings.
//     All menu audio (ambient pad + click + stings + chimes + coin + whooshes)
//     routes through it. Game tracks (music / sfx sliders) stay independent
//     so players can mute the menu without muting their games.
//   • Silent no-op before unlock — before the first gesture, _ctx is null and
//     every play fn returns early. Components never need to check "is audio
//     ready?" — they just call.

let _ctx: AudioContext | null = null;
// All app-wide audio (ambient pad + clicks + stings + chimes + coin + whoosh +
// tab tick + welcome chime) routes through _appAudioGain. Games have their own
// music and sfx sliders that do NOT affect this — the menu can be silenced
// while games stay audible, and vice versa.
let _appAudioGain = 0;

function ensureCtx(): AudioContext | null {
  if (_ctx) return _ctx;
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try { _ctx = new Ctx(); } catch { return null; }
  // Some browsers (Safari on iOS, older Chrome variants) create the context
  // in "suspended" state even during a user gesture. Explicit resume() is
  // required or nothing audible ever plays. Fire-and-forget — if it rejects
  // we can't do anything useful with the error anyway.
  if (_ctx && _ctx.state !== "running") {
    _ctx.resume().catch(() => {});
  }
  return _ctx;
}

// ─── Primitive tone helpers ──────────────────────────────────────────────────

function scheduleSine(ctx: AudioContext, freq: number, startAt: number, duration: number, volume: number, sweepTo?: number) {
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
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(startAt); osc.stop(startAt + duration + 0.02);
}

function scheduleBell(ctx: AudioContext, freq: number, startAt: number, duration: number, volume: number) {
  if (volume <= 0) return;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, startAt);
  master.gain.linearRampToValueAtTime(volume, startAt + 0.003);
  master.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  master.connect(ctx.destination);
  // Fundamental sine + soft triangle 2nd harmonic = bell
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

// ═══ Exported play functions — anyone can import and call ═══════════════════

// Short sine-sweep blip — the universal "button pressed" tick. Ties to sfx.
export function playClick() {
  const ctx = _ctx;
  if (!ctx) return;
  scheduleSine(ctx, 1400, ctx.currentTime, 0.08, 0.1 * _appAudioGain, 900);
}

// Welcome chime — fires on first AudioContext unlock so the player HEARS
// the moment their tap enabled audio. Bright C major arpeggio up one octave.
// Ties to SFX (not music) — it's a UI sting, not background music — and is
// intentionally loud so a first-time player can't miss the cue that audio
// has come online. If the player has sfx muted, it stays silent.
export function playWelcomeChime() {
  const ctx = _ctx;
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50];  // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    scheduleBell(ctx, freq, now + i * 0.08, 0.5, 0.28 * _appAudioGain);
  });
}

// Achievement unlock — bright single bell with long sustain. Plays when the
// finish screen's green "NEW ACHIEVEMENT" card appears.
export function playAchievementChime() {
  const ctx = _ctx;
  if (!ctx) return;
  const now = ctx.currentTime;
  scheduleBell(ctx, 1568.00, now, 0.7, 0.22 * _appAudioGain);          // G6
  scheduleBell(ctx, 2093.00, now + 0.06, 0.6, 0.14 * _appAudioGain);   // C7 — sparkle
}

// Level-up fanfare — rising 4-note arpeggio in C major, ~320ms total.
// Plays when the ★ LEVEL UP ★ callout pops.
export function playLevelUp() {
  const ctx = _ctx;
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50];  // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    scheduleBell(ctx, freq, now + i * 0.08, 0.5, 0.2 * _appAudioGain);
  });
}

// Save success — soft 2-note chime in a perfect fourth (C5 → F5). "Saved."
export function playSaveSuccess() {
  const ctx = _ctx;
  if (!ctx) return;
  const now = ctx.currentTime;
  scheduleBell(ctx, 523.25, now,        0.3, 0.16 * _appAudioGain);  // C5
  scheduleBell(ctx, 698.46, now + 0.08, 0.35, 0.16 * _appAudioGain); // F5
}

// New rank reveal — punchy single gold bell. Plays when the rank pill shows.
export function playRankReveal() {
  const ctx = _ctx;
  if (!ctx) return;
  scheduleBell(_ctx!, 1318.51, _ctx!.currentTime, 0.45, 0.2 * _appAudioGain);  // E6
}

// Modal open — rising whoosh, pitch sweep up.
export function playWhooshIn() {
  const ctx = _ctx;
  if (!ctx) return;
  scheduleSine(ctx, 200, ctx.currentTime, 0.16, 0.08 * _appAudioGain, 700);
}

// Modal close — falling whoosh, pitch sweep down.
export function playWhooshOut() {
  const ctx = _ctx;
  if (!ctx) return;
  scheduleSine(ctx, 700, ctx.currentTime, 0.16, 0.08 * _appAudioGain, 200);
}

// Coin / G$ claim — bright double bell at C7 and E7 (major third stack).
// Classic "cha-ching" feel.
export function playCoin() {
  const ctx = _ctx;
  if (!ctx) return;
  const now = ctx.currentTime;
  scheduleBell(ctx, 2093.00, now,        0.35, 0.2 * _appAudioGain);   // C7
  scheduleBell(ctx, 2637.02, now + 0.05, 0.4,  0.16 * _appAudioGain);  // E7
  scheduleBell(ctx, 3135.96, now + 0.12, 0.5,  0.14 * _appAudioGain);  // G7 sparkle
}

// Tab switch — subtle high tick, so quiet it's almost subliminal.
export function playTabSwitch() {
  const ctx = _ctx;
  if (!ctx) return;
  scheduleSine(ctx, 900, ctx.currentTime, 0.05, 0.06 * _appAudioGain, 1100);
}

// ═══ Ambient pad — menu background music ════════════════════════════════════
// Am - F - C - G classic cinematic loop. Each chord is 3 triangle-wave notes
// with a 2s fade in, 1.5s hold, 1.5s exponential release. New waves start
// every 4s so chords cross-fade with 1s overlap.

const AMBIENT_CHORDS: [number, number, number][] = [
  [110.00, 130.81, 164.81],  // Am  (A2, C3, E3)
  [87.31,  110.00, 130.81],  // F   (F2, A2, C3)
  [130.81, 164.81, 196.00],  // C   (C3, E3, G3)
  [98.00,  123.47, 146.83],  // G   (G2, B2, D3)
];
const WAVE_DURATION_SEC = 5;
const WAVE_INTERVAL_MS  = 4000;
// Per-note volume. Three notes layered + music gain (default 0.7) lands the
// chord around 0.13 — loud enough to clearly hear the pad on menu screens,
// quiet enough to duck under every game's own music when it takes over.
const PAD_NOTE_VOL      = 0.06;

function scheduleAmbientWave(ctx: AudioContext, chord: [number, number, number], when: number) {
  const v = PAD_NOTE_VOL * _appAudioGain;
  if (v <= 0) return;
  for (const freq of chord) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(v, when + 2);
    gain.gain.setValueAtTime(v, when + 3.5);
    gain.gain.exponentialRampToValueAtTime(0.001, when + WAVE_DURATION_SEC);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(when); osc.stop(when + WAVE_DURATION_SEC + 0.1);
  }
}

// Routes where ambient pauses so the game's own music can dominate.
function isGameplayRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/games/rhythm") || pathname.startsWith("/games/simon");
}

// ═══ Hook — wires the module-level ctx, installs global listener + loop ════

export function useAppAudio() {
  const loopIdRef   = useRef<number | null>(null);
  const chordIdxRef = useRef(0);

  // Live-sync the module-level gain values with user settings. Every play
  // fn reads these when it fires, so changes in profile take effect on the
  // next sound without any reload.
  const settings: AudioSettings & { update: (p: Partial<AudioSettings>) => void } = useAudioSettings();
  useEffect(() => {
    const g = effectiveGains(settings);
    _appAudioGain = g.appAudio;
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
      const chord = AMBIENT_CHORDS[chordIdxRef.current % AMBIENT_CHORDS.length];
      scheduleAmbientWave(ctx, chord, ctx.currentTime + 0.05);
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

  // Pause ambient when entering a game route, resume on exit.
  useEffect(() => {
    if (!_ctx) return;
    if (isGameplayRoute(pathname)) stopAmbientLoop();
    else startAmbientLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // First-gesture AudioContext unlock + global click blip on buttons.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      // Lazy AudioContext init + welcome chime on the very first user gesture
      const firstGesture = !_ctx;
      const ctx = ensureCtx();
      if (!ctx) return;
      if (firstGesture) {
        // Make sure the gain is populated BEFORE the first chime reads it —
        // the settings effect may not have run yet on a cold first tap.
        const g = effectiveGains(settings);
        _appAudioGain = g.appAudio;
        playWelcomeChime();
        if (!isGameplayRoute(pathnameRef.current)) startAmbientLoop();
      }

      // UI click blip — any <button> or [role="button"] that isn't opted out
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
