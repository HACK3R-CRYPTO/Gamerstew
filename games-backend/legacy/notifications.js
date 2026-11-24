// ─── notifications ────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── Web Push Notifications ──
function* (core) {
  Object.defineProperties(core, {
    push: { get: () => push, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Web Push Notifications ──────────────────────────────────────────────────
// Duolingo-style engagement: streak warnings (loss aversion), cup deadlines,
// re-engagement after lapse. Pet-as-narrator copy lives in lib/push.js.
const push = require('../lib/push');

// Public VAPID key for the frontend to subscribe with.
core.app.get('/api/push/vapid-key', (_, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// Player subscribes — body: { walletAddress, subscription: { endpoint, keys } }.
// On the wallet's FIRST subscription ever, fires a one-time welcome ping so
// they get an instant payoff for granting permission. Re-subscribes on new
// devices stay silent (zero existing rows = first; any rows = returning).
// SECURITY (2026-07-17 audit): these three had NO auth. The CORS origin check
// is not authentication · any script can forge an Origin header, so they were
// world-writable: register a subscription against any wallet, kill any player's
// subscription by endpoint, or flip any player's notification prefs. They now
// go through server actions (frontend/app/actions/push.ts) and demand the
// secret like every other write.
core.app.post('/api/push/subscribe', core.requireSecret, async (req, res) => {
  const { walletAddress, subscription } = req.body || {};
  if (!walletAddress || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: 'Invalid address' });
  }

  // Has this wallet ever subscribed before? Check before save so a fresh
  // wallet with zero rows is unambiguous.
  const lower = walletAddress.toLowerCase();
  const { data: existing } = await core.supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('wallet_address', lower)
    .limit(1);
  const isFirstSubscription = !existing || existing.length === 0;

  const ok = await push.saveSubscription(core.supabase, walletAddress, subscription, req.headers['user-agent']);
  if (!ok) return res.status(500).json({ error: 'Save failed' });

  // Fire welcome only on first-ever subscription. Async so the HTTP
  // response isn't blocked by a slow web push round-trip.
  if (isFirstSubscription) {
    (async () => {
      try {
        const username = await core.resolveUsername(walletAddress);
        const payload = push.welcomeNotification(username);
        await push.sendToWallet(core.supabase, walletAddress, 'welcome', payload);
      } catch (e) {
        console.warn('welcome ping failed:', e.message);
      }
    })();
  }

  res.json({ success: true });
});

// Player unsubscribes a specific endpoint.
core.app.post('/api/push/unsubscribe', core.requireSecret, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  await push.deleteSubscription(core.supabase, endpoint);
  res.json({ success: true });
});

// Notification preferences — players can mute categories.
core.app.get('/api/push/prefs/:address', async (req, res) => {
  const addr = req.params.address.toLowerCase();
  const { data } = await core.supabase
    .from('notification_prefs')
    .select('streak_warnings, cup_deadlines, rank_changes, reengagement')
    .eq('wallet_address', addr)
    .limit(1);
  res.json(data?.[0] || {
    streak_warnings: true, cup_deadlines: true, rank_changes: true, reengagement: true,
  });
});

core.app.post('/api/push/prefs', core.requireSecret, async (req, res) => {
  const { walletAddress, streak_warnings, cup_deadlines, rank_changes, reengagement } = req.body || {};
  if (!walletAddress) return res.status(400).json({ error: 'Missing walletAddress' });
  await core.supabase.from('notification_prefs').upsert({
    wallet_address: walletAddress.toLowerCase(),
    streak_warnings: !!streak_warnings,
    cup_deadlines:   !!cup_deadlines,
    rank_changes:    !!rank_changes,
    reengagement:    !!reengagement,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'wallet_address' });
  res.json({ success: true });
});

// ─── Admin broadcast — game updates / new feature announcements ─────────────
// Protected with INTERNAL_SECRET so only the team can call it. Honors
// per-wallet reengagement mute so players who muted promos stay quiet.
//
// Example:
//   curl -X POST https://.../api/push/broadcast \
//     -H "x-internal-secret: $INTERNAL_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"title":"🏆 New Cup Live","body":"$10 pool, 72hr","url":"/leaderboard"}'
core.app.post('/api/push/broadcast', core.requireSecret, async (req, res) => {
  const { title, body, url, tag } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  const payload = push.announcementNotification({ title, body, url, tag });
  const result = await push.sendBroadcast(core.supabase, payload);
  console.log(`📣 Broadcast: sent ${result.sent}, skipped (muted) ${result.skipped}, cleaned ${result.cleaned}`);
  res.json({ success: true, ...result });
});
},

// ── Rank change — top-3 displacement only ──
function* (core) {
  Object.defineProperties(core, {
    notifyRankDisplacement: { get: () => notifyRankDisplacement, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── Rank change — top-3 displacement only ──────────────────────────────────
// Called inline from /api/submit-score after a new score lands. Compares
// the leaderboard before and after the new entry: if someone got bumped
// off a top-3 spot, ping them. We only fire for podium displacement since
// that's the emotionally meaningful moment — not bumping someone from #47
// to #48.
async function notifyRankDisplacement(game, submitterAddr, leaderboardBefore, leaderboardAfter) {
  try {
    if (!leaderboardBefore || leaderboardBefore.length === 0) return;
    if (!leaderboardAfter || leaderboardAfter.length === 0) return;

    // Find players who were in top-3 before AND no longer in top-3 after
    const beforeTop3 = leaderboardBefore.slice(0, 3).map(e => e.wallet_address?.toLowerCase());
    const afterTop3 = new Set(leaderboardAfter.slice(0, 3).map(e => e.wallet_address?.toLowerCase()));

    for (const wallet of beforeTop3) {
      if (!wallet) continue;
      if (afterTop3.has(wallet)) continue;             // still top-3, no displacement
      if (wallet === submitterAddr.toLowerCase()) continue; // skip the submitter

      // Find their new rank (or absent → fall to #4)
      const newIdx = leaderboardAfter.findIndex(e => e.wallet_address?.toLowerCase() === wallet);
      const newRank = newIdx >= 0 ? newIdx + 1 : 4;

      const submitterName = await core.resolveUsername(submitterAddr) || 'Someone';
      const payload = core.push.rankChangeNotification(submitterName, newRank, game);
      await core.push.sendToWallet(core.supabase, wallet, 'rank_change', payload);
    }
  } catch (e) {
    console.warn('rank displacement notify failed:', e?.message || e);
  }
}

// ─── Streak warning cron ─────────────────────────────────────────────────────
// Fires every hour. Finds players with active streaks who haven't played
// today, sends one notification per day per player, pet-stage aware copy.
async function sendStreakWarnings() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Pull active streakers who haven't played today and have streak >= 1
    const { data: candidates } = await core.supabase
      .from('users')
      .select('wallet_address, play_streak, xp, last_play_date')
      .gte('play_streak', 1)
      .neq('last_play_date', today);

    if (!candidates || candidates.length === 0) return;

    let sent = 0;
    for (const u of candidates) {
      // Skip if user opted out of streak warnings
      const { data: prefs } = await core.supabase
        .from('notification_prefs')
        .select('streak_warnings')
        .eq('wallet_address', u.wallet_address)
        .limit(1);
      if (prefs && prefs[0] && prefs[0].streak_warnings === false) continue;

      const stage = core.push.petStage(core.levelFromXp(u.xp || 0));
      const payload = core.push.streakNotification(stage, u.play_streak);
      const ok = await core.push.sendToWallet(core.supabase, u.wallet_address, 'streak_warning', payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🔔 Streak warnings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('streak warning cron failed:', e?.message || e);
  }
}

// Run every hour. Cheap query; subscriptions are sparse early on.
core.jobs.every('sendStreakWarnings', 60 * 60 * 1000, sendStreakWarnings);
// Cup deadline cron — every 15 min so the 1-hour-before-end window is always caught
core.jobs.every('sendCupDeadlineWarnings', 15 * 60 * 1000, core.sendCupDeadlineWarnings);

// ─── Close-rank cron — predictive "you're about to be passed" / "1 point
//     away from #N" pings. Fires hourly. Scans top-5 of each game; for any
//     adjacent pair whose gap is small (under 10% of the higher score, or
//     under 1000 absolute pts, whichever is larger), sends:
//       · "Someone's coming for your #N" to the higher-ranked player
//       · "X pts from #N" to the lower-ranked player
//     Once-per-day dedup per game per direction so the same pair doesn't
//     ping repeatedly. Top-5 only — we don't ping deep-tail churn.
async function sendCloseRankPings() {
  try {
    const seasonStart = core.SEASON_EPOCH + (core.currentSeasonNumber() - 1) * core.SEASON_DAYS * 86400;
    for (const game of core.VALID_GAMES) {
      const gameTypeInt = core.GAME_TYPE[game];
      let board = [];
      try {
        board = await core.subgraph.leaderboard(gameTypeInt, seasonStart, 5);
      } catch (_) { continue; }
      if (!board || board.length < 2) continue;

      for (let i = 0; i < board.length - 1; i++) {
        const higher = board[i];
        const lower  = board[i + 1];
        if (!higher?.wallet_address || !lower?.wallet_address) continue;
        const gap = higher.score - lower.score;
        if (gap <= 0) continue;
        // Threshold: smaller of (10% of higher score) or 1000 pts. Means
        // tight pairs always trigger; massive blowouts never do.
        const threshold = Math.max(1000, Math.floor(higher.score * 0.10));
        if (gap > threshold) continue;

        // Resolve usernames once for both sides
        const higherName = higher.username || (await core.resolveUsername(higher.wallet_address)) || 'Someone';
        const lowerName  = lower.username  || (await core.resolveUsername(lower.wallet_address))  || 'Someone';

        // Higher player gets the chase warning
        const chasePayload = core.push.rankChasingNotification(lowerName, gap, i + 1, game);
        core.push.sendToWallet(core.supabase, higher.wallet_address, `close_rank_chase_${game}`, chasePayload).catch(() => {});

        // Lower player gets the climb call-to-action
        const climbPayload = core.push.rankClimbingNotification(higherName, gap, i + 1, game);
        core.push.sendToWallet(core.supabase, lower.wallet_address, `close_rank_climb_${game}`, climbPayload).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('close-rank cron failed:', e?.message || e);
  }
}

core.jobs.every('sendCloseRankPings', 60 * 60 * 1000, sendCloseRankPings);
},

// ── Mission-expiring cron ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── Mission-expiring cron ───────────────────────────────────────────────────
// Fires every 15 min. In the (30, 60] minute window before UTC midnight,
// pings any subscribed player who still has unclaimed mission XP on the
// table for today. Sums XP from completed-but-unclaimed AND incomplete
// missions (incomplete are still earnable in that window). Once-per-day
// dedup via notification_log so the cron's repeated ticks don't spam.
async function sendMissionExpiringPings() {
  try {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const minsToMidnight = Math.floor((tomorrow.getTime() - now.getTime()) / 60000);
    if (minsToMidnight <= 30 || minsToMidnight > 60) return;

    const today = now.toISOString().slice(0, 10);

    // Pull today's missions where the player still has XP on the table
    const { data: rows } = await core.supabase
      .from('daily_missions')
      .select('wallet, reward_xp, completed, claimed')
      .eq('date', today)
      .eq('claimed', false);
    if (!rows || rows.length === 0) return;

    // Sum unclaimed XP per wallet (only completed missions count as earned-
    // but-unclaimed — incomplete ones are quick reminders, XP shown as 0)
    const earned = new Map();
    const hasIncomplete = new Map();
    for (const r of rows) {
      if (r.completed) earned.set(r.wallet, (earned.get(r.wallet) || 0) + (r.reward_xp || 0));
      else hasIncomplete.set(r.wallet, true);
    }

    // Limit to subscribed wallets only — no point querying for non-subscribers
    const { data: subs } = await core.supabase
      .from('push_subscriptions')
      .select('wallet_address');
    const subscribed = new Set((subs || []).map(s => s.wallet_address));
    if (subscribed.size === 0) return;

    let sent = 0;
    const candidates = new Set([...earned.keys(), ...hasIncomplete.keys()]);
    for (const wallet of candidates) {
      if (!subscribed.has(wallet)) continue;
      const unclaimedXp = earned.get(wallet) || 0;
      const payload = core.push.missionExpiringNotification(unclaimedXp);
      const ok = await core.push.sendToWallet(core.supabase, wallet, 'mission_expire', payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`🎯 Mission-expiring pings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('mission-expiring cron failed:', e?.message || e);
  }
}

core.jobs.every('sendMissionExpiringPings', 15 * 60 * 1000, sendMissionExpiringPings);

// ─── Daily G$ claim reminder ─────────────────────────────────────────────────
// Fires every hour. In the window 9:00-10:00 WAT (= 08:00-09:00 UTC), sends
// one push per day to all subscribed wallets. Simple "claim your daily G$"
// nudge — we don't check on-chain entitlement per wallet (expensive) so we
// send to everyone. Players who aren't verified or already claimed just open
// the app and see the "Claimed today" state. Once-per-day dedup via
// notification_log prevents repeat fires.
async function sendDailyClaimPings() {
  try {
    const hour = new Date().getUTCHours();
    // Fire once in the 08:00-09:00 UTC window (9-10am WAT / Lagos)
    if (hour !== 8) return;

    const { data: subs } = await core.supabase
      .from('push_subscriptions')
      .select('wallet_address');
    if (!subs || subs.length === 0) return;

    const wallets = [...new Set(subs.map(s => s.wallet_address))];
    let sent = 0;
    for (const w of wallets) {
      const payload = {
        title: '💰 Daily G$ ready',
        body: 'Open GameArena and claim your GoodDollar. It only takes a tap.',
        tag: 'daily-g-claim',
        url: '/profile',
      };
      const ok = await core.push.sendToWallet(core.supabase, w, 'daily_g_claim', payload);
      if (ok) sent++;
    }
    if (sent > 0) console.log(`💰 Daily G$ claim pings sent to ${sent} wallets`);
  } catch (e) {
    console.warn('daily claim ping cron failed:', e?.message || e);
  }
}
core.jobs.every('sendDailyClaimPings', 60 * 60 * 1000, sendDailyClaimPings);
},

// ── Re-engagement cron — lapsed-user pings ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── Re-engagement cron — lapsed-user pings ──────────────────────────────────
// Runs every 6 hours. Targets users who last played exactly 1, 3, 7, or 14
// days ago (Duolingo escalation pattern). Once-per-day dedup via
// notification_log so a player can't get pinged twice in one day. After
// day 14 we stay silent — no chasing dead users.
async function sendReengagementPings() {
  try {
    const days = [1, 3, 7, 14];
    let totalSent = 0;
    for (const d of days) {
      const target = new Date(Date.now() - d * 86400 * 1000).toISOString().slice(0, 10);
      const { data: candidates } = await core.supabase
        .from('users')
        .select('wallet_address, xp, last_play_date')
        .eq('last_play_date', target)
        .limit(500);
      if (!candidates || candidates.length === 0) continue;

      for (const u of candidates) {
        // Honor reengagement mute
        const { data: prefs } = await core.supabase
          .from('notification_prefs')
          .select('reengagement')
          .eq('wallet_address', u.wallet_address)
          .limit(1);
        if (prefs && prefs[0] && prefs[0].reengagement === false) continue;

        const stage = core.push.petStage(core.levelFromXp(u.xp || 0));
        // Resolve username for personalization (cached after first lookup)
        const username = await core.resolveUsername(u.wallet_address);
        const payload = core.push.reengagementNotification(stage, d, username);
        if (!payload) continue;
        const ok = await core.push.sendToWallet(core.supabase, u.wallet_address, `reengagement_d${d}`, payload);
        if (ok) totalSent++;
      }
    }
    if (totalSent > 0) console.log(`💤 Re-engagement pings sent to ${totalSent} lapsed wallets`);
  } catch (e) {
    console.warn('reengagement cron failed:', e?.message || e);
  }
}

// Run on startup + every 6 hours so all four lapse buckets get covered each day.
sendReengagementPings();
core.jobs.every('sendReengagementPings', 6 * 60 * 60 * 1000, sendReengagementPings);

// Seal seasons on startup and every hour
core.sealCompletedSeasons();
core.jobs.every('sealCompletedSeasons', 60 * 60 * 1000, core.sealCompletedSeasons);

// Index chain scores on startup then every 5 min
core.indexOnChainScores();
core.jobs.every('indexOnChainScores', 5 * 60 * 1000, core.indexOnChainScores);

// Duel Rooms (P2) · create/join happen on-chain from the player's own wallet;
// this module mirrors rooms for the hub and lets the validator resolve payouts.
require('../lib/duelRooms').registerDuelRoutes(core.app, { supabase: core.supabase, provider: core.provider, validator: core.validator, isVerified: core.isVerified, requireSecret: core.requireSecret });

// Street Strike online rooms · a free friend lane. In memory, no chain, no stakes.
core.platform.registerStrikeRoutes(core.app, { requireSecret: core.requireSecret });
// The inbox: read, delete and announcements, remembered per player (src/modules/inbox).
core.platform.registerInboxRoutes(core.app, { inbox: core.platform.createInbox({ store: core.platform.supabaseInbox(core.supabase) }), requireSecret: core.requireSecret });
// Friend rooms for any game (src/modules/rooms).
core.platform.registerRoomRoutes(core.app, { requireSecret: core.requireSecret });

// Which routes are slow, and how slow (median, tail, failures). Internal only.
// What is configured, by group. Secrets show only as set or unset.
core.app.get('/internal/config', core.requireSecret, (_req, res) => res.json({ ...core.platform.checkEnv(), settings: core.platform.describeEnv() }));
core.app.get('/internal/metrics', core.requireSecret, async (_req, res) => res.json({ outbox: core.outboxOn() ? await core.outbox.status().catch(() => ({ unreadable: true })) : { on: false }, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), routes: core.metrics.snapshot(), jobs: core.jobs.status() }));

// Private Sprint · read-only live board for the hand-picked roster (games 0/1/2).
require('../lib/sprint').registerSprintRoutes(core.app);

// Partner Game SDK · lets approved third-party games (e.g. BlockSlide) push scores
// onto GameArena boards + read GoodDollar verification. Inert until PARTNER_GAMES +
// PARTNER_KEY_* env are set. See lib/partner.js and /sdk.
require('../lib/partner')(core.app, { supabase: core.supabase, saveScore: core.saveScore, ethers: core.ethers, enqueueScoreWrite: core.enqueueScoreWrite, hasGamePass: core.hasGamePass, resolveUsername: core.resolveUsername });

const server = core.app.listen(core.PORT, () => {
  console.log(`🎮 Games backend on http://localhost:${core.PORT} — Season ${core.currentSeasonNumber()}`);
  // Surface whether on-chain addresses came from env or a hardcoded fallback,
  // so a missing Railway env var is loud in the deploy logs instead of silent.
  console.log(`📍 GAME_PASS_ADDRESS:        ${process.env.GAME_PASS_ADDRESS ? 'env' : `fallback (${core.GAME_PASS_ADDR})`}`);
  console.log(`📍 SOLO_WAGER_ADDRESS:      ${process.env.SOLO_WAGER_ADDRESS ? 'env' : 'unset'}`);
  console.log(`📍 HABITAT_REGISTRY_ADDRESS: ${process.env.HABITAT_REGISTRY_ADDRESS ? 'env' : 'unset'}`);
});

// A stray rejected promise is logged instead of killing the server, and a
// redeploy lets requests in flight finish before the process exits.
// Read the finished seasons once, now, so the first visitor to the leaderboard
// does not pay for it. If it fails the first request simply does the work.
core.seasonsService.seasons().catch((e) => console.warn('seasons warm-up failed:', e?.message || e));

core.lifecycle = core.platform.installLifecycle(server, {
  graceMs: core.config.shutdownGraceMs,
  // Live-match spectators hold a stream open for the whole match. End those
  // streams when a redeploy starts, or the shutdown would wait on them.
  beforeClose: () => {
    core.jobs.stopAll(); // no new job run starts once shutdown has begun
    for (const h of core.liveMatchHub.values()) for (const res of h.clients) { try { res.end(); } catch { /* already gone */ } }
  },
});


},

];
