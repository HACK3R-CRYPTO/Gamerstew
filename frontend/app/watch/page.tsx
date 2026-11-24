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
  ladder: { name: "Word Ladder", art: "/games/covers/ladder.svg" }, nepa3d: { name: "UP NEPA 3D", art: "/games/covers/upnepa3d.jpg" },
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function WatchHome() {
  const router = useRouter(); const [code, setCode] = useState(""); const [rooms, setRooms] = useState<Live[] | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => { const q = window.matchMedia("(min-width: 900px)"); const on = () => setWide(q.matches); on(); q.addEventListener("change", on); return () => q.removeEventListener("change", on); }, []);
  useEffect(() => {
    let live = true;
    const look = () => fetch("/api/rooms/rooms/live", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (live) setRooms(Array.isArray(d.rooms) ? d.rooms : []); }).catch(() => { if (live) setRooms((x) => x ?? []); });
    void look(); const t = setInterval(() => { if (document.visibilityState === "visible") void look(); }, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const ok = /^[A-Za-z0-9]{5}$/.test(code);
  return (
    <div className="wp">
      <AppHeader tone="light" />
      <main>
        <h1>Watch <em><i /> {rooms?.length ?? 0} live</em></h1>
        {rooms === null && <p className="note">Looking for live rounds…</p>}
        {rooms && rooms.length === 0 && <div className="none"><b>Nobody is in a round right now</b><span>Rounds between friends show here the moment they start. Open a room in any game and yours will be the first.</span><button onClick={() => router.push("/dashboard")}>Pick a game</button></div>}
        {rooms && rooms.length > 0 && (
          <ul>{rooms.map((r) => { const g = GAMES[r.game] ?? { name: "GameArena", art: "" }; return (
            <li key={r.watch}><button onClick={() => router.push(`/watch/${r.watch}`)}>
              <span className="art" style={g.art ? { backgroundImage: `url(${g.art})` } : undefined}><em>LIVE · {clock(r.elapsed)}</em></span>
              <span className="info"><b>{g.name}</b><small>{r.players.join(" vs ")}</small><span className="meta"><i>👁 {r.watching}</i>{r.round > 1 && <i>Round {r.round}</i>}{r.stake && <i className="gold">For G$</i>}</span></span>
              <span className="go">Watch ›</span>
            </button></li>
          ); })}</ul>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (ok) router.push(`/watch/${code.toUpperCase()}`); }}>
          <label htmlFor="wc">Have a room code?</label>
          <div><input id="wc" value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase())} placeholder="CODE" autoCapitalize="characters" autoComplete="off" /><button disabled={!ok}>Watch</button></div>
        </form>
      </main>
      <AppBottomNav wide={wide} tone="light" />
      <style>{`
        .wp { min-height: 100dvh; width: 100%; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #efe6ff 55%, #e6dbff 100%); color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .wp main { max-width: 760px; margin: 0 auto; padding: 16px 16px calc(120px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 16px; }
        .wp h1 { font-family: "Melon Pop", sans-serif; font-weight: 400; font-size: 32px; margin: 4px 0 0; } .wp h1 em { font: 800 14px ui-sans-serif, system-ui, sans-serif; color: #b91c1c; margin-left: 10px; vertical-align: middle; display: inline-flex; align-items: center; gap: 6px; } .wp h1 em i { width: 9px; height: 9px; border-radius: 50%; background: #dc2626; box-shadow: 0 0 0 4px rgba(220,38,38,0.2); }
        .wp ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .wp li button { width: 100%; display: flex; align-items: center; gap: 14px; padding: 10px; border: none; border-radius: 20px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12), 0 16px 28px -24px rgba(76,29,149,0.9); cursor: pointer; text-align: left; color: #22104f; }
        .art { position: relative; flex: 0 0 auto; width: 96px; height: 72px; border-radius: 14px; background: linear-gradient(135deg, #7c3aed, #3b1391) center/cover; overflow: hidden; } .art em { position: absolute; left: 6px; top: 6px; padding: 3px 7px; border-radius: 999px; background: #dc2626; color: #fff; font: 800 10.5px ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.04em; }
        .info { flex: 1; min-width: 0; display: grid; gap: 3px; } .info b { font-size: 17px; } .info small { font-size: 14px; color: rgba(34,16,79,0.72); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .meta { display: flex; gap: 6px; flex-wrap: wrap; } .meta i { font-style: normal; font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: #f1ecfb; color: #4c1d95; } .meta i.gold { background: #fde68a; color: #713f12; }
        .go { flex: 0 0 auto; padding: 10px 14px; border-radius: 12px; background: #6d28d9; color: #fff; font-weight: 800; font-size: 14px; }
        .note { margin: 0; color: rgba(34,16,79,0.7); } .none { display: grid; gap: 8px; justify-items: start; padding: 20px; border-radius: 20px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12); } .none b { font-size: 18px; } .none span { color: rgba(34,16,79,0.72); font-size: 15px; line-height: 1.45; }
        .none button, .wp form button { min-height: 46px; padding: 0 20px; border: none; border-radius: 14px; background: linear-gradient(180deg,#7c3aed,#6d28d9); box-shadow: 0 4px 0 #4c1d95; color: #fff; font-weight: 800; font-size: 15px; cursor: pointer; } .wp form button:disabled { opacity: 0.5; cursor: default; }
        .wp form { display: grid; gap: 8px; padding: 16px; border-radius: 20px; background: rgba(255,255,255,0.6); box-shadow: 0 0 0 1px rgba(76,29,149,0.1); } .wp form label { font-weight: 800; font-size: 14.5px; } .wp form div { display: flex; gap: 8px; }
        .wp form input { flex: 1; min-width: 0; min-height: 46px; padding: 0 14px; border-radius: 14px; border: 2px solid rgba(109,40,217,0.25); font-size: 18px; font-weight: 800; letter-spacing: 6px; color: #22104f; background: #fff; }
        @media (min-width: 900px) { .wp main { padding: 28px 32px 80px; } }
      `}</style>
    </div>
  );
}
