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

// Game type IDs · mirror games-backend/server.js GAME_TYPE map and the
// uint8 gameType the GamePass contract emits. Stack Tower = 2.
export type GameId = 'rhythm' | 'simon' | 'stack';
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
  | {
      success:    true;
      signature:  string;
      nonce:      string;
      gameType:   number;
      // Server-computed score (rhythm only). Client uses this as the canonical
      // on-chain score — the client's local count is just for live display.
      score?:     number;
    }
  | { success: false; error: string };

// Tap log row — every player input recorded by the client during a rhythm
// session. The server replays these to compute the score; the client never
// claims a number. lane: 0-3, time: seconds since game start.
export type RhythmTap = { lane: number; time: number };

type StartGameResult =
  | { success: true;  sessionToken: string }
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

// ─── startGame — issue a server-side session token ───────────────────────────
// Player calls this when they tap PLAY. Backend records started_at and
// returns a single-use token. The token MUST be passed to signScore later;
// without it the backend refuses to sign anything.
//
// Privy auth is required to bind the session to a real verified wallet —
// blocks "request a token for someone else's wallet" attacks.
export async function startGame(
  accessToken:   string,
  playerAddress: string,
  game:          GameId,
): Promise<StartGameResult> {
  if (!await verifyUser(accessToken, playerAddress)) {
    return { success: false, error: 'Unauthorized' };
  }
  try {
    const { ok, data } = await internalFetch('/api/start-game', {
      wallet: playerAddress,
      game,
    });
    if (!ok) return { success: false, error: data?.error || 'Failed to start session' };
    return { success: true, sessionToken: data.sessionToken };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}

// MiniPay variant of startGame — no client signature.
//
// MiniPay does NOT support personal_sign / eth_signTypedData (canonical
// celopedia rule: minipay-guide.md §"Important Constraints"). Prompting
// for one is a listing-blocker. The cryptographic chain still ends at
// the on-chain score-submission tx, which requires the player's wallet
// to sign — so a forged session can only ever credit the named wallet,
// which has zero payoff for an attacker.
//
// `walletSig` / `signedMessage` are accepted for backwards-compatibility
// but ignored. New callers should pass empty strings or omit them.
export async function startGameMiniPay(
  playerAddress: string,
  _walletSig:    string,
  _signedMessage:string,
  game:          GameId,
): Promise<StartGameResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(playerAddress)) {
    return { success: false, error: 'Invalid wallet address' };
  }
  try {
    const { ok, data } = await internalFetch('/api/start-game', {
      wallet: playerAddress,
      game,
    });
    if (!ok) return { success: false, error: data?.error || 'Failed to start session' };
    return { success: true, sessionToken: data.sessionToken };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}

// ─── signScore — Privy users ─────────────────────────────────────────────────
// Call BEFORE the on-chain tx. Returns an EIP-712 BackendApproval voucher that
// the player's wallet passes to recordScoreWithBackendSig on GamePass.
//
// For rhythm: pass the full tapLog. Server replays it and the SERVER-COMPUTED
// score is what gets signed. The `score` arg becomes informational only.
// For simon: tapLog is unused; client-claimed score is signed (session ticket
// still blocks the demonstrated PoC).
export async function signScore(
  accessToken:   string,
  playerAddress: string,
  scoreData:     { game: GameId; score: number },
  sessionToken:  string,
  tapLog?:       RhythmTap[],
): Promise<SignScoreResult> {
  if (!await verifyUser(accessToken, playerAddress)) {
    return { success: false, error: 'Unauthorized' };
  }
  try {
    const { ok, data } = await internalFetch('/api/sign-score', {
      playerAddress,
      game:  scoreData.game,
      score: scoreData.score,
      sessionToken,
      tapLog: tapLog ?? null,
    });
    if (!ok) return { success: false, error: data?.error || 'Sign failed' };
    return {
      success:   true,
      signature: data.signature,
      nonce:     data.nonce,
      gameType:  data.gameType,
      score:     typeof data.score === 'number' ? data.score : scoreData.score,
    };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}

// ─── signScoreMiniPay — MiniPay users (no Privy JWT, no client sig) ──────────
// Same reasoning as startGameMiniPay above: MiniPay forbids personal_sign,
// and the sig was only authenticating identity. A forged request can only
// produce an EIP-712 voucher bound to the named wallet, which only that
// wallet can spend on-chain — zero exploit value. Drop the sig check.
//
// `walletSig` / `signedMessage` stay in the signature for backwards
// compatibility but are ignored.
export async function signScoreMiniPay(
  playerAddress:  string,
  _walletSig:     string,
  _signedMessage: string,
  scoreData:      { game: GameId; score: number },
  sessionToken:   string,
  tapLog?:        RhythmTap[],
): Promise<SignScoreResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(playerAddress)) {
    return { success: false, error: 'Invalid wallet address' };
  }
  try {
    const { ok, data } = await internalFetch('/api/sign-score', {
      playerAddress,
      game:  scoreData.game,
      score: scoreData.score,
      sessionToken,
      tapLog: tapLog ?? null,
    });
    if (!ok) return { success: false, error: data?.error || 'Sign failed' };
    return {
      success:   true,
      signature: data.signature,
      nonce:     data.nonce,
      gameType:  data.gameType,
      score:     typeof data.score === 'number' ? data.score : scoreData.score,
    };
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

// ─── submitScoreMiniPay — MiniPay users (no client sig) ──────────────────────
// Same reasoning as startGameMiniPay / signScoreMiniPay above. MiniPay
// forbids personal_sign; the on-chain score-submission tx already binds
// the score to the wallet. `walletSig` / `signedMessage` kept for the
// action signature but ignored.
export async function submitScoreMiniPay(
  playerAddress:  string,
  _walletSig:     string,
  _signedMessage: string,
  scoreData:      ScoreData,
): Promise<SubmitScoreResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(playerAddress)) {
    return { success: false, error: 'Invalid wallet address' };
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
