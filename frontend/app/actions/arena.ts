'use server';

// ─── Arena Instant Match server actions ──────────────────────────────────────
// Thin bridge to games-backend /api/arena/*. Runs on the Next server so
// BACKEND_URL and INTERNAL_SECRET never reach the browser — same pattern as
// app/actions/game.ts score vouchers.

const BACKEND_URL     = process.env.BACKEND_URL || 'http://localhost:3005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

type StartResponse = {
  matchId: string;
  commitHash: string;
  bestOf: number;
  winsNeeded: number;
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
