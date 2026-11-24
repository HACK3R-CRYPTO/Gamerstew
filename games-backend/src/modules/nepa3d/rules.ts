// UP NEPA 3D, Restore the Light: what the server can and cannot check.
//
// This game cannot be replayed. The player runs freely through a 3D street and
// the surges, raids and traffic are random on their device. So, unlike Word
// Ladder and Street Strike, the server does not work the score out from
// scratch. It does three things instead:
//
//   1. TIME is the server's. The run cannot be shorter than the time the server
//      itself saw pass since it issued the ticket, less a fixed allowance.
//   2. POSSIBLE: lighting the whole street needs a known distance covered at a
//      known top speed, plus the final hold. A faster finish is refused.
//   3. BOUNDED: skill points (perfect flips, chains, dodges, saves) are accepted
//      only up to what can be earned in the time played.
//
// The breakers and speed parts are then computed here from those checked
// numbers. A made-up run that stays inside every bound would still be accepted,
// so this game is PLAUSIBILITY-CHECKED, not verified. Do not put prize money on
// it until that changes.

export const POINTS = 10;
export const PAR_TIME = 45;
export const MAX_TIME = 120;
export const SCORE_MAX = { breakers: 400, speed: 350 } as const;

// The ten breakers zig-zag down both sides of an 84 m street: about 112 m of
// travel. The fastest thing in the game is the keke at 8.5 m/s, then six seconds
// holding the finale and about half a second on each breaker's timing check.
export const MIN_WIN_SECONDS = 24;
// From ticket to the clock starting (scene load, the countdown) plus sending the
// result. A claimed time may be this much shorter than the server's own count.
export const START_ALLOWANCE_S = 20;
// Skill a player can earn. The richest sources are a full dodge streak (54) and a
// full chain (48) and neither can happen more than about once a second; the
// finale and all-perfect bonuses are one-off.
export const SKILL_PER_SECOND = 60;
export const SKILL_ONE_OFF = 400;

export interface RestoreProof { won: boolean; restored: number; timeTaken: number | null; skill: number }
export interface ScoreParts { breakers: number; speed: number; skill: number; total: number }
export type Verdict = { ok: true; total: number; parts: ScoreParts; seconds: number | null } | { ok: false; error: string };

export function parts(restored: number, timeTaken: number | null, skillPts: number): ScoreParts {
  const breakers = Math.round((restored / POINTS) * SCORE_MAX.breakers);
  if (timeTaken == null || restored < POINTS) return { breakers, speed: 0, skill: 0, total: breakers };
  const speed = Math.round(Math.max(0, Math.min(1, 1 - (timeTaken - PAR_TIME) / (MAX_TIME - PAR_TIME))) * SCORE_MAX.speed);
  const skill = Math.round(Math.max(0, skillPts));
  return { breakers, speed, skill, total: breakers + speed + skill };
}

export function verifyRestore(raw: unknown, elapsedMs: number): Verdict {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'No run sent' };
  const p = raw as Partial<RestoreProof>;
  if (typeof p.won !== 'boolean') return { ok: false, error: 'Bad run' };
  if (!Number.isInteger(p.restored) || (p.restored as number) < 0 || (p.restored as number) > POINTS) return { ok: false, error: 'Bad breaker count' };
  const restored = p.restored as number;
  const serverSeconds = elapsedMs / 1000;

  if (!p.won) {
    // an unfinished run scores its breakers only; each one still takes time to reach
    if (restored >= POINTS) return { ok: false, error: 'Every breaker lit is a win' };
    if (serverSeconds < restored * 1.5) return { ok: false, error: 'Too many breakers for the time played' };
    return { ok: true, total: parts(restored, null, 0).total, parts: parts(restored, null, 0), seconds: null };
  }

  if (restored !== POINTS) return { ok: false, error: 'A win needs every breaker lit' };
  if (typeof p.timeTaken !== 'number' || !Number.isFinite(p.timeTaken) || p.timeTaken <= 0) return { ok: false, error: 'Bad time' };
  if (p.timeTaken > serverSeconds + 2) return { ok: false, error: 'Run is longer than the session' };
  // the server's clock wins: a claimed time cannot undercut what really passed
  const seconds = Math.max(p.timeTaken, serverSeconds - START_ALLOWANCE_S);
  if (seconds < MIN_WIN_SECONDS) return { ok: false, error: 'Faster than the street can be crossed' };
  if (typeof p.skill !== 'number' || !Number.isFinite(p.skill) || p.skill < 0) return { ok: false, error: 'Bad skill points' };
  const skill = Math.min(Math.round(p.skill), Math.round(SKILL_ONE_OFF + SKILL_PER_SECOND * seconds));
  const out = parts(POINTS, seconds, skill);
  return { ok: true, total: out.total, parts: out, seconds };
}
