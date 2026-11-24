import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdmin, hashPassword, checkPassword, range, type Admin, type AdminStore } from './service';

function world() {
  const clock = { t: Date.parse('2026-11-25T10:00:00Z') };
  const admins = new Map<string, Admin>(); const log: [string, string][] = []; const calls: [string, Record<string, unknown>][] = []; const payouts: Record<string, unknown>[] = []; const events: string[] = [];
  const add = (email: string, role: Admin['role'], password = 'correct horse battery') => admins.set(email, { email, name: null, role, disabled: false, pass_hash: hashPassword(password) });
  const store: AdminStore = {
    rpc: async (name, args) => { calls.push([name, args]); return { data: name === 'admin_verify_queue' ? [{ wallet: '0x' + '1'.repeat(40) }, { wallet: '0x' + '2'.repeat(40) }, { wallet: '0x' + '3'.repeat(40) }] : name === 'admin_set_verified' ? args.is_verified === true : name === 'admin_track' ? (args.batch as unknown[]).length : { n: 1 }, error: null }; },
    admin: async (e) => admins.get(e) ?? null, admins: async () => [...admins.values()],
    saveAdmin: async (r) => { admins.set(r.email, { ...r, disabled: false }); return null; }, setDisabled: async (e, d) => { const a = admins.get(e); if (a) a.disabled = d; return null; },
    touchLogin: async () => {}, log: async (e, a) => { log.push([e, a]); }, actions: async () => log,
    payouts: async () => ({ rows: payouts, total: payouts.length }), addPayout: async (r) => { if (payouts.some((p) => p.tx_hash && p.tx_hash === r.tx_hash && p.wallet === r.wallet)) return 'duplicate key'; payouts.push(r); return null; },
    setPayoutStatus: async () => null, event: async (r) => { events.push(r.kind); },
  };
  return { svc: createAdmin({ store, now: () => clock.t }), clock, add, admins, log, calls, payouts, events };
}

test('passwords: salted, never stored, a wrong one is refused', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/); assert.notEqual(h, hashPassword('correct horse battery'));
  assert.equal(checkPassword('correct horse battery', h), true); assert.equal(checkPassword('correct horse batterx', h), false); assert.equal(checkPassword('x', 'plain'), false);
});

test('sign-in: right password in, wrong out, disabled out, five wrong tries lock the email for a while', async () => {
  const w = world(); w.add('boss@x.io', 'super_admin');
  assert.deepEqual((await w.svc.login({ email: 'Boss@X.io ', password: 'correct horse battery' })).body, { email: 'boss@x.io', name: null, role: 'super_admin' });
  assert.equal((await w.svc.login({ email: 'nobody@x.io', password: 'whatever whatever' })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await w.svc.login({ email: 'boss@x.io', password: 'nope' })).status, 401);
  assert.equal((await w.svc.login({ email: 'boss@x.io', password: 'correct horse battery' })).status, 429, 'locked, even with the right password');
  w.clock.t += 16 * 60_000; assert.equal((await w.svc.login({ email: 'boss@x.io', password: 'correct horse battery' })).status, 200);
  w.admins.get('boss@x.io')!.disabled = true; assert.equal((await w.svc.login({ email: 'boss@x.io', password: 'correct horse battery' })).status, 401);
  assert.ok(w.log.some(([, a]) => a === 'login') && w.log.some(([, a]) => a === 'login_failed'));
});

test('roles: an analyst reads but cannot pay or manage; an admin pays but cannot manage; a role is never taken from the request', async () => {
  const w = world(); w.add('ana@x.io', 'analyst'); w.add('adm@x.io', 'admin'); w.add('sup@x.io', 'super_admin');
  const W = '0x' + 'a'.repeat(40); const TX = '0x' + 'b'.repeat(64);
  assert.equal((await w.svc.read(undefined, 'overview', {})).status, 401);
  assert.equal((await w.svc.read('ana@x.io', 'overview', {})).status, 200);
  assert.equal((await w.svc.read('ana@x.io', 'admins', {})).status, 403); assert.equal((await w.svc.read('adm@x.io', 'actions', {})).status, 403);
  assert.equal((await w.svc.recordPayout('ana@x.io', { wallet: W, amount: 10, txHash: TX })).status, 403);
  assert.equal((await w.svc.recordPayout('adm@x.io', { wallet: W, amount: 10, txHash: TX, reason: 'Week 42, 1st' })).status, 200);
  assert.equal((await w.svc.recordPayout('adm@x.io', { wallet: W, amount: 10, txHash: TX })).status, 409, 'the same transfer is not recorded twice');
  assert.equal((await w.svc.recordPayout('adm@x.io', { wallet: W, amount: 10 })).body.error, 'tx_needed', 'a payout marked sent needs its transaction');
  assert.equal((await w.svc.recordPayout('adm@x.io', { wallet: W, amount: 10, status: 'pending' })).status, 200, 'one that is still owed does not');
  assert.equal((await w.svc.recordPayout('adm@x.io', { wallet: 'nope', amount: 10, txHash: TX })).status, 400); assert.equal((await w.svc.recordPayout('adm@x.io', { wallet: W, amount: -1, txHash: TX })).status, 400);
  assert.equal((await w.svc.saveAdmin('adm@x.io', { email: 'new@x.io', role: 'analyst', password: 'a long enough one' })).status, 403);
  assert.equal((await w.svc.saveAdmin('sup@x.io', { email: 'new@x.io', role: 'analyst', password: 'short' })).body.error, 'weak_password');
  assert.equal((await w.svc.saveAdmin('sup@x.io', { email: 'new@x.io', role: 'analyst', password: 'a long enough one' })).status, 200);
  assert.equal((await w.svc.login({ email: 'new@x.io', password: 'a long enough one' })).status, 200);
  assert.equal((await w.svc.disableAdmin('sup@x.io', { email: 'sup@x.io' })).body.error, 'not_yourself');
  assert.equal((await w.svc.disableAdmin('sup@x.io', { email: 'new@x.io' })).status, 200); assert.equal((await w.svc.read('new@x.io', 'overview', {})).status, 401, 'a disabled admin is out at once');
  const list = (await w.svc.read('sup@x.io', 'admins', {})).body.data as Record<string, unknown>[];
  assert.ok(list.length === 4 && list.every((a) => !('pass_hash' in a)), 'password hashes never leave the server');
  assert.ok(w.events.includes('payout_recorded'));
});

test('reads ask the database by name, with a bounded date range', async () => {
  const w = world(); w.add('ana@x.io', 'analyst');
  assert.deepEqual(range({}, w.clock.t), { from: '2026-10-27', to: '2026-11-25' });
  assert.deepEqual(range({ from: '2026-11-01', to: '2026-11-07' }, w.clock.t), { from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(range({ days: 99999 }, w.clock.t).from, '2024-11-26', 'two years at most');
  await w.svc.read('ana@x.io', 'games', { days: 7 }); await w.svc.read('ana@x.io', 'players', { q: '0xAB', who: 'verified', limit: 5000 }); await w.svc.read('ana@x.io', 'feed', { kind: 'payout' });
  assert.deepEqual(w.calls[0], ['admin_games', { from_day: '2026-11-19', to_day: '2026-11-25' }]);
  assert.deepEqual(w.calls[1], ['admin_players', { q: '0xAB', who: 'verified', lim: 300, off: 0 }]);
  assert.deepEqual(w.calls[2], ['admin_feed', { lim: 50, before: null, only_kind: 'payout' }]);
  assert.equal((await w.svc.read('ana@x.io', 'player', { wallet: 'x' })).status, 400); assert.equal((await w.svc.read('ana@x.io', 'nonsense', {})).status, 404);
});

test('tracking keeps what is well formed, drops the rest, and cannot be flooded by one browser', async () => {
  const w = world();
  const r = await w.svc.track({ events: [{ anon_id: 'abcd1234', kind: 'pageview', path: '/games/stack?x=1', device: 'phone', ref: 'x.com' }, { anon_id: 'short', path: '/' }, { anon_id: 'abcd1234', kind: 'Bad Kind!' }, { anon_id: 'wxyz9876', wallet: '0x' + 'c'.repeat(40), kind: 'game_start', embed: 'minipay', props: { game: 'stack' } }, 'junk'] });
  assert.equal(r.body.stored, 2);
  const batch = w.calls[0]![1].batch as Record<string, unknown>[];
  assert.equal(batch[0]!.path, '/games/stack', 'the query string is not kept'); assert.equal(batch[1]!.wallet, '0x' + 'c'.repeat(40));
  let stored = 0; for (let i = 0; i < 8; i++) stored += Number((await w.svc.track({ events: Array.from({ length: 20 }, () => ({ anon_id: 'flooder1', path: '/' })) })).body.stored);
  assert.equal(stored, 60, 'sixty a minute from one browser, then nothing');
});

test('the verification sweep records what the chain says, and a chain error is "unknown", never "not verified"', async () => {
  const w = world();
  const out = await w.svc.sweepVerification(async (wallet) => { if (wallet.endsWith('2')) throw new Error('rpc down'); return wallet.endsWith('1'); });
  assert.deepEqual(out, { checked: 2, newly: 1 });
  assert.deepEqual(w.calls.filter(([n]) => n === 'admin_set_verified').map(([, a]) => a.is_verified), [true, false]);
});

import { createPurchaseIndexer, CONFIRMATIONS, MAX_SPAN, type Purchase } from './chain';

test('the purchase reader walks forward in ranges, stores each with its cursor, and never skips a range that failed', async () => {
  const saved: { upto: number; n: number }[] = []; const asked: [number, number][] = []; let cursor: number | null = null; let failOnce = true; let storeDown = false;
  const at = (block: number) => ({ tx_hash: '0x' + block.toString(16).padStart(64, '0'), log_index: 0, block, kind: 'perk' as const, wallet: '0x' + 'a'.repeat(40), item: 6, total: '50', ubi: '10', treasury: '40' });
  const idx = createPurchaseIndexer({
    startBlock: 1000,
    reader: { head: async () => 20_000 + CONFIRMATIONS, blockTime: async (b) => 1_700_000_000 + b,
      purchases: async (from, to) => { asked.push([from, to]); if (from === 6000 && failOnce) { failOnce = false; throw new Error('query exceeds range'); } return [1500, 7200, 19_999].filter((b) => b >= from && b <= to).map(at); } },
    store: { cursor: async () => cursor, save: async (upto, batch: Purchase[]) => { if (storeDown) return false; saved.push({ upto, n: batch.length }); cursor = upto; assert.ok(batch.every((p) => p.at === 1_700_000_000 + p.block)); return true; } },
  });
  const a = await idx.run(10);
  assert.deepEqual(asked.slice(0, 2), [[1000, 5999], [6000, 10_999]]); assert.equal(MAX_SPAN, 5000);
  assert.equal(a.ranges, 1); assert.equal(cursor, 5999, 'the failed range was not stepped over'); assert.match(a.error!, /exceeds range/);
  const b = await idx.run(10);
  assert.equal(asked[2]![0], 6000, 'it starts again exactly where it failed'); assert.equal(asked[2]![1], 6000 + 2500 - 1, 'with half the range');
  assert.equal(cursor, 20_000, 'and reads to a few blocks short of the head'); assert.equal(b.behind, 0);
  assert.equal(saved.reduce((s, x) => s + x.n, 0), 3, 'every purchase stored exactly once');
  assert.equal((await idx.run(10)).ranges, 0, 'nothing new: nothing read');
  cursor = 100; storeDown = true; const c = await idx.run(3);
  assert.equal(c.error, 'could_not_store'); assert.equal(cursor, 100, 'if the database refuses, the cursor stays put');
});

test('with no key for the locked tables, sign-in says so instead of "wrong password"', async () => {
  const w = world(); w.add('boss@x.io', 'super_admin');
  const store = { admin: async () => null, rpc: async () => ({ data: null, error: null }) } as unknown as AdminStore;
  const svc = createAdmin({ store, canReadLocked: () => false });
  assert.deepEqual(await svc.login({ email: 'boss@x.io', password: 'correct horse battery' }), { status: 503, body: { error: 'server_key_missing' } });
  assert.equal((await svc.read('boss@x.io', 'overview', {})).body.error, 'server_key_missing');
});
