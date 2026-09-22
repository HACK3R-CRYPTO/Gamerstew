// ─── Verified Tug of War — the client/server contract ────────────────────────
// Defined here so the page and the API are written against the same shape.
//
// Note what is NOT in the public payload: identity roots, duplicate flags, and
// anyone else's wallet-level detail. Those are scoring internals — publishing a
// player's identity root would let anyone correlate their linked wallets.

export type Team = "red" | "blue";

export interface TugStandings {
  eventId: string;
  status: "scheduled" | "live" | "ended";
  startsAt: string;
  endsAt: string;
  /** Cumulative, the 7-day state. */
  red: number;
  blue: number;
  /** Today only, resets at 00:00 WAT. A trailing side can still win today. */
  today: { red: number; blue: number; date: string };
  humans: { red: number; blue: number };
  bounty: { slots: number; claimed: number; amountG: number };
  prizeTotalG: number;
  serverTime: string;
}

export interface TugMe {
  wallet: string | null;
  team: Team | null;
  /** Verified AND played enough — the unit the rope actually counts. */
  qualified: boolean;
  /** null when they haven't qualified yet. */
  bountyRank: number | null;
  pullsToday: number;
  dailyPullCap: number;
  pullsTotal: number;
  gamesToQualify: number;
  gamesPlayed: number;
  verified: boolean;
  /** Days until their GoodDollar check lapses; 0 when unknown. */
  verificationDaysLeft: number;
  /** Percentile within their own team — never a global rank. */
  teamPercentile: number | null;
  /** A few rows either side of the player, centred on them.
   *  Never a global 1..N board: "rank 4,112 of 9,000" is a quit trigger, and
   *  Duolingo's leagues work precisely because most people sit in a wide
   *  neutral band rather than at the bottom of one long list. */
  neighbours?: Array<{ rank: number; name: string; pulls: number; isMe?: boolean }>;
}

/** What the player should do next. Exactly one thing, never a list. */
// NOTE: there is no "pick a team" step. Sides are drawn from your GoodDollar
// identity, so one human is always on one side no matter how many wallets they
// hold and nobody can be moved onto a team by someone else. You grow your side
// by RECRUITING — anyone you bring inherits your team.
export type NextAction =
  | { kind: "connect" }
  | { kind: "verify" }
  | { kind: "reverify_soon"; daysLeft: number }
  | { kind: "play"; gamesLeft: number }
  | { kind: "bounty_locked"; rank: number }
  | { kind: "pull_more"; pullsLeft: number }
  | { kind: "recruit" };

export function nextAction(me: TugMe | null): NextAction {
  if (!me?.wallet) return { kind: "connect" };
  if (!me.verified) return { kind: "verify" };
  if (me.verificationDaysLeft > 0 && me.verificationDaysLeft <= 1) {
    return { kind: "reverify_soon", daysLeft: me.verificationDaysLeft };
  }
  if (!me.qualified) {
    return { kind: "play", gamesLeft: Math.max(0, me.gamesToQualify - me.gamesPlayed) };
  }
  if (me.pullsToday < me.dailyPullCap) {
    return { kind: "pull_more", pullsLeft: me.dailyPullCap - me.pullsToday };
  }
  if (me.bountyRank) return { kind: "bounty_locked", rank: me.bountyRank };
  return { kind: "recruit" };
}
