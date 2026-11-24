"use client";

// ─── /bowling — Street Strike ────────────────────────────────────────────────
// Thin client page that lazy-loads the 3D game (three + rapier only download on
// this route and never server-render), same pattern as /world.

import dynamic from "next/dynamic";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";

const Game = dynamic(() => import("./Game"), {
  ssr: false,
  // the same loading screen every game uses, in the app's look
  loading: () => <GameLoadingScreen title="Street Strike" art="/games/covers/streetstrike.jpg" bg="" glow="" />,
});

export default function BowlingPage() {
  return <Game />;
}
