"use client";

// ─── Guest free-play limit · skill games ─────────────────────────────────────
// Guests (not signed in) get a small number of free runs per skill game, then
// we ask them to sign in — the same funnel Challenge AI uses for its demo
// matches (see lib/markovDemo · DEMO_MATCH_LIMIT). Signing in is the gate for
// SAVING; this makes it a soft gate for continued PLAYING once the taste is
// over, so the free runs convert instead of running forever.
//
// Client-side only: the count lives in localStorage. This is a funnel nudge,
// not a security control — a determined guest can clear storage, exactly like
// the Challenge AI demo. Real anti-farming lives behind sign-in + verification.

export const GUEST_PLAY_LIMIT = 3;

const KEY = (game: string) => `gamearena:guestPlayed:${game}`;

/** Free runs this guest has already completed for `game`. */
export function guestPlaysPlayed(game: string): number {
  if (typeof window === "undefined") return 0;
  return Number(window.localStorage.getItem(KEY(game)) || 0);
}

/** Free runs the guest has left for `game` before the sign-in gate. */
export function guestPlaysLeft(game: string): number {
  return Math.max(0, GUEST_PLAY_LIMIT - guestPlaysPlayed(game));
}

/** Count one completed free run. Call once when a guest run finishes. */
export function bumpGuestPlayed(game: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY(game), String(guestPlaysPlayed(game) + 1));
}
