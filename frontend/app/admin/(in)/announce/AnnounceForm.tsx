"use client";

// Write a "what is new" message and see exactly what players will get before it
// goes: the pop-up on their home screen, the line in their bell, and the push.
// Nothing is sent from this component; the form posts to a server action, and
// the backend checks the admin's role and the limits again.

import { useState } from "react";
import { points } from "@/components/WhatsNewModal";
import { sendAnnouncement } from "../actions";
import { C, input, button } from "@/components/admin/ui";

const PAGES: [string, string][] = [["/dashboard", "Home"], ["/profile", "Profile (their pet)"], ["/shop", "Shop"], ["/games/ladder", "Word Ladder"], ["/games/stack", "Stack Tower"], ["/games/rhythm", "Rhythm Rush"], ["/games/simon", "Simon Memory"], ["/bowling", "Street Strike"], ["/world", "UP NEPA 3D"], ["/friends", "Friends"], ["/watch", "Live rounds"], ["/leaderboard", "Ranks"]];
const D = '"Melon Pop", "Fredoka", system-ui, sans-serif';
const count = (n: number, max: number) => <span style={{ fontSize: 12, fontWeight: 700, color: n > max ? C.bad : n > max * 0.9 ? C.warn : C.dim }}>{n} / {max}</span>;
const label: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 13, fontWeight: 700, color: C.ink, margin: "12px 0 5px" };

export default function AnnounceForm({ canSend, devices }: { canSend: boolean; /** phones with notifications switched on right now; null when it could not be read */ devices: { devices: number; players: number } | null }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [pt, setPt] = useState(""); const [pb, setPb] = useState("");
  const [url, setUrl] = useState("/dashboard"); const [live, setLive] = useState(false); const [pushOnly, setPushOnly] = useState(false);
  const lines = points(body);
  const pushHalf = !!pt.trim() !== !!pb.trim();
  const bad = pushOnly ? !(pt.trim() && pb.trim()) || pt.length > 60 || pb.length > 160 : !title.trim() || !body.trim() || title.length > 80 || body.length > 400 || pt.length > 60 || pb.length > 160 || pushHalf;
  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 16, alignItems: "start" }}>
      <form action={sendAnnouncement} style={{ background: "#fff", borderRadius: 20, padding: 18, boxShadow: `0 0 0 1px ${C.line}` }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>The message</div>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.dim, lineHeight: 1.45 }}>It goes into every player&apos;s bell and pops up once on their home screen. Write the text as short sentences: each one becomes a line.</p>
        <div style={label}><span>Title</span>{count(title.length, 80)}</div>
        <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New: living pets, a daily pot and more" style={input} />
        <div style={label}><span>Text</span>{count(body.length, 400)}</div>
        <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Your slime has moods now. A pot opens every day on one game." style={{ ...input, resize: "vertical", lineHeight: 1.45, fontFamily: "inherit" }} />
        <div style={label}><span>Button opens</span></div>
        <select name="url" value={url} onChange={(e) => setUrl(e.target.value)} style={input}>{PAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>

        <div style={{ marginTop: 18, fontSize: 16, fontWeight: 800, color: C.ink }}>The push <span style={{ fontWeight: 600, fontSize: 13, color: C.dim }}>optional</span></div>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.dim, lineHeight: 1.45 }}>Sent to phones that allowed notifications. One hook, one line. Leave both empty to send no push.</p>
        <div style={{ marginTop: 8, padding: "9px 12px", borderRadius: 12, background: C.soft, fontSize: 13.5, color: C.ink }}>{devices ? <><b>{devices.devices}</b> {devices.devices === 1 ? "phone has" : "phones have"} notifications switched on, from <b>{devices.players}</b> {devices.players === 1 ? "player" : "players"}. That is who a push can reach.</> : "Could not read how many phones have notifications on."}</div>
        <label style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 10, fontSize: 13.5, color: C.ink, cursor: "pointer" }}>
          <input type="checkbox" name="pushOnly" checked={pushOnly} onChange={(e) => setPushOnly(e.target.checked)} style={{ width: 17, height: 17 }} />
          <span><b>Only the push.</b> The news is already in the bell; send just the push for it.</span>
        </label>
        <div style={label}><span>Push title</span>{count(pt.length, 60)}</div>
        <input name="pushTitle" value={pt} onChange={(e) => setPt(e.target.value)} placeholder="Your slime has feelings now" style={input} />
        <div style={label}><span>Push text</span>{count(pb.length, 160)}</div>
        <input name="pushBody" value={pb} onChange={(e) => setPb(e.target.value)} placeholder="Happy when you play. Sad when your streak is about to break." style={input} />
        {pushHalf && <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: C.bad }}>A push needs both a title and a text.</div>}

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 18, padding: 12, borderRadius: 14, background: C.soft, fontSize: 13.5, lineHeight: 1.4, color: C.ink, cursor: "pointer" }}>
          <input type="checkbox" name="live" checked={live} onChange={(e) => setLive(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, flex: "none" }} />
          <span><b>Everything in this message is live on gamearenahq.xyz.</b> It goes to every player and cannot be taken back.</span>
        </label>
        <button type="submit" disabled={!canSend || bad || !live} style={{ ...button, width: "100%", marginTop: 12, padding: "13px 16px", fontSize: 15, opacity: !canSend || bad || !live ? 0.45 : 1, cursor: !canSend || bad || !live ? "default" : "pointer" }}>{pushOnly ? "Send the push" : "Send to every player"}</button>
        {!canSend && <div style={{ marginTop: 8, fontSize: 12.5, color: C.dim }}>Only an Admin or a Super Admin can send. You can write and preview.</div>}
      </form>

      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: C.dim, marginBottom: 6 }}>THE POP-UP · ONCE, ON THE HOME SCREEN</div>
          <div style={{ maxWidth: 360, borderRadius: 26, overflow: "hidden", background: "#fff", boxShadow: "0 14px 40px rgba(27,13,66,0.22)" }}>
            <div style={{ position: "relative", height: 132, background: "radial-gradient(120% 130% at 20% 0%, #8b5cf6 0%, #6d28d9 45%, #3b0f8f 100%)" }}>
              <div style={{ position: "absolute", left: "50%", bottom: 12, width: 132, height: 82, marginLeft: -66 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 13, background: "#ede4ff" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/pets/m/baby-joy.webp" alt="" style={{ position: "absolute", left: "50%", bottom: 20, width: 84, height: 84, marginLeft: -42 }} />
                <div style={{ position: "absolute", inset: 0, borderRadius: 13, background: "linear-gradient(180deg, #fff, #f3ecff)", clipPath: "polygon(0 28%, 50% 72%, 100% 28%, 100% 100%, 0 100%)" }} />
              </div>
            </div>
            <div style={{ padding: "14px 16px 16px", fontFamily: '"Fredoka", system-ui, sans-serif' }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b style={{ padding: "3px 9px", borderRadius: 999, background: "#fde68a", color: "#3b0764", fontSize: 9.5, letterSpacing: "0.12em" }}>NEW FROM GAMEARENA</b><span style={{ fontSize: 11.5, color: "rgba(34,16,79,0.56)" }}>{today}</span></div>
              <div style={{ fontFamily: D, fontSize: 22, lineHeight: 1.12, color: "#22104f", marginTop: 8 }}>{title || "Your title"}</div>
              {(lines.length ? lines : ["Your text, one sentence to a line."]).map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 13.5, lineHeight: 1.4, color: "rgba(34,16,79,0.84)" }}><i style={{ flex: "none", width: 19, height: 19, borderRadius: "50%", display: "grid", placeItems: "center", background: "#ede4ff", color: "#6d28d9", fontStyle: "normal", fontSize: 11, fontWeight: 800 }}>✓</i><span>{l}</span></div>
              ))}
              <div style={{ marginTop: 14, padding: "12px 0", borderRadius: 14, textAlign: "center", background: "linear-gradient(180deg, #7c3aed, #6d28d9)", color: "#fff", fontFamily: D, fontSize: 17 }}>Show me</div>
              <div style={{ marginTop: 8, textAlign: "center", fontSize: 11.5, color: "rgba(34,16,79,0.56)" }}>Opens {PAGES.find(([v]) => v === url)?.[1] ?? url}. Stays in the bell.</div>
            </div>
          </div>
          {body.length > 0 && lines.length > 6 && <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: C.warn }}>Only the first six sentences are shown as lines.</div>}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: C.dim, marginBottom: 6 }}>THE PUSH · ON THEIR PHONE</div>
          <div style={{ maxWidth: 360, display: "flex", gap: 10, padding: 12, borderRadius: 18, background: "#fff", boxShadow: `0 0 0 1px ${C.line}`, opacity: pt || pb ? 1 : 0.5 }}>
            <span style={{ flex: "none", width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(140deg, #fbbf24, #f472b6 60%, #7c3aed)", fontFamily: D, fontSize: 20, color: "#1b0d42" }}>G</span>
            <span style={{ minWidth: 0 }}><b style={{ display: "block", fontSize: 14, color: C.ink }}>{pt || "No push will be sent"}</b><span style={{ fontSize: 13, color: C.dim, lineHeight: 1.35 }}>{pb || "Fill both push fields to send one."}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
