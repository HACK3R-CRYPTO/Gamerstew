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

export type LadderEntry = { wallet: string; username?: string | null; points: number; matches: number; wins: number; rank: number };
export type LadderData = {
  week: string;
  currentWeek?: string;
  weeks?: string[];
  remainingToday?: number | null;
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
