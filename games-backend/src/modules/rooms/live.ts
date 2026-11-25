// ─── The live line ───────────────────────────────────────────────────────────
// A socket between a phone and the room it is in or watching. The server
// PUSHES the room the moment anything in it changes: a block landing, a pad
// pressed, a line of chat, a score. Nobody has to ask.
//
//   phone → { t: "hello", code, token }   a player, by their seat key
//   phone → { t: "hello", watch }         a spectator, by the room's watch name
//                                         (or its code, for a friend who has it)
//   phone → { t: "p", progress, live }    a player's screen, as numbers
//   phone → { t: "say", text }            a line of chat
//   server → { t: "room", view }          the room, as that phone may see it
//   server → { t: "gone" }                the room has closed
//
// Each phone is sent its own view: a player gets the deal, a spectator never
// does, and a spectator who came by the watch name is never told the code.
// Everything that needs a checked sign-in or moves money (taking a seat,
// starting, finishing, playing for G$) stays on the ordinary routes.
//
// The hub knows nothing about sockets beyond `Sock`, so it is tested with
// plain objects. One server holds every room in memory, so one hub reaches
// every phone; a second server would need a shared channel between hubs.

import { isFail, type RoomService, type RoomView } from './service';

export interface Sock { send(data: string): void; close(): void }
export interface Conn { /** a message from the phone, as text */ message(raw: string): void; /** the socket closed */ closed(): void }
export const MAX_PER_ROOM = 80;
export const MAX_SOCKETS = 5000;
export const MAX_MESSAGE = 4096;
export const HELLO_MS = 6000;
/** how many messages a phone may send in any two seconds */
export const BURST = 40;

type Member = { sock: Sock; code: string; token: string | null; by: string; key: string; last: string; sent: number[] };

export function createLiveHub(deps: { service: RoomService; now?: () => number; defer?: (fn: () => void) => void; onChange?: (code: string) => void }) {
  const { service } = deps; const now = deps.now ?? Date.now; const defer = deps.defer ?? ((fn) => { setImmediate(fn); });
  const rooms = new Map<string, Set<Member>>(); let total = 0; let seq = 0;
  const dirty = new Set<string>(); let flushing = false;

  function send(m: Member, msg: unknown) { try { m.sock.send(JSON.stringify(msg)); } catch { /* a dead socket is dropped when it closes */ } }
  function drop(m: Member) { const set = rooms.get(m.code); if (set?.delete(m)) { total--; if (!set.size) rooms.delete(m.code); } }

  /** Send everyone in a room what they may see, if it changed since they were last told. */
  function push(code: string) {
    const set = rooms.get(code); if (!set) return;
    for (const m of [...set]) {
      const v = m.token ? service.get(code, m.token) : service.get(m.by, undefined, m.key);
      if (isFail(v) || (m.token && (v as RoomView).you < 0)) { send(m, { t: 'gone' }); drop(m); try { m.sock.close(); } catch { /* already closed */ } continue; }
      const text = JSON.stringify(v);
      if (text === m.last) continue;
      m.last = text; send(m, { t: 'room', view: v });
    }
  }
  /** Something changed in this room. Changes made in the same instant go out as one message. */
  function publish(code: unknown) {
    const c = String(code ?? '').toUpperCase(); if (!rooms.has(c)) return;
    dirty.add(c);
    if (flushing) return; flushing = true;
    defer(() => { flushing = false; const list = [...dirty]; dirty.clear(); for (const x of list) push(x); });
  }

  return {
    publish,
    /** Once a second: clocks move, a player who went quiet is marked away, a round runs out of time. */
    tick() { for (const code of [...rooms.keys()]) push(code); },
    stats: () => ({ rooms: rooms.size, sockets: total }),

    /** A phone has connected. `who` tells two spectators apart (their address is enough). */
    connect(sock: Sock, who: string): Conn {
      let me: Member | null = null; let done = false; const born = now();
      const end = () => { if (done) return; done = true; if (me) drop(me); try { sock.close(); } catch { /* already closed */ } };
      const refuse = (why: string) => { try { sock.send(JSON.stringify({ t: 'no', why })); } catch { /* gone */ } end(); };
      const early: number[] = [];
      return {
        closed() { done = true; if (me) drop(me); },
        message(raw: string) {
          if (done) return;
          if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return refuse('too_big');
          const t = now(); const sent = me ? me.sent : early;
          while (sent.length && t - sent[0]! > 2000) sent.shift();
          if (sent.push(t) > BURST) return refuse('slow_down');
          let msg: Record<string, unknown>;
          try { const p = JSON.parse(raw); if (typeof p !== 'object' || p === null) return; msg = p as Record<string, unknown>; } catch { return; }

          if (!me) {
            if (msg.t !== 'hello') { if (t - born > HELLO_MS) refuse('say_hello'); return; }
            if (total >= MAX_SOCKETS) return refuse('busy');
            const token = typeof msg.token === 'string' && msg.token.length === 32 ? msg.token : null;
            const by = String(token ? msg.code ?? '' : msg.watch ?? msg.code ?? '');
            const code = service.codeFor(by);
            if (!code) return refuse('no_room');
            const key = `${String(who).slice(0, 48)}#${++seq}`;
            const first = token ? service.get(code, token) : service.get(by, undefined, key);
            if (isFail(first) || (token && first.you < 0)) return refuse('no_room');
            const set = rooms.get(code) ?? new Set<Member>();
            if (set.size >= MAX_PER_ROOM) return refuse('full');
            me = { sock, code, token, by: token ? code : by, key, last: JSON.stringify(first), sent: early };
            set.add(me); rooms.set(code, set); total++;
            send(me, { t: 'room', view: first });
            if (!token) publish(code); // the players see the watcher count go up
            return;
          }
          if (msg.t === 'ping') return send(me, { t: 'pong' });
          if (!me.token) return; // a spectator only listens
          if (msg.t === 'p') { const out = service.progress(me.code, me.token, msg.progress, msg.live); if (!isFail(out)) publish(me.code); return; }
          if (msg.t === 'say') { const out = service.say(me.code, me.token, msg.text); if (isFail(out)) send(me, { t: 'no', why: out.error }); else { deps.onChange?.(me.code); publish(me.code); } return; }
        },
      };
    },
  };
}
export type LiveHub = ReturnType<typeof createLiveHub>;
