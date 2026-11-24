"use client";

// One line on the home screen when friends' rounds are being played right now:
// "2 rounds live", who is in the first, and a way to watch. Nothing is shown
// when nothing is live, so it never becomes wallpaper.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Live { watch: string; players: string[]; watching: number }

export default function LiveNow() {
  const router = useRouter(); const [rooms, setRooms] = useState<Live[]>([]);
  useEffect(() => {
    let live = true;
    const look = () => fetch("/api/rooms/rooms/live", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (live && Array.isArray(d.rooms)) setRooms(d.rooms); }).catch(() => {});
    void look(); const t = setInterval(() => { if (document.visibilityState === "visible") void look(); }, 15000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (!rooms.length) return null;
  return (
    <button className="lvn" onClick={() => router.push(rooms.length === 1 ? `/watch/${rooms[0].watch}` : "/watch")}>
      <i /> <b>{rooms.length} {rooms.length === 1 ? "round" : "rounds"} live</b><span>{rooms[0].players.join(" vs ")}</span><em>Watch ›</em>
      <style>{`
        .lvn { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 8px 12px 8px 16px; border-radius: 18px; border: none; background: #fff; box-shadow: 0 0 0 1px rgba(220,38,38,0.28), 0 14px 26px -24px rgba(76,29,149,0.9); cursor: pointer; text-align: left; color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .lvn i { width: 10px; height: 10px; border-radius: 50%; background: #dc2626; box-shadow: 0 0 0 4px rgba(220,38,38,0.2); flex: 0 0 auto; animation: lvnP 1.6s ease-in-out infinite; } @keyframes lvnP { 50% { box-shadow: 0 0 0 7px rgba(220,38,38,0.08); } }
        .lvn b { font-size: 15px; color: #b91c1c; flex: 0 0 auto; } .lvn span { flex: 1; min-width: 0; font-size: 14px; color: rgba(34,16,79,0.72); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lvn em { flex: 0 0 auto; font-style: normal; padding: 8px 13px; border-radius: 11px; background: #6d28d9; color: #fff; font-weight: 800; font-size: 13.5px; }
        @media (prefers-reduced-motion: reduce) { .lvn i { animation: none; } }
      `}</style>
    </button>
  );
}
