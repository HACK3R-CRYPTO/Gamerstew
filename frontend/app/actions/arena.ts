'use server';

// ─── Arena Instant Match server actions ──────────────────────────────────────
// Thin bridge to games-backend /api/arena/*. Runs on the Next server so
// BACKEND_URL and INTERNAL_SECRET never reach the browser — same pattern as
// app/actions/game.ts score vouchers.

const BACKEND_URL     = process.env.BACKEND_URL || 'http://localhost:3005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

export type RefillOffer = {
  sku: string;
  priceGs: number;
  grants: number;
  poolWallet: string;
  gToken: string;
  relayer?: string | null;      // gasless path: permit spender
  permitNonce?: string | null;  // player's current G$ permit nonce
};

type StartResponse = {
  matchId: string;
  commitHash: string;
  bestOf: number;
  winsNeeded: number;
  remainingToday?: number | null;
  refill?: RefillOffer;    // present when error === 'daily_limit'
  error?: string;
};

export type RoundResult = {
  round: number;
  playerMove: number;
  aiMove: number;
  result: 'win' | 'loss' | 'tie';
  called?: boolean;          // MARKOV's model predicted this exact throw
  readLevel?: number;        // 0-100 · how deeply MARKOV has modeled the player
  suddenDeath?: boolean;     // next round decides the match (2-2)
  mindGame?: { text: string } | null; // MARKOV's pre-round psych-out for the next round
  score: { player: number; ai: number; ties: number };
  markovLine: string;
  emphasis?: boolean;        // this round's line is a big moment · client voices it
  final?: {
    outcome: 'player_won' | 'ai_won' | 'tie';
    seed: string;
    commitHash: string;
    rounds: { playerMove: number; aiMove: number; result: string; mode: string; called?: boolean }[];
    calledCount?: number;
    totalRounds?: number;
    matchLine: string;
    modelReveal: {
      totalObserved: number;
      favoriteMove: string;
      favoritePct: number;
      pattern: { after: string; plays: string; pct: number } | null;
    } | null;
  };
  error?: string;
};

async function backend(path: string, body: object) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET ?? '',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return res.json();
}

export async function startArenaMatch(playerAddress: string): Promise<StartResponse> {
  try {
    return await backend('/api/arena/start', { playerAddress });
  } catch {
    return { matchId: '', commitHash: '', bestOf: 5, winsNeeded: 3, error: 'backend_unreachable' };
  }
}

// Send a player's deployed agent into an exhibition match against MARKOV. The
// backend starts it and drives it round by round on the live SSE feed; we get
// the matchId back instantly so the UI can open the live view. Auth is the
// internal secret (server-to-server) — the scoped agent key stays with
// GoodAgents.
export async function playAgentMatch(agentAddress: string): Promise<{ matchId?: string; error?: string }> {
  try {
    const out = await backend('/api/arena/agent/play', { agentAddress });
    if (out?.matchId) return { matchId: out.matchId };
    return { error: out?.error || 'could_not_start' };
  } catch {
    return { error: 'backend_unreachable' };
  }
}

// Batch-resolve on-chain GamePass usernames for arbitrary wallets (e.g. the
// owners behind agents on the ladder). Returns a lowercased address → name map;
// unnamed wallets are simply absent.
export async function getUsernames(addresses: string[]): Promise<Record<string, string>> {
  try {
    const list = Array.from(
      new Set(addresses.map((a) => a?.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a || ""))),
    ).slice(0, 500);
    if (list.length === 0) return {};
    const res = await fetch(`${BACKEND_URL}/api/usernames?wallets=${list.join(",")}`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET ?? '' },
      cache: 'no-store',
    });
    const data = await res.json();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data?.usernames || {})) {
      if (v && typeof v === 'string') out[k.toLowerCase()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export type LadderEntry = { wallet: string; username?: string | null; points: number; matches: number; wins: number; rank: number };
export type LadderData = {
  week: string;
  currentWeek?: string;
  weeks?: string[];
  remainingToday?: number | null;
  currentSeason?: number;
  currentEndsAt?: number;    // unix seconds · same boundary as the skill seasons
  currentStartsAt?: number;
  poolGs: number;
  poolBaseGs?: number;
  players: number;
  top: LadderEntry[];
  me: LadderEntry | null;
  error?: string;
};

export async function getArenaLadder(wallet?: string, week?: string): Promise<LadderData> {
  try {
    const params = new URLSearchParams();
    if (wallet) params.set('wallet', wallet);
    if (week) params.set('week', week);
    const q = params.size ? `?${params}` : '';
    const res = await fetch(`${BACKEND_URL}/api/arena/ladder${q}`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET ?? '' },
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { week: '', poolGs: 0, players: 0, top: [], me: null, error: 'backend_unreachable' };
  }
}

// Gasless refill: the player signed an EIP-2612 permit; the backend relays
// permit + transferFrom and pays the gas. Zero CELO needed to buy.
export async function purchaseArenaRefillGasless(
  wallet: string,
  sig: { deadline: string; v: number; r: string; s: string },
): Promise<{ ok?: boolean; remaining?: number; error?: string }> {
  try {
    return await backend('/api/arena/purchase-gasless', { wallet, sku: 'refill_5', ...sig });
  } catch {
    return { error: 'backend_unreachable' };
  }
}

// Verify a G$ refill purchase (player already sent the transfer tx from
// their own wallet) and grant the extra matches.
export async function purchaseArenaRefill(
  wallet: string,
  txHash: string,
): Promise<{ ok?: boolean; remaining?: number; error?: string }> {
  try {
    return await backend('/api/arena/purchase', { wallet, sku: 'refill_5', txHash });
  } catch {
    return { error: 'backend_unreachable' };
  }
}

// On-chain receipt for a finished match. The backend writes the GamePass
// ScoreRecorded tx fire-and-forget after the match ends, so the finish screen
// polls this: { pending: true } until the tx lands, then { txHash }. Best-effort
// — an absent/unwritten receipt just resolves to pending forever, no error.
export async function getArenaMatchReceipt(matchId: string): Promise<{ txHash?: string; pending?: boolean }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/arena/receipt?matchId=${encodeURIComponent(matchId)}`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET ?? '' },
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { pending: true };
  }
}

export async function throwArenaMove(matchId: string, move: number): Promise<RoundResult> {
  try {
    return await backend('/api/arena/throw', { matchId, move });
  } catch {
    return {
      round: 0, playerMove: move, aiMove: 0, result: 'tie',
      score: { player: 0, ai: 0, ties: 0 }, markovLine: '',
      error: 'backend_unreachable',
    };
  }
}
