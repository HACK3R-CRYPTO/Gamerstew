// ─── The public boards: leaderboard, names, activity, stats ──────────────────
// Read-only views. On-chain facts (scores, plays, totals) come from the
// subgraph, which is the single source of truth for them. Off-chain facts
// (streaks) come from the database. Nothing here writes anything.
//
// A subgraph outage degrades these to empty lists and zeros, with a warning in
// the log. It never turns a page into an error.

import { mergeBoards } from './plays';
export const BOARD_TTL_MS = 20_000;

export interface BoardRow { wallet_address: string; score: number; username: string | null; created_at: string; tx_hash: string | null; game?: string }
export interface GlobalStat {
  totalPlayers?: unknown; totalScores?: unknown; totalRhythmPlays?: unknown; totalSimonPlays?: unknown;
  totalWageredG?: string | null; totalUbiDonatedG?: string | null; totalTreasuryG?: string | null; totalHabitatUnlocks?: unknown;
}

export interface BoardDeps {
  gameTypes: Record<string, number>;
  currentSeason(): number;
  /** unix seconds */
  seasonBounds(season: number): { start: number; end: number };
  subgraph: {
    leaderboard(gameType: number, seasonStartSec: number, limit?: number): Promise<BoardRow[]>;
    recentActivity(limit: number, player: string | null): Promise<BoardRow[]>;
    globalStats(): Promise<GlobalStat | null>;
    /** wallets that have scored since `sinceSec` (capped by the subgraph page size) */
    seasonPlayerIds(sinceSec: number): Promise<string[]>;
  };
  /** Each player's best run from this server's own session ledger. The subgraph
   *  can stop indexing; with this, a board still shows what was really played. */
  ledgerBoard?(game: string, sinceSec: number): Promise<BoardRow[]>;
  /** shared short-lived cache with one piece of work per key (platform/resultCache) */
  results?: { get<T>(key: string, opts: { ttlMs: number; compute: () => Promise<T> }): Promise<T> };
  /** wallet (lowercase) → play streak, for the wallets given */
  streaks(wallets: string[]): Promise<Map<string, number>>;
  resolveUsername(wallet: string): Promise<string | null | undefined>;
  treasuryBalance(): Promise<string>;
  cache: { get(key: string): unknown; set(key: string, value: unknown, ttlMs: number): void };
  statsTtlMs: number;
  logger?: { warn(m: string, ...e: unknown[]): void };
}

export interface Reply { status: number; body: Record<string, unknown> }
const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body });
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const why = (e: unknown): unknown => (e as { message?: unknown } | null | undefined)?.message || e;
// what parseInt(req.query.x) gave: the first value if repeated, NaN if absent
const int = (v: unknown) => parseInt(String(Array.isArray(v) ? v[0] : v));

export const MAX_PAGE = 50;
export const DEFAULT_PAGE = 20;
export const MAX_USERNAMES = 500;

/** Which slice of the board a request is asking for. Two styles are accepted:
 *  `page` (1-based) or a raw `offset`; an offset wins, and then `page` is null. */
export function paging(query: Record<string, unknown>): { limit: number; offset: number; page: number | null; start: number } {
  // a limit below 1 is not a page: treat it as "not given"
  const asked = int(query.limit);
  const limit = Math.min(MAX_PAGE, asked >= 1 ? asked : DEFAULT_PAGE);
  const offset = Math.max(0, int(query.offset) || 0);
  const page = offset > 0 ? null : Math.max(1, int(query.page) || 1);
  return { limit, offset, page, start: offset > 0 ? offset : ((page ?? 1) - 1) * limit };
}

export function createBoardService(deps: BoardDeps) {
  const logger = deps.logger ?? { warn: (m, ...e) => console.warn(m, ...e) };
  const knownGame = (g: unknown): g is string => typeof g === 'string' && Object.prototype.hasOwnProperty.call(deps.gameTypes, g);

  /** GET /api/leaderboard?game=&limit=&page=|offset= · this season's board for one game */
  async function leaderboard(query: Record<string, unknown>): Promise<Reply> {
    const game = query.game;
    if (!knownGame(game)) return { status: 400, body: { error: 'Unknown game' } };
    const { limit, offset, page, start } = paging(query);

    // `since` (unix seconds) lets a page ask for its own window; default is this season
    const since = int(query.since);
    const seasonStart = since > 0 ? since : deps.seasonBounds(deps.currentSeason()).start;
    // The merged board is worked out at most once every BOARD_TTL_MS per game and
    // window, and everyone who asks in that time shares the one answer. A
    // thousand people opening a board cost one read, not a thousand.
    const build = async (): Promise<BoardRow[]> => {
      let all: BoardRow[] = [];
      try {
        all = await deps.subgraph.leaderboard(deps.gameTypes[game]!, seasonStart); // every player who scored this season
      } catch (e) {
        logger.warn('subgraph leaderboard failed:', why(e));
      }
      if (deps.ledgerBoard) {
        try {
          all = mergeBoards(all, await deps.ledgerBoard(game, seasonStart));
        } catch (e) {
          logger.warn('ledger leaderboard failed:', why(e));
        }
      }
      return all;
    };
    const all = deps.results ? await deps.results.get(`board:${game}:${Math.floor(seasonStart / 60)}`, { ttlMs: BOARD_TTL_MS, compute: build }) : await build();
    const total = all.length;
    const slice = all.slice(start, start + limit);
    // ledger rows carry no name: look up only the ones on this page
    await Promise.all(slice.map(async (e, i) => { if (!e.username) slice[i] = { ...e, username: (await deps.resolveUsername(e.wallet_address).catch(() => null)) || null }; }));

    // one small read for the whole page, not one per row
    const wallets = slice.map((e) => e.wallet_address.toLowerCase());
    const streakOf = wallets.length > 0 ? await deps.streaks(wallets) : new Map<string, number>();

    const rows = slice.map((e) => ({ player: e.wallet_address, score: e.score, timestamp: unix(e.created_at), tx_hash: e.tx_hash, username: e.username, streak: streakOf.get(e.wallet_address.toLowerCase()) || 0 }));
    const listTotal = Math.max(0, total - (offset > 0 ? offset : 0));
    return ok({ leaderboard: rows, total, page, limit, pages: Math.ceil(listTotal / limit) });
  }

  /** GET /api/usernames?wallets=0xa,0xb · on-chain names for up to 500 wallets */
  async function usernames(query: Record<string, unknown>): Promise<Reply> {
    const raw = String(query.wallets || '').trim();
    if (!raw) return ok({ usernames: {} });
    const wallets = [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^0x[a-f0-9]{40}$/.test(s)))].slice(0, MAX_USERNAMES);
    const entries = await Promise.all(wallets.map(async (w) => [w, (await deps.resolveUsername(w).catch(() => null)) || null] as const));
    return ok({ usernames: Object.fromEntries(entries) });
  }

  /** GET /api/activity[?player=0x…] · the last 10 plays, or one player's last 30 */
  async function activity(query: Record<string, unknown>): Promise<Reply> {
    const player = typeof query.player === 'string' ? query.player : null;
    let entries: BoardRow[] = [];
    try {
      entries = await deps.subgraph.recentActivity(player ? 30 : 10, player);
    } catch (e) {
      logger.warn('subgraph activity failed:', why(e));
    }
    return ok({ activity: entries.map((e) => ({ player: e.wallet_address, game: e.game, score: e.score, tx_hash: e.tx_hash, timestamp: unix(e.created_at), username: e.username })) });
  }

  /** GET /api/stats · the headline numbers, cached for a minute */
  async function stats(): Promise<Reply> {
    const cached = deps.cache.get('stats:global');
    if (cached) return ok(cached as Record<string, unknown>);
    const season = deps.currentSeason();
    const { start, end } = deps.seasonBounds(season);

    let g: GlobalStat | null = null;
    try {
      g = await deps.subgraph.globalStats();
    } catch (e) {
      logger.warn('subgraph stats failed:', why(e));
    }
    // G$ has 18 decimals; this keeps two of them without floating-point drift
    const totalWagered = g ? Number(BigInt(g.totalWageredG || '0') / 10n ** 16n) / 100 : 0;

    let seasonUsers = 0;
    try {
      seasonUsers = new Set(await deps.subgraph.seasonPlayerIds(start)).size;
    } catch {
      /* stays 0 */
    }
    const [topR, topS] = await Promise.all([deps.subgraph.leaderboard(0, start, 1).catch(() => [] as BoardRow[]), deps.subgraph.leaderboard(1, start, 1).catch(() => [] as BoardRow[])]);

    let estimatedPrizePot = '0.00';
    try {
      estimatedPrizePot = (parseFloat(await deps.treasuryBalance()) * 0.1).toFixed(2);
    } catch {
      /* stays 0.00 */
    }

    const payload = {
      totalUsers: g ? Number(g.totalPlayers) : 0,
      seasonUsers,
      totalGames: (g ? Number(g.totalScores) : 0) || 0,
      rhythmPlayers: (g ? Number(g.totalRhythmPlays) : 0) || 0,
      simonPlayers: (g ? Number(g.totalSimonPlays) : 0) || 0,
      topRhythm: topR[0]?.score ?? 0,
      topSimon: topS[0]?.score ?? 0,
      totalWagered: totalWagered.toFixed(2),
      currentSeason: season,
      seasonEndsAt: end,
      estimatedPrizePot,
      // raw 18-decimal G$ strings; the frontend formats them
      totalUbiDonatedG: g ? g.totalUbiDonatedG || '0' : '0',
      totalTreasuryG: g ? g.totalTreasuryG || '0' : '0',
      totalHabitatUnlocks: g ? Number(g.totalHabitatUnlocks) : 0,
    };
    deps.cache.set('stats:global', payload, deps.statsTtlMs);
    return ok(payload);
  }

  return { leaderboard, usernames, activity, stats };
}
