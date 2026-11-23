import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { guardWalletFields, guardWalletParams, isWallet } from './validate';
import { createJobs } from './jobs';

const W = '0x' + 'aB'.repeat(20);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('isWallet: 0x and exactly forty hex digits, nothing else', () => {
  for (const ok of [W, W.toLowerCase(), '0x' + '0'.repeat(40)]) assert.strictEqual(isWallet(ok), true);
  for (const bad of ['', '0x', W.slice(2), W + '0', W.slice(0, -1), '0x' + 'g'.repeat(40), ` ${W}`, `${W}\n`, '%', '0x%', 'undefined', 'null', null, undefined, 5, [W], { toString: () => W }]) assert.strictEqual(isWallet(bad), false, String(bad));
});

test('a wallet in the path, the query or the body must be a wallet, before any route runs', async () => {
  const reached: string[] = [];
  const app = express();
  guardWalletParams(app);
  app.use(express.json());
  app.use(guardWalletFields());
  app.get('/api/user/:address', (req, res) => { reached.push(String(req.params.address)); res.json({ ok: true }); });
  app.get('/api/ref/:wallet/summary', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/room/:code', (_req, res) => { res.json({ ok: true }); }); // other parameters are not touched
  app.get('/api/activity', (_req, res) => { res.json({ ok: true }); });
  app.post('/api/save', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => { const r = await fetch(base + p); return [r.status, await r.json()]; };
  const post = async (b: unknown) => { const r = await fetch(base + '/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return [r.status, await r.json()]; };
  try {
    assert.deepStrictEqual(await get(`/api/user/${W}`), [200, { ok: true }]);
    for (const bad of ['undefined', '%25', '0x123', `${W}00`, 'ada']) assert.deepStrictEqual(await get(`/api/user/${bad}`), [400, { error: 'Invalid wallet address', field: 'address', in: 'path' }], bad);
    assert.deepStrictEqual(reached, [W]); // the route never saw a bad one
    assert.deepStrictEqual(await get('/api/ref/%25/summary'), [400, { error: 'Invalid wallet address', field: 'wallet', in: 'path' }]); // "%" would have matched every row
    assert.deepStrictEqual(await get('/api/room/ANYTHING'), [200, { ok: true }]);
    assert.deepStrictEqual(await get(`/api/activity?player=${W}`), [200, { ok: true }]);
    assert.deepStrictEqual(await get('/api/activity'), [200, { ok: true }]); // absent is the route's business
    assert.deepStrictEqual(await get('/api/activity?player='), [200, { ok: true }]);
    assert.deepStrictEqual(await get('/api/activity?player=%25'), [400, { error: 'Invalid wallet address', field: 'player', in: 'query' }]);
    assert.deepStrictEqual(await get(`/api/activity?wallet=${W}&wallet=${W}`), [400, { error: 'Invalid wallet address', field: 'wallet', in: 'query' }]); // a repeated value is a list, not a wallet
    assert.deepStrictEqual(await post({ playerAddress: W, score: 5 }), [200, { ok: true }]);
    assert.deepStrictEqual(await post({ score: 5 }), [200, { ok: true }]);
    assert.deepStrictEqual(await post({ playerAddress: null }), [200, { ok: true }]);
    assert.deepStrictEqual(await post({ playerAddress: { $ne: '' } }), [400, { error: 'Invalid wallet address', field: 'playerAddress', in: 'body' }]);
    assert.deepStrictEqual(await post({ wallet: '%' }), [400, { error: 'Invalid wallet address', field: 'wallet', in: 'body' }]);
    assert.deepStrictEqual(await post([{ wallet: '%' }]), [200, { ok: true }]); // not an object: nothing named to check
  } finally { server.close(); }
});

test('a job never overlaps itself, and a slow run is reported, not stacked', async () => {
  const logs: string[] = [];
  const jobs = createJobs({ log: (m) => logs.push(m) });
  let live = 0, peak = 0, runs = 0;
  jobs.every('slow', 15, async () => { live++; peak = Math.max(peak, live); runs++; await sleep(70); live--; });
  await sleep(200);
  await jobs.stopAll(200);
  assert.strictEqual(peak, 1); // never two at once
  assert.ok(runs >= 2 && runs <= 3, `runs ${runs}`); // about 200/70, not 200/15
  const st = jobs.status()[0]!;
  assert.ok(st.skipped >= 5);
  assert.strictEqual(st.runs, runs);
  assert.ok((st.lastMs ?? 0) >= 60);
  assert.strictEqual(logs.filter((l) => l.includes('previous run still going')).length, 1); // said once, not on every tick
});

test('a job that throws or rejects is logged by name and keeps running', async () => {
  const logs: string[] = [];
  const jobs = createJobs({ log: (m) => logs.push(m) });
  let n = 0;
  jobs.every('flaky', 15, () => { n++; if (n === 1) throw new Error('sync boom'); if (n === 2) return Promise.reject(new Error('async boom')); return undefined; });
  await sleep(90);
  await jobs.stopAll();
  const st = jobs.status()[0]!;
  assert.ok(n >= 3); // it carried on after both failures
  assert.strictEqual(st.failures, 2);
  assert.strictEqual(st.lastError, null); // the latest run was fine
  assert.deepStrictEqual(logs.slice(0, 2), ['⚠️  job flaky failed:', '⚠️  job flaky failed:']);
  const after = n;
  await sleep(50);
  assert.strictEqual(n, after); // stopped means stopped
});

test('stopAll waits for a run in flight, up to the limit', async () => {
  const jobs = createJobs({ log: () => {} });
  let done = false;
  const j = jobs.every('long', 10_000, async () => { await sleep(60); done = true; });
  j.runNow();
  await jobs.stopAll(500);
  assert.strictEqual(done, true);
  const stuck = createJobs({ log: () => {} });
  stuck.every('stuck', 10_000, () => new Promise(() => {})).runNow();
  const t0 = Date.now();
  await stuck.stopAll(60);
  assert.ok(Date.now() - t0 < 400); // a job that never ends does not hold shutdown hostage
});
