// ─── Friend rooms, for any game ──────────────────────────────────────────────
// One player opens a room and shares its 5-letter code. Up to four friends join
// and everyone plays the SAME round at the SAME time, each on their own phone,
// watching each other's progress. Highest score wins the round.
//
// This is the Street Strike lane idea made general. A game plugs in with three
// small functions (see GameRules): what everyone is dealt, how far a player has
// got, and how the server scores a finished run. For a game the server can
// replay (Word Ladder) the room's result is worked out here, not reported.
//
// Free rooms only, for now. Entry stakes come next and will only be offered for
// games whose `verified` flag is true.
//
// Rooms live in this process's memory. That is right for one server; see
// strike/store.ts for what several servers would need.

import { randomBytes } from 'crypto';

export const MAX_PLAYERS = 4;
export const MAX_ROOMS = 2000;
export const ROOM_TTL_MS = 20 * 60 * 1000;
export const AWAY_MS = 30 * 1000;
export const ROUND_MAX_MS = 12 * 60 * 1000; // a round nobody finishes ends on its own
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

export interface GameRules {
  /** true when `score` works the result out from the player's own moves */
  verified: boolean;
  /** what every player in the round is given (same seed, same deal) */
  deal(seed: string): unknown;
  /** the most `progress` can be, so a phone cannot claim more */
  maxProgress: number;
  /** score a finished run. `elapsedMs` is the server's time since the round began. */
  score(seed: string, proof: unknown, elapsedMs: number): Promise<{ ok: true; score: number } | { ok: false; error: string }>;
}

export interface Player { name: string; token: string; seen: number; left: boolean; score: number | null; done: boolean; progress: number }
export interface Room { code: string; game: string; status: 'waiting' | 'playing' | 'over'; round: number; seed: string; startedAt: number; touched: number; players: Player[] }

export type FailCode = 'slow_down' | 'busy' | 'no_room' | 'started' | 'full' | 'not_host' | 'need_two' | 'not_in_room' | 'not_playing' | 'bad_game' | 'bad_run' | 'already_done' | 'not_over';
export interface Fail { error: FailCode; status: number; reason?: string }
export interface Seat { code: string; token: string; seat: number; game: string }
export interface RoomView {
  code: string; game: string; status: Room['status']; round: number; verified: boolean;
  /** the caller's seat, or -1 for a stranger */
  you: number;
  /** seconds since the round began, by the server's clock */
  elapsed: number;
  players: { name: string; host: boolean; score: number | null; done: boolean; progress: number; away: boolean }[];
  /** the round's deal. Only sent to players in the room, and only once it has started. */
  deal?: unknown;
}

const fail = (error: FailCode, status: number, reason?: string): Fail => (reason ? { error, status, reason } : { error, status });
export const isFail = (v: unknown): v is Fail => typeof v === 'object' && v !== null && 'error' in v && 'status' in v;

export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 16).join('') || 'Player';
}

/** Somewhere rooms are written so a restart does not end them. Both calls are
 *  best effort: a room that cannot be saved still works, it just will not
 *  survive a restart. */
export interface RoomKeeper { save(room: Room): void; remove(code: string): void }

export function createRoomService(games: Record<string, GameRules>, opts: { now?: () => number; randomHex?: (bytes: number) => string; keep?: RoomKeeper } = {}) {
  const now = opts.now ?? Date.now;
  const hex = opts.randomHex ?? ((n: number) => randomBytes(n).toString('hex'));
  const rooms = new Map<string, Room>();

  const find = (code: unknown) => rooms.get(String(code ?? '').toUpperCase());
  const seatOf = (room: Room, token: unknown) => (typeof token === 'string' && token.length === 32 ? room.players.findIndex((p) => p.token === token) : -1);
  const gone = (room: Room, i: number, t: number) => { const p = room.players[i]; return !p || p.left || t - p.seen >= AWAY_MS; };
  const hostSeat = (room: Room) => room.players.findIndex((p) => !p.left);
  const sweep = (t: number) => { for (const [c, r] of rooms) if (t - r.touched > ROOM_TTL_MS) rooms.delete(c); };

  /** A round is over when everyone still here has finished, or it has run too
   *  long. Worked out fresh each time, so a phone that went quiet never holds
   *  the others, and one that comes back can still finish. */
  function statusOf(room: Room): Room['status'] {
    if (room.status !== 'playing') return room.status;
    const t = now();
    if (t - room.startedAt > ROUND_MAX_MS) return 'over';
    return room.players.every((p, i) => p.done || gone(room, i, t)) ? 'over' : 'playing';
  }
  function view(room: Room, seat: number): RoomView {
    const t = now(); const host = hostSeat(room); const status = statusOf(room);
    const v: RoomView = {
      code: room.code, game: room.game, status, round: room.round, verified: games[room.game]!.verified, you: seat,
      elapsed: status === 'waiting' ? 0 : Math.max(0, Math.round((t - room.startedAt) / 1000)),
      // tokens are the players' keys to the room: they never leave the server
      players: room.players.map((p, i) => ({ name: p.name, host: i === host, score: p.score, done: p.done, progress: p.progress, away: gone(room, i, t) })),
    };
    if (seat >= 0 && status !== 'waiting') v.deal = games[room.game]!.deal(room.seed);
    return v;
  }
  function touch(room: Room, seat: number) { const t = now(); room.touched = t; const me = room.players[seat]; if (me) me.seen = t; }
  function newCode(): string | null {
    for (let tries = 0; tries < 50; tries++) {
      const bytes = Buffer.from(hex(5), 'hex'); let c = '';
      for (let i = 0; i < 5; i++) c += ALPHABET[bytes[i]! % ALPHABET.length];
      if (!rooms.has(c)) return c;
    }
    return null;
  }
  const blank = (name: string, t: number): Player => ({ name, token: hex(16), seen: t, left: false, score: null, done: false, progress: 0 });

  const api = {
    games: () => Object.keys(games),

    create(game: unknown, name: unknown): Seat | Fail {
      if (typeof game !== 'string' || !Object.prototype.hasOwnProperty.call(games, game)) return fail('bad_game', 400);
      const t = now(); sweep(t);
      if (rooms.size >= MAX_ROOMS) return fail('busy', 503);
      const code = newCode();
      if (!code) return fail('busy', 503);
      const me = blank(cleanName(name), t);
      rooms.set(code, { code, game, status: 'waiting', round: 0, seed: '', startedAt: 0, touched: t, players: [me] });
      return { code, token: me.token, seat: 0, game };
    },

    join(code: unknown, name: unknown): Seat | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      if (room.status !== 'waiting') return fail('started', 409);
      if (room.players.filter((p) => !p.left).length >= MAX_PLAYERS) return fail('full', 409);
      const t = now(); const base = cleanName(name);
      // two players with one name would be impossible to tell apart
      const taken = (x: string) => room.players.some((p) => !p.left && p.name.toLowerCase() === x.toLowerCase());
      let n = base;
      for (let k = 2; taken(n); k++) n = `${Array.from(base).slice(0, 13).join('').trim()} ${k}`;
      const me = blank(n, t);
      room.players.push(me); room.touched = t;
      return { code: room.code, token: me.token, seat: room.players.length - 1, game: room.game };
    },

    get(code: unknown, token: unknown): RoomView | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat >= 0) touch(room, seat);
      return view(room, seat);
    },

    start(code: unknown, token: unknown): RoomView | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0 || seat !== hostSeat(room)) return fail('not_host', 403);
      if (room.status !== 'waiting') return fail('started', 409);
      if (room.players.filter((p) => !p.left).length < 2) return fail('need_two', 409);
      const t = now();
      room.status = 'playing'; room.round += 1; room.seed = hex(16); room.startedAt = t;
      for (const p of room.players) { p.score = null; p.done = false; p.progress = 0; p.seen = t; }
      touch(room, seat);
      return view(room, seat);
    },

    /** How far a player has got. Display only: it never decides anything. */
    progress(code: unknown, token: unknown, value: unknown): RoomView | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0) return fail('not_in_room', 403);
      if (statusOf(room) !== 'playing') return fail('not_playing', 409);
      const me = room.players[seat]!;
      const n = Math.floor(Number(value));
      // only ever forward, and never past what the game allows
      if (Number.isFinite(n) && !me.done) me.progress = Math.max(me.progress, Math.min(games[room.game]!.maxProgress, Math.max(0, n)));
      touch(room, seat);
      return view(room, seat);
    },

    /** A player's finished run. The game's own rules score it. */
    async finish(code: unknown, token: unknown, proof: unknown): Promise<RoomView | Fail> {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0) return fail('not_in_room', 403);
      if (room.status !== 'playing' || now() - room.startedAt > ROUND_MAX_MS) return fail('not_playing', 409);
      const me = room.players[seat]!;
      if (me.done) return fail('already_done', 409);
      const round = room.round;
      const res = await games[room.game]!.score(room.seed, proof, now() - room.startedAt);
      if (!res.ok) return fail('bad_run', 422, res.error);
      // the score took time to work out: make sure it is still the same round
      if (room.round !== round || room.status !== 'playing' || me.done) return fail('not_playing', 409);
      me.score = res.score; me.done = true; me.progress = games[room.game]!.maxProgress;
      touch(room, seat);
      // 'over' is never stored while a round is on: it is worked out each time, so
      // a friend whose phone went quiet can still come back and finish
      return view(room, seat);
    },

    rematch(code: unknown, token: unknown): RoomView | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0 || seat !== hostSeat(room)) return fail('not_host', 403);
      if (statusOf(room) !== 'over') return fail('not_over', 409);
      // the people who left are gone for good; everyone else goes back to the lobby
      room.players = room.players.filter((p) => !p.left);
      room.status = 'waiting';
      for (const p of room.players) { p.score = null; p.done = false; p.progress = 0; }
      const mine = room.players.findIndex((p) => p.token === token);
      touch(room, mine);
      return view(room, mine);
    },

    leave(code: unknown, token: unknown): { ok: true } | Fail {
      const room = find(code);
      if (!room) return { ok: true };
      const seat = seatOf(room, token);
      if (seat < 0) return { ok: true };
      if (room.status === 'waiting') room.players.splice(seat, 1);
      else room.players[seat]!.left = true;
      room.touched = now();
      if (room.players.every((p) => p.left) || room.players.length === 0) rooms.delete(room.code);
      return { ok: true };
    },

    count: () => rooms.size,

    /** Put back the rooms that were open before a restart. Rooms that have
     *  gone stale, are for a game this server no longer has, or clash with a
     *  room already open are skipped. Returns how many came back. */
    restore(list: unknown): number {
      if (!Array.isArray(list)) return 0;
      const t = now(); let n = 0;
      for (const r of list as Room[]) {
        if (!r || typeof r.code !== 'string' || !Array.isArray(r.players) || rooms.has(r.code)) continue;
        if (!Object.prototype.hasOwnProperty.call(games, r.game) || t - r.touched > ROOM_TTL_MS || rooms.size >= MAX_ROOMS) continue;
        rooms.set(r.code, r); n++;
      }
      return n;
    },
  };

  // Every change that matters is written down: who is in the room, the round,
  // the scores. Progress and polling are not; they are remade within a second.
  const keep = opts.keep;
  if (!keep) return api;
  const record = (code: unknown) => { const c = String(code ?? '').toUpperCase(); const r = rooms.get(c); try { if (r) keep.save(r); else keep.remove(c); } catch { /* best effort */ } };
  const then = <T>(out: T | Promise<T>, code: (o: T) => unknown): void => { void Promise.resolve(out).then((o) => { if (!isFail(o)) record(code(o)); }).catch(() => {}); };
  return {
    ...api,
    create(game: unknown, name: unknown) { const out = api.create(game, name); then(out, (o) => (o as Seat).code); return out; },
    join(code: unknown, name: unknown) { const out = api.join(code, name); then(out, () => code); return out; },
    start(code: unknown, token: unknown) { const out = api.start(code, token); then(out, () => code); return out; },
    finish(code: unknown, token: unknown, proof: unknown) { const out = api.finish(code, token, proof); then(out, () => code); return out; },
    rematch(code: unknown, token: unknown) { const out = api.rematch(code, token); then(out, () => code); return out; },
    leave(code: unknown, token: unknown) { const out = api.leave(code, token); then(out, () => code); return out; },
  };
}
export type RoomService = ReturnType<typeof createRoomService>;
