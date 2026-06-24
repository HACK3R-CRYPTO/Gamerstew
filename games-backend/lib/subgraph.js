// Goldsky subgraph client for the backend. The subgraph is now the source
// of truth for everything on-chain (scores, players, habitats, wagers).
// Supabase remains for off-chain state (XP, missions, streaks, achievements,
// equipped-habitat preference, identity flags).
//
// Failures throw — callers can decide whether to surface the error or fall
// back to a cached Supabase read. Most read endpoints just throw and the
// Express default 500 handler returns it; the client is on a fast cache so
// transient outages stay invisible to most users.

const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ||
  'https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.0/gn';

const TIMEOUT_MS = 8_000;

// Maps the on-chain uint8 gameType to the player-facing game key. Mirrors
// GAME_TYPE in server.js · adding a new game means one row here. Previously
// this was a ternary that defaulted everything non-rhythm to 'simon',
// which silently mislabeled Stack Tower (gameType 2) scores as simon.
const GAME_BY_TYPE = { 0: 'rhythm', 1: 'simon', 2: 'stack' };

async function gql(query, variables = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`subgraph ${r.status}`);
    const json = await r.json();
    if (json.errors) throw new Error('subgraph: ' + JSON.stringify(json.errors));
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Leaderboard for a game over a time window ───────────────────────────────
// Returns top-N by score within [startUnix, +∞), deduped per-player. Exact
// shape match to the previous Supabase getLeaderboard() so callers don't
// have to rewrap.
async function leaderboard(gameType, startUnix, limit = 50) {
  const data = await gql(
    `query LB($g: Int!, $start: BigInt!) {
      scores(first: 500, where: { gameType: $g, blockTimestamp_gte: $start }, orderBy: score, orderDirection: desc) {
        player { id username }
        score
        blockTimestamp
        txHash
      }
    }`,
    { g: gameType, start: startUnix.toString() },
  );
  const seen = new Map();
  for (const s of data.scores || []) {
    const id = s.player.id.toLowerCase();
    const score = Number(s.score);
    const existing = seen.get(id);
    if (!existing || score > existing.score) {
      seen.set(id, {
        wallet_address: id,
        username: s.player.username || null,
        score,
        created_at: new Date(Number(s.blockTimestamp) * 1000).toISOString(),
        tx_hash: s.txHash || null,
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}

// ─── Recent activity feed ────────────────────────────────────────────────────
async function recentActivity(limit = 20, player = null) {
  const where = player ? `, where: { player: "${player.toLowerCase()}" }` : '';
  const data = await gql(
    `{
      scores(first: ${Math.min(50, limit)}, orderBy: blockTimestamp, orderDirection: desc${where}) {
        player { id username }
        gameType
        score
        blockTimestamp
        txHash
      }
    }`,
  );
  return (data.scores || []).map(s => ({
    wallet_address: s.player.id,
    username: s.player.username || null,
    game: GAME_BY_TYPE[s.gameType] || 'rhythm',
    score: Number(s.score),
    tx_hash: s.txHash,
    created_at: new Date(Number(s.blockTimestamp) * 1000).toISOString(),
  }));
}

// ─── Player record (best scores, ownership, totals) ──────────────────────────
async function playerProfile(address) {
  const data = await gql(
    `query P($id: ID!) {
      player(id: $id) {
        id
        username
        totalGames
        rhythmPlays
        simonPlays
        bestRhythmScore
        bestSimonScore
        highestHabitatTier
        totalUbiDonated
        ownedHabitats(orderBy: tier) {
          tier
          unlockedAt
          ubiAmount
        }
      }
    }`,
    { id: address.toLowerCase() },
  );
  return data.player || null;
}

// ─── Global totals — replaces /api/stats heavy aggregates ────────────────────
async function globalStats() {
  const data = await gql(
    `{
      globalStat(id: "global") {
        totalPlayers
        totalScores
        totalRhythmPlays
        totalSimonPlays
        totalHabitatUnlocks
        totalUbiDonatedG
        totalTreasuryG
        totalWagers
        totalWageredG
      }
    }`,
  );
  return data.globalStat || null;
}

// ─── Season-scoped rank for a single player ──────────────────────────────────
// Used by submit-score so the post-game results screen never shows blank.
async function seasonRank(playerLower, playerScore, gameType, seasonStartUnix) {
  const board = await leaderboard(gameType, seasonStartUnix, 500);
  const myCurrent = board.find(e => e.wallet_address === playerLower)?.score || 0;
  const myEffective = Math.max(myCurrent, Number(playerScore));
  let above = 0;
  for (const e of board) {
    if (e.wallet_address === playerLower) continue;
    if (e.score > myEffective) above++;
  }
  return above + 1;
}

module.exports = {
  gql,
  leaderboard,
  recentActivity,
  playerProfile,
  globalStats,
  seasonRank,
};
