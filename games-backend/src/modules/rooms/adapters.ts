import { ROOM_TTL_MS, type Room, type RoomKeeper } from './service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = { from(table: string): any };

/** Rooms kept in one small table, a row per open room. Writes are not awaited:
 *  a slow or failed write must never hold up a player. Until the migration has
 *  been run the writes fail quietly (one line in the log) and rooms simply live
 *  in memory as before. */
export function supabaseRoomKeeper(db: Db, log: (msg: string) => void = console.warn): RoomKeeper & { loadAll(): Promise<Room[]> } {
  let warned = false;
  const failed = (what: string, error: { message?: string } | null) => { if (error && !warned) { warned = true; log(`[rooms] could not ${what} (${error.message ?? 'unknown'}). Rooms will not survive a restart until supabase-migrations/2026-11-24_friend_rooms.sql is run.`); } };
  return {
    save(room) {
      void Promise.resolve(db.from('friend_rooms').upsert({ code: room.code, game: room.game, data: room, touched_at: new Date(room.touched).toISOString() }, { onConflict: 'code' }))
        .then((r: any) => failed('save a room', r?.error ?? null), () => failed('save a room', { message: 'network' }));
    },
    remove(code) {
      void Promise.resolve(db.from('friend_rooms').delete().eq('code', code)).then((r: any) => failed('remove a room', r?.error ?? null), () => {});
    },
    async loadAll() {
      const cutoff = new Date(Date.now() - ROOM_TTL_MS).toISOString();
      void Promise.resolve(db.from('friend_rooms').delete().lt('touched_at', cutoff)).then(() => {}, () => {}); // old rows are of no use to anyone
      const { data, error } = await db.from('friend_rooms').select('data').gte('touched_at', cutoff).limit(2000);
      if (error) { failed('load rooms', error); return []; }
      return ((data ?? []) as { data: Room }[]).map((r) => r.data).filter(Boolean);
    },
  };
}
