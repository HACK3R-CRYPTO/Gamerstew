"use client";

// Season 1 referral persistence — captures `?ref=<wallet>` from any
// inbound URL and stashes it in localStorage so it survives the
// connect → mint → verify → leaderboard redirect chain. The previous
// flow lost the ref the moment a new user got bounced to /connect.
//
// The server-side intent table is still the source of truth post-mint.
// This client-side cache is just the bridge from "they clicked a link"
// to "they finished minting" — once /api/season/intent writes, we
// clear the cache so the table is the only state that matters.

const KEY = "season1_pending_referrer";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Reads `?ref=` from the current URL and writes it to localStorage if
// it parses as a 0x wallet. Idempotent — repeated calls on the same
// page reload the same value. Returns the wallet (or null) so a caller
// can branch in the same render.
export function captureReferralFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URL(window.location.href).searchParams.get("ref")?.toLowerCase().trim() ?? null;
  if (!raw) return null;
  if (!/^0x[a-f0-9]{40}$/.test(raw)) return null;
  try {
    localStorage.setItem(KEY, JSON.stringify({ wallet: raw, at: Date.now() }));
  } catch { /* private mode / quota — accept that this user misses persistence */ }
  return raw;
}

// Returns the cached referrer if still fresh; null if missing, expired,
// or unparseable. Expired entries are removed in-place.
export function readPendingReferral(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return null;
    const parsed = JSON.parse(v) as { wallet?: string; at?: number };
    if (!parsed.wallet || !parsed.at) return null;
    if (Date.now() - parsed.at > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed.wallet;
  } catch {
    return null;
  }
}

// Called from /mint after a successful intent write so the cache stops
// shadowing the server-side truth. Safe to call when nothing is cached.
export function clearPendingReferral(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY); } catch { /* ignored */ }
}
