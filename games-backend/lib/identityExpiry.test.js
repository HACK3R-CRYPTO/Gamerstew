const test = require('node:test');
const assert = require('node:assert');
const { computeIdentityExpiry, LEGACY_AUTHCOUNT_CUTOFF } = require('./identityExpiry');

const SCHEDULE = [3, 180]; // live Celo mainnet value
const day = (n) => n * 24 * 3600 * 1000;

// Anchor: a post-upgrade wallet so the legacy branch doesn't apply.
const AUTHED = LEGACY_AUTHCOUNT_CUTOFF + 10 * 86400; // seconds
const AUTHED_MS = AUTHED * 1000;

test('first-ever verification (authCount 0) lasts exactly 3 days', () => {
  const id = { dateAuthenticated: AUTHED, status: 1, authCount: 0 };
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(2)).verified, true);
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(2)).windowDays, 3);
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(4)).verified, false,
    'day 4 must be lapsed — this is the bug players reported');
});

test('second verification (authCount 1) lasts 180 days', () => {
  const id = { dateAuthenticated: AUTHED, status: 1, authCount: 1 };
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(100)).verified, true);
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(181)).verified, false);
});

test('pre-upgrade wallets are grandfathered to the last step, ignoring authCount', () => {
  const id = { dateAuthenticated: LEGACY_AUTHCOUNT_CUTOFF - 86400, status: 1, authCount: 0 };
  const r = computeIdentityExpiry(id, SCHEDULE, (LEGACY_AUTHCOUNT_CUTOFF) * 1000 + day(10));
  assert.equal(r.windowDays, 180, 'legacy wallet must NOT get the 3-day window');
  assert.equal(r.verified, true);
});

test('lapsed is distinguishable from never-verified', () => {
  const lapsed = computeIdentityExpiry(
    { dateAuthenticated: AUTHED, status: 1, authCount: 0 }, SCHEDULE, AUTHED_MS + day(30));
  assert.equal(lapsed.everVerified, true);
  assert.equal(lapsed.verified, false, 'lapsed: verified before, not now');

  const never = computeIdentityExpiry(
    { dateAuthenticated: 0, status: 0, authCount: 0 }, SCHEDULE, Date.now());
  assert.equal(never.everVerified, false);
  assert.equal(never.verified, false);
});

test('daysLeft drives the warning window', () => {
  const id = { dateAuthenticated: AUTHED, status: 1, authCount: 0 };
  // ~26h before expiry → 2 days left (ceil); ~20h before → 1.
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(3) - 26 * 3600e3).daysLeft, 2);
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(3) - 20 * 3600e3).daysLeft, 1);
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(5)).daysLeft, 0);
});

test('an authCount past the end of the schedule clamps instead of returning undefined', () => {
  const id = { dateAuthenticated: AUTHED, status: 1, authCount: 7 };
  const r = computeIdentityExpiry(id, SCHEDULE, AUTHED_MS);
  assert.equal(r.windowDays, 180);
  assert.ok(Number.isFinite(r.daysLeft));
});

test('empty or missing schedule fails safe rather than throwing', () => {
  const id = { dateAuthenticated: AUTHED, status: 1, authCount: 0 };
  assert.equal(computeIdentityExpiry(id, [], AUTHED_MS).verified, false);
  assert.equal(computeIdentityExpiry(id, null, AUTHED_MS).verified, false);
});

test('accepts bigint fields as returned by ethers', () => {
  const id = { dateAuthenticated: BigInt(AUTHED), status: 1n, authCount: 0n };
  assert.equal(computeIdentityExpiry(id, SCHEDULE, AUTHED_MS + day(1)).verified, true);
});
