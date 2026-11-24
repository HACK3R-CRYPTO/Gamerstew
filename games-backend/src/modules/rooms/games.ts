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

const rhythmLib = require('../../../lib/rhythmScoring') as {
  physicsCheck(tapLog: unknown[], elapsedMs: number): { ok: boolean; reason?: string };
  computeScore(tapLog: unknown[], elapsedMs: number, songId: string | null): { score: number; hits: unknown[] };
  jitterCheck(hits: unknown[]): { ok: boolean; reason?: string };
};
const rhythmSongs = (require('../../../lib/rhythmSongs.json') as { songs: { id: string }[] }).songs.map((x) => x.id);
/** The song a room's round is played on: the seed picks it, so everyone gets the same one. */
export const rhythmSongFor = (seed: string): string => rhythmSongs[(parseInt(seed.slice(0, 8), 16) || 0) % rhythmSongs.length]!;

/** Rhythm Rush: the seed picks one song for the whole room. The server replays
 *  the taps against that song's notes, exactly as it does for a ranked run, so
 *  the score is the server's and the phone's number is never used. */
const rhythmRules: GameRules = {
  verified: true,
  deal: (seed) => ({ songId: rhythmSongFor(seed) }),
  maxProgress: 1_000_000, // the score so far
  async score(seed, proof, elapsedMs) {
    const taps = (proof as { tapLog?: unknown } | null)?.tapLog;
    if (!Array.isArray(taps)) return { ok: false, error: 'No taps sent' };
    if (taps.length > 20000) return { ok: false, error: 'Too many taps' };
    if (taps.length === 0) return { ok: true, score: 0 }; // sat the round out: last place, not an error
    const physics = rhythmLib.physicsCheck(taps, elapsedMs);
    if (!physics.ok) return { ok: false, error: 'That run could not be checked' };
    const run = rhythmLib.computeScore(taps, elapsedMs, rhythmSongFor(seed));
    if (!rhythmLib.jitterCheck(run.hits).ok) return { ok: false, error: 'That run could not be checked' };
    return { ok: true, score: Math.max(0, Math.round(run.score)) };
  },
};

export const ROOM_GAMES: Record<string, GameRules> = { ladder: ladderRules, simon: simonRules, stack: stackRules, rhythm: rhythmRules };
