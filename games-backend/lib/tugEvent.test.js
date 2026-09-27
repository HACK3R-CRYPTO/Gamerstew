const test = require('node:test');
const assert = require('node:assert');
const { assignTeam, assignSides } = require('./tugEvent');
const { compareQualificationOrder } = require('./tugScoring');

const mk = (w, root, block) => ({ wallet: w, identity_root: root, qualified_block: block, qualified_log_idx: 0 });
const sides = (quals, referrerOf = new Map()) =>
  assignSides(quals, referrerOf, compareQualificationOrder);
const tally = (q, s) => q.filter((x) => x.team === s).length;

const ROOT_A = '0xaaa1000000000000000000000000000000000001';
const ROOT_B = '0xbbb2000000000000000000000000000000000002';

test('team assignment is a stable pure function of identity, not a balance', () => {
  // The greedy balance that used to enforce |red-blue|<=1 was abandoned: it
  // made a player's side depend on everyone else in the set, so a dropout
  // reshuffled the field. Team is now assignTeam(identity_root) — the same
  // answer regardless of who else is present. It is only roughly balanced, and
  // that is the deliberate trade for never moving anyone.
  const roots = Array.from({ length: 200 }, (_, i) => `0xr${i}`);
  // same identity -> same team, no matter the surrounding set or order
  const a = sides(roots.map((r, i) => mk(`0xw${i}`, r, i)));
  const b = sides(roots.map((r, i) => mk(`0xw${i}`, r, i)).reverse());
  const teamA = new Map(a.map((x) => [x.wallet, x.team]));
  for (const x of b) assert.equal(x.team, teamA.get(x.wallet), 'same identity must always get the same team');
  // roughly balanced over many identities (not enforced, just checked loosely)
  const red = a.filter((x) => x.team === 'red').length;
  assert.ok(red > 70 && red < 130, `200 identities split ${red}/${200 - red} — hash should be near even`);
});

test('a recruit is NOT dragged onto their recruiter side', () => {
  // A recruit's TEAM is decided by their own identity hash, never inherited
  // from the recruiter. (The recruiter is paid via bounty_team instead.)
  const boss = mk('0xboss', ROOT_A, 1);
  const recruits = Array.from({ length: 10 }, (_, i) => mk(`0xr${i}`, `0xroot${i}`, 10 + i));
  const referrerOf = new Map(recruits.map((r) => [r.wallet, '0xboss']));
  const q = sides([boss, ...recruits], referrerOf);
  for (const r of recruits) {
    const row = q.find((x) => x.wallet === r.wallet);
    assert.equal(row.team, assignTeam(r.identity_root), 'recruit team must be their own hash, not the recruiter\'s');
  }
});

test('a recruit bounty is credited to the RECRUITER side, not their own', () => {
  const boss = mk('0xboss', ROOT_A, 1);
  const recruits = Array.from({ length: 6 }, (_, i) => mk(`0xr${i}`, `0xroot${i}`, 10 + i));
  const referrerOf = new Map(recruits.map((r) => [r.wallet, '0xboss']));
  const q = sides([boss, ...recruits], referrerOf);
  const bossTeam = q.find((x) => x.wallet === '0xboss').team;
  for (const r of recruits) {
    assert.equal(q.find((x) => x.wallet === r.wallet).bounty_team, bossTeam);
  }
  // bounty always credits the recruiter's side, even for recruits whose own
  // hash puts them on the other team.
  const crossTeam = q.filter((x) => x.wallet !== '0xboss' && x.team !== bossTeam);
  for (const x of crossTeam) assert.equal(x.bounty_team, bossTeam);
});

test('a recruit who qualifies BEFORE their recruiter still pays the recruiter', () => {
  const q = sides([mk('0xrecruit', ROOT_B, 1), mk('0xboss', ROOT_A, 99)],
    new Map([['0xrecruit', '0xboss']]));
  assert.equal(q.find((x) => x.wallet === '0xrecruit').bounty_team,
    q.find((x) => x.wallet === '0xboss').team);
});

test('an unqualified recruiter has no side to lend, so the bounty stays put', () => {
  const q = sides([mk('0xme', ROOT_A, 1)], new Map([['0xme', '0xghost']]));
  const me = q.find((x) => x.wallet === '0xme');
  assert.equal(me.bounty_team, me.team);
});

test('a referral CYCLE terminates instead of hanging the rebuild', () => {
  const q = sides([mk('0xa', ROOT_A, 1), mk('0xb', ROOT_B, 2)],
    new Map([['0xa', '0xb'], ['0xb', '0xa']]));
  for (const x of q) assert.ok(x.bounty_team === 'red' || x.bounty_team === 'blue');
});

test('a player NEVER changes team when later players join', () => {
  // Teams are shown live and carry prize money, so a mid-event swap would be
  // read as the event being rigged.
  const grow = (n) => sides(Array.from({ length: n }, (_, i) => mk(`0xw${i}`, `0xr${i}`, i)));
  let prev = new Map(grow(1).map((x) => [x.wallet, x.team]));
  for (let n = 2; n <= 40; n++) {
    const now = grow(n);
    for (const x of now) {
      if (prev.has(x.wallet)) {
        assert.equal(x.team, prev.get(x.wallet), `${x.wallet} moved when player ${n} joined`);
      }
    }
    prev = new Map(now.map((x) => [x.wallet, x.team]));
  }
});

test('assignment is deterministic regardless of input row order', () => {
  const rows = () => Array.from({ length: 25 }, (_, i) => mk(`0xw${i}`, `0xr${i}`, i));
  const a = sides(rows());
  const b = sides(rows().reverse());
  for (const x of a) assert.equal(b.find((y) => y.wallet === x.wallet).team, x.team);
});

test('sides are stable and split roughly evenly across identities', () => {
  let red = 0;
  for (let i = 0; i < 1000; i++) {
    const root = '0xdd' + String(i).padStart(38, '0');
    if (assignTeam(root) === 'red') red++;
    assert.equal(assignTeam(root), assignTeam(root.toUpperCase()), 'must be case-stable');
  }
  assert.ok(red > 400 && red < 600, `expected a near-even split, got ${red}/1000 red`);
});

test('the recruiter board counts real recruits, not zero', () => {
  // REGRESSION. dedupeByIdentityRoot returns NEW rows carrying `counted`; it
  // never mutates the rows handed to it. The board used to loop over the raw
  // qualification rows and test q.counted, which was undefined on every one, so
  // it skipped all of them and reported 0 entrants for the whole event while
  // real recruits were being brought in. A live recruiter with 4 verified,
  // qualified recruits showed as 0 recruited.
  const now = Date.parse('2026-09-23T20:00:00Z');
  const cfg = { ...require('./tugEvent').tugConfig(),
    startsAt: '2026-09-23T17:00:00Z', endsAt: '2026-09-30T17:00:00Z' };

  const ts = Math.floor(Date.parse('2026-09-23T18:00:00Z') / 1000);
  const player = (w, n) => ({ id: w, username: n });
  const scores = [];
  let sid = 0;
  // A recruiter plus three recruits, each with enough real runs to qualify.
  for (const [w, name] of [['0xboss', 'Boss'], ['0xr1', 'R1'], ['0xr2', 'R2'], ['0xr3', 'R3']]) {
    for (let i = 0; i < 4; i++) {
      scores.push({ id: `s${sid++}`, blockTimestamp: String(ts + sid),
        gameType: 2, score: 60, player: player(w, name) });
    }
  }
  const deps = {
    subgraph: { gql: async (_q, v) => (Number(v.gte) <= ts ? { scores } : { scores: [] }) },
    isVerified: async () => true,
    identityRootOf: async (w) => w,                 // one human per wallet
    mapLimit: async (items, _n, fn) => { const o = []; for (const x of items) o.push(await fn(x)); return o; },
    referrerMap: async () => new Map([['0xr1', '0xboss'], ['0xr2', '0xboss'], ['0xr3', '0xboss']]),
  };

  return require('./tugEvent').buildStandings(deps, cfg, now).then((r) => {
    assert.equal(r.standings.referral.entrants, 1, 'the recruiter must appear on the board');
    assert.equal(r.standings.referral.top[0].recruits, 3, 'all three recruits must count');
    assert.equal(r.standings.referral.top[0].name, 'Boss');
  });
});

test('playing more games never moves anyone between teams', () => {
  // REGRESSION, reported by a player who was Red at 8pm and Blue at 10pm
  // without doing anything. The ordering key used to be the wallet's running
  // game count, so any player finishing a game re-sorted the whole field and
  // the balancer reassigned sides over the new order.
  const now = Date.parse('2026-09-23T22:00:00Z');
  const base = require('./tugEvent').tugConfig();
  const cfg = { ...base, startsAt: '2026-09-23T17:00:00Z', endsAt: '2026-09-30T17:00:00Z' };
  const t0 = Math.floor(Date.parse('2026-09-23T17:30:00Z') / 1000);

  // Five players qualify in a fixed order. `grinder` then plays far more games
  // than anyone else, which is exactly what used to shuffle the field.
  const build = (grinderExtraGames) => {
    const scores = [];
    let id = 0;
    const names = ['ann', 'ben', 'cal', 'dee', 'grinder'];
    names.forEach((w, i) => {
      const runs = w === 'grinder' ? 3 + grinderExtraGames : 3;
      for (let k = 0; k < runs; k++) {
        // Qualifying runs stay at their original times; extra runs come later,
        // so nobody's qualification moment changes.
        const ts = k < 3 ? t0 + i * 60 + k : t0 + 3600 + k;
        scores.push({ id: `s${id++}`, blockTimestamp: String(ts),
          gameType: 2, score: 50, player: { id: `0x${w}`, username: w } });
      }
    });
    scores.sort((a, b) => Number(a.blockTimestamp) - Number(b.blockTimestamp));
    return {
      subgraph: { gql: async (_q, v) => ({ scores: scores.filter((s) =>
        Number(s.blockTimestamp) >= Number(v.gte) && Number(s.blockTimestamp) <= Number(v.end)) }) },
      isVerified: async () => true,
      identityRootOf: async (w) => w,
      mapLimit: async (items, _n, fn) => { const o = []; for (const x of items) o.push(await fn(x)); return o; },
      referrerMap: async () => new Map(),
    };
  };

  const teamsFor = (extra) => require('./tugEvent')
    .buildStandings(build(extra), cfg, now)
    .then((r) => new Map(r.players.map((p) => [p.wallet, p.team])));

  return teamsFor(0).then((before) =>
    Promise.all([teamsFor(10), teamsFor(40), teamsFor(120)]).then((afters) => {
      for (const after of afters) {
        for (const [w, team] of before) {
          assert.equal(after.get(w), team, `${w} changed team because another player kept playing`);
        }
      }
      // And the sides must still be balanced.
      const red = [...before.values()].filter((t) => t === 'red').length;
      assert.ok(Math.abs(red - (before.size - red)) <= 1, 'sides must stay level');
    }));
});

test('a player NEVER changes team when OTHER players leave the qualified set', () => {
  // REGRESSION. Verification lapses on the GoodDollar 3-day window, so players
  // drop OUT of the qualified set mid-event. The old greedy balance reassigned
  // every downstream player when that happened; a teammate with real points was
  // flipped to the other team. Team must depend only on the player's own
  // identity, never on who else is currently qualified.
  const now = Date.parse('2026-09-26T20:00:00Z');
  const cfg = { ...require('./tugEvent').tugConfig(),
    startsAt: '2026-09-23T17:00:00Z', endsAt: '2026-09-30T17:00:00Z' };
  const t0 = Math.floor(Date.parse('2026-09-24T00:00:00Z') / 1000);

  const build = (verifiedSet) => {
    const names = ['ann', 'ben', 'cal', 'dee', 'eve', 'fin', 'gus', 'hal'];
    const scores = [];
    let sid = 0;
    names.forEach((w, i) => {
      for (let k = 0; k < 3; k++) scores.push({ id: `s${sid++}`, blockTimestamp: String(t0 + i * 60 + k), gameType: 2, score: 50, player: { id: `0x${w}`, username: w } });
    });
    return {
      subgraph: { gql: async (_q, v) => ({ scores: scores.filter((s) => Number(s.blockTimestamp) >= Number(v.gte) && Number(s.blockTimestamp) <= Number(v.end)) }) },
      isVerified: async (w) => verifiedSet.has(w.toLowerCase()),
      identityRootOf: async (w) => w,
      mapLimit: async (items, _n, fn) => { const o = []; for (const x of items) o.push(await fn(x)); return o; },
      referrerMap: async () => new Map(),
    };
  };

  const all = new Set(['0xann', '0xben', '0xcal', '0xdee', '0xeve', '0xfin', '0xgus', '0xhal']);
  const teamsFor = (verified) => require('./tugEvent').buildStandings(build(verified), cfg, now)
    .then((r) => new Map(r.players.filter((p) => p.counted).map((p) => [p.wallet, p.team])));

  return teamsFor(all).then((before) => {
    // ann and cal lose verification and drop out.
    const reduced = new Set([...all].filter((w) => w !== '0xann' && w !== '0xcal'));
    return teamsFor(reduced).then((after) => {
      for (const [w, team] of after) {
        assert.equal(team, before.get(w), `${w} changed team when others dropped out`);
      }
    });
  });
});

test('a recruit who verified and played still counts after their verification lapses', () => {
  // REGRESSION. A top recruiter's count fell 10 -> 7 because 3 recruits who
  // verified and played (one 199 games) let their verification lapse on the
  // 3-day window and dropped out of the current-verified set. Recruit credit
  // must persist on "ever verified" (permanent lastAuthenticated).
  const now = Date.parse('2026-09-26T20:00:00Z');
  const cfg = { ...require('./tugEvent').tugConfig(), startsAt: '2026-09-23T17:00:00Z', endsAt: '2026-09-30T17:00:00Z' };
  const t0 = Math.floor(Date.parse('2026-09-24T00:00:00Z') / 1000);
  const players = ['0xboss', '0xr1', '0xr2', '0xr3'];
  const scores = [];
  let sid = 0;
  players.forEach((w, i) => { for (let k = 0; k < 4; k++) scores.push({ id: `s${sid++}`, blockTimestamp: String(t0 + i * 60 + k), gameType: 2, score: 50, player: { id: w, username: w.slice(2) } }); });

  // r2 and r3 have LAPSED: not currently verified, but everVerified true.
  const currentlyVerified = new Set(['0xboss', '0xr1']);
  const everVerifiedSet = new Set(['0xboss', '0xr1', '0xr2', '0xr3']);
  const deps = {
    subgraph: { gql: async (_q, v) => ({ scores: scores.filter((s) => Number(s.blockTimestamp) >= Number(v.gte) && Number(s.blockTimestamp) <= Number(v.end)) }) },
    isVerified: async (w) => currentlyVerified.has(w.toLowerCase()),
    identityRootOf: async (w) => (currentlyVerified.has(w.toLowerCase()) ? w : null),
    everVerified: async (w) => everVerifiedSet.has(w.toLowerCase()),
    mapLimit: async (items, _n, fn) => { const o = []; for (const x of items) o.push(await fn(x)); return o; },
    referrerMap: async () => new Map([['0xr1', '0xboss'], ['0xr2', '0xboss'], ['0xr3', '0xboss']]),
  };
  return require('./tugEvent').buildStandings(deps, cfg, now).then((r) => {
    const boss = r.standings.referral.top.find((t) => t.name === 'boss');
    assert.ok(boss, 'the recruiter must be on the board');
    assert.equal(boss.recruits, 3, 'all 3 recruits count, including the 2 whose verification lapsed');
  });
});

test('new joiners fill the smaller side while stored players never move', () => {
  // The balance-without-flipping contract: stored teams are the anchor (nobody
  // moves), and a player with no stored team goes to whichever side is smaller.
  const mk2 = (w, root, block) => ({ wallet: w, identity_root: root, qualified_block: block, qualified_log_idx: 0 });
  const { compareQualificationOrder } = require('./tugScoring');
  const { assignSides } = require('./tugEvent');

  // Stored: 5 red, 2 blue (lopsided, like the live 30/25).
  const stored = new Map([['0xa', 'red'], ['0xb', 'red'], ['0xc', 'red'], ['0xd', 'red'], ['0xe', 'red'], ['0xf', 'blue'], ['0xg', 'blue']]);
  // Field = the 7 stored + 4 brand-new joiners.
  const quals = [
    ...[...stored.keys()].map((w, i) => mk2(w, `0xr${w}`, i)),
    ...['0xn1', '0xn2', '0xn3', '0xn4'].map((w, i) => mk2(w, `0xroot${w}`, 100 + i)),
  ];
  const newAssign = [];
  assignSides(quals, new Map(), compareQualificationOrder, stored, newAssign);
  const teamOf = new Map(quals.map((q) => [q.wallet, q.team]));

  // stored players unchanged
  for (const [w, t] of stored) assert.equal(teamOf.get(w), t, `${w} must keep its stored team`);
  // the 4 new joiners all filled blue (the smaller side)
  const newTeams = ['0xn1', '0xn2', '0xn3', '0xn4'].map((w) => teamOf.get(w));
  assert.deepEqual(newTeams, ['blue', 'blue', 'blue', 'red'], 'new joiners fill blue until it catches red, then alternate');
  // and only the new ones were queued to persist
  assert.equal(newAssign.length, 4);
  // final split is now even-ish: 6 red / 5 blue
  const red = [...teamOf.values()].filter((t) => t === 'red').length;
  assert.equal(red, 6);
});
