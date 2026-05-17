// ─── challengeAi.ts ──────────────────────────────────────────────────────────
// Challenge AI = wagered 1v1 matches against MARKOV-1, the platform's ERC-8004
// AI agent (token at NEXT_PUBLIC_AGENT_TOKEN_ID, wallet at
// CONTRACT_ADDRESSES.AI_AGENT, deployed by ARENA_PLATFORM at
// CONTRACT_ADDRESSES.ARENA_PLATFORM on Celo Mainnet).
//
// One AI, two game modes (RPS + Coin Flip), three wager tiers. The wager tier
// controls both the stake size AND the AI's behavioral mode on the backend —
// WARM-UP MARKOV-1 plays loose, STAKED plays adaptive, HIGH ROLLER plays at
// peak strategy.
//
// The contract-level match shape is single-round commit-reveal:
//   1. Player calls transferAndCall on G$ token with encoded propose args
//   2. ARENA_PLATFORM receives, creates MatchProposed, auto-targets AI_AGENT
//   3. AI agent backend listens for MatchProposed events, calls acceptMatch
//      (via transferAndCall on its own G$ balance), then calls playMove
//   4. Player calls playMove with their move
//   5. Contract auto-resolves once both moves are in, transfers prize
//
// Player-First Tie Rule: the contract awards ties to the challenger (player).
// This gives every match a structural ~17% edge in RPS (1/9 tie outcomes go
// to the player) on top of any strategic skill. Keep this in mind when tuning
// AI difficulty — the player has a built-in cushion.

// ─── Move type (game-agnostic numeric id) ───────────────────────────────────
// RPS:        0 = rock, 1 = paper, 2 = scissors
// Coin Flip:  0 = heads, 1 = tails
export type Move = number;

// ─── Game types — match the on-chain enum on ARENA_PLATFORM ────────────────
// 0 = RPS, 1 = Dice, 2 = Strategy, 3 = Coin Flip
// We expose RPS + Coin Flip only in v1. Dice + Strategy were cut because they
// are the same mechanic with different ranges (higher number wins). The
// contract still supports them for future expansion.
export const GAME_TYPE_RPS  = 0 as const;
export const GAME_TYPE_COIN = 3 as const;
export type GameTypeId = typeof GAME_TYPE_RPS | typeof GAME_TYPE_COIN;

export type GameType = {
  id:        GameTypeId;
  slug:      "rps" | "coin";
  label:     string;
  shortName: string;
  // Number of valid moves — used to validate input before sending to chain
  moveCount: number;
  // Move definitions for the UI
  moves:     { id: Move; emoji: string; label: string; hint?: string }[];
  // One-line how-to shown under the title on the hub
  rules:     string;
};

export const GAME_TYPES: GameType[] = [
  {
    id:        GAME_TYPE_RPS,
    slug:      "rps",
    label:     "Rock-Paper-Scissors",
    shortName: "RPS",
    moveCount: 3,
    moves: [
      { id: 0, emoji: "✊", label: "ROCK",     hint: "Crushes scissors" },
      { id: 1, emoji: "✋", label: "PAPER",    hint: "Covers rock"      },
      { id: 2, emoji: "✌️", label: "SCISSORS", hint: "Cuts paper"       },
    ],
    rules: "Pick a move. MARKOV-1 picks too. Ties go to you.",
  },
  {
    id:        GAME_TYPE_COIN,
    slug:      "coin",
    label:     "Coin Flip",
    shortName: "COIN",
    moveCount: 2,
    moves: [
      { id: 0, emoji: "🪙", label: "HEADS" },
      { id: 1, emoji: "🦅", label: "TAILS" },
    ],
    rules: "Call the coin. MARKOV-1 calls too. Ties go to you.",
  },
];

export function gameTypeBySlug(slug: string): GameType | undefined {
  return GAME_TYPES.find(g => g.slug === slug);
}

export function gameTypeById(id: number): GameType | undefined {
  return GAME_TYPES.find(g => g.id === id);
}

// ─── Move-name helper for results banner ────────────────────────────────────
export function moveDisplay(gameType: GameTypeId, move: Move | null | undefined) {
  if (move === null || move === undefined) return { emoji: "?", label: "—" };
  const g = gameTypeById(gameType);
  if (!g) return { emoji: "?", label: "—" };
  const m = g.moves.find(x => x.id === move);
  return m ? { emoji: m.emoji, label: m.label } : { emoji: "?", label: "—" };
}

// ─── Wager tiers ─────────────────────────────────────────────────────────────
// Three fixed amounts. Tier choice is the player's difficulty knob — the AI
// backend reads the wager and adjusts its strategy. From the player's POV,
// the tier signals stakes + intensity:
//   WARM-UP    — 0.1 G$. MARKOV-1 plays half-random. New-player friendly.
//   STAKED     — 1.0 G$. MARKOV-1 plays adaptive (transition-prob counter).
//   HIGH ROLLER — 5.0 G$. MARKOV-1 plays at peak + adds taunts.
// Player-first tie-breaker applies at every tier — your structural edge.
// Wager amounts are stored as decimal strings so parseUnits is the single
// source of truth for 18-decimal conversion (no float drift).

export type WagerTierId = "warmup" | "staked" | "highroller";

export type WagerTier = {
  id:         WagerTierId;
  name:       string;
  amount:     string;       // decimal string, e.g. "0.1"
  amountWei:  bigint;       // pre-computed 18-decimal wei (set below)
  blurb:      string;       // sub-label shown on the tier chip
  agentMode:  string;       // descriptor for the AI's behavior at this tier
  color:      string;
  wall:       string;
  face:       string;
  glow:       string;
};

// Helpers — parseUnits would do this at runtime but the values are static.
// Keep them as bigint literals to avoid a runtime cost per render.
const G_DECIMALS = 18n;
const pow10 = (n: bigint) => 10n ** n;
// 0.1 * 1e18, 1 * 1e18, 5 * 1e18
const WAGER_WARMUP_WEI    = pow10(G_DECIMALS - 1n);                       // 1e17
const WAGER_STAKED_WEI    = pow10(G_DECIMALS);                            // 1e18
const WAGER_HIGHROLLER_WEI = pow10(G_DECIMALS) * 5n;                      // 5e18

export const WAGER_TIERS: WagerTier[] = [
  {
    id:         "warmup",
    name:       "WARM-UP",
    amount:     "0.1",
    amountWei:  WAGER_WARMUP_WEI,
    blurb:      "Easy entry. MARKOV-1 plays loose.",
    agentMode:  "half-random pattern, easy to read",
    color:      "#86efac",
    wall:       "#003a00",
    face:       "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
    glow:       "rgba(34,197,94,0.55)",
  },
  {
    id:         "staked",
    name:       "STAKED",
    amount:     "1",
    amountWei:  WAGER_STAKED_WEI,
    blurb:      "Real stakes. MARKOV-1 adapts.",
    agentMode:  "transition-probability counter from history",
    color:      "#fbbf24",
    wall:       "#7c2d00",
    face:       "linear-gradient(160deg, #fde68a 0%, #f59e0b 50%, #b45309 100%)",
    glow:       "rgba(245,158,11,0.65)",
  },
  {
    id:         "highroller",
    name:       "HIGH ROLLER",
    amount:     "5",
    amountWei:  WAGER_HIGHROLLER_WEI,
    blurb:      "Peak adversary. Player-first ties still apply.",
    agentMode:  "peak prediction + taunts",
    color:      "#a78bfa",
    wall:       "#4a006b",
    face:       "linear-gradient(160deg, #d8b4fe 0%, #9333ea 50%, #6b21a8 100%)",
    glow:       "rgba(167,139,250,0.7)",
  },
];

export function wagerTierById(id: string): WagerTier | undefined {
  return WAGER_TIERS.find(t => t.id === id);
}

// ─── MARKOV-1 — the agent persona ────────────────────────────────────────────
// Single AI opponent. Identity lives on-chain via ERC-8004 registry; the
// frontend just reads its tokenURI to render the badge. Taunts are local UI —
// they don't affect the contract outcome but they make the match feel like
// playing someone, not interacting with a transaction.
export const MARKOV = {
  name:    "MARKOV-1",
  tagline: "Verified AI Agent · ERC-8004",
  emoji:   "🤖",
};

// Taunt line pools keyed by outcome. Picked at random per match. Indexed by
// tier so HIGH ROLLER MARKOV-1 talks more trash and WARM-UP MARKOV-1 stays
// gentle. Empty pool = no taunt (silent tier).
export type Taunt = string;
export type TauntPool = {
  win:  Taunt[];   // AI won
  lose: Taunt[];   // AI lost (player won)
  tie:  Taunt[];   // tie (player wins by rule, but AI can comment)
};

const TAUNTS_BY_TIER: Record<WagerTierId, TauntPool> = {
  warmup: {
    win:  [
      "Lucky read. Try again.",
      "I called it. Don't tilt.",
      "Easy round. Stay sharp.",
    ],
    lose: [
      "Nicely played.",
      "Pattern broken. Respect.",
      "You got me on that one.",
    ],
    tie:  [
      "Tie. The rule favors you.",
      "Mirror move. Player edge.",
    ],
  },
  staked: {
    win:  [
      "I read three moves ahead.",
      "Predictable. Mix it up.",
      "Your history told me everything.",
      "Same move twice. Of course I countered.",
    ],
    lose: [
      "Sharp. The pattern broke.",
      "You varied. I respect.",
      "Won the round. Win the war.",
    ],
    tie:  [
      "Same instinct. Your rule wins.",
      "Aligned minds. The edge is yours.",
    ],
  },
  highroller: {
    win:  [
      "I counted your last six moves. The seventh was already mine.",
      "Higher stakes, sharper read. Try again.",
      "The pattern speaks. MARKOV answers.",
      "You play like the data. The data is mine.",
      "I have already seen this round end.",
    ],
    lose: [
      "You broke the pattern. Take the win.",
      "Outsmarted at peak. Earned.",
      "I bow. Your read was cleaner.",
    ],
    tie:  [
      "Aligned. The player-first rule is yours to keep.",
      "Both minds picked the same. The protocol favors flesh.",
    ],
  },
};

export function tauntFor(
  tier: WagerTierId,
  outcome: "win" | "lose" | "tie",
  rng: () => number = Math.random,
): Taunt {
  const pool = TAUNTS_BY_TIER[tier][outcome];
  if (!pool || pool.length === 0) return "";
  return pool[Math.floor(rng() * pool.length)];
}

// ─── On-chain match status — mirrors ARENA_PLATFORM enum ────────────────────
export const MATCH_STATUS = {
  PROPOSED:  0,
  ACCEPTED:  1,
  COMPLETED: 2,
  CANCELLED: 3,
} as const;
export const MATCH_STATUS_LABEL: Record<number, string> = {
  0: "Proposed",
  1: "Accepted",
  2: "Completed",
  3: "Cancelled",
};

// Match struct as the contract returns it (matches function returns tuple).
// Wagmi will decode this into a typed object for us, this type just makes
// the rest of the codebase typed for it.
export type ArenaMatch = {
  id:         bigint;
  challenger: `0x${string}`;
  opponent:   `0x${string}`;
  wager:      bigint;
  gameType:   number;
  status:     number;
  winner:     `0x${string}`;
  createdAt:  bigint;
};

// ─── UI phase machine for the match page ────────────────────────────────────
// Wraps the on-chain match lifecycle in a UX phase model that drives the
// LOCK + simultaneous-reveal animation. Each contract status maps to one or
// more UI phases below:
//
//   PROPOSED (chain) → WAITING_OPPONENT (UI: waiting for AI to accept)
//   ACCEPTED (chain) + player hasn't played → PICK (UI: show move buttons)
//   ACCEPTED (chain) + player has played + AI hasn't yet → LOCK (UI: ? + ?)
//   ACCEPTED (chain) + both played → REVEAL (UI: simultaneous flip)
//   COMPLETED (chain) → RESOLVE (UI: outcome screen)
//   CANCELLED (chain) → CANCELLED (UI: refund message)
export type MatchPhase =
  | "WAITING_OPPONENT"
  | "PICK"
  | "LOCK"
  | "REVEAL"
  | "RESOLVE"
  | "CANCELLED";

// Derives the UI phase from on-chain match state + per-player hasPlayed flags.
//
// IMPORTANT: REVEAL is only triggered by `status === COMPLETED` (set by the
// AI agent's resolveMatch call). Before that, even if both hasPlayed flags
// are true, we stay in LOCK — because Solidity mappings return 0 by default
// and a `playerMoves` read can briefly return 0 (= ROCK in RPS) before the
// actual move propagates through RPC. Tying the reveal to COMPLETED ensures
// both moves are finalized on-chain before we ever show them.
//
// Phase machine:
//   PROPOSED  → WAITING_OPPONENT
//   ACCEPTED + !playerHasPlayed → PICK
//   ACCEPTED + playerHasPlayed   → LOCK   (stays here even if AI has played;
//                                          only flips when COMPLETED fires)
//   COMPLETED + recentlyResolved → REVEAL (suspense hold from page component)
//   COMPLETED + !recentlyResolved → RESOLVE
//   CANCELLED → CANCELLED
export function derivePhase(
  status:   number,
  playerHasPlayed: boolean,
  _aiHasPlayed:    boolean, // unused — kept in signature for clarity / future
  recentlyResolved?: boolean,
): MatchPhase {
  if (status === MATCH_STATUS.CANCELLED) return "CANCELLED";
  if (status === MATCH_STATUS.PROPOSED)  return "WAITING_OPPONENT";

  if (status === MATCH_STATUS.COMPLETED) {
    // Page component holds `recentlyResolved` true for ~1.5-2s after the
    // status flips, giving the simultaneous reveal animation its dramatic
    // beat before the outcome panel takes over.
    if (recentlyResolved) return "REVEAL";
    return "RESOLVE";
  }

  // ACCEPTED. Either the player still needs to move, or they've moved and
  // we're waiting for the agent to play + resolve.
  if (!playerHasPlayed) return "PICK";
  return "LOCK";
}
