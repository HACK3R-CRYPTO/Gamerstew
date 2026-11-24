// Street Strike: replay a whole game on the server.
//
// The player sends the throws (which tyre, where, how hard, how much spin).
// Every throw is run through the same lane simulation the phone ran (sim.ts),
// so the score is worked out here. The phone never reports pins or a total.

import { simulate, cleanThrow, PINS, SIM_TYRES, STEP, type SimThrow } from './sim';
import { score } from './scoring';

export const FRAMES = 5;
export const MAX_THROWS = (FRAMES - 1) * 2 + 3;

export interface GameThrow extends SimThrow { tyre: string }
export type GameVerdict =
  | { ok: true; total: number; rolls: number[]; simMs: number }
  | { ok: false; error: string };

// The physics engine starts up once, on first use.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
let enginePromise: Promise<any> | null = null;
export function engine(): Promise<any> {
  if (!enginePromise) {
    const R = require('@dimforge/rapier3d-compat');
    enginePromise = R.init().then(() => R);
  }
  return enginePromise as Promise<any>;
}

const isThrow = (t: unknown): t is GameThrow => {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  return typeof o.tyre === 'string' && Object.prototype.hasOwnProperty.call(SIM_TYRES, o.tyre)
    && ['x', 'angle', 'speed', 'spin'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
};

/** Play the throws in order. `elapsedMs` is how long the server saw the game take. */
export function replay(R: any, throws: unknown, elapsedMs: number): GameVerdict {
  if (!Array.isArray(throws) || throws.length === 0) return { ok: false, error: 'No throws' };
  if (throws.length > MAX_THROWS) return { ok: false, error: 'Too many throws' };
  const rolls: number[] = [];
  let standing = Array<boolean>(PINS).fill(true);
  let steps = 0;
  for (let i = 0; i < throws.length; i++) {
    const t = throws[i];
    if (!isThrow(t)) return { ok: false, error: `Throw ${i + 1}: not a throw` };
    if (score(rolls, FRAMES).done) return { ok: false, error: 'Throws after the game ended' };
    const out = simulate(R, { tyre: t.tyre, throw: cleanThrow(t.tyre, t), standing });
    steps += out.steps;
    rolls.push(out.down.filter(Boolean).length);
    const st = score(rolls, FRAMES);
    standing = st.freshRack ? Array<boolean>(PINS).fill(true) : standing.map((up, k) => up && !out.down[k]);
  }
  const end = score(rolls, FRAMES);
  if (!end.done) return { ok: false, error: 'Game not finished' };
  // every roll plays out on screen in real time, so a game cannot take less
  // time than its rolls last (with slack for a fast phone and the network)
  const simMs = steps * STEP * 1000;
  if (elapsedMs < simMs * 0.6) return { ok: false, error: 'Game finished faster than its rolls can play' };
  return { ok: true, total: end.total, rolls, simMs };
}
