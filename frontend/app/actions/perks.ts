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

// Verify a PerkShop purchase and grant it: Match Pack (#6) → +5 matches,
// save/retry (1/3/5) → +1 stock, cosmetics → nothing (owned on-chain). The
// frontend just passes the buy tx hash.
export async function grantPerk(
  wallet: string,
  txHash: string,
): Promise<{ ok?: boolean; kind?: string; remaining?: number; perkId?: number; balance?: number; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/perks/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ wallet, txHash }),
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { error: 'backend_unreachable' };
  }
}

// Spend one save/retry from a player's stock. Returns the new balance, or
// ok:false when the stock is empty.
export async function consumePerkStock(
  wallet: string,
  perkId: number,
): Promise<{ ok?: boolean; balance?: number; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/perks/use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ wallet, perkId }),
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { error: 'backend_unreachable' };
  }
}

// Read a player's explicit cosmetic equip choices, keyed by perk id. Any
// owned cosmetic missing from this map is treated as equipped (default ON).
export async function getCosmeticEquip(
  wallet: string,
): Promise<{ equipped: Record<number, boolean>; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/cosmetics/equip?wallet=${wallet}`, {
      method: 'GET',
      headers: { 'x-internal-secret': INTERNAL_SECRET ?? '' },
      cache: 'no-store',
    });
    const j = await res.json();
    return { equipped: j.equipped ?? {} };
  } catch {
    return { equipped: {} };
  }
}

// Persist one cosmetic's equipped flag for a wallet so it follows the account.
export async function setCosmeticEquip(
  wallet: string,
  perkId: number,
  equipped: boolean,
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/cosmetics/equip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ wallet, perkId, equipped }),
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { error: 'backend_unreachable' };
  }
}

// Read a player's save/retry stock counts, keyed by perk id.
export async function getPerkInventory(
  wallet: string,
): Promise<{ balances: Record<number, number>; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/perks/inventory?wallet=${wallet}`, {
      method: 'GET',
      headers: { 'x-internal-secret': INTERNAL_SECRET ?? '' },
      cache: 'no-store',
    });
    const j = await res.json();
    return { balances: j.balances ?? {} };
  } catch {
    return { balances: {} };
  }
}
