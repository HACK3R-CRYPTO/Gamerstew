// ─── Street Strike scoring ───────────────────────────────────────────────────
// Ten-pin rules over a configurable number of frames (we play 5 for a quick
// phone game). A strike scores 10 plus your next two rolls, a spare 10 plus your
// next one, and the last frame gives the bonus rolls you earn. Pure functions,
// no game state, so they are easy to test.

export const PINS = 10;

export interface FrameView {
  rolls: number[];
  /** running total once the frame's bonus rolls are known, else null */
  total: number | null;
  marks: string[]; // what to print in the boxes: "X", "/", "-", "7"…
}

export interface ScoreState {
  frames: FrameView[];
  total: number; // total of every frame that can be scored so far
  frame: number; // index of the frame being bowled (== frameCount when done)
  ball: number; // 0-based roll within that frame
  done: boolean;
  /** true when the next roll is at a full rack of ten */
  freshRack: boolean;
}

/** Split a flat list of rolls into frames. */
export function splitFrames(rolls: number[], frameCount: number): number[][] {
  const out: number[][] = [];
  let i = 0;
  for (let f = 0; f < frameCount && i < rolls.length; f++) {
    const last = f === frameCount - 1;
    if (!last) {
      if (rolls[i] === PINS) {
        out.push([PINS]);
        i += 1;
      } else {
        out.push(rolls.slice(i, i + 2));
        i += 2;
      }
    } else {
      const r = rolls.slice(i, i + 3);
      const earned = r.length >= 2 && (r[0] === PINS || r[0] + r[1] === PINS) ? 3 : 2;
      out.push(r.slice(0, earned));
      i += earned;
    }
  }
  return out;
}

export function score(rolls: number[], frameCount: number): ScoreState {
  const split = splitFrames(rolls, frameCount);
  const frames: FrameView[] = [];
  let i = 0;
  let running = 0;
  let open = true; // are all earlier frames scored?
  for (let f = 0; f < frameCount; f++) {
    const r = split[f] ?? [];
    const last = f === frameCount - 1;
    let total: number | null = null;
    if (r.length) {
      if (last) {
        const need = r.length >= 2 && (r[0] === PINS || r[0] + r[1] === PINS) ? 3 : 2;
        if (r.length >= need) total = r.reduce((a, b) => a + b, 0);
      } else if (r[0] === PINS) {
        if (rolls.length >= i + 3) total = PINS + rolls[i + 1] + rolls[i + 2];
      } else if (r.length === 2) {
        if (r[0] + r[1] === PINS) {
          if (rolls.length >= i + 3) total = PINS + rolls[i + 2];
        } else total = r[0] + r[1];
      }
    }
    if (total != null && open) {
      running += total;
      total = running;
    } else {
      open = false;
      total = null;
    }
    // box marks
    const marks: string[] = [];
    r.forEach((v, k) => {
      const prev = k > 0 ? r[k - 1] : null;
      const freshHere = k === 0 || (last && (prev === PINS || (k === 2 && r[0] + r[1] === PINS && r[0] !== PINS)) );
      if (v === PINS && freshHere) marks.push("X");
      else if (!freshHere && prev != null && prev + v === PINS) marks.push("/");
      else marks.push(v === 0 ? "-" : String(v));
    });
    frames.push({ rolls: r, total, marks });
    i += r.length;
  }

  // where are we?
  let frame = split.length ? split.length - 1 : 0;
  let ball = split.length ? split[frame].length : 0;
  let done = false;
  if (split.length) {
    const r = split[frame];
    const last = frame === frameCount - 1;
    const complete = last
      ? r.length >= (r.length >= 2 && (r[0] === PINS || r[0] + r[1] === PINS) ? 3 : 2)
      : r[0] === PINS || r.length === 2;
    if (complete) {
      if (last) done = true;
      frame += 1;
      ball = 0;
    }
  }
  const cur = split[frame] ?? [];
  let freshRack = ball === 0;
  if (frame === frameCount - 1 && ball > 0) {
    // last frame: a strike, or a spare completed on roll 2, re-racks
    if (ball === 1) freshRack = cur[0] === PINS;
    else if (ball === 2) freshRack = cur[1] === PINS || cur[0] + cur[1] === PINS;
  }
  return { frames, total: running, frame: Math.min(frame, frameCount), ball, done, freshRack };
}

/** Best possible score for `frameCount` frames (all strikes). */
export const perfect = (frameCount: number) => (frameCount - 1) * 30 + 30;
