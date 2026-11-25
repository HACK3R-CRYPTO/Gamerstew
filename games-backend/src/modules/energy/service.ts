// Energy: how many ranked runs a player may start today.
//
// A number of free ones each UTC day, then runs bought in the shop (an energy
// pack is a shop item like any other; the plays it adds do not expire). Taking
// a run is one statement in the database, so two taps cannot both take the last
// one. If the meter itself cannot be read, the player is let in: a broken meter
// must never stop play.

import { dayOf, dayStart, DAY_MS } from '../pot/rules';

export interface EnergyStore {
  /** take one run: a free one if any are left today, else a bought one. null: the meter could not be read */
  take(wallet: string, day: string, free: number): Promise<{ ok: boolean; paid: boolean; used: number; bought: number } | null>;
  /** put one back (the run could not be opened after all) */
  giveBack(wallet: string, day: string, paid: boolean): Promise<void>;
  state(wallet: string, day: string): Promise<{ used: number; bought: number } | null>;
  /** add bought runs; resolves to the new balance */
  add(wallet: string, plays: number): Promise<number | null>;
}
export interface EnergyState { on: true; free: number; freeLeft: number; bought: number; left: number; resetsAt: number; packPlays: number }

export function createEnergy(o: { store: EnergyStore; free: number; packPlays: number; now?: () => number }) {
  const now = o.now ?? Date.now;
  const shape = (used: number, bought: number): EnergyState => {
    const freeLeft = Math.max(0, o.free - Math.max(0, used)); const b = Math.max(0, bought);
    return { on: true, free: o.free, freeLeft, bought: b, left: freeLeft + b, resetsAt: dayStart(dayOf(now())) + DAY_MS, packPlays: o.packPlays };
  };
  const clean = (w: unknown) => (typeof w === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w) ? w.toLowerCase() : null);
  return {
    async state(wallet: unknown): Promise<EnergyState | null> {
      const w = clean(wallet); if (!w) return null;
      const s = await o.store.state(w, dayOf(now())).catch(() => null);
      return s ? shape(s.used, s.bought) : null;
    },
    /** `ok: false` only when the meter was read and it is empty. */
    async take(wallet: unknown): Promise<{ ok: boolean; paid: boolean; day: string; state: EnergyState | null }> {
      const w = clean(wallet); const day = dayOf(now());
      if (!w) return { ok: true, paid: false, day, state: null };
      const t = await o.store.take(w, day, o.free).catch(() => null);
      if (!t) return { ok: true, paid: false, day, state: null };
      return { ok: t.ok, paid: t.paid, day, state: shape(t.used, t.bought) };
    },
    async giveBack(wallet: unknown, taken: { paid: boolean; day: string; state: EnergyState | null }): Promise<void> {
      const w = clean(wallet); if (!w || !taken.state) return;
      await o.store.giveBack(w, taken.day, taken.paid).catch(() => {});
    },
    /** One energy purchase: add a pack. */
    async grant(wallet: unknown): Promise<number | null> {
      const w = clean(wallet); if (!w) return null;
      return o.store.add(w, o.packPlays).catch(() => null);
    },
  };
}
export type Energy = ReturnType<typeof createEnergy>;
