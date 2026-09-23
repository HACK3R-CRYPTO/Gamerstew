const test = require('node:test');
const assert = require('node:assert');
const {
  dedupeByIdentityRoot, scoreTeams, ropeOffset, bountyWinners,
  playPulls, POINTS_PER_QUALIFIED_HUMAN, ROPE_CAP,
} = require('./tugScoring');

const ROOT_A = '0xaaaa000000000000000000000000000000000001';
const ROOT_B = '0xbbbb000000000000000000000000000000000002';
const q = (wallet, root, at, team = 'red', extra = {}) => ({
  wallet, identity_root: root, qualified_at: at, team,
  qualified_block: 1, qualified_log_idx: 0, games_at_qualify: 3, ...extra,
});

// ── The attack the whole design exists to stop ──────────────────────────────
test('160 wallets sharing one identity root score as ONE human', () => {
  const sybil = Array.from({ length: 160 }, (_, i) =>
    q(`0x${String(i).padStart(40, '0')}`, ROOT_A, `2026-09-23T10:00:${String(i % 60).padStart(2,'0')}Z`));
  const out = dedupeByIdentityRoot(sybil);
  assert.equal(out.filter(r => r.counted).length, 1, 'one face must be one human');
  assert.equal(out.filter(r => r.duplicate_of).length, 159);
});

test('the earliest on-chain qualifier keeps the seat, not the first row passed in', () => {
  const rows = [
    q('0xlate',  ROOT_A, '2026-09-23T12:00:00Z'),
    q('0xearly', ROOT_A, '2026-09-23T09:00:00Z'),
  ];
  const counted = dedupeByIdentityRoot(rows).find(r => r.counted);
  assert.equal(counted.wallet, '0xearly');
});

test('duplicates are retained for review, never silently dropped', () => {
  // A connectAccount poisoning attack would mass-link real players to one root.
  // Dropping rows would erase them invisibly; we must be able to see it.
  const rows = [q('0xa', ROOT_A, '2026-09-23T09:00:00Z'), q('0xb', ROOT_A, '2026-09-23T10:00:00Z')];
  const out = dedupeByIdentityRoot(rows);
  assert.equal(out.length, 2, 'no row may vanish');
  assert.equal(out.find(r => r.wallet === '0xb').duplicate_of, '0xa');
});

test('a zero / missing identity root never scores', () => {
  const rows = [
    q('0xa', '0x0000000000000000000000000000000000000000', '2026-09-23T09:00:00Z'),
    q('0xb', '', '2026-09-23T09:00:00Z'),
  ];
  assert.equal(dedupeByIdentityRoot(rows).filter(r => r.counted).length, 0);
});

test('root matching ignores address casing', () => {
  const rows = [
    q('0xa', ROOT_A.toLowerCase(), '2026-09-23T09:00:00Z'),
    q('0xb', ROOT_A.toUpperCase(), '2026-09-23T10:00:00Z'),
  ];
  assert.equal(dedupeByIdentityRoot(rows).filter(r => r.counted).length, 1);
});

test('ordering is deterministic when timestamps collide', () => {
  const rows = [
    q('0xb', ROOT_A, '2026-09-23T09:00:00Z', 'red', { qualified_block: 5, qualified_log_idx: 2 }),
    q('0xa', ROOT_B, '2026-09-23T09:00:00Z', 'red', { qualified_block: 5, qualified_log_idx: 1 }),
  ];
  // Same timestamp → log index decides, so the bounty cutoff is re-derivable.
  assert.equal(bountyWinners(rows, 1)[0].wallet, '0xa');
  assert.deepEqual(bountyWinners([...rows].reverse(), 1)[0].wallet, '0xa');
});

// ── Daily pull cap ───────────────────────────────────────────────────────────
test('the limit applies per DAY, not once over the whole event', () => {
  const oneDay = [{ play_date: '2026-09-23', best: new Map([[2, 134]]) }];
  const twoDays = [
    { play_date: '2026-09-23', best: new Map([[2, 134]]) },
    { play_date: '2026-09-24', best: new Map([[2, 134]]) },
  ];
  // Within 1 of double, not exactly double: the total is rounded once at the
  // end rather than per day, so two half-points can merge into one.
  assert.ok(Math.abs(playPulls(twoDays, 5) - playPulls(oneDay, 5) * 2) <= 1,
    `${playPulls(twoDays, 5)} should be about double ${playPulls(oneDay, 5)}`);
});

test('a grinder cannot outscore recruiting', () => {
  // The best single day seen in live data is a raw 38 points (lollyposh).
  const dailyByWallet = new Map([['0xgrinder', [{ play_date: '2026-09-23', best: new Map([[2, 134], [1, 108], [0, 789]]) }]]]);
  const one = scoreTeams({
    qualifications: [q('0xgrinder', ROOT_A, '2026-09-23T09:00:00Z', 'red')],
    dailyByWallet, dailyCap: 5,
  });
  // One grinder maxed out for a day vs two recruits who played nothing.
  const two = scoreTeams({
    qualifications: [
      q('0xr1', ROOT_A, '2026-09-23T09:00:00Z', 'blue'),
      q('0xr2', ROOT_B, '2026-09-23T09:01:00Z', 'blue'),
    ],
    dailyByWallet: new Map(), dailyCap: 5,
  });
  assert.ok(two.teams.blue.score > one.teams.red.score,
    'two verified humans must beat one maxed grinder — recruiting is the point');
});

test('the one-off human bonus is excluded from the daily tick', () => {
  const dailyByWallet = new Map([['0xa', [
    { play_date: '2026-09-23', best: new Map([[2, 20]]) },  // 4 pts
    { play_date: '2026-09-24', best: new Map([[2, 10]]) },  // 2 pts
  ]]]);
  const quals = [q('0xa', ROOT_A, '2026-09-23T09:00:00Z', 'red')];
  const cumulative = scoreTeams({ qualifications: quals, dailyByWallet, dailyCap: 5 });
  const today = scoreTeams({ qualifications: quals, dailyByWallet, dailyCap: 5, onlyDate: '2026-09-24' });
  assert.equal(cumulative.teams.red.score, POINTS_PER_QUALIFIED_HUMAN + 6);
  assert.equal(today.teams.red.score, 2, 'daily view must be today-only effort');
});

// ── Rope ─────────────────────────────────────────────────────────────────────
test('rope is centred at a tie and signed toward the leader', () => {
  assert.equal(ropeOffset(100, 100), 0);
  assert.ok(ropeOffset(200, 100) > 0);
  assert.ok(ropeOffset(100, 200) < 0);
});

test('a small lead still moves the rope visibly (not a linear map)', () => {
  // 55/45 is a 10% relative lead. Linear would be 14px of 140 — reads as a tie.
  const off = Math.abs(ropeOffset(55, 45, 140));
  assert.ok(off > 40, `expected clearly visible movement, got ${off.toFixed(1)}px`);
});

test('rope pins at the disclosed cap and never exceeds maxPx', () => {
  const atCap = Math.abs(ropeOffset(1000 * (1 + ROPE_CAP), 1000 * (1 - ROPE_CAP), 140));
  assert.ok(Math.abs(atCap - 140) < 1, `should pin at the cap, got ${atCap.toFixed(1)}`);
  assert.ok(Math.abs(ropeOffset(1_000_000, 1, 140)) <= 140, 'never overshoot the track');
});

test('rope handles an empty event without NaN', () => {
  assert.equal(ropeOffset(0, 0), 0);
});

// ── Bounty ───────────────────────────────────────────────────────────────────
test('bounty is team-independent — the losing side can still be paid', () => {
  const rows = [
    q('0xblue1', ROOT_A, '2026-09-23T09:00:00Z', 'blue'),
    q('0xred1',  ROOT_B, '2026-09-23T09:05:00Z', 'red'),
  ];
  const winners = bountyWinners(rows, 2).map(w => w.wallet);
  assert.deepEqual(winners, ['0xblue1', '0xred1'],
    'ordering is by qualification time only, team must not matter');
});

test('a sybil fleet cannot take the bounty slots', () => {
  const sybil = Array.from({ length: 200 }, (_, i) =>
    q(`0xf${String(i).padStart(39, '0')}`, ROOT_A, `2026-09-23T09:00:00Z`,
      'red', { qualified_block: 1, qualified_log_idx: i }));
  const real = q('0xreal', ROOT_B, '2026-09-23T11:00:00Z', 'blue');
  const winners = bountyWinners([...sybil, real], 160);
  assert.equal(winners.length, 2, 'the fleet collapses to one seat, leaving room for real players');
  assert.ok(winners.some(w => w.wallet === '0xreal'));
});

test('bounty respects the slot limit', () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    q(`0xw${i}`, `0x${String(i).padStart(40, '0')}`, `2026-09-23T09:0${i}:00Z`));
  assert.equal(bountyWinners(rows, 4).length, 4);
  assert.deepEqual(bountyWinners(rows, 4).map(w => w.rank), [1, 2, 3, 4]);
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — round-two audit findings. Each of these failed before the fix.
// ─────────────────────────────────────────────────────────────────────────────

const { compareQualificationOrder, assertDailyCap } = require('./tugScoring');

// T4 — a NaN comparator made ordering depend on input array order.
test('T4: unparseable qualified_at can no longer decide the bounty order', () => {
  const rows = [
    q('0xB', ROOT_A, 'not-a-date', 'red', { qualified_block: 9, qualified_log_idx: 9 }),
    q('0xA', ROOT_B, 'not-a-date', 'red', { qualified_block: 1, qualified_log_idx: 0 }),
  ];
  // Ordering now comes from on-chain position, so the timestamp is irrelevant.
  assert.equal(bountyWinners(rows, 1)[0].wallet, '0xA');
  assert.equal(bountyWinners([...rows].reverse(), 1)[0].wallet, '0xA');
});

test('T4: missing on-chain position throws instead of mis-ranking silently', () => {
  const rows = [
    q('0xA', ROOT_A, '2026-09-23T09:00:00Z', 'red', { qualified_block: undefined }),
    q('0xB', ROOT_B, '2026-09-23T09:00:00Z'),
  ];
  assert.throws(() => bountyWinners(rows, 1), /qualified_block/);
});

// T19.2 — the property the whole module exists to guarantee.
test('T19: dedupe is invariant under input permutation (100 shuffles)', () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    q(`0xw${String(i).padStart(4, '0')}`, `0x${String(i % 7).padStart(40, '0')}`,
      '2026-09-23T09:00:00Z', i % 2 ? 'red' : 'blue',
      { qualified_block: 100 + (i % 5), qualified_log_idx: i }));
  const expected = JSON.stringify(bountyWinners(rows, 10));
  for (let n = 0; n < 100; n++) {
    const shuffled = [...rows];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    assert.equal(JSON.stringify(bountyWinners(shuffled, 10)), expected,
      `permutation ${n} produced a different winner list`);
  }
});

// T5 — locale collation made the final tiebreak machine-dependent.
test('T5: wallet tiebreak is byte order, not locale collation', () => {
  const a = { wallet: '0xAbC0000000000000000000000000000000000001', qualified_block: 1, qualified_log_idx: 0 };
  const b = { wallet: '0xabb0000000000000000000000000000000000002', qualified_block: 1, qualified_log_idx: 0 };
  // lowercased byte order: 'abb…' < 'abc…', so b sorts first. localeCompare disagreed.
  assert.ok(compareQualificationOrder(a, b) > 0);
  assert.ok(compareQualificationOrder(b, a) < 0);
});

// T6 — slice(0, undefined) paid everyone; slice(0, null) paid nobody.
test('T6: a bad bounty slot count throws rather than producing a payout list', () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    q(`0xw${i}`, `0x${String(i).padStart(40, '0')}`, '2026-09-23T09:00:00Z',
      'red', { qualified_block: i, qualified_log_idx: 0 }));
  for (const bad of [undefined, null, 0, -1, 2.5, 'abc', NaN]) {
    assert.throws(() => bountyWinners(rows, bad), /bad bounty slots/, `slots=${String(bad)}`);
  }
  assert.equal(bountyWinners(rows, 4).length, 4);
});

// T7 — the same wallet twice under one root was counted as two humans.
test('T7: a repeated wallet under one root takes exactly one seat', () => {
  const dup = [
    q('0xa', ROOT_A, '2026-09-23T09:00:00Z', 'red', { qualified_block: 1, qualified_log_idx: 0 }),
    q('0xa', ROOT_A, '2026-09-23T10:00:00Z', 'red', { qualified_block: 2, qualified_log_idx: 0 }),
  ];
  const s = scoreTeams({ qualifications: dup, dailyByWallet: new Map(), dailyCap: 5 });
  assert.equal(s.teams.red.humans, 1);
  assert.equal(s.teams.red.score, POINTS_PER_QUALIFIED_HUMAN);
});

test('T7: mixed-case wallets under one root take exactly one seat', () => {
  const dup = [
    q('0xAAaa', ROOT_A, '2026-09-23T09:00:00Z', 'red', { qualified_block: 1, qualified_log_idx: 0 }),
    q('0xaaaa', ROOT_A, '2026-09-23T10:00:00Z', 'red', { qualified_block: 2, qualified_log_idx: 0 }),
  ];
  assert.equal(dedupeByIdentityRoot(dup).filter(r => r.counted).length, 1);
});

// T8 — a missing cap silently zeroed or NaN'd the entire event.
test('T8: a bad dailyCap throws instead of silently zeroing every pull', () => {
  for (const bad of [null, undefined, 0, -1, 2.5, NaN]) {
    assert.throws(() => playPulls([{ play_date: 'd', games: 3 }], bad), /bad dailyCap/);
    assert.throws(() => assertDailyCap(bad), /bad dailyCap/);
  }
});

test('T8: ropeOffset never emits NaN into a CSS transform', () => {
  for (const [r, b] of [[NaN, 5], [5, NaN], [undefined, 5], [-5, -5]]) {
    const v = ropeOffset(r, b, 140);
    assert.ok(Number.isFinite(v), `ropeOffset(${r},${b}) = ${v}`);
  }
});

// T9 — a row dropped for a bad team carried no reason.
test('T9: a row dropped for an invalid team says why', () => {
  const s = scoreTeams({
    qualifications: [q('0xa', ROOT_A, '2026-09-23T09:00:00Z', 'Red')], // wrong case
    dailyByWallet: new Map(), dailyCap: 5,
  });
  assert.equal(s.teams.red.humans, 0);
  assert.equal(s.players[0].reason, 'invalid_team');
});

// T10 — the rope pinned at an ordinary team split.
test('T10: an ordinary team imbalance does not pin the rope', () => {
  // 65 vs 39 humans is a realistic split for ~100 verified players.
  const off = Math.abs(ropeOffset(65 * 10, 39 * 10, 140));
  assert.ok(off < 139, `65/39 should still have travel, got ${off.toFixed(1)}px`);
  // The extreme still pins.
  assert.ok(Math.abs(ropeOffset(1000, 1, 140)) > 139);
});

// T19.10 — the one boundary with money attached.
test('T19: the #160 / #161 boundary is exact and re-derivable', () => {
  // Roots start at 1: String(0).padStart(40,'0') IS the zero address, which the
  // engine correctly refuses to seat.
  const rows = Array.from({ length: 161 }, (_, i) =>
    q(`0xw${String(i).padStart(4, '0')}`, `0x${String(i + 1).padStart(40, '0')}`,
      '2026-09-23T09:00:00Z', 'red', { qualified_block: 1000 + i, qualified_log_idx: 0 }));
  const winners = bountyWinners(rows, 160);
  assert.equal(winners.length, 160);
  assert.equal(winners[159].wallet, '0xw0159', 'the 160th seat');
  assert.ok(!winners.some(w => w.wallet === '0xw0160'), '#161 must not be paid');
  // Same answer from shuffled input.
  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  assert.equal(bountyWinners(shuffled, 160)[159].wallet, '0xw0159');
});


test('T19: a root that pads to the zero address is never seated', () => {
  const rows = [
    q('0xzero', '0x0000000000000000000000000000000000000000', '2026-09-23T09:00:00Z',
      'red', { qualified_block: 1, qualified_log_idx: 0 }),
    q('0xreal', ROOT_A, '2026-09-23T09:00:01Z', 'red', { qualified_block: 2, qualified_log_idx: 0 }),
  ];
  const winners = bountyWinners(rows, 160);
  assert.deepEqual(winners.map(w => w.wallet), ['0xreal']);
});

// ─────────────────────────────────────────────────────────────────────────────
// SKILL SCORING — pulls come from how well you played, not how often you
// pressed start. Counting games was farmable by quitting instantly on repeat.
// ─────────────────────────────────────────────────────────────────────────────

const { dayPoints, GAME_DIVISOR } = require('./tugScoring');

test('quitting instantly earns nothing, however many times you do it', () => {
  // 50 bailed runs: a score below the divisor floors to zero.
  const quitter = [{ play_date: 'd1', best: new Map([[2, 4]]) }];   // stack, divisor 5
  assert.equal(playPulls(quitter, 10), 0, 'sub-divisor scores must earn 0');
});

test('one good run beats fifty bad ones', () => {
  const grinder = [{ play_date: 'd1', best: new Map([[2, 4]]) }];     // 50 quits, best 4
  const player  = [{ play_date: 'd1', best: new Map([[2, 60]]) }];    // one real run
  assert.equal(playPulls(grinder, 10), 0);
  assert.ok(playPulls(player, 10) > 0, 'a real run must pay something');
});

test('only your BEST score that day counts, not the sum of attempts', () => {
  // The caller keeps one best per game per day, so ten mediocre runs cannot add up.
  const best = new Map([[2, 30]]);                 // 30 / 5 = 6
  assert.equal(dayPoints(best), 6);
});

test('each game is normalised by its own divisor', () => {
  assert.equal(dayPoints(new Map([[0, 1000]])), 10); // rhythm  /100
  assert.equal(dayPoints(new Map([[1, 200]])),  10); // simon   /20
  assert.equal(dayPoints(new Map([[2, 50]])),   10); // stack   /5
  assert.deepEqual(GAME_DIVISOR, { 0: 100, 1: 20, 2: 5 });
});

test('playing several games in a day stacks before the cap applies', () => {
  const day = [{ play_date: 'd1', best: new Map([[0, 300], [1, 60], [2, 15]]) }]; // 3+3+3
  assert.equal(playPulls(day, 20), 9, 'under the cap, paid in full');
  const overCap = playPulls(day, 5);
  assert.ok(overCap >= 5 && overCap < 9, `over the cap, reduced but not clipped: got ${overCap}`);
});

test('an unknown game type earns nothing rather than crashing', () => {
  assert.equal(dayPoints(new Map([[99, 100000]])), 0);
});

test('a negative or junk score is ignored', () => {
  assert.equal(dayPoints(new Map([[2, -500], [1, NaN], [0, 'abc']])), 0);
});

test('a row with no scores earns nothing, closing the old count-path hole', () => {
  // The count fallback paid a point per started game. Beside a soft cap that
  // turned 999 quits into 254 points against 20 for two recruits.
  assert.equal(playPulls([{ play_date: 'd1', games: 999 }], 5), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SOFT CAP — a hard clip cancelled out the skill scoring beside it. With a cap
// of 5, a stack score of 25 already maxed the day, so scoring 134 paid the same
// as scraping 25 and the correct play was to hit the cap and stop.
// ─────────────────────────────────────────────────────────────────────────────

const { applySoftCap } = require('./tugScoring');

test('below the cap, every point is paid in full', () => {
  assert.equal(applySoftCap(3, 5), 3);
  assert.equal(applySoftCap(5, 5), 5);
});

test('above the cap, playing better still pays more', () => {
  const scrape = applySoftCap(5, 5);
  const good = applySoftCap(30, 5);
  const great = applySoftCap(38, 5);
  assert.ok(great > good && good > scrape, `${scrape} < ${good} < ${great}`);
});

test('the best real day in live data still pays less than one recruit', () => {
  // This is the guard on the whole event design. 38 raw points is lollyposh's
  // actual best day. If a day of playing ever out-earns bringing a person,
  // nobody recruits and the event stops producing verified players.
  const { tugConfig } = require('./tugEvent');
  const bestRealDay = applySoftCap(38, tugConfig().dailyPullCap);
  assert.ok(bestRealDay < POINTS_PER_QUALIFIED_HUMAN,
    `a top day paid ${bestRealDay}, a recruit pays ${POINTS_PER_QUALIFIED_HUMAN}`);
});

test('the curve flattens rather than running away', () => {
  // Ten times the raw points must not pay anywhere near ten times as much.
  const low = applySoftCap(10, 5);
  const huge = applySoftCap(100, 5);
  assert.ok(huge < low * 5, `${low} -> ${huge} is too steep`);
});

test('zero and junk still earn nothing', () => {
  for (const v of [0, -5, NaN, undefined]) assert.equal(applySoftCap(v, 5), 0);
});

test('an over-rate of 0 reproduces the old hard cap', () => {
  assert.equal(applySoftCap(38, 5, 0), 5);
});

test('playPulls applies the soft cap per day, not across the week', () => {
  const twoBigDays = [
    { play_date: 'd1', best: new Map([[2, 134]]) },
    { play_date: 'd2', best: new Map([[2, 134]]) },
  ];
  const oneBigDay = [{ play_date: 'd1', best: new Map([[2, 134]]) }];
  assert.ok(Math.abs(playPulls(twoBigDays, 5) - playPulls(oneBigDay, 5) * 2) <= 1,
    'a second big day adds about as much as the first, so the limit is daily');
});


test('small daily overages accumulate instead of rounding away', () => {
  // A raw 9 day is 5.48 under the soft cap. Rounding per day made that 5, so a
  // week of them paid 35 instead of 38.
  const week = Array.from({ length: 7 }, (_, i) => ({
    play_date: `d${i}`, best: new Map([[0, 300], [1, 60], [2, 15]]),   // raw 9
  }));
  assert.ok(playPulls(week, 5) > 7 * 5, `a week of above-cap days must beat ${7 * 5}`);
});

test('the human bounty must stay above the daily cap', () => {
  // The invariant the whole event rests on. Play points are paid in full up to
  // dailyPullCap, so if the bounty ever sat at or below the cap, a player who
  // simply maxed a day would match or beat someone who brought a real verified
  // human, recruiting would stop paying and the event would stop growing.
  // Raising TUG_DAILY_PULL_CAP without raising TUG_POINTS_PER_HUMAN is exactly
  // how that happens, so it fails here rather than in production.
  const { tugConfig } = require('./tugEvent');
  const { dailyPullCap } = tugConfig();
  assert.ok(POINTS_PER_QUALIFIED_HUMAN > dailyPullCap,
    `cap ${dailyPullCap} >= bounty ${POINTS_PER_QUALIFIED_HUMAN}: grinding would beat recruiting`);

  // And the realistic top day must lose to one recruit too, not just the cap.
  assert.ok(applySoftCap(38, dailyPullCap) < POINTS_PER_QUALIFIED_HUMAN,
    `a top day pays ${applySoftCap(38, dailyPullCap)} vs ${POINTS_PER_QUALIFIED_HUMAN} for a recruit`);
});
