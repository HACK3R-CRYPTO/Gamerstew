"use client";

// ─── Watch ───────────────────────────────────────────────────────────────────
// Rounds being played right now, busiest first: tap one to look on. No code is
// needed, and none is shown: a room on this list can be watched, never joined.
// A friend's room can also be opened with the code they gave you.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

interface Live { watch: string; game: string; round: number; elapsed: number; players: string[]; watching: number; stake: boolean }
const GAMES: Record<string, { name: string; art: string }> = {
  rhythm: { name: "Rhythm Rush", art: "/games/covers/rhythm.jpg" }, simon: { name: "Simon Memory", art: "/games/covers/simon.jpg" }, stack: { name: "Stack Tower", art: "/games/covers/stack.jpg" },
  ladder: { name: "Word Ladder", art: "/games/covers/ladder.svg" }, strike: { name: "Street Strike", art: "/games/covers/streetstrike.jpg" }, nepa3d: { name: "UP NEPA 3D", art: "/games/covers/upnepa3d.jpg" },
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function WatchHome() {
  const router = useRouter(); const [code, setCode] = useState(""); const [rooms, setRooms] = useState<Live[] | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => { const q = window.matchMedia("(min-width: 900px)"); const on = () => setWide(q.matches); on(); q.addEventListener("change", on); return () => q.removeEventListener("change", on); }, []);
  useEffect(() => {
    let live = true;
    // two kinds of room: the shared rooms, and Street Strike's own lanes
    const get = (u: string) => fetch(u, { cache: "no-store" }).then((r) => r.json()).then((d) => (Array.isArray(d.rooms) ? (d.rooms as Live[]) : [])).catch(() => [] as Live[]);
    const look = () => Promise.all([get("/api/rooms/rooms/live"), get("/api/strike/rooms/live")]).then(([a, b]) => { if (live) setRooms([...a, ...b].sort((x, y) => y.watching - x.watching || x.elapsed - y.elapsed)); });
    void look(); const t = setInterval(() => { if (document.visibilityState === "visible") void look(); }, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const ok = /^[A-Za-z0-9]{5}$/.test(code);
  const [only, setOnly] = useState("");
  const kinds = [...new Set((rooms ?? []).map((r) => r.game))];
  const shown = (rooms ?? []).filter((r) => !only || r.game === only);
  return (
    <div className="wp">
      <AppHeader tone="light" />
      <main>
        {/* The title, and the code box beside it: always in reach, however long the list below grows */}
        <div className="top">
          <h1>Watch <em><i /> {rooms?.length ?? 0} live</em></h1>
          <form onSubmit={(e) => { e.preventDefault(); if (ok) router.push(`/watch/${code.toUpperCase()}`); }}>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase())} placeholder="Room code" aria-label="Room code" autoCapitalize="characters" autoComplete="off" />
            <button disabled={!ok}>Watch</button>
          </form>
        </div>

        {/* one chip per game that has a round on, so a long list can be cut down in a tap */}
        {rooms && kinds.length > 1 && (
          <div className="chips" role="tablist" aria-label="Filter by game">
            <button className={!only ? "on" : ""} onClick={() => setOnly("")}>All <i>{rooms.length}</i></button>
            {kinds.map((k) => <button key={k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}>{GAMES[k]?.name ?? k} <i>{rooms.filter((r) => r.game === k).length}</i></button>)}
          </div>
        )}

        {rooms === null && <p className="note">Looking for live rounds…</p>}
        {rooms && rooms.length === 0 && <div className="none"><b>Nobody is in a round right now</b><span>Rounds between friends show here the moment they start. Open a room in any game and yours will be the first.</span><button onClick={() => router.push("/dashboard")}>Pick a game</button></div>}
        {shown.length > 0 && (
          <ul>{shown.map((r) => { const g = GAMES[r.game] ?? { name: "GameArena", art: "" }; return (
            <li key={r.watch}><button onClick={() => { if (r.game === "strike") window.location.href = `/bowling?watch=${r.watch}`; else router.push(`/watch/${r.watch}`); }}>
              <span className="art" style={g.art ? { backgroundImage: `url(${g.art})` } : undefined}><em><u /> LIVE · {clock(r.elapsed)}</em><b>👁 {r.watching}</b></span>
              <span className="info"><b>{g.name}</b><small>{r.players.join(" vs ")}</small><span className="meta">{r.round > 1 && <i>Round {r.round}</i>}<i>{r.players.length} players</i>{r.stake && <i className="gold">For G$</i>}</span></span>
              <span className="go">Watch ›</span>
            </button></li>
          ); })}</ul>
        )}
      </main>
      <AppBottomNav wide={wide} tone="light" />
      <style>{`
        .wp { min-height: 100dvh; width: 100%; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #efe6ff 55%, #e6dbff 100%); color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .wp main { max-width: 1180px; margin: 0 auto; padding: 16px 16px calc(120px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; }
        .top { display: flex; flex-direction: column; gap: 12px; }
        .wp h1 { font-family: "Melon Pop", sans-serif; font-weight: 400; font-size: 32px; margin: 4px 0 0; } .wp h1 em { font: 800 14px ui-sans-serif, system-ui, sans-serif; color: #b91c1c; margin-left: 10px; vertical-align: middle; display: inline-flex; align-items: center; gap: 6px; } .wp h1 em i { width: 9px; height: 9px; border-radius: 50%; background: #dc2626; box-shadow: 0 0 0 4px rgba(220,38,38,0.2); }
        .top form { display: flex; gap: 8px; } .top input { flex: 1; min-width: 0; min-height: 46px; padding: 0 14px; border-radius: 14px; border: 2px solid rgba(109,40,217,0.22); font-size: 16px; font-weight: 700; letter-spacing: 2px; color: #22104f; background: #fff; } .top input:focus { outline: none; border-color: #6d28d9; } .top input::placeholder { letter-spacing: 0; font-weight: 600; }
        .top form button, .none button { min-height: 46px; padding: 0 20px; border: none; border-radius: 14px; background: linear-gradient(180deg,#7c3aed,#6d28d9); box-shadow: 0 4px 0 #4c1d95; color: #fff; font-weight: 800; font-size: 15px; cursor: pointer; } .top form button:disabled { opacity: 0.5; cursor: default; }
        .chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 2px; } .chips::-webkit-scrollbar { display: none; }
        .chips button { flex: 0 0 auto; min-height: 40px; padding: 0 14px; border-radius: 999px; border: none; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.14); color: #4c1d95; font-weight: 800; font-size: 13.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; } .chips button.on { background: #22104f; color: #fff; box-shadow: none; } .chips i { font-style: normal; font-size: 11.5px; padding: 2px 7px; border-radius: 999px; background: rgba(109,40,217,0.14); } .chips button.on i { background: rgba(255,255,255,0.2); }
        .wp ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: 1fr; }
        .wp li button { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 0; padding: 0; border: none; border-radius: 22px; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12), 0 18px 30px -24px rgba(76,29,149,0.9); cursor: pointer; text-align: left; color: #22104f; transition: transform .16s ease, box-shadow .16s ease; }
        .wp li button:hover { transform: translateY(-3px); box-shadow: 0 0 0 2px #7c3aed, 0 24px 34px -22px rgba(76,29,149,0.95); }
        .art { position: relative; width: 100%; aspect-ratio: 16 / 8; background: linear-gradient(135deg, #7c3aed, #3b1391) center/cover; }
        .art em { position: absolute; left: 10px; top: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; background: #dc2626; color: #fff; font: 800 11.5px ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.05em; } .art u { width: 7px; height: 7px; border-radius: 50%; background: #fff; }
        .art b { position: absolute; right: 10px; top: 10px; padding: 5px 10px; border-radius: 999px; background: rgba(10,2,32,0.7); color: #fff; font-size: 12px; font-weight: 800; }
        .info { display: grid; gap: 4px; padding: 12px 14px 4px; } .info b { font-size: 18px; } .info small { font-size: 14.5px; color: rgba(34,16,79,0.75); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; } .meta i { font-style: normal; font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: #f1ecfb; color: #4c1d95; } .meta i.gold { background: #fde68a; color: #713f12; }
        .go { margin: 10px 14px 14px; padding: 11px 0; border-radius: 13px; background: #6d28d9; color: #fff; font-weight: 800; font-size: 14.5px; text-align: center; }
        .note { margin: 0; color: rgba(34,16,79,0.7); } .none { display: grid; gap: 8px; justify-items: start; padding: 22px; border-radius: 22px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12); } .none b { font-size: 19px; } .none span { color: rgba(34,16,79,0.72); font-size: 15px; line-height: 1.45; max-width: 520px; }
        @media (min-width: 620px) { .wp ul { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 900px) {
          .wp main { padding: 28px 32px 80px; gap: 18px; }
          .top { flex-direction: row; align-items: center; justify-content: space-between; } .wp h1 { font-size: 40px; margin: 0; } .top form { width: 330px; }
          .wp ul { grid-template-columns: repeat(3, 1fr); gap: 16px; }
        }
        @media (prefers-reduced-motion: reduce) { .wp li button { transition: none; } .wp li button:hover { transform: none; } }
      `}</style>
    </div>
  );
}
