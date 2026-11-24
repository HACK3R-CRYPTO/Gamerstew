// ─── habitat ──────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── Habitat helpers ──
function* (core) {
  Object.defineProperties(core, {
    habitatCache: { get: () => habitatCache, enumerable: true, configurable: true },
    HABITAT_CACHE_TTL_MS: { get: () => HABITAT_CACHE_TTL_MS, enumerable: true, configurable: true },
    freeTierForLevel: { get: () => freeTierForLevel, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Habitat helpers ─────────────────────────────────────────────────────
function freeTierForLevel(level) {
  let tier = core.HABITAT_FREE_TIERS[0].id;
  for (const t of core.HABITAT_FREE_TIERS) {
    if (level >= t.unlockLevel) tier = t.id;
  }
  return tier;
}

// In-memory cache of paid tier ownership per wallet. Chain reads are
// rare-changing (only on unlock), so a 60s TTL keeps the leaderboard
// indicator endpoint fast even when many wallets are queried at once.
const habitatCache = new Map(); // wallet → { ownedPaidTiers: number[], ubiDonated: string, at: ms }
const HABITAT_CACHE_TTL_MS = 60_000;
},

// ── GET /api/habitat/:address — combined free + paid + equipped ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── GET /api/habitat/:address — combined free + paid + equipped ────────────
// One read for any third-party (leaderboard rows, share cards, dashboards).
// Returns the player's level-derived free tier, on-chain owned paid tiers,
// their currently equipped choice, and total UBI contribution.
core.app.get('/api/habitat/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return res.status(400).json({ error: 'Invalid address' });

  // Level from XP (same logic as /api/user)
  const { data: userRows } = await core.supabase
    .from('users')
    .select('xp, equipped_habitat')
    .eq('wallet_address', addr)
    .limit(1);
  const xp = userRows?.[0]?.xp || 0;
  const level = core.levelFromXp(xp);
  const freeTier = core.freeTierForLevel(level);

  // Paid ownership (chain) + UBI donation total
  const { ownedPaidTiers, ubiDonated } = await core.fetchPaidOwnership(addr);

  // Equipped choice. Falls back to highest paid owned, otherwise free tier.
  const stored = userRows?.[0]?.equipped_habitat || null;
  const validStored =
    stored != null &&
    ((stored >= 6 && ownedPaidTiers.includes(stored)) ||
     (stored >= 1 && stored <= 5 && stored <= freeTier));
  const equipped = validStored
    ? stored
    : (ownedPaidTiers.length > 0 ? Math.max(...ownedPaidTiers) : freeTier);

  res.json({
    address: addr,
    level,
    freeTier,
    ownedPaidTiers,
    equipped,
    ubiDonated,
  });

  // Lazy season point credit — fire-and-forget so the response stays fast.
  // Any player loading their habitat page gets their +30/tier credited
  // without waiting on a manual sync.
  core.creditHabitatPoints(addr, ownedPaidTiers).catch(() => {});
});
},

// ── POST /api/habitat/equip — persist player's equipped tier choice ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── POST /api/habitat/equip — persist player's equipped tier choice ────────
// Stored in users.equipped_habitat so the choice travels with the wallet
// across devices. Validates ownership before writing.
// SECURITY (2026-07-17 audit): this had no requireSecret because useHabitats
// POSTed it straight from the browser, and a browser cannot hold the secret.
// The CORS origin check is NOT authentication · any script can forge an Origin
// header, so this was world-writable: anyone could change any player's equipped
// habitat. It now goes through the setHabitatEquip server action (see
// frontend/app/actions/habitat.ts), so it can demand the secret like every
// other write path.
core.app.post('/api/habitat/equip', core.requireSecret, async (req, res) => {
  const { address, tier } = req.body || {};
  if (!address || typeof tier !== 'number') {
    return res.status(400).json({ error: 'address and tier required' });
  }
  const addr = String(address).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return res.status(400).json({ error: 'Invalid address' });
  if (tier < 1 || tier > 255) return res.status(400).json({ error: 'Invalid tier' });

  // Validate the player can actually equip this tier
  const { data: userRows } = await core.supabase
    .from('users')
    .select('xp')
    .eq('wallet_address', addr)
    .limit(1);
  const xp = userRows?.[0]?.xp || 0;
  const level = core.levelFromXp(xp);
  const freeTier = core.freeTierForLevel(level);

  if (tier <= 5) {
    // Free tier: must be reached by level
    if (tier > freeTier) return res.status(403).json({ error: 'Free tier not yet unlocked' });
  } else {
    // Paid tier: must own on-chain
    const { ownedPaidTiers } = await core.fetchPaidOwnership(addr);
    if (!ownedPaidTiers.includes(tier)) {
      return res.status(403).json({ error: 'Paid tier not owned' });
    }
  }

  // Upsert: row may not exist yet for new players
  const { error } = await core.supabase
    .from('users')
    .upsert({ wallet_address: addr, equipped_habitat: tier }, { onConflict: 'wallet_address' });
  if (error) return res.status(500).json({ error: 'Persist failed' });

  res.json({ success: true, equipped: tier });
});

// ─── GoodCollective choice ──────────────────────────────────────────────────
// Per-player attribution: which GoodCollective their G$ spending's UBI share
// supports. On-chain the 20% flows to one pool, so this ledger drives display
// (passport, impact) and future multi-pool routing. Table: collective_choice.

// GET /api/collective/:address → { collectiveId } (null when never chosen)
core.app.get('/api/collective/:address', async (req, res) => {
  const addr = String(req.params.address || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return res.status(400).json({ error: 'Invalid address' });
  try {
    const { data } = await core.supabase
      .from('collective_choice').select('collective_id').eq('wallet', addr).maybeSingle();
    return res.json({ collectiveId: data?.collective_id ?? null });
  } catch {
    return res.json({ collectiveId: null });
  }
});

// POST /api/collective/choose { address, collectiveId } · requireSecret: comes
// through a Next server action for the connected wallet (same trust model as
// /api/habitat/equip).
core.app.post('/api/collective/choose', core.requireSecret, async (req, res) => {
  const { address, collectiveId } = req.body || {};
  const addr = String(address || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return res.status(400).json({ error: 'Invalid address' });
  const id = String(collectiveId || '').trim();
  if (!id || id.length > 64 || !/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Invalid collective' });
  const { error } = await core.supabase
    .from('collective_choice')
    .upsert({ wallet: addr, collective_id: id, set_at: new Date().toISOString() }, { onConflict: 'wallet' });
  if (error) return res.status(500).json({ error: 'Persist failed' });
  return res.json({ success: true, collectiveId: id });
});
},

];
