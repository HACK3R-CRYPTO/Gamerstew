// ─── Partner Game SDK ────────────────────────────────────────────────────────
// Lets approved third-party games (e.g. BlockSlide) plug INTO GameArena without
// rebuilding anything: they keep their own game, contract and on-chain rewards,
// and use this HTTP surface to
//   1. push their players' scores onto GameArena leaderboards  (POST /score)
//   2. check GoodDollar proof-of-humanity for a wallet          (GET  /verified)
//   3. read their own leaderboard back                          (GET  /leaderboard)
//
// GameArena is the distribution + identity layer here; the partner stays the
// source of truth for their game and keeps their own settlement.
//
// Every score always writes to the `scores`/`activity` tables the GameArena
// leaderboards read (off-chain, instant). If a partner is given a gameType in
// config, each score ALSO writes on-chain via GameArena's gasless GamePass path
// — so the partner's plays count as Celo transactions on GameArena's side too.
// That makes it two-way: their players show up on GameArena boards AND lift
// GameArena's on-chain activity. Gas for that write is sponsored by GameArena.
//
// Auth is a per-partner API key (never in code). Configure via env:
//   PARTNER_GAMES=blockslide:BlockSlide:4,foo:Foo Game   (":4" = on-chain gameType)
//   PARTNER_KEY_BLOCKSLIDE=<long-random-secret>
// Omit the gameType (blockslide:BlockSlide) to keep a partner off-chain only.
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

// Config format: PARTNER_GAMES=slug:Label[:gameType], comma-separated.
//   blockslide:BlockSlide      → off-chain only (scores hit the leaderboard)
//   blockslide:BlockSlide:4    → ALSO writes on-chain (GamePass gameType 4), so
//                                each play counts as a Celo tx on GameArena.
// gameType is a free uint8 on GamePass — no contract change to add one. Keep it
// distinct from the native games (0 rhythm, 1 simon, 2 stack, 3 challenge-ai).
function loadPartners() {
  const out = {};
  (process.env.PARTNER_GAMES || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .forEach((pair) => {
      const parts = pair.split(':').map((s) => s.trim());
      const slug = parts[0];
      const key = process.env[`PARTNER_KEY_${(slug || '').toUpperCase()}`];
      if (!slug || !key) return;
      const last = parts[parts.length - 1];
      let gameType = null, label = slug;
      if (parts.length >= 2 && /^\d+$/.test(last)) {
        gameType = Number(last);
        label = parts.slice(1, -1).join(':') || slug;
      } else if (parts.length >= 2) {
        label = parts.slice(1).join(':') || slug;
      }
      out[slug] = { label, key, gameType };
    });
  return out;
}

module.exports = function mountPartnerRoutes(app, deps) {
  const { supabase, saveScore, ethers, enqueueScoreWrite, hasGamePass, resolveUsername } = deps;
  const APP_URL = (process.env.GAMEARENA_APP_URL || 'https://gamearenahq.xyz').replace(/\/$/, '');
  const PARTNERS = loadPartners();
  const provider = new ethers.JsonRpcProvider(process.env.CELO_RPC || 'https://forno.celo.org');
  const idContract = new ethers.Contract(GD_IDENTITY, ID_ABI, provider);

  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

  // Partner-side display name (their domain, their naming). Sanitised + capped.
  function cleanName(n) {
    if (typeof n !== 'string') return null;
    const t = Array.from(n).filter((ch) => { const c = ch.charCodeAt(0); return c > 31 && c !== 127; }).join("").trim().slice(0, 32);
    return t || null;
  }
  // Best-effort: store the partner's name for a wallet. Degrades to a no-op if
  // the partner_players table hasn't been created yet — never fails a score.
  async function setPartnerName(game, wallet, name) {
    if (!name) return;
    try {
      await supabase.from('partner_players').upsert(
        { game, wallet_address: wallet, name, updated_at: new Date().toISOString() },
        { onConflict: 'game,wallet_address' },
      );
    } catch (_) { /* table may not exist yet — ignore */ }
  }
  // Look up partner names for a batch of wallets → { wallet: name }.
  async function getPartnerNames(game, wallets) {
    if (!wallets.length) return {};
    try {
      const { data } = await supabase
        .from('partner_players')
        .select('wallet_address, name')
        .eq('game', game)
        .in('wallet_address', wallets);
      return Object.fromEntries((data || []).map((r) => [r.wallet_address, r.name]));
    } catch (_) { return {}; }
  }

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
    const { wallet, score, txHash, name } = req.body || {};
    if (!wallet || !ADDR.test(wallet)) return res.status(400).json({ error: 'invalid wallet' });
    const s = Number(score);
    if (!Number.isFinite(s) || s < 0 || s > MAX_SCORE) return res.status(400).json({ error: 'invalid score' });
    const scoreInt = Math.floor(s);
    const partner = PARTNERS[req.game];
    const displayName = cleanName(name);
    let onchainHash = (typeof txHash === 'string' && txHash) ? txHash : null;
    try {
      // On-chain mirror (opt-in per partner via gameType in PARTNER_GAMES).
      // Records the score on GamePass through the SAME gasless path GameArena
      // uses for its own games, so the partner's play counts as a Celo tx on
      // GameArena's side. Gas is sponsored by the backend signer. Degrades
      // gracefully — if the write reverts (e.g. player has no GamePass yet) the
      // off-chain leaderboard record below still happens.
      if (partner && partner.gameType != null && typeof enqueueScoreWrite === 'function') {
        try {
          const tx = await enqueueScoreWrite(wallet.toLowerCase(), partner.gameType, scoreInt);
          if (tx && tx.hash) onchainHash = tx.hash;
        } catch (e) {
          console.warn(`🔌 partner on-chain write skipped (${req.game}):`, e.message);
        }
      }
      await saveScore({
        wallet_address: wallet.toLowerCase(),
        game: req.game,
        score: scoreInt,
        tx_hash: onchainHash,
      });
      // Remember the partner-side name for this wallet so they show up named on
      // GameArena boards even if they never minted a GamePass. Best-effort.
      if (displayName) setPartnerName(req.game, wallet.toLowerCase(), displayName);
      return res.json({ success: true, game: req.game, onchain: !!onchainHash, txHash: onchainHash });
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

  // GET /api/partner/profile/:wallet  → the "sign in with GamePass" lookup.
  // BlockSlide connects the player's wallet on their side (the player already
  // controls it), then calls this to resolve the GameArena identity for it:
  //   { wallet, hasPass, username, verified, joinUrl }
  // hasPass=true  → greet them as their GamePass username, no separate signup.
  // hasPass=false → send them to joinUrl to mint a GamePass (new GameArena user).
  router.get('/profile/:wallet', limiter, requirePartner, async (req, res) => {
    const w = req.params.wallet;
    if (!ADDR.test(w)) return res.status(400).json({ error: 'invalid wallet' });
    const lower = w.toLowerCase();
    try {
      const [hasPass, username, verified] = await Promise.all([
        typeof hasGamePass === 'function' ? hasGamePass(lower) : null,
        typeof resolveUsername === 'function' ? resolveUsername(lower).catch(() => null) : null,
        idContract.isWhitelisted(lower).catch(() => null),
      ]);
      return res.json({
        wallet: lower,
        hasPass: !!hasPass,
        username: username || null,
        verified: !!verified,
        joinUrl: APP_URL,
      });
    } catch (e) {
      console.error(`🔌 partner profile failed (${req.game}):`, e.message);
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
    const wallets = (data || []).map((r) => r.wallet_address);
    // Name each row: partner-side name first (their domain), else GamePass name
    // (GameArena players), else null (front-end shows the wallet).
    const partnerNames = await getPartnerNames(req.game, wallets);
    const rows = await Promise.all((data || []).map(async (r, i) => {
      let username = partnerNames[r.wallet_address] || null;
      if (!username && typeof resolveUsername === 'function') {
        username = await resolveUsername(r.wallet_address).catch(() => null);
      }
      return { rank: i + 1, wallet: r.wallet_address, username: username || null, score: r.score };
    }));
    return res.json({ game: req.game, rows });
  });

  app.use('/api/partner', router);
  const names = Object.keys(PARTNERS);
  console.log(`🔌 Partner SDK mounted at /api/partner · ${names.length ? names.join(', ') : 'no partners configured'}`);
};
