import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoardService, type BoardDeps, type BoardRow } from './service';
import { createResultCache } from '../../platform/resultCache';

// A crowd opening the same board must cost the database one read, not one each.
test('a thousand people opening a board at once cost one read of each record', async () => {
  let subgraphReads = 0, ledgerReads = 0, nameLookups = 0;
  const row = (i: number): BoardRow => ({ wallet_address: `0x${i.toString(16).padStart(40, '0')}`, score: 1000 - i, username: null, created_at: new Date(1_700_000_000_000).toISOString(), tx_hash: null });
  const deps: BoardDeps = {
    gameTypes: { stack: 2 },
    currentSeason: () => 1,
    seasonBounds: () => ({ start: 1_700_000_000, end: 1_700_600_000 }),
    subgraph: {
      leaderboard: async () => { subgraphReads++; await new Promise((r) => setTimeout(r, 15)); return []; },
      recentActivity: async () => [], globalStats: async () => null, seasonPlayerIds: async () => [],
    },
    ledgerBoard: async () => { ledgerReads++; await new Promise((r) => setTimeout(r, 15)); return Array.from({ length: 120 }, (_, i) => row(i)); },
    results: createResultCache(),
    streaks: async () => new Map(),
    resolveUsername: async () => { nameLookups++; return 'someone'; },
    treasuryBalance: async () => '0',
    cache: { get: () => undefined, set: () => undefined },
    statsTtlMs: 1000,
  };
  const svc = createBoardService(deps);
  const replies = await Promise.all(Array.from({ length: 1000 }, () => svc.leaderboard({ game: 'stack', limit: '20' })));
  assert.equal(subgraphReads, 1);
  assert.equal(ledgerReads, 1);
  for (const r of replies) { assert.equal(r.status, 200); assert.equal((r.body as { total: number }).total, 120); assert.equal((r.body as { leaderboard: unknown[] }).leaderboard.length, 20); }
  // a second wave inside the cache window reads nothing new
  await Promise.all(Array.from({ length: 200 }, () => svc.leaderboard({ game: 'stack', limit: '20', page: '2' })));
  assert.equal(subgraphReads, 1); assert.equal(ledgerReads, 1);
  assert.ok(nameLookups <= 1200 * 20); // names are looked up per page shown, never for the whole board
});

test('a board row carries the transaction that recorded it, and a failed lookup leaves the board as it was', async () => {
  const { withTransactions, TX_ROWS } = await import('./plays');
  const rows = [{ wallet_address: '0xaa', score: 90, username: null, created_at: 'x', tx_hash: null }, { wallet_address: '0xbb', score: 70, username: null, created_at: 'x', tx_hash: null }, { wallet_address: '0xcc', score: 10, username: null, created_at: 'x', tx_hash: '0xkept' }];
  const asked: unknown[] = [];
  const chain = (data: unknown, error: unknown = null) => { const q: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'gte', 'in', 'not', 'order']) q[m] = (...a: unknown[]) => { asked.push([m, ...a]); return q; }; q.limit = (n: number) => { asked.push(['limit', n]); return Promise.resolve({ data, error }); }; return q; };
  // activity comes back best first; 0xaa has two saved runs, 0xbb none with a transaction
  const db = { from: () => chain([{ wallet_address: '0xAA', score: 90, tx_hash: '0xbest' }, { wallet_address: '0xaa', score: 40, tx_hash: '0xold' }]) };
  const out = await withTransactions(db as never, 'ladder', 1000, rows);
  assert.deepEqual(out.map((r) => r.tx_hash), ['0xbest', null, '0xkept']);
  assert.ok(asked.some((a) => Array.isArray(a) && a[0] === 'in' && JSON.stringify(a[2]) === '["0xaa","0xbb"]'), 'only rows without a transaction are looked up');
  assert.ok(asked.some((a) => Array.isArray(a) && a[0] === 'limit' && a[1] === TX_ROWS * 6), 'the read is bounded');
  assert.deepEqual(await withTransactions({ from: () => chain(null, { message: 'down' }) } as never, 'ladder', 1000, rows), rows);
  assert.deepEqual(await withTransactions({ from: () => { throw new Error('boom'); } } as never, 'ladder', 1000, rows), rows);
});

test('the activity feed comes from our own saved runs, with names, and only falls back to the subgraph when that read fails', async () => {
  const base = { gameTypes: { stack: 2 }, currentSeason: () => 1, seasonBounds: () => ({ start: 0, end: 9 }), streaks: async () => new Map(), treasuryBalance: async () => 0 } as unknown as BoardDeps;
  const asked: string[] = [];
  const subgraph = { leaderboard: async () => [], recentActivity: async () => { asked.push('subgraph'); return [{ wallet_address: '0xold', game: 'stack', score: 1, username: null, created_at: '2026-10-01T00:00:00Z', tx_hash: '0xoldtx' }] as BoardRow[]; }, globalStats: async () => null, seasonPlayerIds: async () => [] };
  const own = createBoardService({ ...base, subgraph, resolveUsername: async (w: string) => (w === '0xaa' ? 'ada' : null), recentPlays: async (limit: number, player: string | null) => { asked.push(`own ${limit} ${player}`); return { ok: true, rows: [{ wallet_address: '0xaa', game: 'ladder', score: 58, username: null, created_at: '2026-11-24T09:05:30Z', tx_hash: '0xtx' }] }; } } as unknown as BoardDeps);
  const r = await own.activity({});
  assert.deepEqual((r.body.activity as unknown[])[0], { player: '0xaa', game: 'ladder', score: 58, tx_hash: '0xtx', timestamp: Math.floor(Date.parse('2026-11-24T09:05:30Z') / 1000), username: 'ada' });
  assert.deepEqual(asked, ['own 10 null']);
  await own.activity({ player: '0xAA' }); assert.equal(asked[1], 'own 30 0xAA');
  const down = createBoardService({ ...base, subgraph, resolveUsername: async () => null, recentPlays: async () => ({ ok: false, rows: [] }) } as unknown as BoardDeps);
  assert.equal(((await down.activity({})).body.activity as { player: string }[])[0]!.player, '0xold');
});

test('all-time totals keep moving after the subgraph stops: runs saved since are added, and totals never go back', async () => {
  const base = { gameTypes: { stack: 2 }, currentSeason: () => 1, seasonBounds: () => ({ start: 0, end: 9 }), streaks: async () => new Map(), treasuryBalance: async () => '0', resolveUsername: async () => null, cache: { get: () => undefined, set: () => {} } } as unknown as BoardDeps;
  const subgraph = { leaderboard: async () => [], recentActivity: async () => [], globalStats: async () => ({ totalPlayers: 974, totalScores: 63948 }), seasonPlayerIds: async () => [] };
  const asked: string[] = [];
  const own = (players: number | null, since: number | null, head = 1_793_400_000) => ({ players: async () => players, runsSince: async (iso: string) => { asked.push(iso); return since; }, subgraphHeadSec: async () => head });
  const run = async (o?: ReturnType<typeof own>) => (await createBoardService({ ...base, subgraph, ...(o ? { own: o } : {}) } as unknown as BoardDeps).stats()).body as { totalUsers: number; totalGames: number };
  assert.deepEqual(await run().then((b) => [b.totalUsers, b.totalGames]), [974, 63948]);            // nothing of our own: as before
  assert.deepEqual(await run(own(981, 12)).then((b) => [b.totalUsers, b.totalGames]), [981, 63960]); // more players, 12 runs since
  assert.equal(asked[0], new Date(1_793_400_000 * 1000).toISOString());
  assert.deepEqual(await run(own(600, null)).then((b) => [b.totalUsers, b.totalGames]), [974, 63948]); // a smaller or failed count never lowers a total
  assert.deepEqual(await run(own(981, 99, 0)).then((b) => [b.totalUsers, b.totalGames]), [981, 63948]); // head unknown: no guess at what is new
});
