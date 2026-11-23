// ─── tug ──────────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── Verified Tug of War ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── Verified Tug of War ─────────────────────────────────────────────────────
// Standings are COMPUTED, never stored: the subgraph says who played and when,
// the GoodDollar Identity contract says who is a verified human and which human
// they are. That means the event runs without a migration, and every number on
// the page is re-derivable from the chain rather than trusted from a table.
//
// isVerified here is self-verification only; identityRootOf is the dedupe key.
// Keeping those separate is what stops one face being counted as many players
// (see the note on the identity cache above).
const tugEvent = require('../lib/tugEvent');

// Who referred whom. Reuses season_v1_referrer_intent — the same table the Cup
// referral lane and the connector crown already read — so a recruit lands on
// their recruiter's side without a new table.
//
// Cached for a few minutes: referrals are rare (82 in the project's lifetime)
// and a recruit showing up on the right side a minute late costs nothing.
let _refCache = { at: 0, map: null };
const REF_TTL_MS = 3 * 60 * 1000;
async function tugReferrerMap() {
  if (_refCache.map && Date.now() - _refCache.at < REF_TTL_MS) return _refCache.map;
  const map = new Map();
  try {
    let from = 0;
    for (;;) {
      const { data, error } = await core.supabase
        .from('season_v1_referrer_intent')
        .select('wallet, referrer_wallet')
        .range(from, from + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) {
        const w = r.wallet?.toLowerCase(), ref = r.referrer_wallet?.toLowerCase();
        if (w && ref && w !== ref) map.set(w, ref);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    _refCache = { at: Date.now(), map };
  } catch (e) {
    console.warn('tug referrer map failed:', e?.message || e);
    return _refCache.map || map;   // stale beats empty: empty silently re-homes everyone
  }
  return map;
}

// Persisted team assignments. This is the anchor that lets teams both stay
// stable (nobody moves) AND stay balanced (new joiners fill the smaller side):
// once a wallet is here, its team is fixed forever; only wallets NOT here are
// balanced on the way in. Reads/writes tug_team; every path degrades to the
// identity-hash fallback if the table is missing, so it can never break tug.
async function loadTugTeams() {
  const map = new Map();
  try {
    let from = 0;
    for (;;) {
      const { data, error } = await core.supabase
        .from('tug_team')
        .select('wallet, team')
        .eq('event_id', tugEvent.tugConfig().eventId)
        .range(from, from + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) if (r.wallet && (r.team === 'red' || r.team === 'blue')) map.set(String(r.wallet).toLowerCase(), r.team);
      if (data.length < 1000) break;
      from += 1000;
    }
  } catch (e) {
    // Table not provisioned yet, or transient. Return null so assignSides falls
    // back to the pure identity hash (current stable behaviour), never empty
    // (empty would treat everyone as new and rebalance them).
    return null;
  }
  // An empty table means "provisioned but not seeded yet". Treat that as the
  // hash fallback too, so persistence only activates once the seed has frozen
  // the current teams — a deploy before seeding can never trigger a reshuffle.
  return map.size > 0 ? map : null;
}
async function saveTugTeams(rows) {
  if (!rows || !rows.length) return;
  const eventId = tugEvent.tugConfig().eventId;
  try {
    await core.supabase.from('tug_team').upsert(
      rows.map((r) => ({ wallet: String(r.wallet).toLowerCase(), identity_root: r.identity_root || null, team: r.team, event_id: eventId })),
      { onConflict: 'wallet,event_id', ignoreDuplicates: true },
    );
  } catch (e) { /* best-effort; a missed write just reassigns next rebuild */ }
}

let _tugCache = { at: 0, data: null };
let _tugInflight = null;                        // single-flight guard
const TUG_TTL_MS = Number(process.env.TUG_TTL_MS || 30_000);

// SINGLE FLIGHT. A rebuild pages the subgraph and reads the Identity contract
// for every candidate wallet, so it is by far the most expensive thing here.
// With a plain TTL cache, the moment it expires EVERY in-flight request misses
// at once and they all rebuild together — the classic stampede, and it gets
// worse exactly when the event is busiest. Concurrent callers now await the one
// rebuild already running.
//
// Cost is therefore flat in traffic: at most one rebuild per TTL no matter
// whether 5 people or 5,000 are watching the rope.
async function getTugStandings() {
  if (_tugCache.data && Date.now() - _tugCache.at < TUG_TTL_MS) return _tugCache.data;
  if (_tugInflight) return _tugInflight;

  _tugInflight = (async () => {
    const _t0 = Date.now();
    console.log('🪢 tug rebuild START');
    try {
      const data = await tugEvent.buildStandings(
        { subgraph: core.subgraph, isVerified: core.isVerified, identityRootOf: core.identityRootOf, everVerified: core.everVerified, mapLimit: core.mapLimit, referrerMap: tugReferrerMap, loadTeams: loadTugTeams, saveTeams: saveTugTeams },
        tugEvent.tugConfig(),
        Date.now(),
      );
      _tugCache = { at: Date.now(), data };
      console.log(`🪢 tug rebuild DONE in ${Date.now() - _t0}ms`);
      return data;
    } catch (e) {
      // Serve the last good standing rather than failing everyone. A rope that
      // is 40 seconds stale beats a blank one during a prize event.
      if (_tugCache.data) {
        console.warn('tug rebuild failed, serving stale:', e?.message || e);
        return _tugCache.data;
      }
      throw e;
    } finally {
      _tugInflight = null;
    }
  })();
  return _tugInflight;
}

// Verification expiry moves once every few months, so re-reading identities()
// on every /me poll was pure waste — one on-chain call per player per poll.
const _expiryCache = new Map();
const EXPIRY_TTL_MS = 6 * 60 * 60 * 1000;
async function verificationDaysLeftCached(wallet) {
  const w = String(wallet).toLowerCase();
  const hit = _expiryCache.get(w);
  if (hit && Date.now() - hit.at < EXPIRY_TTL_MS) return hit.days;
  try {
    const schedule = await core.getReverifySchedule();
    if (!schedule || !core._gdIdentity) return 0;
    const idn = await core._gdIdentity.identities(w);
    const days = core.computeIdentityExpiry(idn, schedule).daysLeft;
    _expiryCache.set(w, { days, at: Date.now() });
    return days;
  } catch {
    return hit ? hit.days : 0;
  }
}

core.app.get('/api/tug', core.requireSecret, async (_req, res) => {
  try {
    const { standings } = await getTugStandings();
    res.json(standings);
  } catch (e) {
    console.warn('tug standings failed:', e?.message || e);
    res.status(503).json({ error: 'standings unavailable' });
  }
});

// Referral leaderboard for the creator / thread contest — every referrer ranked
// by QUALIFIED referrals brought DURING the contest window. A referral counts
// when the referred player was brought in the window (referral set_at inside
// it), has ever passed a GoodDollar face check, and has played the qualifying
// games. Windowed by ?since / ?until (ISO); defaults to the creator-contest env
// window. This is a separate competition from the in-app tug recruiter prize,
// so it must not reuse the tug board's all-time counts. Public: names + counts.
const CREATOR_CONTEST_START = process.env.CREATOR_CONTEST_START || '';
const CREATOR_CONTEST_END = process.env.CREATOR_CONTEST_END || '';
core.app.get('/api/referrals/leaderboard', async (req, res) => {
  try {
    const sinceMs = req.query.since ? Date.parse(String(req.query.since))
      : (CREATOR_CONTEST_START ? Date.parse(CREATOR_CONTEST_START) : NaN);
    const untilMs = req.query.until ? Date.parse(String(req.query.until))
      : (CREATOR_CONTEST_END ? Date.parse(CREATOR_CONTEST_END) : Date.now());

    // Play data comes from the warm tug cache — no extra subgraph calls.
    // A referral counts when the player VERIFIES and plays the qualifying games,
    // matching the contest's announced rules. Override with ?minGames=0 to count
    // verified-only, or any N for a different bar.
    const { plays, cfg } = await getTugStandings();
    const defaultMin = cfg?.qualifyGames ?? 3;
    const minGames = Number.isFinite(Number(req.query.minGames)) ? Math.max(0, Number(req.query.minGames)) : defaultMin;

    // Referrals within the window, from the intent table's set_at.
    let rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await core.supabase.from('season_v1_referrer_intent')
        .select('wallet, referrer_wallet, set_at').range(from, from + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const inWindow = rows.filter((r) => {
      const t = Date.parse(r.set_at);
      if (!Number.isFinite(t)) return true;               // undated rows: keep
      if (Number.isFinite(sinceMs) && t < sinceMs) return false;
      if (Number.isFinite(untilMs) && t > untilMs) return false;
      return true;
    });

    // A referral qualifies when the player has ever verified AND played the bar.
    const referredWallets = [...new Set(inWindow.map((r) => r.wallet?.toLowerCase()).filter(Boolean))];
    const qual = new Map();
    await core.mapLimit(referredWallets, 10, async (w) => {
      const pl = plays?.get(w);
      const played = minGames <= 0 ? true : Boolean(pl && (pl.total || 0) >= minGames);
      const ever = played ? await core.everVerified(w) : false;   // skip the read when the play bar isn't met
      qual.set(w, Boolean(played && ever));
    });

    const byRef = new Map();  // referrer -> Set(qualified recruit wallets)
    for (const r of inWindow) {
      const w = r.wallet?.toLowerCase(), ref = r.referrer_wallet?.toLowerCase();
      if (!w || !ref || w === ref || !qual.get(w)) continue;
      if (!byRef.has(ref)) byRef.set(ref, new Set());
      byRef.get(ref).add(w);
    }
    const nameFor = (w) => { const pl = plays?.get(w); return (pl && pl.username) || String(w).slice(2, 8); };
    const leaderboard = [...byRef.entries()]
      .map(([ref, set]) => ({ name: nameFor(ref), qualifiedReferrals: set.size }))
      .sort((a, b) => b.qualifiedReferrals - a.qualifiedReferrals || a.name.localeCompare(b.name))
      .map((r, i) => ({ rank: i + 1, ...r }));

    res.json({
      updatedAt: new Date().toISOString(),
      window: { since: Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null,
                until: Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : null },
      rule: minGames > 0 ? `verified + played ${minGames} games` : 'verified',
      entrants: leaderboard.length,
      leaderboard,
    });
  } catch (e) {
    console.warn('referral leaderboard failed:', e?.message || e);
    res.status(503).json({ error: 'unavailable' });
  }
});

core.app.get('/api/tug/me', core.requireSecret, async (req, res) => {
  const wallet = String(req.query.wallet || '').toLowerCase();
  try {
    const { standings, players, byWallet, bountyRank, plays, cfg, todayStr } = await getTugStandings();
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
      return res.json({ wallet: null, team: null, qualified: false, bountyRank: null,
        pullsToday: 0, dailyPullCap: cfg?.dailyPullCap ?? 10, pullsTotal: 0,
        pointsPerHuman: cfg?.pointsPerHuman ?? 20,
        gamesToQualify: cfg?.qualifyGames ?? 3, gamesPlayed: 0,
        verified: false, verificationDaysLeft: 0, teamPercentile: null });
    }

    const me = byWallet?.get(wallet) || null;
    const play = plays?.get(wallet) || null;
    const gamesPlayed = play?.total || 0;
    const pullsToday = Math.min(play?.days?.get(todayStr) || 0, cfg.dailyPullCap);

    // Percentile within YOUR OWN team, never a global rank — "4,112nd of 9,000"
    // is a reason to close the tab.
    let teamPercentile = null, neighbours = undefined;
    if (me?.counted) {
      const mates = (players || [])
        .filter((p) => p.counted && p.team === me.team)
        .sort((a, b) => b.pulls - a.pulls || String(a.wallet).localeCompare(String(b.wallet)));
      const idx = mates.findIndex((p) => p.wallet === wallet);
      if (idx >= 0) {
        teamPercentile = Math.max(1, Math.round(((idx + 1) / mates.length) * 100));
        const from = Math.max(0, idx - 2), to = Math.min(mates.length, idx + 3);
        neighbours = mates.slice(from, to).map((p, i) => ({
          rank: from + i + 1,
          name: p.username || String(p.wallet).slice(2, 8),
          pulls: p.pulls,
          isMe: p.wallet === wallet,
        }));
      }
    }

    const verified = await core.isVerified(wallet);            // 60-min cached
    const verificationDaysLeft = await verificationDaysLeftCached(wallet);  // 6-hr cached

    // Your recruits, bucketed, so a recruiter can SEE who counted and who is one
    // nudge away — instead of a bare "10 brought" with no way to chase the rest.
    // Bounded to this wallet's own referrals (~a dozen), cached briefly.
    let recruitBreakdown = null;
    try {
      const rbKey = `tugrecruits:${wallet}`;
      recruitBreakdown = core.cacheGet(rbKey);
      if (!recruitBreakdown) {
        const { data: refs } = await core.supabase.from('season_v1_referrer_intent')
          .select('wallet').ilike('referrer_wallet', wallet).limit(1000);
        const recruitWallets = [...new Set((refs || []).map((r) => r.wallet?.toLowerCase()).filter(Boolean))]
          .filter((w) => w !== wallet);
        const counted = [], needPlay = [], needVerify = [];
        await core.mapLimit(recruitWallets, 8, async (w) => {
          const pl = plays?.get(w);
          const played3 = Boolean(pl && pl.qualifiedTs !== undefined);
          const ever = await core.everVerified(w);
          const name = (pl && pl.username) || String(w).slice(2, 8);
          if (ever && played3) counted.push(name);
          else if (ever && !played3) needPlay.push(name);   // verified, just needs to play
          else needVerify.push(name);                        // hasn't verified yet
        });
        recruitBreakdown = {
          counted: counted.sort(), needPlay: needPlay.sort(), needVerify: needVerify.sort(),
          countedN: counted.length, needPlayN: needPlay.length, needVerifyN: needVerify.length,
        };
        core.cacheSet(rbKey, recruitBreakdown, 3 * 60 * 1000);
      }
    } catch (e) { /* breakdown is a bonus; never fail /me over it */ }

    res.json({
      wallet,
      // identityRootOf is itself cached; only reached for players not yet in
      // the standings, so it costs nothing for the qualified majority.
      team: me?.counted ? me.team : (verified ? tugEvent.assignTeam((await core.identityRootOf(wallet)) || wallet) : null),
      qualified: Boolean(me?.counted),
      bountyRank: bountyRank?.get(wallet) ?? null,
      pullsToday,
      dailyPullCap: cfg.dailyPullCap,
      pointsPerHuman: cfg.pointsPerHuman,
      pullsTotal: me?.pulls ?? 0,
      gamesToQualify: cfg.qualifyGames,
      gamesPlayed,
      verified,
      verificationDaysLeft,
      teamPercentile,
      neighbours,
      recruitBreakdown,
      referral: (() => {
        const board = _tugCache.data?.referralBoard || [];
        const row = board.find((r) => r.wallet === wallet);
        const paidPlaces = (cfg.referralPrizesG || []).length;

        // "How far off am I" is the number a recruiter actually wants, and
        // without it the board is just a list of people beating them. Knowing
        // it takes two more people to reach a paid place is what makes someone
        // go and get two more people.
        const gapTo = (targetRank) => {
          const target = board[targetRank - 1];
          if (!target) return null;
          const mine = row?.recruits ?? 0;
          return { rank: targetRank, name: target.username || String(target.wallet).slice(2, 8),
                   need: Math.max(1, target.recruits - mine + 1) };
        };

        if (!row) {
          // Not on the board yet: show what the last paid place is holding.
          return { recruits: 0, rank: null, prizeG: 0, paidPlaces,
                   nextUp: paidPlaces ? gapTo(paidPlaces) : null, inTheMoney: false };
        }
        return {
          recruits: row.recruits,
          rank: row.rank,
          prizeG: row.prizeG,
          paidPlaces,
          inTheMoney: row.rank <= paidPlaces,
          // Chasing the place above; already first means nothing to chase.
          nextUp: row.rank > 1 ? gapTo(row.rank - 1) : null,
        };
      })(),
      _standingsAt: standings.serverTime,
    });
  } catch (e) {
    console.warn('tug me failed:', e?.message || e);
    res.status(503).json({ error: 'unavailable' });
  }
});

// ─── GET /api/tug/payout-list — the final, auditable per-wallet distribution ──
// Computed straight from the same standings the event ran on, so it is
// reproducible and nobody has to eyeball a payout. requireSecret: it exposes
// every participant's wallet, so it is admin-only. Only returns once the event
// has ENDED (a payout mid-event would be wrong).
//
// Prize model, exactly as the in-app rules (TugRules.tsx) promised players:
//   1. Bounty      · each wallet that CLAIMED a bounty slot (first bountySlots
//                    qualifiers) gets bountyAmountG. Unclaimed slots are not owed
//                    to anyone. 77 of 160 claimed → only those 77 are paid.
//   2. Team split  · prizeTotalG − (bountySlots × bountyAmountG) = the split pool
//                    (600,000 G$ here). Paid to every COUNTED player in proportion
//                    to their individual points, so the winning side earns more in
//                    aggregate (they scored more) while the losing side is still
//                    paid "by how much" they scored — the exact wording of rule 6.
//                    ?rollUnclaimed=1 folds the unclaimed bounty into this pool
//                    instead of leaving it in treasury (opt-in; default off, which
//                    matches the literal rule).
//   3. Referral    · top referrers get referralPrizesG (500k/300k/200k) by wallet.
// A wallet can appear in more than one bucket; its row sums them.
core.app.get('/api/tug/payout-list', core.requireSecret, async (req, res) => {
  try {
    const data = await getTugStandings();
    const { standings, players, bountyRank, referralBoard, cfg } = data;
    if (standings.status !== 'ended') {
      return res.status(409).json({ error: 'event not ended', status: standings.status });
    }

    const BOUNTY_G = cfg.bountyAmountG;
    const bountyReserveG = cfg.bountySlots * cfg.bountyAmountG;
    const baseSplitPoolG = cfg.prizeTotalG - bountyReserveG;
    const claimed = bountyRank.size;
    const unclaimedBountyG = (cfg.bountySlots - claimed) * cfg.bountyAmountG;
    const rollUnclaimed = req.query.rollUnclaimed === '1';
    const splitPoolG = rollUnclaimed ? baseSplitPoolG + unclaimedBountyG : baseSplitPoolG;

    const acc = new Map(); // wallet -> { wallet, name, bounty, split, referral }
    const add = (wallet, field, amt, name) => {
      if (!amt) return;
      const w = String(wallet).toLowerCase();
      let row = acc.get(w);
      if (!row) { row = { wallet: w, name: name || null, bounty: 0, split: 0, referral: 0 }; acc.set(w, row); }
      row[field] += amt;
      if (name && !row.name) row.name = name;
    };

    // 1 · Bounty — only wallets that actually claimed a slot
    for (const p of players) if (bountyRank.has(p.wallet)) add(p.wallet, 'bounty', BOUNTY_G, p.username);

    // 2 · Team split — proportional to individual points, counted players only
    const counted = players.filter((p) => p.counted && p.points > 0);
    const totalPoints = counted.reduce((s, p) => s + p.points, 0);
    for (const p of counted) {
      const amt = totalPoints > 0 ? Math.round((splitPoolG * p.points) / totalPoints) : 0;
      add(p.wallet, 'split', amt, p.username);
    }

    // 3 · Referral — top placements with a prize
    for (const r of referralBoard) if (r.prizeG > 0) add(r.wallet, 'referral', r.prizeG, r.username);

    const payouts = [...acc.values()]
      .map((r) => ({ ...r, totalG: r.bounty + r.split + r.referral }))
      .sort((a, b) => b.totalG - a.totalG);

    const sum = (f) => payouts.reduce((s, r) => s + r[f], 0);

    // ?format=disperse → plain text ready to paste into Disperse.app: one
    // "wallet amount" per line, amounts in whole G$ (Disperse takes token units,
    // not wei). Zero-total rows are dropped so no dust entries.
    if (req.query.format === 'disperse') {
      const text = payouts.filter((r) => r.totalG > 0).map((r) => `${r.wallet} ${r.totalG}`).join('\n');
      res.set('Content-Type', 'text/plain; charset=utf-8');
      return res.send(text);
    }

    res.json({
      eventId: cfg.eventId,
      endsAt: cfg.endsAt,
      winner: standings.blue > standings.red ? 'blue' : standings.red > standings.blue ? 'red' : 'tie',
      scores: { red: standings.red, blue: standings.blue },
      pools: {
        mainTotalG: cfg.prizeTotalG,
        bountyReserveG,
        bountySlots: cfg.bountySlots,
        bountyClaimed: claimed,
        bountyPaidG: claimed * BOUNTY_G,
        unclaimedBountyG,
        rolledUnclaimedIntoSplit: rollUnclaimed,
        splitPoolG,
        referralTotalG: standings.referral?.totalG ?? 0,
      },
      totals: { wallets: payouts.length, bountyG: sum('bounty'), splitG: sum('split'), referralG: sum('referral'), totalG: sum('totalG') },
      payouts,
    });
  } catch (e) {
    console.warn('tug payout-list failed:', e?.message || e);
    res.status(503).json({ error: 'unavailable' });
  }
});

// ─── Tug of War notification cron ────────────────────────────────────────────
// Four moments, and deliberately only four. Push is the one channel a player
// cannot mute selectively without muting everything, so an event that pings
// daily trains people to turn it off before it even starts.
//
//   T-24h   verify tonight — the bounty slots go in order and a first face
//           check takes 30 seconds, so arriving unverified on day one means
//           the early slots are already gone
//   launch  the rope is live
//   scarce  bounty slots nearly gone, sent ONCE, and only to people who have
//           not claimed one — telling a player who already has a slot that
//           slots are running out is noise
//   T-24h   last day
//
// sendToWallet already de-dupes per (wallet, category, day) and writes
// notifications_feed, so the message still reaches the ~96% of players with no
// push subscription next time they open the app.
function tugNotifyWindow(nowMs, startMs, endMs) {
  const H = 3600 * 1000;
  const toStart = startMs - nowMs;
  const toEnd = endMs - nowMs;
  if (toStart > 23 * H && toStart <= 25 * H) return 'tug_eve';
  if (toStart <= 0 && toStart > -2 * H) return 'tug_live';
  if (toEnd > 23 * H && toEnd <= 25 * H) return 'tug_lastday';
  return null;
}

async function sendTugNotifications() {
  try {
    const cfg = tugEvent.tugConfig();
    const startMs = Date.parse(cfg.startsAt), endMs = Date.parse(cfg.endsAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    const now = Date.now();

    const { data: subs } = await core.supabase.from('push_subscriptions').select('wallet_address');
    const wallets = [...new Set((subs || []).map((r) => r.wallet_address?.toLowerCase()).filter(Boolean))];
    if (wallets.length === 0) return;

    const moment = tugNotifyWindow(now, startMs, endMs);
    if (moment) {
      const payload = {
        tug_eve: {
          title: '🪢 Tug of War opens tomorrow',
          body: `Verify tonight. The first ${cfg.bountySlots} players to verify and play take ${cfg.bountyAmountG.toLocaleString()} G$ each, in order.`,
        },
        tug_live: {
          title: '🪢 The rope is live',
          body: 'Play 3 games and you are pulling for your side. Bring someone and they land on your team.',
        },
        tug_lastday: {
          title: '🪢 Last day on the rope',
          body: 'It closes in 24 hours. Your best run today still counts.',
        },
      }[moment];
      let sent = 0;
      for (const w of wallets) {
        if (await core.push.sendToWallet(core.supabase, w, moment, { ...payload, tag: moment, url: '/tug' })) sent++;
      }
      if (sent > 0) console.log(`🪢 ${moment} sent to ${sent} wallets`);
      return;
    }

    // Scarcity, mid-event only, and only to players without a slot.
    if (now <= startMs || now >= endMs) return;
    const { standings, bountyRank } = await getTugStandings();
    const left = cfg.bountySlots - (standings?.bounty?.claimed ?? 0);
    if (left > 30 || left <= 0) return;
    let sent = 0;
    for (const w of wallets) {
      if (bountyRank?.has(w)) continue;   // already holds a slot
      const ok = await core.push.sendToWallet(core.supabase, w, 'tug_bounty_low', {
        title: `🪢 ${left} guaranteed slots left`,
        body: `Verify and play 3 games to claim ${cfg.bountyAmountG.toLocaleString()} G$. Once they are gone they are gone.`,
        tag: 'tug-bounty-low',
        url: '/tug',
      });
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🪢 bounty-low sent to ${sent} wallets (${left} left)`);
  } catch (e) {
    console.warn('tug notification cron failed:', e?.message || e);
  }
}
setInterval(sendTugNotifications, 60 * 60 * 1000);
},

];
