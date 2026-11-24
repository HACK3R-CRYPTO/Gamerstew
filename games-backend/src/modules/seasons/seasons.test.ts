import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { bestPerPlayer, createSeasonsService, type ActivityRow, type SeasonRow, type SeasonsDeps } from './service';
import { registerSeasonsRoutes } from './routes';
import { supabaseSealedSeasons, supabaseTopActivity } from './adapters';

const GAMES = ['rhythm', 'simon', 'stack', 'nepa'];
const W = (n: number) => `0xAA${String(n).padStart(38, '0')}`;
const act = (n: number, score: number, extra: Partial<ActivityRow> = {}): ActivityRow => ({ wallet_address: W(n), score, game_time: 60_000, wagered: null, created_at: '2026-11-20T10:00:00.700Z', tx_hash: `0xtx${n}`, ...extra });
const T = Math.floor(Date.parse('2026-11-20T10:00:00.700Z') / 1000);
const season = (n: number): SeasonRow => ({ season_number: n, start_ts: n * 1000, end_ts: n * 1000 + 1000, prize_pot: 50, created_at: '2026-11-21T00:00:00Z' });
const iso = (sec: number) => new Date(sec * 1000).toISOString();

function world(over: { failRead?: (game: string, to: string | null) => boolean; failNames?: boolean; sealed?: SeasonRow[]; rows?: (game: string, from: string, to: string | null) => ActivityRow[]; names?: Record<string, string>; slowDb?: boolean } = {}) {
  const calls: unknown[][] = [];
  const store = new Map<string, unknown>();
  // the clock starts long after every fixture season ended, so they count as settled
  const state = { sealed: over.sealed ?? [], names: { ...(over.names ?? {}) } as Record<string, string>, clock: 1e12, failRead: over.failRead, failNames: !!over.failNames };
  const deps: SeasonsDeps = {
    games: GAMES,
    currentSeason: () => 42,
    seasonBounds: (s) => ({ start: s * 1000, end: s * 1000 + 1000 }),
    topActivity: async (game, from, to) => { calls.push(['activity', game, from, to]); if (over.slowDb) await new Promise((r) => setTimeout(r, 15)); if (state.failRead?.(game, to)) return { rows: [], ok: false }; return { rows: over.rows ? over.rows(game, from, to) : [], ok: true }; },
    sealedSeasons: async () => { calls.push(['sealed']); return state.sealed; },
    resolveUsername: async (w) => { calls.push(['name', w]); return state.failNames ? { name: null, ok: false } : { name: state.names[w.toLowerCase()], ok: true }; },
    cache: { get: (k) => store.get(k), set: (k, v, ttl) => { calls.push(['cacheSet', k, ttl]); store.set(k, v); } },
    ttlMs: 60_000,
    now: () => state.clock,
  };
  const count = (kind: string, pastOnly = false) => calls.filter((c) => c[0] === kind && (!pastOnly || c[3] !== null)).length;
  return { deps, calls, store, state, count, svc: createSeasonsService(deps) };
}

test('bestPerPlayer: one row each, their best, highest first, capped', () => {
  const rows = [act(1, 50), act(2, 90), act(1, 70), act(3, 10), { ...act(4, 999), wallet_address: null }, { ...act(1, 60), wallet_address: W(1).toLowerCase() }];
  assert.deepStrictEqual(bestPerPlayer(rows).map((r) => [r.wallet_address, r.score]), [[W(2), 90], [W(1), 70], [W(3), 10]]); // same player in two letter-cases is one player
  assert.strictEqual(bestPerPlayer(Array.from({ length: 30 }, (_, i) => act(i, i))).length, 10);
  assert.strictEqual(bestPerPlayer(Array.from({ length: 30 }, (_, i) => act(i, i)), 3).length, 3);
  assert.deepStrictEqual(bestPerPlayer(null), []);
  const tie = bestPerPlayer([act(1, 5, { tx_hash: 'first' }), act(1, 5, { tx_hash: 'second' })]);
  assert.strictEqual(tie[0]!.tx_hash, 'first'); // an equal score does not replace the earlier row
});

test('the reply: live standings and every sealed season, in the shape the pages read', async () => {
  const w = world({
    sealed: [season(41), season(40)],
    names: { [W(1).toLowerCase()]: 'ada' },
    rows: (game, _from, to) => (game === 'rhythm' ? [act(1, 900, { wagered: '5' }), act(2, 400), act(1, 300)] : game === 'stack' && to ? [act(3, 77)] : []),
  });
  const r = await w.svc.seasons();
  assert.deepStrictEqual(Object.keys(r), ['currentSeason', 'currentEndsAt', 'live', 'past']);
  assert.deepStrictEqual([r.currentSeason, r.currentEndsAt], [42, 43_000]);
  const live = r.live as Record<string, Record<string, unknown>[]>;
  assert.deepStrictEqual(Object.keys(live), GAMES);
  assert.deepStrictEqual(live.rhythm, [
    { player: W(1), username: 'ada', score: 900, gameTime: 60_000, wagered: '5', timestamp: T, tx_hash: '0xtx1' },
    { player: W(2), username: null, score: 400, gameTime: 60_000, wagered: null, timestamp: T, tx_hash: '0xtx2' },
  ]);
  assert.deepStrictEqual(live.stack, []); // the live window has no stack rows in this fixture
  const past = r.past as Record<string, unknown>[];
  assert.deepStrictEqual(past.map((p) => p.season), [41, 40]); // newest first, as the database returned them
  assert.deepStrictEqual(Object.keys(past[0]!), ['season', 'startTs', 'endTs', 'prizePot', 'sealedAt', 'totalPlayers', ...GAMES]);
  assert.deepStrictEqual([past[0]!.startTs, past[0]!.endTs, past[0]!.prizePot, past[0]!.sealedAt, past[0]!.totalPlayers], [41_000, 42_000, 50, Math.floor(Date.parse('2026-11-21T00:00:00Z') / 1000), 3]);
  assert.deepStrictEqual((past[0]!.rhythm as unknown[])[0], { player: W(1), username: 'ada', score: 900, gameTime: 60_000, timestamp: T, tx_hash: '0xtx1' }); // no `wagered` on past rows
  assert.deepStrictEqual(past[0]!.stack, [{ player: W(3), username: null, score: 77, gameTime: 60_000, timestamp: T, tx_hash: '0xtx3' }]);
  // the windows asked for: live from this season's start with no end; each past season by its own bounds
  assert.deepStrictEqual(w.calls.filter((c) => c[0] === 'activity' && c[1] === 'rhythm').map((c) => [c[2], c[3]]).sort(), [[iso(40_000), iso(41_000)], [iso(41_000), iso(42_000)], [iso(42_000), null]].sort());
  assert.deepStrictEqual(w.calls.filter((c) => c[0] === 'cacheSet'), [['cacheSet', 'seasons:global', 60_000]]);
});

test('ten per game, live and past; totalPlayers counts every wallet as the database spells it', async () => {
  const many = Array.from({ length: 14 }, (_, i) => act(i + 1, 100 - i));
  const w = world({ sealed: [season(41)], rows: (game) => (game === 'rhythm' ? [...many, { ...act(1, 5), wallet_address: W(1).toLowerCase() }, { ...act(99, 1), wallet_address: null }] : []) });
  const r = await w.svc.seasons();
  assert.strictEqual((r.live as Record<string, unknown[]>).rhythm!.length, 10);
  const p = (r.past as Record<string, unknown>[])[0]!;
  assert.strictEqual((p.rhythm as unknown[]).length, 10);
  assert.strictEqual(p.totalPlayers, 16); // 14 wallets, one of them again in lower case, and one row with no wallet
  assert.strictEqual(((await world({ sealed: [{ ...season(41), prize_pot: null }] }).svc.seasons()).past as { prizePot: unknown }[])[0]!.prizePot, null); // a missing prize stays missing
  const none = world();
  none.deps.sealedSeasons = async () => null as unknown as SeasonRow[];
  assert.deepStrictEqual((await createSeasonsService(none.deps).seasons()).past, []);
});

test('a finished season is read from the database once, however often the page is opened', async () => {
  const w = world({ sealed: Array.from({ length: 41 }, (_, i) => season(41 - i)), rows: () => [act(1, 10)] });
  await w.svc.seasons();
  assert.strictEqual(w.count('activity'), 4 + 41 * 4); // the first read pays for everything, once
  assert.strictEqual(w.svc.pastSeasonsHeld(), 41);
  w.calls.length = 0;
  const first = JSON.stringify(await w.svc.seasons());
  assert.deepStrictEqual(w.calls, []); // served from the short cache: no reads, no lookups, nothing
  // a saved score clears that cache: the next view re-reads only what can have changed
  w.store.clear();
  w.calls.length = 0;
  const again = JSON.stringify(await w.svc.seasons());
  assert.strictEqual(again, first); // byte for byte the same reply
  assert.strictEqual(w.count('activity'), 4); // four queries, not 168
  assert.strictEqual(w.count('activity', true), 0);
  assert.strictEqual(w.count('sealed'), 1);
  assert.strictEqual(w.count('name'), 4); // only the live rows; past names are still fresh
});

test('a season sealed later is read once when it appears; a corrected season row is re-read', async () => {
  const w = world({ sealed: [season(40)], rows: () => [act(1, 10)] });
  await w.svc.seasons();
  w.store.clear(); w.calls.length = 0;
  w.state.sealed = [season(41), season(40)];
  const r = await w.svc.seasons();
  assert.deepStrictEqual((r.past as { season: number }[]).map((p) => p.season), [41, 40]);
  assert.strictEqual(w.count('activity', true), 4); // just the new season
  w.store.clear(); w.calls.length = 0;
  w.state.sealed = [season(41), { ...season(40), end_ts: 40_900 }]; // its bounds were fixed by hand
  await w.svc.seasons();
  assert.strictEqual(w.count('activity', true), 4);
  w.store.clear(); w.calls.length = 0;
  w.state.sealed = [season(41), { ...season(40), start_ts: 39_900, end_ts: 40_900 }]; // and its start
  await w.svc.seasons();
  assert.strictEqual(w.count('activity', true), 4);
  assert.strictEqual(w.svc.pastSeasonsHeld(), 2); // superseded readings are dropped, not hoarded
  // prize and seal time are read fresh from the season row every time
  w.store.clear();
  w.state.sealed = [{ ...season(41), prize_pot: 75 }];
  assert.strictEqual(((await w.svc.seasons()).past as { prizePot: number }[])[0]!.prizePot, 75);
});

test('names on past seasons catch up within ten minutes, with no database read', async () => {
  const w = world({ sealed: [season(41)], rows: (_g, _f, to) => (to ? [act(1, 10)] : []) });
  const nameOf = async () => { w.store.clear(); return (((await w.svc.seasons()).past as Record<string, { username: unknown }[]>[])[0]!.rhythm as { username: unknown }[])[0]!.username; };
  assert.strictEqual(await nameOf(), null);
  w.state.names[W(1).toLowerCase()] = 'renamed';
  w.state.clock += 10 * 60_000;
  assert.strictEqual(await nameOf(), null); // exactly ten minutes: still trusted
  w.state.clock += 1;
  w.calls.length = 0;
  assert.strictEqual(await nameOf(), 'renamed');
  assert.strictEqual(w.count('activity', true), 0);
});

test('a failed read is served once and never remembered', async () => {
  // the database fails one game of one finished season, the way supabase-js reports it: no throw, just no data
  const w = world({ sealed: [season(41), season(40)], rows: () => [act(1, 10)], failRead: (game, to) => game === 'rhythm' && to === iso(42_000) });
  const during = (await w.svc.seasons()).past as Record<string, unknown[]>[];
  assert.deepStrictEqual(during[0]!.rhythm, []); // degraded for this one reply, as it always was
  assert.strictEqual(w.svc.pastSeasonsHeld(), 1); // the healthy season is kept; the damaged one is not
  w.state.failRead = undefined; // the database recovers
  w.store.clear(); w.calls.length = 0;
  const after = (await w.svc.seasons()).past as Record<string, unknown[]>[];
  assert.strictEqual(after[0]!.rhythm!.length, 1); // read again, and right this time
  assert.strictEqual(w.count('activity', true), 4);
  assert.strictEqual(w.svc.pastSeasonsHeld(), 2);
});

test('a kept season is read again after about half an hour, so removed rows disappear', async () => {
  let cheat = true;
  const w = world({ sealed: [season(41)], rows: (_g, _f, to) => (to ? (cheat ? [act(1, 9999), act(2, 10)] : [act(2, 10)]) : []) });
  const top = async () => { w.store.clear(); return (((await w.svc.seasons()).past as Record<string, { score: number }[]>[])[0]!.rhythm as { score: number }[])[0]!.score; };
  assert.strictEqual(await top(), 9999);
  cheat = false; // an admin deletes the row
  w.state.clock += 20 * 60_000;
  assert.strictEqual(await top(), 9999); // not yet
  w.state.clock += 26 * 60_000; // past the longest any season is kept (45 minutes)
  w.calls.length = 0;
  assert.strictEqual(await top(), 10);
  assert.strictEqual(w.count('activity', true), 4);
  // if that re-read itself fails, the table already held is served, not a hole
  w.state.clock += 46 * 60_000;
  w.state.failRead = (_g, to) => !!to;
  assert.strictEqual(await top(), 10);
  // and it can be dropped on demand
  w.state.failRead = undefined;
  w.svc.flush();
  assert.strictEqual(w.svc.pastSeasonsHeld(), 0);
});

test('a season that ended minutes ago is not kept yet: a late score can still land in it', async () => {
  const w = world({ sealed: [season(41)], rows: () => [act(1, 10)] });
  w.state.clock = 42_000 * 1000 + 9 * 60_000; // nine minutes after it ended
  await w.svc.seasons();
  assert.strictEqual(w.svc.pastSeasonsHeld(), 0);
  w.store.clear(); w.calls.length = 0;
  await w.svc.seasons();
  assert.strictEqual(w.count('activity', true), 4); // read fresh again
  w.state.clock = 42_000 * 1000 + 10 * 60_000; // settled
  w.store.clear();
  await w.svc.seasons();
  assert.strictEqual(w.svc.pastSeasonsHeld(), 1);
});

test('names from a failed lookup are not kept: the next request asks again', async () => {
  const w = world({ sealed: [season(41)], rows: (_g, _f, to) => (to ? [act(1, 10)] : []), names: { [W(1).toLowerCase()]: 'ada' }, failNames: true });
  const nameOf = async () => { w.store.clear(); return (((await w.svc.seasons()).past as Record<string, { username: unknown }[]>[])[0]!.rhythm as { username: unknown }[])[0]!.username; };
  assert.strictEqual(await nameOf(), null); // the chain could not be asked
  w.state.failNames = false;
  assert.strictEqual(await nameOf(), 'ada'); // one request later, not ten minutes later
});

test('two visitors arriving together share one read of each finished season', async () => {
  const w = world({ sealed: [season(41), season(40)], rows: () => [act(1, 10)], slowDb: true });
  const [a, b] = await Promise.all([w.svc.seasons(), w.svc.seasons()]);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(w.count('activity', true), 8); // not 16
  assert.strictEqual(w.count('activity'), 12); // and one set of live reads, not two
  assert.strictEqual(w.count('sealed'), 1);
});

test('a database failure is an error for that request and poisons nothing', async () => {
  const w = world({ sealed: [season(41)] });
  let fail = true;
  const real = w.deps.topActivity;
  w.deps.topActivity = async (g, f, t) => { if (fail && t) throw new Error('db down'); return real(g, f, t); };
  // (a port that throws outright, rather than reporting ok: false)
  const svc = createSeasonsService(w.deps);
  await assert.rejects(svc.seasons(), /db down/);
  assert.strictEqual(svc.pastSeasonsHeld(), 0); // a failed read is not remembered as an empty season
  assert.strictEqual(w.store.size, 0);
  fail = false;
  assert.strictEqual(((await svc.seasons()).past as unknown[]).length, 1);
});

test('over HTTP, and the adapters', async () => {
  const w = world({ sealed: [season(41)] });
  let broken = false;
  const sealed = w.deps.sealedSeasons;
  const app = express();
  const svc = registerSeasonsRoutes(app, { ...w.deps, sealedSeasons: async () => { if (broken) throw new Error('db exploded'); return sealed(); } });
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/seasons`;
  try {
    const r = await fetch(url, { headers: { origin: 'https://gamearenahq.xyz' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(((await r.json()) as { currentSeason: number }).currentSeason, 42);
    broken = true; w.store.clear();
    const bad = await fetch(url);
    assert.deepStrictEqual([bad.status, await bad.json()], [500, { error: 'Failed to load' }]);
    assert.strictEqual(typeof svc.seasons, 'function'); // server.js keeps this to warm up at boot
  } finally {
    server.close();
  }
  const seen: unknown[][] = [];
  const db = (data: unknown) => ({ from: (t: string) => { const q: Record<string, unknown> = {}; const step = (n: string) => (...a: unknown[]) => { seen.push([t, n, ...a]); return q; }; Object.assign(q, { select: step('select'), eq: step('eq'), gte: step('gte'), lt: step('lt'), order: (...a: unknown[]) => { seen.push([t, 'order', ...a]); return Object.assign(Promise.resolve({ data }), q); }, limit: async (n: number) => { seen.push([t, 'limit', n]); return { data }; } }); return q; } });
  assert.deepStrictEqual(await supabaseTopActivity(db([act(1, 5)]))('stack', 'A', 'B'), { rows: [act(1, 5)], ok: true });
  assert.deepStrictEqual(seen, [['activity', 'select', 'wallet_address, score, game_time, wagered, created_at, tx_hash'], ['activity', 'eq', 'game', 'stack'], ['activity', 'gte', 'created_at', 'A'], ['activity', 'lt', 'created_at', 'B'], ['activity', 'order', 'score', { ascending: false }], ['activity', 'limit', 500]]);
  seen.length = 0;
  assert.deepStrictEqual(await supabaseTopActivity(db(null))('stack', 'A', null), { rows: [], ok: false }); // no data is a failed read, not an empty game
  assert.deepStrictEqual(await supabaseTopActivity(db([]))('stack', 'A', null), { rows: [], ok: true }); // nobody played
  const errDb = { from: () => { const q: Record<string, unknown> = {}; Object.assign(q, { select: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q, limit: async () => ({ data: [act(1, 5)], error: { message: '' } }) }); return q; } };
  assert.strictEqual((await supabaseTopActivity(errDb)('stack', 'A', 'B')).ok, false); // an error object is a failure even with an empty message
  assert.ok(!seen.some((c) => c[1] === 'lt')); // the live window has no upper bound
  seen.length = 0;
  assert.deepStrictEqual(await supabaseSealedSeasons(db([season(1)]))(), [season(1)]);
  assert.deepStrictEqual(seen, [['seasons', 'select', '*'], ['seasons', 'eq', 'sealed', true], ['seasons', 'order', 'season_number', { ascending: false }]]);
  assert.deepStrictEqual(await supabaseSealedSeasons(db(null))(), []);
});
