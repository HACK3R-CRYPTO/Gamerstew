'use server';

import { PrivyClient } from '@privy-io/server-auth';
import { verifyMessage } from 'viem';

// ─── Server-only env vars ────────────────────────────────────────────────────
// BACKEND_URL and INTERNAL_SECRET are NOT prefixed with NEXT_PUBLIC_ on purpose
// — that means they never get bundled into the browser JS. They only exist in
// this Node process, so the games-backend URL and the shared secret never
// appear in a Network request visible to end users.
const BACKEND_URL     = process.env.BACKEND_URL;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

// ─── Privy server-side client ────────────────────────────────────────────────
// Used to verify access tokens that browsers pass in — confirms the caller
// actually logged in via Privy AND that their linked wallet matches the address
// they claim to be submitting for. Blocks "submit a score for someone else".
const privy = new PrivyClient(
  process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!,
);

// ═══ Auth verifiers ══════════════════════════════════════════════════════════

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

// MiniPay users have no Privy JWT — they sign a short message with their
// injected wallet instead. Message format: "GameArena|{game}|{score}|{ts}".
// We check (a) the signature recovers to claimedAddress, (b) timestamp is
// under 5 min old (prevents replay), (c) scheme/game prefix matches.
async function verifyMiniPaySig(
  sig: string,
  message: string,
  claimedAddress: string,
): Promise<boolean> {
  try {
    const parts = message.split('|');
    if (parts.length !== 4 || parts[0] !== 'GameArena') return false;
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

// ═══ Backend proxy with internal secret ══════════════════════════════════════
// Every call to the games-backend goes through this helper so the secret
// header is applied consistently. Never invoke `fetch(BACKEND_URL/...)` without
// using this helper — otherwise you forget the header and get 401s.
async function internalFetch(path: string, body: unknown) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'x-internal-secret': INTERNAL_SECRET!,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

// ═══ Public server actions ═══════════════════════════════════════════════════

export type GameId = 'rhythm' | 'simon';
export type ScoreData = {
  game:     GameId;
  score:    number;
  gameTime: number;
  wagered?: string | null;
  wagerId?: string | null;
  txHash?:  string | null;
  // Rhythm-only skill flags — unlock rhythm_fc / rhythm_ap achievements.
  // Backend trusts the frontend for these since the score itself is already
  // bound on-chain via the EIP-712 voucher (a lying client still needs a
  // matching tx receipt, so it can't FC a score it didn't earn).
  fullCombo?:  boolean;
  allPerfect?: boolean;
};

type SignScoreResult =
  | { success: true;  signature: string; nonce: string; gameType: number }
  | { success: false; error: string };

type SubmitScoreResult =
  | {
      success:         true;
      score:           number;
      rank:            number;
      txHash:          string | null;
      streak:          number;
      xpEarned?:       number;
      xp?:             number;
      level?:          number;
      leveledUp?:      boolean;
      isNewPb?:        boolean;
      prevBest?:       number;
      newAchievements?: { id: string; name: string; icon?: string; desc?: string }[];
    }
  | { success: false; error: string };

// ─── signScore — Privy users ─────────────────────────────────────────────────
// Call BEFORE the on-chain tx. Returns an EIP-712 BackendApproval voucher that
// the player's wallet passes to recordScoreWithBackendSig on GamePass.
export async function signScore(
  accessToken:   string,
  playerAddress: string,
  scoreData:     { game: GameId; score: number },
): Promise<SignScoreResult> {
  if (!await verifyUser(accessToken, playerAddress)) {
    return { success: false, error: 'Unauthorized' };
  }
  try {
    const { ok, data } = await internalFetch('/api/sign-score', {
      playerAddress,
      game:  scoreData.game,
      score: scoreData.score,
    });
    if (!ok) return { success: false, error: data?.error || 'Sign failed' };
    return { success: true, signature: data.signature, nonce: data.nonce, gameType: data.gameType };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}

// ─── signScoreMiniPay — MiniPay users (no Privy JWT) ─────────────────────────
export async function signScoreMiniPay(
  playerAddress:  string,
  walletSig:      string,
  signedMessage:  string,
  scoreData:      { game: GameId; score: number },
): Promise<SignScoreResult> {
  if (!await verifyMiniPaySig(walletSig, signedMessage, playerAddress)) {
    return { success: false, error: 'Unauthorized' };
  }
  try {
    const { ok, data } = await internalFetch('/api/sign-score', {
      playerAddress,
      game:  scoreData.game,
      score: scoreData.score,
    });
    if (!ok) return { success: false, error: data?.error || 'Sign failed' };
    return { success: true, signature: data.signature, nonce: data.nonce, gameType: data.gameType };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}

// ─── submitScore — Privy users ───────────────────────────────────────────────
// Call AFTER the on-chain tx (or instead of it, if the game is off-chain-only).
// Saves the score to Supabase, awards XP, updates missions, unlocks achievements.
// Returns the new rank and any achievement unlocks so the UI can celebrate.
export async function submitScore(
  accessToken:   string,
  playerAddress: string,
  scoreData:     ScoreData,
): Promise<SubmitScoreResult> {
  if (!await verifyUser(accessToken, playerAddress)) {
    return { success: false, error: 'Unauthorized' };
  }

  const { score, gameTime } = scoreData;
  if (score < 0 || score > 1_000_000) return { success: false, error: 'Score out of range' };
  if (gameTime < 5000)                 return { success: false, error: 'Game time too short' };

  try {
    const { ok, data } = await internalFetch('/api/submit-score', { playerAddress, scoreData });
    if (!ok) return { success: false, error: data?.error || 'Submit failed' };
    return {
      success:         true,
      score:           data.score ?? score,
      rank:            data.rank ?? 0,
      txHash:          data.txHash ?? null,
      streak:          data.streak ?? 0,
      xpEarned:        data.xpEarned,
      xp:              data.xp,
      level:           data.level,
      leveledUp:       !!data.leveledUp,
      isNewPb:         !!data.isNewPb,
      prevBest:        typeof data.prevBest === 'number' ? data.prevBest : undefined,
      newAchievements: data.newAchievements || [],
    };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}

// ─── submitScoreMiniPay — MiniPay users ──────────────────────────────────────
export async function submitScoreMiniPay(
  playerAddress:  string,
  walletSig:      string,
  signedMessage:  string,
  scoreData:      ScoreData,
): Promise<SubmitScoreResult> {
  if (!await verifyMiniPaySig(walletSig, signedMessage, playerAddress)) {
    return { success: false, error: 'Unauthorized' };
  }

  const { score, gameTime } = scoreData;
  if (score < 0 || score > 1_000_000) return { success: false, error: 'Score out of range' };
  if (gameTime < 5000)                 return { success: false, error: 'Game time too short' };

  try {
    const { ok, data } = await internalFetch('/api/submit-score', { playerAddress, scoreData });
    if (!ok) return { success: false, error: data?.error || 'Submit failed' };
    return {
      success:         true,
      score:           data.score ?? score,
      rank:            data.rank ?? 0,
      txHash:          data.txHash ?? null,
      streak:          data.streak ?? 0,
      xpEarned:        data.xpEarned,
      xp:              data.xp,
      level:           data.level,
      leveledUp:       !!data.leveledUp,
      isNewPb:         !!data.isNewPb,
      prevBest:        typeof data.prevBest === 'number' ? data.prevBest : undefined,
      newAchievements: data.newAchievements || [],
    };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}
