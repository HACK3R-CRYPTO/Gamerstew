// The real database and subgraph, behind the board ports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseLike { from(table: string): any }

/** The latest saved runs, newest first: everyone's, or one player's. Named
 *  columns and a hard row limit, because this feeds the home screen.
 *  `ok` false = the read failed (the caller falls back to the subgraph). */
export function supabaseRecentPlays(db: SupabaseLike) {
  return async (limit: number, player: string | null): Promise<{ ok: boolean; rows: { wallet_address: string; game: string; score: number; tx_hash: string | null; created_at: string; username: null }[] }> => {
    let q = db.from('activity').select('wallet_address, game, score, tx_hash, created_at');
    if (player) q = q.eq('wallet_address', player.toLowerCase());
    const { data, error } = await q.order('created_at', { ascending: false }).limit(Math.max(1, Math.min(50, limit)));
    if (error || !Array.isArray(data)) return { ok: false, rows: [] };
    return { ok: true, rows: (data as { wallet_address: string; game: string; score: number; tx_hash: string | null; created_at: string }[]).map((r) => ({ wallet_address: String(r.wallet_address).toLowerCase(), game: r.game, score: Number(r.score), tx_hash: r.tx_hash ?? null, created_at: r.created_at, username: null })) };
  };
}

/** Two counts from our own tables, asked as counts (no rows are sent back):
 *  how many players there are, and how many runs were saved after a moment. */
export function supabaseOwnTotals(db: SupabaseLike) {
  return {
    async players(): Promise<number | null> {
      const { count, error } = await db.from('users').select('wallet_address', { count: 'exact', head: true });
      return error || typeof count !== 'number' ? null : count;
    },
    async runsSince(sinceIso: string): Promise<number | null> {
      const { count, error } = await db.from('activity').select('id', { count: 'exact', head: true }).gt('created_at', sinceIso);
      return error || typeof count !== 'number' ? null : count;
    },
  };
}

/** Play streaks for a page of wallets, in one read. */
export function supabaseStreaks(db: SupabaseLike) {
  return async (wallets: string[]): Promise<Map<string, number>> => {
    const { data } = await db.from('users').select('wallet_address, play_streak').in('wallet_address', wallets);
    return new Map(((data || []) as { wallet_address: string; play_streak: number | null }[]).map((r) => [r.wallet_address.toLowerCase(), r.play_streak || 0]));
  };
}

/** Wallets with a score since `sinceSec`, from the subgraph (first 500 score rows). */
export function subgraphSeasonPlayers(gql: (query: string, vars: Record<string, unknown>) => Promise<{ scores?: { player: { id: string } }[] }>) {
  return async (sinceSec: number): Promise<string[]> => {
    const data = await gql(
      `query SU($s: BigInt!) {
        scores(first: 500, where: { blockTimestamp_gte: $s }) { player { id } }
      }`,
      { s: sinceSec.toString() },
    );
    return (data.scores || []).map((r) => r.player.id);
  };
}
