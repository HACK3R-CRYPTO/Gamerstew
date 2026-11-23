// ─── health ───────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── GET /health ──
function* (core) {
  Object.defineProperties(core, {
    indexOnChainScores: { get: () => indexOnChainScores, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── GET /health ────────────────────────────────────────────────────────────
// Which Rhythm Rush songs this server can score. The game asks before offering
// any song beyond the original, so a newer game talking to an older server
// never lets someone play a song that would be replayed against the wrong chart.
core.app.get('/api/rhythm/songs', (_req, res) => {
  const songs = require('../lib/rhythmSongs.json');
  res.json({ songs: songs.songs.map((s) => s.id), default: songs.default });
});

core.app.get('/health', async (_, res) => {
  // Per-game score counts. New games pick up automatically via VALID_GAMES.
  const scoreCounts = Object.fromEntries(
    await Promise.all(core.VALID_GAMES.map(async (game) => {
      const { count } = await core.supabase
        .from('scores')
        .select('*', { count: 'exact', head: true })
        .eq('game', game);
      return [game, count || 0];
    }))
  );

  res.json({
    status: 'ok',
    season: core.currentSeasonNumber(),
    scores: scoreCounts,
    onChainReady: !!core.wagerContract,
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
  if (!core.passContract || !core.provider) return;
  try {
    // Reuse the module-level provider + interface instead of allocating
    // fresh ones every 5 min — the old pattern was the main memory leak.
    const currentBlock = await core.provider.getBlockNumber();
    if (indexerCursor === null) indexerCursor = Math.max(0, currentBlock - INDEXER_MAX_RANGE);
    if (indexerCursor >= currentBlock) return;

    const logs = [];
    let windows = 0;
    while (indexerCursor < currentBlock && windows < INDEXER_WINDOWS_PER_TICK) {
      const from = indexerCursor + 1;
      const to = Math.min(from + INDEXER_MAX_RANGE - 1, currentBlock);
      const chunk = await core.provider.getLogs({
        address: core.GAME_PASS_ADDR,
        topics: [core.ethers.id('ScoreRecorded(address,uint8,uint256,uint256,uint256)')],
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
      const parsed = core.SCORE_EVENT_IFACE.parseLog({ topics: log.topics, data: log.data });
      const player = parsed.args[0].toLowerCase();
      const gameType = Number(parsed.args[1]);
      const score = Number(parsed.args[2]);
      // gameType 3 = Challenge AI (MARKOV). Its ScoreRecorded events are the
      // on-chain history trail, but its authoritative weekly ranking lives in
      // arena_free_matches → /api/arena/ladder (sum-based), NOT the `scores`
      // table (which is max-per-wallet and feeds the skill-game leaderboards).
      // So we intentionally do NOT mirror gameType 3 into `scores` — skip it
      // quietly, without the unknown-gameType warning below.
      if (gameType === core.CHALLENGE_AI_GAME_TYPE) continue;
      // Reverse of GAME_TYPE · uint8 from on-chain back to the player-key
      // string we use in the activity table. Adding a new game means
      // appending one row here, not a wider ternary chain.
      const game = ({ 0: 'rhythm', 1: 'simon', 2: 'stack', 4: 'nepa' })[gameType];
      if (!game) {
        console.warn(`⛓️  Unknown gameType ${gameType} in ScoreRecorded event · skipping`);
        continue;
      }

      let timestamp = new Date().toISOString();
      try {
        const block = await core.provider.getBlock(log.blockNumber);
        if (block) timestamp = new Date(Number(block.timestamp) * 1000).toISOString();
      } catch (_) { }

      const { data: existing } = await core.supabase
        .from('scores')
        .select('id, score')
        .eq('wallet_address', player)
        .eq('game', game)
        .order('score', { ascending: false })
        .limit(1)
        .single();

      if (existing && existing.score >= score) continue;

      if (existing) {
        await core.supabase
          .from('scores')
          .update({ score, tx_hash: log.transactionHash })
          .eq('id', existing.id);
      } else {
        await core.supabase.from('scores').insert({
          wallet_address: player,
          game,
          score,
          game_time: 0,
          season_number: core.currentSeasonNumber(),
          tx_hash: log.transactionHash,
          created_at: timestamp,
        });
      }

      await core.registerUser(player);
      added++;
    }

    console.log(`⛓️  Indexed ${added} scores from ${logs.length} on-chain events`);
  } catch (e) {
    console.warn('⚠️  On-chain score indexing failed:', e.message);
  }
}
},

];
