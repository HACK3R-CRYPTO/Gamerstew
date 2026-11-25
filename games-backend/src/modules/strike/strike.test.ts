import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { cleanName, readCard } from './card';
import { AWAY_MS, createStrikeService, isFail, MAX_ROOMS, ROOM_TTL_MS, type RoomView, type Seat } from './service';
import { MemoryRoomStore } from './store';
import { registerStrikeRoutes } from './routes';

const ok = <T>(v: T | { error: string; status: number }): T => { assert.ok(!isFail(v), `unexpected failure ${JSON.stringify(v)}`); return v as T; };
const err = (v: unknown) => (isFail(v) ? v.error : null);

test('readCard accepts legal cards and rejects illegal ones', () => {
  assert.deepStrictEqual(readCard([]), { done: false, frame: 0 });
  assert.deepStrictEqual(readCard([10, 10, 10, 10, 10, 10, 10]), { done: true, frame: 5 }); // perfect game
  assert.deepStrictEqual(readCard([3, 4, 3, 4, 3, 4, 3, 4, 3, 4]), { done: true, frame: 5 }); // open last frame
  assert.deepStrictEqual(readCard([3, 4, 3, 4, 3, 4, 3, 4, 3, 7, 5]), { done: true, frame: 5 }); // spare earns a bonus
  assert.strictEqual(readCard([3, 4, 3, 4, 3, 4, 3, 4, 3, 7])?.done, false); // bonus still owed
  assert.strictEqual(readCard([10, 10, 10, 10, 10, 10])?.done, false); // second bonus still owed
  assert.strictEqual(readCard([7, 5]), null); // 12 in a frame
  assert.strictEqual(readCard([11]), null);
  assert.strictEqual(readCard([-1]), null);
  assert.strictEqual(readCard([3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 2]), null); // a roll after the game ended
  assert.strictEqual(readCard([1.5]), null);
  assert.strictEqual(readCard(['5']), null);
  assert.strictEqual(readCard('nope'), null);
  assert.strictEqual(readCard([10, 10, 10, 10, 10, 3, 9]), null); // 12 on the bonus pair
  assert.strictEqual(readCard(Array(12).fill(0)), null); // longer than any card can be
});

test('names are cleaned', () => {
  assert.strictEqual(cleanName('  <b>Tunde</b>  '), 'bTundeb');
  assert.strictEqual(cleanName(''), 'Player');
  assert.strictEqual(cleanName(null), 'Player');
  assert.strictEqual(cleanName('x'.repeat(40)).length, 14);
  assert.strictEqual(cleanName('Chiọma'), 'Chiọma'); // real names keep their letters
  assert.strictEqual(cleanName('Ẹ̀kọ́'), 'Ẹ̀kọ́'.normalize('NFC')); // and their tone marks
  assert.strictEqual(cleanName('abcdefghijklm  z'), 'abcdefghijklm'); // never ends in a space
  assert.strictEqual(Array.from(cleanName('𝓐'.repeat(20))).length, 14); // cut between characters, not through one
});

test('a full game between two players', async () => {
  let t = 1000;
  const s = createStrikeService(new MemoryRoomStore(), () => t);
  const a = ok<Seat>(await s.create('Ada'));
  assert.match(a.code, /^[A-Z2-9]{5}$/);
  assert.strictEqual(err(await s.start(a.code, a.token)), 'need_two'); // cannot start alone
  const b = ok<Seat>(await s.join(a.code.toLowerCase(), 'Ada')); // code is not case sensitive
  assert.strictEqual(b.seat, 1);
  assert.strictEqual(ok<RoomView>(await s.get(a.code, a.token)).players[1]?.name, 'Ada 2'); // duplicate name told apart
  assert.strictEqual(err(await s.start(a.code, b.token)), 'not_host');
  assert.strictEqual(err(await s.roll(a.code, a.token, [5])), 'not_playing');
  assert.strictEqual(ok<RoomView>(await s.start(a.code, a.token)).status, 'playing');
  assert.strictEqual(err(await s.join(a.code, 'Late')), 'started');
  assert.strictEqual(err(await s.roll(a.code, 'f'.repeat(32), [5])), 'not_in_room');
  assert.strictEqual(err(await s.roll(a.code, undefined, [5])), 'not_in_room');
  assert.strictEqual(err(await s.roll(a.code, a.token, [5, 9])), 'bad_card');
  ok(await s.roll(a.code, a.token, [5, 4]));
  assert.strictEqual(err(await s.roll(a.code, a.token, [6, 4])), 'rewrite'); // history cannot change
  assert.strictEqual(err(await s.roll(a.code, a.token, [5])), 'rewrite'); // nor shrink
  const full = [5, 4, 5, 4, 5, 4, 5, 4, 5, 4];
  assert.strictEqual(ok<RoomView>(await s.roll(a.code, a.token, full)).status, 'playing'); // B still bowling
  const seen = ok<RoomView>(await s.get(a.code, b.token));
  assert.strictEqual(seen.you, 1);
  assert.deepStrictEqual(seen.players[0]?.rolls, full);
  assert.strictEqual(seen.players[0]?.done, true);
  assert.ok(!JSON.stringify(seen).includes(a.token)); // tokens never leave the server
  assert.strictEqual(ok<RoomView>(await s.get(a.code, 'stranger')).you, -1);
  assert.strictEqual(err(await s.rematch(a.code, a.token)), 'not_over');
  assert.strictEqual(ok<RoomView>(await s.roll(a.code, b.token, [10, 10, 10, 10, 10, 10, 10])).status, 'over');
  const again = ok<RoomView>(await s.rematch(a.code, a.token));
  assert.strictEqual(again.status, 'playing');
  assert.strictEqual(again.round, 2);
  assert.deepStrictEqual(again.players.map((p) => p.rolls.length), [0, 0]);
});

test('a player who goes quiet does not hold the room', async () => {
  let t = 1000;
  const s = createStrikeService(new MemoryRoomStore(), () => t);
  const a = ok<Seat>(await s.create('A'));
  ok(await s.join(a.code, 'B'));
  ok(await s.start(a.code, a.token));
  ok(await s.roll(a.code, a.token, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
  assert.strictEqual(ok<RoomView>(await s.get(a.code, a.token)).status, 'playing');
  const b = ok<RoomView>(await s.get(a.code, 'x')).players.length;
  assert.strictEqual(b, 2);
  t += AWAY_MS + 1;
  const v = ok<RoomView>(await s.get(a.code, a.token)); // A is still here, B has not been heard from
  assert.strictEqual(v.players[1]?.away, true);
  assert.strictEqual(v.status, 'over');
});

test('a player who comes back after a dropped connection can still finish', async () => {
  let t = 1000;
  const s = createStrikeService(new MemoryRoomStore(), () => t);
  const a = ok<Seat>(await s.create('A'));
  const b = ok<Seat>(await s.join(a.code, 'B'));
  ok(await s.start(a.code, a.token));
  ok(await s.roll(a.code, a.token, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
  t += AWAY_MS + 1;
  assert.strictEqual(ok<RoomView>(await s.get(a.code, a.token)).status, 'over'); // A stops waiting
  const back = ok<RoomView>(await s.roll(a.code, b.token, [9, 0])); // B's phone wakes up and reports a roll
  assert.strictEqual(back.status, 'playing'); // not locked out
  assert.strictEqual(ok<RoomView>(await s.roll(a.code, b.token, [9, 0, 9, 0, 9, 0, 9, 0, 9, 0])).status, 'over');
});

test('the host leaving never strands the room', async () => {
  let t = 1000;
  const s = createStrikeService(new MemoryRoomStore(), () => t);
  // before the game: the next player becomes host and can start
  const a = ok<Seat>(await s.create('A'));
  const b = ok<Seat>(await s.join(a.code, 'B'));
  const c = ok<Seat>(await s.join(a.code, 'C'));
  await s.leave(a.code, a.token);
  const v = ok<RoomView>(await s.get(a.code, b.token));
  assert.deepStrictEqual(v.players.map((p) => [p.name, p.host]), [['B', true], ['C', false]]);
  assert.strictEqual(v.you, 0);
  assert.strictEqual(err(await s.start(a.code, c.token)), 'not_host');
  assert.strictEqual(ok<RoomView>(await s.start(a.code, b.token)).status, 'playing');
  // during the game: the host's card stays, and the next player inherits rematch
  await s.leave(a.code, b.token);
  ok(await s.roll(a.code, c.token, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const end = ok<RoomView>(await s.get(a.code, c.token));
  assert.strictEqual(end.status, 'over');
  assert.strictEqual(end.players[1]?.host, true);
  assert.strictEqual(ok<RoomView>(await s.rematch(a.code, c.token)).round, 2);
  // the last one out closes the room
  await s.leave(a.code, c.token);
  assert.strictEqual(err(await s.get(a.code, c.token)), 'no_room');
});

test('three players with one name are all told apart', async () => {
  const s = createStrikeService(new MemoryRoomStore());
  const a = ok<Seat>(await s.create('Bob'));
  ok(await s.join(a.code, 'Bob 3'));
  ok(await s.join(a.code, 'bob'));
  ok(await s.join(a.code, 'BOB'));
  const names = ok<RoomView>(await s.get(a.code, a.token)).players.map((p) => p.name.toLowerCase());
  assert.strictEqual(new Set(names).size, 4);
});

test('the room cap holds, and two rolls sent at once cannot corrupt a card', async () => {
  const s = createStrikeService(new MemoryRoomStore());
  let last: unknown;
  for (let i = 0; i < MAX_ROOMS; i++) last = await s.create('x');
  assert.ok(!isFail(last));
  assert.strictEqual(err(await s.create('one too many')), 'busy');
  const s2 = createStrikeService(new MemoryRoomStore());
  const a = ok<Seat>(await s2.create('A'));
  const b = ok<Seat>(await s2.join(a.code, 'B'));
  ok(await s2.start(a.code, a.token));
  const both = await Promise.all([s2.roll(a.code, a.token, [5, 4]), s2.roll(a.code, b.token, [10]), s2.get(a.code, a.token), s2.roll(a.code, a.token, [5, 4, 3])]);
  assert.ok(both.every((r) => !isFail(r)));
  const v = ok<RoomView>(await s2.get(a.code, a.token));
  assert.deepStrictEqual(v.players.map((p) => p.rolls), [[5, 4, 3], [10]]);
});

test('rooms fill at four, leaving frees a seat, old rooms expire', async () => {
  let t = 1000;
  const store = new MemoryRoomStore();
  const s = createStrikeService(store, () => t);
  const a = ok<Seat>(await s.create('A'));
  const joined: Seat[] = [];
  for (const n of ['P1', 'P2', 'P3']) joined.push(ok<Seat>(await s.join(a.code, n)));
  assert.strictEqual(err(await s.join(a.code, 'P5')), 'full');
  await s.leave(a.code, joined[0]!.token); // leaving the waiting room frees the seat
  assert.strictEqual(ok<RoomView>(await s.get(a.code, a.token)).players.length, 3);
  assert.strictEqual(ok<Seat>(await s.join(a.code, 'P5')).seat, 3);
  assert.strictEqual(err(await s.get('ZZZZZ', '')), 'no_room');
  t += ROOM_TTL_MS + 1;
  ok(await s.create('B')); // creating a room sweeps the expired ones
  assert.strictEqual(await store.count(), 1);
  assert.strictEqual(err(await s.get(a.code, a.token)), 'no_room');
});

test('the HTTP routes speak the same language', async () => {
  const app = express();
  app.use(express.json());
  registerStrikeRoutes(app);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/strike/rooms`;
  const post = async (path: string, body: unknown) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
  try {
    const a = await post('', { name: 'Ada' });
    assert.strictEqual(a.status, 200);
    const b = await post(`/${a.body.code}/join`, { name: 'Tunde' });
    assert.strictEqual(b.body.seat, 1);
    assert.strictEqual((await post(`/${a.body.code}/start`, { token: b.body.token })).status, 403);
    assert.strictEqual((await post(`/${a.body.code}/start`, { token: a.body.token })).body.status, 'playing');
    assert.strictEqual((await post(`/${a.body.code}/roll`, { token: a.body.token, rolls: [9, 9] })).status, 400);
    assert.strictEqual((await post(`/${a.body.code}/roll`, { token: a.body.token })).status, 400); // no rolls at all
    assert.strictEqual((await post(`/${a.body.code}/roll`, { token: a.body.token, rolls: [9, 1] })).status, 200);
    const seen = (await (await fetch(`${base}/${a.body.code}?token=${b.body.token}`)).json()) as RoomView;
    assert.deepStrictEqual(seen.players[0]?.rolls, [9, 1]);
    assert.strictEqual((await fetch(`${base}/NOPE1`)).status, 404);
    // a body that is not an object must not crash the route
    const odd = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1,2,3]' });
    assert.strictEqual(odd.status, 200); // treated as "no name given"
    assert.match(((await odd.json()) as { code: string }).code, /^[A-Z2-9]{5}$/);
  } finally {
    server.close();
  }
});

test('the secret gate guards every route, and one address cannot flood rooms', async () => {
  const app = express();
  app.use(express.json());
  registerStrikeRoutes(app, { requireSecret: (req, res, next) => { if (req.headers['x-internal-secret'] === 's3') next(); else res.status(401).json({ error: 'Unauthorized' }); } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/strike/rooms`;
  const make = (ip: string, secret = 's3') => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret, 'x-client-ip': ip }, body: '{}' });
  try {
    assert.strictEqual((await make('1.1.1.1', 'wrong')).status, 401);
    assert.strictEqual((await fetch(`${base}/ABCDE`)).status, 401);
    assert.strictEqual((await fetch(`${base}/ABCDE/roll`, { method: 'POST' })).status, 401);
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await make('1.1.1.1')).status);
    assert.deepStrictEqual(codes, [200, 200, 200, 200, 200, 200, 200, 200, 429, 429]);
    assert.strictEqual((await make('2.2.2.2')).status, 200); // someone else is not affected
  } finally {
    server.close();
  }
});

test('throws are kept with the rolls so a round can be replayed; a watcher sees them and never the code', async () => {
  const svc = createStrikeService(new MemoryRoomStore());
  const host = ok<Seat>(await svc.create('Ada')); const guest = ok<Seat>(await svc.join(host.code, 'Bo'));
  assert.deepStrictEqual(await svc.live(), [], 'a lane still waiting is not listed');
  ok<RoomView>(await svc.start(host.code, host.token));
  const shot = { tyre: 'keke', x: 0.1, angle: 0.02, speed: 9, spin: 3 };
  const v = ok<RoomView>(await svc.roll(host.code, host.token, [7], [{ ...shot, speed: 9999, extra: 'x' }]));
  assert.equal(v.players[0]!.throws.length, 1);
  assert.ok(v.players[0]!.throws[0]!.speed < 100, 'a throw is held to what the game allows');
  assert.deepStrictEqual(Object.keys(v.players[0]!.throws[0]!).sort(), ['angle', 'speed', 'spin', 'tyre', 'x']);
  // more throws than rolls, an unknown tyre, or junk: the rolls still count, the throws are left as they were
  ok<RoomView>(await svc.roll(host.code, host.token, [7, 2], [shot, shot, shot]));
  ok<RoomView>(await svc.roll(host.code, host.token, [7, 2], [{ ...shot, tyre: 'tank' }, shot]));
  assert.equal(ok<RoomView>(await svc.get(host.code, host.token)).players[0]!.throws.length, 1);
  const [live] = await svc.live();
  assert.deepStrictEqual([live!.game, live!.players], ['strike', ['Ada', 'Bo']]); assert.equal(JSON.stringify(live).includes(host.code), false);
  const seen = ok<RoomView>(await svc.get(live!.watch, undefined, 'tv'));
  assert.deepStrictEqual([seen.code, seen.you, seen.players[0]!.throws.length], ['', -1, 1]);
  assert.equal((await svc.live())[0]!.watching, 1);
  assert.equal(err(await svc.join(live!.watch, 'Sneak')), 'no_room', 'a watch name is not a way in');
  assert.equal(await svc.codeFor(live!.watch), host.code);
  void guest;
});
