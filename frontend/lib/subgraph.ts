// Goldsky subgraph client. Replaces the Supabase-backed leaderboard reads
// so the frontend stays alive even when Supabase egress is throttled.
//
// All queries are read-only POSTs to the public Goldsky endpoint. Failures
// fall back to an empty array — callers handle the empty state.

const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.2/gn";

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

// ─── Schema feature detection ───────────────────────────────────────────────
// The frontend ships ahead of the subgraph deploy: this codebase knows
// about Stack Tower's bestStackScore field, but the live Goldsky subgraph
// may still be running the previous schema version. Querying a field that
// doesn't exist yet fails the WHOLE query, which used to wipe the all-time
// board for everyone. So we introspect the Player type on first call,
// cache the result for the session, and build query strings that omit
// fields the deployed schema doesn't expose. Once Goldsky's schema is
// updated, the detection flips to true automatically · no code change.
let stackFieldSupportedPromise: Promise<boolean> | null = null;
function isStackFieldSupported(): Promise<boolean> {
  if (stackFieldSupportedPromise) return stackFieldSupportedPromise;
  stackFieldSupportedPromise = (async () => {
    const data = await gql<{ __type: { fields: { name: string }[] } | null }>(
      `query { __type(name: "Player") { fields { name } } }`,
    );
    const fields = data?.__type?.fields ?? [];
    return fields.some(f => f.name === "bestStackScore");
  })();
  return stackFieldSupportedPromise;
}

// ─── Leaderboard ────────────────────────────────────────────────────────────
// `gameType` 0 = Rhythm Rush, 1 = Simon Memory, 2 = Stack Tower.
// Mirrors GamePass.sol uint8 gameType + the backend's GAME_TYPE map. We
// query scores within the current-week window and dedupe per-player
// client-side. Scores are immutable so the subgraph never double-counts.

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
export type GameTypeId = 0 | 1 | 2;

export async function fetchLeaderboard(
  gameType: GameTypeId,
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
  bestStackScore?: string;   // optional · only present when the deployed schema includes it
};

export type AllTimeEntry = LeaderboardEntry & {
  bestRhythm: number;
  bestSimon: number;
  bestStack: number;
};

export async function fetchAllTimeLeaderboard(limit = 50): Promise<AllTimeEntry[]> {
  // Pull all players who have ever scored. With a small population we can
  // pull the lot and sort client-side. If the population grows we can swap
  // in server-side ordering by a derived combined-best field.
  //
  // Combined score = sum of every per-game best. Each new game lands here
  // by adding its best{Game}Score field below — players who diversify
  // get a higher combined number, which is the intended incentive.
  //
  // bestStackScore is included conditionally: if the deployed subgraph
  // doesn't expose it yet, asking for it would fail the whole query and
  // wipe the board. Detection runs once per session.
  const stack = await isStackFieldSupported();
  const stackField = stack ? "bestStackScore" : "";
  const data = await gql<{ players: PlayerRow[] }>(
    `query AllTime {
      players(first: 1000) {
        id
        username
        bestRhythmScore
        bestSimonScore
        ${stackField}
      }
    }`,
  );

  if (!data || !data.players) return [];

  return data.players
    .map(p => {
      const bestRhythm = Number(p.bestRhythmScore);
      const bestSimon  = Number(p.bestSimonScore);
      const bestStack  = Number(p.bestStackScore ?? 0);
      return {
        player: p.id.toLowerCase(),
        username: p.username || undefined,
        score: bestRhythm + bestSimon + bestStack,
        timestamp: 0, // combined view doesn't track a single peak moment
        bestRhythm,
        bestSimon,
        bestStack,
      };
    })
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function fetchPlayerAllTimeCombinedStats(
  address: string,
): Promise<{ peak: number; rank: number; bestRhythm: number; bestSimon: number; bestStack: number } | null> {
  // Fetch the player's bests + count anyone whose combined best is higher.
  // Sums are computed client-side because the subgraph doesn't index a
  // derived combined-best field directly.
  const stack = await isStackFieldSupported();
  const stackField = stack ? "bestStackScore" : "";

  const me = await gql<{ player: PlayerRow | null }>(
    `query MyBest($id: ID!) {
      player(id: $id) {
        id
        username
        bestRhythmScore
        bestSimonScore
        ${stackField}
      }
    }`,
    { id: address.toLowerCase() },
  );
  const p = me?.player;
  if (!p) return null;
  const bestRhythm = Number(p.bestRhythmScore);
  const bestSimon  = Number(p.bestSimonScore);
  const bestStack  = Number(p.bestStackScore ?? 0);
  const myCombined = bestRhythm + bestSimon + bestStack;
  if (myCombined === 0) return null;

  // Pull everyone, count how many have a higher combined best.
  const all = await gql<{ players: PlayerRow[] }>(
    `query All { players(first: 1000) { id bestRhythmScore bestSimonScore ${stackField} } }`,
  );
  const above = (all?.players || []).filter(o => {
    const c = Number(o.bestRhythmScore) + Number(o.bestSimonScore) + Number(o.bestStackScore ?? 0);
    return c > myCombined && o.id.toLowerCase() !== address.toLowerCase();
  }).length;

  return { peak: myCombined, rank: above + 1, bestRhythm, bestSimon, bestStack };
}

// ─── Player all-time stats ──────────────────────────────────────────────────
// Returns the player's all-time peak score for the requested game AND their
// rank vs everyone else. Used by the ALL-TIME tab to render the
// "Your rank: #N · Your best: X" chip when they're outside the top 50.

const BEST_FIELD: Record<GameTypeId, "bestRhythmScore" | "bestSimonScore" | "bestStackScore"> = {
  0: "bestRhythmScore",
  1: "bestSimonScore",
  2: "bestStackScore",
};

export async function fetchPlayerAllTimeStats(
  address: string,
  gameType: GameTypeId,
): Promise<{ peak: number; rank: number } | null> {
  const orderField = BEST_FIELD[gameType];
  const stack = await isStackFieldSupported();
  // Asking for stack on gameType=2 when the subgraph doesn't index it yet
  // would always return 0; signal "no data yet" cleanly instead of pretending.
  if (gameType === 2 && !stack) return null;
  const stackField = stack ? "bestStackScore" : "";

  const data = await gql<{
    player: {
      id: string;
      bestRhythmScore: string;
      bestSimonScore: string;
      bestStackScore?: string;
    } | null;
  }>(
    `query MyBest($id: ID!) {
      player(id: $id) {
        id
        bestRhythmScore
        bestSimonScore
        ${stackField}
      }
    }`,
    { id: address.toLowerCase() },
  );
  const my = data?.player;
  if (!my) return null;
  const myBest = my[orderField];
  if (!myBest || myBest === "0") return null;

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
  gameType: GameTypeId,
): Promise<number | null> {
  const orderField = BEST_FIELD[gameType];
  const stack = await isStackFieldSupported();
  // gameType=2 against an unmigrated subgraph has no truth to report.
  if (gameType === 2 && !stack) return null;
  const stackField = stack ? "bestStackScore" : "";

  const playerData = await gql<{
    player: {
      id: string;
      bestRhythmScore: string;
      bestSimonScore: string;
      bestStackScore?: string;
    } | null;
  }>(
    `query MyBest($id: ID!) {
      player(id: $id) {
        id
        bestRhythmScore
        bestSimonScore
        ${stackField}
      }
    }`,
    { id: address.toLowerCase() },
  );
  const my = playerData?.player;
  if (!my) return null;

  const myBest = my[orderField];
  if (!myBest || myBest === "0") return null;

  const countData = await gql<{ players: { id: string }[] }>(
    `query Above($best: BigInt!) {
      players(first: 1000, where: { ${orderField}_gt: $best }) { id }
    }`,
    { best: myBest },
  );
  const above = countData?.players?.length ?? 0;
  return above + 1;
}
