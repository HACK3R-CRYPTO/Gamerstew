"use client";

// ─── Restore the Light — mode state ──────────────────────────────────────────
// The whole street is in blackout. You are the one who brings NEPA back: run to
// each power point (breaker box on a pole) and switch it on. Every one you flip
// lights up a slice of the neighbourhood — the global light level rises with the
// fraction you have restored, so the dark city comes alive behind you as you run.
// It is a SPEEDRUN: a visible clock counts UP and your TIME is your score (faster
// = higher, so the leaderboard ranks fastest). The run ends ONLY when the whole
// street is lit — there is no fail-clock; a stuck player bails with the "← Modes"
// button. Each breaker is a timing skill-check, and they get harder (faster sweep,
// smaller green) the more you have lit.
//
// HOT per-frame state (activated/flash) lives here and is read in useFrame; the
// HUD numbers live in the zustand store, pushed a few times a second.

import { create } from "zustand";

export const BLACKOUT_LEVEL = 0.05; // residual moonlight before you restore anything
export const ACTIVATE_RADIUS = 2.3; // how close you must get to flip a point
export const PAR_TIME = 45; // finish at/under this = full speed bonus
export const MAX_TIME = 120; // speed bonus fades to 0 by this finish time (scoring only)

// ── NEPA surges ──────────────────────────────────────────────────────────────
// Once you have lit enough of the street, NEPA starts fighting back: every so
// often a breaker you already flipped TRIPS back off (after a voltage-dip
// warning), the street partly re-darkens, and you must re-flip it. The win
// becomes holding ALL points lit at once — the real "light don come, light don
// go" struggle. Surges come faster the more you have restored.
export const SURGE_START_FRAC = 0.4; // NEPA starts tripping once this fraction is lit
export const SURGE_WARN = 1.8; // seconds of flickering voltage-dip warning before a trip

// You start with this many lives. Spent by: a car hit, standing in the road,
// being caught on a tripping breaker, a total grid blackout, OR the
// VIP breaker tripping. Bumped 2→3 to stay fair against the extra stakes below.
export const LIVES_START = 3;

// ── TIME PRESSURE: the night gets HARDER the longer you take ──────────────────
// Difficulty used to scale only with how much you'd restored. Now the CLOCK bites
// too: intensity ramps 0→1 over INTENSITY_RAMP seconds and feeds decay speed, the
// brownout fill rate and raid frequency. So dawdling is genuinely dangerous — not
// just a smaller speed bonus — which gives the speedrun real teeth. Early game is
// calm (nothing decays below DECAY_START_FRAC); late game is a scramble.
export const INTENSITY_RAMP = 80; // seconds of play to reach full pressure
export function intensity(elapsed: number): number {
  return Math.max(0, Math.min(1, elapsed / INTENSITY_RAMP));
}

// ── VIP breaker: the hospital 🏥 ──────────────────────────────────────────────
// One breaker powers the clinic — it MUST stay lit. If it ever TRIPS you lose a
// life on the spot (not just a re-flip), with a loud alarm. It forces the hardest
// triage choice in the game: sprint to save the hospital, or save two others?
// (Disabled during the MEGA-SURGE finale, which has its own rules.)
export const VIP_INDEX = 5; // index into POWER_POINTS — a central one, [4.3, 2]

// ── NEPA RAIDS: scripted drama spikes ─────────────────────────────────────────
// Every so often NEPA "raids" the area and a CLUSTER of lit breakers trips into
// warning at once, with a loud callout. Raids only start once half the street is
// lit, come sooner + bigger as the night drags on (intensity), and are suppressed
// during the finale. A real set-piece that punctuates the triage grind.
export const RAID_MIN_FRAC = 0.5;
export function nextRaidDelay(inten: number): number {
  return 24 - inten * 13 + Math.random() * 6; // ~24s early → ~11s late
}
export function raidSize(inten: number): number {
  return 2 + Math.round(inten * 2); // 2 → 4 breakers at once
}

// ── Near-miss dodging ─────────────────────────────────────────────────────────
// Slip past a speeding car (just outside its hit box) and you bank a DODGE.
// Consecutive dodges without getting hit stack a streak that pays more, so the
// traffic stops being a thing you only avoid and becomes a thing you WANT to
// thread for score. A car hit (or any life lost) resets the streak.
export const DODGE_BASE = 9; // score per dodge, before the streak multiplier
export const DODGE_STREAK_CAP = 6; // streak multiplier maxes here

// ── Flip chain ────────────────────────────────────────────────────────────────
// Flip breakers back-to-back (each within CHAIN_WINDOW seconds of the last) and a
// CHAIN multiplier climbs, paying a growing bonus. Dawdle and it resets. This
// rewards fast, efficient routing moment-to-moment, not just at the finish clock.
export const CHAIN_WINDOW = 3.5; // seconds you have to keep the chain alive
export const CHAIN_BASE = 6; // score per chained flip, before the chain multiplier
export const CHAIN_CAP = 8; // chain multiplier maxes here

// Seconds to the next surge, given the fraction currently lit (~15s → ~10s as
// you near a full restore), plus a little randomness so it's not metronomic.
// Deliberately not faster than a player can re-flip — the challenge is holding
// the street, not an impossible treadmill. The director also stops surging once
// you're one breaker from done, so the final flip is always a clean grab.
export function nextSurgeDelay(frac: number): number {
  const t = Math.max(0, Math.min(1, (frac - SURGE_START_FRAC) / (1 - SURGE_START_FRAC)));
  return 15 - t * 5 + Math.random() * 2;
}

// Power points down both sidewalks (x just off the curb, varied z), clear of the
// parked cars/danfo. ~10 points → a satisfying "light it all" sweep.
export const POWER_POINTS: [number, number][] = [
  [-4.3, -44],
  [4.3, -36],
  [-4.3, -26],
  [4.3, -16],
  [-4.3, -8],
  [4.3, 2],
  [-4.3, 10],
  [4.3, 20],
  [-4.3, 30],
  [4.3, 40],
];

export interface PointHot {
  on: boolean;
  flash: number;
  /** >0 = this already-lit breaker is in WARNING, counting down to a trip. You can
   *  run back and re-tap it to STABILISE (save) it before it hits 0. 0 = stable. */
  warnT: number;
  /** Seconds until this lit, stable breaker next destabilises into a warning. Set
   *  when it's first flipped on (and on every save), re-rolled via nextDecayDelay. */
  decayCd: number;
  /** True once this breaker has TRIPPED back to dark after being lit (vs one you
   *  simply haven't reached yet). Only tripped + warning breakers feed the brownout
   *  meter — never-lit breakers must not, or normal progress would force blackouts. */
  lost: boolean;
}
export const pointState: PointHot[] = POWER_POINTS.map(() => ({ on: false, flash: 0, warnT: 0, decayCd: 0, lost: false }));

export function resetPointState() {
  for (const p of pointState) {
    p.on = false;
    p.flash = 0;
    p.warnT = 0;
    p.decayCd = 0;
    p.lost = false;
  }
}

// ── TRIAGE: hold the neighbourhood together ──────────────────────────────────
// Once you've lit enough of the street, breakers you already flipped start to
// DESTABILISE one by one — each gives a visible WARNING (amber pulse + rising
// tone), then a CRITICAL last second (red fast-flash + alarm), then TRIPS back to
// dark if you don't run back and re-tap it in time. Multiple can be dying at once,
// so every second is a choice: push forward to light a new breaker, or sprint back
// to save the ones about to go. Decay comes sooner the more you've lit, but the
// rate PLATEAUS so the street stays holdable, not an impossible treadmill.
export const DECAY_START_FRAC = 0.35; // triage pressure begins once this fraction is lit
export const WARN_TIME = 2.6; // seconds a breaker flickers in warning before it trips
export const CRITICAL_TIME = 1.0; // the last seconds of a warning = critical (alarm)
export const CLUTCH_WINDOW = 0.9; // saving with ≤ this much time left pays a CLUTCH bonus
export const CLUTCH_BONUS = 14;
export const SAVE_BONUS = 5; // a normal stabilise (keeps defence rewarding)

// Seconds until a freshly-lit breaker next destabilises, given the fraction lit
// AND the time-pressure (inten). ~9s early → ~5s by coverage, minus up to ~3.5s
// more as the night drags on, floored at 2.6s so it's always humanly savable.
export function nextDecayDelay(frac: number, inten = 0): number {
  const t = Math.max(0, Math.min(1, (frac - DECAY_START_FRAC) / (1 - DECAY_START_FRAC)));
  return Math.max(2.6, 9 - t * 4 - inten * 3.5 + Math.random() * 3);
}

// ── BROWNOUT meter: the whole-grid pressure gauge ────────────────────────────
// Rises while breakers sit dark/unstable (faster the more of them there are),
// drains when the street is whole. Fill it and the grid collapses into a TOTAL
// BLACKOUT: you lose a life, every warning clears, and a short LULL lets you
// recover — the "surge then breather" wave that keeps triage from grinding.
export const BROWNOUT_PER_UNIT = 0.085; // fill/sec per dark-or-warning breaker
export const BROWNOUT_DRAIN = 0.14; // drain/sec when the street is stable
export const BROWNOUT_LULL = 4.0; // seconds of calm (no new decay) after a blackout
export const BROWNOUT_TRIP_JOLT = 0.13; // instant meter SPIKE every time a breaker trips —
// so each trip visibly shoves the grid toward collapse (failing your core job bites)

// ── MEGA-SURGE finale ─────────────────────────────────────────────────────────
// Lighting the LAST breaker no longer wins on the spot — it triggers NEPA's final
// assault. For MEGASURGE_HOLD seconds the whole grid fights to collapse: breakers
// trip fast and in bunches (brownout is disarmed so the pressure is the TRIPS
// themselves, not a second meter), and you must keep EVERY one lit. The hold timer
// only advances while the street is 100% lit, so a trip pauses — not resets — your
// progress until you sprint it back up. Hold the full street for the duration and
// the night is yours, with a MEGASURGE_BONUS for surviving the onslaught. This is
// the mode's climax: the "light don come, light don go" fight at its loudest.
export const MEGASURGE_HOLD = 6; // seconds of a fully-lit street you must hold to win
export const MEGASURGE_BONUS = 120; // survival reward folded into the win score
export const MEGA_MAX_WARN = 2; // cap on breakers dying at once in the finale. Sim-tuned:
// at 2, any player who actively saves wins (even ~1.1s reactions) while an idle one
// always fails; at 3 there's an unfair cliff. The real client adds run-distance +
// traffic the sim ignores, so 2 reads as tense-but-fair, not rigged.
/** Decay re-roll during the finale — fast + staggered so trips keep coming. */
export function megaDecayDelay(): number {
  return 0.8 + Math.random() * 1.8;
}

// ── Timing skill-check (the "throw the switch" mini-game) ────────────────────
// When you stand on an unlit breaker a meter runs: a marker sweeps 0→1→0 and you
// must tap while it's inside the green sweet-spot. Centre hit = PERFECT. A miss
// sparks and briefly locks you out, so you line up the next swing. Hot state read
// in useFrame by the director + the meter mesh — never React.
export interface TimingState {
  activeIdx: number | null; // the breaker you're lined up on, or null
  needle: number; // 0..1 marker position
  dir: number; // +1 / -1
  speed: number; // sweeps per second-ish
  sweetC: number; // sweet-spot centre 0..1
  sweetW: number; // sweet-spot half-width
  lock: number; // seconds locked out after a miss
  result: number; // >0 just after a hit: 2 = perfect, 1 = ok, decays for HUD flash
  miss: number; // >0 just after a miss, decays for the spark flash
}
export const timing: TimingState = {
  activeIdx: null,
  needle: 0,
  dir: 1,
  speed: 1.15,
  sweetC: 0.5,
  sweetW: 0.16,
  lock: 0,
  result: 0,
  miss: 0,
};

// The tap is tuned in MILLISECONDS, not meter units, because that is what a thumb
// on a phone experiences. The green zone is open ~360 ms on the first breakers and
// narrows to a ~170 ms floor at the end of the run (touch games need far more room
// than a mouse: Android touch + display latency alone eats 30-50 ms, and at 30 fps
// a frame is 33 ms). The sweep speeds up with progress, so the zone's WIDTH on the
// meter is derived from the target window and the speed.
export const TAP_WINDOW_START = 0.36; // seconds the green is open at 0% lit
export const TAP_WINDOW_END = 0.17; // …and at 100% lit (never tighter than this)
// Late-tap forgiveness: a tap this many seconds AFTER the marker left the green
// still counts (the player saw it in the green; the phone delivered it late).
export const TAP_GRACE = 0.05;
export function armTiming(idx: number, frac: number) {
  const f = Math.max(0, Math.min(1, frac));
  timing.activeIdx = idx;
  timing.needle = 0;
  timing.dir = 1;
  timing.speed = 0.95 + f * 0.85 + Math.random() * 0.2;
  const windowS = TAP_WINDOW_START + (TAP_WINDOW_END - TAP_WINDOW_START) * f;
  timing.sweetW = (windowS * timing.speed) / 2; // half-width on the 0..1 meter
  timing.sweetC = 0.28 + Math.random() * 0.44;
  timing.lock = 0;
}

export function resetTiming() {
  timing.activeIdx = null;
  timing.lock = 0;
  timing.result = 0;
  timing.miss = 0;
}

export type RestoreMode = "idle" | "playing" | "won" | "over";

export interface RestoreSummary {
  restored: number; // points lit
  total: number;
  timeTaken: number | null; // seconds, if you finished
  won: boolean;
  score: number;
  parts?: ScoreParts; // where the score came from, shown on the result sheet
}

interface RestoreStore {
  mode: RestoreMode;
  elapsed: number; // seconds since you started — counts UP (your run time)
  restored: number;
  total: number;
  lives: number; // hearts left; a car hit costs one, 0 = game over
  pStreak: number; // consecutive PERFECT flips (depth: chase an all-perfect run)
  dodges: number; // total near-misses this run (feel + a stat on the result)
  dodgeStreak: number; // current consecutive dodge streak (resets on a life lost)
  dodgeBonus: number; // accumulated dodge score, folded into the win score
  chain: number; // current flip-chain count (fast consecutive flips); for the HUD
  brownout: number; // 0..1 grid-pressure meter; fills while breakers sit dark, 1 = blackout
  saves: number; // breakers rescued from a warning before they tripped (stat)
  megaActive: boolean; // the MEGA-SURGE finale is running (all lit once, now hold it)
  mega: number; // 0..1 progress of the final hold (seconds held / MEGASURGE_HOLD)
  intensity: number; // 0..1 time-pressure (drives decay speed / raids) — for the HUD
  vipLit: boolean; // is the hospital breaker currently lit (false = tripped/not-yet-lit)
  vipWarn: boolean; // is the hospital breaker in danger right now (warning) — HUD alarm
  raidKey: number; // bumps on each NEPA raid so the HUD can flash a set-piece banner
  nearIdx: number | null; // nearest in-range unlit/warning point (for the prompt)
  nearWarn: boolean; // is that nearest target a warning breaker (save) vs an unlit one (flip)?
  summary: RestoreSummary | null;
  start: () => void;
  finish: (summary: RestoreSummary) => void;
  loseLife: () => void;
  addDodge: () => void; // Traffic calls this when you slip past a speeding car
  reset: () => void;
  setLive: (v: Partial<RestoreStore>) => void;
}

export const useRestoreStore = create<RestoreStore>((set) => ({
  mode: "idle",
  elapsed: 0,
  restored: 0,
  total: POWER_POINTS.length,
  lives: LIVES_START,
  pStreak: 0,
  dodges: 0,
  dodgeStreak: 0,
  dodgeBonus: 0,
  chain: 0,
  brownout: 0,
  saves: 0,
  megaActive: false,
  mega: 0,
  intensity: 0,
  vipLit: false,
  vipWarn: false,
  raidKey: 0,
  nearIdx: null,
  nearWarn: false,
  summary: null,
  start: () => {
    resetPointState();
    set({ mode: "playing", elapsed: 0, restored: 0, total: POWER_POINTS.length, lives: LIVES_START, pStreak: 0, dodges: 0, dodgeStreak: 0, dodgeBonus: 0, chain: 0, brownout: 0, saves: 0, megaActive: false, mega: 0, intensity: 0, vipLit: false, vipWarn: false, raidKey: 0, nearIdx: null, nearWarn: false, summary: null });
  },
  finish: (summary) => set({ mode: summary.won ? "won" : "over", summary, nearIdx: null }),
  // A car clipped you — lose a heart (never below 0) AND drop your dodge streak
  // (you were in the flow, now you're on the floor). The director watches lives
  // and ends the run at 0, so game-over is decided in one place.
  loseLife: () => set((s) => ({ lives: Math.max(0, s.lives - 1), dodgeStreak: 0 })),
  // A near-miss: bank a dodge, grow the streak, and pay a streak-scaled bonus.
  addDodge: () =>
    set((s) => {
      const streak = s.dodgeStreak + 1;
      return { dodges: s.dodges + 1, dodgeStreak: streak, dodgeBonus: s.dodgeBonus + DODGE_BASE * Math.min(streak, DODGE_STREAK_CAP) };
    }),
  reset: () => set({ mode: "idle", restored: 0, elapsed: 0, lives: LIVES_START, dodges: 0, dodgeStreak: 0, dodgeBonus: 0, chain: 0, brownout: 0, saves: 0, megaActive: false, mega: 0, intensity: 0, vipLit: false, vipWarn: false, raidKey: 0, nearIdx: null, nearWarn: false, summary: null }),
  setLive: (v) => set(v),
}));

// ── Score: small numbers, in three parts a player can read, with no ceiling ──
// The old score ran to a million (a failed run showed "280,000 pts"), which is
// a number nobody can judge. The scale is now a thousand times smaller:
//   BREAKERS  40 for each breaker lit (400 for the whole street)
//   SPEED     up to 350: full marks at or under PAR_TIME, fading to 0 by MAX_TIME
//   SKILL     perfect flips, chains, dodges, saves, the finale. NOT capped: a
//             better run always scores more, so there is no maximum high score
// A run that does not finish scores its breakers only.
export const SCORE_MAX = { breakers: 400, speed: 350 } as const;
export interface ScoreParts { breakers: number; speed: number; skill: number; total: number }
export function restoreParts(restored: number, total: number, timeTaken: number | null, skillPts: number): ScoreParts {
  const coverage = total > 0 ? restored / total : 0;
  const breakers = Math.round(coverage * SCORE_MAX.breakers);
  if (timeTaken == null || restored < total) return { breakers, speed: 0, skill: 0, total: breakers };
  const span = Math.max(1, MAX_TIME - PAR_TIME);
  const speed = Math.round(Math.max(0, Math.min(1, 1 - (timeTaken - PAR_TIME) / span)) * SCORE_MAX.speed);
  const skill = Math.round(Math.max(0, skillPts)); // no ceiling
  return { breakers, speed, skill, total: breakers + speed + skill };
}
export function restoreScore(restored: number, total: number, timeTaken: number | null, skillPts: number): number {
  return restoreParts(restored, total, timeTaken, skillPts).total;
}

// Dev-only: expose the store + the hot timing/point state so the headless harness
// can start a run and read the live needle + per-breaker warn state for QA.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __restoreStore?: typeof useRestoreStore }).__restoreStore = useRestoreStore;
  (window as unknown as { __restoreTiming?: typeof timing }).__restoreTiming = timing;
  (window as unknown as { __pointState?: typeof pointState }).__pointState = pointState;
}
