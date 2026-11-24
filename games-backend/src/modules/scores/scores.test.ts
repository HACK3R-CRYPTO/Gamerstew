import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import type { ScoreDeps } from './ports';
import { checkSession, isClientScore, seasonPoints, SESSION_MAX_MS, type SessionRow } from './rules';
import { createScoreService } from './service';
import { registerScoreRoutes } from './routes';
import { ethersChain, supabaseSeason, supabaseSessions } from './adapters';

const P = '0xAbC0000000000000000000000000000000000001';
const T0 = Date.parse('2026-11-23T10:00:00Z');

// A fake world: every port records what it was asked to do.
function world(over: { session?: Partial<SessionRow> | null; elapsedMs?: number; gasless?: boolean; budget?: { ok: boolean; reason?: string }; submitFails?: number; enrolled?: boolean; chainReady?: boolean } = {}) {
  // `order` is every side effect in the order it happened; `args` is what each replay and lookup was actually given
  const calls = { order: [] as string[], args: {} as Record<string, unknown>, created: [] as unknown[], used: [] as unknown[], points: [] as unknown[], submitted: [] as unknown[], consumed: 0, remembered: [] as string[], vouchers: [] as unknown[], logs: [] as string[] };
  const session: SessionRow | null = over.session === null ? null : { token: 'tok', wallet: P.toLowerCase(), game: 'rhythm', used: false, started_at: new Date(T0).toISOString(), ...over.session };
  let fails = over.submitFails ?? 0;
  const deps: ScoreDeps = {
    gameTypes: { rhythm: 0, simon: 1, stack: 2, nepa: 4, ladder: 5 },
    now: () => T0 + (over.elapsedMs ?? 60_000),
    randomHex: (n) => 'ab'.repeat(n),
    logger: { log: (m) => calls.logs.push(m), warn: (m) => calls.logs.push(m), error: (m) => calls.logs.push(m) },
    sessions: {
      create: async (row) => { calls.created.push(row); return { ok: true }; },
      find: async (token) => (session && token === session.token ? session : null),
      markUsed: async (token, info) => { calls.order.push('markUsed'); calls.used.push({ token, ...info }); },
    },
    season: { isEnrolled: async (wallet) => { calls.order.push('isEnrolled'); calls.args.enrolled = wallet; return over.enrolled ?? true; }, addGamePoints: async (row) => { calls.order.push('addPoints'); calls.points.push(row); } },
    chain: {
      ready: () => over.chainReady ?? true,
      submitScore: async (player, gameType, score) => { calls.order.push('submit'); if (fails-- > 0) throw new Error('rpc hiccup'); calls.submitted.push({ player, gameType, score }); return { hash: '0xtx' }; },
      scoreNonce: async (player) => { calls.order.push('nonce'); calls.args.nonceFor = player; return 7n; },
      signVoucher: async (player, gameType, score, nonce) => { calls.order.push('sign'); calls.vouchers.push({ player, gameType, score, nonce }); return '0xsig'; },
    },
    gasless: { enabled: () => over.gasless ?? false, check: (p) => { calls.order.push('budget'); calls.args.budgetFor = p; return over.budget ?? { ok: true }; }, consume: () => { calls.order.push('consume'); calls.consumed++; }, remember: (h) => { calls.order.push('remember'); calls.remembered.push(h); } },
    replay: {
      rhythm: {
        physicsCheck: (taps, elapsedMs) => { calls.args.physics = { taps: taps.length, elapsedMs }; return taps.length > 500 ? { ok: false, reason: 'too many taps' } : { ok: true }; },
        isKnownSong: (id) => id === 'turca' || id === 'elise',
        computeScore: (taps, elapsedMs, songId) => { calls.args.rhythm = { taps: taps.length, elapsedMs, songId }; return { score: taps.length * 100, hits: taps }; },
        jitterCheck: (hits) => (hits.includes('robot') ? { ok: false, reason: 'too regular' } : { ok: true }),
      },
      stack: { computeScore: () => ({ score: 40, drops: 8, perfects: 2, maxCombo: 2 }), humanness: () => ({ human: true, reasons: [], stats: { dropsPerSec: 1 } }) },
      simon: { computeScore: (input) => { calls.args.simon = input; return { score: 90, tapsOk: true, roundsClaimed: 9, roundsVerified: 9 }; } },
      nepa: { computeScore: (input) => { calls.args.nepa = { seed: input.seed, inputs: input.inputLog.length }; return { points: 50, nairaScore: 50000, banked: 50000, wasted: 0, maxCombo: 3 }; }, humanness: (log) => { calls.args.nepaHuman = log.length; return { human: true, reasons: [], stats: { inputsPerSec: 2 } }; } },
    },
  };
  return { deps, calls, svc: createScoreService(deps) };
}
const rhythmBody = { playerAddress: P, game: 'rhythm', sessionToken: 'tok', score: 999_999, tapLog: Array(12).fill('tap') };

test('checkSession: every way a ticket can be refused, in order', () => {
  const s: SessionRow = { token: 't', wallet: P.toLowerCase(), game: 'simon', used: false, started_at: new Date(T0).toISOString() };
  assert.deepStrictEqual(checkSession(s, P, 'simon', T0 + 60_000), { ok: true, elapsedMs: 60_000 }); // wallet case does not matter
  assert.deepStrictEqual(checkSession(null, P, 'simon', T0), { ok: false, error: 'Invalid session token' });
  assert.deepStrictEqual(checkSession({ ...s, used: true }, P, 'simon', T0 + 60_000), { ok: false, error: 'Session already used' });
  assert.deepStrictEqual(checkSession(s, '0xother', 'simon', T0 + 60_000), { ok: false, error: 'Session wallet mismatch' });
  assert.deepStrictEqual(checkSession(s, P, 'stack', T0 + 60_000), { ok: false, error: 'Session game mismatch' });
  assert.deepStrictEqual(checkSession(s, P, 'simon', T0 + SESSION_MAX_MS + 1), { ok: false, error: 'Session expired' });
  assert.strictEqual(checkSession(s, P, 'simon', T0 + SESSION_MAX_MS).ok, true); // exactly 11 minutes is still in
  assert.deepStrictEqual(checkSession(s, P, 'simon', T0 + 4_999), { ok: false, error: 'Session too short' });
  assert.strictEqual(checkSession(s, P, 'simon', T0 + 5_000).ok, true);
  assert.strictEqual(checkSession({ ...s, started_at: 'not a date' }, P, 'simon', T0).ok, false); // no provable length
});

test('isClientScore and seasonPoints', () => {
  for (const ok of [0, 1, 1_000_000]) assert.strictEqual(isClientScore(ok), true);
  for (const bad of [-1, 1_000_001, 1.5, NaN, Infinity, '50', null, undefined]) assert.strictEqual(isClientScore(bad), false);
  assert.strictEqual(seasonPoints('rhythm', 99, 60_000), 0); // no real play, no points
  assert.strictEqual(seasonPoints('rhythm', 500, 60_000), 5);
  assert.strictEqual(seasonPoints('rhythm', 400_000, 60_000), 15); // capped
  assert.strictEqual(seasonPoints('stack', 30, 60_000), 6);
  assert.strictEqual(seasonPoints('simon', 100, 60_000), 5);
  assert.strictEqual(seasonPoints('nepa', 500, 60_000), 15);
  assert.strictEqual(seasonPoints('rhythm', 5_000, 7_999), 0); // too quick to count
  assert.strictEqual(seasonPoints('rhythm', 5_000, 8_000), 15);
  assert.strictEqual(seasonPoints('rhythm', NaN, 60_000), 0);
});

test('start-game issues a ticket; only NEPA gets a seed', async () => {
  const w = world();
  assert.deepStrictEqual(await w.svc.startGame({ wallet: P, game: 'simon' }), { status: 200, body: { success: true, sessionToken: 'ab'.repeat(32) } });
  assert.deepStrictEqual(w.calls.created[0], { token: 'ab'.repeat(32), wallet: P.toLowerCase(), game: 'simon' }); // no seed key at all
  const n = await w.svc.startGame({ wallet: P, game: 'nepa' });
  assert.strictEqual(n.body.seed, 'ab'.repeat(16));
  assert.deepStrictEqual(w.calls.created[1], { token: 'ab'.repeat(32), wallet: P.toLowerCase(), game: 'nepa', seed: 'ab'.repeat(16) });
  assert.deepStrictEqual(await w.svc.startGame({ wallet: P }), { status: 400, body: { error: 'Missing wallet or game' } });
  assert.deepStrictEqual(await w.svc.startGame({ wallet: P, game: 'chess' }), { status: 400, body: { error: 'Unknown game' } });
  assert.deepStrictEqual(await w.svc.startGame({ wallet: P, game: 'constructor' }), { status: 400, body: { error: 'Unknown game' } }); // not fooled by object built-ins
  const down = world();
  // The regression an audit caught: a database failure whose message is EMPTY
  // must still be a failure. A ticket that was never stored is never handed out.
  down.deps.sessions.create = async () => ({ ok: false, reason: '' });
  assert.deepStrictEqual(await createScoreService(down.deps).startGame({ wallet: P, game: 'simon' }), { status: 500, body: { error: 'Failed to start session' } });
});

test('sign-score refuses bad requests before touching anything', async () => {
  const off = world({ chainReady: false });
  assert.deepStrictEqual(await off.svc.signScore(rhythmBody), { status: 503, body: { error: 'Validator not configured' } });
  const w = world();
  assert.deepStrictEqual(await w.svc.signScore({ game: 'rhythm' }), { status: 400, body: { error: 'Missing playerAddress or game' } });
  assert.deepStrictEqual(await w.svc.signScore({ playerAddress: { evil: 1 }, game: 'rhythm' }), { status: 400, body: { error: 'Missing playerAddress or game' } });
  assert.deepStrictEqual(await w.svc.signScore({ playerAddress: P, game: 'chess' }), { status: 400, body: { error: 'Unknown game' } });
  assert.deepStrictEqual(await w.svc.signScore({ playerAddress: P, game: 'rhythm' }), { status: 400, body: { error: 'Missing sessionToken' } });
  assert.deepStrictEqual(await w.svc.signScore({ ...rhythmBody, sessionToken: 'nope' }), { status: 403, body: { error: 'Invalid session token' } });
  assert.deepStrictEqual(await world({ session: { used: true } }).svc.signScore(rhythmBody), { status: 403, body: { error: 'Session already used' } });
  assert.deepStrictEqual(await world({ session: { wallet: '0xsomeoneelse' } }).svc.signScore(rhythmBody), { status: 403, body: { error: 'Session wallet mismatch' } });
  assert.deepStrictEqual(await world({ session: { game: 'simon' } }).svc.signScore(rhythmBody), { status: 403, body: { error: 'Session game mismatch' } });
  assert.deepStrictEqual(await world({ elapsedMs: 12 * 60_000 }).svc.signScore(rhythmBody), { status: 403, body: { error: 'Session expired' } });
  assert.deepStrictEqual(await world({ elapsedMs: 3_000 }).svc.signScore(rhythmBody), { status: 403, body: { error: 'Session too short' } });
  assert.deepStrictEqual(w.calls.used, []); // none of those spent the ticket
  assert.deepStrictEqual(w.calls.vouchers, []);
});

test('rhythm: the server replays the run and signs ITS score, never the client number', async () => {
  const w = world();
  const r = await w.svc.signScore(rhythmBody); // client claims 999,999; 12 taps replay to 1,200
  assert.deepStrictEqual(r, { status: 200, body: { success: true, signature: '0xsig', nonce: '7', gameType: 0, score: 1200 } });
  assert.deepStrictEqual(w.calls.vouchers, [{ player: P, gameType: 0, score: 1200, nonce: 7n }]);
  assert.deepStrictEqual(w.calls.used, [{ token: 'tok', computedScore: 1200, tapCount: 12 }]);
  assert.deepStrictEqual(w.calls.points, [{ wallet: P.toLowerCase(), points: 12, ref: 'tok' }]); // one ledger row, keyed by the ticket
  // what the replay and the lookups were actually given
  assert.deepStrictEqual(w.calls.args.physics, { taps: 12, elapsedMs: 60_000 });
  assert.deepStrictEqual(w.calls.args.rhythm, { taps: 12, elapsedMs: 60_000, songId: null });
  assert.strictEqual(w.calls.args.enrolled, P); // asked about this player, address as sent
  assert.strictEqual(w.calls.args.nonceFor, P);
  // the ticket is spent BEFORE anything is signed, and the ladder before the chain
  assert.deepStrictEqual(w.calls.order, ['markUsed', 'isEnrolled', 'addPoints', 'nonce', 'sign']);
  assert.ok(w.calls.logs.every((l) => !l.startsWith('Season 1 pts skipped')));
  const song = world();
  await song.svc.signScore({ ...rhythmBody, songId: 'elise' });
  assert.deepStrictEqual(song.calls.args.rhythm, { taps: 12, elapsedMs: 60_000, songId: 'elise' }); // the chosen song reaches the replay
  const rejected = world();
  await rejected.svc.signScore({ ...rhythmBody, tapLog: ['robot'] });
  assert.deepStrictEqual(rejected.calls.order, []); // a rejected run spends nothing
  assert.deepStrictEqual(rejected.calls.logs, [`[rhythm] Jitter check rejected ${P}: too regular · 1 hits`]);
  assert.deepStrictEqual(await world().svc.signScore({ ...rhythmBody, tapLog: undefined }), { status: 400, body: { error: 'Missing tapLog (required for rhythm)' } });
  assert.deepStrictEqual(await world().svc.signScore({ ...rhythmBody, tapLog: Array(501).fill('t') }), { status: 403, body: { error: 'Physics check failed', reason: 'too many taps' } });
  assert.deepStrictEqual(await world().svc.signScore({ ...rhythmBody, tapLog: ['robot'] }), { status: 403, body: { error: 'Jitter check failed', reason: 'too regular' } });
  assert.deepStrictEqual(await world().svc.signScore({ ...rhythmBody, songId: 'pirate-song' }), { status: 400, body: { error: 'Unknown song', songId: 'pirate-song' } });
  assert.strictEqual((await world().svc.signScore({ ...rhythmBody, songId: 'elise' })).status, 200);
  assert.strictEqual((await world().svc.signScore({ ...rhythmBody, songId: '' })).status, 200); // older client: the original song
});

test('simon, stack, nepa: the claim is signed inside the bound; shadow replays only log', async () => {
  for (const [game, extra, tag] of [['simon', { simonTapLog: [1, 2] }, '[simon:shadow]'], ['stack', { dropLog: [1] }, '[stack:shadow]'], ['nepa', { nepaInputLog: [1] }, '[nepa:shadow]']] as const) {
    const w = world({ session: { game, seed: 'seed' } });
    const r = await w.svc.signScore({ playerAddress: P, game, sessionToken: 'tok', score: 120, ...extra });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.score, 120); // the shadow replay said something else and changed nothing
    assert.ok(w.calls.logs.some((l) => l.startsWith(tag) && l.endsWith('SIGNING CLIENT SCORE')), `${game} logged its comparison`);
    assert.deepStrictEqual(w.calls.used, [{ token: 'tok', computedScore: 120, tapCount: null }]);
  }
  // each shadow replay is fed the real inputs: the ticket for Simon, the stored seed for NEPA
  const si = world({ session: { game: 'simon' } });
  await si.svc.signScore({ playerAddress: P, game: 'simon', sessionToken: 'tok', score: 120, simonTapLog: [1, 2], simonElapsedMs: 41_000 });
  assert.deepStrictEqual(si.calls.args.simon, { sessionToken: 'tok', tapLog: [1, 2], clientElapsedMs: 41_000 });
  const si2 = world({ session: { game: 'simon' } });
  await si2.svc.signScore({ playerAddress: P, game: 'simon', sessionToken: 'tok', score: 120, simonTapLog: [1] });
  assert.strictEqual((si2.calls.args.simon as { clientElapsedMs: number }).clientElapsedMs, 60_000); // falls back to the session's own length
  const ne = world({ session: { game: 'nepa', seed: 'the-stored-seed' } });
  await ne.svc.signScore({ playerAddress: P, game: 'nepa', sessionToken: 'tok', score: 120, nepaInputLog: Array(1500).fill(1) });
  assert.deepStrictEqual(ne.calls.args.nepa, { seed: 'the-stored-seed', inputs: 1000 }); // replay capped at 1,000 inputs
  assert.strictEqual(ne.calls.args.nepaHuman, 1500); // the humanness check sees the whole log
  assert.ok(ne.calls.logs.some((l) => l.includes('inputLog over cap (1500 > 1000)')));
  const quiet = world({ session: { game: 'stack' } });
  await quiet.svc.signScore({ playerAddress: P, game: 'stack', sessionToken: 'tok', score: 3 }); // no log sent, 3 points is below a ladder point
  assert.deepStrictEqual(quiet.calls.logs, [`Season 1 pts skipped: ${P.slice(0, 8)}.. game=stack score=3 elapsed=60000ms`]);
  for (const bad of [-1, 1_000_001, 12.5, '120', undefined]) {
    const r = await world({ session: { game: 'simon' } }).svc.signScore({ playerAddress: P, game: 'simon', sessionToken: 'tok', score: bad });
    assert.deepStrictEqual(r, { status: 400, body: { error: 'Score out of range (max 1000000)' } });
  }
  // a shadow replay that blows up must not cost the player their run
  const w = world({ session: { game: 'stack' } });
  w.deps.replay.stack.computeScore = () => { throw new Error('port bug'); };
  assert.strictEqual((await createScoreService(w.deps).signScore({ playerAddress: P, game: 'stack', sessionToken: 'tok', score: 55, dropLog: [1] })).body.score, 55);
});

test('ladder points: only enrolled players, never for an empty run, and a ladder failure never blocks the score', async () => {
  const out = world({ enrolled: false });
  assert.strictEqual((await out.svc.signScore(rhythmBody)).status, 200);
  assert.deepStrictEqual(out.calls.points, []);
  const empty = world();
  await empty.svc.signScore({ ...rhythmBody, tapLog: [] }); // score 0
  assert.deepStrictEqual(empty.calls.points, []);
  const broken = world();
  broken.deps.season.isEnrolled = async () => { throw new Error('ledger down'); };
  assert.strictEqual((await createScoreService(broken.deps).signScore(rhythmBody)).status, 200);
});

test('gasless: the backend submits; retries a hiccup; falls back to a voucher', async () => {
  const w = world({ gasless: true });
  assert.deepStrictEqual(await w.svc.signScore(rhythmBody), { status: 200, body: { success: true, gasless: true, txHash: '0xtx', gameType: 0, score: 1200 } });
  assert.deepStrictEqual(w.calls.submitted, [{ player: P, gameType: 0, score: 1200 }]);
  assert.strictEqual(w.calls.consumed, 1);
  assert.deepStrictEqual(w.calls.remembered, ['0xtx']);
  assert.deepStrictEqual(w.calls.vouchers, []);
  assert.deepStrictEqual(w.calls.used, [{ token: 'tok', computedScore: 1200, tapCount: 12 }]); // the ticket is spent on the gasless path too
  assert.deepStrictEqual(w.calls.order, ['markUsed', 'isEnrolled', 'addPoints', 'budget', 'submit', 'consume', 'remember']);
  assert.strictEqual(w.calls.args.budgetFor, P);

  const flaky = world({ gasless: true, submitFails: 2 }); // third try lands
  assert.strictEqual((await flaky.svc.signScore(rhythmBody)).body.gasless, true);
  assert.strictEqual(flaky.calls.consumed, 1);

  const dead = world({ gasless: true, submitFails: 3 }); // all three fail: voucher, and no budget spent
  const r = await dead.svc.signScore(rhythmBody);
  assert.strictEqual(r.body.signature, '0xsig');
  assert.strictEqual(r.body.gasless, undefined);
  assert.strictEqual(dead.calls.consumed, 0);
  assert.deepStrictEqual(dead.calls.order, ['markUsed', 'isEnrolled', 'addPoints', 'budget', 'submit', 'submit', 'submit', 'nonce', 'sign']);
  assert.deepStrictEqual(dead.calls.remembered, []);

  const broke = world({ gasless: true, budget: { ok: false, reason: 'wallet daily cap' } }); // over budget: never touches the signer's gas
  assert.strictEqual((await broke.svc.signScore(rhythmBody)).body.signature, '0xsig');
  assert.deepStrictEqual(broke.calls.submitted, []);
  assert.ok(broke.calls.logs.some((l) => l.includes('Gasless budget hit (wallet daily cap)')));
});

test('a signing failure is a clean 500, and the ticket is already spent', async () => {
  const w = world();
  w.deps.chain.signVoucher = async () => { throw new Error('kms down'); };
  assert.deepStrictEqual(await createScoreService(w.deps).signScore(rhythmBody), { status: 500, body: { error: 'Failed to sign score' } });
  assert.strictEqual(w.calls.used.length, 1);
});

test('over HTTP: gate, limiter and replies, including a handler that throws', async () => {
  const w = world();
  const app = express();
  app.use(express.json());
  const order: string[] = [];
  registerScoreRoutes(app, { ...w.deps, requireSecret: (req, res, next) => { order.push('secret'); if (req.headers['x-internal-secret'] === 's') next(); else res.status(401).json({ error: 'Unauthorized' }); }, limiter: (_q, _s, next) => { order.push('limit'); next(); } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, secret = 's') => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  try {
    assert.strictEqual((await post('/api/sign-score', rhythmBody, 'wrong')).status, 401);
    assert.deepStrictEqual(order, ['secret']); // refused before the limiter or the handler
    assert.deepStrictEqual((await post('/api/start-game', { wallet: P, game: 'simon' })).body, { success: true, sessionToken: 'ab'.repeat(32) });
    assert.deepStrictEqual((await post('/api/sign-score', rhythmBody)).body, { success: true, signature: '0xsig', nonce: '7', gameType: 0, score: 1200 });
    w.deps.sessions.find = async () => { throw new Error('db exploded'); };
    assert.deepStrictEqual(await post('/api/sign-score', rhythmBody), { status: 500, body: { error: 'Failed to sign score' } }); // answered, not left hanging
  } finally {
    server.close();
  }
});

// The interfaces in ports.ts describe lib/*Scoring.js. If a library changes
// shape, this fails here instead of in production.
test('the real replay libraries still have the shape this module reads', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const rhythm = require('../../../lib/rhythmScoring');
  const stack = require('../../../lib/stackScoring');
  const simon = require('../../../lib/simonScoring');
  const nepa = require('../../../lib/nepaScoring');
  assert.strictEqual(typeof rhythm.physicsCheck([], 60_000).ok, 'boolean');
  assert.strictEqual(rhythm.isKnownSong('definitely-not-a-song'), false);
  const run = rhythm.computeScore([], 60_000, null);
  assert.strictEqual(typeof run.score, 'number');
  assert.ok(Array.isArray(run.hits));
  assert.strictEqual(typeof rhythm.jitterCheck(run.hits).ok, 'boolean');
  const st = stack.computeStackScore([]);
  for (const k of ['score', 'drops', 'perfects', 'maxCombo']) assert.strictEqual(typeof st[k], 'number', `stack.${k}`);
  const sh = stack.computeStackHumanness([]);
  assert.strictEqual(typeof sh.human, 'boolean');
  assert.ok(Array.isArray(sh.reasons) && typeof sh.stats === 'object');
  const si = simon.computeSimonScore({ sessionToken: 'ab'.repeat(32), tapLog: [], clientElapsedMs: 60_000 });
  assert.strictEqual(typeof si.score, 'number');
  assert.strictEqual(typeof si.tapsOk, 'boolean');
  for (const k of ['roundsClaimed', 'roundsVerified']) assert.ok(k in si, `simon.${k}`);
  const ne = nepa.computeNepaScore({ seed: 'ab'.repeat(16), inputLog: [] });
  for (const k of ['points', 'nairaScore', 'banked', 'wasted', 'maxCombo']) assert.strictEqual(typeof ne[k], 'number', `nepa.${k}`);
  const nh = nepa.computeNepaHumanness([]);
  assert.strictEqual(typeof nh.human, 'boolean');
  assert.ok(Array.isArray(nh.reasons) && typeof nh.stats === 'object');
});

// ─── the adapters: the only code that touches Supabase and ethers ────────────
// A stand-in for the Supabase query builder that records every call and replies
// with whatever the test says the database said.
function fakeDb(replies: Record<string, unknown>) {
  const seen: unknown[][] = [];
  const builder = (table: string, steps: unknown[][]): Record<string, unknown> => {
    const step = (name: string) => (...a: unknown[]) => builder(table, [...steps, [name, ...a]]);
    const settle = () => { seen.push([table, ...steps]); return replies[`${table}.${String(steps[0]?.[0])}`] ?? { data: null, error: null }; };
    return { insert: step('insert'), select: step('select'), update: step('update'), eq: step('eq'), ilike: step('ilike'), single: async () => settle(), maybeSingle: async () => settle(), then: (ok: (v: unknown) => unknown) => Promise.resolve(settle()).then(ok) };
  };
  return { db: { from: (t: string) => builder(t, []) }, seen };
}

test('adapters: a failed insert is a failure whatever its message says', async () => {
  const row = { token: 't', wallet: '0xabc', game: 'simon' };
  assert.deepStrictEqual(await supabaseSessions(fakeDb({}).db).create(row), { ok: true });
  for (const error of [{ message: 'boom' }, { message: '' }, {}, { error: 'bad gateway' }]) { // supabase-js really returns all of these
    const r = await supabaseSessions(fakeDb({ 'game_sessions.insert': { error } }).db).create(row);
    assert.strictEqual(r.ok, false, JSON.stringify(error));
    assert.ok(r.reason); // always something to log
  }
});

test('adapters: the exact tables, columns and filters', async () => {
  const session = { token: 't', wallet: '0xabc', game: 'simon', used: false, started_at: '2026-11-23T10:00:00+00:00' };
  const f = fakeDb({ 'game_sessions.select': { data: session, error: null }, 'season_v1_players.select': { data: { wallet: '0xabc' }, error: null } });
  const sessions = supabaseSessions(f.db, () => '2026-11-23T10:05:00.000Z');
  await sessions.create({ token: 't', wallet: '0xabc', game: 'nepa', seed: 's' });
  assert.deepStrictEqual(await sessions.find('t'), session);
  await sessions.markUsed('t', { computedScore: 1200, tapCount: 12 });
  const season = supabaseSeason(f.db);
  assert.strictEqual(await season.isEnrolled('0xAbC'), true);
  await season.addGamePoints({ wallet: '0xabc', points: 12, ref: 't' });
  assert.deepStrictEqual(f.seen, [
    ['game_sessions', ['insert', { token: 't', wallet: '0xabc', game: 'nepa', seed: 's' }]],
    ['game_sessions', ['select', '*'], ['eq', 'token', 't']],
    ['game_sessions', ['update', { used: true, used_at: '2026-11-23T10:05:00.000Z', computed_score: 1200, tap_count: 12 }], ['eq', 'token', 't']],
    ['season_v1_players', ['select', 'wallet'], ['ilike', 'wallet', '0xAbC']],
    ['season_v1_points', ['insert', { wallet: '0xabc', action_type: 'game_played', points: 12, ref: 't' }]],
  ]);
  // not found, or a lookup error, is "no such ticket"; a missing ladder row is "not enrolled"
  assert.strictEqual(await supabaseSessions(fakeDb({ 'game_sessions.select': { data: null, error: { message: 'no rows' } } }).db).find('x'), null);
  assert.strictEqual(await supabaseSessions(fakeDb({}).db).find('x'), null);
  assert.strictEqual(await supabaseSeason(fakeDb({}).db).isEnrolled('0xabc'), false);
});

test('adapters: the chain is read at request time and the score is signed as a BigInt', async () => {
  let validator: { signTypedData(d: unknown, t: unknown, v: unknown): Promise<string> } | null = null;
  let pass: { scoreNonces(p: string): Promise<bigint> } | null = null;
  const signed: unknown[] = [];
  const chain = ethersChain({ validator: () => validator, passContract: () => pass, submitScore: async () => ({ hash: '0xtx' }), domain: { name: 'GamePass' }, types: { BackendApproval: [] } });
  assert.strictEqual(chain.ready(), false); // nothing loaded yet
  validator = { signTypedData: async (d, t, v) => { signed.push([d, t, v]); return '0xsig'; } };
  assert.strictEqual(chain.ready(), false); // both are needed
  pass = { scoreNonces: async () => 9n };
  assert.strictEqual(chain.ready(), true); // picked up without rebuilding the adapter
  const nonce = await chain.scoreNonce(P);
  assert.strictEqual(await chain.signVoucher(P, 2, 1200, nonce), '0xsig');
  assert.deepStrictEqual(signed, [[{ name: 'GamePass' }, { BackendApproval: [] }, { player: P, gameType: 2, score: 1200n, nonce: 9n }]]);
  assert.deepStrictEqual(await chain.submitScore(P, 2, 1200), { hash: '0xtx' });
});

// ── Word Ladder: the only game besides rhythm whose score the server works out itself ──
import * as ladderRules from '../ladder/rules';
import { VALID as LADDER_VALID } from '../ladder/data';
const LW = new Set(LADDER_VALID.split(' '));
function ladderRoute(a: string, z: string): string[] {
  const prev = new Map<string, string | null>([[a, null]]); const q = [a];
  for (let h = 0; h < q.length; h++) { const w = q[h]!; if (w === z) break; for (let i = 0; i < 4; i++) for (let c = 97; c < 123; c++) { const x = w.slice(0, i) + String.fromCharCode(c) + w.slice(i + 1); if (!prev.has(x) && LW.has(x)) { prev.set(x, w); q.push(x); } } }
  const out: string[] = []; for (let w: string | null | undefined = z; w && w !== a; w = prev.get(w)) out.unshift(w); return out;
}
const ladderRuns = (token: string) => ladderRules.deal(token).map(([s, t]) => { const words = ladderRoute(s, t); return { words, ms: words.length * 3_000, hints: 0 }; });

test('ladder: start-game deals five ladders from the ticket and stores no seed', async () => {
  const w = world();
  const r = await w.svc.startGame({ wallet: P, game: 'ladder' });
  assert.strictEqual(r.status, 200);
  const token = r.body.sessionToken as string;
  assert.deepStrictEqual(r.body.ladders, ladderRules.deal(token));
  assert.strictEqual((r.body.ladders as unknown[]).length, 5);
  assert.deepStrictEqual(w.calls.created, [{ token, wallet: P.toLowerCase(), game: 'ladder' }]);
});

test('ladder: the signed score is the server replay, whatever number the client sends', async () => {
  const runs = ladderRuns('tok');
  const w = world({ session: { game: 'ladder' }, elapsedMs: 60_000, gasless: true });
  const r = await w.svc.signScore({ playerAddress: P, game: 'ladder', sessionToken: 'tok', score: 999_999, ladderRuns: runs });
  assert.strictEqual(r.status, 200);
  const expected = ladderRules.verify(ladderRules.deal('tok'), runs, 60_000);
  assert.ok(expected.ok && expected.total > 0 && expected.total <= 1000);
  assert.strictEqual(r.body.score, expected.ok ? expected.total : -1);
  assert.strictEqual(r.body.gameType, 5);
  assert.deepStrictEqual(w.calls.submitted, [{ player: P, gameType: 5, score: expected.ok ? expected.total : -1 }]);
});

test('ladder: a bad route, missing words, or words for another ticket are refused and nothing is spent', async () => {
  const good = ladderRuns('tok');
  const cases: unknown[] = [
    undefined,                                             // no words sent at all
    good.slice(0, 4),                                      // one ladder missing
    good.map((r, i) => (i === 0 ? { ...r, words: ['zzzz'] } : r)), // not a word
    ladderRuns('another-ticket'),                          // a valid round, but not the one dealt for this ticket
  ];
  for (const ladderRunsBody of cases) {
    const w = world({ session: { game: 'ladder' }, elapsedMs: 60_000, gasless: true });
    const r = await w.svc.signScore({ playerAddress: P, game: 'ladder', sessionToken: 'tok', score: 1000, ladderRuns: ladderRunsBody });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.error, 'Ladder check failed');
    assert.deepStrictEqual(w.calls.order, [], 'nothing marked used, nothing sent on-chain');
  }
});

test('ladder: times that add up to more than the session lasted are refused', async () => {
  const runs = ladderRuns('tok').map((r) => ({ ...r, ms: 30_000 })); // claims 150 s
  const w = world({ session: { game: 'ladder' }, elapsedMs: 60_000 });
  const r = await w.svc.signScore({ playerAddress: P, game: 'ladder', sessionToken: 'tok', score: 1, ladderRuns: runs });
  assert.strictEqual(r.status, 403);
});

test('ladder: season points use the ladder scale', () => {
  assert.strictEqual(seasonPoints('ladder', 1000, 60_000), 14);
  assert.strictEqual(seasonPoints('ladder', 400, 60_000), 5);
  assert.strictEqual(seasonPoints('ladder', 60, 60_000), 0);
});
