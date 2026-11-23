// ─── What progression needs stored, and the Supabase version of it ───────────
// The service asks for things by intent ("claim this mission"); only this file
// knows tables and columns.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseLike { from(table: string): any }

export interface MissionRow { id: number; wallet: string; date: string; mission_id: string; target: number; progress: number; completed: boolean; claimed: boolean; reward_xp: number }
export interface ScoreEntry { wallet_address: string; game: string; score: number; game_time?: unknown; season_number?: unknown; wagered?: unknown; wager_id?: unknown; tx_hash?: unknown }
export interface UnlockRow { achievement_id: string; unlocked_at: string; nft_token_id?: unknown; tx_hash?: unknown }
export interface FeedRow { id: unknown; wallet_address: string | null; category: unknown; title: unknown; body: unknown; url: unknown; tag: unknown; sent_at: string }
export interface UserRow { xp?: number | null; play_streak?: number | null; last_play_date?: string | null; claim_streak?: number | null; last_claim_date?: string | null }

export interface ProgressionStore {
  // missions
  missionCount(wallet: string, date: string): Promise<number>;
  addMissions(rows: { wallet: string; date: string; mission_id: string; target: number; reward_xp: number }[]): Promise<void>;
  missions(wallet: string, date: string, ordered: boolean): Promise<MissionRow[]>;
  gamesPlayedSince(wallet: string, sinceIso: string): Promise<unknown[]>;
  setMissionProgress(id: number, progress: number, completed: boolean): Promise<void>;
  mission(id: unknown, wallet: string): Promise<MissionRow | null>;
  /** Mark claimed ONLY if it is not already. True if this call was the one that claimed it. */
  claimMission(id: number): Promise<boolean>;
  // achievements
  unlockedIds(wallet: string): Promise<string[]>;
  unlocks(wallet: string): Promise<UnlockRow[]>;
  /** true if stored (false when it already existed or the write failed) */
  addUnlock(row: { wallet: string; achievement_id: string; trigger_score: unknown; trigger_game: unknown }): Promise<boolean>;
  // users
  user(wallet: string): Promise<UserRow | null>;
  setXp(wallet: string, xp: number): Promise<void>;
  setClaimStreak(wallet: string, streak: number, date: string): Promise<void>;
  // scores
  bestScore(wallet: string, game: string): Promise<{ id: unknown; score: number } | null>;
  insertScore(entry: ScoreEntry): Promise<void>;
  /** replace the stored best with a better one, in a single statement */
  replaceScore(id: unknown, entry: ScoreEntry): Promise<void>;
  addActivity(row: { wallet_address: string; game: string; score: number; tx_hash: unknown }): Promise<void>;
  // feed and ladder
  feed(wallet: string, limit: number): Promise<{ ok: boolean; rows: FeedRow[]; reason?: string }>;
  isEnrolled(wallet: string): Promise<boolean>;
  addClaimPoints(wallet: string, date: string): Promise<void>;
}

export function supabaseProgression(db: SupabaseLike): ProgressionStore {
  return {
    async missionCount(wallet, date) {
      const { data } = await db.from('daily_missions').select('mission_id').eq('wallet', wallet).eq('date', date);
      return data ? data.length : 0;
    },
    async addMissions(rows) {
      await db.from('daily_missions').upsert(rows, { onConflict: 'wallet,date,mission_id', ignoreDuplicates: true });
    },
    async missions(wallet, date, ordered) {
      const q = db.from('daily_missions').select('*').eq('wallet', wallet).eq('date', date);
      const { data } = ordered ? await q.order('id', { ascending: true }) : await q;
      return (data || []) as MissionRow[];
    },
    async gamesPlayedSince(wallet, sinceIso) {
      const { data } = await db.from('activity').select('game,created_at').eq('wallet_address', wallet).gte('created_at', sinceIso);
      return ((data || []) as { game: unknown }[]).map((a) => a.game);
    },
    async setMissionProgress(id, progress, completed) {
      await db.from('daily_missions').update({ progress, completed }).eq('id', id);
    },
    async mission(id, wallet) {
      const { data } = await db.from('daily_missions').select('*').eq('id', id).eq('wallet', wallet).limit(1);
      return data && data.length > 0 ? (data[0] as MissionRow) : null;
    },
    // The filter on `claimed` is the whole point: the database flips it for one
    // request only, however many arrive together. Whoever gets a row back won.
    async claimMission(id) {
      const { data, error } = await db.from('daily_missions').update({ claimed: true }).eq('id', id).eq('claimed', false).select('id');
      return !error && Array.isArray(data) && data.length > 0;
    },
    async unlockedIds(wallet) {
      const { data } = await db.from('achievements_unlocked').select('achievement_id').eq('wallet', wallet);
      return ((data || []) as { achievement_id: string }[]).map((r) => r.achievement_id);
    },
    async unlocks(wallet) {
      const { data } = await db.from('achievements_unlocked').select('achievement_id, unlocked_at, nft_token_id, tx_hash').eq('wallet', wallet);
      return (data || []) as UnlockRow[];
    },
    async addUnlock(row) {
      const { error } = await db.from('achievements_unlocked').insert(row);
      return !error;
    },
    async user(wallet) {
      const { data } = await db.from('users').select('xp, play_streak, last_play_date, claim_streak, last_claim_date').eq('wallet_address', wallet).limit(1);
      return data && data.length > 0 ? (data[0] as UserRow) : null;
    },
    async setXp(wallet, xp) {
      await db.from('users').update({ xp }).eq('wallet_address', wallet);
    },
    async setClaimStreak(wallet, streak, date) {
      await db.from('users').upsert({ wallet_address: wallet, claim_streak: streak, last_claim_date: date }, { onConflict: 'wallet_address' });
    },
    async bestScore(wallet, game) {
      const { data } = await db.from('scores').select('id, score').eq('wallet_address', wallet).eq('game', game).order('score', { ascending: false }).limit(1);
      return data && data.length > 0 ? (data[0] as { id: unknown; score: number }) : null;
    },
    async insertScore(entry) {
      await db.from('scores').insert(entry);
    },
    // Only the columns the old insert wrote. The scores table is not in the
    // migrations folder, so no column is assumed that the insert did not use.
    async replaceScore(id, entry) {
      await db.from('scores').update(entry).eq('id', id);
    },
    async addActivity(row) {
      await db.from('activity').insert(row);
    },
    async feed(wallet, limit) {
      const { data, error } = await db.from('notifications_feed').select('id, wallet_address, category, title, body, url, tag, sent_at').or(`wallet_address.eq.${wallet},wallet_address.is.null`).order('sent_at', { ascending: false }).limit(limit);
      return error ? { ok: false, rows: [], reason: String(error.message || error) } : { ok: true, rows: (data || []) as FeedRow[] };
    },
    async isEnrolled(wallet) {
      const { data } = await db.from('season_v1_players').select('wallet').ilike('wallet', wallet).maybeSingle();
      return !!data;
    },
    async addClaimPoints(wallet, date) {
      await db.from('season_v1_points').insert({ wallet, action_type: 'daily_claim', points: 5, ref: `claim:${date}` });
    },
  };
}
