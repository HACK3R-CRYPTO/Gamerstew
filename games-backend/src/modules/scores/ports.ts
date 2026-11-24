// ─── What the score path needs from the outside world ────────────────────────
// The signing service never imports Supabase, ethers or the replay libraries.
// It is handed these small interfaces instead. server.js supplies the real ones;
// tests supply fakes. That is what lets the most important code in the backend
// be tested without a database, a chain or a private key.

import type { SessionRow } from './rules';

export interface SessionStore {
  /** `ok` is the answer. `reason` is only text for the log: it may be empty. */
  create(row: { token: string; wallet: string; game: string; seed?: string }): Promise<{ ok: boolean; reason?: string }>;
  find(token: string): Promise<SessionRow | null>;
  markUsed(token: string, info: { computedScore: number; tapCount: number | null }): Promise<void>;
}

export interface SeasonLedger {
  isEnrolled(wallet: string): Promise<boolean>;
  addGamePoints(row: { wallet: string; points: number; ref: string }): Promise<void>;
}

export interface Chain {
  /** validator key and GamePass contract are both loaded */
  ready(): boolean;
  /** the backend submits the score itself and pays the gas */
  submitScore(player: string, gameType: number, score: number): Promise<{ hash: string }>;
  scoreNonce(player: string): Promise<{ toString(): string }>;
  /** an EIP-712 voucher the player submits and pays for */
  signVoucher(player: string, gameType: number, score: number, nonce: unknown): Promise<string>;
}

export interface GaslessBudget {
  enabled(): boolean;
  check(player: string): { ok: boolean; reason?: string };
  consume(player: string): void;
  /** remember a tx the backend sent, so the save step trusts it without waiting for a mine */
  remember(txHash: string): void;
}

// The replay libraries (lib/*Scoring.js). Only the parts this path reads.
export interface Replay {
  rhythm: {
    physicsCheck(tapLog: unknown[], elapsedMs: number): { ok: boolean; reason?: string };
    isKnownSong(songId: string): boolean;
    computeScore(tapLog: unknown[], elapsedMs: number, songId: string | null): { score: number; hits: unknown[] };
    jitterCheck(hits: unknown[]): { ok: boolean; reason?: string };
  };
  stack: {
    computeScore(dropLog: unknown[]): { score: number; drops: number; perfects: number; maxCombo: number };
    humanness(dropLog: unknown[]): { human: boolean; reasons: string[]; stats: { dropsPerSec?: number } }; // the rate is absent for an empty log
  };
  simon: {
    computeScore(input: { sessionToken: string; tapLog: unknown[]; clientElapsedMs: number }): { score: number; tapsOk: boolean; roundsClaimed: number; roundsVerified: number };
    /** The highest score an honest run with these taps could have, in the time the server saw. */
    verify?(input: { sessionToken: string; tapLog: unknown[]; elapsedMs: number }): { score: number; rounds: number; tapRounds: number; failedAttempts: number; fitsTime: boolean };
  };
  nepa: {
    computeScore(input: { seed: string | null | undefined; inputLog: unknown[] }): { points: number; nairaScore: number; banked: number; wasted: number; maxCombo: number };
    humanness(inputLog: unknown[]): { human: boolean; reasons: string[]; stats: { inputsPerSec?: number } };
  };
}

export interface Logger { log(msg: string): void; warn(msg: string, ...extra: unknown[]): void; error(msg: string, ...extra: unknown[]): void }

export interface ScoreDeps {
  sessions: SessionStore;
  season: SeasonLedger;
  chain: Chain;
  gasless: GaslessBudget;
  replay: Replay;
  /** game name → on-chain game type, e.g. { rhythm: 0, simon: 1 } */
  gameTypes: Record<string, number>;
  /** The chain outbox. When it is on, a checked score is queued and the player
   *  is answered at once; the transaction is sent from the queue. */
  outbox?: { enabled(): boolean; enqueue(row: { sessionToken: string; wallet: string; game: string; gameType: number; score: number }): Promise<{ ok: boolean }> };
  /** Is the server's own score enforced for this game? Off when not given. */
  enforce?: (game: string) => boolean;
  now?: () => number;
  randomHex?: (bytes: number) => string;
  logger?: Logger;
}
