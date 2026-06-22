"use client";

// Simon Memory leaderboard. Same shape as Rhythm's but tuned for Simon copy
// + accent. Keeps each game's leaderboard living inside the game.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import SkillLeaderboardTabs from "@/components/SkillLeaderboardTabs";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  accent: "#06b6d4",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const ChevLeft = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6l-6 6 6 6V6z" /></svg>;

export default function SimonLeaderboardPage() {
  const router = useRouter();
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 760 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 16 }}>

        <button onClick={() => router.push("/games/simon")} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px 6px 8px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim, fontFamily: T.body, fontSize: 11.5, fontWeight: 700 }}>
          <ChevLeft /> Back to Simon Memory
        </button>

        <div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em" }}>SIMON MEMORY · LEADERBOARD</div>
          <h2 style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 24, color: T.ink, margin: "4px 0 0", letterSpacing: "-0.01em" }}>Deepest memory</h2>
          <p style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, margin: "6px 0 0", lineHeight: 1.5 }}>
            This week&apos;s standings + past seasons recap. All-time lives on the Events page.
          </p>
        </div>

        <SkillLeaderboardTabs gameKind="simon" accent={T.accent} />
      </div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
