// ─── Progression: XP, daily missions, achievements, streaks, saved scores ────
// Everything a player earns for playing, beyond the on-chain score itself.
//
// Three defects of the old code are fixed here, each with a test:
//
//   Claiming a mission twice. The old route read "is it claimed?", then wrote
//   "claimed", then paid XP. Two requests sent together both read "no" and both
//   got paid. The claim is now a single conditional write, and only the request
//   that actually flipped it is paid.
//
//   Losing a score. A new best was saved by deleting the old row and inserting
//   the new one. If the insert failed, the player had no score at all. It is
//   now one update.
//
//   Claim streak always zero. The profile route returned claim_streak without
//   ever asking the database for it.
//
// One known weakness remains, and needs a database function to fix: XP is read,
// added to and written back, so two awards landing in the same instant can lose
// one. Mission claims no longer race, which was the practical way to hit it.

import { standing } from './streak';
import { ACHIEVEMENT_CATALOG, advanceMission, DAY_MS, goldStreak, levelFromXp, MISSION_TEMPLATES, pickDailyMissions, utcDay, VALID_GAMES, xpProgress, type RunContext, missionGame } from './catalog';
import type { ProgressionStore, ScoreEntry } from './store';

export interface Reply { status: number; body: Record<string, unknown> }
const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body });
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

export interface BadgeRow { badge: string; game: string; season_number: number; created_at: string }
export interface ProgressionDeps {
  store: ProgressionStore;
  badges(wallet: string): Promise<BadgeRow[]>;
  /** total games recorded on-chain for a wallet; null when the chain cannot be asked */
  gamesPlayed(wallet: string): Promise<number | null>;
  now?: () => number;
  logger?: { log(m: string): void; warn(m: string, ...e: unknown[]): void };
}

export function createProgression(deps: ProgressionDeps) {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? { log: (m) => console.log(m), warn: (m, ...e) => console.warn(m, ...e) };
  const today = () => utcDay(now());

  // ── missions ──
  async function ensureTodayMissions(wallet: string, date: string): Promise<void> {
    if ((await store.missionCount(wallet, date)) >= 3) return;
    await store.addMissions(pickDailyMissions(wallet, date).map((m) => ({ wallet, date, mission_id: m.id, target: m.target, reward_xp: m.reward })));
  }

  async function updateMissionProgress(wallet: string, run: RunContext): Promise<void> {
    const date = today();
    await ensureTodayMissions(wallet, date);
    const seenGamesToday = new Set(await store.gamesPlayedSince(wallet, `${date}T00:00:00.000Z`));
    for (const m of await store.missions(wallet, date, false)) {
      if (m.completed) continue;
      const tpl = MISSION_TEMPLATES.find((t) => t.id === m.mission_id);
      if (!tpl) continue;
      const next = advanceMission(tpl, m, { ...run, seenGamesToday });
      if (!next) continue;
      await store.setMissionProgress(m.id, next.progress, next.completed);
      if (next.completed) logger.log(`🎯 ${wallet.slice(0, 8)}... completed: ${tpl.label}`);
    }
  }

  // ── achievements ──
  async function checkAndUnlockAchievements(wallet: string, run: RunContext) {
    const have = new Set(await store.unlockedIds(wallet));
    const totalGames = (await deps.gamesPlayed(wallet).catch(() => null)) ?? 0;
    const playStreak = (await store.user(wallet))?.play_streak || 0;
    const input = { ...run, totalGames, playStreak };
    const fresh: { id: string; name: string; icon: string; desc: string }[] = [];
    for (const a of ACHIEVEMENT_CATALOG) {
      if (have.has(a.id) || !a.check(input)) continue;
      if (await store.addUnlock({ wallet, achievement_id: a.id, trigger_score: run.score || null, trigger_game: run.game || null })) {
        fresh.push({ id: a.id, name: a.name, icon: a.icon, desc: a.desc });
        logger.log(`🏅 ${wallet.slice(0, 8)}... unlocked: ${a.name}`);
      }
    }
    return fresh;
  }

  // ── xp ──
  async function awardXp(addr: string, amount: number, reason = '') {
    if (!amount) return null;
    const wallet = addr.toLowerCase();
    const before = (await store.user(wallet))?.xp || 0;
    const after = before + amount;
    const [was, is] = [levelFromXp(before), levelFromXp(after)];
    await store.setXp(wallet, after);
    if (is > was) logger.log(`✨ ${wallet.slice(0, 8)}... LV ${was} → ${is} (+${amount} XP ${reason})`);
    return { xp: after, level: is, leveledUp: is > was };
  }

  // ── scores ──
  /** Keep a player's best per game, and record every run in the activity feed. */
  async function saveScore(entry: ScoreEntry): Promise<void> {
    const best = await store.bestScore(entry.wallet_address, entry.game);
    if (!best) await store.insertScore(entry);
    else if (best.score < entry.score) {
      await store.replaceScore(best.id, entry);
      logger.log(`📈 Score updated: ${entry.wallet_address.slice(0, 8)}... ${best.score} → ${entry.score}`);
    }
    await store.addActivity({ wallet_address: entry.wallet_address, game: entry.game, score: entry.score, tx_hash: entry.tx_hash || null });
  }

  // ── routes ──
  async function badges(address: string): Promise<Reply> {
    const addr = address.toLowerCase();
    const rows = await deps.badges(addr);
    const count = (type: string) => rows.filter((b) => b.badge === type).length;
    const streaks: Record<string, number> = {};
    for (const game of VALID_GAMES) streaks[game] = goldStreak(rows.filter((b) => b.badge === 'gold' && b.game === game).map((b) => b.season_number));
    const top = Math.max(streaks.rhythm || 0, streaks.simon || 0);
    return ok({
      address: addr,
      badges: rows.map((b) => ({ season: b.season_number, game: b.game, rank: b.badge === 'gold' ? 1 : b.badge === 'silver' ? 2 : 3, type: b.badge, awardedAt: unix(b.created_at) })),
      streaks,
      summary: { totalGold: count('gold'), totalSilver: count('silver'), totalBronze: count('bronze'), streakLabel: top >= 3 ? `${top}-WEEK CHAMPION` : top === 2 ? '2-WEEK CHAMPION' : null },
    });
  }

  async function notifications(address: string, limitRaw: unknown): Promise<Reply> {
    const addr = (address || '').toLowerCase();
    if (!addr) return { status: 400, body: { error: 'address required' } };
    const feed = await store.feed(addr, Math.min(Number(limitRaw) || 50, 200));
    if (!feed.ok) {
      logger.warn('notifications_feed read failed:', feed.reason);
      return ok({ notifications: [] });
    }
    return ok({ notifications: feed.rows.map((r) => ({ id: String(r.id), isBroadcast: r.wallet_address === null, category: r.category, title: r.title, body: r.body, url: r.url, tag: r.tag, sentAt: unix(r.sent_at) })) });
  }

  async function achievements(address: string): Promise<Reply> {
    const addr = address.toLowerCase();
    const got = new Map((await store.unlocks(addr)).map((r) => [r.achievement_id, r]));
    const list = ACHIEVEMENT_CATALOG.map((a) => {
      const u = got.get(a.id);
      return { id: a.id, icon: a.icon, name: a.name, desc: a.desc, unlocked: !!u, unlockedAt: u ? unix(u.unlocked_at) : null, nftTokenId: u?.nft_token_id || null, txHash: u?.tx_hash || null };
    });
    return ok({ address: addr, total: list.length, unlockedCount: list.filter((a) => a.unlocked).length, achievements: list });
  }

  async function missionsToday(address: string): Promise<Reply> {
    const addr = address.toLowerCase();
    const date = today();
    await ensureTodayMissions(addr, date);
    const rows = await store.missions(addr, date, true);
    const t = new Date(now());
    const midnight = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1);
    return ok({
      address: addr,
      date,
      secondsUntilReset: Math.max(0, Math.floor((midnight - t.getTime()) / 1000)),
      missions: rows.map((r) => ({ id: r.id, missionId: r.mission_id, game: missionGame(r.mission_id), label: MISSION_TEMPLATES.find((x) => x.id === r.mission_id)?.label ?? r.mission_id, progress: r.progress, target: r.target, completed: r.completed, claimed: r.claimed, rewardXp: r.reward_xp })),
    });
  }

  async function claimMission(body: Record<string, unknown>): Promise<Reply> {
    const { wallet, missionId } = body;
    if (!wallet || typeof wallet !== 'string' || missionId == null) return { status: 400, body: { error: 'Missing wallet or missionId' } };
    const addr = wallet.toLowerCase();
    const m = await store.mission(missionId, addr);
    if (!m) return { status: 404, body: { error: 'Mission not found' } };
    if (!m.completed) return { status: 400, body: { error: 'Mission not yet completed' } };
    if (m.claimed) return { status: 400, body: { error: 'Already claimed' } };
    // Only the request that really flips the flag is paid. A second request that
    // arrived in the same instant finds it already flipped and gets the same
    // answer as one that arrived a minute later.
    if (!(await store.claimMission(m.id))) return { status: 400, body: { error: 'Already claimed' } };
    const xp = await awardXp(addr, m.reward_xp, `mission ${m.mission_id}`);
    return ok({ success: true, xpAwarded: m.reward_xp, xp: xp?.xp, level: xp?.level, leveledUp: !!xp?.leveledUp });
  }

  async function user(address: string): Promise<Reply> {
    const addr = address.toLowerCase();
    const u = await store.user(addr);
    if (!u) { const p = xpProgress(0); return ok({ address: addr, xp: 0, level: p.level, xpInLevel: p.xpInLevel, xpToNext: p.xpToNext, streak: 0, playedToday: false, lastPlayDate: null }); }
    const xp = u.xp || 0;
    const p = xpProgress(xp);
    // freezes are only looked up for a player who has a streak to protect
    const freezes = (u.play_streak || 0) > 0 && store.freezes ? await store.freezes(addr).catch(() => 0) : 0;
    const st = standing({ streak: u.play_streak || 0, lastPlay: u.last_play_date, today: today(), freezes });
    return ok({ address: addr, xp, level: p.level, xpInLevel: p.xpInLevel, xpToNext: p.xpToNext, streak: st.streak, streakFreezes: freezes, streakFrozen: st.frozen, playedToday: u.last_play_date === today(), lastPlayDate: u.last_play_date || null, claimStreak: u.claim_streak || 0, lastClaimDate: u.last_claim_date || null });
  }

  async function recordClaim(body: Record<string, unknown>): Promise<Reply> {
    const { walletAddress } = body;
    if (!walletAddress || typeof walletAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return { status: 400, body: { error: 'Missing or invalid walletAddress' } };
    const addr = walletAddress.toLowerCase();
    const date = today();
    const current = (await store.user(addr)) ?? {};
    if (current.last_claim_date === date) return ok({ success: true, claimStreak: current.claim_streak || 1, alreadyClaimed: true });
    const streak = current.last_claim_date === utcDay(now() - DAY_MS) ? (current.claim_streak || 0) + 1 : 1;
    await store.setClaimStreak(addr, streak, date);
    // Five ladder points per daily claim for enrolled players. Best effort.
    try {
      if (await store.isEnrolled(addr)) await store.addClaimPoints(addr, date);
    } catch (e) {
      logger.warn('Season 1 points hook (daily_claim) failed:', (e as { message?: unknown })?.message);
    }
    return ok({ success: true, claimStreak: streak, alreadyClaimed: false });
  }

  async function streak(address: string): Promise<Reply> {
    const u = await store.user(address.toLowerCase());
    if (!u) return ok({ streak: 0, playedToday: false });
    // alive if they played today or yesterday, or if freezes they hold cover the days missed
    const freezes = (u.play_streak || 0) > 0 && store.freezes ? await store.freezes(address.toLowerCase()).catch(() => 0) : 0;
    const st = standing({ streak: u.play_streak || 0, lastPlay: u.last_play_date, today: today(), freezes });
    return ok({ streak: st.streak, playedToday: st.playedToday, freezes, frozen: st.frozen });
  }

  return { ensureTodayMissions, updateMissionProgress, checkAndUnlockAchievements, awardXp, saveScore, routes: { badges, notifications, achievements, missionsToday, claimMission, user, recordClaim, streak } };
}
export type Progression = ReturnType<typeof createProgression>;
