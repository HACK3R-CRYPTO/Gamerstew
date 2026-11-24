"use client";

import Link from "next/link";

// ─── Arena cross-promo · game-over funnel ────────────────────────────────────
// Sits under the PLAY AGAIN / EXIT row on every skill game's result sheet.
// The moment a player finishes a run is peak "I'm good at this" energy —
// exactly when "prove it against the AI" converts. Drives skill-game
// traffic into the arena, where the ladder and G$ economy live. Also
// carries the "Built by GameArena" studio badge (brand association starts
// now, per the studio roadmap).
export default function ArenaCrossPromo() {
  return (
    <div style={{ marginTop: 12 }}>
      <Link href="/games/challenge-ai" style={{ textDecoration: "none" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 14,
            padding: "10px 14px",
            background: "linear-gradient(90deg, #14532d 0%, #22104f 100%)", // a solid dark card: its text is light
            border: "1px solid rgba(74,222,128,0.35)",
            cursor: "pointer",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/games/challenge-ai-v2/ai-bot-medium.png"
            alt="MARKOV"
            style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 0 8px rgba(251,191,36,0.5))" }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontSize: 12.5, fontWeight: 800, lineHeight: 1.25 }}>
              Think you&apos;re good? MARKOV learns your patterns.
            </div>
            <div style={{ color: "rgba(134,239,172,0.8)", fontSize: 10.5, fontWeight: 700, marginTop: 2 }}>
              Free · instant · beat the AI, climb the weekly ladder
            </div>
          </div>
          <span style={{ color: "#86efac", fontSize: 16, fontWeight: 900, flexShrink: 0 }}>›</span>
        </div>
      </Link>
      <div style={{ textAlign: "center", marginTop: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(34,16,79,0.6)" }}>
        ⚔️ BUILT BY GAMEARENA
      </div>
    </div>
  );
}
