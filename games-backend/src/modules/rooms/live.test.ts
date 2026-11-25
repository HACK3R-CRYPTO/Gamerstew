import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomService, isFail, type GameRules, type RoomView, type Seat } from './service';
import { createLiveHub, BURST } from './live';

const toy: GameRules = { verified: true, deal: (seed) => ({ seed }), maxProgress: 5, score: async (_s, proof) => ({ ok: true, score: Number(proof) }) };
function world() {
  const clock = { t: 1_000_000 }; let n = 0; const later: (() => void)[] = [];
  const svc = createRoomService({ toy }, { now: () => clock.t, randomHex: (b) => (++n).toString(16).padStart(b * 2, '0') });
  const hub = createLiveHub({ service: svc, now: () => clock.t, defer: (fn) => { later.push(fn); } });
  const flush = () => { while (later.length) later.shift()!(); };
  const phone = (who = 'a') => { const got: { t: string; view?: RoomView; why?: string }[] = []; let shut = false; const c = hub.connect({ send: (d) => got.push(JSON.parse(d)), close: () => { shut = true; } }, who); return { got, say: (m: unknown) => c.message(JSON.stringify(m)), raw: (s: string) => c.message(s), close: () => c.closed(), get shut() { return shut; }, last: () => got[got.length - 1]! }; };
  const ok = <T>(v: T | { error: string }): T => { assert.ok(!isFail(v)); return v as T; };
  const host = ok<Seat>(svc.create('toy', 'Ada')); const guest = ok<Seat>(svc.join(host.code, 'Bo'));
  return { svc, hub, clock, flush, phone, host, guest, ok };
}

test('a player and a spectator are each pushed their own view, the instant the room changes', () => {
  const w = world();
  const ada = w.phone(); ada.say({ t: 'hello', code: w.host.code, token: w.host.token });
  assert.equal(ada.last().view!.you, 0);
  const tv = w.phone('tv'); tv.say({ t: 'hello', watch: w.svc.live.length >= 0 ? w.ok<RoomView>(w.svc.get(w.host.code, w.host.token)).watchId : '' });
  assert.equal(tv.last().view!.you, -1); assert.equal(tv.last().view!.code, '', 'a watcher by watch name is never told the code');
  w.flush(); assert.equal(ada.last().view!.watching, 1, 'the player sees someone is watching');
  w.ok<RoomView>(w.svc.start(w.host.code, w.host.token)); w.hub.publish(w.host.code); w.flush();
  assert.equal(ada.last().view!.status, 'playing'); assert.ok(ada.last().view!.deal, 'a player is dealt the round');
  assert.equal(tv.last().view!.deal, undefined, 'a spectator never is');
  const before = tv.got.length;
  ada.say({ t: 'p', progress: 3, live: { pts: 9 } }); w.flush();
  assert.equal(tv.got.length, before + 1); assert.deepEqual(tv.last().view!.players[0]!.live, { pts: 9 });
  w.hub.publish(w.host.code); w.flush(); assert.equal(tv.got.length, before + 1, 'nothing changed, nothing sent');
});

test('a spectator cannot play or talk; chat from a player reaches everyone; bad keys and floods are refused', () => {
  const w = world();
  const tv = w.phone('tv'); tv.say({ t: 'hello', watch: w.host.code });
  tv.say({ t: 'say', text: 'hello from the stands' }); tv.say({ t: 'p', progress: 5 }); w.flush();
  assert.deepEqual(w.ok<RoomView>(w.svc.get(w.host.code, w.host.token)).chat, []);
  const bo = w.phone(); bo.say({ t: 'hello', code: w.host.code, token: w.guest.token });
  bo.say({ t: 'say', text: 'good luck' }); w.flush();
  assert.equal(tv.last().view!.chat[0]!.text, 'good luck');
  const liar = w.phone(); liar.say({ t: 'hello', code: w.host.code, token: 'f'.repeat(32) });
  assert.deepEqual([liar.last().t, liar.last().why, liar.shut], ['no', 'no_room', true]);
  const noisy = w.phone(); noisy.say({ t: 'hello', code: w.host.code, token: w.host.token });
  for (let i = 0; i < BURST + 2; i++) noisy.say({ t: 'ping' });
  assert.equal(noisy.shut, true, 'a flood closes the line');
  const big = w.phone(); big.raw('x'.repeat(5000)); assert.equal(big.shut, true);
});

test('a closed socket is forgotten, and a room that ends tells its phones', () => {
  const w = world();
  const ada = w.phone(); ada.say({ t: 'hello', code: w.host.code, token: w.host.token });
  const bo = w.phone(); bo.say({ t: 'hello', code: w.host.code, token: w.guest.token });
  assert.deepEqual(w.hub.stats(), { rooms: 1, sockets: 2 });
  bo.close(); assert.deepEqual(w.hub.stats(), { rooms: 1, sockets: 1 });
  w.svc.leave(w.host.code, w.host.token); w.svc.leave(w.host.code, w.guest.token); w.hub.tick();
  assert.equal(ada.last().t, 'gone'); assert.deepEqual(w.hub.stats(), { rooms: 0, sockets: 0 });
});
