// ─── A player's own line ─────────────────────────────────────────────────────
// One socket per open app, for things that are for THIS player and cannot
// wait for them to look: today, an invite into a friend's room. Without it an
// invite sat in the bell until the player happened to open it, while the host
// waited in an empty room.
//
//   phone → { t: "hello", ticket }     who this is (see ticket.ts)
//   phone → { t: "ping" }              still here (also keeps the green dot lit)
//   server → { t: "ok" }               the line is open
//   server → { t: "invite", invite }   a friend is calling them into a room
//
// The line only ever carries messages TO the player. Nothing a phone sends on
// it changes anything, so a stolen ticket shows an attacker invites for ten
// minutes and nothing more.
//
// Like the room line it knows nothing about sockets beyond `Sock`, and one
// server holds every line in memory.
export interface Sock { send(data: string): void; close(): void }
export interface Conn { message(raw: string): void; closed(): void }
export const MAX_LINES = 10_000;
/** open tabs or phones one player may have on the line at once */
export const PER_WALLET = 4;
export const HELLO_MS = 6000;
export const MAX_MESSAGE = 512;
/** messages a phone may send in any ten seconds (it has nothing to say but "ping") */
export const BURST = 8;

type Line = { sock: Sock; wallet: string | null; born: number; sent: number[] };

export function createPersonalLine(deps: {
  verify: (ticket: unknown) => string | null;
  /** what is still waiting for this player, sent the moment their line opens */
  pending?: (wallet: string) => unknown[];
  /** the player's app is open */
  seen?: (wallet: string) => void;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const lines = new Map<string, Set<Line>>(); const all = new Set<Line>();
  const post = (l: Line, msg: unknown) => { try { l.sock.send(JSON.stringify(msg)); } catch { /* a dead socket is dropped when it closes */ } };
  const drop = (l: Line) => { all.delete(l); if (l.wallet) { const set = lines.get(l.wallet); if (set?.delete(l) && !set.size) lines.delete(l.wallet); } };
  const end = (l: Line) => { drop(l); try { l.sock.close(); } catch { /* already closed */ } };

  return {
    /** Send something to every open app of one player. Returns how many got it. */
    tell(wallet: string, msg: unknown): number {
      const set = lines.get(String(wallet).toLowerCase()); if (!set) return 0;
      for (const l of set) post(l, msg);
      return set.size;
    },
    stats: () => ({ players: lines.size, sockets: all.size }),
    /** Every few seconds: a connection that never said who it is is closed. */
    sweep() { const t = now(); for (const l of [...all]) if (!l.wallet && t - l.born > HELLO_MS) end(l); },

    connect(sock: Sock): Conn {
      const me: Line = { sock, wallet: null, born: now(), sent: [] }; let done = false;
      if (all.size >= MAX_LINES) { try { sock.send(JSON.stringify({ t: 'no', why: 'busy' })); sock.close(); } catch { /* gone */ } return { message() {}, closed() {} }; }
      all.add(me);
      const refuse = (why: string) => { if (done) return; done = true; post(me, { t: 'no', why }); end(me); };
      return {
        closed() { done = true; drop(me); },
        message(raw: string) {
          if (done) return;
          if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return refuse('too_big');
          const t = now(); while (me.sent.length && t - me.sent[0]! > 10_000) me.sent.shift();
          if (me.sent.push(t) > BURST) return refuse('slow_down');
          let msg: Record<string, unknown>;
          try { const p = JSON.parse(raw); if (typeof p !== 'object' || p === null) return; msg = p as Record<string, unknown>; } catch { return; }
          if (!me.wallet) {
            if (msg.t !== 'hello') return;
            const wallet = deps.verify(msg.ticket);
            if (!wallet) return refuse('bad_ticket');
            const set = lines.get(wallet) ?? new Set<Line>();
            // a fifth tab takes the place of the oldest one, so a new tab always works
            if (set.size >= PER_WALLET) { const oldest = [...set][0]!; set.delete(oldest); all.delete(oldest); oldest.wallet = null; try { oldest.sock.close(); } catch { /* already closed */ } }
            me.wallet = wallet; set.add(me); lines.set(wallet, set);
            post(me, { t: 'ok' });
            deps.seen?.(wallet);
            for (const invite of deps.pending?.(wallet) ?? []) post(me, { t: 'invite', invite });
            return;
          }
          if (msg.t === 'ping') deps.seen?.(me.wallet);
        },
      };
    },
  };
}
export type PersonalLine = ReturnType<typeof createPersonalLine>;
