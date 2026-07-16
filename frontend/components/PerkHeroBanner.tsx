"use client";

import { usePerks } from "@/hooks/usePerks";

// ─── PerkHeroBanner ─────────────────────────────────────────────────────────
// The visual hook for the Perks tab: brand key-art (crowned golden gamepad
// mascot summoning a save-shield) with the headline and the live community
// UBI number overlaid on the art's left negative space. One card carries both
// the emotional pull and the on-chain proof.

const T = {
  ink: "#ffffff",
  inkDim: "rgba(224,215,255,0.82)",
  good: "#4ade80",
  gold: "#fde68a",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const fmtG = (v: bigint) => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function PerkHeroBanner({ isDesktop }: { isDesktop: boolean }) {
  const { totalCommunity } = usePerks();

  return (
    <div style={{
      position: "relative", overflow: "hidden",
      borderRadius: 20, minHeight: isDesktop ? 220 : 172,
      border: "1px solid rgba(167,139,250,0.4)",
      boxShadow: "0 20px 50px -20px rgba(124,58,237,0.7)",
      background: "#1a0552",
    }}>
      {/* Brand key-art — anchored right so the mascot reads, text sits left */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "url('/perks-hero.jpg')",
        backgroundSize: "cover",
        backgroundPosition: isDesktop ? "center right" : "72% center",
      }} />
      {/* Left scrim for text legibility */}
      <div style={{
        position: "absolute", inset: 0,
        background: isDesktop
          ? "linear-gradient(90deg, rgba(15,4,48,0.94) 0%, rgba(15,4,48,0.72) 34%, rgba(15,4,48,0) 62%)"
          : "linear-gradient(90deg, rgba(15,4,48,0.96) 0%, rgba(15,4,48,0.78) 44%, rgba(15,4,48,0.15) 100%)",
      }} />

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 2, height: "100%",
        padding: isDesktop ? "30px 32px" : "20px 18px",
        display: "flex", flexDirection: "column", justifyContent: "center", gap: 12,
        maxWidth: isDesktop ? 460 : 300,
      }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, alignSelf: "flex-start", padding: "4px 11px", borderRadius: 999, background: "rgba(74,222,128,0.14)", border: "1px solid rgba(74,222,128,0.4)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: T.good, boxShadow: `0 0 8px ${T.good}` }} />
          <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.16em", color: T.good, textTransform: "uppercase" }}>G$ Perk Economy</span>
        </div>

        <h2 style={{ fontFamily: T.display, fontSize: isDesktop ? 34 : 26, color: T.ink, margin: 0, lineHeight: 1.05, letterSpacing: "-0.01em", textShadow: "0 2px 20px rgba(0,0,0,0.6)" }}>
          Never lose a<br />good run.
        </h2>

        <p style={{ fontFamily: T.body, fontSize: isDesktop ? 13.5 : 12, color: T.inkDim, margin: 0, lineHeight: 1.5, maxWidth: 300, textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}>
          Saves, retries and cosmetics paid in G$. Tap once, keep playing.
        </p>

        {/* Live proof — the number that ties back to Celoscan */}
        <div style={{ display: "inline-flex", alignItems: "baseline", gap: 6, alignSelf: "flex-start", marginTop: 2 }}>
          <span style={{ fontFamily: T.display, fontSize: isDesktop ? 22 : 19, color: T.good, lineHeight: 1, textShadow: "0 0 14px rgba(74,222,128,0.5)" }}>
            {fmtG(totalCommunity)} G$
          </span>
          <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, fontWeight: 700 }}>
            pooled for community UBI
          </span>
        </div>
      </div>
    </div>
  );
}
