"use client";

// One leaderboard page for any ranked game. A new game gets a board by adding
// a three-line route file that renders this with its own words.

import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentProps } from "react";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import SkillLeaderboardTabs from "@/components/SkillLeaderboardTabs";

type Kind = ComponentProps<typeof SkillLeaderboardTabs>["gameKind"];
const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';

export default function GameLeaderboardPage({ gameKind, game, back, title, blurb }: { gameKind: Kind; game: string; back: string; title: string; blurb: string }) {
  const router = useRouter();
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const update = () => setWide(window.innerWidth >= 900);
    update(); window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return (
    <div style={{ minHeight: "100vh", width: "100%", background: "linear-gradient(180deg, #f3eeff 0%, #e6dcff 100%)", color: "#22104f", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <AppHeader />
      <div style={{ maxWidth: wide ? 760 : 480, margin: "0 auto", padding: wide ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 16 }}>
        <button onClick={() => router.push(back)} style={{ alignSelf: "flex-start", padding: "7px 14px", borderRadius: 999, background: "#fff", border: "1px solid rgba(76,29,149,0.14)", color: "#22104f", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          ‹ Back to {game}
        </button>
        <div>
          <div style={{ fontSize: 11, color: "rgba(34,16,79,0.5)", fontWeight: 700, letterSpacing: "0.16em" }}>{game.toUpperCase()} · LEADERBOARD</div>
          <h2 style={{ fontFamily: DISPLAY, fontWeight: 400, fontSize: wide ? 32 : 24, margin: "4px 0 0" }}>{title}</h2>
          <p style={{ fontSize: 13, color: "rgba(34,16,79,0.68)", margin: "6px 0 0", lineHeight: 1.5 }}>{blurb}</p>
        </div>
        <SkillLeaderboardTabs gameKind={gameKind} accent="#6d28d9" />
      </div>
      <AppBottomNav wide={wide} />
    </div>
  );
}
