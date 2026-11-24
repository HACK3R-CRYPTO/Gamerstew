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

export interface Player { name: string; token: string; seen: number; left: boolean; score: number | null; done: boolean; progress: number; /** the wallet that paid this seat's entry */ wallet?: string }
export interface Room { code: string; game: string; status: 'waiting' | 'playing' | 'over'; round: number; seed: string; startedAt: number; touched: number; players: Player[]; /** the join code for this round's escrow; only players in the room are told it */ secret?: string; stake?: Stake }

// ─── Playing for G$ ──────────────────────────────────────────────────────────
// A room can carry an entry. The money never touches this server: every player
// pays into the DuelEscrow contract that is already live, and the contract pays
// the winner. This server's only power is to post the round's scores, and the
// contract works out the winner from them.
//
//   1. Friends gather in the room as usual.
//   2. The host opens an escrow room sized to exactly the players present, and
//      tells us its number. We read it from the chain and check every term.
//   3. Each friend pays in, then tells us; we check the chain shows their wallet.
//   4. When everyone has paid the escrow is full, and the round can start.
//   5. When the round ends we post the scores. The contract pays the winner.
//
// The escrow is always full before a round starts, because a full room is the
// only kind the contract lets us settle straight away. If someone backs out
// first, nobody plays and everyone is refunded once the escrow's deadline has
// passed. Should this server vanish, anyone can refund the room two days later.
//
// NOT SWITCHED ON. Nothing in the server passes `stakes` to this service, so no
// room can carry an entry today. The contract has had no independent audit, and
// an outside reviewer has raised three points about it. Two are handled here:
//   · ties pay the room's creator      → a tie is refunded, never sent (below)
//   · the join code can be read off the chain, so a stranger can take a seat
//                                      → a room with a stranger in it never
//                                        starts, and is refunded
// The third cannot be handled from here: one server key posts the scores, so
// whoever holds that key decides which player in a room is paid. Leave this
// off until the contracts have been audited.
export interface EscrowRoom { status: 'open' | 'resolved' | 'refunded'; creator: string; stakeWei: string; seedWei: string; feeBps: number; capacity: number; deadlineSec: number; joinCodeHash: string; useAllowlist: boolean; players: string[] }
export interface StakeChain {
  /** the escrow room as the chain has it, addresses lower-cased; null if there is none */
  room(id: number): Promise<EscrowRoom | null>;
  /** what the contract compares a join code against */
  codeHash(secret: string): string;
  /** post the scores, in the order of the escrow's own players; returns the transaction */
  resolve(id: number, scores: number[]): Promise<string>;
  refundAll(id: number): Promise<string>;
}
export interface StakeRules { chain: StakeChain; feeBps: number; minWei: bigint; maxWei: bigint }
export type StakeState = 'collecting' | 'ready' | 'playing' | 'settling' | 'paid' | 'refund_due' | 'refunding' | 'refunded';
export interface Stake { escrowId: number; stakeWei: string; feeBps: number; capacity: number; /** ms; after it, an unplayed room can be refunded */ deadline: number; state: StakeState; tries: number; tx?: string; winner?: string }
const settled = (st: Stake | undefined) => !st || st.state === 'paid' || st.state === 'refunded';
const WALLET = /^0x[a-f0-9]{40}$/;
export const STAKE_TRIES = 5;

export type FailCode = 'slow_down' | 'busy' | 'no_room' | 'started' | 'full' | 'not_host' | 'need_two' | 'not_in_room' | 'not_playing' | 'bad_game' | 'bad_run' | 'already_done' | 'not_over'
  | 'stakes_off' | 'not_verified' | 'locked' | 'bad_escrow' | 'bad_wallet' | 'wallet_taken' | 'not_paid' | 'stake_pending';
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
  /** true when this room can be played for G$ (the server allows it and the game's scores are the server's own) */
  stakes: boolean;
  /** the join code for the escrow. Only sent to players in the room, while it waits. */
  joinCode?: string;
  stake?: { escrowId: number; stakeWei: string; feeBps: number; capacity: number; deadline: number; state: StakeState; tx: string | null; /** who has paid, by seat */ paid: boolean[]; winnerSeat: number };
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

export function createRoomService(games: Record<string, GameRules>, opts: { now?: () => number; randomHex?: (bytes: number) => string; keep?: RoomKeeper; stakes?: StakeRules } = {}) {
  const now = opts.now ?? Date.now;
  const hex = opts.randomHex ?? ((n: number) => randomBytes(n).toString('hex'));
  const rooms = new Map<string, Room>();

  const find = (code: unknown) => rooms.get(String(code ?? '').toUpperCase());
  const seatOf = (room: Room, token: unknown) => (typeof token === 'string' && token.length === 32 ? room.players.findIndex((p) => p.token === token) : -1);
  const gone = (room: Room, i: number, t: number) => { const p = room.players[i]; return !p || p.left || t - p.seen >= AWAY_MS; };
  const hostSeat = (room: Room) => room.players.findIndex((p) => !p.left);
  // a room holding unsettled money is never forgotten
  const sweep = (t: number) => { for (const [c, r] of rooms) if (t - r.touched > ROOM_TTL_MS && settled(r.stake)) rooms.delete(c); };
  const usedEscrows = new Set<number>();
  let record: (code: unknown) => void = () => {};

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
      code: room.code, game: room.game, status, round: room.round, verified: games[room.game]!.verified, you: seat, stakes: !!opts.stakes && games[room.game]!.verified,
      elapsed: status === 'waiting' ? 0 : Math.max(0, Math.round((t - room.startedAt) / 1000)),
      // tokens are the players' keys to the room: they never leave the server
      players: room.players.map((p, i) => ({ name: p.name, host: i === host, score: p.score, done: p.done, progress: p.progress, away: gone(room, i, t) })),
    };
    if (seat >= 0 && status !== 'waiting') v.deal = games[room.game]!.deal(room.seed);
    if (seat >= 0 && status === 'waiting' && v.stakes && room.secret) v.joinCode = room.secret;
    const st = room.stake;
    if (st) v.stake = { escrowId: st.escrowId, stakeWei: st.stakeWei, feeBps: st.feeBps, capacity: st.capacity, deadline: Math.floor(st.deadline / 1000), state: st.state, tx: st.tx ?? null, paid: room.players.map((p) => !!p.wallet), winnerSeat: st.winner ? room.players.findIndex((p) => p.wallet === st.winner) : -1 };
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
      rooms.set(code, { code, game, status: 'waiting', round: 0, seed: '', startedAt: 0, touched: t, players: [me], secret: hex(16) });
      return { code, token: me.token, seat: 0, game };
    },

    join(code: unknown, name: unknown): Seat | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      if (room.status !== 'waiting') return fail('started', 409);
      if (!settled(room.stake)) return fail('locked', 409); // the escrow is sized to the players already here
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
      if (room.stake && !settled(room.stake)) {
        if (room.stake.state !== 'ready') return fail('stake_pending', 409); // not everyone has paid in
        room.stake.state = 'playing';
      }
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
      if (!settled(room.stake)) return fail('stake_pending', 409); // the last round's money is not settled yet
      delete room.stake; room.secret = hex(16);
      // the people who left are gone for good; everyone else goes back to the lobby
      room.players = room.players.filter((p) => !p.left);
      room.status = 'waiting';
      for (const p of room.players) { p.score = null; p.done = false; p.progress = 0; delete p.wallet; }
      const mine = room.players.findIndex((p) => p.token === token);
      touch(room, mine);
      return view(room, mine);
    },

    leave(code: unknown, token: unknown): { ok: true } | Fail {
      const room = find(code);
      if (!room) return { ok: true };
      const seat = seatOf(room, token);
      if (seat < 0) return { ok: true };
      // Backing out before the round starts: the escrow can no longer fill with
      // the players here, so nobody plays and everyone gets their entry back.
      if (room.status === 'waiting' && room.stake && !settled(room.stake)) { room.stake.state = 'refund_due'; room.players[seat]!.left = true; }
      else if (room.status === 'waiting') room.players.splice(seat, 1);
      else room.players[seat]!.left = true;
      room.touched = now();
      if ((room.players.every((p) => p.left) || room.players.length === 0) && settled(room.stake)) rooms.delete(room.code);
      return { ok: true };
    },

    /** The host has opened an escrow room for this round. Every term is read
     *  from the chain and checked; nothing the phone says about it is trusted. */
    async stake(code: unknown, token: unknown, escrowId: unknown, wallet: unknown): Promise<RoomView | Fail> {
      const cfg = opts.stakes;
      if (!cfg) return fail('stakes_off', 409);
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0 || seat !== hostSeat(room)) return fail('not_host', 403);
      if (room.status !== 'waiting') return fail('started', 409);
      if (!games[room.game]!.verified) return fail('not_verified', 409);
      if (!settled(room.stake)) return fail('locked', 409);
      const w = String(wallet ?? '').toLowerCase(); const id = Number(escrowId);
      if (!WALLET.test(w)) return fail('bad_wallet', 400);
      if (!Number.isSafeInteger(id) || id <= 0 || usedEscrows.has(id)) return fail('bad_escrow', 422, 'That escrow room cannot be used');
      const n = room.players.filter((p) => !p.left).length;
      if (n < 2) return fail('need_two', 409);
      const round = room.round;
      const e = await cfg.chain.room(id).catch(() => null);
      if (!e) return fail('bad_escrow', 422, 'Could not read that escrow room');
      // the read took time: make sure the room is as we left it
      if (find(code) !== room || room.status !== 'waiting' || room.round !== round || !settled(room.stake) || room.players.filter((p) => !p.left).length !== n || usedEscrows.has(id)) return fail('locked', 409);
      const t = now(); const dl = e.deadlineSec * 1000; let stakeWei: bigint;
      try { stakeWei = BigInt(e.stakeWei); } catch { return fail('bad_escrow', 422, 'Unreadable entry'); }
      const wrong =
        e.status !== 'open' ? 'It is already closed'
        : e.creator !== w || e.players.length !== 1 || e.players[0] !== w ? 'It was not opened by this wallet alone'
        : e.capacity !== n ? `It must hold exactly the ${n} players in this room`
        : stakeWei < cfg.minWei || stakeWei > cfg.maxWei ? 'That entry is outside the allowed range'
        : e.seedWei !== '0' ? 'It must not carry a prize on top'
        : e.feeBps !== cfg.feeBps ? 'It has the wrong fee'
        : e.useAllowlist ? 'It must not use an allowlist'
        : e.joinCodeHash.toLowerCase() !== cfg.chain.codeHash(room.secret ?? '').toLowerCase() ? 'It does not carry this room\'s join code'
        : dl < t + 3 * 60_000 || dl > t + 60 * 60_000 ? 'Its deadline must be between 3 and 60 minutes away'
        : null;
      if (wrong) return fail('bad_escrow', 422, wrong);
      usedEscrows.add(id);
      room.stake = { escrowId: id, stakeWei: e.stakeWei, feeBps: e.feeBps, capacity: e.capacity, deadline: dl, state: 'collecting', tries: 0 };
      for (const p of room.players) delete p.wallet;
      room.players[seat]!.wallet = w;
      touch(room, seat);
      return view(room, seat);
    },

    /** A player says they have paid in. The chain decides whether that is so. */
    async paid(code: unknown, token: unknown, wallet: unknown): Promise<RoomView | Fail> {
      const cfg = opts.stakes;
      if (!cfg) return fail('stakes_off', 409);
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0) return fail('not_in_room', 403);
      const st = room.stake;
      if (!st || room.status !== 'waiting') return fail('stake_pending', 409);
      if (st.state === 'ready') return view(room, seat);
      if (st.state !== 'collecting') return fail('stake_pending', 409);
      const w = String(wallet ?? '').toLowerCase();
      if (!WALLET.test(w)) return fail('bad_wallet', 400);
      if (room.players.some((p, i) => i !== seat && p.wallet === w)) return fail('wallet_taken', 409);
      const e = await cfg.chain.room(st.escrowId).catch(() => null);
      if (!e) return fail('bad_escrow', 422, 'Could not read the escrow room');
      if (find(code) !== room || room.stake !== st || st.state !== 'collecting' || room.status !== 'waiting') return fail('stake_pending', 409);
      if (e.status !== 'open' || !e.players.includes(w)) return fail('not_paid', 409);
      if (room.players.some((p, i) => i !== seat && p.wallet === w)) return fail('wallet_taken', 409);
      room.players[seat]!.wallet = w;
      // ready only when the escrow is full of exactly the people in this room
      const here = room.players.filter((p) => !p.left);
      if (here.length === st.capacity && e.players.length === st.capacity && here.every((p) => p.wallet && e.players.includes(p.wallet))) st.state = 'ready';
      touch(room, seat);
      return view(room, seat);
    },

    /** Move one room's money along: pay the winner once the round is over, or
     *  refund everyone when the round cannot be played. Safe to call any time,
     *  and as often as you like. */
    async settle(code: unknown): Promise<StakeState | null> {
      const cfg = opts.stakes; const room = find(code); const st = room?.stake;
      if (!cfg || !room || !st || settled(st) || st.state === 'settling' || st.state === 'refunding') return st?.state ?? null;
      const t = now();
      if ((st.state === 'collecting' || st.state === 'ready') && t > st.deadline) st.state = 'refund_due';
      if (st.state === 'playing' && statusOf(room) === 'over') {
        st.state = 'settling';
        try {
          const e = await cfg.chain.room(st.escrowId);
          if (!e) throw new Error('escrow unreadable');
          if (e.status !== 'open') st.state = e.status === 'resolved' ? 'paid' : 'refunded'; // settled already, by an earlier try or by hand
          else {
            // the contract wants the scores in ITS order of players, not ours
            const scores = e.players.map((w) => { const p = room.players.find((x) => x.wallet === w); return p && p.done && p.score ? Math.max(0, Math.round(p.score)) : 0; });
            // The contract breaks every tie in favour of whoever entered first,
            // and the host always enters first. So a tie for first place is
            // never sent to it: nobody is crowned and everyone is refunded.
            // The same goes for a round in which nobody scored.
            const top = Math.max(...scores);
            if (top === 0 || scores.filter((x) => x === top).length > 1) st.state = 'refund_due';
            else {
              st.tx = await cfg.chain.resolve(st.escrowId, scores);
              st.winner = e.players[scores.indexOf(top)]!; st.state = 'paid';
            }
          }
        } catch { st.tries += 1; st.state = st.tries >= STAKE_TRIES ? 'refund_due' : 'playing'; }
      }
      if (st.state === 'refund_due' && t > st.deadline + 15_000) {
        st.state = 'refunding';
        try {
          const e = await cfg.chain.room(st.escrowId);
          if (e && e.status !== 'open') st.state = e.status === 'resolved' ? 'paid' : 'refunded';
          else { st.tx = await cfg.chain.refundAll(st.escrowId); st.state = 'refunded'; }
        } catch { st.tries += 1; st.state = 'refund_due'; }
      }
      room.touched = Math.max(room.touched, t);
      record(room.code);
      return st.state;
    },

    /** Every room with money still to settle. Run on a timer. */
    async settleDue(): Promise<number> {
      let n = 0;
      for (const room of [...rooms.values()]) if (!settled(room.stake)) { n++; await api.settle(room.code).catch(() => {}); }
      return n;
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
        if (!Object.prototype.hasOwnProperty.call(games, r.game) || rooms.size >= MAX_ROOMS) continue;
        if (t - r.touched > ROOM_TTL_MS && settled(r.stake)) continue; // a stale room still holding money comes back, to be settled
        if (r.stake) usedEscrows.add(r.stake.escrowId);
        rooms.set(r.code, r); n++;
      }
      return n;
    },
  };

  // Every change that matters is written down: who is in the room, the round,
  // the scores. Progress and polling are not; they are remade within a second.
  const keep = opts.keep;
  if (!keep) return api;
  record = (code: unknown) => { const c = String(code ?? '').toUpperCase(); const r = rooms.get(c); try { if (r) keep.save(r); else keep.remove(c); } catch { /* best effort */ } };
  const then = <T>(out: T | Promise<T>, code: (o: T) => unknown): void => { void Promise.resolve(out).then((o) => { if (!isFail(o)) record(code(o)); }).catch(() => {}); };
  return {
    ...api,
    create(game: unknown, name: unknown) { const out = api.create(game, name); then(out, (o) => (o as Seat).code); return out; },
    join(code: unknown, name: unknown) { const out = api.join(code, name); then(out, () => code); return out; },
    start(code: unknown, token: unknown) { const out = api.start(code, token); then(out, () => code); return out; },
    finish(code: unknown, token: unknown, proof: unknown) { const out = api.finish(code, token, proof); then(out, () => code); return out; },
    rematch(code: unknown, token: unknown) { const out = api.rematch(code, token); then(out, () => code); return out; },
    leave(code: unknown, token: unknown) { const out = api.leave(code, token); then(out, () => code); return out; },
    stake(code: unknown, token: unknown, escrowId: unknown, wallet: unknown) { const out = api.stake(code, token, escrowId, wallet); then(out, () => code); return out; },
    paid(code: unknown, token: unknown, wallet: unknown) { const out = api.paid(code, token, wallet); then(out, () => code); return out; },
  };
}
export type RoomService = ReturnType<typeof createRoomService>;
