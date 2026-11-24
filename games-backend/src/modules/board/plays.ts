// How many games each player played in a window.
//
// There are two records. The subgraph reads the chain; the session ledger
// (`game_sessions`) is this server's own row for every run it scored. Either can
// fall short: the subgraph can stop indexing (it sat 23 days behind in November
// 2026 and nobody could tell, so the weekly challenge showed 0 while people were
// playing), and a ledger write is best effort. So a player's count is the HIGHER
// of the two. A game a player really played is then counted as long as one
// record has it.

export interface PlayCount { username: string | null; count: number }
export type Counts = Map<string, PlayCount>;

/** The slice of supabase-js this needs. */
export interface LedgerDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, v: unknown): { gte(col: string, v: string): { lte(col: string, v: string): { range(a: number, b: number): PromiseLike<{ data: { wallet?: string | null }[] | null; error: unknown }> } } };
    };
  };
}

const PAGE = 1000;

/** Scored runs per wallet from the session ledger. `ok` is false when a read
 *  failed, so the caller does not mistake "could not read" for "nobody played". */
export async function ledgerCounts(db: LedgerDb, startIso: string, endIso: string): Promise<{ counts: Counts; ok: boolean }> {
  const counts: Counts = new Map();
  for (let page = 0; page < 200; page++) {
    const { data, error } = await db.from('game_sessions').select('wallet').eq('used', true).gte('used_at', startIso).lte('used_at', endIso).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { counts, ok: false };
    const rows = data ?? [];
    for (const r of rows) {
      const w = String(r.wallet ?? '').toLowerCase();
      if (!w) continue;
      const cur = counts.get(w) ?? { username: null, count: 0 };
      cur.count += 1;
      counts.set(w, cur);
    }
    if (rows.length < PAGE) break;
  }
  return { counts, ok: true };
}

/** Per wallet, the higher count; a username from whichever record has one. */
export function mergeCounts(a: Counts, b: Counts): Counts {
  const out: Counts = new Map();
  for (const src of [a, b]) for (const [w, v] of src) {
    const key = w.toLowerCase(); const cur = out.get(key);
    out.set(key, { username: cur?.username ?? v.username ?? null, count: Math.max(cur?.count ?? 0, v.count) });
  }
  return out;
}

// the database function when it exists, the row-by-row reader when it does not
async function ledgerOrRpc(db: LedgerDb & Partial<RpcDb>, startIso: string, endIso: string): Promise<{ counts: Counts; ok: boolean }> {
  try {
    if (typeof db.rpc === 'function') { const fast = await rpcCounts(db as RpcDb, startIso, endIso); if (fast.ok) return fast; }
    return await ledgerCounts(db, startIso, endIso);
  } catch {
    return { counts: new Map(), ok: false };
  }
}

/** Counts for a window from both records. Never throws: a record that cannot be
 *  read contributes nothing, and `sources` says which ones answered. */
export async function playCounts(deps: { subgraph: (startUnix: number, endUnix: number) => Promise<Counts>; db: LedgerDb & Partial<RpcDb> }, startUnix: number, endUnix: number): Promise<{ counts: Counts; sources: { subgraph: boolean; ledger: boolean } }> {
  const [sg, ledger] = await Promise.all([
    deps.subgraph(startUnix, endUnix).then((c) => ({ c, ok: true })).catch(() => ({ c: new Map() as Counts, ok: false })),
    ledgerOrRpc(deps.db, new Date(startUnix * 1000).toISOString(), new Date(endUnix * 1000).toISOString()),
  ]);
  return { counts: mergeCounts(sg.c, ledger.counts), sources: { subgraph: sg.ok, ledger: ledger.ok } };
}

// ── Leaderboard rows from the session ledger ────────────────────────────────
export interface LedgerBoardDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, v: unknown): { eq(col: string, v: unknown): { gte(col: string, v: string): { range(a: number, b: number): PromiseLike<{ data: { wallet?: string | null; computed_score?: number | null; used_at?: string | null }[] | null; error: unknown }> } } };
    };
  };
}
export interface LedgerBoardRow { wallet_address: string; score: number; username: string | null; created_at: string; tx_hash: string | null }

/** Each player's best scored run of a game since `sinceSec`, best first. Returns
 *  an empty list if the read fails: the caller merges it with the subgraph. */
export function supabaseLedgerBoard(db: LedgerBoardDb) {
  return async (game: string, sinceSec: number): Promise<LedgerBoardRow[]> => {
    const fn = (db as unknown as Partial<RpcDb>).rpc;
    if (typeof fn === 'function') {
      // the top 200 in one indexed query; nobody pages a board further than that
      const fast = await rpcBoardPage(db as unknown as RpcDb, game, sinceSec, 200, 0).catch(() => null);
      if (fast) return fast.rows;
    }
    const best = new Map<string, LedgerBoardRow>();
    const sinceIso = new Date(sinceSec * 1000).toISOString();
    for (let page = 0; page < 100; page++) {
      const { data, error } = await db.from('game_sessions').select('wallet, computed_score, used_at').eq('used', true).eq('game', game).gte('used_at', sinceIso).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) break;
      const rows = data ?? [];
      for (const r of rows) {
        const w = String(r.wallet ?? '').toLowerCase(); const score = Number(r.computed_score);
        if (!w || r.computed_score == null || !Number.isFinite(score)) continue; // a run with no recorded score is not on the board
        const cur = best.get(w);
        if (!cur || score > cur.score) best.set(w, { wallet_address: w, score, username: null, created_at: String(r.used_at ?? sinceIso), tx_hash: null });
      }
      if (rows.length < PAGE) break;
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  };
}

/** Two boards into one: each player's higher score, best first. */
export function mergeBoards<T extends { wallet_address: string; score: number; username: string | null }>(a: T[], b: T[]): T[] {
  const out = new Map<string, T>();
  for (const row of [...a, ...b]) {
    const key = row.wallet_address.toLowerCase(); const cur = out.get(key);
    if (!cur) out.set(key, row);
    else if (row.score > cur.score) out.set(key, { ...row, username: row.username ?? cur.username });
    else if (!cur.username && row.username) out.set(key, { ...cur, username: row.username });
  }
  return [...out.values()].sort((x, y) => y.score - x.score);
}

// ── The same two reads, done inside the database ────────────────────────────
// supabase-migrations/2026-11-24_new_games_and_fast_boards.sql adds two
// functions that add up in SQL and return only what a page needs. These call
// them. Until that migration has been run the functions do not exist, the call
// reports an error, and the caller falls back to the row-by-row readers above.
// So this is safe to deploy before the migration.
export interface RpcDb { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }

/** One page of a board, with the board's full size. null = function missing or failed. */
export async function rpcBoardPage(db: RpcDb, game: string, sinceSec: number, limit: number, offset: number): Promise<{ rows: LedgerBoardRow[]; total: number } | null> {
  const { data, error } = await db.rpc('board_window', { p_game: game, p_since: new Date(sinceSec * 1000).toISOString(), p_limit: limit, p_offset: offset });
  if (error || !Array.isArray(data)) return null;
  const rows = (data as { wallet: string; best: number; last_at: string; total: number | string }[]).map((r) => ({ wallet_address: String(r.wallet).toLowerCase(), score: Number(r.best), username: null, created_at: String(r.last_at), tx_hash: null }));
  const total = data.length ? Number((data[0] as { total: number | string }).total) : 0;
  return { rows, total };
}

/** Whole-window counts in one call. `ok` false = function missing or failed. */
export async function rpcCounts(db: RpcDb, startIso: string, endIso: string): Promise<{ counts: Counts; ok: boolean }> {
  const { data, error } = await db.rpc('play_counts_window', { p_start: startIso, p_end: endIso });
  if (error || !Array.isArray(data)) return { counts: new Map(), ok: false };
  const counts: Counts = new Map();
  for (const r of data as { wallet: string; plays: number | string }[]) counts.set(String(r.wallet).toLowerCase(), { username: null, count: Number(r.plays) });
  return { counts, ok: true };
}
