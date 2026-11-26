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

test('a card ended early is scored on the throws made; an unfinished card is still refused unless it was ended; nothing knocked down is not a game', async () => {
  const R = await engine();
  const good: GameThrow = { tyre: 'danfo', ...cleanThrow('danfo', { x: 0, angle: 0, speed: 10, spin: 0 }) };
  const one = replay(R, [good], 60_000);
  assert.equal(one.ok, false, 'one throw is not a finished game');
  const early = replay(R, [good], 60_000, true);
  assert.equal(early.ok, true);
  if (early.ok) {
    assert.equal(early.rolls.length, 1, 'only the throws that were made are reported');
    const card = early.rolls.slice();
    while (!score(card, FRAMES).done) card.push(0);
    assert.equal(early.total, score(card, FRAMES).total, 'scored as a card whose other throws missed');
    assert.ok(early.total >= (early.rolls[0] ?? 0) && early.total > 0);
  }
  const gutter: GameThrow = { tyre: 'keke', ...cleanThrow('keke', { x: 5, angle: 0.1, speed: 6, spin: 20 }) };
  const missed = simulate(R, { tyre: 'keke', throw: gutter, standing: Array(10).fill(true) }).down.filter(Boolean).length;
  if (missed === 0) assert.equal(replay(R, [gutter], 60_000, true).ok, false, 'leaving with nothing down does not count');
  assert.equal(replay(R, [good], 10, true).ok, false, 'an early end still cannot be faster than its rolls');
});

// ── Street Strike in a friend room: the same replay decides the round ────────
import { ROOM_GAMES } from '../rooms/games';
import { createRoomService } from '../rooms/service';

test('a friend room scores a lane by replaying the throws; what the phone says it scored is never used', async () => {
  const rules = ROOM_GAMES.strike!;
  assert.equal(rules.verified, true, 'server-scored, so a room may be played for G$');
  const g = await playOut(7);
  assert.deepEqual(await rules.score('seed', { throws: g.throws, score: 9999, rolls: [10, 10, 10] }, g.ms + 20_000), { ok: true, score: g.total });
  assert.equal((await rules.score('seed', { throws: g.throws.slice(0, 2) }, 600_000)).ok, false, 'an unfinished card');
  assert.equal((await rules.score('seed', { throws: g.throws }, 500)).ok, false, 'faster than the rolls can play');
  assert.equal((await rules.score('seed', { score: 50 }, 600_000)).ok, false, 'no throws: nothing to score');
  assert.equal((await rules.score('seed', null, 600_000)).ok, false);
});

test('two friends bowl a room: each lane is replayed, the standings are the server totals, and the higher one wins', async () => {
  const clock = { t: 1_800_000_000_000 };
  const svc = createRoomService(ROOM_GAMES, { now: () => clock.t });
  const made = svc.create('strike', 'Ada') as { code: string; token: string };
  const joined = svc.join(made.code, 'Bola') as { code: string; token: string };
  const started = svc.start(made.code, made.token) as { status: string; verified: boolean; stakes: boolean };
  assert.equal(started.status, 'playing'); assert.equal(started.verified, true);
  const a = await playOut(3), b = await playOut(21);
  // each roll as it lands: the frame they are on, and the card so far for the others to see
  const seen = svc.progress(made.code, made.token, 2, { rolls: [10, 7, 3] }) as { players: { progress: number; live?: { rolls?: number[] } }[] };
  assert.equal(seen.players[0]!.progress, 2); assert.deepEqual(seen.players[0]!.live?.rolls, [10, 7, 3]);
  clock.t += Math.max(a.ms, b.ms) + 30_000;
  await svc.finish(made.code, made.token, { throws: a.throws });
  const end = await svc.finish(joined.code, joined.token, { throws: b.throws }) as { status: string; players: { name: string; score: number | null; done: boolean }[] };
  assert.equal(end.status, 'over');
  assert.deepEqual(end.players.map((p) => [p.name, p.score, p.done]), [['Ada', a.total, true], ['Bola', b.total, true]]);
});
