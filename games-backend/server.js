require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const { ethers } = require('ethers');

const app  = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());


// ─── On-chain config ────────────────────────────────────────────────────────
const CELO_RPC          = process.env.CELO_RPC_URL  || 'https://forno.celo.org';
const SOLO_WAGER_ADDR   = process.env.SOLO_WAGER_ADDRESS || '';
const VALIDATOR_KEY     = process.env.VALIDATOR_PRIVATE_KEY || '';

const SOLO_WAGER_ABI = [
  'function resolveWager(uint256 wagerId, uint256 score) external',
  'function wagers(uint256) external view returns (uint256 id, address player, uint256 amount, uint8 gameType, uint8 status, uint256 createdAt, uint256 score)',
  'function getPlayerWagers(address player) external view returns (uint256[] memory)',
  'function treasuryBalance() external view returns (uint256)',
  'function distributeSeasonPrizes(uint256 seasonId, address[3] rhythmWinners, address[3] simonWinners) external',
  'function totalUsers() external view returns (uint256)',
];

const GAME_PASS_ADDR = '0xd184E5CBEbf957624d14fAa0bfe20d6443411453';
const GAME_PASS_ABI  = [
  'function getUsername(address player) external view returns (string)',
  'function totalSupply() external view returns (uint256)',
  'function recordScore(address player, uint8 gameType, uint256 score) external',
  'function totalGamesPlayed() external view returns (uint256)',
  'function bestScore(address player, uint8 gameType) external view returns (uint256)',
];

let provider   = null;
let passContract = null;
let validator  = null;
let wagerContract = null;

if (SOLO_WAGER_ADDR && VALIDATOR_KEY) {
  try {
    provider      = new ethers.JsonRpcProvider(CELO_RPC);
    validator     = new ethers.Wallet(VALIDATOR_KEY, provider);
    wagerContract = new ethers.Contract(SOLO_WAGER_ADDR, SOLO_WAGER_ABI, validator);
    passContract  = new ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, validator);
    console.log(`🔗 On-chain resolver ready — validator: ${validator.address}`);
  } catch (e) {
    console.warn('⚠️  On-chain resolver not configured:', e.message);
  }
} else {
  // Still init passContract for username lookups even without wager config
  try {
    const p = new ethers.JsonRpcProvider(CELO_RPC);
    passContract = new ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, p);
  } catch (_) {}
  console.log('ℹ️  SOLO_WAGER_ADDRESS or VALIDATOR_PRIVATE_KEY not set — wager resolution disabled');
}

// ── Username cache (avoid repeated RPC calls) ───────────────────────────────
const usernameCache = new Map();
async function resolveUsername(addr) {
  const lower = addr.toLowerCase();
  if (usernameCache.has(lower)) return usernameCache.get(lower);
  if (!passContract) return null;
  try {
    const name = await passContract.getUsername(addr);
    if (name) usernameCache.set(lower, name);
    return name || null;
  } catch (_) { return null; }
}

async function resolveOnChain(wagerId, score) {
  if (!wagerContract || !wagerId) return null;
  try {
    const tx      = await wagerContract.resolveWager(BigInt(wagerId), BigInt(score));
    const receipt = await tx.wait();
    console.log(`✅ resolveWager(${wagerId}, ${score}) — tx: ${receipt.hash}`);
    return receipt.hash;
  } catch (e) {
    console.error(`❌ resolveWager failed for wager ${wagerId}:`, e.message);
    return null;
  }
}

// Returns treasury balance in G$ (18 decimals → formatted as string)
async function getTreasuryBalance() {
  if (!wagerContract) return '0';
  try {
    const raw = await wagerContract.treasuryBalance();
    return ethers.formatUnits(raw, 18);
  } catch (_) { return '0'; }
}

// Distribute 10% of treasury to top 3 of each game for a sealed season
async function distributeSeasonPrizesOnChain(season, rhythmTop3, simonTop3) {
  if (!wagerContract) return null;
  const pad  = (arr) => [...arr.slice(0, 3), ...Array(3).fill(ethers.ZeroAddress)].slice(0, 3);
  const rWin = pad(rhythmTop3.map(e => e.player));
  const sWin = pad(simonTop3.map(e => e.player));
  try {
    const tx      = await wagerContract.distributeSeasonPrizes(BigInt(season), rWin, sWin);
    const receipt = await tx.wait();
    console.log(`🏆 Season ${season} prizes distributed — tx: ${receipt.hash}`);
    return receipt.hash;
  } catch (e) {
    console.error(`❌ Season ${season} prize distribution failed:`, e.message);
    return null;
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────
const DB_FILE    = path.join(__dirname, 'scores.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// ─── Persistent user registry (only grows, never shrinks) ────────────────────
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (_) {}
  return { addresses: [], count: 0 };
}
function saveUsers(u) {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); } catch (_) {}
}
function registerUser(addr) {
  const lower = addr.toLowerCase();
  const users = loadUsers();
  if (users.addresses.includes(lower)) return users.count; // already known
  users.addresses.push(lower);
  users.count = users.addresses.length;
  saveUsers(users);
  console.log(`👤 New user #${users.count}: ${lower}`);
  return users.count;
}

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // Migrate old schema
      if (!raw.activity) raw.activity = [];
      if (!raw.seasons)  raw.seasons  = [];
      if (!raw.badges)   raw.badges   = {};
      return raw;
    }
  } catch (_) {}
  return { rhythm: [], simon: [], activity: [], seasons: [], badges: {} };
}

function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (_) {}
}

let db = loadDB();

// ─── Season helpers ──────────────────────────────────────────────────────────
// Season = 7-day window. Week 1 = first 7 days from a fixed epoch.
const SEASON_EPOCH = 1770249600; // Feb 5 2026 00:00 UTC (GoodBuilders S3 launch)
const SEASON_DAYS  = 7;

function currentSeasonNumber() {
  const elapsed = Math.floor(Date.now() / 1000) - SEASON_EPOCH;
  return Math.floor(elapsed / (SEASON_DAYS * 86400)) + 1;
}

function seasonBounds(n) {
  const start = SEASON_EPOCH + (n - 1) * SEASON_DAYS * 86400;
  const end   = start + SEASON_DAYS * 86400;
  return { start, end };
}

// Run at startup and every hour — seal any completed seasons
async function sealCompletedSeasons() {
  const current = currentSeasonNumber();
  const sealed  = new Set(db.seasons.map(s => s.season));

  for (let n = 1; n < current; n++) {
    if (sealed.has(n)) continue;

    const { start, end } = seasonBounds(n);

    const rhythmEntries = db.rhythm.filter(e => e.timestamp >= start && e.timestamp < end);
    const simonEntries  = db.simon.filter(e => e.timestamp >= start && e.timestamp < end);

    // Read treasury balance before distributing (so we can record G$ won)
    const treasuryBefore = await getTreasuryBalance();
    const pot  = parseFloat(treasuryBefore) * 0.10; // 10% of treasury
    const half = pot / 2; // 5% per game

    // Compute G$ amounts for each rank slot (60/30/10 of half)
    function prizeAmounts(gamePot, count) {
      if (count === 0) return [0, 0, 0];
      const f = count >= 1 ? (gamePot * 0.60) : 0;
      const s = count >= 2 ? (gamePot * 0.30) : 0;
      const t = count >= 3 ? (gamePot * 0.10) : 0;
      return [f, s, t];
    }
    const rPrizes = prizeAmounts(half, rhythmEntries.length);
    const sPrizes = prizeAmounts(half, simonEntries.length);

    const seasonRecord = {
      season:   n,
      startTs:  start,
      endTs:    end,
      rhythm:   rhythmEntries.slice(0, 10).map((e, i) => ({
        ...e, gWon: i < 3 ? parseFloat(rPrizes[i].toFixed(4)) : 0,
      })),
      simon:    simonEntries.slice(0, 10).map((e, i) => ({
        ...e, gWon: i < 3 ? parseFloat(sPrizes[i].toFixed(4)) : 0,
      })),
      sealedAt: Math.floor(Date.now() / 1000),
      prizePot: parseFloat(pot.toFixed(4)),
    };

    db.seasons.push(seasonRecord);
    awardSeasonBadges(seasonRecord);
    saveDB(db);

    console.log(`🏆 Season ${n} sealed — ${rhythmEntries.length} rhythm, ${simonEntries.length} simon players — pot: ${pot.toFixed(2)} G$`);

    // Distribute prizes on-chain (non-blocking)
    distributeSeasonPrizesOnChain(n, rhythmEntries.slice(0, 3), simonEntries.slice(0, 3))
      .catch(() => {});
  }

  saveDB(db);
}

function awardSeasonBadges(seasonRecord) {
  // Award badges to top 3 of each game
  [
    { entries: seasonRecord.rhythm, game: 'rhythm' },
    { entries: seasonRecord.simon,  game: 'simon'  },
  ].forEach(({ entries, game }) => {
    entries.slice(0, 3).forEach((entry, i) => {
      const addr = entry.player;
      if (!db.badges[addr]) db.badges[addr] = [];

      const rank = i + 1;
      const badgeType = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';

      db.badges[addr].push({
        season:   seasonRecord.season,
        game,
        rank,
        type:     badgeType,
        score:    entry.score,
        awardedAt: Math.floor(Date.now() / 1000),
      });
    });
  });
}

// Check for consecutive #1 finishes and add streak badges
function computeStreakBadges(address) {
  const addr    = address.toLowerCase();
  const myBadges = (db.badges[addr] || []).filter(b => b.rank === 1);

  const streaks = {};
  ['rhythm', 'simon'].forEach(game => {
    const goldSeasons = myBadges
      .filter(b => b.game === game)
      .map(b => b.season)
      .sort((a, b) => a - b);

    let maxStreak = 0, curStreak = 1;
    for (let i = 1; i < goldSeasons.length; i++) {
      if (goldSeasons[i] === goldSeasons[i - 1] + 1) {
        curStreak++;
        maxStreak = Math.max(maxStreak, curStreak);
      } else {
        curStreak = 1;
      }
    }
    if (goldSeasons.length === 1) maxStreak = 1;
    streaks[game] = maxStreak;
  });

  return streaks;
}

// ─── Validation ─────────────────────────────────────────────────────────────
function validateScore({ score, gameTime, game }) {
  if (!['rhythm', 'simon'].includes(game)) return { valid: false, reason: 'Unknown game' };
  if (typeof score !== 'number' || score < 0 || score > 1_000_000) return { valid: false, reason: 'Score out of range' };
  if (typeof gameTime !== 'number' || gameTime < 5000) return { valid: false, reason: 'Game time too short' };
  return { valid: true };
}

// ─── POST /api/submit-score ──────────────────────────────────────────────────
app.post('/api/submit-score', async (req, res) => {
  const { playerAddress, scoreData } = req.body;

  if (!playerAddress || !scoreData) {
    return res.status(400).json({ error: 'Missing playerAddress or scoreData' });
  }

  const check = validateScore(scoreData);
  if (!check.valid) {
    return res.status(400).json({ error: 'Validation failed', reason: check.reason });
  }

  const { game, score, gameTime, wagered, wagerId } = scoreData;

  // Track unique user
  registerUser(playerAddress);

  const entry = {
    player:    playerAddress.toLowerCase(),
    score,
    gameTime,
    wagered:   wagered || null,
    timestamp: Math.floor(Date.now() / 1000),
  };

  // Push to leaderboard
  db[game].push(entry);

  // Keep only best score per wallet
  const map = new Map();
  db[game].forEach(e => {
    const existing = map.get(e.player);
    if (!existing || e.score > existing.score) map.set(e.player, e);
  });
  db[game] = Array.from(map.values()).sort((a, b) => b.score - a.score);

  // Push to activity feed (all plays, not just personal best)
  db.activity.unshift({ ...entry, game });
  if (db.activity.length > 20) db.activity = db.activity.slice(0, 20);

  saveDB(db);

  const rank = db[game].findIndex(e => e.player === playerAddress.toLowerCase()) + 1;
  console.log(`✅ [${game}] ${playerAddress.slice(0, 8)}... → ${score} pts (rank #${rank})`);

  // Resolve wager on-chain (non-blocking)
  if (wagerId) {
    resolveOnChain(wagerId, score).catch(() => {});
  }

  // Record score on-chain via GamePass (non-blocking, backend pays gas)
  if (passContract && passContract.recordScore) {
    const gameType = game === 'rhythm' ? 0 : 1;
    passContract.recordScore(playerAddress, gameType, BigInt(score))
      .then(tx => tx.wait())
      .then(r => console.log(`⛓️  Score recorded on-chain: ${playerAddress.slice(0, 8)}... → ${score} pts (tx: ${r.hash.slice(0, 10)}...)`))
      .catch(e => console.warn(`⚠️  On-chain score recording failed: ${e.message}`));
  }

  res.json({ success: true, score, rank });
});

// ─── GET /api/leaderboard?game=rhythm|simon ──────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  const game = req.query.game;
  if (!['rhythm', 'simon'].includes(game)) {
    return res.status(400).json({ error: 'game must be rhythm or simon' });
  }
  const entries = db[game].slice(0, 10);
  // Resolve usernames for each entry
  const enriched = await Promise.all(entries.map(async (e) => ({
    ...e,
    username: await resolveUsername(e.player) || null,
  })));
  res.json({ leaderboard: enriched });
});

// ─── GET /api/activity ───────────────────────────────────────────────────────
app.get('/api/activity', async (_, res) => {
  const entries = db.activity.slice(0, 10);
  const enriched = await Promise.all(entries.map(async (e) => ({
    ...e,
    username: await resolveUsername(e.player) || null,
  })));
  res.json({ activity: enriched });
});

// ─── GET /api/stats ──────────────────────────────────────────────────────────
app.get('/api/stats', async (_, res) => {
  const totalWagered = db.activity
    .filter(e => e.wagered)
    .reduce((sum, e) => sum + Number(e.wagered), 0);

  const season     = currentSeasonNumber();
  const { start, end } = seasonBounds(season);
  const seasonPlayers = new Set(
    db.activity.filter(e => e.timestamp >= start).map(e => e.player.toLowerCase())
  );

  // User count: on-chain (wagerers) + local file (all players including free)
  const localUsers = loadUsers();
  let onChainUsers = 0;
  try {
    if (wagerContract) {
      onChainUsers = Number(await wagerContract.totalUsers());
    }
  } catch (_) {}
  const totalUsers = Math.max(localUsers.count, onChainUsers);

  // Estimate current prize pot: 10% of on-chain treasury (or estimate from wagered G$)
  let estimatedPrizePot = '0.00';
  try {
    const bal = await getTreasuryBalance();
    estimatedPrizePot = (parseFloat(bal) * 0.10).toFixed(2);
  } catch (_) {}

  res.json({
    totalUsers:       totalUsers,
    seasonUsers:      seasonPlayers.size,
    totalGames:       db.activity.length,
    rhythmPlayers:    db.rhythm.length,
    simonPlayers:     db.simon.length,
    topRhythm:        db.rhythm[0]?.score  ?? 0,
    topSimon:         db.simon[0]?.score   ?? 0,
    totalWagered:     totalWagered.toFixed(2),
    currentSeason:    season,
    seasonEndsAt:     end,
    estimatedPrizePot,
  });
});

// ─── GET /api/seasons ────────────────────────────────────────────────────────
app.get('/api/seasons', (_, res) => {
  const current = currentSeasonNumber();
  const { start, end } = seasonBounds(current);

  // Live current season standings
  const liveRhythm = db.rhythm
    .filter(e => e.timestamp >= start)
    .slice(0, 10);
  const liveSimon = db.simon
    .filter(e => e.timestamp >= start)
    .slice(0, 10);

  res.json({
    currentSeason: current,
    currentEndsAt: end,
    live: { rhythm: liveRhythm, simon: liveSimon },
    past: [...db.seasons].reverse(), // most recent first
  });
});

// ─── GET /api/badges/:address ─────────────────────────────────────────────────
app.get('/api/badges/:address', (req, res) => {
  const addr    = req.params.address.toLowerCase();
  const badges  = db.badges[addr] || [];
  const streaks = computeStreakBadges(addr);

  // Compute summary labels
  const goldCount = badges.filter(b => b.rank === 1).length;

  let streakLabel = null;
  const maxStreak = Math.max(streaks.rhythm || 0, streaks.simon || 0);
  if (maxStreak >= 3) streakLabel = `${maxStreak}-WEEK CHAMPION`;
  else if (maxStreak === 2) streakLabel = '2-WEEK CHAMPION';

  res.json({
    address: addr,
    badges,
    streaks,
    summary: {
      totalGold:   goldCount,
      totalSilver: badges.filter(b => b.rank === 2).length,
      totalBronze: badges.filter(b => b.rank === 3).length,
      streakLabel,
    },
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status:        'ok',
  season:        currentSeasonNumber(),
  scores:        { rhythm: db.rhythm.length, simon: db.simon.length },
  onChainReady:  !!wagerContract,
}));

// Seal seasons on startup and every hour
sealCompletedSeasons();
setInterval(sealCompletedSeasons, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🎮 Games backend on http://localhost:${PORT} — Season ${currentSeasonNumber()}`);
});
