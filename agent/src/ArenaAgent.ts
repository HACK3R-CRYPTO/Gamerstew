import { createPublicClient, createWalletClient, http, parseAbiItem, formatEther, parseEther, parseAbi, encodeAbiParameters, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import * as dotenv from 'dotenv';
import chalk from 'chalk';
import { MoltbookService } from './services/MoltbookService.js';
import { attestMatchCompleted } from './feedbackOracle.js';

dotenv.config();
dotenv.config({ path: '../contracts/.env' });

// Shared Supabase client. Same project as the games-backend on Railway.
// Uses SUPABASE_ANON_KEY to match the existing backend convention. This
// works because RLS is currently disabled on the agent_* tables, so the
// anon role has full access. If RLS is ever enabled, either switch this
// to a SUPABASE_SERVICE_ROLE_KEY env var or add policies that grant the
// anon role insert/update on agent_loss_caps + execute on
// agent_increment_loss.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error(chalk.red("FATAL: SUPABASE_URL and SUPABASE_ANON_KEY must be set."));
    console.log(chalk.yellow("Use the same values the games-backend service already uses on Railway."));
    process.exit(1);
}
const supabase = createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
);

const ARENA_ABI = [
    { type: "event", name: "MatchProposed", inputs: [{ name: "matchId", type: "uint256", indexed: true }, { name: "challenger", type: "address", indexed: true }, { name: "opponent", type: "address", indexed: true }, { name: "wager", type: "uint256", indexed: false }, { name: "gameType", type: "uint8", indexed: false }] },
    { type: "event", name: "MatchAccepted", inputs: [{ name: "matchId", type: "uint256", indexed: true }, { name: "opponent", type: "address", indexed: true }] },
    { type: "event", name: "MovePlayed", inputs: [{ name: "matchId", type: "uint256", indexed: true }, { name: "player", type: "address", indexed: true }, { name: "move", type: "uint8", indexed: false }] },
    { type: "function", name: "acceptMatch", inputs: [{ name: "_matchId", type: "uint256" }], outputs: [], stateMutability: "payable" },
    { type: "function", name: "playMove", inputs: [{ name: "_matchId", type: "uint256" }, { name: "_move", type: "uint8" }], outputs: [], stateMutability: "nonpayable" },
    { type: "function", name: "resolveMatch", inputs: [{ name: "_matchId", type: "uint256" }, { name: "_winner", type: "address" }], outputs: [], stateMutability: "nonpayable" },
    { type: "function", name: "matchCounter", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "matches", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "id", type: "uint256" }, { name: "challenger", type: "address" }, { name: "opponent", type: "address" }, { name: "wager", type: "uint256" }, { name: "gameType", type: "uint8" }, { name: "status", type: "uint8" }, { name: "winner", type: "address" }, { name: "createdAt", type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "hasPlayed", inputs: [{ name: "_matchId", type: "uint256" }, { name: "_player", type: "address" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
    { type: "function", name: "playerMoves", inputs: [{ name: "_matchId", type: "uint256" }, { name: "_player", type: "address" }], outputs: [{ name: "", type: "uint8" }], stateMutability: "view" }
] as const;


const ARENA_ADDRESS = (process.env.VITE_ARENA_PLATFORM_ADDRESS || '0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE') as `0x${string}`;
const USER_ADDRESS = '0xa479b8c6030cBB01f8E9F6AcB2Ad2C757C81894d';
const G_TOKEN_ADDRESS = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' as `0x${string}`;
const REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`; // ERC-8004 on Celo Mainnet

const ERC20_ABI = parseAbi([
    "function transferAndCall(address to, uint256 value, bytes data) external returns (bool)",
    "function transfer(address to, uint256 value) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
]);

if (!process.env.PRIVATE_KEY) {
    console.error(chalk.red("FATAL: PRIVATE_KEY environment variable is not set."));
    console.log(chalk.yellow("On Railway, please add PRIVATE_KEY to your Service variables in the Dashboard."));
    process.exit(1);
}

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);

import { type Chain } from 'viem';

const CELO_MAINNET = {
    id: 42220,
    name: 'Celo Mainnet',
    network: 'celo',
    nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
    rpcUrls: {
        default: { http: [process.env.VITE_RPC_URL || 'https://forno.celo.org'] },
        public: { http: [process.env.VITE_RPC_URL || 'https://forno.celo.org'] },
    },
    contracts: {
        multicall3: {
            address: '0xcA11bde05977b3631167028862bE2a173976CA11' as `0x${string}`,
            blockCreated: 0,
        },
    },
} as const;

const publicClient = createPublicClient({
    chain: CELO_MAINNET,
    transport: http(process.env.VITE_RPC_URL || 'https://forno.celo.org'),
});


const walletClient = createWalletClient({
    account,
    chain: CELO_MAINNET,
    transport: http(process.env.VITE_RPC_URL || 'https://forno.celo.org'),
});


const GAME_NAMES = ['RockPaperScissors', 'DiceRoll', 'UNUSED', 'CoinFlip', 'UNUSED_TicTacToe'];

// AI Logic: Markov Chain for Opponent Modeling
// ─── OpponentModel ──────────────────────────────────────────────────────────
// Sustainable Markov-1 strategy. The goal is NOT to win every match — the
// player-first tie rule + visible 1.9× payout already give the player a strong
// emotional edge. The goal is a tunable house win rate that keeps the contract
// treasury sustainable while still letting good players exploit AI patterns
// occasionally for retention.
//
// Three layers of decision:
//   1. Transition model — per-player count of "after move X, player plays Y."
//      Pure counter against this beats casual / pattern players at ~65%.
//   2. Mixed strategy — 70% counter, 18% meta-counter (the move that beats
//      the counter — defends against players who learn to exploit step 1),
//      12% pure random (entropy floor — caps any exploit at ~50%).
//   3. Cold-start prior — for first-time opponents, use the well-documented
//      RPS opening bias (humans pick rock ~41% on round 1). We weight toward
//      paper to counter that, instead of going pure random.
//
// Expected vs typical casual player: ~55-58% AI win rate on non-tie outcomes.
// Combined with the contract's 5% protocol fee, the treasury grows ~10-15%
// per 100 matches of average wager — sustainable without continuous topping
// up of the agent wallet.

// ─── MoveSeeder ─────────────────────────────────────────────────────────────
// Hash-committed RNG for provably fair play. Lifecycle per match:
//   1. accept time:  commit() generates a 32-byte seed, stores it in memory,
//                    returns the keccak256 hash. That hash is written to
//                    agent_match_state.commit_hash BEFORE the player plays.
//   2. play time:    rand() returns a deterministic [0,1) generator bound
//                    to this match's seed. Every Math.random() in the
//                    move-pick path is replaced with this generator, so
//                    every randomness draw is locked in once the seed is.
//   3. resolve time: reveal() returns the seed. It's written to
//                    agent_match_state.seed so anyone can verify
//                    keccak256(seed) == commit_hash and replay the RNG.
//   4. cleanup:      forget() drops the seed from memory.
//
// If the agent restarts between accept and resolve the in-memory seed is
// lost. predict() / determineWinner() fall back to Math.random for that
// match and the row's `seed` column ends up null at resolve time. A
// verifier sees commit_hash present but seed null and labels the match
// "unverifiable for this run." Crucially, the agent CANNOT forge a
// replacement seed because keccak256 is one-way — submitting a fake seed
// would fail the commit hash check on the verifier side.
class MoveSeeder {
    private seeds = new Map<string, `0x${string}`>();
    private counters = new Map<string, number>();

    commit(matchId: bigint): { seed: `0x${string}`; commitHash: `0x${string}` } {
        const seed = toHex(randomBytes(32));
        const commitHash = keccak256(seed);
        const key = matchId.toString();
        this.seeds.set(key, seed);
        this.counters.set(key, 0);
        return { seed, commitHash };
    }

    rand(matchId: bigint): () => number {
        const key = matchId.toString();
        const seed = this.seeds.get(key);
        if (!seed) {
            console.warn(chalk.yellow(`⚠️  No seed for match #${matchId} — falling back to Math.random. This match will not be verifiable.`));
            return Math.random;
        }
        return () => {
            const counter = this.counters.get(key) ?? 0;
            this.counters.set(key, counter + 1);
            // keccak256(seed || matchId(32B) || counter(8B)) → first 4 bytes → uint32 → [0,1)
            const matchIdHex = toHex(matchId, { size: 32 }).slice(2);
            const counterHex = toHex(BigInt(counter), { size: 8 }).slice(2);
            const input = `${seed}${matchIdHex}${counterHex}` as `0x${string}`;
            const hash = keccak256(input);
            const v = parseInt(hash.slice(2, 10), 16);
            return v / 0x100000000;
        };
    }

    reveal(matchId: bigint): `0x${string}` | null {
        return this.seeds.get(matchId.toString()) ?? null;
    }

    forget(matchId: bigint): void {
        const key = matchId.toString();
        this.seeds.delete(key);
        this.counters.delete(key);
    }
}

const moveSeeder = new MoveSeeder();

// Fraction of matches that run the Markov branch. The remainder play
// uniformly random. The mix is decided by a seeded coin per match, so
// the player can't tell which mode any given match is in without the
// seed (revealed at resolve time). 0.7 = 70% Markov / 30% random.
// Override via env without redeploy.
const MARKOV_PCT = Math.min(1, Math.max(0, Number(process.env.MARKOV_PCT ?? "0.7")));

class OpponentModel {
    // Markov-1: transitions1[gameType][player][prevMove][nextMove]
    transitions1: Record<number, Record<string, number[][]>> = {};
    // Markov-2: transitions2[gameType][player][prev2Move][prev1Move][nextMove]
    transitions2: Record<number, Record<string, number[][][]>> = {};
    // Rolling last-N moves per player. Capped at HISTORY_CAP to keep memory
    // bounded; Markov-2 only ever needs the last two.
    history: Record<number, Record<string, number[]>> = {};
    // Player's overall move histogram. Last-resort signal when neither
    // Markov-2 nor Markov-1 has enough rows.
    histograms: Record<number, Record<string, number[]>> = {};
    // Total moves we've observed per player — gates the cold-start branch.
    seen: Record<number, Record<string, number>> = {};
    matchCount: number = 0;
    wins: Record<string, number> = {};

    private readonly HISTORY_CAP = 8;
    private readonly MARKOV2_MIN_OBS = 3; // need 3 hits in a (p2,p1) bucket
    private readonly MARKOV1_MIN_OBS = 2; // need 2 hits in a p1 bucket

    update(gameType: number, player: string, move: number) {
        if (!this.transitions1[gameType]) this.transitions1[gameType] = {};
        if (!this.transitions2[gameType]) this.transitions2[gameType] = {};
        if (!this.history[gameType])      this.history[gameType] = {};
        if (!this.histograms[gameType])   this.histograms[gameType] = {};
        if (!this.seen[gameType])         this.seen[gameType] = {};

        const size = gameType === 0 ? 3 : gameType === 1 ? 6 : 2;

        if (!this.transitions1[gameType][player]) {
            this.transitions1[gameType][player] = Array.from({ length: size }, () => Array(size).fill(0));
        }
        if (!this.transitions2[gameType][player]) {
            this.transitions2[gameType][player] = Array.from({ length: size }, () =>
                Array.from({ length: size }, () => Array(size).fill(0))
            );
        }
        if (!this.histograms[gameType][player]) {
            this.histograms[gameType][player] = Array(size).fill(0);
        }
        if (!this.history[gameType][player]) {
            this.history[gameType][player] = [];
        }

        // Histogram is unconditional — every observed move counts.
        if (move < size) {
            const histRow = this.histograms[gameType]![player]!;
            histRow[move] = (histRow[move] ?? 0) + 1;
            this.seen[gameType]![player] = (this.seen[gameType]![player] ?? 0) + 1;
        }

        const playerHistory = this.history[gameType]![player]!;

        // Markov-1: increment transitions1[lastMove][move] when we have one prior move.
        if (playerHistory.length >= 1 && move < size) {
            const lastMove = playerHistory[playerHistory.length - 1]!;
            if (lastMove < size) {
                const row = this.transitions1[gameType]![player]![lastMove]!;
                row[move] = (row[move] || 0) + 1;
            }
            this.matchCount++;
            if (!this.wins[player]) this.wins[player] = 0;
        }

        // Markov-2: increment transitions2[prev2][prev1][move] when we have two prior moves.
        if (playerHistory.length >= 2 && move < size) {
            const prev2 = playerHistory[playerHistory.length - 2]!;
            const prev1 = playerHistory[playerHistory.length - 1]!;
            if (prev2 < size && prev1 < size) {
                const row = this.transitions2[gameType]![player]![prev2]![prev1]!;
                row[move] = (row[move] || 0) + 1;
            }
        }

        playerHistory.push(move);
        if (playerHistory.length > this.HISTORY_CAP) playerHistory.shift();
    }

    // Predicts the player's next move via cascading lookups: Markov-2 first,
    // then Markov-1, then the overall histogram. Returns null when none have
    // enough signal — callers fall through to coldStart in that case.
    predictNext(gameType: number, player: string): { move: number; confidence: number; depth: 1 | 2 | 0 } | null {
        const size = gameType === 0 ? 3 : gameType === 1 ? 6 : 2;
        const playerHistory = this.history[gameType]?.[player] ?? [];
        const trans1 = this.transitions1[gameType]?.[player];
        const trans2 = this.transitions2[gameType]?.[player];
        const hist = this.histograms[gameType]?.[player];
        const totalSeen = this.seen[gameType]?.[player] ?? 0;

        // Markov-2: condition on the last two moves.
        if (playerHistory.length >= 2 && trans2) {
            const prev2 = playerHistory[playerHistory.length - 2]!;
            const prev1 = playerHistory[playerHistory.length - 1]!;
            const counts = trans2[prev2]?.[prev1];
            if (counts) {
                const total = counts.reduce((a, b) => a + b, 0);
                if (total >= this.MARKOV2_MIN_OBS) {
                    let best = 0;
                    for (let i = 1; i < size; i++) {
                        if (counts[i]! > counts[best]!) best = i;
                    }
                    return { move: best, confidence: counts[best]! / total, depth: 2 };
                }
            }
        }

        // Markov-1 fallback: condition on the last move only.
        if (playerHistory.length >= 1 && trans1) {
            const lastMove = playerHistory[playerHistory.length - 1]!;
            const counts = trans1[lastMove];
            if (counts) {
                const total = counts.reduce((a, b) => a + b, 0);
                if (total >= this.MARKOV1_MIN_OBS) {
                    let best = 0;
                    for (let i = 1; i < size; i++) {
                        if (counts[i]! > counts[best]!) best = i;
                    }
                    return { move: best, confidence: counts[best]! / total, depth: 1 };
                }
            }
        }

        // Histogram (overall move bias) is a weak last signal.
        if (hist && totalSeen >= 3) {
            let best = 0;
            for (let i = 1; i < size; i++) {
                if (hist[i]! > hist[best]!) best = i;
            }
            return { move: best, confidence: hist[best]! / totalSeen, depth: 0 };
        }

        return null;
    }

    // Main decision function. Returns the agent's 0-indexed move plus the
    // strategy mode used to pick it ('markov' / 'random' / 'cold_start').
    // Pass a seeded `rand` to make every randomness draw verifiable after
    // the match (MoveSeeder.rand for production, Math.random for fallback).
    //
    // The mix coin is drawn FIRST so its position in the seeded RNG stream
    // is deterministic. Even if the Markov branch never executes (e.g. the
    // player has no history yet), the coin still consumes one rand counter
    // so the verifier can replay the stream in lockstep.
    predict(gameType: number, player: string, rand: () => number = Math.random, markovPct = MARKOV_PCT): { move: number; mode: 'markov' | 'random' | 'cold_start' } {
        const size = gameType === 0 ? 3 : gameType === 1 ? 6 : 2;
        const prediction = this.predictNext(gameType, player);
        const modeCoin = rand();
        const wantMarkov = modeCoin < markovPct;

        // ─── Cold start ────────────────────────────────────────────────────
        // No history yet, so no Markov branch to mix against. coldStart is
        // a fixed opening-bias distribution; force-mixing random on top
        // would just degrade the cold-start edge.
        if (!prediction) {
            return { move: this.coldStart(gameType, size, rand), mode: 'cold_start' };
        }

        // ─── Random mode ───────────────────────────────────────────────────
        // The coin landed in the random pocket. Play a uniformly random
        // move regardless of what Markov would have done. Player can't
        // tell from outside the agent whether this match is markov or
        // random; that obscuration is the whole point of the mix.
        if (!wantMarkov) {
            return { move: Math.floor(rand() * size), mode: 'random' };
        }

        // ─── Markov mode — RPS ─────────────────────────────────────────────
        if (gameType === 0) {
            const counter      = (prediction.move + 1) % 3;   // beats predicted
            const metaCounter  = (prediction.move + 2) % 3;   // beats the counter
            const random       = Math.floor(rand() * 3);

            // Lower-confidence predictions = more randomness. When the model
            // is confident we lean hard on counter; when uncertain we mix
            // more random so we don't telegraph the same move repeatedly.
            const r = rand();
            if (prediction.confidence >= 0.6) {
                // High confidence: 75% counter, 15% meta, 10% random
                return { move: r < 0.75 ? counter : r < 0.90 ? metaCounter : random, mode: 'markov' };
            }
            // Lower confidence: 60% counter, 20% meta, 20% random
            return { move: r < 0.60 ? counter : r < 0.80 ? metaCounter : random, mode: 'markov' };
        }

        // ─── Markov mode — Coin flip ──────────────────────────────────────
        if (gameType === 3) {
            const opposite = 1 - prediction.move;
            return { move: rand() < 0.80 ? opposite : Math.floor(rand() * 2), mode: 'markov' };
        }

        // ─── Markov mode — Dice ───────────────────────────────────────────
        if (gameType === 1) {
            return { move: rand() > 0.3 ? 5 : Math.floor(rand() * 6), mode: 'markov' };
        }

        return { move: Math.floor(rand() * size), mode: 'markov' };
    }

    // Cold-start strategy when we have no prior signal on this player.
    // For RPS we exploit the well-documented opening bias toward rock.
    coldStart(gameType: number, size: number, rand: () => number = Math.random): number {
        if (gameType === 0) {
            // Humans play rock ~41% on first round. Paper beats rock.
            // Mix: 45% paper (beats rock), 30% scissors (beats paper),
            // 25% rock (beats scissors) — still has variety, but tilted.
            const r = rand();
            return r < 0.45 ? 1 : r < 0.75 ? 2 : 0;
        }
        if (gameType === 3) {
            // Heads is the modal first call (~52%). Counter with tails.
            return rand() < 0.55 ? 1 : 0;
        }
        return Math.floor(rand() * size);
    }
}

const model = new OpponentModel();
const respondedMatches = new Set<string>();
const processingAcceptance = new Set<string>();
const completedMatches = new Set<string>(); // Skip these on future scans

// ─── LossCapTracker ─────────────────────────────────────────────────────────
// Two-layer circuit breaker against draining the agent wallet:
//
//   1. Global daily loss cap. If MARKOV has lost > GLOBAL_DAILY_LOSS_CAP
//      across ALL matches today (UTC), agent refuses to accept any new
//      match until the next UTC day rolls over.
//
//   2. Per-wallet daily loss cap. If a SINGLE wallet has won more than
//      WALLET_DAILY_LOSS_CAP from MARKOV today, agent refuses to accept
//      further matches from that wallet.
//
// State lives in Supabase (`agent_loss_caps`), shared with the games-backend
// project. Survives container restarts, deploys, and disk wipes. The atomic
// `agent_increment_loss` Postgres function prevents lost updates when two
// matches resolve in the same tick.
//
// Policy on DB failure: FAIL CLOSED on reads (refuse new accepts if we
// can't verify caps), but log loudly and surface in /healthz. Writes use a
// best-effort retry; permanent failure leaves cap state under-counted, so
// errors must page operators.
class LossCapTracker {
    private readonly GLOBAL_CAP_WEI: bigint = parseEther(process.env.GLOBAL_DAILY_LOSS_CAP ?? "100");
    private readonly WALLET_CAP_WEI: bigint = parseEther(process.env.WALLET_DAILY_LOSS_CAP ?? "50");

    // Process-local dedup. Belt-and-suspenders on top of the contract's
    // exactly-once resolve guarantee. A duplicate recordOutcome call in
    // the same process (retry path, double-fire) is silently skipped.
    private countedMatches: Set<string> = new Set();

    private dayKey(): string {
        return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    }

    /**
     * Called before acceptMatch. Returns null if the match can be accepted,
     * or a reason string if a cap would be exceeded. FAIL CLOSED: a DB read
     * error returns a reject string, so the agent declines until Supabase
     * is reachable again.
     */
    async canAccept(challenger: string, wager: bigint): Promise<string | null> {
        const today = this.dayKey();
        const lcChal = challenger.toLowerCase();

        const { data, error } = await supabase
            .from("agent_loss_caps")
            .select("scope, loss_wei")
            .eq("scope_date", today)
            .in("scope", ["global", lcChal]);

        if (error) {
            console.error(chalk.red(`Loss cap read failed (${error.message}). Refusing match for safety.`));
            return `Loss cap state unavailable; refusing accept until DB is reachable.`;
        }

        let totalLossWei = 0n;
        let walletLossWei = 0n;
        for (const row of data ?? []) {
            const v = BigInt((row.loss_wei as unknown as string) ?? "0");
            if (row.scope === "global") totalLossWei = v;
            else if (row.scope === lcChal) walletLossWei = v;
        }

        if (totalLossWei + wager > this.GLOBAL_CAP_WEI) {
            return `GLOBAL daily loss cap reached (${formatEther(totalLossWei)}/${formatEther(this.GLOBAL_CAP_WEI)} G$ lost today). Pausing until next UTC day.`;
        }
        if (walletLossWei + wager > this.WALLET_CAP_WEI) {
            return `WALLET cap reached for ${challenger.slice(0, 8)}.. (${formatEther(walletLossWei)}/${formatEther(this.WALLET_CAP_WEI)} G$ won from MARKOV today).`;
        }
        return null;
    }

    /**
     * Called after a successful resolveMatch tx. Increments both scope rows
     * atomically via the `agent_increment_loss` RPC. Only charges when the
     * agent lost (player won the wager).
     *
     * If the RPC fails, the in-process dedup is rolled back so the next
     * tick can retry. A persistent failure means cap state diverges from
     * reality; the error is logged at error level for ops visibility.
     */
    async recordOutcome(matchId: bigint, challenger: string, agentWon: boolean, wager: bigint): Promise<void> {
        const key = matchId.toString();
        if (this.countedMatches.has(key)) return;
        this.countedMatches.add(key);

        if (agentWon) return; // agent won — nothing to charge

        const today = this.dayKey();
        const lcChal = challenger.toLowerCase();
        const deltaStr = wager.toString();

        try {
            const [globalRes, walletRes] = await Promise.all([
                supabase.rpc("agent_increment_loss", { p_date: today, p_scope: "global", p_delta: deltaStr }),
                supabase.rpc("agent_increment_loss", { p_date: today, p_scope: lcChal,    p_delta: deltaStr }),
            ]);
            if (globalRes.error || walletRes.error) {
                throw new Error(globalRes.error?.message ?? walletRes.error?.message ?? "rpc failed");
            }
            const newTotal = BigInt((globalRes.data as unknown as string) ?? "0");
            const newWallet = BigInt((walletRes.data as unknown as string) ?? "0");
            console.log(chalk.gray(`📊 Loss cap: +${formatEther(wager)} G$ (player ${challenger.slice(0, 8)}..). Today total = ${formatEther(newTotal)}/${formatEther(this.GLOBAL_CAP_WEI)} G$. This wallet = ${formatEther(newWallet)}/${formatEther(this.WALLET_CAP_WEI)} G$.`));
        } catch (e: any) {
            console.error(chalk.red(`Loss cap RPC failed (${e?.message ?? e}). State now under-counted by ${formatEther(wager)} G$ until reconciled.`));
            this.countedMatches.delete(key); // allow a retry path
        }
    }
}

const lossCap = new LossCapTracker();
let lastKnownMatchCount = 0n;
const moltbook = new MoltbookService();
// Cache of moves the agent itself submitted, keyed by matchId. Populated by
// tryPlayMove right after a successful playMove tx; consumed by
// tryResolveMatch as the source of truth for the agent's own move.
//
// Why: when the agent reads its own move back from chain via playerMoves,
// forno's RPC sometimes serves a snapshot from before the AI's playMove was
// indexed — returning 0 (= ROCK by Solidity default) instead of the real
// value. Trusting the local cache eliminates that read entirely; the
// challenger's move still comes from chain (we don't know it locally).
const agentMoves = new Map<string, number>();
// The mode predict() returned for this match — written to agent_match_state
// at resolve time so the verifier can confirm the seed-derived coin flip
// landed in the mode the agent claims.
const agentModes = new Map<string, 'markov' | 'random' | 'cold_start'>();

// Robust helper to handle different Viem return formats (named or indexed)
function normalizeMatch(m: any, id: bigint) {
    if (!m) return null;
    return {
        id: id,
        challenger: (m.challenger || m[1]) as string,
        opponent: (m.opponent || m[2]) as string,
        wager: (m.wager || m[3]) as bigint,
        gameType: (m.gameType !== undefined ? m.gameType : m[4]) as number,
        status: (m.status !== undefined ? m.status : m[5]) as number,
        winner: (m.winner || m[6]) as string,
        createdAt: (m.createdAt || m[7]) as bigint
    };
}


const activeGameLocks = new Set<string>();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── submitTx — in-process tx serializer ───────────────────────────────────
// The agent uses one wallet for every chain write (acceptMatch, playMove,
// resolveMatch, tie refund, registration). viem reads the next nonce from
// the RPC at the moment writeContract is called, so two parallel calls see
// the same nonce — one tx wins inclusion, the other reverts with
// "nonce too low" and the affected match silently fails to advance.
//
// This serializer chains every tx submission behind a single promise so
// the nonce read for tx N always happens after the receipt of tx N-1.
// Same wallet runs to completion before the next one starts. Loss-cap
// reads + writes also become race-free because the next `canAccept` only
// runs after the previous `acceptMatch` finalises.
//
// Cost: a second concurrent challenger waits one extra block (~5s on Celo)
// before their match is accepted. Acceptable tradeoff vs silent drops.
let txQueueTail: Promise<unknown> = Promise.resolve();
async function submitTx<T>(op: () => Promise<T>): Promise<T> {
    const previous = txQueueTail;
    let release: () => void = () => {};
    const next = new Promise<void>(r => { release = r; });
    txQueueTail = next;
    try {
        await previous.catch(() => {}); // never block the queue on prior failures
        return await op();
    } finally {
        release();
    }
}

// RETRY HELPER: Handle temporary RPC/Network glitches
async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e: any) {
            const isLast = i === retries - 1;
            console.log(chalk.yellow(`[${label}] RPC Error (attempt ${i + 1}/${retries}): ${e.shortMessage || e.message}`));
            if (isLast) throw e;
            await sleep(2000 * (i + 1)); // Exponential backoff
        }
    }
    throw new Error(`Failed ${label} after ${retries} retries`);
}

async function scanForMatches() {
    try {
        const matchCounter = await withRetry(() => publicClient.readContract({
            address: ARENA_ADDRESS,
            abi: ARENA_ABI,
            functionName: 'matchCounter',
        }), "matchCounter") as bigint;

        if (matchCounter === 0n) return;

        // Only scan matches we haven't marked as completed
        // Build list of match IDs to check (skip completed ones)
        const toCheck: bigint[] = [];
        for (let i = 0n; i < matchCounter; i++) {
            if (!completedMatches.has(i.toString())) {
                toCheck.push(i);
            }
        }

        const isNew = matchCounter > lastKnownMatchCount;
        if (isNew) {
            console.log(chalk.gray(`New matches detected! Total: ${matchCounter} | Scanning ${toCheck.length} active`));
        } else if (toCheck.length > 0) {
            console.log(chalk.gray(`Scanning ${toCheck.length} active matches (${completedMatches.size} completed, skipped)`));
        } else {
            // Nothing to scan — all matches are completed
            return;
        }
        lastKnownMatchCount = matchCounter;

        if (toCheck.length === 0) return;

        // BATCH FETCH: Only fetch active/pending matches
        const matchContracts = toCheck.map(id => ({
            address: ARENA_ADDRESS,
            abi: ARENA_ABI,
            functionName: 'matches',
            args: [id]
        }));

        const results = await withRetry(() => publicClient.multicall({ contracts: matchContracts }), "multicallMatches");

        for (let i = 0; i < results.length; i++) {
            const res = results[i];
            if (!res || res.status !== 'success') continue;
            const matchId = toCheck[i]!;
            const matchIdStr = matchId.toString();

            const raw = res.result as any;
            const m = normalizeMatch(raw, matchId);
            if (!m) continue;

            // Match #4/stuck match debug
            console.log(chalk.gray(`Match #${matchIdStr}: status=${m.status}, challenger=${m.challenger.slice(0, 6)}.., opponent=${m.opponent.slice(0, 6)}..`));

            // Status 2 = Completed, 3 = Cancelled — mark and skip forever
            if (m.status === 2 || m.status === 3) {
                completedMatches.add(matchIdStr);
                continue;
            }

            // 1. Accept pending matches (Status 0)
            if (m.status === 0 && !processingAcceptance.has(matchIdStr) && (m.opponent.toLowerCase() === account.address.toLowerCase() || m.opponent === '0x0000000000000000000000000000000000000000')) {
                await handleChallenge(matchId, m.challenger, m.wager, m.gameType);
            }


            // 2. Process Accepted Matches (Play Move OR Resolve)
            if (m.status === 1) {
                await tryPlayMove(matchId, m);
                await tryResolveMatch(matchId, m);
            }
        }

    } catch (e) {
        console.error(chalk.red("Error scanning for matches:"), e);
    }
}

async function startAgent() {
    try {
        console.log(chalk.gray('Connecting to Celo RPC...'));
        const blockNumber = await Promise.race([
            publicClient.getBlockNumber(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('RPC connection timeout (15s)')), 15000))
        ]);
        console.log(chalk.blue(`Connected to network. Current block: ${blockNumber}`));
    } catch (err: any) {
        console.error(chalk.red(`Failed to connect to network: ${err.message || err}`));
        console.log(chalk.yellow('Continuing anyway — will retry on first scan...'));
    }
    console.log(chalk.blue.bold('🤖 Arena AI Agent V3 (EIP-8004) Started'));

    const ERC8004_ABI = [
        { inputs: [{ internalType: "string", name: "agentURI", type: "string" }], name: "register", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "nonpayable", type: "function" },
        { inputs: [{ internalType: "address", name: "owner", type: "address" }], name: "balanceOf", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" }
    ] as const;

    // EIP-8004 Registration (Simpler Check)
    try {
        const balance = await publicClient.readContract({
            address: REGISTRY_ADDRESS,
            abi: ERC8004_ABI,
            functionName: 'balanceOf',
            args: [account.address]
        }) as bigint;

        if (balance === 0n) {
            console.log(chalk.yellow('📝 Registering AI Agent Profile (EIP-8004)...'));

            console.log(chalk.yellow('📝 Registering AI Agent Profile (EIP-8004)...'));

            // User-provided IPFS CID
            const ipfsUri = "ipfs://bafkreig6sha4aqzafeqbocsppwobxdp3rlu7axv2rcloyh4tpw2afbj2r4";

            const txHash = await submitTx(async () => {
                const h = await walletClient.writeContract({
                    address: REGISTRY_ADDRESS,
                    abi: ERC8004_ABI,
                    functionName: 'register',
                    args: [ipfsUri],
                    chain: CELO_MAINNET,
                    account
                });
                await publicClient.waitForTransactionReceipt({ hash: h });
                return h;
            });
            console.log(chalk.green(`✅ Agent Registered! TX: ${txHash}`));
        } else {
            console.log(chalk.green('✅ Agent already registered (EIP-8004).'));
        }
    } catch (e) {
        console.log(chalk.gray('EIP-8004 registration check... (skipping if failed)'));
    }

    // ─── Self Agent ID (Talent Protocol prize-pool requirement) ─────────────
    // Self Agent ID is mint-with-proof: register(agentURI) reverts with a
    // custom error (0xf570d268) when called from a wallet that hasn't
    // gone through the passport-backed ZK verification in the Self mobile
    // app. The right path is "linked" registration via
    // https://selfagentid.xyz — a verified human registers and then signs
    // an EIP-712 message that authorises this agent wallet. We just
    // surface the current registration status on boot so ops can confirm
    // it's still in place; we never try to write from here.
    const SELF_AGENT_REGISTRY = '0xaC3DF9ABf80d0F5c020C06B04Cced27763355944' as `0x${string}`;
    try {
        const selfBalance = await publicClient.readContract({
            address: SELF_AGENT_REGISTRY,
            abi: ERC8004_ABI,
            functionName: 'balanceOf',
            args: [account.address]
        }) as bigint;
        if (selfBalance > 0n) {
            console.log(chalk.green('✅ Self Agent ID linked to this wallet.'));
        } else {
            console.log(chalk.yellow('⚠️  Self Agent ID not yet linked. Use https://selfagentid.xyz (linked mode, Celo Mainnet).'));
        }
    } catch {
        console.log(chalk.gray('Self Agent ID status check skipped (RPC error).'));
    }

    console.log(chalk.gray(`Wallet: ${account.address} | Platform: ${ARENA_ADDRESS}`));
    console.log(chalk.cyan(`RPC: ${process.env.VITE_RPC_URL || 'https://forno.celo.org (default · env var NOT set)'}`));

    setInterval(scanForMatches, 2000); // Check every 2s for lightning response


    await scanForMatches();

    publicClient.watchEvent({
        address: ARENA_ADDRESS,
        event: parseAbiItem('event MatchProposed(uint256 indexed matchId, address indexed challenger, address indexed opponent, uint256 wager, uint8 gameType)'),
        onLogs: async (logs) => {
            for (const log of logs) {
                const { matchId, challenger, opponent, wager, gameType } = log.args;
                if (processingAcceptance.has(matchId!.toString())) continue;

                if (opponent?.toLowerCase() === account.address.toLowerCase() || opponent === '0x0000000000000000000000000000000000000000') {
                    if (matchId !== undefined && challenger && wager !== undefined && gameType !== undefined) {
                        await handleChallenge(matchId, challenger, wager, gameType);
                    }
                }
            }
        }
    });

    publicClient.watchEvent({
        address: ARENA_ADDRESS,
        event: parseAbiItem('event MovePlayed(uint256 indexed matchId, address indexed player, uint8 move)'),
        onLogs: async (logs) => {
            for (const log of logs) {
                const { matchId, player } = log.args;
                const matchIdStr = matchId!.toString();

                if (activeGameLocks.has(matchIdStr)) continue;

                const m = await withRetry(() => publicClient.readContract({
                    address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'matches', args: [matchId!]
                }), "readMatchEvent") as any;

                if (m.status !== 1) continue;


                console.log(chalk.blue(`\nMove Detected: Match #${matchId} by ${player}`));

                // A. Try to play our move (if we are in match)
                await tryPlayMove(matchId!, m);

                // B. Try to Resolve (if both played) -> Global Referee
                await tryResolveMatch(matchId!, m);
            }
        }
    });
}

const SUPPORTED_GAME_TYPES = [0, 3]; // RPS (0) and CoinFlip (3) only

async function handleChallenge(matchId: bigint, challenger: string, wager: bigint, gameType: number) {
    if (processingAcceptance.has(matchId.toString())) return;
    processingAcceptance.add(matchId.toString());

    if (!SUPPORTED_GAME_TYPES.includes(gameType)) {
        console.log(chalk.red(`Match #${matchId} rejected: game type ${GAME_NAMES[gameType] ?? gameType} is not supported`));
        processingAcceptance.delete(matchId.toString());
        return;
    }

    console.log(chalk.yellow(`\nMatch Proposed: #${matchId} (${GAME_NAMES[gameType]}) from ${challenger}`));

    const balance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address]
    }) as bigint;
    // Allow up to 50% of balance (reserve rest for gas/other matches)
    const maxWager = balance / 2n;

    if (wager > maxWager) {
        console.log(chalk.red(`Challenge rejected: Wager ${formatEther(wager)} G$ too high (Max allowed: ${formatEther(maxWager)} G$)`));
        return;
    }

    // Loss-cap circuit breaker — global + per-wallet. Cheap in-memory check
    // before we burn gas on the acceptMatch tx. If a cap is hit, the match
    // sits on chain in PROPOSED state; the frontend's useAgentLiveness will
    // detect the staleness within ~45s and surface 'MARKOV is offline'.
    const capReject = await lossCap.canAccept(challenger, wager);
    if (capReject) {
        console.log(chalk.yellow(`Match #${matchId} not accepted: ${capReject}`));
        processingAcceptance.delete(matchId.toString());
        return;
    }

    // Generate the per-match seed and lock its hash to Supabase BEFORE
    // we burn the accept tx. The player can read commit_hash on the row
    // the moment the contract status flips to ACCEPTED, then verify
    // after the match that keccak256(revealed_seed) == commit_hash.
    const { commitHash } = moveSeeder.commit(matchId);
    try {
        await supabase.from('agent_match_state').upsert({
            match_id: matchId.toString(),
            challenger: challenger.toLowerCase(),
            wager_wei: wager.toString(),
            game_type: gameType,
            accepted_at: new Date().toISOString(),
            commit_hash: commitHash,
        }, { onConflict: 'match_id' });
    } catch (e: any) {
        console.warn(chalk.yellow(`agent_match_state pre-accept upsert failed for #${matchId}: ${e?.message ?? e}`));
    }

    try {
        const encodedArgs = encodeAbiParameters(
            [{ type: 'uint8' }, { type: 'uint256' }],
            [1, matchId]
        );
        const hash = await submitTx(async () => {
            const { request } = await publicClient.simulateContract({
                address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: 'transferAndCall', args: [ARENA_ADDRESS, wager, encodedArgs], account
            });
            const h = await walletClient.writeContract(request);
            await publicClient.waitForTransactionReceipt({ hash: h });
            return h;
        });
        console.log(chalk.green(`Match #${matchId} accepted! Hash: ${hash} (commit ${commitHash.slice(0, 10)}..)`));

        // Social Update: Match Accepted
        await moltbook.postChallengeAccepted(
            matchId.toString(),
            challenger,
            formatEther(wager),
            GAME_NAMES[gameType] || 'Unknown'
        );
    } catch (error: any) {
        processingAcceptance.delete(matchId.toString()); // Allow retry if failed
        if (error.message?.includes('available')) {
            console.log(chalk.gray(`Match #${matchId} already accepted by someone else.`));
        } else {
            console.error(chalk.red('Failed to accept match:'), error.shortMessage || error.message);
        }
    }
}

async function tryPlayMove(matchId: bigint, m: any) {

    const matchIdStr = matchId.toString();
    if (activeGameLocks.has(matchIdStr)) return;

    // Only play if Agent is a participant (Challenger or Opponent)
    const isChallenger = m.challenger.toLowerCase() === account.address.toLowerCase();
    const isOpponent = m.opponent.toLowerCase() === account.address.toLowerCase();

    if (!isChallenger && !isOpponent) return;

    // CRITICAL: claim the lock SYNCHRONOUSLY before any await so a parallel
    // poll cycle for the same match can't sneak through the has-check and
    // submit a duplicate playMove. Was previously set after the on-chain
    // reads below, which let two pollers race to playMove with different
    // (mathematically pre-determined) moves — only one mined but the second
    // briefly polluted the visible state and made debugging confusing.
    activeGameLocks.add(matchIdStr);

    try {
        // Check if we already played
        const hasPlayed = await withRetry(() => publicClient.readContract({
            address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'hasPlayed', args: [matchId, account.address]
        }), "hasPlayed") as boolean;

        if (hasPlayed) return;

        // FAIRNESS: If we are the opponent (accepted someone's challenge),
        // wait for the challenger to play first so they can't see our move
        if (isOpponent) {
            const challengerPlayed = await withRetry(() => publicClient.readContract({
                address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'hasPlayed', args: [matchId, m.challenger]
            }), "challengerPlayed") as boolean;

            console.log(chalk.gray(`Match #${matchId}: challengerPlayed=${challengerPlayed}, waiting...`));
            if (!challengerPlayed) return; // Wait for challenger to go first
        }

        // Pick + submit our move
        const gameType = m.gameType;
        const opponentAddr = isChallenger ? m.opponent : m.challenger;

        console.log(chalk.magenta(`🤖 Agent playing move for Match #${matchId} (${GAME_NAMES[gameType]})...`));

        // Seeded RNG bound to this match's commit_hash. Every randomness
        // draw inside predict (and later inside determineWinner's oracle
        // flip) consumes from the same counter, so the entire match is
        // verifiable from the seed alone.
        const rand = moveSeeder.rand(matchId);
        const { move: aiMove, mode: aiMode } = model.predict(gameType, opponentAddr, rand);
        agentModes.set(matchIdStr, aiMode);
        console.log(chalk.gray(`Strategy mode: ${aiMode}${aiMode === 'random' ? ' (this match is non-counter — Markov-vs-random mix)' : ''}`));
        let moveToSend = aiMove;

        let moveLabel = 'Strategic';
        if (gameType === 0) moveLabel = ['Rock', 'Paper', 'Scissors'][aiMove] || 'Unknown';
        else if (gameType === 1) { moveLabel = `Dice ${aiMove + 1}`; moveToSend = aiMove + 1; }
        else if (gameType === 3) moveLabel = ['Heads', 'Tails'][aiMove] || 'Unknown';

        console.log(chalk.yellow(`Submitting Move (${moveLabel})...`));

        const hash = await submitTx(async () => {
            const { request } = await publicClient.simulateContract({
                address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'playMove',
                args: [matchId, moveToSend], account
            });
            const h = await walletClient.writeContract(request);
            await publicClient.waitForTransactionReceipt({ hash: h });
            return h;
        });
        console.log(chalk.gray(`TX: ${hash}`));

        // Cache the move locally so the resolver doesn't need to read it
        // back from chain. RPC nodes can serve stale snapshots and return
        // 0 (rock by default) even after the playMove tx confirmed — that
        // was the root cause of the wrong-winner bug.
        agentMoves.set(matchIdStr, moveToSend);

    } catch (e: any) {
        console.error(chalk.red(`Failed to play move for #${matchId}:`), e.shortMessage || e.message);
    } finally {
        // Release the lock on every exit path — early return, success, or error.
        // The next poll cycle is the right time to retry if this attempt failed.
        activeGameLocks.delete(matchIdStr);
    }
}

async function tryResolveMatch(matchId: bigint, m: any) {

    const matchIdStr = matchId.toString();
    if (activeGameLocks.has(matchIdStr + '_resolve')) return;

    // Check if BOTH have played
    const [challengerPlayed, opponentPlayed] = await withRetry(() => Promise.all([
        publicClient.readContract({ address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'hasPlayed', args: [matchId, m.challenger] }),
        publicClient.readContract({ address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'hasPlayed', args: [matchId, m.opponent] })
    ]), "checkBothPlayed") as [boolean, boolean];


    if (!challengerPlayed || !opponentPlayed) return; // Wait for both

    activeGameLocks.add(matchIdStr + '_resolve');
    try {
        console.log(chalk.cyan(`⚖️ Resolving Match #${matchId} (Global Referee Mode)...`));

        // Source of truth for the AI's own move: the in-memory cache the
        // tryPlayMove function populated right after its playMove tx
        // confirmed. Reading the AI's move back from chain is unreliable
        // — forno's RPC serves stale snapshots that can return 0 (= ROCK
        // by Solidity default) for tens of seconds after the tx mined.
        // That was the root cause of every wrong-winner outcome.
        //
        // The challenger's move still has to come from chain (we don't
        // know it locally), but the challenger plays FIRST, so by the
        // time we get here it has been on chain for many seconds and is
        // safe to read.
        const cachedOpponentMove = agentMoves.get(matchIdStr);
        if (cachedOpponentMove === undefined) {
            // Edge case: agent restarted between playing the move and
            // resolving the match, so the cache was wiped. Fall back to
            // a chain read with a healthy delay so the move is indexed.
            console.log(chalk.yellow(`Match #${matchId}: AI move not in cache (agent restart?). Falling back to chain read.`));
            await sleep(3000);
        }

        const challengerMove = Number(await withRetry(() => publicClient.readContract({
            address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'playerMoves',
            args: [matchId, m.challenger],
        }), "readChallengerMove"));

        const opponentMove = cachedOpponentMove !== undefined
            ? cachedOpponentMove
            : Number(await withRetry(() => publicClient.readContract({
                address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'playerMoves',
                args: [matchId, m.opponent],
            }), "readOpponentMove"));

        console.log(chalk.gray(`Match #${matchId} moves: challenger=${challengerMove}, opponent=${opponentMove} (${cachedOpponentMove !== undefined ? 'cached' : 'chain'})`));

        // Train the model with the player's observed move BEFORE we
        // resolve. Each call ticks the histogram, Markov-1 transitions,
        // and Markov-2 transitions. Without this the model never learns
        // and predict() always hits the cold-start branch.
        if (challengerMove !== undefined && challengerMove !== null) {
            model.update(m.gameType, m.challenger, challengerMove);
        }

        // Continue the same seeded RNG stream that predict() started
        // during tryPlayMove. determineWinner's coin-flip oracle picks
        // up at the next counter value, so play-time and resolve-time
        // randomness are both derivable from one seed.
        const resolveRand = moveSeeder.rand(matchId);
        const outcome = determineWinner(m.gameType, m.challenger, challengerMove, m.opponent, opponentMove, m.wager, resolveRand);

        await submitTx(async () => {
            const { request } = await publicClient.simulateContract({
                address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'resolveMatch',
                args: [matchId, outcome.winner], account
            });
            const h = await walletClient.writeContract(request);
            await publicClient.waitForTransactionReceipt({ hash: h });
        });
        console.log(chalk.green(`✅ Match #${matchId} Resolved! ${outcome.isTie ? `TIE (${outcome.tieReason}) → AI on chain, refund pending` : `Winner: ${outcome.winner === m.challenger ? 'Challenger' : 'Opponent'} (${outcome.winner})`}`));

        // Persist the resolve outcome to Supabase so the frontend can
        // tell a tied match apart from a clean loss (the contract emits
        // MatchCompleted with AI as winner in both cases). Reveal the
        // seed at the same time — the row now contains everything a
        // verifier needs: commit_hash (from accept time) + seed (here) +
        // both players' moves + outcome. Null seed means the agent
        // restarted mid-match and this row is unverifiable.
        const matchOutcome = outcome.isTie ? 'tie' : (outcome.winner.toLowerCase() === account.address.toLowerCase() ? 'ai_won' : 'player_won');
        const revealedSeed = moveSeeder.reveal(matchId);
        const recordedMode = agentModes.get(matchIdStr) ?? null;
        try {
            await supabase.from('agent_match_state').upsert({
                match_id: matchId.toString(),
                challenger: m.challenger.toLowerCase(),
                wager_wei: m.wager.toString(),
                game_type: m.gameType,
                ai_move: opponentMove,
                player_move: challengerMove,
                resolved_at: new Date().toISOString(),
                ai_won: outcome.winner.toLowerCase() === account.address.toLowerCase(),
                outcome: matchOutcome,
                tie_reason: outcome.isTie ? outcome.tieReason : null,
                tie_refund_wei: outcome.isTie ? outcome.tieRefundWei.toString() : null,
                refund_pending: outcome.isTie,
                seed: revealedSeed,
                mode: recordedMode,
            }, { onConflict: 'match_id' });
        } catch (e: any) {
            console.warn(chalk.yellow(`agent_match_state upsert failed for #${matchId}: ${e?.message ?? e}`));
        }
        agentModes.delete(matchIdStr);
        moveSeeder.forget(matchId);

        // ERC-8004 reputation hook. Fire-and-forget · attests the resolved
        // match to MARKOV's record in the official Feedback Registry on
        // Celo. Builds the agent's on-chain reputation in real time as
        // matches happen, surfaced on 8004scan.io/agents/celo/6386.
        attestMatchCompleted({
            matchId,
            gameType: m.gameType,
            outcome: outcome.isTie ? 'tie' : (outcome.winner.toLowerCase() === account.address.toLowerCase() ? 'markov' : 'player'),
        });

        // Season 1 Solo Ladder hook. Award the challenger 10 points for
        // playing a match, plus 20 bonus points if they won the wager.
        // Idempotent via the unique match_id used as `ref`. Best-effort:
        // failures are logged but never block the resolve flow.
        try {
            const challengerLc = m.challenger.toLowerCase();
            const { data: enrolled } = await supabase
                .from('season_v1_players')
                .select('wallet')
                .ilike('wallet', challengerLc)
                .maybeSingle();
            if (enrolled) {
                const rows: { wallet: string; action_type: string; points: number; ref: string }[] = [
                    { wallet: challengerLc, action_type: 'game_played', points: 10, ref: `cai:${matchIdStr}` },
                ];
                // Rebalanced 20 → 15 so the win bonus is "significant but not
                // dominant". Combined with the base 10 for playing, a wager
                // win is worth 25 pts (2.5× a regular game), which rewards
                // risk-taking without crowding out grinders.
                if (matchOutcome === 'player_won') {
                    rows.push({ wallet: challengerLc, action_type: 'wager_won', points: 15, ref: `cai:${matchIdStr}` });
                }
                await supabase.from('season_v1_points').insert(rows);
            }
        } catch (e: any) {
            console.warn(chalk.yellow(`Season 1 points hook (challenge-ai) failed for #${matchId}: ${e?.message ?? e}`));
        }

        // Tie refund. Send 0.98× wager from the agent's wallet to the
        // challenger. Best-effort with chain-level retry. Failure is
        // logged loudly; the refund_pending row in Supabase surfaces
        // it for manual reconciliation.
        if (outcome.isTie) {
            await sendTieRefund(matchId, m.challenger as `0x${string}`, outcome.tieRefundWei);
        }

        // Loss-cap accounting. On a clean loss the agent paid `wager` to
        // the player. On a tie the agent paid `tieRefundWei` to the
        // player out of its own wallet. Either is a real outflow against
        // the daily cap. On a clean AI win, no charge.
        const lossWei = outcome.isTie
            ? outcome.tieRefundWei
            : (outcome.winner.toLowerCase() === account.address.toLowerCase() ? 0n : m.wager);
        if (lossWei > 0n) {
            await lossCap.recordOutcome(matchId, m.challenger, false, lossWei);
        } else {
            await lossCap.recordOutcome(matchId, m.challenger, true, 0n);
        }

        // Social Update: Match Result
        await moltbook.postMatchResult(
            matchId.toString(),
            m.challenger,
            m.opponent,
            outcome.winner,
            formatEther(m.wager * 2n),
            GAME_NAMES[m.gameType] || 'Unknown'
        );


    } catch (e: any) {
        const errMsg = e.shortMessage || e.message || '';
        if (errMsg.includes('Match not in progress')) {
            console.log(chalk.gray(`Match #${matchId} already resolved by another party.`));
            // Still post to Moltbook — we participated in this match
            try {
                const resolvedWinner = m.winner; // winner field from match struct
                if (resolvedWinner && resolvedWinner !== '0x0000000000000000000000000000000000000000') {
                    await moltbook.postMatchResult(
                        matchId.toString(),
                        m.challenger, m.opponent, resolvedWinner,
                        formatEther(m.wager * 2n),
                        GAME_NAMES[m.gameType] || 'Unknown'
                    );
                }
            } catch (postErr: any) {

                console.error(chalk.yellow(`[MOLTBOOK] Post failed after external resolve: ${postErr.message}`));
            }
        } else {
            console.error(chalk.red(`Failed to resolve #${matchId}: ${errMsg}`));
        }
    } finally {
        activeGameLocks.delete(matchIdStr + '_resolve');
    }
}

// Sends the tie refund to the challenger from the agent's wallet. Called
// only after a successful resolveMatch tx has assigned the prize to the
// AI on chain. Failure is logged but doesn't throw — the caller flagged
// refund_pending=true in agent_match_state so ops can reconcile.
async function sendTieRefund(matchId: bigint, player: `0x${string}`, amountWei: bigint): Promise<void> {
    const matchKey = matchId.toString();
    try {
        console.log(chalk.gray(`💸 Refund #${matchId}: ${formatEther(amountWei)} G$ → ${player.slice(0, 8)}..`));

        const hash = await submitTx(async () => {
            const { request } = await publicClient.simulateContract({
                address: G_TOKEN_ADDRESS,
                abi: ERC20_ABI,
                functionName: 'transfer',
                args: [player, amountWei],
                account,
            });
            const h = await walletClient.writeContract(request);
            await publicClient.waitForTransactionReceipt({ hash: h });
            return h;
        });

        try {
            await supabase
                .from('agent_match_state')
                .update({ refund_pending: false, refund_tx_hash: hash })
                .eq('match_id', matchKey);
        } catch (e: any) {
            console.warn(chalk.yellow(`Refund tx ${hash} succeeded but agent_match_state update failed for #${matchId}: ${e?.message ?? e}`));
        }

        console.log(chalk.green(`✅ Refund tx ${hash} for match #${matchId}`));
    } catch (e: any) {
        console.error(chalk.red(`❌ Tie refund FAILED for #${matchId} → ${player}: ${e?.shortMessage ?? e?.message ?? e}. agent_match_state.refund_pending stays true; reconcile manually.`));
    }
}

// Resolution outcome for one match. `winner` is the address that
// resolveMatch is called with (the contract pays it 1.96× the pot).
// On a tie we route the on-chain win to the AI and refund the player
// `tieRefundWei` G$ from the agent's wallet in a follow-up tx — gives
// each side a symmetric "each pays half the protocol fee" outcome
// without changing the contract.
interface ResolveOutcome {
    winner: `0x${string}`;
    isTie: boolean;
    tieRefundWei: bigint;
    tieReason: string; // empty if not a tie
}

// Refund 98% of the wager on ties. The 2% fee already taken at
// resolveMatch is split evenly between both sides this way (AI keeps
// 0.98× of the pot, refunds the other 0.98× to the player).
function tieRefundFor(wager: bigint): bigint {
    return (wager * 98n) / 100n;
}

function determineWinner(gameType: number, p1: string, m1: number, p2: string, m2: number, wager: bigint, rand: () => number = Math.random): ResolveOutcome {
    let p1Wins = false;
    let isTie = false;
    let tieReason = '';

    if (gameType === 0) { // RPS
        if (m1 === m2) { isTie = true; tieReason = 'rps_same'; }
        else if ((m1 === 0 && m2 === 2) || (m1 === 1 && m2 === 0) || (m1 === 2 && m2 === 1)) p1Wins = true;
    } else if (gameType === 1) { // Dice
        if (m1 === m2) { isTie = true; tieReason = 'dice_same'; }
        else if (m1 > m2) p1Wins = true;
    } else if (gameType === 3) { // Coin Flip
        // Oracle flip decides which side called correctly. Outcomes:
        //   - p1 only correct → player wins
        //   - p2 only correct → AI wins
        //   - both correct    → tie (refunds)
        //   - both wrong      → tie (refunds)
        //
        // The oracle now draws from the same seed stream the agent's
        // own move pick consumed, so the entire match's randomness is
        // provably bound to the commit_hash written at accept time.
        // Player can replay this draw after the seed is revealed.
        const oracleFlip = rand() > 0.5 ? 1 : 0; // 0=Heads, 1=Tails
        console.log(chalk.gray(`🔮 Oracle Flip: ${oracleFlip === 0 ? 'Heads' : 'Tails'}`));

        const p1Correct = m1 === oracleFlip;
        const p2Correct = m2 === oracleFlip;

        if (p1Correct && p2Correct) {
            isTie = true; tieReason = 'coin_both_right';
            console.log(chalk.gray(`Both correct — tie, refund pending.`));
        } else if (!p1Correct && !p2Correct) {
            isTie = true; tieReason = 'coin_both_wrong';
            console.log(chalk.gray(`Both wrong — tie, refund pending.`));
        } else if (p1Correct) {
            p1Wins = true;
        } else {
            p1Wins = false;
        }
    }

    if (isTie) {
        // Route every tie to AI on chain. Caller sends `tieRefundWei` G$
        // to the player after the resolveMatch tx confirms. Each side
        // ends up net -2% (the protocol fee), no asymmetric edge either way.
        const refund = tieRefundFor(wager);
        console.log(chalk.yellow(`🤝 TIE (${tieReason}). On chain → AI; refund ${formatEther(refund)} G$ to player.`));
        return { winner: p2 as `0x${string}`, isTie: true, tieRefundWei: refund, tieReason };
    }

    return {
        winner: (p1Wins ? p1 : p2) as `0x${string}`,
        isTie: false,
        tieRefundWei: 0n,
        tieReason: '',
    };
}

startAgent();
