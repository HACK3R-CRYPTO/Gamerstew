"use client";

// News from GameArena, delivered once. When a player opens the home screen and
// there is a message to everyone they have not seen on this device, it arrives
// as a letter: their slime pops out of an envelope with the headline, the points
// one to a line, and a button that goes to the thing.
//
// The same message is in the bell under "From GameArena", so closing this loses
// nothing. Rules it keeps (a pop-up is an interruption, so it has to earn it):
//   - only on the home screen, never inside a game
//   - once per message per device, and only for news less than two weeks old
//   - a first-time visitor is not told what is "new": everything is new to them
//   - it waits a moment after the page settles, and never opens over another sheet
//   - Later, the X, a tap outside and Escape all close it
//
// Post a message with scripts/whats-new.sh.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Pet from "@/components/Pet";
import { PET_STAGES, petForLevel } from "@/lib/pets";
import { track } from "@/lib/track";

interface News { id: number; kind: string; title: string; body: string; url: string | null; sentAt: number }
const SEEN = "gamearena:whatsnew:seen";   // id of the newest message this device has shown or skipped
const KNOWN = "gamearena:whatsnew:known"; // set on a device's first visit: from then on, news is news
const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';

/** A message body as points: one sentence to a line, so it can be read at a glance. */
export function points(body: string): string[] {
  return body.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
}
const when = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function WhatsNewModal({ level = 5 }: { /** the player's level, so the letter is carried by their own slime */ level?: number }) {
  const router = useRouter();
  const [news, setNews] = useState<News | null>(null);
  const [open, setOpen] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    fetch(`${base}/api/whats-new`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const item = d?.item as News | null | undefined;
      if (!live || !item || !item.title) return;
      let seen = 0, known = false;
      try { seen = Number(localStorage.getItem(SEEN) || 0); known = localStorage.getItem(KNOWN) === "1"; } catch { return; } // storage blocked: it could not be shown just once, so it is not shown
      if (!known) { // first visit on this device: note where the news stood, show nothing
        try { localStorage.setItem(KNOWN, "1"); localStorage.setItem(SEEN, String(item.id)); } catch { /* ignore */ }
        return;
      }
      if (item.id <= seen) return;
      setNews(item);
      // let the page settle, and never open on top of another sheet (sign-in, onboarding, a prompt)
      const tryOpen = (left: number) => {
        if (!live) return;
        if (document.querySelector('[role="dialog"]') && left > 0) { timer = setTimeout(() => tryOpen(left - 1), 2500); return; }
        if (document.querySelector('[role="dialog"]')) return;
        setOpen(true); track("whatsnew_shown", { id: item.id, title: item.title });
        try { localStorage.setItem(SEEN, String(item.id)); } catch { /* ignore */ }
      };
      timer = setTimeout(() => tryOpen(6), 1300);
    }).catch(() => {});
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [open]);

  if (!open || !news) return null;
  const lines = points(news.body);
  const close = (how: "later" | "x" | "outside") => { track("whatsnew_closed", { id: news.id, how }); setOpen(false); };
  const go = () => { track("whatsnew_open", { id: news.id, url: news.url }); setOpen(false); if (news.url) router.push(news.url); };
  const stage = level > 0 ? petForLevel(Math.max(5, level)) : PET_STAGES[1]; // an egg has no face to deliver news with

  return (
    <div className="wn" role="dialog" aria-modal="true" aria-labelledby="wn-title" onClick={() => close("outside")}>
      <div className="wn-card" onClick={(e) => e.stopPropagation()}>
        <button ref={closeBtn} className="wn-x" onClick={() => close("x")} aria-label="Close">×</button>
        <div className="wn-top" aria-hidden>
          <i className="wn-s s1">✦</i><i className="wn-s s2">✦</i><i className="wn-s s3">✦</i>
          <div className="wn-mail">
            <div className="wn-back" />
            <div className="wn-pet"><Pet stage={stage} mood="happy" size={104} burst={{ mood: "joy", ts: news.id, ms: 2600 }} /></div>
            <div className="wn-front" />
          </div>
        </div>
        <div className="wn-body">
          <div className="wn-kick"><b>NEW FROM GAMEARENA</b><span>{when(news.sentAt)}</span></div>
          <h2 id="wn-title" style={{ fontFamily: DISPLAY }}>{news.title}</h2>
          {lines.length > 1
            ? <ul>{lines.map((l, i) => <li key={i} style={{ animationDelay: `${0.25 + i * 0.07}s` }}><i aria-hidden>✓</i><span>{l}</span></li>)}</ul>
            : lines.length === 1 ? <p>{lines[0]}</p> : null}
          <button className="wn-go" style={{ fontFamily: DISPLAY }} onClick={go}>{news.url ? "Show me" : "Got it"}</button>
          {news.url && <button className="wn-later" onClick={() => close("later")}>Later</button>}
          <div className="wn-note">This stays in your notifications, under the bell.</div>
        </div>
      </div>
      <style>{`
        .wn { position: fixed; inset: 0; z-index: 1250; display: flex; align-items: flex-end; justify-content: center; background: rgba(27,13,66,0.6); animation: wnIn 0.2s ease-out; font-family: "Fredoka", system-ui, sans-serif; }
        .wn-card { position: relative; width: 100%; max-width: 460px; max-height: 94dvh; overflow: auto; border-radius: 30px 30px 0 0; background: #fff; color: #22104f; box-shadow: 0 -12px 60px rgba(27,13,66,0.4); animation: wnUp 0.34s cubic-bezier(0.2, 0.9, 0.3, 1.05); }
        .wn-x { position: absolute; right: 12px; top: 12px; z-index: 3; width: 40px; height: 40px; border-radius: 13px; border: none; background: rgba(255,255,255,0.2); color: #fff; font-size: 24px; line-height: 1; cursor: pointer; }
        .wn-top { position: relative; height: 172px; overflow: hidden; background: radial-gradient(120% 130% at 20% 0%, #8b5cf6 0%, #6d28d9 45%, #3b0f8f 100%); }
        .wn-s { position: absolute; font-style: normal; color: #fde68a; opacity: 0; animation: wnSpark 2.2s ease-in-out infinite; }
        .wn-s.s1 { left: 18%; top: 26%; font-size: 18px; } .wn-s.s2 { left: 78%; top: 20%; font-size: 14px; animation-delay: 0.6s; } .wn-s.s3 { left: 70%; top: 62%; font-size: 20px; animation-delay: 1.1s; }
        .wn-mail { position: absolute; left: 50%; bottom: 16px; width: 168px; height: 104px; margin-left: -84px; }
        .wn-back { position: absolute; inset: 0; border-radius: 16px; background: #ede4ff; box-shadow: 0 10px 26px rgba(20,8,40,0.35); }
        .wn-pet { position: absolute; left: 50%; bottom: 26px; width: 104px; height: 104px; margin-left: -52px; animation: wnRise 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.2) 0.25s both; }
        .wn-front { position: absolute; inset: 0; border-radius: 16px; background: linear-gradient(180deg, #ffffff, #f3ecff); clip-path: polygon(0 28%, 50% 72%, 100% 28%, 100% 100%, 0 100%); box-shadow: inset 0 0 0 1px rgba(76,29,149,0.1); }
        .wn-body { padding: 18px 18px calc(16px + env(safe-area-inset-bottom, 0px)); }
        .wn-kick { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .wn-kick b { padding: 4px 10px; border-radius: 999px; background: #fde68a; color: #3b0764; font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; }
        .wn-kick span { font-size: 12.5px; font-weight: 600; color: rgba(34,16,79,0.56); }
        .wn-body h2 { margin: 10px 0 0; font-size: 28px; line-height: 1.12; color: #22104f; }
        .wn-body p { margin: 10px 0 0; font-size: 15.5px; line-height: 1.5; color: rgba(34,16,79,0.78); }
        .wn-body ul { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 9px; }
        .wn-body li { display: flex; gap: 10px; align-items: flex-start; font-size: 15px; line-height: 1.4; color: rgba(34,16,79,0.84); animation: wnLine 0.32s ease-out both; }
        .wn-body li i { flex: none; width: 22px; height: 22px; margin-top: -1px; border-radius: 50%; display: grid; place-items: center; background: #ede4ff; color: #6d28d9; font-style: normal; font-size: 12.5px; font-weight: 800; }
        .wn-go { display: block; width: 100%; min-height: 54px; margin-top: 18px; border: none; border-radius: 17px; background: linear-gradient(180deg, #7c3aed, #6d28d9); box-shadow: 0 4px 0 #4c1d95; color: #fff !important; font-size: 20px; cursor: pointer; }
        .wn-later { display: block; width: 100%; min-height: 46px; margin-top: 8px; border-radius: 15px; border: 1px solid rgba(76,29,149,0.2); background: #fff; color: #4c1d95; font: 700 15px "Fredoka", system-ui, sans-serif; cursor: pointer; }
        .wn-note { margin-top: 10px; text-align: center; font-size: 12.5px; color: rgba(34,16,79,0.56); }
        @keyframes wnIn { from { opacity: 0; } } @keyframes wnUp { from { transform: translateY(40px); opacity: 0; } }
        @keyframes wnRise { from { transform: translateY(70px); } to { transform: none; } }
        @keyframes wnLine { from { opacity: 0; transform: translateX(-8px); } }
        @keyframes wnSpark { 0%, 100% { opacity: 0; transform: scale(0.4) rotate(0); } 50% { opacity: 1; transform: scale(1.1) rotate(40deg); } }
        @media (min-width: 700px) { .wn { align-items: center; padding: 24px; } .wn-card { border-radius: 30px; max-width: 480px; } .wn-top { height: 190px; } }
        @media (prefers-reduced-motion: reduce) { .wn, .wn-card, .wn-pet, .wn-body li, .wn-s { animation: none !important; } .wn-s { opacity: 0.9; } }
      `}</style>
    </div>
  );
}
