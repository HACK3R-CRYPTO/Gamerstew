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
