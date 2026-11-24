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

export const ROOM_GAMES: Record<string, GameRules> = { ladder: ladderRules };
