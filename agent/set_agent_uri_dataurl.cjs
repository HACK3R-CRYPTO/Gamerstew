const { createWalletClient, http, publicActions, getAddress } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { celo } = require('viem/chains');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Sets tokenURI of MARKOV (Token #6386) to a base64 data URI embedding
// the live markov.json. Content-addressed → clears 8004scan WA040.

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_ID = 6386n;
const JSON_PATH = path.join(__dirname, '..', 'frontend', 'public', 'agent', 'markov.json');
const EXPECTED_OWNER = '0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1';

const ABI = [
  { type: 'function', name: 'setAgentURI', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'newURI', type: 'string' }],
    outputs: [] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }] },
];

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in env.');
    process.exit(1);
  }

  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  // Parse + re-stringify (compact) so any local whitespace doesn't change the on-chain bytes.
  const minified = JSON.stringify(JSON.parse(raw));
  const base64 = Buffer.from(minified, 'utf8').toString('base64');
  const NEW_URI = `data:application/json;base64,${base64}`;
  console.log('Source file:', JSON_PATH);
  console.log('Minified JSON bytes:', minified.length);
  console.log('base64 length:', base64.length);
  console.log('Data URI length:', NEW_URI.length);

  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const client = createWalletClient({
    account,
    chain: celo,
    transport: http('https://forno.celo.org'),
  }).extend(publicActions);

  console.log('Signer:', account.address);
  if (getAddress(account.address) !== getAddress(EXPECTED_OWNER)) {
    console.error(`\nSigner mismatch — expected ${EXPECTED_OWNER}.`);
    process.exit(1);
  }

  const current = await client.readContract({
    address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [AGENT_ID],
  });
  const currentSummary = current.startsWith('data:') ? `${current.slice(0, 40)}... (${current.length} chars)` : current;
  console.log('Current tokenURI:', currentSummary);
  console.log('New tokenURI:    ', `${NEW_URI.slice(0, 40)}... (${NEW_URI.length} chars)`);

  if (current === NEW_URI) {
    console.log('\nAlready set. No-op.');
    return;
  }

  console.log('\nSending setAgentURI tx...');
  const hash = await client.writeContract({
    address: REGISTRY,
    abi: ABI,
    functionName: 'setAgentURI',
    args: [AGENT_ID, NEW_URI],
  });
  console.log('tx hash:', hash);

  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log('status:', receipt.status, '· block:', receipt.blockNumber.toString(), '· gas used:', receipt.gasUsed.toString());

  // Re-read against the same node we wrote through (avoids the read-after-write
  // propagation lag we saw last time when Forno fan-out hit a lagging backend).
  await new Promise(r => setTimeout(r, 3000));
  const verify = await client.readContract({
    address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [AGENT_ID],
  });
  const match = verify === NEW_URI;
  console.log('Verified tokenURI matches:', match);
  if (!match) {
    console.log('  · on-chain returned:', verify.slice(0, 60), '...');
    console.log('  · expected:        ', NEW_URI.slice(0, 60), '...');
    console.log('  (RPC propagation lag is normal — try `cast call ... tokenURI ...` in ~10s)');
  }
  console.log('\nDone. Refresh 8004scan in ~5-15 min. WA040 should clear.');
}

main().catch((e) => { console.error(e); process.exit(1); });
