import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFriends, INVITE_GAP_MS, ONLINE_MS, type FriendStore, type Pair } from './service';

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40);
function world() {
  const rows = new Map<string, Pair>(); const sent: { to: string; category: string; url: string }[] = []; const clock = { t: 1_800_000_000_000 };
  const store: FriendStore = {
    list: async (w) => ({ ok: true, rows: [...rows.values()].filter((r) => r.a === w || r.b === w) }),
    get: async (a, b) => ({ ok: true, row: rows.get(a + b) ?? null }),
    put: async (r) => { rows.set(r.a + r.b, r); return true; },
    remove: async (a, b) => { rows.delete(a + b); return true; },
    findByName: async (n) => (n === 'bola' ? B : null),
    searchNames: async (p) => [{ wallet: B, name: 'bola' }, { wallet: A, name: 'boat' }].filter((x) => x.name.startsWith(p)),
  };
  const f = createFriends({ store, nameOf: async (w) => (w === A ? 'ada' : w === B ? 'bola' : null), notify: async (to, category, note) => { sent.push({ to, category, url: note.url }); }, now: () => clock.t });
  return { f, rows, sent, clock };
}
const flush = () => new Promise((r) => setImmediate(r));

test('ask by username, the other accepts, both see each other', async () => {
  const w = world();
  assert.equal((await w.f.request(A, '@Bola')).body.state, 'asked');
  await flush(); assert.equal(w.sent[0]!.to, B);
  assert.equal(((await w.f.list(B)).body.incoming as unknown[]).length, 1);
  assert.equal(((await w.f.list(A)).body.outgoing as unknown[]).length, 1);
  assert.equal((await w.f.accept(A, B)).status, 403, 'the asker cannot accept their own request');
  assert.equal((await w.f.accept(B, A)).body.state, 'friends');
  const mine = (await w.f.list(A)).body.friends as { wallet: string; name: string }[];
  assert.deepEqual(mine.map((p) => [p.wallet, p.name]), [[B, 'bola']]);
  assert.equal(w.rows.size, 1, 'one row per pair');
});

test('asking someone who already asked you is a yes; unknown names and yourself are refused', async () => {
  const w = world();
  await w.f.request(B, A);
  assert.equal((await w.f.request(A, B)).body.state, 'friends');
  assert.equal((await w.f.request(A, 'nobody')).status, 404);
  assert.equal((await w.f.request(A, A)).body.error, 'yourself');
  assert.equal((await w.f.request(A, 'DROP TABLE;')).status, 404);
});

test('remove works for either side, and an invite needs a friendship, a real game and a pause between sends', async () => {
  const w = world();
  assert.equal((await w.f.invite(A, B, 'ladder', 'ABCDE')).body.error, 'not_friends');
  await w.f.request(A, B); await w.f.accept(B, A); await flush(); w.sent.length = 0;
  assert.equal((await w.f.invite(A, B, 'casino', 'ABCDE')).body.error, 'bad_room');
  assert.equal((await w.f.invite(A, B, 'ladder', 'abcde')).body.sent, true);
  await flush(); assert.deepEqual(w.sent, [{ to: B, category: 'room_invite_ABCDE', url: '/games/ladder?room=ABCDE' }]);
  assert.equal((await w.f.invite(A, B, 'ladder', 'ABCDE')).status, 429);
  w.clock.t += INVITE_GAP_MS + 1;
  assert.equal((await w.f.invite(A, B, 'ladder', 'ABCDE')).body.sent, true);
  assert.equal((await w.f.remove(B, A)).body.state, 'none');
  assert.equal(((await w.f.list(A)).body.friends as unknown[]).length, 0);
  assert.equal((await w.f.invite(A, C, 'ladder', 'ABCDE')).body.error, 'not_friends');
});

test('online: a friend with the app open shows as online and comes first; a stranger who only asked learns nothing', async () => {
  const w = world();
  await w.f.request(A, B); await w.f.accept(B, A); await w.f.request(C, A);
  w.clock.t += ONLINE_MS + 1; // everyone has gone quiet
  type P = { wallet: string; online: boolean; lastSeen: number | null };
  assert.equal(((await w.f.list(A)).body.friends as P[])[0]!.online, false);
  w.f.ping(B);
  assert.equal(((await w.f.list(A)).body.friends as P[])[0]!.online, true);
  w.f.ping(C);
  const asking = (await w.f.list(A)).body.incoming as P[];
  assert.deepEqual([asking[0]!.online, asking[0]!.lastSeen], [false, null], 'not a friend yet');
  w.clock.t += ONLINE_MS + 1;
  const later = ((await w.f.list(A)).body.friends as P[])[0]!;
  assert.equal(later.online, false); assert.ok(later.lastSeen, 'still says when they were last seen');
});

test('search: finds players by the start of a name, never yourself, and says where you stand with each', async () => {
  const w = world();
  type R = { wallet: string; name: string; state: string };
  assert.deepEqual(((await w.f.search(A, '@Bo')).body.results as R[]).map((r) => [r.name, r.state]), [['bola', 'none']], 'your own name is left out');
  await w.f.request(A, B);
  assert.equal(((await w.f.search(A, 'bo')).body.results as R[])[0]!.state, 'asked');
  assert.equal(((await w.f.search(B, A)).body.results as R[])[0]!.state, 'incoming', 'a friend link is a whole wallet');
  await w.f.accept(B, A);
  assert.equal(((await w.f.search(A, 'bol')).body.results as R[])[0]!.state, 'friends');
  assert.deepEqual((await w.f.search(A, 'b')).body.results, [], 'one letter is not enough');
  assert.deepEqual((await w.f.search(A, "x'; drop")).body.results, []);
});

test('people: everyone with the app open, friend or not, never yourself, with where you stand', async () => {
  const w = world();
  await w.f.request(A, B); w.f.ping(B); w.f.ping(C); w.f.ping(A);
  const got = (await w.f.people(A)).body.people as { wallet: string; state: string }[];
  assert.deepEqual(got.map((p) => [p.wallet, p.state]).sort(), [[B, 'asked'], [C, 'none']]);
  w.clock.t += ONLINE_MS + 1;
  assert.equal(((await w.f.people(A)).body.people as unknown[]).length, 0);
});

// ── an invite reaches a player who has the app open ──────────────────────────
import { createTickets } from './ticket';
import { createPersonalLine, PER_WALLET, HELLO_MS, BURST } from './line';
import { INVITE_TTL_MS, type Invite } from './service';

test('a ticket names one wallet for ten minutes and cannot be forged or changed', () => {
  const clock = { t: 1_800_000_000_000 };
  const tk = createTickets('server-secret', { now: () => clock.t });
  const good = tk.sign(A.toUpperCase().replace('0X', '0x'));
  assert.equal(tk.verify(good), A);
  assert.equal(tk.verify(good.replace(A, B)), null, 'another wallet with the same signature');
  assert.equal(tk.verify(good.slice(0, -2) + 'xx'), null);
  assert.equal(createTickets('other-secret', { now: () => clock.t }).verify(good), null, 'signed by a different server');
  for (const junk of [null, 42, '', 'a.b.c', `${A}.${clock.t + 1000}.`, 'x'.repeat(500)]) assert.equal(tk.verify(junk), null);
  clock.t += 10 * 60_000 + 1;
  assert.equal(tk.verify(good), null, 'out of date');
});

function lineWorld() {
  const clock = { t: 1_800_000_000_000 }; const seen: string[] = []; const waiting: Record<string, unknown[]> = {};
  const tk = createTickets('server-secret', { now: () => clock.t });
  const line = createPersonalLine({ verify: tk.verify, pending: (w) => waiting[w] ?? [], seen: (w) => { seen.push(w); }, now: () => clock.t });
  const phone = () => { const got: Record<string, unknown>[] = []; const p = { got, closed: false, conn: line.connect({ send: (d) => { got.push(JSON.parse(d)); }, close: () => { p.closed = true; } }) }; return p; };
  return { clock, seen, waiting, tk, line, phone };
}

test('the line: hello with a ticket opens it, an invite arrives at once, and what was waiting comes first', () => {
  const w = lineWorld();
  w.waiting[B] = [{ id: 'old' }];
  const p = w.phone();
  p.conn.message(JSON.stringify({ t: 'ping' })); assert.equal(p.got.length, 0, 'nothing before hello');
  p.conn.message(JSON.stringify({ t: 'hello', ticket: w.tk.sign(B) }));
  assert.deepEqual(p.got, [{ t: 'ok' }, { t: 'invite', invite: { id: 'old' } }]);
  assert.deepEqual(w.seen, [B]);
  assert.equal(w.line.tell(B, { t: 'invite', invite: { id: 'new' } }), 1);
  assert.deepEqual(p.got.at(-1), { t: 'invite', invite: { id: 'new' } });
  assert.equal(w.line.tell(A, { t: 'invite' }), 0, 'nobody else is told');
  p.conn.message(JSON.stringify({ t: 'ping' })); assert.equal(w.seen.length, 2, 'a ping keeps the green dot lit');
  p.conn.closed(); assert.deepEqual(w.line.stats(), { players: 0, sockets: 0 });
  assert.equal(w.line.tell(B, {}), 0);
});

test('the line refuses a bad ticket, a silent connection, a flood, and keeps a player to a few tabs', () => {
  const w = lineWorld();
  const bad = w.phone(); bad.conn.message(JSON.stringify({ t: 'hello', ticket: 'nope' }));
  assert.deepEqual(bad.got, [{ t: 'no', why: 'bad_ticket' }]); assert.equal(bad.closed, true);
  const quiet = w.phone(); w.clock.t += HELLO_MS + 1; w.line.sweep(); assert.equal(quiet.closed, true, 'never said who it was');
  const loud = w.phone(); loud.conn.message(JSON.stringify({ t: 'hello', ticket: w.tk.sign(A) }));
  for (let i = 0; i < BURST; i++) loud.conn.message(JSON.stringify({ t: 'ping' }));
  assert.equal(loud.closed, true); assert.deepEqual(loud.got.at(-1), { t: 'no', why: 'slow_down' });
  w.clock.t += 20_000;
  const tabs = Array.from({ length: PER_WALLET + 1 }, () => { const p = w.phone(); p.conn.message(JSON.stringify({ t: 'hello', ticket: w.tk.sign(B) })); return p; });
  assert.equal(tabs[0]!.closed, true, 'the oldest tab makes room'); assert.equal(tabs.at(-1)!.closed, false);
  assert.equal(w.line.tell(B, { t: 'x' }), PER_WALLET);
  assert.deepEqual(w.line.stats(), { players: 1, sockets: PER_WALLET });
});

test('an invite is handed to the open app, waits three minutes for a check-in, and still goes to the bell', async () => {
  const rows = new Map<string, Pair>(); const live: { to: string; invite: Invite }[] = []; const bell: string[] = []; const clock = { t: 1_800_000_000_000 };
  const store: FriendStore = { list: async () => ({ ok: true, rows: [] }), get: async (a, b) => ({ ok: true, row: rows.get(a + b) ?? null }), put: async (r) => { rows.set(r.a + r.b, r); return true; }, remove: async () => true, findByName: async () => null, searchNames: async () => [] };
  const f = createFriends({ store, nameOf: async (w) => (w === A ? 'ada' : null), notify: async (to) => { bell.push(to); }, live: (to, invite) => { live.push({ to, invite }); }, ticket: (w) => `ticket-for-${w}`, now: () => clock.t });
  await f.request(A, B); await f.accept(B, A);
  assert.equal((await f.invite(A, B, 'simon', '9utvp')).body.sent, true);
  await flush();
  assert.equal(live.length, 1); assert.equal(live[0]!.to, B);
  assert.deepEqual({ ...live[0]!.invite }, { id: `9UTVP:${A}`, from: A, name: 'ada', game: 'simon', gameName: 'Simon Memory', code: '9UTVP', url: '/games/simon?room=9UTVP', at: clock.t, until: clock.t + INVITE_TTL_MS, left: INVITE_TTL_MS });
  assert.ok(bell.includes(B), 'the bell keeps it');
  clock.t += 60_000;
  const ping = f.ping(B).body as { invites: Invite[]; ticket: string };
  assert.equal(ping.invites.length, 1); assert.equal(ping.ticket, `ticket-for-${B}`);
  assert.equal(ping.invites[0]!.left, INVITE_TTL_MS - 60_000, 'time left is counted by the server');
  assert.equal((f.ping(A).body.invites as unknown[]).length, 0, 'the host is not shown their own invite');
  // asking again after the gap replaces the invite, it does not stack
  clock.t += INVITE_GAP_MS + 1; await f.invite(A, B, 'simon', '9UTVP');
  assert.equal(f.pendingFor(B).length, 1);
  clock.t += INVITE_TTL_MS + 1;
  assert.equal(f.pendingFor(B).length, 0, 'an old invite is not shown');
  // a failing live line never costs the invite
  const g = createFriends({ store, nameOf: async () => null, live: () => { throw new Error('line down'); }, now: () => clock.t });
  clock.t += INVITE_GAP_MS + 1;
  assert.equal((await g.invite(A, B, 'ladder', 'ABCDE')).body.sent, true);
});
