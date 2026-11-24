import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomService, isFail, PERMIT_MIN_MS, ROOM_TTL_MS, ROUND_MAX_MS, STAKE_TRIES, type Fail, type GameRules, type Permit, type RoomView, type Seat, type StakePay } from './service';

// A game whose score is simply the number sent, and one the server cannot check.
const sure: GameRules = { verified: true, deal: () => ({}), maxProgress: 100, score: async (_s, proof) => ({ ok: true, score: Number((proof as { n: number }).n) }) };
const GAMES = { sure, unsure: { ...sure, verified: false } };
const W = (c: string) => '0x' + c.repeat(40);
const A = W('a'), B = W('b'), C = W('c');
const ONE = 10n ** 18n; const E100 = String(100n * ONE), E50 = String(50n * ONE);
const ok = <T>(v: T | Fail): T => { assert.ok(!isFail(v), `unexpected failure: ${JSON.stringify(v)}`); return v as T; };
const no = (v: unknown, error: string) => { assert.ok(isFail(v), `expected ${error}, got ${JSON.stringify(v)}`); assert.equal((v as Fail).error, error); return v as Fail; };

/** A pretend chain: wallets with balances, and a record of every payment. */
function world() {
  const clock = { t: 1_800_000_000_000 }; let n = 0;
  const balance = new Map<string, bigint>([[A, 500n * ONE], [B, 500n * ONE], [C, 500n * ONE]]);
  const used = new Set<string>(); const moves: string[] = []; const banned = new Set<string>();
  const fail = { collect: 0, check: false, lieAfterCollect: false };
  const sigOf = (p: Permit) => `${p.owner}:${p.value}:${p.deadline}`;
  const pay: StakePay = {
    // a permit here is genuine when its r names its owner, as a real signature would
    check: async (p) => { if (fail.check) throw new Error('rpc down'); if (p.r !== '0x' + p.owner.slice(2).padStart(64, '0')) return { ok: false, why: 'Not signed by that wallet' }; if (used.has(sigOf(p))) return { ok: false, why: 'Already used' }; if ((balance.get(p.owner) ?? 0n) < BigInt(p.value)) return { ok: false, why: 'Not enough G$' }; return { ok: true }; },
    collect: async (p, winner, winnerWei, feeWei) => {
      if (fail.collect > 0) { fail.collect--; throw new Error('rpc'); }
      const total = BigInt(winnerWei) + BigInt(feeWei);
      assert.equal(String(total), p.value, 'a permit is worth exactly one entry');
      if (used.has(sigOf(p))) return { ok: false, why: 'Already used' };
      if ((balance.get(p.owner) ?? 0n) < total) return { ok: false, why: 'The wallet no longer holds the entry' };
      used.add(sigOf(p)); balance.set(p.owner, balance.get(p.owner)! - total); balance.set(winner, (balance.get(winner) ?? 0n) + BigInt(winnerWei));
      moves.push(`${p.owner.slice(2, 3)}→${winner.slice(2, 3)} ${BigInt(winnerWei) / ONE}+${BigInt(feeWei) / ONE}`);
      if (fail.lieAfterCollect) { fail.lieAfterCollect = false; throw new Error('timeout waiting for receipt'); }
      return { ok: true, tx: '0xtx' + moves.length };
    },
    allowed: async (w) => !banned.has(w),
  };
  const svc = createRoomService(GAMES, { now: () => clock.t, randomHex: (b) => (++n).toString(16).padStart(b * 2, '0'), stakes: { pay, feeBps: 1000, entries: [E50, E100], spender: W('5') } });
  const sign = (owner: string, value = E100, mins = 30): Permit => ({ owner, value, deadline: Math.floor(clock.t / 1000) + mins * 60, v: 27, r: '0x' + owner.slice(2).padStart(64, '0'), s: '0x' + '1'.repeat(64) });
  return { svc, clock, balance, moves, fail, banned, sign };
}
function lobby(w = world(), game = 'sure') {
  const host = ok<Seat>(w.svc.create(game, 'Ada')); const bo = ok<Seat>(w.svc.join(host.code, 'Bo')); const cy = ok<Seat>(w.svc.join(host.code, 'Cy'));
  return { ...w, host, bo, cy, code: host.code };
}
/** three friends who have all signed for 100 G$ */
async function ready() {
  const L = lobby();
  ok<RoomView>(await L.svc.stake(L.code, L.host.token, E100, L.sign(A)));
  ok<RoomView>(await L.svc.commit(L.code, L.bo.token, L.sign(B)));
  const v = ok<RoomView>(await L.svc.commit(L.code, L.cy.token, L.sign(C)));
  assert.equal(v.stake!.state, 'ready'); assert.deepEqual(v.stake!.signed, [true, true, true]);
  return L;
}
const play = async (L: Awaited<ReturnType<typeof ready>>, a: number, b: number, c: number) => {
  ok<RoomView>(L.svc.start(L.code, L.host.token));
  ok<RoomView>(await L.svc.finish(L.code, L.host.token, { n: a })); ok<RoomView>(await L.svc.finish(L.code, L.bo.token, { n: b })); ok<RoomView>(await L.svc.finish(L.code, L.cy.token, { n: c }));
};

test('the whole way through: nothing moves until the round ends, then each loser pays the winner directly', async () => {
  const L = await ready();
  assert.deepEqual(L.moves, [], 'signing is not paying');
  ok<RoomView>(L.svc.start(L.code, L.host.token));
  ok<RoomView>(await L.svc.finish(L.code, L.host.token, { n: 40 })); ok<RoomView>(await L.svc.finish(L.code, L.bo.token, { n: 90 }));
  assert.equal(await L.svc.settle(L.code), 'playing', 'nothing is paid while someone is still playing');
  ok<RoomView>(await L.svc.finish(L.code, L.cy.token, { n: 55 }));
  assert.equal(await L.svc.settle(L.code), 'settled');
  assert.deepEqual(L.moves, ['a→b 90+10', 'c→b 90+10']); // 10% of each entry is the fee
  assert.equal(L.balance.get(B), 680n * ONE); assert.equal(L.balance.get(A), 400n * ONE);
  const v = ok<RoomView>(L.svc.get(L.code, L.cy.token));
  assert.equal(v.stake!.winnerSeat, 1); assert.deepEqual(v.stake!.pays, ['paid', null, 'paid']); assert.deepEqual(v.stake!.signed, [false, false, false], 'signatures are not kept once the round is settled');
  assert.equal(await L.svc.settle(L.code), 'settled'); assert.equal(await L.svc.settleDue(), 0);
  assert.equal(L.moves.length, 2, 'paid once, however often it is asked');
  const again = ok<RoomView>(L.svc.rematch(L.code, L.host.token));
  assert.equal(again.stake, undefined); // a rematch is free until the host sets an entry again
});

test('a phone is told the terms and who has signed, never a signature', async () => {
  const L = await ready();
  const v = ok<RoomView>(L.svc.get(L.code, L.bo.token));
  assert.deepEqual(v.stakeTerms, { spender: W('5'), entries: [E50, E100], feeBps: 1000 });
  assert.ok(!JSON.stringify(v).includes('1'.repeat(64)), 'no signature in what a phone receives');
  assert.ok(!JSON.stringify(ok<RoomView>(L.svc.get(L.code, 'f'.repeat(32)))).includes(A.slice(2)), 'a stranger does not learn the wallets either');
});

test('a tie for first, or a round nobody scores in, moves no money at all', async () => {
  const L = await ready(); await play(L, 50, 50, 20);
  assert.equal(await L.svc.settle(L.code), 'void'); assert.deepEqual(L.moves, []);
  const M = await ready(); await play(M, 0, 0, 0);
  assert.equal(await M.svc.settle(M.code), 'void'); assert.deepEqual(M.moves, []);
  const N = await ready(); await play(N, 20, 20, 60); // a tie lower down does not matter
  assert.equal(await N.svc.settle(N.code), 'settled'); assert.deepEqual(N.moves, ['a→c 90+10', 'b→c 90+10']);
});

test('a permit is refused unless it is genuine, for exactly the entry, long enough, and backed by the wallet', async () => {
  const L = lobby();
  no(await L.svc.stake(L.code, L.bo.token, E100, L.sign(B)), 'not_host');
  no(await L.svc.stake(L.code, L.host.token, String(7n * ONE), L.sign(A, String(7n * ONE))), 'bad_entry'); // not an entry on offer
  no(await L.svc.stake(L.code, L.host.token, E100, L.sign(A, E50)), 'bad_permit');           // signed for less
  no(await L.svc.stake(L.code, L.host.token, E100, { ...L.sign(A), r: '0x' + '9'.repeat(64) }), 'bad_permit'); // someone else's signature
  no(await L.svc.stake(L.code, L.host.token, E100, L.sign(A, E100, 5)), 'bad_permit');       // runs out before a round could
  no(await L.svc.stake(L.code, L.host.token, E100, L.sign(A, E100, 600)), 'bad_permit');     // open for ten hours
  for (const junk of [null, 'x', {}, { ...L.sign(A), v: 3 }, { ...L.sign(A), owner: 'nope' }, { ...L.sign(A), s: '0x12' }]) no(await L.svc.stake(L.code, L.host.token, E100, junk), 'bad_permit');
  L.balance.set(A, 10n * ONE); no(await L.svc.stake(L.code, L.host.token, E100, L.sign(A)), 'bad_permit'); L.balance.set(A, 500n * ONE);
  L.fail.check = true; assert.equal(no(await L.svc.stake(L.code, L.host.token, E100, L.sign(A)), 'bad_permit').status, 503); L.fail.check = false;
  L.banned.add(A); no(await L.svc.stake(L.code, L.host.token, E100, L.sign(A)), 'not_allowed'); L.banned.delete(A);
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).stake, undefined, 'a refused entry sets nothing');
  ok<RoomView>(await L.svc.stake(L.code, L.host.token, E100, L.sign(A)));
  no(await L.svc.commit(L.code, L.bo.token, L.sign(A)), 'wallet_taken');                     // one wallet, one seat
  no(await L.svc.commit(L.code, L.bo.token, L.sign(B, E50)), 'bad_permit');                  // not the entry the host set
  no(await L.svc.commit(L.code, 'f'.repeat(32), L.sign(B)), 'not_in_room');
  no(L.svc.start(L.code, L.host.token), 'stake_pending');                                    // not everyone has signed
});

test('stakes are only for games the server scores itself, and only when switched on', async () => {
  const L = lobby(world(), 'unsure');
  const v = ok<RoomView>(L.svc.get(L.code, L.host.token));
  assert.equal(v.stakes, false); assert.equal(v.stakeTerms, undefined);
  no(await L.svc.stake(L.code, L.host.token, E100, L.sign(A)), 'not_verified');
  const off = createRoomService(GAMES); const h = ok<Seat>(off.create('sure', 'A')); ok<Seat>(off.join(h.code, 'B'));
  no(await off.stake(h.code, h.token, E100, L.sign(A)), 'stakes_off'); no(await off.commit(h.code, h.token, L.sign(A)), 'stakes_off');
  assert.equal(await off.settle(h.code), null); assert.equal(ok<RoomView>(off.get(h.code, h.token)).stakes, false);
});

test('before the start nothing is owed: people can come, go, change the entry or call it off', async () => {
  const L = await ready();
  const di = ok<Seat>(L.svc.join(L.code, 'Di'));                                             // a newcomer has not signed
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).stake!.state, 'collecting');
  no(L.svc.start(L.code, L.host.token), 'stake_pending');
  ok(L.svc.leave(L.code, di.token));                                                         // and leaves again
  assert.equal(ok<RoomView>(L.svc.get(L.code, L.host.token)).stake!.state, 'ready');
  ok<RoomView>(await L.svc.stake(L.code, L.host.token, E50, L.sign(A, E50)));                // a new entry: everyone signs again
  assert.deepEqual(ok<RoomView>(L.svc.get(L.code, L.host.token)).stake!.signed, [true, false, false]);
  no(L.svc.unstake(L.code, L.bo.token), 'not_host');
  assert.equal(ok<RoomView>(L.svc.unstake(L.code, L.host.token)).stake, undefined);
  ok<RoomView>(L.svc.start(L.code, L.host.token));                                           // a free round, as before
  assert.deepEqual(L.moves, []);
});

test('a loser who empties their wallet does not pay; it is recorded against them and the others still do', async () => {
  const L = await ready(); ok<RoomView>(L.svc.start(L.code, L.host.token));
  L.balance.set(A, 0n);                                                                      // Ada moves her G$ away mid-round
  ok<RoomView>(await L.svc.finish(L.code, L.host.token, { n: 1 })); ok<RoomView>(await L.svc.finish(L.code, L.bo.token, { n: 9 })); ok<RoomView>(await L.svc.finish(L.code, L.cy.token, { n: 5 }));
  assert.equal(await L.svc.settle(L.code), 'settled');
  assert.deepEqual(L.moves, ['c→b 90+10']);
  assert.deepEqual(ok<RoomView>(L.svc.get(L.code, L.bo.token)).stake!.pays, ['unpaid', null, 'paid']);
});

test('a player who walks off mid-round scores nothing and still pays', async () => {
  const L = await ready(); ok<RoomView>(L.svc.start(L.code, L.host.token));
  ok<RoomView>(await L.svc.finish(L.code, L.host.token, { n: 12 })); ok<RoomView>(await L.svc.finish(L.code, L.cy.token, { n: 30 }));
  ok(L.svc.leave(L.code, L.bo.token));
  assert.equal(await L.svc.settle(L.code), 'settled'); assert.deepEqual(L.moves, ['a→c 90+10', 'b→c 90+10']);
});

test('a payment the chain did not answer for is tried again, and never taken twice', async () => {
  const L = await ready(); await play(L, 5, 9, 7);
  L.fail.collect = 3;                                                                        // down for the first three calls
  assert.equal(await L.svc.settle(L.code), 'playing'); assert.equal(await L.svc.settle(L.code), 'playing');
  assert.equal(await L.svc.settle(L.code), 'settled'); assert.deepEqual(L.moves, ['c→b 90+10', 'a→b 90+10']);

  // the money moved but the answer never came back: the retry finds the permit spent, and takes nothing more
  const M = await ready(); await play(M, 3, 8, 4);
  M.fail.lieAfterCollect = true;
  assert.equal(await M.svc.settle(M.code), 'playing');
  assert.equal(await M.svc.settle(M.code), 'settled');
  assert.equal(M.moves.length, 2); assert.equal(M.balance.get(A), 400n * ONE, 'Ada paid once');

  // the chain never answers: it stops trying, and says so
  const N = await ready(); await play(N, 3, 8, 4); N.fail.collect = 99;
  for (let i = 0; i < STAKE_TRIES - 1; i++) assert.equal(await N.svc.settle(N.code), 'playing');
  assert.equal(await N.svc.settle(N.code), 'settled');
  assert.deepEqual(ok<RoomView>(N.svc.get(N.code, N.host.token)).stake!.pays, ['unpaid', null, 'unpaid']); assert.deepEqual(N.moves, []);
});

test('a permit that ran out is not used, and a round cannot start on one that will', async () => {
  const L = await ready();
  L.clock.t += PERMIT_MIN_MS; // 20 of the 30 minutes gone: 10 left is less than a full round
  no(L.svc.start(L.code, L.host.token), 'stake_pending');
  const M = await ready(); await play(M, 3, 8, 4);
  M.fail.collect = 99; await M.svc.settle(M.code);
  M.clock.t += 31 * 60_000; M.fail.collect = 0;
  assert.equal(await M.svc.settle(M.code), 'settled');
  assert.deepEqual(ok<RoomView>(M.svc.get(M.code, M.host.token)).stake!.pays, ['expired', null, 'expired']); assert.deepEqual(M.moves, []);
});

test('a round with payments still to make is never forgotten; an abandoned lobby is', async () => {
  const L = await ready(); await play(L, 3, 8, 4);
  L.fail.collect = 99; await L.svc.settle(L.code);
  const idle = await ready(); // signed, never started, on the same service clock? no: its own world; checked below on L's service
  void idle;
  const h2 = ok<Seat>(L.svc.create('sure', 'Eve')); ok<Seat>(L.svc.join(h2.code, 'Fay')); ok<RoomView>(await L.svc.stake(h2.code, h2.token, E100, L.sign(C)));
  for (const s of [L.host, L.bo, L.cy]) L.svc.leave(L.code, s.token);
  L.clock.t += ROOM_TTL_MS + ROUND_MAX_MS;
  ok<Seat>(L.svc.create('sure', 'Someone else')); // creating a room clears out stale ones
  assert.ok(!isFail(L.svc.get(L.code, L.host.token)), 'everyone left and it went quiet; it stays until its payments are made');
  no(L.svc.get(h2.code, h2.token), 'no_room'); // a lobby that only ever signed is let go: nothing was owed

  // a restart: the saved room is stale by the clock but comes back, and pays
  const saved = JSON.parse(JSON.stringify({ code: 'KEPT1', game: 'sure', status: 'playing', round: 1, seed: 'aa', startedAt: L.clock.t - 3_600_000, touched: L.clock.t - 3_600_000,
    players: [{ name: 'A', token: '1'.repeat(32), seen: 0, left: false, score: 8, done: true, progress: 0, wallet: A, permit: L.sign(A) }, { name: 'B', token: '2'.repeat(32), seen: 0, left: false, score: 2, done: true, progress: 0, wallet: B, permit: L.sign(B) }],
    stake: { entryWei: E100, feeBps: 1000, state: 'playing', tries: 0 } }));
  L.fail.collect = 0; const before = L.moves.length;
  assert.equal(L.svc.restore([saved, { ...saved, code: 'GONE1', stake: undefined }]), 1, 'the stale room with nothing owed is dropped; the one owing returns');
  await L.svc.settleDue();
  assert.ok(L.moves.slice(before).includes('b→a 90+10'));
});
