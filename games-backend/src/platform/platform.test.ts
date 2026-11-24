import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import { loadConfig } from './config';
import { installLifecycle } from './lifecycle';
import { createMetrics } from './metrics';

test('config reads, defaults and validates', () => {
  const c = loadConfig({ ALLOWED_ORIGINS: 'https://gamearenahq.xyz, https://preview.example.app' });
  assert.deepStrictEqual(c.allowedOrigins, ['https://gamearenahq.xyz', 'https://preview.example.app']);
  assert.strictEqual(c.port, 3005);
  assert.strictEqual(loadConfig({ ALLOWED_ORIGINS: 'http://localhost:3000', PORT: '8080' }).port, 8080);
  // a bad or missing setting never stops the server: safe default, loud warning
  const empty = loadConfig({});
  assert.deepStrictEqual(empty.allowedOrigins, []);
  assert.ok(empty.warnings.some((w) => /ALLOWED_ORIGINS is not set/.test(w)));
  const bad = loadConfig({ ALLOWED_ORIGINS: 'https://a.xyz', PORT: 'abc', SLOW_REQUEST_MS: '-5' });
  assert.strictEqual(bad.port, 3005);
  assert.strictEqual(bad.slowRequestMs, 1500);
  assert.strictEqual(bad.warnings.length, 2);
  // an unusual scheme that worked before is kept exactly as typed, with no complaint
  const app = loadConfig({ ALLOWED_ORIGINS: 'capacitor://localhost' });
  assert.deepStrictEqual(app.allowedOrigins, ['capacitor://localhost']);
  assert.strictEqual(app.warnings.length, 0);
  // a hand-typed slip is tidied and reported, never a reason to refuse to boot
  const slip = loadConfig({ ALLOWED_ORIGINS: 'https://a.xyz/, gamearenahq.xyz' });
  assert.deepStrictEqual(slip.allowedOrigins, ['https://a.xyz', 'gamearenahq.xyz']);
  assert.strictEqual(slip.warnings.length, 2);
  assert.strictEqual(c.warnings.length, 0);
});

test('metrics group by route pattern, find the slow ones, count failures', () => {
  let clock = 0;
  const logs: string[] = [];
  const m = createMetrics({ slowMs: 100, log: (s) => logs.push(s), now: () => clock });
  for (let i = 1; i <= 100; i++) m.record('GET /api/user/:address', i, 200);
  m.record('POST /api/sign-score', 900, 500);
  const snap = m.snapshot();
  assert.strictEqual(snap[0]?.route, 'POST /api/sign-score'); // slowest first
  assert.strictEqual(snap[0]?.errors, 1);
  const user = snap.find((r) => r.route === 'GET /api/user/:address');
  assert.strictEqual(user?.count, 100);
  assert.strictEqual(user?.p50, 51);
  assert.strictEqual(user?.p95, 96);
  assert.strictEqual(user?.slow, 1); // only the 100 ms one
  assert.strictEqual(logs.length, 2);
  for (let i = 0; i < 1000; i++) m.record(`GET /scan/${i}`, 1, 404); // a scanner cannot grow memory without limit
  assert.ok(m.snapshot().length <= 400);
});

test('the middleware times real requests under their route pattern', async () => {
  const m = createMetrics({ slowMs: 10_000 });
  const app = express();
  app.use(m.middleware);
  app.get('/api/user/:address', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fetch(`${base}/api/user/0xabc`);
    await fetch(`${base}/api/user/0xdef`);
    await fetch(`${base}/nothing-here`);
    await new Promise((r) => setTimeout(r, 20));
    const snap = m.snapshot();
    assert.strictEqual(snap.find((r) => r.route === 'GET /api/user/:address')?.count, 2); // one bucket, not one per wallet
    assert.strictEqual(snap.find((r) => r.route === 'GET (unmatched)')?.count, 1);
  } finally {
    server.close();
  }
});

test('a handler that never replies is answered with a 504 and counted; streams are left alone', async () => {
  const m = createMetrics({ slowMs: 10_000, timeoutMs: 60, log: () => {} });
  const app = express();
  app.use(m.middleware);
  app.get('/hang', () => { /* a rejected promise nobody caught leaves exactly this */ });
  app.get('/stream', (_req, res) => { res.setHeader('content-type', 'text/event-stream'); res.flushHeaders(); setTimeout(() => res.end(), 150); });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/hang`);
    assert.strictEqual(r.status, 504);
    await (await fetch(`${base}/stream`)).text();
    await new Promise((x) => setTimeout(x, 20));
    const snap = m.snapshot();
    assert.strictEqual(snap.find((x) => x.route === 'GET /hang')?.errors, 1);
    assert.strictEqual(snap.find((x) => x.route === 'GET /stream'), undefined); // a stream's lifetime is not a slow request
  } finally {
    server.close();
  }
});

test('shutdown with a live stream and a running timer still exits cleanly', async () => {
  const exits: number[] = [];
  const streams = new Set<http.ServerResponse>();
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: hi\n\n'); streams.add(res); });
  await new Promise<void>((r) => server.listen(0, r));
  const cron = setInterval(() => {}, 20);
  const life = installLifecycle(server, { graceMs: 2000, log: () => {}, exit: (c) => exits.push(c), beforeClose: () => { clearInterval(cron); for (const s of streams) s.end(); } });
  try {
    const reading = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 40));
    life.shutdown('SIGTERM');
    await reading;
    await new Promise((r) => setTimeout(r, 120));
    assert.deepStrictEqual(exits, [0]); // not the grace-period exit(1)
  } finally {
    life.uninstall();
  }
});

test('shutdown lets a request in flight finish, then exits cleanly', async () => {
  const exits: number[] = [];
  const server = http.createServer((_req, res) => { setTimeout(() => res.end('done'), 120); });
  await new Promise<void>((r) => server.listen(0, r));
  const life = installLifecycle(server, { graceMs: 2000, log: () => {}, exit: (c) => exits.push(c) });
  try {
    const pending = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 30));
    life.shutdown('SIGTERM');
    assert.strictEqual(await pending, 'done'); // the player's request was not cut off
    await new Promise((r) => setTimeout(r, 60));
    assert.deepStrictEqual(exits, [0]);
    assert.strictEqual(life.isStopping(), true);
  } finally {
    life.uninstall();
  }
});

test('shutdown gives up after the grace period', async () => {
  const exits: number[] = [];
  const server = http.createServer(() => { /* never answers */ });
  await new Promise<void>((r) => server.listen(0, r));
  const life = installLifecycle(server, { graceMs: 80, log: () => {}, exit: (c) => exits.push(c) });
  try {
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`).catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    life.shutdown('SIGTERM');
    await new Promise((r) => setTimeout(r, 160));
    assert.deepStrictEqual(exits, [1]);
  } finally {
    life.uninstall();
    server.closeAllConnections();
  }
});

test('a stray rejected promise is logged, not fatal', async () => {
  const logs: string[] = [];
  const exits: number[] = [];
  const server = http.createServer();
  const life = installLifecycle(server, { graceMs: 100, log: (m) => logs.push(m), exit: (c) => exits.push(c) });
  try {
    life.onRejection(new Error('boom')); // what Node calls for a promise nobody caught
    assert.strictEqual(logs.length, 1);
    assert.deepStrictEqual(exits, []);
  } finally {
    life.uninstall();
  }
});
