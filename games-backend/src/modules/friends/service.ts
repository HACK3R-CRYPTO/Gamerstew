// ─── Friends ─────────────────────────────────────────────────────────────────
// A player keeps a list of friends: ask, accept, remove. A friend can be
// invited straight into a friend room.
//
// One row per pair of players, stored with the lower address first, so a pair
// can never be recorded twice. `by` is who asked; the other one answers.
// Nothing here moves money or changes a score.

export type Status = 'pending' | 'accepted';
export interface Pair { a: string; b: string; status: Status; by: string; at: string; acceptedAt: string | null }
export interface FriendStore {
  /** every pair this wallet is part of. `ok` false: could not be read */
  list(wallet: string): Promise<{ ok: boolean; rows: Pair[] }>;
  get(a: string, b: string): Promise<{ ok: boolean; row: Pair | null }>;
  put(row: Pair): Promise<boolean>;
  remove(a: string, b: string): Promise<boolean>;
  /** a player's wallet from their username, any case. null: no such player */
  findByName(name: string): Promise<string | null>;
}
export interface Person { wallet: string; name: string | null; since: string; /** has the app open right now */ online: boolean; /** when they were last seen with the app open, or null if not since the server started */ lastSeen: number | null }
export interface Reply { status: number; body: Record<string, unknown> }
export interface Note { title: string; body: string; url: string; tag: string }

export const MAX_FRIENDS = 200;
export const MAX_ASKING = 30;
export const INVITE_GAP_MS = 30_000;
/** a player counts as online for this long after their app last checked in */
export const ONLINE_MS = 150_000;
const WALLET = /^0x[a-f0-9]{40}$/;
const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body });
const bad = (error: string, status = 400): Reply => ({ status, body: { error } });
const low = (v: unknown): string => String(v ?? '').trim().toLowerCase();
const order = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
/** only the games' own pages, so an invite can never point somewhere else */
const GAME_PATHS: Record<string, { name: string; path: string }> = {
  rhythm: { name: 'Rhythm Rush', path: '/games/rhythm' }, simon: { name: 'Simon Memory', path: '/games/simon' }, stack: { name: 'Stack Tower', path: '/games/stack' },
  ladder: { name: 'Word Ladder', path: '/games/ladder' }, nepa3d: { name: 'UP NEPA 3D', path: '/world' },
};

export function createFriends(deps: {
  store: FriendStore;
  nameOf: (wallet: string) => Promise<string | null>;
  /** tell one player something (their inbox, and a push if they allow it). Best effort. */
  notify?: (wallet: string, category: string, note: Note) => Promise<unknown>;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const lastInvite = new Map<string, number>();
  // Who has the app open. Kept in memory only: a restart forgets it, and it
  // fills again within a minute as open apps check in.
  const seen = new Map<string, number>();
  const mark = (w: string) => { if (seen.size > 50_000) seen.clear(); seen.set(w, now()); };
  const name = async (w: string) => (await deps.nameOf(w).catch(() => null)) || null;
  const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
  const tell = (wallet: string, category: string, note: Note) => { if (deps.notify) void deps.notify(wallet, category, note).catch(() => {}); };

  /** who the request is about: a wallet, or a username to look up */
  async function target(raw: unknown): Promise<string | null> {
    const s = low(raw).replace(/^@/, '');
    if (WALLET.test(s)) return s;
    if (!/^[a-z0-9_]{2,24}$/.test(s)) return null;
    return (await deps.store.findByName(s).catch(() => null))?.toLowerCase() ?? null;
  }

  return {
    async list(walletRaw: unknown): Promise<Reply> {
      const me = low(walletRaw);
      if (!WALLET.test(me)) return bad('bad_wallet');
      const { ok: read, rows } = await deps.store.list(me);
      if (!read) return bad('unavailable', 503);
      mark(me); const t = now();
      // only friends learn when someone is online; a stranger who merely asked does not
      const person = async (r: Pair): Promise<Person> => { const w = r.a === me ? r.b : r.a; const at = r.status === 'accepted' ? seen.get(w) ?? null : null; return { wallet: w, name: await name(w), since: r.acceptedAt ?? r.at, online: at !== null && t - at < ONLINE_MS, lastSeen: at }; };
      const [friends, incoming, outgoing] = await Promise.all([
        Promise.all(rows.filter((r) => r.status === 'accepted').map(person)),
        Promise.all(rows.filter((r) => r.status === 'pending' && r.by !== me).map(person)),
        Promise.all(rows.filter((r) => r.status === 'pending' && r.by === me).map(person)),
      ]);
      friends.sort((x, y) => Number(y.online) - Number(x.online) || (y.lastSeen ?? 0) - (x.lastSeen ?? 0) || (x.name ?? x.wallet).localeCompare(y.name ?? y.wallet));
      return ok({ friends, incoming, outgoing, max: MAX_FRIENDS });
    },

    /** The app is open: called about once a minute by a signed-in player. */
    ping(walletRaw: unknown): Reply {
      const me = low(walletRaw);
      if (!WALLET.test(me)) return bad('bad_wallet');
      mark(me);
      return ok({ ok: true });
    },

    /** Ask someone to be a friend. If they had already asked, this accepts. */
    async request(walletRaw: unknown, toRaw: unknown): Promise<Reply> {
      const me = low(walletRaw);
      if (!WALLET.test(me)) return bad('bad_wallet');
      const them = await target(toRaw);
      if (!them) return bad('no_player', 404);
      if (them === me) return bad('yourself');
      const [a, b] = order(me, them);
      const [mine, had] = await Promise.all([deps.store.list(me), deps.store.get(a, b)]);
      if (!mine.ok || !had.ok) return bad('unavailable', 503);
      if (had.row?.status === 'accepted') return ok({ state: 'friends' });
      const t = new Date(now()).toISOString();
      if (had.row && had.row.by !== me) { // they asked first: this is a yes
        if (mine.rows.filter((r) => r.status === 'accepted').length >= MAX_FRIENDS) return bad('full', 409);
        if (!(await deps.store.put({ ...had.row, status: 'accepted', acceptedAt: t }))) return bad('unavailable', 503);
        tell(them, `friend_yes_${me.slice(2, 10)}`, { title: '🤝 You have a new friend', body: `${(await name(me)) ?? short(me)} accepted your friend request.`, url: '/friends', tag: `friend-${me.slice(2, 10)}` });
        return ok({ state: 'friends' });
      }
      if (had.row) return ok({ state: 'asked' }); // already asked, still waiting
      if (mine.rows.filter((r) => r.status === 'accepted').length >= MAX_FRIENDS) return bad('full', 409);
      if (mine.rows.filter((r) => r.status === 'pending' && r.by === me).length >= MAX_ASKING) return bad('too_many_asks', 429);
      if (!(await deps.store.put({ a, b, status: 'pending', by: me, at: t, acceptedAt: null }))) return bad('unavailable', 503);
      tell(them, `friend_ask_${me.slice(2, 10)}`, { title: '👋 Friend request', body: `${(await name(me)) ?? short(me)} wants to be your friend on GameArena.`, url: '/friends', tag: `friend-${me.slice(2, 10)}` });
      return ok({ state: 'asked', wallet: them, name: await name(them) });
    },

    /** Say yes to someone who asked. Only the one who was asked can. */
    async accept(walletRaw: unknown, otherRaw: unknown): Promise<Reply> {
      const me = low(walletRaw), them = low(otherRaw);
      if (!WALLET.test(me) || !WALLET.test(them) || me === them) return bad('bad_wallet');
      const [a, b] = order(me, them);
      const [mine, had] = await Promise.all([deps.store.list(me), deps.store.get(a, b)]);
      if (!mine.ok || !had.ok) return bad('unavailable', 503);
      if (!had.row) return bad('no_request', 404);
      if (had.row.status === 'accepted') return ok({ state: 'friends' });
      if (had.row.by === me) return bad('not_yours', 403); // you cannot accept your own request
      if (mine.rows.filter((r) => r.status === 'accepted').length >= MAX_FRIENDS) return bad('full', 409);
      const t = new Date(now()).toISOString();
      if (!(await deps.store.put({ ...had.row, status: 'accepted', acceptedAt: t }))) return bad('unavailable', 503);
      tell(them, `friend_yes_${me.slice(2, 10)}`, { title: '🤝 You have a new friend', body: `${(await name(me)) ?? short(me)} accepted your friend request.`, url: '/friends', tag: `friend-${me.slice(2, 10)}` });
      return ok({ state: 'friends' });
    },

    /** Unfriend, turn a request down, or take your own request back. Either side can. Nobody is told. */
    async remove(walletRaw: unknown, otherRaw: unknown): Promise<Reply> {
      const me = low(walletRaw), them = low(otherRaw);
      if (!WALLET.test(me) || !WALLET.test(them) || me === them) return bad('bad_wallet');
      const [a, b] = order(me, them);
      return (await deps.store.remove(a, b)) ? ok({ state: 'none' }) : bad('unavailable', 503);
    },

    /** Call a friend into a room. Friends only, and not more than once every half minute to the same friend. */
    async invite(walletRaw: unknown, otherRaw: unknown, gameRaw: unknown, codeRaw: unknown): Promise<Reply> {
      const me = low(walletRaw), them = low(otherRaw); const game = GAME_PATHS[String(gameRaw)]; const code = String(codeRaw ?? '').toUpperCase();
      if (!WALLET.test(me) || !WALLET.test(them) || me === them) return bad('bad_wallet');
      if (!game || !/^[A-Z0-9]{5}$/.test(code)) return bad('bad_room');
      const [a, b] = order(me, them);
      const had = await deps.store.get(a, b);
      if (!had.ok) return bad('unavailable', 503);
      if (had.row?.status !== 'accepted') return bad('not_friends', 403);
      const key = `${me}>${them}`; const t = now();
      if (lastInvite.size > 20000) lastInvite.clear();
      if (t - (lastInvite.get(key) ?? 0) < INVITE_GAP_MS) return bad('slow_down', 429);
      lastInvite.set(key, t);
      tell(them, `room_invite_${code}`, { title: `🎮 ${(await name(me)) ?? 'A friend'} invited you`, body: `Join their ${game.name} room. Code ${code}.`, url: `${game.path}?room=${code}`, tag: `room-${code}` });
      return ok({ sent: true });
    },
  };
}
export type Friends = ReturnType<typeof createFriends>;
