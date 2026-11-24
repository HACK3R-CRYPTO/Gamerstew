"use client";

// ─── Watching a room ─────────────────────────────────────────────────────────
// A spectator's view of a round between friends, laid out like a match on a
// screen: the game and the clock across the top, one panel per player with
// their score and a live picture of their game (components/LiveBoard), and the
// room's chat beside them. On a phone the panels stack.
//
// The page asks the room for its state a little more than once a second, as a stranger.
// It is shown names, scores and each player's screen as numbers, and never the
// round's deal, so watching cannot help a player. Nothing here changes a room.

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import LiveBoard, { LIVE_BOARD_CSS } from "@/components/LiveBoard";
import RoomChat from "@/components/RoomChat";
import type { RoomView } from "@/hooks/useFriendRoom";
import { track } from "@/lib/track";

type View = RoomView & { goal?: number };
const GAMES: Record<string, { name: string; path: string; art: string; what: string }> = {
  rhythm: { name: "Rhythm Rush", path: "/games/rhythm", art: "/games/covers/rhythm.jpg", what: "Tap the beat. Chain the combo." },
  simon: { name: "Simon Memory", path: "/games/simon", art: "/games/covers/simon.jpg", what: "Watch. Remember. Repeat." },
  stack: { name: "Stack Tower", path: "/games/stack", art: "/games/covers/stack.jpg", what: "Drop the block. Stack it clean." },
  ladder: { name: "Word Ladder", path: "/games/ladder", art: "/games/covers/ladder.svg", what: "Change one letter. Reach the word." },
  nepa3d: { name: "UP NEPA 3D", path: "/world", art: "/games/covers/upnepa3d.jpg", what: "Bring the light back to the street." },
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const tint = (name: string) => `hsl(${[...name].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360} 62% 46%)`;

export default function WatchRoom({ params }: { params: Promise<{ code: string }> }) {
  const raw = use(params).code; const byName = /^[0-9a-f]{8}$/.test(raw); const code = byName ? raw : raw.toUpperCase(); const router = useRouter();
  const [v, setV] = useState<View | null>(null);
  const [state, setState] = useState<"loading" | "live" | "gone" | "offline">("loading");
  const misses = useRef(0);
  const [wide, setWide] = useState(false);
  useEffect(() => { const q = window.matchMedia("(min-width: 900px)"); const on = () => setWide(q.matches); on(); q.addEventListener("change", on); return () => q.removeEventListener("change", on); }, []);

  useEffect(() => {
    if (!byName && !/^[A-Z0-9]{5}$/.test(code)) { setState("gone"); return; }
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
    // often enough that a watcher is never far behind the play
    void look(); const t = setInterval(() => { if (document.visibilityState === "visible") void look(); }, 800);
    return () => { live = false; clearInterval(t); };
  }, [code, byName]);

  const game = v ? GAMES[v.game] ?? { name: "GameArena", path: "/dashboard", art: "", what: "" } : null;
  const over = v?.status === "over"; const goal = Math.max(1, v?.goal ?? 1);
  const pts = (p: View["players"][number]) => p.score ?? (typeof p.live?.pts === "number" ? p.live.pts : null);
  const ranked = (v?.players ?? []).map((p, seat) => ({ ...p, seat })).sort((a, b) => (pts(b) ?? -1) - (pts(a) ?? -1) || b.progress - a.progress);
  const top = over ? ranked.find((p) => p.score !== null) : null;
  const lead = !over && v?.status === "playing" && ranked.length > 1 && (pts(ranked[0]) ?? 0) > (pts(ranked[1]) ?? 0) ? ranked[0].seat : -1;

  return (
    <div className="wr">
      <AppHeader tone="light" />
      <main>
        <button className="back" onClick={() => router.push("/watch")}>← All live rounds</button>

        {state === "loading" && <p className="note">Finding the room…</p>}
        {state === "gone" && <div className="empty"><b>This room has closed</b><span>Rooms end a while after the last round.</span><button className="go" onClick={() => router.push("/watch")}>See what is live</button></div>}
        {state === "offline" && !v && <div className="empty"><b>Cannot reach the room</b><span>Check your connection. This page keeps trying.</span></div>}

        {v && game && state !== "gone" && (
          <>
            <section className="hero" style={game.art ? { backgroundImage: `linear-gradient(90deg, rgba(20,6,60,0.94) 0%, rgba(20,6,60,0.72) 55%, rgba(20,6,60,0.35) 100%), url(${game.art})` } : undefined}>
              <div>
                <span className={`state ${v.status}`}>{v.status === "waiting" ? "Waiting to start" : v.status === "playing" ? <><i /> LIVE · {clock(v.elapsed)}</> : "Round over"}</span>
                <h1>{game.name}</h1>
                <p>{game.what}</p>
              </div>
              <div className="facts"><span>👁 <b>{Math.max(1, v.watching ?? 1)}</b> watching</span>{v.round > 0 && <span>Round <b>{v.round}</b></span>}<span><b>{v.players.length}</b> players</span>{v.stake && <span className="gold">Playing for G$</span>}{!byName && <span>Room <b>{code}</b></span>}</div>
            </section>
            {state === "offline" && <p className="note">Connection lost. Showing the last thing seen.</p>}
            {top && <div className="win" role="status">🏆 <b>{top.name}</b> wins with {top.score!.toLocaleString()}</div>}

            <div className="stage">
              <div className={`screens n${Math.min(4, ranked.length)}`}>
                {ranked.map((p, i) => (
                  <article key={p.seat} className={`${p.away && !p.done ? "away" : ""}${top && p.seat === top.seat ? " first" : ""}${p.seat === lead ? " lead" : ""}`}>
                    <header>
                      <span className="av" style={{ background: tint(p.name) }}>{p.name.slice(0, 1).toUpperCase()}</span>
                      <span className="who"><b>{p.name}</b><small>{p.host ? "Host · " : ""}{v.status === "waiting" ? "Ready" : p.done ? "Finished" : p.away ? "Left the round" : "Playing"}</small></span>
                      {v.status !== "waiting" && <span className="rank">{p.seat === lead ? "Leading" : `#${i + 1}`}</span>}
                    </header>
                    <div className="score"><b>{pts(p) !== null ? Math.round(pts(p)!).toLocaleString() : v.status === "waiting" ? "—" : "0"}</b><small>{p.score !== null ? "final score" : "points"}</small></div>
                    {v.status === "waiting" ? <div className="lb"><div className="lb-cap">The game shows here when the host starts the round.</div></div> : <LiveBoard game={v.game} live={p.live} done={p.done} progress={p.progress} goal={goal} />}
                    {/* a bar only where a round has an end to fill towards */}
                    {goal <= 60 && <span className="bar" aria-hidden><i style={{ width: `${p.done ? 100 : Math.min(100, (p.progress / goal) * 100)}%` }} /></span>}
                  </article>
                ))}
              </div>
              <aside>
                <h2>Room chat</h2>
                <RoomChat lines={v.chat ?? []} you={-1} />
                <p className="small">Only the players can write here.</p>
                {/* a room found on the live list can be watched, never joined: only someone given the code can take a seat */}
                <button className="go" onClick={() => router.push(byName ? game.path : `${game.path}?room=${code}`)}>{!byName && v.status === "waiting" ? "Join this room and play" : `Play ${game.name} yourself`}</button>
              </aside>
            </div>
          </>
        )}
      </main>
      <AppBottomNav wide={wide} tone="light" />
      <style>{`
        ${LIVE_BOARD_CSS}
        .wr { min-height: 100dvh; width: 100%; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #efe6ff 55%, #e6dbff 100%); color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .wr main { max-width: 1180px; margin: 0 auto; padding: 14px 16px calc(120px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; }
        .back { align-self: flex-start; min-height: 40px; padding: 0 14px; border-radius: 999px; border: none; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.14); color: #4c1d95; font-weight: 800; font-size: 13.5px; cursor: pointer; }
        .hero { display: flex; flex-direction: column; gap: 14px; padding: 20px; border-radius: 24px; background: linear-gradient(120deg, #2a1466, #6d28d9) center/cover; color: #fff; box-shadow: 0 22px 40px -28px rgba(76,29,149,0.95); }
        .hero h1 { font-family: "Melon Pop", sans-serif; font-weight: 400; font-size: 38px; line-height: 1; margin: 10px 0 6px; } .hero p { margin: 0; font-size: 15px; color: rgba(255,255,255,0.82); }
        .state { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,0.18); font-size: 12.5px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
        .state.playing { background: #dc2626; } .state.playing i { width: 8px; height: 8px; border-radius: 50%; background: #fff; animation: wrP 1.4s ease-in-out infinite; } @keyframes wrP { 50% { opacity: 0.35; } }
        .facts { display: flex; flex-wrap: wrap; gap: 8px; } .facts span { padding: 7px 12px; border-radius: 12px; background: rgba(255,255,255,0.14); font-size: 13.5px; font-weight: 600; } .facts b { font-weight: 900; } .facts .gold { background: #fde68a; color: #713f12; font-weight: 800; }
        .win { padding: 14px 18px; border-radius: 18px; background: linear-gradient(180deg, #fff7d6, #fde68a); font-size: 18px; box-shadow: 0 0 0 1px rgba(180,120,0,0.25); }
        .stage { display: flex; flex-direction: column; gap: 14px; }
        .screens { display: grid; gap: 12px; grid-template-columns: 1fr; }
        .screens article { display: grid; gap: 12px; align-content: start; padding: 14px; border-radius: 22px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12), 0 18px 30px -26px rgba(76,29,149,0.9); transition: box-shadow .3s ease; }
        .screens article.lead { box-shadow: 0 0 0 2px #7c3aed, 0 18px 30px -22px rgba(76,29,149,0.9); } .screens article.first { box-shadow: 0 0 0 3px #f59e0b, 0 18px 30px -22px rgba(180,120,0,0.6); } .screens article.away { opacity: 0.62; }
        .screens header { display: flex; align-items: center; gap: 10px; } .av { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 900; font-size: 17px; flex: 0 0 auto; }
        .who { flex: 1; min-width: 0; display: grid; } .who b { font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .who small { font-size: 12.5px; color: rgba(34,16,79,0.66); font-weight: 600; }
        .rank { flex: 0 0 auto; padding: 5px 10px; border-radius: 999px; background: #ede4ff; color: #4c1d95; font-size: 12px; font-weight: 900; } .lead .rank { background: #7c3aed; color: #fff; } .first .rank { background: #f59e0b; color: #fff; }
        .score { display: flex; align-items: baseline; gap: 8px; } .score b { font-family: "Melon Pop", sans-serif; font-weight: 400; font-size: 44px; line-height: 1; font-variant-numeric: tabular-nums; } .score small { font-size: 13px; font-weight: 700; color: rgba(34,16,79,0.6); }
        .bar { height: 7px; border-radius: 999px; background: #ede4ff; overflow: hidden; } .bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #7c3aed, #a78bfa); transition: width .5s ease; }
        aside { display: grid; gap: 10px; align-content: start; padding: 16px; border-radius: 22px; background: rgba(255,255,255,0.72); box-shadow: 0 0 0 1px rgba(76,29,149,0.1); } aside h2 { margin: 0; font-size: 12.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(34,16,79,0.72); }
        .small { margin: 0; font-size: 12.5px; color: rgba(34,16,79,0.6); }
        .note { margin: 0; font-size: 14.5px; color: rgba(34,16,79,0.72); text-align: center; }
        .empty { margin-top: 10vh; display: grid; gap: 10px; text-align: center; justify-items: center; } .empty b { font-size: 22px; } .empty span { color: rgba(34,16,79,0.72); font-size: 15px; }
        .go { min-height: 50px; padding: 0 22px; border: none; border-radius: 16px; background: linear-gradient(180deg,#7c3aed,#6d28d9); box-shadow: 0 5px 0 #4c1d95; color: #fff; font-weight: 800; font-size: 15.5px; cursor: pointer; }
        @media (min-width: 620px) { .screens.n2, .screens.n3, .screens.n4 { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 900px) {
          .wr main { padding: 24px 32px 80px; gap: 18px; }
          .hero { flex-direction: row; align-items: flex-end; justify-content: space-between; padding: 30px 32px; min-height: 190px; } .hero h1 { font-size: 54px; } .facts { justify-content: flex-end; max-width: 46%; }
          .stage { display: grid; grid-template-columns: minmax(0, 1fr) 340px; align-items: start; gap: 18px; } aside { position: sticky; top: 96px; }
          .screens.n3 { grid-template-columns: 1fr 1fr 1fr; } .screens.n1 { grid-template-columns: minmax(0, 520px); }
          .lb { min-height: 360px; }
        }
        @media (prefers-reduced-motion: reduce) { .state.playing i { animation: none; } .bar i { transition: none; } }
      `}</style>
    </div>
  );
}
