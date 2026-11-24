import type { FriendStore, Pair } from './service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = { from(table: string): any };
const toPair = (r: any): Pair => ({ a: r.a, b: r.b, status: r.status, by: r.asked_by, at: r.created_at, acceptedAt: r.accepted_at ?? null });

/** The friendships table is locked to the server (RLS on, no policies), so
 *  `db` must be the service-role client. Usernames come from chain_mints, the
 *  server's own copy of GamePass mints. Until its migration has been run, a
 *  name cannot be looked up and adding by wallet or link still works. */
export function supabaseFriends(db: Db): FriendStore {
  return {
    async list(wallet) {
      const { data, error } = await db.from('friendships').select('a, b, status, asked_by, created_at, accepted_at').or(`a.eq.${wallet},b.eq.${wallet}`).limit(600);
      return error ? { ok: false, rows: [] } : { ok: true, rows: ((data ?? []) as any[]).map(toPair) };
    },
    async get(a, b) {
      const { data, error } = await db.from('friendships').select('a, b, status, asked_by, created_at, accepted_at').eq('a', a).eq('b', b).limit(1);
      return error ? { ok: false, row: null } : { ok: true, row: data?.[0] ? toPair(data[0]) : null };
    },
    async put(row) {
      const { error } = await db.from('friendships').upsert({ a: row.a, b: row.b, status: row.status, asked_by: row.by, created_at: row.at, accepted_at: row.acceptedAt }, { onConflict: 'a,b' });
      return !error;
    },
    async remove(a, b) {
      const { error } = await db.from('friendships').delete().eq('a', a).eq('b', b);
      return !error;
    },
    async findByName(name) {
      const { data, error } = await db.from('chain_mints').select('player').ilike('username', name.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1);
      return error ? null : (data?.[0]?.player ?? null);
    },
  };
}
