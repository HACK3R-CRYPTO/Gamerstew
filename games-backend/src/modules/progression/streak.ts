// The daily streak, and the streak freeze: the rules, with no I/O.
//
// A streak grows by one for each UTC day a player plays, and goes back to 1
// when a day is missed. A streak freeze is a shop item a player holds in
// advance. When they come back after a missed day, one freeze is spent for each
// day missed and the streak carries on as if they had played. Nothing is spent
// when it would not be enough, and no more than MAX_COVER days can be covered at
// once, so a freeze protects a slip, not a holiday.

export const FREEZE_ITEM = 11;        // the shop item
export const MAX_COVER = 2;           // most missed days one return can cover
export const MAX_HELD = 2;            // most a player can usefully hold; the shop stops selling past it
const DAY = 86_400_000;

const dayNumber = (day: string): number => Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`) / DAY);
/** Whole days missed between the last day played and today. 0: they played yesterday, or today. */
export function missedDays(lastPlay: string | null | undefined, today: string): number {
  if (!lastPlay) return 0;
  const gap = dayNumber(today) - dayNumber(lastPlay);
  return Number.isFinite(gap) && gap > 1 ? gap - 1 : 0;
}

export type StreakChange = 'first' | 'same' | 'grew' | 'saved' | 'reset';
export interface StreakStep { streak: number; use: number; change: StreakChange }

/** What a play today does to a streak. `use` is how many freezes it spends. */
export function playToday(p: { streak: number; lastPlay: string | null | undefined; today: string; freezes: number }): StreakStep {
  const streak = Math.max(0, Math.floor(p.streak || 0));
  if (!p.lastPlay) return { streak: 1, use: 0, change: 'first' };
  if (p.lastPlay.slice(0, 10) === p.today) return { streak: Math.max(1, streak), use: 0, change: 'same' };
  const missed = missedDays(p.lastPlay, p.today);
  if (missed === 0) return { streak: streak + 1, use: 0, change: 'grew' };
  if (streak > 0 && missed <= MAX_COVER && Math.floor(p.freezes || 0) >= missed) return { streak: streak + 1, use: missed, change: 'saved' };
  return { streak: 1, use: 0, change: 'reset' };
}

/** How a streak stands right now, before any play today: for showing it. */
export function standing(p: { streak: number; lastPlay: string | null | undefined; today: string; freezes: number }): { streak: number; playedToday: boolean; atRisk: boolean; frozen: boolean } {
  const streak = Math.max(0, Math.floor(p.streak || 0));
  const playedToday = !!p.lastPlay && p.lastPlay.slice(0, 10) === p.today;
  if (!p.lastPlay || streak === 0) return { streak: 0, playedToday, atRisk: false, frozen: false };
  const missed = missedDays(p.lastPlay, p.today);
  if (missed === 0) return { streak, playedToday, atRisk: !playedToday, frozen: false };
  // a day (or two) already missed: the streak still stands only if freezes cover it
  const covered = missed <= MAX_COVER && Math.floor(p.freezes || 0) >= missed;
  return { streak: covered ? streak : 0, playedToday: false, atRisk: covered, frozen: covered };
}
