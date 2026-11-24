// ─── vatar ────────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── Vatar (Lagos Life) in-game purchases ──
function* (core) {
  Object.defineProperties(core, {
    VATAR_SECRET: { get: () => VATAR_SECRET, enumerable: true, configurable: true },
    vatarApi: { get: () => vatarApi, enumerable: true, configurable: true },
    deliverVatarPurchase: { get: () => deliverVatarPurchase, enumerable: true, configurable: true },
    vatarSignatureOk: { get: () => vatarSignatureOk, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Vatar (Lagos Life) in-game purchases ────────────────────────────────────
// Players pay inside the embedding "world"; our server confirms each purchase
// with Vatar and delivers the item EXACTLY once. The secret never leaves the
// server (env only, never the game bundle). Docs: lagoslife.app/developers/docs
const VATAR_API = process.env.VATAR_API || 'https://lagoslife.app/api/games/v1';
const VATAR_SECRET = process.env.VATAR_SECRET || '';
const VATAR_WEBHOOK_SECRET = process.env.VATAR_WEBHOOK_SECRET || '';

// Call the Vatar games API with our bearer secret. Returns { http, ...json }.
async function vatarApi(path, body) {
  const r = await fetch(VATAR_API + path, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${VATAR_SECRET}`, 'Content-Type': 'application/json' },
  });
  let json = {};
  try { json = await r.json(); } catch {}
  return { http: r.status, ...json };
}

// Verify X-Vatar-Signature: "sha256=" + hex HMAC-SHA256 of the RAW body, keyed
// with the webhook signing secret. Constant-time compare; false if unconfigured.
function vatarSignatureOk(rawBody, header) {
  if (!VATAR_WEBHOOK_SECRET || !rawBody || !rawBody.length) return false;
  const want = Buffer.from('sha256=' + core.crypto.createHmac('sha256', VATAR_WEBHOOK_SECRET).update(rawBody).digest('hex'));
  const got = Buffer.from(String(header ?? ''));
  return want.length === got.length && core.crypto.timingSafeEqual(want, got);
}

// Deliver a Vatar purchase EXACTLY once. The vatar_deliveries.purchase_id primary
// key makes replays (client /claim AND the server webhook both firing) a no-op.
// Returns { granted:false, already:true } on a replay. THIS is the single place
// to map a Vatar productId to a real GameArena item — see the TODO below.
async function deliverVatarPurchase({ purchaseId, playerId, productId, wallet }) {
  const { error } = await core.supabase.from('vatar_deliveries').insert({
    purchase_id: purchaseId,
    player_id: String(playerId),
    product_id: String(productId),
    wallet: wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : null,
  });
  if (error) {
    if (error.code === '23505') return { granted: false, already: true }; // unique = already delivered
    throw error;
  }
  // TODO(product mapping): grant the actual item for `productId` here. e.g.
  //   if (productId === 'double_taps') { /* credit perk_inventory / arena_daily */ }
  // This needs the Vatar player ↔ GameArena wallet link decided first; until then
  // the purchase is VERIFIED and RECORDED (nothing lost, never double-granted).
  return { granted: true };
}
},

// ── Vatar purchases ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── Vatar purchases ─────────────────────────────────────────────────────────
// POST /api/vatar/claim — the game (browser) calls this after Vatar.purchase()
// resolves, or from Vatar.onPurchase(), with the player's short-lived session
// and the purchaseId (optional linked wallet). We confirm BOTH with Vatar — the
// session proves who is asking, the purchase proves it is real and theirs — then
// deliver once and tell Vatar it is delivered. Never trust the client alone.
// Browser origin is gated by the global CORS allowlist above.
core.app.post('/api/vatar/claim', core.standardLimiter, async (req, res) => {
  const { session, purchaseId, wallet } = req.body || {};
  if (!session || !purchaseId) return res.status(400).json({ error: 'session_and_purchaseId_required' });
  if (!core.VATAR_SECRET) return res.status(503).json({ error: 'vatar_not_configured' });
  try {
    const me = await core.vatarApi('/session/verify', { session });
    const p = await core.vatarApi(`/purchases/${encodeURIComponent(purchaseId)}`);
    if (me.http !== 200 || p.http !== 200 || !p.playerId || p.playerId !== me.playerId) {
      return res.status(403).json({ error: 'not_your_purchase' });
    }
    if (p.status === 'refunded') return res.status(409).json({ error: 'refunded' });
    const result = await core.deliverVatarPurchase({ purchaseId: p.id, playerId: p.playerId, productId: p.productId, wallet });
    await core.vatarApi(`/purchases/${encodeURIComponent(p.id)}/deliver`, {}); // idempotent on Vatar's side
    return res.json({ ok: true, productId: p.productId, granted: result.granted });
  } catch (e) {
    console.error('vatar/claim error:', e?.message || e);
    return res.status(500).json({ error: 'claim_failed' });
  }
});

// ─── Brought over from main: Vatar players on-chain ──────────────────────────
// (written against the old single server.js; names it shares are read off `core`)
// ─── Vatar on-chain provisioning (custodial wallets) ─────────────────────────
// Brings Vatar (Lagos Life) players onto Celo. Each Vatar playerId maps to a
// DETERMINISTIC custodial Celo wallet derived from VATAR_CUSTODY_SEED — the key
// is never stored, only re-derived. On first embed load we drip gas and mint a
// GamePass, so the Vatar player becomes a real on-chain GameArena player; their
// scores and purchases settle on-chain in later phases.
//
// VATAR_CUSTODY_SEED is the MASTER key for every custodial wallet: env only,
// never code/commits. Lose it = the wallets can't be re-derived; leak it = every
// custodial key is derivable; change it = everyone already provisioned is
// orphaned. Set once, back up, keep secret.
const VATAR_CUSTODY_SEED = process.env.VATAR_CUSTODY_SEED || '';
const VATAR_GAS_DRIP_CELO = process.env.VATAR_GAS_DRIP_CELO || '0.1'; // a mint costs ~0.06
// Minimal GamePass ABI for the custodial mint — the main core.passContract ABI is
// bound to the core.validator and exposes no mint().
const GAME_PASS_MINT_ABI = [
  'function mint(string username) external',
  'function hasMinted(address player) external view returns (bool)',
  'function isUsernameAvailable(string username) external view returns (bool)',
];

// Deterministic custodial wallet for a Vatar playerId. keccak256(seed:playerId)
// is the private key, so the same player always resolves to the same wallet and
// no keys are ever stored. null when unconfigured.
function deriveVatarWallet(playerId) {
  if (!VATAR_CUSTODY_SEED || !core.provider) return null;
  try {
    const pk = core.ethers.keccak256(core.ethers.toUtf8Bytes(`${VATAR_CUSTODY_SEED}:${playerId}`));
    return new core.ethers.Wallet(pk, core.provider);
  } catch { return null; }
}

// Player-facing username for the minted pass · "ll_" (Lagos Life) + 8 hex of the
// playerId: deterministic, collision-resistant, matches the contract's
// [a-z0-9_]{3,16} rule.
function vatarUsername(playerId) {
  const h = core.ethers.keccak256(core.ethers.toUtf8Bytes(`username:${playerId}`)).slice(2, 10);
  return `ll_${h}`;
}

// In-flight guard · "on embed load" fires ensureVatarOnchain for every page
// load, and the first few can race before the DB row lands. One provision per
// playerId at a time; the on-chain hasMinted check + mint's own revert make any
// surviving race harmless.
const _vatarProvisioning = new Set();

// Ensure a Vatar player has a custodial wallet + a minted GamePass. Idempotent:
// returns early when already minted (DB row or on-chain). Drips gas then mints
// from the custodial wallet. Returns { address, minted, txHash?, already? } or
// { address?, error }.
async function ensureVatarOnchain(playerId) {
  const wallet = deriveVatarWallet(playerId);
  if (!wallet) return { error: 'custody_not_configured' };
  const address = wallet.address;

  const { data: existing } = await core.supabase
    .from('vatar_wallets').select('address, minted').eq('player_id', String(playerId)).maybeSingle();
  if (existing?.minted) return { address: existing.address, minted: true, already: true };

  if (_vatarProvisioning.has(playerId)) return { address, minted: false, pending: true };
  _vatarProvisioning.add(playerId);
  try {
    const pass = new core.ethers.Contract(core.GAME_PASS_ADDR, GAME_PASS_MINT_ABI, wallet);

    // Record the mapping up front so we always know the address, even if the
    // mint below fails and we retry on the next load.
    await core.supabase.from('vatar_wallets')
      .upsert({ player_id: String(playerId), address }, { onConflict: 'player_id' });

    // Minted on-chain already (e.g. provisioned before the row was written)?
    if (await pass.hasMinted(address)) {
      await core.supabase.from('vatar_wallets').update({ minted: true }).eq('player_id', String(playerId));
      return { address, minted: true, already: true };
    }

    // Drip gas so the custodial wallet can pay for its own mint.
    const faucetSigner = core.faucetWallet || core.validator;
    if (!faucetSigner) return { address, minted: false, error: 'no_faucet' };
    const dripWei = core.ethers.parseEther(VATAR_GAS_DRIP_CELO);
    if ((await core.provider.getBalance(address)) < dripWei) {
      const faucetBal = await core.provider.getBalance(faucetSigner.address);
      if (faucetBal < dripWei + core.ethers.parseEther('0.02')) {
        console.warn(`⛽ VATAR GAS LOW · refusing drip to ${address} · TOP UP ${faucetSigner.address}`);
        return { address, minted: false, error: 'faucet_empty' };
      }
      const drip = await faucetSigner.sendTransaction({ to: address, value: dripWei });
      await drip.wait();
    }

    // Pick an available username (append two hex of the address on the rare clash).
    let username = vatarUsername(playerId);
    try { if (!(await pass.isUsernameAvailable(username))) username = `${username}${address.slice(2, 4).toLowerCase()}`; } catch {}

    const tx = await pass.mint(username);
    await tx.wait();
    await core.supabase.from('vatar_wallets')
      .update({ minted: true, username }).eq('player_id', String(playerId));
    console.log(`🎮 Vatar player on Celo · ${address} minted "${username}" (tx ${tx.hash.slice(0, 10)}…)`);
    return { address, minted: true, txHash: tx.hash };
  } catch (e) {
    console.error(`Vatar on-chain provision failed for ${playerId}:`, e?.message || e);
    return { address, minted: false, error: 'provision_failed' };
  } finally {
    _vatarProvisioning.delete(playerId);
  }
}


// POST /api/vatar/onchain/ensure — provision a Vatar player onto Celo (custodial
// wallet + GamePass mint). The embed calls this on load via the Next server
// action. core.requireSecret because it SPENDS GAS (drip + mint), so only our own
// server (holding INTERNAL_SECRET) can trigger it; the Vatar session is then
// verified server-side so we never trust a client-supplied playerId. Idempotent.
core.app.post('/api/vatar/onchain/ensure', core.standardLimiter, core.requireSecret, async (req, res) => {
  const { session } = req.body || {};
  if (!session) return res.status(400).json({ error: 'session_required' });
  if (!VATAR_SECRET) return res.status(503).json({ error: 'vatar_not_configured' });
  try {
    const me = await vatarApi('/session/verify', { session });
    if (me.http !== 200 || !me.playerId) return res.status(401).json({ error: 'bad_session' });
    const r = await ensureVatarOnchain(me.playerId);
    return res.json(r);
  } catch (e) {
    console.error('vatar/onchain/ensure error:', e?.message || e);
    return res.status(500).json({ error: 'ensure_failed' });
  }
});

// ─── Vatar on-chain scores (Phase 2) ─────────────────────────────────────────
// A Vatar embed player has no browser wallet, but IS a provisioned custodial
// GamePass holder (see ensureVatarOnchain). These two endpoints let their
// skill-game runs land on the GameArena on-chain leaderboard, with the SAME
// session-ticket + replay anti-cheat as signed-in players. Identity always
// comes from the VERIFIED Vatar session, never a client-supplied wallet, so a
// player can only ever write scores for THEIR OWN custodial wallet. The write
// is always gasless (the custodial key is server-side; the player never signs).

// POST /api/vatar/start-game — issue a session ticket bound to the player's
// custodial wallet. Mirrors /api/start-game.
core.app.post('/api/vatar/start-game', core.requireSecret, core.gaslessLimiter, async (req, res) => {
  const { session, game } = req.body || {};
  if (!session || !game) return res.status(400).json({ error: 'Missing session or game' });
  if (!core.VALID_GAMES.includes(game)) return res.status(400).json({ error: 'Unknown game' });
  if (!VATAR_SECRET) return res.status(503).json({ error: 'vatar_not_configured' });
  try {
    const me = await vatarApi('/session/verify', { session });
    if (me.http !== 200 || !me.playerId) return res.status(401).json({ error: 'bad_session' });
    const wallet = deriveVatarWallet(me.playerId);
    if (!wallet) return res.status(503).json({ error: 'custody_not_configured' });

    const token = require('crypto').randomBytes(32).toString('hex');
    const { error } = await core.supabase
      .from('game_sessions')
      .insert({ token, wallet: wallet.address.toLowerCase(), game });
    if (error) {
      console.error('vatar/start-game insert error:', error.message);
      return res.status(500).json({ error: 'Failed to start session' });
    }
    return res.json({ success: true, sessionToken: token });
  } catch (e) {
    console.error('vatar/start-game error:', e?.message || e);
    return res.status(500).json({ error: 'start_failed' });
  }
});

// POST /api/vatar/sign-score — validate a Vatar run and record it on-chain
// (gasless). Same validation as /api/sign-score: the session ticket blocks
// direct PoC submits, rhythm is server-replayed, simon/stack trust the client
// score within bounds. No legacy voucher path (the player can't sign) and no
// Season-1 points hook (Vatar players aren't enrolled).
core.app.post('/api/vatar/sign-score', core.requireSecret, core.gaslessLimiter, async (req, res) => {
  if (!core.passScoreWriter || !core.GASLESS_SKILL_GAMES) {
    return res.status(503).json({ error: 'gasless_not_configured' });
  }
  const { session, game, score, sessionToken, tapLog, songId } = req.body || {};
  if (!session || !game) return res.status(400).json({ error: 'Missing session or game' });
  if (!core.VALID_GAMES.includes(game)) return res.status(400).json({ error: 'Unknown game' });
  if (!sessionToken) return res.status(400).json({ error: 'Missing sessionToken' });
  if (!VATAR_SECRET) return res.status(503).json({ error: 'vatar_not_configured' });

  try {
    // ── Identity from the verified Vatar session ──
    const me = await vatarApi('/session/verify', { session });
    if (me.http !== 200 || !me.playerId) return res.status(401).json({ error: 'bad_session' });
    const wallet = deriveVatarWallet(me.playerId);
    if (!wallet) return res.status(503).json({ error: 'custody_not_configured' });
    const playerAddress = wallet.address;

    // ── Ensure the GamePass exists (recordScore reverts without it). Idempotent
    //    and fast once minted; init already fires this on embed load. ──
    const prov = await ensureVatarOnchain(me.playerId).catch(() => null);
    if (!prov || !prov.minted) return res.status(503).json({ error: 'not_provisioned' });

    // ── Session-ticket validation (mirrors /api/sign-score) ──
    const { data: gs, error: sErr } = await core.supabase
      .from('game_sessions').select('*').eq('token', sessionToken).single();
    if (sErr || !gs) return res.status(403).json({ error: 'Invalid session token' });
    if (gs.used) return res.status(403).json({ error: 'Session already used' });
    if (gs.wallet.toLowerCase() !== playerAddress.toLowerCase())
      return res.status(403).json({ error: 'Session wallet mismatch' });
    if (gs.game !== game) return res.status(403).json({ error: 'Session game mismatch' });
    const elapsed = Date.now() - new Date(gs.started_at).getTime();
    if (elapsed > 11 * 60 * 1000) return res.status(403).json({ error: 'Session expired' });
    if (elapsed < 5_000) return res.status(403).json({ error: 'Session too short' });

    // ── Score determination (rhythm replayed; simon/stack bounded client score) ──
    let serverScore;
    if (game === 'rhythm') {
      if (!Array.isArray(tapLog)) return res.status(400).json({ error: 'Missing tapLog (required for rhythm)' });
      const physics = core.rhythmPhysicsCheck(tapLog, elapsed);
      if (!physics.ok) return res.status(403).json({ error: 'Physics check failed', reason: physics.reason });
      const replay = core.rhythmComputeScore(tapLog, elapsed, typeof songId === 'string' && core.rhythmIsKnownSong(songId) ? songId : null);
      const jitter = core.rhythmJitterCheck(replay.hits);
      if (!jitter.ok) return res.status(403).json({ error: 'Jitter check failed', reason: jitter.reason });
      serverScore = replay.score;
    } else {
      if (typeof score !== 'number' || !Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > 1_000_000)
        return res.status(400).json({ error: 'Score out of range (max 1000000)' });
      serverScore = score;
    }

    // Burn the ticket (best-effort; the score is already validated/computed).
    await core.supabase.from('game_sessions')
      .update({ used: true, used_at: new Date().toISOString(), computed_score: serverScore })
      .eq('token', sessionToken);

    // ── Gasless on-chain write · serialized with every other signer write ──
    const budget = core.gaslessBudgetCheck(playerAddress);
    if (!budget.ok) {
      console.warn(`⛔ Vatar gasless budget hit (${budget.reason}) · ${playerAddress.slice(0, 10)}…`);
      return res.status(429).json({ error: 'rate_limited' });
    }
    const gameType = core.GAME_TYPE[game];
    const tx = await core.enqueueScoreWrite(playerAddress, gameType, serverScore);
    core.gaslessBudgetConsume(playerAddress);
    core._rememberGaslessTx(tx.hash);
    console.log(`⛽ Vatar ${game} · ${playerAddress.slice(0, 10)}… score ${serverScore} · ${tx.hash}`);
    return res.json({ success: true, gasless: true, txHash: tx.hash, gameType, score: serverScore });
  } catch (e) {
    console.error('vatar/sign-score error:', e?.message || e);
    return res.status(500).json({ error: 'sign_failed' });
  }
});


// POST /api/vatar/webhook — Lagos Life POSTs purchase events here (server-to-
// server). Verify the HMAC over the raw body, then RE-verify the purchase with
// Vatar before granting (the event is only a nudge). Always 200 a well-formed
// signed event so Vatar stops retrying; delivery is idempotent either way.
core.app.post('/api/vatar/webhook', async (req, res) => {
  if (!core.vatarSignatureOk(req.rawBody, req.headers['x-vatar-signature'])) return res.status(401).end();
  let evt = {};
  try { evt = JSON.parse(req.rawBody.toString('utf8')); } catch { return res.status(400).end(); }
  try {
    const purchaseId = evt?.data?.purchaseId;
    if (purchaseId) {
      const p = await core.vatarApi(`/purchases/${encodeURIComponent(purchaseId)}`);
      if (p.http === 200 && p.id && p.status !== 'refunded') {
        await core.deliverVatarPurchase({ purchaseId: p.id, playerId: p.playerId, productId: p.productId, wallet: null });
        await core.vatarApi(`/purchases/${encodeURIComponent(p.id)}/deliver`, {});
      }
    }
  } catch (e) {
    console.error('vatar/webhook error:', e?.message || e); // recorded idempotently; no retry needed
  }
  return res.status(200).end();
});

// GET /api/cosmetics/equip?wallet=0x… — a player's explicit equip choices.
// Returns only rows they've set; the client treats any owned cosmetic NOT in
// this map as equipped (default ON). Keyed by wallet so the choice follows
// the account across browsers/devices.
core.app.get('/api/cosmetics/equip', core.requireSecret, async (req, res) => {
  const w = (req.query.wallet || '').toString().toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(w)) return res.status(400).json({ error: 'wallet required' });
  try {
    const { data } = await core.supabase.from('cosmetic_equip').select('perk_id, equipped').eq('wallet', w);
    const equipped = {};
    for (const r of data || []) equipped[r.perk_id] = r.equipped;
    return res.json({ equipped });
  } catch {
    return res.json({ equipped: {} });
  }
});

// POST /api/cosmetics/equip — set one cosmetic's equipped flag for a wallet.
// Body: { wallet, perkId, equipped }. Pure display preference — no on-chain
// effect, so no purchase proof required (just the internal secret).
core.app.post('/api/cosmetics/equip', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { wallet, perkId, equipped } = req.body || {};
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
  const pid = Number(perkId);
  if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ error: 'perkId required' });
  const w = wallet.toLowerCase();
  const { error } = await core.supabase.from('cosmetic_equip').upsert({
    wallet: w, perk_id: pid, equipped: !!equipped, updated_at: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: 'save_failed' });
  return res.json({ ok: true, perkId: pid, equipped: !!equipped });
});
},

];
