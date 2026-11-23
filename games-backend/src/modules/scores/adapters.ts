// ─── The real database and chain, behind the score ports ─────────────────────
// These are the only lines in the module that know Supabase or ethers exist.
// They are deliberately dull, and they are tested, because a slip here (the
// wrong column, an error read the wrong way) loses a player's score just as
// surely as a bug in the rules.
//
// supabase-js never throws: every call resolves to { data, error }. "Did it
// fail?" is therefore always `error` being truthy. Its `.message` can be an
// empty string or missing entirely on a gateway error, so it is never used as
// the test, only as the text.

import type { Chain, SeasonLedger, SessionStore } from './ports';
import type { SessionRow } from './rules';

/* The Supabase client is used through its query builder, which is typed per
   project schema. This module needs only "it has from()", so the boundary is
   left loose here and pinned by the adapter tests instead. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseLike { from(table: string): any }

export function supabaseSessions(db: SupabaseLike, nowIso: () => string = () => new Date().toISOString()): SessionStore {
  return {
    async create(row) {
      const { error } = await db.from('game_sessions').insert(row);
      return error ? { ok: false, reason: String(error.message || 'insert failed') } : { ok: true };
    },
    async find(token) {
      const { data, error } = await db.from('game_sessions').select('*').eq('token', token).single();
      return error || !data ? null : (data as SessionRow);
    },
    // Best effort, as before: the score is already decided, so a failed write
    // here is not a reason to refuse the player.
    async markUsed(token, info) {
      await db.from('game_sessions')
        .update({ used: true, used_at: nowIso(), computed_score: info.computedScore, tap_count: info.tapCount })
        .eq('token', token);
    },
  };
}

export function supabaseSeason(db: SupabaseLike): SeasonLedger {
  return {
    async isEnrolled(wallet) {
      const { data } = await db.from('season_v1_players').select('wallet').ilike('wallet', wallet).maybeSingle();
      return !!data;
    },
    async addGamePoints(row) {
      await db.from('season_v1_points').insert({ wallet: row.wallet, action_type: 'game_played', points: row.points, ref: row.ref });
    },
  };
}

export interface ChainParts {
  /** read at request time: both are loaded after boot, and may be absent */
  validator(): { signTypedData(domain: unknown, types: unknown, value: unknown): Promise<string> } | null | undefined;
  passContract(): { scoreNonces(player: string): Promise<{ toString(): string }> } | null | undefined;
  /** the single serialized write queue for the signer */
  submitScore(player: string, gameType: number, score: number): Promise<{ hash: string }>;
  domain: unknown;
  types: unknown;
}

export function ethersChain(parts: ChainParts): Chain {
  return {
    ready: () => !!parts.validator() && !!parts.passContract(),
    submitScore: (player, gameType, score) => parts.submitScore(player, gameType, score),
    scoreNonce: (player) => parts.passContract()!.scoreNonces(player),
    // the contract's score field is a uint256: it must be signed as a BigInt
    signVoucher: (player, gameType, score, nonce) => parts.validator()!.signTypedData(parts.domain, parts.types, { player, gameType, score: BigInt(score), nonce }),
  };
}
