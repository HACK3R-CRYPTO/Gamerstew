#!/usr/bin/env node
// ─── MARKOV Climb G$ payout ───────────────────────────────────────────────
// Sends the prize-pool G$ to top-3 qualified climbers in one batch.
// Source of truth: the public /api/markov-climb endpoint (same data the
// in-app card reads). The PRIZES table inside that endpoint is mirrored
// here so we can validate against drift before broadcasting any tx.
//
// USDC for 1st place is NOT handled by this script · USDC goes to a
// payment wallet the winner DMs after the announcement, which can be on
// any chain. Run a one-off send for that separately.
//
// Usage:
//   node scripts/payout-markov-climb.js              # dry-run · prints
//                                                    # plan, no tx sent
//   node scripts/payout-markov-climb.js --execute    # broadcasts the
//                                                    # G$ transfers
//
// Env required (reads frontend/.env.local by default):
//   VALIDATOR_PRIVATE_KEY  · signs the transfers + pays gas. Override
//                            with PAYOUT_PRIVATE_KEY if the prize-pool
//                            G$ lives on a different wallet.
//   CELO_RPC_URL           · optional; defaults to https://forno.celo.org
//   PAYOUT_API_URL         · optional; defaults to the live
//                            https://gamearenahq.xyz/api/markov-climb
//
// Safety:
//   - Default mode is dry-run · prints what WOULD be sent, exits cleanly.
//   - Live mode (--execute) requires a 5-second pause + final ABORT
//     window so a stray invocation doesn't accidentally drain the wallet.
//   - Aborts if the source wallet's G$ balance is below the total payout.
//   - Aborts if any recipient address is malformed.
//   - Prints every tx hash after broadcast so you can paste them into
//     the TG announcement.

const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

// Load .env.local from the frontend project · same secret file the rest
// of the team already maintains. Fallback to process.env so the script
// also works on CI / Railway shell.
try {
  // Script lives in games-backend/scripts/ · walk up to find env files.
  // Load ALL candidates (not just the first) so VALIDATOR_PRIVATE_KEY in
  // games-backend/.env merges with INTERNAL_SECRET in frontend/.env.local.
  // dotenv leaves already-set keys alone by default, so file order doesn't
  // matter for keys that exist in only one file.
  const candidates = [
    path.resolve(__dirname, '..', '..', 'frontend', '.env.local'),
    path.resolve(__dirname, '..', '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      require('dotenv').config({ path: p });
    }
  }
} catch {
  // dotenv isn't required for the script to function if env is already set.
}

const RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const API_URL = process.env.PAYOUT_API_URL || 'https://gamearenahq.xyz/api/markov-climb';
const PRIV_KEY = process.env.PAYOUT_PRIVATE_KEY || process.env.VALIDATOR_PRIVATE_KEY;

// G$ on Celo · matches frontend/lib/contracts.ts CONTRACT_ADDRESSES.G_TOKEN
const G_TOKEN_ADDR = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
const G_TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

// Prize table · MUST match the PRIZES const in
// frontend/app/api/markov-climb/route.ts. If you change one, change both.
const PRIZE_TABLE = [
  { rank: 1, badge: '🥇', g_dollar: 1000, usdc: 5 },
  { rank: 2, badge: '🥈', g_dollar: 500,  usdc: 0 },
  { rank: 3, badge: '🥉', g_dollar: 250,  usdc: 0 },
];

const DRY_RUN = !process.argv.includes('--execute');
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function bold(s) { return `\x1b[1m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }

async function main() {
  console.log(bold('\n━━━ MARKOV Climb · G$ payout ━━━\n'));
  console.log(`Mode:     ${DRY_RUN ? yellow('DRY-RUN (no tx will broadcast)') : red('LIVE EXECUTION')}`);
  console.log(`RPC:      ${RPC_URL}`);
  console.log(`Endpoint: ${API_URL}`);
  console.log(`G$:       ${G_TOKEN_ADDR}`);

  if (!PRIV_KEY) {
    console.error(red('\n✗ Missing PAYOUT_PRIVATE_KEY (or VALIDATOR_PRIVATE_KEY).'));
    console.error('  Add one to frontend/.env.local before running.');
    process.exit(1);
  }

  // Fetch the sealed leaderboard. The endpoint sets phase=ended after
  // the window closes; we use that as the gate so we don't accidentally
  // pay out from a still-live climb.
  console.log('\nFetching final standings…');
  const res = await fetch(API_URL, { headers: { 'User-Agent': 'payout-markov-climb' } });
  if (!res.ok) {
    console.error(red(`✗ API returned ${res.status}`));
    process.exit(1);
  }
  const data = await res.json();
  const phase = data?.event?.phase;
  if (phase !== 'ended') {
    console.error(red(`✗ Event phase is "${phase}", not "ended". Aborting · only pay out sealed events.`));
    process.exit(1);
  }

  // Top 3 by match count where qualified===true. The endpoint already
  // sorts descending by matches so we just slice and filter.
  const qualified = (data.leaderboard || []).filter(e => e.qualified).slice(0, 3);
  if (qualified.length === 0) {
    console.error(red('✗ No qualified players. Nothing to pay.'));
    process.exit(1);
  }

  // Pair each qualified player with their prize row from PRIZE_TABLE.
  const plan = qualified.map((p, i) => {
    const prize = PRIZE_TABLE[i];
    if (!ADDR_RE.test(p.wallet)) {
      console.error(red(`✗ Malformed wallet at rank ${i + 1}: ${p.wallet}`));
      process.exit(1);
    }
    return {
      rank: i + 1,
      badge: prize.badge,
      username: p.username || '(no name)',
      wallet: p.wallet,
      matches: p.matches,
      g_dollar: prize.g_dollar,
      usdc: prize.usdc,
    };
  });

  const totalG = plan.reduce((s, p) => s + p.g_dollar, 0);
  const totalUsdc = plan.reduce((s, p) => s + p.usdc, 0);

  console.log(`\n${bold('Plan (top 3 qualified):')}\n`);
  for (const p of plan) {
    const usdcLine = p.usdc > 0 ? `  +  $${p.usdc} USDC (out-of-script · DM-driven)` : '';
    console.log(`  ${p.badge} #${p.rank} ${bold(p.username)} · ${p.matches} matches`);
    console.log(`     → ${p.g_dollar} G$ → ${p.wallet}${usdcLine}`);
  }
  console.log(`\n${bold('Total G$ payout:')} ${totalG} G$`);
  if (totalUsdc > 0) {
    console.log(`${bold('Total USDC payout:')} $${totalUsdc} (manual, not in this script)`);
  }

  // Wire the wallet, check balance against required total.
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIV_KEY, provider);
  const gToken = new ethers.Contract(G_TOKEN_ADDR, G_TOKEN_ABI, wallet);

  console.log(`\nSource wallet: ${wallet.address}`);
  const [celoBalWei, gBalWei] = await Promise.all([
    provider.getBalance(wallet.address),
    gToken.balanceOf(wallet.address),
  ]);
  const celoBal = Number(ethers.formatEther(celoBalWei));
  // G$ is 18 decimals · same as ether scale, so formatEther is the right call.
  const gBal = Number(ethers.formatEther(gBalWei));
  console.log(`  CELO balance: ${celoBal.toFixed(4)} CELO (for gas)`);
  console.log(`  G$ balance:   ${gBal.toFixed(2)} G$`);

  if (gBal < totalG) {
    console.error(red(`\n✗ Source wallet has ${gBal.toFixed(2)} G$ · needs ${totalG} G$ for payout.`));
    process.exit(1);
  }
  if (celoBal < 0.05) {
    console.error(red(`\n✗ Source wallet has ${celoBal.toFixed(4)} CELO · low gas, may not cover 3 transfers.`));
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(green('\n✓ Dry-run complete. Re-run with --execute to broadcast.'));
    console.log('  Example: node scripts/payout-markov-climb.js --execute\n');
    return;
  }

  // 5-second ABORT window before broadcasting · catches accidental --execute.
  console.log(red(`\n⚠️  Broadcasting in 5 seconds. Ctrl+C to abort.`));
  await new Promise(r => setTimeout(r, 5000));

  console.log('\nBroadcasting transfers…\n');
  const results = [];
  for (const p of plan) {
    const amountWei = ethers.parseEther(String(p.g_dollar));
    try {
      const tx = await gToken.transfer(p.wallet, amountWei);
      console.log(`  ${p.badge} → ${p.username}  tx: ${tx.hash}  (pending)`);
      const receipt = await tx.wait();
      const ok = Number(receipt.status) === 1;
      results.push({ ...p, txHash: tx.hash, ok });
      console.log(`     ${ok ? green('✓ confirmed') : red('✗ FAILED on chain')}`);
    } catch (e) {
      console.error(red(`     ✗ transfer threw: ${e.message?.slice(0, 120)}`));
      results.push({ ...p, txHash: null, ok: false, error: e.message });
    }
  }

  // Final summary · paste-ready for the TG announcement.
  console.log(bold('\n━━━ Payout summary ━━━\n'));
  for (const r of results) {
    if (r.ok) {
      console.log(`  ${r.badge} ${r.username} · ${r.g_dollar} G$ · https://celoscan.io/tx/${r.txHash}`);
    } else {
      console.log(red(`  ${r.badge} ${r.username} · ${r.g_dollar} G$ · FAILED${r.txHash ? ' (tx: ' + r.txHash + ')' : ''}`));
    }
  }
  const failed = results.filter(r => !r.ok);
  console.log('');
  if (failed.length === 0) {
    console.log(green('✓ All G$ payouts confirmed on chain. Paste the celoscan links into the TG announcement.'));
  } else {
    console.log(red(`✗ ${failed.length} transfer(s) failed. Investigate before re-running.`));
    process.exit(1);
  }
}

main().catch(e => {
  console.error(red('\nFatal: ' + (e.stack || e.message || e)));
  process.exit(1);
});
