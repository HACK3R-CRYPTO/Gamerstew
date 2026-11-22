"use client";

// ─── /world — entry point ────────────────────────────────────────────────────
// A thin Client Component page that LAZY-LOADS the entire 3D world client-only.
// `ssr: false` is valid here because this is a Client Component (Next 16 —
// node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md). The result:
// three.js + react-three-fiber + the GLB only ever download on /world, never
// server-render, and never bloat any other route's bundle.

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { initVatar } from "./vatar";

const World = dynamic(() => import("./World"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: "radial-gradient(ellipse 80% 60% at 50% 20%, #f6b36b 0%, #b5632b 35%, #2a1230 75%, #0a0120 100%)",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 40 }}>🏙️💡</div>
      <div style={{ fontWeight: 700, fontSize: 20 }}>Loading the neighbourhood…</div>
      <div style={{ opacity: 0.8, fontSize: 14 }}>Warming up the generator</div>
    </div>
  ),
});

export default function WorldPage() {
  // Activate the Vatar SDK when the game is embedded in a Vatar world (no-ops on
  // standalone gamearenahq.xyz). Wallet linking can be added once the account
  // mapping is decided; delivery already records the Vatar player.
  useEffect(() => {
    void initVatar();
  }, []);
  return <World />;
}
