// Energy: a number of free ranked runs a day, then bought ones (the server decides;
// see games-backend/src/modules/energy). When a run is refused for lack of it, any
// page calls outOfEnergy() and the one sheet mounted in the layout opens.

export interface EnergyState { on: true; free: number; freeLeft: number; bought: number; left: number; resetsAt: number; packPlays: number }
export const OUT_OF_ENERGY = "ga:out-of-energy";
export function outOfEnergy(state?: EnergyState | null): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OUT_OF_ENERGY, { detail: state ?? null }));
}
/** "6h 12m", "12m", "under a minute" */
export function timeUntil(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.ceil((ms - now) / 60000));
  if (m < 1) return "under a minute";
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
