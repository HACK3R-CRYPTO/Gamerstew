// ─── challengeAi.ts ──────────────────────────────────────────────────────────
// Shared types, opponent personalities, and AI strategies for the Challenge AI
// game mode. RPS for v1 (`/games/challenge-ai/rps`), more variants slot in
// later (coinflip, number-guess, etc.) using the same Opponent shape.
//
// Each opponent is a function that takes the player's move history and returns
// a next move. Strategies are deterministic given the same history + seed so
// the server can replay the match for anti-cheat verification later.

// ─── Move type ───────────────────────────────────────────────────────────────
// 0 = rock, 1 = paper, 2 = scissors. Encoded as numbers so transition arrays
// stay cheap to index into.
export type Move = 0 | 1 | 2;

export const MOVES: Move[] = [0, 1, 2];
export const MOVE_LABEL: Record<Move, string> = { 0: "ROCK", 1: "PAPER", 2: "SCISSORS" };
export const MOVE_EMOJI: Record<Move, string> = { 0: "✊", 1: "✋", 2: "✌️" };

// Standard RPS rules — 1 beats 0, 2 beats 1, 0 beats 2. Returns 1 if a wins,
// -1 if b wins, 0 if tie.
export function rpsOutcome(a: Move, b: Move): -1 | 0 | 1 {
  if (a === b) return 0;
  if ((a + 1) % 3 === b) return -1; // b beats a (b is the counter to a)
  return 1; // a beats b
}

// ─── Match phases ────────────────────────────────────────────────────────────
// IDLE     — between matches, showing summary or pre-game splash
// PICK     — waiting on player to choose a move
// LOCK     — both moves locked, building suspense (1.2-2.0s depending on opp)
// REVEAL   — simultaneous flip of both cards
// RESOLVE  — outcome shown, score/lives update, ~1.2s before next round
// FINISHED — out of lives, final score ready to submit
export type Phase = "IDLE" | "PICK" | "LOCK" | "REVEAL" | "RESOLVE" | "FINISHED";

// ─── Opponent config ─────────────────────────────────────────────────────────
// Each opponent has:
//   id           — stable key for routing / scoring / leaderboard
//   name         — display name (uppercase, like a fighting game roster)
//   tagline      — one-line trash talk shown on the opponent card
//   color        — primary brand color (wall + glow)
//   wall         — dark wall color for the juicy card
//   face         — gradient for the card face
//   glow         — rgba glow color
//   emoji        — single character/emoji that represents the opponent
//   lockMs       — how long the LOCK phase lasts (personality pacing)
//   strategy     — function that picks the AI's move
//   narrative    — pool of trash-talk lines used during play
//   difficulty   — 1 (easiest) to 3 (hardest), for sorting on the hub

export type OpponentId = "gambler" | "mirror" | "oracle";

export type Opponent = {
  id:         OpponentId;
  name:       string;
  tagline:    string;
  color:      string;
  wall:       string;
  face:       string;
  glow:       string;
  emoji:      string;
  lockMs:     number;
  difficulty: 1 | 2 | 3;
  narrative:  string[];
  // History is the player's last N moves (most recent last). Returns 0/1/2.
  strategy:   (history: Move[]) => Move;
};

// ─── AI strategies ───────────────────────────────────────────────────────────

// GAMBLER — pure RNG. The "luck" opponent. Provides a baseline win rate of
// roughly 1/3 (ignoring ties) and warms players up to the mechanic without
// punishing pattern habits.
function gamblerStrategy(): Move {
  return MOVES[Math.floor(Math.random() * 3)];
}

// MIRROR — plays the player's last move. First round defaults to a random
// pick since there's no history yet. Predictable once the player notices,
// so beating MIRROR feels like an "aha" moment rather than a slot machine.
function mirrorStrategy(history: Move[]): Move {
  if (history.length === 0) return MOVES[Math.floor(Math.random() * 3)];
  return history[history.length - 1];
}

// ORACLE — transition-probability prediction. Looks at the player's last few
// moves, finds the most common move that historically followed the player's
// most recent move, predicts the player will play that again, then plays the
// counter. Falls back to random when history is too short to be meaningful.
//
// Mirrors pantheon's `predictFromHistory` shape so the "Challenge AI" feel
// carries over — adaptive opponents are what made that experience real.
function oracleStrategy(history: Move[]): Move {
  if (history.length < 2) {
    // Not enough history to predict yet — bias toward the move that beats the
    // most-common first move (rock). Slightly better than random.
    return 1;
  }
  const last = history[history.length - 1];

  // Build a transition histogram from `last` → next.
  const dist: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i] === last) {
      dist[history[i + 1]]++;
    }
  }

  // If we've seen no transitions yet, fall back to copying the player (MIRROR
  // behavior) since players often repeat after a win.
  if (dist[0] + dist[1] + dist[2] === 0) return last;

  // Pick the most-likely next move the player would play.
  let predicted: Move = 0;
  if (dist[1] > dist[predicted]) predicted = 1;
  if (dist[2] > dist[predicted]) predicted = 2;

  // Play the counter to the predicted move.
  return ((predicted + 1) % 3) as Move;
}

// ─── Opponent roster ─────────────────────────────────────────────────────────
// Order here is the order the hub renders them — easy → hard.

export const OPPONENTS: Opponent[] = [
  {
    id:         "gambler",
    name:       "GAMBLER",
    tagline:    "Luck only. No tricks.",
    color:      "#fbbf24",
    wall:       "#6b4a00",
    face:       "linear-gradient(160deg, #fde047 0%, #ca8a04 50%, #854d0e 100%)",
    glow:       "rgba(251,191,36,0.55)",
    emoji:      "🎲",
    lockMs:     1200,
    difficulty: 1,
    narrative:  [
      "Roll the bones. Best of luck.",
      "No reading, no pattern. Just chance.",
      "Either we tie or one of us walks out lucky.",
      "I don't think. I just pick.",
    ],
    strategy:   gamblerStrategy,
  },
  {
    id:         "mirror",
    name:       "MIRROR",
    tagline:    "I follow. I become.",
    color:      "#67e8f9",
    wall:       "#004a5a",
    face:       "linear-gradient(160deg, #67e8f9 0%, #06b6d4 50%, #0e7490 100%)",
    glow:       "rgba(103,232,249,0.55)",
    emoji:      "🪞",
    lockMs:     1500,
    difficulty: 2,
    narrative:  [
      "Whatever you played, I am.",
      "Your last move tells me my next.",
      "I am your reflection. Beat your own pattern.",
      "Repeat yourself and I will be ready.",
    ],
    strategy:   mirrorStrategy,
  },
  {
    id:         "oracle",
    name:       "ORACLE",
    tagline:    "I have counted your moves. The next is already mine.",
    color:      "#a78bfa",
    wall:       "#4a006b",
    face:       "linear-gradient(160deg, #d8b4fe 0%, #9333ea 50%, #6b21a8 100%)",
    glow:       "rgba(167,139,250,0.65)",
    emoji:      "🔮",
    lockMs:     2000,
    difficulty: 3,
    narrative:  [
      "Your seventh move is decided by your first six.",
      "I have already seen this round end.",
      "The pattern speaks. ORACLE answers in kind.",
      "Predict me and I'll predict you back.",
    ],
    strategy:   oracleStrategy,
  },
];

export function opponentById(id: string): Opponent | undefined {
  return OPPONENTS.find(o => o.id === id);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
// Score = wins × multiplier(streak). Each win in a row bumps the multiplier.
// Mirrors rhythm's combo math (1 + floor(streak / 5)) so the game economy
// reads consistently across all three games.
export function scoreForWin(currentStreak: number): number {
  const multiplier = 1 + Math.floor(currentStreak / 5);
  return 100 * multiplier;
}

// Difficulty bonus — finishing a run vs ORACLE pays more than GAMBLER.
export const OPPONENT_BONUS: Record<OpponentId, number> = {
  gambler: 1.0,
  mirror:  1.5,
  oracle:  2.5,
};

// ─── Round log entry — sent to backend for replay validation ────────────────
// Server will recompute scoreFromLog with the same strategy fn and confirm.
export type RoundLog = {
  t:          number;   // ms since round start
  playerMove: Move;
  aiMove:     Move;
  result:     -1 | 0 | 1; // from player's POV (-1 = AI win, 0 = tie, 1 = player win)
};

// Pick a narrative line for the round. Rotates based on round index so the
// same line doesn't repeat back-to-back.
export function narrativeFor(opp: Opponent, roundIdx: number): string {
  return opp.narrative[roundIdx % opp.narrative.length];
}
