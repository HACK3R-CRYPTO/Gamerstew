// ─── arena ────────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── Arena G$ perks: daily limit + purchase rail ──
function* (core) {
  Object.defineProperties(core, {
    arenaEngine: { get: () => arenaEngine, enumerable: true, configurable: true },
    arenaDayKey: { get: () => arenaDayKey, enumerable: true, configurable: true },
    ARENA_FREE_MATCHES_PER_DAY: { get: () => ARENA_FREE_MATCHES_PER_DAY, enumerable: true, configurable: true },
    hasGamePass: { get: () => hasGamePass, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Arena G$ perks: daily limit + purchase rail ────────────────────────────
// FREE matches/day per wallet. Casual play never hits the wall; ladder
// grinders refill with G$ that routes to the weekly pool wallet.
const ARENA_FREE_MATCHES_PER_DAY = Number(process.env.ARENA_FREE_MATCHES_PER_DAY || 10);
const ARENA_POOL_WALLET = (process.env.ARENA_POOL_WALLET || '').toLowerCase();
const ARENA_G_TOKEN = (process.env.G_TOKEN_ADDR || '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A').toLowerCase();
const ARENA_SKUS = {
  refill_5: { priceWei: core.ethers.parseEther('2'), grantExtra: 5, label: '+5 matches' },
};
const ERC20_TRANSFER_IFACE = new core.ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

// ─── Gasless purchases via EIP-2612 permit ──────────────────────────────────
// G$ on Celo supports permit (verified on-chain: domain GoodDollar/1/42220).
// The player signs a permit for the relayer off-chain (zero gas, zero CELO);
// the relayer submits permit + transferFrom(player → pool wallet) and pays
// the gas. Kills the last purchase friction for embedded-wallet players.
const ARENA_RELAYER_KEY = process.env.ARENA_RELAYER_KEY || process.env.VALIDATOR_PRIVATE_KEY || '';
const arenaRelayer = (core.provider && ARENA_RELAYER_KEY) ? new core.ethers.Wallet(ARENA_RELAYER_KEY, core.provider) : null;
const ARENA_GD = core.provider ? new core.ethers.Contract(ARENA_G_TOKEN, [
  'function nonces(address) view returns (uint256)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
], arenaRelayer || core.provider) : null;

// ─── PerkShop gasless rail (M1 G$ Perk Economy) ─────────────────────────────
// Same relayer, same permit trick as the arena refill: the player signs a
// permit for the PerkShop contract (spender = PerkShop), the relayer submits
// buyPerkWithPermit and pays the gas. The 20/80 split runs inside the contract.
const PERK_SHOP_ADDRESS = (process.env.PERK_SHOP_ADDRESS || '0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5').toLowerCase();
const PERK_SHOP = (core.provider && arenaRelayer) ? new core.ethers.Contract(PERK_SHOP_ADDRESS, [
  'function buyPerkWithPermit(address player, uint16 perkId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
], arenaRelayer) : null;

// PerkShop perk #6 = the Challenge AI match ticket. A verified purchase of it
// grants +5 matches — the PerkShop-native replacement for the refill_5 SKU,
// so ticket spend now routes through the same 20/80 split as every perk.
const PERK_TICKET_ID = 6;
const PERK_TICKET_GRANT = 5;
// Consumable save/retry perks that stock as an inventory (owned - used).
// Cosmetics (2, 4) are on-chain ownership; the Match Pack (6) grants matches.
const CONSUMABLE_STOCK_PERKS = new Set([1, 3, 5]);
const PERK_PURCHASED_IFACE = new core.ethers.Interface([
  'event PerkPurchased(address indexed player, uint16 indexed perkId, bool cosmetic, uint256 totalPaid, uint256 ubiAmount, uint256 treasuryAmount)',
]);

// Shared grant: record the purchase (replay-proof via tx_hash PK) and bump
// today's extra allowance. Used by both the direct-transfer and gasless paths.
async function arenaGrantPurchase(wallet, sku, txHash, amountWei) {
  const item = ARENA_SKUS[sku];
  const { error: insErr } = await core.supabase.from('arena_purchases').insert({
    tx_hash: txHash, wallet, sku, amount_wei: amountWei.toString(),
  });
  if (insErr) return { ok: false, reason: 'grant_failed' };
  const day = arenaDayKey();
  const { data: row } = await core.supabase
    .from('arena_daily').select('used, extra').eq('wallet', wallet).eq('day', day).maybeSingle();
  await core.supabase.from('arena_daily').upsert({
    wallet, day,
    used: row?.used ?? 0,
    extra: (row?.extra ?? 0) + item.grantExtra,
    updated_at: new Date().toISOString(),
  });
  return { ok: true, remaining: ARENA_FREE_MATCHES_PER_DAY + (row?.extra ?? 0) + item.grantExtra - (row?.used ?? 0) };
}

function arenaDayKey() { return new Date().toISOString().slice(0, 10); }

// Consume one match slot. Fail-soft: if the table is missing (local setup
// pre-migration) play is unlimited. Read-then-update has a benign race at
// this scale; the limit is an economy dial, not a security boundary.
async function arenaConsumeSlot(wallet) {
  const day = arenaDayKey();
  try {
    const { data, error } = await core.supabase
      .from('arena_daily')
      .select('used, extra')
      .eq('wallet', wallet)
      .eq('day', day)
      .maybeSingle();
    if (error) throw error;
    const used = data?.used ?? 0;
    const extra = data?.extra ?? 0;
    const allowance = ARENA_FREE_MATCHES_PER_DAY + extra;
    if (used >= allowance) return { ok: false, remaining: 0 };
    await core.supabase.from('arena_daily').upsert({
      wallet, day, used: used + 1, extra, updated_at: new Date().toISOString(),
    });
    return { ok: true, remaining: allowance - used - 1 };
  } catch (e) {
    // Fail CLOSED on a real error. This used to return ok:true on ANY error,
    // so a transient DB blip silently handed out UNLIMITED free matches. The
    // one legitimate exception is a genuinely absent table (local dev before
    // the migration), which we detect explicitly rather than assuming.
    const missingTable = /PGRST205|does not exist|schema cache/i.test(e?.message || '');
    if (missingTable) return { ok: true, remaining: null }; // local dev only
    console.error('arenaConsumeSlot failed · denying slot:', e?.message);
    return { ok: false, remaining: 0 };
  }
}

// Verify a G$ transfer to the pool wallet and grant the SKU. Mirrors the
// verifyScoreTx pattern: receipt polled, status checked, target checked,
// Transfer(player → pool, ≥price) parsed from logs. tx_hash PK = replay-proof.
async function arenaVerifyPurchase(txHash, wallet, sku) {
  const item = ARENA_SKUS[sku];
  if (!item) return { ok: false, reason: 'unknown_sku' };
  if (!ARENA_POOL_WALLET) return { ok: false, reason: 'pool_wallet_unconfigured' };
  if (!core.provider) return { ok: false, reason: 'rpc_unavailable' };

  const { data: existing } = await core.supabase
    .from('arena_purchases').select('tx_hash').eq('tx_hash', txHash).maybeSingle();
  if (existing) return { ok: false, reason: 'tx_already_used' };

  const deadline = Date.now() + core.RECEIPT_TIMEOUT_MS;
  let receipt = null;
  while (Date.now() < deadline) {
    try { receipt = await core.provider.getTransactionReceipt(txHash); if (receipt) break; } catch {}
    await new Promise(r => setTimeout(r, core.RECEIPT_POLL_MS));
  }
  if (!receipt) return { ok: false, reason: 'receipt_not_found' };
  if (Number(receipt.status) !== 1) return { ok: false, reason: 'tx_reverted' };
  if ((receipt.to || '').toLowerCase() !== ARENA_G_TOKEN) {
    return { ok: false, reason: 'tx_not_gdollar' };
  }
  let paid = null;
  for (const log of receipt.logs || []) {
    try {
      const parsed = ERC20_TRANSFER_IFACE.parseLog({ topics: log.topics, data: log.data });
      if (!parsed || parsed.name !== 'Transfer') continue;
      if (String(parsed.args.from).toLowerCase() !== wallet) continue;
      if (String(parsed.args.to).toLowerCase() !== ARENA_POOL_WALLET) continue;
      if (BigInt(parsed.args.value) >= item.priceWei) { paid = parsed.args.value; break; }
    } catch {}
  }
  if (!paid) return { ok: false, reason: 'transfer_to_pool_not_found' };

  const { error: insErr } = await core.supabase.from('arena_purchases').insert({
    tx_hash: txHash, wallet, sku, amount_wei: paid.toString(),
  });
  if (insErr) return { ok: false, reason: 'grant_failed' }; // unique violation = replay race

  // Grant: bump today's extra allowance.
  const day = arenaDayKey();
  const { data: row } = await core.supabase
    .from('arena_daily').select('used, extra').eq('wallet', wallet).eq('day', day).maybeSingle();
  await core.supabase.from('arena_daily').upsert({
    wallet, day,
    used: row?.used ?? 0,
    extra: (row?.extra ?? 0) + item.grantExtra,
    updated_at: new Date().toISOString(),
  });
  const remaining = ARENA_FREE_MATCHES_PER_DAY + (row?.extra ?? 0) + item.grantExtra - (row?.used ?? 0);
  return { ok: true, remaining };
}

// ─── GamePass gate · ladder integrity ───────────────────────────────────────
// Anyone can PLAY the arena free · that is the funnel and we keep it open.
// But a match only COUNTS on the ladder if the wallet actually minted a
// GamePass on-chain, exactly like the other games (play free, mint to save
// your score). Minting costs a real signature and gas, so throwaway wallets
// stop being free.
//
// Why this exists: the ladder previously recorded any address the caller
// passed. The daily cap is per-wallet, so one operator with N wallets got N x
// the free allowance. That is exactly what happened · 11 wallets first seen
// inside a 107-second window, each burning precisely the 10/day cap for two
// days, none of them holding a pass.
//
// Cached with a TTL so a real player costs one RPC read, not one per match.
// Fails CLOSED: if we cannot prove a pass, the match is not recorded. A real
// player loses one row during an RPC blip; a sybil farm gets nothing. That is
// the right trade for a ladder that pays G$.
const PASS_CACHE_TTL_MS = 10 * 60 * 1000;
const passCache = new Map(); // wallet -> { has: boolean, at: number }

async function hasGamePass(wallet) {
  const w = (wallet || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) return false;
  const hit = passCache.get(w);
  if (hit && Date.now() - hit.at < PASS_CACHE_TTL_MS) return hit.has;
  if (!core.passContract) return false; // no RPC configured · cannot prove · fail closed
  try {
    const has = await core.passContract.hasMinted(w);
    passCache.set(w, { has: !!has, at: Date.now() });
    return !!has;
  } catch (e) {
    console.warn(`⚠️  GamePass check failed for ${w.slice(0, 10)}…:`, e?.message);
    if (hit) return hit.has; // a stale answer beats guessing
    return false;            // fail closed
  }
}

const arenaEngine = new core.ArenaMatchEngine({
  onMatchComplete: async (session) => {
    // Receipt layer: persist completed matches for history, ladder, and the
    // async Oracle attestation. Table may not exist yet in local setups —
    // persistence is best-effort, gameplay never depends on it.
    try {
      if (!(await hasGamePass(session.wallet))) {
        // Played fine, just not ranked. The finish screen prompts the mint.
        console.log(`⛔ arena match not recorded · no GamePass: ${String(session.wallet).slice(0, 10)}…`);
        core.attestInstantMatch(session);
        return;
      }
      await core.supabase.from('arena_free_matches').insert({
        match_id: session.matchId,
        wallet: session.wallet,
        player_wins: session.playerWins,
        ai_wins: session.aiWins,
        ties: session.ties,
        outcome: session.playerWins > session.aiWins ? 'player_won'
               : session.aiWins > session.playerWins ? 'ai_won' : 'tie',
        rounds: session.rounds,
        commit_hash: session.commitHash,
        seed: session.seed,
        points: core.arenaPoints(session),
        week_key: core.arenaWeekKey(),
        created_at: new Date(session.createdAt).toISOString(),
      });
    } catch (e) {
      console.error('arena match persist failed:', e?.message);
    }
    // On-chain receipt: one ScoreRecorded event per match (gameType 3), the same
    // history trail the skill games leave. Fire-and-forget + serialized inside —
    // never blocks or breaks the match flow. Reached only past the hasGamePass
    // gate above, so the player is guaranteed minted (recordScore requires it).
    core.recordChallengeMatchOnChain(session);
    // ERC-8004 reputation: emit one match_completed feedback per finished
    // match (throttled inside the oracle · min-interval, fire-and-forget).
    // Replaces the wager-era hook that fired after resolveMatch, which v3
    // Instant Arena matches never reach · without this MARKOV's engagement
    // dimension on 8004scan stalls.
    core.attestInstantMatch(session);
  },
});

// POST /api/arena/start — open an instant match. Returns the commit hash
// BEFORE any round: MARKOV's moves are provably pre-seeded. Enforces the
// daily free-match limit; when exhausted, returns the refill offer.
core.app.post('/api/arena/start', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { playerAddress } = req.body || {};
  if (!playerAddress || !/^0x[0-9a-fA-F]{40}$/.test(playerAddress)) {
    return res.status(400).json({ error: 'playerAddress required' });
  }
  const slot = await arenaConsumeSlot(playerAddress.toLowerCase());
  if (!slot.ok) {
    // Gasless path metadata: the player's current G$ permit nonce + the
    // relayer address the permit must approve. Best-effort — if the RPC
    // read fails, the frontend falls back to the direct-transfer path.
    let permitNonce = null;
    if (ARENA_GD && arenaRelayer) {
      try { permitNonce = (await ARENA_GD.nonces(playerAddress)).toString(); } catch {}
    }
    return res.status(402).json({
      error: 'daily_limit',
      remaining: 0,
      refill: {
        sku: 'refill_5',
        // Display price only. The actual charge is PerkShop perk #6 "Match Pack"
        // (frontend buys it via buyPerk), so this MUST match that perk's price
        // (50 G$). It was left at the retired 2 G$ direct-refill value, which
        // showed "pay 2 G$" while 50 G$ was deducted.
        priceGs: 50,
        grants: 5,
        poolWallet: ARENA_POOL_WALLET,
        gToken: ARENA_G_TOKEN,
        relayer: arenaRelayer ? arenaRelayer.address : null,
        permitNonce,
      },
    });
  }
  return res.json({ ...arenaEngine.start(playerAddress), remainingToday: slot.remaining });
});

// POST /api/arena/purchase-gasless — the player signed an EIP-2612 permit
// for the relayer; we submit permit + transferFrom(player → pool) paying
// gas ourselves, then grant. Body: { wallet, sku, deadline, v, r, s }.
// Replay-safe twice over: the permit nonce is single-use on-chain, and the
// transferFrom tx hash is the arena_purchases primary key.
core.app.post('/api/arena/purchase-gasless', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { wallet, sku, deadline, v, r, s } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  const item = ARENA_SKUS[String(sku)];
  if (!item) return res.status(400).json({ error: 'unknown_sku' });
  if (!ARENA_GD || !arenaRelayer) return res.status(400).json({ error: 'gasless_unavailable' });
  if (!ARENA_POOL_WALLET) return res.status(400).json({ error: 'pool_wallet_unconfigured' });
  try {
    const permitTx = await ARENA_GD.permit(wallet, arenaRelayer.address, item.priceWei, BigInt(deadline), Number(v), r, s);
    await permitTx.wait();
    const moveTx = await ARENA_GD.transferFrom(wallet, ARENA_POOL_WALLET, item.priceWei);
    const rc = await moveTx.wait();
    if (Number(rc.status) !== 1) return res.status(400).json({ error: 'transfer_reverted' });
    const out = await arenaGrantPurchase(wallet.toLowerCase(), String(sku), rc.hash, item.priceWei);
    if (!out.ok) return res.status(400).json({ error: out.reason });
    return res.json({ ok: true, remaining: out.remaining, txHash: rc.hash });
  } catch (e) {
    console.error('gasless purchase failed:', e?.shortMessage || e?.message);
    return res.status(400).json({ error: 'gasless_failed' });
  }
});

// POST /api/arena/purchase — verify an on-chain G$ transfer to the pool
// wallet and grant the SKU. Body: { wallet, sku, txHash }.
core.app.post('/api/arena/purchase', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { wallet, sku, txHash } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ error: 'txHash required' });
  const out = await arenaVerifyPurchase(txHash, wallet.toLowerCase(), String(sku));
  if (!out.ok) return res.status(400).json({ error: out.reason });
  return res.json({ ok: true, remaining: out.remaining });
});

// POST /api/perks/buy-gasless — the player signed an EIP-2612 permit for the
// PerkShop contract; the relayer submits buyPerkWithPermit and pays gas, so
// the buy costs the player zero CELO and one signature. The G$ split (20% UBI
// / 80% treasury) happens inside the contract. Body: { wallet, perkId, deadline, v, r, s }.
// Replay-safe: the permit nonce is single-use on-chain.
core.app.post('/api/perks/buy-gasless', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { wallet, perkId, deadline, v, r, s } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  const pid = Number(perkId);
  if (!Number.isInteger(pid) || pid < 1 || pid > 65535) return res.status(400).json({ error: 'bad_perk' });
  if (!PERK_SHOP || !arenaRelayer) return res.status(400).json({ error: 'gasless_unavailable' });
  try {
    const tx = await PERK_SHOP.buyPerkWithPermit(wallet, pid, BigInt(deadline), Number(v), r, s);
    const rc = await tx.wait();
    if (Number(rc.status) !== 1) return res.status(400).json({ error: 'purchase_reverted' });
    return res.json({ ok: true, txHash: rc.hash });
  } catch (e) {
    console.error('perk gasless failed:', e?.shortMessage || e?.message);
    return res.status(400).json({ error: 'gasless_failed' });
  }
});

// POST /api/perks/grant — verify an on-chain PerkShop purchase and grant it.
// Routes by perk: the Match Pack (#6) grants +5 matches; save/retry perks
// (1/3/5) stock as inventory (owned - used); cosmetics need no grant (owned
// on-chain). Works for both gasless and direct buys — the frontend hands us the
// buy tx hash. Replay-safe: tx hash is the arena_purchases primary key.
// Body: { wallet, txHash }.
core.app.post('/api/perks/grant', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { wallet, txHash } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ error: 'txHash required' });
  if (!core.provider) return res.status(400).json({ error: 'rpc_unavailable' });
  const w = wallet.toLowerCase();

  const { data: existing } = await core.supabase
    .from('arena_purchases').select('tx_hash').eq('tx_hash', txHash).maybeSingle();
  if (existing) return res.status(400).json({ error: 'tx_already_used' });

  // Wait for the receipt, then confirm it's a PerkShop PerkPurchased by this wallet.
  const deadline = Date.now() + core.RECEIPT_TIMEOUT_MS;
  let receipt = null;
  while (Date.now() < deadline) {
    try { receipt = await core.provider.getTransactionReceipt(txHash); if (receipt) break; } catch {}
    await new Promise(r => setTimeout(r, core.RECEIPT_POLL_MS));
  }
  if (!receipt) return res.status(400).json({ error: 'receipt_not_found' });
  if (Number(receipt.status) !== 1) return res.status(400).json({ error: 'tx_reverted' });

  let matched = null;
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== PERK_SHOP_ADDRESS) continue;
    try {
      const parsed = PERK_PURCHASED_IFACE.parseLog({ topics: log.topics, data: log.data });
      if (!parsed || parsed.name !== 'PerkPurchased') continue;
      if (String(parsed.args.player).toLowerCase() !== w) continue;
      matched = parsed.args; break;
    } catch {}
  }
  if (!matched) return res.status(400).json({ error: 'perk_purchase_not_found' });
  const pid = Number(matched.perkId);

  // Record the purchase (idempotency guard).
  const { error: insErr } = await core.supabase.from('arena_purchases').insert({
    tx_hash: txHash, wallet: w, sku: 'perk_' + pid, amount_wei: String(matched.totalPaid),
  });
  if (insErr) return res.status(400).json({ error: 'tx_already_used' }); // unique violation = replay race

  // Route the grant by perk type.
  if (pid === PERK_TICKET_ID) {
    const day = arenaDayKey();
    const { data: row } = await core.supabase
      .from('arena_daily').select('used, extra').eq('wallet', w).eq('day', day).maybeSingle();
    await core.supabase.from('arena_daily').upsert({
      wallet: w, day, used: row?.used ?? 0,
      extra: (row?.extra ?? 0) + PERK_TICKET_GRANT, updated_at: new Date().toISOString(),
    });
    const remaining = ARENA_FREE_MATCHES_PER_DAY + (row?.extra ?? 0) + PERK_TICKET_GRANT - (row?.used ?? 0);
    return res.json({ ok: true, kind: 'matches', remaining });
  }
  if (CONSUMABLE_STOCK_PERKS.has(pid)) {
    const { data: row } = await core.supabase
      .from('perk_inventory').select('balance').eq('wallet', w).eq('perk_id', pid).maybeSingle();
    const balance = (row?.balance ?? 0) + 1;
    await core.supabase.from('perk_inventory').upsert({
      wallet: w, perk_id: pid, balance, updated_at: new Date().toISOString(),
    });
    return res.json({ ok: true, kind: 'stock', perkId: pid, balance });
  }
  return res.json({ ok: true, kind: 'cosmetic' }); // ownership is on-chain, nothing to grant
});

// POST /api/perks/use — spend one save/retry from a player's stock. Called by
// the game when a player uses a save they bought ahead. Body: { wallet, perkId }.
core.app.post('/api/perks/use', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { wallet, perkId } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  const pid = Number(perkId);
  if (!CONSUMABLE_STOCK_PERKS.has(pid)) return res.status(400).json({ error: 'not_a_stock_perk' });
  const w = wallet.toLowerCase();
  const { data: row } = await core.supabase
    .from('perk_inventory').select('balance').eq('wallet', w).eq('perk_id', pid).maybeSingle();
  const bal = row?.balance ?? 0;
  if (bal <= 0) return res.json({ ok: false, balance: 0 });
  await core.supabase.from('perk_inventory').upsert({
    wallet: w, perk_id: pid, balance: bal - 1, updated_at: new Date().toISOString(),
  });
  return res.json({ ok: true, balance: bal - 1 });
});

// GET /api/perks/inventory?wallet=0x… — a player's save/retry stock counts.
core.app.get('/api/perks/inventory', core.requireSecret, async (req, res) => {
  const w = (req.query.wallet || '').toString().toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(w)) return res.status(400).json({ error: 'wallet required' });
  try {
    const { data } = await core.supabase.from('perk_inventory').select('perk_id, balance').eq('wallet', w);
    const balances = {};
    for (const r of data || []) if (r.balance > 0) balances[r.perk_id] = r.balance;
    return res.json({ balances });
  } catch {
    return res.json({ balances: {} });
  }
});
},

// ── Live match spectating (SSE) ──
function* (core) {
  Object.defineProperties(core, {
    classifyAgents: { get: () => classifyAgents, enumerable: true, configurable: true },
    liveMatchHub: { get: () => liveMatchHub, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// POST /api/arena/throw — one round. Instant response with MARKOV's move,
// round result, persona line, and (on match end) the seed reveal + model stats.
// ─── Live match spectating (SSE) ─────────────────────────────────────────────
// Lets anyone watch an in-progress MARKOV match round-by-round, e.g. a
// GoodAgents agent playing MARKOV. One-way server→viewer push, so SSE (not
// WebSocket): simpler, auto-reconnects, scales. Each round the match engine
// produces is broadcast to every viewer subscribed to that matchId. Late
// joiners replay a short history buffer so they catch up. The stream is public
// (match moves are non-sensitive and verifiable via the revealed seed).
//
// NOTE ON PACING: a match otherwise resolves in milliseconds. For a watchable
// live view, the CALLER (the agent) should pace its /api/arena/throw calls
// (~1s between rounds). This feed relays whatever rounds arrive.
const liveMatchHub = new Map(); // matchId → { clients:Set<res>, history:[] }
function liveHub(matchId) {
  let h = liveMatchHub.get(matchId);
  if (!h) { h = { clients: new Set(), history: [] }; liveMatchHub.set(matchId, h); }
  return h;
}
function liveBroadcast(matchId, type, payload) {
  // liveHub (not .get): CREATE the hub so history buffers from round 1 even
  // when no viewer has connected yet. With .get, rounds broadcast before the
  // first viewer were dropped — every spectator joined mid-match missing the
  // opening rounds. Hubs are cleaned up 30s after the 'end' frame as before.
  const h = liveHub(matchId);
  const frame = { type, ...payload };
  const chunk = `data: ${JSON.stringify(frame)}\n\n`;
  if (h) {
    h.history.push(chunk);
    if (h.history.length > 24) h.history.shift();
    for (const res of h.clients) { try { res.write(chunk); } catch { /* dropped */ } }
    if (type === 'end') {
      for (const res of h.clients) { try { res.end(); } catch {} }
      setTimeout(() => liveMatchHub.delete(matchId), 30_000); // keep briefly for late joiners
    }
  }
}

// GET /api/arena/live/:matchId — SSE stream of a match's rounds as they play.
// Public + CORS so a partner site (e.g. goodagentids.xyz) can subscribe via
// EventSource. Events: {type:'round', round, playerMove, aiMove, result,
// score, ...} per round, then {type:'end', final:{outcome, seed, ...}}.
core.app.get('/api/arena/live/:matchId', (req, res) => {
  const matchId = String(req.params.matchId || '');
  if (!matchId) return res.status(400).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no', // don't let proxies buffer the stream
  });
  res.flushHeaders?.();
  const h = liveHub(matchId);
  h.clients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'hello', matchId })}\n\n`);
  for (const chunk of h.history) res.write(chunk); // replay so late joiners catch up
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20_000);
  req.on('close', () => { clearInterval(hb); h.clients.delete(res); });
});

core.app.post('/api/arena/throw', core.requireSecret, core.gameSubmitLimiter, (req, res) => {
  const { matchId, move } = req.body || {};
  if (typeof matchId !== 'string') return res.status(400).json({ error: 'matchId required' });
  const out = core.arenaEngine.throw(matchId, Number(move));
  if (out.error) return res.status(400).json(out);
  // Push this round to any live spectators, then close the stream on match end.
  liveBroadcast(matchId, out.final ? 'end' : 'round', out);
  return res.json(out);
});

// ─── Agent play (GoodAgents) ─────────────────────────────────────────────────
// A deployed GoodAgents agent plays MARKOV through these two routes, driven by
// GoodAgents' server with the scoped AGENT_PLAY_KEY. They mirror /start + /throw
// but: (1) auth is the scoped key, not the master secret; (2) no human daily
// free-match limit — agents are their own track; (3) /start verifies on-chain
// that the address is a real deployed agent, so only genuine agents can grind
// the board. Matches still flow through arenaEngine → onMatchComplete, so they
// land on the same ladder (the frontend splits Players vs Agents by detection)
// and stream live via the existing SSE feed. The caller MUST pace throws (~1s)
// or the match resolves in milliseconds with nothing to watch.
const AGENT_VAULT_ADDRESS = '0x0409042B55e99Df8c0Feb7525A770838f3A47090';
const agentVault = core.provider ? new core.ethers.Contract(AGENT_VAULT_ADDRESS, [
  'function getAgent(address) view returns (address operator, uint256 stakeAmount, uint256 unlockAt)',
], core.provider) : null;

// Batch agent classification · one RPC round-trip for a whole leaderboard.
// getAgent(wallet) returns a non-zero operator only for a deployed GoodAgents
// agent; humans get the zero address. The Cup uses this to (a) pull agents out
// of the Human ladder and (b) build the Agent ladder — the same on-chain gate
// the in-app arena board uses (useAgentOperators), so the two boards agree.
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const multicall3 = core.provider ? new core.ethers.Contract(MULTICALL3_ADDRESS, [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)',
], core.provider) : null;
const _vaultIface = new core.ethers.Interface([
  'function getAgent(address) view returns (address operator, uint256 stakeAmount, uint256 unlockAt)',
]);
// wallets -> Map(agentWalletLower -> ownerWalletLower), agents only.
async function classifyAgents(wallets) {
  const out = new Map();
  const list = [...new Set((wallets || []).map((w) => (w || '').toLowerCase()).filter(Boolean))];
  if (!multicall3 || !list.length) return out;
  const CHUNK = 400;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const calls = chunk.map((w) => ({
      target: AGENT_VAULT_ADDRESS, allowFailure: true,
      callData: _vaultIface.encodeFunctionData('getAgent', [w]),
    }));
    let results;
    try { results = await multicall3.aggregate3(calls); }
    catch (e) { console.warn('classifyAgents multicall:', e?.shortMessage || e?.message || e); continue; }
    results.forEach((r, j) => {
      if (!r.success) return;
      try {
        const [operator] = _vaultIface.decodeFunctionResult('getAgent', r.returnData);
        if (operator && !/^0x0+$/.test(operator)) out.set(chunk[j], operator.toLowerCase());
      } catch { /* undecodable · treat as human */ }
    });
  }
  return out;
}

// On-chain gate: a real agent has a non-zero operator on the vault. Blocks
// random wallets from posing as agents on the board. Returns null if OK,
// or an {status, error} object to send back.
async function verifyAgentAddress(agentAddress) {
  if (!agentVault) return null; // RPC down · fail open (dev)
  try {
    const [operator] = await agentVault.getAgent(agentAddress);
    if (!operator || /^0x0+$/.test(operator)) {
      return { status: 403, error: 'not_a_deployed_agent' };
    }
    return null;
  } catch (e) {
    console.error('agent verify failed:', e?.shortMessage || e?.message);
    return { status: 503, error: 'agent_verify_unavailable' };
  }
}

core.app.post('/api/arena/agent/start', core.requireAgentKey, core.gameSubmitLimiter, async (req, res) => {
  const { agentAddress } = req.body || {};
  if (!agentAddress || !/^0x[0-9a-fA-F]{40}$/.test(agentAddress)) {
    return res.status(400).json({ error: 'agentAddress required' });
  }
  const bad = await verifyAgentAddress(agentAddress);
  if (bad) return res.status(bad.status).json({ error: bad.error });
  return res.json(core.arenaEngine.start(agentAddress));
});

// POST /api/arena/agent/play — start a match AND drive it to completion on the
// server, one paced round at a time, broadcasting each round to the live SSE
// feed. Returns the matchId immediately so the caller (a player tapping "send
// my agent", or GoodAgents) can open the live view right away. Auth accepts the
// scoped agent key OR GameArena's own internal secret (its "play" button hits
// this via a server action).
//
// NOTE: the agent's moves here are chosen server-side — this is the exhibition/
// self-play driver that makes the match watchable on demand. When GoodAgents
// drives its own agent's real strategy, it uses /agent/start + /agent/throw
// instead and this route is skipped.
core.app.post('/api/arena/agent/play', core.gameSubmitLimiter, async (req, res) => {
  const keyOk = core.AGENT_PLAY_KEY && req.headers['x-agent-key'] === core.AGENT_PLAY_KEY;
  const secretOk = core.INTERNAL_SECRET && req.headers['x-internal-secret'] === core.INTERNAL_SECRET;
  if (!keyOk && !secretOk) return res.status(401).json({ error: 'Unauthorized' });

  const { agentAddress, pace } = req.body || {};
  if (!agentAddress || !/^0x[0-9a-fA-F]{40}$/.test(agentAddress)) {
    return res.status(400).json({ error: 'agentAddress required' });
  }
  const bad = await verifyAgentAddress(agentAddress);
  if (bad) return res.status(bad.status).json({ error: bad.error });

  const started = core.arenaEngine.start(agentAddress);
  const matchId = started.matchId;
  // Answer instantly · the client opens the live feed on this id.
  res.json({ matchId, commitHash: started.commitHash, bestOf: started.bestOf, winsNeeded: started.winsNeeded });

  // Drive the match asynchronously so viewers see it unfold round by round.
  const stepMs = Math.min(Math.max(Number(pace) || 1100, 500), 3000);
  (async () => {
    // Cap high enough that even a tie-heavy random driver reaches 3 wins; ties
    // replay and don't count, so a match can run well past 5 rounds.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, stepMs));
      const move = Math.floor(Math.random() * 3);
      const out = core.arenaEngine.throw(matchId, move);
      if (!out || out.error) break;
      liveBroadcast(matchId, out.final ? 'end' : 'round', out);
      if (out.final) break;
    }
  })().catch((e) => console.error('agent self-play failed:', e?.message));
});

core.app.post('/api/arena/agent/throw', core.requireAgentKey, core.gameSubmitLimiter, (req, res) => {
  const { matchId, move } = req.body || {};
  if (typeof matchId !== 'string') return res.status(400).json({ error: 'matchId required' });
  const out = core.arenaEngine.throw(matchId, Number(move));
  if (out.error) return res.status(400).json(out);
  liveBroadcast(matchId, out.final ? 'end' : 'round', out);
  return res.json(out);
});

// GET /api/arena/receipt?matchId=… — the on-chain GamePass tx for a finished
// match, once written. The write fires fire-and-forget in onMatchComplete, so
// the finish screen polls this a few times: { pending: true } until the tx
// lands, then { txHash }. Absent entry = not written yet (or the player had no
// GamePass / validator key unset) — the finish screen just shows nothing.
core.app.get('/api/arena/receipt', core.requireSecret, (req, res) => {
  const matchId = (req.query.matchId || '').toString();
  if (!matchId) return res.status(400).json({ error: 'matchId required' });
  const r = core.challengeReceipts.get(matchId);
  if (r && r.txHash) return res.json({ txHash: r.txHash });
  return res.json({ pending: true });
});

// GET /api/arena/ladder?wallet=0x…&week=2026-W27 — the weekly MARKOV ladder.
// Aggregates the requested ISO week (default: current): points desc, then
// wins desc. Returns top 20 + own standing + pool + the list of past weeks
// so finished boards stay viewable forever (bragging rights don't expire).
core.app.get('/api/arena/ladder', core.requireSecret, async (req, res) => {
  try {
    const currentWeek = core.arenaWeekKey();
    const reqWeek = (req.query.week || '').toString();
    // Accept the new season key (S<n>) and the legacy ISO form (YYYY-Www) so
    // past weeks stay viewable through the transition.
    const week = /^(S\d+|\d{4}-W\d{2})$/.test(reqWeek) ? reqWeek : currentWeek;
    const wallet = (req.query.wallet || '').toString().toLowerCase();

    // Full standings for the week, cached briefly.
    //
    // Aggregate in the DATABASE, not the app. Postgres GROUP BY returns one row
    // per wallet — a set bounded by the player count (hundreds), never by the
    // match count (unbounded as agents grind). This is what keeps the ladder
    // correct forever: there is no raw-row scan in the app, so PostgREST's
    // 1000-row response cap can never truncate the board again, and the work
    // stays flat no matter how many millions of matches a season accumulates.
    // (History: an unpaginated raw read silently dropped players once weekly
    // volume passed 1000 — a single agent's grind filled the whole window.)
    const ladderKey = `arena:ladder:${week}`;
    let standings = core.cacheGet(ladderKey);
    if (!standings) {
      standings = await core.arenaLadderStandings(week);
      standings.forEach((s, i) => { s.rank = i + 1; });
      // Usernames for the visible slice (GamePass on-chain names, LRU-cached).
      await Promise.all(standings.slice(0, 20).map(async (s) => { s.username = await core.resolveUsername(s.wallet); }));
      core.cacheSet(ladderKey, standings, 30_000);
    }

    // Past weeks — newest first. DON'T sample arena_free_matches ordered by
    // week_key: the CURRENT season's grind (agents play thousands of matches)
    // fills any row-limited sample, truncating every finished season out of the
    // window — which is why the PAST tab showed "no finished weeks" despite ~26
    // sealed seasons. Instead derive the candidate season keys from the SAME
    // clock arenaWeekKey uses (like the skill-game leaderboards do), and keep
    // the ones that actually have matches. Cached — the list only changes on a
    // season rollover, and it's identical for every caller (no wallet in it).
    const seasonNum = k => (/^S(\d+)$/.test(k) ? parseInt(k.slice(1), 10) : -1);
    let weeks = core.cacheGet('arena:weeks');
    if (!weeks) {
      weeks = [currentWeek];
      try {
        const seen = new Set([currentWeek]);
        const curN = seasonNum(currentWeek);
        if (curN > 1) {
          // Existence check per finished season · the current season (the only
          // high-volume key) is excluded by construction, so no truncation.
          const candidates = [];
          for (let n = curN - 1; n >= Math.max(1, curN - 12); n--) candidates.push(`S${n}`);
          const hits = await Promise.all(candidates.map(async (k) => {
            const { data } = await core.supabase.from('arena_free_matches').select('week_key').eq('week_key', k).limit(1);
            return data && data.length ? k : null;
          }));
          for (const k of hits) if (k) seen.add(k);
        }
        // Legacy ISO week keys (rows from before the season-aligned switch).
        const { data: legacy } = await core.supabase.from('arena_free_matches').select('week_key').like('week_key', '%-W%').limit(500);
        for (const r of legacy || []) seen.add(r.week_key);
        weeks = [...seen].sort((a, b) => {
          const an = seasonNum(a), bn = seasonNum(b);
          if (an >= 0 && bn >= 0) return bn - an;
          if (an >= 0) return -1;
          if (bn >= 0) return 1;
          return a < b ? 1 : -1;
        }).slice(0, 12);
      } catch { weeks = [currentWeek]; }
      core.cacheSet('arena:weeks', weeks, 5 * 60 * 1000);
    }

    const me = wallet ? standings.find((s) => s.wallet === wallet) || null : null;
    if (me && me.username === undefined) me.username = await core.resolveUsername(me.wallet);

    // Remaining matches today for the asking wallet — lets the lobby show
    // the counter on entry instead of only after the first match starts.
    let remainingToday = null;
    if (wallet) {
      try {
        const { data: daily } = await core.supabase
          .from('arena_daily')
          .select('used, extra')
          .eq('wallet', wallet)
          .eq('day', core.arenaDayKey())
          .maybeSingle();
        remainingToday = Math.max(0, core.ARENA_FREE_MATCHES_PER_DAY + (daily?.extra ?? 0) - (daily?.used ?? 0));
      } catch { /* table absent → unlimited, leave null */ }
    }

    // Live pool = seeded base + this week's player purchases. Keeps the
    // "your G$ goes into the pool" promise visibly true: every refill
    // bought this week grows the number players are competing for.
    // Pool = this SEASON's player purchases (aligned to the ladder window, not
    // an ISO Mon-Sun week) + the seeded base.
    const season = core.currentSeasonNumber();
    const { start: seasonStart, end: seasonEnd } = core.seasonBounds(season);
    let purchasedGs = 0;
    try {
      const { data: buys } = await core.supabase
        .from('arena_purchases')
        .select('amount_wei')
        .gte('created_at', new Date(seasonStart * 1000).toISOString());
      for (const b of buys || []) purchasedGs += Number(b.amount_wei) / 1e18;
    } catch { /* purchases table absent → base pool only */ }

    return res.json({
      week,
      currentWeek,
      weeks,
      remainingToday,
      currentSeason: season,
      currentEndsAt: seasonEnd,      // unix seconds · same boundary as skill seasons
      currentStartsAt: seasonStart,
      poolGs: Math.round(core.ARENA_WEEKLY_POOL_GS + purchasedGs),
      poolBaseGs: core.ARENA_WEEKLY_POOL_GS,
      poolFromPlayersGs: Math.round(purchasedGs * 100) / 100,
      players: standings.length,
      top: standings.slice(0, 20),
      me,
    });
  } catch (e) {
    console.error('arena ladder failed:', e?.message);
    // Fail soft: an empty ladder renders as "fresh week" instead of an
    // error. Covers local setups where the migration hasn't run yet.
    const wk = core.arenaWeekKey();
    return res.json({ week: wk, currentWeek: wk, weeks: [wk], poolGs: core.ARENA_WEEKLY_POOL_GS, players: 0, top: [], me: null });
  }
});
},

];
