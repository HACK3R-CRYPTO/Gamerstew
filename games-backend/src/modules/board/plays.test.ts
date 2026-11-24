import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerCounts, mergeCounts, playCounts, supabaseLedgerBoard, mergeBoards, type Counts, type LedgerDb, type LedgerBoardDb } from './plays';

// a fake table that records the query it was asked and serves rows in pages
function db(rows: { wallet: string | null }[], fail = false) {
  const asked: Record<string, unknown> = {};
  const d: LedgerDb = { from: (table) => { asked.table = table; return { select: (cols) => { asked.cols = cols; return { eq: (c, v) => { asked.eq = [c, v]; return { gte: (c2, v2) => { asked.gte = [c2, v2]; return { lte: (c3, v3) => { asked.lte = [c3, v3]; return { range: async (a, b) => (fail ? { data: null, error: { message: 'down' } } : { data: rows.slice(a, b + 1), error: null }) }; } }; } }; } }; } }; } };
  return { d, asked };
}
const m = (o: Record<string, number>): Counts => new Map(Object.entries(o).map(([w, count]) => [w, { username: null, count }]));

test('ledger: counts used sessions per wallet in the window, case-insensitive, across pages', async () => {
  const rows = [...Array(1500).fill({ wallet: '0xAAA' }), { wallet: '0xaaa' }, { wallet: '0xbbb' }, { wallet: null }];
  const { d, asked } = db(rows);
  const r = await ledgerCounts(d, '2026-11-23T00:00:00.000Z', '2026-11-29T23:59:59.999Z');
  assert.equal(r.ok, true);
  assert.equal(r.counts.get('0xaaa')!.count, 1501);
  assert.equal(r.counts.get('0xbbb')!.count, 1);
  assert.equal(r.counts.size, 2);
  assert.deepEqual([asked.table, asked.eq, asked.gte, asked.lte], ['game_sessions', ['used', true], ['used_at', '2026-11-23T00:00:00.000Z'], ['used_at', '2026-11-29T23:59:59.999Z']]);
});

test('ledger: a failed read says so, it is not "nobody played"', async () => {
  const r = await ledgerCounts(db([], true).d, 'a', 'b');
  assert.equal(r.ok, false);
});

test('merge: each player gets the higher of the two counts, and a name from either', () => {
  const sg: Counts = new Map([['0xA', { username: 'ada', count: 3 }], ['0xb', { username: null, count: 9 }]]);
  const out = mergeCounts(sg, m({ '0xa': 7, '0xc': 2 }));
  assert.deepEqual(out.get('0xa'), { username: 'ada', count: 7 });
  assert.deepEqual(out.get('0xb'), { username: null, count: 9 });
  assert.deepEqual(out.get('0xc'), { username: null, count: 2 });
});

test('playCounts: a stalled or failing subgraph does not zero the week', async () => {
  const { d } = db([{ wallet: '0xa' }, { wallet: '0xa' }, { wallet: '0xb' }]);
  const stalled = await playCounts({ subgraph: async () => new Map(), db: d }, 1, 2);       // answers, but has indexed nothing
  assert.equal(stalled.counts.get('0xa')!.count, 2); assert.equal(stalled.counts.size, 2);
  const down = await playCounts({ subgraph: async () => { throw new Error('403'); }, db: d }, 1, 2);
  assert.equal(down.counts.get('0xb')!.count, 1);
  assert.deepEqual(down.sources, { subgraph: false, ledger: true });
});

test('playCounts: a failing ledger still returns what the subgraph has', async () => {
  const r = await playCounts({ subgraph: async () => m({ '0xa': 4 }), db: db([], true).d }, 1, 2);
  assert.equal(r.counts.get('0xa')!.count, 4);
  assert.deepEqual(r.sources, { subgraph: true, ledger: false });
});

test('ledger board: each player\'s best run of that game since the start, best first', async () => {
  const asked: unknown[] = [];
  const rows = [{ wallet: '0xA', computed_score: 40, used_at: 't1' }, { wallet: '0xa', computed_score: 90, used_at: 't2' }, { wallet: '0xb', computed_score: 60, used_at: 't3' }, { wallet: '0xc', computed_score: null, used_at: 't4' }];
  const d: LedgerBoardDb = { from: (t) => ({ select: (c) => ({ eq: (a, av) => ({ eq: (b, bv) => ({ gte: (g, gv) => ({ range: async () => { asked.push(t, c, a, av, b, bv, g, gv); return { data: rows, error: null }; } }) }) }) }) }) };
  const board = await supabaseLedgerBoard(d)('stack', 1_700_000_000);
  assert.deepEqual(board.map((r) => `${r.wallet_address}:${r.score}`), ['0xa:90', '0xb:60']);
  assert.deepEqual(asked.slice(0, 7), ['game_sessions', 'wallet, computed_score, used_at', 'used', true, 'game', 'stack', 'used_at']);
  assert.equal(asked[7], new Date(1_700_000_000 * 1000).toISOString());
});

test('ledger board: a failed read is an empty board, not an error', async () => {
  const d: LedgerBoardDb = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ range: async () => ({ data: null, error: { message: 'down' } }) }) }) }) }) }) };
  assert.deepEqual(await supabaseLedgerBoard(d)('stack', 1), []);
});

test('mergeBoards: higher score per player wins, names are kept, best first', () => {
  type Row = { wallet_address: string; score: number; username: string | null };
  const sg: Row[] = [{ wallet_address: '0xA', score: 50, username: 'ada' }, { wallet_address: '0xb', score: 80, username: 'bo' }];
  const ledger: Row[] = [{ wallet_address: '0xa', score: 70, username: null }, { wallet_address: '0xc', score: 10, username: null }];
  assert.deepEqual(mergeBoards(sg, ledger).map((r) => [r.wallet_address.toLowerCase(), r.score, r.username]), [['0xb', 80, 'bo'], ['0xa', 70, 'ada'], ['0xc', 10, null]]);
});
