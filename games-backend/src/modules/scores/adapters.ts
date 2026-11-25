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

/** Runs that were started and never finished, for the unfinished-run recorder. */
export function supabaseUnfinished(db: SupabaseLike): import('./unfinished').UnfinishedStore {
  return {
    async open(olderThanIso, newerThanIso, limit) {
      const { data, error } = await db.from('game_sessions').select('token, wallet, game, started_at').eq('used', false).is('tx_hash', null).lt('started_at', olderThanIso).gt('started_at', newerThanIso).order('started_at', { ascending: true }).limit(limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return error ? [] : ((data ?? []) as any[]).map((r) => ({ token: r.token, wallet: r.wallet, game: r.game, startedAt: r.started_at }));
    },
    async mark(token, txHash) {
      // only a run that is still unfinished: if it was finished in the meantime, its own score transaction stands
      const { error } = await db.from('game_sessions').update({ tx_hash: txHash }).eq('token', token).eq('used', false);
      return !error;
    },
  };
}

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
    // needs supabase-migrations/2026-11-24_session_save.sql; a failure is not a reason to refuse the player
    async noteTx(token, txHash) {
      await db.from('game_sessions').update({ tx_hash: txHash }).eq('token', token);
    },
  };
}

// ─── Saving a run exactly once ───────────────────────────────────────────────
// After a score is on the chain, the run still has to be SAVED: the board row,
// XP, missions, achievements. That used to depend on the phone making one more
// call. If the call failed or the tab closed, the score was on the chain and
// nothing else was recorded. Now the run remembers its transaction, the save
// is claimed once (so it can never be applied twice), and a job finishes any
// run the phone did not.
export interface UnsavedRun { token: string; wallet: string; game: string; score: number; txHash: string; createdAt: string; usedAt: string }
/* eslint-disable @typescript-eslint/no-explicit-any */
export function supabaseSaveClaims(db: SupabaseLike, nowIso: () => string = () => new Date().toISOString()) {
  const t = () => (db as any).from('game_sessions');
  return {
    /** true = this caller may save the run. false = it is already saved. Any doubt
     *  (no such ticket, the columns not there yet) answers true, as before this existed. */
    async claimSave(token: string): Promise<boolean> {
      const { data, error } = await t().update({ saved_at: nowIso() }).eq('token', token).is('saved_at', null).select('token');
      if (error) return true;
      if (Array.isArray(data) && data.length > 0) return true;
      const row = await t().select('saved_at').eq('token', token).maybeSingle();
      return !(row.data && row.data.saved_at);
    },
    /** The save did not complete: give the claim back so it can be tried again. */
    async releaseSave(token: string): Promise<void> {
      await t().update({ saved_at: null }).eq('token', token);
    },
    /** Runs that reached the chain but were never saved, oldest first. */
    async unsaved(olderThanIso: string, newerThanIso: string, limit: number): Promise<UnsavedRun[]> {
      const { data, error } = await t().select('token, wallet, game, computed_score, tx_hash, started_at, used_at').eq('used', true).not('tx_hash', 'is', null).is('saved_at', null)
        .not('computed_score', 'is', null).lt('used_at', olderThanIso).gt('used_at', newerThanIso).order('used_at', { ascending: true }).limit(limit);
      if (error || !Array.isArray(data)) return [];
      return data.map((r: any) => ({ token: r.token, wallet: String(r.wallet).toLowerCase(), game: r.game, score: Number(r.computed_score), txHash: r.tx_hash, createdAt: r.started_at, usedAt: r.used_at }));
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

/** The player's best score for one game in one season; 0 if they have none. */
export function supabaseBestThisSeason(db: SupabaseLike) {
  return async (wallet: string, game: string, season: number): Promise<number> => {
    const { data } = await db.from('scores').select('score').eq('wallet_address', wallet).eq('game', game).eq('season_number', season).order('score', { ascending: false }).limit(1);
    return data && data.length > 0 ? data[0].score || 0 : 0;
  };
}
