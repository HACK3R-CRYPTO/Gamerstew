// The daily pot: what it is now, and closing a day.
//
// Nothing here moves money. Closing a day works out who won what and writes each
// prize down as a PENDING payout, in the same ledger the weekly prizes use. The
// owner pays them, as with every prize today. The pot itself is a number worked
// out from what the chain reader recorded, not a balance held anywhere.

import { dayOf, dayStart, dayBefore, gameOfDay, potSize, rank, settle, winnersOf, shares, ordinal, DAY_MS, type Entry, type Paid } from './rules';

export interface PotDay { day: string; game: string; spend: number; seed: number; carried_in: number; pot: number; players: number; winners: number; status: 'paid' | 'rolled'; carried_out: number }
export interface PotStore {
  /** G$ spent on energy on a day (from the purchases the chain reader recorded). null: could not be read */
  spend(day: string): Promise<number | null>;
  /** every verified player's best CONFIRMED score in a game on a day. null: could not be read */
  entries(day: string, game: string): Promise<Entry[] | null>;
  /** a closed day, or null */
  closed(day: string): Promise<PotDay | null>;
  /** write a closed day and its pending payouts, once. false: it was already closed, or could not be saved */
  close(row: PotDay, payouts: { wallet: string; amount: number; reason: string }[]): Promise<boolean>;
}
export interface PotOptions {
  store: PotStore;
  games: string[];
  shareBps: number;
  seed: number;
  minPlayers: number;
  now?: () => number;
  nameOf?: (wallet: string) => Promise<string | null>;
  gameName?: (game: string) => string;
  cacheMs?: number;
}
export interface PotView {
  day: string; game: string | null; pot: number; spend: number; seed: number; carried: number; endsAt: number;
  players: number; paidPlaces: number; firstPrize: number; minPlayers: number;
  top: { rank: number; wallet: string; name: string | null; score: number; prize: number }[];
  you: { rank: number; score: number; prize: number } | null;
  yesterday: { day: string; game: string; pot: number; status: 'paid' | 'rolled'; players: number; winners: number } | null;
}

export function createPot(o: PotOptions) {
  const now = o.now ?? Date.now; const cacheMs = o.cacheMs ?? 30_000;
  const nameOf = o.nameOf ?? (async () => null); const gameName = o.gameName ?? ((g: string) => g);
  type Built = { day: string; at: number; view: Omit<PotView, 'you'>; ranked: Entry[] };
  let cache: Built | null = null;
  let building: Promise<Built> | null = null;

  /** what rolled into `day` from the day before, if that day was closed without paying */
  const carriedInto = async (day: string): Promise<number> => (await o.store.closed(dayBefore(day)).catch(() => null))?.carried_out ?? 0;

  async function build(day: string): Promise<Built> {
    const game = gameOfDay(day, o.games);
    const [spend, entries, carried, prev] = await Promise.all([o.store.spend(day).catch(() => null), game ? o.store.entries(day, game).catch(() => null) : Promise.resolve([] as Entry[]), carriedInto(day), o.store.closed(dayBefore(day)).catch(() => null)]);
    const ranked = rank(entries ?? []);
    const pot = potSize({ spend: spend ?? 0, seed: o.seed, carried, shareBps: o.shareBps });
    const places = ranked.length >= Math.max(1, o.minPlayers) ? winnersOf(ranked.length) : 0;
    const prizes = shares(pot, places);
    const top = await Promise.all(ranked.slice(0, 10).map(async (e, i) => ({ rank: i + 1, wallet: e.wallet, name: await nameOf(e.wallet).catch(() => null), score: e.score, prize: prizes[i] ?? 0 })));
    return {
      day, at: now(), ranked,
      view: {
        day, game, pot, spend: spend ?? 0, seed: o.seed, carried, endsAt: dayStart(day) + DAY_MS,
        players: ranked.length, paidPlaces: places, firstPrize: prizes[0] ?? shares(pot, 1)[0] ?? 0, minPlayers: o.minPlayers, top,
        yesterday: prev ? { day: prev.day, game: prev.game, pot: prev.pot, status: prev.status, players: prev.players, winners: prev.winners } : null,
      },
    };
  }

  return {
    /** Today's pot. Worked out at most once every half minute however many players ask. */
    async today(wallet?: string): Promise<PotView> {
      const day = dayOf(now());
      if (!cache || cache.day !== day || now() - cache.at > cacheMs) {
        building ??= build(day).finally(() => { building = null; });
        cache = await building;
      }
      const c = cache!; const w = String(wallet ?? '').toLowerCase();
      const i = w ? c.ranked.findIndex((e) => e.wallet === w) : -1;
      const prizes = shares(c.view.pot, c.view.paidPlaces);
      return { ...c.view, you: i >= 0 ? { rank: i + 1, score: c.ranked[i]!.score, prize: prizes[i] ?? 0 } : null };
    },

    /** Close every day that has ended and is still open, oldest first, up to `back` days ago. A day is closed once, ever. */
    async settleDue(back = 3): Promise<{ closed: { day: string; status: string; pot: number; winners: number }[] }> {
      const out: { day: string; status: string; pot: number; winners: number }[] = [];
      const today = dayOf(now());
      const days: string[] = []; for (let d = dayBefore(today), k = 0; k < back; k++, d = dayBefore(d)) days.unshift(d);
      for (const day of days) {
        if (await o.store.closed(day).catch(() => null)) continue;
        const game = gameOfDay(day, o.games); if (!game) continue;
        const [spend, entries] = await Promise.all([o.store.spend(day), o.store.entries(day, game)]);
        if (spend === null || entries === null) break; // the facts could not be read: close nothing, and nothing later either (a later day depends on what this one carries)
        const carried = await carriedInto(day);
        const pot = potSize({ spend, seed: o.seed, carried, shareBps: o.shareBps });
        const s = settle({ pot, entries, minPlayers: o.minPlayers });
        const row: PotDay = { day, game, spend, seed: o.seed, carried_in: carried, pot, players: s.players, winners: s.paid.length, status: s.status, carried_out: s.carry };
        const payouts = (s.paid as Paid[]).map((p) => ({ wallet: p.wallet, amount: p.amount, reason: `Daily pot, ${day}, ${gameName(game)}, ${ordinal(p.rank)} of ${s.players}` }));
        if (!(await o.store.close(row, payouts))) break;
        out.push({ day, status: s.status, pot, winners: s.paid.length });
        cache = null;
      }
      return { closed: out };
    },
  };
}
export type Pot = ReturnType<typeof createPot>;
