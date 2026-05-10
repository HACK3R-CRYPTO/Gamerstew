// Goldsky subgraph client. Replaces the Supabase-backed leaderboard reads
// so the frontend stays alive even when Supabase egress is throttled.
//
// All queries are read-only POSTs to the public Goldsky endpoint. Failures
// fall back to an empty array — callers handle the empty state.

const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.0/gn";

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) return null;
    const json = await r.json();
    if (json.errors) {
      console.warn("subgraph errors:", json.errors);
      return null;
    }
    return json.data as T;
  } catch (e) {
    console.warn("subgraph fetch failed:", e);
    return null;
  }
}

// ─── Leaderboard ────────────────────────────────────────────────────────────
// `gameType` 0 = Rhythm Rush, 1 = Simon Memory. We query scores within the
// current-week window and dedupe per-player client-side, mirroring the
// previous Supabase logic. Scores are immutable so the subgraph never
// double-counts.

export type LeaderboardEntry = {
  player: string;          // wallet address (lowercase)
  username?: string;
  score: number;
  timestamp: number;       // unix seconds
  streak?: number;         // not in subgraph yet; left for parity
};

type ScoreRow = {
  player: { id: string; username: string | null };
  score: string;
  blockTimestamp: string;
};

// Returns the top players for the current week's leaderboard. Pulls a wide
// score window from the subgraph (top 500 by score) and dedupes per-player.
export async function fetchLeaderboard(
  gameType: 0 | 1,
  weekStartUnix: number,
  limit = 50,
): Promise<LeaderboardEntry[]> {
  const data = await gql<{ scores: ScoreRow[] }>(
    `query LB($gameType: Int!, $start: BigInt!) {
      scores(
        first: 500,
        where: { gameType: $gameType, blockTimestamp_gte: $start }
        orderBy: score, orderDirection: desc
      ) {
        player { id username }
        score
        blockTimestamp
      }
    }`,
    { gameType, start: weekStartUnix.toString() },
  );

  if (!data || !data.scores) return [];

  // Keep only the best score per wallet
  const seen = new Map<string, LeaderboardEntry>();
  for (const s of data.scores) {
    const id = s.player.id.toLowerCase();
    const score = Number(s.score);
    const existing = seen.get(id);
    if (!existing || score > existing.score) {
      seen.set(id, {
        player: id,
        username: s.player.username || undefined,
        score,
        timestamp: Number(s.blockTimestamp),
      });
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ─── All-time combined leaderboard ──────────────────────────────────────────
// One global leaderboard combining BOTH games. Each player's score = their
// best Rhythm + best Simon (peak across all time). The single number
// rewards players who are skilled at both games and gives every player a
// stable "where do I stand overall" answer that doesn't reset.
//
// Pulls from the Player entity which already aggregates bestRhythmScore /
// bestSimonScore, so this is a single cheap query per refresh.

type PlayerRow = {
  id: string;
  username: string | null;
  bestRhythmScore: string;
  bestSimonScore: string;
};

export type AllTimeEntry = LeaderboardEntry & {
  bestRhythm: number;
  bestSimon: number;
};

export async function fetchAllTimeLeaderboard(limit = 50): Promise<AllTimeEntry[]> {
  // Pull all players who have ever scored. With a small population we can
  // pull the lot and sort client-side. If the population grows we can swap
  // in server-side ordering by a derived combined-best field.
  const data = await gql<{ players: PlayerRow[] }>(
    `query AllTime {
      players(first: 1000) {
        id
        username
        bestRhythmScore
        bestSimonScore
      }
    }`,
  );

  if (!data || !data.players) return [];

  return data.players
    .map(p => {
      const bestRhythm = Number(p.bestRhythmScore);
      const bestSimon  = Number(p.bestSimonScore);
      return {
        player: p.id.toLowerCase(),
        username: p.username || undefined,
        score: bestRhythm + bestSimon,
        timestamp: 0, // combined view doesn't track a single peak moment
        bestRhythm,
        bestSimon,
      };
    })
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function fetchPlayerAllTimeCombinedStats(
  address: string,
): Promise<{ peak: number; rank: number; bestRhythm: number; bestSimon: number } | null> {
  // Fetch the player's bests + count anyone whose combined best is higher.
  // Sums are computed client-side because the subgraph doesn't index a
  // derived combined-best field directly.
  const me = await gql<{ player: PlayerRow | null }>(
    `query MyBest($id: ID!) {
      player(id: $id) {
        id
        username
        bestRhythmScore
        bestSimonScore
      }
    }`,
    { id: address.toLowerCase() },
  );
  const p = me?.player;
  if (!p) return null;
  const bestRhythm = Number(p.bestRhythmScore);
  const bestSimon  = Number(p.bestSimonScore);
  const myCombined = bestRhythm + bestSimon;
  if (myCombined === 0) return null;

  // Pull everyone, count how many have a higher combined best.
  const all = await gql<{ players: PlayerRow[] }>(
    `query All { players(first: 1000) { id bestRhythmScore bestSimonScore } }`,
  );
  const above = (all?.players || []).filter(o => {
    const c = Number(o.bestRhythmScore) + Number(o.bestSimonScore);
    return c > myCombined && o.id.toLowerCase() !== address.toLowerCase();
  }).length;

  return { peak: myCombined, rank: above + 1, bestRhythm, bestSimon };
}

// ─── Player all-time stats ──────────────────────────────────────────────────
// Returns the player's all-time peak score for the requested game AND their
// rank vs everyone else. Used by the ALL-TIME tab to render the
// "Your rank: #N · Your best: X" chip when they're outside the top 50.

export async function fetchPlayerAllTimeStats(
  address: string,
  gameType: 0 | 1,
): Promise<{ peak: number; rank: number } | null> {
  const orderField = gameType === 0 ? "bestRhythmScore" : "bestSimonScore";
  const data = await gql<{
    player: { id: string; bestRhythmScore: string; bestSimonScore: string } | null;
  }>(
    `query MyBest($id: ID!) {
      player(id: $id) {
        id
        bestRhythmScore
        bestSimonScore
      }
    }`,
    { id: address.toLowerCase() },
  );
  const my = data?.player;
  if (!my) return null;
  const myBest = gameType === 0 ? my.bestRhythmScore : my.bestSimonScore;
  if (myBest === "0") return null;

  const above = await gql<{ players: { id: string }[] }>(
    `query Above($best: BigInt!) {
      players(first: 1000, where: { ${orderField}_gt: $best }) { id }
    }`,
    { best: myBest },
  );
  const aboveCount = above?.players?.length ?? 0;
  return { peak: Number(myBest), rank: aboveCount + 1 };
}

// ─── Player rank ────────────────────────────────────────────────────────────
// Used by the post-game results screen if the backend's rank field is null.
// Counts how many distinct players have a higher best score than the player.
// Cheap because the subgraph already aggregates per-Player.

export async function fetchPlayerRank(
  address: string,
  gameType: 0 | 1,
): Promise<number | null> {
  const orderField = gameType === 0 ? "bestRhythmScore" : "bestSimonScore";
  const data = await gql<{
    me: { id: string } | null;
    abovePlayers: { id: string }[];
  }>(
    `query Rank($id: ID!, $myScore: BigInt!) {
      me: player(id: $id) { id }
      abovePlayers: players(
        first: 1000,
        where: { ${orderField}_gt: $myScore }
      ) { id }
    }`,
    {
      id: address.toLowerCase(),
      // We don't know myScore here yet, so we use 0 to count anyone above 0,
      // then adjust below. Simpler approach: fetch the player first, then count.
      myScore: "0",
    },
  );
  if (!data?.me) return null;

  // Two-step query for accuracy: get player's best, then count above
  const playerData = await gql<{
    player: {
      id: string;
      bestRhythmScore: string;
      bestSimonScore: string;
    } | null;
  }>(
    `query MyBest($id: ID!) {
      player(id: $id) {
        id
        bestRhythmScore
        bestSimonScore
      }
    }`,
    { id: address.toLowerCase() },
  );
  const my = playerData?.player;
  if (!my) return null;

  const myBest = gameType === 0 ? my.bestRhythmScore : my.bestSimonScore;
  if (myBest === "0") return null;

  const countData = await gql<{ players: { id: string }[] }>(
    `query Above($best: BigInt!) {
      players(first: 1000, where: { ${orderField}_gt: $best }) { id }
    }`,
    { best: myBest },
  );
  const above = countData?.players?.length ?? 0;
  return above + 1;
}
