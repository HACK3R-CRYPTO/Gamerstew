import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInbox, kindOf, safeUrl, MAX_IDS, type FeedRow, type InboxStore } from './service';

const W = '0x' + 'a'.repeat(40);
function world(over: Partial<InboxStore> = {}) {
  const calls: unknown[] = [];
  const rows: FeedRow[] = [
    { id: 3, kind: 'whats_new', category: 'whats_new', title: 'Word Ladder is here', body: 'A new game', url: '/games/ladder', sent_at: '2026-11-24T10:00:00Z', is_broadcast: true, read: false },
    { id: 2, kind: null, category: 'achievement_first_win', title: 'Achievement', body: null, url: 'javascript:alert(1)', sent_at: '2026-11-24T09:00:00Z', is_broadcast: false, read: true },
  ];
  const store: InboxStore = {
    page: async (w, limit, before) => { calls.push(['page', w, limit, before]); return { ok: true, rows }; },
    unread: async () => ({ ok: true, count: 1 }),
    markRead: async (w, ids) => { calls.push(['markRead', w, ids]); return true; },
    markAllRead: async (w, at) => { calls.push(['markAllRead', w, at]); return true; },
    remove: async (w, ids) => { calls.push(['remove', w, ids]); return true; },
    clearAll: async (w, at) => { calls.push(['clearAll', w, at]); return true; },
    announce: async (row) => { calls.push(['announce', row]); return { ok: true, created: true, id: 9 }; },
    ...over,
  };
  return { inbox: createInbox({ store, now: () => Date.parse('2026-11-24T12:00:00Z') }), calls };
}

test('list: newest first, kinds worked out, an unsafe link dropped, the wallet lower-cased', async () => {
  const w = world();
  const r = await w.inbox.list(W.toUpperCase().replace('0X', '0x'), { limit: '10' });
  assert.equal(r.status, 200);
  const items = r.body.items as { id: string; kind: string; url: string | null; read: boolean; fromGameArena: boolean; sentAt: number }[];
  assert.deepEqual(items.map((i) => [i.id, i.kind, i.url, i.read, i.fromGameArena]), [['3', 'whats_new', '/games/ladder', false, true], ['2', 'reward', null, true, false]]);
  assert.equal(r.body.unread, 1);
  assert.deepEqual(w.calls[0], ['page', W, 10, null]);
  assert.equal((await w.inbox.list('nope')).status, 400);
});

test('list: a failed read says it could not look, it does not say "all caught up"', async () => {
  const r = await world({ page: async () => ({ ok: false, rows: [] }) }).inbox.list(W);
  assert.deepEqual(r.body, { items: [], unread: 0, more: false, unavailable: true });
});

test('read and delete: some by id, or everything by one timestamp; never for a bad address or junk ids', async () => {
  const w = world();
  assert.equal((await w.inbox.read(W, { ids: [3, '2', 3] })).status, 200);
  assert.equal((await w.inbox.read(W, { all: true })).status, 200);
  assert.equal((await w.inbox.remove(W, { ids: [2] })).status, 200);
  assert.equal((await w.inbox.remove(W, { all: true })).status, 200);
  assert.deepEqual(w.calls, [['markRead', W, [3, 2]], ['markAllRead', W, '2026-11-24T12:00:00.000Z'], ['remove', W, [2]], ['clearAll', W, '2026-11-24T12:00:00.000Z']]);
  for (const bad of [{}, { ids: [] }, { ids: ['x'] }, { ids: [-1] }, { ids: [1.5] }, { ids: Array(MAX_IDS + 1).fill(1) }, { all: 'yes' }]) {
    assert.equal((await w.inbox.read(W, bad)).status, 400); assert.equal((await w.inbox.remove(W, bad)).status, 400);
  }
  assert.equal((await w.inbox.remove('0x123', { all: true })).status, 400);
  assert.equal(w.calls.length, 4, 'nothing was written for the refused requests');
});

test('a write that fails is reported, not swallowed', async () => {
  const r = await world({ remove: async () => false }).inbox.remove(W, { ids: [1] });
  assert.equal(r.status, 503);
});

test('announce: trimmed, bounded, links checked, and the same key twice is one announcement', async () => {
  const w = world();
  const r = await w.inbox.announce({ title: '  New game: Word Ladder  ', body: 'Turn one word into another.', url: '/games/ladder', kind: 'whats_new', dedupeKey: 'ladder-launch' });
  assert.deepEqual(r.body, { ok: true, created: true, id: 9, kind: 'whats_new' });
  assert.deepEqual(w.calls[0], ['announce', { kind: 'whats_new', category: 'whats_new', title: 'New game: Word Ladder', body: 'Turn one word into another.', url: '/games/ladder', dedupeKey: 'ladder-launch' }]);
  assert.equal((await w.inbox.announce({ body: 'no title' })).status, 400);
  assert.equal((await w.inbox.announce({ title: 'x', url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await w.inbox.announce({ title: 'x', url: 'http://not-secure.example' })).status, 400);
  const long = await world().inbox.announce({ title: 'T'.repeat(500), body: 'B'.repeat(5000) });
  assert.equal(long.status, 200);
  const again = await world({ announce: async () => ({ ok: true, created: false }) }).inbox.announce({ title: 'x', dedupeKey: 'k' });
  assert.equal(again.body.created, false);
});

test('kinds and links', () => {
  assert.deepEqual(['broadcast', 'whats_new', 'achievement_x', 'wager_won', 'rank_change', 'close_rank_chase', 'streak_warning', 'reengagement_d3', 'something_new'].map((c) => kindOf(c)),
    ['announcement', 'whats_new', 'reward', 'reward', 'rank', 'rank', 'reminder', 'reminder', 'activity']);
  assert.equal(kindOf('broadcast', 'whats_new'), 'whats_new'); // a stored kind wins
  assert.deepEqual(['/games/ladder', 'https://gamearenahq.xyz/x', '//evil.example', 'javascript:1', 'http://a.b', ''].map(safeUrl), ['/games/ladder', 'https://gamearenahq.xyz/x', null, null, null, null]);
});
