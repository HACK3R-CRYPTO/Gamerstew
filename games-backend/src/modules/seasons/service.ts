// ─── Seasons: this week's standings and every past week ──────────────────────
// GET /api/seasons feeds the leaderboard page and the home preview. It returns
// the live top ten per game for the current season, and the final top ten per
// game for every sealed season before it.
//
// HOW IT STAYS FAST AS THE SEASONS PILE UP
// A sealed season is over: its scores can never change. The old handler
// re-read every past season from the database on every uncached request, one
// query per game per season (about 165 queries at season 42, more every week),
// and looked up an on-chain username for every player who had ever scored. It
// took over four seconds, and every saved score threw the result away.
//
// Now each past season's final table is kept in memory and re-read only every
// half hour. A request costs one query per game for the live season plus one
// for the list of seasons, however many seasons there are. Names are looked up
// only for the players actually shown, and refreshed every ten minutes so a
// renamed player still catches up.
//
// What is never remembered:
//   - a read that FAILED. A database hiccup must not become an empty season
//     that lasts until the next deploy. It is served once, as the old code
//     would have served it, and read again on the next request.
//   - a season that ended minutes ago. A score saved right on the boundary can
//     still land in it, so it is read fresh until it has settled.
//   - names from a lookup that failed. They are tried again on the next request.
// And a table is not kept for ever: after half an hour it is read again, so a
// row an admin removes from a past season disappears without a redeploy.
//
// The reply has exactly the shape it always had.

export interface ActivityRow { wallet_address?: string | null; score: number; game_time?: unknown; wagered?: unknown; created_at: string; tx_hash?: unknown }
export interface SeasonRow { season_number: number; start_ts: number; end_ts: number; prize_pot?: unknown; created_at: string }

export interface SeasonsDeps {
  /** every game, in the order their keys appear in the reply */
  games: string[];
  currentSeason(): number;
  seasonBounds(season: number): { start: number; end: number };
  /** up to 500 best activity rows for one game from `fromIso`, before `toIso` when given.
   *  `ok` is false when the read failed (the rows are then empty and mean nothing). */
  topActivity(game: string, fromIso: string, toIso: string | null): Promise<{ rows: ActivityRow[]; ok: boolean }>;
  /** sealed seasons, newest first */
  sealedSeasons(): Promise<SeasonRow[]>;
  /** `ok` is false when the lookup itself failed, as opposed to "this player has no name" */
  resolveUsername(wallet: string): Promise<{ name: string | null | undefined; ok: boolean }>;
  cache: { get(key: string): unknown; set(key: string, value: unknown, ttlMs: number): void };
  ttlMs: number;
  /** how long names on past seasons are trusted before being looked up again */
  nameTtlMs?: number;
  /** how long a finished season's table is kept before it is read again */
  pastTtlMs?: number;
  /** a season that ended more recently than this is not kept yet */
  settleMs?: number;
  now?: () => number;
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const iso = (sec: number) => new Date(sec * 1000).toISOString();

/** One row per player, their best, highest first. */
export function bestPerPlayer<T extends ActivityRow>(rows: T[] | null | undefined, limit = 10): T[] {
  const best = new Map<string, T>();
  for (const row of rows || []) {
    const key = row.wallet_address?.toLowerCase();
    if (!key) continue;
    const had = best.get(key);
    if (!had || row.score > had.score) best.set(key, row);
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}

interface PastMemo { top: Record<string, ActivityRow[]>; totalPlayers: number; shown: Record<string, unknown[]> | null; namedAt: number; readAt: number }

export function createSeasonsService(deps: SeasonsDeps) {
  const now = deps.now ?? Date.now;
  const nameTtl = deps.nameTtlMs ?? 10 * 60 * 1000;
  const pastTtl = deps.pastTtlMs ?? 30 * 60 * 1000;
  const settle = deps.settleMs ?? 10 * 60 * 1000;
  // finished seasons, keyed by number and bounds so a corrected row is re-read
  const past = new Map<string, PastMemo>();
  const inFlight = new Map<string, Promise<PastMemo>>();

  // Seasons do not all expire in the same instant: each one's half hour is
  // shifted by its number, so re-reading is a trickle and never a burst.
  const keepFor = (seasonNumber: number) => pastTtl + ((seasonNumber * 37) % 60) * (pastTtl / 120);

  async function readPast(s: SeasonRow): Promise<PastMemo> {
    const key = `${s.season_number}:${s.start_ts}:${s.end_ts}`;
    const have = past.get(key);
    if (have && now() - have.readAt <= keepFor(s.season_number)) return have;
    // two requests arriving together share one read instead of each doing it
    let loading = inFlight.get(key);
    if (!loading) {
      loading = (async () => {
        const perGame = await Promise.all(deps.games.map(async (game) => [game, await deps.topActivity(game, iso(s.start_ts), iso(s.end_ts))] as const));
        const players = new Set<unknown>();
        for (const [, read] of perGame) for (const r of read.rows) players.add(r.wallet_address);
        const memo: PastMemo = { top: Object.fromEntries(perGame.map(([g, read]) => [g, bestPerPlayer(read.rows, 10)])), totalPlayers: players.size, shown: null, namedAt: 0, readAt: now() };
        const complete = perGame.every(([, read]) => read.ok);
        const settled = now() - s.end_ts * 1000 >= settle;
        if (complete && settled) {
          past.set(key, memo);
          // an older reading of the same season under different bounds is of no further use
          for (const k of past.keys()) if (k !== key && k.startsWith(`${s.season_number}:`)) past.delete(k);
        } else if (!complete && have) {
          return have; // the re-read failed: the table we already hold is better than a hole
        }
        return memo;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, loading);
    }
    return loading;
  }

  async function pastSeason(s: SeasonRow) {
    const memo = await readPast(s);
    let shown = memo.shown;
    if (!shown || now() - memo.namedAt > nameTtl) {
      let allAnswered = true;
      const named: Record<string, unknown[]> = {};
      for (const game of deps.games) {
        named[game] = await Promise.all((memo.top[game] ?? []).map(async (e) => {
          const who = await deps.resolveUsername(e.wallet_address as string);
          if (!who.ok) allAnswered = false;
          return { player: e.wallet_address, username: who.name || null, score: e.score, gameTime: e.game_time, timestamp: unix(e.created_at), tx_hash: e.tx_hash };
        }));
      }
      shown = named;
      // names are kept only when every lookup really answered; otherwise the next request asks again
      if (allAnswered) { memo.shown = named; memo.namedAt = now(); }
    }
    // prize and seal time come from the season row itself, read fresh every time
    return { season: s.season_number, startTs: s.start_ts, endTs: s.end_ts, prizePot: s.prize_pot, sealedAt: unix(s.created_at), totalPlayers: memo.totalPlayers, ...shown };
  }

  let building: Promise<Record<string, unknown>> | null = null;

  /** GET /api/seasons */
  async function seasons(): Promise<Record<string, unknown>> {
    const cached = deps.cache.get('seasons:global');
    if (cached) return cached as Record<string, unknown>;
    // visitors who arrive while one reply is being built wait for that one
    if (!building) building = build().finally(() => { building = null; });
    return building;
  }

  async function build(): Promise<Record<string, unknown>> {
    const current = deps.currentSeason();
    const { start, end } = deps.seasonBounds(current);

    const liveRows = (await Promise.all(deps.games.map((game) => deps.topActivity(game, iso(start), null)))).map((read) => read.rows);
    const sealed = await deps.sealedSeasons();
    const pastOut = await Promise.all((sealed || []).map(pastSeason));

    const live: Record<string, unknown[]> = {};
    for (const [i, game] of deps.games.entries()) {
      live[game] = await Promise.all(bestPerPlayer(liveRows[i]).map(async (e) => ({ player: e.wallet_address, username: (await deps.resolveUsername(e.wallet_address as string)).name || null, score: e.score, gameTime: e.game_time, wagered: e.wagered, timestamp: unix(e.created_at), tx_hash: e.tx_hash })));
    }
    const payload = { currentSeason: current, currentEndsAt: end, live, past: pastOut };
    deps.cache.set('seasons:global', payload, deps.ttlMs);
    return payload;
  }

  return {
    seasons,
    /** drop every kept season, e.g. after an admin edits past data */
    flush: () => { past.clear(); },
    /** for tests and metrics */
    pastSeasonsHeld: () => past.size,
  };
}
