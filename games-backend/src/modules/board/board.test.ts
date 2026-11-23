import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { createBoardService, paging, type BoardDeps, type BoardRow, type GlobalStat } from './service';
import { registerBoardRoutes } from './routes';
import { subgraphSeasonPlayers, supabaseStreaks } from './adapters';

const row = (n: number, score: number, extra: Partial<BoardRow> = {}): BoardRow => ({ wallet_address: `0xAA${String(n).padStart(38, '0')}`, score, username: `p${n}`, created_at: '2026-11-23T10:00:00Z', tx_hash: `0xtx${n}`, ...extra });
const T = Date.parse('2026-11-23T10:00:00Z') / 1000;

function world(over: { boards?: Record<number, BoardRow[]>; noStreaks?: boolean; board?: BoardRow[]; activity?: BoardRow[]; stats?: GlobalStat | null; down?: string[]; names?: Record<string, string>; treasury?: string; seasonIds?: string[] } = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const store = new Map<string, unknown>();
  const down = (n: string) => { if (over.down?.includes(n)) throw new Error(`${n} down`); };
  const deps: BoardDeps = {
    gameTypes: { rhythm: 0, simon: 1, stack: 2, nepa: 4 },
    currentSeason: () => 42,
    seasonBounds: (s) => ({ start: 1000 + s, end: 2000 + s }),
    subgraph: {
      leaderboard: async (g, start, limit) => { calls.push(['leaderboard', g, start, limit]); down('leaderboard'); const b = over.boards ? over.boards[g] ?? [] : over.board ?? []; return limit ? b.slice(0, limit) : b; },
      recentActivity: async (limit, player) => { calls.push(['activity', limit, player]); down('activity'); return over.activity ?? []; },
      globalStats: async () => { calls.push(['globalStats']); down('globalStats'); return over.stats === undefined ? null : over.stats; },
      seasonPlayerIds: async (since) => { calls.push(['seasonIds', since]); down('seasonIds'); return over.seasonIds ?? []; },
    },
    streaks: async (wallets) => { calls.push(['streaks', wallets]); return over.noStreaks ? new Map() : new Map(wallets.map((w, i) => [w, i === 0 ? 7 : 0])); },
    resolveUsername: async (w) => { calls.push(['name', w]); if (w.endsWith('dead')) throw new Error('rpc'); return over.names?.[w]; },
    treasuryBalance: async () => { down('treasury'); return over.treasury ?? '123.456'; },
    cache: { get: (k) => store.get(k), set: (k, v, ttl) => { calls.push(['cacheSet', k, ttl]); store.set(k, v); } },
    statsTtlMs: 60_000,
    logger: { warn: (m, ...e) => logs.push([m, ...e].join(' ')) },
  };
  return { deps, calls, logs, store, svc: createBoardService(deps) };
}

test('paging: page or offset, a ceiling of 50, sensible defaults', () => {
  assert.deepStrictEqual(paging({}), { limit: 20, offset: 0, page: 1, start: 0 });
  assert.deepStrictEqual(paging({ page: '3' }), { limit: 20, offset: 0, page: 3, start: 40 });
  assert.deepStrictEqual(paging({ page: '2', limit: '10' }), { limit: 10, offset: 0, page: 2, start: 10 });
  assert.deepStrictEqual(paging({ limit: '500' }), { limit: 50, offset: 0, page: 1, start: 0 }); // nobody pulls the whole board in one go
  assert.deepStrictEqual(paging({ offset: '30', page: '9' }), { limit: 20, offset: 30, page: null, start: 30 }); // an offset wins
  assert.deepStrictEqual(paging({ page: '0' }), { limit: 20, offset: 0, page: 1, start: 0 });
  assert.deepStrictEqual(paging({ page: '-4', offset: '-9' }), { limit: 20, offset: 0, page: 1, start: 0 });
  for (const limit of ['0', '-5', 'abc', '']) assert.strictEqual(paging({ limit }).limit, 20, `limit ${limit}`); // never a zero or negative page
  assert.deepStrictEqual(paging({ limit: ['7', '9'], page: ['2'] }), { limit: 7, offset: 0, page: 2, start: 7 }); // a repeated parameter uses its first value
  assert.strictEqual(paging({ limit: '1' }).limit, 1); // one row is a real page
  assert.strictEqual(paging({ limit: '5.9' }).limit, 5); // whole numbers, read the way a query string always was
  assert.strictEqual(paging({ limit: '7abc' }).limit, 7);
  assert.deepStrictEqual(paging({ offset: '1' }), { limit: 20, offset: 1, page: null, start: 1 }); // any offset above zero is offset style
  assert.deepStrictEqual(paging({ limit: { a: '1' }, page: { a: '2' } }), { limit: 20, offset: 0, page: 1, start: 0 }); // nonsense is "not given"
});

test('leaderboard: this season, one page, streaks joined in one read', async () => {
  const board = Array.from({ length: 45 }, (_, i) => row(i, 1000 - i));
  const w = world({ board });
  const r = await w.svc.leaderboard({ game: 'stack', page: '2', limit: '20' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(Object.keys(r.body), ['leaderboard', 'total', 'page', 'limit', 'pages']);
  assert.deepStrictEqual([r.body.total, r.body.page, r.body.limit, r.body.pages], [45, 2, 20, 3]);
  const rows = r.body.leaderboard as Record<string, unknown>[];
  assert.strictEqual(rows.length, 20);
  assert.deepStrictEqual(rows[0], { player: board[20]!.wallet_address, score: 980, timestamp: T, tx_hash: '0xtx20', username: 'p20', streak: 7 }); // address as the chain has it
  assert.strictEqual(rows[1]!.streak, 0);
  assert.deepStrictEqual(w.calls[0], ['leaderboard', 2, 1042, undefined]); // stack's on-chain type, this season's start, no cap
  assert.deepStrictEqual(w.calls[1], ['streaks', board.slice(20, 40).map((b) => b.wallet_address.toLowerCase())]); // one read, lower-cased
  assert.strictEqual(w.calls.length, 2);
  // offset style: page is null and the page count is of what remains
  const o = await w.svc.leaderboard({ game: 'stack', offset: '40' });
  assert.deepStrictEqual([o.body.page, o.body.pages, (o.body.leaderboard as unknown[]).length], [null, 1, 5]);
  assert.strictEqual(o.body.total, 45); // total is always the whole board, never what is left
  const beyond = await w.svc.leaderboard({ game: 'stack', offset: '90' });
  assert.deepStrictEqual([beyond.body.total, beyond.body.pages], [45, 0]); // never a negative page count
  // a player with no streak row shows 0; a time between seconds is rounded down
  const bare = world({ noStreaks: true, board: [row(1, 5, { created_at: '2026-11-23T10:00:00.900Z' })] });
  const only = ((await bare.svc.leaderboard({ game: 'rhythm' })).body.leaderboard as Record<string, unknown>[])[0]!;
  assert.deepStrictEqual([only.streak, only.timestamp], [0, T]);
  // past the end, and an empty board: no streak read at all
  const past = world({ board });
  assert.deepStrictEqual((await past.svc.leaderboard({ game: 'stack', page: '9' })).body.leaderboard, []);
  assert.ok(!past.calls.some((c) => c[0] === 'streaks'));
});

test('leaderboard: unknown game is refused; a subgraph outage is an empty board, not an error', async () => {
  for (const game of [undefined, 'chess', 'toString', ['rhythm', 'simon'], ['rhythm'], { a: 'rhythm' }]) assert.deepStrictEqual(await world().svc.leaderboard({ game }), { status: 400, body: { error: 'game must be rhythm or simon' } });
  const w = world({ down: ['leaderboard'] });
  assert.deepStrictEqual(await w.svc.leaderboard({ game: 'rhythm' }), { status: 200, body: { leaderboard: [], total: 0, page: 1, limit: 20, pages: 0 } });
  assert.deepStrictEqual(w.logs, ['subgraph leaderboard failed: leaderboard down']);
});

test('usernames: valid wallets only, de-duplicated, capped, and a failed lookup is null', async () => {
  const a = '0x' + 'a'.repeat(40), b = '0x' + 'b'.repeat(40), dead = '0x' + 'c'.repeat(36) + 'dead';
  const w = world({ names: { [a]: 'ada' } });
  const r = await w.svc.usernames({ wallets: ` ${a.toUpperCase().replace('0X', '0x')}, ${a} ,nonsense,0x123,${b},${dead}` });
  assert.deepStrictEqual(r.body, { usernames: { [a]: 'ada', [b]: null, [dead]: null } });
  assert.strictEqual(w.calls.filter((c) => c[0] === 'name').length, 3); // the duplicate was asked once
  assert.deepStrictEqual((await world().svc.usernames({})).body, { usernames: {} });
  // only exact 40-hex addresses are looked up: nothing longer, shorter, prefixed, or with other letters
  const strict = world();
  await strict.svc.usernames({ wallets: [`x${a}`, `${a}ff`, '0x' + 'g'.repeat(40), '0x' + 'a'.repeat(39), ` ${b} `].join(',') });
  assert.deepStrictEqual(strict.calls, [['name', b]]);
  const blank = world({ names: { [a]: '' } }); // a wallet with an empty name has no name
  assert.deepStrictEqual((await blank.svc.usernames({ wallets: a })).body, { usernames: { [a]: null } });
  assert.deepStrictEqual((await world().svc.usernames({ wallets: '   ' })).body, { usernames: {} });
  const many = world();
  await many.svc.usernames({ wallets: Array.from({ length: 600 }, (_, i) => '0x' + i.toString(16).padStart(40, '0')).join(',') });
  assert.strictEqual(many.calls.length, 500);
});

test('activity: ten for the feed, thirty for one player', async () => {
  const feed = world({ activity: [row(1, 50, { game: 'simon' })] });
  assert.deepStrictEqual((await feed.svc.activity({})).body, { activity: [{ player: row(1, 50).wallet_address, game: 'simon', score: 50, tx_hash: '0xtx1', timestamp: T, username: 'p1' }] });
  assert.deepStrictEqual(feed.calls[0], ['activity', 10, null]);
  const one = world();
  await one.svc.activity({ player: '0xabc' });
  assert.deepStrictEqual(one.calls[0], ['activity', 30, '0xabc']);
  const mixed = world();
  await mixed.svc.activity({ player: '0xAbC' });
  assert.deepStrictEqual(mixed.calls[0], ['activity', 30, '0xAbC']); // passed on exactly as asked
  const odd = world();
  await odd.svc.activity({ player: ['0xa', '0xb'] }); // a repeated parameter is not a player
  assert.deepStrictEqual(odd.calls[0], ['activity', 10, null]);
  const down = world({ down: ['activity'] });
  assert.deepStrictEqual((await down.svc.activity({})).body, { activity: [] });
  assert.deepStrictEqual(down.logs, ['subgraph activity failed: activity down']);
});

test('stats: the headline numbers, then served from the cache', async () => {
  const stats: GlobalStat = { totalPlayers: '120', totalScores: '4000', totalRhythmPlays: '2500', totalSimonPlays: '900', totalWageredG: '12345678900000000000', totalUbiDonatedG: '5000000000000000000', totalTreasuryG: null, totalHabitatUnlocks: '14' };
  const w = world({ stats, boards: { 0: [row(1, 777)], 1: [row(2, 31)] }, seasonIds: ['0xa', '0xb', '0xa'] });
  const r = await w.svc.stats();
  assert.deepStrictEqual(r.body, { totalUsers: 120, seasonUsers: 2, totalGames: 4000, rhythmPlayers: 2500, simonPlayers: 900, topRhythm: 777, topSimon: 31, totalWagered: '12.34', currentSeason: 42, seasonEndsAt: 2042, estimatedPrizePot: '12.35', totalUbiDonatedG: '5000000000000000000', totalTreasuryG: '0', totalHabitatUnlocks: 14 });
  assert.deepStrictEqual(Object.keys(r.body), ['totalUsers', 'seasonUsers', 'totalGames', 'rhythmPlayers', 'simonPlayers', 'topRhythm', 'topSimon', 'totalWagered', 'currentSeason', 'seasonEndsAt', 'estimatedPrizePot', 'totalUbiDonatedG', 'totalTreasuryG', 'totalHabitatUnlocks']);
  assert.deepStrictEqual(w.calls, [['globalStats'], ['seasonIds', 1042], ['leaderboard', 0, 1042, 1], ['leaderboard', 1, 1042, 1], ['cacheSet', 'stats:global', 60_000]]);
  const before = w.calls.length;
  assert.deepStrictEqual((await w.svc.stats()).body, r.body);
  assert.strictEqual(w.calls.length, before); // second read cost nothing
});

test('stats: a subgraph row with holes in it still gives clean numbers', async () => {
  const w = world({ stats: { totalPlayers: '9', totalScores: 'oops', totalRhythmPlays: undefined, totalSimonPlays: null, totalWageredG: null, totalUbiDonatedG: null, totalTreasuryG: '77', totalHabitatUnlocks: '2' }, treasury: '100abc' });
  const b = (await w.svc.stats()).body;
  assert.deepStrictEqual([b.totalUsers, b.totalGames, b.rhythmPlayers, b.simonPlayers], [9, 0, 0, 0]); // never NaN on a page
  assert.deepStrictEqual([b.totalWagered, b.totalUbiDonatedG, b.totalTreasuryG], ['0.00', '0', '77']);
  assert.strictEqual(b.estimatedPrizePot, '10.00'); // reads the leading number, as before
  // an outage is cached too, for the same minute: a failing subgraph is not hammered on every page view
  const down = world({ down: ['globalStats'] });
  await down.svc.stats();
  assert.ok(down.calls.some((c) => c[0] === 'cacheSet'));
});

test('with no logger given, outages are still reported on the console', async () => {
  const w = world({ down: ['leaderboard', 'activity', 'globalStats'] });
  const { logger: _drop, ...deps } = w.deps;
  const seen: unknown[][] = [];
  const real = console.warn;
  console.warn = (...a: unknown[]) => { seen.push(a); };
  try {
    const svc = createBoardService(deps);
    await svc.leaderboard({ game: 'rhythm' });
    await svc.activity({});
    await svc.stats();
  } finally {
    console.warn = real;
  }
  assert.deepStrictEqual(seen, [['subgraph leaderboard failed:', 'leaderboard down'], ['subgraph activity failed:', 'activity down'], ['subgraph stats failed:', 'globalStats down']]);
});

test('stats: with everything down it is zeros, never an error', async () => {
  const w = world({ down: ['globalStats', 'seasonIds', 'leaderboard', 'treasury'] });
  assert.deepStrictEqual((await w.svc.stats()).body, { totalUsers: 0, seasonUsers: 0, totalGames: 0, rhythmPlayers: 0, simonPlayers: 0, topRhythm: 0, topSimon: 0, totalWagered: '0.00', currentSeason: 42, seasonEndsAt: 2042, estimatedPrizePot: '0.00', totalUbiDonatedG: '0', totalTreasuryG: '0', totalHabitatUnlocks: 0 });
  assert.deepStrictEqual(w.logs, ['subgraph stats failed: globalStats down']);
});

test('over HTTP: query strings, status codes, and a crash is answered', async () => {
  const w = world({ board: [row(1, 9)] });
  let broken = false;
  const streaks = w.deps.streaks;
  const app = express();
  registerBoardRoutes(app, { ...w.deps, streaks: async (x) => { if (broken) throw new Error('db exploded'); return streaks(x); } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };
  try {
    assert.strictEqual((await get('/api/leaderboard?game=rhythm&limit=5')).body.limit, 5);
    // every query parameter reaches the service
    assert.strictEqual((await get('/api/leaderboard?game=rhythm&offset=3')).body.page, null);
    assert.strictEqual((await get('/api/leaderboard?game=rhythm&page=4')).body.page, 4);
    assert.strictEqual((await get('/api/leaderboard?game[]=rhythm')).status, 400);
    assert.deepStrictEqual((await get('/api/usernames?wallets=0x' + 'a'.repeat(40))).body, { usernames: { ['0x' + 'a'.repeat(40)]: null } });
    await get('/api/activity?player=0xabc');
    assert.deepStrictEqual(w.calls.filter((c) => c[0] === 'activity').pop(), ['activity', 30, '0xabc']);
    // a browser sends an Origin header; the routes answer just the same
    const withOrigin = await fetch(base + '/api/stats', { headers: { origin: 'https://gamearenahq.xyz' } });
    assert.strictEqual(withOrigin.status, 200);
    assert.strictEqual((await fetch(base + '/api/stats', { method: 'POST' })).status, 404); // reads only
    assert.strictEqual((await get('/api/leaderboard')).status, 400);
    assert.deepStrictEqual((await get('/api/usernames')).body, { usernames: {} });
    assert.deepStrictEqual((await get('/api/activity')).body, { activity: [] });
    assert.strictEqual((await get('/api/stats')).body.currentSeason, 42);
    broken = true;
    assert.deepStrictEqual(await get('/api/leaderboard?game=rhythm'), { status: 500, body: { error: 'Failed to load' } });
  } finally {
    server.close();
  }
});

test('adapters: streaks in one read; season players from one subgraph query', async () => {
  const seen: unknown[][] = [];
  const db = (data: unknown) => ({ from: (t: string) => ({ select: (c: string) => ({ in: async (col: string, vals: unknown) => { seen.push([t, c, col, vals]); return { data, error: null }; } }) }) });
  const m = await supabaseStreaks(db([{ wallet_address: '0xABC', play_streak: 4 }, { wallet_address: '0xdef', play_streak: null }]))(['0xabc', '0xdef']);
  assert.deepStrictEqual([...m], [['0xabc', 4], ['0xdef', 0]]);
  assert.deepStrictEqual(seen, [['users', 'wallet_address, play_streak', 'wallet_address', ['0xabc', '0xdef']]]);
  assert.strictEqual((await supabaseStreaks(db(null))(['0xabc'])).size, 0);
  const asked: unknown[] = [];
  const ids = await subgraphSeasonPlayers(async (q, v) => { asked.push([/blockTimestamp_gte: \$s/.test(q) && /first: 500/.test(q), v]); return { scores: [{ player: { id: '0xa' } }, { player: { id: '0xb' } }] }; })(1042);
  assert.deepStrictEqual(ids, ['0xa', '0xb']);
  assert.deepStrictEqual(asked, [[true, { s: '1042' }]]); // the timestamp travels as a string, as BigInt variables must
  let text = '';
  await subgraphSeasonPlayers(async (q) => { text = q.replace(/\s+/g, ' ').trim(); return {}; })(1);
  assert.strictEqual(text, 'query SU($s: BigInt!) { scores(first: 500, where: { blockTimestamp_gte: $s }) { player { id } } }'); // the exact query
  const big = Array.from({ length: 40 }, (_, i) => `0x${i}`);
  const all: unknown[] = [];
  await supabaseStreaks({ from: () => ({ select: () => ({ in: async (_c: string, v: unknown) => { all.push(v); return { data: [] }; } }) }) })(big);
  assert.deepStrictEqual(all, [big]); // the whole page in one read, never trimmed
  assert.deepStrictEqual(await subgraphSeasonPlayers(async () => ({}))(1), []);
});
