"use client";

// ─── /bowling — Street Strike ────────────────────────────────────────────────
// Thin client page that lazy-loads the 3D game (three + rapier only download on
// this route and never server-render), same pattern as /world.

import dynamic from "next/dynamic";

const Game = dynamic(() => import("./Game"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
        background: "radial-gradient(ellipse 80% 60% at 50% 30%, #ffb36b 0%, #d0629a 35%, #4a2380 75%, #0a0120 100%)",
        color: "#fff", fontFamily: '"Fredoka", system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 44 }}>🛞</div>
      <div style={{ fontWeight: 700, fontSize: 20 }}>Setting up the bottles…</div>
    </div>
  ),
});

export default function BowlingPage() {
  return <Game />;
}
