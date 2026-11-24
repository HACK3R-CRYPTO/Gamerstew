"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

// ─── UbiImpactCard ──────────────────────────────────────────────────────────
// Single hero metric — the cumulative G$ GameArena has routed to GoodDollar's
// UBI pool. Reads directly from the Goldsky subgraph so the card never
// depends on the backend or Supabase. Tap to navigate to the habitat tab
// where players can grow the pool themselves.

const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.0/gn";

type Props = {
  myUbiG?: string;       // accepted but unused — kept for prop stability
  onClick?: () => void;
};

function fmtG(raw: string): string {
  try {
    const whole = BigInt(raw) / 10n ** 18n;
    return Number(whole).toLocaleString();
  } catch {
    return "0";
  }
}

function useCountUp(target: number) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!target) { setDisplay(0); return; }
    const start = performance.now();
    const dur = 800;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return display;
}

export function UbiImpactCard({ onClick }: Props) {
  const isMobile = useIsMobile();

  const [globalStat, setGlobalStat] = useState<{
    totalUbiDonatedG: string;
    totalHabitatUnlocks: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(SUBGRAPH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `{ globalStat(id: "global") { totalUbiDonatedG totalHabitatUnlocks } }`,
          }),
        });
        if (!r.ok) return;
        const json = await r.json();
        if (!cancelled && json?.data?.globalStat) setGlobalStat(json.data.globalStat);
      } catch { /* network blip */ }
    };
    load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 60_000) /* a tab nobody is looking at does not need fresh data */;
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const total = fmtG(globalStat?.totalUbiDonatedG || "0");
  const totalNum = Number(total.replace(/,/g, ""));
  const totalDisplay = useCountUp(totalNum);

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : -1}
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        borderRadius: "20px",
        padding: "2px",
        background: "linear-gradient(135deg, #22c55e 0%, #06b6d4 35%, #a78bfa 70%, #fbbf24 100%)",
        boxShadow: "0 0 28px rgba(34,197,94,0.3), 0 14px 32px rgba(0,0,0,0.6)",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.15s",
      }}
      onMouseEnter={onClick ? e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; } : undefined}
      onMouseLeave={onClick ? e => { (e.currentTarget as HTMLDivElement).style.transform = ""; } : undefined}
    >
      <div style={{
        position: "relative",
        borderRadius: "18px",
        background: "linear-gradient(180deg, #0d2818 0%, #0a0420 60%, #050211 100%)",
        overflow: "hidden",
        padding: isMobile ? "16px 16px 14px" : "20px 22px 18px",
      }}>
        {/* Atmospheric glow corners */}
        <div style={{
          position: "absolute", top: "-30%", right: "-15%",
          width: "60%", aspectRatio: "1", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(34,197,94,0.3) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: "-30%", left: "-15%",
          width: "55%", aspectRatio: "1", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.18) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />

        {/* Eyebrow + tag row */}
        <div style={{
          position: "relative", zIndex: 1,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
          marginBottom: isMobile ? "12px" : "14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "8px",
              background: "rgba(34,197,94,0.18)",
              border: "1px solid rgba(34,197,94,0.45)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, flexShrink: 0,
            }}>🌍</div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                color: "rgba(220,255,225,0.92)",
                fontSize: "10px", fontWeight: 900,
                letterSpacing: "0.18em",
              }}>SOCIAL IMPACT</div>
              <div style={{
                color: "rgba(220,255,225,0.5)",
                fontSize: "10px", fontWeight: 700,
                marginTop: "1px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>Funded into GoodDollar UBI</div>
            </div>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            padding: "3px 8px", borderRadius: "999px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            flexShrink: 0,
          }}>
            <span style={{ color: "#86efac", fontSize: 9, fontWeight: 900 }}>✓</span>
            <span style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "8.5px", fontWeight: 800,
              letterSpacing: "0.1em",
            }}>ON CELO</span>
          </div>
        </div>

        {/* HERO — community pool number, large and centered */}
        <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{
              color: "#86efac",
              fontSize: isMobile ? "clamp(40px, 12vw, 56px)" : "clamp(48px, 7vw, 72px)",
              fontWeight: 900, lineHeight: 1,
              letterSpacing: "-0.03em",
              textShadow: "0 0 30px rgba(134,239,172,0.7), 0 0 60px rgba(34,197,94,0.4)",
              fontFeatureSettings: '"tnum" 1',
            }}>{totalDisplay.toLocaleString()}</span>
            <span style={{
              color: "#86efac",
              fontSize: isMobile ? "20px" : "26px",
              fontWeight: 900,
              textShadow: "0 0 12px rgba(134,239,172,0.6)",
            }}>G$</span>
          </div>
          <div style={{
            color: "rgba(220,255,225,0.7)",
            fontSize: isMobile ? "11px" : "12px",
            fontWeight: 700,
            marginTop: "8px",
            letterSpacing: "0.04em",
          }}>
            {totalNum > 0
              ? "Routed to verified humans on GoodDollar"
              : "Be the first to fund verified humans"}
          </div>
        </div>
      </div>
    </div>
  );
}
