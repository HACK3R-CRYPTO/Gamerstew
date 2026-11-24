import test from 'node:test';
import assert from 'node:assert';
import { ACHIEVEMENT_CATALOG, advanceMission, goldStreak, levelFromXp, MISSION_TEMPLATES, pickDailyMissions, totalXpForLevel, utcDay, xpProgress } from './catalog';
import { createProgression } from './service';
import { supabaseProgression, type MissionRow, type ProgressionStore, type ScoreEntry, type UserRow } from './store';

const W = '0x' + 'ab'.repeat(20);
const NOW = Date.parse('2026-11-23T10:00:00Z');
const tpl = (id: string) => MISSION_TEMPLATES.find((t) => t.id === id)!;

// An in-memory store that behaves like the database, including the one rule
// that matters for claims: a conditional update changes a row at most once.
function world(seed: { user?: UserRow | null; missions?: MissionRow[]; best?: { id: number; score: number } | null; unlocked?: string[]; played?: string[]; gamesPlayed?: number | null; enrolled?: boolean; failReplace?: boolean } = {}) {
  const log: string[] = [];
  const state = { user: seed.user === undefined ? ({ xp: 0, play_streak: 0 } as UserRow) : seed.user, missions: (seed.missions ?? []).map((m) => ({ ...m })), best: seed.best ?? null, scores: [] as unknown[], activity: [] as unknown[], unlocked: [...(seed.unlocked ?? [])], points: [] as unknown[], added: [] as unknown[] };
  const store: ProgressionStore = {
    missionCount: async () => state.missions.length,
    addMissions: async (rows) => { log.push('addMissions'); state.added.push(...rows); rows.forEach((r, i) => state.missions.push({ id: 100 + i, progress: 0, completed: false, claimed: false, ...r })); },
    missions: async () => state.missions,
    gamesPlayedSince: async (_w, since) => { log.push(`playedSince ${since}`); return seed.played ?? []; },
    setMissionProgress: async (id, progress, completed) => { log.push(`progress ${id} ${progress} ${completed}`); Object.assign(state.missions.find((m) => m.id === id)!, { progress, completed }); },
    mission: async (id, wallet) => state.missions.find((m) => m.id === id && m.wallet === wallet) ?? null,
    claimMission: async (id) => { await Promise.resolve(); const m = state.missions.find((x) => x.id === id)!; if (m.claimed) return false; m.claimed = true; return true; },
    unlockedIds: async () => state.unlocked,
    unlocks: async () => state.unlocked.map((id) => ({ achievement_id: id, unlocked_at: '2026-11-01T00:00:00.900Z', nft_token_id: null, tx_hash: null })),
    addUnlock: async (row) => { state.unlocked.push(row.achievement_id); // no uniqueness here on purpose: the SERVICE must not ask twice
      log.push(`unlock ${row.achievement_id} ${row.trigger_game} ${row.trigger_score}`); return true; },
    user: async () => state.user,
    setXp: async (_w, xp) => { await Promise.resolve(); state.user = { ...(state.user ?? {}), xp }; },
    setClaimStreak: async (_w, streak, date) => { state.user = { ...(state.user ?? {}), claim_streak: streak, last_claim_date: date }; },
    bestScore: async () => state.best,
    insertScore: async (e) => { log.push('insertScore'); state.scores.push(e); },
    replaceScore: async (id, e) => { log.push(`replaceScore ${id}`); if (seed.failReplace) throw new Error('db down'); state.scores.push(e); },
    addActivity: async (row) => { log.push('activity'); state.activity.push(row); },
    feed: async () => ({ ok: true, rows: [] }),
    isEnrolled: async () => seed.enrolled ?? false,
    addClaimPoints: async (w, d) => { state.points.push([w, d]); },
  };
  const logs: string[] = [];
  const p = createProgression({ store, badges: async () => [], gamesPlayed: async () => (seed.gamesPlayed === undefined ? 0 : seed.gamesPlayed), now: () => NOW, logger: { log: (m) => logs.push(m), warn: (m) => logs.push(m) } });
  return { p, state, log, logs, store };
}
const mission = (id: number, mission_id: string, over: Partial<MissionRow> = {}): MissionRow => ({ id, wallet: W, date: '2026-11-23', mission_id, target: tpl(mission_id).target, progress: 0, completed: false, claimed: false, reward_xp: tpl(mission_id).reward, ...over });

test('levels: each one costs 100 XP more than the last', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(totalXpForLevel), [0, 100, 300, 600, 1000]);
  assert.deepStrictEqual([0, 99, 100, 299, 300, 599, 600, 1000].map(levelFromXp), [1, 1, 2, 2, 3, 3, 4, 5]);
  assert.deepStrictEqual([null, undefined, -50].map(levelFromXp), [1, 1, 1]);
  assert.deepStrictEqual(xpProgress(150), { level: 2, xpInLevel: 50, xpToNext: 200 });
  assert.deepStrictEqual(xpProgress(0), { level: 1, xpInLevel: 0, xpToNext: 100 });
  for (const xp of [0, 100, 250, 600, 5000]) { const p = xpProgress(xp); assert.ok(p.xpInLevel >= 0 && p.xpInLevel < p.xpToNext, `xp ${xp}`); } // never overflows the bar
});

test('daily missions: three a day, one of each kind, the same all day, and different tomorrow', () => {
  const a = pickDailyMissions(W, '2026-11-23');
  assert.deepStrictEqual(a.map((m) => m.cat), ['count', 'skill', 'special']);
  assert.deepStrictEqual(pickDailyMissions(W, '2026-11-23').map((m) => m.id), a.map((m) => m.id)); // no reroll by asking again
  const month = new Set(Array.from({ length: 30 }, (_, d) => pickDailyMissions(W, `2026-11-${String(d + 1).padStart(2, '0')}`).map((m) => m.id).join()));
  assert.ok(month.size > 5); // the days really do differ
  assert.strictEqual(new Set(MISSION_TEMPLATES.map((m) => m.id)).size, MISSION_TEMPLATES.length);
});

test('a mission advances by what the run earned, and never past its target', () => {
  const seen = (...g: string[]) => new Set<unknown>(g);
  const run = { game: 'rhythm', score: 550, isNewPb: false, seenGamesToday: seen('rhythm') };
  assert.deepStrictEqual(advanceMission(tpl('play_3_games'), { progress: 1, target: 3 }, run), { progress: 2, completed: false });
  assert.deepStrictEqual(advanceMission(tpl('play_3_games'), { progress: 2, target: 3 }, run), { progress: 3, completed: true });
  assert.deepStrictEqual(advanceMission(tpl('rhythm_50k'), { progress: 0, target: 1 }, run), { progress: 1, completed: true });
  assert.strictEqual(advanceMission(tpl('rhythm_80k'), { progress: 0, target: 1 }, run), null); // not enough
  assert.strictEqual(advanceMission(tpl('simon_5'), { progress: 0, target: 1 }, run), null); // wrong game
  assert.strictEqual(advanceMission(tpl('beat_personal_best'), { progress: 0, target: 1 }, run), null);
  // variety counts the games seen today, it does not add
  assert.deepStrictEqual(advanceMission(tpl('variety_2'), { progress: 1, target: 2 }, { ...run, seenGamesToday: seen('rhythm', 'simon') }), { progress: 2, completed: true });
  assert.strictEqual(advanceMission(tpl('variety_3'), { progress: 2, target: 3 }, { ...run, seenGamesToday: seen('rhythm', 'simon') }), null); // unchanged
  assert.deepStrictEqual(advanceMission(tpl('variety_2'), { progress: 0, target: 2 }, { ...run, seenGamesToday: seen('a', 'b', 'c', 'd') }), { progress: 2, completed: true }); // capped
});

test('playing updates only the missions the run moved, and creates today\\x27s three if they are missing', async () => {
  const w = world({ missions: [mission(1, 'play_3_games', { progress: 2 }), mission(2, 'rhythm_80k'), mission(3, 'variety_2', { progress: 1 }), mission(4, 'play_5_games', { progress: 2, completed: true })], played: ['rhythm', 'stack'] });
  await w.p.updateMissionProgress(W, { game: 'rhythm', score: 400 });
  assert.deepStrictEqual(w.log, ['playedSince 2026-11-23T00:00:00.000Z', 'progress 1 3 true', 'progress 3 2 true']); // a finished mission is left alone
  assert.deepStrictEqual(w.logs, ['🎯 0xababab... completed: Play 3 games today', '🎯 0xababab... completed: Play 2 different games today']);
  const fresh = world();
  await fresh.p.updateMissionProgress(W, { game: 'simon', score: 9 });
  assert.strictEqual(fresh.state.added.length, 3);
  assert.deepStrictEqual(Object.keys(fresh.state.added[0] as object), ['wallet', 'date', 'mission_id', 'target', 'reward_xp']);
});

test('a mission reward is paid once, even when two claims arrive in the same instant', async () => {
  const w = world({ user: { xp: 90 }, missions: [mission(7, 'play_3_games', { progress: 3, completed: true })] });
  const [a, b] = await Promise.all([w.p.routes.claimMission({ wallet: W, missionId: 7 }), w.p.routes.claimMission({ wallet: W.toUpperCase().replace('0X', '0x'), missionId: 7 })]);
  const paid = [a, b].filter((r) => r.status === 200);
  assert.strictEqual(paid.length, 1); // the old code paid both
  assert.deepStrictEqual(paid[0]!.body, { success: true, xpAwarded: 20, xp: 110, level: 2, leveledUp: true });
  assert.deepStrictEqual([a, b].find((r) => r.status !== 200), { status: 400, body: { error: 'Already claimed' } });
  assert.strictEqual(w.state.user!.xp, 110); // 90 + 20, not 90 + 40
  assert.deepStrictEqual(await w.p.routes.claimMission({ wallet: W, missionId: 7 }), { status: 400, body: { error: 'Already claimed' } });
});

test('claims are refused for the right reason', async () => {
  const w = world({ missions: [mission(7, 'play_3_games', { progress: 1 }), mission(8, 'simon_5', { wallet: '0xsomeoneelse', completed: true })] });
  assert.deepStrictEqual(await w.p.routes.claimMission({}), { status: 400, body: { error: 'Missing wallet or missionId' } });
  assert.deepStrictEqual(await w.p.routes.claimMission({ wallet: W }), { status: 400, body: { error: 'Missing wallet or missionId' } });
  assert.deepStrictEqual(await w.p.routes.claimMission({ wallet: { a: 1 }, missionId: 7 }), { status: 400, body: { error: 'Missing wallet or missionId' } });
  assert.deepStrictEqual(await w.p.routes.claimMission({ wallet: W, missionId: 99 }), { status: 404, body: { error: 'Mission not found' } });
  assert.deepStrictEqual(await w.p.routes.claimMission({ wallet: W, missionId: 8 }), { status: 404, body: { error: 'Mission not found' } }); // someone else's mission
  assert.deepStrictEqual(await w.p.routes.claimMission({ wallet: W, missionId: 7 }), { status: 400, body: { error: 'Mission not yet completed' } });
  assert.strictEqual(w.state.user!.xp, 0);
});

test('saving a score keeps the best, never loses it, and always records the run', async () => {
  const entry = (score: number): ScoreEntry => ({ wallet_address: W, game: 'stack', score, tx_hash: '0xtx' });
  const first = world();
  await first.p.saveScore(entry(40));
  assert.deepStrictEqual(first.log, ['insertScore', 'activity']);
  const lower = world({ best: { id: 5, score: 90 } });
  await lower.p.saveScore(entry(40));
  assert.deepStrictEqual(lower.log, ['activity']); // the best stands; the run is still in the feed
  const equal = world({ best: { id: 5, score: 40 } });
  await equal.p.saveScore(entry(40));
  assert.deepStrictEqual(equal.log, ['activity']);
  const better = world({ best: { id: 5, score: 40 } });
  await better.p.saveScore(entry(90));
  assert.deepStrictEqual(better.log, ['replaceScore 5', 'activity']); // one statement, no delete
  assert.deepStrictEqual(better.logs, ['📈 Score updated: 0xababab... 40 → 90']);
  assert.deepStrictEqual(better.state.activity, [{ wallet_address: W, game: 'stack', score: 90, tx_hash: '0xtx' }]);
  // if that one statement fails, the old best is untouched: nothing was deleted first
  const broken = world({ best: { id: 5, score: 40 }, failReplace: true });
  await assert.rejects(broken.p.saveScore(entry(90)), /db down/);
  assert.ok(!broken.log.some((l) => l.startsWith('delete')));
  assert.deepStrictEqual(broken.state.scores, []);
});

test('achievements unlock once, from the run plus the player\\x27s totals', async () => {
  const w = world({ user: { play_streak: 7 }, gamesPlayed: 26, unlocked: ['first_win'] });
  const got = await w.p.checkAndUnlockAchievements(W, { game: 'rhythm', score: 750, isWin: true, fullCombo: true });
  assert.deepStrictEqual(got.map((a) => a.id), ['streak_3', 'streak_7', 'games_5', 'games_25', 'rhythm_300', 'rhythm_500', 'rhythm_fc']); // not first_win again, not all-perfect
  assert.deepStrictEqual(Object.keys(got[0]!), ['id', 'name', 'icon', 'desc']);
  assert.ok(w.log.includes('unlock rhythm_500 rhythm 750'));
  assert.deepStrictEqual(await w.p.checkAndUnlockAchievements(W, { game: 'rhythm', score: 750, isWin: true, fullCombo: true }), []); // nothing twice
  assert.strictEqual(new Set(w.state.unlocked).size, w.state.unlocked.length); // and nothing stored twice
  const offline = world({ gamesPlayed: null }); // the chain could not be asked: totals count as zero, nothing breaks
  assert.deepStrictEqual((await offline.p.checkAndUnlockAchievements(W, { game: 'stack', score: 10 })).map((a) => a.id), []);
  assert.strictEqual(new Set(ACHIEVEMENT_CATALOG.map((a) => a.id)).size, ACHIEVEMENT_CATALOG.length);
});

test('XP: nothing for nothing, and a level-up is reported', async () => {
  const w = world({ user: { xp: 95 } });
  assert.strictEqual(await w.p.awardXp(W, 0), null);
  assert.deepStrictEqual(await w.p.awardXp(W, 4), { xp: 99, level: 1, leveledUp: false });
  assert.deepStrictEqual(await w.p.awardXp(W.toUpperCase().replace('0X', '0x'), 10, 'played'), { xp: 109, level: 2, leveledUp: true });
  assert.deepStrictEqual(w.logs, ['✨ 0xababab... LV 1 → 2 (+10 XP played)']);
  assert.deepStrictEqual(await world({ user: null }).p.awardXp(W, 30), { xp: 30, level: 1, leveledUp: false });
});

test('profile: a new player, and a returning one with a real claim streak', async () => {
  assert.deepStrictEqual((await world({ user: null }).p.routes.user(W)).body, { address: W, xp: 0, level: 1, xpInLevel: 0, xpToNext: 100, streak: 0, playedToday: false, lastPlayDate: null });
  const r = await world({ user: { xp: 150, play_streak: 4, last_play_date: '2026-11-23', claim_streak: 6, last_claim_date: '2026-11-22' } }).p.routes.user(W.toUpperCase().replace('0X', '0x'));
  assert.deepStrictEqual(r.body, { address: W, xp: 150, level: 2, xpInLevel: 50, xpToNext: 200, streak: 4, playedToday: true, lastPlayDate: '2026-11-23', claimStreak: 6, lastClaimDate: '2026-11-22' }); // claimStreak was always 0 before
});

test('streak: alive only if they played today or yesterday', async () => {
  const s = async (last: string | null, n = 5) => (await world({ user: { play_streak: n, last_play_date: last } }).p.routes.streak(W)).body;
  assert.deepStrictEqual(await s('2026-11-23'), { streak: 5, playedToday: true });
  assert.deepStrictEqual(await s('2026-11-22'), { streak: 5, playedToday: false });
  assert.deepStrictEqual(await s('2026-11-21'), { streak: 0, playedToday: false }); // broken
  assert.deepStrictEqual((await world({ user: null }).p.routes.streak(W)).body, { streak: 0, playedToday: false });
  assert.strictEqual(utcDay(Date.parse('2026-11-23T23:59:59Z')), '2026-11-23');
  assert.strictEqual(utcDay(Date.parse('2026-11-24T00:00:00Z')), '2026-11-24');
});

test('daily claim: once a day, the streak grows by a day or restarts, enrolled players get ladder points', async () => {
  const c = async (user: UserRow | null, enrolled = false) => { const w = world({ user, enrolled }); return { r: await w.p.routes.recordClaim({ walletAddress: W }), w }; };
  assert.deepStrictEqual((await c({ claim_streak: 3, last_claim_date: '2026-11-22' })).r.body, { success: true, claimStreak: 4, alreadyClaimed: false });
  assert.deepStrictEqual((await c({ claim_streak: 3, last_claim_date: '2026-11-20' })).r.body, { success: true, claimStreak: 1, alreadyClaimed: false }); // missed a day
  assert.deepStrictEqual((await c(null)).r.body, { success: true, claimStreak: 1, alreadyClaimed: false });
  const again = await c({ claim_streak: 3, last_claim_date: '2026-11-23' }, true);
  assert.deepStrictEqual(again.r.body, { success: true, claimStreak: 3, alreadyClaimed: true });
  assert.deepStrictEqual(again.w.state.points, []); // no second helping of points
  assert.deepStrictEqual((await c({ claim_streak: 1, last_claim_date: '2026-11-22' }, true)).w.state.points, [[W, '2026-11-23']]);
  assert.deepStrictEqual((await c({ claim_streak: 1, last_claim_date: '2026-11-22' }, false)).w.state.points, []);
  for (const bad of [undefined, '', '0x123', 5]) assert.deepStrictEqual(await world().p.routes.recordClaim({ walletAddress: bad }), { status: 400, body: { error: 'Missing or invalid walletAddress' } });
});

test('badges, achievements list, missions today, notifications', async () => {
  assert.deepStrictEqual([goldStreak([]), goldStreak([4]), goldStreak([3, 1, 2]), goldStreak([1, 2, 4, 5, 6]), goldStreak([1, 3, 5])], [0, 1, 3, 3, 1]);
  const badge = (badge: string, game: string, season_number: number) => ({ badge, game, season_number, created_at: '2026-11-01T00:00:00.400Z' });
  const p = createProgression({ store: world().store, badges: async () => [badge('gold', 'rhythm', 1), badge('gold', 'rhythm', 2), badge('silver', 'simon', 2), badge('gold', 'stack', 1), badge('gold', 'stack', 2), badge('gold', 'stack', 3)], gamesPlayed: async () => 0, now: () => NOW });
  const b = (await p.routes.badges(W)).body as { badges: Record<string, unknown>[]; streaks: Record<string, number>; summary: Record<string, unknown> };
  assert.deepStrictEqual(b.streaks, { rhythm: 2, simon: 0, stack: 3, nepa: 0, ladder: 0, strike: 0, nepa3d: 0 });
  assert.deepStrictEqual(b.summary, { totalGold: 5, totalSilver: 1, totalBronze: 0, streakLabel: '2-WEEK CHAMPION' }); // the label reads rhythm and simon only, as before
  assert.deepStrictEqual(b.badges[2], { season: 2, game: 'simon', rank: 2, type: 'silver', awardedAt: Math.floor(Date.parse('2026-11-01T00:00:00.400Z') / 1000) });
  const a = (await world({ unlocked: ['games_5'] }).p.routes.achievements(W)).body as { total: number; unlockedCount: number; achievements: Record<string, unknown>[] };
  assert.deepStrictEqual([a.total, a.unlockedCount], [ACHIEVEMENT_CATALOG.length, 1]);
  assert.deepStrictEqual(a.achievements.find((x) => x.id === 'games_5'), { id: 'games_5', icon: '🎮', name: 'Getting Started', desc: 'Play 5 games total', unlocked: true, unlockedAt: Math.floor(Date.parse('2026-11-01T00:00:00.900Z') / 1000), nftTokenId: null, txHash: null });
  const m = (await world({ missions: [mission(1, 'play_3_games', { progress: 2 }), { ...mission(2, 'simon_5'), mission_id: 'retired_mission', target: 1, reward_xp: 9 }] }).p.routes.missionsToday(W)).body as { secondsUntilReset: number; missions: Record<string, unknown>[] };
  assert.strictEqual(m.secondsUntilReset, 14 * 3600); // 10:00 UTC → midnight
  assert.deepStrictEqual(m.missions[0], { id: 1, missionId: 'play_3_games', game: null, label: 'Play 3 games today', progress: 2, target: 3, completed: false, claimed: false, rewardXp: 20 });
  assert.strictEqual(m.missions[1]!.label, 'retired_mission'); // a mission no longer in the catalogue still shows
  const fail = world();
  fail.store.feed = async () => ({ ok: false, rows: [], reason: 'timeout' });
  assert.deepStrictEqual((await createProgression({ store: fail.store, badges: async () => [], gamesPlayed: async () => 0, logger: { log: () => {}, warn: () => {} } }).routes.notifications(W, '999')).body, { notifications: [] });
});

test('the store: a claim is one conditional write, and a better score is one update', async () => {
  const calls: unknown[][] = [];
  const db = (reply: unknown) => ({ from: (t: string) => { const q: Record<string, unknown> = {}; const step = (n: string) => (...a: unknown[]) => { calls.push([t, n, ...a]); return q; }; Object.assign(q, { update: step('update'), insert: step('insert'), delete: step('delete'), eq: step('eq'), select: step('select'), limit: step('limit'), order: step('order'), then: (res: (v: unknown) => unknown) => Promise.resolve(reply).then(res) }); return q; } });
  assert.strictEqual(await supabaseProgression(db({ data: [{ id: 7 }], error: null })).claimMission(7), true);
  assert.deepStrictEqual(calls, [['daily_missions', 'update', { claimed: true }], ['daily_missions', 'eq', 'id', 7], ['daily_missions', 'eq', 'claimed', false], ['daily_missions', 'select', 'id']]);
  assert.strictEqual(await supabaseProgression(db({ data: [], error: null })).claimMission(7), false); // someone else got there first
  assert.strictEqual(await supabaseProgression(db({ data: null, error: { message: '' } })).claimMission(7), false); // a failed write pays nobody
  calls.length = 0;
  await supabaseProgression(db({ data: null, error: null })).replaceScore(5, { wallet_address: W, game: 'stack', score: 90 });
  assert.deepStrictEqual(calls, [['scores', 'update', { wallet_address: W, game: 'stack', score: 90 }], ['scores', 'eq', 'id', 5]]); // exactly the columns the insert wrote
  assert.ok(!calls.some((c) => c[1] === 'delete'));
  calls.length = 0;
  await supabaseProgression(db({ data: [{ xp: 5, claim_streak: 2 }], error: null })).user(W);
  assert.deepStrictEqual(calls[0], ['users', 'select', 'xp, play_streak, last_play_date, claim_streak, last_claim_date']); // the claim columns are asked for now
});

test('every skill mission and score achievement can be reached on its game\x27s real scale, and none is free', async () => {
  const { MISSION_TEMPLATES, ACHIEVEMENT_CATALOG: ACHIEVEMENTS, missionGame, SIMON_ROUND } = await import('./catalog');
  // what a strong, honest run of each game scores, and what a run that barely started scores
  const strong: Record<string, number> = { rhythm: 1100, simon: 20 * SIMON_ROUND, stack: 320, ladder: 100, strike: 150, nepa3d: 900 };
  const weak: Record<string, number> = { rhythm: 40, simon: SIMON_ROUND, stack: 3, ladder: 10, strike: 9, nepa3d: 40 };
  for (const m of MISSION_TEMPLATES.filter((x) => x.cat === 'skill')) {
    const game = missionGame(m.id);
    assert.ok(game && strong[game] != null, `${m.id} names a game`);
    const run = (score: number) => m.match({ game: game!, score, seenGamesToday: new Set() });
    assert.strictEqual(run(strong[game!]!), 1, `${m.id} ("${m.label}") can be completed`);
    assert.strictEqual(run(weak[game!]!), 0, `${m.id} is not completed by a run that barely started`);
  }
  const base = { isWin: false, playStreak: 0, totalGames: 0 } as never;
  for (const a of ACHIEVEMENTS.filter((x) => /^(rhythm|simon|stack|ladder|strike|nepa3d)_\d|_street$/.test(x.id))) {
    const game = a.id.split('_')[0]!;
    assert.ok(a.check({ ...(base as object), game, score: strong[game]! } as never), `${a.id} ("${a.desc}") can be unlocked`);
    assert.ok(!a.check({ ...(base as object), game, score: weak[game]! } as never), `${a.id} is not unlocked by a run that barely started`);
  }
  assert.strictEqual(missionGame('play_3_games'), null); assert.strictEqual(missionGame('variety_2'), null); assert.strictEqual(missionGame('nepa3d_6'), 'nepa3d');
});
