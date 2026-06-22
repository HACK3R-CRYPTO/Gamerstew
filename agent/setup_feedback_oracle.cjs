const { createWalletClient, http, publicActions, parseEther, formatEther } = require('viem');
const { privateKeyToAccount, generatePrivateKey } = require('viem/accounts');
const { celo } = require('viem/chains');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// One-shot Oracle wallet setup.
//   1. If FEEDBACK_ORACLE_KEY is already in .env, no-op (already initialised).
//   2. Otherwise: generate a fresh wallet, send 0.5 CELO from the agent wallet,
//      append FEEDBACK_ORACLE_KEY to agent/.env so subsequent scripts pick it up.
//
// Why we need it: the ERC-8004 Feedback Registry reverts with
// "Self-feedback not allowed" when msg.sender owns the agent token.
// MARKOV is owned by the agent wallet, so we need a different EOA to submit.
//
// Funding amount: 0.5 CELO ≈ $0.20 at current price · enough for ~10,000
// feedback txs on Celo (gas per tx ~100k @ 0.5 gwei).

const FUND_AMOUNT = parseEther('0.5');
const ENV_PATH = path.join(__dirname, '.env');

async function main() {
  if (process.env.FEEDBACK_ORACLE_KEY) {
    const oracle = privateKeyToAccount(process.env.FEEDBACK_ORACLE_KEY);
    console.log('Oracle already initialised:', oracle.address);
    const client = createWalletClient({ account: oracle, chain: celo, transport: http('https://forno.celo.org') }).extend(publicActions);
    const bal = await client.getBalance({ address: oracle.address });
    console.log('Balance:', formatEther(bal), 'CELO');
    if (bal < parseEther('0.05')) {
      console.warn('⚠ low balance · consider topping up from agent wallet');
    }
    return;
  }

  if (!process.env.PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY (agent wallet) in env. Need it to fund the new oracle.');
    process.exit(1);
  }

  const agent = privateKeyToAccount(process.env.PRIVATE_KEY);
  const client = createWalletClient({ account: agent, chain: celo, transport: http('https://forno.celo.org') }).extend(publicActions);

  // Generate fresh oracle wallet.
  const oracleKey = generatePrivateKey();
  const oracle = privateKeyToAccount(oracleKey);
  console.log('Generated Oracle wallet:', oracle.address);

  const agentBal = await client.getBalance({ address: agent.address });
  console.log('Agent wallet balance:', formatEther(agentBal), 'CELO');
  if (agentBal < FUND_AMOUNT + parseEther('0.01')) {
    console.error(`Agent wallet too low to fund oracle with ${formatEther(FUND_AMOUNT)} CELO`);
    process.exit(1);
  }

  console.log(`Funding oracle with ${formatEther(FUND_AMOUNT)} CELO from agent wallet...`);
  const hash = await client.sendTransaction({ to: oracle.address, value: FUND_AMOUNT });
  console.log('Funding tx:', hash);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log('Funding status:', receipt.status, '· block:', receipt.blockNumber.toString());

  // Append to .env so future runs pick it up automatically.
  const line = `\n# Feedback Oracle wallet · used to submit ERC-8004 feedback on behalf of MARKOV\nFEEDBACK_ORACLE_KEY=${oracleKey}\nFEEDBACK_ORACLE_ADDR=${oracle.address}\n`;
  fs.appendFileSync(ENV_PATH, line);
  console.log(`\n✅ Wrote FEEDBACK_ORACLE_KEY to ${ENV_PATH}`);
  console.log(`Oracle address: ${oracle.address}`);
  console.log(`\nNext: run "FEEDBACK_PRIVATE_KEY=$FEEDBACK_ORACLE_KEY node submit_feedback.cjs" or use the backfill script.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
