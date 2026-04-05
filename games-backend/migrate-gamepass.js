/**
 * GamePass Migration Script
 * Run from games-backend: node migrate-gamepass.js
 *
 * Reads all players from old GamePass, zeros hacked scores (>= 9990),
 * deploys GamePass v3, calls migrate(), prints next steps.
 */

require('dotenv').config();
const { ethers } = require('ethers');
const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const OLD_GAME_PASS_ADDRESS = '0xd184E5CBEbf957624d14fAa0bfe20d6443411453';
const CELO_RPC_URL          = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const DEPLOYER_PRIVATE_KEY  = process.env.VALIDATOR_PRIVATE_KEY;

// Hacked scores seen: 9999, 9998, 9993 — real gameplay tops out ~700
const HACKED_SCORE_THRESHOLD = 9990n;

// ── ABIs ──────────────────────────────────────────────────────────────────────

const OLD_ABI = [
  'function totalSupply() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function usernameOf(address) view returns (string)',
  'function bestScore(address, uint8) view returns (uint256)',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanScore(score, address, game) {
  if (score >= HACKED_SCORE_THRESHOLD) {
    console.log(`  ⚠️  Zeroing hacked ${game} score ${score.toString()} for ${address}`);
    return 0n;
  }
  return score;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!DEPLOYER_PRIVATE_KEY) {
    console.error('❌  VALIDATOR_PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
  const signer   = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  const network  = await provider.getNetwork();
  console.log(`\n🌐  Chain ${network.chainId}`);
  console.log(`👤  Deployer: ${signer.address}`);

  const balance = await provider.getBalance(signer.address);
  console.log(`💰  Balance: ${ethers.formatEther(balance)} CELO\n`);

  // ── Step 1: Read all PassMinted events ───────────────────────────────────
  console.log('📖  Reading old GamePass contract...');
  const oldContract = new ethers.Contract(OLD_GAME_PASS_ADDRESS, OLD_ABI, provider);
  const totalSupply = await oldContract.totalSupply();
  console.log(`    Total passes: ${totalSupply.toString()}\n`);

  console.log(`📋  Fetching ${totalSupply} players via ownerOf...\n`);

  // ── Step 2: Fetch + clean scores ─────────────────────────────────────────
  console.log('🔍  Fetching scores...');

  const players      = [];
  const usernames    = [];
  const rhythmScores = [];
  const simonScores  = [];
  let hackedCount    = 0;

  for (let tokenId = 1n; tokenId <= totalSupply; tokenId++) {
    const player   = await oldContract.ownerOf(tokenId);
    const username = await oldContract.usernameOf(player);

    const rawRhythm = await oldContract.bestScore(player, 0);
    const rawSimon  = await oldContract.bestScore(player, 1);

    const rhythm = cleanScore(rawRhythm, player, 'rhythm');
    const simon  = cleanScore(rawSimon,  player, 'simon');

    if (rhythm !== rawRhythm || simon !== rawSimon) hackedCount++;

    players.push(player);
    usernames.push(username);
    rhythmScores.push(rhythm);
    simonScores.push(simon);

    console.log(`  ${username.padEnd(18)} rhythm=${rhythm.toString().padStart(6)}  simon=${simon.toString().padStart(6)}  ${player}`);
  }

  console.log(`\n📊  Total: ${players.length} players, ${hackedCount} hacked entries zeroed\n`);

  // ── Step 3: Save snapshot ─────────────────────────────────────────────────
  const snapshot = {
    timestamp: new Date().toISOString(),
    oldContract: OLD_GAME_PASS_ADDRESS,
    hackedScoreThreshold: HACKED_SCORE_THRESHOLD.toString(),
    players: players.map((p, i) => ({
      address:      p,
      username:     usernames[i],
      rhythmScore:  rhythmScores[i].toString(),
      simonScore:   simonScores[i].toString(),
    })),
  };
  const snapshotPath = resolve(__dirname, 'migration-snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`💾  Snapshot saved → migration-snapshot.json\n`);

  // ── Step 4: Deploy GamePass v3 ────────────────────────────────────────────
  console.log('🚀  Deploying GamePass v3...');

  const artifactPath = resolve(__dirname, '../contracts/out/GamePass.sol/GamePass.json');
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch {
    console.error(`❌  Artifact not found at ${artifactPath}`);
    console.error('    Run `cd ../contracts && forge build` first');
    process.exit(1);
  }

  const factory     = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, signer);
  const newContract = await factory.deploy();
  await newContract.waitForDeployment();
  const newAddress  = await newContract.getAddress();
  console.log(`✅  GamePass v3 deployed: ${newAddress}\n`);

  // ── Step 5: Migrate in batches of 50 ─────────────────────────────────────
  console.log('📤  Running migrate()...');
  const BATCH = 50;

  for (let i = 0; i < players.length; i += BATCH) {
    const end = Math.min(i + BATCH, players.length);
    process.stdout.write(`    Batch ${Math.floor(i / BATCH) + 1} (${i}–${end - 1})... `);

    const tx = await newContract.migrate(
      players.slice(i, end),
      usernames.slice(i, end),
      rhythmScores.slice(i, end),
      simonScores.slice(i, end),
    );
    const receipt = await tx.wait();
    console.log(`✅  ${receipt.hash}`);
  }

  console.log(`\n🎉  ${players.length} players migrated!\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`NEW CONTRACT ADDRESS: ${newAddress}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n⚠️  After verifying on Celoscan, lock migration:');
  console.log(`   cast send ${newAddress} "finalizeMigration()" \\`);
  console.log(`     --private-key $VALIDATOR_PRIVATE_KEY \\`);
  console.log(`     --rpc-url ${CELO_RPC_URL}`);
  console.log('\n📝  Then update these files with the new address above:');
  console.log(`   frontend/lib/contracts.ts          GAME_PASS: '${newAddress}'`);
  console.log(`   games-backend/.env                  GAME_PASS_ADDRESS=${newAddress}`);
  console.log(`   frontend/.env.local                 NEXT_PUBLIC_GAME_PASS_ADDRESS=${newAddress}\n`);

  // Write new address to a file so we can read it in the next step
  writeFileSync(resolve(__dirname, '.new-gamepass-address'), newAddress);
}

main().catch(err => {
  console.error('\n❌  Migration failed:', err.message || err);
  process.exit(1);
});
