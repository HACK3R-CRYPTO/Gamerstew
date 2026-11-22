// ─── Skill-matched start ─────────────────────────────────────────────────────
// A player who has already proved they can handle the fast part of a game
// should not have to crawl through the slow part every single run. This keeps
// a short history of how each of the last few runs went, per game, on the
// device, and each game turns that into where the NEXT run starts.
//
// It moves both ways, the way adaptive puzzle games do it: a few strong runs
// and you start faster; a few rough ones and it eases you back down. A new
// player has no history and always starts from the gentle beginning.
//
// Device only. It changes pacing, never the scoring rules.

const KEY = (game: string) => `skill_recent_${game}_v1`;
const KEEP = 5;

export function recentRuns(game: string): number[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY(game)) || "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "number").slice(-KEEP) : [];
  } catch {
    return [];
  }
}

export function recordRun(game: string, value: number) {
  try {
    const next = [...recentRuns(game), value].slice(-KEEP);
    localStorage.setItem(KEY(game), JSON.stringify(next));
  } catch {
    /* private mode: the next run simply starts from the beginning */
  }
}

/** Average of the recent runs, or null with fewer than two runs (not enough to judge). */
export function recentAverage(game: string): number | null {
  const r = recentRuns(game);
  if (r.length < 2) return null;
  return r.reduce((a, c) => a + c, 0) / r.length;
}
