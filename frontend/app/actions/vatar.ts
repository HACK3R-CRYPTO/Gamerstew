'use server';

// ─── Vatar (Lagos Life) purchase claim ───────────────────────────────────────
// Thin bridge to games-backend /api/vatar/claim. Runs on the Next server so
// BACKEND_URL and INTERNAL_SECRET never reach the browser. The browser (the
// Vatar SDK) hands us the player's short-lived session and the purchaseId; the
// backend confirms BOTH with Vatar and delivers the item exactly once. We never
// grant anything from the client alone.

const BACKEND_URL     = process.env.BACKEND_URL || 'http://localhost:3005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

export async function claimVatarPurchase(
  session: string,
  purchaseId: string,
  wallet?: string,
): Promise<{ ok?: boolean; productId?: string; granted?: boolean; error?: string }> {
  if (!session || !purchaseId) return { error: 'session_and_purchaseId_required' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/vatar/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ session, purchaseId, wallet }),
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { error: 'backend_unreachable' };
  }
}

// Provision a Vatar player onto Celo (custodial wallet + GamePass mint). Called
// on embed load. The backend verifies the session itself and mints at most once,
// so this is safe to fire on every load. Returns the player's custodial address
// when provisioned. Spends sponsored gas server-side, hence the internal secret.
export async function ensureVatarOnchain(
  session: string,
): Promise<{ address?: string; minted?: boolean; error?: string }> {
  if (!session) return { error: 'session_required' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/vatar/onchain/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ session }),
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { error: 'backend_unreachable' };
  }
}

// ─── Vatar on-chain scores (Phase 2) ─────────────────────────────────────────
// Record an embed player's skill-game run on the GameArena on-chain leaderboard.
// Identity is the Vatar session (the backend verifies it and resolves the
// player's custodial wallet) — the client never names a wallet. The write is
// gasless (backend-signed), same anti-cheat as signed-in players.

type VatarGame = 'rhythm' | 'simon' | 'stack';

// Request a session ticket BEFORE play. Mirrors startGame() for signed-in
// players; the backend binds the ticket to the player's custodial wallet.
export async function startVatarGame(
  session: string,
  game: VatarGame,
): Promise<{ success: true; sessionToken: string } | { success: false; error: string }> {
  if (!session || !game) return { success: false, error: 'session_and_game_required' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/vatar/start-game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ session, game }),
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok || !data?.success) return { success: false, error: data?.error || 'start_failed' };
    return { success: true, sessionToken: data.sessionToken };
  } catch {
    return { success: false, error: 'backend_unreachable' };
  }
}

// Record the run on-chain AFTER play. For rhythm, pass the tapLog (the backend
// replays it and records the computed score, ignoring any client number).
export async function signVatarScore(
  session: string,
  game: VatarGame,
  score: number,
  sessionToken: string,
  tapLog?: unknown[] | null,
): Promise<{ success: true; txHash: string; score: number } | { success: false; error: string }> {
  if (!session || !sessionToken) return { success: false, error: 'session_required' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/vatar/sign-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ session, game, score, sessionToken, tapLog: tapLog ?? null }),
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok || !data?.success) return { success: false, error: data?.error || 'sign_failed' };
    return { success: true, txHash: data.txHash, score: typeof data.score === 'number' ? data.score : score };
  } catch {
    return { success: false, error: 'backend_unreachable' };
  }
}
