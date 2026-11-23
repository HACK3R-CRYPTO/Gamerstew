import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { catchAsync, fetchWithTimeout, hardenApp, installErrorHandlers } from './http';

async function serve(build: (app: express.Application) => void, stopping = { now: false }) {
  const logs: string[] = [];
  const app = express();
  catchAsync(app);
  hardenApp(app, { isStopping: () => stopping.now });
  app.use(express.json({ limit: '1kb' }));
  build(app);
  installErrorHandlers(app, { log: (m, e) => logs.push(`${m} ${(e as Error)?.message ?? e}`) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, init?: RequestInit) => { const r = await fetch(base + path, init); const text = await r.text(); let body: unknown = text; try { body = JSON.parse(text); } catch { /* not json */ } return { status: r.status, body, headers: r.headers, text }; };
  return { call, logs, close: () => server.close() };
}

test('an async handler that rejects, and a sync one that throws, are both answered', async () => {
  const s = await serve((app) => {
    app.get('/async', async () => { throw new Error('db exploded: password=hunter2'); });
    app.get('/sync', () => { throw new Error('boom'); });
    app.post('/late', async (_req, res) => { res.json({ ok: true }); throw new Error('after the reply'); });
    app.get('/chain', (_req, _res, next) => next(), async () => { throw new Error('second handler'); });
    app.get('/array', [async () => { throw new Error('in an array'); }]);
    app.get('/fine', async (_req, res) => { res.json({ ok: true }); });
  });
  try {
    for (const p of ['/async', '/sync', '/chain', '/array']) {
      const r = await s.call(p);
      assert.strictEqual(r.status, 500, p);
      assert.deepStrictEqual(Object.keys(r.body as object), ['error', 'requestId']);
      assert.strictEqual((r.body as { error: string }).error, 'Internal error');
      assert.ok(!r.text.includes('hunter2') && !r.text.includes('at ')); // no message, no stack trace, ever
    }
    assert.strictEqual(s.logs.length, 4);
    assert.ok(s.logs[0]!.includes('GET /async failed') && s.logs[0]!.includes('hunter2')); // the detail goes to OUR log
    assert.deepStrictEqual((await s.call('/late', { method: 'POST' })).body, { ok: true }); // a reply already sent stands
    assert.deepStrictEqual((await s.call('/fine')).body, { ok: true });
  } finally { s.close(); }
});

test('the request id is returned, logged, and taken from the platform when it sends one', async () => {
  const s = await serve((app) => { app.get('/x', async () => { throw new Error('x'); }); });
  try {
    const own = await s.call('/x');
    const id = own.headers.get('x-request-id')!;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.strictEqual((own.body as { requestId: string }).requestId, id);
    assert.ok(s.logs[0]!.includes(`[${id}]`));
    assert.strictEqual((await s.call('/x', { headers: { 'x-railway-request-id': 'H1hwnX-ZTTGLPvcMs_GTAg' } })).headers.get('x-request-id'), 'H1hwnX-ZTTGLPvcMs_GTAg');
    const forged = await s.call('/x', { headers: { 'x-request-id': '<script>alert(1)</script>' } });
    assert.match(forged.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/); // a hostile id is not echoed back
  } finally { s.close(); }
});

test('errors are JSON: bad body 400, too large 413, unknown path 404', async () => {
  const s = await serve((app) => { app.post('/echo', (req, res) => { res.json(req.body); }); });
  const json = { 'content-type': 'application/json' };
  try {
    assert.deepStrictEqual(await s.call('/echo', { method: 'POST', headers: json, body: '{not json' }).then((r) => [r.status, r.body]), [400, { error: 'Invalid JSON body' }]);
    assert.deepStrictEqual(await s.call('/echo', { method: 'POST', headers: json, body: JSON.stringify({ a: 'x'.repeat(5000) }) }).then((r) => [r.status, r.body]), [413, { error: 'Request body too large' }]);
    assert.deepStrictEqual(await s.call('/nowhere').then((r) => [r.status, r.body]), [404, { error: 'Not found', path: '/nowhere' }]);
    assert.strictEqual(s.logs.length, 0); // a client's mistake is not our error
    assert.deepStrictEqual((await s.call('/echo', { method: 'POST', headers: json, body: '{"a":1}' })).body, { a: 1 });
  } finally { s.close(); }
});

test('security headers on every reply, and nothing that names the framework', async () => {
  const s = await serve((app) => { app.get('/ok', (_q, res) => { res.json({}); }); });
  try {
    for (const p of ['/ok', '/nowhere', '/healthz']) {
      const h = (await s.call(p)).headers;
      assert.strictEqual(h.get('x-powered-by'), null, p);
      assert.strictEqual(h.get('x-content-type-options'), 'nosniff', p);
      assert.strictEqual(h.get('x-frame-options'), 'DENY', p);
      assert.strictEqual(h.get('referrer-policy'), 'no-referrer', p);
    }
  } finally { s.close(); }
});

test('/healthz is free and tells the platform when we are shutting down', async () => {
  const stopping = { now: false };
  const s = await serve(() => {}, stopping);
  try {
    const up = await s.call('/healthz');
    assert.strictEqual(up.status, 200);
    assert.strictEqual((up.body as { status: string }).status, 'ok');
    stopping.now = true;
    assert.deepStrictEqual(await s.call('/healthz').then((r) => [r.status, r.body]), [503, { status: 'stopping' }]);
  } finally { s.close(); }
});

test('app.get(name) still reads a setting; error handlers are not wrapped', () => {
  const app = express();
  catchAsync(app);
  app.set('trust proxy', 1);
  assert.strictEqual(app.get('trust proxy'), 1);
  const four = (_e: unknown, _q: unknown, _s: unknown, _n: unknown) => {};
  app.use(four as express.ErrorRequestHandler); // untouched: still recognised as an error handler by its 4 arguments
});

test('fetchWithTimeout gives up on a server that never answers, and keeps the signal a caller passes', async () => {
  const hang = express();
  hang.get('/', () => { /* never replies */ });
  const server = hang.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    const t0 = Date.now();
    await assert.rejects(fetchWithTimeout(80)(url), (e: Error) => e.name === 'TimeoutError');
    assert.ok(Date.now() - t0 < 1500);
    const seen: (AbortSignal | null | undefined)[] = [];
    const spy = (async (_i: unknown, init?: RequestInit) => { seen.push(init?.signal); return new Response('ok'); }) as typeof fetch;
    const mine = new AbortController().signal;
    await fetchWithTimeout(50, spy)('http://x', { signal: mine });
    await fetchWithTimeout(50, spy)('http://x', { method: 'POST' });
    assert.strictEqual(seen[0], mine);
    assert.ok(seen[1] instanceof AbortSignal && seen[1] !== mine);
  } finally { server.closeAllConnections(); server.close(); }
});
