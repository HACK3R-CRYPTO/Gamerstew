'use server';

// ─── PerkShop gasless purchase ───────────────────────────────────────────────
// Thin bridge to games-backend /api/perks/buy-gasless. Runs on the Next server
// so BACKEND_URL and INTERNAL_SECRET never reach the browser. The player signs
// an EIP-2612 permit for the PerkShop contract; the backend relayer submits
// buyPerkWithPermit and pays the gas — one signature, zero CELO.

const BACKEND_URL     = process.env.BACKEND_URL || 'http://localhost:3005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

export async function buyPerkGasless(
  wallet: string,
  perk: { perkId: number; deadline: string; v: number; r: string; s: string },
): Promise<{ ok?: boolean; txHash?: string; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/perks/buy-gasless`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ wallet, ...perk }),
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { error: 'backend_unreachable' };
  }
}
