"use client";

// ─── Room chat ───────────────────────────────────────────────────────────────
// A few lines of talk between the players in a friend room: in the lobby, on
// the result card, and (read only) for people watching. Quick replies come
// first because most of what is said in a game is one of six things, and a
// tap beats typing on a phone.

import { useEffect, useRef, useState } from "react";
import type { ChatLine } from "@/hooks/useFriendRoom";

const QUICK = ["Ready? 👀", "Good luck 🤝", "GG 👏", "Again! 🔁", "😂", "🔥"];

export default function RoomChat({ lines, you, send, dark = false, fold = false }: { lines: ChatLine[]; /** your seat, or -1 when only watching */ you: number; /** leave out for a read-only view */ send?: (text: string) => Promise<boolean>; dark?: boolean; /** on a phone, start as one line that opens on a tap (a wide screen always shows it open) */ fold?: boolean }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const box = useRef<HTMLDivElement>(null);
  // `seen` is the newest line there was when the chat was last opened or shut: anything after it, from someone else, is new
  const [open, setOpen] = useState(false); const [seen, setSeen] = useState(0);
  const last = lines[lines.length - 1]?.id ?? 0;
  const latest = lines[lines.length - 1]; const unread = fold && !open ? lines.filter((l) => l.id > seen && l.seat !== you).length : 0;
  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; }, [last]);
  const say = async (t: string) => { const v = t.trim(); if (!v || busy || !send) return; setBusy(true); const ok = await send(v); setBusy(false); if (ok && t === text) setText(""); };
  return (
    <div className={`rc${dark ? " dark" : ""}${fold ? " fold" : ""}${fold && !open ? " shut" : ""}`}>
      {fold && (
        <button className="rc-fold" onClick={() => { setSeen(last); setOpen((o) => !o); }} aria-expanded={open}>
          <span className="rc-ico" aria-hidden>💬</span>
          <span className="rc-peek">{open ? <b>Chat</b> : latest ? <><b>{latest.seat === you ? "You" : latest.name}:</b> {latest.text}</> : <><b>Chat</b> · say hi while you wait</>}</span>
          {unread > 0 && <i aria-label={`${unread} new`}>{unread}</i>}
          <span className="rc-chev" aria-hidden>{open ? "▴" : "▾"}</span>
        </button>
      )}
      <div className="rc-in">
      <div className="rc-lines" ref={box} aria-live="polite">
        {lines.length === 0 ? <p>{send ? "Say hi while you wait." : "No messages yet."}</p> : lines.map((l) => <div key={l.id} className={l.seat === you ? "me" : ""}><b>{l.seat === you ? "You" : l.name}</b><span>{l.text}</span></div>)}
      </div>
      {send && (
        <>
          <div className="rc-quick">{QUICK.map((q) => <button key={q} onClick={() => void say(q)} disabled={busy}>{q}</button>)}</div>
          <form onSubmit={(e) => { e.preventDefault(); void say(text); }}><input value={text} onChange={(e) => setText(e.target.value.slice(0, 140))} placeholder="Message" aria-label="Message" enterKeyHint="send" autoComplete="off" /><button disabled={!text.trim() || busy} aria-label="Send">➤</button></form>
        </>
      )}
      </div>
      <style>{`
        .rc { display: grid; gap: 8px; padding: 10px; border-radius: 16px; background: #f6f1ff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #22104f; text-align: left; }
        .rc-lines { max-height: 132px; min-height: 44px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; overscroll-behavior: contain; }
        .rc-lines p { margin: auto 0; text-align: center; font-size: 13px; color: rgba(34,16,79,0.6); }
        .rc-lines div { align-self: flex-start; max-width: 86%; padding: 6px 10px; border-radius: 12px 12px 12px 4px; background: #fff; font-size: 14px; line-height: 1.3; box-shadow: 0 0 0 1px rgba(76,29,149,0.08); word-break: break-word; animation: rcIn .18s ease both; }
        .rc-lines div.me { align-self: flex-end; background: #6d28d9; color: #fff; border-radius: 12px 12px 4px 12px; box-shadow: none; }
        .rc-lines b { display: block; font-size: 11px; font-weight: 800; opacity: 0.7; } @keyframes rcIn { from { opacity: 0; transform: translateY(5px); } }
        .rc-quick { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; } .rc-quick::-webkit-scrollbar { display: none; }
        .rc-quick button { flex: 0 0 auto; min-height: 36px; padding: 0 12px; border-radius: 999px; border: none; background: #fff; box-shadow: 0 0 0 1px rgba(109,40,217,0.25); color: #4c1d95; font-weight: 700; font-size: 13.5px; cursor: pointer; white-space: nowrap; }
        .rc form { display: flex; gap: 6px; } .rc input { flex: 1; min-width: 0; min-height: 42px; padding: 0 12px; border-radius: 12px; border: 1.5px solid rgba(109,40,217,0.25); background: #fff; font-size: 16px; color: #22104f; } .rc input:focus { outline: none; border-color: #6d28d9; }
        .rc form button { width: 44px; min-height: 42px; border: none; border-radius: 12px; background: #6d28d9; color: #fff; font-size: 16px; cursor: pointer; } .rc form button:disabled { opacity: 0.45; cursor: default; }
        .rc-in { display: grid; gap: 8px; min-width: 0; }
        .rc-fold { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 44px; padding: 0 4px; border: none; background: none; color: #22104f; font: inherit; text-align: left; cursor: pointer; }
        .rc-ico { flex: none; font-size: 17px; } .rc-chev { flex: none; font-size: 13px; color: rgba(34,16,79,0.5); }
        .rc-peek { flex: 1; min-width: 0; font-size: 14px; color: rgba(34,16,79,0.72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .rc-peek b { color: #22104f; }
        .rc-fold i { flex: none; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center; background: #e11d48; color: #fff; font-style: normal; font-size: 12px; font-weight: 800; }
        .rc.shut { padding: 2px 10px; } .rc.shut .rc-in { display: none; }
        /* beside the room on a wide screen: always open, and taller */
        @media (min-width: 860px) { .rc.fold .rc-fold { display: none; } .rc.fold.shut { padding: 10px; } .rc.fold.shut .rc-in { display: grid; } .rc.fold .rc-lines { min-height: 180px; max-height: 300px; } .rc.fold .rc-quick { flex-wrap: wrap; overflow: visible; } }
        @media (prefers-reduced-motion: reduce) { .rc-lines div { animation: none; } }
      `}</style>
    </div>
  );
}
