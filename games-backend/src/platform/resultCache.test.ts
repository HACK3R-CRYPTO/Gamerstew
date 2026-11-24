import test from 'node:test';
import assert from 'node:assert';
import { createResultCache, eventTtl } from './resultCache';

test('an answer is worked out once and then served until it expires', async () => {
  let t = 0, n = 0;
  const c = createResultCache({ now: () => t });
  const get = () => c.get('k', { ttlMs: 100, compute: async () => ++n });
  assert.deepStrictEqual([await get(), await get()], [1, 1]);
  t = 99; assert.strictEqual(await get(), 1);
  t = 100; assert.strictEqual(await get(), 2); // expired exactly at its lifetime
  assert.strictEqual(n, 2);
});

test('a failure is never remembered, and an older answer is served if there is one', async () => {
  let t = 0, fail = true;
  const logs: string[] = [];
  const c = createResultCache({ now: () => t, log: (m) => logs.push(m) });
  const get = () => c.get('k', { ttlMs: 100, compute: async () => { if (fail) throw new Error('db down'); return 'table'; } });
  await assert.rejects(get(), /db down/); // nothing held yet: the caller sees the failure
  assert.strictEqual(c.size(), 0);
  fail = false;
  assert.strictEqual(await get(), 'table'); // and the very next request tries again
  t = 500; fail = true;
  assert.strictEqual(await get(), 'table'); // refresh failed: the previous table, not an error
  assert.strictEqual(logs.length, 1);
  fail = false;
  assert.strictEqual(await get(), 'table'); // still expired, so it refreshes now that it can
});

test('visitors arriving together share one piece of work', async () => {
  let n = 0;
  const c = createResultCache();
  const slow = () => c.get('k', { ttlMs: 1000, compute: async () => { n++; await new Promise((r) => setImmediate(r)); return n; } });
  assert.deepStrictEqual(await Promise.all([slow(), slow(), slow()]), [1, 1, 1]);
  assert.strictEqual(n, 1);
  const f = createResultCache();
  let m = 0;
  const bad = () => f.get('k', { ttlMs: 1000, compute: async () => { m++; await new Promise((r) => setImmediate(r)); throw new Error('x'); } });
  const results = await Promise.allSettled([bad(), bad()]);
  assert.deepStrictEqual(results.map((r) => r.status), ['rejected', 'rejected']); // they share the failure too
  assert.strictEqual(m, 1);
});

test('keys are separate, it can be dropped, and it cannot grow without limit', async () => {
  const c = createResultCache({ maxEntries: 3 });
  for (const k of ['a', 'b', 'c', 'd']) await c.get(k, { ttlMs: 1000, compute: async () => k.toUpperCase() });
  assert.strictEqual(c.size(), 3);
  let recomputed = false;
  await c.get('a', { ttlMs: 1000, compute: async () => { recomputed = true; return 'A'; } }); // the oldest was evicted
  assert.strictEqual(recomputed, true);
  assert.strictEqual(await c.get('d', { ttlMs: 1000, compute: async () => 'nope' }), 'D');
  c.drop('d');
  assert.strictEqual(await c.get('d', { ttlMs: 1000, compute: async () => 'fresh' }), 'fresh');
  c.drop();
  assert.strictEqual(c.size(), 0);
});

test('eventTtl: short while an event runs, long once it has settled', () => {
  const end = 1_000_000;
  assert.strictEqual(eventTtl(end, end - 1), 10_000); // still running
  assert.strictEqual(eventTtl(end, end + 9 * 60_000), 10_000); // just over: a late write can still land
  assert.strictEqual(eventTtl(end, end + 10 * 60_000), 30 * 60_000); // settled
  assert.strictEqual(eventTtl(end, end + 1e9, 5, 7), 7);
});
