const test = require('node:test');
const assert = require('node:assert');
const { createStore, readCard, cleanName, AWAY_MS } = require('./strikeRooms');

test('readCard accepts legal cards and rejects illegal ones', () => {
  assert.deepStrictEqual(readCard([]), { done: false, frame: 0 });
  assert.deepStrictEqual(readCard([10, 10, 10, 10, 10, 10, 10]), { done: true, frame: 5 }); // perfect
  assert.deepStrictEqual(readCard([3, 4, 3, 4, 3, 4, 3, 4, 3, 4]), { done: true, frame: 5 }); // open last frame
  assert.deepStrictEqual(readCard([3, 4, 3, 4, 3, 4, 3, 4, 3, 7, 5]), { done: true, frame: 5 }); // spare earns a bonus
  assert.strictEqual(readCard([3, 4, 3, 4, 3, 4, 3, 4, 3, 7]).done, false); // bonus still owed
  assert.strictEqual(readCard([7, 5]), null); // 12 in a frame
  assert.strictEqual(readCard([11]), null);
  assert.strictEqual(readCard([3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 2]), null); // a roll after the game ended
  assert.strictEqual(readCard([1.5]), null);
  assert.strictEqual(readCard('nope'), null);
  assert.strictEqual(readCard([10, 10, 10, 10, 10, 3, 9]), null); // 12 on the bonus pair
});

test('names are cleaned', () => {
  assert.strictEqual(cleanName('  <b>Tunde</b>  '), 'bTundeb');
  assert.strictEqual(cleanName(''), 'Player');
  assert.strictEqual(cleanName('x'.repeat(40)).length, 14);
});

test('a full game between two players', () => {
  let t = 1000;
  const s = createStore(() => t);
  const a = s.create('Ada');
  assert.match(a.code, /^[A-Z2-9]{5}$/);
  assert.strictEqual(s.start(a.code, a.token).error, 'need_two'); // cannot start alone
  const b = s.join(a.code.toLowerCase(), 'Ada'); // code is not case sensitive; duplicate name is told apart
  assert.strictEqual(b.seat, 1);
  assert.strictEqual(s.get(a.code, a.token).players[1].name, 'Ada 2');
  assert.strictEqual(s.start(a.code, b.token).error, 'not_host');
  assert.strictEqual(s.roll(a.code, a.token, [5]).error, 'not_playing');
  assert.strictEqual(s.start(a.code, a.token).status, 'playing');
  assert.strictEqual(s.join(a.code, 'Late').error, 'started');
  assert.strictEqual(s.roll(a.code, 'f'.repeat(32), [5]).error, 'not_in_room');
  assert.strictEqual(s.roll(a.code, a.token, [5, 9]).error, 'bad_card');
  s.roll(a.code, a.token, [5, 4]);
  assert.strictEqual(s.roll(a.code, a.token, [6, 4]).error, 'rewrite'); // history cannot change
  assert.strictEqual(s.roll(a.code, a.token, [5]).error, 'rewrite'); // nor shrink
  const full = [5, 4, 5, 4, 5, 4, 5, 4, 5, 4];
  assert.strictEqual(s.roll(a.code, a.token, full).status, 'playing'); // B still bowling
  const seen = s.get(a.code, b.token);
  assert.strictEqual(seen.you, 1);
  assert.deepStrictEqual(seen.players[0].rolls, full);
  assert.strictEqual(seen.players[0].done, true);
  assert.ok(!('token' in seen.players[0])); // tokens never leave the server
  assert.strictEqual(s.rematch(a.code, a.token).error, 'not_over');
  assert.strictEqual(s.roll(a.code, b.token, [10, 10, 10, 10, 10, 10, 10]).status, 'over');
  const again = s.rematch(a.code, a.token);
  assert.strictEqual(again.status, 'playing');
  assert.strictEqual(again.round, 2);
  assert.deepStrictEqual(again.players.map((p) => p.rolls.length), [0, 0]);
});

test('a player who goes quiet does not hold the room', () => {
  let t = 1000;
  const s = createStore(() => t);
  const a = s.create('A');
  const b = s.join(a.code, 'B');
  s.start(a.code, a.token);
  s.roll(a.code, a.token, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.strictEqual(s.get(a.code, a.token).status, 'playing');
  t += AWAY_MS + 1;
  const v = s.get(a.code, a.token); // A is still here, B has not been heard from
  assert.strictEqual(v.players[1].away, true);
  assert.strictEqual(v.status, 'over');
  assert.strictEqual(b.seat, 1);
});

test('rooms fill at four, and leaving works', () => {
  const s = createStore();
  const a = s.create('A');
  const tokens = [1, 2, 3].map((i) => s.join(a.code, 'P' + i));
  assert.strictEqual(s.join(a.code, 'P5').error, 'full');
  s.leave(a.code, tokens[0].token); // leaving the waiting room frees the seat
  assert.strictEqual(s.get(a.code, a.token).players.length, 3);
  assert.strictEqual(s.join(a.code, 'P5').seat, 3);
  assert.strictEqual(s.get('ZZZZZ', '').error, 'no_room');
});
