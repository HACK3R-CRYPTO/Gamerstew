// ─── challenges ───────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── GET /api/challenge — short-burst play-count challenge ──
function* (core) {
  Object.defineProperties(core, {
    CHALLENGE_END: { get: () => CHALLENGE_END, enumerable: true, configurable: true },
    CHALLENGE_START: { get: () => CHALLENGE_START, enumerable: true, configurable: true },
    challengeCache: { get: () => challengeCache, set: (v) => { challengeCache = v; }, enumerable: true, configurable: true },
    CHALLENGE_CACHE_TTL_MS: { get: () => CHALLENGE_CACHE_TTL_MS, enumerable: true, configurable: true },
    rebuildChallengeCache: { get: () => rebuildChallengeCache, enumerable: true, configurable: true },
    CHALLENGE_TOP_N: { get: () => CHALLENGE_TOP_N, enumerable: true, configurable: true },
    CHALLENGE_PRIZE_USDC: { get: () => CHALLENGE_PRIZE_USDC, enumerable: true, configurable: true },
    CHALLENGE_NAME: { get: () => CHALLENGE_NAME, enumerable: true, configurable: true },
    CHALLENGE_ID: { get: () => CHALLENGE_ID, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── GET /api/challenge — short-burst play-count challenge ────────────────────
// 72-hour hosted event that awards a flat USDC prize to the top N players by
// total game plays. Designed for end-of-program traction pushes where the
// goal is volume of transactions, not peak score.
//
// Config is hardcoded on purpose so the event is deterministic and the
// whole team knows when it starts and stops without hunting through env
// vars. Update these three constants to run another challenge later.
const CHALLENGE_ID          = '2026-04-28_72h_arena_cup';
const CHALLENGE_NAME        = '72-hr Arena Cup II';
// Starts 12:00pm WAT Apr 28 (= 11:00 UTC), ends 72h later at 11:00 UTC May 1.
const CHALLENGE_START       = Math.floor(new Date('2026-04-28T11:00:00Z').getTime() / 1000);
const CHALLENGE_END         = Math.floor(new Date('2026-05-01T11:00:00Z').getTime() / 1000);
const CHALLENGE_MIN_PLAYS   = 500;
const CHALLENGE_TOP_N       = 2;
const CHALLENGE_PRIZE_USDC  = 5;

// Freeze guard — flips to true the moment we write the immutable winner
// record. Survives across /api/challenge calls within one process; on cold
// start the first post-end caller re-runs the freeze, which the upsert's
// onConflict: 'id' makes idempotent.
let challengeFrozen = false;

async function freezeChallengeIfNeeded(nowSec, ranked) {
  if (challengeFrozen) return;
  if (nowSec < CHALLENGE_END) return;

  // Winners = top N qualified players. If fewer than N qualified, we record
  // only those who did — no inflating the winner list with players below
  // the min-plays floor.
  const winners = ranked
    .filter(r => r.qualified)
    .slice(0, CHALLENGE_TOP_N)
    .map((r, i) => ({
      rank: i + 1,
      wallet: r.wallet,
      username: r.username,
      plays: r.plays,
    }));

  try {
    await core.supabase.from('challenge_winners').upsert({
      id: CHALLENGE_ID,
      name: CHALLENGE_NAME,
      starts_at: new Date(CHALLENGE_START * 1000).toISOString(),
      ends_at:   new Date(CHALLENGE_END   * 1000).toISOString(),
      min_plays: CHALLENGE_MIN_PLAYS,
      top_n:     CHALLENGE_TOP_N,
      prize_usdc: CHALLENGE_PRIZE_USDC,
      winners,
    }, { onConflict: 'id' });
    challengeFrozen = true;
    console.log(`🏆 Froze ${CHALLENGE_ID} — ${winners.length} winner(s)`);
  } catch (e) {
    console.error('Failed to freeze challenge:', e?.message || e);
    // Leave challengeFrozen=false so the next caller retries.
  }
}

// ── Challenge leaderboard aggregation ────────────────────────────────────────
// Two-strategy pipeline designed to scale from 100 players to 1M:
//
//   FAST PATH  — Postgres RPC `challenge_leaderboard(start, end, min_plays,
//                top_n)`. The GROUP BY runs inside Postgres, against the
//                composite index on activity(created_at, wallet_address).
//                Returns ≤ top_n rows over the wire, regardless of how big
//                the activity table grows. One round-trip, O(log N) seek.
//
//   FALLBACK   — JS-side paginated aggregation. Used only when the RPC is
//                not deployed (graceful degradation while the migration is
//                rolling out). Aggregates in-loop into a Map so memory is
//                O(unique wallets), never O(rows).
//
//   IN-MEMORY  — 10s TTL cache wraps both. Concurrent cache misses share
//                ONE in-flight rebuild promise (thundering-herd guard).
//                Failures preserve the last good cache rather than poison
//                callers with partial or empty data.
//
// Tuning the constants:
//   - CHALLENGE_CACHE_TTL_MS   how long a snapshot stays warm
//   - CHALLENGE_PAGE_SIZE      Supabase row cap per request (1000 default)
//   - CHALLENGE_TOP_LIST       how many ranked players we ship to clients

const CHALLENGE_CACHE_TTL_MS = 10_000;
const CHALLENGE_PAGE_SIZE    = 1000;
const CHALLENGE_TOP_LIST     = 20;

let challengeCache   = { at: 0, plays: new Map(), ranked: [] };
let challengeRebuild = null;

// While the challenge runs its table is rebuilt every ten seconds. Once it has
// been over for ten minutes the table cannot change, so it is kept for half an
// hour: this event ended months ago and was still being recomputed all day.
// `at` is only set by a rebuild that succeeded, so a failure is never kept.
const isCacheFresh = () =>
  challengeCache.at > 0 &&
  Date.now() - challengeCache.at < core.platform.eventTtl(CHALLENGE_END * 1000, Date.now(), CHALLENGE_CACHE_TTL_MS);

async function getChallengePlays() {
  if (isCacheFresh()) {
    return { plays: challengeCache.plays, ranked: challengeCache.ranked };
  }
  // Coalesce concurrent cache-misses into a single rebuild. Followers
  // resolve from the same promise the first miss kicked off.
  if (!challengeRebuild) {
    challengeRebuild = rebuildChallengeCache().finally(() => {
      challengeRebuild = null;
    });
  }
  return challengeRebuild;
}

async function rebuildChallengeCache() {
  const startIso = new Date(CHALLENGE_START * 1000).toISOString();
  const endIso   = new Date(CHALLENGE_END   * 1000).toISOString();
  try {
    // Try the fast path first; fall back if the function isn't deployed.
    const fresh = (await aggregateViaRpc(startIso, endIso))
              || (await aggregateViaPagination(startIso, endIso));
    challengeCache = { at: Date.now(), ...fresh };
    return fresh;
  } catch (e) {
    console.error('challenge aggregation failed:', e?.message || e);
    // Last-good-cache wins over wrong-data. Empty Map + array is the
    // safe zero-state for the very first call after a cold-start failure.
    return { plays: challengeCache.plays, ranked: challengeCache.ranked };
  }
}

// Fast path — Postgres GROUP BY via the `challenge_leaderboard` RPC. The
// function is defined in supabase-migrations.sql; if it has not been
// deployed yet, this returns null and the caller falls back. Any other
// error is rethrown so it surfaces in logs instead of silently degrading.
async function aggregateViaRpc(startIso, endIso) {
  const { data, error } = await core.supabase.rpc('challenge_leaderboard', {
    p_start:     startIso,
    p_end:       endIso,
    p_min_plays: CHALLENGE_MIN_PLAYS,
    p_top_n:     CHALLENGE_TOP_LIST,
  });
  if (error) {
    if (error.code === '42883' || /does not exist/i.test(error.message || '')) {
      return null; // function not deployed yet → use fallback
    }
    throw error;
  }
  if (!data) return null;
  const rankings = Array.isArray(data.rankings) ? data.rankings : [];
  const playsMap = data.plays_map && typeof data.plays_map === 'object'
    ? data.plays_map
    : {};
  const plays = new Map();
  for (const [wallet, count] of Object.entries(playsMap)) {
    plays.set(wallet, Number(count));
  }
  const ranked = await Promise.all(
    rankings.map(async (r) => ({
      wallet:    r.wallet,
      plays:     Number(r.plays),
      qualified: !!r.qualified,
      username:  await core.resolveUsername(r.wallet) || null,
    }))
  );
  return { plays, ranked };
}

// Fallback path — paginate `activity`, aggregate in-loop into a Map. Memory
// stays O(unique wallets) instead of O(rows). Any page error throws, which
// the caller catches and converts to a last-good-cache return.
async function aggregateViaPagination(startIso, endIso) {
  const plays = new Map();
  for (let from = 0; ; from += CHALLENGE_PAGE_SIZE) {
    const { data: page, error } = await core.supabase
      .from('activity')
      .select('wallet_address')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: true })
      .range(from, from + CHALLENGE_PAGE_SIZE - 1);
    if (error) throw error;
    if (!page || page.length === 0) break;
    for (const row of page) {
      const key = row.wallet_address?.toLowerCase();
      if (key) plays.set(key, (plays.get(key) || 0) + 1);
    }
    if (page.length < CHALLENGE_PAGE_SIZE) break;
  }
  const ranked = await Promise.all(
    Array.from(plays.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, CHALLENGE_TOP_LIST)
      .map(async ([wallet, count]) => ({
        wallet,
        plays:     count,
        qualified: count >= CHALLENGE_MIN_PLAYS,
        username:  await core.resolveUsername(wallet) || null,
      }))
  );
  return { plays, ranked };
}

// Pre-event visibility window — show the "STARTS IN ..." teaser up to 7
// days before CHALLENGE_START. Builds anticipation, lets players see what's
// coming, and bumps Games/Leaderboard engagement ahead of launch.
// Same for a challenge that has ended: build its table once at startup.
if (Date.now() / 1000 >= CHALLENGE_END) {
  setImmediate(() => getChallengePlays().catch((e) => console.warn('challenge warm-up failed:', e?.message || e)));
}

const CHALLENGE_PREVIEW_SECONDS = 7 * 24 * 60 * 60;

core.app.get('/api/challenge', async (req, res) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const active  = nowSec >= CHALLENGE_START && nowSec < CHALLENGE_END;
  const pending = nowSec < CHALLENGE_START &&
                  nowSec >= (CHALLENGE_START - CHALLENGE_PREVIEW_SECONDS);

  // During pending, skip the DB aggregation — no plays exist in the window
  // yet. Only run it when the event is live or has ended (ended is needed
  // for the auto-freeze path below).
  const needPlays = active || nowSec >= CHALLENGE_END;
  const { plays, ranked } = needPlays
    ? await getChallengePlays()
    : { plays: new Map(), ranked: [] };

  // Auto-freeze on first call after CHALLENGE_END. Idempotent via upsert —
  // if multiple concurrent requests race here they all converge on one row.
  await freezeChallengeIfNeeded(nowSec, ranked);

  // My play count comes from the in-memory plays Map. With pagination the
  // map is exact and worst-case staleness is 10s (the cache TTL), which is
  // invisible to a player tapping refresh after a finished game.
  const requester = (req.query.player || '').toString().toLowerCase();
  const myPlays = requester ? (plays.get(requester) || 0) : 0;

  res.json({
    active,
    pending,
    name: CHALLENGE_NAME,
    startsAt: CHALLENGE_START,
    endsAt: CHALLENGE_END,
    secondsUntilStart: Math.max(0, CHALLENGE_START - nowSec),
    secondsLeft: Math.max(0, CHALLENGE_END - nowSec),
    minPlays: CHALLENGE_MIN_PLAYS,
    topN: CHALLENGE_TOP_N,
    prizeUsdc: CHALLENGE_PRIZE_USDC,
    totalPrizePool: CHALLENGE_TOP_N * CHALLENGE_PRIZE_USDC,
    rankings: ranked,
    myPlays,
    myQualified: myPlays >= CHALLENGE_MIN_PLAYS,
  });
});

// ─── GET /api/challenges/past — archive of frozen challenge results ──────────
// Returns every challenge that has ended and been frozen, newest first.
// The leaderboard "past seasons" section uses this to render a history of
// hosted events alongside regular weekly seasons.
core.app.get('/api/challenges/past', async (_, res) => {
  const { data } = await core.supabase
    .from('challenge_winners')
    .select('*')
    .lte('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: false })
    .limit(20);
  res.json({ challenges: data || [] });
});
},

// ── Competition payouts ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── Competition payouts ──────────────────────────────────────────────────────
// What GameArena has actually paid OUT to players through competitions, so the
// impact page and GoodDollar can see it in one place instead of it living only
// in WhatsApp announcements. Source of truth is data/competition-payouts.json,
// a committed ledger where every row carries the on-chain tx hash that proves
// it — the same tx anyone can open on Celoscan. Amounts are what reached
// PLAYERS; the treasury/change leg in each batch is excluded at the ledger.
// Add a row when a payout settles; nothing here is computed from a mutable
// balance, so it cannot drift.
core.app.get('/api/payouts', (_req, res) => {
  try {
    const fs = require('fs'), path = require('path');
    const raw = fs.readFileSync(path.join(require('path').join(__dirname, '..'), 'data', 'competition-payouts.json'), 'utf8');
    const ledger = JSON.parse(raw);
    const rows = Array.isArray(ledger.payouts) ? ledger.payouts : [];
    const totals = {};
    let playerSlots = 0;
    let usdValueTotal = 0;          // for rows recorded by USD value (exact token amount pending)
    for (const r of rows) {
      const a = String(r.asset || '').toUpperCase();
      // Only rows with a confirmed native amount count toward the asset totals.
      // A row still awaiting its exact on-chain figure (amountToPlayers null)
      // contributes its usdValue instead, so it is represented without inventing
      // a token amount.
      if (Number.isFinite(Number(r.amountToPlayers))) {
        totals[a] = (totals[a] || 0) + Number(r.amountToPlayers);
      }
      if (Number.isFinite(Number(r.usdValue))) usdValueTotal += Number(r.usdValue);
      playerSlots += Number(r.players) || 0;
    }
    res.json({
      payouts: rows,
      totals,                         // confirmed native amounts, e.g. { "G$": 686135, "USDC": 50 }
      usdValueTotal,                  // sum of USD-denominated prize values (e.g. Arena Cup)
      playerSlotsPaid: playerSlots,   // sum of confirmed per-competition winner counts
      payoutWallet: ledger.payoutWallet || null,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('payouts ledger read failed:', e?.message || e);
    res.status(200).json({ payouts: [], totals: {}, playerSlotsPaid: 0, updatedAt: null });
  }
});
},

// ── GET /api/weekly-challenge — community games milestone ──
function* (core) {
  Object.defineProperties(core, {
    WEEKLY_CHALLENGE_CAP: { get: () => WEEKLY_CHALLENGE_CAP, enumerable: true, configurable: true },
    WEEKLY_CHALLENGE_TARGET: { get: () => WEEKLY_CHALLENGE_TARGET, enumerable: true, configurable: true },
    WEEKLY_CHALLENGE_PER_GAME_G: { get: () => WEEKLY_CHALLENGE_PER_GAME_G, enumerable: true, configurable: true },
    WEEKLY_CHALLENGE_REWARD_G: { get: () => WEEKLY_CHALLENGE_REWARD_G, enumerable: true, configurable: true },
    WEEKLY_CHALLENGE_UBI_G: { get: () => WEEKLY_CHALLENGE_UBI_G, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── GET /api/weekly-challenge — community games milestone ──────────────────
// Returns progress toward the weekly community games target. Counts games
// from this week's Monday 00:00 UTC. Each player's contribution is capped at
// PER_PLAYER_CAP so no single grinder can solo the milestone.
// Config lives as constants — bump TARGET and REWARD as community grows.
const WEEKLY_CHALLENGE_TARGET    = 1200;   // games the community must play to unlock the pool (≈ budget ÷ per-game)
const WEEKLY_CHALLENGE_PER_GAME_G = 105;   // FIXED G$ earned per game (~₦17) · cap × this = the max per player
const WEEKLY_CHALLENGE_REWARD_G  = 126000; // G$ budget ceiling (~₦20,000) · = TARGET × PER_GAME_G when fully hit
const WEEKLY_CHALLENGE_UBI_G     = 50;     // G$ GameArena sends to GoodDollar
const WEEKLY_CHALLENGE_CAP       = 150;    // max games per player · CAP × PER_GAME_G = 15,750 G$ (~₦2,500) max payout

core.app.get('/api/weekly-challenge', async (req, res) => {
  const nowUTC = new Date();
  const dayOfWeek = nowUTC.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(
    nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(),
    nowUTC.getUTCDate() - daysSinceMonday, 0, 0, 0, 0,
  ));
  const sunday = new Date(monday.getTime() + 7 * 86400000 - 1);

  // Count human skill-game plays from the on-chain subgraph (source of truth),
  // excluding agent/MARKOV matches (gameType 3). The old Supabase `activity`
  // count silently dropped rows — it undercounted the pool (showed 945 when the
  // real human total was 1,273) and under-credited real players. Cached briefly;
  // once agent plays are filtered out a full window rebuild is only ~2 pages.
  const winStart = Math.floor(monday.getTime() / 1000);
  const winEnd   = Math.floor(sunday.getTime() / 1000);
  const cacheKey = `weekly-challenge:${winStart}`;
  let byWallet = core.cacheGet(cacheKey);
  if (!byWallet) {
    // Both records, the higher count per player (src/modules/board/plays.ts): the
    // subgraph alone showed 0 for weeks when it stopped indexing.
    const { counts, sources } = await core.platform.playCounts({ subgraph: (a, b) => core.subgraph.playCountsInWindow(a, b), db: core.supabase }, winStart, winEnd);
    if (!sources.subgraph || !sources.ledger) console.warn(`[weekly-challenge] counted with subgraph=${sources.subgraph} ledger=${sources.ledger}`);
    byWallet = {};
    for (const [w, v] of counts) byWallet[w] = { username: v.username, count: v.count };
    core.cacheSet(cacheKey, byWallet, core.MEM_TTL.leaderboard);
  }

  // Rebuild raw-count + on-chain-username maps from the cached window snapshot.
  const perPlayer = new Map(); // wallet → raw play count
  const onchainName = new Map(); // wallet → on-chain username (avoids a resolve call)
  for (const [w, v] of Object.entries(byWallet)) {
    perPlayer.set(w, v.count);
    if (v.username) onchainName.set(w, v.username);
  }

  const totalCapped = Array.from(perPlayer.values())
    .reduce((s, n) => s + Math.min(WEEKLY_CHALLENGE_CAP, n), 0);
  const playersIn = perPlayer.size;
  const hit       = totalCapped >= WEEKLY_CHALLENGE_TARGET;

  const msLeft   = sunday.getTime() - Date.now();
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));

  // Per-player contribution — returned when wallet query param is present.
  // Used by the frontend to show "Your share: X / 50" on the challenge card.
  const wallet = req.query.wallet?.toLowerCase();
  const myRawCount    = wallet ? (perPlayer.get(wallet) || 0) : null;
  const myContribution = myRawCount !== null ? Math.min(WEEKLY_CHALLENGE_CAP, myRawCount) : null;

  // All contributors ranked by capped games. Each entry has wallet,
  // resolved username, and the capped game count. Used by:
  //  - games page sidebar (just needs wallet for avatars)
  //  - leaderboard community-challenge card (renders the full list with
  //    rank + username + games as a leaderboard view of participants)
  // Capped at 50 to bound response size and chain-lookup latency. A typical
  // week will be well under that.
  const topContributorWallets = Array.from(perPlayer.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  const topContributors = await Promise.all(
    topContributorWallets.map(async ([w, count]) => ({
      wallet:   w,
      username: onchainName.get(w) || await core.resolveUsername(w),
      games:    Math.min(WEEKLY_CHALLENGE_CAP, count),
    })),
  );

  // Fixed economics: each capped game earns a fixed PER_GAME_G, so a player's
  // earned-so-far = their capped games × PER_GAME_G (guaranteed, not diluted).
  const perGameG = WEEKLY_CHALLENGE_PER_GAME_G;
  const myProjectedG = myContribution != null ? myContribution * perGameG : null;

  res.json({
    target:       WEEKLY_CHALLENGE_TARGET,
    progress:     totalCapped,
    playersIn,
    hit,
    daysLeft,
    rewardG:      WEEKLY_CHALLENGE_REWARD_G,
    ubiG:         WEEKLY_CHALLENGE_UBI_G,
    capPerPlayer: WEEKLY_CHALLENGE_CAP,
    perGameG:     Math.round(perGameG * 100) / 100,
    myProjectedG,
    windowStart:  monday.toISOString(),
    windowEnd:    sunday.toISOString(),
    myContribution,
    contributors: topContributors,
  });
});
},

// ── Competition freeze — mirrors freezeChallengeIfNeeded ──
function* (core) {
  Object.defineProperties(core, {
    freezeCompetitionIfNeeded: { get: () => freezeCompetitionIfNeeded, enumerable: true, configurable: true },
    COMPETITION_ID: { get: () => COMPETITION_ID, enumerable: true, configurable: true },
    arenaWeekKey: { get: () => arenaWeekKey, enumerable: true, configurable: true },
    ArenaMatchEngine: { get: () => ArenaMatchEngine, enumerable: true, configurable: true },
    attestInstantMatch: { get: () => attestInstantMatch, enumerable: true, configurable: true },
    arenaPoints: { get: () => arenaPoints, enumerable: true, configurable: true },
    arenaLadderStandings: { get: () => arenaLadderStandings, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Competition freeze — mirrors freezeChallengeIfNeeded ────────────────────
// Writes a single immutable snapshot to competition_winners when the comp ends.
// Idempotent via upsert + onConflict:'id'. In-process guard avoids redundant
// Supabase writes; cold-start re-runs are safe because upsert is a no-op.
let competitionFrozen = false;
// ID reflects the actual 4-week data window (10-13). Public-facing name
// stays "3-Week Competition" because that's what the community was told.
const COMPETITION_ID = 'gamearena-comp-s10-13';
const COMPETITION_NAME = '3-Week Competition';

async function freezeCompetitionIfNeeded(nowSec, rankings, compEnd, compStart) {
  if (competitionFrozen) return;
  if (nowSec < compEnd) return;

  const winners = rankings.slice(0, 3).map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet,
    username: r.username,
    total: r.total,
    totalRhythm: r.totalRhythm,
    totalSimon: r.totalSimon,
  }));

  // Write into competition_winners — the proper table for multi-week season
  // events. Different from challenge_winners (used by 72-hr cups) because
  // the data shape is different: scores instead of play counts, and
  // per-rank prize breakdown ($15/$10/$5) instead of a flat per-winner amount.
  // Frontend reads this via /api/competition/past and renders it under
  // COMPLETED EVENTS with score-aware columns.
  const { error } = await core.supabase.from('competition_winners').upsert({
    id: COMPETITION_ID,
    name: COMPETITION_NAME,
    starts_at: new Date(compStart * 1000).toISOString(),
    ends_at:   new Date(compEnd   * 1000).toISOString(),
    weeks: core.COMPETITION_WEEKS,
    prizes: { first: 15, second: 10, third: 5 },
    winners,
  }, { onConflict: 'id' });

  if (error) {
    console.error(`❌ Failed to freeze ${COMPETITION_ID}:`, error.message || error);
    throw new Error(error.message || 'Supabase upsert failed');
  }

  competitionFrozen = true;
  console.log(`🏆 Froze ${COMPETITION_ID} — ${winners.length} winner(s)`);
}

// ─── GET /api/competition/past — archive of frozen competition results ────────
core.app.get('/api/competition/past', async (_, res) => {
  const { data } = await core.supabase
    .from('competition_winners')
    .select('*')
    .order('ends_at', { ascending: false });
  res.json({ competitions: data || [] });
});

// ─── POST /api/competition/freeze — admin force-freeze the current comp ──────
// Escape hatch for when the time-based freeze didn't fire (process restart
// timing, deploy gaps, manual cleanup). Computes current rankings and writes
// the same snapshot the auto-freeze writes. Idempotent via upsert.
//
// Example:
//   curl -X POST https://.../api/competition/freeze \
//     -H "x-internal-secret: $INTERNAL_SECRET"
core.app.post('/api/competition/freeze', core.requireSecret, async (_, res) => {
  try {
    // Recompute current rankings exactly the way GET /api/competition does.
    const totals = new Map();
    for (const week of core.COMPETITION_WEEKS) {
      const { start, end } = core.seasonBounds(week);
      const startIso = new Date(start * 1000).toISOString();
      const endIso   = new Date(end   * 1000).toISOString();
      for (const game of core.VALID_GAMES) {
        const { data: rows } = await core.supabase
          .from('activity')
          .select('wallet_address, score')
          .eq('game', game)
          .gte('created_at', startIso)
          .lt('created_at', endIso)
          .order('score', { ascending: false })
          .limit(500);
        const weekBest = new Map();
        for (const row of (rows || [])) {
          const key = row.wallet_address?.toLowerCase();
          if (!key) continue;
          if (!weekBest.has(key) || row.score > weekBest.get(key)) {
            weekBest.set(key, row.score);
          }
        }
        // Historical competition only counted rhythm + simon · skip stack
        // here (it didn't exist when these weeks ran) rather than letting
        // the else-fallthrough mislabel stack scores as simon.
        for (const [wallet, score] of weekBest.entries()) {
          if (game !== 'rhythm' && game !== 'simon') continue;
          if (!totals.has(wallet)) totals.set(wallet, { wallet, totalRhythm: 0, totalSimon: 0 });
          const entry = totals.get(wallet);
          if (game === 'rhythm') entry.totalRhythm += score;
          else entry.totalSimon += score;
        }
      }
    }
    const rankings = await Promise.all(
      Array.from(totals.values())
        .map(e => ({ ...e, total: e.totalRhythm + e.totalSimon }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 20)
        .map(async e => ({ ...e, username: await core.resolveUsername(e.wallet) || null }))
    );

    const { start: compStart } = core.seasonBounds(core.COMPETITION_WEEKS[0]);
    const { end: compEnd }     = core.seasonBounds(core.COMPETITION_WEEKS[core.COMPETITION_WEEKS.length - 1]);

    // Force the freeze regardless of the in-memory flag or current time.
    competitionFrozen = false;
    await freezeCompetitionIfNeeded(Math.floor(Date.now() / 1000), rankings, compEnd, compStart);

    res.json({ success: true, frozen: competitionFrozen, winners: rankings.slice(0, 3) });
  } catch (e) {
    console.error('Manual freeze failed:', e?.message || e);
    res.status(500).json({ success: false, error: e?.message || 'Freeze failed' });
  }
});

// ─── POST /api/dice-roll — disabled until Phase 2 signed oracle ──────────────
// ─── GET /api/weekly-challenge/payout-list — payout list for manual distribution
// Returns every wallet that played at least 1 game this week, their game count
// (capped at 70), their username, and how much G$ they should receive when the
// milestone is hit. Call this when the milestone hits to know who to pay.
//
// curl https://.../api/weekly-challenge/payout-list \
//   -H "x-internal-secret: $INTERNAL_SECRET"
core.app.get('/api/weekly-challenge/payout-list', core.requireSecret, async (_, res) => {
  try {
    const nowUTC = new Date();
    const dayOfWeek = nowUTC.getUTCDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(Date.UTC(
      nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(),
      nowUTC.getUTCDate() - daysSinceMonday, 0, 0, 0, 0,
    ));
    const sunday = new Date(monday.getTime() + 7 * 86400000 - 1);

    // Count from the on-chain subgraph (source of truth), excluding agent/MARKOV
    // matches (gameType 3). Matches /api/weekly-challenge so the payout list can
    // never diverge from what the pool card shows. The old Supabase `activity`
    // count dropped rows and under-paid real players.
    // MONEY: with the outbox on, only runs confirmed on-chain count here. The
    // public card above may show a run that is still on its way; this list may not.
    const { counts } = await core.platform.playCounts(
      { subgraph: (a, b) => core.subgraph.playCountsInWindow(a, b), db: core.supabase, confirmedOnly: core.outboxOn() },
      Math.floor(monday.getTime() / 1000),
      Math.floor(sunday.getTime() / 1000),
    );
    const rawCount = new Map();
    const onchainName = new Map();
    for (const [w, v] of counts) {
      rawCount.set(w, v.count);
      if (v.username) onchainName.set(w, v.username);
    }

    const totalCapped = Array.from(rawCount.values())
      .reduce((s, n) => s + Math.min(core.WEEKLY_CHALLENGE_CAP, n), 0);
    const hit = totalCapped >= core.WEEKLY_CHALLENGE_TARGET;

    // FIXED payout: each game (up to the per-player cap) earns a fixed PER_GAME_G,
    // so a player's payout = their capped games × PER_GAME_G, guaranteed and not
    // diluted by turnout. A cap player always gets CAP × PER_GAME_G.
    const qualifyingWallets = Array.from(rawCount.keys());
    const perGameG = core.WEEKLY_CHALLENGE_PER_GAME_G;

    const players = await Promise.all(
      qualifyingWallets.map(async (w) => {
        const countedGames = Math.min(core.WEEKLY_CHALLENGE_CAP, rawCount.get(w));
        const verified = await core.isVerified(w);
        return {
          wallet:      w,
          username:    onchainName.get(w) || await core.resolveUsername(w) || null,
          gamesPlayed: rawCount.get(w),
          countedGames,
          verified,
          // Unverified players are SKIPPED · they earn nothing no matter how much
          // they played. Only face-verified humans get paid.
          payoutG:     verified ? countedGames * perGameG : 0,
        };
      })
    );
    // Sort verified-with-payout first, then by games. Only verified count toward
    // what's owed. `overBudget` flags if verified overplay passed the budget.
    players.sort((a, b) => (b.payoutG - a.payoutG) || (b.countedGames - a.countedGames));
    const verifiedPlayers   = players.filter(p => p.verified).length;
    const skippedUnverified = players.length - verifiedPlayers;
    const totalOwedG = players.reduce((s, p) => s + p.payoutG, 0);
    const overBudget = totalOwedG > core.WEEKLY_CHALLENGE_REWARD_G;

    res.json({
      milestoneHit:    hit,
      weekStart:       monday.toISOString(),
      weekEnd:         sunday.toISOString(),
      totalCappedGames: totalCapped,
      target:          core.WEEKLY_CHALLENGE_TARGET,
      totalPlayers:    qualifyingWallets.length,
      verifiedPlayers,       // only these get paid
      skippedUnverified,     // played but not verified → skipped
      rewardPool:      core.WEEKLY_CHALLENGE_REWARD_G,
      perGameG,
      totalOwedG,            // sum owed to VERIFIED players only
      overBudget,
      ubiG:            core.WEEKLY_CHALLENGE_UBI_G,
      players,
    });
  } catch (e) {
    console.error('payout list failed:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Failed' });
  }
});

// app.post('/api/dice-roll', requireSecret, standardLimiter, async (_, res) => {
//   const { randomInt } = require('crypto');
//   res.json({ roll: randomInt(1, 7) }); // 1–6 inclusive, cryptographically secure
// });

// ─── Arena Instant Match (Challenge AI v3) ──────────────────────────────────
// MARKOV served over HTTP: instant best-of-5 RPS, commit-reveal fairness,
// no wagers, no chain in the loop. See lib/arenaMatch.js for the engine.
const { ArenaMatchEngine } = require('../lib/arenaMatch');
const { attestInstantMatch } = require('../lib/feedbackOracle');

// Ladder bucket, SEASON-ALIGNED. The ladder now resets on the SAME clock as the
// skill games (Rhythm/Simon/Stack): the fixed SEASON_EPOCH, 7-day windows, so
// Challenge AI and the skill leaderboards roll over together. Key form 'S<n>'
// (e.g. 'S24'). Older rows use the legacy ISO 'YYYY-Www' form and stay viewable
// as past weeks. The payout runs on the season boundary, not Sunday.
function arenaWeekKey(d = new Date()) {
  const t = Math.floor(d.getTime() / 1000);
  const season = Math.floor((t - core.SEASON_EPOCH) / (core.SEASON_DAYS * 86400)) + 1;
  return `S${season}`;
}

// Per-wallet standings for one ladder week, sorted best-first.
//
// Fast path: a Postgres aggregate (arena_ladder_standings) does the GROUP BY
// server-side and returns one row per wallet — small, bounded, index-scanned,
// and immune to the 1000-row response cap no matter how many matches exist.
// Fallback: if that function isn't migrated yet, page through the raw rows so
// the ladder is still correct (just less efficient) until the migration lands.
async function arenaLadderStandings(week) {
  try {
    const { data, error } = await core.supabase.rpc('arena_ladder_standings', { p_week: week });
    if (error) throw error;
    return (data || []).map((r) => ({
      wallet: r.wallet,
      points: Number(r.points) || 0,   // bigint arrives as a string over the wire
      matches: Number(r.matches) || 0,
      wins: Number(r.wins) || 0,
    })).sort((x, y) => y.points - x.points || y.wins - x.wins);
  } catch (e) {
    console.warn('arena_ladder_standings rpc unavailable, paging raw rows:', e?.message || e);
    const PAGE = 1000;
    const agg = new Map();
    for (let from = 0; ; from += PAGE) {
      const { data: chunk, error } = await core.supabase
        .from('arena_free_matches')
        .select('wallet, points, outcome')
        .eq('week_key', week)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!chunk || chunk.length === 0) break;
      for (const row of chunk) {
        const a = agg.get(row.wallet) || { wallet: row.wallet, points: 0, matches: 0, wins: 0 };
        a.points += row.points || 0;
        a.matches += 1;
        if (row.outcome === 'player_won') a.wins += 1;
        agg.set(row.wallet, a);
      }
      if (chunk.length < PAGE) break;
    }
    return [...agg.values()].sort((x, y) => y.points - x.points || y.wins - x.wins);
  }
}

// Ladder points per match. Wins pay, participation trickles, sweeps bonus.
// Points are infinite; G$ is budgeted — the weekly pool pays ranks, so the
// per-match formula can be generous without any treasury risk.
function arenaPoints(session) {
  const won = session.playerWins > session.aiWins;
  const tied = session.playerWins === session.aiWins;
  let pts = won ? 10 : tied ? 4 : 2;
  if (won && session.aiWins === 0) pts += 3; // flawless sweep vs the model
  return pts;
}
},

];
