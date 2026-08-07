"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CupCountdown from "@/components/CupCountdown";
import { cupPhase, type CupPhase } from "@/lib/cup";

// ─── EventTeaser ────────────────────────────────────────────────────────────
// Teaser + live countdown for the Arena Cup ($150 in G$, supported by
// GoodAgents). Shown on the dashboard (home) and the events/leaderboard page.
// Phase-aware: the blurb reads "before it goes live" only while upcoming, and
// the whole teaser hides once the Cup has ended (so a finished event never
// lingers as a live headline).

const T = {
  ink: "#ffffff",
  inkDim: "rgba(224,215,255,0.78)",
  gold: "#fde68a",
  goldDeep: "#f59e0b",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

export default function EventTeaser({ isDesktop = false }: { isDesktop?: boolean }) {
  // Mounted clock so the phase is stable (SSR has no reliable time). Before
  // mount we assume "live" so the teaser renders during the event without a
  // flash; once mounted we hide it only if the Cup has truly ended.
  const [phase, setPhase] = useState<CupPhase>("live");
  useEffect(() => {
    const tick = () => setPhase(cupPhase(Date.now()));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  if (phase === "ended") return null;

  const blurb =
    phase === "upcoming"
      ? "The top 5 players split a $150 pool, paid in G$. Lock a spot before it goes live."
      : "It's live. The top 5 players split a $150 pool, paid in G$. Keep playing to lock your spot.";

  return (
    <Link href="/leaderboard/cup" style={{
      display: "block", textDecoration: "none", color: "inherit",
      position: "relative", overflow: "hidden", borderRadius: 18,
      padding: isDesktop ? "18px 22px" : "15px 16px",
      background: "linear-gradient(115deg, rgba(120,53,15,0.55) 0%, rgba(30,14,74,0.75) 55%, rgba(20,8,52,0.9) 100%)",
      border: "1px solid rgba(251,191,36,0.4)",
      boxShadow: "0 14px 40px -18px rgba(245,158,11,0.55)",
    }}>
      {/* soft gold glow, top-right */}
      <div style={{ position: "absolute", top: -40, right: -30, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(251,191,36,0.28), transparent 70%)", pointerEvents: "none" }} />

      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 10px", borderRadius: 999, background: "rgba(251,191,36,0.16)", border: "1px solid rgba(251,191,36,0.45)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: T.gold, boxShadow: `0 0 8px ${T.gold}` }} />
            <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.18em", color: T.gold, textTransform: "uppercase" }}>Arena Cup</span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
            <span style={{ fontFamily: T.display, fontSize: isDesktop ? 40 : 32, color: T.gold, lineHeight: 1, textShadow: "0 0 22px rgba(251,191,36,0.5)" }}>$150</span>
          </div>
          <div style={{ fontFamily: T.body, fontSize: 10, color: "rgba(253,230,138,0.75)", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 4 }}>
            Prize pool · paid in G$
          </div>

          {/* Live countdown · starts ticking the moment this ships */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 11, padding: "6px 13px", borderRadius: 999, background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.45)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: T.gold, boxShadow: `0 0 8px ${T.gold}`, animation: "pulse-soft 1.6s ease-in-out infinite" }} />
            <CupCountdown
              labelStyle={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(253,230,138,0.8)", textTransform: "uppercase" }}
              timeStyle={{ fontFamily: T.display, fontSize: isDesktop ? 16 : 14, color: T.gold, letterSpacing: "0.02em" }}
            />
          </div>

          <p style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, margin: "9px 0 0", lineHeight: 1.5, maxWidth: 440 }}>
            {blurb}
          </p>

          {/* GoodAgents supports the pool · credited, not the headline. */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10 }}>
            <img src="/goodagents-logo.png" alt="" width={16} height={16} style={{ display: "block" }} />
            <span style={{ fontFamily: T.body, fontSize: 10, color: "rgba(253,230,138,0.7)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Supported by GoodAgents</span>
          </div>
        </div>

        {/* Same 3D trophy art as the dashboard hero · `screen` drops its dark bg */}
        <img
          src="/event-prize.png"
          alt=""
          style={{ width: isDesktop ? 128 : 96, height: isDesktop ? 128 : 96, objectFit: "contain", mixBlendMode: "screen", flexShrink: 0, pointerEvents: "none" }}
        />
      </div>
    </Link>
  );
}
