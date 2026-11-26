// Energy: a number of free ranked runs a day, then bought ones (the server decides;
// see games-backend/src/modules/energy). When a run is refused for lack of it, any
// page calls outOfEnergy() and the one sheet mounted in the layout opens.

export interface EnergyState { on: true; free: number; freeLeft: number; bought: number; left: number; resetsAt: number; packPlays: number }
export const OUT_OF_ENERGY = "ga:out-of-energy";
/** Fired when a run was opened or a pack bought: anything showing the count reads it again. */
export const ENERGY_CHANGED = "ga:energy-changed";
/** Open the energy sheet as information: how many runs are left, when the free ones come back, and a pack to buy. */
export const OPEN_ENERGY = "ga:energy-open";
export function openEnergy(state?: EnergyState | null): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_ENERGY, { detail: state ?? null }));
}
export function energyChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ENERGY_CHANGED));
}
export function outOfEnergy(state?: EnergyState | null): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OUT_OF_ENERGY, { detail: state ?? null }));
}
/** "6h 12m", "12m", "under a minute" */
export function timeUntil(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.ceil((ms - now) / 60000));
  if (m < 1) return "under a minute";
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
