import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deal, verify, pointsFor, isWord, PARS, MIN_MS_PER_STEP, CLIMB_MS, CLIMB_DEALT, parAt, type Puzzle, type LadderRun } from './rules';
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

test('points: a ladder is out of 20; par and speed add, extra steps and hints cost, never below 2', () => {
  assert.equal(pointsFor(3, 3, 0, 0), 20);
  assert.equal(pointsFor(3, 2, 0, 0), 20);
  assert.equal(pointsFor(3, 5, 0, 0), 18);   // two steps over par
  assert.equal(pointsFor(3, 3, 45, 0), 18);  // slower
  assert.equal(pointsFor(3, 3, 100, 0), 15); // no speed bonus left
  assert.equal(pointsFor(3, 3, 0, 1), 17);   // one hint
  assert.equal(pointsFor(3, 12, 500, 9), 2);
});

test('the climb: a long deal starts with the same five, gets harder, and never fails to deal', () => {
  const long = deal('seed-1', CLIMB_DEALT);
  assert.equal(long.length, CLIMB_DEALT);
  assert.deepEqual(long.slice(0, 5), deal('seed-1'), 'the first five are the ordinary round');
  long.forEach((p, i) => assert.equal(p[2], parAt(i)));
  assert.equal(parAt(4), 4); assert.equal(parAt(8), 5); assert.equal(parAt(30), 6);
  assert.deepEqual(deal('seed-1', CLIMB_DEALT), long, 'the same seed deals the same climb');
});

test('the climb: the score has no ceiling, and is every ladder solved inside the clock', () => {
  const ps = deal('climb', CLIMB_DEALT);
  const nine = honest(ps.slice(0, 9), 1_500);
  const v = verify(ps, nine, sum(nine) + 2_000, { climb: true });
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.ladders.length, 9);
  assert.ok(v.total > 100, `nine ladders are worth more than the old ceiling of 100, got ${v.total}`);
  const five = verify(ps, nine.slice(0, 5), sum(nine.slice(0, 5)) + 2_000, { climb: true });
  assert.ok(five.ok && five.total < v.total, 'more ladders, more points');
  // the last ladder may be left as it stood when the clock ran out; one in the middle may not
  const cut = [...nine.slice(0, 5), { words: nine[5]!.words.slice(0, 1), ms: 4_000, hints: 0 }];
  const c = verify(ps, cut, sum(cut) + 2_000, { climb: true });
  assert.ok(c.ok && c.ladders[5]!.points === 0);
  const hole = [...nine.slice(0, 2), { words: [], ms: 4_000, hints: 0 }, ...nine.slice(3, 6)];
  assert.equal(verify(ps, hole, sum(hole) + 2_000, { climb: true }).ok, false);
  assert.equal(verify(ps, [], 5_000, { climb: true }).ok, false, 'a round with no ladders is not a round');
});

test('the climb: more time than the clock is refused, a hinted ladder earns nothing, and the fixed round is unchanged', () => {
  const ps = deal('clock', CLIMB_DEALT);
  const slow = honest(ps.slice(0, 6), 14_000); // far longer than three minutes in all
  assert.ok(sum(slow) > CLIMB_MS + 3_000);
  assert.equal(verify(ps, slow, sum(slow) + 5_000, { climb: true }).ok, false);
  const runs = honest(ps.slice(0, 4)); runs[1] = { ...runs[1]!, hints: 1 };
  const v = verify(ps, runs, sum(runs) + 2_000, { climb: true });
  assert.ok(v.ok && v.ladders[1]!.points === 0 && v.ladders[0]!.points > 0);
  // the ordinary round still needs exactly five and still pays a hinted ladder
  const fixed = deal('clock');
  assert.equal(verify(fixed, honest(fixed).slice(0, 4), 60_000).ok, false);
  const h = honest(fixed); h[0] = { ...h[0]!, hints: 1 };
  const f = verify(fixed, h, sum(h) + 2_000);
  assert.ok(f.ok && f.ladders[0]!.points > 0);
});
