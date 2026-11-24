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

/** Counts for a window from both records. Never throws: a record that cannot be
 *  read contributes nothing, and `sources` says which ones answered. */
export async function playCounts(deps: { subgraph: (startUnix: number, endUnix: number) => Promise<Counts>; db: LedgerDb }, startUnix: number, endUnix: number): Promise<{ counts: Counts; sources: { subgraph: boolean; ledger: boolean } }> {
  const [sg, ledger] = await Promise.all([
    deps.subgraph(startUnix, endUnix).then((c) => ({ c, ok: true })).catch(() => ({ c: new Map() as Counts, ok: false })),
    ledgerCounts(deps.db, new Date(startUnix * 1000).toISOString(), new Date(endUnix * 1000).toISOString()).catch(() => ({ counts: new Map() as Counts, ok: false })),
  ]);
  return { counts: mergeCounts(sg.c, ledger.counts), sources: { subgraph: sg.ok, ledger: ledger.ok } };
}
