import { createWalletClient, http, publicActions, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import chalk from 'chalk';

// MARKOV's on-chain reputation hook.
//   When the agent resolves a match, it dispatches a non-blocking
//   `match_completed` attestation through this oracle to the ERC-8004
//   Feedback Registry on Celo. Each resolved match becomes one feedback
//   row tied back to MARKOV (token 6386) on 8004scan.
//
//   The agent's own wallet can't submit (the registry reverts with
//   "Self-feedback not allowed") so we use a dedicated Oracle EOA whose
//   key lives in FEEDBACK_ORACLE_KEY. The Oracle is funded once from the
//   agent wallet via agent/setup_feedback_oracle.cjs.
//
//   This call must NEVER block the resolve flow. Wrapped at the caller
//   in try/catch; any failure here just logs and returns.

const FEEDBACK_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as const;
const AGENT_ID = 6386n;
const ENDPOINT = 'https://celoscan.io/address/0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE';

const FEEDBACK_ABI = [
    { type: 'function', name: 'giveFeedback', stateMutability: 'nonpayable',
      inputs: [
        { name: 'agentId', type: 'uint256' },
        { name: 'score', type: 'int128' },
        { name: 'scoreDecimals', type: 'uint8' },
        { name: 'tag1', type: 'string' },
        { name: 'tag2', type: 'string' },
        { name: 'endpoint', type: 'string' },
        { name: 'feedbackURI', type: 'string' },
        { name: 'feedbackHash', type: 'bytes32' },
      ], outputs: [] },
] as const;

const GAME_TAG: Record<number, string> = { 0: 'rps', 1: 'dice', 2: 'coinflip' };

export type MatchOutcomeAttestation = {
    matchId: bigint;
    gameType: number;
    // 'markov' = agent won outright; 'player' = challenger won; 'tie' = tie/refund
    outcome: 'markov' | 'player' | 'tie';
};

let cachedOracleClient: ReturnType<typeof buildOracleClient> | null = null;
function buildOracleClient() {
    const key = process.env.FEEDBACK_ORACLE_KEY as `0x${string}` | undefined;
    if (!key) return null;
    const account = privateKeyToAccount(key);
    const client = createWalletClient({
        account,
        chain: celo,
        transport: http(process.env.CELO_RPC_URL || 'https://forno.celo.org'),
    }).extend(publicActions);
    return { account, client };
}

/**
 * Fire-and-forget match attestation. Caller should NOT await this from a
 * latency-critical path · just spawn it and move on. Internally it logs
 * success/failure but never throws.
 */
export function attestMatchCompleted(att: MatchOutcomeAttestation): void {
    void doAttest(att).catch(() => { /* doAttest already logs */ });
}

async function doAttest(att: MatchOutcomeAttestation): Promise<void> {
    if (!cachedOracleClient) cachedOracleClient = buildOracleClient();
    if (!cachedOracleClient) {
        // Oracle not configured · silently no-op so dev environments aren't noisy.
        return;
    }
    const { account, client } = cachedOracleClient;
    const tag2 = GAME_TAG[att.gameType] ?? `gametype_${att.gameType}`;
    // Scoring: clear winner → 95, tie/refund → 80. Leaves room above for
    // hand-curated higher scores from real raters via 8004scan UI.
    const score = att.outcome === 'tie' ? 80n : 95n;
    const fbHash = keccak256(encodePacked(['string', 'uint256', 'uint256'], ['MARKOV', AGENT_ID, att.matchId]));

    try {
        const hash = await client.writeContract({
            address: FEEDBACK_REGISTRY,
            abi: FEEDBACK_ABI,
            functionName: 'giveFeedback',
            args: [AGENT_ID, score, 0, 'match_completed', tag2, ENDPOINT, '', fbHash],
        });
        const r = await client.waitForTransactionReceipt({ hash });
        if (r.status === 'success') {
            console.log(chalk.cyan(`📡 8004 feedback emitted for match #${att.matchId} (${tag2}, ${att.outcome}) · ${hash.slice(0, 10)}...`));
        } else {
            console.warn(chalk.yellow(`8004 feedback reverted for match #${att.matchId}`));
        }
    } catch (e: any) {
        // Common failure: oracle out of CELO. Log loudly so it's visible in
        // the agent stream but never crash the resolve flow.
        console.warn(chalk.yellow(`8004 feedback failed for match #${att.matchId} from ${account.address}: ${e?.shortMessage ?? e?.message ?? e}`));
    }
}
