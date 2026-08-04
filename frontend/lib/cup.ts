// ─── Arena Cup · event window (single source of truth for countdowns) ─────────
// MUST match games-backend CUP config (server.js). Fri Aug 7 17:00 WAT (UTC+1)
// = 16:00 UTC, running 14 days to Fri Aug 21 16:00 UTC.

export const CUP_START = "2026-08-07T16:00:00Z";
export const CUP_END   = "2026-08-21T16:00:00Z";
export const CUP_STARTS_MS = Date.parse(CUP_START);
export const CUP_ENDS_MS   = Date.parse(CUP_END);

export type CupPhase = "upcoming" | "live" | "ended";

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
