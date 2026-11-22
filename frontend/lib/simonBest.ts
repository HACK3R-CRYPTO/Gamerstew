// Simon Memory personal best, kept on the device. Display only: it never
// touches scoring, the seeded pattern or what is sent to the server.

export interface SimonBest {
  rounds: number; // deepest round cleared
  score: number;
}

const KEY = "simon_best_v1";

export function readSimonBest(): SimonBest | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as SimonBest;
    return typeof b?.rounds === "number" ? b : null;
  } catch {
    return null;
  }
}

export function saveSimonBest(b: SimonBest) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* private mode or storage full: the run still counts on screen */
  }
}

// The named rounds the game already celebrates. Used to show how far the next one is.
export const SIMON_MILESTONES: [number, string][] = [[5, "5TH COLOR"], [10, "DOUBLE DIGITS"], [15, "ELITE"], [25, "MASTER"], [50, "LEGENDARY"]];
export function nextSimonMilestone(cleared: number): { at: number; name: string } | null {
  const m = SIMON_MILESTONES.find(([at]) => at > cleared);
  return m ? { at: m[0], name: m[1] } : null;
}
