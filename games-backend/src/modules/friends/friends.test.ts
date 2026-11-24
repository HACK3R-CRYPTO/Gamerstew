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
