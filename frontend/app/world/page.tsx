"use client";

// ─── /world — entry point ────────────────────────────────────────────────────
// A thin Client Component page that LAZY-LOADS the entire 3D world client-only.
// `ssr: false` is valid here because this is a Client Component (Next 16 —
// node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md). The result:
// three.js + react-three-fiber + the GLB only ever download on /world, never
// server-render, and never bloat any other route's bundle.

import dynamic from "next/dynamic";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { useEffect } from "react";
import { initVatar } from "./vatar";

const World = dynamic(() => import("./World"), {
  ssr: false,
  // the same loading screen every game uses, in the app's look
  loading: () => <GameLoadingScreen title="UP NEPA 3D" art="/games/covers/upnepa3d.jpg" bg="" glow="" />,
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
