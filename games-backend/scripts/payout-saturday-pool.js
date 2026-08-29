#!/usr/bin/env node
/**
 * Saturday community pool — split a fixed G$ pool among the TOP N players who
 * played during the event window. Ranks by score (normalised across games so
 * it's fair), verified players only, optionally gated to a voted/eligible list.
 *
 * This is the 10-winner "prize pool" model (not the 1-winner duel rooms):
 * players just play, we read their scores from the subgraph, rank, and pay.
 *
 * SAFETY (same as payout-community-pool.js)
 *  - Dry-run by default. It ONLY sends when you pass `--send`.
 *  - Your key never leaves your machine and is never printed:
 *      export POOL_PRIVATE_KEY=0x...      (wallet holding the pool G$)
 *  - Checks the wallet holds enough G$ (+ CELO for gas) before sending.
 *  - Idempotent: writes saturday-pool-progress.json and skips wallets already
 *    paid, so a re-run continues and never double-pays.
 *
 * CONFIGURE (env)
 *  POOL_PRIVATE_KEY  wallet holding the pool G$                (required to --send)
 *  POOL_TOTAL_G      total G$ to split (the $50 worth of G$)   (required)
 *  SAT_START         event start, ISO e.g. 2026-08-29T09:00:00Z (required)
 *  SAT_END           event end,   ISO                           (required)
 *  WINNERS           how many top players share it (default 10)
 *  ELIGIBLE_FILE     path to a text file of voted+verified wallets, one per line
 *                    (optional — if set, only these wallets can win; blank = all)
 *  SPLIT             'equal' (default) or 'graduated' (top-weighted)
 *
 * USAGE
 *      cd games-backend
 *      export POOL_PRIVATE_KEY=0x...
 *      POOL_TOTAL_G=1650000 SAT_START=2026-08-29T09:00:00Z SAT_END=2026-08-29T21:00:00Z \
 *        node scripts/payout-saturday-pool.js                  # dry run — shows winners + split
 *      ... same, add --send                                    # actually pays
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC       = process.env.CELO_RPC || 'https://forno.celo.org';
const GDOLLAR   = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
const IDENTITY  = '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42'; // GoodDollar IdentityV2
const SUBGRAPH  = process.env.SUBGRAPH_URL ||
  'https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.0/gn';
const KEY       = process.env.POOL_PRIVATE_KEY || '';
const SEND      = process.argv.includes('--send');
const PROGRESS  = path.join(__dirname, 'saturday-pool-progress.json');

const TOTAL_G   = Number(process.env.POOL_TOTAL_G || 0);
const WINNERS   = Number(process.env.WINNERS || 10);
const SPLIT     = (process.env.SPLIT || 'equal').toLowerCase();
const SAT_START = process.env.SAT_START || '';
const SAT_END   = process.env.SAT_END || '';
const ELIGIBLE_FILE = process.env.ELIGIBLE_FILE || '';

// Cross-game normalisation — same divisors the Arena Cup uses.
const DIVISOR = { 0: 100, 1: 20, 2: 5, 3: 20 };

const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const ID_ABI = ['function isWhitelisted(address) view returns (bool)'];

function loadProgress() { try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return { paid: {} }; } }
function saveProgress(p) { fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 2)); }

async function gql(query, variables) {
  const r = await fetch(SUBGRAPH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

// Best run per (player, game) in the window → normalised total per player.
async function rankPlayers(startSec, endSec) {
  const best = new Map(); // wallet -> Map(game -> bestScore)
  let cursor = startSec;
  for (let page = 0; page < 200; page++) {
    const data = await gql(
      `query($s:BigInt!,$e:BigInt!){ scores(first:1000, orderBy: blockTimestamp, orderDirection: asc,
        where:{ blockTimestamp_gte:$s, blockTimestamp_lt:$e }){ player{ id } gameType score blockTimestamp } }`,
      { s: String(cursor), e: String(endSec) },
    );
    const rows = data.scores || [];
    if (!rows.length) break;
    for (const row of rows) {
      const w = row.player.id.toLowerCase(); const g = Number(row.gameType); const sc = Number(row.score);
      if (!best.has(w)) best.set(w, new Map());
      const m = best.get(w); if (!m.has(g) || sc > m.get(g)) m.set(g, sc);
    }
    if (rows.length < 1000) break;
    cursor = Number(rows[rows.length - 1].blockTimestamp) + 1;
  }
  const scored = [];
  for (const [w, m] of best) {
    let total = 0;
    for (const [g, sc] of m) total += Math.floor(sc / (DIVISOR[g] || 20));
    scored.push({ wallet: w, score: total });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// Split TOTAL_G among n winners. 'equal' = TOTAL_G/n each; 'graduated' = a gentle
// top-weighted curve that still sums to TOTAL_G.
function splitPool(n) {
  if (n <= 0) return [];
  if (SPLIT === 'graduated') {
    const weights = Array.from({ length: n }, (_, i) => n - i); // n, n-1, …, 1
    const wsum = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map((wt) => Math.floor((TOTAL_G * wt) / wsum));
    let used = raw.reduce((a, b) => a + b, 0);
    raw[0] += TOTAL_G - used; // remainder to the top
    return raw;
  }
  const each = Math.floor(TOTAL_G / n);
  const arr = Array(n).fill(each);
  arr[0] += TOTAL_G - each * n; // remainder to the top
  return arr;
}

async function main() {
  if (!TOTAL_G || !SAT_START || !SAT_END) {
    console.error('ERROR: set POOL_TOTAL_G, SAT_START and SAT_END (ISO). See the header.'); process.exit(1);
  }
  const startSec = Math.floor(Date.parse(SAT_START) / 1000);
  const endSec = Math.floor(Date.parse(SAT_END) / 1000);
  if (!(endSec > startSec)) { console.error('ERROR: SAT_END must be after SAT_START.'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC);
  const id = new ethers.Contract(IDENTITY, ID_ABI, provider);

  console.log(`\nSaturday pool — window ${SAT_START} → ${SAT_END}`);
  console.log(`Pool: ${TOTAL_G.toLocaleString()} G$  ·  top ${WINNERS}  ·  split: ${SPLIT}`);
  console.log(SEND ? '>>> LIVE MODE (--send): transactions WILL be sent\n' : '>>> DRY RUN (no --send)\n');

  // Rank everyone who played in the window.
  let ranked = await rankPlayers(startSec, endSec);
  console.log(`Players with a score in the window: ${ranked.length}`);

  // Optional voted/eligible gate.
  if (ELIGIBLE_FILE) {
    const set = new Set(fs.readFileSync(ELIGIBLE_FILE, 'utf8').split(/\s+/).map((w) => w.trim().toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w)));
    ranked = ranked.filter((r) => set.has(r.wallet));
    console.log(`After the eligible/voted list (${set.size} wallets): ${ranked.length}`);
  }

  // Verified only — walk down the ranking until we have WINNERS verified players.
  const winners = [];
  for (const r of ranked) {
    if (winners.length >= WINNERS) break;
    let ok = false;
    try { ok = await id.isWhitelisted(r.wallet); } catch { ok = false; }
    if (ok) winners.push(r); else console.log(`  skip (unverified) ${r.wallet}  (${r.score} pts)`);
  }
  if (!winners.length) { console.error('\nNo eligible verified players scored in the window. Nothing to pay.'); process.exit(1); }

  const amounts = splitPool(winners.length);
  console.log(`\nWinners (${winners.length}):`);
  const plan = winners.map((w, i) => ({ to: w.wallet, g: amounts[i], score: w.score }));
  plan.forEach((p, i) => console.log(`  #${String(i + 1).padStart(2)}  ${p.to}  ${String(p.g).padStart(9)} G$   (${p.score} pts)`));
  const totalOut = plan.reduce((s, p) => s + p.g, 0);
  console.log(`\nTotal to pay: ${totalOut.toLocaleString()} G$`);

  if (!SEND) { console.log('\nDry run — re-run with --send to pay. Set POOL_PRIVATE_KEY first.'); return; }
  if (!KEY) { console.error('ERROR: set POOL_PRIVATE_KEY to send.'); process.exit(1); }

  const wallet = new ethers.Wallet(KEY, provider);
  const gd = new ethers.Contract(GDOLLAR, ERC20, wallet);
  const from = await wallet.getAddress();
  const gBal = await gd.balanceOf(from);
  const celoBal = await provider.getBalance(from);
  console.log(`\nFrom wallet : ${from}`);
  console.log(`G$ balance  : ${Number(ethers.formatUnits(gBal, 18)).toLocaleString()} G$  (need ${totalOut.toLocaleString()})`);
  console.log(`CELO (gas)  : ${Number(ethers.formatEther(celoBal)).toFixed(4)} CELO\n`);
  if (gBal < ethers.parseUnits(String(totalOut), 18)) { console.error('ERROR: pool wallet G$ below total owed. Top it up.'); process.exit(1); }
  if (celoBal === 0n) { console.error('ERROR: pool wallet has 0 CELO for gas.'); process.exit(1); }

  const progress = loadProgress();
  for (const p of plan) {
    if (progress.paid[p.to]) { console.log(`  skip   ${p.to} already paid (${progress.paid[p.to].slice(0, 12)}…)`); continue; }
    try {
      const tx = await gd.transfer(p.to, ethers.parseUnits(String(p.g), 18));
      process.stdout.write(`  send   ${p.to}  ${String(p.g).padStart(9)} G$  ${tx.hash.slice(0, 12)}… `);
      await tx.wait();
      progress.paid[p.to] = tx.hash; saveProgress(progress);
      console.log('✓');
    } catch (e) {
      console.log(`\n  FAILED ${p.to}: ${e.message}`);
      console.log('  Stopping — already-paid wallets are skipped on re-run.');
      process.exit(1);
    }
  }
  console.log('\nDone. Winners paid on-chain, verifiable on Celoscan.');
}

main().catch((e) => { console.error(e); process.exit(1); });
