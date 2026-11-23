// ─── gate ─────────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── CORS — only allowed origins or trusted server-to-server calls ──
function* (core) {
  Object.defineProperties(core, {
    requireSecret: { get: () => requireSecret, enumerable: true, configurable: true },
    gameSubmitLimiter: { get: () => gameSubmitLimiter, enumerable: true, configurable: true },
    gaslessLimiter: { get: () => gaslessLimiter, enumerable: true, configurable: true },
    gaslessBudgetCheck: { get: () => gaslessBudgetCheck, enumerable: true, configurable: true },
    gaslessBudgetConsume: { get: () => gaslessBudgetConsume, enumerable: true, configurable: true },
    INTERNAL_SECRET: { get: () => INTERNAL_SECRET, enumerable: true, configurable: true },
    standardLimiter: { get: () => standardLimiter, enumerable: true, configurable: true },
    requireAgentKey: { get: () => requireAgentKey, enumerable: true, configurable: true },
    AGENT_PLAY_KEY: { get: () => AGENT_PLAY_KEY, enumerable: true, configurable: true },
    strictLimiter: { get: () => strictLimiter, enumerable: true, configurable: true },
    requireSecretOrPartner: { get: () => requireSecretOrPartner, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── CORS — only allowed origins or trusted server-to-server calls ───────────
const allowedOrigins = core.config.allowedOrigins;
// Keep the exact raw bytes of each JSON body on req.rawBody so the Vatar webhook
// can verify its HMAC signature over them (JSON.parse + re-stringify would not
// byte-match what Vatar signed). Negligible cost for every other route.
core.app.use(core.express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
// A body or query field named like a wallet must be a wallet, before any route sees it.
core.app.use(core.platform.guardWalletFields());

// ─── Rate Limiting ──────────────────────────────────────────────────────────
// Three buckets, each keyed appropriately:
//   • standardLimiter — generic per-IP cap, used for low-cost reads.
//   • strictLimiter   — per-IP cap for endpoints with real cost (faucet),
//                       low ceiling because each call costs us money.
//   • gameSubmitLimiter — per-wallet cap on score submissions. Higher
//                         ceiling than strictLimiter so a hot-streak
//                         player rolling Rhythm rounds back-to-back never
//                         hits it; keyed by wallet so two legit players
//                         on the same network/WiFi don't share a bucket.
//
// 60 submissions per minute is one finished game every second. Real
// rhythm rounds are 45s minimum, so the only way to exceed this is
// scripted abuse — which the score-vs-elapsed-time bound catches anyway.

// Pull the wallet out of the request body for keying. Falls back to the
// IP if the body shape is unexpected, so we never drop the limit entirely.
// Per-wallet bucket when a wallet is present, else IPv6-safe fallback.
// express-rate-limit's stricter validator (v8+) rejects raw req.ip
// because IPv6 addresses share a /64 prefix per provider, letting one
// attacker mint unlimited keys. ipKeyGenerator normalises to the /64.
const walletKey = (req) => {
  const w = (req.body?.playerAddress || req.body?.wallet || '').toString().toLowerCase();
  if (w && /^0x[0-9a-f]{40}$/.test(w)) return `wallet:${w}`;
  return `ip:${core.ipKeyGenerator(req.ip)}`;
};

const standardLimiter = core.rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests, please try again later.' }
});

const strictLimiter = core.rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: { error: 'Rate limit exceeded. Please wait a few minutes.' }
});

// Tight per-wallet cap for the two endpoints on the GASLESS path. A human
// cannot finish 12 skill games in a minute; a script trivially can, and every
// one of those costs US gas (the backend signer submits recordScore itself).
// Deliberately much tighter than gameSubmitLimiter, which guards an endpoint
// that runs AFTER the on-chain write and so can't prevent the spend.
const gaslessLimiter = core.rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  keyGenerator: walletKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many game sessions too quickly. Wait a moment and try again.' }
});

// NOTE — there is deliberately no per-IP limiter on the gasless endpoints.
// They sit behind requireSecret and are only ever called by the Next.js server
// action, so req.ip is Vercel's egress address for EVERY player. Keying on it
// gives no per-attacker separation whatsoever and instead caps the whole
// product at one shared bucket — a 60/min ceiling there is an outage waiting
// for a traffic spike, which during a prize event is precisely when it fires.
// The real controls are the per-wallet limiter below, the daily gasless budget,
// and (above all) gating rewards on self-verification.

// ── Gasless write budget ────────────────────────────────────────────────────
// Rate limits bound the RATE; this bounds the TOTAL. Because the backend signer
// pays for every gasless recordScore, an attacker rotating wallets and IPs can
// otherwise drain the signer's CELO outright. These two ceilings make the
// worst-case spend a known, bounded number rather than "however much is in the
// wallet". Both reset at UTC midnight.
// Implementation + regression tests live in lib/gaslessBudget.js.
const { createGaslessBudget } = require('../lib/gaslessBudget');
const _gaslessBudget = createGaslessBudget({
  perWalletPerDay: Number(process.env.GASLESS_MAX_PER_WALLET_DAY || 60),
  globalPerDay:    Number(process.env.GASLESS_MAX_GLOBAL_DAY || 3000),
});
const gaslessBudgetCheck   = (w) => _gaslessBudget.check(w);
const gaslessBudgetConsume = (w) => _gaslessBudget.consume(w);

const gameSubmitLimiter = core.rateLimit({
  windowMs: 1 * 60 * 1000,           // 1 minute window
  max: 60,                            // 60 finished games per wallet per minute
  keyGenerator: walletKey,            // per-wallet bucket, not per-IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are submitting too fast. Take a breath and try again in a moment.' }
});

// ─── Internal secret — every request from Next.js must include this header ───
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
if (!INTERNAL_SECRET) {
  console.error('FATAL: INTERNAL_SECRET env var is not set. Refusing to start.');
  process.exit(1);
}
function requireSecret(req, res, next) {
  if (req.headers['x-internal-secret'] === INTERNAL_SECRET) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── Agent-play scoped key — GoodAgents' server plays MARKOV with this ────────
// A partner (GoodAgents) drives deployed agents through the arena. We hand them
// a scoped key that ONLY opens the /api/arena/agent/* routes — never the master
// INTERNAL_SECRET. If unset, the agent routes are simply closed (feature off).
const AGENT_PLAY_KEY = process.env.AGENT_PLAY_KEY || '';
function requireAgentKey(req, res, next) {
  if (AGENT_PLAY_KEY && req.headers['x-agent-key'] === AGENT_PLAY_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── Partner keys — same env as lib/partner.js (PARTNER_GAMES + PARTNER_KEY_*) ─
// Loaded here too so server-to-server routes a partner BFF calls directly (the
// faucet, below) can accept a valid x-partner-key without the master secret.
const PARTNER_KEYS = (() => {
  const set = new Set();
  (process.env.PARTNER_GAMES || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .forEach((pair) => {
      const slug = pair.split(':')[0];
      const key = process.env[`PARTNER_KEY_${(slug || '').toUpperCase()}`];
      if (key) set.add(key);
    });
  return set;
})();
function isPartnerKey(req) {
  const k = req.headers['x-partner-key'];
  return !!k && PARTNER_KEYS.has(k);
}
// Faucet auth: the master internal secret (frontend) OR a valid partner key
// (a partner BFF funding a player it just verified). Flags req.viaPartner so the
// route can apply the smaller partner drip.
function requireSecretOrPartner(req, res, next) {
  if (req.headers['x-internal-secret'] === INTERNAL_SECRET) return next();
  if (isPartnerKey(req)) { req.viaPartner = true; return next(); }
  return res.status(401).json({ error: 'Unauthorized' });
}

// For no-origin requests (Next.js server actions) require INTERNAL_SECRET.
// Browser requests must come from an allowed origin.
core.app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Public live-match SSE feed · any origin may subscribe (partner sites embed
  // it). The stream is read-only, non-sensitive match data, so it bypasses the
  // origin allowlist with permissive CORS instead of a 403.
  // The Rhythm Rush song list is public too: a fixed list of song ids, read by
  // the game on any deployment (including preview builds) before it offers them.
  if (req.path.startsWith('/api/arena/live/') || req.path === '/api/rhythm/songs') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  // Agent-play routes · server-to-server from GoodAgents (no browser origin).
  // Gated by the scoped agent key inside the route; let the no-origin request
  // through here so it can reach the handler instead of dying on the CORS gate.
  if (req.path.startsWith('/api/arena/agent/')) {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  // Partner API · server-to-server from partner BFFs (Square, etc.) holding the
  // scoped x-partner-key and sending NO browser Origin. Gated by the key inside
  // the partner router (requirePartner rejects missing/invalid keys), so let the
  // no-origin request through here instead of dying on the origin gate. An origin
  // check is meaningless for server-to-server traffic — there is no browser to
  // protect and the header is attacker-controlled; the key is the real auth.
  if (req.path.startsWith('/api/partner/')) {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  // Faucet · also called server-to-server by a partner BFF (holding x-partner-key)
  // to fund a just-verified player, in addition to the frontend's no-origin +
  // internal-secret call. The route (requireSecretOrPartner) is the real auth, so
  // let the request through the origin gate to reach it.
  if (req.path === '/api/faucet') {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  // Vatar webhook · server-to-server from Lagos Life, carrying NO browser Origin.
  // The X-Vatar-Signature HMAC checked inside the handler is the real auth, so
  // let the no-origin request through the gate instead of 403-ing it here.
  if (req.path === '/api/vatar/webhook') {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  // Public read-only stats · the /impact page (and partners) read these. They're
  // cached, non-sensitive aggregates — the same numbers shown publicly on-site —
  // so they bypass the origin/secret gate with permissive CORS. Without this the
  // frontend's server-side fetch (no browser origin) hit the secret branch below
  // and, when the prod secret wasn't wired, got a 403 → the page fell back to a
  // stale hardcoded verified count instead of the live on-chain figure.
  if (req.path === '/api/verified-stats') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  if (!origin) {
    if (req.headers['x-internal-secret'] === INTERNAL_SECRET) return next();
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-secret');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  return res.status(403).json({ error: 'Origin not allowed' });
});
},

];
