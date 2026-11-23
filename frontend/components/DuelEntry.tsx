"use client";

// ─── DuelEntry ───────────────────────────────────────────────────────────────
// "Play a friend" lives inside each game, next to its own modes, so a player
// meets it where they decide how to play. It used to be one card on the
// leaderboard page, which nobody looking for a game would find.
//
// The tile opens the room builder with THIS game already chosen and the staked
// duel selected, or the list of rooms the player can join.

import Link from "next/link";

export type DuelGame = "rhythm" | "simon" | "stack" | "challenge-ai";

const GOLD = "#fbbf24";

export default function DuelEntry({ game, compact = false }: { game: DuelGame; compact?: boolean }) {
  return (
    <div
      style={{
        width: "100%", maxWidth: 360, margin: compact ? "8px auto 0" : "10px auto 0", boxSizing: "border-box",
        borderRadius: 16, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
        background: "linear-gradient(115deg, rgba(120,53,15,0.42) 0%, rgba(30,14,74,0.72) 60%, rgba(20,8,52,0.9) 100%)",
        border: "1px solid rgba(251,191,36,0.38)", boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif", textAlign: "left",
      }}
    >
      <div aria-hidden style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>⚔️</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>Duel a friend</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.68)", lineHeight: 1.3, marginTop: 2 }}>Both stake G$. Higher score takes the pot.</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <Link
          href={`/duel/create?game=${game}&mode=duel`}
          style={{ textDecoration: "none", padding: "8px 12px", borderRadius: 11, fontSize: 12.5, fontWeight: 900, color: "#1a0b33", background: GOLD, boxShadow: "0 3px 0 #b45309" }}
        >
          Create
        </Link>
        <Link
          href="/duel"
          style={{ textDecoration: "none", padding: "8px 12px", borderRadius: 11, fontSize: 12.5, fontWeight: 800, color: "#fff", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.22)" }}
        >
          Join
        </Link>
      </div>
    </div>
  );
}
