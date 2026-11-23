import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { createSubmitService, validateSubmission, type Achievement, type LeaderboardEntry, type SubmitDeps } from './submit';
import { registerSubmitRoute } from './routes';
import { supabaseBestThisSeason } from './adapters';

const P = '0xAbC0000000000000000000000000000000000001';
const LOW = P.toLowerCase();
const TX = '0x' + 'a1'.repeat(32);
const WAGER_TX = '0x' + 'b2'.repeat(32);
const T0 = Date.parse('2026-11-23T10:00:00Z');
const GAMES = { rhythm: 0, simon: 1, stack: 2, nepa: 4 };

function world(over: { slowSave?: boolean; seasons?: number[]; rejectPush?: boolean; hangNotify?: boolean; gasless?: boolean; verify?: { ok: boolean; reason?: string }; prevBest?: number; wagerTx?: string | null; achievements?: Achievement[] | null; rank?: number; board?: LeaderboardEntry[]; xp?: { xp?: number; level?: number; leveledUp?: boolean } | null; throws?: string[] } = {}) {
  const order: string[] = [];
  const seen: Record<string, unknown> = {};
  const pushes: unknown[] = [];
  const logs: string[] = [];
  const boom = (name: string) => { if (over.throws?.includes(name)) throw new Error(`${name} down`); };
  const deps: SubmitDeps = {
    gameTypes: GAMES,
    gameLabels: { rhythm: 'Rhythm Rush', simon: 'Simon Memory', stack: 'Stack Tower', nepa: 'Up NEPA!' },
    winThreshold: { rhythm: 350, simon: 7, stack: 50, nepa: 50 },
    xp: { played: 10, win: 25, newPb: 25 },
    now: () => T0,
    logger: { log: (m) => logs.push(m), warn: (m, ...e) => logs.push([m, ...e].join(' ')) },
    currentSeason: () => { order.push('season'); return over.seasons ? over.seasons.shift()! : 42; },
    seasonStartSec: (s) => 1_000_000 + s,
    registerUser: async (w) => { order.push('registerUser'); seen.registered = w; return 5; },
    resolveWager: async (id, score) => { order.push('resolveWager'); seen.wager = [id, score]; return over.wagerTx === undefined ? WAGER_TX : over.wagerTx; },
    isGaslessTx: (h) => { order.push('isGasless'); seen.gaslessAsked = h; return over.gasless ?? false; },
    verifyScoreTx: async (h, p, g) => { order.push('verify'); seen.verify = [h, p, g]; return over.verify ?? { ok: true }; },
    bestThisSeason: async (w, g, s) => { order.push('prevBest'); seen.best = [w, g, s]; return over.prevBest ?? 0; },
    saveScore: async (row) => { if (over.slowSave) await new Promise((r) => setTimeout(r, 25)); order.push('save'); seen.saved = row; },
    invalidateCaches: (g) => { order.push('invalidate'); seen.invalidated = g; },
    awardXp: async (w, n, why) => { order.push('awardXp'); seen.xp = [w, n, why]; return over.xp === undefined ? { xp: 135, level: 3, leveledUp: false } : over.xp; },
    updateMissions: async (w, run) => { order.push('missions'); boom('missions'); seen.missions = [w, run]; },
    unlockAchievements: async (w, run) => { order.push('achievements'); boom('achievements'); seen.ach = [w, run]; return over.achievements === undefined ? [] : over.achievements; },
    seasonRank: async (w, sc, g, start) => { order.push('rank'); boom('rank'); seen.rank = [w, sc, g, start]; return over.rank ?? 12; },
    leaderboard: async (g, start, limit) => { order.push('leaderboard'); boom('leaderboard'); seen.board = [g, start, limit]; return over.board ?? []; },
    notifyRankDisplacement: (g, w, before, after) => { order.push('displacement'); seen.displacement = { g, w, before, after }; return over.hangNotify ? new Promise<void>(() => {}) : over.rejectPush ? Promise.reject(new Error('push down')) : Promise.resolve(); },
    push: {
      wagerWon: (wagered, label) => ({ kind: 'won', wagered, label }),
      wagerLost: (label) => ({ kind: 'lost', label }),
      achievement: (name, icon) => ({ kind: 'ach', name, icon }),
      send: (w, category, payload) => { order.push('push'); pushes.push([w, category, payload]); return over.rejectPush ? Promise.reject(new Error('push down')) : Promise.resolve(); },
    },
    recoverSigner: (payload) => (payload.endsWith(':good') ? '0xVALIDATOR' : '0xsomeoneelse'),
    validatorAddress: () => '0xvalidator',
  };
  return { deps, order, seen, pushes, logs, submit: createSubmitService(deps) };
}
const body = (extra: Record<string, unknown> = {}) => ({ playerAddress: P, scoreData: { game: 'rhythm', score: 500, gameTime: 60_000, txHash: TX, ...extra } });

test('validateSubmission: a known game, a score in range, a run of at least five seconds', () => {
  assert.deepStrictEqual(validateSubmission({ game: 'rhythm', score: 0, gameTime: 5000 }, GAMES), { valid: true });
  assert.deepStrictEqual(validateSubmission({ game: 'rhythm', score: 1_000_000, gameTime: 5000 }, GAMES), { valid: true });
  assert.deepStrictEqual(validateSubmission({ game: 'chess', score: 1, gameTime: 9000 }, GAMES), { valid: false, reason: 'Unknown game' });
  assert.deepStrictEqual(validateSubmission({ game: 'toString', score: 1, gameTime: 9000 }, GAMES), { valid: false, reason: 'Unknown game' });
  for (const score of [-1, 1_000_001, '500', undefined]) assert.deepStrictEqual(validateSubmission({ game: 'rhythm', score, gameTime: 9000 }, GAMES), { valid: false, reason: 'Score out of range' });
  for (const gameTime of [4999, '60000', undefined]) assert.deepStrictEqual(validateSubmission({ game: 'rhythm', score: 5, gameTime }, GAMES), { valid: false, reason: 'Game time too short' });
});

test('a proven score is saved, rewarded and answered, in the order it always was', async () => {
  const w = world({ prevBest: 400 });
  const r = await w.submit(body(), true);
  assert.deepStrictEqual(r, { status: 200, body: { success: true, score: 500, rank: 12, txHash: TX, streak: 5, xpEarned: 60, xp: 135, level: 3, leveledUp: false, isNewPb: true, prevBest: 400, newAchievements: [] } });
  assert.deepStrictEqual(Object.keys(r.body), ['success', 'score', 'rank', 'txHash', 'streak', 'xpEarned', 'xp', 'level', 'leveledUp', 'isNewPb', 'prevBest', 'newAchievements']);
  assert.deepStrictEqual(w.order, ['season', 'registerUser', 'isGasless', 'verify', 'prevBest', 'save', 'invalidate', 'awardXp', 'missions', 'achievements', 'rank']);
  assert.strictEqual(w.seen.registered, P); // as sent
  assert.deepStrictEqual(w.seen.verify, [TX, P, 0]); // this player, this game's on-chain type
  assert.deepStrictEqual(w.seen.best, [LOW, 'rhythm', 42]); // best in THIS season
  assert.deepStrictEqual(w.seen.saved, { wallet_address: LOW, game: 'rhythm', score: 500, game_time: 60_000, season_number: 42, wagered: null, wager_id: null, tx_hash: TX });
  assert.strictEqual(w.seen.invalidated, 'rhythm');
  assert.deepStrictEqual(w.seen.xp, [LOW, 60, 'played + win + new PB']); // 10 + 25 + 25
  assert.deepStrictEqual(w.seen.missions, [LOW, { game: 'rhythm', score: 500, isWin: true, isNewPb: true }]);
  assert.deepStrictEqual(w.seen.ach, [LOW, { game: 'rhythm', score: 500, isWin: true, isNewPb: true, fullCombo: false, allPerfect: false }]);
  assert.deepStrictEqual(w.seen.rank, [LOW, 500, 0, 1_000_042]);
  assert.deepStrictEqual(w.logs, [`✅ [rhythm] ${LOW.slice(0, 8)}... → 500 pts (rank #12) +60 XP tx: ${TX.slice(0, 10)}...`]);
  assert.deepStrictEqual(w.pushes, []);
});

test('XP: playing, winning and a new best are each counted once', async () => {
  const cases: [number, number, number, string][] = [[100, 400, 10, 'played'], [349, 0, 35, 'played + new PB'], [350, 400, 35, 'played + win'], [350, 350, 35, 'played + win'], [351, 350, 60, 'played + win + new PB']];
  for (const [score, prevBest, xp, why] of cases) {
    const w = world({ prevBest });
    const r = await w.submit(body({ score }), true);
    assert.strictEqual(r.body.xpEarned, xp, `score ${score} vs best ${prevBest}`);
    assert.deepStrictEqual(w.seen.xp, [LOW, xp, why]);
    assert.strictEqual(r.body.isNewPb, score > prevBest);
  }
  const none = await world({ xp: null }).submit(body(), true); // no XP row came back
  assert.strictEqual(none.body.leveledUp, false);
  assert.strictEqual('xp' in JSON.parse(JSON.stringify(none.body)), false);
  assert.strictEqual((await world({ xp: { xp: 9, level: 2, leveledUp: true } }).submit(body(), true)).body.leveledUp, true);
  // the skill flags are read as yes/no, each on its own
  const flags = async (extra: Record<string, unknown>) => { const x = world(); await x.submit(body(extra), true); const a = (x.seen.ach as [string, { fullCombo: boolean; allPerfect: boolean }])[1]; return [a.fullCombo, a.allPerfect]; };
  assert.deepStrictEqual(await flags({ fullCombo: 1, allPerfect: 'yes' }), [true, true]);
  assert.deepStrictEqual(await flags({ fullCombo: true }), [true, false]);
  assert.deepStrictEqual(await flags({ allPerfect: true }), [false, true]);
  assert.deepStrictEqual(await flags({ fullCombo: 0, allPerfect: '' }), [false, false]);
});

test('no proof, no save', async () => {
  for (const txHash of [undefined, '', '0x123', 'a1'.repeat(32), '0x' + 'zz'.repeat(32), TX + '00']) {
    const w = world();
    assert.deepStrictEqual(await w.submit(body({ txHash }), true), { status: 400, body: { error: 'Missing on-chain proof', reason: 'txHash required — every score must reference a GamePass contract tx' } });
    assert.ok(!w.order.includes('save') && !w.order.includes('awardXp'));
  }
  const bad = world({ verify: { ok: false, reason: 'tx reverted' } });
  assert.deepStrictEqual(await bad.submit(body(), true), { status: 400, body: { error: 'On-chain proof verification failed', reason: 'tx reverted' } });
  assert.deepStrictEqual(bad.order, ['season', 'registerUser', 'isGasless', 'verify']); // the streak is touched, nothing else
  // a failed proof is a failed proof, with or without an explanation
  const mute = world({ verify: { ok: false } });
  assert.strictEqual((await mute.submit(body(), true)).status, 400);
  assert.ok(!mute.order.includes('save'));
  // hex digits may be upper case; the 0x prefix may not
  assert.strictEqual((await world().submit(body({ txHash: '0x' + 'A1'.repeat(32) }), true)).status, 200);
  assert.strictEqual((await world().submit(body({ txHash: '0X' + 'a1'.repeat(32) }), true)).status, 400);
  assert.deepStrictEqual(bad.logs, [`🚨 submit-score rejected: ${P.slice(0, 10)}.. game=rhythm tx=${TX.slice(0, 10)}.. · tx reverted`]);
});

test('a tx the backend sent is trusted by its hash and not re-verified', async () => {
  const w = world({ gasless: true });
  assert.strictEqual((await w.submit(body(), true)).status, 200);
  assert.strictEqual(w.seen.gaslessAsked, TX);
  assert.ok(!w.order.includes('verify'));
  assert.ok(w.order.includes('save'));
});

test('wagers: resolved first, their tx is the proof, and the player is told the outcome', async () => {
  const won = world();
  const r = await won.submit(body({ wagerId: 77, wagered: '5', txHash: undefined }), true);
  assert.strictEqual(r.body.txHash, WAGER_TX);
  assert.deepStrictEqual(won.seen.wager, [77, 500]);
  assert.deepStrictEqual(won.order.slice(0, 4), ['season', 'registerUser', 'resolveWager', 'prevBest']); // a wager tx was awaited when resolved, so it is not verified again
  assert.deepStrictEqual((won.seen.saved as Record<string, unknown>).wagered, '5');
  assert.deepStrictEqual((won.seen.saved as Record<string, unknown>).wager_id, 77);
  assert.deepStrictEqual((won.seen.saved as Record<string, unknown>).tx_hash, WAGER_TX);
  assert.deepStrictEqual(won.pushes, [[LOW, 'wager_77', { kind: 'won', wagered: '5', label: 'Rhythm Rush' }]]);
  const lost = world();
  await lost.submit(body({ wagerId: 78, wagered: '5', score: 100 }), true);
  assert.deepStrictEqual(lost.pushes, [[LOW, 'wager_78', { kind: 'lost', label: 'Rhythm Rush' }]]);
  // the wager did not land on-chain: the player's own score tx is the proof, it IS verified, and nobody is pinged
  const pending = world({ wagerTx: null });
  const p = await pending.submit(body({ wagerId: 79, wagered: '5' }), true);
  assert.strictEqual(p.body.txHash, TX);
  assert.ok(pending.order.includes('verify'));
  assert.strictEqual((pending.seen.saved as Record<string, unknown>).wager_id, 79); // the wager is still recorded against the score
  // a wager id of 0 is "no wager": nothing is resolved, nothing is recorded
  const zero = world();
  await zero.submit(body({ wagerId: 0, wagered: 0 }), true);
  assert.ok(!zero.order.includes('resolveWager'));
  assert.deepStrictEqual([(zero.seen.saved as Record<string, unknown>).wager_id, (zero.seen.saved as Record<string, unknown>).wagered], [null, null]);
  assert.deepStrictEqual(pending.pushes, []);
  // both present: the wager tx is saved, the score tx is still verified
  const both = world();
  assert.strictEqual((await both.submit(body({ wagerId: 80 }), true)).body.txHash, WAGER_TX);
  assert.deepStrictEqual(both.seen.verify, [TX, P, 0]);
  assert.strictEqual(both.seen.gaslessAsked, TX); // the gasless question is asked about the SCORE tx, never the wager tx
});

test('rewards are best effort: a failure after the save never costs the player the score', async () => {
  const w = world({ throws: ['missions', 'achievements', 'rank'] });
  const r = await w.submit(body(), true);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.rank, 0);
  assert.deepStrictEqual(r.body.newAchievements, []);
  assert.ok(w.order.includes('save'));
  assert.deepStrictEqual(w.logs.slice(0, 3), ['mission progress update failed: missions down', 'achievement check failed: achievements down', 'rank lookup failed: rank down']);
});

test('the save is awaited, the season is read once, and nothing after the save can fail the reply', async () => {
  const slow = world({ slowSave: true });
  await slow.submit(body(), true);
  // caches are cleared, and XP awarded, only once the score is really in
  assert.deepStrictEqual(slow.order.filter((x) => ['save', 'invalidate', 'awardXp'].includes(x)), ['save', 'invalidate', 'awardXp']);
  // a season rolling over mid-request must not split one save across two seasons
  const roll = world({ seasons: [42, 43] });
  await roll.submit(body(), true);
  assert.strictEqual((roll.seen.saved as Record<string, unknown>).season_number, 42);
  assert.deepStrictEqual(roll.seen.rank, [LOW, 500, 0, 1_000_042]);
  assert.strictEqual(roll.order.filter((x) => x === 'season').length, 1);
  // notifications are fired and forgotten: one that never settles, or rejects, changes nothing
  const hang = world({ rank: 1, hangNotify: true });
  const answered = await Promise.race([hang.submit(body(), true), new Promise<null>((r) => setTimeout(() => r(null), 500))]);
  assert.strictEqual(answered?.status, 200, 'the reply must not wait on a notification');
  const rej = world({ rank: 1, rejectPush: true, achievements: [{ id: 'a', name: 'A' }] });
  assert.strictEqual((await rej.submit(body({ wagerId: 5, wagered: '1' }), true)).status, 200);
  await new Promise((r) => setTimeout(r, 10)); // an unhandled rejection here would fail the run
  // an XP failure after the save: the score stands and the player is told so
  const xp = world();
  xp.deps.awardXp = async () => { throw new Error('users table down'); };
  const r = await createSubmitService(xp.deps)(body(), true);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.success, true);
  assert.strictEqual(r.body.xp, undefined);
  assert.ok(xp.logs.includes('xp award failed (score is saved): users table down'));
  // a notification that cannot even be built does not throw into the save path
  const bad = world({ achievements: [{ id: 'x', name: 'X' }] });
  bad.deps.push.achievement = () => { throw new Error('no title'); };
  assert.strictEqual((await createSubmitService(bad.deps)(body(), true)).status, 200);
  // a helper that throws something with no message is still logged
  const odd = world();
  odd.deps.seasonRank = async () => { throw 'subgraph offline'; };
  await createSubmitService(odd.deps)(body(), true);
  assert.ok(odd.logs.includes('rank lookup failed: subgraph offline'));
});

test('achievements each notify once, keyed by id', async () => {
  const w = world({ achievements: [{ id: 'rhythm_fc', name: 'Full Combo', icon: '🎯' }, { name: 'Nameless' }, { id: 'only_id' }] });
  const r = await w.submit(body({ fullCombo: true }), true);
  assert.strictEqual((r.body.newAchievements as unknown[]).length, 3);
  assert.strictEqual((w.seen.ach as [string, { fullCombo: boolean }])[1].fullCombo, true);
  assert.deepStrictEqual(w.pushes, [
    [LOW, 'achievement_rhythm_fc', { kind: 'ach', name: 'Full Combo', icon: '🎯' }],
    [LOW, 'achievement_Nameless', { kind: 'ach', name: 'Nameless', icon: undefined }],
    [LOW, 'achievement_only_id', { kind: 'ach', name: 'only_id', icon: undefined }],
  ]);
  assert.deepStrictEqual((await world({ achievements: null }).submit(body(), true)).body.newAchievements, null);
});

test('landing in the top three works out the new board and notifies; lower ranks do not', async () => {
  const entry = (wallet: string, score: number): LeaderboardEntry => ({ wallet_address: wallet, score, username: null, created_at: 'x', tx_hash: null });
  const board = [entry('0xaaa', 900), entry(LOW, 300), entry('0xbbb', 450)];
  const w = world({ rank: 2, board });
  await w.submit(body(), true);
  assert.deepStrictEqual(w.seen.board, [0, 1_000_042, 50]);
  const d = w.seen.displacement as { g: string; w: string; before: LeaderboardEntry[]; after: LeaderboardEntry[] };
  assert.strictEqual(d.g, 'rhythm');
  assert.strictEqual(d.w, LOW);
  assert.deepStrictEqual(d.before, board);
  // the player's old row is replaced by the new score, and the board is re-sorted
  assert.deepStrictEqual(d.after, [entry('0xaaa', 900), { wallet_address: LOW, score: 500, username: null, created_at: new Date(T0).toISOString(), tx_hash: TX }, entry('0xbbb', 450)]);
  assert.ok((await (async () => { const x = world({ rank: 3 }); await x.submit(body(), true); return x.order; })()).includes('displacement')); // third place counts
  for (const rank of [0, 4, 12]) assert.ok(!(await (async () => { const x = world({ rank }); await x.submit(body(), true); return x.order; })()).includes('leaderboard'));
  const flaky = world({ rank: 1, throws: ['leaderboard'] }); // the board lookup failing keeps the rank
  assert.strictEqual((await flaky.submit(body(), true)).body.rank, 1);
});

test('bad requests are refused before anything is touched', async () => {
  const w = world();
  assert.deepStrictEqual(await w.submit({}, true), { status: 400, body: { error: 'Missing playerAddress or scoreData' } });
  assert.deepStrictEqual(await w.submit({ playerAddress: P }, true), { status: 400, body: { error: 'Missing playerAddress or scoreData' } });
  assert.deepStrictEqual(await w.submit({ playerAddress: { x: 1 }, scoreData: {} }, true), { status: 400, body: { error: 'Missing playerAddress or scoreData' } });
  assert.deepStrictEqual(await w.submit(body({ game: 'chess' }), true), { status: 400, body: { error: 'Validation failed', reason: 'Unknown game' } });
  assert.deepStrictEqual(await w.submit(body({ score: 2_000_000 }), true), { status: 400, body: { error: 'Validation failed', reason: 'Score out of range' } });
  assert.deepStrictEqual(await w.submit(body({ gameTime: 1000 }), true), { status: 400, body: { error: 'Validation failed', reason: 'Game time too short' } });
  assert.deepStrictEqual(w.order, []);
});

test('the legacy session check, for a server with no secret configured', async () => {
  const s = (over: Record<string, unknown> = {}) => ({ ...body(), session: { token: '0xsig', timestamp: T0 - 70_000, nonce: 'good', playerAddress: P, ...over } });
  assert.strictEqual((await world().submit(s(), false)).status, 200);
  assert.deepStrictEqual(await world().submit(body(), false), { status: 400, body: { error: 'Missing session token' } });
  assert.deepStrictEqual(await world().submit(s({ playerAddress: '0xother' }), false), { status: 403, body: { error: 'Session player mismatch' } });
  assert.deepStrictEqual(await world().submit(s({ nonce: 'forged' }), false), { status: 403, body: { error: 'Invalid session token' } });
  assert.deepStrictEqual(await world().submit(s({ timestamp: T0 - 10_000 }), false), { status: 403, body: { error: 'Cheating detected: Speed hack' } }); // claims 60 s, only 10 s passed
  assert.deepStrictEqual(await world().submit(s({ timestamp: T0 - 12 * 60_000 }), false), { status: 403, body: { error: 'Session expired' } });
  assert.deepStrictEqual(await world().submit(s({ playerAddress: undefined }), false), { status: 400, body: { error: 'Session verification failed' } });
});

test('over HTTP: trusted only with the configured secret; a crash is answered', async () => {
  const w = world();
  let secret: string | undefined = 's3';
  const app = express();
  app.use(express.json());
  let dbDown = false;
  const registerUser = w.deps.registerUser;
  const gates: string[] = [];
  registerSubmitRoute(app, { ...w.deps, registerUser: async (x) => { if (dbDown) throw new Error('db exploded'); return registerUser(x); }, requireSecret: (req, res, next) => { gates.push('secret'); if (req.headers['x-internal-secret'] === secret) next(); else res.status(401).json({ error: 'Unauthorized' }); }, limiter: (_q, _s, next) => { gates.push('limit'); next(); }, internalSecret: () => secret });
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/submit-score`;
  const post = async (b: unknown, headers: Record<string, string> = { 'x-internal-secret': 's3' }) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) }); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };
  try {
    assert.strictEqual((await post(body(), { 'x-internal-secret': 'wrong' })).status, 401);
    assert.deepStrictEqual(gates, ['secret']); // refused before the limiter
    assert.strictEqual((await post(body())).body.success, true); // trusted: no session needed
    assert.deepStrictEqual(gates, ['secret', 'secret', 'limit']); // the rate limit is applied, after the secret
    secret = undefined; // if the gate were ever loosened, the session check must take over
    assert.deepStrictEqual(await post(body(), {}), { status: 400, body: { error: 'Missing session token' } });
    secret = 's3';
    dbDown = true;
    assert.deepStrictEqual(await post(body()), { status: 500, body: { error: 'Failed to submit score' } });
  } finally {
    server.close();
  }
});

test('adapter: best score this season', async () => {
  const calls: unknown[][] = [];
  const db = (rows: unknown) => ({ from: (t: string) => { const q: Record<string, unknown> = {}; const step = (n: string) => (...a: unknown[]) => { calls.push([t, n, ...a]); return q; }; Object.assign(q, { select: step('select'), eq: step('eq'), order: step('order'), limit: async (n: number) => { calls.push([t, 'limit', n]); return { data: rows, error: null }; } }); return q; } });
  assert.strictEqual(await supabaseBestThisSeason(db([{ score: 880 }]))('0xabc', 'stack', 42), 880);
  assert.deepStrictEqual(calls, [['scores', 'select', 'score'], ['scores', 'eq', 'wallet_address', '0xabc'], ['scores', 'eq', 'game', 'stack'], ['scores', 'eq', 'season_number', 42], ['scores', 'order', 'score', { ascending: false }], ['scores', 'limit', 1]]);
  assert.strictEqual(await supabaseBestThisSeason(db([]))('0xabc', 'stack', 42), 0);
  assert.strictEqual(await supabaseBestThisSeason(db(null))('0xabc', 'stack', 42), 0);
  assert.strictEqual(await supabaseBestThisSeason(db([{ score: null }]))('0xabc', 'stack', 42), 0);
});
