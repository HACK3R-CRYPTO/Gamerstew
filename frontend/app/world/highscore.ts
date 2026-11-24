// ─── High scores ─────────────────────────────────────────────────────────────
// One place that keeps each mode's best score on this device. `record` is
// called once when a run ends: it compares the run to the stored best, saves it
// if it is higher, and returns what the result screen needs to say.
//
// Kept on the device for now (localStorage). When a mode gets an on-chain or
// server leaderboard, this is the one function to extend.

export interface High {
  best: number; // the high score after this run
  prev: number | null; // what it was before this run (null = first ever run)
  isNew: boolean; // this run set a new high score
}

const KEY = (mode: string) => `upnepa_high_${mode}`;

export function readHigh(mode: string): number | null {
  try {
    const raw = localStorage.getItem(KEY(mode));
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function recordHigh(mode: string, score: number): High {
  const prev = readHigh(mode);
  const isNew = score > 0 && (prev == null || score > prev);
  if (isNew) {
    try {
      localStorage.setItem(KEY(mode), String(score));
    } catch {
      /* private mode or storage full: the run still counts on screen */
    }
  }
  return { best: isNew ? score : prev ?? score, prev, isNew };
}
