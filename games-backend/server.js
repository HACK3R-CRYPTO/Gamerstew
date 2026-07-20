require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const crypto = require('crypto');
const {
  physicsCheck:  rhythmPhysicsCheck,
  jitterCheck:   rhythmJitterCheck,
  computeScore:  rhythmComputeScore,
} = require('./lib/rhythmScoring');
const { computeStackScore, computeStackHumanness } = require('./lib/stackScoring');
const { computeSimonScore } = require('./lib/simonScoring');

const app = express();
const PORT = process.env.PORT || 3005;

// Trust Railway/Vercel reverse proxy so rate-limiter reads X-Forwarded-For correctly
app.set('trust proxy', 1);

// ─── CORS — only allowed origins or trusted server-to-server calls ───────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS).split(',').map(o => o.trim());
app.use(express.json());

// ─── Rate Limiting ──────────────────────────────────────────────────────────
// Three buckets, each keyed appropriately:
//   • standardLimiter — generic per-IP cap, used for low-cost reads.
//   • strictLimiter   — per-IP cap for endpoints with real cost (faucet),
//                       low ceiling because each call costs us money.
//   • gameSubmitLimiter — per-wallet cap on score submissions. Higher
//                         ceiling than strictLimiter so a hot-streak
//                         player rolling Rhythm rounds back-to-back never
//                         hits it; keyed by wallet so two legit players
//                         on the same network/WiFi don't share a bucket.
//
// 60 submissions per minute is one finished game every second. Real
// rhythm rounds are 45s minimum, so the only way to exceed this is
// scripted abuse — which the score-vs-elapsed-time bound catches anyway.

// Pull the wallet out of the request body for keying. Falls back to the
// IP if the body shape is unexpected, so we never drop the limit entirely.
// Per-wallet bucket when a wallet is present, else IPv6-safe fallback.
// express-rate-limit's stricter validator (v8+) rejects raw req.ip
// because IPv6 addresses share a /64 prefix per provider, letting one
// attacker mint unlimited keys. ipKeyGenerator normalises to the /64.
const walletKey = (req) => {
  const w = (req.body?.playerAddress || req.body?.wallet || '').toString().toLowerCase();
  if (w && /^0x[0-9a-f]{40}$/.test(w)) return `wallet:${w}`;
  return `ip:${ipKeyGenerator(req.ip)}`;
};

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

const gameSubmitLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,           // 1 minute window
  max: 60,                            // 60 finished games per wallet per minute
  keyGenerator: walletKey,            // per-wallet bucket, not per-IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are submitting too fast. Take a breath and try again in a moment.' }
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

// ─── Validator-signed GamePass writer ────────────────────────────────────────
// A GamePass contract bound to the validator wallet, for backend-SUBMITTED score
// writes (recordScore, which requires msg.sender == scoreValidator). The skill
// games use recordScoreWithBackendSig (player submits, backend only signs), but
// Challenge AI match receipts are written by the backend directly so the free
// instant loop never asks the player to sign or pay gas. This is deliberately
// INDEPENDENT of SOLO_WAGER_ADDR — it works whenever a validator key exists,
// unlike `passContract` above which is read-only when the wager address is unset.
let passScoreWriter = null;
if (provider && VALIDATOR_KEY) {
  try {
    const scoreSigner = validator || new ethers.Wallet(VALIDATOR_KEY, provider);
    passScoreWriter = new ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, scoreSigner);
  } catch (e) {
    console.warn('⚠️  GamePass score writer not configured:', e?.message);
  }
}

// ─── Faucet wallet — dedicated gas-drip signer ───────────────────────────────
// Funds fresh-wallet CELO drips from its OWN wallet, isolated from the
// validator (score-voucher signing) wallet so heavy faucet use can never drain
// the signing gas. Falls back to the validator wallet when FAUCET_PRIVATE_KEY
// is unset, so existing deployments keep working unchanged.
const FAUCET_KEY = process.env.FAUCET_PRIVATE_KEY || '';
let faucetWallet = null;
if (provider && FAUCET_KEY) {
  try {
    faucetWallet = new ethers.Wallet(FAUCET_KEY, provider);
    console.log(`⛽ Faucet wallet ready — dedicated: ${faucetWallet.address}`);
  } catch (e) {
    console.warn('⚠️  FAUCET_PRIVATE_KEY invalid — faucet will fall back to validator:', e.message);
  }
}

// ─── Habitat Registry — paid habitat tier ownership ──────────────────────────
const HABITAT_REGISTRY_ADDR = process.env.HABITAT_REGISTRY_ADDRESS || '';
const HABITAT_PAID_TIERS    = [6, 7, 8, 9, 10];
const HABITAT_FREE_TIERS = [
  { id: 1, unlockLevel: 1  },
  { id: 2, unlockLevel: 5  },
  { id: 3, unlockLevel: 15 },
  { id: 4, unlockLevel: 30 },
  { id: 5, unlockLevel: 50 },
];
const HABITAT_REGISTRY_ABI = [
  'function ownsHabitat(address player, uint8 tier) external view returns (bool)',
  'function playerUbiDonated(address player) external view returns (uint256)',
];

let habitatContract = null;
if (provider && HABITAT_REGISTRY_ADDR) {
  try {
    habitatContract = new ethers.Contract(HABITAT_REGISTRY_ADDR, HABITAT_REGISTRY_ABI, provider);
    console.log(`🏛️  Habitat registry: ${HABITAT_REGISTRY_ADDR}`);
  } catch (e) {
    console.warn('⚠️  Habitat registry not configured:', e.message);
  }
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

// ─── On-chain proof verification for /api/submit-score ──────────────────────
// Before this guard, the backend trusted whatever txHash the frontend sent.
// If the player's recordScoreWithBackendSig reverted on chain (e.g. Forno's
// "phantom revert" when CELO runs out · see reference_celo_insufficient_funds_trap)
// the frontend would STILL pass the txHash and the backend would credit XP +
// activity + score off-chain. Result: ghost ranks — dashboards say "#75"
// but the subgraph shows zero ScoreRecorded events. The on-chain leaderboard
// disagrees with the off-chain one.
//
// Fix: before crediting, fetch the receipt and require status===1 AND a
// ScoreRecorded log keyed to THIS player + game. If the tx didn't land or
// reverted, reject the submit · no off-chain credits land either. Off-chain
// state becomes a strict subset of on-chain state, as intended.
//
// Polling: frontend doesn't await receipt before calling submit-score, so
// the tx may not be mined yet when we look. Poll up to RECEIPT_TIMEOUT_MS,
// with RECEIPT_POLL_MS gaps. Celo blocks are ~5s so 12s covers 2-3 blocks
// of mining latency. If still no receipt after that, reject as "not mined."
const RECEIPT_TIMEOUT_MS = 12_000;
const RECEIPT_POLL_MS = 1_500;

async function verifyScoreTx(txHash, playerAddress, gameType) {
  if (!provider) {
    // No RPC configured — fail open with a warning rather than blocking all
    // submits. This branch should never hit in prod (CELO_RPC always set).
    console.warn('⚠️  verifyScoreTx: no RPC provider, skipping verification');
    return { ok: true, skipped: true };
  }
  const expectedPlayer = playerAddress.toLowerCase();
  const expectedGameType = Number(gameType);
  const expectedContract = GAME_PASS_ADDR.toLowerCase();

  // Poll for receipt. ethers v6 returns null while pending.
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  let receipt = null;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, RECEIPT_POLL_MS));
  }
  if (!receipt) {
    return {
      ok: false,
      reason: lastErr
        ? `Receipt fetch failed: ${lastErr.message?.slice(0, 80) || lastErr}`
        : `Receipt not mined within ${RECEIPT_TIMEOUT_MS}ms · tx may have failed broadcast`,
    };
  }
  if (Number(receipt.status) !== 1) {
    return { ok: false, reason: `Tx reverted on chain (status ${receipt.status})` };
  }
  // Receipt's `to` MUST be the GamePass contract · otherwise the player
  // could submit any unrelated successful tx hash to satisfy the check.
  if ((receipt.to || '').toLowerCase() !== expectedContract) {
    return { ok: false, reason: `Tx target mismatch · expected GamePass at ${expectedContract}, got ${receipt.to}` };
  }
  // Parse logs looking for the ScoreRecorded event keyed to THIS player and
  // game. The contract may emit other events alongside; we only care that
  // the one we're crediting exists.
  let matched = null;
  for (const log of receipt.logs || []) {
    try {
      const parsed = SCORE_EVENT_IFACE.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) continue;
      if (parsed.name !== 'ScoreRecorded') continue;
      const evPlayer = String(parsed.args.player).toLowerCase();
      const evGameType = Number(parsed.args.gameType);
      if (evPlayer === expectedPlayer && evGameType === expectedGameType) {
        matched = {
          player: evPlayer,
          gameType: evGameType,
          score: Number(parsed.args.score),
          season: Number(parsed.args.season),
        };
        break;
      }
    } catch (_) { /* not a ScoreRecorded log */ }
  }
  if (!matched) {
    return {
      ok: false,
      reason: `Tx succeeded but no ScoreRecorded(${expectedPlayer}, gameType=${expectedGameType}) emitted`,
    };
  }
  return { ok: true, onChainScore: matched.score, onChainSeason: matched.season };
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

const WIN_THRESHOLD = { rhythm: 350, simon: 7, stack: 50 };

// Single source of truth for game enum mapping. GamePass.sol treats
// gameType as a free uint8 — these IDs are off-chain conventions that
// also drive the subgraph mapping. Add a new game by appending here.
const GAME_TYPE = { rhythm: 0, simon: 1, stack: 2 };
const VALID_GAMES = Object.keys(GAME_TYPE);

// Challenge AI (MARKOV) records an on-chain GamePass score per completed match,
// exactly like the skill games emit one ScoreRecorded event per run. It is a
// STANDALONE gameType, deliberately NOT added to GAME_TYPE / VALID_GAMES: those
// drive the /api/leaderboard + /api/stats score paths and the DB `scores` mirror,
// and Challenge AI already has its own sum-based weekly ladder (arena_free_matches
// → /api/arena/ladder). Adding it there would spawn a duplicate, misleading
// max-per-wallet leaderboard. The uint8 gameType is open on GamePass.sol, so no
// contract change is needed — see onMatchComplete + recordChallengeMatchOnChain.
const CHALLENGE_AI_GAME_TYPE = 3;
const GAME_LABEL = { rhythm: 'Rhythm Rush', simon: 'Simon Memory', stack: 'Stack Tower' };

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
// Templates the daily refresh picks 3 from — one per category (count / skill /
// special) so every day is a balanced mix. Rewards are deliberately SMALL and
// proportionate to real play: a finished game is worth 10 XP (XP_PLAYED), so a
// mission is ~2–4 games of value. A "perfect day" (all 3) lands ~75–110 XP —
// a nice nudge, NOT a level. Leveling should come from PLAYING, not from
// topping up missions. There is no "win" in these score-based games, so no
// win missions exist.
const MISSION_TEMPLATES = [
  // ── COUNT · just show up and play ──────────────────────────────────────────
  { id: 'play_3_games',  cat: 'count', label: 'Play 3 games today',   target: 3,  reward: 20, match: () => 1 },
  { id: 'play_5_games',  cat: 'count', label: 'Play 5 games today',   target: 5,  reward: 30, match: () => 1 },
  { id: 'play_10_games', cat: 'count', label: 'Play 10 games today',  target: 10, reward: 45, match: () => 1 },
  // ── SKILL · score thresholds spanning casual → focused runs ────────────────
  // Rhythm points, Simon rounds, Stack blocks. Each tier: easy / mid / hard.
  { id: 'rhythm_30k', cat: 'skill', label: 'Score 30,000+ in Rhythm Rush', target: 1, reward: 20, match: ({ game, score }) => game === 'rhythm' && score >= 30000 ? 1 : 0 },
  { id: 'rhythm_50k', cat: 'skill', label: 'Score 50,000+ in Rhythm Rush', target: 1, reward: 28, match: ({ game, score }) => game === 'rhythm' && score >= 50000 ? 1 : 0 },
  { id: 'rhythm_80k', cat: 'skill', label: 'Score 80,000+ in Rhythm Rush', target: 1, reward: 35, match: ({ game, score }) => game === 'rhythm' && score >= 80000 ? 1 : 0 },
  { id: 'simon_5',    cat: 'skill', label: 'Reach round 5 in Simon Memory',  target: 1, reward: 20, match: ({ game, score }) => game === 'simon' && score >= 5  ? 1 : 0 },
  { id: 'simon_8',    cat: 'skill', label: 'Reach round 8 in Simon Memory',  target: 1, reward: 28, match: ({ game, score }) => game === 'simon' && score >= 8  ? 1 : 0 },
  { id: 'simon_12',   cat: 'skill', label: 'Reach round 12 in Simon Memory', target: 1, reward: 35, match: ({ game, score }) => game === 'simon' && score >= 12 ? 1 : 0 },
  { id: 'stack_30',   cat: 'skill', label: 'Stack 30+ blocks in Stack Tower', target: 1, reward: 20, match: ({ game, score }) => game === 'stack' && score >= 30 ? 1 : 0 },
  { id: 'stack_45',   cat: 'skill', label: 'Stack 45+ blocks in Stack Tower', target: 1, reward: 28, match: ({ game, score }) => game === 'stack' && score >= 45 ? 1 : 0 },
  { id: 'stack_60',   cat: 'skill', label: 'Stack 60+ blocks in Stack Tower', target: 1, reward: 35, match: ({ game, score }) => game === 'stack' && score >= 60 ? 1 : 0 },
  // ── SPECIAL · improve, or explore the arcade ───────────────────────────────
  { id: 'beat_personal_best', cat: 'special', label: 'Beat a personal best',        target: 1, reward: 35, match: ({ isNewPb }) => isNewPb ? 1 : 0 },
  { id: 'variety_2',          cat: 'special', label: 'Play 2 different games today', target: 2, reward: 25, match: ({ game, _seenGamesToday }) => _seenGamesToday && !_seenGamesToday.has(game) ? 1 : 0 },
  { id: 'variety_3',          cat: 'special', label: 'Play 3 different games today', target: 3, reward: 40, match: ({ game, _seenGamesToday }) => _seenGamesToday && !_seenGamesToday.has(game) ? 1 : 0 },
];

// Deterministic 3-mission pick per (wallet, date) so a player gets the SAME 3 missions all day.
function pickDailyMissions(wallet, date) {
  // Hash (wallet + date) into a seed
  let h = 0;
  const seed = `${wallet}-${date}`;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const rng = () => { h = Math.imul(48271, h) | 0; return ((h >>> 0) / 0xffffffff); };

  // Balanced daily set: one from each category so every day mixes a show-up
  // goal, a skill goal, and a special goal (never 3 of the same shape).
  const count   = MISSION_TEMPLATES.filter(m => m.cat === 'count');
  const skill   = MISSION_TEMPLATES.filter(m => m.cat === 'skill');
  const special = MISSION_TEMPLATES.filter(m => m.cat === 'special');
  const pick    = (arr) => arr[Math.floor(rng() * arr.length)];
  return [pick(count), pick(skill), pick(special)];
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
  // Rhythm achievement thresholds — long-term milestones. The 80k
  // daily-mission ceiling lives below Apprentice (60k? — daily is
  // easier on purpose, see below) wait — actually we set them at 60k
  // / 200k / 400k. Geometric 2× progression: clearing the Master
  // daily a couple times nudges you into Apprentice; sustained skill
  // takes you to Master; Legend is a stretch goal for top players.
  { id: 'rhythm_300',   icon: '🥁', name: 'Drum Apprentice',    desc: 'Score 60,000+ in Rhythm Rush',
    check: async ({ game, score }) => game === 'rhythm' && score >= 60000 },
  { id: 'rhythm_500',   icon: '🥁', name: 'Rhythm Master',      desc: 'Score 200,000+ in Rhythm Rush',
    check: async ({ game, score }) => game === 'rhythm' && score >= 200000 },
  { id: 'rhythm_700',   icon: '👑', name: 'Rhythm Legend',      desc: 'Score 400,000+ in Rhythm Rush',
    check: async ({ game, score }) => game === 'rhythm' && score >= 400000 },
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
  // Stack Tower milestones · scoring = blocks + perfect-stack combo
  // bonus. 50 blocks is a tidy run, 150 is precise, 300 is hall-of-fame.
  { id: 'stack_50',     icon: '🧱', name: 'Block Builder',      desc: 'Score 50+ in Stack Tower',
    check: async ({ game, score }) => game === 'stack' && score >= 50 },
  { id: 'stack_150',    icon: '🏗️', name: 'Tower Master',       desc: 'Score 150+ in Stack Tower',
    check: async ({ game, score }) => game === 'stack' && score >= 150 },
  { id: 'stack_300',    icon: '🏙️', name: 'Sky Architect',     desc: 'Score 300+ in Stack Tower',
    check: async ({ game, score }) => game === 'stack' && score >= 300 },
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
const subgraph = require('./lib/subgraph');

async function getLeaderboard(game, limit = 50, seasonFilter = true) {
  const cacheKey = `lb:${game}:${seasonFilter ? 'season' : 'all'}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Use the activity table so we pick up every play this week,
  // not just players whose all-time best happened to fall in this week.
  // Project narrowed columns — we don't need every field.
  let query = supabase
    .from('activity')
    .select('wallet_address, score, game_time, wagered, tx_hash, created_at')
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

  let q = supabase
    .from('activity')
    .select('wallet_address, game, score, tx_hash, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (player) q = q.eq('wallet_address', player.toLowerCase());
  const { data } = await q;
  return cacheSet(cacheKey, data || [], MEM_TTL.activity);
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
    const perGame = await Promise.all(VALID_GAMES.map(async (game) => {
      const { data } = await supabase
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
    await supabase.from('seasons').upsert({
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
        await supabase.from('badges').upsert({
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
  if (!VALID_GAMES.includes(game)) return { valid: false, reason: 'Unknown game' };
  if (typeof score !== 'number' || score < 0 || score > 1_000_000) return { valid: false, reason: 'Score out of range' };
  if (typeof gameTime !== 'number' || gameTime < 5000) return { valid: false, reason: 'Game time too short' };
  return { valid: true };
}

// ─── POST /api/start-session ───────────────────────────────────────────────
// SECURITY (2026-07-17 audit): this had NO requireSecret, so any script could
// forge an Origin header and ask the VALIDATOR KEY to sign a payload for any
// address it liked · an unauthenticated signing oracle on the same key that
// owns PerkShop and HabitatRegistry. The payload shape (`addr:ts:nonce`) meant
// it could not forge a score voucher or a tx, so impact was limited, but an
// open signing endpoint is never acceptable. Now secret-gated.
//
// NOTE: this endpoint is currently DEAD. The live score flow is
// start-game → sign-score → on-chain tx → verifyScoreTx. The "silent session"
// it issues is only read by the unreachable branch in /api/submit-score (see
// the comment there). Kept, gated, and documented rather than deleted so the
// speed-hack layer can be revived deliberately instead of by accident.
app.post('/api/start-session', requireSecret, gameSubmitLimiter, async (req, res) => {
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

// ─── POST /api/start-game ────────────────────────────────────────────────────
// Issues a server-side session token at game start. The token is required
// by /api/sign-score later — no token, no signing. This is the load-bearing
// piece of the anti-cheat: it forces every signed score to be tied to a
// real /api/start-game call, which only legit players make.
//
// The session row also captures started_at, used later to enforce min/max
// game duration. Single-use: marked used=true after sign-score consumes it.
app.post('/api/start-game', requireSecret, async (req, res) => {
  const { wallet, game } = req.body;
  if (!wallet || !game) {
    return res.status(400).json({ error: 'Missing wallet or game' });
  }
  if (!VALID_GAMES.includes(game)) {
    return res.status(400).json({ error: 'Unknown game' });
  }

  // 32 random bytes → 64 hex chars. Unguessable.
  const token = crypto.randomBytes(32).toString('hex');

  const { error } = await supabase
    .from('game_sessions')
    .insert({
      token,
      wallet: wallet.toLowerCase(),
      game,
    });

  if (error) {
    console.error('start-game insert error:', error.message);
    return res.status(500).json({ error: 'Failed to start session' });
  }

  return res.json({ success: true, sessionToken: token });
});

// ─── POST /api/sign-score ────────────────────────────────────────────────────
// Called by the Next.js server action before the player submits on-chain.
// Returns an EIP-712 BackendApproval signature + current scoreNonce.
// The frontend then calls recordScoreWithBackendSig(gameType, score, nonce, sig).
//
// SECURITY: the score in the EIP-712 payload is the SERVER-COMPUTED score from
// the player's tap log (rhythm only — simon still trusts the client number for
// now, but requires the session ticket so direct PoC submissions are blocked).
// The client-provided `score` field is no longer trusted; for rhythm, whatever
// the replay computes is what gets signed.
app.post('/api/sign-score', requireSecret, async (req, res) => {
  if (!validator || !passContract) {
    return res.status(503).json({ error: 'Validator not configured' });
  }

  const { playerAddress, game, score, sessionToken, tapLog, dropLog,
          simonTapLog, simonRounds, simonElapsedMs } = req.body;
  if (!playerAddress || !game) {
    return res.status(400).json({ error: 'Missing playerAddress or game' });
  }
  if (!VALID_GAMES.includes(game)) {
    return res.status(400).json({ error: 'Unknown game' });
  }
  if (!sessionToken) {
    return res.status(400).json({ error: 'Missing sessionToken' });
  }

  // ── Session validation ────────────────────────────────────────────────────
  const { data: session, error: sessionErr } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('token', sessionToken)
    .single();

  if (sessionErr || !session) {
    return res.status(403).json({ error: 'Invalid session token' });
  }
  if (session.used) {
    return res.status(403).json({ error: 'Session already used' });
  }
  if (session.wallet.toLowerCase() !== playerAddress.toLowerCase()) {
    return res.status(403).json({ error: 'Session wallet mismatch' });
  }
  if (session.game !== game) {
    return res.status(403).json({ error: 'Session game mismatch' });
  }

  const sessionElapsedMs = Date.now() - new Date(session.started_at).getTime();
  // Session expiry: 11 minutes. Simon's in-game timer hard-stops the run at
  // exactly 10 minutes, so 11 gives a 60-second safety margin for the score
  // submit network call to land. Still blocks long-wait cap-inflation attacks.
  if (sessionElapsedMs > 11 * 60 * 1000) {
    return res.status(403).json({ error: 'Session expired' });
  }
  // Min duration: 5 seconds. Shorter than the 30s I considered earlier
  // since the score-vs-elapsed bound (via replay) is the real gate.
  if (sessionElapsedMs < 5_000) {
    return res.status(403).json({ error: 'Session too short' });
  }

  // ── Score determination ──────────────────────────────────────────────────
  // For rhythm: server replays the tap log and the COMPUTED score is what
  // gets signed. The client-provided `score` is ignored.
  //
  // For simon: replay validation isn't implemented yet, so fall back to the
  // client's claimed score. Session ticket still blocks the demonstrated PoC.
  let serverScore;

  if (game === 'rhythm') {
    if (!Array.isArray(tapLog)) {
      return res.status(400).json({ error: 'Missing tapLog (required for rhythm)' });
    }

    const physics = rhythmPhysicsCheck(tapLog, sessionElapsedMs);
    if (!physics.ok) {
      console.warn(`[rhythm] Physics check rejected ${playerAddress}: ${physics.reason} · ${tapLog.length} taps, ${sessionElapsedMs}ms session`);
      return res.status(403).json({ error: 'Physics check failed', reason: physics.reason });
    }

    const replay = rhythmComputeScore(tapLog, sessionElapsedMs);

    const jitter = rhythmJitterCheck(replay.hits);
    if (!jitter.ok) {
      console.warn(`[rhythm] Jitter check rejected ${playerAddress}: ${jitter.reason} · ${replay.hits.length} hits`);
      return res.status(403).json({ error: 'Jitter check failed', reason: jitter.reason });
    }

    serverScore = replay.score;
  } else {
    // Simon / Stack — session-ticket protected, but the score is still the
    // CLIENT'S claim. This is the real remaining "don't trust the client" hole:
    // a tampered browser can send any number up to the bound and we sign it.
    //
    // DELIBERATELY NOT TIGHTENING THE BOUND. A lower ceiling looks like a fix
    // and isn't: it cannot tell a cheat from a great run, so it only punishes
    // real players the day someone plays out of their skin. Rhythm proves the
    // point · the client clamps at 1,000,000 (Math.min in the game page) and
    // rhythmScoring has NO internal cap, so genuine monster runs land on
    // exactly 1,000,000. Read naively, those look like fraud. They are not.
    //
    // The only honest fix is what rhythm already does: replay the run
    // server-side and sign the COMPUTED score, ignoring the client entirely.
    // See rhythmComputeScore + rhythmPhysicsCheck + rhythmJitterCheck for the
    // pattern simon and stack still need. Until then this bound stays a sanity
    // check, not a pretence of security.
    if (typeof score !== 'number' || !Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > 1_000_000) {
      return res.status(400).json({ error: 'Score out of range (max 1000000)' });
    }
    serverScore = score;

    // ── Stack · SHADOW MODE (ANTICHEAT.md Step 1) ─────────────────────────────
    // Recompute the score from the client's per-drop log and LOG the comparison.
    // We do NOT touch serverScore here · the CLIENT'S claimed score is still what
    // gets signed (serverScore was set to `score` just above and stays that way).
    // This is deliberately non-enforcing so an imperfect port cannot affect any
    // player · deltas should be ~0 for honest runs, and any drift gets fixed
    // while nobody is impacted. See ANTICHEAT.md "How to ship it without hurting
    // anyone" step 1. Absent dropLog = behave exactly as before (no log line).
    if (game === 'stack' && Array.isArray(dropLog)) {
      const shadow = computeStackScore(dropLog);
      const human = computeStackHumanness(dropLog);
      const delta = shadow.score - score;
      const flag = human.human ? 'human' : `FLAG(${human.reasons.join('; ')})`;
      console.log(`[stack:shadow] player=${playerAddress.slice(0, 10)} dropLog=${dropLog.length} serverScore=${shadow.score} clientScore=${score} delta=${delta} (drops=${shadow.drops} perfects=${shadow.perfects} maxCombo=${shadow.maxCombo}) rate=${human.stats.dropsPerSec}/s ${flag} · SIGNING CLIENT SCORE`);
    }

    // ── Simon · SHADOW MODE (ANTICHEAT.md Steps 1 + 3) ────────────────────────
    // The pattern is now seeded from the session token (client derives it with
    // the SAME keccak PRNG as simonScoring.derivePattern), so the server finally
    // has ground truth to check the taps against. Recompute the score from the
    // tap log and LOG the comparison. We do NOT touch serverScore · the CLIENT'S
    // claimed score is still what gets signed (set to `score` above). Non-enforcing
    // so an imperfect port cannot affect a player; deltas should be ~0 for honest
    // runs. Absent simonTapLog (older client, or guest/unminted with no token and
    // thus no seed) = behave exactly as before (no log line).
    if (game === 'simon' && Array.isArray(simonTapLog)) {
      const clientElapsed = typeof simonElapsedMs === 'number' ? simonElapsedMs : sessionElapsedMs;
      const sim = computeSimonScore({ sessionToken, tapLog: simonTapLog, clientElapsedMs: clientElapsed });
      const delta = sim.score - score;
      const flag = sim.tapsOk ? 'tapsOk' : 'FLAG(tap mismatch)';
      const claimed = typeof simonRounds === 'number' ? simonRounds : sim.roundsClaimed;
      console.log(`[simon:shadow] player=${playerAddress.slice(0, 10)} taps=${simonTapLog.length} serverScore=${sim.score} clientScore=${score} delta=${delta} roundsVerified=${sim.roundsVerified} roundsClaimed=${claimed} ${flag} · SIGNING CLIENT SCORE`);
    }
  }

  const gameType = GAME_TYPE[game];

  try {
    const nonce = await passContract.scoreNonces(playerAddress);

    const signature = await validator.signTypedData(
      BACKEND_APPROVAL_DOMAIN,
      BACKEND_APPROVAL_TYPES,
      {
        player: playerAddress,
        gameType,
        score: BigInt(serverScore),
        nonce,
      },
    );

    // Mark session used + record forensic data. Best-effort; failure here
    // shouldn't block the signing response (the signature is already
    // committed cryptographically).
    await supabase
      .from('game_sessions')
      .update({
        used: true,
        used_at: new Date().toISOString(),
        computed_score: serverScore,
        tap_count: Array.isArray(tapLog) ? tapLog.length : null,
      })
      .eq('token', sessionToken);

    // Season 1 Solo Ladder hook. Points now scale with the score the
    // player actually earned in the round, so "open game → game over →
    // claim point" is not a viable farm — that run scores ~0 and
    // earns 0 Solo Ladder points. Real play (hits, sequences, runs)
    // earns 1-15 points depending on effort.
    //
    // Formula: pts = clamp(floor(score / divisor), 0, MAX_PTS).
    //   - Rhythm divisor 100: a real session (~500-3000 score) earns
    //     5-15 pts. Score < 100 (no real play) earns 0.
    //   - Simon divisor 20:   a real session (~100-300 score) earns
    //     5-15 pts. Score < 20 (game over round 1) earns 0.
    //
    // Plus an 8s duration gate on top of the 5s sign-score floor. Same
    // idempotency: one ledger row per session token. Best-effort write.
    const MAX_SEASON_PTS_PER_GAME = 15;
    // Score normalization · keeps the combined season ladder balanced
    // across games with very different score scales:
    //   rhythm — raw scores 30k–400k+ → /100 → 300–4000+
    //   simon  — raw rounds 5–20      → /20  →  0–1   (per game)
    //   stack  — raw 30–300+ blocks   → /5   →  6–60+
    // Each divisor was tuned so a strong run in any game lands in a
    // comparable normalized band.
    const SCORE_DIVISOR = game === 'rhythm' ? 100 : game === 'stack' ? 5 : 20;
    const MIN_DURATION_MS = 8_000;
    const passesDuration = sessionElapsedMs >= MIN_DURATION_MS;
    const seasonPts = passesDuration
      ? Math.max(0, Math.min(MAX_SEASON_PTS_PER_GAME, Math.floor(serverScore / SCORE_DIVISOR)))
      : 0;
    if (seasonPts > 0) {
      try {
        const { data: enrolled } = await supabase
          .from('season_v1_players')
          .select('wallet')
          .ilike('wallet', playerAddress)
          .maybeSingle();
        if (enrolled) {
          await supabase
            .from('season_v1_points')
            .insert({
              wallet: playerAddress.toLowerCase(),
              action_type: 'game_played',
              points: seasonPts,
              ref: sessionToken,
            });
        }
      } catch (e) {
        console.warn('Season 1 points hook (game_played) failed:', e.message);
      }
    } else {
      // Quiet diagnostic — useful for tuning the divisor without spamming.
      console.log(`Season 1 pts skipped: ${playerAddress.slice(0, 8)}.. game=${game} score=${serverScore} elapsed=${sessionElapsedMs}ms`);
    }

    return res.json({
      success:   true,
      signature,
      nonce:     nonce.toString(),
      gameType,
      score:     serverScore, // ← client uses this number, not their claim
    });
  } catch (e) {
    console.error('sign-score error:', e.message);
    return res.status(500).json({ error: 'Failed to sign score' });
  }
});

// ─── POST /api/submit-score ─────────────────────────────────────────────────
app.post('/api/submit-score', requireSecret, gameSubmitLimiter, async (req, res) => {
  const { playerAddress, scoreData, session } = req.body;

  const isInternalCall = req.headers['x-internal-secret'] === INTERNAL_SECRET && INTERNAL_SECRET;

  if (!playerAddress || !scoreData) {
    return res.status(400).json({ error: 'Missing playerAddress or scoreData' });
  }

  // 1. Verify "Silent" Session Integrity (skipped for trusted server-action calls)
  //
  // ⚠️ AUDIT NOTE (2026-07-17): this branch is UNREACHABLE. `requireSecret`
  // above already rejects every request without the secret, so isInternalCall
  // is always true and the speed-hack detection below has never actually run.
  // Do not read this block as active protection. The real anti-cheat is the
  // on-chain path: start-game → sign-score → tx → verifyScoreTx (receipt must
  // target GamePass), which is what genuinely gates scores today.
  //
  // Left in place, not deleted, because reviving speed-hack detection should be
  // a deliberate decision (it would need to move ABOVE requireSecret, or the
  // session would need threading through the server action).
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

      if (actualElapsed > 11 * 60 * 1000) {
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

  // ═══ Verify the on-chain proof actually landed ═══
  // Format-only checks let "ghost ranks" through · a tx hash with the right
  // shape but no successful receipt would still credit XP and activity. Now
  // we fetch the receipt, require status===1, and confirm a ScoreRecorded
  // log for THIS player + game exists. Only applied to player-submitted
  // score txs (scoreTxHash); wager-resolution txs (wagerTxHash) come from
  // resolveOnChain which already awaits the receipt before returning.
  if (scoreTxHash) {
    const gameTypeNum = GAME_TYPE[game];
    if (gameTypeNum === undefined) {
      return res.status(400).json({ error: 'Unknown game · cannot verify on-chain proof' });
    }
    const verified = await verifyScoreTx(scoreTxHash, playerAddress, gameTypeNum);
    if (!verified.ok) {
      console.warn(`🚨 submit-score rejected: ${playerAddress.slice(0, 10)}.. game=${game} tx=${scoreTxHash.slice(0, 10)}.. · ${verified.reason}`);
      return res.status(400).json({
        error: 'On-chain proof verification failed',
        reason: verified.reason,
      });
    }
  }

  // Read previous best for this game IN THE CURRENT SEASON. PBs are a
  // per-season concept — saves are already scoped to season_number, so the
  // comparison should match. An all-time query would let last season's high
  // score lock the player out of the "🏆 New PB!" celebration + XP_NEW_PB
  // bonus + opt-in trigger forever, which is the wrong reward shape.
  const lower = playerAddress.toLowerCase();
  const { data: prevRows } = await supabase
    .from('scores')
    .select('score')
    .eq('wallet_address', lower)
    .eq('game', game)
    .eq('season_number', season)
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

  // Bust caches so this player's rank is computed against the score they
  // just saved, not a 30s-stale leaderboard. Without this, post-submit
  // rank lookups returned -1 → 0 → the rank tile rendered empty on the
  // results screen, and global stats lagged by a full TTL window.
  cacheInvalidatePrefix(`lb:${game}`);
  cacheInvalidatePrefix('act:');
  memCache.delete('stats:global');
  memCache.delete('seasons:global');

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

  // Wager resolved — notify the player of their outcome. Only fires when the
  // on-chain resolveWager succeeded (we have a tx hash) so we don't ping on
  // pending or failed resolutions. Won path leads with the wagered amount;
  // lost path is gentle. Per-wager category bypasses same-day dedup so a
  // player who runs multiple wagers gets pinged for each.
  if (wagerId && wagerTxHash) {
    const gameLabel = GAME_LABEL[game];
    const payload = isWin
      ? push.wagerWonNotification(wagered, gameLabel)
      : push.wagerLostNotification(gameLabel);
    push.sendToWallet(supabase, lower, `wager_${wagerId}`, payload).catch(() => {});
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

  // Rank is read from the subgraph — single source of truth for on-chain
  // scores. The on-chain ScoreRecorded event is what the subgraph indexes,
  // and we already require an on-chain proof above, so by the time we hit
  // here the player's score is canonical.
  let rank = 0;
  try {
    const seasonStart = SEASON_EPOCH + (season - 1) * SEASON_DAYS * 86400;
    const gameTypeInt = GAME_TYPE[game];
    rank = await subgraph.seasonRank(lower, score, gameTypeInt, seasonStart);

    // Rank change notification — only fires if submitter just landed in
    // top-3 (the dramatic moment). We simulate the after-state since the
    // subgraph hasn't indexed the new tx yet.
    if (rank > 0 && rank <= 3) {
      try {
        const before = await subgraph.leaderboard(gameTypeInt, seasonStart, 50);
        const without = before.filter(e => e.wallet_address !== lower);
        const after = [...without, {
          wallet_address: lower,
          score,
          username: null,
          created_at: new Date().toISOString(),
          tx_hash: txHash,
        }].sort((a, b) => b.score - a.score);
        // Fire-and-forget; don't block the response on notification delivery
        notifyRankDisplacement(game, lower, before, after).catch(() => {});
      } catch (_) { /* best-effort */ }
    }
  } catch (e) {
    console.warn('rank lookup failed:', e?.message || e);
  }

  // Achievement notifications — one per new unlock. Fires inline since the
  // unlock list is right here. Players who are subscribed to push get an
  // immediate ding when they earn a trophy.
  if (newAchievements && newAchievements.length > 0) {
    for (const a of newAchievements) {
      const payload = push.achievementNotification(a.name || a.id, a.icon);
      // Per-day dedup category includes the achievement id so multiple
      // unlocks in one day each fire (rare but possible).
      push.sendToWallet(supabase, lower, `achievement_${a.id || a.name}`, payload).catch(() => {});
    }
  }

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
// Reads from the Goldsky subgraph (on-chain truth), not Supabase. Supabase
// is reserved for off-chain state only — this endpoint is purely a view of
// indexed score events.
app.get('/api/leaderboard', async (req, res) => {
  const game = req.query.game;
  if (!VALID_GAMES.includes(game)) {
    return res.status(400).json({ error: 'game must be rhythm or simon' });
  }
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const page = offset > 0 ? null : Math.max(1, parseInt(req.query.page) || 1);
  const start = offset > 0 ? offset : (page - 1) * limit;

  // Pull current-season leaderboard from the subgraph
  const seasonStart = SEASON_EPOCH + (currentSeasonNumber() - 1) * SEASON_DAYS * 86400;
  const gameTypeInt = GAME_TYPE[game];
  let all = [];
  try {
    all = await subgraph.leaderboard(gameTypeInt, seasonStart, 100);
  } catch (e) {
    console.warn('subgraph leaderboard failed:', e?.message || e);
  }
  const total = all.length;
  const slice = all.slice(start, start + limit);

  // Streaks are off-chain (Supabase). Username comes from the subgraph row.
  // Single batch query keeps Supabase egress minimal — one tiny read per
  // page instead of one per row.
  const wallets = slice.map(e => e.wallet_address.toLowerCase());
  let streakMap = new Map();
  if (wallets.length > 0) {
    const { data: streakRows } = await supabase
      .from('users')
      .select('wallet_address, play_streak')
      .in('wallet_address', wallets);
    streakMap = new Map((streakRows || []).map(r => [r.wallet_address.toLowerCase(), r.play_streak || 0]));
  }

  const enriched = slice.map(e => ({
    player: e.wallet_address,
    score: e.score,
    timestamp: Math.floor(new Date(e.created_at).getTime() / 1000),
    tx_hash: e.tx_hash,
    username: e.username,
    streak: streakMap.get(e.wallet_address.toLowerCase()) || 0,
  }));
  const listTotal = Math.max(0, total - (offset > 0 ? offset : 0));
  res.json({ leaderboard: enriched, total, page, limit, pages: Math.ceil(listTotal / limit) });
});

// ─── GET /api/usernames?wallets=0xa,0xb,... ─────────────────────────────────
// Batch lookup of on-chain usernames (from the GamePass NFT contract).
// Surfaces names to other services — the Season 1 Solo Ladder reads from
// the Supabase ledger, which has no username column, so it can't enrich
// rows without this endpoint. The resolveUsername LRU caches results so
// repeat callers don't pay an RPC per wallet.
app.get('/api/usernames', async (req, res) => {
  const raw = String(req.query.wallets || '').trim();
  if (!raw) return res.json({ usernames: {} });
  const wallets = [...new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(s => /^0x[a-f0-9]{40}$/.test(s)))].slice(0, 500);
  const entries = await Promise.all(wallets.map(async (w) => {
    const name = await resolveUsername(w).catch(() => null);
    return [w, name || null];
  }));
  res.json({ usernames: Object.fromEntries(entries) });
});

// ─── GET /api/activity ──────────────────────────────────────────────────────
// Recent score events from the subgraph. Profile pages pass ?player=0x...
// to scope to a single wallet; the global feed shows the last 10 plays.
app.get('/api/activity', async (req, res) => {
  const player = typeof req.query.player === 'string' ? req.query.player : null;
  const limit = player ? 30 : 10;
  let entries = [];
  try {
    entries = await subgraph.recentActivity(limit, player);
  } catch (e) {
    console.warn('subgraph activity failed:', e?.message || e);
  }
  const enriched = entries.map(e => ({
    player: e.wallet_address,
    game: e.game,
    score: e.score,
    tx_hash: e.tx_hash,
    timestamp: Math.floor(new Date(e.created_at).getTime() / 1000),
    username: e.username,
  }));
  res.json({ activity: enriched });
});

// ─── GET /api/stats ─────────────────────────────────────────────────────────
// All aggregates come from the subgraph's GlobalStat row in one query —
// no more pulling thousands of activity rows just to count them.
app.get('/api/stats', async (_, res) => {
  const cached = cacheGet('stats:global');
  if (cached) return res.json(cached);
  const season = currentSeasonNumber();
  const { start, end } = seasonBounds(season);

  let g = null;
  try {
    g = await subgraph.globalStats();
  } catch (e) {
    console.warn('subgraph stats failed:', e?.message || e);
  }

  const totalUsers     = g ? Number(g.totalPlayers)      : 0;
  const totalGames     = g ? Number(g.totalScores)       : 0;
  const rhythmPlayers  = g ? Number(g.totalRhythmPlays)  : 0;
  const simonPlayers   = g ? Number(g.totalSimonPlays)   : 0;
  const totalWagered   = g ? Number(BigInt(g.totalWageredG || '0') / 10n ** 16n) / 100 : 0;

  // UBI impact — the cumulative G$ GameArena has routed to GoodCollective
  // through habitat unlocks. Surfaced as the "community impact" number on
  // the Games page so players see what their donations have built.
  // Both fields stay as raw 18-decimal strings; the frontend formats them.
  const totalUbiDonatedG  = g ? (g.totalUbiDonatedG  || '0') : '0';
  const totalTreasuryG    = g ? (g.totalTreasuryG    || '0') : '0';
  const totalHabitatUnlocks = g ? Number(g.totalHabitatUnlocks) : 0;

  // Season-active users — one tiny subgraph query for current season scores
  let seasonUsers = 0;
  try {
    const seasonScores = await subgraph.gql(
      `query SU($s: BigInt!) {
        scores(first: 500, where: { blockTimestamp_gte: $s }) { player { id } }
      }`,
      { s: start.toString() },
    );
    seasonUsers = new Set((seasonScores.scores || []).map(r => r.player.id)).size;
  } catch (_) { }

  // Top scores from subgraph (also one query each)
  const seasonStartUnix = start;
  const [topR, topS] = await Promise.all([
    subgraph.leaderboard(0, seasonStartUnix, 1).catch(() => []),
    subgraph.leaderboard(1, seasonStartUnix, 1).catch(() => []),
  ]);
  const leaderboardR = topR.length ? topR : [{ score: 0 }];
  const leaderboardS = topS.length ? topS : [{ score: 0 }];

  // Prize pot still on chain
  let estimatedPrizePot = '0.00';
  try {
    const bal = await getTreasuryBalance();
    estimatedPrizePot = (parseFloat(bal) * 0.10).toFixed(2);
  } catch (_) { }

  const payload = {
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
    // UBI impact (raw 18-decimal G$ strings; frontend formats)
    totalUbiDonatedG,
    totalTreasuryG,
    totalHabitatUnlocks,
  };
  cacheSet('stats:global', payload, MEM_TTL.global);
  res.json(payload);
});

// ─── GET /api/seasons ───────────────────────────────────────────────────────
app.get('/api/seasons', async (_, res) => {
  const cached = cacheGet('seasons:global');
  if (cached) return res.json(cached);
  const current = currentSeasonNumber();
  const { start, end } = seasonBounds(current);
  const startDate = new Date(start * 1000).toISOString();

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

  // Live current-season standings · one query per registered game so
  // Stack Tower (and any future game) gets picked up automatically.
  const liveByGame = Object.fromEntries(
    await Promise.all(VALID_GAMES.map(async (game) => {
      const { data } = await supabase
        .from('activity')
        .select('*')
        .eq('game', game)
        .gte('created_at', startDate)
        .order('score', { ascending: false })
        .limit(500);
      return [game, data || []];
    }))
  );

  // Past sealed seasons
  const { data: pastSeasons } = await supabase
    .from('seasons')
    .select('*')
    .eq('sealed', true)
    .order('season_number', { ascending: false });

  // Fetch actual scores for each past season from the activity table.
  // Fan out one query per registered game per past season so stack
  // (and any future game) flows through without per-game code.
  const pastWithScores = await Promise.all((pastSeasons || []).map(async (s) => {
    const startIso = new Date(s.start_ts * 1000).toISOString();
    const endIso   = new Date(s.end_ts   * 1000).toISOString();

    const rawByGame = Object.fromEntries(
      await Promise.all(VALID_GAMES.map(async (game) => {
        const { data } = await supabase
          .from('activity')
          .select('*')
          .eq('game', game)
          .gte('created_at', startIso)
          .lt('created_at', endIso)
          .order('score', { ascending: false })
          .limit(500);
        return [game, data || []];
      }))
    );

    // Count distinct players across every game played that week
    const allPlayers = new Set(
      VALID_GAMES.flatMap(g => rawByGame[g].map(e => e.wallet_address))
    );

    // Prefetch usernames ONCE per unique wallet. Without this, a wallet in
    // three games' top-10s fired three concurrent uncached contract reads
    // (the LRU only stores completed lookups) — up to 150 RPC calls per
    // /api/seasons hit. After the prefetch, fmt() below is pure cache hits.
    await Promise.all([...allPlayers].map((w) => resolveUsername(w)));

    const fmt = async (e) => ({
      player: e.wallet_address,
      username: await resolveUsername(e.wallet_address) || null,
      score: e.score,
      gameTime: e.game_time,
      timestamp: Math.floor(new Date(e.created_at).getTime() / 1000),
      tx_hash: e.tx_hash,
    });

    // Build per-game top-10 lists for the response
    const perGame = Object.fromEntries(
      await Promise.all(VALID_GAMES.map(async (game) => [
        game,
        await Promise.all(dedupScores(rawByGame[game], 10).map(fmt)),
      ]))
    );

    return {
      season:       s.season_number,
      startTs:      s.start_ts,
      endTs:        s.end_ts,
      prizePot:     s.prize_pot,
      sealedAt:     Math.floor(new Date(s.created_at).getTime() / 1000),
      totalPlayers: allPlayers.size,
      ...perGame,
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

  const payload = {
    currentSeason: current,
    currentEndsAt: end,
    live: Object.fromEntries(
      await Promise.all(VALID_GAMES.map(async (game) => [
        game,
        await Promise.all(dedupScores(liveByGame[game]).map(formatEntry)),
      ]))
    ),
    past: pastWithScores,
  };
  cacheSet('seasons:global', payload, MEM_TTL.global);
  res.json(payload);
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
  VALID_GAMES.forEach(game => {
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

// ─── GET /api/notifications/:address ───────────────────────────────────────
// In-app notification feed. Merges two row types from `notifications_feed`:
//   1. Per-wallet sends — every push sendToWallet logs the payload here,
//      so the bell can render achievement unlocks, rank changes, wager
//      results, etc., even on devices that weren't subscribed at send time.
//   2. Broadcasts — single rows with `wallet_address = NULL`. EVERY
//      wallet's feed includes them via the OR filter.
//
// Query is the simplest form of "merged feed". The frontend de-dupes and
// merges with achievements + badges (which it already fetches separately)
// to build the full bell content.
app.get('/api/notifications/:address', async (req, res) => {
  const addr = (req.params.address || '').toLowerCase();
  if (!addr) return res.status(400).json({ error: 'address required' });
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const { data, error } = await supabase
    .from('notifications_feed')
    .select('id, wallet_address, category, title, body, url, tag, sent_at')
    .or(`wallet_address.eq.${addr},wallet_address.is.null`)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('notifications_feed read failed:', error.message || error);
    return res.json({ notifications: [] });
  }

  const notifications = (data || []).map(r => ({
    id: String(r.id),
    // "broadcast" vs everything else — frontend uses it for icon/color.
    isBroadcast: r.wallet_address === null,
    category: r.category,
    title: r.title,
    body: r.body,
    url: r.url,
    tag: r.tag,
    sentAt: Math.floor(new Date(r.sent_at).getTime() / 1000),
  }));

  res.json({ notifications });
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
// requireSecret: claims arrive via Next server actions that verify wallet
// control first (Privy token / MiniPay signature) — the browser can no
// longer claim XP for arbitrary wallets by calling this directly.
app.post('/api/missions/claim', requireSecret, gameSubmitLimiter, async (req, res) => {
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
      streak: 0, playedToday: false, lastPlayDate: null,
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
    lastPlayDate: u.last_play_date || null,
    claimStreak: u.claim_streak || 0,
    lastClaimDate: u.last_claim_date || null,
  });
});

// ─── POST /api/record-claim — called by frontend after G$ claim succeeds ─────
// Increments claim_streak if last claim was yesterday, resets to 1 otherwise.
// Frontend calls this once claimG$() resolves successfully. No auth needed
// beyond origin check — worst case a player calls it without claiming and
// gets a streak count; the G$ entitlement gate on GoodDollar's end is the
// real guard.
// SECURITY (2026-07-17 audit): this had NO auth at all. The CORS origin check
// is not authentication · any script can forge an Origin header, so this was
// world-writable. It takes a wallet from the body and writes a claim streak
// with ZERO proof the wallet ever claimed G$, meaning anyone could fabricate
// streaks for themselves or for any other player. Now secret-gated.
//
// NOTE: currently DEAD (no caller anywhere in the repo). If the claim-streak
// feature is revived, it must verify the claim on-chain rather than trust the
// caller's word · a signed streak is only worth what it is checked against.
app.post('/api/record-claim', requireSecret, async (req, res) => {
  const { walletAddress } = req.body || {};
  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: 'Missing or invalid walletAddress' });
  }
  const addr = walletAddress.toLowerCase();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const { data: rows } = await supabase
    .from('users')
    .select('claim_streak, last_claim_date')
    .eq('wallet_address', addr)
    .limit(1);

  const current = rows?.[0] || {};

  // Already claimed today — idempotent, don't double-increment.
  if (current.last_claim_date === today) {
    return res.json({ success: true, claimStreak: current.claim_streak || 1, alreadyClaimed: true });
  }

  const newStreak = current.last_claim_date === yesterday
    ? (current.claim_streak || 0) + 1
    : 1;

  await supabase
    .from('users')
    .upsert({ wallet_address: addr, claim_streak: newStreak, last_claim_date: today }, { onConflict: 'wallet_address' });

  // Season 1 Solo Ladder hook. Award 5 points per daily claim if the
  // player is enrolled in the active season. Idempotent via the
  // wallet:date ref — repeated calls in the same day won't double-count.
  try {
    const { data: enrolled } = await supabase
      .from('season_v1_players')
      .select('wallet')
      .ilike('wallet', addr)
      .maybeSingle();
    if (enrolled) {
      await supabase
        .from('season_v1_points')
        .insert({
          wallet: addr,
          action_type: 'daily_claim',
          points: 5,
          ref: `claim:${today}`,
        });
    }
  } catch (e) {
    console.warn('Season 1 points hook (daily_claim) failed:', e.message);
  }

  res.json({ success: true, claimStreak: newStreak, alreadyClaimed: false });
});

// ─── Habitat helpers ─────────────────────────────────────────────────────
function freeTierForLevel(level) {
  let tier = HABITAT_FREE_TIERS[0].id;
  for (const t of HABITAT_FREE_TIERS) {
    if (level >= t.unlockLevel) tier = t.id;
  }
  return tier;
}

// In-memory cache of paid tier ownership per wallet. Chain reads are
// rare-changing (only on unlock), so a 60s TTL keeps the leaderboard
// indicator endpoint fast even when many wallets are queried at once.
const habitatCache = new Map(); // wallet → { ownedPaidTiers: number[], ubiDonated: string, at: ms }
const HABITAT_CACHE_TTL_MS = 60_000;

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

    const { data: meta } = await supabase
      .from('season_v1_meta')
      .select('starts_at, ends_at')
      .eq('active', true)
      .maybeSingle();
    if (!meta) return;

    // Which tiers are already credited inside the active window?
    const { data: existing } = await supabase
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
    const { error } = await supabase.from('season_v1_points').insert(rows);
    if (error) console.warn(`creditHabitatPoints insert failed for ${lower}:`, error.message);
  } catch (e) {
    console.warn(`creditHabitatPoints unexpected error for ${wallet}:`, e?.message || e);
  }
}

async function fetchPaidOwnership(addr) {
  const cached = habitatCache.get(addr);
  if (cached && Date.now() - cached.at < HABITAT_CACHE_TTL_MS) return cached;

  if (!habitatContract) {
    return { ownedPaidTiers: [], ubiDonated: '0', at: Date.now() };
  }

  try {
    // Batch all paid tier checks + donation read in parallel.
    const [ownsResults, ubi] = await Promise.all([
      Promise.all(HABITAT_PAID_TIERS.map(tier => habitatContract.ownsHabitat(addr, tier))),
      habitatContract.playerUbiDonated(addr),
    ]);
    const ownedPaidTiers = HABITAT_PAID_TIERS.filter((_, i) => ownsResults[i] === true);
    const result = { ownedPaidTiers, ubiDonated: ubi.toString(), at: Date.now() };
    habitatCache.set(addr, result);
    return result;
  } catch (e) {
    console.warn(`Habitat ownership read failed for ${addr}:`, e?.message || e);
    return { ownedPaidTiers: [], ubiDonated: '0', at: Date.now() };
  }
}

// ─── GET /api/habitat/:address — combined free + paid + equipped ────────────
// One read for any third-party (leaderboard rows, share cards, dashboards).
// Returns the player's level-derived free tier, on-chain owned paid tiers,
// their currently equipped choice, and total UBI contribution.
app.get('/api/habitat/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return res.status(400).json({ error: 'Invalid address' });

  // Level from XP (same logic as /api/user)
  const { data: userRows } = await supabase
    .from('users')
    .select('xp, equipped_habitat')
    .eq('wallet_address', addr)
    .limit(1);
  const xp = userRows?.[0]?.xp || 0;
  const level = levelFromXp(xp);
  const freeTier = freeTierForLevel(level);

  // Paid ownership (chain) + UBI donation total
  const { ownedPaidTiers, ubiDonated } = await fetchPaidOwnership(addr);

  // Equipped choice. Falls back to highest paid owned, otherwise free tier.
  const stored = userRows?.[0]?.equipped_habitat || null;
  const validStored =
    stored != null &&
    ((stored >= 6 && ownedPaidTiers.includes(stored)) ||
     (stored >= 1 && stored <= 5 && stored <= freeTier));
  const equipped = validStored
    ? stored
    : (ownedPaidTiers.length > 0 ? Math.max(...ownedPaidTiers) : freeTier);

  res.json({
    address: addr,
    level,
    freeTier,
    ownedPaidTiers,
    equipped,
    ubiDonated,
  });

  // Lazy season point credit — fire-and-forget so the response stays fast.
  // Any player loading their habitat page gets their +30/tier credited
  // without waiting on a manual sync.
  creditHabitatPoints(addr, ownedPaidTiers).catch(() => {});
});

// ─── GET /api/season/sync-habitats?wallet=X ─────────────────────────────────
// Reconciles on-chain habitat ownership against the season_v1_points ledger
// for one wallet. Called by /api/season/me right before it reads points so
// the personal score always reflects the latest purchase without needing a
// habitat page visit. Idempotent (creditHabitatPoints filters already-
// credited refs), so /api/season/me can call it on every read.
app.get('/api/season/sync-habitats', async (req, res) => {
  const wallet = String(req.query.wallet || '').toLowerCase().trim();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet' });
  }
  const { ownedPaidTiers } = await fetchPaidOwnership(wallet);
  await creditHabitatPoints(wallet, ownedPaidTiers);
  res.json({ ok: true, owned: ownedPaidTiers });
});

// ─── POST /api/habitat/equip — persist player's equipped tier choice ────────
// Stored in users.equipped_habitat so the choice travels with the wallet
// across devices. Validates ownership before writing.
// SECURITY (2026-07-17 audit): this had no requireSecret because useHabitats
// POSTed it straight from the browser, and a browser cannot hold the secret.
// The CORS origin check is NOT authentication · any script can forge an Origin
// header, so this was world-writable: anyone could change any player's equipped
// habitat. It now goes through the setHabitatEquip server action (see
// frontend/app/actions/habitat.ts), so it can demand the secret like every
// other write path.
app.post('/api/habitat/equip', requireSecret, async (req, res) => {
  const { address, tier } = req.body || {};
  if (!address || typeof tier !== 'number') {
    return res.status(400).json({ error: 'address and tier required' });
  }
  const addr = String(address).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return res.status(400).json({ error: 'Invalid address' });
  if (tier < 1 || tier > 255) return res.status(400).json({ error: 'Invalid tier' });

  // Validate the player can actually equip this tier
  const { data: userRows } = await supabase
    .from('users')
    .select('xp')
    .eq('wallet_address', addr)
    .limit(1);
  const xp = userRows?.[0]?.xp || 0;
  const level = levelFromXp(xp);
  const freeTier = freeTierForLevel(level);

  if (tier <= 5) {
    // Free tier: must be reached by level
    if (tier > freeTier) return res.status(403).json({ error: 'Free tier not yet unlocked' });
  } else {
    // Paid tier: must own on-chain
    const { ownedPaidTiers } = await fetchPaidOwnership(addr);
    if (!ownedPaidTiers.includes(tier)) {
      return res.status(403).json({ error: 'Paid tier not owned' });
    }
  }

  // Upsert: row may not exist yet for new players
  const { error } = await supabase
    .from('users')
    .upsert({ wallet_address: addr, equipped_habitat: tier }, { onConflict: 'wallet_address' });
  if (error) return res.status(500).json({ error: 'Persist failed' });

  res.json({ success: true, equipped: tier });
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

const isCacheFresh = () =>
  challengeCache.plays.size > 0 &&
  Date.now() - challengeCache.at < CHALLENGE_CACHE_TTL_MS;

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
  const { data, error } = await supabase.rpc('challenge_leaderboard', {
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
      username:  await resolveUsername(r.wallet) || null,
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
    const { data: page, error } = await supabase
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
        username:  await resolveUsername(wallet) || null,
      }))
  );
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
app.get('/api/challenges/past', async (_, res) => {
  const { data } = await supabase
    .from('challenge_winners')
    .select('*')
    .lte('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: false })
    .limit(20);
  res.json({ challenges: data || [] });
});

// ─── GET /api/weekly-challenge — community games milestone ──────────────────
// Returns progress toward the weekly community games target. Counts games
// from this week's Monday 00:00 UTC. Each player's contribution is capped at
// PER_PLAYER_CAP so no single grinder can solo the milestone.
// Config lives as constants — bump TARGET and REWARD as community grows.
const WEEKLY_CHALLENGE_TARGET    = 500;   // games needed to hit milestone
const WEEKLY_CHALLENGE_REWARD_G  = 500;  // G$ total pool split equally among qualifying players
const WEEKLY_CHALLENGE_UBI_G     = 50;   // G$ GameArena sends to GoodDollar
const WEEKLY_CHALLENGE_CAP       = 70;   // max games per player that count toward total

app.get('/api/weekly-challenge', async (req, res) => {
  const nowUTC = new Date();
  const dayOfWeek = nowUTC.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(
    nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(),
    nowUTC.getUTCDate() - daysSinceMonday, 0, 0, 0, 0,
  ));
  const sunday = new Date(monday.getTime() + 7 * 86400000 - 1);

  const { data: rows } = await supabase
    .from('activity')
    .select('wallet_address')
    .gte('created_at', monday.toISOString())
    .lte('created_at', sunday.toISOString());

  // Count per player, cap at PER_PLAYER_CAP
  const perPlayer = new Map();
  for (const r of (rows || [])) {
    const w = r.wallet_address?.toLowerCase();
    if (!w) continue;
    perPlayer.set(w, (perPlayer.get(w) || 0) + 1);
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
      username: await resolveUsername(w),
      games:    Math.min(WEEKLY_CHALLENGE_CAP, count),
    })),
  );

  res.json({
    target:       WEEKLY_CHALLENGE_TARGET,
    progress:     totalCapped,
    playersIn,
    hit,
    daysLeft,
    rewardG:      WEEKLY_CHALLENGE_REWARD_G,
    ubiG:         WEEKLY_CHALLENGE_UBI_G,
    capPerPlayer: WEEKLY_CHALLENGE_CAP,
    windowStart:  monday.toISOString(),
    windowEnd:    sunday.toISOString(),
    myContribution,
    contributors: topContributors,
  });
});

// ─── GET /api/competition — cumulative leaderboard (weeks 10-13) ────────────
// Each player's best score per week is summed. Top 3 win $15/$10/$5. The
// comp ran for 4 weeks of activity ending at the close of week 13. The
// public-facing name stays "3-Week Competition" (the original branding the
// community knows) while the data window covers all 4 weeks.
const COMPETITION_WEEKS = [10, 11, 12, 13];

app.get('/api/competition', async (_, res) => {
  const totals = new Map(); // wallet -> { username, rhythm, simon, weeks: { 11: n, 12: n, 13: n } }

  for (const week of COMPETITION_WEEKS) {
    const { start, end } = seasonBounds(week);
    const startIso = new Date(start * 1000).toISOString();
    const endIso   = new Date(end   * 1000).toISOString();

    for (const game of VALID_GAMES) {
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

      // Add to cumulative totals. Historical competition (weeks 10-13)
      // only tracked rhythm + simon · Stack Tower didn't exist yet, so
      // stack scores are intentionally skipped here instead of being
      // mislabeled into totalSimon (which the previous else-fallthrough
      // was silently doing).
      for (const [wallet, score] of weekBest.entries()) {
        if (game !== 'rhythm' && game !== 'simon') continue;
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
  // Count the current week as remaining if we're inside the competition
  // window. Without this, weeksLeft hits 0 during the final active week
  // and the frontend hides the cup card while it should still be live.
  let weeksLeft = COMPETITION_WEEKS.filter(w => w >= current).length;
  const { start: compStart } = seasonBounds(COMPETITION_WEEKS[0]);
  const { end: compEnd }     = seasonBounds(COMPETITION_WEEKS[COMPETITION_WEEKS.length - 1]);

  const nowSec = Math.floor(Date.now() / 1000);
  // Always attempt freeze. The function self-gates on (nowSec >= compEnd) so
  // nothing happens before the window closes. Removing the outer week-number
  // guard means a freshly-restarted process will still freeze on the first
  // /api/competition GET after the deadline, even if no one queried during
  // the exact handoff minute.
  await freezeCompetitionIfNeeded(nowSec, rankings, compEnd, compStart);

  // If the competition has been frozen (auto or via admin), force weeksLeft
  // to 0 so the live card hides and only the COMPLETED EVENTS card renders.
  // Without this, an admin force-freeze would put the same comp in both
  // sections of the UI, which reads as a bug to the player.
  const { data: frozenRow } = await supabase
    .from('competition_winners')
    .select('id')
    .eq('id', COMPETITION_ID)
    .limit(1);
  if (frozenRow && frozenRow.length > 0) weeksLeft = 0;

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
  const { error } = await supabase.from('competition_winners').upsert({
    id: COMPETITION_ID,
    name: COMPETITION_NAME,
    starts_at: new Date(compStart * 1000).toISOString(),
    ends_at:   new Date(compEnd   * 1000).toISOString(),
    weeks: COMPETITION_WEEKS,
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
app.get('/api/competition/past', async (_, res) => {
  const { data } = await supabase
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
app.post('/api/competition/freeze', requireSecret, async (_, res) => {
  try {
    // Recompute current rankings exactly the way GET /api/competition does.
    const totals = new Map();
    for (const week of COMPETITION_WEEKS) {
      const { start, end } = seasonBounds(week);
      const startIso = new Date(start * 1000).toISOString();
      const endIso   = new Date(end   * 1000).toISOString();
      for (const game of VALID_GAMES) {
        const { data: rows } = await supabase
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
        .map(async e => ({ ...e, username: await resolveUsername(e.wallet) || null }))
    );

    const { start: compStart } = seasonBounds(COMPETITION_WEEKS[0]);
    const { end: compEnd }     = seasonBounds(COMPETITION_WEEKS[COMPETITION_WEEKS.length - 1]);

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
app.get('/api/weekly-challenge/payout-list', requireSecret, async (_, res) => {
  try {
    const nowUTC = new Date();
    const dayOfWeek = nowUTC.getUTCDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(Date.UTC(
      nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(),
      nowUTC.getUTCDate() - daysSinceMonday, 0, 0, 0, 0,
    ));
    const sunday = new Date(monday.getTime() + 7 * 86400000 - 1);

    const { data: rows } = await supabase
      .from('activity')
      .select('wallet_address')
      .gte('created_at', monday.toISOString())
      .lte('created_at', sunday.toISOString());

    const rawCount = new Map();
    for (const r of (rows || [])) {
      const w = r.wallet_address?.toLowerCase();
      if (!w) continue;
      rawCount.set(w, (rawCount.get(w) || 0) + 1);
    }

    const totalCapped = Array.from(rawCount.values())
      .reduce((s, n) => s + Math.min(WEEKLY_CHALLENGE_CAP, n), 0);
    const hit = totalCapped >= WEEKLY_CHALLENGE_TARGET;

    // Per-player payout = total reward pool ÷ number of qualifying players
    const qualifyingWallets = Array.from(rawCount.keys());
    const perPlayerG = qualifyingWallets.length > 0
      ? Math.floor(WEEKLY_CHALLENGE_REWARD_G / qualifyingWallets.length)
      : 0;

    const players = await Promise.all(
      qualifyingWallets.map(async (w) => ({
        wallet:      w,
        username:    await resolveUsername(w) || null,
        gamesPlayed: rawCount.get(w),
        countedGames: Math.min(WEEKLY_CHALLENGE_CAP, rawCount.get(w)),
        payoutG:     perPlayerG,
      }))
    );

    players.sort((a, b) => b.countedGames - a.countedGames);

    res.json({
      milestoneHit:    hit,
      weekStart:       monday.toISOString(),
      weekEnd:         sunday.toISOString(),
      totalCappedGames: totalCapped,
      target:          WEEKLY_CHALLENGE_TARGET,
      totalPlayers:    qualifyingWallets.length,
      rewardPool:      WEEKLY_CHALLENGE_REWARD_G,
      perPlayerG,
      ubiG:            WEEKLY_CHALLENGE_UBI_G,
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
const { ArenaMatchEngine } = require('./lib/arenaMatch');
const { attestInstantMatch } = require('./lib/feedbackOracle');

// Ladder bucket, SEASON-ALIGNED. The ladder now resets on the SAME clock as the
// skill games (Rhythm/Simon/Stack): the fixed SEASON_EPOCH, 7-day windows, so
// Challenge AI and the skill leaderboards roll over together. Key form 'S<n>'
// (e.g. 'S24'). Older rows use the legacy ISO 'YYYY-Www' form and stay viewable
// as past weeks. The payout runs on the season boundary, not Sunday.
function arenaWeekKey(d = new Date()) {
  const t = Math.floor(d.getTime() / 1000);
  const season = Math.floor((t - SEASON_EPOCH) / (SEASON_DAYS * 86400)) + 1;
  return `S${season}`;
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

// ─── On-chain match receipt · Challenge AI → GamePass ────────────────────────
// Every completed Challenge AI match writes ONE transaction to GamePass as
// gameType 3, carrying the player's RUNNING SEASON TOTAL (the sum of their
// points for the current season bucket — the same window the ladder uses). So
// each match is its own tx, and the value climbs: 10 → 23 → 25 …
//
// Why the running total instead of the per-match points:
//   · The on-chain number then EQUALS the ladder total, and because the total
//     only climbs within a season, GamePass's weeklyBest[season][3] naturally
//     ends the season holding that total — directly rankable on-chain. (The
//     GamePass season boundary (block.timestamp / 7 days) is aligned with our
//     SEASON_EPOCH, which is an exact multiple of 7 days, so both reset together
//     and bestScore[3] becomes "best season ever".)
//   · SELF-HEALING: each write re-reads the sum from the DB, so if one match's
//     write fails (best-effort), the NEXT match's write catches the total back
//     up. Per-match writes would lose a failed match's contribution forever.
// Per-match detail still lives in arena_free_matches, so no history is lost.
//
// Backend-submitted via recordScore (validator == on-chain scoreValidator), so
// the player never signs or pays gas — the free instant loop is untouched.
//
// Writes are SERIALIZED through one promise chain so ethers assigns sequential
// nonces: concurrent matches would otherwise race on the validator wallet's
// nonce and all but one would revert. Best-effort throughout — a failed or
// disabled write never affects gameplay, the DB receipt, or the ladder.
// matchId → { txHash, at } for the just-written on-chain receipt. Lets the
// finish screen show a Celoscan link for THIS match without a DB column: the
// player is on the finish screen when the tx lands seconds later, so a short-
// lived in-memory entry is enough. Pruned on write past CHALLENGE_RECEIPT_TTL.
const challengeReceipts = new Map();
const CHALLENGE_RECEIPT_TTL_MS = 10 * 60 * 1000;
function _pruneChallengeReceipts() {
  const cutoff = Date.now() - CHALLENGE_RECEIPT_TTL_MS;
  for (const [id, r] of challengeReceipts) {
    if (r.at < cutoff) challengeReceipts.delete(id);
  }
}

// ─── Signer gas guard ────────────────────────────────────────────────────────
// The score-signer wallet (0xc1cF, == on-chain scoreValidator) pays gas for
// every backend-submitted write AND funds the faucet drips (~0.7 CELO each, the
// biggest drain). If it runs dry, writes revert (caught as best-effort, so
// gameplay is fine) but scores silently stop reaching the chain and drips fail.
//
// This runs as a DECOUPLED periodic check, NOT hung off any one traffic path:
// the wallet drains from faucet drips, Challenge AI writes, and (soon) gasless
// skill-game writes, so a check that only fired on Challenge AI matches would
// miss a faucet-driven drain on a quiet-match night. One cheap getBalance every
// interval covers every drain source. Warns each interval while low so it stays
// visible until topped up. `.unref()` so it never keeps the process alive.
const SIGNER_MIN_CELO = Number(process.env.SIGNER_MIN_CELO || 5);
const SIGNER_GAS_CHECK_INTERVAL_MS = 5 * 60 * 1000;
async function _checkSignerGas() {
  if (!provider || !passScoreWriter?.runner?.address) return;
  try {
    const addr = passScoreWriter.runner.address;
    const bal = Number(ethers.formatEther(await provider.getBalance(addr)));
    if (bal < SIGNER_MIN_CELO) {
      console.warn(`🔴 SIGNER LOW GAS · ${addr} has ${bal.toFixed(3)} CELO (< ${SIGNER_MIN_CELO}) · top it up or on-chain score writes + faucet drips will start failing`);
    }
  } catch { /* balance check is best-effort */ }
}
if (provider && passScoreWriter) {
  const _gasTimer = setInterval(_checkSignerGas, SIGNER_GAS_CHECK_INTERVAL_MS);
  if (_gasTimer.unref) _gasTimer.unref();
  _checkSignerGas(); // one check at boot so a wallet that starts low is flagged now
}

let _challengeWriteChain = Promise.resolve();
async function _doRecordChallengeMatch(session) {
  if (!passScoreWriter) return; // no validator key configured — silently skip
  try {
    // Running season total = sum of this wallet's points for the current season
    // bucket. The match was already inserted into arena_free_matches before this
    // runs (onMatchComplete awaits the insert first), so the sum includes it.
    const weekKey = arenaWeekKey();
    const { data, error } = await supabase
      .from('arena_free_matches')
      .select('points')
      .eq('wallet', session.wallet)
      .eq('week_key', weekKey);
    if (error) throw error;
    let total = 0;
    for (const r of data || []) total += r.points || 0;
    if (total <= 0) return; // nothing to record yet
    const tx = await passScoreWriter.recordScore(session.wallet, CHALLENGE_AI_GAME_TYPE, total);
    console.log(`🏆 Challenge AI on-chain · ${String(session.wallet).slice(0, 10)}… ${weekKey} total ${total} · ${tx.hash}`);
    if (session.matchId) {
      _pruneChallengeReceipts();
      challengeReceipts.set(String(session.matchId), { txHash: tx.hash, at: Date.now() });
    }
  } catch (e) {
    console.warn(`⚠️  Challenge AI recordScore failed · ${String(session.wallet).slice(0, 10)}…:`, e?.message);
  }
}
function recordChallengeMatchOnChain(session) {
  _challengeWriteChain = _challengeWriteChain.then(() => _doRecordChallengeMatch(session)).catch(() => {});
  return _challengeWriteChain;
}

const ARENA_WEEKLY_POOL_GS = Number(process.env.ARENA_WEEKLY_POOL_GS || 500);

// ─── Arena G$ perks: daily limit + purchase rail ────────────────────────────
// FREE matches/day per wallet. Casual play never hits the wall; ladder
// grinders refill with G$ that routes to the weekly pool wallet.
const ARENA_FREE_MATCHES_PER_DAY = Number(process.env.ARENA_FREE_MATCHES_PER_DAY || 10);
const ARENA_POOL_WALLET = (process.env.ARENA_POOL_WALLET || '').toLowerCase();
const ARENA_G_TOKEN = (process.env.G_TOKEN_ADDR || '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A').toLowerCase();
const ARENA_SKUS = {
  refill_5: { priceWei: ethers.parseEther('2'), grantExtra: 5, label: '+5 matches' },
};
const ERC20_TRANSFER_IFACE = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

// ─── Gasless purchases via EIP-2612 permit ──────────────────────────────────
// G$ on Celo supports permit (verified on-chain: domain GoodDollar/1/42220).
// The player signs a permit for the relayer off-chain (zero gas, zero CELO);
// the relayer submits permit + transferFrom(player → pool wallet) and pays
// the gas. Kills the last purchase friction for embedded-wallet players.
const ARENA_RELAYER_KEY = process.env.ARENA_RELAYER_KEY || process.env.VALIDATOR_PRIVATE_KEY || '';
const arenaRelayer = (provider && ARENA_RELAYER_KEY) ? new ethers.Wallet(ARENA_RELAYER_KEY, provider) : null;
const ARENA_GD = provider ? new ethers.Contract(ARENA_G_TOKEN, [
  'function nonces(address) view returns (uint256)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
], arenaRelayer || provider) : null;

// ─── PerkShop gasless rail (M1 G$ Perk Economy) ─────────────────────────────
// Same relayer, same permit trick as the arena refill: the player signs a
// permit for the PerkShop contract (spender = PerkShop), the relayer submits
// buyPerkWithPermit and pays the gas. The 20/80 split runs inside the contract.
const PERK_SHOP_ADDRESS = (process.env.PERK_SHOP_ADDRESS || '0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5').toLowerCase();
const PERK_SHOP = (provider && arenaRelayer) ? new ethers.Contract(PERK_SHOP_ADDRESS, [
  'function buyPerkWithPermit(address player, uint16 perkId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
], arenaRelayer) : null;

// PerkShop perk #6 = the Challenge AI match ticket. A verified purchase of it
// grants +5 matches — the PerkShop-native replacement for the refill_5 SKU,
// so ticket spend now routes through the same 20/80 split as every perk.
const PERK_TICKET_ID = 6;
const PERK_TICKET_GRANT = 5;
// Consumable save/retry perks that stock as an inventory (owned - used).
// Cosmetics (2, 4) are on-chain ownership; the Match Pack (6) grants matches.
const CONSUMABLE_STOCK_PERKS = new Set([1, 3, 5]);
const PERK_PURCHASED_IFACE = new ethers.Interface([
  'event PerkPurchased(address indexed player, uint16 indexed perkId, bool cosmetic, uint256 totalPaid, uint256 ubiAmount, uint256 treasuryAmount)',
]);

// Shared grant: record the purchase (replay-proof via tx_hash PK) and bump
// today's extra allowance. Used by both the direct-transfer and gasless paths.
async function arenaGrantPurchase(wallet, sku, txHash, amountWei) {
  const item = ARENA_SKUS[sku];
  const { error: insErr } = await supabase.from('arena_purchases').insert({
    tx_hash: txHash, wallet, sku, amount_wei: amountWei.toString(),
  });
  if (insErr) return { ok: false, reason: 'grant_failed' };
  const day = arenaDayKey();
  const { data: row } = await supabase
    .from('arena_daily').select('used, extra').eq('wallet', wallet).eq('day', day).maybeSingle();
  await supabase.from('arena_daily').upsert({
    wallet, day,
    used: row?.used ?? 0,
    extra: (row?.extra ?? 0) + item.grantExtra,
    updated_at: new Date().toISOString(),
  });
  return { ok: true, remaining: ARENA_FREE_MATCHES_PER_DAY + (row?.extra ?? 0) + item.grantExtra - (row?.used ?? 0) };
}

function arenaDayKey() { return new Date().toISOString().slice(0, 10); }

// Consume one match slot. Fail-soft: if the table is missing (local setup
// pre-migration) play is unlimited. Read-then-update has a benign race at
// this scale; the limit is an economy dial, not a security boundary.
async function arenaConsumeSlot(wallet) {
  const day = arenaDayKey();
  try {
    const { data, error } = await supabase
      .from('arena_daily')
      .select('used, extra')
      .eq('wallet', wallet)
      .eq('day', day)
      .maybeSingle();
    if (error) throw error;
    const used = data?.used ?? 0;
    const extra = data?.extra ?? 0;
    const allowance = ARENA_FREE_MATCHES_PER_DAY + extra;
    if (used >= allowance) return { ok: false, remaining: 0 };
    await supabase.from('arena_daily').upsert({
      wallet, day, used: used + 1, extra, updated_at: new Date().toISOString(),
    });
    return { ok: true, remaining: allowance - used - 1 };
  } catch (e) {
    // Fail CLOSED on a real error. This used to return ok:true on ANY error,
    // so a transient DB blip silently handed out UNLIMITED free matches. The
    // one legitimate exception is a genuinely absent table (local dev before
    // the migration), which we detect explicitly rather than assuming.
    const missingTable = /PGRST205|does not exist|schema cache/i.test(e?.message || '');
    if (missingTable) return { ok: true, remaining: null }; // local dev only
    console.error('arenaConsumeSlot failed · denying slot:', e?.message);
    return { ok: false, remaining: 0 };
  }
}

// Verify a G$ transfer to the pool wallet and grant the SKU. Mirrors the
// verifyScoreTx pattern: receipt polled, status checked, target checked,
// Transfer(player → pool, ≥price) parsed from logs. tx_hash PK = replay-proof.
async function arenaVerifyPurchase(txHash, wallet, sku) {
  const item = ARENA_SKUS[sku];
  if (!item) return { ok: false, reason: 'unknown_sku' };
  if (!ARENA_POOL_WALLET) return { ok: false, reason: 'pool_wallet_unconfigured' };
  if (!provider) return { ok: false, reason: 'rpc_unavailable' };

  const { data: existing } = await supabase
    .from('arena_purchases').select('tx_hash').eq('tx_hash', txHash).maybeSingle();
  if (existing) return { ok: false, reason: 'tx_already_used' };

  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  let receipt = null;
  while (Date.now() < deadline) {
    try { receipt = await provider.getTransactionReceipt(txHash); if (receipt) break; } catch {}
    await new Promise(r => setTimeout(r, RECEIPT_POLL_MS));
  }
  if (!receipt) return { ok: false, reason: 'receipt_not_found' };
  if (Number(receipt.status) !== 1) return { ok: false, reason: 'tx_reverted' };
  if ((receipt.to || '').toLowerCase() !== ARENA_G_TOKEN) {
    return { ok: false, reason: 'tx_not_gdollar' };
  }
  let paid = null;
  for (const log of receipt.logs || []) {
    try {
      const parsed = ERC20_TRANSFER_IFACE.parseLog({ topics: log.topics, data: log.data });
      if (!parsed || parsed.name !== 'Transfer') continue;
      if (String(parsed.args.from).toLowerCase() !== wallet) continue;
      if (String(parsed.args.to).toLowerCase() !== ARENA_POOL_WALLET) continue;
      if (BigInt(parsed.args.value) >= item.priceWei) { paid = parsed.args.value; break; }
    } catch {}
  }
  if (!paid) return { ok: false, reason: 'transfer_to_pool_not_found' };

  const { error: insErr } = await supabase.from('arena_purchases').insert({
    tx_hash: txHash, wallet, sku, amount_wei: paid.toString(),
  });
  if (insErr) return { ok: false, reason: 'grant_failed' }; // unique violation = replay race

  // Grant: bump today's extra allowance.
  const day = arenaDayKey();
  const { data: row } = await supabase
    .from('arena_daily').select('used, extra').eq('wallet', wallet).eq('day', day).maybeSingle();
  await supabase.from('arena_daily').upsert({
    wallet, day,
    used: row?.used ?? 0,
    extra: (row?.extra ?? 0) + item.grantExtra,
    updated_at: new Date().toISOString(),
  });
  const remaining = ARENA_FREE_MATCHES_PER_DAY + (row?.extra ?? 0) + item.grantExtra - (row?.used ?? 0);
  return { ok: true, remaining };
}

// ─── GamePass gate · ladder integrity ───────────────────────────────────────
// Anyone can PLAY the arena free · that is the funnel and we keep it open.
// But a match only COUNTS on the ladder if the wallet actually minted a
// GamePass on-chain, exactly like the other games (play free, mint to save
// your score). Minting costs a real signature and gas, so throwaway wallets
// stop being free.
//
// Why this exists: the ladder previously recorded any address the caller
// passed. The daily cap is per-wallet, so one operator with N wallets got N x
// the free allowance. That is exactly what happened · 11 wallets first seen
// inside a 107-second window, each burning precisely the 10/day cap for two
// days, none of them holding a pass.
//
// Cached with a TTL so a real player costs one RPC read, not one per match.
// Fails CLOSED: if we cannot prove a pass, the match is not recorded. A real
// player loses one row during an RPC blip; a sybil farm gets nothing. That is
// the right trade for a ladder that pays G$.
const PASS_CACHE_TTL_MS = 10 * 60 * 1000;
const passCache = new Map(); // wallet -> { has: boolean, at: number }

async function hasGamePass(wallet) {
  const w = (wallet || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) return false;
  const hit = passCache.get(w);
  if (hit && Date.now() - hit.at < PASS_CACHE_TTL_MS) return hit.has;
  if (!passContract) return false; // no RPC configured · cannot prove · fail closed
  try {
    const has = await passContract.hasMinted(w);
    passCache.set(w, { has: !!has, at: Date.now() });
    return !!has;
  } catch (e) {
    console.warn(`⚠️  GamePass check failed for ${w.slice(0, 10)}…:`, e?.message);
    if (hit) return hit.has; // a stale answer beats guessing
    return false;            // fail closed
  }
}

const arenaEngine = new ArenaMatchEngine({
  onMatchComplete: async (session) => {
    // Receipt layer: persist completed matches for history, ladder, and the
    // async Oracle attestation. Table may not exist yet in local setups —
    // persistence is best-effort, gameplay never depends on it.
    try {
      if (!(await hasGamePass(session.wallet))) {
        // Played fine, just not ranked. The finish screen prompts the mint.
        console.log(`⛔ arena match not recorded · no GamePass: ${String(session.wallet).slice(0, 10)}…`);
        attestInstantMatch(session);
        return;
      }
      await supabase.from('arena_free_matches').insert({
        match_id: session.matchId,
        wallet: session.wallet,
        player_wins: session.playerWins,
        ai_wins: session.aiWins,
        ties: session.ties,
        outcome: session.playerWins > session.aiWins ? 'player_won'
               : session.aiWins > session.playerWins ? 'ai_won' : 'tie',
        rounds: session.rounds,
        commit_hash: session.commitHash,
        seed: session.seed,
        points: arenaPoints(session),
        week_key: arenaWeekKey(),
        created_at: new Date(session.createdAt).toISOString(),
      });
    } catch (e) {
      console.error('arena match persist failed:', e?.message);
    }
    // On-chain receipt: one ScoreRecorded event per match (gameType 3), the same
    // history trail the skill games leave. Fire-and-forget + serialized inside —
    // never blocks or breaks the match flow. Reached only past the hasGamePass
    // gate above, so the player is guaranteed minted (recordScore requires it).
    recordChallengeMatchOnChain(session);
    // ERC-8004 reputation: emit one match_completed feedback per finished
    // match (throttled inside the oracle · min-interval, fire-and-forget).
    // Replaces the wager-era hook that fired after resolveMatch, which v3
    // Instant Arena matches never reach · without this MARKOV's engagement
    // dimension on 8004scan stalls.
    attestInstantMatch(session);
  },
});

// POST /api/arena/start — open an instant match. Returns the commit hash
// BEFORE any round: MARKOV's moves are provably pre-seeded. Enforces the
// daily free-match limit; when exhausted, returns the refill offer.
app.post('/api/arena/start', requireSecret, gameSubmitLimiter, async (req, res) => {
  const { playerAddress } = req.body || {};
  if (!playerAddress || !/^0x[0-9a-fA-F]{40}$/.test(playerAddress)) {
    return res.status(400).json({ error: 'playerAddress required' });
  }
  const slot = await arenaConsumeSlot(playerAddress.toLowerCase());
  if (!slot.ok) {
    // Gasless path metadata: the player's current G$ permit nonce + the
    // relayer address the permit must approve. Best-effort — if the RPC
    // read fails, the frontend falls back to the direct-transfer path.
    let permitNonce = null;
    if (ARENA_GD && arenaRelayer) {
      try { permitNonce = (await ARENA_GD.nonces(playerAddress)).toString(); } catch {}
    }
    return res.status(402).json({
      error: 'daily_limit',
      remaining: 0,
      refill: {
        sku: 'refill_5',
        priceGs: 2,
        grants: 5,
        poolWallet: ARENA_POOL_WALLET,
        gToken: ARENA_G_TOKEN,
        relayer: arenaRelayer ? arenaRelayer.address : null,
        permitNonce,
      },
    });
  }
  return res.json({ ...arenaEngine.start(playerAddress), remainingToday: slot.remaining });
});

// POST /api/arena/purchase-gasless — the player signed an EIP-2612 permit
// for the relayer; we submit permit + transferFrom(player → pool) paying
// gas ourselves, then grant. Body: { wallet, sku, deadline, v, r, s }.
// Replay-safe twice over: the permit nonce is single-use on-chain, and the
// transferFrom tx hash is the arena_purchases primary key.
app.post('/api/arena/purchase-gasless', requireSecret, gameSubmitLimiter, async (req, res) => {
  const { wallet, sku, deadline, v, r, s } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  const item = ARENA_SKUS[String(sku)];
  if (!item) return res.status(400).json({ error: 'unknown_sku' });
  if (!ARENA_GD || !arenaRelayer) return res.status(400).json({ error: 'gasless_unavailable' });
  if (!ARENA_POOL_WALLET) return res.status(400).json({ error: 'pool_wallet_unconfigured' });
  try {
    const permitTx = await ARENA_GD.permit(wallet, arenaRelayer.address, item.priceWei, BigInt(deadline), Number(v), r, s);
    await permitTx.wait();
    const moveTx = await ARENA_GD.transferFrom(wallet, ARENA_POOL_WALLET, item.priceWei);
    const rc = await moveTx.wait();
    if (Number(rc.status) !== 1) return res.status(400).json({ error: 'transfer_reverted' });
    const out = await arenaGrantPurchase(wallet.toLowerCase(), String(sku), rc.hash, item.priceWei);
    if (!out.ok) return res.status(400).json({ error: out.reason });
    return res.json({ ok: true, remaining: out.remaining, txHash: rc.hash });
  } catch (e) {
    console.error('gasless purchase failed:', e?.shortMessage || e?.message);
    return res.status(400).json({ error: 'gasless_failed' });
  }
});

// POST /api/arena/purchase — verify an on-chain G$ transfer to the pool
// wallet and grant the SKU. Body: { wallet, sku, txHash }.
app.post('/api/arena/purchase', requireSecret, gameSubmitLimiter, async (req, res) => {
  const { wallet, sku, txHash } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ error: 'txHash required' });
  const out = await arenaVerifyPurchase(txHash, wallet.toLowerCase(), String(sku));
  if (!out.ok) return res.status(400).json({ error: out.reason });
  return res.json({ ok: true, remaining: out.remaining });
});

// POST /api/perks/buy-gasless — the player signed an EIP-2612 permit for the
// PerkShop contract; the relayer submits buyPerkWithPermit and pays gas, so
// the buy costs the player zero CELO and one signature. The G$ split (20% UBI
// / 80% treasury) happens inside the contract. Body: { wallet, perkId, deadline, v, r, s }.
// Replay-safe: the permit nonce is single-use on-chain.
app.post('/api/perks/buy-gasless', requireSecret, gameSubmitLimiter, async (req, res) => {
  const { wallet, perkId, deadline, v, r, s } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  const pid = Number(perkId);
  if (!Number.isInteger(pid) || pid < 1 || pid > 65535) return res.status(400).json({ error: 'bad_perk' });
  if (!PERK_SHOP || !arenaRelayer) return res.status(400).json({ error: 'gasless_unavailable' });
  try {
    const tx = await PERK_SHOP.buyPerkWithPermit(wallet, pid, BigInt(deadline), Number(v), r, s);
    const rc = await tx.wait();
    if (Number(rc.status) !== 1) return res.status(400).json({ error: 'purchase_reverted' });
    return res.json({ ok: true, txHash: rc.hash });
  } catch (e) {
    console.error('perk gasless failed:', e?.shortMessage || e?.message);
    return res.status(400).json({ error: 'gasless_failed' });
  }
});

// POST /api/perks/grant — verify an on-chain PerkShop purchase and grant it.
// Routes by perk: the Match Pack (#6) grants +5 matches; save/retry perks
// (1/3/5) stock as inventory (owned - used); cosmetics need no grant (owned
// on-chain). Works for both gasless and direct buys — the frontend hands us the
// buy tx hash. Replay-safe: tx hash is the arena_purchases primary key.
// Body: { wallet, txHash }.
app.post('/api/perks/grant', requireSecret, gameSubmitLimiter, async (req, res) => {
  const { wallet, txHash } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ error: 'txHash required' });
  if (!provider) return res.status(400).json({ error: 'rpc_unavailable' });
  const w = wallet.toLowerCase();

  const { data: existing } = await supabase
    .from('arena_purchases').select('tx_hash').eq('tx_hash', txHash).maybeSingle();
  if (existing) return res.status(400).json({ error: 'tx_already_used' });

  // Wait for the receipt, then confirm it's a PerkShop PerkPurchased by this wallet.
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  let receipt = null;
  while (Date.now() < deadline) {
    try { receipt = await provider.getTransactionReceipt(txHash); if (receipt) break; } catch {}
    await new Promise(r => setTimeout(r, RECEIPT_POLL_MS));
  }
  if (!receipt) return res.status(400).json({ error: 'receipt_not_found' });
  if (Number(receipt.status) !== 1) return res.status(400).json({ error: 'tx_reverted' });

  let matched = null;
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== PERK_SHOP_ADDRESS) continue;
    try {
      const parsed = PERK_PURCHASED_IFACE.parseLog({ topics: log.topics, data: log.data });
      if (!parsed || parsed.name !== 'PerkPurchased') continue;
      if (String(parsed.args.player).toLowerCase() !== w) continue;
      matched = parsed.args; break;
    } catch {}
  }
  if (!matched) return res.status(400).json({ error: 'perk_purchase_not_found' });
  const pid = Number(matched.perkId);

  // Record the purchase (idempotency guard).
  const { error: insErr } = await supabase.from('arena_purchases').insert({
    tx_hash: txHash, wallet: w, sku: 'perk_' + pid, amount_wei: String(matched.totalPaid),
  });
  if (insErr) return res.status(400).json({ error: 'tx_already_used' }); // unique violation = replay race

  // Route the grant by perk type.
  if (pid === PERK_TICKET_ID) {
    const day = arenaDayKey();
    const { data: row } = await supabase
      .from('arena_daily').select('used, extra').eq('wallet', w).eq('day', day).maybeSingle();
    await supabase.from('arena_daily').upsert({
      wallet: w, day, used: row?.used ?? 0,
      extra: (row?.extra ?? 0) + PERK_TICKET_GRANT, updated_at: new Date().toISOString(),
    });
    const remaining = ARENA_FREE_MATCHES_PER_DAY + (row?.extra ?? 0) + PERK_TICKET_GRANT - (row?.used ?? 0);
    return res.json({ ok: true, kind: 'matches', remaining });
  }
  if (CONSUMABLE_STOCK_PERKS.has(pid)) {
    const { data: row } = await supabase
      .from('perk_inventory').select('balance').eq('wallet', w).eq('perk_id', pid).maybeSingle();
    const balance = (row?.balance ?? 0) + 1;
    await supabase.from('perk_inventory').upsert({
      wallet: w, perk_id: pid, balance, updated_at: new Date().toISOString(),
    });
    return res.json({ ok: true, kind: 'stock', perkId: pid, balance });
  }
  return res.json({ ok: true, kind: 'cosmetic' }); // ownership is on-chain, nothing to grant
});

// POST /api/perks/use — spend one save/retry from a player's stock. Called by
// the game when a player uses a save they bought ahead. Body: { wallet, perkId }.
app.post('/api/perks/use', requireSecret, gameSubmitLimiter, async (req, res) => {
  const { wallet, perkId } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  const pid = Number(perkId);
  if (!CONSUMABLE_STOCK_PERKS.has(pid)) return res.status(400).json({ error: 'not_a_stock_perk' });
  const w = wallet.toLowerCase();
  const { data: row } = await supabase
    .from('perk_inventory').select('balance').eq('wallet', w).eq('perk_id', pid).maybeSingle();
  const bal = row?.balance ?? 0;
  if (bal <= 0) return res.json({ ok: false, balance: 0 });
  await supabase.from('perk_inventory').upsert({
    wallet: w, perk_id: pid, balance: bal - 1, updated_at: new Date().toISOString(),
  });
  return res.json({ ok: true, balance: bal - 1 });
});

// GET /api/perks/inventory?wallet=0x… — a player's save/retry stock counts.
app.get('/api/perks/inventory', requireSecret, async (req, res) => {
  const w = (req.query.wallet || '').toString().toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(w)) return res.status(400).json({ error: 'wallet required' });
  try {
    const { data } = await supabase.from('perk_inventory').select('perk_id, balance').eq('wallet', w);
    const balances = {};
    for (const r of data || []) if (r.balance > 0) balances[r.perk_id] = r.balance;
    return res.json({ balances });
  } catch {
    return res.json({ balances: {} });
  }
});

// GET /api/cosmetics/equip?wallet=0x… — a player's explicit equip choices.
// Returns only rows they've set; the client treats any owned cosmetic NOT in
// this map as equipped (default ON). Keyed by wallet so the choice follows
// the account across browsers/devices.
app.get('/api/cosmetics/equip', requireSecret, async (req, res) => {
  const w = (req.query.wallet || '').toString().toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(w)) return res.status(400).json({ error: 'wallet required' });
  try {
    const { data } = await supabase.from('cosmetic_equip').select('perk_id, equipped').eq('wallet', w);
    const equipped = {};
    for (const r of data || []) equipped[r.perk_id] = r.equipped;
    return res.json({ equipped });
  } catch {
    return res.json({ equipped: {} });
  }
});

// POST /api/cosmetics/equip — set one cosmetic's equipped flag for a wallet.
// Body: { wallet, perkId, equipped }. Pure display preference — no on-chain
// effect, so no purchase proof required (just the internal secret).
app.post('/api/cosmetics/equip', requireSecret, gameSubmitLimiter, async (req, res) => {
  const { wallet, perkId, equipped } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  const pid = Number(perkId);
  if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ error: 'perkId required' });
  const w = wallet.toLowerCase();
  const { error } = await supabase.from('cosmetic_equip').upsert({
    wallet: w, perk_id: pid, equipped: !!equipped, updated_at: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: 'save_failed' });
  return res.json({ ok: true, perkId: pid, equipped: !!equipped });
});

// POST /api/arena/throw — one round. Instant response with MARKOV's move,
// round result, persona line, and (on match end) the seed reveal + model stats.
app.post('/api/arena/throw', requireSecret, gameSubmitLimiter, (req, res) => {
  const { matchId, move } = req.body || {};
  if (typeof matchId !== 'string') return res.status(400).json({ error: 'matchId required' });
  const out = arenaEngine.throw(matchId, Number(move));
  if (out.error) return res.status(400).json(out);
  return res.json(out);
});

// GET /api/arena/receipt?matchId=… — the on-chain GamePass tx for a finished
// match, once written. The write fires fire-and-forget in onMatchComplete, so
// the finish screen polls this a few times: { pending: true } until the tx
// lands, then { txHash }. Absent entry = not written yet (or the player had no
// GamePass / validator key unset) — the finish screen just shows nothing.
app.get('/api/arena/receipt', requireSecret, (req, res) => {
  const matchId = (req.query.matchId || '').toString();
  if (!matchId) return res.status(400).json({ error: 'matchId required' });
  const r = challengeReceipts.get(matchId);
  if (r && r.txHash) return res.json({ txHash: r.txHash });
  return res.json({ pending: true });
});

// GET /api/arena/ladder?wallet=0x…&week=2026-W27 — the weekly MARKOV ladder.
// Aggregates the requested ISO week (default: current): points desc, then
// wins desc. Returns top 20 + own standing + pool + the list of past weeks
// so finished boards stay viewable forever (bragging rights don't expire).
app.get('/api/arena/ladder', requireSecret, async (req, res) => {
  try {
    const currentWeek = arenaWeekKey();
    const reqWeek = (req.query.week || '').toString();
    // Accept the new season key (S<n>) and the legacy ISO form (YYYY-Www) so
    // past weeks stay viewable through the transition.
    const week = /^(S\d+|\d{4}-W\d{2})$/.test(reqWeek) ? reqWeek : currentWeek;
    const wallet = (req.query.wallet || '').toString().toLowerCase();
    const { data, error } = await supabase
      .from('arena_free_matches')
      .select('wallet, points, outcome')
      .eq('week_key', week);
    if (error) throw error;

    // Distinct weeks with any matches (cheap at this scale) — newest first.
    let weeks = [currentWeek];
    try {
      const { data: wk } = await supabase
        .from('arena_free_matches')
        .select('week_key')
        .order('week_key', { ascending: false })
        .limit(2000);
      const seen = new Set([currentWeek]);
      for (const r of wk || []) seen.add(r.week_key);
      // Newest first. Season keys ('S<n>') sort by number so S100 > S24; any
      // legacy ISO keys fall back to string order below the season keys.
      const seasonNum = k => (/^S(\d+)$/.test(k) ? parseInt(k.slice(1), 10) : -1);
      weeks = [...seen].sort((a, b) => {
        const an = seasonNum(a), bn = seasonNum(b);
        if (an >= 0 && bn >= 0) return bn - an;
        if (an >= 0) return -1;
        if (bn >= 0) return 1;
        return a < b ? 1 : -1;
      }).slice(0, 12);
    } catch { /* keep current-only */ }

    const agg = new Map();
    for (const row of data || []) {
      const a = agg.get(row.wallet) || { wallet: row.wallet, points: 0, matches: 0, wins: 0 };
      a.points += row.points || 0;
      a.matches += 1;
      if (row.outcome === 'player_won') a.wins += 1;
      agg.set(row.wallet, a);
    }
    const standings = [...agg.values()].sort((x, y) => y.points - x.points || y.wins - x.wins);
    standings.forEach((s, i) => { s.rank = i + 1; });

    // Usernames for the visible slice (GamePass on-chain names, LRU-cached).
    await Promise.all(standings.slice(0, 20).map(async (s) => {
      s.username = await resolveUsername(s.wallet);
    }));

    const me = wallet ? standings.find((s) => s.wallet === wallet) || null : null;
    if (me && me.username === undefined) me.username = await resolveUsername(me.wallet);

    // Remaining matches today for the asking wallet — lets the lobby show
    // the counter on entry instead of only after the first match starts.
    let remainingToday = null;
    if (wallet) {
      try {
        const { data: daily } = await supabase
          .from('arena_daily')
          .select('used, extra')
          .eq('wallet', wallet)
          .eq('day', arenaDayKey())
          .maybeSingle();
        remainingToday = Math.max(0, ARENA_FREE_MATCHES_PER_DAY + (daily?.extra ?? 0) - (daily?.used ?? 0));
      } catch { /* table absent → unlimited, leave null */ }
    }

    // Live pool = seeded base + this week's player purchases. Keeps the
    // "your G$ goes into the pool" promise visibly true: every refill
    // bought this week grows the number players are competing for.
    // Pool = this SEASON's player purchases (aligned to the ladder window, not
    // an ISO Mon-Sun week) + the seeded base.
    const season = currentSeasonNumber();
    const { start: seasonStart, end: seasonEnd } = seasonBounds(season);
    let purchasedGs = 0;
    try {
      const { data: buys } = await supabase
        .from('arena_purchases')
        .select('amount_wei')
        .gte('created_at', new Date(seasonStart * 1000).toISOString());
      for (const b of buys || []) purchasedGs += Number(b.amount_wei) / 1e18;
    } catch { /* purchases table absent → base pool only */ }

    return res.json({
      week,
      currentWeek,
      weeks,
      remainingToday,
      currentSeason: season,
      currentEndsAt: seasonEnd,      // unix seconds · same boundary as skill seasons
      currentStartsAt: seasonStart,
      poolGs: Math.round(ARENA_WEEKLY_POOL_GS + purchasedGs),
      poolBaseGs: ARENA_WEEKLY_POOL_GS,
      poolFromPlayersGs: Math.round(purchasedGs * 100) / 100,
      players: standings.length,
      top: standings.slice(0, 20),
      me,
    });
  } catch (e) {
    console.error('arena ladder failed:', e?.message);
    // Fail soft: an empty ladder renders as "fresh week" instead of an
    // error. Covers local setups where the migration hasn't run yet.
    const wk = arenaWeekKey();
    return res.json({ week: wk, currentWeek: wk, weeks: [wk], poolGs: ARENA_WEEKLY_POOL_GS, players: 0, top: [], me: null });
  }
});

// ─── POST /api/faucet — gas drip for fresh wallets ──────────────────────────
// Sends FAUCET_DRIP_CELO (default 0.1) once per wallet to fresh sign-ins so
// they don't hit the "insufficient gas" wall on GamePass mint or score
// submit. Susanne flagged this as the killer friction for MiniPay-style
// audiences · this endpoint kills it.
//
// Sybil defense stack, every layer enforced server-side:
//   1. requireSecret middleware → only the frontend server action can
//      reach this (the INTERNAL_SECRET never ships to the browser).
//   2. Privy-bound caller → server action verifies the JWT and forwards
//      privyUserId so the same human can't farm by spawning wallets.
//   3. One drip per wallet, EVER · UNIQUE on faucet_claims.wallet.
//   4. One drip per Privy user → second wallet linked to the same Privy
//      identity is blocked even if the wallet itself is fresh.
//   5. Balance gate → wallet must hold < FAUCET_FRESH_THRESHOLD CELO
//      (default 0.001) at claim time · stops players who already have
//      gas from claiming "for the road".
//   6. Per-IP daily cap → FAUCET_MAX_PER_IP_DAY drips (default 5) from
//      the same IP hash in a rolling 24h. Same-household sharing still
//      works (5 per day per network).
//   7. Global daily kill-switch → FAUCET_MAX_PER_DAY drips total across
//      all wallets (default 50). Worst-case daily drain is bounded ·
//      (50 × 0.1 CELO) ≈ 5 CELO ≈ a few dollars. Tunable via env.
//
// GoodDollar verification is OPTIONAL · enable by setting
// FAUCET_REQUIRE_GOODDOLLAR=true. Default OFF for max onboarding speed.
// When ON, only Self-verified wallets get the drip · strongest sybil
// gate but adds onboarding friction (player must verify first).
const FAUCET_DRIP_CELO        = process.env.FAUCET_DRIP_CELO || '0.7';
const FAUCET_FRESH_THRESHOLD  = process.env.FAUCET_FRESH_THRESHOLD_CELO || '0.001';
const FAUCET_MAX_PER_IP_DAY   = Number(process.env.FAUCET_MAX_PER_IP_DAY || '5');
const FAUCET_MAX_PER_DAY      = Number(process.env.FAUCET_MAX_PER_DAY || '50');
const FAUCET_REQUIRE_GOODDOLLAR = process.env.FAUCET_REQUIRE_GOODDOLLAR === 'true';

app.post('/api/faucet', requireSecret, strictLimiter, async (req, res) => {
  const { address, privyUserId, ipHash } = req.body || {};
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ success: false, error: 'Missing or invalid address' });
  }
  // Drips come from the dedicated faucet wallet when set, else the validator.
  const faucetSigner = faucetWallet || validator;
  if (!faucetSigner) {
    return res.status(500).json({ success: false, error: 'Faucet not configured' });
  }
  const lower = address.toLowerCase();

  // Layer 3 · one drip per wallet ever
  const { data: existingByWallet } = await supabase
    .from('faucet_claims')
    .select('id')
    .eq('wallet', lower)
    .limit(1);
  if (existingByWallet && existingByWallet.length > 0) {
    return res.json({ success: false, reason: 'already_claimed' });
  }

  // Layer 4 · one drip per Privy user (cross-wallet dedup)
  if (privyUserId) {
    const { data: existingByUser } = await supabase
      .from('faucet_claims')
      .select('id')
      .eq('privy_user_id', privyUserId)
      .limit(1);
    if (existingByUser && existingByUser.length > 0) {
      return res.json({ success: false, reason: 'user_already_claimed' });
    }
  }

  // Layer 6 · per-IP rolling 24h cap
  if (ipHash) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: ipRows } = await supabase
      .from('faucet_claims')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('claimed_at', since);
    const ipCount = ipRows?.length ?? 0;
    if (ipCount >= FAUCET_MAX_PER_IP_DAY) {
      return res.json({ success: false, reason: 'ip_rate_limit' });
    }
  }

  // Layer 7 · global daily kill-switch
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await supabase
    .from('faucet_claims')
    .select('id', { count: 'exact', head: true })
    .gte('claimed_at', since24h);
  if ((dailyCount ?? 0) >= FAUCET_MAX_PER_DAY) {
    return res.json({ success: false, reason: 'daily_cap' });
  }

  try {
    const provider = faucetSigner.provider;

    // Layer 5 · balance gate · wallets that already have gas don't get more
    const balance = await provider.getBalance(address);
    const threshold = ethers.parseEther(FAUCET_FRESH_THRESHOLD);
    if (balance >= threshold) {
      return res.json({ success: false, reason: 'not_fresh' });
    }

    // Optional GoodDollar gate · off by default
    if (FAUCET_REQUIRE_GOODDOLLAR) {
      const GOODDOLLAR_IDENTITY_ADDR = '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42';
      const ID_ABI = ['function isWhitelisted(address) view returns (bool)'];
      const idContract = new ethers.Contract(GOODDOLLAR_IDENTITY_ADDR, ID_ABI, provider);
      const isVerified = await idContract.isWhitelisted(address);
      if (!isVerified) {
        return res.status(403).json({ success: false, reason: 'unverified' });
      }
    }

    const amountWei = ethers.parseEther(FAUCET_DRIP_CELO);
    const tx = await faucetSigner.sendTransaction({ to: address, value: amountWei });
    await tx.wait();

    // Persist BEFORE returning success so a retry can't double-drip in the
    // gap between tx confirmation and DB write.
    await supabase.from('faucet_claims').insert({
      wallet:        lower,
      privy_user_id: privyUserId || null,
      ip_hash:       ipHash || null,
      amount_wei:    amountWei.toString(),
      tx_hash:       tx.hash,
    });

    console.log(`⛽ Faucet: sent ${FAUCET_DRIP_CELO} CELO to ${lower} (tx: ${tx.hash.slice(0, 10)}...)`);
    return res.json({ success: true, txHash: tx.hash, amount: FAUCET_DRIP_CELO });
  } catch (e) {
    console.error(`⛽ Faucet failed for ${lower}:`, e.message);
    return res.status(500).json({ success: false, error: 'Faucet transfer failed' });
  }
});

// ─── GET /health ────────────────────────────────────────────────────────────
app.get('/health', async (_, res) => {
  // Per-game score counts. New games pick up automatically via VALID_GAMES.
  const scoreCounts = Object.fromEntries(
    await Promise.all(VALID_GAMES.map(async (game) => {
      const { count } = await supabase
        .from('scores')
        .select('*', { count: 'exact', head: true })
        .eq('game', game);
      return [game, count || 0];
    }))
  );

  res.json({
    status: 'ok',
    season: currentSeasonNumber(),
    scores: scoreCounts,
    onChainReady: !!wagerContract,
    database: 'supabase',
  });
});

// ── Index on-chain scores on startup ────────────────────────────────────────
// RPC providers cap eth_getLogs at ~5,000 blocks; the old single 200k-block
// query reverted with "query exceeds range" on EVERY tick, so on-chain scores
// silently stopped syncing. Now: a module-level cursor walks forward in
// ≤4,900-block windows (a few per tick, so backlogs drain across ticks).
// Cold start looks back one window — the indexer is reconciliation, not the
// primary write path (frontend submits write scores directly).
const INDEXER_MAX_RANGE = 4900;
const INDEXER_WINDOWS_PER_TICK = 6;
let indexerCursor = null; // last block already indexed

async function indexOnChainScores() {
  if (!passContract || !provider) return;
  try {
    // Reuse the module-level provider + interface instead of allocating
    // fresh ones every 5 min — the old pattern was the main memory leak.
    const currentBlock = await provider.getBlockNumber();
    if (indexerCursor === null) indexerCursor = Math.max(0, currentBlock - INDEXER_MAX_RANGE);
    if (indexerCursor >= currentBlock) return;

    const logs = [];
    let windows = 0;
    while (indexerCursor < currentBlock && windows < INDEXER_WINDOWS_PER_TICK) {
      const from = indexerCursor + 1;
      const to = Math.min(from + INDEXER_MAX_RANGE - 1, currentBlock);
      const chunk = await provider.getLogs({
        address: GAME_PASS_ADDR,
        topics: [ethers.id('ScoreRecorded(address,uint8,uint256,uint256,uint256)')],
        fromBlock: from,
        toBlock: to,
      });
      logs.push(...chunk);
      indexerCursor = to;
      windows++;
    }
    if (logs.length === 0) { return; }

    let added = 0;
    for (const log of logs) {
      const parsed = SCORE_EVENT_IFACE.parseLog({ topics: log.topics, data: log.data });
      const player = parsed.args[0].toLowerCase();
      const gameType = Number(parsed.args[1]);
      const score = Number(parsed.args[2]);
      // gameType 3 = Challenge AI (MARKOV). Its ScoreRecorded events are the
      // on-chain history trail, but its authoritative weekly ranking lives in
      // arena_free_matches → /api/arena/ladder (sum-based), NOT the `scores`
      // table (which is max-per-wallet and feeds the skill-game leaderboards).
      // So we intentionally do NOT mirror gameType 3 into `scores` — skip it
      // quietly, without the unknown-gameType warning below.
      if (gameType === CHALLENGE_AI_GAME_TYPE) continue;
      // Reverse of GAME_TYPE · uint8 from on-chain back to the player-key
      // string we use in the activity table. Adding a new game means
      // appending one row here, not a wider ternary chain.
      const game = ({ 0: 'rhythm', 1: 'simon', 2: 'stack' })[gameType];
      if (!game) {
        console.warn(`⛓️  Unknown gameType ${gameType} in ScoreRecorded event · skipping`);
        continue;
      }

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

// ─── Web Push Notifications ──────────────────────────────────────────────────
// Duolingo-style engagement: streak warnings (loss aversion), cup deadlines,
// re-engagement after lapse. Pet-as-narrator copy lives in lib/push.js.
const push = require('./lib/push');

// Public VAPID key for the frontend to subscribe with.
app.get('/api/push/vapid-key', (_, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// Player subscribes — body: { walletAddress, subscription: { endpoint, keys } }.
// On the wallet's FIRST subscription ever, fires a one-time welcome ping so
// they get an instant payoff for granting permission. Re-subscribes on new
// devices stay silent (zero existing rows = first; any rows = returning).
// SECURITY (2026-07-17 audit): these three had NO auth. The CORS origin check
// is not authentication · any script can forge an Origin header, so they were
// world-writable: register a subscription against any wallet, kill any player's
// subscription by endpoint, or flip any player's notification prefs. They now
// go through server actions (frontend/app/actions/push.ts) and demand the
// secret like every other write.
app.post('/api/push/subscribe', requireSecret, async (req, res) => {
  const { walletAddress, subscription } = req.body || {};
  if (!walletAddress || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: 'Invalid address' });
  }

  // Has this wallet ever subscribed before? Check before save so a fresh
  // wallet with zero rows is unambiguous.
  const lower = walletAddress.toLowerCase();
  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('wallet_address', lower)
    .limit(1);
  const isFirstSubscription = !existing || existing.length === 0;

  const ok = await push.saveSubscription(supabase, walletAddress, subscription, req.headers['user-agent']);
  if (!ok) return res.status(500).json({ error: 'Save failed' });

  // Fire welcome only on first-ever subscription. Async so the HTTP
  // response isn't blocked by a slow web push round-trip.
  if (isFirstSubscription) {
    (async () => {
      try {
        const username = await resolveUsername(walletAddress);
        const payload = push.welcomeNotification(username);
        await push.sendToWallet(supabase, walletAddress, 'welcome', payload);
      } catch (e) {
        console.warn('welcome ping failed:', e.message);
      }
    })();
  }

  res.json({ success: true });
});

// Player unsubscribes a specific endpoint.
app.post('/api/push/unsubscribe', requireSecret, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  await push.deleteSubscription(supabase, endpoint);
  res.json({ success: true });
});

// Notification preferences — players can mute categories.
app.get('/api/push/prefs/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const { data } = await supabase
    .from('notification_prefs')
    .select('streak_warnings, cup_deadlines, rank_changes, reengagement')
    .eq('wallet_address', addr)
    .limit(1);
  res.json(data?.[0] || {
    streak_warnings: true, cup_deadlines: true, rank_changes: true, reengagement: true,
  });
});

app.post('/api/push/prefs', requireSecret, async (req, res) => {
  const { walletAddress, streak_warnings, cup_deadlines, rank_changes, reengagement } = req.body || {};
  if (!walletAddress) return res.status(400).json({ error: 'Missing walletAddress' });
  await supabase.from('notification_prefs').upsert({
    wallet_address: walletAddress.toLowerCase(),
    streak_warnings: !!streak_warnings,
    cup_deadlines:   !!cup_deadlines,
    rank_changes:    !!rank_changes,
    reengagement:    !!reengagement,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'wallet_address' });
  res.json({ success: true });
});

// ─── Admin broadcast — game updates / new feature announcements ─────────────
// Protected with INTERNAL_SECRET so only the team can call it. Honors
// per-wallet reengagement mute so players who muted promos stay quiet.
//
// Example:
//   curl -X POST https://.../api/push/broadcast \
//     -H "x-internal-secret: $INTERNAL_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"title":"🏆 New Cup Live","body":"$10 pool, 72hr","url":"/leaderboard"}'
app.post('/api/push/broadcast', requireSecret, async (req, res) => {
  const { title, body, url, tag } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  const payload = push.announcementNotification({ title, body, url, tag });
  const result = await push.sendBroadcast(supabase, payload);
  console.log(`📣 Broadcast: sent ${result.sent}, skipped (muted) ${result.skipped}, cleaned ${result.cleaned}`);
  res.json({ success: true, ...result });
});

// ─── Cup deadline cron ───────────────────────────────────────────────────────
// Fires every 15 min during a cup window. ~1 hour before cup ends, sends
// one notification per cup per player to anyone who has played at least
// once but isn't already top-N qualified. Encourages a final push.
async function sendCupDeadlineWarnings() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    // Only fire while in the 60-minute pre-end window
    const minsLeft = Math.floor((CHALLENGE_END - nowSec) / 60);
    if (minsLeft <= 0 || minsLeft > 60) return;
    if (nowSec < CHALLENGE_START) return;

    // Pull current cup standings via the existing cache path
    const { ranked } = challengeCache.at && Date.now() - challengeCache.at < CHALLENGE_CACHE_TTL_MS
      ? challengeCache
      : await rebuildChallengeCache();
    if (!ranked || ranked.length === 0) return;

    const totalPool = CHALLENGE_TOP_N * CHALLENGE_PRIZE_USDC;
    let sent = 0;
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      const rank = i + 1;
      // Only ping people in striking distance — top 20 for the cup, not deep tail
      if (rank > 20) break;
      const payload = push.cupDeadlineNotification(rank, CHALLENGE_TOP_N, totalPool);
      const ok = await push.sendToWallet(supabase, r.wallet, 'cup_deadline', payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🏆 Cup deadline pings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('cup deadline cron failed:', e?.message || e);
  }
}

// ─── Rank change — top-3 displacement only ──────────────────────────────────
// Called inline from /api/submit-score after a new score lands. Compares
// the leaderboard before and after the new entry: if someone got bumped
// off a top-3 spot, ping them. We only fire for podium displacement since
// that's the emotionally meaningful moment — not bumping someone from #47
// to #48.
async function notifyRankDisplacement(game, submitterAddr, leaderboardBefore, leaderboardAfter) {
  try {
    if (!leaderboardBefore || leaderboardBefore.length === 0) return;
    if (!leaderboardAfter || leaderboardAfter.length === 0) return;

    // Find players who were in top-3 before AND no longer in top-3 after
    const beforeTop3 = leaderboardBefore.slice(0, 3).map(e => e.wallet_address?.toLowerCase());
    const afterTop3 = new Set(leaderboardAfter.slice(0, 3).map(e => e.wallet_address?.toLowerCase()));

    for (const wallet of beforeTop3) {
      if (!wallet) continue;
      if (afterTop3.has(wallet)) continue;             // still top-3, no displacement
      if (wallet === submitterAddr.toLowerCase()) continue; // skip the submitter

      // Find their new rank (or absent → fall to #4)
      const newIdx = leaderboardAfter.findIndex(e => e.wallet_address?.toLowerCase() === wallet);
      const newRank = newIdx >= 0 ? newIdx + 1 : 4;

      const submitterName = await resolveUsername(submitterAddr) || 'Someone';
      const payload = push.rankChangeNotification(submitterName, newRank, game);
      await push.sendToWallet(supabase, wallet, 'rank_change', payload);
    }
  } catch (e) {
    console.warn('rank displacement notify failed:', e?.message || e);
  }
}

// ─── Streak warning cron ─────────────────────────────────────────────────────
// Fires every hour. Finds players with active streaks who haven't played
// today, sends one notification per day per player, pet-stage aware copy.
async function sendStreakWarnings() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Pull active streakers who haven't played today and have streak >= 1
    const { data: candidates } = await supabase
      .from('users')
      .select('wallet_address, play_streak, xp, last_play_date')
      .gte('play_streak', 1)
      .neq('last_play_date', today);

    if (!candidates || candidates.length === 0) return;

    let sent = 0;
    for (const u of candidates) {
      // Skip if user opted out of streak warnings
      const { data: prefs } = await supabase
        .from('notification_prefs')
        .select('streak_warnings')
        .eq('wallet_address', u.wallet_address)
        .limit(1);
      if (prefs && prefs[0] && prefs[0].streak_warnings === false) continue;

      const stage = push.petStage(levelFromXp(u.xp || 0));
      const payload = push.streakNotification(stage, u.play_streak);
      const ok = await push.sendToWallet(supabase, u.wallet_address, 'streak_warning', payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🔔 Streak warnings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('streak warning cron failed:', e?.message || e);
  }
}

// Run every hour. Cheap query; subscriptions are sparse early on.
setInterval(sendStreakWarnings, 60 * 60 * 1000);
// Cup deadline cron — every 15 min so the 1-hour-before-end window is always caught
setInterval(sendCupDeadlineWarnings, 15 * 60 * 1000);

// ─── Close-rank cron — predictive "you're about to be passed" / "1 point
//     away from #N" pings. Fires hourly. Scans top-5 of each game; for any
//     adjacent pair whose gap is small (under 10% of the higher score, or
//     under 1000 absolute pts, whichever is larger), sends:
//       · "Someone's coming for your #N" to the higher-ranked player
//       · "X pts from #N" to the lower-ranked player
//     Once-per-day dedup per game per direction so the same pair doesn't
//     ping repeatedly. Top-5 only — we don't ping deep-tail churn.
async function sendCloseRankPings() {
  try {
    const seasonStart = SEASON_EPOCH + (currentSeasonNumber() - 1) * SEASON_DAYS * 86400;
    for (const game of VALID_GAMES) {
      const gameTypeInt = GAME_TYPE[game];
      let board = [];
      try {
        board = await subgraph.leaderboard(gameTypeInt, seasonStart, 5);
      } catch (_) { continue; }
      if (!board || board.length < 2) continue;

      for (let i = 0; i < board.length - 1; i++) {
        const higher = board[i];
        const lower  = board[i + 1];
        if (!higher?.wallet_address || !lower?.wallet_address) continue;
        const gap = higher.score - lower.score;
        if (gap <= 0) continue;
        // Threshold: smaller of (10% of higher score) or 1000 pts. Means
        // tight pairs always trigger; massive blowouts never do.
        const threshold = Math.max(1000, Math.floor(higher.score * 0.10));
        if (gap > threshold) continue;

        // Resolve usernames once for both sides
        const higherName = higher.username || (await resolveUsername(higher.wallet_address)) || 'Someone';
        const lowerName  = lower.username  || (await resolveUsername(lower.wallet_address))  || 'Someone';

        // Higher player gets the chase warning
        const chasePayload = push.rankChasingNotification(lowerName, gap, i + 1, game);
        push.sendToWallet(supabase, higher.wallet_address, `close_rank_chase_${game}`, chasePayload).catch(() => {});

        // Lower player gets the climb call-to-action
        const climbPayload = push.rankClimbingNotification(higherName, gap, i + 1, game);
        push.sendToWallet(supabase, lower.wallet_address, `close_rank_climb_${game}`, climbPayload).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('close-rank cron failed:', e?.message || e);
  }
}

setInterval(sendCloseRankPings, 60 * 60 * 1000);

// ─── Cup-starting cron ───────────────────────────────────────────────────────
// Fires twice per cup window: ~24h before CHALLENGE_START and ~1h before.
// Targets every subscribed wallet (respects reengagement mute since cup
// announcements are promo-grade). Cron runs every 15 min so both 60-minute
// firing windows are reliably caught. notification_log dedup keyed by
// (wallet, category, sent_on=today) keeps each player from getting two
// 24h pings on the same day — the 1h ping lands on cup-day so it gets a
// fresh log row.
async function sendCupStartingPings() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const secsToStart = CHALLENGE_START - nowSec;
    // 24h window: (23h, 24h] before start
    const in24hWindow = secsToStart > 23 * 3600 && secsToStart <= 24 * 3600;
    // 1h window: (0, 1h] before start
    const in1hWindow  = secsToStart > 0          && secsToStart <= 3600;
    if (!in24hWindow && !in1hWindow) return;

    const totalPool = CHALLENGE_TOP_N * CHALLENGE_PRIZE_USDC;
    const durationHours = Math.round((CHALLENGE_END - CHALLENGE_START) / 3600);
    const payload = in24hWindow
      ? push.cupStarting24hNotification(CHALLENGE_NAME, totalPool, durationHours)
      : push.cupStarting1hNotification(CHALLENGE_NAME, totalPool);
    const category = in24hWindow
      ? `cup_start_24h_${CHALLENGE_ID}`
      : `cup_start_1h_${CHALLENGE_ID}`;

    // Unique wallets across all subscriptions
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('wallet_address');
    const wallets = [...new Set((subs || []).map(s => s.wallet_address))];
    if (wallets.length === 0) return;

    // Honor reengagement mute (same toggle the broadcast endpoint respects)
    const { data: prefs } = await supabase
      .from('notification_prefs')
      .select('wallet_address, reengagement');
    const muted = new Set((prefs || []).filter(p => p.reengagement === false).map(p => p.wallet_address));

    let sent = 0;
    for (const w of wallets) {
      if (muted.has(w)) continue;
      const ok = await push.sendToWallet(supabase, w, category, payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🏁 Cup-starting (${in24hWindow ? '24h' : '1h'}) pings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('cup-starting cron failed:', e?.message || e);
  }
}

setInterval(sendCupStartingPings, 15 * 60 * 1000);

// ─── Season-ending cron ──────────────────────────────────────────────────────
// Fires every 15 min. In the final hour of the weekly season, pings every
// subscribed wallet with rank-aware copy: top-3 get "hold the podium",
// everyone else gets "last chance to climb". Best rank across both games
// wins (lower number = better). Category includes season number so the
// same player gets pinged once per season, not blocked across weeks.
async function sendSeasonEndingPings() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const seasonNum = currentSeasonNumber();
    const seasonStart = SEASON_EPOCH + (seasonNum - 1) * SEASON_DAYS * 86400;
    const seasonEnd   = seasonStart + SEASON_DAYS * 86400;
    const minsLeft = Math.floor((seasonEnd - nowSec) / 60);
    if (minsLeft <= 0 || minsLeft > 60) return;

    // Build wallet → best-rank map across both games (top 50 each)
    const rankMap = new Map();
    for (const game of VALID_GAMES) {
      const gameTypeInt = GAME_TYPE[game];
      let board = [];
      try {
        board = await subgraph.leaderboard(gameTypeInt, seasonStart, 50);
      } catch (_) { continue; }
      board.forEach((e, idx) => {
        if (!e?.wallet_address) return;
        const w = e.wallet_address.toLowerCase();
        const rank = idx + 1;
        const prev = rankMap.get(w);
        if (prev == null || rank < prev) rankMap.set(w, rank);
      });
    }

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('wallet_address');
    const wallets = [...new Set((subs || []).map(s => s.wallet_address))];
    if (wallets.length === 0) return;

    const category = `season_ending_${seasonNum}`;
    let sent = 0;
    for (const w of wallets) {
      const rank = rankMap.get(w) || 0;
      const payload = push.seasonEndingNotification(rank);
      const ok = await push.sendToWallet(supabase, w, category, payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`⌛ Season-ending pings sent to ${sent} wallets (season ${seasonNum})`);
  } catch (e) {
    console.warn('season-ending cron failed:', e?.message || e);
  }
}

setInterval(sendSeasonEndingPings, 15 * 60 * 1000);

// ─── Mission-expiring cron ───────────────────────────────────────────────────
// Fires every 15 min. In the (30, 60] minute window before UTC midnight,
// pings any subscribed player who still has unclaimed mission XP on the
// table for today. Sums XP from completed-but-unclaimed AND incomplete
// missions (incomplete are still earnable in that window). Once-per-day
// dedup via notification_log so the cron's repeated ticks don't spam.
async function sendMissionExpiringPings() {
  try {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const minsToMidnight = Math.floor((tomorrow.getTime() - now.getTime()) / 60000);
    if (minsToMidnight <= 30 || minsToMidnight > 60) return;

    const today = now.toISOString().slice(0, 10);

    // Pull today's missions where the player still has XP on the table
    const { data: rows } = await supabase
      .from('daily_missions')
      .select('wallet, reward_xp, completed, claimed')
      .eq('date', today)
      .eq('claimed', false);
    if (!rows || rows.length === 0) return;

    // Sum unclaimed XP per wallet (only completed missions count as earned-
    // but-unclaimed — incomplete ones are quick reminders, XP shown as 0)
    const earned = new Map();
    const hasIncomplete = new Map();
    for (const r of rows) {
      if (r.completed) earned.set(r.wallet, (earned.get(r.wallet) || 0) + (r.reward_xp || 0));
      else hasIncomplete.set(r.wallet, true);
    }

    // Limit to subscribed wallets only — no point querying for non-subscribers
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('wallet_address');
    const subscribed = new Set((subs || []).map(s => s.wallet_address));
    if (subscribed.size === 0) return;

    let sent = 0;
    const candidates = new Set([...earned.keys(), ...hasIncomplete.keys()]);
    for (const wallet of candidates) {
      if (!subscribed.has(wallet)) continue;
      const unclaimedXp = earned.get(wallet) || 0;
      const payload = push.missionExpiringNotification(unclaimedXp);
      const ok = await push.sendToWallet(supabase, wallet, 'mission_expire', payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🎯 Mission-expiring pings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('mission-expiring cron failed:', e?.message || e);
  }
}

setInterval(sendMissionExpiringPings, 15 * 60 * 1000);

// ─── Daily G$ claim reminder ─────────────────────────────────────────────────
// Fires every hour. In the window 9:00-10:00 WAT (= 08:00-09:00 UTC), sends
// one push per day to all subscribed wallets. Simple "claim your daily G$"
// nudge — we don't check on-chain entitlement per wallet (expensive) so we
// send to everyone. Players who aren't verified or already claimed just open
// the app and see the "Claimed today" state. Once-per-day dedup via
// notification_log prevents repeat fires.
async function sendDailyClaimPings() {
  try {
    const hour = new Date().getUTCHours();
    // Fire once in the 08:00-09:00 UTC window (9-10am WAT / Lagos)
    if (hour !== 8) return;

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('wallet_address');
    if (!subs || subs.length === 0) return;

    const wallets = [...new Set(subs.map(s => s.wallet_address))];
    let sent = 0;
    for (const w of wallets) {
      const payload = {
        title: '💰 Daily G$ ready',
        body: 'Open GameArena and claim your GoodDollar. It only takes a tap.',
        tag: 'daily-g-claim',
        url: '/profile',
      };
      const ok = await push.sendToWallet(supabase, w, 'daily_g_claim', payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`💰 Daily G$ claim pings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('daily claim ping cron failed:', e?.message || e);
  }
}
setInterval(sendDailyClaimPings, 60 * 60 * 1000);

// ─── Re-engagement cron — lapsed-user pings ──────────────────────────────────
// Runs every 6 hours. Targets users who last played exactly 1, 3, 7, or 14
// days ago (Duolingo escalation pattern). Once-per-day dedup via
// notification_log so a player can't get pinged twice in one day. After
// day 14 we stay silent — no chasing dead users.
async function sendReengagementPings() {
  try {
    const days = [1, 3, 7, 14];
    let totalSent = 0;
    for (const d of days) {
      const target = new Date(Date.now() - d * 86400 * 1000).toISOString().slice(0, 10);
      const { data: candidates } = await supabase
        .from('users')
        .select('wallet_address, xp, last_play_date')
        .eq('last_play_date', target)
        .limit(500);
      if (!candidates || candidates.length === 0) continue;

      for (const u of candidates) {
        // Honor reengagement mute
        const { data: prefs } = await supabase
          .from('notification_prefs')
          .select('reengagement')
          .eq('wallet_address', u.wallet_address)
          .limit(1);
        if (prefs && prefs[0] && prefs[0].reengagement === false) continue;

        const stage = push.petStage(levelFromXp(u.xp || 0));
        // Resolve username for personalization (cached after first lookup)
        const username = await resolveUsername(u.wallet_address);
        const payload = push.reengagementNotification(stage, d, username);
        if (!payload) continue;
        const ok = await push.sendToWallet(supabase, u.wallet_address, `reengagement_d${d}`, payload);
        if (ok) totalSent++;
      }
    }
    if (totalSent > 0) console.log(`💤 Re-engagement pings sent to ${totalSent} lapsed wallets`);
  } catch (e) {
    console.warn('reengagement cron failed:', e?.message || e);
  }
}

// Run on startup + every 6 hours so all four lapse buckets get covered each day.
sendReengagementPings();
setInterval(sendReengagementPings, 6 * 60 * 60 * 1000);

// Seal seasons on startup and every hour
sealCompletedSeasons();
setInterval(sealCompletedSeasons, 60 * 60 * 1000);

// Index chain scores on startup then every 5 min
indexOnChainScores();
setInterval(indexOnChainScores, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🎮 Games backend on http://localhost:${PORT} — Season ${currentSeasonNumber()}`);
  // Surface whether on-chain addresses came from env or a hardcoded fallback,
  // so a missing Railway env var is loud in the deploy logs instead of silent.
  console.log(`📍 GAME_PASS_ADDRESS:        ${process.env.GAME_PASS_ADDRESS ? 'env' : `fallback (${GAME_PASS_ADDR})`}`);
  console.log(`📍 SOLO_WAGER_ADDRESS:      ${process.env.SOLO_WAGER_ADDRESS ? 'env' : 'unset'}`);
  console.log(`📍 HABITAT_REGISTRY_ADDRESS: ${process.env.HABITAT_REGISTRY_ADDRESS ? 'env' : 'unset'}`);
});
