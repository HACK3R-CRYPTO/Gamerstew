// Player-signed ERC-8004 feedback for MARKOV (token #6386).
//
// The agent already emits one feedback per resolved match via its own
// Oracle wallet. That counts as 1 counterparty on 8004scan no matter
// how many real humans played, which reads as a Sybil pump under the
// v5.2 scoring algorithm.
//
// This module lets the PLAYER's wallet emit a second feedback after
// every match they finish · one human, one feedback, one distinct
// counterparty in the registry. Fires fire-and-forget through whatever
// signer the player came in on (MiniPay, Privy embedded, MetaMask) so
// the latency stays off the UI. If it fails, the Oracle attestation
// from the agent still lands · we keep the safety net.

import { parseAbi } from 'viem';

export const FEEDBACK_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as const;
export const MARKOV_AGENT_ID = 6386n;

// Static endpoint pointed at the live wager surface. 8004scan renders
// this as a clickable link from the agent profile so anyone auditing
// MARKOV can land on the actual play page in one tap.
const ENDPOINT_BASE = 'https://gamearenahq.xyz/games/challenge-ai';

export const FEEDBACK_ABI = parseAbi([
    'function giveFeedback(uint256 agentId, int128 score, uint8 scoreDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external',
]);

export type RoundOutcome = 'win' | 'lose' | 'tie';
export type GameTag = 'rps' | 'coinflip';

const ZERO_HASH = ('0x' + '0'.repeat(64)) as `0x${string}`;

// Score logic mirrors the agent's oracle attestation in
// agent/src/feedbackOracle.ts so player + oracle feedback for the same
// match agree on the score: 95 for a decisive outcome (either side
// clearly won), 80 for tie / refund.
export function buildFeedbackArgs(opts: {
    matchId: bigint;
    outcome: RoundOutcome;
    gameTag: GameTag;
}) {
    const score: bigint = opts.outcome === 'tie' ? 80n : 95n;
    return [
        MARKOV_AGENT_ID,
        score,
        0,
        'match_completed',
        opts.gameTag,
        `${ENDPOINT_BASE}/match/${opts.matchId.toString()}`,
        '',
        ZERO_HASH,
    ] as const;
}
