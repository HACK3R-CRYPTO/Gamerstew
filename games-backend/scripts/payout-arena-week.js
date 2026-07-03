#!/usr/bin/env node
// ─── Weekly MARKOV Ladder G$ payout ──────────────────────────────────────────
// Pays the weekly pool to the closing week's ladder standings, from the
// transparent pool wallet (ARENA_POOL_KEY). Source of truth: the same
// /api/arena/ladder aggregation the in-app board reads.
//
// Payout scheme (validated by simulations/payout.sim.js — farm-proof):
//   #1 30% · #2 20% · #3 12% · #4-10 split 28% · #11-20 split 10%
//   Unclaimed shares (empty ranks, dust, ineligible) STAY IN THE POOL WALLET
//   and roll into next week.
//
// Usage:
//   node scripts/payout-arena-week.js --pool 500              # dry-run
//   node scripts/payout-arena-week.js --pool 500 --execute    # broadcast
//   node scripts/payout-arena-week.js --pool 500 --week 2026-W27
//
//   --pool <G$>     REQUIRED · the amount this week pays. Deliberate act:
//                   there is no default, so a stray run can't invent a prize.
//   --week <key>    ISO week to pay · defaults to the LAST COMPLETED week
//                   (never the running one).
//   --min-matches   eligibility floor · default 3 (a one-match fluke doesn't
//                   collect a rank payout; their share rolls over).
//
// Env (games-backend/.env):
//   ARENA_POOL_KEY   · signs transfers + pays gas · the pool wallet itself
//   BACKEND_URL      · optional · defaults to http://localhost:3005
//   INTERNAL_SECRET  · auth for /api/arena/ladder
//   CELO_RPC_URL     · optional · defaults to https://forno.celo.org
//
// Safety (mirrors payout-markov-climb.js):
//   - Dry-run by default · prints the exact plan, sends nothing.
//   - --execute has a 5-second ABORT window.
//   - Aborts if pool wallet G$ balance < total payout.
//   - Aborts on malformed addresses; skips dust shares (< 0.5 G$).
//   - Prints every tx hash for the announcement post.

const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

try {
  for (const p of [
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '..', '..', 'frontend', '.env.local'),
  ]) if (fs.existsSync(p)) require('dotenv').config({ path: p });
} catch {}

const RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const BACKEND_URL = process.env.BACKEND_URL_LOCAL || process.env.BACKEND_URL || 'http://localhost:3005';
const SECRET = process.env.INTERNAL_SECRET;
const POOL_KEY = process.env.ARENA_POOL_KEY;

const G_TOKEN_ADDR = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
const G_TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

// Scheme mirrors simulations/payout.sim.js payoutShare(). Change both together.
function payoutShare(rank) {
  if (rank === 1) return 0.30;
  if (rank === 2) return 0.20;
  if (rank === 3) return 0.12;
  if (rank <= 10) return 0.28 / 7;
  if (rank <= 20) return 0.10 / 10;
  return 0;
}

function lastCompletedWeek() {
  // ISO week key of the most recently FINISHED week (today minus 7 days).
  const d = new Date(Date.now() - 7 * 86400000);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const poolGs = Number(arg('pool'));
  const week = arg('week', lastCompletedWeek());
  const minMatches = Number(arg('min-matches', 3));

  if (!poolGs || poolGs <= 0) { console.error('✗ --pool <G$ amount> is required (deliberate funding, no default)'); process.exit(1); }
  if (!SECRET) { console.error('✗ INTERNAL_SECRET not in env'); process.exit(1); }
  if (!POOL_KEY) { console.error('✗ ARENA_POOL_KEY not in env'); process.exit(1); }
  if (!/^\d{4}-W\d{2}$/.test(week)) { console.error(`✗ bad week key: ${week}`); process.exit(1); }

  console.log(`\n🏆 Weekly ladder payout · week ${week} · pool ${poolGs} G$ · ${execute ? 'EXECUTE' : 'DRY-RUN'}\n`);

  const res = await fetch(`${BACKEND_URL}/api/arena/ladder?week=${week}`, {
    headers: { 'x-internal-secret': SECRET },
  });
  if (!res.ok) { console.error(`✗ ladder fetch failed: ${res.status}`); process.exit(1); }
  const ladder = await res.json();
  if (ladder.currentWeek === week) {
    console.error(`✗ ${week} is the RUNNING week — pay only completed weeks.`); process.exit(1);
  }
  if (!ladder.top?.length) { console.error(`✗ no standings for ${week} — nothing to pay.`); process.exit(1); }

  // Build the plan
  const plan = [];
  let totalGs = 0;
  for (const e of ladder.top) {
    const share = payoutShare(e.rank);
    if (share === 0) continue;
    if (e.matches < minMatches) {
      console.log(`  · skip #${e.rank} ${e.wallet.slice(0, 8)}… (${e.matches} matches < floor ${minMatches}) — share rolls over`);
      continue;
    }
    const gs = Math.floor(poolGs * share * 100) / 100;
    if (gs < 0.5) continue; // dust rolls over
    if (!/^0x[0-9a-fA-F]{40}$/.test(e.wallet)) { console.error(`✗ malformed address at rank ${e.rank}: ${e.wallet}`); process.exit(1); }
    plan.push({ rank: e.rank, wallet: e.wallet, username: e.username || null, points: e.points, gs });
    totalGs += gs;
  }
  if (!plan.length) { console.error('✗ empty payout plan (all ranks ineligible?)'); process.exit(1); }

  console.log(`  week ${week} · ${ladder.players} climbers · paying ${plan.length} ranks · total ${Math.round(totalGs * 100) / 100} G$ (${Math.round((totalGs / poolGs) * 100)}% of pool, rest rolls over)\n`);
  for (const p of plan) {
    const name = p.username ? `@${p.username}` : `${p.wallet.slice(0, 8)}…`;
    console.log(`  #${String(p.rank).padStart(2)} ${name.padEnd(18)} ${String(p.points).padStart(4)} pts → ${p.gs} G$`);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(POOL_KEY, provider);
  const gd = new ethers.Contract(G_TOKEN_ADDR, G_TOKEN_ABI, wallet);
  const balance = await gd.balanceOf(wallet.address);
  const totalWei = ethers.parseEther(String(totalGs));
  console.log(`\n  pool wallet ${wallet.address}`);
  console.log(`  G$ balance: ${ethers.formatEther(balance)} · needed: ${totalGs}`);
  if (balance < totalWei) {
    if (execute) { console.error('✗ pool wallet balance below total payout — fund it first.'); process.exit(1); }
    console.log('  ⚠️  balance below total payout — fund the pool wallet before --execute.');
  }

  if (!execute) { console.log('\n  DRY-RUN complete · re-run with --execute to broadcast.\n'); return; }

  console.log('\n  ⚠️  Broadcasting in 5 seconds — Ctrl-C to ABORT');
  await new Promise((r) => setTimeout(r, 5000));

  for (const p of plan) {
    const tx = await gd.transfer(p.wallet, ethers.parseEther(String(p.gs)));
    const rc = await tx.wait();
    console.log(`  ✓ #${p.rank} ${p.gs} G$ → ${p.wallet} · ${rc.hash}`);
  }
  console.log('\n  All payouts broadcast. Paste the tx hashes into the announcement. 🏆\n');
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
