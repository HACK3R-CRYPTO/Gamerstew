// ─── ERC-8004 Feedback Oracle · Instant Arena edition ────────────────────────
// MARKOV's reputation on 8004scan is driven by feedback rows on the ERC-8004
// Feedback Registry. The original oracle lived in the agent process and fired
// after `resolveMatch` — but v3 Instant Arena matches settle server-side, so
// resolveMatch never fires for human play and the engagement stream dried up.
//
// This port re-anchors attestation to the Instant Arena completion hook:
// every finished best-of-5 match emits one `match_completed` feedback, with
// the match's commit hash folded into the deterministic feedbackHash so the
// attestation is tied to the verifiable seed receipt.
//
// Rules inherited from the agent-side oracle (see agent/src/feedbackOracle.ts
// and the 8004 playbook):
//   · MUST be sent from the dedicated Oracle EOA (FEEDBACK_ORACLE_KEY) ·
//     the agent/owner wallet is rejected on-chain ("Self-feedback not allowed").
//   · Minimal mode: empty feedbackURI + deterministic feedbackHash. Matches
//     the pattern of top-scoring agents; avoids the WF002 hash-mismatch noise.
//   · NEVER blocks or throws into the gameplay path · fire-and-forget only.
//
// New here: a min-interval throttle. Free matches are quick (a player can
// finish several in minutes) and reputation cadence beats reputation bursts ·
// the leaderboard-leading agents emit ~1/hour. Matches arriving inside the
// interval are skipped, not queued. Tune with FEEDBACK_MIN_INTERVAL_MS.

const { ethers } = require('ethers');

const FEEDBACK_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const AGENT_ID = 6386n;
// Attestations point at the playable surface · Instant Arena matches don't
// settle on the ArenaPlatform contract, their receipt is the commit-reveal
// seed, so the play URL is the honest endpoint.
const ENDPOINT = 'https://gamearenahq.xyz/games/challenge-ai';

const FEEDBACK_ABI = [
  'function giveFeedback(uint256 agentId, int128 score, uint8 scoreDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
];

const MIN_INTERVAL_MS = Number(process.env.FEEDBACK_MIN_INTERVAL_MS || 10 * 60 * 1000);

let oracle = null;          // { wallet, contract } once built
let initLogged = false;
let lastSentAt = 0;         // throttle anchor
let inFlight = false;       // serialize sends · avoids nonce races

function buildOracle() {
  const key = process.env.FEEDBACK_ORACLE_KEY;
  if (!key) {
    if (!initLogged) {
      console.warn('[8004] FEEDBACK_ORACLE_KEY not set · Instant Arena attestations will no-op. Add it to the games-backend Railway env to enable.');
      initLogged = true;
    }
    return null;
  }
  const provider = new ethers.JsonRpcProvider(process.env.CELO_RPC_URL || 'https://forno.celo.org');
  const wallet = new ethers.Wallet(key, provider);
  const contract = new ethers.Contract(FEEDBACK_REGISTRY, FEEDBACK_ABI, wallet);
  if (!initLogged) {
    console.log(`[8004] Feedback Oracle configured · attestor=${wallet.address}`);
    initLogged = true;
  }
  return { wallet, contract };
}

/**
 * Fire-and-forget attestation for a completed Instant Arena match.
 * Call from the onMatchComplete hook with the finished session · never await
 * from the gameplay path, never throws.
 *
 * @param {object} session · the completed engine session
 *   { matchId: string, commitHash: string, playerWins, aiWins }
 */
function attestInstantMatch(session) {
  void doAttest(session).catch(() => { /* doAttest logs internally */ });
}

async function doAttest(session) {
  if (!oracle) oracle = buildOracle();
  if (!oracle) return;

  // Throttle: keep a steady cadence instead of burst-emitting when one
  // player rips through their daily free matches. Skipped matches are
  // fine · engagement scoring rewards a continuous stream, not volume.
  const now = Date.now();
  if (now - lastSentAt < MIN_INTERVAL_MS || inFlight) return;
  lastSentAt = now;
  inFlight = true;

  try {
    const outcome =
      session.playerWins > session.aiWins ? 'player' :
      session.aiWins > session.playerWins ? 'markov' : 'tie';
    // Same scoring the wager-era oracle used: decisive match 95, tie 80.
    const score = outcome === 'tie' ? 80n : 95n;
    // Deterministic hash binds the attestation to THIS match's verifiable
    // receipt · matchId is the engine's string id, commitHash is the
    // pre-round-1 seed commitment any player can replay against.
    const fbHash = ethers.keccak256(
      ethers.solidityPacked(
        ['string', 'uint256', 'string', 'bytes32'],
        ['MARKOV', AGENT_ID, String(session.matchId), session.commitHash],
      ),
    );

    const tx = await oracle.contract.giveFeedback(
      AGENT_ID, score, 0, 'match_completed', 'instant_rps', ENDPOINT, '', fbHash,
    );
    const rcpt = await tx.wait();
    if (Number(rcpt.status) === 1) {
      console.log(`📡 8004 feedback emitted for instant match ${session.matchId} (${outcome}) · ${tx.hash.slice(0, 10)}…`);
    } else {
      console.warn(`[8004] feedback reverted for instant match ${session.matchId}`);
    }
  } catch (e) {
    // Most common failure: oracle wallet out of CELO. Loud log, no crash.
    console.warn(`[8004] feedback failed for instant match ${session.matchId}: ${e?.shortMessage || e?.message || e}`);
  } finally {
    inFlight = false;
  }
}

module.exports = { attestInstantMatch };
