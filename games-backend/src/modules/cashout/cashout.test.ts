import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCashouts, noteFor, verifySignature, TOLERANCE_S, type CashoutRow, type CashoutStore, type Note } from './service';

const SECRET = 'whsec_test'; const A = '0x' + 'a'.repeat(40);
const sign = (body: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
function world() {
  const clock = { t: 1_800_000_000_000 }; const rows = new Map<string, CashoutRow>(); const events = new Set<string>(); const told: { wallet: string; category: string; note: Note }[] = []; const fail = { save: false, event: false };
  const store: CashoutStore = {
    save: async (r) => { if (fail.save) return false; rows.set(r.id, r); return true; },
    event: async (id) => { if (fail.event) return 'failed'; if (events.has(id)) return 'seen'; events.add(id); return 'new'; },
  };
  const svc = createCashouts({ store, secret: SECRET, notify: async (wallet, category, note) => { told.push({ wallet, category, note }); }, now: () => clock.t });
  const send = (evt: unknown, opts: { secret?: string; at?: number; header?: string } = {}) => { const body = JSON.stringify(evt); return svc.webhook(Buffer.from(body), opts.header ?? sign(body, Math.floor((opts.at ?? clock.t) / 1000), opts.secret)); };
  return { clock, rows, events, told, fail, svc, send };
}
const cashout = (over: Record<string, unknown> = {}) => ({ id: 'co_1', object: 'cashout', mode: 'live', status: 'paid', wallet: '0x' + 'B'.repeat(40), amountG: '25000', receive: { naira: 3243.7, minimumNaira: 3195 }, feePercent: 3, partnerRef: A.toUpperCase().replace('0X', '0x'), txHash: '0x' + 'AB'.repeat(32), createdAt: '2026-11-26T10:00:00Z', paidAt: '2026-11-26T10:03:00Z', ...over });
const flush = () => new Promise((r) => setImmediate(r));

test('the signature: right secret and fresh, or nothing', () => {
  const body = '{"a":1}'; const now = 1_800_000_000_000; const t = now / 1000;
  assert.equal(verifySignature(body, sign(body, t), SECRET, now), true);
  assert.equal(verifySignature(Buffer.from(body), sign(body, t), SECRET, now), true, 'raw bytes work as well as text');
  assert.equal(verifySignature(body + ' ', sign(body, t), SECRET, now), false, 'one changed byte');
  assert.equal(verifySignature(body, sign(body, t, 'other'), SECRET, now), false);
  assert.equal(verifySignature(body, sign(body, t - TOLERANCE_S - 1), SECRET, now), false, 'an old call replayed');
  assert.equal(verifySignature(body, sign(body, t + TOLERANCE_S + 1), SECRET, now), false);
  assert.equal(verifySignature(body, sign(body, t), '', now), false, 'no secret set: nothing passes');
  for (const junk of [undefined, null, 42, '', 't=1', 'v1=abc', `t=${t},v1=zz`, ['x']]) assert.equal(verifySignature(body, junk, SECRET, now), false);
});

test('a paid cash out is kept and the player is told once, however many times GoodCash says it', async () => {
  const w = world();
  const first = await w.send({ id: 'evt_1', type: 'cashout.paid', data: cashout() });
  assert.deepEqual(first, { status: 200, body: { ok: true } }); await flush();
  assert.deepEqual(w.rows.get('co_1'), { id: 'co_1', wallet: A, amount_g: 25000, naira: 3243.7, fee_percent: 3, status: 'paid', mode: 'live', tx_hash: '0x' + 'ab'.repeat(32), created_at: '2026-11-26T10:00:00.000Z', paid_at: '2026-11-26T10:03:00.000Z' });
  assert.equal(w.told.length, 1); assert.equal(w.told[0]!.wallet, A, 'the wallet we named when it started, not the one that paid');
  assert.equal(w.told[0]!.note.title, '₦3,243 paid to your bank'); assert.equal(w.told[0]!.category, 'cashout_co_1_paid');
  assert.deepEqual((await w.send({ id: 'evt_1', type: 'cashout.paid', data: cashout() })).body, { ok: true, repeat: true }); await flush();
  assert.equal(w.told.length, 1, 'a repeat is thanked and not told again');
});

test('forged, altered, stale and malformed calls are refused and change nothing', async () => {
  const w = world(); const evt = { id: 'evt_x', type: 'cashout.paid', data: cashout() };
  assert.equal((await w.send(evt, { secret: 'guess' })).body.error, 'bad_signature');
  assert.equal((await w.send(evt, { at: w.clock.t - (TOLERANCE_S + 5) * 1000 })).body.error, 'bad_signature');
  assert.equal((await w.send(evt, { header: 'nope' })).status, 400);
  const body = JSON.stringify(evt);
  assert.equal((await w.svc.webhook(Buffer.from(body.replace('25000', '99999')), sign(body, w.clock.t / 1000))).body.error, 'bad_signature', 'the amount was changed after signing');
  assert.equal((await w.svc.webhook(undefined, 'x')).body.error, 'bad_body');
  assert.equal((await w.svc.webhook(Buffer.alloc(70 * 1024), 'x')).body.error, 'bad_body');
  const junk = 'not json'; assert.equal((await w.svc.webhook(junk, sign(junk, w.clock.t / 1000))).body.error, 'bad_json');
  assert.equal((await w.send({ id: 'evt_y', type: 'cashout.paid', data: cashout({ status: 'weird' }) })).body.error, 'bad_cashout');
  assert.equal(w.rows.size, 0); assert.equal(w.told.length, 0);
  assert.equal((await createCashouts({ store: { save: async () => true, event: async () => 'new' }, secret: '' }).webhook(Buffer.from('{}'), 'x')).status, 503, 'no secret set: the door is shut');
});

test('what it does with each kind of news', async () => {
  const w = world();
  assert.deepEqual((await w.send({ id: 'e0', type: 'cashout.test', data: {} })).body, { ok: true, test: true });
  assert.deepEqual((await w.send({ id: 'e1', type: 'topup.delivered', data: { id: 'tu_1' } })).body, { ok: true, ignored: true });
  await w.send({ id: 'e2', type: 'cashout.sent', data: cashout({ id: 'co_2', status: 'sent', paidAt: null }) }); await flush();
  assert.equal(w.rows.get('co_2')!.status, 'sent'); assert.equal(w.told.length, 0, 'sent is not worth a message: they just did it');
  await w.send({ id: 'e3', type: 'cashout.refunded', data: cashout({ id: 'co_2', status: 'refunded', paidAt: null }) }); await flush();
  assert.match(w.told[0]!.note.body, /25,000 G\$ is back in your wallet/);
  await w.send({ id: 'e4', type: 'cashout.failed', data: cashout({ id: 'co_3', status: 'failed' }) }); await flush();
  assert.match(w.told[1]!.note.body, /Reference: co_3/);
  await w.send({ id: 'e5', type: 'cashout.delayed', data: cashout({ id: 'co_4', status: 'processing', mode: 'test' }) }); await flush();
  assert.equal(w.told[2]!.note.title, 'Test: Your cash out is taking longer');
  // nobody to tell: kept all the same
  await w.send({ id: 'e6', type: 'cashout.paid', data: cashout({ id: 'co_5', partnerRef: 'player-42', wallet: 'none' }) }); await flush();
  assert.equal(w.rows.get('co_5')!.wallet, null); assert.equal(w.told.length, 3);
  assert.equal(noteFor('cashout.expired', w.rows.get('co_5')!), null);
});

test('when the database is down GoodCash is asked to try again, and the retry is not lost', async () => {
  const w = world(); const evt = { id: 'evt_9', type: 'cashout.paid', data: cashout({ id: 'co_9' }) };
  w.fail.save = true; assert.equal((await w.send(evt)).status, 500); await flush();
  assert.equal(w.events.size, 0, 'the event is not marked as handled'); assert.equal(w.told.length, 0);
  w.fail.save = false; w.fail.event = true; assert.equal((await w.send(evt)).status, 500); await flush(); assert.equal(w.told.length, 0);
  w.fail.event = false; assert.equal((await w.send(evt)).status, 200); await flush();
  assert.equal(w.told.length, 1); assert.equal(w.rows.get('co_9')!.status, 'paid');
});
