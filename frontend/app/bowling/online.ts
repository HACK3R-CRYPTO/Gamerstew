// ─── Street Strike online: the room, as the phone sees it ────────────────────
// A room is a friend lane. Everyone in it bowls at the same time on their own
// phone and watches the others' cards fill in. The phone asks the server for
// the room every second or so; there is no socket to drop.

/** One throw as it was released. With the tyre and the bottles still standing, it replays exactly. */
export interface Shot { tyre: string; x: number; angle: number; speed: number; spin: number }
export interface RoomPlayer { name: string; host: boolean; rolls: number[]; done: boolean; away: boolean; /** every throw of this round, in order */ throws?: Shot[] }
export interface Room { code: string; status: "waiting" | "playing" | "over"; round: number; frames: number; you: number; players: RoomPlayer[]; /** the lane's public watch name */ watchId?: string; watching?: number; /** the last lines of talk between the players */ chat?: { id: number; seat: number; name: string; text: string; at: number }[] }
export interface Session { code: string; token: string; seat: number }

const WORDS: Record<string, string> = {
  no_room: "That room does not exist. Check the code.",
  started: "That game has already started.",
  full: "That room is full (4 players).",
  need_two: "You need at least 2 players to start.",
  unreachable: "Cannot reach the game server. Check your connection.",
  busy: "The server is busy. Try again in a moment.",
  slow_down: "That was too fast. Wait a moment and try again.",
  not_in_room: "You are not in that room any more.",
  say_something: "Type something first.",
};
export const explain = (code: string) => WORDS[code] ?? "Something went wrong. Try again.";

async function call<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/strike/${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("unreachable");
  }
  const data = await r.json().catch(() => ({ error: "unreachable" }));
  if (!r.ok || data?.error) throw new Error(data?.error || "unreachable");
  return data as T;
}

export const net = {
  create: (name: string) => call<Session>("rooms", { name }),
  join: (code: string, name: string) => call<Session>(`rooms/${code}/join`, { name }),
  get: (s: Session) => call<Room>(`rooms/${s.code}?token=${s.token}`),
  start: (s: Session) => call<Room>(`rooms/${s.code}/start`, { token: s.token }),
  // the throws go with the rolls, so someone watching can replay each one in their own street
  roll: (s: Session, rolls: number[], throws?: Shot[]) => call<Room>(`rooms/${s.code}/roll`, { token: s.token, rolls, ...(throws ? { throws } : {}) }),
  /** a lane as a spectator sees it, by its watch name or its code */
  watch: (by: string) => call<Room>(`rooms/${by}?watch=1`),
  rematch: (s: Session) => call<Room>(`rooms/${s.code}/rematch`, { token: s.token }),
  say: (s: Session, text: string) => call<Room>(`rooms/${s.code}/say`, { token: s.token, text }),
  leave: (s: Session) => call<{ ok: true }>(`rooms/${s.code}/leave`, { token: s.token }).catch(() => ({ ok: true as const })),
};
