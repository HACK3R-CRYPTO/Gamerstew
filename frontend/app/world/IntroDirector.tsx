"use client";

// ─── IntroDirector — the cold-open wow beat ──────────────────────────────────
// Runs once on load (appMode === "intro"), before the menu. The street is shown,
// then NEPA takes the light (blackout), a beat of darkness, then UP NEPA — light
// floods back with a gold flash + exposure surge + bloom + cheer + "UP NEPA!".
// Judges see the payoff in the first ~4 seconds. Then it hands off to the menu.
// A tap/key skips straight to the menu (handled in World).

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { worldControls } from "./controls";
import { useWorldStore } from "./store";
import { useAppStore } from "./appStore";
import { useFx } from "./fx";
import { playNepaCut, playNepaUp, playCheer } from "./audio";
import { useShout } from "./shout";

const DARK = 0.04;

export default function IntroDirector() {
  const t = useRef(0);
  const phase = useRef(0);
  const hudKey = useRef(0);
  const setHud = useWorldStore((s) => s.setHud);
  const setMode = useAppStore((s) => s.setMode);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    t.current += dt;

    if (phase.current === 0 && t.current > 0.5) {
      // NEPA takes the light.
      phase.current = 1;
      hudKey.current += 1;
      setHud({ title: "NEPA don carry light!", sub: "the whole area don blackout", tone: "cut", key: hudKey.current });
      playNepaCut();
    } else if (phase.current === 1 && t.current > 2.3) {
      // UP NEPA — the flood.
      phase.current = 2;
      hudKey.current += 1;
      setHud({ title: "UP NEPA!", sub: "light don come back 💡", tone: "relight", key: hudKey.current });
      worldControls.surge = 1;
      worldControls.shake = 0.45;
      useFx.getState().flash(true);
      playNepaUp();
      playCheer();
      useShout.getState().shout("UP NEPA!", "big");
    } else if (phase.current === 2 && t.current > 4.4) {
      // Hand off to the menu.
      phase.current = 3;
      setHud({ title: "", sub: "", tone: "neutral", key: hudKey.current });
      worldControls.lit = 1;
      setMode("menu");
    }

    const target = phase.current === 1 ? DARK : 1;
    worldControls.lit += (target - worldControls.lit) * Math.min(1, dt * (phase.current === 2 ? 9 : 5));
    worldControls.surge += (0 - worldControls.surge) * (1 - Math.exp(-2.4 * dt));
    if (worldControls.surge < 0.001) worldControls.surge = 0;
  });

  return null;
}
