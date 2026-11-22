"use client";

// ─── The NEPA light cycle — the heart of the world ───────────────────────────
// A telegraphed, round-synced light rhythm (not a random flick):
//
//   ON     lights steady, you charge. Lasts a RANDOMISED window so it is tense
//          but never metronomic.
//   WARN   ~3s heads-up: the bulbs start flickering (harder as it runs out) and
//          a "NEPA wan carry light!" banner shows. You still have light, so you
//          scramble to bank what is charging.
//   CUT    real darkness, charging dies everywhere, "NEPA don carry light!".
//   RELIGHT power floods back with one warm surge, "UP NEPA!", then settles ON.
//
// It only cycles WHILE A ROUND IS PLAYING (useGameStore mode === "playing"), and
// it resets to a fresh ON window the instant a round starts — so the menu and the
// game-over screen stay lit, and the first cut never ambushes you at t=0. `lit`
// is eased toward each phase target with an exponential time-constant; WARN and
// RELIGHT add a short flicker on top.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { worldControls, type NepaPhase } from "./controls";
import { useWorldStore } from "./store";
import { useGameStore } from "./game";
import { playNepaCut, playNepaUp } from "./audio";
import { useFx } from "./fx";

// ESCALATION: each successive light window is shorter than the last (floored),
// so the round ramps from calm to frantic. Values rise in game.ts in step.
// How long NEPA leaves the light on. It shrinks each time AND swings by several
// seconds either way, so you can never count on the fridge fitting: you have to
// read the flicker warning and decide. (With long, steady windows the priciest
// device was always safe and there was no gamble at all.)
const WIN_START = 11.5; // average steady-light seconds for the first window
const WIN_STEP = 1.3; // shaved off the average per window
const WIN_FLOOR = 5; // the average never drops below this
const WIN_RAND = 3.2; // +/- swing around the average
const WARN_DURATION = 2.6; // seconds of flicker warning before the cut
const CUT_DURATION = 3.4; // seconds of real blackout (kept short for momentum)
const RELIGHT_DURATION = 1.2; // seconds of surge on the way back
const CUT_LEVEL = 0.05; // residual moonlight during a blackout

const windowLength = (windowIndex: number) =>
  Math.max(3.2, Math.max(WIN_FLOOR, WIN_START - windowIndex * WIN_STEP) + (Math.random() * 2 - 1) * WIN_RAND);

const easeFactor = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export default function NepaDirector() {
  const t = useRef(0); // seconds spent in the current phase
  const onLen = useRef(windowLength(0)); // this window's length
  const setHud = useWorldStore((s) => s.setHud);
  const setPhase = useWorldStore((s) => s.setPhase);
  const setDarkness = useWorldStore((s) => s.setDarkness);
  const hudKey = useRef(0);
  const darkThrottle = useRef(0);
  const prevPlaying = useRef(false);

  const enter = (phase: NepaPhase) => {
    worldControls.phase = phase;
    t.current = 0;
    setPhase(phase);
    if (phase === "on") {
      onLen.current = windowLength(worldControls.windowIndex);
      setHud({ title: "", sub: "", tone: "neutral", key: hudKey.current });
    } else if (phase === "warn") {
      hudKey.current += 1;
      setHud({ title: "NEPA wan carry light!", sub: "Bank am sharp sharp!", tone: "cut", key: hudKey.current });
    } else if (phase === "cut") {
      hudKey.current += 1;
      setHud({ title: "NEPA don carry light!", sub: "The whole area don blackout", tone: "cut", key: hudKey.current });
      playNepaCut();
    } else if (phase === "relight") {
      hudKey.current += 1;
      setHud({ title: "UP NEPA!", sub: "Light don come back 💡", tone: "relight", key: hudKey.current });
      worldControls.surge = 1;
      useFx.getState().flash(true); // UP NEPA screen flare
      playNepaUp();
    }
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const playing = useGameStore.getState().mode === "playing";

    // Round start → fresh first window. Round end/menu → hold the lights on.
    if (playing && !prevPlaying.current) {
      worldControls.windowIndex = 0;
      enter("on");
    } else if (!playing && prevPlaying.current) {
      worldControls.phase = "on";
      t.current = 0;
      worldControls.lightLeft = 0;
      setPhase("on");
      setHud({ title: "", sub: "", tone: "neutral", key: hudKey.current });
    }
    prevPlaying.current = playing;

    t.current += dt;

    if (playing) {
      // Manual trigger kept as a debug shortcut (N key), harmless mid-game.
      if (worldControls.pendingToggle) {
        worldControls.pendingToggle = false;
        if (worldControls.phase === "on") enter("warn");
        else if (worldControls.phase === "warn") enter("cut");
        else if (worldControls.phase === "cut") enter("relight");
      }

      switch (worldControls.phase) {
        case "on":
          if (t.current >= onLen.current) enter("warn");
          break;
        case "warn":
          if (t.current >= WARN_DURATION) enter("cut");
          break;
        case "cut":
          if (t.current >= CUT_DURATION) enter("relight");
          break;
        case "relight":
          if (t.current >= RELIGHT_DURATION) {
            worldControls.windowIndex += 1; // next window is shorter + richer
            enter("on");
          }
          break;
      }

      // Light countdown: seconds until the blackout actually lands.
      if (worldControls.phase === "on") {
        worldControls.lightLeft = Math.max(0, onLen.current - t.current) + WARN_DURATION;
      } else if (worldControls.phase === "warn") {
        worldControls.lightLeft = Math.max(0, WARN_DURATION - t.current);
      } else {
        worldControls.lightLeft = 0;
      }
    } else {
      worldControls.pendingToggle = false; // ignore stray toggles off-round
      worldControls.lightLeft = 0;
    }

    // Ramp `lit` toward the phase target.
    let target = 1;
    let k = 4;
    if (worldControls.phase === "cut") {
      target = CUT_LEVEL;
      k = 6;
    } else if (worldControls.phase === "relight") {
      target = 1;
      k = 9;
    }
    worldControls.lit += (target - worldControls.lit) * easeFactor(k, dt);

    // WARN flicker — gentle at first, harder as the window runs out.
    if (worldControls.phase === "warn") {
      const urgency = Math.min(1, t.current / WARN_DURATION); // 0 → 1
      if (Math.random() < 0.25 + urgency * 0.4) {
        worldControls.lit *= 1 - (0.1 + urgency * 0.35) * Math.random();
      }
    }
    // RELIGHT: one brief soft flicker (not a strobe) as power stabilises.
    if (worldControls.phase === "relight" && t.current < 0.35) {
      worldControls.lit *= 0.7 + 0.3 * Math.random();
    }
    worldControls.lit = Math.max(0, Math.min(1, worldControls.lit));

    // Warm RELIGHT overshoot decays back to 0 over ~1s.
    worldControls.surge += (0 - worldControls.surge) * easeFactor(2.4, dt);
    if (worldControls.surge < 0.001) worldControls.surge = 0;

    // Push darkness to the HUD meter ~8x/sec (not every frame).
    darkThrottle.current += dt;
    if (darkThrottle.current > 0.12) {
      darkThrottle.current = 0;
      setDarkness(1 - worldControls.lit);
    }
  });

  return null;
}
