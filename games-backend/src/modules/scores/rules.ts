// ─── Score rules, as pure functions ──────────────────────────────────────────
// The decisions the signing path makes that need no database and no chain:
// is this session usable, is this number a plausible score, how many ladder
// points is a run worth. Kept apart so each can be tested exhaustively, and so
// the numbers players are judged by live in exactly one place.

export const SESSION_MAX_MS = 11 * 60 * 1000; // Simon hard-stops a run at 10 min; 11 leaves a minute for the submit to land
export const SESSION_MIN_MS = 5_000; // the replay is the real gate; this only stops instant submits
export const SEASON_MIN_DURATION_MS = 8_000;
export const MAX_SEASON_PTS_PER_GAME = 15;
export const MAX_CLIENT_SCORE = 1_000_000;
export const NEPA_MAX_INPUTS = 1_000;

export interface SessionRow {
  token: string;
  wallet: string;
  game: string;
  used?: boolean | null;
  started_at: string;
  seed?: string | null;
}

export type SessionVerdict = { ok: true; elapsedMs: number } | { ok: false; error: string };

/** Is this session ticket valid for this player, this game, right now? */
export function checkSession(session: SessionRow | null | undefined, playerAddress: string, game: string, nowMs: number): SessionVerdict {
  if (!session) return { ok: false, error: 'Invalid session token' };
  if (session.used) return { ok: false, error: 'Session already used' };
  if (String(session.wallet).toLowerCase() !== playerAddress.toLowerCase()) return { ok: false, error: 'Session wallet mismatch' };
  if (session.game !== game) return { ok: false, error: 'Session game mismatch' };
  const elapsedMs = nowMs - new Date(session.started_at).getTime();
  if (elapsedMs > SESSION_MAX_MS) return { ok: false, error: 'Session expired' };
  if (elapsedMs < SESSION_MIN_MS) return { ok: false, error: 'Session too short' };
  // A start time that cannot be read gives NaN, which passes both comparisons
  // above. Such a session has no provable length, so it is not usable.
  if (!Number.isFinite(elapsedMs)) return { ok: false, error: 'Invalid session token' };
  return { ok: true, elapsedMs };
}

/** A whole number from 0 to the ceiling. A sanity bound, not a security check:
 *  it cannot tell a cheat from a great run, which is why replay exists. */
export function isClientScore(score: unknown): score is number {
  return typeof score === 'number' && Number.isFinite(score) && Number.isInteger(score) && score >= 0 && score <= MAX_CLIENT_SCORE;
}

// Score normalisation keeps the combined season ladder balanced across games
// with very different scales, so a strong run in any game lands in a comparable
// band:  rhythm 30k–400k+ → /100 · stack 30–300+ blocks → /5 · simon and nepa → /20
// ladder: a round tops out at 1,000, so /67 puts a perfect round just under the cap
const SEASON_DIVISOR: Record<string, number> = { rhythm: 100, stack: 5, nepa: 20, ladder: 67, strike: 10, nepa3d: 70 }; // strike: a perfect game is 150
const DEFAULT_DIVISOR = 20;

/** Solo Ladder points for one run. A run with no real play scores about zero
 *  and earns zero, so "open, lose, claim" is not a farm. */
export function seasonPoints(game: string, score: number, elapsedMs: number): number {
  if (!(elapsedMs >= SEASON_MIN_DURATION_MS)) return 0;
  const pts = Math.floor(score / (SEASON_DIVISOR[game] ?? DEFAULT_DIVISOR));
  if (!Number.isFinite(pts)) return 0;
  return Math.max(0, Math.min(MAX_SEASON_PTS_PER_GAME, pts));
}
