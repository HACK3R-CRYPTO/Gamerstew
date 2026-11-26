// The real database behind the admin dashboard's store.
import type { Admin, AdminStore, Role } from './service';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseLike { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any }

export function supabaseAdminStore(db: SupabaseLike): AdminStore {
  const msg = (e: unknown): string | null => (e ? String((e as { message?: string }).message || e) : null);
  return {
    async rpc(name, args) { try { const { data, error } = await db.rpc(name, args); return { data, error: msg(error) }; } catch (e) { return { data: null, error: msg(e) }; } },
    async admin(email) { const { data } = await db.from('admin_users').select('email, name, role, disabled, pass_hash').eq('email', email).maybeSingle(); return (data as Admin | null) ?? null; },
    async admins() { const { data } = await db.from('admin_users').select('email, name, role, disabled, created_at, last_login_at').order('created_at', { ascending: true }); return (data as Admin[] | null) ?? []; },
    async saveAdmin(row) { const { error } = await db.from('admin_users').upsert({ ...row, disabled: false }, { onConflict: 'email' }); return msg(error); },
    async setDisabled(email, disabled) { const { error } = await db.from('admin_users').update({ disabled }).eq('email', email); return msg(error); },
    async touchLogin(email) { await db.from('admin_users').update({ last_login_at: new Date().toISOString() }).eq('email', email); },
    async log(admin_email, action, detail) { await db.from('admin_actions').insert({ admin_email, action, detail }); },
    async announcements(limit) { const { data } = await db.from('notifications_feed').select('id, title, body, url, category, sent_at').is('wallet_address', null).order('sent_at', { ascending: false }).limit(limit); return data ?? []; },
    async actions(limit) { const { data } = await db.from('admin_actions').select('at, admin_email, action, detail').order('at', { ascending: false }).limit(limit); return data ?? []; },
    async payouts(limit, offset, wallet) {
      let q = db.from('payouts').select('id, created_at, wallet, amount, token, reason, status, tx_hash, paid_at, note, recorded_by', { count: 'exact' });
      if (wallet) q = q.eq('wallet', wallet);
      const { data, count } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      return { rows: data ?? [], total: count ?? 0 };
    },
    async addPayout(row) { const { error } = await db.from('payouts').insert(row); return msg(error); },
    async setPayoutStatus(id, status) { const { error } = await db.from('payouts').update({ status }).eq('id', id); return msg(error); },
    async event(row) { await db.from('platform_events').insert(row); },
  };
}
export type { Role };
