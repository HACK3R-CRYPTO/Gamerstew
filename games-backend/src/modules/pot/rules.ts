// The daily pot: the rules, with no I/O.
//
// One game a day carries a pot. The pot is a share of what players spent on
// energy that day, plus a seed, plus whatever an unpaid day rolled forward.
// When the day ends, the top third of players split it by rank.
//
// The split of every G$ spent on energy (the owner's decision, 2026-11-27):
//   70% to that day's pot   20% to the treasury   10% to the GoodDollar UBI pool
// Only the 70% is worked out here. The other two happen on the chain, inside
// the shop contract, which pays the UBI pool its share at the moment of sale.
//
// Days are UTC days, written YYYY-MM-DD.

export const DAY_MS = 86_400_000;
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const dayStart = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);
export const dayBefore = (day: string): string => dayOf(dayStart(day) - DAY_MS);

/** The game that carries the pot on a day. It turns through the list in order, so every day is a different contest. */
export function gameOfDay(day: string, games: string[]): string | null {
  if (!games.length) return null;
  const i = Math.floor(dayStart(day) / DAY_MS) % games.length;
  return games[(i + games.length) % games.length]!;
}

/** The size of a day's pot, in whole G$. `shareBps` is the pot's share of energy spend in hundredths of a percent. */
export function potSize(p: { spend: number; seed: number; carried: number; shareBps: number }): number {
  const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return Math.floor(clean(p.seed) + clean(p.carried) + (clean(p.spend) * Math.max(0, Math.min(10_000, p.shareBps))) / 10_000);
}

export interface Entry { wallet: string; score: number; at: string }
export interface Paid { wallet: string; rank: number; score: number; amount: number }
export type Settlement = { status: 'paid'; paid: Paid[]; carry: 0; players: number } | { status: 'rolled'; paid: []; carry: number; players: number; why: 'no_pot' | 'too_few_players' };

/** One line per player, best first. A tie goes to whoever got there first. */
export function rank(entries: Entry[]): Entry[] {
  const best = new Map<string, Entry>();
  for (const e of entries) {
    const w = String(e.wallet).toLowerCase(); const cur = best.get(w);
    if (!Number.isFinite(e.score) || e.score <= 0) continue;
    if (!cur || e.score > cur.score || (e.score === cur.score && e.at < cur.at)) best.set(w, { wallet: w, score: e.score, at: e.at });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || (a.wallet < b.wallet ? -1 : 1));
}

/** How many of `players` are paid: the top third, and never nobody. */
export const winnersOf = (players: number): number => (players <= 0 ? 0 : Math.max(1, Math.ceil(players / 3)));

/** Split a pot among `winners` places by rank: first gets `winners` parts, last gets one. Whole G$, and they add up to the pot exactly. */
export function shares(pot: number, winners: number): number[] {
  if (winners <= 0 || pot <= 0) return [];
  const parts = (winners * (winners + 1)) / 2;
  const out = Array.from({ length: winners }, (_, i) => Math.floor((pot * (winners - i)) / parts));
  out[0]! += pot - out.reduce((a, b) => a + b, 0); // what rounding left over goes to first place
  return out;
}

/** Close a day. Too few players, or nothing in the pot, and it rolls into tomorrow's instead. */
export function settle(p: { pot: number; entries: Entry[]; minPlayers: number }): Settlement {
  const ranked = rank(p.entries); const players = ranked.length;
  if (p.pot <= 0) return { status: 'rolled', paid: [], carry: 0, players, why: 'no_pot' };
  if (players < Math.max(1, p.minPlayers)) return { status: 'rolled', paid: [], carry: p.pot, players, why: 'too_few_players' };
  const amounts = shares(p.pot, winnersOf(players));
  const paid = amounts.map((amount, i) => ({ wallet: ranked[i]!.wallet, rank: i + 1, score: ranked[i]!.score, amount })).filter((x) => x.amount > 0);
  return { status: 'paid', paid, carry: 0, players };
}

export const ordinal = (n: number): string => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };
