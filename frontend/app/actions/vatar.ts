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
