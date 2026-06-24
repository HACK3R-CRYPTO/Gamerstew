// Web Push helper. Sends notifications, manages subscriptions, owns the
// pet-voice copy library so the backend speaks consistently across all
// notification triggers.
//
// Pattern lifted from Duolingo + top mobile games:
//   - Streak loss aversion as the primary engagement loop
//   - Pet-as-narrator (the slime says it, not "GameArena: ...")
//   - Once-per-day cap per category (notification_log primary key enforces it)
//   - Pet stage adapts the voice (egg vs king slime)

const webpush = require('web-push');

// Single source of truth for player-facing game names. Mirrors the
// GAME_LABEL map in server.js · adding a new game means one line here,
// every notification template picks it up automatically. Previously each
// template had its own `game === 'rhythm' ? 'Rhythm Rush' : 'Simon Memory'`
// ternary which silently mislabeled Stack Tower scores as Simon Memory.
const GAME_LABEL = {
  rhythm: 'Rhythm Rush',
  simon:  'Simon Memory',
  stack:  'Stack Tower',
};
function gameLabelOf(game) {
  return GAME_LABEL[game] || game;
}

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_CONTACT = process.env.VAPID_CONTACT_EMAIL || 'mailto:notify@gamearenahq.xyz';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ─── Pet voice library ───────────────────────────────────────────────────────
// Pet evolves with player level (matches /frontend/app/profile/page.tsx).
// We pick the voice that matches their current stage so the notification
// reads as if it's from the player's actual pet, not generic copy.
function petStage(level) {
  if (level >= 50) return 'king';
  if (level >= 30) return 'crystal';
  if (level >= 15) return 'teen';
  if (level >= 5)  return 'baby';
  return 'egg';
}

// Streak warning copy by stage. Each variant uses loss aversion + the pet's
// personality. Player's actual streak count goes in the body for personalization.
const STREAK_COPY = {
  egg: {
    title: '🥚 Your egg is shaking',
    body: (s) => `${s}-day streak ends in a few hours. One round keeps it alive.`,
  },
  baby: {
    title: '🟢 Your slime is sad',
    body: (s) => `Your ${s}-day streak ends soon. Just one round to keep going.`,
  },
  teen: {
    title: '🟣 The forest is quiet',
    body: (s) => `${s} days strong. Don't lose it now — play one round.`,
  },
  crystal: {
    title: '💎 Your crystal is dimming',
    body: (s) => `${s}-day streak about to break. One round saves it.`,
  },
  king: {
    title: '👑 A king without games is just a slime',
    body: (s) => `${s}-day streak ends in a few hours. Defend the throne.`,
  },
};

function streakNotification(stage, streakDays) {
  const c = STREAK_COPY[stage] || STREAK_COPY.baby;
  return {
    title: c.title,
    body: c.body(streakDays),
    tag: `streak-warning-${new Date().toISOString().slice(0,10)}`,
    url: '/games',
    requireInteraction: true,
  };
}

// Cup deadline reminder — fires roughly 1 hour before the cup ends.
// Personalized with the player's current standing relative to the prize line.
function cupDeadlineNotification(rank, qualifyAt, totalPrizePool) {
  if (rank > 0 && rank <= qualifyAt) {
    return {
      title: '🏆 You\'re in the prize zone',
      body: `1 hour left. Hold #${rank} or climb — $${totalPrizePool} pool.`,
      tag: 'cup-deadline',
      url: '/leaderboard',
      requireInteraction: true,
    };
  }
  return {
    title: '🏆 1 hour left to qualify',
    body: rank > 0
      ? `You're #${rank}. Push past #${qualifyAt} to win — $${totalPrizePool} pool.`
      : `Last chance to qualify. $${totalPrizePool} pool.`,
    tag: 'cup-deadline',
    url: '/leaderboard',
    requireInteraction: true,
  };
}

// Rank change — someone just bumped you off a podium spot. Only fires for
// top-3 displacement because that's the emotionally significant moment.
function rankChangeNotification(opponent, newRank, game) {
  const gameLabel = gameLabelOf(game);
  const placeMedal = newRank === 4 ? '🥉→4️⃣' : newRank === 3 ? '🥈→🥉' : '🥇→🥈';
  return {
    title: `📉 You dropped to #${newRank}`,
    body: `${opponent} just passed you on ${gameLabel}. Take it back? ${placeMedal}`,
    tag: `rank-change-${game}-${new Date().toISOString().slice(0,10)}`,
    url: `/leaderboard?game=${game}`,
  };
}

// "You're being chased" — sent to the higher-ranked player when an opponent
// is close behind. Defensive loss aversion. Fires when the gap shrinks
// inside a threshold but BEFORE displacement actually happens.
function rankChasingNotification(opponentName, gap, yourRank, game) {
  const gameLabel = gameLabelOf(game);
  return {
    title: `⚠️ Someone's coming for #${yourRank}`,
    body: `${opponentName} is just ${gap.toLocaleString()} pts behind you on ${gameLabel}. Defend it.`,
    tag: `close-rank-chase-${game}-${new Date().toISOString().slice(0,10)}`,
    url: `/leaderboard?game=${game}`,
    requireInteraction: true,
  };
}

// "You're 1 point away from #N" — sent to the lower-ranked player when
// they're close to climbing. Offensive call-to-action.
function rankClimbingNotification(targetName, gap, targetRank, game) {
  const gameLabel = gameLabelOf(game);
  return {
    title: `🎯 ${gap.toLocaleString()} pts from #${targetRank}`,
    body: `Take ${targetName}'s spot on ${gameLabel}. One round could do it.`,
    tag: `close-rank-climb-${game}-${new Date().toISOString().slice(0,10)}`,
    url: `/leaderboard?game=${game}`,
    requireInteraction: true,
  };
}

// Achievement unlocked — fired inline from submit-score, not via cron.
function achievementNotification(name, icon) {
  return {
    title: `${icon || '🏆'} Achievement unlocked`,
    body: `${name}`,
    tag: `achievement-${name.toLowerCase().replace(/\s+/g, '-')}`,
    url: '/profile?tab=achievements',
  };
}

// Generic broadcast — admin sends "we shipped X" / "new cup is live".
// No category-specific dedup beyond the shared notification_log table.
function announcementNotification({ title, body, url, tag }) {
  return {
    title: title || '📣 GameArena update',
    body: body || '',
    url: url || '/games',
    tag: tag || `announcement-${new Date().toISOString().slice(0,10)}`,
  };
}

// ─── New trigger copy ────────────────────────────────────────────────────────

// Welcome — fired ONCE the first time a wallet subscribes. Confirms the
// permission grant worked + sets expectations so they don't immediately
// turn it off. Top retention apps all do this.
function welcomeNotification(username) {
  const name = username || 'Player';
  return {
    title: '🔔 You\'re in',
    body: `${name}, we'll only ping you when it matters — streak risk, cup deadlines, rank changes.`,
    tag: 'welcome',
    url: '/games',
  };
}

// Wager resolved — won or lost. Won path leads with the payout amount;
// lost path is gentler and turns it into a re-engagement nudge.
function wagerWonNotification(amount, gameLabel) {
  return {
    title: `🎉 You won ${amount} G$`,
    body: `${gameLabel} wager paid out. Keep the streak going?`,
    tag: `wager-won-${Date.now()}`,
    url: '/profile?tab=matches',
    requireInteraction: true,
  };
}
function wagerLostNotification(gameLabel) {
  return {
    title: '😤 Tough one',
    body: `${gameLabel} wager didn't pay. One more round to bounce back?`,
    tag: `wager-lost-${Date.now()}`,
    url: '/games',
  };
}

// New cup starting — fires twice per cup window: 24 hours out and 1 hour
// out. Different copy each time so the second feels urgent, not redundant.
function cupStarting24hNotification(name, prizePool, durationHours) {
  return {
    title: '⏰ Cup tomorrow',
    body: `${name} starts in 24h · $${prizePool} pool · ${durationHours}h to qualify.`,
    tag: `cup-start-24h`,
    url: '/leaderboard',
  };
}
function cupStarting1hNotification(name, prizePool) {
  return {
    title: '🏁 Cup starts in 1 hour',
    body: `${name} kicks off · $${prizePool} on the line · be first to qualify.`,
    tag: `cup-start-1h`,
    url: '/leaderboard',
    requireInteraction: true,
  };
}

// Season ending in 1 hour — different from cup deadline. Targets weekly
// season's badge/podium reset moment.
function seasonEndingNotification(rank) {
  if (rank > 0 && rank <= 3) {
    return {
      title: '🥇 Season ends in 1 hour',
      body: `You're #${rank} — hold for the gold/silver/bronze badge.`,
      tag: 'season-ending',
      url: '/leaderboard',
      requireInteraction: true,
    };
  }
  return {
    title: '⌛ Season ends in 1 hour',
    body: rank > 0
      ? `You're #${rank}. Last chance to climb the podium.`
      : 'Last chance to score before the season locks.',
    tag: 'season-ending',
    url: '/leaderboard',
  };
}

// Daily mission about to expire — sent 30-60 min before UTC midnight to
// players with unclaimed mission XP still on the table.
function missionExpiringNotification(unclaimedXp) {
  return {
    title: '🎯 Missions reset in 30 min',
    body: unclaimedXp > 0
      ? `Claim your ${unclaimedXp} XP before they're gone.`
      : 'Quick round? Three new missions waiting tomorrow.',
    tag: 'mission-expire',
    url: '/games',
  };
}

// Re-engagement, escalating by days lapsed. Mirrors Duolingo's escalation
// playbook: gentle nudge → stage-specific guilt-trip → "you're missing
// out" → guilt-paradox farewell. After day 14 we stay silent — we don't
// chase dead users forever.
function reengagementNotification(stage, daysLapsed, username) {
  const name = username || 'Player';
  if (daysLapsed === 1) {
    const day1 = {
      egg: '🥚 Your egg is getting cold',
      baby: '🟢 Slime is asleep',
      teen: '🟣 Forest got quieter',
      crystal: '💎 Crystal stopped glowing',
      king: '👑 The throne is empty',
    };
    return {
      title: day1[stage] || day1.baby,
      body: `${name}, quick round? Less than a minute keeps the pet alive.`,
      tag: 're-d1', url: '/games',
    };
  }
  if (daysLapsed === 3) {
    return {
      title: '⏰ 3 days away',
      body: 'Other players are climbing the leaderboard. Pick a game and jump back in.',
      tag: 're-d3', url: '/games',
    };
  }
  if (daysLapsed === 7) {
    return {
      title: '✨ A week away from GameArena',
      body: 'New cups, new players, new prizes. Come see what you missed.',
      tag: 're-d7', url: '/games',
    };
  }
  if (daysLapsed === 14) {
    // Duolingo's killer message. Permission to stop ironically pulls people back.
    return {
      title: '🥺 These reminders aren\'t working',
      body: `We'll stop bugging you, ${name}. One last round before we go quiet?`,
      tag: 're-d14', url: '/games',
      requireInteraction: true,
    };
  }
  return null;
}

// ─── Subscription management ─────────────────────────────────────────────────
async function saveSubscription(supabase, walletAddress, sub, userAgent) {
  const lower = walletAddress.toLowerCase();
  const { error } = await supabase.from('push_subscriptions').upsert({
    wallet_address: lower,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth:   sub.keys.auth,
    user_agent: userAgent || null,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  return !error;
}

async function getSubscriptions(supabase, walletAddress) {
  const { data } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('wallet_address', walletAddress.toLowerCase());
  return data || [];
}

async function deleteSubscription(supabase, endpoint) {
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// ─── Send ────────────────────────────────────────────────────────────────────
// Fires a push to all of a wallet's subscriptions. Records once-per-day in
// notification_log so the cron can't double-send. Removes dead endpoints
// (410 Gone) so the table stays clean.
async function sendToWallet(supabase, walletAddress, category, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;

  const lower = walletAddress.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);

  // De-dupe: have we already sent this category today?
  const { data: log } = await supabase
    .from('notification_log')
    .select('wallet_address')
    .eq('wallet_address', lower)
    .eq('category', category)
    .eq('sent_on', today)
    .limit(1);
  if (log && log.length > 0) return false;

  const subs = await getSubscriptions(supabase, lower);
  if (subs.length === 0) return false;

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map(s => webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      body,
    )),
  );

  // Clean up dead subscriptions
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected' && r.reason && (r.reason.statusCode === 410 || r.reason.statusCode === 404)) {
      await deleteSubscription(supabase, subs[i].endpoint);
    }
  }

  // Record send so we don't repeat today
  await supabase.from('notification_log').insert({
    wallet_address: lower,
    category,
    sent_on: today,
    payload_tag: payload.tag || null,
  });

  // Preserve the full payload in the in-app feed (notifications_feed)
  // so the bell icon can render this delivery later — including for
  // devices that weren't subscribed at send time. Fire-and-forget;
  // a failed insert here must not block the push response path.
  supabase.from('notifications_feed').insert({
    wallet_address: lower,
    category,
    title: payload.title || category,
    body: payload.body || null,
    url: payload.url || null,
    tag: payload.tag || null,
  }).then(() => {}, () => {});

  return true;
}

// Broadcast to every subscribed wallet. Used by admin POST /api/push/broadcast.
// Honors per-wallet category mute via notification_prefs.reengagement so
// players who turned off all promo can't be force-fed announcements.
async function sendBroadcast(supabase, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { sent: 0, skipped: 0 };

  // Log the broadcast ONCE (wallet_address NULL) before fanning out, so
  // even players who weren't subscribed at send-time (no push device,
  // tab not open) still see it in their bell when they next open the
  // app. One row per broadcast, every player reads it via OR filter.
  supabase.from('notifications_feed').insert({
    wallet_address: null,
    category: 'broadcast',
    title: payload.title || 'Game Arena',
    body: payload.body || null,
    url: payload.url || null,
    tag: payload.tag || null,
  }).then(() => {}, () => {});

  // Pull all subscriptions and the prefs map in parallel
  const [{ data: subs }, { data: prefs }] = await Promise.all([
    supabase.from('push_subscriptions').select('wallet_address, endpoint, p256dh, auth'),
    supabase.from('notification_prefs').select('wallet_address, reengagement'),
  ]);
  const muted = new Set((prefs || []).filter(p => p.reengagement === false).map(p => p.wallet_address));

  let sent = 0, skipped = 0;
  const dead = [];
  const body = JSON.stringify(payload);

  for (const s of (subs || [])) {
    if (muted.has(s.wallet_address)) { skipped++; continue; }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 410 || e.statusCode === 404)) dead.push(s.endpoint);
    }
  }

  // Clean dead endpoints
  if (dead.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', dead);
  }
  return { sent, skipped, cleaned: dead.length };
}

module.exports = {
  petStage,
  streakNotification,
  cupDeadlineNotification,
  rankChangeNotification,
  rankChasingNotification,
  rankClimbingNotification,
  reengagementNotification,
  achievementNotification,
  announcementNotification,
  welcomeNotification,
  wagerWonNotification,
  wagerLostNotification,
  cupStarting24hNotification,
  cupStarting1hNotification,
  seasonEndingNotification,
  missionExpiringNotification,
  saveSubscription,
  getSubscriptions,
  deleteSubscription,
  sendToWallet,
  sendBroadcast,
};
