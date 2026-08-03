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

function store(wallet: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ wallet, at: Date.now() }));
  } catch { /* private mode / quota — accept that this user misses persistence */ }
}

// Resolve a referral code (GamePass username or 0x wallet) to a wallet via
// /api/ref/resolve. Returns null when the code matches nobody.
export async function resolveRefCode(code: string): Promise<{ address: string; username: string | null } | null> {
  try {
    const res = await fetch(`/api/ref/resolve?code=${encodeURIComponent(code.trim())}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.address ? { address: data.address, username: data.username ?? null } : null;
  } catch {
    return null;
  }
}

// Reads `?ref=` from the current URL and banks it. Accepts a 0x wallet
// (stored synchronously, as before) OR a username code (resolved via the
// subgraph in the background, then stored). Idempotent. Returns the wallet
// when it was an address; username codes return null here but still land in
// storage once resolved.
export function captureReferralFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URL(window.location.href).searchParams.get("ref")?.trim() ?? null;
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(lower)) {
    store(lower);
    return lower;
  }
  // Username code · resolve fire-and-forget so the sync callers stay sync.
  if (/^[a-zA-Z0-9_]{2,24}$/.test(raw)) {
    void resolveRefCode(raw).then((hit) => { if (hit) store(hit.address); });
  }
  return null;
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
