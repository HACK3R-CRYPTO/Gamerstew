import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnfinishedRecorder, noteFor, type OpenRun } from './unfinished';

const W = (c: string) => '0x' + c.repeat(40); const H = (n: number) => '0x' + n.toString(16).padStart(64, '0');
function world(runs: OpenRun[], opts: { fail?: boolean; perWalletPerDay?: number; perPass?: number; perDay?: number } = {}) {
  const clock = { t: Date.parse('2026-11-26T12:00:00Z') }; const sent: string[] = []; const marked = new Map<string, string>(); let n = 0;
  const rec = createUnfinishedRecorder({
    now: () => clock.t, perPass: opts.perPass ?? 8, perWalletPerDay: opts.perWalletPerDay ?? 20, perDay: opts.perDay ?? 1500,
    store: {
      open: async (older, newer, limit) => runs.filter((r) => !marked.has(r.token) && r.startedAt < older && r.startedAt > newer).slice(0, limit),
      mark: async (token, hash) => { marked.set(token, hash); return true; },
    },
    send: async (note) => { if (opts.fail) throw new Error('out of gas'); sent.push(note); return H(++n); },
  });
  return { rec, sent, marked, clock };
}
const at = (minsAgo: number) => new Date(Date.parse('2026-11-26T12:00:00Z') - minsAgo * 60000).toISOString();

test('a run too old to finish gets one transaction with a readable note; a fresh one and an ancient one are left alone', async () => {
  const w = world([{ token: 'old', wallet: W('A'), game: 'ladder', startedAt: at(40) }, { token: 'fresh', wallet: W('a'), game: 'stack', startedAt: at(5) }, { token: 'ancient', wallet: W('a'), game: 'stack', startedAt: at(60 * 9) }]);
  assert.deepEqual(await w.rec.sweep(), { sent: 1, skipped: 0, failed: 0 });
  assert.equal(w.sent[0], `GameArena · unfinished run · ladder · ${W('a')}`);
  assert.deepEqual([...w.marked.keys()], ['old']);
  assert.deepEqual(await w.rec.sweep(), { sent: 0, skipped: 0, failed: 0 }, 'never twice');
  assert.equal(noteFor({ game: 'x"; drop--', wallet: W('B') }), `GameArena · unfinished run · xdrop-- · ${W('b')}`);
});

test('one player cannot make the server pay without end, and the day has a ceiling', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ token: `t${i}`, wallet: W('a'), game: 'stack', startedAt: at(30 + i) }));
  const w = world([...many, { token: 'other', wallet: W('b'), game: 'simon', startedAt: at(31) }], { perWalletPerDay: 3, perPass: 50 });
  const out = await w.rec.sweep();
  assert.equal(w.sent.filter((s) => s.endsWith(W('a'))).length, 3); assert.equal(w.sent.filter((s) => s.endsWith(W('b'))).length, 1); assert.equal(out.sent, 4);
  const capped = world(many, { perDay: 2, perPass: 50 });
  assert.equal((await capped.rec.sweep()).sent, 2); assert.equal((await capped.rec.sweep()).sent, 0);
});

test('a failed send stops the pass and marks nothing, so it is tried again later; a bad wallet is passed over', async () => {
  const runs = [{ token: 'a', wallet: W('a'), game: 'stack', startedAt: at(30) }, { token: 'b', wallet: W('b'), game: 'stack', startedAt: at(31) }];
  const w = world(runs, { fail: true });
  assert.deepEqual(await w.rec.sweep(), { sent: 0, skipped: 0, failed: 1 }); assert.equal(w.marked.size, 0);
  const odd = world([{ token: 'g', wallet: 'guest', game: 'stack', startedAt: at(30) }]);
  assert.deepEqual(await odd.rec.sweep(), { sent: 0, skipped: 1, failed: 0 });
});
