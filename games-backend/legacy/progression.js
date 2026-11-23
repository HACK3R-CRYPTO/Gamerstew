// ─── progression ──────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── XP / Level system ──
function* (core) {
  Object.defineProperties(core, {
    VALID_GAMES: { get: () => VALID_GAMES, enumerable: true, configurable: true },
    GAME_TYPE: { get: () => GAME_TYPE, enumerable: true, configurable: true },
    GAME_LABEL: { get: () => GAME_LABEL, enumerable: true, configurable: true },
    WIN_THRESHOLD: { get: () => WIN_THRESHOLD, enumerable: true, configurable: true },
    XP_PLAYED: { get: () => XP_PLAYED, enumerable: true, configurable: true },
    XP_WIN: { get: () => XP_WIN, enumerable: true, configurable: true },
    XP_NEW_PB: { get: () => XP_NEW_PB, enumerable: true, configurable: true },
    saveScore: { get: () => saveScore, enumerable: true, configurable: true },
    awardXp: { get: () => awardXp, enumerable: true, configurable: true },
    updateMissionProgress: { get: () => updateMissionProgress, enumerable: true, configurable: true },
    checkAndUnlockAchievements: { get: () => checkAndUnlockAchievements, enumerable: true, configurable: true },
    ACHIEVEMENT_CATALOG: { get: () => ACHIEVEMENT_CATALOG, enumerable: true, configurable: true },
    ensureTodayMissions: { get: () => ensureTodayMissions, enumerable: true, configurable: true },
    MISSION_TEMPLATES: { get: () => MISSION_TEMPLATES, enumerable: true, configurable: true },
    xpProgress: { get: () => xpProgress, enumerable: true, configurable: true },
    levelFromXp: { get: () => levelFromXp, enumerable: true, configurable: true },
    CHALLENGE_AI_GAME_TYPE: { get: () => CHALLENGE_AI_GAME_TYPE, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

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

const WIN_THRESHOLD = { rhythm: 350, simon: 7, stack: 50, nepa: 50 };

// Single source of truth for game enum mapping. GamePass.sol treats
// gameType as a free uint8 — these IDs are off-chain conventions that
// also drive the subgraph mapping. Add a new game by appending here.
const GAME_TYPE = { rhythm: 0, simon: 1, stack: 2, nepa: 4 };
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
const GAME_LABEL = { rhythm: 'Rhythm Rush', simon: 'Simon Memory', stack: 'Stack Tower', nepa: 'Up NEPA!' };

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
  // ABSOLUTE progress = how many DISTINCT games played today (the set's size),
  // not an increment. The old incremental version was stuck at 0: the current
  // play is already in today's activity when this runs, so "!has(game)" was
  // always false and it never counted.
  { id: 'variety_2',          cat: 'special', absolute: true, label: 'Play 2 different games today', target: 2, reward: 25, match: ({ _seenGamesToday }) => _seenGamesToday ? _seenGamesToday.size : 0 },
  { id: 'variety_3',          cat: 'special', absolute: true, label: 'Play 3 different games today', target: 3, reward: 40, match: ({ _seenGamesToday }) => _seenGamesToday ? _seenGamesToday.size : 0 },
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
  const { data: existing } = await core.supabase
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
  await core.supabase.from('daily_missions').upsert(rows, { onConflict: 'wallet,date,mission_id', ignoreDuplicates: true });
}

async function updateMissionProgress(wallet, ctx) {
  const today = new Date().toISOString().split('T')[0];
  await ensureTodayMissions(wallet, today);

  // Compute "games played today" set (for play_both_games mission). Excludes the current submission.
  const { data: todays } = await core.supabase
    .from('activity')
    .select('game,created_at')
    .eq('wallet_address', wallet)
    .gte('created_at', `${today}T00:00:00.000Z`);
  const seenGamesToday = new Set((todays || []).map(a => a.game));

  // Pull all of today's missions for this wallet
  const { data: missions } = await core.supabase
    .from('daily_missions')
    .select('*')
    .eq('wallet', wallet)
    .eq('date', today);

  for (const m of missions || []) {
    if (m.completed) continue;
    const tpl = MISSION_TEMPLATES.find(t => t.id === m.mission_id);
    if (!tpl) continue;
    const value = tpl.match({ ...ctx, _seenGamesToday: seenGamesToday });
    // Absolute missions (e.g. "play N different games") report the true count;
    // everything else accumulates a per-play delta.
    const newProgress = tpl.absolute
      ? Math.min(m.target, value)
      : Math.min(m.target, m.progress + value);
    if (!tpl.absolute && !value) continue;         // no delta → nothing changed
    if (newProgress === m.progress) continue;      // absolute but unchanged
    const completed = newProgress >= m.target;
    await core.supabase
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
  const { data: existing } = await core.supabase
    .from('achievements_unlocked')
    .select('achievement_id')
    .eq('wallet', wallet);
  const unlockedSet = new Set((existing || []).map(r => r.achievement_id));

  let totalGames = 0;
  if (core.passContract) {
    try { totalGames = Number(await core.passContract.gamesPlayed(wallet)); } catch (_) {}
  }

  const { data: userRow } = await core.supabase
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
    const { error } = await core.supabase.from('achievements_unlocked').insert({
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
  const { data: rows } = await core.supabase
    .from('users')
    .select('xp')
    .eq('wallet_address', lower)
    .limit(1);
  const before = rows && rows.length > 0 ? (rows[0].xp || 0) : 0;
  const after  = before + amount;
  const beforeLevel = levelFromXp(before);
  const afterLevel  = levelFromXp(after);
  await core.supabase.from('users').update({ xp: after }).eq('wallet_address', lower);
  if (afterLevel > beforeLevel) {
    console.log(`✨ ${lower.slice(0, 8)}... LV ${beforeLevel} → ${afterLevel} (+${amount} XP ${reason})`);
  }
  return { xp: after, level: afterLevel, leveledUp: afterLevel > beforeLevel };
}

async function saveScore(entry) {
  // Upsert: keep best score per wallet per game
  const { data: rows } = await core.supabase
    .from('scores')
    .select('id, score')
    .eq('wallet_address', entry.wallet_address)
    .eq('game', entry.game)
    .order('score', { ascending: false })
    .limit(1);

  const existing = rows && rows.length > 0 ? rows[0] : null;

  if (existing && existing.score >= entry.score) {
    // Existing score is better, still log activity
    await core.supabase.from('activity').insert({
      wallet_address: entry.wallet_address,
      game: entry.game,
      score: entry.score,
      tx_hash: entry.tx_hash || null,
    });
    return;
  }

  if (existing) {
    // Delete old + insert new (avoids RLS update issues)
    await core.supabase.from('scores').delete().eq('id', existing.id);
    await core.supabase.from('scores').insert(entry);
    console.log(`📈 Score updated: ${entry.wallet_address.slice(0, 8)}... ${existing.score} → ${entry.score}`);
  } else {
    // Insert new
    await core.supabase.from('scores').insert(entry);
  }

  // Log activity
  await core.supabase.from('activity').insert({
    wallet_address: entry.wallet_address,
    game: entry.game,
    score: entry.score,
    tx_hash: entry.tx_hash || null,
  });
}
},

// ── GET /api/badges/:address ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── GET /api/badges/:address ───────────────────────────────────────────────
core.app.get('/api/badges/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const badges = await core.getBadges(addr);

  const goldCount = badges.filter(b => b.badge === 'gold').length;
  const silverCount = badges.filter(b => b.badge === 'silver').length;
  const bronzeCount = badges.filter(b => b.badge === 'bronze').length;

  // Compute streaks
  const streaks = {};
  core.VALID_GAMES.forEach(game => {
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
core.app.get('/api/notifications/:address', async (req, res) => {
  const addr = (req.params.address || '').toLowerCase();
  if (!addr) return res.status(400).json({ error: 'address required' });
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const { data, error } = await core.supabase
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
core.app.get('/api/achievements/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const { data: rows } = await core.supabase
    .from('achievements_unlocked')
    .select('achievement_id, unlocked_at, nft_token_id, tx_hash')
    .eq('wallet', addr);
  const unlockedMap = new Map((rows || []).map(r => [r.achievement_id, r]));

  const achievements = core.ACHIEVEMENT_CATALOG.map(ach => {
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
core.app.get('/api/missions/today/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const today = new Date().toISOString().split('T')[0];

  // Make sure today's missions exist
  await core.ensureTodayMissions(addr, today);

  const { data: rows } = await core.supabase
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
    const tpl = core.MISSION_TEMPLATES.find(t => t.id === r.mission_id);
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
core.app.post('/api/missions/claim', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { wallet, missionId } = req.body || {};
  if (!wallet || missionId == null) return res.status(400).json({ error: 'Missing wallet or missionId' });
  const addr = wallet.toLowerCase();

  // Look up the row, must belong to this player and be completed-but-not-claimed
  const { data: rows } = await core.supabase
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
  await core.supabase.from('daily_missions').update({ claimed: true }).eq('id', m.id);
  const xpResult = await core.awardXp(addr, m.reward_xp, `mission ${m.mission_id}`);

  res.json({ success: true, xpAwarded: m.reward_xp, xp: xpResult?.xp, level: xpResult?.level, leveledUp: !!xpResult?.leveledUp });
});

// ─── GET /api/user/:address — XP / level / streak in one shot ───────────────
core.app.get('/api/user/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const { data: rows } = await core.supabase
    .from('users')
    .select('xp, play_streak, last_play_date')
    .eq('wallet_address', addr)
    .limit(1);

  if (!rows || rows.length === 0) {
    const p = core.xpProgress(0);
    return res.json({
      address: addr,
      xp: 0, level: p.level, xpInLevel: p.xpInLevel, xpToNext: p.xpToNext,
      streak: 0, playedToday: false, lastPlayDate: null,
    });
  }

  const u = rows[0];
  const xp = u.xp || 0;
  const p = core.xpProgress(xp);
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
core.app.post('/api/record-claim', core.requireSecret, async (req, res) => {
  const { walletAddress } = req.body || {};
  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: 'Missing or invalid walletAddress' });
  }
  const addr = walletAddress.toLowerCase();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const { data: rows } = await core.supabase
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

  await core.supabase
    .from('users')
    .upsert({ wallet_address: addr, claim_streak: newStreak, last_claim_date: today }, { onConflict: 'wallet_address' });

  // Season 1 Solo Ladder hook. Award 5 points per daily claim if the
  // player is enrolled in the active season. Idempotent via the
  // wallet:date ref — repeated calls in the same day won't double-count.
  try {
    const { data: enrolled } = await core.supabase
      .from('season_v1_players')
      .select('wallet')
      .ilike('wallet', addr)
      .maybeSingle();
    if (enrolled) {
      await core.supabase
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
},

// ── GET /api/streak/:address ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── GET /api/streak/:address ────────────────────────────────────────────
core.app.get('/api/streak/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const { data: rows } = await core.supabase
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
},

];
