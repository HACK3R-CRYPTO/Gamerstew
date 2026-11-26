"use client";

// ─── A player's own line, from the phone's side ──────────────────────────────
// One socket to the game server for things that are for this player and cannot
// wait for them to look: today, a friend inviting them into a room. The server
// only ever sends on it; the phone says hello with a short-lived ticket (given
// by the once-a-minute check-in, which a checked sign-in is needed for) and
// then only "still here".
//
// It looks after itself: closed while the tab is hidden, opened again when it
// shows, and retried (2s, 4s … up to 30s) when the line drops. If it can never
// open, nothing breaks: the check-in carries waiting invites too, a little later.

export interface OwnInvite { id: string; from: string; name: string | null; game: string; gameName: string; code: string; url: string; at: number; /** ms it is still worth showing, counted by the server */ left: number }

/** Only what the server could really have sent: a path on this site, a room code, a time. */
export function asInvite(v: unknown): OwnInvite | null {
  if (typeof v !== "object" || v === null) return null;
  const i = v as Record<string, unknown>;
  if (typeof i.id !== "string" || typeof i.from !== "string" || typeof i.code !== "string" || typeof i.url !== "string" || typeof i.gameName !== "string") return null;
  if (!/^[A-Z0-9]{5}$/.test(i.code) || !/^\/[a-z0-9/]+\?room=[A-Z0-9]{5}$/.test(i.url)) return null;
  const left = Number(i.left); if (!Number.isFinite(left) || left <= 0) return null;
  return { id: i.id.slice(0, 80), from: i.from, name: typeof i.name === "string" ? i.name.slice(0, 40) : null, game: String(i.game ?? ""), gameName: i.gameName.slice(0, 40), code: i.code, url: i.url, at: Number(i.at) || 0, left: Math.min(left, 10 * 60_000) };
}

let where: Promise<string> | null = null;
const address = () => (where ??= fetch("/api/live").then((r) => r.json()).then((d) => (typeof d?.url === "string" && d.url ? `${d.url.replace(/\/$/, "")}/me` : "")).catch(() => ""));

export function openOwnLine(ticket: () => string | null, on: { invite: (i: OwnInvite) => void }): { close(): void } {
  let ws: WebSocket | null = null; let wanted = true; let wait = 2000; let again: ReturnType<typeof setTimeout> | null = null; let beat: ReturnType<typeof setInterval> | null = null;
  const stop = () => { if (beat) { clearInterval(beat); beat = null; } const s = ws; ws = null; try { s?.close(); } catch { /* closed */ } };
  const retry = () => { if (!wanted || again || document.visibilityState !== "visible") return; again = setTimeout(() => { again = null; void start(); }, wait); wait = Math.min(30000, wait * 2); };
  const start = async () => {
    if (!wanted || ws || document.visibilityState !== "visible") return;
    const url = await address(); const t = ticket();
    if (!wanted || ws) return;
    if (!url || typeof WebSocket === "undefined") return; // no live line here: the check-in carries invites instead
    if (!t) { retry(); return; } // the first check-in has not answered yet
    let s: WebSocket;
    try { s = new WebSocket(url); } catch { retry(); return; }
    ws = s;
    s.onopen = () => { try { s.send(JSON.stringify({ t: "hello", ticket: t })); } catch { /* onclose follows */ } };
    s.onmessage = (e) => {
      let m: { t?: string; invite?: unknown };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === "ok") { wait = 2000; if (!beat) beat = setInterval(() => { try { if (s.readyState === WebSocket.OPEN) s.send('{"t":"ping"}'); } catch { /* closing */ } }, 25000); }
      else if (m.t === "invite") { const i = asInvite(m.invite); if (i) on.invite(i); }
      else if (m.t === "no") { try { s.close(); } catch { /* closed */ } }
    };
    s.onclose = () => { if (ws === s) { ws = null; if (beat) { clearInterval(beat); beat = null; } } retry(); };
    s.onerror = () => { try { s.close(); } catch { /* closed */ } };
  };
  const seen = () => { if (document.visibilityState === "visible") { wait = 2000; void start(); } else { if (again) { clearTimeout(again); again = null; } stop(); } };
  document.addEventListener("visibilitychange", seen);
  void start();
  return { close: () => { wanted = false; document.removeEventListener("visibilitychange", seen); if (again) clearTimeout(again); stop(); } };
}
