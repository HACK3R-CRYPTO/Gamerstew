// What each game brings to a friend room. Add a game here and it has rooms.
import type { GameRules } from './service';
import * as ladder from '../ladder/rules';

/** Word Ladder: everyone gets the same five ladders; the server replays the words. */
const ladderRules: GameRules = {
  verified: true,
  deal: (seed) => ({ ladders: ladder.deal(seed) }),
  maxProgress: ladder.ROUND,
  async score(seed, proof, elapsedMs) {
    const v = ladder.verify(ladder.deal(seed), (proof as { ladderRuns?: unknown } | null)?.ladderRuns, elapsedMs);
    return v.ok ? { ok: true, score: v.total } : { ok: false, error: v.error };
  },
};

/* eslint-disable @typescript-eslint/no-require-imports */
// The older games' scoring lives in lib/ as plain JavaScript.
const simonLib = require('../../../lib/simonScoring') as { verifySimonRun(input: { sessionToken: string; tapLog: unknown[]; elapsedMs: number }): { score: number; rounds: number } };
const stackLib = require('../../../lib/stackScoring') as { computeStackScore(dropLog: unknown[]): { score: number } };
const claim = (proof: unknown): number | null => { const n = (proof as { score?: unknown } | null)?.score; return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

/** Simon Memory: the room's seed fixes the pattern, so everyone watches the same
 *  sequence. The taps are checked against it and the rounds must fit in the time
 *  the server saw; the score is the lower of that bound and what the phone showed. */
const simonRules: GameRules = {
  verified: true,
  deal: (seed) => ({ seed }),
  maxProgress: 56, // the most rounds one session can hold
  async score(seed, proof, elapsedMs) {
    const taps = (proof as { simonTapLog?: unknown } | null)?.simonTapLog;
    if (!Array.isArray(taps)) return { ok: false, error: 'No taps sent' };
    const bound = simonLib.verifySimonRun({ sessionToken: seed, tapLog: taps, elapsedMs }).score;
    const said = claim(proof);
    return { ok: true, score: said == null ? bound : Math.min(said, bound) };
  },
};

/** Stack Tower: nothing to deal, every tower starts the same. The score is the
 *  sum of the run's own drop log, never more than the phone showed. The drops
 *  are the phone's account of what happened, so this is NOT verified: no stakes. */
const stackRules: GameRules = {
  verified: false,
  deal: () => ({}),
  maxProgress: 9999,
  async score(_seed, proof) {
    const drops = (proof as { dropLog?: unknown } | null)?.dropLog;
    if (!Array.isArray(drops)) return { ok: false, error: 'No drops sent' };
    if (drops.length > 20000) return { ok: false, error: 'Too many drops' };
    const sum = stackLib.computeStackScore(drops).score;
    const said = claim(proof);
    return { ok: true, score: said == null ? sum : Math.min(said, sum) };
  },
};

export const ROOM_GAMES: Record<string, GameRules> = { ladder: ladderRules, simon: simonRules, stack: stackRules };
