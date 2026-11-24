// ─── Saving a score after it reached the chain ───────────────────────────────
// POST /api/submit-score. By the time a request arrives here the score has been
// decided and signed (sign-score) and written on-chain, either by the backend
// (gasless) or by the player. This step turns that on-chain fact into everything
// the player sees: a saved score, XP, missions, achievements, a rank and the
// notifications that go with them.
//
// The one rule that matters: NOTHING is saved without an on-chain proof. A
// transaction the backend itself sent is trusted by its hash. Any other hash is
// checked against the chain (it must be a successful GamePass write for this
// player and this game). So the database can only ever hold a subset of what
// happened on-chain.
//
// The order of the steps below is the order they have always run in, and it is
// pinned by tests. Once the score is saved, EVERYTHING after it is best effort:
// a failed XP award, mission update, rank lookup or notification is logged and
// the player still gets a success reply. Answering "failed" for a score that
// was in fact saved invites a retry, and a retry saves it twice.

import { MAX_CLIENT_SCORE } from './rules';
import type { Reply } from './service';

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SESSION_MAX_MS = 11 * 60 * 1000;
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const msg = (e: unknown): unknown => (e as { message?: unknown } | null | undefined)?.message;

export interface Achievement { id?: string; name?: string; icon?: string }
export interface LeaderboardEntry { wallet_address: string; score: number; username: string | null; created_at: string; tx_hash: string | null }
export interface RunFacts { game: string; score: number; isWin: boolean; isNewPb: boolean }

export interface SubmitDeps {
  gameTypes: Record<string, number>;
  gameLabels: Record<string, string>;
  winThreshold: Record<string, number>;
  xp: { played: number; win: number; newPb: number };
  currentSeason(): number;
  /** unix seconds the given season starts */
  seasonStartSec(season: number): number;
  /** records the player and returns their play streak */
  registerUser(wallet: string): Promise<unknown>;
  /** resolves a wager on-chain; returns its tx hash, or null if it did not land */
  resolveWager(wagerId: unknown, score: number): Promise<string | null>;
  isGaslessTx(hash: string): boolean;
  /** Is there a queued run for this ticket, by this player, of this game, with this score?
   *  The server checked that run and stored it; its transaction follows from the outbox. */
  queuedRun?(sessionToken: string, wallet: string, game: string, score: number): Promise<boolean>;
  verifyScoreTx(hash: string, player: string, gameType: number): Promise<{ ok: boolean; reason?: string }>;
  bestThisSeason(wallet: string, game: string, season: number): Promise<number>;
  saveScore(row: { wallet_address: string; game: string; score: number; game_time: number; season_number: number; wagered: unknown; wager_id: unknown; /** null while a queued run waits for its transaction */ tx_hash: string | null }): Promise<void>;
  /** the leaderboard, activity and stats caches that this save makes stale */
  invalidateCaches(game: string): void;
  awardXp(wallet: string, amount: number, reason: string): Promise<{ xp?: number; level?: number; leveledUp?: boolean } | null | undefined>;
  updateMissions(wallet: string, run: RunFacts): Promise<void>;
  unlockAchievements(wallet: string, run: RunFacts & { fullCombo: boolean; allPerfect: boolean }): Promise<Achievement[] | null | undefined>;
  seasonRank(wallet: string, score: number, gameType: number, seasonStartSec: number): Promise<number>;
  leaderboard(gameType: number, seasonStartSec: number, limit: number): Promise<LeaderboardEntry[]>;
  notifyRankDisplacement(game: string, wallet: string, before: LeaderboardEntry[], after: LeaderboardEntry[]): Promise<void>;
  push: {
    wagerWon(wagered: unknown, gameLabel: string | undefined): unknown;
    wagerLost(gameLabel: string | undefined): unknown;
    achievement(name: string | undefined, icon: string | undefined): unknown;
    /** `category` is the per-day dedup key */
    send(wallet: string, category: string, payload: unknown): Promise<unknown>;
  };
  /** the legacy "silent session": who signed this payload, and who should have */
  recoverSigner(payload: string, signature: string): string;
  validatorAddress(): string;
  now?: () => number;
  logger?: { log(m: string): void; warn(m: string, ...e: unknown[]): void };
}

/** The shape check every saved score passes: a known game, a score in range, a run of at least five seconds. */
export function validateSubmission(scoreData: Record<string, unknown>, gameTypes: Record<string, number>): { valid: true } | { valid: false; reason: string } {
  const { score, gameTime, game } = scoreData;
  if (typeof game !== 'string' || !Object.prototype.hasOwnProperty.call(gameTypes, game)) return { valid: false, reason: 'Unknown game' };
  if (typeof score !== 'number' || score < 0 || score > MAX_CLIENT_SCORE) return { valid: false, reason: 'Score out of range' };
  if (typeof gameTime !== 'number' || gameTime < 5000) return { valid: false, reason: 'Game time too short' };
  return { valid: true };
}

export function createSubmitService(deps: SubmitDeps) {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? { log: (m) => console.log(m), warn: (m, ...e) => console.warn(m, ...e) };

  /** `trusted` is true when the call carried the internal secret, which is every call in production. */
  return async function submitScore(body: Record<string, unknown>, trusted: boolean): Promise<Reply> {
    const playerAddress = body.playerAddress;
    const scoreData = body.scoreData as Record<string, unknown> | undefined;
    if (!playerAddress || !scoreData || typeof playerAddress !== 'string' || typeof scoreData !== 'object') return reply(400, { error: 'Missing playerAddress or scoreData' });

    // The legacy "silent session" check. Unreachable today: server.js refuses to
    // boot without an internal secret, and the route's gate requires it, so
    // every call arrives trusted. Kept, and tested, so that loosening the gate
    // later cannot silently leave this route with no check at all.
    if (!trusted) {
      const session = body.session as Record<string, unknown> | undefined;
      if (!session) return reply(400, { error: 'Missing session token' });
      try {
        const { token, timestamp, nonce, playerAddress: tokenPlayer } = session;
        // a session with no readable player throws here and is refused below
        if ((tokenPlayer as string).toLowerCase() !== playerAddress.toLowerCase()) return reply(403, { error: 'Session player mismatch' });
        const signer = deps.recoverSigner(`${playerAddress.toLowerCase()}:${timestamp}:${nonce}`, token as string);
        if (signer.toLowerCase() !== deps.validatorAddress().toLowerCase()) return reply(403, { error: 'Invalid session token' });
        const actualElapsed = now() - (timestamp as number);
        const reportedTime = (scoreData.gameTime as number) || 0;
        if (actualElapsed < reportedTime - 2000) {
          logger.warn(`🚨 Anti-cheat: Speed hack detected from ${playerAddress}. Reported ${reportedTime}ms, but only ${actualElapsed}ms elapsed.`);
          return reply(403, { error: 'Cheating detected: Speed hack' });
        }
        if (actualElapsed > SESSION_MAX_MS) return reply(403, { error: 'Session expired' });
      } catch {
        return reply(400, { error: 'Session verification failed' });
      }
    }

    const check = validateSubmission(scoreData, deps.gameTypes);
    if (!check.valid) return reply(400, { error: 'Validation failed', reason: check.reason });

    const game = scoreData.game as string;
    const score = scoreData.score as number;
    const gameTime = scoreData.gameTime as number;
    const { wagered, wagerId, fullCombo, allPerfect } = scoreData;
    const season = deps.currentSeason();

    // the player exists and their streak is up to date, whatever happens next
    const streak = await deps.registerUser(playerAddress);

    let wagerTxHash: string | null = null;
    if (wagerId) wagerTxHash = await deps.resolveWager(wagerId, score);

    const scoreTxHash = (scoreData.txHash as string | undefined) || null;
    const txHash = wagerTxHash || scoreTxHash;

    // ── no proof, no save ───────────────────────────────────────────────────
    // A run in the outbox needs no transaction yet: the server itself checked it
    // and stored it. Anything else still needs one.
    const ticket = typeof scoreData.sessionToken === 'string' ? scoreData.sessionToken : '';
    const queued = !txHash && !!ticket && !!deps.queuedRun && (await deps.queuedRun(ticket, playerAddress, game, score).catch(() => false));
    if (!queued && (!txHash || !TX_HASH_RE.test(txHash))) {
      return reply(400, { error: 'Missing on-chain proof', reason: 'txHash required — every score must reference a GamePass contract tx' });
    }
    // A hash of the right shape is not a proof. A tx the player sent must have
    // succeeded and carry a score record for THIS player and game. A tx the
    // backend sent is trusted by its hash (waiting on a mine to re-check our own
    // write would only stall the save). Wager txs were awaited when resolved.
    if (scoreTxHash && !deps.isGaslessTx(scoreTxHash)) {
      const gameType = deps.gameTypes[game];
      if (gameType === undefined) return reply(400, { error: 'Unknown game · cannot verify on-chain proof' });
      const verified = await deps.verifyScoreTx(scoreTxHash, playerAddress, gameType);
      if (!verified.ok) {
        logger.warn(`🚨 submit-score rejected: ${playerAddress.slice(0, 10)}.. game=${game} tx=${scoreTxHash.slice(0, 10)}.. · ${verified.reason}`);
        return reply(400, { error: 'On-chain proof verification failed', reason: verified.reason });
      }
    }

    // ── save ────────────────────────────────────────────────────────────────
    // Personal bests are per season, to match how scores are saved. An all-time
    // best would lock a player out of "New PB" for good after one great season.
    const lower = playerAddress.toLowerCase();
    const prevBest = await deps.bestThisSeason(lower, game, season);
    await deps.saveScore({ wallet_address: lower, game, score, game_time: gameTime, season_number: season, wagered: wagered || null, wager_id: wagerId || null, tx_hash: txHash });
    // so the rank shown on the results screen includes the score just saved
    deps.invalidateCaches(game);

    // ── rewards ─────────────────────────────────────────────────────────────
    const isWin = score >= (deps.winThreshold[game] || Infinity);
    const isNewPb = score > prevBest;
    const run: RunFacts = { game, score, isWin, isNewPb };
    const xpEarned = deps.xp.played + (isWin ? deps.xp.win : 0) + (isNewPb ? deps.xp.newPb : 0);
    let xpResult: Awaited<ReturnType<SubmitDeps['awardXp']>> = null;
    try {
      xpResult = await deps.awardXp(lower, xpEarned, ['played', isWin && 'win', isNewPb && 'new PB'].filter(Boolean).join(' + '));
    } catch (e) {
      logger.warn('xp award failed (score is saved):', msg(e));
    }
    // a notification must never throw into the save path, whether building it or sending it
    const notify = (category: string, build: () => unknown) => {
      try {
        deps.push.send(lower, category, build()).catch(() => {});
      } catch (e) {
        logger.warn(`push ${category} failed:`, msg(e));
      }
    };

    try {
      await deps.updateMissions(lower, run);
    } catch (e) {
      logger.warn('mission progress update failed:', msg(e));
    }

    // Only when the wager really resolved on-chain. One category per wager, so a
    // player who runs several in a day hears about each.
    if (wagerId && wagerTxHash) {
      const label = deps.gameLabels[game];
      notify(`wager_${wagerId}`, () => (isWin ? deps.push.wagerWon(wagered, label) : deps.push.wagerLost(label)));
    }

    // The full-combo and all-perfect flags are the client's word. That is safe
    // here only because the score they decorate is already proven on-chain.
    let newAchievements: Achievement[] | null | undefined = [];
    try {
      newAchievements = await deps.unlockAchievements(lower, { ...run, fullCombo: !!fullCombo, allPerfect: !!allPerfect });
    } catch (e) {
      logger.warn('achievement check failed:', msg(e));
    }

    // Rank comes from the subgraph, the single source of truth for on-chain scores.
    let rank = 0;
    try {
      const seasonStart = deps.seasonStartSec(season);
      const gameType = deps.gameTypes[game]!;
      rank = await deps.seasonRank(lower, score, gameType, seasonStart);
      // Landing in the top three is the moment worth a notification. The subgraph
      // has not indexed this tx yet, so the "after" board is worked out here.
      if (rank > 0 && rank <= 3) {
        try {
          const before = await deps.leaderboard(gameType, seasonStart, 50);
          const after = [...before.filter((e) => e.wallet_address !== lower), { wallet_address: lower, score, username: null, created_at: new Date(now()).toISOString(), tx_hash: txHash }].sort((a, b) => b.score - a.score);
          deps.notifyRankDisplacement(game, lower, before, after).catch(() => {});
        } catch {
          /* best effort */
        }
      }
    } catch (e) {
      logger.warn('rank lookup failed:', msg(e) || e);
    }

    if (newAchievements && newAchievements.length > 0) {
      for (const a of newAchievements) {
        // the id is in the category so several unlocks in one day each notify
        notify(`achievement_${a.id || a.name}`, () => deps.push.achievement(a.name || a.id, a.icon));
      }
    }

    logger.log(`✅ [${game}] ${lower.slice(0, 8)}... → ${score} pts (rank #${rank}) +${xpEarned} XP ${txHash ? `tx: ${txHash.slice(0, 10)}...` : ''}`);

    return reply(200, { success: true, score, rank, txHash, streak, xpEarned, xp: xpResult?.xp, level: xpResult?.level, leveledUp: !!xpResult?.leveledUp, isNewPb, prevBest, newAchievements });
  };
}
