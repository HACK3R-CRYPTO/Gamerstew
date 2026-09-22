// ─── Arena Cup · event window (single source of truth for countdowns) ─────────
// MUST match games-backend CUP config (server.js). Fri Aug 7 17:00 WAT (UTC+1)
// = 16:00 UTC, running 14 days to Fri Aug 21 16:00 UTC.

export const CUP_START = "2026-08-07T16:00:00Z";
export const CUP_END   = "2026-08-21T16:00:00Z";
export const CUP_STARTS_MS = Date.parse(CUP_START);
export const CUP_ENDS_MS   = Date.parse(CUP_END);

export type CupPhase = "upcoming" | "live" | "ended";

// How long a finished cup stays on screen. Long enough that players can find
// the result, short enough that the app doesn't advertise a dead event — the
// Season 1 Cup ended 2026-08-21 and its banner was still on the dashboard a
// month later, which makes a live product look abandoned.
export const CUP_ENDED_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** True once a finished cup should stop being shown at all. Single source of
 *  truth so the countdown and the cards that wrap it can never disagree —
 *  hiding only the countdown leaves a headless "ARENA CUP · $150" card behind,
 *  which is worse than leaving it alone. */
export function cupIsStale(now: number): boolean {
  return cupPhase(now) === "ended" && now - CUP_ENDS_MS > CUP_ENDED_GRACE_MS;
}

// Evaluated once, when the module is first imported. Staleness flips exactly
// once — at a fixed timestamp three days after CUP_ENDS_MS — and that moment is
// already long past, so the answer cannot change inside a session. Capturing
// the clock here keeps the call sites PURE, which is what React 19's compiler
// requires of anything read during render, without needing state, an effect or
// a live interval on the busiest screen in the app.
const MODULE_LOADED_AT = Date.now();

/** Pure, render-safe form of cupIsStale — same answer every call. */
export function cupIsStaleNow(): boolean {
  return cupIsStale(MODULE_LOADED_AT);
}

export function cupPhase(now: number): CupPhase {
  if (now < CUP_STARTS_MS) return "upcoming";
  if (now >= CUP_ENDS_MS) return "ended";
  return "live";
}

// "2d 04h 11m" while far out, "4h 09m 33s" under an hour — always reads as urgent
// the closer it gets. Returns "" at/after zero.
export function fmtCupCountdown(ms: number): string {
  if (ms <= 0) return "";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const p = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${p(h)}h ${p(m)}m`;
  if (h > 0) return `${h}h ${p(m)}m ${p(s)}s`;
  return `${m}m ${p(s)}s`;
}
