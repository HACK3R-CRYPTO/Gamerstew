// The real database, behind the seasons ports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseLike { from(table: string): any }
import type { ActivityRow, SeasonRow } from './service';

/** The 500 best activity rows for a game in a window. `toIso` null means "until now".
 *  supabase-js never throws: a timeout or a 5xx comes back as { data: null, error }.
 *  That is reported as `ok: false`, because "the read failed" and "nobody played"
 *  must never be confused by anything that remembers the answer. */
export function supabaseTopActivity(db: SupabaseLike) {
  return async (game: string, fromIso: string, toIso: string | null): Promise<{ rows: ActivityRow[]; ok: boolean }> => {
    // named columns, not the whole row: this is read for every game on every seasons call
    let q = db.from('activity').select('wallet_address, score, game_time, wagered, created_at, tx_hash').eq('game', game).gte('created_at', fromIso);
    if (toIso) q = q.lt('created_at', toIso);
    const { data, error } = await q.order('score', { ascending: false }).limit(500);
    return { rows: (data || []) as ActivityRow[], ok: !error && Array.isArray(data) };
  };
}

export function supabaseSealedSeasons(db: SupabaseLike) {
  return async (): Promise<SeasonRow[]> => {
    const { data } = await db.from('seasons').select('*').eq('sealed', true).order('season_number', { ascending: false });
    return (data || []) as SeasonRow[];
  };
}
