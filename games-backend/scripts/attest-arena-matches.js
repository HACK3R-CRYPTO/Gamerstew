#!/usr/bin/env node
// ─── Oracle 8004 attestor for arena free matches ─────────────────────────────
// Batch-emits `match_completed` feedback to the ERC-8004 Feedback Registry
// for completed instant-arena matches that haven't been attested yet
// (arena_free_matches.attested = false). Keeps MARKOV's on-chain reputation
// trail growing now that the match loop itself is off-chain — the chain is
// the receipt layer.
//
// Mirrors agent/src/feedbackOracle.ts exactly (same registry, agent id,
// scoring, tags, feedback hash) so free-match attestations are
// indistinguishable in shape from the wager-era ones on 8004scan.
//
// Usage:
//   node scripts/attest-arena-matches.js              # dry-run · lists queue
//   node scripts/attest-arena-matches.js --execute    # broadcasts
//   node scripts/attest-arena-matches.js --execute --limit 25
//
// Run it on a schedule (Railway cron / manual): each row costs one small
// Oracle tx (~the Oracle wallet holds CELO for thousands of these).
//
// Env:
//   FEEDBACK_ORACLE_KEY  · Oracle EOA (lives in agent/.env · loaded below)
//   SUPABASE_URL / key   · games-backend/.env
//   CELO_RPC_URL         · optional · defaults to forno

const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');

try {
  for (const p of [
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '..', '..', 'agent', '.env'),
  ]) if (fs.existsSync(p)) require('dotenv').config({ path: p });
} catch {}

const RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const ORACLE_KEY = process.env.FEEDBACK_ORACLE_KEY;
const FEEDBACK_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const AGENT_ID = 6386n;
const ENDPOINT = 'https://celoscan.io/address/0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE';

const FEEDBACK_ABI = [
  'function giveFeedback(uint256 agentId, int128 score, uint8 scoreDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const limit = Number(arg('limit', 50));

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY,
  );

  const { data: rows, error } = await sb
    .from('arena_free_matches')
    .select('match_id, wallet, outcome, created_at')
    .eq('attested', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { console.error('✗ queue read failed:', error.message); process.exit(1); }
  if (!rows?.length) { console.log('✓ attestation queue is empty — nothing to do.'); return; }

  console.log(`\n📡 8004 attestation queue · ${rows.length} match(es) · ${execute ? 'EXECUTE' : 'DRY-RUN'}\n`);
  for (const r of rows) {
    console.log(`  ${r.match_id} · ${r.wallet.slice(0, 8)}… · ${r.outcome} · score ${r.outcome === 'tie' ? 80 : 95}`);
  }

  if (!execute) { console.log('\n  DRY-RUN complete · re-run with --execute to broadcast.\n'); return; }
  if (!ORACLE_KEY) { console.error('✗ FEEDBACK_ORACLE_KEY not in env'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const oracle = new ethers.Wallet(ORACLE_KEY, provider);
  const registry = new ethers.Contract(FEEDBACK_REGISTRY, FEEDBACK_ABI, oracle);
  const celoBal = await provider.getBalance(oracle.address);
  console.log(`\n  oracle ${oracle.address} · ${ethers.formatEther(celoBal)} CELO`);
  if (celoBal < ethers.parseEther('0.05')) { console.error('✗ oracle low on CELO — top it up first.'); process.exit(1); }

  let ok = 0, failed = 0;
  for (const r of rows) {
    // Same hash construction as feedbackOracle.ts: keccak256(pack('MARKOV', agentId, matchRef)).
    // Free-match ids are strings ('am_…'), so the numeric ref is a keccak of the id
    // reduced to uint256 — deterministic and collision-free per match.
    const matchRef = BigInt(ethers.keccak256(ethers.toUtf8Bytes(r.match_id)));
    const fbHash = ethers.keccak256(
      ethers.solidityPacked(['string', 'uint256', 'uint256'], ['MARKOV', AGENT_ID, matchRef]),
    );
    const score = r.outcome === 'tie' ? 80n : 95n;
    try {
      const tx = await registry.giveFeedback(AGENT_ID, score, 0, 'match_completed', 'rps', ENDPOINT, '', fbHash);
      await tx.wait();
      await sb.from('arena_free_matches').update({ attested: true }).eq('match_id', r.match_id);
      ok++;
      console.log(`  ✓ ${r.match_id} · ${tx.hash.slice(0, 12)}…`);
    } catch (e) {
      failed++;
      console.warn(`  ✗ ${r.match_id} · ${e.shortMessage || e.message}`);
    }
  }
  console.log(`\n  done · ${ok} attested · ${failed} failed (will retry next run)\n`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
