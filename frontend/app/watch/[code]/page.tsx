"use client";

// ─── Spectator view of a friend room ─────────────────────────────────────────
// Anyone with the room's code can look on. The page asks the room for its
// state every second and a half, as a stranger: it is shown names, progress
// and scores, and never the round's deal, so a watcher cannot help a player.
// Nothing here can change the room.

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomView } from "@/hooks/useFriendRoom";
import { track } from "@/lib/track";

type View = RoomView & { watching?: number; goal?: number };
const GAMES: Record<string, { name: string; path: string }> = {
  rhythm: { name: "Rhythm Rush", path: "/games/rhythm" }, simon: { name: "Simon Memory", path: "/games/simon" }, stack: { name: "Stack Tower", path: "/games/stack" },
  ladder: { name: "Word Ladder", path: "/games/ladder" }, nepa3d: { name: "UP NEPA 3D", path: "/world" },
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function WatchRoom({ params }: { params: Promise<{ code: string }> }) {
  const code = use(params).code.toUpperCase(); const router = useRouter();
  const [v, setV] = useState<View | null>(null);
  const [state, setState] = useState<"loading" | "live" | "gone" | "offline">("loading");
  const misses = useRef(0);

  useEffect(() => {
    if (!/^[A-Z0-9]{5}$/.test(code)) { setState("gone"); return; }
    track("room_watched"); let live = true;
    const look = async () => {
      try {
        const r = await fetch(`/api/rooms/rooms/${code}?watch=1`, { cache: "no-store" });
        if (!live) return;
        if (r.status === 404) { setState("gone"); return; }
        if (!r.ok) throw new Error("bad");
        setV(await r.json()); setState("live"); misses.current = 0;
      } catch { if (live && ++misses.current >= 3) setState("offline"); }
    };
    void look(); const t = setInterval(() => { if (document.visibilityState === "visible") void look(); }, 1500);
    return () => { live = false; clearInterval(t); };
  }, [code]);

  const game = v ? GAMES[v.game] ?? { name: "GameArena", path: "/dashboard" } : null;
  const here = v ? v.players.map((p, seat) => ({ ...p, seat })) : [];
  const over = v?.status === "over";
  const ranked = [...here].sort((a, b) => (over || a.done || b.done ? (b.score ?? -1) - (a.score ?? -1) : 0) || b.progress - a.progress);
  const top = over ? ranked.find((p) => p.score !== null) : null;
  const goal = Math.max(1, v?.goal ?? 1);

  return (
    <main className="w">
      <header><button onClick={() => router.push("/dashboard")} aria-label="Back to games">←</button><b>Watching</b><span className="code">{code}</span></header>

      {state === "loading" && <p className="note">Finding the room…</p>}
      {state === "gone" && <div className="empty"><b>This room has closed</b><span>Rooms end a while after the last round. Ask your friend for a new code.</span><button className="go" onClick={() => router.push("/watch")}>Enter another code</button></div>}
      {state === "offline" && !v && <div className="empty"><b>Cannot reach the room</b><span>Check your connection. This page keeps trying.</span></div>}

      {v && game && state !== "gone" && (
        <>
          <section className="head">
            <h1>{game.name}</h1>
            <div className="chips">
              <span className={`chip ${v.status}`}>{v.status === "waiting" ? "Waiting to start" : v.status === "playing" ? `Live · ${clock(v.elapsed)}` : "Round over"}</span>
              {v.round > 0 && <span className="chip">Round {v.round}</span>}
              <span className="chip">👁 {Math.max(1, v.watching ?? 1)} watching</span>
              {v.stake && <span className="chip gold">Playing for G$</span>}
            </div>
            {state === "offline" && <p className="note">Connection lost. Showing the last thing seen.</p>}
          </section>

          {top && <div className="win" role="status">🏆 <b>{top.name}</b> wins with {top.score!.toLocaleString()}</div>}

          <ol className="list">
            {ranked.map((p, i) => (
              <li key={p.seat} className={`${p.away ? "away" : ""}${top && p.seat === top.seat ? " first" : ""}`}>
                <span className="rank">{v.status === "waiting" ? "•" : i + 1}</span>
                <span className="who"><b>{p.name}</b>{p.host && <em>Host</em>}{p.away && <em className="off">Away</em>}</span>
                <span className="score">{p.score !== null ? p.score.toLocaleString() : v.status === "playing" ? (p.done ? "Done" : "Playing") : "—"}</span>
                <span className="bar" aria-hidden><i style={{ width: `${p.done ? 100 : Math.min(100, (p.progress / goal) * 100)}%` }} /></span>
              </li>
            ))}
          </ol>

          {v.status === "waiting" && <p className="note">{here.length < 2 ? "Waiting for a second player to join." : "Everyone is in. The host starts the round."}</p>}
          <button className="go" onClick={() => router.push(`${game.path}?room=${code}`)}>{v.status === "waiting" ? "Join this room and play" : `Play ${game.name} yourself`}</button>
        </>
      )}

      <style>{`
        .w { min-height: 100dvh; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #efe6ff 55%, #e6dbff 100%); color: #22104f; padding: calc(10px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom)); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; gap: 14px; max-width: 560px; margin: 0 auto; }
        .w header { display: grid; grid-template-columns: 48px 1fr auto; align-items: center; }
        .w header button { width: 44px; height: 44px; border-radius: 14px; border: none; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.14); font-size: 19px; color: #22104f; cursor: pointer; }
        .w header b { text-align: center; font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(34,16,79,0.7); }
        .code { font-weight: 900; letter-spacing: 0.2em; font-size: 15px; padding: 9px 12px; border-radius: 12px; background: #22104f; color: #fff; }
        .head h1 { font-family: "Melon Pop", sans-serif; font-size: 34px; margin: 6px 0 10px; font-weight: 400; }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .chip { padding: 7px 12px; border-radius: 999px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.14); font-size: 13.5px; font-weight: 700; }
        .chip.playing { background: #dc2626; color: #fff; box-shadow: none; animation: wPulse 1.6s ease-in-out infinite; }
        .chip.over { background: #22104f; color: #fff; box-shadow: none; } .chip.gold { background: #fde68a; }
        @keyframes wPulse { 50% { opacity: 0.72; } }
        .win { padding: 14px 16px; border-radius: 18px; background: linear-gradient(180deg, #fff7d6, #fde68a); font-size: 17px; box-shadow: 0 0 0 1px rgba(180,120,0,0.25); }
        .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .list li { display: grid; grid-template-columns: 30px 1fr auto; gap: 4px 10px; align-items: center; padding: 14px 14px 12px; border-radius: 18px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12), 0 14px 26px -22px rgba(76,29,149,0.8); }
        .list li.first { box-shadow: 0 0 0 2px #f59e0b, 0 14px 26px -22px rgba(76,29,149,0.8); } .list li.away { opacity: 0.6; }
        .rank { font-weight: 900; font-size: 17px; color: #6d28d9; text-align: center; }
        .who { display: flex; align-items: center; gap: 8px; min-width: 0; } .who b { font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .who em { font-style: normal; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 7px; border-radius: 999px; background: #ede4ff; color: #4c1d95; } .who em.off { background: #f1f1f4; color: #55506a; }
        .score { font-weight: 900; font-size: 18px; font-variant-numeric: tabular-nums; }
        .bar { grid-column: 1 / -1; height: 8px; border-radius: 999px; background: #ede4ff; overflow: hidden; } .bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #7c3aed, #a78bfa); transition: width .5s ease; }
        .note { margin: 0; font-size: 14.5px; color: rgba(34,16,79,0.72); text-align: center; }
        .empty { margin-top: 12vh; display: grid; gap: 10px; text-align: center; } .empty b { font-size: 21px; } .empty span { color: rgba(34,16,79,0.72); font-size: 15px; line-height: 1.45; }
        .go { margin-top: 4px; padding: 15px 0; min-height: 52px; border: none; border-radius: 16px; background: linear-gradient(180deg,#7c3aed,#6d28d9); box-shadow: 0 5px 0 #4c1d95; color: #fff; font-weight: 800; font-size: 16.5px; cursor: pointer; }
        @media (prefers-reduced-motion: reduce) { .chip.playing { animation: none; } .bar i { transition: none; } }
      `}</style>
    </main>
  );
}
