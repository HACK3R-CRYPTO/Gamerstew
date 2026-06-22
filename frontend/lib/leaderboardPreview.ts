// Shared cache + prefetch helper for the lobby top-3 leaderboard previews.
//
// The problem this solves: each game lobby (Rhythm / Simon / Stack) used to
// fire TWO sequential network requests on mount — /api/seasons (~250ms)
// then the Goldsky leaderboard query (~400ms). That's ~650ms of empty card
// every time the player taps in. Felt cheap.
//
// Strategy used here is what top studios ship for hub→lobby transitions:
//
//   1. Module-level cache, stale-while-revalidate. First visit fetches +
//      caches. Subsequent visits show cached data INSTANTLY (synchronous
//      read at component init), then refetch in the background to update.
//
//   2. Prefetch on the previous screen. The /games hub and /dashboard
//      call prefetchPreview(gameType) when the player taps a game card,
//      so by the time the lobby mounts, the cache is already warm and
//      the preview renders with real data on the first paint.
//
//   3. Single source of truth for season metadata. The metadata fetch is
//      cached once and shared across all three games — the season window
//      is the same for everyone.
//
// All three lobbies use this module · adding a new game means one row in
// the GAME_TYPE_FOR call site, nothing else.

import { fetchLeaderboard, type GameTypeId, type LeaderboardEntry } from "@/lib/subgraph";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// Season metadata cache · shared by all games since the season window
// is global. 60-second freshness window is fine · the Sunday rollover
// is a once-a-week event, so a stale read inside the same minute is
// effectively the same response.
type SeasonMeta = { seasonNum: number | null; seasonStart: number };
let seasonMetaCache: { value: SeasonMeta; at: number } | null = null;
const SEASON_TTL_MS = 60_000;

async function getSeasonMeta(): Promise<SeasonMeta> {
  const now = Date.now();
  if (seasonMetaCache && now - seasonMetaCache.at < SEASON_TTL_MS) {
    return seasonMetaCache.value;
  }
  const fallback: SeasonMeta = { seasonNum: null, seasonStart: Math.floor(now / 1000) - 7 * 24 * 60 * 60 };
  try {
    const r = await fetch(`${BACKEND_URL}/api/seasons`, { cache: "no-store" });
    if (!r.ok) {
      seasonMetaCache = { value: fallback, at: now };
      return fallback;
    }
    const d = await r.json();
    const meta: SeasonMeta = {
      seasonNum: typeof d?.currentSeason === "number" ? d.currentSeason : null,
      seasonStart: typeof d?.currentStartsAt === "number"
        ? d.currentStartsAt
        : typeof d?.currentEndsAt === "number"
          ? d.currentEndsAt - 7 * 24 * 60 * 60
          : fallback.seasonStart,
    };
    seasonMetaCache = { value: meta, at: now };
    return meta;
  } catch {
    seasonMetaCache = { value: fallback, at: now };
    return fallback;
  }
}

// Per-game leaderboard cache · 30 seconds is the right TTL because a new
// score lands on-chain within a few seconds, and players checking the
// lobby usually want fresh-ish data. We still show the stale data
// immediately on revisit, just kick off a background refresh.
export type LobbyPreview = {
  seasonNum: number | null;
  top: LeaderboardEntry[];
};

const previewCache = new Map<GameTypeId, { value: LobbyPreview; at: number }>();
const PREVIEW_TTL_MS = 30_000;

// Synchronous · read whatever's in cache without firing a request. Used
// by the preview components to seed initial state, so the first paint
// has data when the cache is warm.
export function getCachedPreview(gameType: GameTypeId): LobbyPreview | null {
  const hit = previewCache.get(gameType);
  return hit?.value ?? null;
}

// In-flight dedupe · if two callers ask for the same gameType while a
// fetch is already running, both await the same promise instead of
// hitting the network twice. Important because the prefetch on tap and
// the lobby's own mount-time fetch can both fire within ~50ms.
const inFlight = new Map<GameTypeId, Promise<LobbyPreview>>();

export async function fetchPreview(gameType: GameTypeId): Promise<LobbyPreview> {
  const existing = inFlight.get(gameType);
  if (existing) return existing;
  const promise = (async (): Promise<LobbyPreview> => {
    const meta = await getSeasonMeta();
    let top: LeaderboardEntry[] = [];
    try {
      const rows = await fetchLeaderboard(gameType, meta.seasonStart, 3);
      top = rows.slice(0, 3);
    } catch { /* leave top as [] · UI handles empty state */ }
    const value: LobbyPreview = { seasonNum: meta.seasonNum, top };
    previewCache.set(gameType, { value, at: Date.now() });
    return value;
  })();
  inFlight.set(gameType, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(gameType);
  }
}

// Fire-and-forget cache warmer · called from the /games hub and the
// /dashboard hero/grid the moment a player taps a game card. By the
// time the lobby's component mounts (~300-500ms later on a typical
// mobile connection), the cache is populated and the preview renders
// real data on first paint instead of a "Loading…" flash.
export function prefetchPreview(gameType: GameTypeId): void {
  const hit = previewCache.get(gameType);
  if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return;   // already fresh
  void fetchPreview(gameType).catch(() => { /* prefetch failures are silent */ });
}
