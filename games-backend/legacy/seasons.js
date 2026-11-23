// ─── seasons ──────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── Season helpers ──
function* (core) {
  Object.defineProperties(core, {
    currentSeasonNumber: { get: () => currentSeasonNumber, enumerable: true, configurable: true },
    seasonBounds: { get: () => seasonBounds, enumerable: true, configurable: true },
    SEASON_EPOCH: { get: () => SEASON_EPOCH, enumerable: true, configurable: true },
    SEASON_DAYS: { get: () => SEASON_DAYS, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Season helpers ─────────────────────────────────────────────────────────
const SEASON_EPOCH = 1770249600;
const SEASON_DAYS = 7;

function currentSeasonNumber() {
  const elapsed = Math.floor(Date.now() / 1000) - SEASON_EPOCH;
  return Math.floor(elapsed / (SEASON_DAYS * 86400)) + 1;
}

function seasonBounds(n) {
  const start = SEASON_EPOCH + (n - 1) * SEASON_DAYS * 86400;
  const end = start + SEASON_DAYS * 86400;
  return { start, end };
}
},

// ── Seal seasons ──
function* (core) {
  Object.defineProperties(core, {
    sealCompletedSeasons: { get: () => sealCompletedSeasons, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Seal seasons ───────────────────────────────────────────────────────────
async function sealCompletedSeasons() {
  const current = core.currentSeasonNumber();

  // Get already sealed seasons
  const { data: sealed } = await core.supabase
    .from('seasons')
    .select('season_number')
    .eq('sealed', true);
  const sealedSet = new Set((sealed || []).map(s => s.season_number));

  for (let n = 1; n < current; n++) {
    if (sealedSet.has(n)) continue;

    const { start, end } = core.seasonBounds(n);

    // Get scores for this season
    const startDate = new Date(start * 1000).toISOString();
    const endDate = new Date(end * 1000).toISOString();

    // Deduplicate: best score per wallet per season
    const dedup = (rows) => {
      const seen = new Map();
      for (const row of (rows || [])) {
        const key = row.wallet_address?.toLowerCase();
        if (!key) continue;
        if (!seen.has(key) || row.score > seen.get(key).score) seen.set(key, row);
      }
      return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, 10);
    };

    // Fan-out one query per registered game. New games (e.g. Stack
    // Tower) join the season seal automatically once they're in
    // VALID_GAMES — no per-game block to keep in sync.
    const perGame = await Promise.all(core.VALID_GAMES.map(async (game) => {
      const { data } = await core.supabase
        .from('activity')
        .select('*')
        .eq('game', game)
        .gte('created_at', startDate)
        .lt('created_at', endDate)
        .order('score', { ascending: false })
        .limit(500);
      return { game, entries: dedup(data) };
    }));

    // Upsert season record
    await core.supabase.from('seasons').upsert({
      season_number: n,
      start_ts: start,
      end_ts: end,
      prize_pot: 50,
      sealed: true,
    }, { onConflict: 'season_number' });

    // Award badges to top 3 per game
    const badgeTypes = ['gold', 'silver', 'bronze'];
    for (const { entries, game } of perGame) {
      for (let i = 0; i < Math.min(3, entries.length); i++) {
        await core.supabase.from('badges').upsert({
          wallet_address: entries[i].wallet_address,
          game,
          season_number: n,
          badge: badgeTypes[i],
        }, { onConflict: 'wallet_address,game,season_number' });
      }
    }

    console.log(`🏆 Season ${n} sealed — ${perGame.map(p => `${p.entries.length} ${p.game}`).join(', ')}`);
  }

  // Ensure current season exists
  const { data: currentSeason } = await core.supabase
    .from('seasons')
    .select('season_number')
    .eq('season_number', current)
    .single();

  if (!currentSeason) {
    const { start, end } = core.seasonBounds(current);
    await core.supabase.from('seasons').insert({
      season_number: current,
      start_ts: start,
      end_ts: end,
      prize_pot: 50,
      sealed: false,
    });
  }
}
},

// ── GET /api/seasons ──
function* (core) {
  Object.defineProperties(core, {
    seasonsService: { get: () => seasonsService, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── GET /api/seasons ───────────────────────────────────────────────────────
// This week's standings and every sealed week before it. Each sealed season is
// read from the database once per process and kept, because it can never
// change. Logic: src/modules/seasons/service.ts.
const seasonsService = core.platform.registerSeasonsRoutes(core.app, {
  games: core.VALID_GAMES,
  currentSeason: () => core.currentSeasonNumber(),
  seasonBounds: (season) => core.seasonBounds(season),
  topActivity: core.platform.supabaseTopActivity(core.supabase),
  sealedSeasons: core.platform.supabaseSealedSeasons(core.supabase),
  resolveUsername: (wallet) => core.resolveUsernameChecked(wallet),
  cache: { get: (key) => core.cacheGet(key), set: (key, value, ttlMs) => core.cacheSet(key, value, ttlMs) },
  ttlMs: core.MEM_TTL.global,
});
},

// ── Season 1: credit habitat ownership as season points ──
function* (core) {
  Object.defineProperties(core, {
    fetchPaidOwnership: { get: () => fetchPaidOwnership, enumerable: true, configurable: true },
    creditHabitatPoints: { get: () => creditHabitatPoints, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Season 1: credit habitat ownership as season points ───────────────────
// Each paid tier (6–10) the wallet owns is worth +30 pts once per season.
// Idempotent via a season-tagged ref so re-running never double-credits;
// the v1 prefix future-proofs Season 2's credit pass against the unique
// constraint already on (wallet, action_type, ref). Designed for fire-and-
// forget invocation — failures log but don't surface to the caller so any
// caller (habitat page, season-me) stays fast.
async function creditHabitatPoints(wallet, ownedPaidTiers) {
  try {
    const lower = String(wallet || '').toLowerCase();
    const tiers = Array.isArray(ownedPaidTiers) ? ownedPaidTiers : [];
    if (!lower || tiers.length === 0) return;

    const { data: meta } = await core.supabase
      .from('season_v1_meta')
      .select('starts_at, ends_at')
      .eq('active', true)
      .maybeSingle();
    if (!meta) return;

    // Which tiers are already credited inside the active window?
    const { data: existing } = await core.supabase
      .from('season_v1_points')
      .select('ref')
      .ilike('wallet', lower)
      .eq('action_type', 'habitat_bought')
      .gte('occurred_at', meta.starts_at)
      .lte('occurred_at', meta.ends_at);
    const existingRefs = new Set((existing || []).map(r => r.ref));

    const rows = tiers
      .map(t => ({
        wallet: lower,
        action_type: 'habitat_bought',
        points: 30,
        ref: `habitat:v1:${t}`,
      }))
      .filter(r => !existingRefs.has(r.ref));

    if (rows.length === 0) return;
    const { error } = await core.supabase.from('season_v1_points').insert(rows);
    if (error) console.warn(`creditHabitatPoints insert failed for ${lower}:`, error.message);
  } catch (e) {
    console.warn(`creditHabitatPoints unexpected error for ${wallet}:`, e?.message || e);
  }
}

async function fetchPaidOwnership(addr) {
  const cached = core.habitatCache.get(addr);
  if (cached && Date.now() - cached.at < core.HABITAT_CACHE_TTL_MS) return cached;

  if (!core.habitatContract) {
    return { ownedPaidTiers: [], ubiDonated: '0', at: Date.now() };
  }

  try {
    // Batch all paid tier checks + donation read in parallel.
    const [ownsResults, ubi] = await Promise.all([
      Promise.all(core.HABITAT_PAID_TIERS.map(tier => core.habitatContract.ownsHabitat(addr, tier))),
      core.habitatContract.playerUbiDonated(addr),
    ]);
    const ownedPaidTiers = core.HABITAT_PAID_TIERS.filter((_, i) => ownsResults[i] === true);
    const result = { ownedPaidTiers, ubiDonated: ubi.toString(), at: Date.now() };
    core.habitatCache.set(addr, result);
    return result;
  } catch (e) {
    console.warn(`Habitat ownership read failed for ${addr}:`, e?.message || e);
    return { ownedPaidTiers: [], ubiDonated: '0', at: Date.now() };
  }
}
},

// ── GET /api/season/sync-habitats?wallet=X ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── GET /api/season/sync-habitats?wallet=X ─────────────────────────────────
// Reconciles on-chain habitat ownership against the season_v1_points ledger
// for one wallet. Called by /api/season/me right before it reads points so
// the personal score always reflects the latest purchase without needing a
// habitat page visit. Idempotent (creditHabitatPoints filters already-
// credited refs), so /api/season/me can call it on every read.
core.app.get('/api/season/sync-habitats', async (req, res) => {
  const wallet = String(req.query.wallet || '').toLowerCase().trim();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet' });
  }
  const { ownedPaidTiers } = await core.fetchPaidOwnership(wallet);
  await core.creditHabitatPoints(wallet, ownedPaidTiers);
  res.json({ ok: true, owned: ownedPaidTiers });
});
},

// ── Season-ending cron ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── Season-ending cron ──────────────────────────────────────────────────────
// Fires every 15 min. In the final hour of the weekly season, pings every
// subscribed wallet with rank-aware copy: top-3 get "hold the podium",
// everyone else gets "last chance to climb". Best rank across both games
// wins (lower number = better). Category includes season number so the
// same player gets pinged once per season, not blocked across weeks.
async function sendSeasonEndingPings() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const seasonNum = core.currentSeasonNumber();
    const seasonStart = core.SEASON_EPOCH + (seasonNum - 1) * core.SEASON_DAYS * 86400;
    const seasonEnd   = seasonStart + core.SEASON_DAYS * 86400;
    const minsLeft = Math.floor((seasonEnd - nowSec) / 60);
    if (minsLeft <= 0 || minsLeft > 60) return;

    // Build wallet → best-rank map across both games (top 50 each)
    const rankMap = new Map();
    for (const game of core.VALID_GAMES) {
      const gameTypeInt = core.GAME_TYPE[game];
      let board = [];
      try {
        board = await core.subgraph.leaderboard(gameTypeInt, seasonStart, 50);
      } catch (_) { continue; }
      board.forEach((e, idx) => {
        if (!e?.wallet_address) return;
        const w = e.wallet_address.toLowerCase();
        const rank = idx + 1;
        const prev = rankMap.get(w);
        if (prev == null || rank < prev) rankMap.set(w, rank);
      });
    }

    const { data: subs } = await core.supabase
      .from('push_subscriptions')
      .select('wallet_address');
    const wallets = [...new Set((subs || []).map(s => s.wallet_address))];
    if (wallets.length === 0) return;

    const category = `season_ending_${seasonNum}`;
    let sent = 0;
    for (const w of wallets) {
      const rank = rankMap.get(w) || 0;
      const payload = core.push.seasonEndingNotification(rank);
      const ok = await core.push.sendToWallet(core.supabase, w, category, payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`⌛ Season-ending pings sent to ${sent} wallets (season ${seasonNum})`);
  } catch (e) {
    console.warn('season-ending cron failed:', e?.message || e);
  }
}

core.jobs.every('sendSeasonEndingPings', 15 * 60 * 1000, sendSeasonEndingPings);
},

];
