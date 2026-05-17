import { createPublicClient, createWalletClient, http, parseAbiItem, formatEther, parseEther, parseAbi, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import chalk from 'chalk';
import * as fs from 'fs';
import { MoltbookService } from './services/MoltbookService.js';

dotenv.config();
dotenv.config({ path: '../contracts/.env' });

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

const ERC20_ABI = parseAbi(["function transferAndCall(address to, uint256 value, bytes data) external returns (bool)", "function balanceOf(address account) external view returns (uint256)"]);

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
    transport: http('https://forno.celo.org'),
});


const walletClient = createWalletClient({
    account,
    chain: CELO_MAINNET,
    transport: http('https://forno.celo.org'),
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
class OpponentModel {
    // transitions[gameType][playerAddress][prevMove][nextMove] = count
    transitions: Record<number, Record<string, number[][]>> = {};
    history: Record<number, Record<string, number>> = {};
    // Player's overall move histogram (not just transitions). Used as a
    // fallback signal when the transition row is empty.
    histograms: Record<number, Record<string, number[]>> = {};
    // Total matches we've seen per player — gates cold-start fallback.
    seen: Record<number, Record<string, number>> = {};
    matchCount: number = 0;
    wins: Record<string, number> = {};

    update(gameType: number, player: string, move: number) {
        if (!this.transitions[gameType]) this.transitions[gameType] = {};
        if (!this.history[gameType])     this.history[gameType] = {};
        if (!this.histograms[gameType])  this.histograms[gameType] = {};
        if (!this.seen[gameType])        this.seen[gameType] = {};

        // Game type move counts: RPS=3, Dice=6, Coin=2
        const size = gameType === 0 ? 3 : gameType === 1 ? 6 : 2;

        if (!this.transitions[gameType][player]) {
            this.transitions[gameType][player] = Array.from({ length: size }, () => Array(size).fill(0));
        }
        if (!this.histograms[gameType][player]) {
            this.histograms[gameType][player] = Array(size).fill(0);
        }

        // Always update the histogram (every move counts).
        if (move < size) {
            const histRow = this.histograms[gameType]![player]!;
            histRow[move] = (histRow[move] ?? 0) + 1;
            this.seen[gameType]![player] = (this.seen[gameType]![player] ?? 0) + 1;
        }

        // Update transitions only after we have a previous move.
        const lastMove = this.history[gameType][player];
        if (lastMove !== undefined && lastMove < size && move < size) {
            const p = this.transitions[gameType]![player];
            if (p) {
                const row = p[lastMove];
                if (row) {
                    row[move] = (row[move] || 0) + 1;
                }
            }
            this.matchCount++;
            if (!this.wins[player]) this.wins[player] = 0;
        }
        this.history[gameType][player] = move;
    }

    // Returns the player's predicted next move, OR null when we don't have
    // enough signal (prediction quality too low). Callers should fall back to
    // a noise distribution in that case.
    predictNext(gameType: number, player: string): { move: number; confidence: number } | null {
        const size = gameType === 0 ? 3 : gameType === 1 ? 6 : 2;
        const lastMove = this.history[gameType]?.[player];
        const trans = this.transitions[gameType]?.[player];
        const hist = this.histograms[gameType]?.[player];
        const totalSeen = this.seen[gameType]?.[player] ?? 0;

        // Try transition-based prediction first.
        if (lastMove !== undefined && trans && trans[lastMove]) {
            const counts = trans[lastMove]!;
            const total = counts.reduce((a, b) => a + b, 0);
            if (total >= 2) {
                let best = 0;
                for (let i = 1; i < size; i++) {
                    if (counts[i]! > counts[best]!) best = i;
                }
                return { move: best, confidence: counts[best]! / total };
            }
        }

        // Fall back to histogram (overall bias).
        if (hist && totalSeen >= 3) {
            let best = 0;
            for (let i = 1; i < size; i++) {
                if (hist[i]! > hist[best]!) best = i;
            }
            return { move: best, confidence: hist[best]! / totalSeen };
        }

        return null;
    }

    // Main decision function. Returns a 0-indexed move suitable for the
    // contract (caller converts to Dice 1-6 if needed).
    predict(gameType: number, player: string): number {
        const size = gameType === 0 ? 3 : gameType === 1 ? 6 : 2;
        const prediction = this.predictNext(gameType, player);

        // ─── Cold start ────────────────────────────────────────────────────
        if (!prediction) {
            return this.coldStart(gameType, size);
        }

        // ─── RPS — the main game ───────────────────────────────────────────
        if (gameType === 0) {
            const counter      = (prediction.move + 1) % 3;   // beats predicted
            const metaCounter  = (prediction.move + 2) % 3;   // beats the counter
            const random       = Math.floor(Math.random() * 3);

            // Lower-confidence predictions = more randomness. When the model
            // is confident we lean hard on counter; when uncertain we mix
            // more random so we don't telegraph the same move repeatedly.
            const r = Math.random();
            if (prediction.confidence >= 0.6) {
                // High confidence: 75% counter, 15% meta, 10% random
                return r < 0.75 ? counter : r < 0.90 ? metaCounter : random;
            }
            // Lower confidence: 60% counter, 20% meta, 20% random
            return r < 0.60 ? counter : r < 0.80 ? metaCounter : random;
        }

        // ─── Coin flip — pick opposite of predicted ──────────────────────
        if (gameType === 3) {
            const opposite = 1 - prediction.move;
            // 80% opposite, 20% random — entropy floor against pattern exploiters.
            return Math.random() < 0.80 ? opposite : Math.floor(Math.random() * 2);
        }

        // ─── Dice — kept from previous strategy, favor high ──────────────
        if (gameType === 1) {
            return Math.random() > 0.3 ? 5 : Math.floor(Math.random() * 6);
        }

        return Math.floor(Math.random() * size);
    }

    // Cold-start strategy when we have no prior signal on this player.
    // For RPS we exploit the well-documented opening bias toward rock.
    coldStart(gameType: number, size: number): number {
        if (gameType === 0) {
            // Humans play rock ~41% on first round. Paper beats rock.
            // Mix: 45% paper (beats rock), 30% scissors (beats paper),
            // 25% rock (beats scissors) — still has variety, but tilted.
            const r = Math.random();
            return r < 0.45 ? 1 : r < 0.75 ? 2 : 0;
        }
        if (gameType === 3) {
            // Heads is the modal first call (~52%). Counter with tails.
            return Math.random() < 0.55 ? 1 : 0;
        }
        return Math.floor(Math.random() * size);
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
//      match until the next UTC day rolls over. Protects against cold
//      streaks and coordinated multi-wallet sharks.
//
//   2. Per-wallet daily loss cap. If a SINGLE wallet has won more than
//      WALLET_DAILY_LOSS_CAP from MARKOV today, agent refuses to accept
//      further matches from that wallet. Protects against a single shark
//      farming the agent.
//
// State is persisted to disk every recordOutcome() call so an agent
// restart can't be used to reset the caps. File: ./.loss-cap-state.json
// (gitignored). On boot, state is loaded only if it's still today's day-
// key — yesterday's snapshot is discarded and counters start fresh.
class LossCapTracker {
    // Defaults — tunable via env vars without redeploy.
    private readonly GLOBAL_CAP_WEI: bigint = parseEther(process.env.GLOBAL_DAILY_LOSS_CAP ?? "100");
    private readonly WALLET_CAP_WEI: bigint = parseEther(process.env.WALLET_DAILY_LOSS_CAP ?? "50");
    private readonly STATE_FILE = "./.loss-cap-state.json";

    private currentDayKey: string = "";
    private totalLossWei: bigint = 0n;
    private walletLossWei: Map<string, bigint> = new Map();
    // Track which matches we've already counted so a duplicate
    // recordOutcome (e.g. on retry) can't double-charge the counters.
    private countedMatches: Set<string> = new Set();

    constructor() {
        this.rolloverIfNeeded();
        this.load();
    }

    private dayKey(): string {
        return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    }

    private rolloverIfNeeded(): void {
        const key = this.dayKey();
        if (key !== this.currentDayKey) {
            if (this.currentDayKey !== "") {
                console.log(chalk.cyan(`📅 New day (${key}) — loss caps reset.`));
            }
            this.currentDayKey = key;
            this.totalLossWei = 0n;
            this.walletLossWei.clear();
            this.countedMatches.clear();
        }
    }

    private load(): void {
        try {
            if (!fs.existsSync(this.STATE_FILE)) return;
            const raw = fs.readFileSync(this.STATE_FILE, "utf-8");
            const data = JSON.parse(raw);
            if (data?.day !== this.dayKey()) {
                // Stale day — discard.
                return;
            }
            this.currentDayKey = data.day;
            this.totalLossWei = BigInt(data.totalLossWei ?? "0");
            this.walletLossWei = new Map(
                Object.entries(data.walletLossWei ?? {}).map(([k, v]) => [k, BigInt(v as string)])
            );
            this.countedMatches = new Set(data.countedMatches ?? []);
            console.log(chalk.gray(`Loaded loss-cap state: today's total = ${formatEther(this.totalLossWei)} G$ across ${this.walletLossWei.size} wallets.`));
        } catch (e: any) {
            console.warn(chalk.yellow(`Could not load loss-cap state: ${e.message}`));
        }
    }

    private persist(): void {
        try {
            const data = {
                day: this.currentDayKey,
                totalLossWei: this.totalLossWei.toString(),
                walletLossWei: Object.fromEntries(
                    Array.from(this.walletLossWei.entries()).map(([k, v]) => [k, v.toString()])
                ),
                countedMatches: Array.from(this.countedMatches),
            };
            fs.writeFileSync(this.STATE_FILE, JSON.stringify(data));
        } catch (e: any) {
            console.warn(chalk.yellow(`Could not persist loss-cap state: ${e.message}`));
        }
    }

    /**
     * Called before acceptMatch. Returns null if the match can be accepted,
     * or a reason string if a cap would be exceeded by this wager.
     */
    canAccept(challenger: string, wager: bigint): string | null {
        this.rolloverIfNeeded();

        // Global cap — would this match push us past the daily ceiling?
        if (this.totalLossWei + wager > this.GLOBAL_CAP_WEI) {
            return `GLOBAL daily loss cap reached (${formatEther(this.totalLossWei)}/${formatEther(this.GLOBAL_CAP_WEI)} G$ lost today). Pausing until next UTC day.`;
        }

        const lcChal = challenger.toLowerCase();
        const walletLoss = this.walletLossWei.get(lcChal) ?? 0n;
        if (walletLoss + wager > this.WALLET_CAP_WEI) {
            return `WALLET cap reached for ${challenger.slice(0, 8)}.. (${formatEther(walletLoss)}/${formatEther(this.WALLET_CAP_WEI)} G$ won from MARKOV today).`;
        }

        return null;
    }

    /**
     * Called after resolveMatch on chain. Charges the agent's loss against
     * both caps only when the player won (i.e. agent lost its wager).
     */
    recordOutcome(matchId: bigint, challenger: string, agentWon: boolean, wager: bigint): void {
        this.rolloverIfNeeded();

        const key = matchId.toString();
        if (this.countedMatches.has(key)) return;
        this.countedMatches.add(key);

        if (!agentWon) {
            this.totalLossWei += wager;
            const lcChal = challenger.toLowerCase();
            this.walletLossWei.set(lcChal, (this.walletLossWei.get(lcChal) ?? 0n) + wager);
            console.log(chalk.gray(`📊 Loss cap: +${formatEther(wager)} G$ (player ${challenger.slice(0, 8)}..). Today total = ${formatEther(this.totalLossWei)}/${formatEther(this.GLOBAL_CAP_WEI)} G$. This wallet = ${formatEther(this.walletLossWei.get(lcChal) ?? 0n)}/${formatEther(this.WALLET_CAP_WEI)} G$.`));
        }

        this.persist();
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

            const txHash = await walletClient.writeContract({
                address: REGISTRY_ADDRESS,
                abi: ERC8004_ABI,
                functionName: 'register',
                args: [ipfsUri],
                chain: CELO_MAINNET,
                account
            });
            console.log(chalk.green(`✅ Agent Registered! TX: ${txHash}`));
        } else {
            console.log(chalk.green('✅ Agent already registered (EIP-8004).'));
        }
    } catch (e) {
        console.log(chalk.gray('EIP-8004 registration check... (skipping if failed)'));
    }

    console.log(chalk.gray(`Wallet: ${account.address} | Platform: ${ARENA_ADDRESS}`));

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
    const capReject = lossCap.canAccept(challenger, wager);
    if (capReject) {
        console.log(chalk.yellow(`Match #${matchId} not accepted: ${capReject}`));
        processingAcceptance.delete(matchId.toString());
        return;
    }

    try {
        const encodedArgs = encodeAbiParameters(
            [{ type: 'uint8' }, { type: 'uint256' }],
            [1, matchId]
        );
        const { request } = await publicClient.simulateContract({
            address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: 'transferAndCall', args: [ARENA_ADDRESS, wager, encodedArgs], account
        });
        const hash = await walletClient.writeContract(request);
        console.log(chalk.green(`Match #${matchId} accepted! Hash: ${hash}`));
        await publicClient.waitForTransactionReceipt({ hash });

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

        const aiMove = model.predict(gameType, opponentAddr);
        let moveToSend = aiMove;

        let moveLabel = 'Strategic';
        if (gameType === 0) moveLabel = ['Rock', 'Paper', 'Scissors'][aiMove] || 'Unknown';
        else if (gameType === 1) { moveLabel = `Dice ${aiMove + 1}`; moveToSend = aiMove + 1; }
        else if (gameType === 3) moveLabel = ['Heads', 'Tails'][aiMove] || 'Unknown';

        console.log(chalk.yellow(`Submitting Move (${moveLabel})...`));

        const { request } = await publicClient.simulateContract({
            address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'playMove',
            args: [matchId, moveToSend], account
        });
        const hash = await walletClient.writeContract(request);
        console.log(chalk.gray(`TX: ${hash}`));
        await publicClient.waitForTransactionReceipt({ hash });

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

        const winner = determineWinner(m.gameType, m.challenger, challengerMove, m.opponent, opponentMove);


        const { request } = await publicClient.simulateContract({
            address: ARENA_ADDRESS, abi: ARENA_ABI, functionName: 'resolveMatch',
            args: [matchId, winner as `0x${string}`], account
        });
        const hash = await walletClient.writeContract(request);
        console.log(chalk.green(`✅ Match #${matchId} Resolved! Winner: ${winner === m.challenger ? 'Challenger' : 'Opponent'} (${winner})`));

        // Loss-cap accounting. Compare winner to the agent's own address to
        // decide if the agent won this match. recordOutcome only counts when
        // the agent lost (player won), so cap state stays accurate.
        const agentWon = winner.toLowerCase() === account.address.toLowerCase();
        lossCap.recordOutcome(matchId, m.challenger, agentWon, m.wager);

        // Social Update: Match Result
        await moltbook.postMatchResult(
            matchId.toString(),
            m.challenger,
            m.opponent,
            winner,
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

function determineWinner(gameType: number, p1: string, m1: number, p2: string, m2: number): string {
    let p1Wins = false;
    let isTie = false;

    if (gameType === 0) { // RPS
        if (m1 === m2) isTie = true;
        else if ((m1 === 0 && m2 === 2) || (m1 === 1 && m2 === 0) || (m1 === 2 && m2 === 1)) p1Wins = true;
    } else if (gameType === 1) { // Dice
        if (m1 === m2) isTie = true;
        else if (m1 > m2) p1Wins = true;
    } else if (gameType === 3) { // Coin Flip
        // Oracle Flip — the third hand of coin flip. Both players call a
        // side, the oracle "flips," whoever matched it wins. For sustainable
        // house economics:
        //   - Both right     → AI (p2) wins. Both made the correct call, but
        //                       the house keeps the edge — otherwise every
        //                       same-side call would tie to the player and
        //                       drain the treasury.
        //   - Both wrong     → tie → player (p1) wins. Consolation prize
        //                       for both missing — preserves the player-
        //                       first feel on collective failure.
        //   - p1 right only  → player wins.
        //   - p2 right only  → AI wins.
        //
        // NOTE: This currently uses Math.random() as the oracle. Ideally
        // we'd use a verifiable on-chain source (blockhash, VRF) so the
        // outcome is auditable. Tracked as post-hackathon work.
        const oracleFlip = Math.random() > 0.5 ? 1 : 0; // 0=Heads, 1=Tails
        console.log(chalk.gray(`🔮 Oracle Flip: ${oracleFlip === 0 ? 'Heads' : 'Tails'}`));

        const p1Correct = m1 === oracleFlip;
        const p2Correct = m2 === oracleFlip;

        if (p1Correct && p2Correct) {
            // Both called the oracle correctly. House takes it.
            p1Wins = false;
            console.log(chalk.gray(`Both correct — AI wins on house-edge tie rule.`));
        } else if (!p1Correct && !p2Correct) {
            // Both missed. Player-first consolation.
            isTie = true;
            console.log(chalk.gray(`Both wrong — player wins on consolation tie rule.`));
        } else if (p1Correct) {
            p1Wins = true;
        } else {
            p1Wins = false;
        }
    }

    if (isTie) {
        // On a tie, award the challenger (p1) — the human player initiates challenges,
        // so this avoids the confusing "you tied but lost" experience.
        console.log(chalk.yellow(`🤝 TIE detected! Awarding challenger (p1) on tie.`));
        return p1;
    }

    return p1Wins ? p1 : p2;
}

startAgent();
