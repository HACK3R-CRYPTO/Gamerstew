require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
console.log('📦 Supabase connected');

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
  try {
    const p = new ethers.JsonRpcProvider(CELO_RPC);
    passContract = new ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, p);
  } catch (_) {}
  console.log('ℹ️  SOLO_WAGER_ADDRESS or VALIDATOR_PRIVATE_KEY not set — wager resolution disabled');
}

// ── Username cache ──────────────────────────────────────────────────────────
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

async function getTreasuryBalance() {
  if (!wagerContract) return '0';
  try {
    const raw = await wagerContract.treasuryBalance();
    return ethers.formatUnits(raw, 18);
  } catch (_) { return '0'; }
}

// ─── Season helpers ─────────────────────────────────────────────────────────
const SEASON_EPOCH = 1770249600;
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

  if (newStreak > 1) console.log(`🔥 ${lower.slice(0,8)}... streak: ${newStreak} days`);
  return newStreak;
}

async function getUserCount() {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  return count || 0;
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
    console.log(`📈 Score updated: ${entry.wallet_address.slice(0,8)}... ${existing.score} → ${entry.score}`);
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
  let query = supabase
    .from('scores')
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
    .limit(500); // fetch more then dedup in JS

  if (!data) return [];

  // Keep only best score per wallet address
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

async function getActivity(limit = 20) {
  const { data } = await supabase
    .from('activity')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
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
    const endDate   = new Date(end * 1000).toISOString();

    const { data: rhythmScores } = await supabase
      .from('scores')
      .select('*')
      .eq('game', 'rhythm')
      .gte('created_at', startDate)
      .lt('created_at', endDate)
      .order('score', { ascending: false })
      .limit(10);

    const { data: simonScores } = await supabase
      .from('scores')
      .select('*')
      .eq('game', 'simon')
      .gte('created_at', startDate)
      .lt('created_at', endDate)
      .order('score', { ascending: false })
      .limit(10);

    const rEntries = rhythmScores || [];
    const sEntries = simonScores || [];

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

// ─── POST /api/submit-score ─────────────────────────────────────────────────
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
  const season = currentSeasonNumber();

  // Track unique user + update streak
  const streak = await registerUser(playerAddress);

  // Resolve wager on-chain if applicable
  let wagerTxHash = null;
  if (wagerId) {
    wagerTxHash = await resolveOnChain(wagerId, score);
  }

  // Record score on-chain via GamePass (get tx hash — stores all-time best)
  let scoreTxHash = null;
  if (passContract && passContract.recordScore) {
    const gameType = game === 'rhythm' ? 0 : 1;
    try {
      const tx = await passContract.recordScore(playerAddress, gameType, BigInt(score));
      const receipt = await tx.wait();
      scoreTxHash = receipt.hash;
      console.log(`⛓️  Score on-chain: ${playerAddress.slice(0, 8)}... → ${score} pts (tx: ${receipt.hash.slice(0, 10)}...)`);
    } catch (e) {
      console.warn(`⚠️  On-chain score failed: ${e.message}`);
    }
  }

  const txHash = wagerTxHash || scoreTxHash;

  // Save actual game score to Supabase (per-season, not all-time best)
  await saveScore({
    wallet_address: playerAddress.toLowerCase(),
    game,
    score,
    game_time: gameTime,
    season_number: season,
    wagered: wagered || null,
    wager_id: wagerId || null,
    tx_hash: txHash,
  });

  // Get rank
  const leaderboard = await getLeaderboard(game);
  const rank = leaderboard.findIndex(e => e.wallet_address === playerAddress.toLowerCase()) + 1;

  console.log(`✅ [${game}] ${playerAddress.slice(0, 8)}... → ${score} pts (rank #${rank}) ${txHash ? `tx: ${txHash.slice(0, 10)}...` : ''}`);

  res.json({ success: true, score, rank, txHash, streak });
});

// ─── GET /api/leaderboard?game=rhythm|simon ─────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  const game = req.query.game;
  if (!['rhythm', 'simon'].includes(game)) {
    return res.status(400).json({ error: 'game must be rhythm or simon' });
  }
  const entries = await getLeaderboard(game);
  const enriched = await Promise.all(entries.map(async (e) => ({
    player: e.wallet_address,
    score: e.score,
    gameTime: e.game_time,
    wagered: e.wagered,
    timestamp: Math.floor(new Date(e.created_at).getTime() / 1000),
    tx_hash: e.tx_hash,
    username: await resolveUsername(e.wallet_address) || null,
  })));
  res.json({ leaderboard: enriched });
});

// ─── GET /api/activity ──────────────────────────────────────────────────────
app.get('/api/activity', async (_, res) => {
  const entries = await getActivity(10);
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
  } catch (_) {}

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

  // Live current season standings
  const { data: liveRhythm } = await supabase
    .from('scores')
    .select('*')
    .eq('game', 'rhythm')
    .gte('created_at', startDate)
    .order('score', { ascending: false })
    .limit(200);

  const { data: liveSimon } = await supabase
    .from('scores')
    .select('*')
    .eq('game', 'simon')
    .gte('created_at', startDate)
    .order('score', { ascending: false })
    .limit(200);

  // Dedup by wallet — keep best score per user
  const dedupScores = (rows) => {
    const seen = new Map();
    for (const row of (rows || [])) {
      const key = row.wallet_address?.toLowerCase();
      if (!key) continue;
      if (!seen.has(key) || row.score > seen.get(key).score) seen.set(key, row);
    }
    return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  };

  // Past sealed seasons
  const { data: pastSeasons } = await supabase
    .from('seasons')
    .select('*')
    .eq('sealed', true)
    .order('season_number', { ascending: false });

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
      simon:  await Promise.all(dedupScores(liveSimon).map(formatEntry)),
    },
    past: (pastSeasons || []).map(s => ({
      season: s.season_number,
      startTs: s.start_ts,
      endTs: s.end_ts,
      prizePot: s.prize_pot,
      sealedAt: Math.floor(new Date(s.created_at).getTime() / 1000),
      rhythm: [],
      simon: [],
    })),
  });
});

// ─── GET /api/badges/:address ───────────────────────────────────────────────
app.get('/api/badges/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const badges = await getBadges(addr);

  const goldCount   = badges.filter(b => b.badge === 'gold').length;
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

// ─── POST /api/dice-roll — server-side randomness (blocks Math.random override) ─
app.post('/api/dice-roll', async (_, res) => {
  const { randomInt } = require('crypto');
  res.json({ roll: randomInt(1, 7) }); // 1–6 inclusive, cryptographically secure
});

// ─── POST /api/faucet — send 0.01 CELO to new users (once per wallet) ────────
app.post('/api/faucet', async (req, res) => {
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
    // 1. Verify GoodDollar Identity on-chain to prevent bots
    const provider = validator.provider;
    const GOODDOLLAR_IDENTITY_ADDR = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";
    const ID_ABI = ["function isWhitelisted(address) view returns (bool)"];
    
    // We check the checksummed or non-checksummed address using ethers
    const idContract = new ethers.Contract(GOODDOLLAR_IDENTITY_ADDR, ID_ABI, provider);
    const isVerified = await idContract.isWhitelisted(address);

    if (!isVerified) {
      return res.status(403).json({ success: false, reason: 'unverified', error: 'Wallet must be verified via GoodDollar to claim free gas.' });
    }

    // 2. Send Gas

    const tx = await validator.sendTransaction({
      to: address,
      value: ethers.parseEther('0.025'),
    });
    await tx.wait();

    // Mark as sent
    await supabase.from('faucet').insert({ wallet_address: lower });

    console.log(`⛽ Faucet: sent 0.025 CELO to ${lower} (tx: ${tx.hash.slice(0, 10)}...)`);
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
  if (!passContract) return;
  try {
    const iface = new ethers.Interface([
      'event ScoreRecorded(address indexed player, uint8 indexed gameType, uint256 score, uint256 totalGames)',
    ]);
    const rpc = new ethers.JsonRpcProvider(CELO_RPC);
    const currentBlock = await rpc.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 200000);
    const logs = await rpc.getLogs({
      address: GAME_PASS_ADDR,
      topics: [ethers.id('ScoreRecorded(address,uint8,uint256,uint256)')],
      fromBlock,
      toBlock: currentBlock,
    });
    if (logs.length === 0) { console.log('⛓️  No on-chain scores found'); return; }

    let added = 0;
    for (const log of logs) {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      const player   = parsed.args[0].toLowerCase();
      const gameType = Number(parsed.args[1]);
      const score    = Number(parsed.args[2]);
      const game     = gameType === 0 ? 'rhythm' : 'simon';

      let timestamp = new Date().toISOString();
      try {
        const block = await rpc.getBlock(log.blockNumber);
        if (block) timestamp = new Date(Number(block.timestamp) * 1000).toISOString();
      } catch (_) {}

      // Check if already in Supabase with better score
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
        });
      }

      // Register user
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
