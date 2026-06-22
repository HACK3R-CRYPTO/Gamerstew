const { createWalletClient, http, publicActions, keccak256, toBytes, getAddress } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { celo } = require('viem/chains');
require('dotenv').config();

// Submits a single ERC-8004 Feedback Registry tx for MARKOV (token 6386).
// Use directly for one-offs, or import as a module from the backfill script.
//
// Function signature (decoded from prior on-chain feedback):
//   giveFeedback(
//     uint256 agentId,
//     int128  score,           // 0-100 (or -100 to 100)
//     uint8   scoreDecimals,   // 0 for plain ints
//     string  tag1,            // primary tag
//     string  tag2,            // optional sub-tag
//     string  endpoint,        // optional URL the feedback is about
//     string  feedbackURI,     // data: URI carrying the offchain JSON
//     bytes32 feedbackHash     // keccak256 of the offchain JSON content
//   )

const FEEDBACK_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const AGENT_REGISTRY    = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_ID          = 6386n;
const CHAIN_ID          = 42220;

const ABI = [
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
    ],
    outputs: [] },
];

function buildFeedbackPayload({ tag1, tag2 = '', score, comment = null, submitterAddress }) {
  // Match the v3.0 format observed in existing 8004scan feedback parses.
  // Field order in the JSON matters for hash determinism — emit a stable shape.
  const offchain = {
    tag1,
    tag2,
    value: score,
    agentId: Number(AGENT_ID),
    comment,
    version: "3.0",
    createdAt: new Date().toISOString(),
    agentRegistry: `eip155:${CHAIN_ID}:${getAddress(AGENT_REGISTRY)}`,
    clientAddress: `eip155:${CHAIN_ID}:${getAddress(submitterAddress)}`,
    valueDecimals: 0,
  };
  const offchainJson = JSON.stringify(offchain);
  const feedbackURI  = `data:application/json;base64,${Buffer.from(offchainJson, 'utf8').toString('base64')}`;
  const feedbackHash = keccak256(toBytes(offchainJson));
  return { offchain, offchainJson, feedbackURI, feedbackHash };
}

async function submitFeedback({ privateKey, tag1, tag2 = '', score, comment = null, endpoint = '', minimal = true, verbose = false }) {
  if (!privateKey) throw new Error('privateKey required');
  if (typeof score !== 'number' || score < -100 || score > 100) {
    throw new Error(`score out of range: ${score}`);
  }

  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: celo,
    transport: http('https://forno.celo.org'),
  }).extend(publicActions);

  // Minimal mode mirrors how high-volume feedback wallets on 8004scan submit:
  // no offchain URI, no hash. Saves gas, avoids the WF002 hash-mismatch
  // parse warning, lets us pipe a comment via the tag fields if we want.
  // Rich mode emits a full offchain JSON blob with a comment field.
  let feedbackURI = '';
  let feedbackHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
  let offchain = null;
  if (!minimal) {
    const built = buildFeedbackPayload({ tag1, tag2, score, comment, submitterAddress: account.address });
    feedbackURI = built.feedbackURI;
    feedbackHash = built.feedbackHash;
    offchain = built.offchain;
  }

  if (verbose) {
    console.log('Submitter:', account.address, '· mode:', minimal ? 'minimal' : 'rich');
    console.log('Tags:', tag1, tag2 ? `· ${tag2}` : '');
    console.log('Score:', score, '· Comment:', comment ?? '(none)');
  }

  const hash = await client.writeContract({
    address: FEEDBACK_REGISTRY,
    abi: ABI,
    functionName: 'giveFeedback',
    args: [AGENT_ID, BigInt(score), 0, tag1, tag2, endpoint, feedbackURI, feedbackHash],
  });

  const receipt = await client.waitForTransactionReceipt({ hash });
  if (verbose) console.log('tx:', hash, '· status:', receipt.status, '· gas:', receipt.gasUsed.toString());
  return { txHash: hash, receipt, offchain };
}

async function main() {
  // CLI mode: read params from env, submit ONE feedback. Default to an honest
  // "match_completed" tag from the agent wallet so we can ground-truth the
  // function call before scaling.
  const pk = process.env.FEEDBACK_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) { console.error('Set FEEDBACK_PRIVATE_KEY or PRIVATE_KEY in env'); process.exit(1); }

  const score = Number(process.env.FB_SCORE ?? '95');
  const tag1  = process.env.FB_TAG1 || 'match_completed';
  const tag2  = process.env.FB_TAG2 || 'rps';
  const comment = process.env.FB_COMMENT || 'GameArena match attestation';
  const endpoint = process.env.FB_ENDPOINT || 'https://gamearenahq.xyz/games/challenge-ai';

  const minimal = process.env.FB_MINIMAL !== '0';
  await submitFeedback({ privateKey: pk, tag1, tag2, score, comment, endpoint, minimal, verbose: true });
  console.log('\nDone. Check https://8004scan.io/agents/celo/6386 in ~30-60s.');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { submitFeedback, buildFeedbackPayload, FEEDBACK_REGISTRY, AGENT_ID, CHAIN_ID };
