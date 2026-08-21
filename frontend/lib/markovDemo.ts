"use client";

// ─── MARKOV demo engine · client-side, guests only ───────────────────────────
// A faithful port of the server arena engine (games-backend/lib/arenaMatch.js)
// so a guest can meet MARKOV without an account and WITHOUT touching an API.
//
// WHY THIS EXISTS
// The ranked arena is an HTTP endpoint, and any endpoint that accepts a wallet
// address is farmable. That is not theoretical: 11 throwaway wallets appeared
// inside a 107-second window and each burned exactly the 10/day free cap. A
// per-wallet cap cannot stop one operator with N wallets. Guests now play
// entirely in the browser: no endpoint, no database row, no server cost, and
// nothing to farm. Signing in switches the page to the real server engine
// (provable, ranked, GamePass-gated).
//
// HONESTY (read before touching the UI)
// This runs the same commit-reveal mechanic as the server, but client-side it
// proves NOTHING · the browser plays both sides, so a commit it generates
// itself is not evidence of anything. Demo matches must be labelled as a demo
// and must NEVER be presented as provably fair. The verifiable MARKOV lives
// behind sign-in. That asymmetry is a feature: it is a reason to sign in.
//
// SOURCE OF TRUTH
// games-backend/lib/arenaMatch.js. The model below mirrors its OpponentModel
// exactly (markov2 → markov1 → histogram → cold-start bias, 70% model / 30%
// random). If the server model changes, change this in lockstep or the demo
// stops feeling like the real MARKOV.

import { keccak256, encodePacked } from "viem";
import type { RoundResult } from "@/app/actions/arena";

const MOVES = ["rock", "paper", "scissors"] as const;
const COUNTER: Record<number, number> = { 0: 1, 1: 2, 2: 0 }; // what beats X
const BEST_OF = 5;
const WINS_NEEDED = Math.ceil(BEST_OF / 2); // 3
const MARKOV_PCT = 0.7;                     // 70% model, 30% random · same mix as the agent

/** How many free matches a guest gets before we ask them to sign in. */
export const DEMO_MATCH_LIMIT = 3;
const DEMO_PLAYED_KEY = "gamearena:markov:demoPlayed";

// ─── Seeded PRNG · mirror of the server makeRand ─────────────────────────────
function makeRand(seed: `0x${string}`, matchId: string) {
  let counter = 0n;
  return () => {
    const h = keccak256(
      encodePacked(["bytes32", "string", "uint256"], [seed, matchId, counter++]),
    );
    return parseInt(h.slice(2, 10), 16) / 0x100000000; // first 4 bytes → [0,1)
  };
}

function randomHex(bytes: number): `0x${string}` {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return ("0x" + Array.from(a, b => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

type Prediction = { move: number; confidence: number; source: string };

// ─── Opponent model · port of the server OpponentModel (RPS only) ────────────
class OpponentModel {
  private hist = [0, 0, 0];
  private m1: Record<string, number[]> = {};
  private m2: Record<string, number[]> = {};
  private moves: number[] = [];

  observe(move: number) {
    const n = this.moves.length;
    if (n >= 1) {
      const k1 = String(this.moves[n - 1]);
      this.m1[k1] = this.m1[k1] || [0, 0, 0];
      this.m1[k1][move]++;
    }
    if (n >= 2) {
      const k2 = `${this.moves[n - 2]},${this.moves[n - 1]}`;
      this.m2[k2] = this.m2[k2] || [0, 0, 0];
      this.m2[k2][move]++;
    }
    this.hist[move]++;
    this.moves.push(move);
    if (this.moves.length > 500) this.moves = this.moves.slice(-250);
  }

  predictNext(): Prediction | null {
    const n = this.moves.length;
    if (n >= 2) {
      const row = this.m2[`${this.moves[n - 2]},${this.moves[n - 1]}`];
      const total = row ? row[0] + row[1] + row[2] : 0;
      if (total >= 3) {
        const best = row.indexOf(Math.max(...row));
        return { move: best, confidence: row[best] / total, source: "markov2" };
      }
    }
    if (n >= 1) {
      const row = this.m1[String(this.moves[n - 1])];
      const total = row ? row[0] + row[1] + row[2] : 0;
      if (total >= 2) {
        const best = row.indexOf(Math.max(...row));
        return { move: best, confidence: row[best] / total, source: "markov1" };
      }
    }
    const totalHist = this.hist[0] + this.hist[1] + this.hist[2];
    if (totalHist >= 3) {
      const best = this.hist.indexOf(Math.max(...this.hist));
      return { move: best, confidence: this.hist[best] / totalHist, source: "histogram" };
    }
    return null;
  }

  revealStats() {
    const total = this.hist[0] + this.hist[1] + this.hist[2];
    if (total === 0) return null;
    const favorite = this.hist.indexOf(Math.max(...this.hist));
    let strongest: { key: number | null; next: number | null; pct: number } = { key: null, next: null, pct: 0 };
    for (const [k, row] of Object.entries(this.m1)) {
      const t = row[0] + row[1] + row[2];
      if (t >= 2) {
        const best = row.indexOf(Math.max(...row));
        const pct = row[best] / t;
        if (pct > strongest.pct) strongest = { key: Number(k), next: best, pct };
      }
    }
    return {
      totalObserved: total,
      favoriteMove: MOVES[favorite],
      favoritePct: Math.round((this.hist[favorite] / total) * 100),
      pattern: strongest.key !== null
        ? { after: MOVES[strongest.key], plays: MOVES[strongest.next!], pct: Math.round(strongest.pct * 100) }
        : null,
    };
  }

  decide(rand: () => number): { move: number; mode: string; predicted?: number; source?: string } {
    const modeCoin = rand();
    const prediction = this.predictNext();

    if (modeCoin >= MARKOV_PCT || !prediction) {
      if (!prediction) {
        // Cold start: exploit human opening bias (rock-heavy openings).
        const r = rand();
        return { move: r < 0.45 ? 1 : r < 0.75 ? 2 : 0, mode: "cold_start" };
      }
      return { move: Math.floor(rand() * 3), mode: "random" };
    }

    const counter = COUNTER[prediction.move];
    const metaCounter = COUNTER[counter];
    const r = rand();
    let move: number;
    if (prediction.confidence >= 0.6) {
      move = r < 0.75 ? counter : r < 0.9 ? metaCounter : Math.floor(rand() * 3);
    } else {
      move = r < 0.6 ? counter : r < 0.8 ? metaCounter : Math.floor(rand() * 3);
    }
    return { move, mode: "markov", predicted: prediction.move, source: prediction.source };
  }
}

// ─── Persona lines · same voice as the server ────────────────────────────────
const LINES = {
  roundWin: [
    "read you like a block explorer",
    "that one was already in my mempool",
    "you flinched. i logged it",
    "pattern spotted. pattern punished",
    "i had that move priced in",
  ],
  roundLoss: [
    "ok. that one lands",
    "noise beats signal sometimes",
    "recalibrating. enjoy it while it lasts",
    "fine. one for the humans",
    "lucky branch. pruning it now",
  ],
  roundTie: ["same wavelength. concerning", "mirror match. run it back", "we both saw that coming"],
  matchWin: [
    "gg. your patterns are public knowledge now",
    "match archived. you were predictable in round 2 onward",
    "the ladder remembers who i beat",
  ],
  matchLoss: [
    "you broke my model. respect",
    "unpredictability is a skill. you have it today",
    "this loss goes in my training data. see you in the rematch",
  ],
  calledIt: [
    "CALLED IT. you are a open book",
    "predicted that exact throw. change something",
    "my model saw that coming two rounds ago",
    "that was in the forecast. literally",
  ],
  suddenDeath: [
    "sudden death. my favorite dataset",
    "last round. i priced this in three rounds ago",
    "one round decides it. i already ran the simulation",
    "this is where your pattern betrays you",
  ],
  playerStreak: [
    "two in a row. anomaly. correcting now",
    "hot streak. statistically due for a correction",
    "you found a seam. i am closing it",
    "enjoy the variance. it regresses",
  ],
  markovStreak: [
    "this is just me reading a file now",
    "three straight. you are on rails",
    "i own this match. you are playing my replay",
    "every round you confirm the model",
  ],
  readEscalation: [
    "that is {n} reads. open book, cover torn off",
    "called you {n} times. embarrassing for both of us",
    "{n} for {n}. change literally anything",
    "{n} correct predictions. i am not even trying",
  ],
};
const pickLine = (rand: () => number, arr: string[]) => arr[Math.floor(rand() * arr.length)];
const trailingStreak = (rounds: { result: string }[], result: string) => {
  let n = 0;
  for (let i = rounds.length - 1; i >= 0; i--) { if (rounds[i].result === result) n++; else break; }
  return n;
};

// ─── Demo session ────────────────────────────────────────────────────────────
// The model persists ACROSS the guest's demo matches, exactly like the server
// keeps a per-wallet model. That is the whole point: MARKOV should visibly
// learn you across the 3 matches, which is the hook that earns the sign-in.
const model = new OpponentModel();

type Session = {
  matchId: string;
  seed: `0x${string}`;
  commitHash: `0x${string}`;
  rand: () => number;
  rounds: { playerMove: number; aiMove: number; result: string; mode: string; called?: boolean }[];
  playerWins: number;
  aiWins: number;
  ties: number;
  calledCount: number;
  done: boolean;
};
let session: Session | null = null;

/** Demo matches this guest has already played (persisted so a refresh is not a reset). */
export function demoMatchesPlayed(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.localStorage.getItem(DEMO_PLAYED_KEY) || 0);
}
export function demoMatchesLeft(): number {
  return Math.max(0, DEMO_MATCH_LIMIT - demoMatchesPlayed());
}
function bumpDemoPlayed() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_PLAYED_KEY, String(demoMatchesPlayed() + 1));
}

export type DemoStart = {
  matchId: string;
  commitHash: string;
  bestOf: number;
  winsNeeded: number;
  remainingToday: number;
  demo: true;
  error?: string;
};

/** Start a local demo match. Mirrors startArenaMatch()'s shape. */
export function startDemoMatch(): DemoStart {
  if (demoMatchesLeft() <= 0) {
    return { matchId: "", commitHash: "", bestOf: BEST_OF, winsNeeded: WINS_NEEDED, remainingToday: 0, demo: true, error: "demo_limit" };
  }
  const seed = randomHex(32);
  const matchId = "demo_" + randomHex(8).slice(2);
  session = {
    matchId,
    seed,
    commitHash: keccak256(seed),
    rand: makeRand(seed, matchId),
    rounds: [],
    playerWins: 0,
    aiWins: 0,
    ties: 0,
    calledCount: 0,
    done: false,
  };
  return {
    matchId,
    commitHash: session.commitHash,
    bestOf: BEST_OF,
    winsNeeded: WINS_NEEDED,
    remainingToday: demoMatchesLeft(),
    demo: true,
  };
}

/** Play one round locally. Mirrors throwArenaMove()'s shape. */
export function throwDemoMove(matchId: string, playerMove: number): RoundResult {
  const s = session;
  if (!s || s.matchId !== matchId) return { error: "match_not_found" } as RoundResult;
  if (s.done) return { error: "match_finished" } as RoundResult;
  if (![0, 1, 2].includes(playerMove)) return { error: "invalid_move" } as RoundResult;

  // MARKOV decides BEFORE observing this throw · same ordering as the server,
  // so the model only ever uses history up to the previous round.
  const decision = model.decide(s.rand);
  const aiMove = decision.move;
  const called = decision.mode === "markov" && decision.predicted === playerMove;
  if (called) s.calledCount++;

  model.observe(playerMove);

  let result: "win" | "loss" | "tie";
  if (playerMove === aiMove) { result = "tie"; s.ties++; }
  else if (COUNTER[aiMove] === playerMove) { result = "win"; s.playerWins++; }
  else { result = "loss"; s.aiWins++; }

  s.rounds.push({ playerMove, aiMove, result, mode: decision.mode, called });

  const suddenDeath = s.playerWins === WINS_NEEDED - 1 && s.aiWins === WINS_NEEDED - 1;
  const streak = trailingStreak(s.rounds, result);

  // Situational voice (mirrors backend): big moments get flagged so the client
  // speaks them; ordinary rounds stay generic + text-only.
  let line: string, emphasis = false;
  if (suddenDeath) {
    line = pickLine(s.rand, LINES.suddenDeath); emphasis = true;
  } else if (called && result === "loss") {
    const n = s.calledCount || 0;
    line = n >= 3 ? pickLine(s.rand, LINES.readEscalation).replace(/\{n\}/g, String(n)) : pickLine(s.rand, LINES.calledIt);
    emphasis = true;
  } else if (result === "win" && streak >= 2) {
    line = pickLine(s.rand, LINES.playerStreak); emphasis = true;
  } else if (result === "loss" && streak >= 2) {
    line = pickLine(s.rand, LINES.markovStreak); emphasis = true;
  } else if (result === "win") {
    line = pickLine(s.rand, LINES.roundLoss);
  } else if (result === "loss") {
    line = pickLine(s.rand, LINES.roundWin);
  } else {
    line = pickLine(s.rand, LINES.roundTie);
  }

  const prediction = model.predictNext();
  const readLevel = !prediction
    ? 8
    : Math.min(97, Math.round(prediction.confidence * (prediction.source === "markov2" ? 1 : prediction.source === "markov1" ? 0.8 : 0.55) * 100));

  // Read-aware psych (mirrors backend _mindGame): menace on the decider,
  // certainty on a strong read, bluster when cold. Never a blank round.
  const honest = prediction && s.rand() < 0.55;
  const psychMove = MOVES[honest ? prediction!.move : Math.floor(s.rand() * 3)];
  const mindText = suddenDeath ? `last round. i can see ${psychMove} coming`
    : prediction && prediction.confidence >= 0.6 ? `i can already see ${psychMove}`
    : !prediction ? `no read on you yet. i will say ${psychMove}`
    : `i'm expecting ${psychMove} from you next`;
  const mindGame = { text: mindText };

  const res: RoundResult = {
    round: s.rounds.length,
    playerMove,
    aiMove,
    result,
    called,
    readLevel,
    suddenDeath,
    mindGame,
    score: { player: s.playerWins, ai: s.aiWins, ties: s.ties },
    markovLine: line,
    emphasis,
  };

  const decided = s.playerWins >= WINS_NEEDED || s.aiWins >= WINS_NEEDED;
  if (decided || s.rounds.length >= 9) {
    s.done = true;
    bumpDemoPlayed();
    const outcome = s.playerWins > s.aiWins ? "player_won" : s.aiWins > s.playerWins ? "ai_won" : "tie";
    res.final = {
      outcome,
      seed: s.seed,
      commitHash: s.commitHash,
      rounds: s.rounds,
      calledCount: s.calledCount,
      totalRounds: s.rounds.length,
      matchLine: outcome === "player_won" ? pickLine(s.rand, LINES.matchLoss) : pickLine(s.rand, LINES.matchWin),
      modelReveal: model.revealStats(),
    };
    session = null;
  }
  return res;
}
