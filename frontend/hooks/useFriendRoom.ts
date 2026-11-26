"use client";

import { openRoomSocket, type RoomSocket } from "@/lib/roomSocket";

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
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useIsMiniPay } from "@/hooks/useMiniPay";

/** A finished round on its way to the chain: only for a signed-in seat, in a game the server scores itself. */
export interface ChainNote { state: "sending" | "recorded" | "failed"; tx?: string }
export type LiveState = Record<string, number | number[] | number[][]>;
export interface RoomPlayer { live?: LiveState; name: string; host: boolean; score: number | null; done: boolean; progress: number; away: boolean; /** the signed-in player in this seat, when there is one */ wallet?: string; chain?: ChainNote }
export type StakeState = "collecting" | "ready" | "playing" | "settling" | "settled" | "void";
export type PayState = "paid" | "unpaid" | "expired";
/** A room played for G$. Nobody's money is held: each loser's entry goes straight to the winner when the round ends. */
export interface RoomStake { entryWei: string; feeBps: number; state: StakeState; signed: boolean[]; winnerSeat: number; pays: (PayState | null)[]; txs: (string | null)[] }
export interface ChatLine { id: number; seat: number; name: string; text: string; at: number }
export interface RoomView {
  code: string; game: string; status: "waiting" | "playing" | "over"; round: number; verified: boolean; you: number; elapsed: number; players: RoomPlayer[]; deal?: unknown;
  /** people looking on */
  watching?: number;
  /** the room's public watch name: a link built from it lets people look on, never join */
  watchId?: string;
  chat?: ChatLine[];
  /** this room can be played for G$ */
  stakes?: boolean;
  stakeTerms?: { spender: string; entries: string[]; feeBps: number };
  stake?: RoomStake;
}
/** whole G$ from wei, for display */
export const gd = (wei: string | bigint): number => Number(BigInt(wei) / 10n ** 15n) / 1000;
/** what the winner gains from the others, after the fee */
export const winnerGain = (entryWei: string, feeBps: number, players: number): number => Math.floor(gd(entryWei) * Math.max(0, players - 1) * (1 - feeBps / 10000));
interface Session { code: string; token: string; seat: number; game: string }

const WORDS: Record<string, string> = {
  no_room: "That room does not exist. Check the code.",
  started: "That round has already started.",
  full: "That room is full (4 players).",
  need_two: "You need at least 2 players to start.",
  not_host: "Only the host can do that.",
  bad_run: "The server could not accept that run.",
  already_done: "Your result for this round is already in.",
  unreachable: "Cannot reach the game server. Check your connection.",
  busy: "The server is busy. Try again in a moment.",
  slow_down: "You have made a lot of rooms. Wait a few minutes and try again.",
  stake_pending: "Not everyone has agreed to the entry yet.",
  stakes_off: "Playing for G$ is not available right now.",
  not_verified: "This game cannot be played for G$.",
  bad_entry: "That entry is not on offer.",
  wallet_taken: "That wallet is already in this room.",
  not_allowed: "This wallet cannot play for G$ right now.",
  bad_permit: "That signature could not be accepted. Try again.",
  locked: "The room changed. Try again.",
};
export const explainRoom = (code: string) => WORDS[code] ?? "Something went wrong. Try again.";

async function call<T>(path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/rooms/${path === "rooms" ? "rooms" : `rooms/${path}`}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json", ...(extra ?? {}) }, body: JSON.stringify(body) });
  } catch { throw new Error("unreachable"); }
  const data = await r.json().catch(() => ({ error: "unreachable" }));
  if (!r.ok || data?.error) throw Object.assign(new Error(data?.error || "unreachable"), { reason: typeof data?.reason === "string" ? data.reason : undefined });
  return data as T;
}

export function useFriendRoom(game: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether the lobby sheet is open lives here, not in the button that opens it:
  // a start screen can be redrawn (sign-in finishing, a banner arriving) and
  // would otherwise shut the sheet in the player's face.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  // a friend's link (?room=CODE) opens the sheet with the code filled in
  useEffect(() => {
    const c = (new URLSearchParams(window.location.search).get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (c.length === 5) { setInviteCode(c); setSheetOpen(true); window.history.replaceState(null, "", window.location.pathname); }
  }, []);
  // Who is taking the seat. A signed-in player's rounds are recorded on the
  // chain, so the site checks this before it tells the game server; a guest
  // sends nothing and simply plays.
  const { address } = useAccount();
  const { authenticated, getAccessToken } = usePrivy();
  const miniPay = useIsMiniPay();
  const who = useCallback(async (): Promise<Record<string, string>> => {
    if (!address) return {};
    if (miniPay) return { "x-room-wallet": address, "x-room-minipay": "1" };
    if (!authenticated) return {};
    try { const t = await getAccessToken(); return t ? { "x-room-wallet": address, "x-room-auth": t } : {}; } catch { return {}; }
  }, [address, authenticated, getAccessToken, miniPay]);
  const sess = useRef<Session | null>(null);
  sess.current = session;

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true); setError(null);
    // the server's own reason, when it gave one, says more than the code does
    try { return await fn(); } catch (e) { setError((e as { reason?: string }).reason ?? explainRoom((e as Error).message)); return null; } finally { setBusy(false); }
  }, []);

  // The live line: the server pushes this room the moment it changes. While
  // the line is up, asking is only a slow safety net; if it drops, the room
  // goes back to asking about once a second until it is back.
  const line = useRef<RoomSocket | null>(null);
  const [lineUp, setLineUp] = useState(false);
  useEffect(() => {
    if (!session) return;
    const s = openRoomSocket({ code: session.code, token: session.token }, {
      view: (v) => { if (v.you < 0) { setSession(null); setView(null); } else setView(v); },
      gone: () => { setSession(null); setView(null); setError("That room has closed."); },
      state: setLineUp,
    });
    line.current = s;
    return () => { s.close(); if (line.current === s) line.current = null; setLineUp(false); };
  }, [session]);

  // ask for the room: about once a second without the live line, now and then with it
  useEffect(() => {
    if (!session) return;
    let live = true;
    const tick = async () => {
      try { const v = await call<RoomView>(`${session.code}?token=${session.token}`); if (live) { setView(v); if (v.you < 0) { setSession(null); setView(null); } } }
      catch (e) { if (live && (e as Error).message === "no_room") { setSession(null); setView(null); setError("That room has closed."); } }
    };
    void tick();
    const id = window.setInterval(tick, lineUp ? 8000 : 1200);
    return () => { live = false; window.clearInterval(id); };
  }, [session, lineUp]);

  // leaving the page leaves the room, so friends are not left waiting on a ghost
  // Not at once, though: React also runs this when it only HIDES the screen for a
  // moment (a 3D scene loading its models does that), and leaving then would
  // throw the player out of a round that is just starting. So the goodbye waits
  // two seconds and is called off if the screen comes back.
  const goodbye = useRef<number | null>(null);
  useEffect(() => {
    if (goodbye.current != null) { window.clearTimeout(goodbye.current); goodbye.current = null; }
    return () => {
      goodbye.current = window.setTimeout(() => { goodbye.current = null; const s = sess.current; if (s) void call(`${s.code}/leave`, { token: s.token }).catch(() => {}); }, 2000);
    };
  }, []);

  const act = useCallback((path: string, extra: Record<string, unknown> = {}) => {
    const s = sess.current;
    if (!s) return Promise.resolve(null);
    return guard(async () => { const v = await call<RoomView>(`${s.code}/${path}`, { token: s.token, ...extra }); setView(v); return v; });
  }, [guard]);

  return {
    session, view, error, busy, live: lineUp,
    sheetOpen, inviteCode, openSheet: () => setSheetOpen(true), closeSheet: () => setSheetOpen(false),
    inRoom: !!session,
    isHost: !!view && view.you >= 0 && !!view.players[view.you]?.host,
    create: (name: string) => guard(async () => { const s = await call<Session>("rooms", { game, name }, await who()); setSession(s); return s; }),
    join: (code: string, name: string) => guard(async () => { const s = await call<Session>(`${code.trim().toUpperCase()}/join`, { name }, await who()); setSession(s); return s; }),
    start: () => act("start"),
    rematch: () => act("rematch"),
    // progress is a courtesy to the others: never let it surface an error
    // `live` is the player's screen as a few numbers, so people watching see the game itself (never text)
    progress: (n: number, live?: LiveState) => { const s = sess.current; if (!s) return; if (line.current?.progress(n, live)) return; void call(`${s.code}/progress`, { token: s.token, progress: n, ...(live ? { live } : {}) }).catch(() => {}); },
    finish: (proof: unknown) => act("finish", { proof }),
    // playing for G$: the host sets the entry, everyone signs, the host can call it off
    setEntry: (entryWei: string, permit: unknown) => act("stake", { entryWei, permit }),
    agreeEntry: (permit: unknown) => act("commit", { permit }),
    clearEntry: () => act("unstake"),
    say: (message: string | null) => setError(message),
    /** a line of room chat. Quiet on failure: chat must never get in the way of a round. */
    chat: async (text: string): Promise<boolean> => { const s = sess.current; if (!s) return false; if (line.current?.say(text)) return true; try { setView(await call<RoomView>(`${s.code}/say`, { token: s.token, text })); return true; } catch { return false; } },
    leave: () => { const s = sess.current; setSession(null); setView(null); setError(null); if (s) void call(`${s.code}/leave`, { token: s.token }).catch(() => {}); },
  };
}
export type FriendRoom = ReturnType<typeof useFriendRoom>;
