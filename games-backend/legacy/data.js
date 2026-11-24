// ─── data ─────────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── Supabase ──
function* (core) {
  Object.defineProperties(core, {
    supabase: { get: () => supabase, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Supabase ────────────────────────────────────────────────────────────────
// Every database call has a deadline. Without one, a database that stops
// answering holds each request open until the proxy gives up.
// Every reply from the database is measured, per table: see /internal/metrics → egress.
const egress = core.platform.createEgressMeter();
core.egress = egress;
const supabase = core.createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { global: { fetch: egress.wrap(core.platform.fetchWithTimeout(core.config.dbTimeoutMs)) } },
);
console.log('📦 Supabase connected');
},

// ── Supabase helpers ──
function* (core) {
  Object.defineProperties(core, {
    registerUser: { get: () => registerUser, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Supabase helpers ───────────────────────────────────────────────────────

async function registerUser(addr) {
  const lower = addr.toLowerCase();
  const { data: rows } = await core.supabase
    .from('users')
    .select('wallet_address, play_streak, last_play_date')
    .eq('wallet_address', lower)
    .limit(1);

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (!rows || rows.length === 0) {
    await core.supabase.from('users').insert({ wallet_address: lower, play_streak: 1, last_play_date: today });
    console.log(`👤 New user: ${lower}`);
    return 1;
  }

  const user = rows[0];
  if (user.last_play_date === today) {
    return user.play_streak || 1; // already played today
  }

  let newStreak;
  if (user.last_play_date === yesterday) {
    newStreak = (user.play_streak || 0) + 1;
  } else {
    newStreak = 1; // streak broken
  }

  await core.supabase
    .from('users')
    .update({ play_streak: newStreak, last_play_date: today })
    .eq('wallet_address', lower);

  if (newStreak > 1) console.log(`🔥 ${lower.slice(0, 8)}... streak: ${newStreak} days`);
  return newStreak;
}

async function getUserCount() {
  const { count } = await core.supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  return count || 0;
}
},

// ── In-memory cache to dramatically cut Supabase egress ──
function* (core) {
  Object.defineProperties(core, {
    cacheInvalidatePrefix: { get: () => cacheInvalidatePrefix, enumerable: true, configurable: true },
    memCache: { get: () => memCache, enumerable: true, configurable: true },
    subgraph: { get: () => subgraph, enumerable: true, configurable: true },
    cacheGet: { get: () => cacheGet, enumerable: true, configurable: true },
    cacheSet: { get: () => cacheSet, enumerable: true, configurable: true },
    MEM_TTL: { get: () => MEM_TTL, enumerable: true, configurable: true },
    getBadges: { get: () => getBadges, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── In-memory cache to dramatically cut Supabase egress ─────────────────────
// Most leaderboard/activity reads are duplicated across pageviews — a player
// scrolls the leaderboard, navigates away, comes back, refreshes. Each call
// shipped 50-500 rows over the network. With a 30s TTL we serve 95%+ of
// reads without hitting Supabase at all. Memory cost is trivial; egress
// savings are massive.
const memCache = new Map(); // key → { value, expires }
const MEM_TTL = {
  leaderboard: 30_000,   // 30s — leaderboards don't move that fast
  activity:    20_000,   // 20s — recent feed
  global:      60_000,   // 1min — stats, season metadata
};

function cacheGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { memCache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value, ttlMs) {
  memCache.set(key, { value, expires: Date.now() + ttlMs });
  // Bound the cache so it can't grow unbounded under attack.
  if (memCache.size > 500) {
    const oldestKey = memCache.keys().next().value;
    memCache.delete(oldestKey);
  }
  return value;
}

// Drop every cache key matching a prefix. Used after a score saves so the
// player's rank lookup reads fresh data and any new leaderboard request
// reflects the score they just submitted.
function cacheInvalidatePrefix(prefix) {
  for (const k of memCache.keys()) {
    if (k.startsWith(prefix)) memCache.delete(k);
  }
}

// ─── Subgraph client — source of truth for on-chain reads ────────────────────
// The subgraph owns every read that depends on score history, player
// identity, habitat ownership, and aggregates. Supabase keeps off-chain
// state only (XP, missions, streaks, achievements, equipped preference).
const subgraph = require('../lib/subgraph');

async function getLeaderboard(game, limit = 50, seasonFilter = true) {
  const cacheKey = `lb:${game}:${seasonFilter ? 'season' : 'all'}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Use the activity table so we pick up every play this week,
  // not just players whose all-time best happened to fall in this week.
  // Project narrowed columns — we don't need every field.
  let query = core.supabase
    .from('activity')
    .select('wallet_address, score, game_time, wagered, tx_hash, created_at')
    .eq('game', game);

  if (seasonFilter) {
    const season = core.currentSeasonNumber();
    const { start } = core.seasonBounds(season);
    const startDate = new Date(start * 1000).toISOString();
    query = query.gte('created_at', startDate);
  }

  const { data } = await query
    .order('score', { ascending: false })
    .limit(500);

  if (!data) return cacheSet(cacheKey, [], MEM_TTL.leaderboard);

  // Keep only best score per wallet for this period
  const seen = new Map();
  for (const row of data) {
    const key = row.wallet_address?.toLowerCase();
    if (!key) continue;
    if (!seen.has(key) || row.score > seen.get(key).score) {
      seen.set(key, row);
    }
  }

  const result = Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return cacheSet(cacheKey, result, MEM_TTL.leaderboard);
}

// Returns recent activity rows. Cached briefly because the feed is read
// constantly across many pages and the data only changes when someone plays.
async function getActivity(limit = 20, player = null) {
  const cacheKey = `act:${player || 'global'}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let q = core.supabase
    .from('activity')
    .select('wallet_address, game, score, tx_hash, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (player) q = q.eq('wallet_address', player.toLowerCase());
  const { data } = await q;
  return cacheSet(cacheKey, data || [], MEM_TTL.activity);
}

async function getBadges(addr) {
  const { data } = await core.supabase
    .from('badges')
    .select('*')
    .eq('wallet_address', addr.toLowerCase())
    .order('season_number', { ascending: false });
  return data || [];
}
},

];
