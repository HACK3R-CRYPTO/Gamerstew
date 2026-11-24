// ─── scores ───────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── POST /api/start-session ──
function* (core) {
  yield; // every part's shared names exist before any part runs

// ─── POST /api/start-session ───────────────────────────────────────────────
// SECURITY (2026-07-17 audit): this had NO requireSecret, so any script could
// forge an Origin header and ask the VALIDATOR KEY to sign a payload for any
// address it liked · an unauthenticated signing oracle on the same key that
// owns PerkShop and HabitatRegistry. The payload shape (`addr:ts:nonce`) meant
// it could not forge a score voucher or a tx, so impact was limited, but an
// open signing endpoint is never acceptable. Now secret-gated.
//
// NOTE: this endpoint is currently DEAD. The live score flow is
// start-game → sign-score → on-chain tx → verifyScoreTx. The "silent session"
// it issues is only read by the unreachable branch in /api/submit-score (see
// the comment there). Kept, gated, and documented rather than deleted so the
// speed-hack layer can be revived deliberately instead of by accident.
core.app.post('/api/start-session', core.requireSecret, core.gameSubmitLimiter, async (req, res) => {
  const { playerAddress } = req.body;
  if (!playerAddress) return res.status(400).json({ error: 'Missing playerAddress' });
  if (!core.validator) return res.status(500).json({ error: 'Validator not ready' });

  try {
    const timestamp = Date.now();
    const nonce = Math.floor(Math.random() * 1000000);
    // Create a deterministic payload for signing
    const payload = `${playerAddress.toLowerCase()}:${timestamp}:${nonce}`;
    const signature = await core.validator.signMessage(payload);

    res.json({
      success: true,
      session: {
        token: signature,
        playerAddress: playerAddress.toLowerCase(),
        timestamp,
        nonce
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// ─── POST /api/start-game · POST /api/sign-score ─────────────────────────────
// The path every skill-game score takes before it reaches the chain. The logic
// lives in src/modules/scores (TypeScript, tested without a database or a key):
//   rules.ts    ticket validity, score bound, ladder points
//   service.ts  start a run, decide the score, record it, submit or sign
// This file only hands it the real database, chain and replay libraries.
// ─── The chain outbox ────────────────────────────────────────────────────────
// Rules: src/modules/outbox/service.ts. Two small jobs drain it; both do nothing
// while it is switched off.
const outboxOn = () => String(process.env.SCORE_OUTBOX ?? 'false').toLowerCase() === 'true';
const outboxStore = core.platform.supabaseOutbox(core.supabase);
const batchSender = core.platform.createBatchSender({
  provider: () => core.provider,
  signer: () => core.passScoreWriter.runner,
  contract: core.GAME_PASS_ADDR,
  encode: (wallet, gameType, score) => core.passScoreWriter.interface.encodeFunctionData('recordScore', [wallet, gameType, score]),
  hasPass: (wallet) => core.passScoreWriter.hasMinted(wallet),
  serialize: (fn) => core.serializeSignerWrite(fn),
});
const outbox = core.platform.createOutbox({
  store: outboxStore,
  chain: core.platform.ethersOutboxChain({
    provider: () => core.provider,
    submitScore: (wallet, gameType, score) => core.enqueueScoreWrite(wallet, gameType, score),
    // one network call a score instead of eleven (src/modules/outbox/sender.ts)
    submitMany: (rows) => batchSender.submitMany(rows),
  }),
});
core.outbox = outbox;
core.outboxOn = outboxOn;
core.jobs.every('outboxSend', 2000, async () => { if (outboxOn()) { await outbox.sendDue(); } });
core.jobs.every('outboxConfirm', 5000, async () => { if (outboxOn()) await outbox.confirmSent(); });
// Say so, loudly and in one place, when the queue is not draining. The subgraph
// went quiet for three weeks with nothing in the logs; this must not.
core.jobs.every('outboxWatch', 60_000, async () => {
  if (!outboxOn()) return;
  const st = await outbox.status();
  if (st.outOfGas) console.error('🚨 [outbox] the sending wallet is OUT OF GAS: scores are queued, none are reaching the chain. Top it up.');
  if (st.oldestPendingMs != null && st.oldestPendingMs > 10 * 60_000) console.error(`🚨 [outbox] a score has waited ${Math.round(st.oldestPendingMs / 60000)} minutes to be sent · pending=${st.pending}`);
  if (st.failed > 0) console.warn(`⚠️  [outbox] ${st.failed} score(s) failed for good and will not reach the chain · look at chain_outbox where status = 'failed'`);
  try {
    const signer = core.validator?.address;
    if (signer && core.provider) {
      const celo = Number(core.ethers.formatEther(await core.provider.getBalance(signer)));
      if (celo < 0.5) console.error(`🚨 [outbox] the sending wallet is low on gas: ${celo.toFixed(3)} CELO left`);
    }
  } catch { /* a balance read failing is not news */ }
});

core.platform.registerScoreRoutes(core.app, {
  requireSecret: core.requireSecret,
  limiter: core.gaslessLimiter,
  gameTypes: core.GAME_TYPE,
  // The chain outbox, off unless SCORE_OUTBOX=true. Read on every request so it
  // can be switched off without a deploy.
  outbox: { enabled: () => outboxOn(), enqueue: (row) => outbox.enqueue(row) },
  // Games whose score the server cuts to what the run's log supports. A list in
  // SCORE_ENFORCE, read on every request, so it can be switched off without a
  // deploy: set SCORE_ENFORCE=none.
  enforce: (game) => String(process.env.SCORE_ENFORCE ?? 'stack,simon').split(',').map((g) => g.trim()).includes(game),
  sessions: core.platform.supabaseSessions(core.supabase),
  season: core.platform.supabaseSeason(core.supabase),
  chain: core.platform.ethersChain({
    validator: () => core.validator,       // read at request time: loaded after boot
    passContract: () => core.passContract,
    submitScore: (player, gameType, score) => core.enqueueScoreWrite(player, gameType, score),
    domain: core.BACKEND_APPROVAL_DOMAIN,
    types: core.BACKEND_APPROVAL_TYPES,
  }),
  gasless: {
    enabled: () => !!core.GASLESS_SKILL_GAMES,
    check: (player) => core.gaslessBudgetCheck(player),
    consume: (player) => core.gaslessBudgetConsume(player),
    remember: (hash) => core._rememberGaslessTx(hash),
  },
  replay: {
    rhythm: { physicsCheck: core.rhythmPhysicsCheck, isKnownSong: core.rhythmIsKnownSong, computeScore: core.rhythmComputeScore, jitterCheck: core.rhythmJitterCheck },
    stack: { computeScore: core.computeStackScore, humanness: core.computeStackHumanness },
    simon: { computeScore: core.computeSimonScore, verify: require('../lib/simonScoring').verifySimonRun },
    nepa: { computeScore: core.computeNepaScore, humanness: core.computeNepaHumanness },
  },
});

// ─── POST /api/submit-score ─────────────────────────────────────────────────
// Saves a score once it is on-chain, then hands out XP, missions, achievements,
// rank and notifications. The logic is src/modules/scores/submit.ts; everything
// below is a plain pass-through to the helpers in this file.
const saveClaims = core.platform.supabaseSaveClaims(core.supabase);
const submitRun = core.platform.registerSubmitRoute(core.app, {
  claimSave: (ticket) => saveClaims.claimSave(ticket),
  releaseSave: (ticket) => saveClaims.releaseSave(ticket),
  requireSecret: core.requireSecret,
  limiter: core.gameSubmitLimiter,
  internalSecret: () => core.INTERNAL_SECRET,
  gameTypes: core.GAME_TYPE,
  gameLabels: core.GAME_LABEL,
  winThreshold: core.WIN_THRESHOLD,
  xp: { played: core.XP_PLAYED, win: core.XP_WIN, newPb: core.XP_NEW_PB },
  currentSeason: () => core.currentSeasonNumber(),
  seasonStartSec: (season) => core.SEASON_EPOCH + (season - 1) * core.SEASON_DAYS * 86400,
  registerUser: (wallet) => core.registerUser(wallet),
  resolveWager: (wagerId, score) => core.resolveOnChain(wagerId, score),
  isGaslessTx: (hash) => core._isGaslessTx(hash),
  queuedRun: async (ticket, wallet, game, score) => { const row = await outboxStore.find(ticket); return !!row && row.wallet === String(wallet).toLowerCase() && row.game === game && Number(row.score) === Number(score); },
  verifyScoreTx: (hash, player, gameType) => core.verifyScoreTx(hash, player, gameType),
  bestThisSeason: core.platform.supabaseBestThisSeason(core.supabase),
  saveScore: (row) => core.saveScore(row),
  invalidateCaches: (game) => {
    core.cacheInvalidatePrefix(`lb:${game}`);
    core.cacheInvalidatePrefix('act:');
    core.memCache.delete('stats:global');
    core.memCache.delete('seasons:global');
  },
  awardXp: (wallet, amount, reason) => core.awardXp(wallet, amount, reason),
  updateMissions: (wallet, run) => core.updateMissionProgress(wallet, run),
  unlockAchievements: (wallet, run) => core.checkAndUnlockAchievements(wallet, run),
  seasonRank: (wallet, score, gameType, seasonStart) => core.subgraph.seasonRank(wallet, score, gameType, seasonStart),
  leaderboard: (gameType, seasonStart, limit) => core.subgraph.leaderboard(gameType, seasonStart, limit),
  notifyRankDisplacement: (game, wallet, before, after) => core.notifyRankDisplacement(game, wallet, before, after),
  push: {
    wagerWon: (wagered, label) => core.push.wagerWonNotification(wagered, label),
    wagerLost: (label) => core.push.wagerLostNotification(label),
    achievement: (name, icon) => core.push.achievementNotification(name, icon),
    send: (wallet, category, payload) => core.push.sendToWallet(core.supabase, wallet, category, payload),
  },
  recoverSigner: (payload, signature) => core.ethers.verifyMessage(payload, signature),
  validatorAddress: () => core.validator.address,
});

// ─── Finish any run the phone did not ────────────────────────────────────────
// A run whose score reached the chain but was never saved (the phone's last
// call failed, or the tab closed) is saved here, a few minutes later: board
// row, XP, missions, achievements. The save is claimed once, so a phone that
// does call back late cannot be paid twice. Needs
// supabase-migrations/2026-11-24_session_save.sql; until then it finds nothing.
core.jobs.every('finishUnsavedRuns', 2 * 60 * 1000, async () => {
  const now = Date.now();
  const runs = await saveClaims.unsaved(new Date(now - 3 * 60 * 1000).toISOString(), new Date(now - 48 * 3600 * 1000).toISOString(), 10);
  for (const r of runs) {
    try {
      const gameTime = Math.max(5000, Date.parse(r.usedAt) - Date.parse(r.createdAt) || 5000);
      const out = await submitRun({ playerAddress: r.wallet, scoreData: { game: r.game, score: r.score, gameTime, txHash: r.txHash, sessionToken: r.token } }, true);
      if (out.status === 200) console.log(`🧹 finished an unsaved run · ${r.game} ${r.score} · ${r.wallet.slice(0, 8)}… · ${r.txHash.slice(0, 10)}…`);
      else console.warn(`🧹 could not finish an unsaved run · ${r.game} ${r.score} · ${r.wallet.slice(0, 8)}… ·`, JSON.stringify(out.body).slice(0, 160));
    } catch (e) { console.warn('🧹 finishing an unsaved run failed:', e?.message || e); }
  }
});

// ─── GET /api/leaderboard · /api/usernames · /api/activity · /api/stats ──────
// The public boards. Read-only views of the subgraph (on-chain truth) plus
// streaks from the database. Logic: src/modules/board/service.ts.
core.platform.registerBoardRoutes(core.app, {
  gameTypes: core.GAME_TYPE,
  currentSeason: () => core.currentSeasonNumber(),
  seasonBounds: (season) => core.seasonBounds(season),
  subgraph: {
    leaderboard: (gameType, seasonStart, limit) => core.subgraph.leaderboard(gameType, seasonStart, limit),
    recentActivity: (limit, player) => core.subgraph.recentActivity(limit, player),
    globalStats: () => core.subgraph.globalStats(),
    seasonPlayerIds: core.platform.subgraphSeasonPlayers((query, vars) => core.subgraph.gql(query, vars)),
  },
  ledgerBoard: core.platform.supabaseLedgerBoard(core.supabase),
  results: core.results,
  streaks: core.platform.supabaseStreaks(core.supabase),
  resolveUsername: (wallet) => core.resolveUsername(wallet),
  treasuryBalance: () => core.getTreasuryBalance(),
  cache: { get: (key) => core.cacheGet(key), set: (key, value, ttlMs) => core.cacheSet(key, value, ttlMs) },
  statsTtlMs: core.MEM_TTL.global,
});
},

// ── GET /api/competition — cumulative leaderboard (weeks 10-13) ──
function* (core) {
  Object.defineProperties(core, {
    COMPETITION_WEEKS: { get: () => COMPETITION_WEEKS, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

// ─── GET /api/competition — cumulative leaderboard (weeks 10-13) ────────────
// Each player's best score per week is summed. Top 3 win $15/$10/$5. The
// comp ran for 4 weeks of activity ending at the close of week 13. The
// public-facing name stays "3-Week Competition" (the original branding the
// community knows) while the data window covers all 4 weeks.
const COMPETITION_WEEKS = [10, 11, 12, 13];

// The standings are sixteen database reads plus a name lookup per player. The
// competition's weeks ended long ago, so the result is kept (see
// src/platform/resultCache.ts): half an hour once it is over, thirty seconds
// while it runs. A read that fails throws, so a failure is never kept.
async function competitionRankings() {
  const totals = new Map(); // wallet -> { username, rhythm, simon, weeks: { 11: n, 12: n, 13: n } }

  for (const week of COMPETITION_WEEKS) {
    const { start, end } = core.seasonBounds(week);
    const startIso = new Date(start * 1000).toISOString();
    const endIso   = new Date(end   * 1000).toISOString();

    for (const game of core.VALID_GAMES) {
      const { data: rows, error } = await core.supabase
        .from('activity')
        .select('wallet_address, score')
        .eq('game', game)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('score', { ascending: false })
        .limit(500);
      if (error) throw new Error(`competition read failed: ${error.message || 'unknown'}`);

      // Best score per player this week
      const weekBest = new Map();
      for (const row of (rows || [])) {
        const key = row.wallet_address?.toLowerCase();
        if (!key) continue;
        if (!weekBest.has(key) || row.score > weekBest.get(key)) {
          weekBest.set(key, row.score);
        }
      }

      // Add to cumulative totals. Historical competition (weeks 10-13)
      // only tracked rhythm + simon · Stack Tower didn't exist yet, so
      // stack scores are intentionally skipped here instead of being
      // mislabeled into totalSimon (which the previous else-fallthrough
      // was silently doing).
      for (const [wallet, score] of weekBest.entries()) {
        if (game !== 'rhythm' && game !== 'simon') continue;
        if (!totals.has(wallet)) totals.set(wallet, { wallet, totalRhythm: 0, totalSimon: 0, weeklyScores: {} });
        const entry = totals.get(wallet);
        if (game === 'rhythm') entry.totalRhythm += score;
        else entry.totalSimon += score;
        if (!entry.weeklyScores[week]) entry.weeklyScores[week] = {};
        entry.weeklyScores[week][game] = score;
      }
    }
  }

  // Build final rankings by total (rhythm + simon combined)
  const rankings = await Promise.all(
    Array.from(totals.values())
      .map(e => ({ ...e, total: e.totalRhythm + e.totalSimon }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20)
      .map(async e => ({
        ...e,
        username: await core.resolveUsername(e.wallet) || null,
      }))
  );

  return rankings;
}

// The competition is over, so its table is worked out once now, at startup,
// and the first visitor to the leaderboard does not wait for it.
if (Date.now() >= core.seasonBounds(COMPETITION_WEEKS[COMPETITION_WEEKS.length - 1]).end * 1000) {
  setImmediate(() => core.results.get('competition:rankings', { ttlMs: 30 * 60_000, compute: competitionRankings }).catch((e) => console.warn('competition warm-up failed:', e?.message || e)));
}

core.app.get('/api/competition', async (_, res) => {
  const compEndMs = core.seasonBounds(COMPETITION_WEEKS[COMPETITION_WEEKS.length - 1]).end * 1000;
  let rankings;
  try {
    rankings = await core.results.get('competition:rankings', { ttlMs: core.platform.eventTtl(compEndMs, Date.now(), 30_000), compute: competitionRankings });
  } catch (e) {
    console.warn('competition standings unavailable:', e?.message || e);
    rankings = []; // as before: a failed read showed an empty table, not an error
  }

  const current = core.currentSeasonNumber();
  // Count the current week as remaining if we're inside the competition
  // window. Without this, weeksLeft hits 0 during the final active week
  // and the frontend hides the cup card while it should still be live.
  let weeksLeft = COMPETITION_WEEKS.filter(w => w >= current).length;
  const { start: compStart } = core.seasonBounds(COMPETITION_WEEKS[0]);
  const { end: compEnd }     = core.seasonBounds(COMPETITION_WEEKS[COMPETITION_WEEKS.length - 1]);

  const nowSec = Math.floor(Date.now() / 1000);
  // Always attempt freeze. The function self-gates on (nowSec >= compEnd) so
  // nothing happens before the window closes. Removing the outer week-number
  // guard means a freshly-restarted process will still freeze on the first
  // /api/competition GET after the deadline, even if no one queried during
  // the exact handoff minute.
  await core.freezeCompetitionIfNeeded(nowSec, rankings, compEnd, compStart);

  // If the competition has been frozen (auto or via admin), force weeksLeft
  // to 0 so the live card hides and only the COMPLETED EVENTS card renders.
  // Without this, an admin force-freeze would put the same comp in both
  // sections of the UI, which reads as a bug to the player.
  // The only thing this lookup can do is turn weeksLeft into 0. Once the weeks
  // are over it already is 0, so the database is not asked.
  if (weeksLeft > 0) {
    const { data: frozenRow } = await core.supabase
      .from('competition_winners')
      .select('id')
      .eq('id', core.COMPETITION_ID)
      .limit(1);
    if (frozenRow && frozenRow.length > 0) weeksLeft = 0;
  }

  res.json({
    weeks: COMPETITION_WEEKS,
    prizes: { first: 15, second: 10, third: 5 },
    compStart,
    compEnd,
    weeksLeft,
    currentWeek: current,
    rankings,
  });
});
},

];
