import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomService, isFail, AWAY_MS, ROUND_MAX_MS, MAX_PLAYERS, type GameRules, type RoomView, type Seat } from './service';
import { ROOM_GAMES, rhythmSongFor } from './games';
import * as ladder from '../ladder/rules';
import { VALID } from '../ladder/data';

// a tiny game: the proof IS the score, unless it says "cheat"
const toy: GameRules = { verified: true, deal: (seed) => ({ seed }), maxProgress: 5, score: async (_s, proof) => (proof === 'cheat' ? { ok: false, error: 'nope' } : { ok: true, score: Number(proof) }) };
function world() {
  const clock = { t: 1_000_000 }; let n = 0;
  const svc = createRoomService({ toy }, { now: () => clock.t, randomHex: (b) => (++n).toString(16).padStart(b * 2, '0') });
  return { svc, clock };
}
const ok = <T>(v: T | { error: string }): T => { assert.ok(!isFail(v), `unexpected failure: ${JSON.stringify(v)}`); return v as T; };
const open = (w: ReturnType<typeof world>, names = ['Ada', 'Bo']) => {
  const host = ok<Seat>(w.svc.create('toy', names[0]));
  const others = names.slice(1).map((nm) => ok<Seat>(w.svc.join(host.code, nm)));
  return { host, others, code: host.code };
};

test('create, join, start: everyone in the room is dealt the same thing, strangers are dealt nothing', () => {
  const w = world(); const r = open(w);
  assert.match(r.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(isFail(w.svc.start(r.code, r.others[0]!.token)), true, 'only the host starts');
  const started = ok<RoomView>(w.svc.start(r.code, r.host.token));
  assert.deepEqual([started.status, started.round, started.you], ['playing', 1, 0]);
  const mine = ok<RoomView>(w.svc.get(r.code, r.host.token)); const theirs = ok<RoomView>(w.svc.get(r.code, r.others[0]!.token));
  assert.deepEqual(mine.deal, theirs.deal); assert.ok(mine.deal);
  const stranger = ok<RoomView>(w.svc.get(r.code, 'x'.repeat(32)));
  assert.equal(stranger.you, -1); assert.equal(stranger.deal, undefined);
  assert.ok(!JSON.stringify(mine).includes(r.others[0]!.token), 'tokens never leave the server');
});

test('a room needs two to start, holds four, and is closed once it has started', () => {
  const w = world(); const solo = ok<Seat>(w.svc.create('toy', 'Solo'));
  assert.deepEqual(w.svc.start(solo.code, solo.token), { error: 'need_two', status: 409 });
  const r = open(w, ['A', 'B', 'C', 'D']);
  assert.equal(r.others.length, MAX_PLAYERS - 1);
  assert.deepEqual(w.svc.join(r.code, 'E'), { error: 'full', status: 409 });
  w.svc.start(r.code, r.host.token);
  assert.deepEqual(w.svc.join(r.code, 'Late'), { error: 'started', status: 409 });
  assert.deepEqual(w.svc.create('chess', 'x'), { error: 'bad_game', status: 400 });
  assert.deepEqual(w.svc.join('ZZZZZ', 'x'), { error: 'no_room', status: 404 });
});

test('two friends with the same name are told apart', () => {
  const w = world(); const r = open(w, ['Tunde', 'tunde', 'TUNDE']);
  const v = ok<RoomView>(w.svc.get(r.code, r.host.token));
  assert.deepEqual(v.players.map((p) => p.name), ['Tunde', 'tunde 2', 'TUNDE 3']);
});

test('finish: the game scores the run; a refused run changes nothing; nobody finishes twice', async () => {
  const w = world(); const r = open(w); w.svc.start(r.code, r.host.token);
  const bad = await w.svc.finish(r.code, r.host.token, 'cheat');
  assert.deepEqual(bad, { error: 'bad_run', status: 422, reason: 'nope' });
  assert.equal(ok<RoomView>(w.svc.get(r.code, r.host.token)).players[0]!.done, false);
  const a = ok<RoomView>(await w.svc.finish(r.code, r.host.token, 70));
  assert.deepEqual([a.status, a.players[0]!.score, a.players[0]!.done], ['playing', 70, true]);
  assert.deepEqual(await w.svc.finish(r.code, r.host.token, 999), { error: 'already_done', status: 409 });
  const b = ok<RoomView>(await w.svc.finish(r.code, r.others[0]!.token, 90));
  assert.equal(b.status, 'over');
  assert.deepEqual(b.players.map((p) => p.score), [70, 90]);
  assert.deepEqual(await w.svc.finish(r.code, r.others[0]!.token, 1), { error: 'already_done', status: 409 });
});

test("progress only goes forward, never past the game's limit, and decides nothing", async () => {
  const w = world(); const r = open(w); w.svc.start(r.code, r.host.token);
  const p = (v: unknown) => ok<RoomView>(w.svc.progress(r.code, r.host.token, v)).players[0]!.progress;
  assert.deepEqual([p(2), p(1), p(99), p('junk'), p(-4)], [2, 2, 5, 5, 5]);
  assert.equal(ok<RoomView>(w.svc.get(r.code, r.host.token)).players[0]!.score, null);
  assert.equal(isFail(w.svc.progress(r.code, 'y'.repeat(32), 3)), true);
});

test('a friend who goes quiet does not hold the round, and can still finish if they come back', async () => {
  const w = world(); const r = open(w); w.svc.start(r.code, r.host.token);
  await w.svc.finish(r.code, r.host.token, 50);
  assert.equal(ok<RoomView>(w.svc.get(r.code, r.host.token)).status, 'playing');
  w.clock.t += AWAY_MS + 1;
  const v = ok<RoomView>(w.svc.get(r.code, r.host.token));
  assert.equal(v.status, 'over'); assert.equal(v.players[1]!.away, true);
  // they come back: seen again, so the round is live again for them to finish
  const back = ok<RoomView>(await w.svc.finish(r.code, r.others[0]!.token, 80));
  assert.deepEqual(back.players.map((p) => p.score), [50, 80]);
});

test('a round nobody finishes ends on its own', () => {
  const w = world(); const r = open(w); w.svc.start(r.code, r.host.token);
  w.clock.t += ROUND_MAX_MS + 1;
  assert.equal(ok<RoomView>(w.svc.get(r.code, r.host.token)).status, 'over');
});

test('host leaving hands the room on; the last one out closes it; rematch clears the scores and deals afresh', async () => {
  const w = world(); const r = open(w, ['A', 'B', 'C']); w.svc.start(r.code, r.host.token);
  const first = ok<RoomView>(w.svc.get(r.code, r.host.token)).deal;
  w.svc.leave(r.code, r.host.token);
  const v = ok<RoomView>(w.svc.get(r.code, r.others[0]!.token));
  assert.deepEqual(v.players.map((p) => p.host), [false, true, false]);
  await w.svc.finish(r.code, r.others[0]!.token, 10); await w.svc.finish(r.code, r.others[1]!.token, 20);
  assert.deepEqual(w.svc.rematch(r.code, r.others[1]!.token), { error: 'not_host', status: 403 });
  const again = ok<RoomView>(w.svc.rematch(r.code, r.others[0]!.token));
  assert.deepEqual([again.status, again.players.length, again.players.map((p) => p.score)], ['waiting', 2, [null, null]]);
  const round2 = ok<RoomView>(w.svc.start(r.code, r.others[0]!.token));
  assert.equal(round2.round, 2); assert.notDeepEqual(round2.deal, first);
  w.svc.leave(r.code, r.others[0]!.token); w.svc.leave(r.code, r.others[1]!.token);
  assert.equal(w.svc.count(), 0);
});

// ── Word Ladder in a room: the real rules ──
const W = new Set(VALID.split(' '));
function route(a: string, z: string): string[] {
  const prev = new Map<string, string | null>([[a, null]]); const q = [a];
  for (let h = 0; h < q.length; h++) { const w = q[h]!; if (w === z) break; for (let i = 0; i < 4; i++) for (let c = 97; c < 123; c++) { const x = w.slice(0, i) + String.fromCharCode(c) + w.slice(i + 1); if (!prev.has(x) && W.has(x)) { prev.set(x, w); q.push(x); } } }
  const out: string[] = []; for (let w: string | null | undefined = z; w && w !== a; w = prev.get(w)) out.unshift(w); return out;
}
test('Word Ladder room: same five ladders for everyone, and the server works out each score from the words', async () => {
  const clock = { t: 5_000_000 }; let n = 0;
  const svc = createRoomService(ROOM_GAMES, { now: () => clock.t, randomHex: (b) => (++n).toString(16).padStart(b * 2, '0') });
  const host = ok<Seat>(svc.create('ladder', 'Ada')); const guest = ok<Seat>(svc.join(host.code, 'Bo'));
  const v = ok<RoomView>(svc.start(host.code, host.token));
  assert.equal(v.verified, true);
  const dealt = (v.deal as { ladders: [string, string, number][] }).ladders;
  assert.equal(dealt.length, 5);
  assert.deepEqual((ok<RoomView>(svc.get(host.code, guest.token)).deal as { ladders: unknown }).ladders, dealt);
  const runs = dealt.map(([s, t]) => { const words = route(s, t); return { words, ms: words.length * 2000, hints: 0 }; });
  clock.t += 45_000;
  const done = ok<RoomView>(await svc.finish(host.code, host.token, { ladderRuns: runs, score: 999_999 })); // a claimed score is ignored
  const expected = ladder.verify(dealt, runs, 45_000);
  assert.ok(expected.ok); assert.equal(done.players[0]!.score, expected.ok ? expected.total : -1);
  const cheat = await svc.finish(host.code, guest.token, { ladderRuns: runs.map((r, i) => (i === 0 ? { ...r, words: ['zzzz'] } : r)) });
  assert.ok(isFail(cheat) && cheat.error === 'bad_run');
});

test('Simon room: one pattern for everyone; taps and time decide the score, never a claim above them', async () => {
  const simon = require('../../../lib/simonScoring');
  const clock = { t: 9_000_000 }; let n = 0;
  const svc = createRoomService(ROOM_GAMES, { now: () => clock.t, randomHex: (b) => (++n).toString(16).padStart(b * 2, '0') });
  const host = ok<Seat>(svc.create('simon', 'Ada')); const guest = ok<Seat>(svc.join(host.code, 'Bo'));
  const v = ok<RoomView>(svc.start(host.code, host.token));
  const seed = (v.deal as { seed: string }).seed;
  assert.equal((ok<RoomView>(svc.get(host.code, guest.token)).deal as { seed: string }).seed, seed);
  const pattern: string[] = simon.derivePattern(seed, 8); const taps: string[] = [];
  for (let r = 1; r <= 6; r++) for (let j = 0; j < r; j++) taps.push(pattern[j]!);
  taps.push(pattern[0] === 'red' ? 'cyan' : 'red');
  clock.t += 50_000;
  const honest = ok<RoomView>(await svc.finish(host.code, host.token, { simonTapLog: taps, score: 6 * 12 + 15 }));
  assert.equal(honest.players[0]!.score, 87);
  const greedy = ok<RoomView>(await svc.finish(host.code, guest.token, { simonTapLog: taps, score: 50_000 }));
  assert.equal(greedy.players[1]!.score, simon.verifySimonRun({ sessionToken: seed, tapLog: taps, elapsedMs: 50_000 }).score);
  assert.ok(greedy.players[1]!.score! < 200);
});

test('Stack room: the score is the drop log added up, never more than claimed, and it is marked unverified', async () => {
  const svc = createRoomService(ROOM_GAMES);
  const host = ok<Seat>(svc.create('stack', 'Ada')); const guest = ok<Seat>(svc.join(host.code, 'Bo'));
  const v = ok<RoomView>(svc.start(host.code, host.token));
  assert.equal(v.verified, false);
  const drops = [{ landed: true, perfect: false, offset: 20 }, { landed: true, perfect: false, offset: 30 }, { landed: true, perfect: true, offset: 2 }, { landed: false }];
  const sum = require('../../../lib/stackScoring').computeStackScore(drops).score;
  assert.ok(sum > 0);
  assert.equal(ok<RoomView>(await svc.finish(host.code, host.token, { dropLog: drops, score: 9_999 })).players[0]!.score, sum);
  assert.equal(ok<RoomView>(await svc.finish(host.code, guest.token, { dropLog: drops, score: 1 })).players[1]!.score, 1);
  const none = createRoomService(ROOM_GAMES); const h = ok<Seat>(none.create('stack', 'A')); ok<Seat>(none.join(h.code, 'B')); none.start(h.code, h.token);
  assert.ok(isFail(await none.finish(h.code, h.token, { score: 500 })));
});

test('Rhythm room: one song for everyone, and the server replays the taps; a claimed score is ignored', async () => {
  const rhythm = require('../../../lib/rhythmScoring');
  const clock = { t: 5_000_000 }; let n = 0;
  const svc = createRoomService(ROOM_GAMES, { now: () => clock.t, randomHex: (b) => (++n * 7919).toString(16).padStart(b * 2, '0') });
  const host = ok<Seat>(svc.create('rhythm', 'Ada')); const guest = ok<Seat>(svc.join(host.code, 'Bo')); const third = ok<Seat>(svc.join(host.code, 'Cy'));
  const v = ok<RoomView>(svc.start(host.code, host.token));
  const songId = (v.deal as { songId: string }).songId;
  assert.ok(rhythm.isKnownSong(songId));
  assert.equal((ok<RoomView>(svc.get(host.code, guest.token)).deal as { songId: string }).songId, songId);
  // a person's timing: 8 to 78 ms off, unevenly; holds let go on time
  const chart: { lane: number; time: number; hold?: number }[] = rhythm.buildMainChart(songId);
  const taps: { lane: number; time: number; up?: 1 }[] = [];
  chart.forEach((note, i) => { const t = note.time + 0.008 + ((i * 37 + 11) % 71) / 1000; taps.push({ lane: note.lane, time: t }); if (note.hold) taps.push({ lane: note.lane, time: t + note.hold, up: 1 }); });
  taps.sort((a, b) => a.time - b.time);
  const elapsed = Math.ceil((rhythm.TRACK_DURATION + 6) * 1000);
  clock.t += elapsed;
  const want = rhythm.computeScore(taps, elapsed, songId).score;
  assert.ok(want > 500, `an honest full run scores well (${want})`);
  const honest = ok<RoomView>(await svc.finish(host.code, host.token, { tapLog: taps }));
  assert.equal(honest.players[0]!.score, Math.round(want));
  const half = taps.slice(0, Math.floor(taps.length / 2));
  const greedy = ok<RoomView>(await svc.finish(host.code, guest.token, { tapLog: half, score: 9_999_999 }));
  assert.equal(greedy.players[1]!.score, Math.round(rhythm.computeScore(half, elapsed, songId).score));
  assert.ok(greedy.players[1]!.score! < honest.players[0]!.score!);
  const sat = ok<RoomView>(await svc.finish(host.code, third.token, { tapLog: [] }));
  assert.equal(sat.players[2]!.score, 0);
  assert.equal(sat.status, 'over');
  assert.equal(ROOM_GAMES.rhythm!.verified, true);
  assert.ok(svc.games().includes('rhythm'));
});

test('Rhythm room: the seed picks the song, and different seeds reach different songs', () => {
  const picks = new Set(Array.from({ length: 40 }, (_, i) => rhythmSongFor((i * 2654435761 >>> 0).toString(16).padStart(8, '0') + '0'.repeat(24))));
  assert.ok(picks.size >= 3);
  assert.equal(rhythmSongFor('zz'), rhythmSongFor('')); // a seed that is not hex still lands on a real song
});

test('a restart does not end a room: it is written on every change that matters and comes back whole', async () => {
  const disk = new Map<string, string>(); const writes: string[] = [];
  const keep = { save: (r: { code: string }) => { disk.set(r.code, JSON.stringify(r)); writes.push('save'); }, remove: (c: string) => { disk.delete(c); writes.push('remove'); } };
  const clock = { t: 1_000_000 };
  const before = createRoomService(ROOM_GAMES, { now: () => clock.t, keep });
  const host = ok<Seat>(before.create('stack', 'Ada')); const guest = ok<Seat>(before.join(host.code, 'Bo'));
  ok<RoomView>(before.start(host.code, host.token));
  ok<RoomView>(await before.finish(host.code, host.token, { dropLog: [], score: 0 }));
  await new Promise((r) => setTimeout(r, 5)); // saves are not awaited by the caller
  const savedSoFar = writes.length;
  before.progress(host.code, guest.token, 4); before.get(host.code, guest.token);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(writes.length, savedSoFar, 'progress and polling are not written');
  assert.equal(savedSoFar, 4);

  // the server restarts 30 seconds later: a new service, nothing in memory
  clock.t += 30_000;
  const after = createRoomService(ROOM_GAMES, { now: () => clock.t, keep });
  assert.equal(after.count(), 0);
  assert.equal(after.restore([...disk.values()].map((j) => JSON.parse(j))), 1);
  const v = ok<RoomView>(after.get(host.code, guest.token));
  assert.equal(v.status, 'playing'); assert.equal(v.round, 1); assert.equal(v.you, 1);
  assert.equal(v.players[0]!.done, true); assert.equal(v.players[1]!.done, false);
  const done = ok<RoomView>(await after.finish(host.code, guest.token, { dropLog: [], score: 0 }));
  assert.equal(done.status, 'over');

  // stale rooms, unknown games and duplicates are not brought back
  const stale = { ...JSON.parse([...disk.values()][0]!), code: 'OLDER', touched: clock.t - 60 * 60 * 1000 };
  const odd = { ...JSON.parse([...disk.values()][0]!), code: 'ODDGM', game: 'chess' };
  assert.equal(after.restore([stale, odd, JSON.parse([...disk.values()][0]!), null, 'junk']), 0);

  // the last player leaving removes the saved room too
  after.leave(host.code, host.token); after.leave(host.code, guest.token);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(disk.size, 0);
});

test('UP NEPA 3D room: a race the server times itself; unverified, so it can never carry a stake', async () => {
  const clock = { t: 3_000_000 }; let n = 0;
  const svc = createRoomService(ROOM_GAMES, { now: () => clock.t, randomHex: (b) => (++n).toString(16).padStart(b * 2, '0') });
  const host = ok<Seat>(svc.create('nepa3d', 'Ada')); const guest = ok<Seat>(svc.join(host.code, 'Bo'));
  const v = ok<RoomView>(svc.start(host.code, host.token));
  assert.equal(v.verified, false); assert.equal(v.stakes, false);
  clock.t += 20_000;
  // a "win" in 5 seconds, sent 20 seconds in: faster than the street can be crossed
  const tooFast = await svc.finish(host.code, host.token, { nepa3dRun: { won: true, restored: 10, timeTaken: 5, skill: 0 } });
  assert.ok(isFail(tooFast) && tooFast.error === 'bad_run');
  clock.t += 40_000; // a minute in
  const win = ok<RoomView>(await svc.finish(host.code, host.token, { nepa3dRun: { won: true, restored: 10, timeTaken: 50, skill: 120 } }));
  const lost = ok<RoomView>(await svc.finish(host.code, guest.token, { nepa3dRun: { won: false, restored: 6, timeTaken: null, skill: 9999 } }));
  assert.ok(win.players[0]!.score! > 700, String(win.players[0]!.score));
  assert.equal(lost.players[1]!.score, 240); // six of ten breakers, and nothing for skill on a lost run
  assert.equal(lost.status, 'over');
});

test("a signed-in seat's checked round goes on the chain after the result; guests, zero scores and unchecked games do not", async () => {
  const A = '0x' + 'a'.repeat(40); const sent: { account: string; game: string; score: number; ref: string }[] = [];
  const loose: GameRules = { ...toy, verified: false };
  let fail = false;
  const svc = createRoomService({ toy, loose }, { onChain: async (run) => { sent.push(run); if (fail) throw new Error('rpc down'); return { txHash: '0xtx' + sent.length }; } });
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const h = ok<Seat>(svc.create('toy', 'Ada', A.toUpperCase().replace('0X', '0x'))); const g = ok<Seat>(svc.join(h.code, 'Bo')); const twin = ok<Seat>(svc.join(h.code, 'Cy', A));
  svc.start(h.code, h.token);
  const first = ok<RoomView>(await svc.finish(h.code, h.token, '40'));
  assert.equal(first.players[0]!.score, 40, 'the result is answered at once');
  assert.equal(first.players[0]!.chain?.state, 'sending');
  await svc.finish(h.code, g.token, '30'); await svc.finish(h.code, twin.token, '20'); await settle();
  assert.deepEqual(sent.map((s) => [s.account, s.game, s.score]), [[A, 'toy', 40]], 'only the signed-in seat, once: the guest and the second phone on the same wallet are not recorded');
  const after = ok<RoomView>(svc.get(h.code, g.token));
  assert.deepEqual(after.players.map((p) => p.chain ?? null), [{ state: 'recorded', tx: '0xtx1' }, null, null]);
  // a new round starts clean, and a failed send says so instead of hanging on "sending"
  svc.rematch(h.code, h.token); svc.start(h.code, h.token); fail = true;
  assert.equal(ok<RoomView>(svc.get(h.code, h.token)).players[0]!.chain, undefined);
  await svc.finish(h.code, h.token, '50'); await settle();
  assert.equal(ok<RoomView>(svc.get(h.code, h.token)).players[0]!.chain?.state, 'failed');
  assert.notEqual(sent[1]!.ref, sent[0]!.ref, 'every round has its own reference');
  // a zero, and a game whose score is the phone's word, are never sent
  const z = ok<Seat>(svc.create('toy', 'Z', A)); ok<Seat>(svc.join(z.code, 'Y')); svc.start(z.code, z.token); await svc.finish(z.code, z.token, '0');
  const l = ok<Seat>(svc.create('loose', 'L', A)); ok<Seat>(svc.join(l.code, 'M')); svc.start(l.code, l.token); await svc.finish(l.code, l.token, '99'); await settle();
  assert.equal(sent.length, 2);
  assert.equal(ok<Seat | { error: string }>(svc.create('toy', 'Q', 'not-a-wallet')) && sent.length, 2);
});
