// ─── Street Strike online rooms: the rules ───────────────────────────────────
// A friend lane: one player makes a room, shares its 5-letter code, and up to
// four people bowl AT THE SAME TIME, each on their own phone, watching each
// other's cards fill in. Nobody waits for a turn, so a slow connection or a
// slow friend never freezes the game.
//
// Free and casual: no stakes, no chain. The server keeps each player's rolls
// and checks they form a legal card that only ever grows; the phones do the
// physics. Every method returns either a result or a typed failure, never
// throws for a rule the caller can break.

import { randomBytes } from 'crypto';
import { cleanName, FRAMES, readCard } from './card';
import type { Room, RoomStore } from './store';

export const MAX_PLAYERS = 4;
export const MAX_ROOMS = 2000;
export const ROOM_TTL_MS = 20 * 60 * 1000; // nobody has polled it for 20 minutes: gone. A live room is touched every second or so
export const AWAY_MS = 30 * 1000; // no word from a phone for this long: stop waiting for it
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

export type FailCode = 'slow_down' | 'busy' | 'no_room' | 'started' | 'full' | 'not_host' | 'need_two' | 'not_in_room' | 'not_playing' | 'bad_card' | 'rewrite' | 'not_over';
export interface Fail { error: FailCode; status: number }
export interface Seat { code: string; token: string; seat: number }
export interface RoomView {
  code: string;
  status: Room['status'];
  round: number;
  frames: number;
  /** the caller's seat, or -1 for a stranger */
  you: number;
  players: { name: string; host: boolean; rolls: number[]; done: boolean; away: boolean }[];
}

const fail = (error: FailCode, status: number): Fail => ({ error, status });
export const isFail = (v: unknown): v is Fail => typeof v === 'object' && v !== null && 'error' in v;

export function createStrikeService(store: RoomStore, now: () => number = Date.now) {
  const find = (code: unknown) => store.get(String(code ?? '').toUpperCase());
  const seatOf = (room: Room, token: unknown) => (typeof token === 'string' && token.length === 32 ? room.players.findIndex((p) => p.token === token) : -1);
  const gone = (room: Room, i: number, t: number) => { const p = room.players[i]; return !p || p.left || t - p.seen >= AWAY_MS; };

  // The host is the first player who has not left, so a host walking out never
  // strands the room: the next player inherits start and rematch.
  const hostSeat = (room: Room) => room.players.findIndex((p) => !p.left);

  /** What the room looks like right now. A round is over when everyone still
   *  here has finished: a phone that went quiet does not hold the others. This is
   *  worked out fresh each time and never stored, so a player who comes back
   *  after a dropped connection can still finish their card. */
  function statusOf(room: Room): Room['status'] {
    if (room.status !== 'playing') return room.status;
    const t = now();
    return room.players.every((p, i) => p.done || gone(room, i, t)) ? 'over' : 'playing';
  }
  function view(room: Room, seat: number): RoomView {
    const t = now();
    const host = hostSeat(room);
    return {
      code: room.code,
      status: statusOf(room),
      round: room.round,
      frames: FRAMES,
      you: seat,
      // tokens are the players' keys to the room: they never leave the server
      players: room.players.map((p, i) => ({ name: p.name, host: i === host, rolls: p.rolls, done: p.done, away: gone(room, i, t) })),
    };
  }
  async function newCode(): Promise<string | null> {
    for (let tries = 0; tries < 50; tries++) {
      const bytes = randomBytes(5);
      let c = '';
      for (let i = 0; i < 5; i++) c += ALPHABET[bytes[i]! % ALPHABET.length];
      if (!(await store.get(c))) return c;
    }
    return null;
  }
  const newToken = () => randomBytes(16).toString('hex');

  return {
    async create(name: unknown): Promise<Seat | Fail> {
      const t = now();
      await store.sweep(t - ROOM_TTL_MS);
      if ((await store.count()) >= MAX_ROOMS) return fail('busy', 503);
      const code = await newCode();
      if (!code) return fail('busy', 503);
      const token = newToken();
      await store.put({ code, status: 'waiting', round: 0, touched: t, players: [{ name: cleanName(name), token, rolls: [], done: false, seen: t, left: false }] });
      return { code, token, seat: 0 };
    },

    async join(code: unknown, name: unknown): Promise<Seat | Fail> {
      const room = await find(code);
      if (!room) return fail('no_room', 404);
      if (room.status !== 'waiting') return fail('started', 409);
      if (room.players.length >= MAX_PLAYERS) return fail('full', 409);
      const t = now();
      const token = newToken();
      // two players with one name would be impossible to tell apart on the card
      const base = cleanName(name);
      const taken = (x: string) => room.players.some((p) => p.name.toLowerCase() === x.toLowerCase());
      let n = base;
      for (let k = 2; taken(n); k++) n = `${Array.from(base).slice(0, 12).join('').trim()} ${k}`;
      room.players.push({ name: n, token, rolls: [], done: false, seen: t, left: false });
      room.touched = t;
      await store.put(room);
      return { code: room.code, token, seat: room.players.length - 1 };
    },

    async get(code: unknown, token: unknown): Promise<RoomView | Fail> {
      const room = await find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      const me = room.players[seat];
      if (me) { me.seen = now(); room.touched = now(); }
      const v = view(room, seat);
      await store.put(room);
      return v;
    },

    async start(code: unknown, token: unknown): Promise<RoomView | Fail> {
      const room = await find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0 || seat !== hostSeat(room)) return fail('not_host', 403);
      if (room.status !== 'waiting') return fail('started', 409);
      if (room.players.filter((p) => !p.left).length < 2) return fail('need_two', 409);
      room.status = 'playing';
      room.round += 1;
      room.touched = now();
      await store.put(room);
      return view(room, seat);
    },

    async roll(code: unknown, token: unknown, rolls: unknown): Promise<RoomView | Fail> {
      const room = await find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      const p = room.players[seat];
      if (!p) return fail('not_in_room', 403);
      if (room.status !== 'playing') return fail('not_playing', 409);
      const card = readCard(rolls);
      if (!card) return fail('bad_card', 400);
      const next = rolls as number[];
      // a card only ever grows: the rolls already reported cannot change
      if (next.length < p.rolls.length || p.rolls.some((v, i) => next[i] !== v)) return fail('rewrite', 409);
      p.rolls = next.slice();
      p.done = card.done;
      p.seen = now();
      room.touched = now();
      const v = view(room, seat);
      await store.put(room);
      return v;
    },

    async rematch(code: unknown, token: unknown): Promise<RoomView | Fail> {
      const room = await find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0 || seat !== hostSeat(room)) return fail('not_host', 403);
      if (statusOf(room) !== 'over') return fail('not_over', 409);
      for (const p of room.players) { p.rolls = []; p.done = false; }
      room.status = 'playing';
      room.round += 1;
      room.touched = now();
      await store.put(room);
      return view(room, seat);
    },

    async leave(code: unknown, token: unknown): Promise<{ ok: true }> {
      const room = await find(code);
      if (!room) return { ok: true };
      const seat = seatOf(room, token);
      const p = room.players[seat];
      if (p) {
        // before the game, leaving simply frees the seat (the next player becomes
        // host if it was the host); once a game exists the card stays on the board
        if (room.status === 'waiting') room.players.splice(seat, 1);
        else p.left = true;
        if (room.players.length === 0) { await store.delete(room.code); return { ok: true }; }
        if (room.players.every((q) => q.left)) await store.delete(room.code);
        else await store.put(room);
      }
      return { ok: true };
    },
  };
}
export type StrikeService = ReturnType<typeof createStrikeService>;
