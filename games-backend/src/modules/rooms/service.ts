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

/** How a seat's finished round went on its way to the chain. */
export type ChainNote = { state: 'sending' | 'recorded' | 'failed'; tx?: string };
/** Puts one server-checked round on the chain for a signed-in player, and saves
 *  it like any solo run (activity, XP, missions). Null = not recorded. */
export type RecordRun = (run: { account: string; game: string; score: number; ref: string; ms: number }) => Promise<{ txHash: string } | null>;
/** What a player's screen looks like right now, as a handful of numbers: enough
 *  for a spectator's page to draw the game, never enough to play it for them.
 *  Numbers only, so nothing a player types can reach someone else's screen. */
export type LiveState = Record<string, number | number[] | number[][]>;
export function cleanLive(raw: unknown): LiveState | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e7, Math.min(1e7, Math.round(v * 100) / 100)) : null);
  const out: LiveState = {}; let keys = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (keys >= 8 || !/^[a-z]{1,6}$/.test(k)) continue;
    const n = num(v);
    if (n !== null) { out[k] = n; keys++; continue; }
    if (!Array.isArray(v)) continue;
    const rows = v.slice(0, 12);
    if (rows.every((x) => num(x) !== null)) { out[k] = rows.map((x) => num(x)!); keys++; }
    else if (rows.every((x) => Array.isArray(x) && x.length <= 6 && x.every((y) => num(y) !== null))) { out[k] = rows.map((x) => (x as unknown[]).map((y) => num(y)!)); keys++; }
  }
  return keys ? out : undefined;
}
export interface Player { live?: LiveState; name: string; token: string; seen: number; left: boolean; score: number | null; done: boolean; progress: number; /** the signed-in wallet this seat plays as (the site checked it at the door). Not the same thing as `wallet`, which is a signed stake. */ account?: string; /** this round's trip to the chain */ chain?: ChainNote; /** the wallet staking for this seat, and its signed permit */ wallet?: string; permit?: Permit }
export interface Room { code: string; game: string; status: 'waiting' | 'playing' | 'over'; round: number; seed: string; startedAt: number; touched: number; players: Player[]; stake?: Stake; /** a second, public name for the room. It lets anyone WATCH and can never be used to join. */ watch?: string; chat?: ChatLine[] }
/** One line of room chat. `seat` is who said it. */
export interface ChatLine { id: number; seat: number; name: string; text: string; at: number }
export const CHAT_KEEP = 40;
export const CHAT_MAX = 140;
export const CHAT_GAP_MS = 700;
/** A room as the "live now" list shows it. No code: a stranger can watch, not join. */
export interface LiveRoom { watch: string; game: string; status: Room['status']; round: number; elapsed: number; players: string[]; watching: number; stake: boolean }

// ─── Playing for G$ ──────────────────────────────────────────────────────────
// A room can carry an entry, and NOBODY'S MONEY IS HELD: not by this server and
// not by a contract. There is no pot to drain.
//
//   1. Friends gather in the room as usual. The host picks an entry.
//   2. Each player signs a permit: "GameArena may move up to <entry> of my G$
//      until <time>". That is a signature, not a payment. We check it is
//      genuine, current, and that the wallet holds the entry.
//   3. When everyone has signed, the round can start.
//   4. When the round ends, each loser's permit is used once to send their
//      entry straight from their wallet to the winner (less the fee). The
//      winner's own permit is never used and runs out by itself.
//
// A tie for first place, or a round nobody scores in, moves no money at all.
// Backing out before the start costs nothing either: nothing was ever taken.
//
// The one thing this cannot stop is a loser emptying their wallet before the
// round ends. Their payment then fails; it is recorded as unpaid against their
// wallet, so they can be kept out of staked rooms. The entry sizes are small on
// purpose.
//
// A permit is worth exactly one entry, so it can never be charged twice, and it
// is only good for the wallet that signed it. If this server's key were stolen,
// the most a thief could take is the permits live at that moment.
export interface Permit { owner: string; value: string; deadline: number; v: number; r: string; s: string }
export interface StakePay {
  /** Is this permit good right now? Signed by `owner` for this server, for exactly this value, not used, not run out, and the wallet holds that much. */
  check(p: Permit): Promise<{ ok: true } | { ok: false; why: string }>;
  /** Use a loser's permit: `winnerWei` to the winner, `feeWei` to the treasury. `ok: false` means the money is not there (a definite no); a thrown error means try again. */
  collect(p: Permit, winner: string, winnerWei: string, feeWei: string): Promise<{ ok: true; tx: string } | { ok: false; why: string }>;
  /** May this wallet play for G$? (verified, and not kept out for an unpaid entry) */
  allowed?(wallet: string): Promise<boolean>;
}
export interface StakeRules { pay: StakePay; feeBps: number; /** the entries a host may pick, in wei */ entries: string[]; /** who the permits are made out to */ spender: string }
export type StakeState = 'collecting' | 'ready' | 'playing' | 'settling' | 'settled' | 'void';
export type PayState = 'paid' | 'unpaid' | 'expired';
export interface Stake { entryWei: string; feeBps: number; state: StakeState; tries: number; /** the winner's wallet */ winner?: string; /** by wallet: how each loser's payment went */ results?: Record<string, { pay: PayState; tx?: string; why?: string }> }
/** nothing left to do for this stake */
const settled = (st: Stake | undefined) => !st || st.state === 'settled' || st.state === 'void';
/** a round has been played for G$ and its payments are not all made */
const owing = (st: Stake | undefined) => !!st && (st.state === 'playing' || st.state === 'settling');
const WALLET = /^0x[a-f0-9]{40}$/;
export const STAKE_TRIES = 5;
/** a permit must outlast the longest round, with room to settle */
export const PERMIT_MIN_MS = 20 * 60 * 1000;
export const PERMIT_MAX_MS = 60 * 60 * 1000;

export type FailCode = 'slow_down' | 'busy' | 'no_room' | 'started' | 'full' | 'not_host' | 'need_two' | 'not_in_room' | 'not_playing' | 'bad_game' | 'bad_run' | 'already_done' | 'not_over'
  | 'stakes_off' | 'not_verified' | 'locked' | 'bad_entry' | 'bad_permit' | 'wallet_taken' | 'not_allowed' | 'stake_pending';
export interface Fail { error: FailCode; status: number; reason?: string }
export interface Seat { code: string; token: string; seat: number; game: string }
export interface RoomView {
  code: string; game: string; status: Room['status']; round: number; verified: boolean;
  /** the caller's seat, or -1 for a stranger */
  you: number;
  /** people looking on without a seat, seen in the last few seconds */
  watching: number;
  /** the room's public watch name, for a link that lets people look on without being able to join */
  watchId: string;
  /** the last lines of room chat */
  chat: ChatLine[];
  /** the progress value that means "finished" in this game, for drawing a bar */
  goal: number;
  /** seconds since the round began, by the server's clock */
  elapsed: number;
  players: { name: string; host: boolean; score: number | null; done: boolean; progress: number; away: boolean; /** their screen right now, as numbers, for a spectator's page to draw */ live?: LiveState; /** the signed-in player in this seat (a public address), so the others can add them as a friend. Sent to players in the room only. */ wallet?: string; /** this round on the chain, for a signed-in seat in a server-checked game */ chain?: ChainNote }[];
  /** the round's deal. Only sent to players in the room, and only once it has started. */
  deal?: unknown;
  /** true when this room can be played for G$ (the server allows it and the game's scores are the server's own) */
  stakes: boolean;
  /** what a phone needs to sign a permit: who to make it out to, the entries on offer, the fee */
  stakeTerms?: { spender: string; entries: string[]; feeBps: number };
  stake?: { entryWei: string; feeBps: number; state: StakeState; /** who has signed, by seat */ signed: boolean[]; winnerSeat: number; /** by seat: how each loser's payment went (null: not a loser, or not settled yet) */ pays: (PayState | null)[]; txs: (string | null)[] };
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
/** A wallet address, lower-cased, or nothing. */
function cleanAccount(a: unknown): string | null { return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null; }

export interface RoomKeeper { save(room: Room): void; remove(code: string): void }

export function createRoomService(games: Record<string, GameRules>, opts: { now?: () => number; randomHex?: (bytes: number) => string; keep?: RoomKeeper; stakes?: StakeRules; /** records a checked round on the chain; rounds are not recorded when it is not given */ onChain?: RecordRun } = {}) {
  const now = opts.now ?? Date.now;
  const hex = opts.randomHex ?? ((n: number) => randomBytes(n).toString('hex'));
  const rooms = new Map<string, Room>();

  const find = (code: unknown) => rooms.get(String(code ?? '').toUpperCase());
  const WATCH_ID = /^[0-9a-f]{8}$/;
  const watchName = (room: Room) => (room.watch ??= hex(4));
  const findWatch = (id: string) => { for (const r of rooms.values()) if (r.watch === id) return r; return undefined; };
  const lastSaid = new Map<string, number>(); // token -> when they last spoke
  const seatOf = (room: Room, token: unknown) => (typeof token === 'string' && token.length === 32 ? room.players.findIndex((p) => p.token === token) : -1);
  const gone = (room: Room, i: number, t: number) => { const p = room.players[i]; return !p || p.left || t - p.seen >= AWAY_MS; };
  const hostSeat = (room: Room) => room.players.findIndex((p) => !p.left);
  // a round played for G$ is never forgotten before its payments are made
  const sweep = (t: number) => { for (const [c, r] of rooms) if (t - r.touched > ROOM_TTL_MS && !owing(r.stake)) rooms.delete(c); };
  let record: (code: unknown) => void = () => {};
  const chainDone = (code: string) => record(code); // keep the room's saved copy in step once a round's transaction is known

  /** A round is over when everyone still here has finished, or it has run too
   *  long. Worked out fresh each time, so a phone that went quiet never holds
   *  the others, and one that comes back can still finish. */
  function statusOf(room: Room): Room['status'] {
    if (room.status !== 'playing') return room.status;
    const t = now();
    if (t - room.startedAt > ROUND_MAX_MS) return 'over';
    return room.players.every((p, i) => p.done || gone(room, i, t)) ? 'over' : 'playing';
  }
  // People watching a room without a seat. Kept beside the rooms, never saved:
  // a restart simply starts the count again. A watcher is someone who looked
  // in the last WATCH_MS; the key is whatever tells two of them apart.
  const WATCH_MS = 8000; const MAX_WATCHERS = 200;
  const watchers = new Map<string, Map<string, number>>();
  function watchingNow(code: string, t: number): number {
    const w = watchers.get(code); if (!w) return 0;
    for (const [k, at] of w) if (t - at > WATCH_MS) w.delete(k);
    if (!w.size) watchers.delete(code);
    return w.size;
  }
  function noteWatcher(code: string, who: string, t: number) {
    if (watchers.size > 5000) watchers.clear(); // never let the count itself become the leak
    let w = watchers.get(code); if (!w) { w = new Map(); watchers.set(code, w); }
    if (w.size < MAX_WATCHERS || w.has(who)) w.set(who, t);
  }
  function view(room: Room, seat: number): RoomView {
    const t = now(); const host = hostSeat(room); const status = statusOf(room);
    const v: RoomView = {
      code: room.code, game: room.game, status, round: room.round, verified: games[room.game]!.verified, you: seat, watching: watchingNow(room.code, t), watchId: watchName(room), chat: (room.chat ?? []).slice(-30), goal: games[room.game]!.maxProgress, stakes: !!opts.stakes && games[room.game]!.verified,
      elapsed: status === 'waiting' ? 0 : Math.max(0, Math.round((t - room.startedAt) / 1000)),
      // tokens are the players' keys to the room: they never leave the server
      players: room.players.map((p, i) => ({ name: p.name, host: i === host, score: p.score, done: p.done, progress: p.progress, away: gone(room, i, t), ...(p.live ? { live: p.live } : {}), ...(seat >= 0 && p.account ? { wallet: p.account } : {}), ...(p.chain ? { chain: { ...p.chain } } : {}) })),
    };
    if (seat >= 0 && status !== 'waiting') v.deal = games[room.game]!.deal(room.seed);
    if (v.stakes && opts.stakes) v.stakeTerms = { spender: opts.stakes.spender, entries: opts.stakes.entries, feeBps: opts.stakes.feeBps };
    const st = room.stake;
    // signatures never leave the server: a phone only learns WHO has signed
    if (st) v.stake = { entryWei: st.entryWei, feeBps: st.feeBps, state: st.state, signed: room.players.map((p) => !!p.permit), winnerSeat: st.winner ? room.players.findIndex((p) => p.wallet === st.winner) : -1, pays: room.players.map((p) => (p.wallet && st.results?.[p.wallet]?.pay) || null), txs: room.players.map((p) => (p.wallet && st.results?.[p.wallet]?.tx) || null) };
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

  /** A permit as a phone sent it, checked: the right shape, the right amount,
   *  long enough to outlast a round, and good on the chain right now. */
  async function vet(cfg: StakeRules, raw: unknown, entryWei: string): Promise<Permit | Fail> {
    const r = (raw ?? {}) as Record<string, unknown>;
    const owner = String(r.owner ?? '').toLowerCase(); const deadline = Number(r.deadline); const v = Number(r.v);
    const hex32 = (x: unknown) => typeof x === 'string' && /^0x[0-9a-fA-F]{64}$/.test(x);
    if (!WALLET.test(owner) || !Number.isSafeInteger(deadline) || (v !== 27 && v !== 28) || !hex32(r.r) || !hex32(r.s)) return fail('bad_permit', 400, 'That is not a permit');
    if (String(r.value ?? '') !== entryWei) return fail('bad_permit', 422, 'The permit must be for exactly the entry');
    const t = now();
    if (deadline * 1000 < t + PERMIT_MIN_MS || deadline * 1000 > t + PERMIT_MAX_MS) return fail('bad_permit', 422, 'The permit must last between 20 and 60 minutes');
    const permit: Permit = { owner, value: entryWei, deadline, v, r: r.r as string, s: r.s as string };
    try {
      if (cfg.pay.allowed && !(await cfg.pay.allowed(owner))) return fail('not_allowed', 403);
      const res = await cfg.pay.check(permit);
      if (!res.ok) return fail('bad_permit', 422, res.why);
    } catch { return fail('bad_permit', 503, 'Could not check the permit. Try again.'); }
    return permit;
  }

  const api = {
    games: () => Object.keys(games),

    create(game: unknown, name: unknown, account?: unknown): Seat | Fail {
      if (typeof game !== 'string' || !Object.prototype.hasOwnProperty.call(games, game)) return fail('bad_game', 400);
      const t = now(); sweep(t);
      if (rooms.size >= MAX_ROOMS) return fail('busy', 503);
      const code = newCode();
      if (!code) return fail('busy', 503);
      const me = blank(cleanName(name), t);
      const acct = cleanAccount(account); if (acct) me.account = acct;
      rooms.set(code, { code, game, status: 'waiting', round: 0, seed: '', startedAt: 0, touched: t, players: [me] });
      return { code, token: me.token, seat: 0, game };
    },

    join(code: unknown, name: unknown, account?: unknown): Seat | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      if (room.status !== 'waiting') return fail('started', 409);
      if (room.stake && room.stake.state === 'ready') room.stake.state = 'collecting'; // a newcomer has not signed yet
      if (room.players.filter((p) => !p.left).length >= MAX_PLAYERS) return fail('full', 409);
      const t = now(); const base = cleanName(name);
      // two players with one name would be impossible to tell apart
      const taken = (x: string) => room.players.some((p) => !p.left && p.name.toLowerCase() === x.toLowerCase());
      let n = base;
      for (let k = 2; taken(n); k++) n = `${Array.from(base).slice(0, 13).join('').trim()} ${k}`;
      const me = blank(n, t);
      // one wallet, one seat: a second phone on the same account plays, but is not recorded twice
      const acct = cleanAccount(account); if (acct && !room.players.some((p) => !p.left && p.account === acct)) me.account = acct;
      room.players.push(me); room.touched = t;
      return { code: room.code, token: me.token, seat: room.players.length - 1, game: room.game };
    },

    /** A look at a room. With a seat's token it is that player's view. Without
     *  one it is a spectator's: the same scores and progress, never the deal.
     *  `watcher` (anything that tells one onlooker from another) counts them. */
    get(code: unknown, token: unknown, watcher?: unknown): RoomView | Fail {
      // by its watch name: always a spectator, and the reply never carries the code
      if (typeof code === 'string' && WATCH_ID.test(code)) {
        const seen = findWatch(code);
        if (!seen) return fail('no_room', 404);
        if (typeof watcher === 'string' && watcher) noteWatcher(seen.code, watcher.slice(0, 64), now());
        return { ...view(seen, -1), code: '' };
      }
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat >= 0) touch(room, seat);
      else if (typeof watcher === 'string' && watcher) noteWatcher(room.code, watcher.slice(0, 64), now());
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
        const here = room.players.filter((p) => !p.left); const t0 = now();
        // everyone here has signed, and every signature will outlast the round
        if (room.stake.state !== 'ready' || here.some((p) => !p.permit || p.permit.deadline * 1000 < t0 + ROUND_MAX_MS + 60_000)) return fail('stake_pending', 409);
        room.stake.state = 'playing';
      }
      const t = now();
      room.status = 'playing'; room.round += 1; room.seed = hex(16); room.startedAt = t;
      for (const p of room.players) { p.score = null; p.done = false; p.progress = 0; p.seen = t; delete p.live; }
      touch(room, seat);
      return view(room, seat);
    },

    /** How far a player has got. Display only: it never decides anything. */
    progress(code: unknown, token: unknown, value: unknown, live?: unknown): RoomView | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0) return fail('not_in_room', 403);
      if (statusOf(room) !== 'playing') return fail('not_playing', 409);
      const me = room.players[seat]!;
      const n = Math.floor(Number(value));
      // only ever forward, and never past what the game allows
      if (Number.isFinite(n) && !me.done) me.progress = Math.max(me.progress, Math.min(games[room.game]!.maxProgress, Math.max(0, n)));
      const shown = cleanLive(live); if (shown) me.live = shown;
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
      // A signed-in seat's round goes on the chain, like a solo run, when the
      // score is the server's own. It is sent after the answer, never before:
      // the round's result must not wait on the chain.
      if (opts.onChain && me.account && games[room.game]!.verified && res.score > 0) {
        const note: ChainNote = { state: 'sending' }; me.chain = note;
        const run = { account: me.account, game: room.game, score: res.score, ref: `${room.code}-${round}-${seat}-${hex(4)}`, ms: Math.max(1000, now() - room.startedAt) };
        void opts.onChain(run).then((out) => { if (out?.txHash) { note.state = 'recorded'; note.tx = out.txHash; } else note.state = 'failed'; }).catch(() => { note.state = 'failed'; }).finally(() => chainDone(room.code));
      }
      // 'over' is never stored while a round is on: it is worked out each time, so
      // a friend whose phone went quiet can still come back and finish
      return view(room, seat);
    },

    /** The room a code or a watch name belongs to, or nothing. */
    codeFor(by: unknown): string | null {
      if (typeof by === 'string' && WATCH_ID.test(by)) return findWatch(by)?.code ?? null;
      return find(by)?.code ?? null;
    },

    /** Rooms being played right now, for the "live" list. Busiest first. */
    live(limit = 20): LiveRoom[] {
      const t = now(); const out: LiveRoom[] = [];
      for (const room of rooms.values()) {
        const status = statusOf(room); const here = room.players.filter((p, i) => !p.left && !gone(room, i, t));
        if (status !== 'playing' || here.length < 2) continue; // only a real round between people
        out.push({ watch: watchName(room), game: room.game, status, round: room.round, elapsed: Math.max(0, Math.round((t - room.startedAt) / 1000)), players: here.map((p) => p.name), watching: watchingNow(room.code, t), stake: !!room.stake });
      }
      return out.sort((a, b) => b.watching - a.watching || a.elapsed - b.elapsed).slice(0, Math.max(1, Math.min(50, limit)));
    },

    /** Say something in the room. Players only; spectators read. */
    say(code: unknown, token: unknown, textRaw: unknown): RoomView | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0) return fail('not_in_room', 403);
      const text = Array.from(String(textRaw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, CHAT_MAX).join('');
      if (!text) return fail('bad_run', 400, 'Say something first');
      const t = now(); const key = room.players[seat]!.token;
      if (lastSaid.size > 20000) lastSaid.clear();
      if (t - (lastSaid.get(key) ?? 0) < CHAT_GAP_MS) return fail('slow_down', 429);
      lastSaid.set(key, t); touch(room, seat);
      const chat = (room.chat ??= []);
      chat.push({ id: (chat[chat.length - 1]?.id ?? 0) + 1, seat, name: room.players[seat]!.name, text, at: t });
      if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
      return view(room, seat);
    },

    rematch(code: unknown, token: unknown): RoomView | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0 || seat !== hostSeat(room)) return fail('not_host', 403);
      if (statusOf(room) !== 'over') return fail('not_over', 409);
      if (!settled(room.stake)) return fail('stake_pending', 409); // the last round's payments are still being made
      delete room.stake;
      // the people who left are gone for good; everyone else goes back to the lobby
      room.players = room.players.filter((p) => !p.left);
      room.status = 'waiting';
      for (const p of room.players) { p.score = null; p.done = false; p.progress = 0; delete p.wallet; delete p.permit; delete p.chain; }
      const mine = room.players.findIndex((p) => p.token === token);
      touch(room, mine);
      return view(room, mine);
    },

    leave(code: unknown, token: unknown): { ok: true } | Fail {
      const room = find(code);
      if (!room) return { ok: true };
      const seat = seatOf(room, token);
      if (seat < 0) return { ok: true };
      // Backing out before the start costs nothing: no money has moved. The
      // others carry on, and are ready again once everyone left has signed.
      if (room.status === 'waiting') {
        room.players.splice(seat, 1);
        const st = room.stake;
        if (st && !settled(st)) { const here = room.players.filter((p) => !p.left); st.state = here.length >= 2 && here.every((p) => p.permit) ? 'ready' : 'collecting'; }
      }
      else room.players[seat]!.left = true;
      room.touched = now();
      if ((room.players.every((p) => p.left) || room.players.length === 0) && !owing(room.stake)) rooms.delete(room.code);
      return { ok: true };
    },

    /** The host sets the entry for the next round, and signs for their own. */
    async stake(code: unknown, token: unknown, entryWei: unknown, permit: unknown): Promise<RoomView | Fail> {
      const cfg = opts.stakes;
      if (!cfg) return fail('stakes_off', 409);
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0 || seat !== hostSeat(room)) return fail('not_host', 403);
      if (room.status !== 'waiting') return fail('started', 409);
      if (!games[room.game]!.verified) return fail('not_verified', 409);
      const entry = String(entryWei ?? '');
      if (!cfg.entries.includes(entry)) return fail('bad_entry', 400);
      const checked = await vet(cfg, permit, entry);
      if (isFail(checked)) return checked;
      if (find(code) !== room || room.status !== 'waiting' || seatOf(room, token) !== hostSeat(room)) return fail('locked', 409);
      // a new entry is a new agreement: everyone signs again
      for (const p of room.players) { delete p.wallet; delete p.permit; }
      room.stake = { entryWei: entry, feeBps: cfg.feeBps, state: 'collecting', tries: 0 };
      const me = room.players[seatOf(room, token)]!; me.wallet = checked.owner; me.permit = checked;
      touch(room, seatOf(room, token));
      return view(room, seatOf(room, token));
    },

    /** The host calls the entry off. Nothing was taken, so nothing is owed. */
    unstake(code: unknown, token: unknown): RoomView | Fail {
      const room = find(code);
      if (!room) return fail('no_room', 404);
      const seat = seatOf(room, token);
      if (seat < 0 || seat !== hostSeat(room)) return fail('not_host', 403);
      if (room.status !== 'waiting') return fail('started', 409);
      delete room.stake;
      for (const p of room.players) { delete p.wallet; delete p.permit; }
      touch(room, seat);
      return view(room, seat);
    },

    /** A player signs up to the entry the host set. */
    async commit(code: unknown, token: unknown, permit: unknown): Promise<RoomView | Fail> {
      const cfg = opts.stakes;
      if (!cfg) return fail('stakes_off', 409);
      const room = find(code);
      if (!room) return fail('no_room', 404);
      if (seatOf(room, token) < 0) return fail('not_in_room', 403);
      const st = room.stake;
      if (!st || room.status !== 'waiting' || settled(st)) return fail('stake_pending', 409);
      const checked = await vet(cfg, permit, st.entryWei);
      if (isFail(checked)) return checked;
      const seat = seatOf(room, token);
      if (find(code) !== room || room.stake !== st || room.status !== 'waiting' || seat < 0) return fail('stake_pending', 409);
      if (room.players.some((p, i) => i !== seat && p.wallet === checked.owner)) return fail('wallet_taken', 409); // one wallet, one seat
      const me = room.players[seat]!; me.wallet = checked.owner; me.permit = checked;
      const here = room.players.filter((p) => !p.left);
      st.state = here.length >= 2 && here.every((p) => p.permit) ? 'ready' : 'collecting';
      touch(room, seat);
      return view(room, seat);
    },

    /** Make a finished round's payments: each loser's entry goes straight to
     *  the winner. Safe to call any time, and as often as you like. */
    async settle(code: unknown): Promise<StakeState | null> {
      const cfg = opts.stakes; const room = find(code); const st = room?.stake;
      if (!cfg || !room || !st || settled(st) || st.state === 'settling') return st?.state ?? null;
      if (st.state !== 'playing' || statusOf(room) !== 'over') return st.state;
      st.state = 'settling';
      const staked = room.players.filter((p) => p.wallet && p.permit);
      const scores = staked.map((p) => (p.done && p.score ? Math.max(0, Math.round(p.score)) : 0));
      const top = Math.max(0, ...scores);
      // one clear winner, or no money moves at all
      if (top === 0 || scores.filter((x) => x === top).length > 1) { st.state = 'void'; record(room.code); return st.state; }
      const winner = staked[scores.indexOf(top)]!;
      st.winner = winner.wallet!; st.results ??= {};
      const entry = BigInt(st.entryWei); const fee = (entry * BigInt(st.feeBps)) / 10_000n;
      let retry = false;
      for (const p of staked) {
        if (p === winner || st.results[p.wallet!]) continue; // the winner pays nobody; a payment already decided is never tried again
        if (p.permit!.deadline * 1000 <= now()) { st.results[p.wallet!] = { pay: 'expired', why: 'The permit ran out before the round was settled' }; continue; }
        try {
          const out = await cfg.pay.collect(p.permit!, winner.wallet!, String(entry - fee), String(fee));
          st.results[p.wallet!] = out.ok ? { pay: 'paid', tx: out.tx } : { pay: 'unpaid', why: out.why };
        } catch { retry = true; } // the chain did not answer: this one is tried again
      }
      if (retry && ++st.tries < STAKE_TRIES) st.state = 'playing';
      else {
        for (const p of staked) if (p !== winner && !st.results[p.wallet!]) st.results[p.wallet!] = { pay: 'unpaid', why: 'The payment could not be sent' };
        st.state = 'settled';
        // a signature has no use once the round is settled: do not keep it
        for (const p of room.players) delete p.permit;
      }
      room.touched = Math.max(room.touched, now());
      record(room.code);
      return st.state;
    },

    /** Every room with payments still to make. Run on a timer. */
    async settleDue(): Promise<number> {
      let n = 0;
      for (const room of [...rooms.values()]) if (room.stake && (room.stake.state === 'playing' || room.stake.state === 'settling')) { n++; await api.settle(room.code).catch(() => {}); }
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
        if (t - r.touched > ROOM_TTL_MS && !owing(r.stake)) continue; // a stale room with payments still to make comes back, to make them
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
    create(game: unknown, name: unknown, account?: unknown) { const out = api.create(game, name, account); then(out, (o) => (o as Seat).code); return out; },
    join(code: unknown, name: unknown, account?: unknown) { const out = api.join(code, name, account); then(out, () => code); return out; },
    start(code: unknown, token: unknown) { const out = api.start(code, token); then(out, () => code); return out; },
    finish(code: unknown, token: unknown, proof: unknown) { const out = api.finish(code, token, proof); then(out, () => code); return out; },
    rematch(code: unknown, token: unknown) { const out = api.rematch(code, token); then(out, () => code); return out; },
    leave(code: unknown, token: unknown) { const out = api.leave(code, token); then(out, () => code); return out; },
    stake(code: unknown, token: unknown, entryWei: unknown, permit: unknown) { const out = api.stake(code, token, entryWei, permit); then(out, () => code); return out; },
    unstake(code: unknown, token: unknown) { const out = api.unstake(code, token); then(out, () => code); return out; },
    commit(code: unknown, token: unknown, permit: unknown) { const out = api.commit(code, token, permit); then(out, () => code); return out; },
  };
}
export type RoomService = ReturnType<typeof createRoomService>;
