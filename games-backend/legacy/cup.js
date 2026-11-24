// ─── cup ──────────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── Arena Cup ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── Arena Cup ──────────────────────────────────────────────────────────────
// The 14-day skill event: two ladders (humans + their AIs) + a community pot.
// PHASE 1 (this): the HUMAN ladder from two lanes — Skill (best run per game)
// and Consistency (distinct days) — computed from the SUBGRAPH. We use the
// subgraph, not the `scores` table, on purpose: `scores` keeps only each
// player's all-time best (saveScore deletes the lower row), so it cannot answer
// "best run inside the 14-day window". Immutable subgraph Score entities carry
// per-run blockTimestamps, so one windowed query yields both best-run and
// distinct-days. Referral / G$-spend / Agent lanes land in later phases.
//
// Skill covers the 3 score games (gameType 0/1/2). Challenge AI is match-based,
// not score-based — it feeds Consistency, the community pot, and the Agent Cup.
const CUP = {
  // UTC ISO. Fri Aug 7 17:00 WAT (UTC+1) = 16:00 UTC, 14 days. Env overrides win.
  startsAt: process.env.CUP_STARTS_AT || '2026-08-07T16:00:00Z',
  endsAt:   process.env.CUP_ENDS_AT   || '2026-08-21T16:00:00Z',
  // Cup Points lane weights (tune after a dry run).
  weights: { skill: 1.0, consist: 8, ref: 25, spend: 1.0 },
  kSpend: 1.0,
  // Cap the spend lane so G$ spend stays a nudge, not a way to buy rank. The
  // √ curve alone let one player convert ~35,850 G$ into 189 points and take
  // #1 over skill-elite grinders. 60 pts ≈ √3,600 G$ — spend past that adds
  // nothing. Env-overridable so it can be retuned without a deploy.
  maxSpendPts: Number(process.env.CUP_MAX_SPEND_PTS || 60),
  // Community pot: total plays (human + agent) unlock bonus G$ for everyone.
  potMilestones: [
    { at: 2_000,  bonusG: 20_000 },
    { at: 5_000,  bonusG: 50_000 },
    { at: 10_000, bonusG: 100_000 },
  ],
  humanSplit: [
    { key: 'champion',  label: 'Cup Champion',  usd: 40 },
    { key: 'second',    label: 'Runner-up',     usd: 25 },
    { key: 'third',     label: '3rd place',     usd: 15 },
    { key: 'connector', label: 'Top Connector', usd: 12 },
    { key: 'streak',    label: 'Iron Streak',   usd: 8  },
  ],
  agentSplit: [
    { key: 'agent1', label: 'Top Agent', usd: 30 },
    { key: 'agent2', label: '2nd Agent', usd: 12 },
    { key: 'agent3', label: '3rd Agent', usd: 8  },
  ],
};
// gameType -> score divisor (same mapping saveScore uses: rhythm 100, simon 20, stack 5).
const CUP_DIVISOR = { 0: 100, 1: 20, 2: 5 };

// Every run in the window, paginated by blockTimestamp (immutable Score rows).
async function cupWindowScores(startSec, endSec) {
  const out = [];
  let cursor = startSec;
  for (let page = 0; page < 40; page++) { // 40 * 1000 = 40k ceiling, ample
    const q = await core.subgraph.gql(
      `query CupScores($e: String!, $c: String!) {
         scores(first: 1000, orderBy: blockTimestamp, orderDirection: asc,
                where: { blockTimestamp_gte: $c, blockTimestamp_lt: $e }) {
           player { id } gameType score blockTimestamp
         }
       }`,
      { e: String(endSec), c: String(cursor) },
    );
    const batch = q.scores || [];
    out.push(...batch);
    if (batch.length < 1000) break;
    cursor = Number(batch[batch.length - 1].blockTimestamp) + 1; // next second
  }
  return out;
}

// Immutable final-board snapshot. Once the Cup ends, the FIRST call computes
// the board one last time and freezes it here; every later call serves this
// copy untouched. This does two jobs at once:
//   1. Correctness — the ended Cup stops drifting. It used to recompute every
//      60s against CURRENT verification, so as referred friends verified or
//      lapsed after the deadline the "final" standings kept reshuffling (the
//      "is this a glitch?" reports). Frozen = winners locked at the deadline.
//   2. Cost — recomputing paged the full arena_free_matches table (tens of
//      thousands of rows) every 60s forever, which blew the Supabase egress
//      quota. A frozen board does ZERO Supabase reads.
// In-memory (recomputes once per cold start) — no migration needed; the
// referral set_at<=deadline bound below keeps that recompute deterministic.
let cupFrozenPayload = null;

core.app.get('/api/cup', async (req, res) => {
  const startSec = Math.floor(Date.parse(CUP.startsAt) / 1000);
  const endSec   = Math.floor(Date.parse(CUP.endsAt) / 1000);
  const nowSec   = Math.floor(Date.now() / 1000);
  const phase = nowSec < startSec ? 'upcoming' : nowSec >= endSec ? 'ended' : 'live';
  const startIso = new Date(startSec * 1000).toISOString();
  const endIso   = new Date(Math.min(nowSec, endSec) * 1000).toISOString();

  let payload = (phase === 'ended' && cupFrozenPayload) ? cupFrozenPayload : core.cacheGet('cup:payload');
  if (!payload) {
    try {
      // ── Skill + Consistency, from the subgraph (per-run timestamps) ──
      const rows = phase === 'upcoming' ? [] : await cupWindowScores(startSec, Math.min(nowSec, endSec));

      // ── Agent Cup (arena_free_matches, windowed) · computed FIRST so we know
      // the agent address set. Deployed agents fight MARKOV through the free
      // Challenge-AI arena, so each match is a row in arena_free_matches keyed
      // by the agent's wallet (outcome player_won = agent beat MARKOV). Those
      // matches also leave an on-chain gameType-3 score under the agent address,
      // so we must pull agents OUT of the Human ladder (consistency lane) too.
      // Who is an agent is decided on-chain via getAgent — the same gate the
      // in-app arena board uses — NOT by "played Challenge-AI" (humans play it
      // too). NOTE: the retired staked-PvP flow (agent_match_state) stopped
      // writing on Jul 22; arena_free_matches is the live source of truth. ──
      // Freeze health guard — if any Supabase-backed lane throws (e.g. the agent
      // pagination or referral read times out on a cold start), the board is
      // INCOMPLETE and must NOT be frozen, or we'd lock in wrong winners. Flipped
      // false in each lane's catch; only a fully-successful board gets frozen.
      let lanesComplete = true;
      let agent = [];
      const agentSet = new Set();
      const agentOwner = new Map(); // agentWalletLower -> ownerWalletLower
      try {
        // Page through arena_free_matches. Supabase caps a single response at
        // ~1,000 rows, so the old `.limit(20000)` silently returned only the
        // OLDEST ~1,000 matches of the whole Cup and froze high-volume agents
        // (e.g. an agent with 2,676 real wins showed 52). Range-paginate by
        // created_at so every match in the window is counted, per the rules.
        const astats = new Map();
        const PAGE = 1000;
        for (let from = 0; from < 500000; from += PAGE) {
          const { data: arows, error } = await core.supabase.from('arena_free_matches')
            .select('wallet, outcome')
            .gte('created_at', startIso).lt('created_at', endIso)
            .order('created_at', { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) { lanesComplete = false; console.warn('cup agent page:', error.message); break; }
          if (!arows || arows.length === 0) break;
          for (const r of arows) {
            const w = r.wallet?.toLowerCase(); if (!w) continue;
            if (!astats.has(w)) astats.set(w, { matches: 0, wins: 0, ties: 0 });
            const s = astats.get(w); s.matches++;
            if (r.outcome === 'player_won') s.wins++; else if (r.outcome === 'tie') s.ties++;
          }
          if (arows.length < PAGE) break;
        }
        // On-chain gate: keep only the wallets that are registered agents. One
        // multicall over every Challenge-AI player in the window.
        const agentToOwner = await core.classifyAgents([...astats.keys()]);
        for (const [w, ow] of agentToOwner) { agentSet.add(w); agentOwner.set(w, ow); }
        agent = [...agentSet].map((w) => {
          const s = astats.get(w);
          return {
            wallet: w, matches: s.matches, wins: s.wins, ties: s.ties,
            losses: s.matches - s.wins - s.ties,
            net: s.wins - (s.matches - s.wins - s.ties),
            winRate: s.matches ? Math.round((s.wins / s.matches) * 100) : 0,
          };
        // Rank by wins vs MARKOV first (the whole point is beating it), then
        // win-rate, then net — so grinding out real wins is what climbs, and a
        // single lucky win can't leapfrog a player who beat MARKOV many times.
        }).sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.net - a.net).slice(0, 50);
        // Owner (agentVault operator) is already known from classifyAgents, so
        // the Agent Cup can show who's behind the bot with no extra RPC.
        await Promise.all(agent.map(async (e) => {
          e.username = (await core.resolveUsername(e.wallet)) || null; // on-chain pass name (usually null for the play address)
          const ow = agentOwner.get(e.wallet);
          e.owner = ow ? { wallet: ow, username: (await core.resolveUsername(ow)) || null } : null;
        }));
        // The agent's display name lives in GoodAgents' partner data, keyed by
        // owner (one agent per owner). Fill it in where the on-chain pass name
        // was empty, so the board shows the agent's name, not a raw address.
        const owners = [...new Set(agent.map((e) => e.owner?.wallet).filter(Boolean))];
        const nameByOwner = new Map();
        await Promise.all(owners.map(async (ow) => {
          try {
            const r = await fetch(`https://goodagentids.xyz/host/partners/gamearena/agents?owner=${ow}`);
            if (!r.ok) return;
            const j = await r.json();
            const a = (j.agents || [])[0];
            if (a?.displayName) nameByOwner.set(ow, a.displayName);
          } catch { /* partner down · fall back to short address */ }
        }));
        agent.forEach((e, i) => {
          if (!e.username && e.owner && nameByOwner.has(e.owner.wallet)) e.username = nameByOwner.get(e.owner.wallet);
          e.rank = i + 1;
        });
      } catch (e) { lanesComplete = false; console.warn('cup agent lane:', e?.message || e); }

      const byPlayer = new Map(); // wallet -> { best:{gt:score}, days:Set }
      for (const r of rows) {
        const w = r.player?.id?.toLowerCase();
        if (!w || agentSet.has(w)) continue; // bots never enter the Human ladder
        let p = byPlayer.get(w);
        if (!p) { p = { best: {}, days: new Set() }; byPlayer.set(w, p); }
        const gt = Number(r.gameType), sc = Number(r.score);
        if (CUP_DIVISOR[gt] !== undefined && (!(gt in p.best) || sc > p.best[gt])) p.best[gt] = sc;
        p.days.add(new Date(Number(r.blockTimestamp) * 1000).toISOString().slice(0, 10));
      }
      const wallets = Array.from(byPlayer.keys());
      const vflags = await core.mapLimit(wallets, 12, (w) => core.isVerified(w));
      const verifiedSet = new Set();
      wallets.forEach((w, i) => { byPlayer.get(w).verified = !!vflags[i]; if (vflags[i]) verifiedSet.add(w); });

      // ── G$ spend lane (arena_purchases, windowed) · √ curve, uncapped ──
      const spendByWallet = new Map();
      try {
        const { data: buys, error: buysErr } = await core.supabase.from('arena_purchases')
          .select('wallet, amount_wei').gte('created_at', startIso).lt('created_at', endIso);
        if (buysErr) { lanesComplete = false; throw buysErr; }
        for (const b of buys || []) {
          const w = b.wallet?.toLowerCase(); if (!w) continue;
          spendByWallet.set(w, (spendByWallet.get(w) || 0) + Number(b.amount_wei) / 1e18);
        }
      } catch (e) { lanesComplete = false; console.warn('cup spend lane:', e?.message || e); }

      // ── Referral lane (season_v1_referrer_intent) ──
      // The referral link lives in season_v1_referrer_intent — set when a friend
      // enters your code — which is the SAME table the passport counts. The old
      // code read season_v1_players.referrer_wallet, a near-dead table (3 rows vs
      // 20 real referrals), so EVERY player showed 0 referral points all Cup.
      // Rule is unchanged: a referral counts only when the referred friend is
      // verified AND played in-window (byPlayer is already window-scoped).
      const refByWallet = new Map();
      try {
        const { data: intents, error: intentsErr } = await core.supabase.from('season_v1_referrer_intent')
          .select('wallet, referrer_wallet')
          .lte('set_at', endIso) // only referrals made on/before the deadline count
          .limit(10000);
        if (intentsErr) { lanesComplete = false; throw intentsErr; }
        for (const j of intents || []) {
          const ref = j.referrer_wallet?.toLowerCase();
          const referred = j.wallet?.toLowerCase();
          if (!ref || !referred) continue;
          if (verifiedSet.has(referred) && byPlayer.has(referred)) {
            refByWallet.set(ref, (refByWallet.get(ref) || 0) + 1);
          }
        }
      } catch (e) { lanesComplete = false; console.warn('cup referral lane:', e?.message || e); }

      // ── Human Cup Points ──
      const entries = wallets.map((w) => {
        const p = byPlayer.get(w);
        const skill = Object.entries(p.best).reduce((s, [gt, sc]) => s + Math.floor(sc / (CUP_DIVISOR[gt] || 20)), 0);
        const consist = Math.min(14, p.days.size);
        const referrals = refByWallet.get(w) || 0;
        const spendG = spendByWallet.get(w) || 0;
        const spendPts = Math.min(CUP.maxSpendPts, Math.round(CUP.kSpend * Math.sqrt(spendG)));
        const cupPoints = Math.round(
          CUP.weights.skill * skill + CUP.weights.consist * consist +
          CUP.weights.ref * referrals + CUP.weights.spend * spendPts,
        );
        return { wallet: w, verified: p.verified, lanes: { skill, consist, referrals, spendG: Math.round(spendG), spendPts }, cupPoints };
      });
      // Rank the whole field by POINTS — what players expect. Verified is only a
      // prize-eligibility flag (see prizeRank below), NOT a sort key: sinking an
      // 87-pt unverified player beneath a 14-pt verified one read as a broken
      // board. Verified breaks exact ties so an eligible player edges a twin.
      entries.sort((a, b) => (b.cupPoints - a.cupPoints) || (Number(b.verified) - Number(a.verified)));
      entries.forEach((e, i) => { e.rank = i + 1; }); // display rank over the whole field
      // Prize rank: position among verified players only, in points order. The
      // podium and $ prizes use THIS, so the list can rank by points while the
      // prize race stays verified-only. null = not eligible until they verify.
      let pr = 0;
      entries.forEach((e) => { e.prizeRank = e.verified ? (++pr) : null; });
      const top = entries.slice(0, 50);
      await Promise.all(top.map(async (e) => { e.username = (await core.resolveUsername(e.wallet)) || null; }));
      // Lightweight full-field lookup so a player outside the top 50 can still be
      // shown their own rank (the "Your rank" card) instead of a misleading
      // "you're not on the board" message.
      const humanAll = entries.map((e) => ({ wallet: e.wallet, cupPoints: e.cupPoints, rank: e.rank, verified: e.verified, prizeRank: e.prizeRank }));

      // ── Crowns (separate ladders so one strength can't sweep the board) ──
      const vEntries = entries.filter((e) => e.verified);
      const connectorE = [...vEntries].sort((a, b) => b.lanes.referrals - a.lanes.referrals)[0];
      const streakE    = [...vEntries].sort((a, b) => b.lanes.consist - a.lanes.consist)[0];
      const crowns = {
        connector: connectorE && connectorE.lanes.referrals > 0
          ? { wallet: connectorE.wallet, username: (await core.resolveUsername(connectorE.wallet)) || null, referrals: connectorE.lanes.referrals } : null,
        streak: streakE && streakE.lanes.consist > 0
          ? { wallet: streakE.wallet, username: (await core.resolveUsername(streakE.wallet)) || null, days: streakE.lanes.consist } : null,
      };

      // ── Community pot (total on-chain plays → bonus G$ milestones) ──
      // rows.length is every on-chain game play in the window (agent Challenge
      // AI matches included), so we count it once here — no double-count.
      const totalPlays = rows.length;
      const agentMatches = agent.reduce((s, a) => s + a.matches, 0);
      const bonusG = CUP.potMilestones.filter((m) => totalPlays >= m.at).reduce((s, m) => s + m.bonusG, 0);
      const next = CUP.potMilestones.find((m) => totalPlays < m.at) || null;

      payload = {
        human: top, humanAll, agent, crowns,
        pot: { plays: totalPlays, agentMatches, bonusG, next, milestones: CUP.potMilestones,
               humanPlayers: humanAll.length, agents: agent.length },
      };
      // Ended → freeze permanently, but ONLY if every Supabase lane succeeded.
      // A partial board (agent/referral read timed out on a cold start) must not
      // be frozen — short-cache it and let the next call retry until it's clean,
      // then freeze the correct final board. Live → 5-min cache (was 60s), ~5x
      // less egress since the agent lane pages the whole matches table.
      if (phase === 'ended') {
        if (lanesComplete) cupFrozenPayload = payload;
        else core.cacheSet('cup:payload', payload, 15_000); // incomplete → retry soon
      } else {
        core.cacheSet('cup:payload', payload, 300_000);
      }
    } catch (e) {
      console.warn('cup failed:', e?.message || e);
      payload = { human: [], agent: [], crowns: { connector: null, streak: null }, pot: null };
    }
  }

  const meWallet = (req.query.wallet || '').toString().toLowerCase();
  let me = meWallet ? (payload.human.find((e) => e.wallet === meWallet) || null) : null;
  // Outside the top 50 but still ranked → surface their own row with a username.
  if (!me && meWallet && Array.isArray(payload.humanAll)) {
    const row = payload.humanAll.find((e) => e.wallet === meWallet);
    if (row) me = { ...row, username: (await core.resolveUsername(row.wallet)) || null };
  }

  // humanAll is an internal lookup, not for the wire.
  const { humanAll: _all, ...pub } = payload;
  res.json({
    phase, startsAt: CUP.startsAt, endsAt: CUP.endsAt,
    weights: CUP.weights, humanSplit: CUP.humanSplit, agentSplit: CUP.agentSplit,
    ...pub, me,
  });
});
},

// ── Cup deadline cron ──
function* (core) {
  Object.defineProperties(core, {
    sendCupDeadlineWarnings: { get: () => sendCupDeadlineWarnings, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Cup deadline cron ───────────────────────────────────────────────────────
// Fires every 15 min during a cup window. ~1 hour before cup ends, sends
// one notification per cup per player to anyone who has played at least
// once but isn't already top-N qualified. Encourages a final push.
async function sendCupDeadlineWarnings() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    // Only fire while in the 60-minute pre-end window
    const minsLeft = Math.floor((core.CHALLENGE_END - nowSec) / 60);
    if (minsLeft <= 0 || minsLeft > 60) return;
    if (nowSec < core.CHALLENGE_START) return;

    // Pull current cup standings via the existing cache path
    const { ranked } = core.challengeCache.at && Date.now() - core.challengeCache.at < core.CHALLENGE_CACHE_TTL_MS
      ? core.challengeCache
      : await core.rebuildChallengeCache();
    if (!ranked || ranked.length === 0) return;

    const totalPool = core.CHALLENGE_TOP_N * core.CHALLENGE_PRIZE_USDC;
    let sent = 0;
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      const rank = i + 1;
      // Only ping people in striking distance — top 20 for the cup, not deep tail
      if (rank > 20) break;
      const payload = core.push.cupDeadlineNotification(rank, core.CHALLENGE_TOP_N, totalPool);
      const ok = await core.push.sendToWallet(core.supabase, r.wallet, 'cup_deadline', payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🏆 Cup deadline pings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('cup deadline cron failed:', e?.message || e);
  }
}
},

// ── Cup-starting cron ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── Cup-starting cron ───────────────────────────────────────────────────────
// Fires twice per cup window: ~24h before CHALLENGE_START and ~1h before.
// Targets every subscribed wallet (respects reengagement mute since cup
// announcements are promo-grade). Cron runs every 15 min so both 60-minute
// firing windows are reliably caught. notification_log dedup keyed by
// (wallet, category, sent_on=today) keeps each player from getting two
// 24h pings on the same day — the 1h ping lands on cup-day so it gets a
// fresh log row.
async function sendCupStartingPings() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const secsToStart = core.CHALLENGE_START - nowSec;
    // 24h window: (23h, 24h] before start
    const in24hWindow = secsToStart > 23 * 3600 && secsToStart <= 24 * 3600;
    // 1h window: (0, 1h] before start
    const in1hWindow  = secsToStart > 0          && secsToStart <= 3600;
    if (!in24hWindow && !in1hWindow) return;

    const totalPool = core.CHALLENGE_TOP_N * core.CHALLENGE_PRIZE_USDC;
    const durationHours = Math.round((core.CHALLENGE_END - core.CHALLENGE_START) / 3600);
    const payload = in24hWindow
      ? core.push.cupStarting24hNotification(core.CHALLENGE_NAME, totalPool, durationHours)
      : core.push.cupStarting1hNotification(core.CHALLENGE_NAME, totalPool);
    const category = in24hWindow
      ? `cup_start_24h_${core.CHALLENGE_ID}`
      : `cup_start_1h_${core.CHALLENGE_ID}`;

    // Unique wallets across all subscriptions
    const { data: subs } = await core.supabase
      .from('push_subscriptions')
      .select('wallet_address');
    const wallets = [...new Set((subs || []).map(s => s.wallet_address))];
    if (wallets.length === 0) return;

    // Honor reengagement mute (same toggle the broadcast endpoint respects)
    const { data: prefs } = await core.supabase
      .from('notification_prefs')
      .select('wallet_address, reengagement');
    const muted = new Set((prefs || []).filter(p => p.reengagement === false).map(p => p.wallet_address));

    let sent = 0;
    for (const w of wallets) {
      if (muted.has(w)) continue;
      const ok = await core.push.sendToWallet(core.supabase, w, category, payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🏁 Cup-starting (${in24hWindow ? '24h' : '1h'}) pings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('cup-starting cron failed:', e?.message || e);
  }
}

core.jobs.every('sendCupStartingPings', 15 * 60 * 1000, sendCupStartingPings);
},

];
