import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, backoffMs, isPermanent, isOutOfGas, MAX_ATTEMPTS, RESEND_AFTER_MS, type OutboxRow, type OutboxStore, type OutboxChain, type NewRow } from './service';

// A store that behaves like the table: one row per ticket, leases, statuses.
function memStore(clock: { t: number }) {
  const rows: (OutboxRow & { due: number; last_error?: string })[] = []; let seq = 0;
  const store: OutboxStore = {
    async enqueue(r: NewRow) { const had = rows.find((x) => x.session_token === r.sessionToken); if (had) return { ok: true, id: had.id, created: false }; rows.push({ id: ++seq, session_token: r.sessionToken, wallet: r.wallet, game: r.game, game_type: r.gameType, score: r.score, status: 'pending', attempts: 0, tx_hash: null, sent_at: null, due: clock.t }); return { ok: true, id: seq, created: true }; },
    async claim(limit, leaseMs) { const due = rows.filter((x) => x.status === 'pending' && x.due <= clock.t).slice(0, limit); for (const x of due) { x.due = clock.t + leaseMs; x.attempts++; } return due.map((x) => ({ ...x })); },
    async markSent(id, hash) { const x = rows.find((r) => r.id === id)!; x.status = 'sent'; x.tx_hash = hash; x.sent_at = new Date(clock.t).toISOString(); },
    async markConfirmed(id) { rows.find((r) => r.id === id)!.status = 'confirmed'; },
    async markFailed(id, reason) { const x = rows.find((r) => r.id === id)!; x.status = 'failed'; x.last_error = reason; },
    async retryLater(id, delayMs, reason) { const x = rows.find((r) => r.id === id)!; x.status = 'pending'; x.tx_hash = null; x.due = clock.t + delayMs; x.last_error = reason; },
    async sentUnconfirmed(olderThanMs, limit) { return rows.filter((x) => x.status === 'sent' && clock.t - Date.parse(x.sent_at!) >= olderThanMs).slice(0, limit).map((x) => ({ ...x })); },
    async counts() { const n = (s: string) => rows.filter((x) => x.status === s).length; const p = rows.filter((x) => x.status === 'pending'); return { pending: n('pending'), sent: n('sent'), confirmed: n('confirmed'), failed: n('failed'), oldestPendingMs: p.length ? 0 : null }; },
  };
  return { store, rows };
}
function world(chainOver: Partial<OutboxChain> = {}) {
  const clock = { t: Date.parse('2026-11-24T10:00:00Z') }; const { store, rows } = memStore(clock);
  const sends: { wallet: string; gameType: number; score: number }[] = []; const logs: string[] = [];
  const chain: OutboxChain = { submitScore: async (wallet, gameType, score) => { sends.push({ wallet, gameType, score }); return { hash: `0xhash${sends.length}` }; }, txState: async () => 'ok', ...chainOver };
  const box = createOutbox({ store, chain, now: () => clock.t, logger: { log: (m) => logs.push(m), warn: (m) => logs.push(m) } });
  return { box, rows, sends, logs, clock, store };
}
const run = (n: number): NewRow => ({ sessionToken: `tok${n}`, wallet: `0x${String(n).padStart(40, '0')}`, game: 'stack', gameType: 2, score: 10 + n });

test('queueing the same run twice is one row', async () => {
  const w = world();
  const a = await w.box.enqueue(run(1)); const b = await w.box.enqueue(run(1));
  assert.deepEqual([a.ok && a.created, b.ok && b.created, w.rows.length], [true, false, 1]);
});

test('the happy path: pending, sent, confirmed, each exactly once', async () => {
  const w = world(); await w.box.enqueue(run(1)); await w.box.enqueue(run(2));
  assert.deepEqual(await w.box.sendDue(), { sent: 2, retried: 0, failed: 0, stopped: false });
  assert.deepEqual(w.sends, [{ wallet: run(1).wallet, gameType: 2, score: 11 }, { wallet: run(2).wallet, gameType: 2, score: 12 }]);
  assert.deepEqual(await w.box.sendDue(), { sent: 0, retried: 0, failed: 0, stopped: false }); // nothing is sent twice
  w.clock.t += 10_000;
  assert.equal((await w.box.confirmSent()).confirmed, 2);
  assert.deepEqual(w.rows.map((r) => r.status), ['confirmed', 'confirmed']);
  assert.equal(w.sends.length, 2);
});

test('a passing failure is tried again later, waiting longer each time, and the score is never lost', async () => {
  let fails = 3;
  const w = world({ submitScore: async () => { if (fails-- > 0) throw new Error('timeout'); return { hash: '0xok' }; } });
  await w.box.enqueue(run(1));
  const waits: number[] = [];
  for (let i = 0; i < 3; i++) { assert.equal((await w.box.sendDue()).retried, 1); const due = (w.rows[0] as { due: number }).due - w.clock.t; waits.push(due); assert.equal((await w.box.sendDue()).retried, 0); w.clock.t += due; } // not due yet: left alone
  assert.deepEqual(waits, [backoffMs(1), backoffMs(2), backoffMs(3)]);
  assert.ok(waits[0]! < waits[1]! && waits[1]! < waits[2]!);
  assert.equal((await w.box.sendDue()).sent, 1);
  assert.equal(w.rows[0]!.status, 'sent');
});

test('a send the chain will never accept is marked failed and left alone', async () => {
  const w = world({ submitScore: async () => { throw new Error('execution reverted: No game pass'); } });
  await w.box.enqueue(run(1));
  assert.deepEqual(await w.box.sendDue(), { sent: 0, retried: 0, failed: 1, stopped: false });
  w.clock.t += 3_600_000;
  assert.deepEqual(await w.box.sendDue(), { sent: 0, retried: 0, failed: 0, stopped: false });
  assert.equal(w.rows[0]!.status, 'failed');
});

test('giving up after the last attempt, not before', async () => {
  const w = world({ submitScore: async () => { throw new Error('rpc down'); } });
  await w.box.enqueue(run(1));
  let failedAt = 0;
  for (let i = 1; i <= MAX_ATTEMPTS + 2 && !failedAt; i++) { const r = await w.box.sendDue(); if (r.failed) failedAt = i; w.clock.t += 6 * 60_000; }
  assert.equal(failedAt, MAX_ATTEMPTS);
});

test('out of gas pauses the queue: nothing is marked failed, and it resumes when topped up', async () => {
  let funded = false; let tries = 0;
  const w = world({ submitScore: async () => { tries++; if (!funded) throw new Error('insufficient funds for gas * price + value'); return { hash: `0x${tries}` }; } });
  for (let i = 1; i <= 5; i++) await w.box.enqueue(run(i));
  const r = await w.box.sendDue();
  assert.deepEqual([r.stopped, r.failed, tries], [true, 0, 1]); // one try, then stop: do not burn through the batch
  assert.ok(w.rows.every((x) => x.status === 'pending'));
  assert.equal((await w.box.status()).outOfGas, true);
  assert.equal(w.logs.filter((l) => l.includes('out of gas')).length, 1);
  funded = true; w.clock.t += 2 * 60_000;
  assert.equal((await w.box.sendDue()).sent, 5);
  assert.equal((await w.box.status()).outOfGas, false);
});

test('a sent row with no receipt is never resent while the chain still knows the transaction', async () => {
  let state: 'pending' | 'gone' | 'ok' = 'pending';
  const w = world({ txState: async () => state });
  await w.box.enqueue(run(1)); await w.box.sendDue();
  w.clock.t += RESEND_AFTER_MS + 60_000;
  assert.deepEqual(await w.box.confirmSent(), { confirmed: 0, reverted: 0, resend: 0, waiting: 1 });
  assert.equal((await w.box.sendDue()).sent, 0);
  assert.equal(w.sends.length, 1);
  state = 'ok';
  assert.equal((await w.box.confirmSent()).confirmed, 1);
});

test('a dropped transaction is sent again, but only after a wait and only once the chain has no trace of it', async () => {
  const w = world({ txState: async () => 'gone' });
  await w.box.enqueue(run(1)); await w.box.sendDue();
  w.clock.t += 30_000;
  assert.equal((await w.box.confirmSent()).resend, 0); // too soon: it may just not have spread yet
  w.clock.t += RESEND_AFTER_MS;
  assert.equal((await w.box.confirmSent()).resend, 1);
  assert.equal((await w.box.sendDue()).sent, 1);
  assert.equal(w.sends.length, 2);
});

test('a transaction that reverted on-chain is failed, and a chain we cannot reach changes nothing', async () => {
  const w = world({ txState: async () => 'reverted' });
  await w.box.enqueue(run(1)); await w.box.sendDue(); w.clock.t += 10_000;
  assert.equal((await w.box.confirmSent()).reverted, 1); assert.equal(w.rows[0]!.status, 'failed');
  const down = world({ txState: async () => { throw new Error('rpc down'); } });
  await down.box.enqueue(run(1)); await down.box.sendDue(); down.clock.t += 10_000;
  assert.deepEqual(await down.box.confirmSent(), { confirmed: 0, reverted: 0, resend: 0, waiting: 1 });
  assert.equal(down.rows[0]!.status, 'sent');
});

test('which errors are which', () => {
  assert.equal(isOutOfGas(new Error('insufficient funds for intrinsic transaction cost')), true);
  assert.equal(isPermanent(new Error('insufficient funds')), false);
  assert.equal(isPermanent(new Error('execution reverted: Not authorised')), true);
  assert.equal(isPermanent(new Error('socket hang up')), false);
  assert.deepEqual([backoffMs(1), backoffMs(2), backoffMs(20)], [5_000, 10_000, 300_000]);
});

// ── the fast path: a whole batch in one go ──
test('batch sending: results line up with rows, and rows after a failed send are tried again at once, not lost', async () => {
  const asked: number[][] = [];
  const w = world({ submitMany: async (rows) => { asked.push(rows.map((r) => r.score)); return rows.length === 5 ? [{ hash: '0xa' }, { hash: '0xb' }, { error: new Error('nonce too low') }] : rows.map((_, i) => ({ hash: `0xz${i}` })); } });
  for (let i = 1; i <= 5; i++) await w.box.enqueue(run(i));
  assert.deepEqual(await w.box.sendDue(), { sent: 2, retried: 1, failed: 0, stopped: false });
  assert.deepEqual(w.rows.map((r) => r.status), ['sent', 'sent', 'pending', 'pending', 'pending']);
  assert.equal(w.sends.length, 0); // the one-at-a-time path was not used
  assert.deepEqual(await w.box.sendDue(), { sent: 2, retried: 0, failed: 0, stopped: false }); // rows 4 and 5: due again straight away
  assert.deepEqual(asked, [[11, 12, 13, 14, 15], [14, 15]]);
  assert.equal(w.rows[2]!.status, 'pending'); // row 3 waits out its backoff
});

test('batch sending: out of gas pauses every row in the batch, and a batch that throws outright loses nothing', async () => {
  const gas = world({ submitMany: async () => [{ error: new Error('insufficient funds for gas') }] });
  for (let i = 1; i <= 3; i++) await gas.box.enqueue(run(i));
  const r = await gas.box.sendDue();
  assert.deepEqual([r.stopped, r.failed], [true, 0]);
  assert.ok(gas.rows.every((x) => x.status === 'pending'));
  const boom = world({ submitMany: async () => { throw new Error('rpc down'); } });
  await boom.box.enqueue(run(1)); await boom.box.enqueue(run(2));
  const b = await boom.box.sendDue();
  assert.deepEqual([b.sent, b.failed], [0, 0]);
  assert.ok(boom.rows.every((x) => x.status === 'pending'));
});
