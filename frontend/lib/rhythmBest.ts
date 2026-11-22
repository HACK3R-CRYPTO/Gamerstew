// Rhythm Rush personal best, kept on the device.
//
// Besides the best score it stores the PACE of that run: the score reached at
// each second of the song. During the next run the game compares the live score
// with that pace, so the player races their own best the whole way through
// ("+15 ahead" / "-20 behind") instead of only finding out at the end.
//
// Purely local and display-only. It never touches scoring, the note chart or
// what is sent to the server.

export interface RhythmBest {
  score: number;
  accuracy: number; // 0..1, main track
  pace: number[]; // score at each whole second of the main track
}

const KEY = "rhythm_best_v1";

export function readRhythmBest(): RhythmBest | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as RhythmBest;
    return typeof b?.score === "number" && Array.isArray(b.pace) ? b : null;
  } catch {
    return null;
  }
}

export function saveRhythmBest(b: RhythmBest) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* private mode or storage full: the run still counts on screen */
  }
}

/** Fill gaps so every second has a value (a second with no sample keeps the last score). */
export function fillPace(pace: number[], seconds: number): number[] {
  const out: number[] = [];
  let last = 0;
  for (let i = 0; i <= seconds; i++) {
    if (typeof pace[i] === "number") last = pace[i];
    out.push(last);
  }
  return out;
}

// Grade thresholds, lowest first. Mirrors gradeFor() in the game.
const GRADES: [string, number][] = [["C", 0.5], ["B", 0.7], ["A", 0.85], ["S", 0.95]];

/** How many more PERFECT hits the next grade up was away. null at the top grade. */
export function nextGradeGap(perfects: number, goods: number, noteCount: number): { letter: string; need: number } | null {
  const pts = perfects + goods * 0.5;
  for (const [letter, thr] of GRADES) {
    const need = Math.ceil(thr * noteCount - pts);
    if (need > 0) return { letter, need };
  }
  return null;
}
