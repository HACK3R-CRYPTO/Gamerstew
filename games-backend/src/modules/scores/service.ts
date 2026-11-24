// ─── Starting a run and signing its score ────────────────────────────────────
// The path every skill-game score takes before it reaches the chain:
//
//   start-game   issues a single-use session ticket (and, for NEPA, the seed
//                the whole run is generated from, so the client cannot pick one)
//   sign-score   checks the ticket, decides the score, records it, then either
//                submits it on-chain itself (gasless) or signs a voucher the
//                player submits
//
// Who decides the score:
//   rhythm            the SERVER, by replaying the tap log. The client's number
//                     is ignored.
//   simon/stack/nepa  still the CLIENT's claim, inside a sanity bound. The
//                     replays for these run in SHADOW MODE: computed and logged
//                     next to the claim, never enforced, so an imperfect port
//                     cannot hurt a player. Enforcing them is the remaining
//                     "do not trust the client" work (see ANTICHEAT.md).
//
// Every reply is `{ status, body }`. The bodies and status codes are the
// contract with the game client and are covered by tests; change them only on
// purpose.

import { randomBytes } from 'crypto';
import type { ScoreDeps } from './ports';
import { checkSession, isClientScore, MAX_CLIENT_SCORE, NEPA_MAX_INPUTS, seasonPoints } from './rules';

import * as ladder from '../ladder/rules';
import * as strike from '../strike/game';
import * as nepa3d from '../nepa3d/rules';
export interface Reply { status: number; body: Record<string, unknown> }
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
// what the old handlers logged: the error's message, whatever was thrown
const msg = (e: unknown): unknown => (e as { message?: unknown } | null | undefined)?.message;
const GASLESS_ATTEMPTS = 3;

export function createScoreService(deps: ScoreDeps) {
  const now = deps.now ?? Date.now;
  const randomHex = deps.randomHex ?? ((n: number) => randomBytes(n).toString('hex'));
  // one-argument lines stay one-argument, so a log search anchored on the end of a line still matches
  const logger = deps.logger ?? { log: (m) => console.log(m), warn: (m, ...e) => console.warn(m, ...e), error: (m, ...e) => console.error(m, ...e) };
  const knownGame = (g: unknown): g is string => typeof g === 'string' && Object.prototype.hasOwnProperty.call(deps.gameTypes, g);

  async function startGame(body: Record<string, unknown>): Promise<Reply> {
    const { wallet, game } = body;
    if (!wallet || !game) return reply(400, { error: 'Missing wallet or game' });
    if (typeof wallet !== 'string') return reply(400, { error: 'Missing wallet or game' });
    if (!knownGame(game)) return reply(400, { error: 'Unknown game' });

    const token = randomHex(32); // 64 hex chars, unguessable
    // NEPA is seed-driven: the seed fixes the light-cut schedule the player races
    // against, so it is made here and stored with the session. Other games keep
    // their original insert shape.
    const seed = game === 'nepa' ? randomHex(16) : undefined;
    // Never hand out a ticket that was not stored: the player would finish the
    // run and only then find the score cannot be saved.
    const stored = await deps.sessions.create(seed ? { token, wallet: wallet.toLowerCase(), game, seed } : { token, wallet: wallet.toLowerCase(), game });
    if (!stored.ok) {
      logger.error('start-game insert error:', stored.reason);
      return reply(500, { error: 'Failed to start session' });
    }
    // Word Ladder: the server deals the five ladders from the ticket itself, so
    // the player cannot pick easy ones and nothing extra has to be stored.
    if (game === 'ladder') return reply(200, { success: true, sessionToken: token, ladders: ladder.deal(token) });
    return reply(200, seed ? { success: true, sessionToken: token, seed } : { success: true, sessionToken: token });
  }

  async function signScore(body: Record<string, unknown>): Promise<Reply> {
    if (!deps.chain.ready()) return reply(503, { error: 'Validator not configured' });

    const { playerAddress, game, score, sessionToken, tapLog, dropLog, simonTapLog, simonRounds, simonElapsedMs, nepaInputLog, nepaBankedNaira, nepaElapsedMs } = body;
    if (!playerAddress || !game || typeof playerAddress !== 'string') return reply(400, { error: 'Missing playerAddress or game' });
    if (!knownGame(game)) return reply(400, { error: 'Unknown game' });
    if (!sessionToken || typeof sessionToken !== 'string') return reply(400, { error: 'Missing sessionToken' });
    const who = playerAddress.slice(0, 10);

    // ── the session ticket ──────────────────────────────────────────────────
    const session = await deps.sessions.find(sessionToken);
    const verdict = checkSession(session, playerAddress, game, now());
    if (!verdict.ok) return reply(403, { error: verdict.error });
    const elapsedMs = verdict.elapsedMs;

    // ── the score ───────────────────────────────────────────────────────────
    let serverScore: number;
    const stackEnforced = game === 'stack' && (deps.enforce?.('stack') ?? false);
    if (game === 'rhythm') {
      if (!Array.isArray(tapLog)) return reply(400, { error: 'Missing tapLog (required for rhythm)' });

      const physics = deps.replay.rhythm.physicsCheck(tapLog, elapsedMs);
      if (!physics.ok) {
        logger.warn(`[rhythm] Physics check rejected ${playerAddress}: ${physics.reason} · ${tapLog.length} taps, ${elapsedMs}ms session`);
        return reply(403, { error: 'Physics check failed', reason: physics.reason });
      }
      // Older clients send no song and get the original. A song this server does
      // not know is refused: replaying it against the wrong chart would score an
      // honest run as misses.
      const songId = typeof body.songId === 'string' && body.songId ? body.songId : null;
      if (songId && !deps.replay.rhythm.isKnownSong(songId)) return reply(400, { error: 'Unknown song', songId });
      const run = deps.replay.rhythm.computeScore(tapLog, elapsedMs, songId);

      const jitter = deps.replay.rhythm.jitterCheck(run.hits);
      if (!jitter.ok) {
        logger.warn(`[rhythm] Jitter check rejected ${playerAddress}: ${jitter.reason} · ${run.hits.length} hits`);
        return reply(403, { error: 'Jitter check failed', reason: jitter.reason });
      }
      serverScore = run.score;
    } else if (game === 'ladder') {
      // Fully replayed: the score is worked out here from the player's words.
      // The number the client sent is ignored.
      const run = ladder.verify(ladder.deal(sessionToken), body.ladderRuns, elapsedMs);
      if (!run.ok) {
        logger.warn(`[ladder] rejected ${playerAddress}: ${run.error}`);
        return reply(403, { error: 'Ladder check failed', reason: run.error });
      }
      if (!run.human) logger.log(`[ladder] FLAG(${run.reasons.join('; ')}) player=${who} score=${run.total} elapsed=${elapsedMs}ms`);
      serverScore = run.total;
    } else if (game === 'strike') {
      // Fully replayed: every throw goes through the same lane simulation the
      // phone ran, and the total comes from that. The client's number is ignored.
      const run = strike.replay(await strike.engine(), body.strikeThrows, elapsedMs);
      if (!run.ok) {
        logger.warn(`[strike] rejected ${playerAddress}: ${run.error}`);
        return reply(403, { error: 'Game check failed', reason: run.error });
      }
      serverScore = run.total;
    } else if (game === 'nepa3d') {
      // Not replayable (see nepa3d/rules.ts): the server's clock sets the time,
      // impossible runs are refused, skill is bounded, and the score is worked
      // out here from those checked numbers.
      const run = nepa3d.verifyRestore(body.nepa3dRun, elapsedMs);
      if (!run.ok) {
        logger.warn(`[nepa3d] rejected ${playerAddress}: ${run.error}`);
        return reply(403, { error: 'Run check failed', reason: run.error });
      }
      logger.log(`[nepa3d] player=${who} clientScore=${typeof score === 'number' ? score : '?'} serverScore=${run.total} seconds=${run.seconds ?? '-'} elapsed=${elapsedMs}ms`);
      serverScore = run.total;
    } else {
      // The client's claim, inside a sanity bound. Deliberately not tightened: a
      // lower ceiling cannot tell a cheat from a great run, so it would only
      // punish real players. The honest fix is replay, as rhythm does.
      if (!isClientScore(score)) return reply(400, { error: `Score out of range (max ${MAX_CLIENT_SCORE})` });
      serverScore = score;

      // STACK, ENFORCED (unless switched off with SCORE_ENFORCE): the score must be
      // backed by the run's own drop log. The server adds the log up and signs
      // the LOWER of the two numbers, so a claim the log does not support is cut
      // to what the log shows, and a score is never raised above what the player
      // saw. Nothing is refused for a mismatch: if the server's sum is ever wrong
      // for an honest run, that player loses points, not the whole run, and the
      // MISMATCH line below is how we find out.
      if (stackEnforced) {
        if (!Array.isArray(dropLog)) return reply(400, { error: 'Missing drop log (required for stack)' });
        try {
          const sum = deps.replay.stack.computeScore(dropLog);
          const human = deps.replay.stack.humanness(dropLog);
          const flag = human.human ? 'human' : `FLAG(${human.reasons.join('; ')})`;
          if (sum.score < score) serverScore = sum.score;
          logger.log(`[stack:enforced] player=${who} dropLog=${dropLog.length} serverScore=${sum.score} clientScore=${score} delta=${sum.score - score} signed=${serverScore}${sum.score !== score ? ' MISMATCH' : ''} (drops=${sum.drops} perfects=${sum.perfects} maxCombo=${sum.maxCombo}) rate=${human.stats.dropsPerSec ?? 0}/s ${flag}`);
        } catch (e) {
          // a fault in our own sum must not cost a player their run
          logger.warn(`[stack:enforced] sum threw, signing the client score · player=${who}:`, msg(e));
        }
      }

      // SHADOW MODE: replay, log the comparison, change nothing. A failure in a
      // shadow replay must never cost a player their run.
      try {
        if (game === 'stack' && Array.isArray(dropLog) && !stackEnforced) {
          const shadow = deps.replay.stack.computeScore(dropLog);
          const human = deps.replay.stack.humanness(dropLog);
          const flag = human.human ? 'human' : `FLAG(${human.reasons.join('; ')})`;
          logger.log(`[stack:shadow] player=${who} dropLog=${dropLog.length} serverScore=${shadow.score} clientScore=${score} delta=${shadow.score - score} (drops=${shadow.drops} perfects=${shadow.perfects} maxCombo=${shadow.maxCombo}) rate=${human.stats.dropsPerSec}/s ${flag} · SIGNING CLIENT SCORE`);
        }
        if (game === 'simon' && Array.isArray(simonTapLog)) {
          const clientElapsedMs = typeof simonElapsedMs === 'number' ? simonElapsedMs : elapsedMs;
          const sim = deps.replay.simon.computeScore({ sessionToken, tapLog: simonTapLog, clientElapsedMs });
          const flag = sim.tapsOk ? 'tapsOk' : 'FLAG(tap mismatch)';
          const claimed = typeof simonRounds === 'number' ? simonRounds : sim.roundsClaimed;
          logger.log(`[simon:shadow] player=${who} taps=${simonTapLog.length} serverScore=${sim.score} clientScore=${score} delta=${sim.score - score} roundsVerified=${sim.roundsVerified} roundsClaimed=${claimed} ${flag} · SIGNING CLIENT SCORE`);
        }
        if (game === 'nepa' && Array.isArray(nepaInputLog)) {
          // A full honest run is a few hundred events. The cap keeps the replay
          // cheap and makes the ceiling a decision, not a side effect of the body limit.
          const capped = nepaInputLog.length > NEPA_MAX_INPUTS ? nepaInputLog.slice(0, NEPA_MAX_INPUTS) : nepaInputLog;
          if (capped !== nepaInputLog) logger.log(`[nepa:shadow] player=${who} inputLog over cap (${nepaInputLog.length} > ${NEPA_MAX_INPUTS}) · truncated for replay`);
          const shadow = deps.replay.nepa.computeScore({ seed: session?.seed, inputLog: capped });
          const human = deps.replay.nepa.humanness(nepaInputLog);
          const flag = human.human ? 'human' : `FLAG(${human.reasons.join('; ')})`;
          const naira = typeof nepaBankedNaira === 'number' ? nepaBankedNaira : shadow.nairaScore;
          const elapsed = typeof nepaElapsedMs === 'number' ? nepaElapsedMs : elapsedMs;
          logger.log(`[nepa:shadow] player=${who} inputs=${nepaInputLog.length} serverPoints=${shadow.points} clientPoints=${score} delta=${shadow.points - score} (naira=${shadow.nairaScore} clientNaira=${naira} banked=${shadow.banked} wasted=${shadow.wasted} maxCombo=${shadow.maxCombo}) rate=${human.stats.inputsPerSec}/s elapsed=${elapsed}ms ${flag} · SIGNING CLIENT SCORE`);
        }
      } catch (e) {
        logger.warn(`[${game}:shadow] replay threw, ignored (score unaffected) · player=${who}:`, msg(e));
      }
    }

    const gameType = deps.gameTypes[game]!;
    try {
      // The ticket is spent, with the forensic record of what was computed.
      await deps.sessions.markUsed(sessionToken, { computedScore: serverScore, tapCount: Array.isArray(tapLog) ? tapLog.length : null });

      // Solo Ladder points, one ledger row per session ticket. Best effort: a
      // ladder hiccup must not cost the player their score.
      const pts = seasonPoints(game, serverScore, elapsedMs);
      if (pts > 0) {
        try {
          if (await deps.season.isEnrolled(playerAddress)) await deps.season.addGamePoints({ wallet: playerAddress.toLowerCase(), points: pts, ref: sessionToken });
        } catch (e) {
          logger.warn('Season 1 points hook (game_played) failed:', msg(e));
        }
      } else {
        logger.log(`Season 1 pts skipped: ${playerAddress.slice(0, 8)}.. game=${game} score=${serverScore} elapsed=${elapsedMs}ms`);
      }

      // ── GASLESS: the backend submits and pays; the player does nothing on-chain.
      if (deps.gasless.enabled()) {
        const budget = deps.gasless.check(playerAddress);
        if (!budget.ok) {
          // Over budget: spend no signer gas, but let a genuine player still save
          // the run by paying their own gas through the voucher below.
          logger.warn(`⛔ Gasless budget hit (${budget.reason}) · ${who}… — falling back to voucher`);
        } else {
          // A failure here is almost always a passing RPC or nonce hiccup, and
          // falling back strands a low-CELO wallet on a "gas needed" screen, so
          // try a few times before giving up.
          let last: unknown;
          for (let attempt = 1; attempt <= GASLESS_ATTEMPTS; attempt++) {
            try {
              const tx = await deps.chain.submitScore(playerAddress, gameType, serverScore);
              deps.gasless.consume(playerAddress);
              deps.gasless.remember(tx.hash);
              logger.log(`⛽ Gasless ${game} · ${who}… score ${serverScore} · ${tx.hash}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
              return reply(200, { success: true, gasless: true, txHash: tx.hash, gameType, score: serverScore });
            } catch (e) {
              last = e;
              logger.warn(`⚠️  Gasless ${game} submit attempt ${attempt}/${GASLESS_ATTEMPTS} failed · ${who}…:`, msg(e));
            }
          }
          logger.warn(`⚠️  Gasless ${game} exhausted retries, falling back to voucher · ${who}…:`, msg(last));
        }
      }

      // ── VOUCHER: the backend only signs; the player submits and pays.
      const nonce = await deps.chain.scoreNonce(playerAddress);
      const signature = await deps.chain.signVoucher(playerAddress, gameType, serverScore, nonce);
      return reply(200, { success: true, signature, nonce: nonce.toString(), gameType, score: serverScore });
    } catch (e) {
      logger.error('sign-score error:', msg(e));
      return reply(500, { error: 'Failed to sign score' });
    }
  }

  return { startGame, signScore };
}
export type ScoreService = ReturnType<typeof createScoreService>;
