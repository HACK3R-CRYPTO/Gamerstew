import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameOfDay, potSize, rank, shares, settle, winnersOf, dayOf, dayBefore, ordinal, type Entry } from './rules';
import { createPot, type PotDay, type PotStore } from './service';

const W = (n: number) => '0x' + n.toString(16).padStart(40, '0');
const E = (n: number, score: number, at = '2026-11-27T10:00:00Z'): Entry => ({ wallet: W(n), score, at });

test('the game of the day turns through the list, one a day, and is the same for everyone', () => {
  const games = ['rhythm', 'simon', 'ladder', 'strike'];
  const week = ['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'].map((d) => gameOfDay(d, games));
  assert.equal(new Set(week.slice(0, 4)).size, 4, 'four days, four games');
  assert.equal(week[4], week[0], 'then round again');
  assert.equal(gameOfDay('2026-11-27', []), null);
  assert.equal(dayBefore('2026-12-01'), '2026-11-30'); assert.equal(dayOf(Date.parse('2026-11-27T23:59:59Z')), '2026-11-27');
});

test('70% of what players spend on energy goes into the pot, on top of the seed and what rolled over', () => {
  assert.equal(potSize({ spend: 1000, seed: 0, carried: 0, shareBps: 7000 }), 700);
  assert.equal(potSize({ spend: 1000, seed: 500, carried: 250, shareBps: 7000 }), 1450);
  assert.equal(potSize({ spend: 0, seed: 0, carried: 0, shareBps: 7000 }), 0);
  assert.equal(potSize({ spend: -5, seed: NaN, carried: 10, shareBps: 99999 }), 10, 'nonsense never makes money');
});

test('ranking: one line a player, best score, and a tie goes to whoever got there first', () => {
  const r = rank([E(1, 50), E(2, 90, '2026-11-27T12:00:00Z'), E(1, 70), E(3, 90, '2026-11-27T09:00:00Z'), E(4, 0), { wallet: W(2).toUpperCase().replace('0X', '0x'), score: 60, at: 'x' }]);
  assert.deepEqual(r.map((e) => [e.wallet, e.score]), [[W(3), 90], [W(2), 90], [W(1), 70]]);
});

test('the top third are paid, by rank, in whole G$ that add up to the pot exactly', () => {
  assert.deepEqual([1, 2, 3, 4, 9, 10, 30].map(winnersOf), [1, 1, 1, 2, 3, 4, 10]);
  assert.deepEqual(shares(600, 3), [300, 200, 100]);
  for (const [pot, n] of [[1000, 3], [999, 7], [1, 4], [12345, 10]] as const) {
    const s = shares(pot, n);
    assert.equal(s.reduce((a, b) => a + b, 0), pot, `${pot} over ${n} places adds up`);
    for (let i = 1; i < s.length; i++) assert.ok(s[i - 1]! >= s[i]!, 'a better place is never paid less');
  }
  assert.deepEqual(shares(0, 3), []); assert.deepEqual(shares(100, 0), []);
});

test('closing a day: paid when enough played, rolled over when too few, and nothing to roll when the pot is empty', () => {
  const nine = Array.from({ length: 9 }, (_, i) => E(i + 1, 100 - i));
  const paid = settle({ pot: 600, entries: nine, minPlayers: 5 });
  assert.equal(paid.status, 'paid'); if (paid.status !== 'paid') return;
  assert.deepEqual(paid.paid.map((p) => [p.wallet, p.rank, p.amount]), [[W(1), 1, 300], [W(2), 2, 200], [W(3), 3, 100]]);
  const few = settle({ pot: 600, entries: nine.slice(0, 4), minPlayers: 5 });
  assert.deepEqual([few.status, few.carry, few.paid.length], ['rolled', 600, 0]);
  const empty = settle({ pot: 0, entries: nine, minPlayers: 5 });
  assert.deepEqual([empty.status, empty.carry], ['rolled', 0]);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
});

function world(opts: { spend?: Record<string, number>; entries?: Record<string, Entry[]>; failRead?: boolean } = {}) {
  const clock = { t: Date.parse('2026-11-28T08:00:00Z') }; const closed = new Map<string, PotDay>(); const payouts: { wallet: string; amount: number; reason: string; day: string }[] = []; let reads = 0;
  const store: PotStore = {
    spend: async (day) => { reads++; return opts.failRead ? null : opts.spend?.[day] ?? 0; },
    entries: async (day) => (opts.failRead ? null : opts.entries?.[day] ?? []),
    closed: async (day) => closed.get(day) ?? null,
    close: async (row, ps) => { if (closed.has(row.day)) return false; closed.set(row.day, row); ps.forEach((p) => payouts.push({ ...p, day: row.day })); return true; },
  };
  const pot = createPot({ store, games: ['rhythm', 'simon', 'ladder', 'strike'], shareBps: 7000, seed: 100, minPlayers: 3, now: () => clock.t, nameOf: async (w) => `p${parseInt(w.slice(-2), 16)}`, gameName: (g) => g.toUpperCase(), cacheMs: 30_000 });
  return { pot, clock, closed, payouts, reads: () => reads };
}

test('today: the pot, the board with each prize, where you stand, and one read however many players ask', async () => {
  const w = world({ spend: { '2026-11-28': 1000 }, entries: { '2026-11-28': [E(1, 90), E(2, 80), E(3, 70), E(4, 60)] } });
  const v = await w.pot.today(W(2));
  assert.equal(v.pot, 800, '100 seed + 70% of 1,000');
  assert.equal(v.players, 4); assert.equal(v.paidPlaces, 2);
  assert.deepEqual(v.top.map((t) => [t.rank, t.name, t.prize]), [[1, 'p1', 534], [2, 'p2', 266], [3, 'p3', 0], [4, 'p4', 0]]);
  assert.deepEqual(v.you, { rank: 2, score: 80, prize: 266 });
  assert.equal((await w.pot.today(W(9))).you, null);
  assert.equal(v.endsAt, Date.parse('2026-11-29T00:00:00Z'));
  const before = w.reads(); await Promise.all(Array.from({ length: 50 }, () => w.pot.today())); assert.equal(w.reads(), before, 'fifty more asks, no more reads');
  w.clock.t += 31_000; await w.pot.today(); assert.equal(w.reads(), before + 1);
});

test('closing days: each ended day once, prizes written as pending payouts, an unpaid pot carried into the next day', async () => {
  const w = world({
    spend: { '2026-11-26': 1000, '2026-11-27': 0 },
    entries: { '2026-11-26': [E(1, 9), E(2, 8)], '2026-11-27': [E(1, 50), E(2, 40), E(3, 30), E(4, 20)] }, // the 26th has too few players
  });
  const out = await w.pot.settleDue();
  assert.deepEqual(out.closed.map((c) => [c.day, c.status, c.pot]), [['2026-11-25', 'rolled', 100], ['2026-11-26', 'rolled', 900], ['2026-11-27', 'paid', 1000]]);
  // 25th: seed only, nobody played: 100 rolls on. 26th: 100 seed + 100 carried + 700 = 900, two players: rolls on. 27th: 100 + 900 = 1,000, paid.
  assert.equal(w.payouts.reduce((a, p) => a + p.amount, 0), 1000, 'every G$ of the pot is owed to someone');
  assert.equal(w.payouts[0]!.reason, 'Daily pot, 2026-11-27, RHYTHM, 1st of 4');
  assert.deepEqual((await w.pot.settleDue()).closed, [], 'a second pass closes nothing');
  assert.equal((await w.pot.today()).yesterday?.status, 'paid');
});

test('closing days: when the facts cannot be read, nothing is closed and nothing is owed', async () => {
  const w = world({ failRead: true });
  assert.deepEqual((await w.pot.settleDue()).closed, []);
  assert.equal(w.closed.size, 0); assert.equal(w.payouts.length, 0);
});

test('the pot seeds itself: a tenth of a paid pot opens the next day, and every G$ still reaches players', async () => {
  const nine = Array.from({ length: 9 }, (_, i) => E(i + 1, 100 - i));
  const s = settle({ pot: 1000, entries: nine, minPlayers: 5, holdBps: 1000 });
  assert.equal(s.status, 'paid'); assert.equal(s.carry, 100);
  assert.equal(s.paid.reduce((a, p) => a + p.amount, 0), 900, 'winners share the rest, to the last G$');
  assert.equal(settle({ pot: 1000, entries: nine, minPlayers: 5, holdBps: 99999 }).carry, 500, 'never more than half is held');
  assert.equal(settle({ pot: 1000, entries: nine.slice(0, 2), minPlayers: 5, holdBps: 1000 }).carry, 1000, 'an unpaid pot still rolls over whole');
  // across days, with no seed and no money from the owner
  const clock = { t: Date.parse('2026-11-29T08:00:00Z') }; const closed = new Map<string, PotDay>(); let owed = 0;
  const pot = createPot({
    games: ['rhythm'], shareBps: 7000, seed: 0, minPlayers: 3, holdBps: 1000, now: () => clock.t,
    store: {
      spend: async (day) => (day === '2026-11-27' ? 1000 : 0), entries: async (day) => (day === '2026-11-29' ? [] : [E(1, 9), E(2, 8), E(3, 7)]),
      closed: async (day) => closed.get(day) ?? null, close: async (row, ps) => { closed.set(row.day, row); owed += ps.reduce((a, p) => a + p.amount, 0); return true; },
    },
  });
  await pot.settleDue();
  assert.deepEqual(['2026-11-27', '2026-11-28'].map((d) => [closed.get(d)!.pot, closed.get(d)!.carried_out]), [[700, 70], [70, 7]]);
  assert.equal(owed, 630 + 63);
  const today = await pot.today();
  assert.equal(today.pot, 7, 'today opens with what yesterday held back, before anyone has bought anything');
});
