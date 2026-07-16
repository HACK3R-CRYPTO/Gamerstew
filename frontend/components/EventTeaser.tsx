"use client";

// ─── EventTeaser ────────────────────────────────────────────────────────────
// "Coming soon" banner for the upcoming 400,000 G$ event. Details aren't set
// yet, so it teases the pool and builds anticipation without promising
// mechanics. Shown on the dashboard (home) and the events/leaderboard page.

const T = {
  ink: "#ffffff",
  inkDim: "rgba(224,215,255,0.78)",
  gold: "#fde68a",
  goldDeep: "#f59e0b",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

export default function EventTeaser({ isDesktop = false }: { isDesktop?: boolean }) {
  return (
    <div style={{
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
            <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.18em", color: T.gold, textTransform: "uppercase" }}>Event · Coming soon</span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
            <span style={{ fontFamily: T.display, fontSize: isDesktop ? 40 : 32, color: T.gold, lineHeight: 1, textShadow: "0 0 22px rgba(251,191,36,0.5)" }}>400,000</span>
            <span style={{ fontFamily: T.display, fontSize: isDesktop ? 20 : 17, color: T.gold, lineHeight: 1 }}>G$</span>
          </div>
          <div style={{ fontFamily: T.body, fontSize: 10, color: "rgba(253,230,138,0.75)", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 4 }}>
            event prize pool
          </div>

          <p style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, margin: "9px 0 0", lineHeight: 1.5, maxWidth: 440 }}>
            Something big is on the way. Details drop soon — keep playing so you&apos;re ready when it goes live.
          </p>
        </div>

        {/* Same 3D trophy art as the dashboard hero · `screen` drops its dark bg */}
        <img
          src="/event-trophy.jpg"
          alt=""
          style={{ width: isDesktop ? 128 : 96, height: isDesktop ? 128 : 96, objectFit: "contain", mixBlendMode: "screen", flexShrink: 0, pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}
