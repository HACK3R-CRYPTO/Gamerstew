import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deal, verify, pointsFor, isWord, PARS, MIN_MS_PER_STEP, type Puzzle, type LadderRun } from './rules';
import { PUZZLES, VALID } from './data';

const WORDS = new Set(VALID.split(' '));
// shortest route through accepted words, for building honest runs
function route(a: string, z: string): string[] {
  const prev = new Map<string, string | null>([[a, null]]); const q = [a];
  for (let h = 0; h < q.length; h++) {
    const w = q[h]!; if (w === z) break;
    for (let i = 0; i < 4; i++) for (let c = 97; c < 123; c++) {
      const x = w.slice(0, i) + String.fromCharCode(c) + w.slice(i + 1);
      if (!prev.has(x) && WORDS.has(x)) { prev.set(x, w); q.push(x); }
    }
  }
  const out: string[] = []; for (let w: string | null | undefined = z; w && w !== a; w = prev.get(w)) out.unshift(w);
  return out;
}
const honest = (ps: Puzzle[], msPerStep = 2_000): LadderRun[] => ps.map(([s, t]) => { const words = route(s, t); return { words, ms: words.length * msPerStep, hints: 0 }; });
const sum = (runs: LadderRun[]) => runs.reduce((a, r) => a + r.ms, 0);

test('deal: the same seed deals the same five, a different seed does not', () => {
  assert.deepEqual(deal('token-a'), deal('token-a'));
  assert.notDeepEqual(deal('token-a'), deal('token-b'));
});

test('deal: five ladders at the set pars, no word used twice, all from the puzzle list', () => {
  for (const seed of ['a', 'b', '2026-11-24', 'x'.repeat(64)]) {
    const d = deal(seed);
    assert.deepEqual(d.map((p) => p[2]), PARS);
    const words = d.flatMap((p) => [p[0], p[1]]);
    assert.equal(new Set(words).size, 10);
    for (const p of d) assert.ok(PUZZLES.some((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2]));
  }
});

test('every puzzle can be solved with accepted words, in no more steps than its par', () => {
  for (const [s, t, par] of PUZZLES) {
    const r = route(s, t);
    assert.ok(r.length > 0 && r[r.length - 1] === t, `${s} to ${t} has no route`);
    assert.ok(r.length <= par, `${s} to ${t}: shortest is ${r.length}, par says ${par}`);
  }
});

test('verify: an honest round scores, and matches the points rule ladder by ladder', () => {
  const ps = deal('honest'); const runs = honest(ps);
  const v = verify(ps, runs, sum(runs) + 3_000);
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.human, true);
  v.ladders.forEach((l, i) => assert.equal(l.points, pointsFor(ps[i]![2], runs[i]!.words.length, Math.floor(runs[i]!.ms / 1000), 0)));
  assert.equal(v.total, v.ladders.reduce((a, l) => a + l.points, 0));
});

test('verify: refuses a made-up word, a two-letter jump, a repeat, and a route that stops short', () => {
  const ps = deal('cheat'); const good = honest(ps); const el = sum(good) + 1_000;
  const swap = (i: number, words: string[]) => good.map((r, k) => (k === i ? { ...r, words } : r));
  const [s, t] = ps[0]!;
  const fake = s.slice(0, 3) + (s[3] === 'q' ? 'x' : 'q');
  assert.equal(isWord(fake) ? true : verify(ps, swap(0, [fake, ...good[0]!.words]), el).ok, isWord(fake));
  assert.equal(verify(ps, swap(0, [t]), el).ok, false, 'jumping straight to the target');
  const first = good[0]!.words[0]!;
  assert.equal(verify(ps, swap(0, [first, s, ...good[0]!.words]), el).ok, false, 'going back to the start word');
  assert.equal(verify(ps, swap(0, good[0]!.words.slice(0, -1)), el).ok, false, 'stopping one short');
  assert.equal(verify(ps, good.slice(0, 4), el).ok, false, 'four ladders sent for five');
});

test('verify: a skipped ladder is allowed and scores nothing', () => {
  const ps = deal('skip'); const runs = honest(ps); runs[2] = { words: [], ms: 4_000, hints: 0, skipped: true };
  const v = verify(ps, runs, sum(runs) + 1_000);
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.ladders[2]!.points, 0); assert.equal(v.ladders[2]!.solved, false);
});

test('verify: the times claimed cannot exceed the time the server saw', () => {
  const ps = deal('time'); const runs = honest(ps);
  assert.equal(verify(ps, runs, sum(runs) - 6_000).ok, false);
  assert.equal(verify(ps, runs, sum(runs) + 4_999).ok, true);
});

test('verify: a round typed faster than a person can is scored but flagged', () => {
  const ps = deal('bot'); const runs = honest(ps, MIN_MS_PER_STEP - 100);
  const v = verify(ps, runs, sum(runs));
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.human, false); assert.ok(v.reasons.length > 0);
});

test('points: par earns the route bonus, extra steps and hints cost, never below 20', () => {
  assert.equal(pointsFor(3, 3, 0, 0), 200);
  assert.equal(pointsFor(3, 2, 0, 0), 200);
  assert.equal(pointsFor(3, 5, 0, 0), 180);
  assert.equal(pointsFor(3, 3, 100, 0), 150);
  assert.equal(pointsFor(3, 3, 0, 1), 170);
  assert.equal(pointsFor(3, 12, 500, 9), 20);
});
