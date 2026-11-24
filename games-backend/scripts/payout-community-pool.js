#!/usr/bin/env node
/**
 * Community pool payout — sends each verified player their G$ share.
 *
 * The weekly community pool unlocked (1,275 games vs 1,200 target). This pays
 * the 15 verified players their games x 105 G$ share, computed on-chain from
 * the subgraph. Unverified players earn nothing (the rule).
 *
 * SAFETY
 *  - Dry-run by default. It ONLY sends when you pass `--send`.
 *  - Your key never leaves your machine and is never printed. Set it in env:
 *      export POOL_PRIVATE_KEY=0x...      (the wallet holding the pool G$)
 *  - Checks the wallet holds enough G$ (and CELO for gas) before sending.
 *  - Idempotent: writes payout-progress.json and skips wallets already paid,
 *    so if it stops halfway you can re-run and it continues, never double-pays.
 *
 * USAGE
 *      cd games-backend
 *      export POOL_PRIVATE_KEY=0x...
 *      node scripts/payout-community-pool.js            # dry run, shows plan
 *      node scripts/payout-community-pool.js --send     # actually sends
 *
 * Gas is paid in CELO. Keep ~0.3 CELO in the wallet for the 15 transfers.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC        = process.env.CELO_RPC || 'https://forno.celo.org';
const GDOLLAR    = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A'; // G$ on Celo, 18 decimals
const KEY        = process.env.POOL_PRIVATE_KEY || '';
const SEND       = process.argv.includes('--send');
const PROGRESS   = path.join(__dirname, 'payout-progress.json');

// wallet -> whole G$ (verified players only; from /api/weekly-challenge/payout-list)
const PAYOUTS = [
  ['0x92f2399940e928dfb78b01dbe1fe5831d2151628', 15750, 'VICK_1_TORR'],
  ['0xfe1de08a089c0dc5528f2b9a4877553fa7e45c54', 15750, 'Olaniyi221'],
  ['0x0f4249e288eb10dbd43c6b4ab03ffdeaf69c9a87', 15750, 'Davedi29ice'],
  ['0x4cdadebafa0b7d2bc6c125487f352e6e7bc4efcb', 13755, '_Deandre_'],
  ['0x19f23514e5fcf8dbaeda94933c0ac64ff58f7961', 10920, 'lollyposh'],
  ['0x307d3f9657b67dc60b7d99b4d9a8734ce5e63b90', 10290, 'cornensecornelia'],
  ['0xb597401c72572ddae428db48485909db66cf722d', 10080, 'botx'],
  ['0x05d69592ecf20055b351316bd05a08f4a87e6e93',  5145, 'temmy'],
  ['0xf483a68c19753322139d7f047dfac72fcc86f49d',  2415, 'UNCL3_SAM'],
  ['0x5cef2c191f62006be6f592f75ae262924dd4474e',  2205, 'RAVENxSPARK'],
  ['0x6aed964ad8b0432b5ff4b661813981c6b75cb5e3',  1680, 'NIAR21'],
  ['0xea75ea46fbda6b955bfd8bc77eb8acdf04856600',   525, 'omoboi'],
  ['0xeb5f3bcbdab427e4a7399826c9c62607117b704f',   315, 'DeeGov'],
  ['0xf12d3374525f0859739d9256a51bfcd7820a99ca',   210, 'aksak'],
  ['0xfb60baa73fd3576063fed2d1bd0de43ea47aa5a4',   210, 'May'],
];

const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return { paid: {} }; }
}
function saveProgress(p) { fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 2)); }

async function main() {
  const total = PAYOUTS.reduce((s, [, g]) => s + g, 0);
  console.log(`\nCommunity pool payout — ${PAYOUTS.length} players, ${total.toLocaleString()} G$ total`);
  console.log(SEND ? '>>> LIVE MODE (--send): transactions WILL be sent\n' : '>>> DRY RUN (no --send): nothing will be sent\n');

  if (!KEY) { console.error('ERROR: set POOL_PRIVATE_KEY in your environment first.'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet   = new ethers.Wallet(KEY, provider);
  const gd       = new ethers.Contract(GDOLLAR, ERC20, wallet);
  const progress = loadProgress();

  const from    = await wallet.getAddress();
  const gBal    = await gd.balanceOf(from);
  const celoBal = await provider.getBalance(from);
  const needG   = ethers.parseUnits(String(total), 18);
  console.log(`From wallet : ${from}`);
  console.log(`G$ balance  : ${Number(ethers.formatUnits(gBal, 18)).toLocaleString()} G$   (need ${total.toLocaleString()})`);
  console.log(`CELO (gas)  : ${Number(ethers.formatEther(celoBal)).toFixed(4)} CELO\n`);

  if (gBal < needG) { console.error('ERROR: wallet G$ balance is below the total owed. Top it up and re-run.'); process.exit(1); }
  if (celoBal === 0n && SEND) { console.error('ERROR: wallet has 0 CELO for gas. Add ~0.3 CELO and re-run.'); process.exit(1); }

  let sent = 0, skipped = 0;
  for (const [to, g, name] of PAYOUTS) {
    if (progress.paid[to]) { console.log(`  skip   ${name.padEnd(18)} already paid (tx ${progress.paid[to].slice(0, 12)}…)`); skipped++; continue; }
    const amount = ethers.parseUnits(String(g), 18);
    if (!SEND) { console.log(`  would  ${name.padEnd(18)} ${String(g).padStart(6)} G$ -> ${to}`); continue; }
    try {
      const tx = await gd.transfer(to, amount);
      process.stdout.write(`  send   ${name.padEnd(18)} ${String(g).padStart(6)} G$ -> ${to}  ${tx.hash.slice(0, 12)}… `);
      await tx.wait();
      progress.paid[to] = tx.hash; saveProgress(progress);
      console.log('✓');
      sent++;
    } catch (e) {
      console.log(`\n  FAILED ${name}: ${e.message}`);
      console.log('  Stopping. Fix the issue and re-run — already-paid wallets are skipped.');
      process.exit(1);
    }
  }

  console.log(`\nDone. ${SEND ? `${sent} sent` : 'dry run'}${skipped ? `, ${skipped} skipped` : ''}.`);
  if (!SEND) console.log('Re-run with --send to execute.');
}

main().catch((e) => { console.error(e); process.exit(1); });
