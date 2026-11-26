import type { EnergyStore } from './service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseLike { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any }

/** See supabase-migrations/2026-11-27c_energy.sql. `item` is the shop item that is energy. */
export function supabaseEnergy(db: SupabaseLike, item: number): EnergyStore {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    async take(wallet, day, free) {
      const { data, error } = await db.rpc('energy_take', { w: wallet, d: day, free_plays: free, item });
      return error || !data ? null : { ok: data.ok === true, paid: data.paid === true, used: n(data.used), bought: n(data.bought) };
    },
    async giveBack(wallet, day, paid) { await db.rpc('energy_give_back', { w: wallet, d: day, was_paid: paid, item }); },
    async state(wallet, day) {
      const { data, error } = await db.rpc('energy_state', { w: wallet, d: day, item });
      return error || !data ? null : { used: n(data.used), bought: n(data.bought) };
    },
    async add(wallet, plays) {
      const { data, error } = await db.rpc('energy_add', { w: wallet, item, plays });
      return error ? null : n(data);
    },
  };
}
