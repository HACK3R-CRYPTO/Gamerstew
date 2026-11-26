import type { PotDay, PotStore } from './service';
import type { Entry } from './rules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseLike { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any }

/** The pot's facts, worked out in the database (see supabase-migrations/2026-11-27b_pot.sql). The tables are locked to the server. */
export function supabasePot(db: SupabaseLike, energyItem: number): PotStore {
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    async spend(day) {
      const { data, error } = await db.rpc('pot_spend', { d: day, energy_item: energyItem });
      return error ? null : num(data);
    },
    async entries(day, game) {
      const { data, error } = await db.rpc('pot_entries', { d: day, g: game });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return error ? null : ((data ?? []) as any[]).map((r): Entry => ({ wallet: String(r.wallet).toLowerCase(), score: num(r.score), at: String(r.at) }));
    },
    async closed(day) {
      const { data, error } = await db.from('pot_days').select('*').eq('day', day).maybeSingle();
      if (error || !data) return null;
      return { day: String(data.day).slice(0, 10), game: data.game, spend: num(data.spend), seed: num(data.seed), carried_in: num(data.carried_in), pot: num(data.pot), players: num(data.players), winners: num(data.winners), status: data.status, carried_out: num(data.carried_out) } as PotDay;
    },
    async close(row, payouts) {
      const { data, error } = await db.rpc('pot_close', { row, payouts });
      return !error && data === true;
    },
  };
}
