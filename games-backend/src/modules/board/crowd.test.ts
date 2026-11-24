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
