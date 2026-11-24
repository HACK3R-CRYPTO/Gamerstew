"use client";

// ─── useFriendRoom ───────────────────────────────────────────────────────────
// A friend room, as a game page sees it. One player opens a room and shares the
// code; everyone plays the same round at once and watches each other's progress.
//
//   const room = useFriendRoom("ladder");
//   room.create(name) / room.join(code, name)   → you are in the lobby
//   room.start()                                → host only, needs two players
//   room.view.deal                              → what this round dealt you
//   room.progress(n) / room.finish(proof)       → while you play, and at the end
//
// The phone asks the server for the room about once a second. There is no
// socket to drop, so a weak connection only makes the other players' progress
// arrive a little late.

import { useCallback, useEffect, useRef, useState } from "react";

export interface RoomPlayer { name: string; host: boolean; score: number | null; done: boolean; progress: number; away: boolean }
export interface RoomView { code: string; game: string; status: "waiting" | "playing" | "over"; round: number; verified: boolean; you: number; elapsed: number; players: RoomPlayer[]; deal?: unknown }
interface Session { code: string; token: string; seat: number; game: string }

const WORDS: Record<string, string> = {
  no_room: "That room does not exist. Check the code.",
  started: "That round has already started.",
  full: "That room is full (4 players).",
  need_two: "You need at least 2 players to start.",
  not_host: "Only the host can do that.",
  bad_run: "The server could not accept that run.",
  unreachable: "Cannot reach the game server. Check your connection.",
  busy: "The server is busy. Try again in a moment.",
  slow_down: "You have made a lot of rooms. Wait a few minutes and try again.",
};
export const explainRoom = (code: string) => WORDS[code] ?? "Something went wrong. Try again.";

async function call<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/rooms/${path === "rooms" ? "rooms" : `rooms/${path}`}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new Error("unreachable"); }
  const data = await r.json().catch(() => ({ error: "unreachable" }));
  if (!r.ok || data?.error) throw new Error(data?.error || "unreachable");
  return data as T;
}

export function useFriendRoom(game: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sess = useRef<Session | null>(null);
  sess.current = session;

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(explainRoom((e as Error).message)); return null; } finally { setBusy(false); }
  }, []);

  // ask for the room about once a second while we are in one
  useEffect(() => {
    if (!session) return;
    let live = true;
    const tick = async () => {
      try { const v = await call<RoomView>(`${session.code}?token=${session.token}`); if (live) { setView(v); if (v.you < 0) { setSession(null); setView(null); } } }
      catch (e) { if (live && (e as Error).message === "no_room") { setSession(null); setView(null); setError("That room has closed."); } }
    };
    void tick();
    const id = window.setInterval(tick, 1200);
    return () => { live = false; window.clearInterval(id); };
  }, [session]);

  // leaving the page leaves the room, so friends are not left waiting on a ghost
  useEffect(() => () => { const s = sess.current; if (s) void call(`${s.code}/leave`, { token: s.token }).catch(() => {}); }, []);

  const act = useCallback((path: string, extra: Record<string, unknown> = {}) => {
    const s = sess.current;
    if (!s) return Promise.resolve(null);
    return guard(async () => { const v = await call<RoomView>(`${s.code}/${path}`, { token: s.token, ...extra }); setView(v); return v; });
  }, [guard]);

  return {
    session, view, error, busy,
    inRoom: !!session,
    isHost: !!view && view.you >= 0 && !!view.players[view.you]?.host,
    create: (name: string) => guard(async () => { const s = await call<Session>("rooms", { game, name }); setSession(s); return s; }),
    join: (code: string, name: string) => guard(async () => { const s = await call<Session>(`${code.trim().toUpperCase()}/join`, { name }); setSession(s); return s; }),
    start: () => act("start"),
    rematch: () => act("rematch"),
    // progress is a courtesy to the others: never let it surface an error
    progress: (n: number) => { const s = sess.current; if (s) void call(`${s.code}/progress`, { token: s.token, progress: n }).catch(() => {}); },
    finish: (proof: unknown) => act("finish", { proof }),
    leave: () => { const s = sess.current; setSession(null); setView(null); setError(null); if (s) void call(`${s.code}/leave`, { token: s.token }).catch(() => {}); },
  };
}
export type FriendRoom = ReturnType<typeof useFriendRoom>;
