// ─── Smoke boot ──────────────────────────────────────────────────────────────
// Starts the real server with NO credentials and NO way to reach the internet
// (block.js), pointed at a fake database, chain node and subgraph (stub.js),
// then calls every route. It proves the thing unit tests cannot: that the whole
// server loads, every route is wired, and nothing throws on the way.
//
//   npm run smoke            boot, call every route, fail on a crash
//   npm run smoke -- out.json   also write every answer, to diff two builds
//
// It runs from an empty folder, so the .env beside server.js is never read.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const B = path.join(__dirname, '..', '..') + path.sep;
const os = require('os');
const entry = 'server.js';
const port = 4700 + Math.floor(Math.random() * 200), stubPort = port + 300;
const outFile = process.argv[2] || null;
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-smoke-'));
function listRoutes() {
  const found = new Map();
  const scan = (t) => { for (const m of t.matchAll(/app\.(get|post|put|delete|patch)\(\s*['"`](\/[^'"`]*)['"`]/g)) found.set(`${m[1]} ${m[2]}`, [m[1].toUpperCase(), m[2]]); };
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|ts)$/.test(f.name) && !/test/.test(f.name)) scan(fs.readFileSync(p, 'utf8')); } };
  for (const d of ['legacy', 'src', 'lib']) walk(path.join(B, d));
  return [...found.values()];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const stub = spawn(process.execPath, [path.join(__dirname, 'stub.js'), String(stubPort)], { stdio: 'ignore' });
  await sleep(500);
  const env = { PATH: process.env.PATH, HOME: emptyDir, NODE_ENV: 'test', PORT: String(port), INTERNAL_SECRET: 'test-secret', ALLOWED_ORIGINS: 'http://allowed.test', SUPABASE_URL: `http://127.0.0.1:${stubPort}`, SUPABASE_ANON_KEY: 'stub', CELO_RPC_URL: `http://127.0.0.1:${stubPort}/rpc`, SUBGRAPH_URL: `http://127.0.0.1:${stubPort}/subgraph`, TZ: 'UTC' };
  let logs = '';
  const srv = spawn(process.execPath, ['-r', path.join(__dirname, 'block.js'), B + entry], { cwd: emptyDir, env });
  srv.stdout.on('data', (d) => (logs += d)); srv.stderr.on('data', (d) => (logs += d));
  let exited = null; srv.on('exit', (c) => (exited = c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60 && exited === null; i++) { try { await fetch(base + '/api/rhythm/songs'); break; } catch { await sleep(500); } }
  const out = { boot: exited === null ? 'up' : `EXITED ${exited}`, results: {} };
  if (exited === null) {
    await sleep(2500); // let boot work settle
    const routes = listRoutes();
    const A = '0x' + 'a'.padStart(40, 'a').replace(/a/g, 'a').slice(0, 39) + '1';
    const fill = (p) => p.replace(/:address|:wallet/g, '0x' + '1'.padStart(40, 'a')).replace(/:id|:matchId|:roomId|:code|:week|:n\b/g, '1').replace(/:[a-zA-Z]+/g, 'x');
    const norm = (s) => s.replace(/"[0-9a-f]{64}"/g, '"<hex64>"').replace(/\b1[0-9]{9}\b|\b1[0-9]{12}\b/g, '<ts>').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<iso>').replace(/"uptimeSec":\d+|"memoryMb":\d+|"p50":\d+|"p95":\d+|"max":\d+|"count":\d+|"slow":\d+|"errors":\d+/g, '"<n>"');
    const call = async (method, p, headers, body) => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
      try { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body), signal: ctl.signal }); const text = await r.text(); return `${r.status} ${norm(text).slice(0, 4000)}`; } catch (e) { return `ERR ${e.name}`; } finally { clearTimeout(t); }
    };
    const secret = { 'x-internal-secret': 'test-secret' };
    const bodies = [{}, { playerAddress: '0x' + '1'.padStart(40, 'a'), wallet: '0x' + '1'.padStart(40, 'a'), game: 'rhythm', score: 100, address: '0x' + '1'.padStart(40, 'a') }];
    for (const [method, p] of routes) {
      if (/live\/|stream|events/.test(p)) continue; // long-lived streams
      const u = fill(p) + (method === 'GET' ? (p.includes('leaderboard') ? '?game=rhythm' : '') : '');
      const key = `${method} ${p}`;
      out.results[key + ' [secret]'] = await call(method, u, secret, bodies[1]);
      out.results[key + ' [browser]'] = await call(method, u, { origin: 'http://allowed.test' }, bodies[0]);
      if (method !== 'GET') out.results[key + ' [secret,empty]'] = await call(method, u, secret, bodies[0]);
    }
    out.results['GET /nope [stranger]'] = await call('GET', '/nope', { origin: 'http://evil.test' });
    out.results['GET /api/stats [stranger]'] = await call('GET', '/api/stats', { origin: 'http://evil.test' });
    try { out.db = (await (await fetch(`http://127.0.0.1:${stubPort}/__log`)).json()).sort(); } catch { out.db = []; }
  }
  out.crashLines = logs.split('\n').filter((l) => /TypeError|ReferenceError|is not a function|Cannot read|is not defined|uncaught|FATAL/i.test(l)).map((l) => l.slice(0, 200)).slice(0, 30);
  out.logLineCount = logs.split('\n').length;
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  srv.kill('SIGKILL'); stub.kill('SIGKILL');
  fs.rmSync(emptyDir, { recursive: true, force: true });
  const statuses = {};
  for (const v of Object.values(out.results)) { const k = String(v).split(' ')[0]; statuses[k] = (statuses[k] || 0) + 1; }
  console.log(`boot: ${out.boot} · route calls: ${Object.keys(out.results).length} · statuses: ${JSON.stringify(statuses)} · crash-like log lines: ${out.crashLines.length}`);
  for (const l of out.crashLines) console.log('  ' + l);
  const failed = out.boot !== 'up' || out.crashLines.length > 0 || (statuses.ERR || 0) > 0;
  console.log(failed ? 'SMOKE FAILED' : 'smoke ok');
  process.exit(failed ? 1 : 0);
})();
