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
export type GameId = 'rhythm' | 'simon' | 'stack' | 'nepa' | 'ladder' | 'strike' | 'nepa3d';
export type ScoreData = {
  game:     GameId;
  score:    number;
  gameTime: number;
  wagered?: string | null;
  wagerId?: string | null;
  txHash?:  string | null;
  // The run's session ticket. With the chain outbox on, a score is saved before
  // its transaction exists, and this ticket is the proof the server looks up.
  sessionToken?: string | null;
  // Rhythm-only skill flags — unlock rhythm_fc / rhythm_ap achievements.
  // Backend trusts the frontend for these since the score itself is already
  // bound on-chain via the EIP-712 voucher (a lying client still needs a
  // matching tx receipt, so it can't FC a score it didn't earn).
  fullCombo?:  boolean;
  allPerfect?: boolean;
};

type SignScoreResult =
  | {
      // GASLESS path: the backend already submitted the score on-chain. The
      // client does NOTHING on-chain — no wallet prompt, no CELO.
      success:  true;
      gasless:  true;
      // null when the score was QUEUED: checked and stored, transaction to follow
      txHash:   string | null;
      queued?:  boolean;
      gameType: number;
      score?:   number;
    }
  | {
      // LEGACY path: player pays gas. Backend returns an EIP-712 voucher the
      // player submits to recordScoreWithBackendSig.
      success:    true;
      gasless?:   false;
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
// `up: 1` marks a hold-note release (finger lifted); presses omit it. The
// server judges hits from presses and pairs each hold-note press with the
// next same-lane release to credit sustain ticks.
export type RhythmTap = { lane: number; time: number; up?: 1 };
// Stack per-drop log · SHADOW MODE only (see games-backend/ANTICHEAT.md).
// Optional + additive · the server recomputes a shadow score from it but STILL
// signs the client's claimed score. `t` is a coarse timestamp for a future
// humanness check and does NOT feed scoring.
export type StackDrop = { dropIndex: number; level: number; landed: boolean; perfect: boolean; offset: number; t: number };
// Simon shadow-mode payload · SHADOW MODE only (see games-backend/ANTICHEAT.md).
// Optional + additive · the server recomputes a shadow score from the seeded
// pattern + these taps but STILL signs the client's claimed score. `tapLog` is
// the ordered color ids the player tapped across the run; `rounds`/`elapsedMs`
// are informational for the shadow log.
export type SimonShadow = { tapLog: string[]; rounds: number; elapsedMs: number };
// NEPA: Up Light shadow-mode payload · SHADOW MODE only (see ANTICHEAT.md).
// Optional + additive · the server replays `inputLog` against the SEED stored
// on the session row and logs the delta, but STILL signs the client's claimed
// score. `inputLog` is the ordered plug/unplug events; `bankedNaira`/`elapsedMs`
// are informational for the shadow log.
// `gen` is a socket-less power-up action (the generator), so device/socket are
// optional — only plug/unplug/bank carry them.
export type NepaInput = { device?: string; socket?: number; action: 'plug' | 'unplug' | 'bank' | 'gen'; t: number };
export type NepaShadow = { inputLog: NepaInput[]; bankedNaira: number; elapsedMs: number };

type StartGameResult =
  | { success: true;  sessionToken: string; seed?: string }
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
    // `seed` is only returned for seed-driven games (nepa); undefined otherwise.
    return { success: true, sessionToken: data.sessionToken, seed: data.seed };
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
    // `seed` is only returned for seed-driven games (nepa); undefined otherwise.
    return { success: true, sessionToken: data.sessionToken, seed: data.seed };
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
  dropLog?:      StackDrop[],
  simon?:        SimonShadow,
  nepa?:         NepaShadow,
  songId?:       string, // Rhythm Rush: which song was played (older servers ignore it)
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
      songId: songId ?? null,
      // Stack shadow-mode drop log · optional, does not change the signed score.
      dropLog: dropLog ?? null,
      // Simon shadow-mode tap log · optional, does not change the signed score.
      simonTapLog:   simon?.tapLog ?? null,
      simonRounds:   simon?.rounds ?? null,
      simonElapsedMs: simon?.elapsedMs ?? null,
      // NEPA shadow-mode input log · optional, does not change the signed score.
      nepaInputLog:   nepa?.inputLog ?? null,
      nepaBankedNaira: nepa?.bankedNaira ?? null,
      nepaElapsedMs:  nepa?.elapsedMs ?? null,
    });
    if (!ok) return { success: false, error: data?.error || 'Sign failed' };
    if (data.gasless) {
      // Backend already recorded the score on-chain — nothing for the client to do.
      return {
        success:  true,
        gasless:  true,
        txHash:   data.txHash ?? null,
        queued:   !!data.queued,
        gameType: data.gameType,
        score:    typeof data.score === 'number' ? data.score : scoreData.score,
      };
    }
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
  dropLog?:       StackDrop[],
  simon?:         SimonShadow,
  nepa?:          NepaShadow,
  songId?:       string, // Rhythm Rush: which song was played (older servers ignore it)
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
      songId: songId ?? null,
      // Stack shadow-mode drop log · optional, does not change the signed score.
      dropLog: dropLog ?? null,
      // Simon shadow-mode tap log · optional, does not change the signed score.
      simonTapLog:   simon?.tapLog ?? null,
      simonRounds:   simon?.rounds ?? null,
      simonElapsedMs: simon?.elapsedMs ?? null,
      // NEPA shadow-mode input log · optional, does not change the signed score.
      nepaInputLog:   nepa?.inputLog ?? null,
      nepaBankedNaira: nepa?.bankedNaira ?? null,
      nepaElapsedMs:  nepa?.elapsedMs ?? null,
    });
    if (!ok) return { success: false, error: data?.error || 'Sign failed' };
    if (data.gasless) {
      // Backend already recorded the score on-chain — nothing for the client to do.
      return {
        success:  true,
        gasless:  true,
        txHash:   data.txHash ?? null,
        queued:   !!data.queued,
        gameType: data.gameType,
        score:    typeof data.score === 'number' ? data.score : scoreData.score,
      };
    }
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


// ═══ Generic ranked run ══════════════════════════════════════════════════════
// One pair of actions any game can use (see hooks/useRankedRun.ts), in place of
// adding another positional argument to signScore for every new game.
//
// `accessToken` is the Privy token. MiniPay has no Privy session and cannot
// sign messages, so it passes null and is checked by address shape only, the
// same rule the *MiniPay actions above follow.
async function allowed(accessToken: string | null, playerAddress: string): Promise<boolean> {
  if (accessToken) return verifyUser(accessToken, playerAddress);
  return /^0x[a-fA-F0-9]{40}$/.test(playerAddress);
}

export type StartRunResult =
  | { success: true; sessionToken: string; seed?: string; ladders?: [string, string, number][] }
  | { success: false; error: string };

/** Open a run. The reply carries whatever the game needs dealt by the server. */
export async function startRun(accessToken: string | null, playerAddress: string, game: GameId, extra?: Record<string, unknown>): Promise<StartRunResult> {
  if (!await allowed(accessToken, playerAddress)) return { success: false, error: 'Unauthorized' };
  try {
    const { ok, data } = await internalFetch('/api/start-game', { ...(extra ?? {}), wallet: playerAddress, game });
    if (!ok) return { success: false, error: data?.error || 'Failed to start session' };
    return { success: true, sessionToken: data.sessionToken, seed: data.seed, ladders: data.ladders };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}

/** Ask the server to check and approve a run. `proof` is the game's own record
 *  of what the player did (e.g. `{ ladderRuns }`); the server scores from it. */
export async function signRun(
  accessToken: string | null,
  playerAddress: string,
  run: { game: GameId; score: number; sessionToken: string; proof?: Record<string, unknown> },
): Promise<SignScoreResult> {
  if (!await allowed(accessToken, playerAddress)) return { success: false, error: 'Unauthorized' };
  try {
    const { ok, data } = await internalFetch('/api/sign-score', { ...(run.proof ?? {}), playerAddress, game: run.game, score: run.score, sessionToken: run.sessionToken });
    if (!ok) return { success: false, error: data?.reason || data?.error || 'Sign failed' };
    const score = typeof data.score === 'number' ? data.score : run.score;
    if (data.gasless) return { success: true, gasless: true, txHash: data.txHash ?? null, queued: !!data.queued, gameType: data.gameType, score };
    return { success: true, signature: data.signature, nonce: data.nonce, gameType: data.gameType, score };
  } catch {
    return { success: false, error: 'Backend unavailable' };
  }
}

/** Save the finished run to the leaderboard and progression (XP, missions, achievements). */
export async function saveRun(accessToken: string | null, playerAddress: string, scoreData: ScoreData): Promise<SubmitScoreResult> {
  if (accessToken) return submitScore(accessToken, playerAddress, scoreData);
  return submitScoreMiniPay(playerAddress, '', '', scoreData);
}

// ═══ Inbox (notifications) ═══════════════════════════════════════════════════
// Reading and deleting are done FOR a player, so they go through here, where
// the caller is checked, and on to the backend with the internal secret.
export type InboxKind = 'announcement' | 'whats_new' | 'reward' | 'rank' | 'reminder' | 'activity';
export interface InboxItem { id: string; kind: InboxKind; category: string; title: string; body: string | null; url: string | null; sentAt: number; fromGameArena: boolean; read: boolean }
export interface InboxPage { ok: boolean; items: InboxItem[]; unread: number; more: boolean; unavailable?: boolean }

export async function inboxList(accessToken: string | null, address: string, before?: number): Promise<InboxPage> {
  const none: InboxPage = { ok: false, items: [], unread: 0, more: false, unavailable: true };
  if (!await allowed(accessToken, address)) return none;
  try {
    const res = await fetch(`${BACKEND_URL}/api/inbox/${address.toLowerCase()}?limit=30${before ? `&before=${Math.floor(before)}` : ''}`, { headers: { 'x-internal-secret': INTERNAL_SECRET! }, cache: 'no-store' });
    if (!res.ok) return none;
    const d = await res.json();
    return { ok: true, items: d.items ?? [], unread: Number(d.unread ?? 0), more: !!d.more, unavailable: !!d.unavailable };
  } catch {
    return none;
  }
}

/** Only the number for the bell's dot: a few bytes, where the full list is a page of rows. */
export async function inboxUnread(accessToken: string | null, address: string): Promise<number | null> {
  if (!await allowed(accessToken, address)) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/inbox/${address.toLowerCase()}/unread`, { headers: { 'x-internal-secret': INTERNAL_SECRET! }, cache: 'no-store' });
    if (!res.ok) return null;
    const d = await res.json();
    return d.unavailable ? null : Number(d.unread ?? 0);
  } catch {
    return null;
  }
}

async function inboxWrite(accessToken: string | null, address: string, what: 'read' | 'delete', target: { ids: string[] } | { all: true }): Promise<boolean> {
  if (!await allowed(accessToken, address)) return false;
  try {
    const { ok } = await internalFetch(`/api/inbox/${address.toLowerCase()}/${what}`, 'all' in target ? { all: true } : { ids: target.ids.map(Number) });
    return ok;
  } catch {
    return false;
  }
}
export async function inboxMarkRead(accessToken: string | null, address: string, target: { ids: string[] } | { all: true }): Promise<boolean> { return inboxWrite(accessToken, address, 'read', target); }
export async function inboxDelete(accessToken: string | null, address: string, target: { ids: string[] } | { all: true }): Promise<boolean> { return inboxWrite(accessToken, address, 'delete', target); }
