// ─── GoodDollar identity expiry ──────────────────────────────────────────────
// Verified against the deployed IdentityV4 implementation
// (0x0ecc03f4E3fa94fa6e2098428A3ad393b65933c9, behind proxy
// 0xC361A6E67822a0EDc17D899227dd9FC50BD62F42) on Celo mainnet:
//
//   isWhitelisted(a) = identities[a].status == 1
//                      && daysSince(dateAuthenticated) < reverifyDaysOptions[authCount]
//
// `authenticationPeriod()` looks like the answer but is DEPRECATED — the
// contract stores it as `unused_authenticationPeriod` and the getter simply
// returns the last entry of the schedule. Using it tells an authCount-0 wallet
// it has 180 days when it really has 3.
//
// On Celo mainnet reverifyDaysOptions == [3, 180]. So a player's FIRST-EVER
// verification lapses after THREE DAYS; re-verifying bumps authCount to 1 and
// buys 180. Wallets authenticated before the V4 upgrade are grandfathered onto
// the last step.
//
// This is why players reported verifying and then being told days later that
// they were not verified. It was never a client bug.

const LEGACY_AUTHCOUNT_CUTOFF = 1772697574; // 2026-03-05, the V4 upgrade point
const DAY_MS = 24 * 3600 * 1000;

/**
 * @param {{dateAuthenticated:bigint|number, status:number|bigint, authCount:number|bigint}} identity
 * @param {number[]} reverifyDaysOptions  on-chain schedule, e.g. [3, 180]
 * @param {number} nowMs
 */
function computeIdentityExpiry(identity, reverifyDaysOptions, nowMs = Date.now()) {
  const authedAt = Number(identity.dateAuthenticated || 0);
  const status = Number(identity.status || 0);
  const rawAuthCount = Number(identity.authCount || 0);

  if (!Array.isArray(reverifyDaysOptions) || reverifyDaysOptions.length === 0) {
    return { everVerified: false, verified: false, expiresAt: null, daysLeft: 0, windowDays: null };
  }
  const everVerified = status === 1 || authedAt > 0;
  if (!everVerified || authedAt === 0) {
    return { everVerified, verified: false, expiresAt: null, daysLeft: 0, windowDays: null };
  }

  // Grandfathering: wallets authenticated before the upgrade start at the LAST
  // step of the schedule, not at their stored authCount.
  const idx = authedAt < LEGACY_AUTHCOUNT_CUTOFF
    ? reverifyDaysOptions.length - 1
    : Math.min(rawAuthCount, reverifyDaysOptions.length - 1);
  const windowDays = Number(reverifyDaysOptions[idx]);

  const expiresAtMs = authedAt * 1000 + windowDays * DAY_MS;
  const verified = status === 1 && nowMs < expiresAtMs;
  const daysLeft = Math.max(0, Math.ceil((expiresAtMs - nowMs) / DAY_MS));

  return { everVerified, verified, expiresAt: new Date(expiresAtMs), daysLeft, windowDays };
}

module.exports = { computeIdentityExpiry, LEGACY_AUTHCOUNT_CUTOFF, DAY_MS };
