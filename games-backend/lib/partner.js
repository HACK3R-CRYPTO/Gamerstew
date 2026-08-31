// ─── Partner Game SDK ────────────────────────────────────────────────────────
// Lets approved third-party games (e.g. BlockSlide) plug INTO GameArena without
// rebuilding anything: they keep their own game, contract and on-chain rewards,
// and use this HTTP surface to
//   1. push their players' scores onto GameArena leaderboards  (POST /score)
//   2. check GoodDollar proof-of-humanity for a wallet          (GET  /verified)
//   3. read their own leaderboard back                          (GET  /leaderboard)
//
// GameArena is the distribution + identity layer here; the partner stays the
// source of truth for their game. This is OFF-CHAIN only — it writes to the same
// `scores`/`activity` tables the GameArena leaderboards read, so no GamePass
// on-chain write is forced on the partner (they keep their own settlement).
//
// Auth is a per-partner API key (never in code). Configure via env:
//   PARTNER_GAMES=blockslide:BlockSlide,foo:Foo Game
//   PARTNER_KEY_BLOCKSLIDE=<long-random-secret>
// With no partners configured the routes mount but reject every call (403), so
// this is inert until you deliberately onboard a partner.
//
// Mounted from server.js:  require('./lib/partner')(app, { supabase, saveScore, ethers });

const express = require('express');
const rateLimit = require('express-rate-limit');

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const MAX_SCORE = 1e12;                // sanity ceiling so a bad partner can't poison the board
const GD_IDENTITY = '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42'; // GoodDollar Identity (isWhitelisted)
const ID_ABI = ['function isWhitelisted(address) view returns (bool)'];

function loadPartners() {
  const out = {};
  (process.env.PARTNER_GAMES || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .forEach((pair) => {
      const [slug, ...rest] = pair.split(':');
      const key = process.env[`PARTNER_KEY_${(slug || '').toUpperCase()}`];
      if (slug && key) out[slug] = { label: rest.join(':') || slug, key };
    });
  return out;
}

module.exports = function mountPartnerRoutes(app, deps) {
  const { supabase, saveScore, ethers } = deps;
  const PARTNERS = loadPartners();
  const provider = new ethers.JsonRpcProvider(process.env.CELO_RPC || 'https://forno.celo.org');
  const idContract = new ethers.Contract(GD_IDENTITY, ID_ABI, provider);

  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

  // Per-partner API key auth. Sets req.game / req.gameLabel on success.
  function requirePartner(req, res, next) {
    const key = req.headers['x-partner-key'];
    if (!key) return res.status(401).json({ error: 'missing partner key' });
    const hit = Object.entries(PARTNERS).find(([, v]) => v.key === key);
    if (!hit) return res.status(403).json({ error: 'invalid partner key' });
    req.game = hit[0];
    req.gameLabel = hit[1].label;
    next();
  }

  // POST /api/partner/score  { wallet, score, txHash? }  → records onto GameArena boards
  router.post('/score', limiter, requirePartner, async (req, res) => {
    const { wallet, score, txHash } = req.body || {};
    if (!wallet || !ADDR.test(wallet)) return res.status(400).json({ error: 'invalid wallet' });
    const s = Number(score);
    if (!Number.isFinite(s) || s < 0 || s > MAX_SCORE) return res.status(400).json({ error: 'invalid score' });
    try {
      await saveScore({
        wallet_address: wallet.toLowerCase(),
        game: req.game,
        score: Math.floor(s),
        tx_hash: (typeof txHash === 'string' && txHash) ? txHash : null,
      });
      return res.json({ success: true, game: req.game });
    } catch (e) {
      console.error(`🔌 partner score failed (${req.game}):`, e.message);
      return res.status(500).json({ error: 'record failed' });
    }
  });

  // GET /api/partner/verified/:wallet  → { verified }  (GoodDollar proof-of-humanity)
  router.get('/verified/:wallet', limiter, requirePartner, async (req, res) => {
    const w = req.params.wallet;
    if (!ADDR.test(w)) return res.status(400).json({ error: 'invalid wallet' });
    try {
      const verified = await idContract.isWhitelisted(w);
      return res.json({ wallet: w.toLowerCase(), verified });
    } catch (e) {
      console.error(`🔌 partner verify failed (${req.game}):`, e.message);
      return res.status(502).json({ error: 'chain read failed' });
    }
  });

  // GET /api/partner/leaderboard?limit=20  → the partner's own board (best score per wallet)
  router.get('/leaderboard', limiter, requirePartner, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const { data, error } = await supabase
      .from('scores')
      .select('wallet_address, score')
      .eq('game', req.game)
      .order('score', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: 'read failed' });
    return res.json({
      game: req.game,
      rows: (data || []).map((r, i) => ({ rank: i + 1, wallet: r.wallet_address, score: r.score })),
    });
  });

  app.use('/api/partner', router);
  const names = Object.keys(PARTNERS);
  console.log(`🔌 Partner SDK mounted at /api/partner · ${names.length ? names.join(', ') : 'no partners configured'}`);
};
