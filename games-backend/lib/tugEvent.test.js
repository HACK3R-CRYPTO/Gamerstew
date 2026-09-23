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

test('the system balances sides no matter how lopsided the hashes are', () => {
  // The bug this replaced: hashing is 50/50 only in expectation. Live data
  // showed red 0, blue 4.
  for (const n of [1, 2, 3, 4, 5, 17, 60]) {
    const q = sides(Array.from({ length: n }, (_, i) => mk(`0xw${i}`, `0xr${i}`, i)));
    assert.ok(Math.abs(tally(q, 'red') - tally(q, 'blue')) <= 1,
      `${n} players split ${tally(q, 'red')}/${tally(q, 'blue')}`);
  }
});

test('a recruit is NOT dragged onto their recruiter side', () => {
  // 1 recruiter + 10 recruits used to be an 11-0 sweep for one side.
  const boss = mk('0xboss', ROOT_A, 1);
  const recruits = Array.from({ length: 10 }, (_, i) => mk(`0xr${i}`, `0xroot${i}`, 10 + i));
  const referrerOf = new Map(recruits.map((r) => [r.wallet, '0xboss']));
  const q = sides([boss, ...recruits], referrerOf);
  assert.ok(Math.abs(tally(q, 'red') - tally(q, 'blue')) <= 1,
    `expected a balanced split, got ${tally(q, 'red')}/${tally(q, 'blue')}`);
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
  // ...and at least one of them really is playing for the other side.
  assert.ok(q.some((x) => x.wallet !== '0xboss' && x.team !== bossTeam),
    'the balancing should have split them across both sides');
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
