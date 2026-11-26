import type { FeedRow, InboxStore } from './service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }> };

/** Reads go through two database functions that apply this player's read and
 *  deleted state. Until the migration has been run they do not exist: the page
 *  falls back to the plain feed (nothing marked read, nothing deletable) and
 *  every write reports that it could not save. */
export function supabaseInbox(db: Db): InboxStore {
  const upsert = async (table: string, row: Record<string, unknown>, onConflict: string): Promise<boolean> => {
    const { error } = await db.from(table).upsert(row, { onConflict });
    return !error;
  };
  const upsertMany = async (rows: Record<string, unknown>[]): Promise<boolean> => {
    const { error } = await db.from('notification_state').upsert(rows, { onConflict: 'wallet,notification_id' });
    return !error;
  };
  return {
    async page(wallet, limit, beforeIso) {
      const fast = await db.rpc('inbox_page', { p_wallet: wallet, p_limit: limit, p_before: beforeIso });
      if (!fast.error && Array.isArray(fast.data)) return { ok: true, rows: fast.data as FeedRow[] };
      let q = db.from('notifications_feed').select('id, wallet_address, category, title, body, url, sent_at').or(`wallet_address.eq.${wallet},wallet_address.is.null`).order('sent_at', { ascending: false }).limit(limit);
      if (beforeIso) q = q.lt('sent_at', beforeIso);
      const { data, error } = await q;
      if (error) return { ok: false, rows: [] };
      return { ok: true, rows: ((data ?? []) as any[]).map((r) => ({ id: r.id, kind: null, category: r.category, title: r.title, body: r.body, url: r.url, sent_at: r.sent_at, is_broadcast: r.wallet_address === null, read: false })) };
    },
    async unread(wallet) {
      const { data, error } = await db.rpc('inbox_unread', { p_wallet: wallet });
      return error ? { ok: false, count: 0 } : { ok: true, count: Number(data ?? 0) };
    },
    markRead: (wallet, ids) => { const at = new Date().toISOString(); return upsertMany(ids.map((id) => ({ wallet, notification_id: id, read_at: at }))); },
    markAllRead: (wallet, atIso) => upsert('inbox_prefs', { wallet, read_before: atIso, updated_at: atIso }, 'wallet'),
    remove: (wallet, ids) => { const at = new Date().toISOString(); return upsertMany(ids.map((id) => ({ wallet, notification_id: id, read_at: at, deleted_at: at }))); },
    clearAll: (wallet, atIso) => upsert('inbox_prefs', { wallet, read_before: atIso, cleared_before: atIso, updated_at: atIso }, 'wallet'),
    async announce(row) {
      const { data, error } = await db.from('notifications_feed').insert({ wallet_address: null, kind: row.kind, category: row.category, title: row.title, body: row.body, url: row.url, dedupe_key: row.dedupeKey }).select('id').single();
      if (!error && data) return { ok: true, created: true, id: Number(data.id) };
      if (error && error.code === '23505') return { ok: true, created: false }; // already announced under this key
      return { ok: false, created: false };
    },
    async latestBroadcast() {
      const { data, error } = await db.from('notifications_feed').select('id, category, title, body, url, sent_at').is('wallet_address', null).in('category', ['whats_new', 'announcement']).order('sent_at', { ascending: false }).limit(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = error ? null : ((data ?? []) as any[])[0];
      return r ? { id: r.id, kind: null, category: r.category, title: r.title, body: r.body, url: r.url, sent_at: r.sent_at, is_broadcast: true, read: false } : null;
    },
  };
}
