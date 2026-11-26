// Word Ladder: the rules, with no I/O. The server deals the ladders and replays
// the player's words, so a score is something the server worked out, not a
// number the phone sent.
//
// What this proves: every word is real, each step changes exactly one letter,
// the route runs from the dealt start to the dealt target, and the time claimed
// fits inside the time the server saw. What it cannot prove: that a person
// found the route. A program can solve any ladder instantly, so `looksHuman`
// flags runs that are too fast to have been typed, and prizes should still be
// limited to verified players, as with the other games.

import { PUZZLES, VALID } from './data';

export const ROUND = 5;
export const PARS = [2, 3, 3, 4, 4];

// The Climb: a ranked round has no ceiling. The clock runs for three minutes and
// the ladders keep coming, harder as they go; the score is every ladder solved in
// that time. Sixty are dealt, one every three seconds, which nobody can type, so
// the deal never runs out for a person and a program gains nothing past it.
// No hints in the Climb: a hint there would be a way to buy points with taps.
export const CLIMB_MS = 180_000;
export const CLIMB_DEALT = 60;
const CLIMB_PARS = [2, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]; // then 6 from the twelfth ladder on
export const parAt = (i: number): number => CLIMB_PARS[i] ?? 6;
export const MAX_STEPS = 40; // per ladder; far above any honest route
export const MIN_MS_PER_STEP = 350; // a tap on a tile plus a tap on a key

export type Puzzle = [start: string, target: string, par: number];
export interface LadderRun { words: string[]; ms: number; hints: number; skipped?: boolean }
export interface LadderScore { points: number; steps: number; solved: boolean }
export type Verdict = { ok: true; total: number; ladders: LadderScore[]; human: boolean; reasons: string[] } | { ok: false; error: string };

const WORDS = new Set(VALID.split(' '));
export const isWord = (w: string): boolean => WORDS.has(w);

// Mulberry32 over a string seed: the same seed always deals the same five.
function seeded(seed: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) { a ^= seed.charCodeAt(i); a = Math.imul(a, 16777619); }
  a >>>= 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The five ladders for a seed. The seed is the server's session token (a
 *  personal round) or the date (the daily), never something the player picks. */
export function deal(seed: string, count: number = ROUND): Puzzle[] {
  const r = seeded(seed); const used = new Set<string>(); const out: Puzzle[] = [];
  // dealt one after another from one stream, so the first five of a long deal are the five of a short one
  for (let i = 0; i < count; i++) {
    const par = parAt(i);
    let pool = (PUZZLES as Puzzle[]).filter((p) => p[2] === par && !used.has(p[0]) && !used.has(p[1]));
    if (!pool.length) pool = (PUZZLES as Puzzle[]).filter((p) => p[2] === par); // every fresh one is used: go round again
    const p = pool[Math.floor(r() * pool.length)]!;
    used.add(p[0]); used.add(p[1]);
    out.push(p);
  }
  return out;
}

const oneLetterApart = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d === 1;
};

export function pointsFor(par: number, steps: number, seconds: number, hints: number): number {
  // Small numbers a player can hold in their head: a ladder is worth up to 20
  // (10 for solving it, 5 for matching par, 5 for speed), so a round is out of 100.
  const route = steps <= par ? 5 : Math.max(0, 5 - (steps - par));
  const speed = Math.max(0, 5 - Math.floor(seconds / 20));
  return Math.max(2, 10 + route + speed - hints * 3);
}

/** Replay a whole round against the ladders the server dealt. `elapsedMs` is the
 *  server's own measure of how long the round took.
 *  `climb`: the timed round. Any number of ladders up to the deal, in order; all the time
 *  claimed fits in the clock; a hinted ladder scores nothing; and only the last ladder may
 *  be left unfinished without being skipped (the clock ran out on it). */
export function verify(puzzles: Puzzle[], runs: unknown, elapsedMs: number, opts: { climb?: boolean } = {}): Verdict {
  const climb = opts.climb === true;
  if (!Array.isArray(runs)) return { ok: false, error: 'Wrong number of ladders' };
  if (climb ? (runs.length < 1 || runs.length > puzzles.length) : runs.length !== puzzles.length) return { ok: false, error: 'Wrong number of ladders' };
  if (climb) puzzles = puzzles.slice(0, runs.length);
  const ladders: LadderScore[] = []; const reasons: string[] = [];
  let claimedMs = 0; let typedSteps = 0;
  for (let i = 0; i < puzzles.length; i++) {
    const [start, target, par] = puzzles[i]!; const run = runs[i] as Partial<LadderRun> | null;
    if (!run || !Array.isArray(run.words)) return { ok: false, error: `Ladder ${i + 1}: no words` };
    const ms = Number(run.ms); const hints = Number(run.hints ?? 0);
    if (!Number.isFinite(ms) || ms < 0) return { ok: false, error: `Ladder ${i + 1}: bad time` };
    if (!Number.isInteger(hints) || hints < 0 || hints > MAX_STEPS) return { ok: false, error: `Ladder ${i + 1}: bad hint count` };
    if (run.words.length > MAX_STEPS) return { ok: false, error: `Ladder ${i + 1}: too many steps` };
    claimedMs += ms;
    const seen = new Set<string>([start]); let prev = start;
    for (const raw of run.words) {
      if (typeof raw !== 'string') return { ok: false, error: `Ladder ${i + 1}: not a word` };
      const w = raw.toLowerCase();
      if (!isWord(w)) return { ok: false, error: `Ladder ${i + 1}: "${w.slice(0, 8)}" is not a word` };
      if (!oneLetterApart(prev, w)) return { ok: false, error: `Ladder ${i + 1}: "${w}" changes more than one letter` };
      if (seen.has(w)) return { ok: false, error: `Ladder ${i + 1}: "${w}" used twice` };
      seen.add(w); prev = w;
    }
    const solved = prev === target && run.words.length > 0;
    if (!solved && !run.skipped && !(climb && i === puzzles.length - 1)) return { ok: false, error: `Ladder ${i + 1}: does not reach the target` };
    if (solved) {
      typedSteps += run.words.length;
      if (ms < run.words.length * MIN_MS_PER_STEP) reasons.push(`ladder ${i + 1} solved in ${ms} ms`);
    }
    ladders.push({ solved, steps: run.words.length, points: solved && !(climb && hints > 0) ? pointsFor(par, run.words.length, Math.floor(ms / 1000), hints) : 0 });
  }
  // the times claimed cannot add up to more than the round took, nor to far less
  // than the server saw pass (a few seconds of slack for the network)
  if (claimedMs > elapsedMs + 5_000) return { ok: false, error: 'Times add up to more than the round took' };
  if (climb && claimedMs > CLIMB_MS + 3_000) return { ok: false, error: 'More time than a round has' };
  if (typedSteps > 0 && elapsedMs < typedSteps * MIN_MS_PER_STEP) reasons.push(`whole round in ${elapsedMs} ms`);
  return { ok: true, total: ladders.reduce((a, l) => a + l.points, 0), ladders, human: reasons.length === 0, reasons };
}
