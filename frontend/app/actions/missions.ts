'use server';

import { PrivyClient } from '@privy-io/server-auth';
import { verifyMessage } from 'viem';

// ─── Mission claim server actions ────────────────────────────────────────────
// /api/missions/claim used to be called browser → backend with no identity
// proof — any origin-allowed client could claim XP for any wallet it typed.
// Now the claim runs through these actions: the caller proves control of the
// wallet (Privy access token for embedded/social logins, signed message for
// MiniPay), and only then does the server forward with the internal secret.
//
// Verifiers are intentionally duplicated from actions/game.ts rather than
// exported from it: every export of a 'use server' file becomes a callable
// endpoint, and verifyUser must never be client-invokable on its own.

const BACKEND_URL     = process.env.BACKEND_URL || 'http://localhost:3005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

const privy = new PrivyClient(
  process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!,
);

async function verifyUser(accessToken: string, claimedAddress: string): Promise<boolean> {
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    const user   = await privy.getUser(claims.userId);
    const wallet = user.linkedAccounts.find(
      (a: { type: string }) => a.type === 'wallet',
    ) as { type: string; address: string } | undefined;
    if (!wallet) return false;
    return wallet.address.toLowerCase() === claimedAddress.toLowerCase();
  } catch {
    return false;
  }
}

// MiniPay message format: "GameArena|mission|{missionId}|{ts}". parts[1] is
// pinned to 'mission' so a signed score message can never be replayed here
// (and vice versa — score verification pins its own scheme).
async function verifyMiniPayMissionSig(
  sig: string,
  message: string,
  claimedAddress: string,
  missionId: number,
): Promise<boolean> {
  try {
    const parts = message.split('|');
    if (parts.length !== 4 || parts[0] !== 'GameArena' || parts[1] !== 'mission') return false;
    if (parseInt(parts[2], 10) !== missionId) return false;
    const ts = parseInt(parts[3], 10);
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) return false;
    return await verifyMessage({
      address:   claimedAddress as `0x${string}`,
      message,
      signature: sig as `0x${string}`,
    });
  } catch {
    return false;
  }
}

async function forwardClaim(wallet: string, missionId: number) {
  const res = await fetch(`${BACKEND_URL}/api/missions/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET ?? '',
    },
    body: JSON.stringify({ wallet, missionId }),
    cache: 'no-store',
  });
  return res.json().catch(() => ({}));
}

export async function claimMission(
  accessToken: string,
  wallet: string,
  missionId: number,
): Promise<{ ok?: boolean; error?: string }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { error: 'bad_wallet' };
  if (!(await verifyUser(accessToken, wallet))) return { error: 'auth_failed' };
  await forwardClaim(wallet, missionId);
  return { ok: true };
}

export async function claimMissionMiniPay(
  sig: string,
  message: string,
  wallet: string,
  missionId: number,
): Promise<{ ok?: boolean; error?: string }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { error: 'bad_wallet' };
  if (!(await verifyMiniPayMissionSig(sig, message, wallet, missionId))) return { error: 'auth_failed' };
  await forwardClaim(wallet, missionId);
  return { ok: true };
}
