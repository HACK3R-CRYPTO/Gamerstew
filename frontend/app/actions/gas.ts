'use server';

import { PrivyClient } from '@privy-io/server-auth';
import { createHash } from 'crypto';
import { headers } from 'next/headers';

// Server-only env. Both never ship to the browser bundle.
const BACKEND_URL     = process.env.BACKEND_URL;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

const privy = new PrivyClient(
  process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!,
);

export type ClaimGasResult =
  | { success: true;  txHash: string; amount: string }
  | { success: false; reason?: string; error?: string };

// ─── claimGas ─────────────────────────────────────────────────────────────────
// Server action that fronts the games-backend faucet. The browser never sees
// INTERNAL_SECRET or BACKEND_URL · this action does. We verify the Privy JWT
// matches the claimed address before forwarding, attach the Privy userId for
// cross-wallet sybil dedup, and hash the caller's IP so the backend can rate-
// limit by network without persisting raw IPs anywhere.
//
// Idempotent · re-calls for the same wallet return { success: false,
// reason: 'already_claimed' } silently. Safe to fire-and-forget from the
// onboarding flow on every sign-in.
export async function claimGas(
  accessToken:   string,
  playerAddress: string,
): Promise<ClaimGasResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(playerAddress)) {
    return { success: false, error: 'Invalid address' };
  }
  if (!accessToken) {
    return { success: false, error: 'Sign in required' };
  }

  // Verify the JWT and pull the Privy userId for cross-wallet dedup.
  let privyUserId: string | null = null;
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    const user   = await privy.getUser(claims.userId);
    const wallet = user.linkedAccounts.find(
      (a: { type: string }) => a.type === 'wallet',
    ) as { type: string; address: string } | undefined;
    if (!wallet) return { success: false, error: 'Unauthorized' };
    if (wallet.address.toLowerCase() !== playerAddress.toLowerCase()) {
      return { success: false, error: 'Unauthorized' };
    }
    privyUserId = claims.userId;
  } catch {
    return { success: false, error: 'Unauthorized' };
  }

  // Hash the request IP so the backend can enforce a per-IP daily cap without
  // either side storing raw IPs. Next.js puts the originating IP in x-forwarded-
  // for; Vercel and most reverse proxies prepend the client IP as the first
  // entry. Fall back to a stable empty hash if no IP is exposed (e.g., dev).
  const hdrs = await headers();
  const forwarded = hdrs.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || hdrs.get('x-real-ip') || '';
  const ipHash = ip
    ? createHash('sha256').update(ip).digest('hex')
    : '';

  try {
    const res = await fetch(`${BACKEND_URL}/api/faucet`, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-internal-secret': INTERNAL_SECRET!,
      },
      body: JSON.stringify({ address: playerAddress, privyUserId, ipHash }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      return { success: false, reason: data?.reason, error: data?.error };
    }
    return { success: true, txHash: data.txHash, amount: data.amount };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}
