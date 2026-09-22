const test = require('node:test');
const assert = require('node:assert');
const { assignTeam, resolveTeam } = require('./tugEvent');

const ROOT_A = '0xaaa1000000000000000000000000000000000001';
const ROOT_B = '0xbbb2000000000000000000000000000000000002';

test('a player with no recruiter gets a side from their own identity', () => {
  const t = resolveTeam('0xme', ROOT_A, new Map(), new Map());
  assert.equal(t, assignTeam(ROOT_A));
});

test('a recruit lands on their RECRUITER side, not their own hash', () => {
  // Pick a root whose own hash differs from the recruiter's, so the test proves
  // inheritance rather than passing by coincidence.
  let recruitRoot = null;
  for (let i = 0; i < 500; i++) {
    const cand = '0xccc' + String(i).padStart(37, '0');
    if (assignTeam(cand) !== assignTeam(ROOT_A)) { recruitRoot = cand; break; }
  }
  assert.ok(recruitRoot, 'needed a root that differs');
  const referrerOf = new Map([['0xrecruit', '0xboss']]);
  const rootOf = new Map([['0xboss', ROOT_A], ['0xrecruit', recruitRoot]]);
  assert.notEqual(assignTeam(recruitRoot), assignTeam(ROOT_A), 'precondition');
  assert.equal(resolveTeam('0xrecruit', recruitRoot, referrerOf, rootOf), assignTeam(ROOT_A));
});

test('a referral chain follows all the way to the top', () => {
  const referrerOf = new Map([['0xc', '0xb'], ['0xb', '0xa']]);
  const rootOf = new Map([['0xa', ROOT_A], ['0xb', ROOT_B], ['0xc', ROOT_B]]);
  assert.equal(resolveTeam('0xc', ROOT_B, referrerOf, rootOf), assignTeam(ROOT_A));
});

test('a referral CYCLE terminates instead of hanging the rebuild', () => {
  const referrerOf = new Map([['0xa', '0xb'], ['0xb', '0xa']]);
  const rootOf = new Map([['0xa', ROOT_A], ['0xb', ROOT_B]]);
  const t = resolveTeam('0xa', ROOT_A, referrerOf, rootOf);
  assert.ok(t === 'red' || t === 'blue');
});

test('an unknown or unverified referrer cannot lend a side they do not have', () => {
  const referrerOf = new Map([['0xme', '0xghost']]);   // ghost has no root
  assert.equal(resolveTeam('0xme', ROOT_A, referrerOf, new Map()), assignTeam(ROOT_A));
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
