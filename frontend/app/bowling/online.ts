// ─── Street Strike online: the room, as the phone sees it ────────────────────
// A room is a friend lane. Everyone in it bowls at the same time on their own
// phone and watches the others' cards fill in. The phone asks the server for
// the room every second or so; there is no socket to drop.

export interface RoomPlayer { name: string; host: boolean; rolls: number[]; done: boolean; away: boolean }
export interface Room { code: string; status: "waiting" | "playing" | "over"; round: number; frames: number; you: number; players: RoomPlayer[] }
export interface Session { code: string; token: string; seat: number }

const WORDS: Record<string, string> = {
  no_room: "That room does not exist. Check the code.",
  started: "That game has already started.",
  full: "That room is full (4 players).",
  need_two: "You need at least 2 players to start.",
  unreachable: "Cannot reach the game server. Check your connection.",
  busy: "The server is busy. Try again in a moment.",
  slow_down: "You have made a lot of rooms. Wait a few minutes and try again.",
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
  roll: (s: Session, rolls: number[]) => call<Room>(`rooms/${s.code}/roll`, { token: s.token, rolls }),
  rematch: (s: Session) => call<Room>(`rooms/${s.code}/rematch`, { token: s.token }),
  leave: (s: Session) => call<{ ok: true }>(`rooms/${s.code}/leave`, { token: s.token }).catch(() => ({ ok: true as const })),
};
