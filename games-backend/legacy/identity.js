// ─── identity ─────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── GoodDollar identity verification (cached) ──
function* (core) {
  Object.defineProperties(core, {
    mapLimit: { get: () => mapLimit, enumerable: true, configurable: true },
    isVerified: { get: () => isVerified, enumerable: true, configurable: true },
    isVerifiedStrict: { get: () => isVerifiedStrict, enumerable: true, configurable: true },
    identityRootOf: { get: () => identityRootOf, enumerable: true, configurable: true },
    everVerified: { get: () => everVerified, enumerable: true, configurable: true },
    _gdIdentity: { get: () => _gdIdentity, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── GoodDollar identity verification (cached) ───────────────────────────────
// The community pool pays VERIFIED players only; unverified players are skipped
// (stops the task-group farmers who play but never verify from taking money).
//
// Two things this MUST get right, both learned the hard way:
//
// 1. THE GATE IS isWhitelisted, NOT getWhitelistedRoot. This was briefly the
//    other way round, on the reasoning that getWhitelistedRoot also resolves a
//    wallet the player LINKED to their identity and so matches the frontend
//    badge. That is a hole. getWhitelistedRoot(a) is
//    `isWhitelisted(a) ? a : isWhitelisted(connectedAccounts[a]) ? ... : 0`,
//    and `connectAccount(address)` on IdentityV4 is permissionless: a verified
//    attacker can claim ANY address that is not currently whitelisted, with no
//    signature or consent from its owner. So a resolved root proves only that
//    SOMEBODY vouched for the address — possibly against its owner's interest.
//    Measured on the live population: 649 of 752 player wallets are claimable
//    that way right now. Gating on the root would let one attacker mark all of
//    them as "verified" under a single identity, and then (with root dedupe)
//    collapse every real player into a duplicate of themselves.
//    getWhitelistedRoot stays — but ONLY as the dedupe key (identityRootOf),
//    never as the gate.
//
// 2. Verification is NOT sticky. IdentityV4 expires it on a graduated
//    schedule (reverifyDaysOptions, currently [3, 180] on Celo mainnet): a
//    player's FIRST-EVER verification lapses after THREE DAYS, and only the
//    second one buys 180. This cache used to keep `true` forever on that
//    wrong assumption, which meant lapsed wallets kept passing the pool gate
//    until the process restarted. Both outcomes are now time-bounded.
const GD_IDENTITY_ADDR = '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42';
const _gdIdentity = core.provider
  ? new core.ethers.Contract(
      GD_IDENTITY_ADDR,
      [
        'function isWhitelisted(address) view returns (bool)',
        'function getWhitelistedRoot(address) view returns (address)',
        'function identities(address) view returns (uint256 dateAuthenticated, uint256 dateAdded, string did, uint256 whitelistedOnChainId, uint8 status, uint32 authCount)',
        'function reverifyDaysOptions(uint256) view returns (uint32)',
        'function lastAuthenticated(address) view returns (uint256)',
      ],
      core.provider,
    )
  : null;
const _verifiedCache = new Map(); // wallet -> { verified, at }
const VERIFIED_FALSE_TTL_MS = 10 * 60 * 1000;   // a just-verified wallet shows up soon
const VERIFIED_TRUE_TTL_MS = 60 * 60 * 1000;    // bounded: verification can lapse
async function isVerified(wallet) {
  if (!_gdIdentity || !wallet) return false;
  const w = String(wallet).toLowerCase();
  const c = _verifiedCache.get(w);
  if (c) {
    const ttl = c.verified ? VERIFIED_TRUE_TTL_MS : VERIFIED_FALSE_TTL_MS;
    if (Date.now() - c.at < ttl) return c.verified;
  }
  try {
    // Self-verification only. See the note above: a resolved root is not proof
    // that THIS wallet's owner ever passed a face check.
    const v = await _gdIdentity.isWhitelisted(w);
    _verifiedCache.set(w, { verified: v, at: Date.now() });
    return v;
  } catch {
    return c ? c.verified : false; // best-effort: keep last known, else treat unverified
  }
}

// The same question, for the admin dashboard's record of who is verified. It
// asks the chain every time and THROWS when the chain cannot answer, so a
// failed read is never written down as "not verified".
// The whole answer, for the admin dashboard. GoodDollar verification is a
// repeating ladder (reverifyDaysOptions, [3, 180] on Celo): a fresh
// verification lasts three days, the next one 180, then it wraps round. So a
// wallet is one of four things, and "not whitelisted" alone cannot tell two of
// them apart:
//   verified     whitelisted now, by itself or through a wallet it is linked to
//   lapsed       it passed the face check and the window has run out
//   none         it never did
//   blacklisted
// Wallets authenticated before TEMP_EXCLUSION_TS were placed straight on the
// last rung by the contract. Method after the GoodDrops dapp's identity module.
// Throws when the chain cannot answer, so a failed read is never stored as a state.
const TEMP_EXCLUSION_TS = 1772697574;
let _rungs = null;
async function identityRungs() {
  if (_rungs) return _rungs;
  const out = [];
  for (let i = 0; i < 6; i++) { try { out.push(Number(await _gdIdentityFull.reverifyDaysOptions(i))); } catch { break; } }
  _rungs = out.length ? out : [3, 180];
  return _rungs;
}
const _gdIdentityFull = core.provider
  ? new core.ethers.Contract(GD_IDENTITY_ADDR, [
      'function isWhitelisted(address) view returns (bool)',
      'function getWhitelistedRoot(address) view returns (address)',
      'function connectedAccounts(address) view returns (address)',
      'function identities(address) view returns (uint256 dateAuthenticated, uint256 dateAdded, string did, uint256 whitelistedOnChainId, uint8 status, uint32 authCount)',
      'function reverifyDaysOptions(uint256) view returns (uint256)',
    ], core.provider)
  : null;
async function isVerifiedStrict(wallet) {
  if (!_gdIdentityFull) throw new Error('identity contract not configured');
  const w = String(wallet).toLowerCase(); const ZERO = core.ethers.ZeroAddress.toLowerCase();
  const [self, root, linked, rungs] = await Promise.all([_gdIdentityFull.isWhitelisted(w), _gdIdentityFull.getWhitelistedRoot(w), _gdIdentityFull.connectedAccounts(w).catch(() => ZERO), identityRungs()]);
  const rootAddr = String(root).toLowerCase(); const linkedAddr = String(linked).toLowerCase();
  const whitelisted = rootAddr !== ZERO;
  // the identity record lives on the root: this wallet, the root it is whitelisted through, or the root it is linked to
  const holder = whitelisted ? rootAddr : linkedAddr !== ZERO ? linkedAddr : w;
  const id = await _gdIdentityFull.identities(holder);
  const authAt = Number(id.dateAuthenticated); const addedAt = Number(id.dateAdded);
  _verifiedCache.set(w, { verified: !!self, at: Date.now() }); // the gate's cache keeps its own, stricter meaning
  if (Number(id.status) === 255) return { verified: false, state: 'blacklisted', self: false, root: null, at: addedAt || null, authAt: authAt || null, expiresAt: null, probation: false };
  if (!authAt) return { verified: false, state: 'none', self: false, root: null, at: null, authAt: null, expiresAt: null, probation: false };
  const grandfathered = authAt < TEMP_EXCLUSION_TS;
  const rung = grandfathered ? rungs.length - 1 : Math.min(Number(id.authCount), rungs.length - 1);
  return {
    verified: whitelisted, state: whitelisted ? 'verified' : 'lapsed', self: !!self, root: holder !== w ? holder : null,
    at: addedAt || authAt, authAt, expiresAt: authAt + rungs[rung] * 86400, probation: !grandfathered && Number(id.authCount) === 0,
  };
}

// The identity root — one per human — used ONLY to deduplicate scoring seats,
// never to decide whether someone is verified. Returns null when unresolvable
// so callers must handle "unknown" rather than silently treating it as a seat.
const _rootCache = new Map();
const ROOT_TTL_MS = 60 * 60 * 1000;
async function identityRootOf(wallet) {
  if (!_gdIdentity || !wallet) return null;
  const w = String(wallet).toLowerCase();
  const c = _rootCache.get(w);
  if (c && Date.now() - c.at < ROOT_TTL_MS) return c.root;
  try {
    const root = await _gdIdentity.getWhitelistedRoot(w);
    const r = !root || root === core.ethers.ZeroAddress ? null : String(root).toLowerCase();
    _rootCache.set(w, { root: r, at: Date.now() });
    return r;
  } catch {
    return c ? c.root : null;
  }
}

// Has this wallet EVER passed a GoodDollar face check, regardless of whether the
// verification is still valid today? lastAuthenticated is a permanent on-chain
// timestamp: non-zero once a wallet has authenticated, and it survives the
// 3-day reverify window lapsing. Used ONLY for recruit credit — a recruiter who
// brought a real human that verified and played should keep the credit even
// after that human's verification expires. It is NOT used to let anyone pull or
// claim a bounty; those still require CURRENT verification via isVerified.
const _everVerifiedCache = new Map(); // wallet -> { ever, at }
async function everVerified(wallet) {
  if (!_gdIdentity || !wallet) return false;
  const w = String(wallet).toLowerCase();
  const c = _everVerifiedCache.get(w);
  // "ever verified" only ever flips false->true and then stays true, so a true
  // can be cached hard; recheck falses periodically in case they verify.
  if (c && (c.ever || Date.now() - c.at < VERIFIED_FALSE_TTL_MS)) return c.ever;
  try {
    const ts = await _gdIdentity.lastAuthenticated(w);
    const ever = ts !== undefined && ts !== null && BigInt(ts) > 0n;
    _everVerifiedCache.set(w, { ever, at: Date.now() });
    return ever;
  } catch {
    return c ? c.ever : false;
  }
}

// ─── GET /api/ref/summary/:wallet — honest referral tally ───────────────────
// "joined"   = friends who minted a GamePass through your code
//              (season_v1_referrer_intent, a lifetime count).
// "verified" = how many of those are GoodDollar-verified RIGHT NOW. Verification
//              lapses after mint, so this is the real number — the passport used
//              to show the join count mislabelled as "verified", which overstated
//              it (e.g. 7 shown while only 3 still verify). isVerified is cached,
//              so repeat referrals across profiles are cheap; result cached 10 min.
core.app.get('/api/ref/summary/:wallet', async (req, res) => {
  const ref = String(req.params.wallet || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(ref)) return res.status(400).json({ error: 'bad wallet' });
  const cached = core.cacheGet(`refsum:${ref}`);
  if (cached) return res.json(cached);
  try {
    const { data } = await core.supabase.from('season_v1_referrer_intent')
      .select('wallet').ilike('referrer_wallet', ref).limit(10000);
    const wallets = [...new Set((data || []).map((r) => r.wallet?.toLowerCase()).filter(Boolean))];
    const flags = await mapLimit(wallets, 12, (w) => isVerified(w));
    const payload = { joined: wallets.length, verified: flags.filter(Boolean).length };
    core.cacheSet(`refsum:${ref}`, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    console.warn('ref summary:', e?.message || e);
    res.json({ joined: 0, verified: 0 });
  }
});

// ─── GET /api/verified-stats — how many real humans, not just pass minters ──
// The subgraph's totalPlayers counts everyone who ever minted a GamePass. That
// is NOT the same as GoodDollar-verified humans: a wallet can hold a pass and
// never pass face verification. This endpoint walks every known player wallet
// and checks isWhitelisted on the GoodDollar identity contract, so the /impact
// page can show the true verified count alongside total players.
//
// Heavy on first run (one on-chain read per uncached wallet), so the aggregate
// is cached for an hour and per-wallet results are cached in _verifiedCache —
// time-bounded in BOTH directions, because GoodDollar verification expires (a
// first-ever check lapses after 3 days). Concurrency is bounded so we never fan
// out hundreds of RPCs at once.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

core.app.get('/api/verified-stats', async (_, res) => {
  const cached = core.cacheGet('verified:stats');
  if (cached) return res.json(cached);
  try {
    // Enumerate the SAME player population the rest of the app counts: one
    // Player entity per GamePass minter in the subgraph (keyed by wallet).
    // Using this instead of the backend `users` table keeps the denominator
    // consistent with globalStat.totalPlayers everywhere else on the site.
    const wallets = [];
    let cursor = '';
    for (let page = 0; page < 20; page++) { // 20 × 1000 = 20k ceiling, ample
      const q = await core.subgraph.gql(
        `query P($c: ID!) { players(first: 1000, where: { id_gt: $c }, orderBy: id, orderDirection: asc) { id } }`,
        { c: cursor },
      );
      const batch = (q.players || []).map(p => p.id?.toLowerCase()).filter(Boolean);
      if (batch.length === 0) break;
      wallets.push(...batch);
      cursor = batch[batch.length - 1];
      if (batch.length < 1000) break;
    }

    const flags = await mapLimit(wallets, 12, (w) => isVerified(w));
    const verifiedPlayers = flags.filter(Boolean).length;

    const payload = {
      totalPlayers:    wallets.length,   // everyone with an account
      verifiedPlayers,                   // subset that passed GoodDollar verification
      verifiedPct:     wallets.length ? Math.round((verifiedPlayers / wallets.length) * 100) : 0,
      updatedAt:       new Date().toISOString(),
    };
    core.cacheSet('verified:stats', payload, 60 * 60 * 1000); // 1h
    res.json(payload);
  } catch (e) {
    console.warn('verified-stats failed:', e?.message || e);
    res.status(200).json({ totalPlayers: 0, verifiedPlayers: 0, verifiedPct: 0, updatedAt: null });
  }
});

// ─── GET /api/impact-stats — live perk economy figures ──────────────────────
// The impact page's "perk spend / purchases" used to be a hardcoded estimate
// backsolved from UBI, so it never moved and drifted from the truth. These are
// the real, auditable totals straight from arena_purchases (every row is a G$
// perk transaction on Celo). Cached 1h — the impact page is not real-time.
core.app.get('/api/impact-stats', async (_, res) => {
  const cached = core.cacheGet('impact:perks');
  if (cached) return res.json(cached);
  try {
    let purchases = 0, spendWei = 0n;
    for (let off = 0; off < 200000; off += 1000) { // hard ceiling, breaks early
      const { data, error } = await core.supabase.from('arena_purchases')
        .select('amount_wei').range(off, off + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) { purchases++; if (r.amount_wei) spendWei += BigInt(r.amount_wei); }
      if (data.length < 1000) break;
    }
    const payload = {
      perkPurchases: purchases,
      perkSpendG: Math.round(Number(spendWei / 10n ** 12n) / 1e6), // wei → G$, whole units
      updatedAt: new Date().toISOString(),
    };
    core.cacheSet('impact:perks', payload, 60 * 60 * 1000); // 1h
    res.json(payload);
  } catch (e) {
    console.warn('impact-stats failed:', e?.message || e);
    res.status(200).json({ perkPurchases: null, perkSpendG: null, updatedAt: null });
  }
});
},

// ── Identity-expiry warning cron ──
function* (core) {
  Object.defineProperties(core, {
    getReverifySchedule: { get: () => getReverifySchedule, enumerable: true, configurable: true },
    computeIdentityExpiry: { get: () => computeIdentityExpiry, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Identity-expiry warning cron ────────────────────────────────────────────
// GoodDollar expires a player's FIRST-EVER verification after 3 days (the
// second one buys 180 — see lib/identityExpiry.js). Nothing used to tell the
// player, so they simply stopped counting as verified: 313 of 752 players are
// currently lapsed, which is the whole reason the verified count falls.
//
// This fires one warning while they can still act on it. sendToWallet also
// writes notifications_feed, so the warning lands in the in-app bell even for
// the ~96% of players with no push subscription — they see it next time they
// open the app, which is exactly when they can fix it.
//
// Runs hourly, acts once in the 09:00-10:00 UTC window (10-11am WAT).
// sendToWallet de-dupes per (wallet, category, day) on top of that.
const { computeIdentityExpiry } = require('../lib/identityExpiry');

let _reverifySchedule = null;
async function getReverifySchedule() {
  if (_reverifySchedule) return _reverifySchedule;
  if (!core._gdIdentity) return null;
  const out = [];
  for (let i = 0; i < 8; i++) {
    try { out.push(Number(await core._gdIdentity.reverifyDaysOptions(i))); }
    catch { break; } // past the end of the array — the read reverts
  }
  if (out.length === 0) return null;
  _reverifySchedule = out;
  console.log(`🪪 GoodDollar reverify schedule: [${out.join(', ')}] days`);
  return out;
}

async function sendIdentityExpiryWarnings() {
  try {
    if (new Date().getUTCHours() !== 9) return;
    if (!core._gdIdentity) return;

    const schedule = await getReverifySchedule();
    if (!schedule) { console.warn('identity-expiry cron: no reverify schedule, skipping'); return; }

    // Same player population the rest of the app counts.
    const wallets = [];
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const q = await core.subgraph.gql(
        `query P($c: ID!) { players(first: 1000, where: { id_gt: $c }, orderBy: id, orderDirection: asc) { id } }`,
        { c: cursor },
      );
      const batch = (q.players || []).map(p => p.id?.toLowerCase()).filter(Boolean);
      if (batch.length === 0) break;
      wallets.push(...batch);
      cursor = batch[batch.length - 1];
      if (batch.length < 1000) break;
    }
    if (wallets.length === 0) return;

    const rows = await core.mapLimit(wallets, 8, async (w) => {
      try {
        const id = await core._gdIdentity.identities(w);
        return { wallet: w, exp: computeIdentityExpiry(id, schedule) };
      } catch {
        return null; // an unreadable wallet is skipped, never warned incorrectly
      }
    });

    let sent = 0;
    for (const r of rows) {
      if (!r || !r.exp.verified) continue;        // lapsed players get the re-verify prompt in-app, not this
      if (r.exp.daysLeft > 1) continue;           // only warn inside the last day
      const ok = await core.push.sendToWallet(core.supabase, r.wallet, 'identity_expiry', {
        title: '🪪 Your verification expires tomorrow',
        body: "One 30-second face check keeps it — and this time it lasts 180 days.",
        tag: 'identity-expiry',
        url: '/verify',
      });
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🪪 Identity-expiry warnings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('identity expiry cron failed:', e?.message || e);
  }
}
core.jobs.every('sendIdentityExpiryWarnings', 60 * 60 * 1000, sendIdentityExpiryWarnings);
},

];
