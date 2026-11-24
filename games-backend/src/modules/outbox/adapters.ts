// The outbox's two connections to the outside: the table and the chain.
import type { NewRow, OutboxChain, OutboxRow, OutboxStore } from './service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase-js, loosely: its builder types are not worth restating here.
type Db = { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }> };

const T = 'chain_outbox';
const COLS = 'id, session_token, wallet, game, game_type, score, status, attempts, tx_hash, sent_at';

export function supabaseOutbox(db: Db, now: () => number = Date.now): OutboxStore {
  const iso = (ms: number) => new Date(ms).toISOString();
  const patch = async (id: number, values: Record<string, unknown>) => {
    const { error } = await db.from(T).update(values).eq('id', id);
    if (error) throw new Error(`outbox update failed: ${error.message ?? 'unknown'}`);
  };
  const count = async (status: string): Promise<number> => {
    const { count: n, error } = await db.from(T).select('id', { count: 'exact', head: true }).eq('status', status);
    if (error) throw new Error(`outbox count failed: ${error.message ?? 'unknown'}`);
    return n ?? 0;
  };
  return {
    async enqueue(r: NewRow) {
      const { data, error } = await db.from(T).insert({ session_token: r.sessionToken, wallet: r.wallet.toLowerCase(), game: r.game, game_type: r.gameType, score: r.score }).select('id').single();
      if (!error && data) return { ok: true, id: Number(data.id), created: true };
      // 23505 = the ticket is already queued: that row is the answer
      if (error && error.code === '23505') {
        const had = await db.from(T).select('id').eq('session_token', r.sessionToken).single();
        if (!had.error && had.data) return { ok: true, id: Number(had.data.id), created: false };
      }
      return { ok: false };
    },
    async claim(limit, leaseMs) {
      const { data, error } = await db.rpc('outbox_claim', { p_limit: limit, p_lease_seconds: Math.ceil(leaseMs / 1000) });
      if (error) throw new Error(`outbox claim failed: ${error.message ?? 'unknown'}`);
      return (Array.isArray(data) ? data : []) as OutboxRow[];
    },
    markSent: (id, txHash) => patch(id, { status: 'sent', tx_hash: txHash, sent_at: iso(now()), last_error: null }),
    markConfirmed: (id) => patch(id, { status: 'confirmed', confirmed_at: iso(now()) }),
    markFailed: (id, reason) => patch(id, { status: 'failed', last_error: reason }),
    retryLater: (id, delayMs, reason) => patch(id, { status: 'pending', tx_hash: null, sent_at: null, next_try_at: iso(now() + delayMs), last_error: reason }),
    async sentUnconfirmed(olderThanMs, limit) {
      const { data, error } = await db.from(T).select(COLS).eq('status', 'sent').lte('sent_at', iso(now() - olderThanMs)).order('sent_at', { ascending: true }).limit(limit);
      if (error) throw new Error(`outbox read failed: ${error.message ?? 'unknown'}`);
      return (data ?? []) as OutboxRow[];
    },
    async counts() {
      const [pending, sent, confirmed, failed] = await Promise.all([count('pending'), count('sent'), count('confirmed'), count('failed')]);
      let oldestPendingMs: number | null = null;
      if (pending > 0) {
        const { data } = await db.from(T).select('created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(1);
        const at = Array.isArray(data) && data[0]?.created_at ? Date.parse(data[0].created_at) : NaN;
        if (Number.isFinite(at)) oldestPendingMs = now() - at;
      }
      return { pending, sent, confirmed, failed, oldestPendingMs };
    },
    async find(sessionToken: string) {
      const { data, error } = await db.from(T).select(COLS).eq('session_token', sessionToken).maybeSingle();
      return error || !data ? null : (data as OutboxRow);
    },
  } as OutboxStore & { find(sessionToken: string): Promise<OutboxRow | null> };
}

/** `provider` is read at call time: it is created after boot. */
export function ethersOutboxChain(deps: { provider: () => any; submitScore: (wallet: string, gameType: number, score: number) => Promise<{ hash: string }>; submitMany?: OutboxChain['submitMany'] }): OutboxChain {
  return {
    ...(deps.submitMany ? { submitMany: deps.submitMany } : {}),
    submitScore: (wallet, gameType, score) => deps.submitScore(wallet, gameType, score),
    async txState(hash) {
      const p = deps.provider();
      const receipt = await p.getTransactionReceipt(hash);
      if (receipt) return Number(receipt.status) === 1 ? 'ok' : 'reverted';
      return (await p.getTransaction(hash)) ? 'pending' : 'gone';
    },
  };
}
