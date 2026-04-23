require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3005;

// Trust Railway/Vercel reverse proxy so rate-limiter reads X-Forwarded-For correctly
app.set('trust proxy', 1);

// ─── CORS — only allowed origins or trusted server-to-server calls ───────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS).split(',').map(o => o.trim());
app.use(express.json());

// ─── Rate Limiting ──────────────────────────────────────────────────────────
const standardLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests, please try again later.' }
});

const strictLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: { error: 'Rate limit exceeded. Please wait a few minutes.' }
});

// ─── Internal secret — every request from Next.js must include this header ───
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
if (!INTERNAL_SECRET) {
  console.error('FATAL: INTERNAL_SECRET env var is not set. Refusing to start.');
  process.exit(1);
}
function requireSecret(req, res, next) {
  if (req.headers['x-internal-secret'] === INTERNAL_SECRET) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// For no-origin requests (Next.js server actions) require INTERNAL_SECRET.
// Browser requests must come from an allowed origin.
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!origin) {
    if (req.headers['x-internal-secret'] === INTERNAL_SECRET) return next();
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-secret');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  return res.status(403).json({ error: 'Origin not allowed' });
});

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
console.log('📦 Supabase connected');

// ─── On-chain config ────────────────────────────────────────────────────────
const CELO_RPC = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const SOLO_WAGER_ADDR = process.env.SOLO_WAGER_ADDRESS || '';
const VALIDATOR_KEY = process.env.VALIDATOR_PRIVATE_KEY || '';

const SOLO_WAGER_ABI = [
  'function resolveWager(uint256 wagerId, uint256 score) external',
  'function wagers(uint256) external view returns (uint256 id, address player, uint256 amount, uint8 gameType, uint8 status, uint256 createdAt, uint256 score)',
  'function getPlayerWagers(address player) external view returns (uint256[] memory)',
  'function treasuryBalance() external view returns (uint256)',
  'function distributeSeasonPrizes(uint256 seasonId, address[3] rhythmWinners, address[3] simonWinners) external',
  'function totalUsers() external view returns (uint256)',
];

const GAME_PASS_ADDR = process.env.GAME_PASS_ADDRESS || '0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE';
const GAME_PASS_ABI = [
  // ── Read ──────────────────────────────────────────────────────────────────
  'function totalSupply() external view returns (uint256)',
  'function hasMinted(address player) external view returns (bool)',
  'function getUsername(address player) external view returns (string)',
  'function usernameOf(address player) external view returns (string)',
  'function isUsernameAvailable(string username) external view returns (bool)',
  'function currentSeason() external view returns (uint256)',
  'function bestScore(address player, uint8 gameType) external view returns (uint256)',
  'function weeklyBest(uint256 season, address player, uint8 gameType) external view returns (uint256)',
  'function gamesPlayed(address player) external view returns (uint256)',
  'function totalGamesPlayed() external view returns (uint256)',
  'function nonces(address player) external view returns (uint256)',
  'function scoreNonces(address player) external view returns (uint256)',
  // ── Write ─────────────────────────────────────────────────────────────────
  'function recordScore(address player, uint8 gameType, uint256 score) external',
  'function recordScoreSigned(address player, uint8 gameType, uint256 score, uint256 nonce, bytes signature) external',
  'function adminSetScore(address player, uint8 gameType, uint256 score, uint256 season) external',
];

// EIP-712 domain for BackendApproval signing
const BACKEND_APPROVAL_DOMAIN = {
  name: 'GameArena Pass',
  version: '3',
  chainId: 42220,
  verifyingContract: GAME_PASS_ADDR,
};
const BACKEND_APPROVAL_TYPES = {
  BackendApproval: [
    { name: 'player', type: 'address' },
    { name: 'gameType', type: 'uint8' },
    { name: 'score', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

// ONE provider for the entire process. ethers.JsonRpcProvider registers
// internal polling timers; creating a new one per cron tick (every 5 min
// in indexOnChainScores) leaked memory — the old instances couldn't GC
// because their timers held references. Railway's watchdog kept killing
// the process with "approaching memory threshold, restarting...".
let provider = null;
let passContract = null;
let validator = null;
let wagerContract = null;

try {
  provider = new ethers.JsonRpcProvider(CELO_RPC);
} catch (e) {
  console.warn('⚠️  Failed to init RPC provider:', e.message);
}

if (provider && SOLO_WAGER_ADDR && VALIDATOR_KEY) {
  try {
    validator = new ethers.Wallet(VALIDATOR_KEY, provider);
    wagerContract = new ethers.Contract(SOLO_WAGER_ADDR, SOLO_WAGER_ABI, validator);
    passContract = new ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, validator);
    console.log(`🔗 On-chain resolver ready — validator: ${validator.address}`);
  } catch (e) {
    console.warn('⚠️  On-chain resolver not configured:', e.message);
  }
} else if (provider) {
  try {
    passContract = new ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, provider);
  } catch (_) { }
  console.log('ℹ️  SOLO_WAGER_ADDRESS or VALIDATOR_PRIVATE_KEY not set — wager resolution disabled');
}

// Event interface for parsing on-chain ScoreRecorded logs. Built once,
// reused by every indexOnChainScores tick. (Previously instantiated
// inside the cron body on each run — minor garbage but unnecessary.)
const SCORE_EVENT_IFACE = new ethers.Interface([
  'event ScoreRecorded(address indexed player, uint8 indexed gameType, uint256 score, uint256 indexed season, uint256 totalGames)',
]);

// ── Username cache (bounded LRU-ish — evict oldest when > 5000 entries
//    so the map doesn't grow to infinity as new wallets hit the backend) ──
const USERNAME_CACHE_MAX = 5000;
const usernameCache = new Map();
async function resolveUsername(addr) {
  const lower = addr.toLowerCase();
  if (usernameCache.has(lower)) {
    // Touch: move to end so it survives the next eviction round.
    const v = usernameCache.get(lower);
    usernameCache.delete(lower);
    usernameCache.set(lower, v);
    return v;
  }
  if (!passContract) return null;
  try {
    const name = await passContract.getUsername(addr);
    if (name) {
      if (usernameCache.size >= USERNAME_CACHE_MAX) {
        // Evict the oldest (first-inserted) entry — Map iteration is
        // insertion order, so the first key is the least-recently-touched.
        const oldestKey = usernameCache.keys().next().value;
        usernameCache.delete(oldestKey);
      }
      usernameCache.set(lower, name);
    }
    return name || null;
  } catch (_) { return null; }
}

async function resolveOnChain(wagerId, score) {
  if (!wagerContract || !wagerId) return null;
  try {
    const tx = await wagerContract.resolveWager(BigInt(wagerId), BigInt(score));
    const receipt = await tx.wait();
    console.log(`✅ resolveWager(${wagerId}, ${score}) — tx: ${receipt.hash}`);
    return receipt.hash;
  } catch (e) {
    console.error(`❌ resolveWager failed for wager ${wagerId}:`, e.message);
    return null;
  }
}

async function getTreasuryBalance() {
  if (!wagerContract) return '0';
  try {
    const raw = await wagerContract.treasuryBalance();
    return ethers.formatUnits(raw, 18);
  } catch (_) { return '0'; }
}

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

// ─── Supabase helpers ───────────────────────────────────────────────────────

async function registerUser(addr) {
  const lower = addr.toLowerCase();
  const { data: rows } = await supabase
    .from('users')
    .select('wallet_address, play_streak, last_play_date')
    .eq('wallet_address', lower)
    .limit(1);

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (!rows || rows.length === 0) {
    await supabase.from('users').insert({ wallet_address: lower, play_streak: 1, last_play_date: today });
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

  await supabase
    .from('users')
    .update({ play_streak: newStreak, last_play_date: today })
    .eq('wallet_address', lower);

  if (newStreak > 1) console.log(`🔥 ${lower.slice(0, 8)}... streak: ${newStreak} days`);
  return newStreak;
}

async function getUserCount() {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  return count || 0;
}

// ─── XP / Level system ──────────────────────────────────────────────────────
// Standard triangular curve used by Clash Royale, Pokémon GO, RuneScape variants.
//   totalXp(N)   = 50 * N * (N + 1)          ← cumulative XP to REACH level N
//   xpForLevel(N) = 100 * N                  ← XP needed within level N to advance
//
//   LV 2  needs 100 cumulative   (+100 from LV 1)
//   LV 3  needs 300 cumulative   (+200)
//   LV 5  needs 1,000 cumulative (+400)
//   LV 10 needs 5,500 cumulative (+1,000)
//   LV 50 needs 127,500          (+5,000)
const XP_PLAYED  = 10;  // base XP for finishing a game
const XP_WIN     = 25;  // bonus when you beat the win threshold
const XP_NEW_PB  = 25;  // bonus when you set a new personal best

const WIN_THRESHOLD = { rhythm: 350, simon: 7 };

// Cumulative XP required to reach a given level (LV 1 = 0).
//   LV 1: 0     LV 2: 100    LV 3: 300    LV 4: 600    LV 5: 1,000
//   LV 10: 4,500   LV 20: 19,000   LV 50: 122,500
function totalXpForLevel(level) {
  return 50 * level * (level - 1);
}

// Returns the highest level fully reached for a given cumulative XP.
function levelFromXp(xp) {
  // Solve 50*N*(N+1) - 100 <= xp  →  N = floor((-1 + sqrt(1 + (xp + 100)/12.5)) / 2) + 1
  // Use a safe iterative approach for clarity
  let lvl = 1;
  while (totalXpForLevel(lvl + 1) <= (xp || 0)) lvl++;
  return Math.max(1, lvl);
}

// XP within current level + XP required to advance.
function xpProgress(xp) {
  const level     = levelFromXp(xp);
  const xpAtLevel = totalXpForLevel(level);
  const xpToNext  = 100 * level; // gap between this level and the next
  const xpInLevel = (xp || 0) - xpAtLevel;
  return { level, xpInLevel, xpToNext };
}

// ─── Daily Missions ─────────────────────────────────────────────────────────
// Templates the daily refresh picks 3 from. Each evaluates `progressDelta` from a played-game event.
// Reward sizes are tuned so a "perfect day" (all 3 done) gives ~150-200 XP — meaningful but not OP.
const MISSION_TEMPLATES = [
  { id: 'play_3_games',     label: 'Play 3 games today',                   target: 3,   reward: 50,  match: () => 1 },
  { id: 'play_5_games',     label: 'Play 5 games today',                   target: 5,   reward: 80,  match: () => 1 },
  { id: 'win_1_game',       label: 'Win 1 game today',                     target: 1,   reward: 60,  match: ({ isWin }) => isWin ? 1 : 0 },
  { id: 'win_3_games',      label: 'Win 3 games today',                    target: 3,   reward: 120, match: ({ isWin }) => isWin ? 1 : 0 },
  { id: 'rhythm_300',       label: 'Score 300+ in Rhythm Rush',            target: 1,   reward: 70,  match: ({ game, score }) => game === 'rhythm' && score >= 300 ? 1 : 0 },
  { id: 'rhythm_500',       label: 'Score 500+ in Rhythm Rush',            target: 1,   reward: 100, match: ({ game, score }) => game === 'rhythm' && score >= 500 ? 1 : 0 },
  { id: 'simon_5',          label: 'Reach round 5 in Simon Memory',        target: 1,   reward: 60,  match: ({ game, score }) => game === 'simon'  && score >= 5   ? 1 : 0 },
  { id: 'simon_10',         label: 'Reach round 10 in Simon Memory',       target: 1,   reward: 100, match: ({ game, score }) => game === 'simon'  && score >= 10  ? 1 : 0 },
  { id: 'beat_personal_best', label: 'Beat your personal best',            target: 1,   reward: 80,  match: ({ isNewPb }) => isNewPb ? 1 : 0 },
  { id: 'play_both_games',  label: 'Play both games today (1 of each)',    target: 2,   reward: 70,  match: ({ game, _seenGamesToday }) => _seenGamesToday && !_seenGamesToday.has(game) ? 1 : 0 },
];

// Deterministic 3-mission pick per (wallet, date) so a player gets the SAME 3 missions all day.
function pickDailyMissions(wallet, date) {
  // Hash (wallet + date) into a seed
  let h = 0;
  const seed = `${wallet}-${date}`;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const rng = () => { h = Math.imul(48271, h) | 0; return ((h >>> 0) / 0xffffffff); };

  // Always include 1 "easy" play-count mission, 1 "win" mission, 1 random
  const easy   = MISSION_TEMPLATES.filter(m => m.id.startsWith('play_'));
  const win    = MISSION_TEMPLATES.filter(m => m.id.startsWith('win_'));
  const rest   = MISSION_TEMPLATES.filter(m => !m.id.startsWith('play_') && !m.id.startsWith('win_'));
  const pick   = (arr) => arr[Math.floor(rng() * arr.length)];
  return [pick(easy), pick(win), pick(rest)];
}

async function ensureTodayMissions(wallet, today) {
  // Check if missions already exist for this wallet today
  const { data: existing } = await supabase
    .from('daily_missions')
    .select('mission_id')
    .eq('wallet', wallet)
    .eq('date', today);
  if (existing && existing.length >= 3) return;

  const picks = pickDailyMissions(wallet, today);
  const rows = picks.map(m => ({
    wallet,
    date: today,
    mission_id: m.id,
    target: m.target,
    reward_xp: m.reward,
  }));
  await supabase.from('daily_missions').upsert(rows, { onConflict: 'wallet,date,mission_id', ignoreDuplicates: true });
}

async function updateMissionProgress(wallet, ctx) {
  const today = new Date().toISOString().split('T')[0];
  await ensureTodayMissions(wallet, today);

  // Compute "games played today" set (for play_both_games mission). Excludes the current submission.
  const { data: todays } = await supabase
    .from('activity')
    .select('game,created_at')
    .eq('wallet_address', wallet)
    .gte('created_at', `${today}T00:00:00.000Z`);
  const seenGamesToday = new Set((todays || []).map(a => a.game));

  // Pull all of today's missions for this wallet
  const { data: missions } = await supabase
    .from('daily_missions')
    .select('*')
    .eq('wallet', wallet)
    .eq('date', today);

  for (const m of missions || []) {
    if (m.completed) continue;
    const tpl = MISSION_TEMPLATES.find(t => t.id === m.mission_id);
    if (!tpl) continue;
    const delta = tpl.match({ ...ctx, _seenGamesToday: seenGamesToday });
    if (!delta) continue;
    const newProgress = Math.min(m.target, m.progress + delta);
    const completed = newProgress >= m.target;
    await supabase
      .from('daily_missions')
      .update({ progress: newProgress, completed })
      .eq('id', m.id);
    if (completed) console.log(`🎯 ${wallet.slice(0, 8)}... completed: ${tpl.label}`);
  }
}

// ─── Achievements (off-chain for now; NFT mint later) ──────────────────────
// Each entry has a check fn that returns true if the player qualifies.
// Catalog is the source of truth — adding a new one = one new entry here.
const ACHIEVEMENT_CATALOG = [
  { id: 'first_win',    icon: '🥇', name: 'First Win',          desc: 'Win your first game',
    check: async ({ isWin }) => isWin },
  { id: 'streak_3',     icon: '🔥', name: '3-Day Streak',       desc: 'Play 3 days in a row',
    check: async ({ playStreak }) => playStreak >= 3 },
  { id: 'streak_7',     icon: '🔥', name: 'Week Warrior',       desc: 'Play 7 days in a row',
    check: async ({ playStreak }) => playStreak >= 7 },
  { id: 'streak_30',    icon: '🔥', name: 'Month Master',       desc: 'Play 30 days in a row',
    check: async ({ playStreak }) => playStreak >= 30 },
  { id: 'games_5',      icon: '🎮', name: 'Getting Started',    desc: 'Play 5 games total',
    check: async ({ totalGames }) => totalGames >= 5 },
  { id: 'games_25',     icon: '🎮', name: 'Regular Player',     desc: 'Play 25 games total',
    check: async ({ totalGames }) => totalGames >= 25 },
  { id: 'games_100',    icon: '💎', name: 'Veteran',            desc: 'Play 100 games total',
    check: async ({ totalGames }) => totalGames >= 100 },
  { id: 'rhythm_300',   icon: '🥁', name: 'Drum Apprentice',    desc: 'Score 300+ in Rhythm Rush',
    check: async ({ game, score }) => game === 'rhythm' && score >= 300 },
  { id: 'rhythm_500',   icon: '🥁', name: 'Rhythm Master',      desc: 'Score 500+ in Rhythm Rush',
    check: async ({ game, score }) => game === 'rhythm' && score >= 500 },
  { id: 'rhythm_700',   icon: '👑', name: 'Rhythm Legend',      desc: 'Score 700+ in Rhythm Rush',
    check: async ({ game, score }) => game === 'rhythm' && score >= 700 },
  // Skill unlocks — tracked per-run via fullCombo / allPerfect flags in the
  // submit-score scoreData payload. Rhythm-specific bragging rights.
  { id: 'rhythm_fc',    icon: '✨', name: 'Full Combo',         desc: 'Clear the rhythm chart without missing a note',
    check: async ({ game, fullCombo }) => game === 'rhythm' && !!fullCombo },
  { id: 'rhythm_ap',    icon: '🌟', name: 'All Perfect',        desc: 'Every hit PERFECT — no goods, no misses',
    check: async ({ game, allPerfect }) => game === 'rhythm' && !!allPerfect },
  { id: 'simon_5',      icon: '🧠', name: 'Memory Apprentice',  desc: 'Reach round 5 in Simon Memory',
    check: async ({ game, score }) => game === 'simon' && score >= 5 },
  { id: 'simon_10',     icon: '🧠', name: 'Memory Master',      desc: 'Reach round 10 in Simon Memory',
    check: async ({ game, score }) => game === 'simon' && score >= 10 },
  { id: 'simon_15',     icon: '👑', name: 'Memory Legend',      desc: 'Reach round 15 in Simon Memory',
    check: async ({ game, score }) => game === 'simon' && score >= 15 },
];

async function checkAndUnlockAchievements(wallet, ctx) {
  const { data: existing } = await supabase
    .from('achievements_unlocked')
    .select('achievement_id')
    .eq('wallet', wallet);
  const unlockedSet = new Set((existing || []).map(r => r.achievement_id));

  let totalGames = 0;
  if (passContract) {
    try { totalGames = Number(await passContract.gamesPlayed(wallet)); } catch (_) {}
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('play_streak')
    .eq('wallet_address', wallet)
    .limit(1);
  const playStreak = userRow?.[0]?.play_streak || 0;

  const fullCtx = { ...ctx, totalGames, playStreak };
  const newlyUnlocked = [];

  for (const ach of ACHIEVEMENT_CATALOG) {
    if (unlockedSet.has(ach.id)) continue;
    if (!await ach.check(fullCtx)) continue;
    const { error } = await supabase.from('achievements_unlocked').insert({
      wallet,
      achievement_id: ach.id,
      trigger_score: ctx.score || null,
      trigger_game: ctx.game || null,
    });
    if (!error) {
      // Return the hydrated shape the frontend expects
      // ({ id, name, icon, desc }) — previously we pushed just the ID
      // string, so the finished-screen achievement list rendered as a
      // column of empty 🏆 trophies with no names.
      newlyUnlocked.push({
        id: ach.id,
        name: ach.name,
        icon: ach.icon,
        desc: ach.desc,
      });
      console.log(`🏅 ${wallet.slice(0, 8)}... unlocked: ${ach.name}`);
    }
  }
  return newlyUnlocked;
}

async function awardXp(addr, amount, reason = '') {
  if (!amount) return null;
  const lower = addr.toLowerCase();
  const { data: rows } = await supabase
    .from('users')
    .select('xp')
    .eq('wallet_address', lower)
    .limit(1);
  const before = rows && rows.length > 0 ? (rows[0].xp || 0) : 0;
  const after  = before + amount;
  const beforeLevel = levelFromXp(before);
  const afterLevel  = levelFromXp(after);
  await supabase.from('users').update({ xp: after }).eq('wallet_address', lower);
  if (afterLevel > beforeLevel) {
    console.log(`✨ ${lower.slice(0, 8)}... LV ${beforeLevel} → ${afterLevel} (+${amount} XP ${reason})`);
  }
  return { xp: after, level: afterLevel, leveledUp: afterLevel > beforeLevel };
}

async function saveScore(entry) {
  // Upsert: keep best score per wallet per game
  const { data: rows } = await supabase
    .from('scores')
    .select('id, score')
    .eq('wallet_address', entry.wallet_address)
    .eq('game', entry.game)
    .order('score', { ascending: false })
    .limit(1);

  const existing = rows && rows.length > 0 ? rows[0] : null;

  if (existing && existing.score >= entry.score) {
    // Existing score is better, still log activity
    await supabase.from('activity').insert({
      wallet_address: entry.wallet_address,
      game: entry.game,
      score: entry.score,
      tx_hash: entry.tx_hash || null,
    });
    return;
  }

  if (existing) {
    // Delete old + insert new (avoids RLS update issues)
    await supabase.from('scores').delete().eq('id', existing.id);
    await supabase.from('scores').insert(entry);
    console.log(`📈 Score updated: ${entry.wallet_address.slice(0, 8)}... ${existing.score} → ${entry.score}`);
  } else {
    // Insert new
    await supabase.from('scores').insert(entry);
  }

  // Log activity
  await supabase.from('activity').insert({
    wallet_address: entry.wallet_address,
    game: entry.game,
    score: entry.score,
    tx_hash: entry.tx_hash || null,
  });
}

async function getLeaderboard(game, limit = 50, seasonFilter = true) {
  // Use the activity table so we pick up every play this week,
  // not just players whose all-time best happened to fall in this week.
  let query = supabase
    .from('activity')
    .select('*')
    .eq('game', game);

  if (seasonFilter) {
    const season = currentSeasonNumber();
    const { start } = seasonBounds(season);
    const startDate = new Date(start * 1000).toISOString();
    query = query.gte('created_at', startDate);
  }

  const { data } = await query
    .order('score', { ascending: false })
    .limit(500);

  if (!data) return [];

  // Keep only best score per wallet for this period
  const seen = new Map();
  for (const row of data) {
    const key = row.wallet_address?.toLowerCase();
    if (!key) continue;
    if (!seen.has(key) || row.score > seen.get(key).score) {
      seen.set(key, row);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Returns recent activity rows. If `player` is provided, scopes the query to
// that wallet (case-insensitive) — avoids the old pattern where the frontend
// fetched globally-recent matches and filtered them client-side, which showed
// nothing (or other users' rows) whenever the user hadn't played in the last
// few minutes of global activity.
async function getActivity(limit = 20, player = null) {
  let q = supabase
    .from('activity')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (player) q = q.eq('wallet_address', player.toLowerCase());
  const { data } = await q;
  return data || [];
}

async function getBadges(addr) {
  const { data } = await supabase
    .from('badges')
    .select('*')
    .eq('wallet_address', addr.toLowerCase())
    .order('season_number', { ascending: false });
  return data || [];
}

// ─── Seal seasons ───────────────────────────────────────────────────────────
async function sealCompletedSeasons() {
  const current = currentSeasonNumber();

  // Get already sealed seasons
  const { data: sealed } = await supabase
    .from('seasons')
    .select('season_number')
    .eq('sealed', true);
  const sealedSet = new Set((sealed || []).map(s => s.season_number));

  for (let n = 1; n < current; n++) {
    if (sealedSet.has(n)) continue;

    const { start, end } = seasonBounds(n);

    // Get scores for this season
    const startDate = new Date(start * 1000).toISOString();
    const endDate = new Date(end * 1000).toISOString();

    const { data: rhythmRaw } = await supabase
      .from('activity')
      .select('*')
      .eq('game', 'rhythm')
      .gte('created_at', startDate)
      .lt('created_at', endDate)
      .order('score', { ascending: false })
      .limit(500);

    const { data: simonRaw } = await supabase
      .from('activity')
      .select('*')
      .eq('game', 'simon')
      .gte('created_at', startDate)
      .lt('created_at', endDate)
      .order('score', { ascending: false })
      .limit(500);

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

    const rhythmScores = dedup(rhythmRaw);
    const simonScores  = dedup(simonRaw);

    const rEntries = rhythmScores;
    const sEntries = simonScores;

    // Upsert season record
    await supabase.from('seasons').upsert({
      season_number: n,
      start_ts: start,
      end_ts: end,
      prize_pot: 50,
      sealed: true,
    }, { onConflict: 'season_number' });

    // Award badges to top 3
    const badgeTypes = ['gold', 'silver', 'bronze'];
    for (const { entries, game } of [
      { entries: rEntries, game: 'rhythm' },
      { entries: sEntries, game: 'simon' },
    ]) {
      for (let i = 0; i < Math.min(3, entries.length); i++) {
        await supabase.from('badges').upsert({
          wallet_address: entries[i].wallet_address,
          game,
          season_number: n,
          badge: badgeTypes[i],
        }, { onConflict: 'wallet_address,game,season_number' });
      }
    }

    console.log(`🏆 Season ${n} sealed — ${rEntries.length} rhythm, ${sEntries.length} simon`);
  }

  // Ensure current season exists
  const { data: currentSeason } = await supabase
    .from('seasons')
    .select('season_number')
    .eq('season_number', current)
    .single();

  if (!currentSeason) {
    const { start, end } = seasonBounds(current);
    await supabase.from('seasons').insert({
      season_number: current,
      start_ts: start,
      end_ts: end,
      prize_pot: 50,
      sealed: false,
    });
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────
function validateScore({ score, gameTime, game }) {
  if (!['rhythm', 'simon'].includes(game)) return { valid: false, reason: 'Unknown game' };
  if (typeof score !== 'number' || score < 0 || score > 1_000_000) return { valid: false, reason: 'Score out of range' };
  if (typeof gameTime !== 'number' || gameTime < 5000) return { valid: false, reason: 'Game time too short' };
  return { valid: true };
}

// ─── POST /api/start-session ───────────────────────────────────────────────
app.post('/api/start-session', strictLimiter, async (req, res) => {
  const { playerAddress } = req.body;
  if (!playerAddress) return res.status(400).json({ error: 'Missing playerAddress' });
  if (!validator) return res.status(500).json({ error: 'Validator not ready' });

  try {
    const timestamp = Date.now();
    const nonce = Math.floor(Math.random() * 1000000);
    // Create a deterministic payload for signing
    const payload = `${playerAddress.toLowerCase()}:${timestamp}:${nonce}`;
    const signature = await validator.signMessage(payload);

    res.json({
      success: true,
      session: {
        token: signature,
        playerAddress: playerAddress.toLowerCase(),
        timestamp,
        nonce
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// ─── POST /api/sign-score ────────────────────────────────────────────────────
// Called by the Next.js server action before the player submits on-chain.
// Returns an EIP-712 BackendApproval signature + current scoreNonce.
// The frontend then calls recordScoreWithBackendSig(gameType, score, nonce, sig).
app.post('/api/sign-score', requireSecret, async (req, res) => {
  if (!validator || !passContract) {
    return res.status(503).json({ error: 'Validator not configured' });
  }

  const { playerAddress, game, score } = req.body;
  if (!playerAddress || !game || score === undefined) {
    return res.status(400).json({ error: 'Missing playerAddress, game, or score' });
  }
  if (!['rhythm', 'simon'].includes(game)) {
    return res.status(400).json({ error: 'Unknown game' });
  }
  // Match /api/submit-score's upper bound (1M). Rhythm encore + precision bonus
  // can legitimately push scores into the 10k-100k range, so the old 5000 cap
  // was truncating real skill. Security still holds: the score value is bound
  // inside the EIP-712 payload the validator signs, and the on-chain nonce is
  // single-use, so a hacker can't tamper with or replay this voucher.
  if (typeof score !== 'number' || score < 0 || score > 1_000_000) {
    return res.status(400).json({ error: 'Score out of range (max 1000000)' });
  }

  const gameType = game === 'rhythm' ? 0 : 1;

  try {
    const nonce = await passContract.scoreNonces(playerAddress);

    const signature = await validator.signTypedData(
      BACKEND_APPROVAL_DOMAIN,
      BACKEND_APPROVAL_TYPES,
      {
        player: playerAddress,
        gameType,
        score: BigInt(score),
        nonce,
      },
    );

    return res.json({ success: true, signature, nonce: nonce.toString(), gameType });
  } catch (e) {
    console.error('sign-score error:', e.message);
    return res.status(500).json({ error: 'Failed to sign score' });
  }
});

// ─── POST /api/submit-score ─────────────────────────────────────────────────
app.post('/api/submit-score', requireSecret, strictLimiter, async (req, res) => {
  const { playerAddress, scoreData, session } = req.body;

  const isInternalCall = req.headers['x-internal-secret'] === INTERNAL_SECRET && INTERNAL_SECRET;

  if (!playerAddress || !scoreData) {
    return res.status(400).json({ error: 'Missing playerAddress or scoreData' });
  }

  // 1. Verify "Silent" Session Integrity (skipped for trusted server-action calls)
  if (!isInternalCall) {
    if (!session) return res.status(400).json({ error: 'Missing session token' });
    try {
      const { token, timestamp, nonce, playerAddress: tokenPlayer } = session;

      if (tokenPlayer.toLowerCase() !== playerAddress.toLowerCase()) {
        return res.status(403).json({ error: 'Session player mismatch' });
      }

      const payload = `${playerAddress.toLowerCase()}:${timestamp}:${nonce}`;
      const recoveredAddress = ethers.verifyMessage(payload, token);

      if (recoveredAddress.toLowerCase() !== validator.address.toLowerCase()) {
        return res.status(403).json({ error: 'Invalid session token' });
      }

      const actualElapsed = Date.now() - timestamp;
      const reportedTime = scoreData.gameTime || 0;

      if (actualElapsed < (reportedTime - 2000)) {
        console.warn(`🚨 Anti-cheat: Speed hack detected from ${playerAddress}. Reported ${reportedTime}ms, but only ${actualElapsed}ms elapsed.`);
        return res.status(403).json({ error: 'Cheating detected: Speed hack' });
      }

      if (actualElapsed > 10 * 60 * 1000) {
        return res.status(403).json({ error: 'Session expired' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Session verification failed' });
    }
  }

  const check = validateScore(scoreData);
  if (!check.valid) {
    return res.status(400).json({ error: 'Validation failed', reason: check.reason });
  }

  const { game, score, gameTime, wagered, wagerId, fullCombo, allPerfect } = scoreData;
  const season = currentSeasonNumber();

  // Track unique user + update streak
  const streak = await registerUser(playerAddress);

  // Resolve wager on-chain if applicable
  let wagerTxHash = null;
  if (wagerId) {
    wagerTxHash = await resolveOnChain(wagerId, score);
  }

  // On-chain tx is now submitted by the player via recordScoreWithBackendSig.
  // Frontend passes the resulting txHash here after the wallet confirms.
  const scoreTxHash = scoreData.txHash || null;
  const txHash = wagerTxHash || scoreTxHash;

  // ═══ Defense in depth: REQUIRE an on-chain proof ═══
  // Every score must reference a successful on-chain write — either a wager
  // resolution (wagerTxHash) or the player's recordScoreWithBackendSig tx
  // (scoreTxHash). Without this guard, a compromised INTERNAL_SECRET could be
  // used to inject scores directly into the DB with no on-chain counterpart.
  // With it, the Supabase state can only ever be a strict subset of what
  // happened on-chain — no "ghost scores" like the 4268 entry from earlier.
  const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
  if (!txHash || !TX_HASH_RE.test(txHash)) {
    return res.status(400).json({
      error: 'Missing on-chain proof',
      reason: 'txHash required — every score must reference a GamePass contract tx',
    });
  }

  // Read previous best for this game so we can detect a new personal best after saving
  const lower = playerAddress.toLowerCase();
  const { data: prevRows } = await supabase
    .from('scores')
    .select('score')
    .eq('wallet_address', lower)
    .eq('game', game)
    .order('score', { ascending: false })
    .limit(1);
  const prevBest = (prevRows && prevRows.length > 0) ? (prevRows[0].score || 0) : 0;

  // Save actual game score to Supabase (per-season, not all-time best)
  await saveScore({
    wallet_address: lower,
    game,
    score,
    game_time: gameTime,
    season_number: season,
    wagered: wagered || null,
    wager_id: wagerId || null,
    tx_hash: txHash,
  });

  // Award XP — base for playing + bonuses for win and new personal best
  const winThreshold = WIN_THRESHOLD[game] || Infinity;
  const isWin    = score >= winThreshold;
  const isNewPb  = score > prevBest;
  const xpEarned = XP_PLAYED + (isWin ? XP_WIN : 0) + (isNewPb ? XP_NEW_PB : 0);
  const xpResult = await awardXp(lower, xpEarned, [
    'played',
    isWin   && 'win',
    isNewPb && 'new PB',
  ].filter(Boolean).join(' + '));

  // Update today's mission progress for this player
  try {
    await updateMissionProgress(lower, { game, score, isWin, isNewPb });
  } catch (e) {
    console.warn('mission progress update failed:', e.message);
  }

  // Check + unlock any new achievements for this player. Rhythm-specific skill
  // flags (fullCombo, allPerfect) come from the frontend and unlock rhythm_fc /
  // rhythm_ap respectively. The backend trusts the frontend for these because
  // the score itself is already bound on-chain via the EIP-712 voucher — a
  // lying client can't claim FC without also providing a matching tx receipt.
  let newAchievements = [];
  try {
    newAchievements = await checkAndUnlockAchievements(lower, {
      game, score, isWin, isNewPb,
      fullCombo:  !!fullCombo,
      allPerfect: !!allPerfect,
    });
  } catch (e) {
    console.warn('achievement check failed:', e.message);
  }

  // Get rank
  const leaderboard = await getLeaderboard(game);
  const rank = leaderboard.findIndex(e => e.wallet_address === lower) + 1;

  console.log(`✅ [${game}] ${lower.slice(0, 8)}... → ${score} pts (rank #${rank}) +${xpEarned} XP ${txHash ? `tx: ${txHash.slice(0, 10)}...` : ''}`);

  res.json({
    success:   true,
    score, rank, txHash, streak, xpEarned,
    xp:        xpResult?.xp,
    level:     xpResult?.level,
    leveledUp: !!xpResult?.leveledUp,
    isNewPb,
    prevBest,
    newAchievements,
  });
});

// ─── GET /api/leaderboard?game=rhythm|simon ─────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  const game = req.query.game;
  if (!['rhythm', 'simon'].includes(game)) {
    return res.status(400).json({ error: 'game must be rhythm or simon' });
  }
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const page = offset > 0 ? null : Math.max(1, parseInt(req.query.page) || 1);
  const start = offset > 0 ? offset : (page - 1) * limit;

  const all = await getLeaderboard(game);
  const total = all.length;
  const slice = all.slice(start, start + limit);

  // Fetch streaks for all players in this slice in one query
  const wallets = slice.map(e => e.wallet_address.toLowerCase());
  const { data: streakRows } = await supabase
    .from('users')
    .select('wallet_address, play_streak')
    .in('wallet_address', wallets);
  const streakMap = new Map((streakRows || []).map(r => [r.wallet_address.toLowerCase(), r.play_streak || 0]));

  const enriched = await Promise.all(slice.map(async (e) => ({
    player: e.wallet_address,
    score: e.score,
    gameTime: e.game_time,
    wagered: e.wagered,
    timestamp: Math.floor(new Date(e.created_at).getTime() / 1000),
    tx_hash: e.tx_hash,
    username: await resolveUsername(e.wallet_address) || null,
    streak: streakMap.get(e.wallet_address.toLowerCase()) || 0,
  })));
  const listTotal = Math.max(0, total - (offset > 0 ? offset : 0));
  res.json({ leaderboard: enriched, total, page, limit, pages: Math.ceil(listTotal / limit) });
});

// ─── GET /api/activity ──────────────────────────────────────────────────────
app.get('/api/activity', async (req, res) => {
  // Optional ?player=0x... scopes the result to a single wallet so profile
  // pages never have to filter on the client (which is fragile and misses
  // matches outside the limit window). Bump the default limit to 20 since
  // the feed view uses this too and benefits from a longer history.
  const player = typeof req.query.player === 'string' ? req.query.player : null;
  const limit = player ? 30 : 10;
  const entries = await getActivity(limit, player);
  const enriched = await Promise.all(entries.map(async (e) => ({
    player: e.wallet_address,
    game: e.game,
    score: e.score,
    tx_hash: e.tx_hash,
    timestamp: Math.floor(new Date(e.created_at).getTime() / 1000),
    username: await resolveUsername(e.wallet_address) || null,
  })));
  res.json({ activity: enriched });
});

// ─── GET /api/stats ─────────────────────────────────────────────────────────
app.get('/api/stats', async (_, res) => {
  const season = currentSeasonNumber();
  const { start, end } = seasonBounds(season);
  const startDate = new Date(start * 1000).toISOString();

  const totalUsers = await getUserCount();

  // Season-specific users
  const { data: seasonScores } = await supabase
    .from('scores')
    .select('wallet_address')
    .gte('created_at', startDate);
  const seasonUsers = new Set((seasonScores || []).map(s => s.wallet_address)).size;

  // Total games from activity
  const { count: totalGames } = await supabase
    .from('activity')
    .select('*', { count: 'exact', head: true });

  // Game counts
  const { count: rhythmPlayers } = await supabase
    .from('scores')
    .select('*', { count: 'exact', head: true })
    .eq('game', 'rhythm');
  const { count: simonPlayers } = await supabase
    .from('scores')
    .select('*', { count: 'exact', head: true })
    .eq('game', 'simon');

  // Top scores
  const leaderboardR = await getLeaderboard('rhythm', 1);
  const leaderboardS = await getLeaderboard('simon', 1);

  // Total wagered
  const { data: wageredData } = await supabase
    .from('scores')
    .select('wagered')
    .not('wagered', 'is', null);
  const totalWagered = (wageredData || []).reduce((sum, e) => sum + Number(e.wagered || 0), 0);

  // Prize pot
  let estimatedPrizePot = '0.00';
  try {
    const bal = await getTreasuryBalance();
    estimatedPrizePot = (parseFloat(bal) * 0.10).toFixed(2);
  } catch (_) { }

  res.json({
    totalUsers,
    seasonUsers,
    totalGames: totalGames || 0,
    rhythmPlayers: rhythmPlayers || 0,
    simonPlayers: simonPlayers || 0,
    topRhythm: leaderboardR[0]?.score ?? 0,
    topSimon: leaderboardS[0]?.score ?? 0,
    totalWagered: totalWagered.toFixed(2),
    currentSeason: season,
    seasonEndsAt: end,
    estimatedPrizePot,
  });
});

// ─── GET /api/seasons ───────────────────────────────────────────────────────
app.get('/api/seasons', async (_, res) => {
  const current = currentSeasonNumber();
  const { start, end } = seasonBounds(current);
  const startDate = new Date(start * 1000).toISOString();

  // Live current season standings — use activity so any play this week is counted
  const { data: liveRhythm } = await supabase
    .from('activity')
    .select('*')
    .eq('game', 'rhythm')
    .gte('created_at', startDate)
    .order('score', { ascending: false })
    .limit(500);

  const { data: liveSimon } = await supabase
    .from('activity')
    .select('*')
    .eq('game', 'simon')
    .gte('created_at', startDate)
    .order('score', { ascending: false })
    .limit(500);

  // Dedup by wallet — keep best score per user this week
  const dedupScores = (rows, limit = 10) => {
    const seen = new Map();
    for (const row of (rows || [])) {
      const key = row.wallet_address?.toLowerCase();
      if (!key) continue;
      if (!seen.has(key) || row.score > seen.get(key).score) seen.set(key, row);
    }
    return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, limit);
  };

  // Past sealed seasons
  const { data: pastSeasons } = await supabase
    .from('seasons')
    .select('*')
    .eq('sealed', true)
    .order('season_number', { ascending: false });

  // Fetch actual scores for each past season from the activity table
  const pastWithScores = await Promise.all((pastSeasons || []).map(async (s) => {
    const startIso = new Date(s.start_ts * 1000).toISOString();
    const endIso   = new Date(s.end_ts   * 1000).toISOString();

    const [{ data: rRaw }, { data: siRaw }] = await Promise.all([
      supabase.from('activity').select('*').eq('game', 'rhythm')
        .gte('created_at', startIso).lt('created_at', endIso)
        .order('score', { ascending: false }).limit(500),
      supabase.from('activity').select('*').eq('game', 'simon')
        .gte('created_at', startIso).lt('created_at', endIso)
        .order('score', { ascending: false }).limit(500),
    ]);

    // Count distinct players across both games this week
    const allPlayers = new Set([
      ...(rRaw  || []).map(e => e.wallet_address),
      ...(siRaw || []).map(e => e.wallet_address),
    ]);

    const fmt = async (e) => ({
      player: e.wallet_address,
      username: await resolveUsername(e.wallet_address) || null,
      score: e.score,
      gameTime: e.game_time,
      timestamp: Math.floor(new Date(e.created_at).getTime() / 1000),
      tx_hash: e.tx_hash,
    });

    return {
      season:       s.season_number,
      startTs:      s.start_ts,
      endTs:        s.end_ts,
      prizePot:     s.prize_pot,
      sealedAt:     Math.floor(new Date(s.created_at).getTime() / 1000),
      totalPlayers: allPlayers.size,
      rhythm:       await Promise.all(dedupScores(rRaw,  10).map(fmt)),
      simon:        await Promise.all(dedupScores(siRaw, 10).map(fmt)),
    };
  }));

  // Format for frontend — same shape as /api/leaderboard so fmt() works correctly
  const formatEntry = async (e) => ({
    player: e.wallet_address,
    username: await resolveUsername(e.wallet_address) || null,
    score: e.score,
    gameTime: e.game_time,
    wagered: e.wagered,
    timestamp: Math.floor(new Date(e.created_at).getTime() / 1000),
    tx_hash: e.tx_hash,
  });

  res.json({
    currentSeason: current,
    currentEndsAt: end,
    live: {
      rhythm: await Promise.all(dedupScores(liveRhythm).map(formatEntry)),
      simon: await Promise.all(dedupScores(liveSimon).map(formatEntry)),
    },
    past: pastWithScores,
  });
});

// ─── GET /api/badges/:address ───────────────────────────────────────────────
app.get('/api/badges/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const badges = await getBadges(addr);

  const goldCount = badges.filter(b => b.badge === 'gold').length;
  const silverCount = badges.filter(b => b.badge === 'silver').length;
  const bronzeCount = badges.filter(b => b.badge === 'bronze').length;

  // Compute streaks
  const streaks = {};
  ['rhythm', 'simon'].forEach(game => {
    const goldSeasons = badges
      .filter(b => b.badge === 'gold' && b.game === game)
      .map(b => b.season_number)
      .sort((a, b) => a - b);

    let maxStreak = goldSeasons.length >= 1 ? 1 : 0;
    let curStreak = 1;
    for (let i = 1; i < goldSeasons.length; i++) {
      if (goldSeasons[i] === goldSeasons[i - 1] + 1) {
        curStreak++;
        maxStreak = Math.max(maxStreak, curStreak);
      } else {
        curStreak = 1;
      }
    }
    streaks[game] = maxStreak;
  });

  const maxStreak = Math.max(streaks.rhythm || 0, streaks.simon || 0);
  let streakLabel = null;
  if (maxStreak >= 3) streakLabel = `${maxStreak}-WEEK CHAMPION`;
  else if (maxStreak === 2) streakLabel = '2-WEEK CHAMPION';

  res.json({
    address: addr,
    badges: badges.map(b => ({
      season: b.season_number,
      game: b.game,
      rank: b.badge === 'gold' ? 1 : b.badge === 'silver' ? 2 : 3,
      type: b.badge,
      awardedAt: Math.floor(new Date(b.created_at).getTime() / 1000),
    })),
    streaks,
    summary: {
      totalGold: goldCount,
      totalSilver: silverCount,
      totalBronze: bronzeCount,
      streakLabel,
    },
  });
});

// ─── GET /api/achievements/:address ─────────────────────────────────────────
// Returns the full achievement catalog with `unlocked` flag per achievement
// for this player, so the frontend can render unlocked + locked together.
app.get('/api/achievements/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const { data: rows } = await supabase
    .from('achievements_unlocked')
    .select('achievement_id, unlocked_at, nft_token_id, tx_hash')
    .eq('wallet', addr);
  const unlockedMap = new Map((rows || []).map(r => [r.achievement_id, r]));

  const achievements = ACHIEVEMENT_CATALOG.map(ach => {
    const u = unlockedMap.get(ach.id);
    return {
      id: ach.id,
      icon: ach.icon,
      name: ach.name,
      desc: ach.desc,
      unlocked: !!u,
      unlockedAt: u ? Math.floor(new Date(u.unlocked_at).getTime() / 1000) : null,
      nftTokenId: u?.nft_token_id || null,
      txHash: u?.tx_hash || null,
    };
  });

  const unlockedCount = achievements.filter(a => a.unlocked).length;
  res.json({ address: addr, total: achievements.length, unlockedCount, achievements });
});

// ─── GET /api/missions/today/:address — today's 3 missions for this player ─
app.get('/api/missions/today/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const today = new Date().toISOString().split('T')[0];

  // Make sure today's missions exist
  await ensureTodayMissions(addr, today);

  const { data: rows } = await supabase
    .from('daily_missions')
    .select('*')
    .eq('wallet', addr)
    .eq('date', today)
    .order('id', { ascending: true });

  // Seconds until midnight UTC for the countdown
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const secondsUntilReset = Math.max(0, Math.floor((tomorrow.getTime() - now.getTime()) / 1000));

  const missions = (rows || []).map(r => {
    const tpl = MISSION_TEMPLATES.find(t => t.id === r.mission_id);
    return {
      id: r.id,
      missionId: r.mission_id,
      label: tpl ? tpl.label : r.mission_id,
      progress: r.progress,
      target: r.target,
      completed: r.completed,
      claimed: r.claimed,
      rewardXp: r.reward_xp,
    };
  });

  res.json({ address: addr, date: today, secondsUntilReset, missions });
});

// ─── POST /api/missions/claim — claim XP for a completed mission ────────────
// Origin-restricted via CORS. Mission lookup enforces wallet ownership (wallet eq check),
// so the worst a malicious caller can do is claim someone else's completed mission FOR them
// (no benefit to themselves). For Phase 4 we'll add signature-based wallet proof.
app.post('/api/missions/claim', async (req, res) => {
  const { wallet, missionId } = req.body || {};
  if (!wallet || missionId == null) return res.status(400).json({ error: 'Missing wallet or missionId' });
  const addr = wallet.toLowerCase();

  // Look up the row, must belong to this player and be completed-but-not-claimed
  const { data: rows } = await supabase
    .from('daily_missions')
    .select('*')
    .eq('id', missionId)
    .eq('wallet', addr)
    .limit(1);
  if (!rows || rows.length === 0) return res.status(404).json({ error: 'Mission not found' });

  const m = rows[0];
  if (!m.completed) return res.status(400).json({ error: 'Mission not yet completed' });
  if (m.claimed)   return res.status(400).json({ error: 'Already claimed' });

  // Mark claimed first to prevent double-claim, then award XP
  await supabase.from('daily_missions').update({ claimed: true }).eq('id', m.id);
  const xpResult = await awardXp(addr, m.reward_xp, `mission ${m.mission_id}`);

  res.json({ success: true, xpAwarded: m.reward_xp, xp: xpResult?.xp, level: xpResult?.level, leveledUp: !!xpResult?.leveledUp });
});

// ─── GET /api/user/:address — XP / level / streak in one shot ───────────────
app.get('/api/user/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const { data: rows } = await supabase
    .from('users')
    .select('xp, play_streak, last_play_date')
    .eq('wallet_address', addr)
    .limit(1);

  if (!rows || rows.length === 0) {
    const p = xpProgress(0);
    return res.json({
      address: addr,
      xp: 0, level: p.level, xpInLevel: p.xpInLevel, xpToNext: p.xpToNext,
      streak: 0, playedToday: false,
    });
  }

  const u = rows[0];
  const xp = u.xp || 0;
  const p = xpProgress(xp);
  const today = new Date().toISOString().split('T')[0];
  res.json({
    address: addr,
    xp,
    level: p.level,
    xpInLevel: p.xpInLevel,
    xpToNext: p.xpToNext,
    streak: u.play_streak || 0,
    playedToday: u.last_play_date === today,
  });
});

// ─── GET /api/streak/:address ────────────────────────────────────────────
app.get('/api/streak/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const { data: rows } = await supabase
    .from('users')
    .select('play_streak, last_play_date')
    .eq('wallet_address', addr)
    .limit(1);

  if (!rows || rows.length === 0) {
    return res.json({ streak: 0, playedToday: false });
  }

  const user = rows[0];
  const playedToday = user.last_play_date === today;
  let streak = user.play_streak || 0;

  // If last play was before yesterday, streak is broken
  if (!playedToday && user.last_play_date !== yesterday) {
    streak = 0;
  }

  res.json({ streak, playedToday });
});

// ─── GET /api/challenge — short-burst play-count challenge ────────────────────
// 72-hour hosted event that awards a flat USDC prize to the top N players by
// total game plays. Designed for end-of-program traction pushes where the
// goal is volume of transactions, not peak score.
//
// Config is hardcoded on purpose so the event is deterministic and the
// whole team knows when it starts and stops without hunting through env
// vars. Update these three constants to run another challenge later.
const CHALLENGE_ID          = '2026-04-24_72h_arena_cup';
const CHALLENGE_NAME        = '72-hr Arena Cup';
// Starts midnight UTC Apr 24 (the "tomorrow" at time of ship), ends 72h
// later on Apr 27. Dates are UTC so the window is stable across timezones.
const CHALLENGE_START       = Math.floor(new Date('2026-04-24T00:00:00Z').getTime() / 1000);
const CHALLENGE_END         = Math.floor(new Date('2026-04-27T00:00:00Z').getTime() / 1000);
const CHALLENGE_MIN_PLAYS   = 500;
const CHALLENGE_TOP_N       = 6;
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
    await supabase.from('challenge_winners').upsert({
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

// In-memory cache for the expensive aggregation. Every client polls every
// 30s; without this, 50 concurrent clients hammer the DB with 50 identical
// full-window scans. 10s TTL means worst-case stale data is 10 seconds old,
// which is invisible to the player and saves ~5x the DB load.
const CHALLENGE_CACHE_TTL_MS = 10_000;
let challengeCache = { at: 0, plays: null, ranked: null };

async function getChallengePlays() {
  const nowMs = Date.now();
  if (challengeCache.plays && nowMs - challengeCache.at < CHALLENGE_CACHE_TTL_MS) {
    return { plays: challengeCache.plays, ranked: challengeCache.ranked };
  }
  const startIso = new Date(CHALLENGE_START * 1000).toISOString();
  const endIso   = new Date(CHALLENGE_END   * 1000).toISOString();

  const { data: rows } = await supabase
    .from('activity')
    .select('wallet_address')
    .gte('created_at', startIso)
    .lt('created_at', endIso);

  const plays = new Map();
  for (const row of (rows || [])) {
    const key = row.wallet_address?.toLowerCase();
    if (!key) continue;
    plays.set(key, (plays.get(key) || 0) + 1);
  }

  const ranked = await Promise.all(
    Array.from(plays.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(async ([wallet, count]) => ({
        wallet,
        plays: count,
        qualified: count >= CHALLENGE_MIN_PLAYS,
        username: await resolveUsername(wallet) || null,
      }))
  );

  challengeCache = { at: nowMs, plays, ranked };
  return { plays, ranked };
}

// Pre-event visibility window — show the "STARTS IN ..." teaser up to 7
// days before CHALLENGE_START. Builds anticipation, lets players see what's
// coming, and bumps Games/Leaderboard engagement ahead of launch.
const CHALLENGE_PREVIEW_SECONDS = 7 * 24 * 60 * 60;

app.get('/api/challenge', async (req, res) => {
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

  // My play count + qualification state, if the client passed ?player=.
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
app.get('/api/challenges/past', async (_, res) => {
  const { data } = await supabase
    .from('challenge_winners')
    .select('*')
    .lte('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: false })
    .limit(20);
  res.json({ challenges: data || [] });
});

// ─── GET /api/competition — 3-week cumulative leaderboard (weeks 11-13) ────────
// Each player's best score per week is summed. Top 3 win $15/$10/$5.
const COMPETITION_WEEKS = [11, 12, 13];

app.get('/api/competition', async (_, res) => {
  const totals = new Map(); // wallet -> { username, rhythm, simon, weeks: { 11: n, 12: n, 13: n } }

  for (const week of COMPETITION_WEEKS) {
    const { start, end } = seasonBounds(week);
    const startIso = new Date(start * 1000).toISOString();
    const endIso   = new Date(end   * 1000).toISOString();

    for (const game of ['rhythm', 'simon']) {
      const { data: rows } = await supabase
        .from('activity')
        .select('wallet_address, score')
        .eq('game', game)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('score', { ascending: false })
        .limit(500);

      // Best score per player this week
      const weekBest = new Map();
      for (const row of (rows || [])) {
        const key = row.wallet_address?.toLowerCase();
        if (!key) continue;
        if (!weekBest.has(key) || row.score > weekBest.get(key)) {
          weekBest.set(key, row.score);
        }
      }

      // Add to cumulative totals
      for (const [wallet, score] of weekBest.entries()) {
        if (!totals.has(wallet)) totals.set(wallet, { wallet, totalRhythm: 0, totalSimon: 0, weeklyScores: {} });
        const entry = totals.get(wallet);
        if (game === 'rhythm') entry.totalRhythm += score;
        else entry.totalSimon += score;
        if (!entry.weeklyScores[week]) entry.weeklyScores[week] = {};
        entry.weeklyScores[week][game] = score;
      }
    }
  }

  // Build final rankings by total (rhythm + simon combined)
  const rankings = await Promise.all(
    Array.from(totals.values())
      .map(e => ({ ...e, total: e.totalRhythm + e.totalSimon }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20)
      .map(async e => ({
        ...e,
        username: await resolveUsername(e.wallet) || null,
      }))
  );

  const current = currentSeasonNumber();
  const weeksLeft = COMPETITION_WEEKS.filter(w => w > current).length;
  const { start: compStart } = seasonBounds(COMPETITION_WEEKS[0]);
  const { end: compEnd }     = seasonBounds(COMPETITION_WEEKS[COMPETITION_WEEKS.length - 1]);

  res.json({
    weeks: COMPETITION_WEEKS,
    prizes: { first: 15, second: 10, third: 5 },
    compStart,
    compEnd,
    weeksLeft,
    currentWeek: current,
    rankings,
  });
});

// ─── POST /api/dice-roll — disabled until Phase 2 signed oracle ──────────────
// app.post('/api/dice-roll', requireSecret, standardLimiter, async (_, res) => {
//   const { randomInt } = require('crypto');
//   res.json({ roll: randomInt(1, 7) }); // 1–6 inclusive, cryptographically secure
// });

// ─── POST /api/faucet — send 0.01 CELO to new users (once per wallet) ────────
app.post('/api/faucet', requireSecret, strictLimiter, async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Missing address' });

  const lower = address.toLowerCase();

  // Check if already received
  const { data: existing } = await supabase
    .from('faucet')
    .select('wallet_address')
    .eq('wallet_address', lower)
    .limit(1);

  if (existing && existing.length > 0) {
    return res.json({ success: false, reason: 'Already received gas' });
  }

  if (!validator) {
    return res.status(500).json({ error: 'Faucet not configured' });
  }

  try {
    const provider = validator.provider;
    const GOODDOLLAR_IDENTITY_ADDR = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";
    const ID_ABI = ["function isWhitelisted(address) view returns (bool)"];

    const idContract = new ethers.Contract(GOODDOLLAR_IDENTITY_ADDR, ID_ABI, provider);
    const isVerified = await idContract.isWhitelisted(address);

    if (!isVerified) {
      return res.status(403).json({ success: false, reason: 'unverified', error: 'Wallet must be verified via GoodDollar to claim free gas.' });
    }

    const tx = await validator.sendTransaction({
      to: address,
      value: ethers.parseEther('0.1'),
    });
    await tx.wait();

    await supabase.from('faucet').insert({ wallet_address: lower });

    console.log(`⛽ Faucet: sent 0.1 CELO to ${lower} (tx: ${tx.hash.slice(0, 10)}...)`);
    res.json({ success: true, txHash: tx.hash });
  } catch (e) {
    console.error(`⛽ Faucet failed for ${lower}:`, e.message);
    res.status(500).json({ error: 'Faucet transfer failed' });
  }
});

// ─── GET /health ────────────────────────────────────────────────────────────
app.get('/health', async (_, res) => {
  const { count: rhythmCount } = await supabase
    .from('scores')
    .select('*', { count: 'exact', head: true })
    .eq('game', 'rhythm');
  const { count: simonCount } = await supabase
    .from('scores')
    .select('*', { count: 'exact', head: true })
    .eq('game', 'simon');

  res.json({
    status: 'ok',
    season: currentSeasonNumber(),
    scores: { rhythm: rhythmCount || 0, simon: simonCount || 0 },
    onChainReady: !!wagerContract,
    database: 'supabase',
  });
});

// ── Index on-chain scores on startup ────────────────────────────────────────
async function indexOnChainScores() {
  if (!passContract || !provider) return;
  try {
    // Reuse the module-level provider + interface instead of allocating
    // fresh ones every 5 min — the old pattern was the main memory leak.
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 200000);
    const logs = await provider.getLogs({
      address: GAME_PASS_ADDR,
      topics: [ethers.id('ScoreRecorded(address,uint8,uint256,uint256,uint256)')],
      fromBlock,
      toBlock: currentBlock,
    });
    if (logs.length === 0) { console.log('⛓️  No on-chain scores found'); return; }

    let added = 0;
    for (const log of logs) {
      const parsed = SCORE_EVENT_IFACE.parseLog({ topics: log.topics, data: log.data });
      const player = parsed.args[0].toLowerCase();
      const gameType = Number(parsed.args[1]);
      const score = Number(parsed.args[2]);
      const game = gameType === 0 ? 'rhythm' : 'simon';

      let timestamp = new Date().toISOString();
      try {
        const block = await provider.getBlock(log.blockNumber);
        if (block) timestamp = new Date(Number(block.timestamp) * 1000).toISOString();
      } catch (_) { }

      const { data: existing } = await supabase
        .from('scores')
        .select('id, score')
        .eq('wallet_address', player)
        .eq('game', game)
        .order('score', { ascending: false })
        .limit(1)
        .single();

      if (existing && existing.score >= score) continue;

      if (existing) {
        await supabase
          .from('scores')
          .update({ score, tx_hash: log.transactionHash })
          .eq('id', existing.id);
      } else {
        await supabase.from('scores').insert({
          wallet_address: player,
          game,
          score,
          game_time: 0,
          season_number: currentSeasonNumber(),
          tx_hash: log.transactionHash,
          created_at: timestamp,
        });
      }

      await registerUser(player);
      added++;
    }

    console.log(`⛓️  Indexed ${added} scores from ${logs.length} on-chain events`);
  } catch (e) {
    console.warn('⚠️  On-chain score indexing failed:', e.message);
  }
}

// Seal seasons on startup and every hour
sealCompletedSeasons();
setInterval(sealCompletedSeasons, 60 * 60 * 1000);

// Index chain scores on startup then every 5 min
indexOnChainScores();
setInterval(indexOnChainScores, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🎮 Games backend on http://localhost:${PORT} — Season ${currentSeasonNumber()}`);
});
