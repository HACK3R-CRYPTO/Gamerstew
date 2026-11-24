// ─── chain ────────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── On-chain config ──
function* (core) {
  Object.defineProperties(core, {
    passContract: { get: () => passContract, set: (v) => { passContract = v; }, enumerable: true, configurable: true },
    validator: { get: () => validator, set: (v) => { validator = v; }, enumerable: true, configurable: true },
    enqueueScoreWrite: { get: () => enqueueScoreWrite, enumerable: true, configurable: true },
    serializeSignerWrite: { get: () => serializeSignerWrite, enumerable: true, configurable: true },
    BACKEND_APPROVAL_DOMAIN: { get: () => BACKEND_APPROVAL_DOMAIN, enumerable: true, configurable: true },
    BACKEND_APPROVAL_TYPES: { get: () => BACKEND_APPROVAL_TYPES, enumerable: true, configurable: true },
    GASLESS_SKILL_GAMES: { get: () => GASLESS_SKILL_GAMES, enumerable: true, configurable: true },
    _rememberGaslessTx: { get: () => _rememberGaslessTx, enumerable: true, configurable: true },
    resolveOnChain: { get: () => resolveOnChain, enumerable: true, configurable: true },
    _isGaslessTx: { get: () => _isGaslessTx, enumerable: true, configurable: true },
    verifyScoreTx: { get: () => verifyScoreTx, enumerable: true, configurable: true },
    resolveUsername: { get: () => resolveUsername, enumerable: true, configurable: true },
    getTreasuryBalance: { get: () => getTreasuryBalance, enumerable: true, configurable: true },
    resolveUsernameChecked: { get: () => resolveUsernameChecked, enumerable: true, configurable: true },
    HABITAT_FREE_TIERS: { get: () => HABITAT_FREE_TIERS, enumerable: true, configurable: true },
    habitatContract: { get: () => habitatContract, set: (v) => { habitatContract = v; }, enumerable: true, configurable: true },
    HABITAT_PAID_TIERS: { get: () => HABITAT_PAID_TIERS, enumerable: true, configurable: true },
    provider: { get: () => provider, set: (v) => { provider = v; }, enumerable: true, configurable: true },
    passScoreWriter: { get: () => passScoreWriter, set: (v) => { passScoreWriter = v; }, enumerable: true, configurable: true },
    RECEIPT_TIMEOUT_MS: { get: () => RECEIPT_TIMEOUT_MS, enumerable: true, configurable: true },
    RECEIPT_POLL_MS: { get: () => RECEIPT_POLL_MS, enumerable: true, configurable: true },
    faucetWallet: { get: () => faucetWallet, set: (v) => { faucetWallet = v; }, enumerable: true, configurable: true },
    wagerContract: { get: () => wagerContract, set: (v) => { wagerContract = v; }, enumerable: true, configurable: true },
    GAME_PASS_ADDR: { get: () => GAME_PASS_ADDR, enumerable: true, configurable: true },
    SCORE_EVENT_IFACE: { get: () => SCORE_EVENT_IFACE, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── On-chain config ────────────────────────────────────────────────────────
const CELO_RPC = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const SOLO_WAGER_ADDR = process.env.SOLO_WAGER_ADDRESS || '';
const VALIDATOR_KEY = process.env.VALIDATOR_PRIVATE_KEY || '';

const SOLO_WAGER_ABI = [
  'function resolveWager(uint256 wagerId, uint256 score) external',
  'function wagers(uint256) external view returns (uint256 id, address player, uint256 amount, uint8 gameType, uint8 status, uint256 createdAt, uint256 score)',
  'function getPlayerWagers(address player) external view returns (uint256[] memory)',
  'function treasuryBalance() external view returns (uint256)',
  'function distributeSeasonPrizes(uint256 seasonId, address[3] rhythmWinners, address[3] simonWinners) external',
  'function totalUsers() external view returns (uint256)',
];

const GAME_PASS_ADDR = process.env.GAME_PASS_ADDRESS || '0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE';
const GAME_PASS_ABI = [
  // ── Read ──────────────────────────────────────────────────────────────────
  'function totalSupply() external view returns (uint256)',
  'function hasMinted(address player) external view returns (bool)',
  'function getUsername(address player) external view returns (string)',
  'function usernameOf(address player) external view returns (string)',
  'function isUsernameAvailable(string username) external view returns (bool)',
  'function currentSeason() external view returns (uint256)',
  'function bestScore(address player, uint8 gameType) external view returns (uint256)',
  'function weeklyBest(uint256 season, address player, uint8 gameType) external view returns (uint256)',
  'function gamesPlayed(address player) external view returns (uint256)',
  'function totalGamesPlayed() external view returns (uint256)',
  'function nonces(address player) external view returns (uint256)',
  'function scoreNonces(address player) external view returns (uint256)',
  // ── Write ─────────────────────────────────────────────────────────────────
  'function recordScore(address player, uint8 gameType, uint256 score) external',
  'function recordScoreSigned(address player, uint8 gameType, uint256 score, uint256 nonce, bytes signature) external',
  'function adminSetScore(address player, uint8 gameType, uint256 score, uint256 season) external',
];

// EIP-712 domain for BackendApproval signing
const BACKEND_APPROVAL_DOMAIN = {
  name: 'GameArena Pass',
  version: '3',
  chainId: 42220,
  verifyingContract: GAME_PASS_ADDR,
};
const BACKEND_APPROVAL_TYPES = {
  BackendApproval: [
    { name: 'player', type: 'address' },
    { name: 'gameType', type: 'uint8' },
    { name: 'score', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

// ONE provider for the entire process. ethers.JsonRpcProvider registers
// internal polling timers; creating a new one per cron tick (every 5 min
// in indexOnChainScores) leaked memory — the old instances couldn't GC
// because their timers held references. Railway's watchdog kept killing
// the process with "approaching memory threshold, restarting...".
let provider = null;
let passContract = null;
let validator = null;
let wagerContract = null;

try {
  provider = new core.ethers.JsonRpcProvider(CELO_RPC);
} catch (e) {
  console.warn('⚠️  Failed to init RPC provider:', e.message);
}

if (provider && SOLO_WAGER_ADDR && VALIDATOR_KEY) {
  try {
    validator = new core.ethers.Wallet(VALIDATOR_KEY, provider);
    wagerContract = new core.ethers.Contract(SOLO_WAGER_ADDR, SOLO_WAGER_ABI, validator);
    passContract = new core.ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, validator);
    console.log(`🔗 On-chain resolver ready — validator: ${validator.address}`);
  } catch (e) {
    console.warn('⚠️  On-chain resolver not configured:', e.message);
  }
} else if (provider) {
  try {
    passContract = new core.ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, provider);
  } catch (_) { }
  console.log('ℹ️  SOLO_WAGER_ADDRESS or VALIDATOR_PRIVATE_KEY not set — wager resolution disabled');
}

// ─── Validator-signed GamePass writer ────────────────────────────────────────
// A GamePass contract bound to the validator wallet, for backend-SUBMITTED score
// writes (recordScore, which requires msg.sender == scoreValidator). The skill
// games use recordScoreWithBackendSig (player submits, backend only signs), but
// Challenge AI match receipts are written by the backend directly so the free
// instant loop never asks the player to sign or pay gas. This is deliberately
// INDEPENDENT of SOLO_WAGER_ADDR — it works whenever a validator key exists,
// unlike `passContract` above which is read-only when the wager address is unset.
let passScoreWriter = null;
if (provider && VALIDATOR_KEY) {
  try {
    const scoreSigner = validator || new core.ethers.Wallet(VALIDATOR_KEY, provider);
    passScoreWriter = new core.ethers.Contract(GAME_PASS_ADDR, GAME_PASS_ABI, scoreSigner);
  } catch (e) {
    console.warn('⚠️  GamePass score writer not configured:', e?.message);
  }
}

// Gasless skill games: when on, the backend SUBMITS the skill-game score itself
// (recordScore, backend pays gas) instead of returning a voucher for the player
// to submit. The legacy player-pays path (recordScoreWithBackendSig) stays fully
// intact and is used whenever this is off — flip GASLESS_SKILL_GAMES=false to
// roll back instantly with no redeploy of logic. Default ON.
const GASLESS_SKILL_GAMES =
  passScoreWriter != null && String(process.env.GASLESS_SKILL_GAMES ?? 'true').toLowerCase() !== 'false';

// ─── Shared on-chain write queue (one signer nonce space) ────────────────────
// EVERY backend-submitted recordScore — gasless skill games AND Challenge AI —
// goes through this one serialized chain. They all send from the same signer
// (0xc1cF), so without a single queue two concurrent writes would grab the same
// nonce and all but one would revert. Serializing the SUBMIT (not the mine) keeps
// each step ~1-2s; returns the tx hash to the caller. Best-effort: the chain
// survives a failed write so the next one still goes.
let _signerWriteChain = Promise.resolve();
// Run something in the signer's single write lane. Everything that spends one
// of this wallet's nonces must go through here (or enqueueScoreWrite), or two
// writers pick the same nonce and one of them reverts.
function serializeSignerWrite(fn) {
  const run = _signerWriteChain.then(fn);
  _signerWriteChain = run.then(() => {}, () => {});
  return run;
}

function enqueueScoreWrite(player, gameType, score) {
  // Resolves to the ethers TransactionResponse (has .hash and .wait()) once the
  // tx is SUBMITTED. The chain advances on submission, not mining, so callers
  // that want a mined receipt wait OUTSIDE the queue (never blocking others).
  const run = _signerWriteChain.then(() => passScoreWriter.recordScore(player, gameType, score));
  _signerWriteChain = run.then(() => {}, () => {});
  return run;
}

// Hashes of txs the BACKEND submitted for gasless skill-game saves. /api/submit-score
// trusts these (skips on-chain re-verification): the backend created the tx and
// already validated the score, so re-verifying would only add a fragile wait on a
// Celo mine. TTL-pruned; tiny.
const gaslessTxHashes = new Map(); // hash(lowercased) -> insertedAtMs
const GASLESS_TX_TTL_MS = 15 * 60 * 1000;
function _rememberGaslessTx(hash) {
  if (!hash) return;
  const now = Date.now();
  for (const [h, at] of gaslessTxHashes) if (now - at > GASLESS_TX_TTL_MS) gaslessTxHashes.delete(h);
  gaslessTxHashes.set(String(hash).toLowerCase(), now);
}
function _isGaslessTx(hash) {
  return !!hash && gaslessTxHashes.has(String(hash).toLowerCase());
}

// ─── Faucet wallet — dedicated gas-drip signer ───────────────────────────────
// Funds fresh-wallet CELO drips from its OWN wallet, isolated from the
// validator (score-voucher signing) wallet so heavy faucet use can never drain
// the signing gas. Falls back to the validator wallet when FAUCET_PRIVATE_KEY
// is unset, so existing deployments keep working unchanged.
const FAUCET_KEY = process.env.FAUCET_PRIVATE_KEY || '';
let faucetWallet = null;
if (provider && FAUCET_KEY) {
  try {
    faucetWallet = new core.ethers.Wallet(FAUCET_KEY, provider);
    console.log(`⛽ Faucet wallet ready — dedicated: ${faucetWallet.address}`);
  } catch (e) {
    console.warn('⚠️  FAUCET_PRIVATE_KEY invalid — faucet will fall back to validator:', e.message);
  }
}

// ─── Habitat Registry — paid habitat tier ownership ──────────────────────────
const HABITAT_REGISTRY_ADDR = process.env.HABITAT_REGISTRY_ADDRESS || '';
const HABITAT_PAID_TIERS    = [6, 7, 8, 9, 10];
const HABITAT_FREE_TIERS = [
  { id: 1, unlockLevel: 1  },
  { id: 2, unlockLevel: 5  },
  { id: 3, unlockLevel: 15 },
  { id: 4, unlockLevel: 30 },
  { id: 5, unlockLevel: 50 },
];
const HABITAT_REGISTRY_ABI = [
  'function ownsHabitat(address player, uint8 tier) external view returns (bool)',
  'function playerUbiDonated(address player) external view returns (uint256)',
];

let habitatContract = null;
if (provider && HABITAT_REGISTRY_ADDR) {
  try {
    habitatContract = new core.ethers.Contract(HABITAT_REGISTRY_ADDR, HABITAT_REGISTRY_ABI, provider);
    console.log(`🏛️  Habitat registry: ${HABITAT_REGISTRY_ADDR}`);
  } catch (e) {
    console.warn('⚠️  Habitat registry not configured:', e.message);
  }
}

// Event interface for parsing on-chain ScoreRecorded logs. Built once,
// reused by every indexOnChainScores tick. (Previously instantiated
// inside the cron body on each run — minor garbage but unnecessary.)
const SCORE_EVENT_IFACE = new core.ethers.Interface([
  'event ScoreRecorded(address indexed player, uint8 indexed gameType, uint256 score, uint256 indexed season, uint256 totalGames)',
]);

// ── Username cache (bounded LRU-ish — evict oldest when > 5000 entries
//    so the map doesn't grow to infinity as new wallets hit the backend) ──
const USERNAME_CACHE_MAX = 5000;
const usernameCache = new Map();
// The same lookup, but it also says whether it really got an answer. `ok` is
// false when the chain could not be asked, which is different from "this player
// has no name" and matters to anything that remembers the result.
async function resolveUsernameChecked(addr) {
  const lower = addr.toLowerCase();
  if (usernameCache.has(lower)) {
    // Touch: move to end so it survives the next eviction round.
    const v = usernameCache.get(lower);
    usernameCache.delete(lower);
    usernameCache.set(lower, v);
    return { name: v, ok: true };
  }
  if (!passContract) return { name: null, ok: false };
  try {
    const name = await passContract.getUsername(addr);
    if (name) {
      if (usernameCache.size >= USERNAME_CACHE_MAX) {
        // Evict the oldest (first-inserted) entry — Map iteration is
        // insertion order, so the first key is the least-recently-touched.
        const oldestKey = usernameCache.keys().next().value;
        usernameCache.delete(oldestKey);
      }
      usernameCache.set(lower, name);
    }
    return { name: name || null, ok: true };
  } catch (_) { return { name: null, ok: false }; }
}
async function resolveUsername(addr) {
  return (await resolveUsernameChecked(addr)).name;
}

async function resolveOnChain(wagerId, score) {
  if (!wagerContract || !wagerId) return null;
  try {
    const tx = await wagerContract.resolveWager(BigInt(wagerId), BigInt(score));
    const receipt = await tx.wait();
    console.log(`✅ resolveWager(${wagerId}, ${score}) — tx: ${receipt.hash}`);
    return receipt.hash;
  } catch (e) {
    console.error(`❌ resolveWager failed for wager ${wagerId}:`, e.message);
    return null;
  }
}

// ─── On-chain proof verification for /api/submit-score ──────────────────────
// Before this guard, the backend trusted whatever txHash the frontend sent.
// If the player's recordScoreWithBackendSig reverted on chain (e.g. Forno's
// "phantom revert" when CELO runs out · see reference_celo_insufficient_funds_trap)
// the frontend would STILL pass the txHash and the backend would credit XP +
// activity + score off-chain. Result: ghost ranks — dashboards say "#75"
// but the subgraph shows zero ScoreRecorded events. The on-chain leaderboard
// disagrees with the off-chain one.
//
// Fix: before crediting, fetch the receipt and require status===1 AND a
// ScoreRecorded log keyed to THIS player + game. If the tx didn't land or
// reverted, reject the submit · no off-chain credits land either. Off-chain
// state becomes a strict subset of on-chain state, as intended.
//
// Polling: frontend doesn't await receipt before calling submit-score, so
// the tx may not be mined yet when we look. Poll up to RECEIPT_TIMEOUT_MS,
// with RECEIPT_POLL_MS gaps. Celo blocks are ~5s so 12s covers 2-3 blocks
// of mining latency. If still no receipt after that, reject as "not mined."
const RECEIPT_TIMEOUT_MS = 12_000;
const RECEIPT_POLL_MS = 1_500;

async function verifyScoreTx(txHash, playerAddress, gameType) {
  if (!provider) {
    // No RPC configured — fail open with a warning rather than blocking all
    // submits. This branch should never hit in prod (CELO_RPC always set).
    console.warn('⚠️  verifyScoreTx: no RPC provider, skipping verification');
    return { ok: true, skipped: true };
  }
  const expectedPlayer = playerAddress.toLowerCase();
  const expectedGameType = Number(gameType);
  const expectedContract = GAME_PASS_ADDR.toLowerCase();

  // Poll for receipt. ethers v6 returns null while pending.
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  let receipt = null;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, RECEIPT_POLL_MS));
  }
  if (!receipt) {
    return {
      ok: false,
      reason: lastErr
        ? `Receipt fetch failed: ${lastErr.message?.slice(0, 80) || lastErr}`
        : `Receipt not mined within ${RECEIPT_TIMEOUT_MS}ms · tx may have failed broadcast`,
    };
  }
  if (Number(receipt.status) !== 1) {
    return { ok: false, reason: `Tx reverted on chain (status ${receipt.status})` };
  }
  // Receipt's `to` MUST be the GamePass contract · otherwise the player
  // could submit any unrelated successful tx hash to satisfy the check.
  if ((receipt.to || '').toLowerCase() !== expectedContract) {
    return { ok: false, reason: `Tx target mismatch · expected GamePass at ${expectedContract}, got ${receipt.to}` };
  }
  // Parse logs looking for the ScoreRecorded event keyed to THIS player and
  // game. The contract may emit other events alongside; we only care that
  // the one we're crediting exists.
  let matched = null;
  for (const log of receipt.logs || []) {
    try {
      const parsed = SCORE_EVENT_IFACE.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) continue;
      if (parsed.name !== 'ScoreRecorded') continue;
      const evPlayer = String(parsed.args.player).toLowerCase();
      const evGameType = Number(parsed.args.gameType);
      if (evPlayer === expectedPlayer && evGameType === expectedGameType) {
        matched = {
          player: evPlayer,
          gameType: evGameType,
          score: Number(parsed.args.score),
          season: Number(parsed.args.season),
        };
        break;
      }
    } catch (_) { /* not a ScoreRecorded log */ }
  }
  if (!matched) {
    return {
      ok: false,
      reason: `Tx succeeded but no ScoreRecorded(${expectedPlayer}, gameType=${expectedGameType}) emitted`,
    };
  }
  return { ok: true, onChainScore: matched.score, onChainSeason: matched.season };
}

async function getTreasuryBalance() {
  if (!wagerContract) return '0';
  try {
    const raw = await wagerContract.treasuryBalance();
    return core.ethers.formatUnits(raw, 18);
  } catch (_) { return '0'; }
}
},

// ── On-chain match receipt · Challenge AI → GamePass ──
function* (core) {
  Object.defineProperties(core, {
    recordChallengeMatchOnChain: { get: () => recordChallengeMatchOnChain, enumerable: true, configurable: true },
    challengeReceipts: { get: () => challengeReceipts, enumerable: true, configurable: true },
    ARENA_WEEKLY_POOL_GS: { get: () => ARENA_WEEKLY_POOL_GS, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── On-chain match receipt · Challenge AI → GamePass ────────────────────────
// Every completed Challenge AI match writes ONE transaction to GamePass as
// gameType 3, carrying the player's RUNNING SEASON TOTAL (the sum of their
// points for the current season bucket — the same window the ladder uses). So
// each match is its own tx, and the value climbs: 10 → 23 → 25 …
//
// Why the running total instead of the per-match points:
//   · The on-chain number then EQUALS the ladder total, and because the total
//     only climbs within a season, GamePass's weeklyBest[season][3] naturally
//     ends the season holding that total — directly rankable on-chain. (The
//     GamePass season boundary (block.timestamp / 7 days) is aligned with our
//     SEASON_EPOCH, which is an exact multiple of 7 days, so both reset together
//     and bestScore[3] becomes "best season ever".)
//   · SELF-HEALING: each write re-reads the sum from the DB, so if one match's
//     write fails (best-effort), the NEXT match's write catches the total back
//     up. Per-match writes would lose a failed match's contribution forever.
// Per-match detail still lives in arena_free_matches, so no history is lost.
//
// Backend-submitted via recordScore (validator == on-chain scoreValidator), so
// the player never signs or pays gas — the free instant loop is untouched.
//
// Writes are SERIALIZED through one promise chain so ethers assigns sequential
// nonces: concurrent matches would otherwise race on the validator wallet's
// nonce and all but one would revert. Best-effort throughout — a failed or
// disabled write never affects gameplay, the DB receipt, or the ladder.
// matchId → { txHash, at } for the just-written on-chain receipt. Lets the
// finish screen show a Celoscan link for THIS match without a DB column: the
// player is on the finish screen when the tx lands seconds later, so a short-
// lived in-memory entry is enough. Pruned on write past CHALLENGE_RECEIPT_TTL.
const challengeReceipts = new Map();
const CHALLENGE_RECEIPT_TTL_MS = 10 * 60 * 1000;
function _pruneChallengeReceipts() {
  const cutoff = Date.now() - CHALLENGE_RECEIPT_TTL_MS;
  for (const [id, r] of challengeReceipts) {
    if (r.at < cutoff) challengeReceipts.delete(id);
  }
}

// ─── Signer gas guard ────────────────────────────────────────────────────────
// The score-signer wallet (0xc1cF, == on-chain scoreValidator) pays gas for
// every backend-submitted write AND funds the faucet drips (~0.7 CELO each, the
// biggest drain). If it runs dry, writes revert (caught as best-effort, so
// gameplay is fine) but scores silently stop reaching the chain and drips fail.
//
// This runs as a DECOUPLED periodic check, NOT hung off any one traffic path:
// the wallet drains from faucet drips, Challenge AI writes, and (soon) gasless
// skill-game writes, so a check that only fired on Challenge AI matches would
// miss a faucet-driven drain on a quiet-match night. One cheap getBalance every
// interval covers every drain source. Warns each interval while low so it stays
// visible until topped up. `.unref()` so it never keeps the process alive.
const SIGNER_MIN_CELO = Number(process.env.SIGNER_MIN_CELO || 5);
const SIGNER_GAS_CHECK_INTERVAL_MS = 5 * 60 * 1000;
async function _checkSignerGas() {
  if (!core.provider || !core.passScoreWriter?.runner?.address) return;
  try {
    const addr = core.passScoreWriter.runner.address;
    const bal = Number(core.ethers.formatEther(await core.provider.getBalance(addr)));
    if (bal < SIGNER_MIN_CELO) {
      console.warn(`🔴 SIGNER LOW GAS · ${addr} has ${bal.toFixed(3)} CELO (< ${SIGNER_MIN_CELO}) · top it up or on-chain score writes + faucet drips will start failing`);
    }
  } catch { /* balance check is best-effort */ }
}
if (core.provider && core.passScoreWriter) {
  const _gasTimer = setInterval(_checkSignerGas, SIGNER_GAS_CHECK_INTERVAL_MS);
  if (_gasTimer.unref) _gasTimer.unref();
  _checkSignerGas(); // one check at boot so a wallet that starts low is flagged now
}

async function _doRecordChallengeMatch(session) {
  if (!core.passScoreWriter) return; // no validator key configured — silently skip
  try {
    // Running season total = sum of this wallet's points for the current season
    // bucket. The match was already inserted into arena_free_matches before this
    // runs (onMatchComplete awaits the insert first), so the sum includes it.
    const weekKey = core.arenaWeekKey();
    const { data, error } = await core.supabase
      .from('arena_free_matches')
      .select('points')
      .eq('wallet', session.wallet)
      .eq('week_key', weekKey);
    if (error) throw error;
    let total = 0;
    for (const r of data || []) total += r.points || 0;
    if (total <= 0) return; // nothing to record yet
    // Shared queue: serialized with the gasless skill-game writes on the same signer.
    // Fire-and-forget (best-effort), so we don't wait for the receipt here.
    const tx = await core.enqueueScoreWrite(session.wallet, core.CHALLENGE_AI_GAME_TYPE, total);
    console.log(`🏆 Challenge AI on-chain · ${String(session.wallet).slice(0, 10)}… ${weekKey} total ${total} · ${tx.hash}`);
    if (session.matchId) {
      _pruneChallengeReceipts();
      challengeReceipts.set(String(session.matchId), { txHash: tx.hash, at: Date.now() });
    }
  } catch (e) {
    console.warn(`⚠️  Challenge AI recordScore failed · ${String(session.wallet).slice(0, 10)}…:`, e?.message);
  }
}
function recordChallengeMatchOnChain(session) {
  // Fire-and-forget; the on-chain submit is serialized inside enqueueScoreWrite.
  _doRecordChallengeMatch(session).catch(() => {});
}

const ARENA_WEEKLY_POOL_GS = Number(process.env.ARENA_WEEKLY_POOL_GS || 500);
},

];
