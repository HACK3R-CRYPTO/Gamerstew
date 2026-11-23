// ─── faucet ───────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── POST /api/faucet — gas drip for fresh wallets ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── POST /api/faucet — gas drip for fresh wallets ──────────────────────────
// Sends FAUCET_DRIP_CELO (default 0.1) once per wallet to fresh sign-ins so
// they don't hit the "insufficient gas" wall on GamePass mint or score
// submit. Susanne flagged this as the killer friction for MiniPay-style
// audiences · this endpoint kills it.
//
// Sybil defense stack, every layer enforced server-side:
//   1. requireSecret middleware → only the frontend server action can
//      reach this (the INTERNAL_SECRET never ships to the browser).
//   2. Privy-bound caller → server action verifies the JWT and forwards
//      privyUserId so the same human can't farm by spawning wallets.
//   3. One drip per wallet, EVER · UNIQUE on faucet_claims.wallet.
//   4. One drip per Privy user → second wallet linked to the same Privy
//      identity is blocked even if the wallet itself is fresh.
//   5. Balance gate → wallet must hold < FAUCET_FRESH_THRESHOLD CELO
//      (default 0.001) at claim time · stops players who already have
//      gas from claiming "for the road".
//   6. Per-IP daily cap → FAUCET_MAX_PER_IP_DAY drips (default 5) from
//      the same IP hash in a rolling 24h. Same-household sharing still
//      works (5 per day per network).
//   7. Global daily kill-switch → FAUCET_MAX_PER_DAY drips total across
//      all wallets (default 50). Worst-case daily drain is bounded ·
//      (50 × 0.1 CELO) ≈ 5 CELO ≈ a few dollars. Tunable via env.
//
// GoodDollar verification is OPTIONAL · enable by setting
// FAUCET_REQUIRE_GOODDOLLAR=true. Default OFF for max onboarding speed.
// When ON, only Self-verified wallets get the drip · strongest sybil
// gate but adds onboarding friction (player must verify first).
const FAUCET_DRIP_CELO        = process.env.FAUCET_DRIP_CELO || '0.7';
// Smaller drip for partner-BFF calls (e.g. Square): a claim/mint costs ~0.06
// CELO, so 0.1 covers it with margin and funds ~7 players for the price of one
// full onboarding drip. Keeps the main onboarding drip untouched.
const FAUCET_PARTNER_DRIP_CELO = process.env.FAUCET_PARTNER_DRIP_CELO || '0.1';
// A wallet under this CELO balance is treated as "out of gas" and eligible for
// a drip. Was 0.001, which left a dead zone: a wallet holding dust (e.g. 0.005
// CELO) was above the line so the faucet refused it, yet it had far too little
// to actually save scores → the player hit "GAS NEEDED" with no way to get
// topped up. 0.05 covers real score-saving gas.
const FAUCET_FRESH_THRESHOLD  = process.env.FAUCET_FRESH_THRESHOLD_CELO || '0.05';
const FAUCET_MAX_PER_IP_DAY   = Number(process.env.FAUCET_MAX_PER_IP_DAY || '5');
const FAUCET_MAX_PER_DAY      = Number(process.env.FAUCET_MAX_PER_DAY || '50');
const FAUCET_REQUIRE_GOODDOLLAR = process.env.FAUCET_REQUIRE_GOODDOLLAR === 'true';

// Per-IP strictLimiter is skipped for partner-BFF calls: they all originate from
// the partner's server IPs, so a per-IP cap would false-throttle legit players in
// a burst. The partner path is still bounded by one-drip-per-wallet-ever, the
// GoodDollar gate, and the global daily kill-switch.
const faucetRateGate = (req, res, next) => (req.viaPartner ? next() : core.strictLimiter(req, res, next));
core.app.post('/api/faucet', core.requireSecretOrPartner, faucetRateGate, async (req, res) => {
  const { address, privyUserId, ipHash } = req.body || {};
  // Partner-BFF calls get the smaller drip; frontend onboarding keeps the full one.
  const dripCelo = req.viaPartner ? FAUCET_PARTNER_DRIP_CELO : FAUCET_DRIP_CELO;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ success: false, error: 'Missing or invalid address' });
  }
  // Drips come from the dedicated faucet wallet when set, else the validator.
  const faucetSigner = core.faucetWallet || core.validator;
  if (!faucetSigner) {
    return res.status(500).json({ success: false, error: 'Faucet not configured' });
  }
  const lower = address.toLowerCase();

  // Layer 3 · one drip per wallet ever
  const { data: existingByWallet } = await core.supabase
    .from('faucet_claims')
    .select('id')
    .eq('wallet', lower)
    .limit(1);
  if (existingByWallet && existingByWallet.length > 0) {
    return res.json({ success: false, reason: 'already_claimed' });
  }

  // Layer 4 · one drip per Privy user (cross-wallet dedup)
  if (privyUserId) {
    const { data: existingByUser } = await core.supabase
      .from('faucet_claims')
      .select('id')
      .eq('privy_user_id', privyUserId)
      .limit(1);
    if (existingByUser && existingByUser.length > 0) {
      return res.json({ success: false, reason: 'user_already_claimed' });
    }
  }

  // Layer 6 · per-IP rolling 24h cap
  if (ipHash) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // `head: true` returns NO rows — the number comes back on `count`. Reading
    // `data.length` here made ipCount permanently 0, so FAUCET_MAX_PER_IP_DAY
    // had never once fired. (The global cap below always destructured `count`
    // correctly, which is why only this layer was dead.)
    const { count: ipCount } = await core.supabase
      .from('faucet_claims')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('claimed_at', since);
    if ((ipCount ?? 0) >= FAUCET_MAX_PER_IP_DAY) {
      return res.json({ success: false, reason: 'ip_rate_limit' });
    }
  }

  // Layer 7 · global daily kill-switch
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await core.supabase
    .from('faucet_claims')
    .select('id', { count: 'exact', head: true })
    .gte('claimed_at', since24h);
  if ((dailyCount ?? 0) >= FAUCET_MAX_PER_DAY) {
    return res.json({ success: false, reason: 'daily_cap' });
  }

  try {
    const provider = faucetSigner.provider;

    // Layer 5 · balance gate · wallets that already have gas don't get more
    const balance = await provider.getBalance(address);
    const threshold = core.ethers.parseEther(FAUCET_FRESH_THRESHOLD);
    if (balance >= threshold) {
      return res.json({ success: false, reason: 'not_fresh' });
    }

    // Optional GoodDollar gate · off by default
    if (FAUCET_REQUIRE_GOODDOLLAR) {
      // Same semantics as the pool gate and the frontend: getWhitelistedRoot
      // resolves linked wallets, plain isWhitelisted does not.
      if (!(await core.isVerified(address))) {
        return res.status(403).json({ success: false, reason: 'unverified' });
      }
    }

    const amountWei = core.ethers.parseEther(dripCelo);

    // Faucet self-balance gate · if the faucet WALLET itself can't cover the
    // drip (+ a little gas), surface a clear `faucet_empty` reason instead of
    // letting sendTransaction throw a generic error — which on Celo/Forno can
    // even masquerade as a fake contract revert. This lets the client show a
    // friendly "gas top-up temporarily unavailable" and stops players from
    // spamming the admin for gas. The loud log line is the low-balance alert.
    const faucetBal = await faucetSigner.provider.getBalance(faucetSigner.address);
    if (faucetBal < amountWei + core.ethers.parseEther('0.02')) {
      console.warn(`⛽ FAUCET LOW: ${core.ethers.formatEther(faucetBal)} CELO left — refusing drip to ${lower}. TOP UP ${faucetSigner.address}`);
      return res.status(503).json({ success: false, reason: 'faucet_empty' });
    }

    const tx = await faucetSigner.sendTransaction({ to: address, value: amountWei });
    await tx.wait();

    // Persist BEFORE returning success so a retry can't double-drip in the
    // gap between tx confirmation and DB write.
    await core.supabase.from('faucet_claims').insert({
      wallet:        lower,
      privy_user_id: privyUserId || null,
      ip_hash:       ipHash || null,
      amount_wei:    amountWei.toString(),
      tx_hash:       tx.hash,
    });

    console.log(`⛽ Faucet: sent ${dripCelo} CELO to ${lower}${req.viaPartner ? ' (partner)' : ''} (tx: ${tx.hash.slice(0, 10)}...)`);
    return res.json({ success: true, txHash: tx.hash, amount: dripCelo });
  } catch (e) {
    console.error(`⛽ Faucet failed for ${lower}:`, e.message);
    return res.status(500).json({ success: false, error: 'Faucet transfer failed' });
  }
});
},

];
