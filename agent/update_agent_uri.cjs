const { createWalletClient, http, publicActions, getAddress } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { celo } = require('viem/chains');
require('dotenv').config();

// Updates the tokenURI of MARKOV (Token #6386) on the official ERC-8004
// registry so 8004scan's Publisher dimension can read rich metadata.

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_ID = 6386n;
const NEW_URI  = 'https://gamearenahq.xyz/agent/markov.json';
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
    console.error('Missing PRIVATE_KEY in env. Export it or add it to agent/.env');
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const client = createWalletClient({
    account,
    chain: celo,
    transport: http('https://forno.celo.org'),
  }).extend(publicActions);

  console.log('Signer:', account.address);
  if (getAddress(account.address) !== getAddress(EXPECTED_OWNER)) {
    console.error(`\nSigner mismatch — expected ${EXPECTED_OWNER} (the agent wallet that owns token ${AGENT_ID}).`);
    console.error('Use the PRIVATE_KEY from agent/.env (the one already used by register_agent_new.cjs / play_manual.cjs).');
    process.exit(1);
  }

  const onchainOwner = await client.readContract({
    address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [AGENT_ID],
  });
  console.log('On-chain owner:', onchainOwner);

  const currentURI = await client.readContract({
    address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [AGENT_ID],
  });
  console.log('Current tokenURI:', currentURI || '(empty)');
  console.log('New tokenURI:    ', NEW_URI);

  if (currentURI === NEW_URI) {
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
  console.log('status:', receipt.status, '· block:', receipt.blockNumber.toString());

  const verifyURI = await client.readContract({
    address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [AGENT_ID],
  });
  console.log('Verified tokenURI:', verifyURI);
  console.log('\nDone. Give 8004scan ~5-15 min to re-index, then refresh the Publisher dimension.');
}

main().catch((e) => { console.error(e); process.exit(1); });
