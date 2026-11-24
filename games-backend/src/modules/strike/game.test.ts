import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { engine, replay, FRAMES, MAX_THROWS, type GameThrow } from './game';
import { simulate, cleanThrow, SIM_TYRES } from './sim';
import { score, perfect } from './scoring';

const root = path.resolve(__dirname, '../../../..'); // dist/modules/strike → repo root
const body = (p: string) => fs.readFileSync(p, 'utf8').split('\n').slice(3).join('\n'); // drop the 3-line COPY header

test('sim.ts and scoring.ts are exact copies of the frontend files', () => {
  for (const f of ['sim.ts', 'scoring.ts']) {
    assert.equal(body(path.join(root, 'games-backend/src/modules/strike', f)), fs.readFileSync(path.join(root, 'frontend/app/bowling', f), 'utf8'), `${f} has drifted from the frontend copy`);
  }
});

// seeded throws so a failure can be reproduced
function rng(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const tyres = Object.keys(SIM_TYRES);
function randomGame(seed: number): GameThrow[] {
  const r = rng(seed); return Array.from({ length: MAX_THROWS }, (_, i) => ({ tyre: tyres[(seed + i) % tyres.length]!, x: (r() - 0.5) * 1.2, angle: (r() - 0.5) * 0.12, speed: 5 + r() * 6, spin: (r() - 0.5) * 30 }));
}
/** play throws until the game ends, the way the phone does, and return exactly the throws used */
async function playOut(seed: number): Promise<{ throws: GameThrow[]; total: number; ms: number }> {
  const R = await engine(); const all = randomGame(seed); const rolls: number[] = []; const used: GameThrow[] = [];
  let standing = Array<boolean>(10).fill(true); let steps = 0;
  for (const t of all) {
    if (score(rolls, FRAMES).done) break;
    const out = simulate(R, { tyre: t.tyre, throw: cleanThrow(t.tyre, t), standing });
    used.push(t); steps += out.steps; rolls.push(out.down.filter(Boolean).length);
    standing = score(rolls, FRAMES).freshRack ? Array<boolean>(10).fill(true) : standing.map((up, k) => up && !out.down[k]);
  }
  return { throws: used, total: score(rolls, FRAMES).total, ms: (steps / 60) * 1000 };
}

test('the same throw always gives the same result', async () => {
  const R = await engine();
  for (let s = 1; s <= 12; s++) {
    const t = randomGame(s)[0]!; const input = { tyre: t.tyre, throw: t, standing: Array<boolean>(10).fill(true) };
    const a = simulate(R, input), b = simulate(R, input);
    assert.deepEqual(a.down, b.down); assert.equal(a.steps, b.steps); assert.equal(a.gutter, b.gutter);
  }
});

test('a pinned throw: this exact result must not change without bumping SIM_VERSION', async () => {
  const R = await engine();
  const r = simulate(R, { tyre: 'danfo', throw: { x: 0.05, angle: 0, speed: 9, spin: 0 }, standing: Array<boolean>(10).fill(true) });
  assert.equal(r.down.map((d) => (d ? 1 : 0)).join('') + ':' + r.steps, process.env.STRIKE_PIN ?? PINNED);
});
const PINNED = '1111111111:342';

test('replay: a finished game scores what the phone would have shown', async () => {
  const R = await engine();
  for (const seed of [3, 7, 21, 40]) {
    const g = await playOut(seed);
    const v = replay(R, g.throws, g.ms + 20_000);
    assert.ok(v.ok, v.ok ? '' : v.error); if (!v.ok) continue;
    assert.equal(v.total, g.total);
    assert.ok(v.total >= 0 && v.total <= perfect(FRAMES));
  }
});

test('replay: refuses an unfinished game, extra throws, junk, an unknown tyre, and a game that was too quick', async () => {
  const R = await engine(); const g = await playOut(5);
  assert.equal(replay(R, g.throws.slice(0, -1), 600_000).ok, false, 'one throw short');
  assert.equal(replay(R, [...g.throws, g.throws[0]], 600_000).ok, false, 'a throw after the end');
  assert.equal(replay(R, [], 600_000).ok, false);
  assert.equal(replay(R, 'nope', 600_000).ok, false);
  assert.equal(replay(R, Array(MAX_THROWS + 1).fill(g.throws[0]), 600_000).ok, false, 'more throws than a game can have');
  assert.equal(replay(R, g.throws.map((t, i) => (i === 0 ? { ...t, tyre: 'tank' } : t)), 600_000).ok, false, 'a tyre that does not exist');
  assert.equal(replay(R, g.throws.map((t, i) => (i === 0 ? { ...t, speed: NaN } : t)), 600_000).ok, false);
  assert.equal(replay(R, g.throws, g.ms * 0.5).ok, false, 'finished in half the time its rolls take');
  assert.equal(replay(R, g.throws, g.ms * 0.7).ok, true);
});

test('replay: a throw outside what a player can do is pulled back in, not trusted', async () => {
  const R = await engine();
  const wild = { tyre: 'danfo', x: 0, angle: 0, speed: 500, spin: 0 };
  const max = { tyre: 'danfo', x: 0, angle: 0, speed: 11, spin: 0 };
  const a = simulate(R, { tyre: 'danfo', throw: cleanThrow('danfo', wild), standing: Array<boolean>(10).fill(true) });
  const b = simulate(R, { tyre: 'danfo', throw: cleanThrow('danfo', max), standing: Array<boolean>(10).fill(true) });
  assert.deepEqual(a.down, b.down); assert.equal(a.steps, b.steps);
});
