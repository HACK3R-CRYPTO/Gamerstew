"use client";

// ─── The live line, from the phone's side ────────────────────────────────────
// One socket to the game server for the room a player is in or watching. The
// server pushes the room the moment it changes, so a block, a pad or a chat
// line shows on the other screens at once.
//
// It looks after itself: it says hello, answers the server's pings by staying
// open, and if the line drops it tries again (after 1s, 2s, 4s, up to 8s) for
// as long as it is wanted. While it is down, the page that owns it goes back
// to asking the server once a second, so a weak connection slows a room down
// and never stops it.

import type { LiveState, RoomView } from "@/hooks/useFriendRoom";

export type Hello = { code: string; token: string } | { watch: string };
export interface RoomSocket { /** true while the line is up */ open(): boolean; progress(n: number, live?: LiveState): boolean; say(text: string): boolean; close(): void }

let where: Promise<string> | null = null;
const address = () => (where ??= fetch("/api/live").then((r) => r.json()).then((d) => (typeof d?.url === "string" ? d.url : "")).catch(() => ""));

/** `kind` picks the line: the shared rooms, or Street Strike's own lanes. */
export function openRoomSocket<V = RoomView>(hello: Hello, on: { view: (v: V) => void; gone?: () => void; state?: (up: boolean) => void }, kind: "rooms" | "strike" = "rooms"): RoomSocket {
  let ws: WebSocket | null = null; let wanted = true; let up = false; let wait = 1000; let again: ReturnType<typeof setTimeout> | null = null; let beat: ReturnType<typeof setInterval> | null = null;
  const set = (v: boolean) => { if (up !== v) { up = v; on.state?.(v); } };
  const send = (msg: unknown) => { if (!ws || ws.readyState !== WebSocket.OPEN || !up) return false; try { ws.send(JSON.stringify(msg)); return true; } catch { return false; } };
  const retry = () => { set(false); if (beat) { clearInterval(beat); beat = null; } if (!wanted || again) return; again = setTimeout(() => { again = null; void start(); }, wait); wait = Math.min(8000, wait * 2); };
  const start = async () => {
    const base = await address(); const url = base && kind === "strike" ? `${base.replace(/\/$/, "")}/strike` : base;
    if (!wanted || !url || typeof WebSocket === "undefined") return; // no live line here: the page keeps asking instead
    let s: WebSocket;
    try { s = new WebSocket(url); } catch { retry(); return; }
    ws = s;
    s.onopen = () => { try { s.send(JSON.stringify({ t: "hello", ...hello })); } catch { /* onclose follows */ } };
    s.onmessage = (e) => {
      let m: { t?: string; view?: V };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === "room" && m.view) { wait = 1000; set(true); on.view(m.view); if (!beat) beat = setInterval(() => send({ t: "ping" }), 25000); }
      else if (m.t === "gone") { wanted = false; set(false); on.gone?.(); try { s.close(); } catch { /* closed */ } }
      else if (m.t === "no") { try { s.close(); } catch { /* closed */ } }
    };
    s.onclose = () => { if (ws === s) ws = null; retry(); };
    s.onerror = () => { try { s.close(); } catch { /* closed */ } };
  };
  void start();
  return {
    open: () => up,
    progress: (n, live) => send({ t: "p", progress: n, ...(live ? { live } : {}) }),
    say: (text) => send({ t: "say", text }),
    close: () => { wanted = false; set(false); if (again) clearTimeout(again); if (beat) clearInterval(beat); try { ws?.close(); } catch { /* closed */ } ws = null; },
  };
}
