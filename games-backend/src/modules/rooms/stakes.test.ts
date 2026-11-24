import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomService, isFail, ROOM_TTL_MS, STAKE_TRIES, type EscrowRoom, type Fail, type GameRules, type RoomView, type Seat, type StakeChain } from './service';

// A game whose score is simply the number sent, and one the server cannot check.
const sure: GameRules = { verified: true, deal: () => ({}), maxProgress: 100, score: async (_s, proof) => ({ ok: true, score: Number((proof as { n: number }).n) }) };
const unsure: GameRules = { ...sure, verified: false };
const GAMES = { sure, unsure };
const W = (c: string) => '0x' + c.repeat(40);
const A = W('a'), B = W('b'), C = W('c'), X = W('e');
const ONE = 10n ** 18n;
const ok = <T>(v: T | Fail): T => { assert.ok(!isFail(v), `unexpected failure: ${JSON.stringify(v)}`); return v as T; };
const no = (v: unknown, error: string) => { assert.ok(isFail(v), `expected ${error}, got ${JSON.stringify(v)}`); assert.equal((v as Fail).error, error); return v as Fail; };

/** A pretend chain: escrow rooms in a map, and a record of every write. */
function world() {
  const clock = { t: 1_800_000_000_000 }; let n = 0;
  const escrows = new Map<number, EscrowRoom>(); const writes: string[] = []; const fail = { resolve: 0, refund: 0, read: false, lieAfterResolve: false };
  const chain: StakeChain = {
    room: async (id) => { if (fail.read) throw new Error('rpc down'); const e = escrows.get(id); return e ? { ...e, players: [...e.players] } : null; },
    codeHash: (secret) => 'hash:' + secret,
    resolve: async (id, scores) => {
      if (fail.resolve > 0) { fail.resolve--; throw new Error('rpc'); }
      const e = escrows.get(id)!; assert.equal(e.status, 'open', 'never resolve a closed room'); assert.equal(scores.length, e.players.length);
      e.status = 'resolved'; writes.push(`resolve ${id} ${scores.join(',')}`);
      if (fail.lieAfterResolve) { fail.lieAfterResolve = false; throw new Error('timeout waiting for receipt'); }
      return '0xresolve' + id;
    },
    refundAll: async (id) => { if (fail.refund > 0) { fail.refund--; throw new Error('rpc'); } const e = escrows.get(id)!; assert.equal(e.status, 'open'); e.status = 'refunded'; writes.push(`refund ${id}`); return '0xrefund' + id; },
  };
  const svc = createRoomService(GAMES, { now: () => clock.t, randomHex: (b) => (++n).toString(16).padStart(b * 2, '0'), stakes: { chain, feeBps: 1000, minWei: 10n * ONE, maxWei: 1000n * ONE } });
  /** what an honest host's wallet would open on the chain */
  const open = (id: number, by: string, capacity: number, joinCode: string, over: Partial<EscrowRoom> = {}) => { escrows.set(id, { status: 'open', creator: by, stakeWei: String(100n * ONE), seedWei: '0', feeBps: 1000, capacity, deadlineSec: Math.floor(clock.t / 1000) + 600, joinCodeHash: 'hash:' + joinCode, useAllowlist: false, players: [by], ...over }); };
  const payIn = (id: number, wallet: string) => escrows.get(id)!.players.push(wallet);
  return { svc, clock, escrows, writes, fail, open, payIn };
}
/** three friends in a room, nothing staked yet */
function lobby(w = world(), game = 'sure') {
  const host = ok<Seat>(w.svc.create(game, 'Ada')); const bo = ok<Seat>(w.svc.join(host.code, 'Bo')); const cy = ok<Seat>(w.svc.join(host.code, 'Cy'));
  const joinCode = ok<RoomView>(w.svc.get(host.code, host.token)).joinCode!;
  return { ...w, host, bo, cy, code: host.code, joinCode };
}
/** ...who have all paid in, escrow 7, and are ready to start */
async function ready() {
  const L = lobby(); L.open(7, A, 3, L.joinCode);
  ok<RoomView>(await L.svc.stake(L.code, L.host.token, 7, A));
  L.payIn(7, C); ok<RoomView>(await L.svc.paid(L.code, L.cy.token, C)); // Cy pays before Bo: the escrow's order is A, C, B
  L.payIn(7, B); const v = ok<RoomView>(await L.svc.paid(L.code, L.bo.token, B));
  assert.equal(v.stake!.state, 'ready'); assert.deepEqual(v.stake!.paid, [true, true, true]);
  return L;
}

test('the whole way through: everyone pays in, plays, and the contract is given the scores in ITS order', async () => {
  const L = await ready();
  ok<RoomView>(L.svc.start(L.code, L.host.token));
  ok<RoomView>(await L.svc.finish(L.code, L.host.token, { n: 40 }));
  ok<RoomView>(await L.svc.finish(L.code, L.bo.token, { n: 90 }));
  assert.equal(await L.svc.settle(L.code), 'playing', 'nothing is paid while someone is still playing');
  ok<RoomView>(await L.svc.finish(L.code, L.cy.token, { n: 55 }));
  assert.equal(await L.svc.settle(L.code), 'paid');
  assert.deepEqual(L.writes, ['resolve 7 40,55,90']); // seats are Ada, Bo, Cy; the escrow is A, C, B
  const v = ok<RoomView>(L.svc.get(L.code, L.cy.token));
  assert.equal(v.stake!.state, 'paid'); assert.equal(v.stake!.winnerSeat, 1); assert.equal(v.stake!.tx, '0xresolve7');
  assert.equal(await L.svc.settle(L.code), 'paid'); assert.equal(await L.svc.settleDue(), 0);
  assert.equal(L.writes.length, 1, 'paid once, however often it is asked');
  // a rematch starts clean: no entry, a new join code, nobody marked as paid
  const again = ok<RoomView>(L.svc.rematch(L.code, L.host.token));
  assert.equal(again.stake, undefined); assert.notEqual(again.joinCode, L.joinCode);
  no(await L.svc.stake(L.code, L.host.token, 7, A), 'bad_escrow'); // an escrow room is used once
});

test('the join code goes to the players in the room and to nobody else', () => {
  const L = lobby();
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.bo.token)).joinCode, L.joinCode);
  const stranger = ok<RoomView>(L.svc.get(L.code, 'f'.repeat(32)));
  assert.equal(stranger.you, -1); assert.equal(stranger.joinCode, undefined);
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.bo.token)).stakes, true);
});

test('an escrow room is refused unless every term on the chain is right', async () => {
  const bad: [string, Partial<EscrowRoom>][] = [
    ['closed', { status: 'resolved' }], ['someone else opened it', { creator: X, players: [X] }], ['others already in it', { players: [A, X] }],
    ['wrong size', { capacity: 4 }], ['too small', { stakeWei: String(ONE) }], ['too big', { stakeWei: String(5000n * ONE) }], ['unreadable entry', { stakeWei: 'lots' }],
    ['a prize on top', { seedWei: '5' }], ['wrong fee', { feeBps: 0 }], ['allowlist', { useAllowlist: true }], ['another room\'s code', { joinCodeHash: 'hash:other' }],
    ['deadline too close', { deadlineSec: 1_800_000_000 + 60 }], ['deadline too far', { deadlineSec: 1_800_000_000 + 7200 }],
  ];
  for (const [what, over] of bad) {
    const L = lobby(); L.open(7, A, 3, L.joinCode, over);
    no(await L.svc.stake(L.code, L.host.token, 7, A), 'bad_escrow');
    assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).stake, undefined, what);
    ok<Seat>(L.svc.join(L.code, 'Di')); // a refused escrow locks nothing
  }
  const L = lobby(); L.open(7, A, 3, L.joinCode);
  no(await L.svc.stake(L.code, L.bo.token, 7, B), 'not_host');
  no(await L.svc.stake(L.code, L.host.token, 99, A), 'bad_escrow');   // no such room
  no(await L.svc.stake(L.code, L.host.token, 7, 'nope'), 'bad_wallet');
  no(await L.svc.stake(L.code, L.host.token, -1, A), 'bad_escrow');
  L.fail.read = true; no(await L.svc.stake(L.code, L.host.token, 7, A), 'bad_escrow'); L.fail.read = false;
  ok<RoomView>(await L.svc.stake(L.code, L.host.token, 7, A));
  no(await L.svc.stake(L.code, L.host.token, 7, A), 'locked');         // one escrow per round
  no(L.svc.join(L.code, 'Late'), 'locked');                           // sized to the players already here
});

test('stakes are only for games the server scores itself, and only when switched on', async () => {
  const L = lobby(world(), 'unsure'); L.open(7, A, 3, L.joinCode ?? '');
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).stakes, false);
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).joinCode, undefined);
  no(await L.svc.stake(L.code, L.host.token, 7, A), 'not_verified');
  const off = createRoomService(GAMES); const h = ok<Seat>(off.create('sure', 'A')); ok<Seat>(off.join(h.code, 'B'));
  no(await off.stake(h.code, h.token, 7, A), 'stakes_off'); no(await off.paid(h.code, h.token, A), 'stakes_off');
  assert.equal(await off.settle(h.code), null); assert.equal(ok<RoomView>(off.get(h.code, h.token)).stakes, false);
});

test('saying you paid is not enough: the chain has to show it, and one wallet is one seat', async () => {
  const L = lobby(); L.open(7, A, 3, L.joinCode);
  no(await L.svc.paid(L.code, L.bo.token, B), 'stake_pending');        // no escrow yet
  ok<RoomView>(await L.svc.stake(L.code, L.host.token, 7, A));
  no(await L.svc.paid(L.code, L.bo.token, B), 'not_paid');             // not on the chain
  no(await L.svc.paid(L.code, L.bo.token, A), 'wallet_taken');         // the host's wallet
  no(await L.svc.paid(L.code, 'f'.repeat(32), B), 'not_in_room');
  no(L.svc.start(L.code, L.host.token), 'stake_pending');
  L.payIn(7, B); ok<RoomView>(await L.svc.paid(L.code, L.bo.token, B));
  no(await L.svc.paid(L.code, L.cy.token, B), 'wallet_taken');         // Cy cannot ride on Bo's payment
  no(L.svc.start(L.code, L.host.token), 'stake_pending');              // two of three is not everyone
  L.payIn(7, X);                                                       // a stranger with the code fills the last place
  no(await L.svc.paid(L.code, L.cy.token, C), 'not_paid');
  no(L.svc.start(L.code, L.host.token), 'stake_pending');              // so this room never starts, and is refunded
  L.clock.t += 11 * 60_000;
  assert.equal(await L.svc.settle(L.code), 'refunded'); assert.deepEqual(L.writes, ['refund 7']);
});

test('someone backs out before the start: nobody plays, and everyone is refunded after the deadline', async () => {
  const L = await ready();
  ok(L.svc.leave(L.code, L.bo.token));
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).stake!.state, 'refund_due');
  no(L.svc.start(L.code, L.host.token), 'stake_pending');
  assert.equal(await L.svc.settle(L.code), 'refund_due', 'the contract will not refund before its deadline');
  assert.deepEqual(L.writes, []);
  L.clock.t += 10 * 60_000 + 20_000;
  assert.equal(await L.svc.settleDue(), 1);
  assert.deepEqual(L.writes, ['refund 7']);
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).stake!.state, 'refunded');
});

test('a round nobody scores in crowns nobody: it is refunded', async () => {
  const L = await ready(); ok<RoomView>(L.svc.start(L.code, L.host.token));
  for (const s of [L.host, L.bo, L.cy]) ok<RoomView>(await L.svc.finish(L.code, s.token, { n: 0 }));
  assert.equal(await L.svc.settle(L.code), 'refund_due');
  no(L.svc.rematch(L.code, L.host.token), 'stake_pending');           // not while money is unsettled
  L.clock.t += 11 * 60_000; assert.equal(await L.svc.settle(L.code), 'refunded'); assert.deepEqual(L.writes, ['refund 7']);
  ok<RoomView>(L.svc.rematch(L.code, L.host.token));
});

test('a tie for first place is never sent to the contract, which would hand the pot to the host', async () => {
  const L = await ready(); ok<RoomView>(L.svc.start(L.code, L.host.token));
  ok<RoomView>(await L.svc.finish(L.code, L.host.token, { n: 50 })); ok<RoomView>(await L.svc.finish(L.code, L.bo.token, { n: 50 })); ok<RoomView>(await L.svc.finish(L.code, L.cy.token, { n: 20 }));
  assert.equal(await L.svc.settle(L.code), 'refund_due'); assert.deepEqual(L.writes, []);
  L.clock.t += 11 * 60_000; assert.equal(await L.svc.settle(L.code), 'refunded'); assert.deepEqual(L.writes, ['refund 7']);
  // a tie lower down does not matter: there is one clear winner
  const M = await ready(); ok<RoomView>(M.svc.start(M.code, M.host.token));
  ok<RoomView>(await M.svc.finish(M.code, M.host.token, { n: 20 })); ok<RoomView>(await M.svc.finish(M.code, M.bo.token, { n: 20 })); ok<RoomView>(await M.svc.finish(M.code, M.cy.token, { n: 60 }));
  assert.equal(await M.svc.settle(M.code), 'paid'); assert.deepEqual(M.writes, ['resolve 7 20,60,20']);
});

test('a player who walks off mid-round scores nothing, and the others are still paid', async () => {
  const L = await ready(); ok<RoomView>(L.svc.start(L.code, L.host.token));
  ok<RoomView>(await L.svc.finish(L.code, L.host.token, { n: 12 })); ok<RoomView>(await L.svc.finish(L.code, L.cy.token, { n: 30 }));
  ok(L.svc.leave(L.code, L.bo.token));
  assert.equal(await L.svc.settle(L.code), 'paid'); assert.deepEqual(L.writes, ['resolve 7 12,30,0']);
});

test('a failed payout is tried again, never sent twice, and gives up into a refund', async () => {
  // the chain is down three times, then answers
  const L = await ready(); ok<RoomView>(L.svc.start(L.code, L.host.token));
  for (const [s, n] of [[L.host, 5], [L.bo, 9], [L.cy, 7]] as const) ok<RoomView>(await L.svc.finish(L.code, s.token, { n }));
  L.fail.resolve = 3;
  for (let i = 0; i < 3; i++) assert.equal(await L.svc.settle(L.code), 'playing');
  assert.equal(await L.svc.settle(L.code), 'paid'); assert.deepEqual(L.writes, ['resolve 7 5,7,9']);

  // the payout went through but the answer never came back: the next look at the chain sees it is done
  const M = await ready(); ok<RoomView>(M.svc.start(M.code, M.host.token));
  for (const [s, n] of [[M.host, 3], [M.bo, 4], [M.cy, 5]] as const) ok<RoomView>(await M.svc.finish(M.code, s.token, { n }));
  M.fail.lieAfterResolve = true;
  assert.equal(await M.svc.settle(M.code), 'playing');
  assert.equal(await M.svc.settle(M.code), 'paid'); assert.equal(M.writes.length, 1, 'not paid a second time');

  // the chain never answers: after the tries run out the room is refunded instead
  const N = await ready(); ok<RoomView>(N.svc.start(N.code, N.host.token));
  for (const [s, n] of [[N.host, 3], [N.bo, 4], [N.cy, 5]] as const) ok<RoomView>(await N.svc.finish(N.code, s.token, { n }));
  N.fail.resolve = 99;
  for (let i = 0; i < STAKE_TRIES - 1; i++) assert.equal(await N.svc.settle(N.code), 'playing');
  assert.equal(await N.svc.settle(N.code), 'refund_due');
  N.clock.t += 11 * 60_000; N.fail.refund = 1;
  assert.equal(await N.svc.settle(N.code), 'refund_due'); assert.equal(await N.svc.settle(N.code), 'refunded');
  assert.deepEqual(N.writes, ['refund 7']);
});

test('a room holding unsettled money is never forgotten: not when it goes quiet, not across a restart', async () => {
  const L = await ready(); ok<RoomView>(L.svc.start(L.code, L.host.token));
  for (const [s, n] of [[L.host, 3], [L.bo, 4], [L.cy, 5]] as const) ok<RoomView>(await L.svc.finish(L.code, s.token, { n }));
  L.fail.resolve = 99; await L.svc.settle(L.code);
  L.clock.t += ROOM_TTL_MS * 3;
  ok<Seat>(L.svc.create('sure', 'Someone else')); // creating a room clears out stale ones
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).stake!.state, 'playing', 'still here');
  for (const s of [L.host, L.bo, L.cy]) L.svc.leave(L.code, s.token);
  assert.ok(!isFail(L.svc.get(L.code, L.host.token)), 'everyone left; the room stays until the money is settled');

  // a restart: the saved room is stale by the clock but comes back, and is paid
  const saved = JSON.parse(JSON.stringify({ code: 'KEPT1', game: 'sure', status: 'playing', round: 1, seed: 'aa', startedAt: L.clock.t - 3_600_000, touched: L.clock.t - 3_600_000, secret: 's',
    players: [{ name: 'A', token: '1'.repeat(32), seen: 0, left: false, score: 8, done: true, progress: 0, wallet: A }, { name: 'B', token: '2'.repeat(32), seen: 0, left: false, score: 2, done: true, progress: 0, wallet: B }],
    stake: { escrowId: 21, stakeWei: String(100n * ONE), feeBps: 1000, capacity: 2, deadline: L.clock.t - 60_000, state: 'playing', tries: 0 } }));
  L.escrows.set(21, { status: 'open', creator: A, stakeWei: String(100n * ONE), seedWei: '0', feeBps: 1000, capacity: 2, deadlineSec: 0, joinCodeHash: 'hash:s', useAllowlist: false, players: [A, B] });
  L.fail.resolve = 0;
  assert.equal(L.svc.restore([saved, { ...saved, code: 'GONE1', stake: undefined }]), 1, 'the stale room with no money is dropped, the one with money returns');
  await L.svc.settleDue();
  assert.ok(L.writes.includes('resolve 21 8,2'));
});
