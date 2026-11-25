"use client";

// ─── Everything that lives inside the <Canvas> ───────────────────────────────
// Assembles the street, the NEPA light rig + director, props, the danfo and the
// player, plus the mobile perf governor (AdaptiveDpr + PerformanceMonitor +
// a hard fps cap driven by a manual render loop).

import { quality } from "./quality";
import { Suspense, useEffect } from "react";
import { useThree, useStore } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  Lightformer,
  AdaptiveDpr,
  PerformanceMonitor,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, HueSaturation, BrightnessContrast } from "@react-three/postprocessing";
import Lights from "./Lights";
import Batch from "./Batch";
import Street from "./Street";
import SideStreet from "./SideStreet";
import LoopRoads from "./LoopRoads";
import StreetProps from "./StreetProps";
import Danfo from "./Danfo";
import Keke from "./Keke";
import FreeRoam from "./FreeRoam";
import Cars from "./Cars";
import Traffic from "./Traffic";
import DriveableKeke from "./DriveableKeke";
import Pickups from "./Pickups";
import Billboard from "./Billboard";
import Trees from "./Trees";
import GasStation from "./GasStation";
import StreetClutter from "./StreetClutter";
import Signboards from "./Signboards";
import Generators from "./Generators";
import PolesAndWires from "./PolesAndWires";
import LaundryLines from "./LaundryLines";
import Player from "./Player";
import Pedestrians from "./Pedestrians";
import LagosBuildings from "./LagosBuildings";
import NepaDirector from "./NepaDirector";
import Devices from "./Devices";
import GameDirector from "./GameDirector";
import PowerPoints from "./PowerPoints";
import RestoreDirector from "./RestoreDirector";
import GuideArrow from "./GuideArrow";
import IntroDirector from "./IntroDirector";
import PerfProbe from "./PerfProbe";
import { useWorldStore } from "./store";
import { useAppStore } from "./appStore";
import { worldControls } from "./controls";
import { rememberSettled, deviceFacts } from "./quality";
import { track } from "@/lib/track";
import { setObstaclesActive } from "./obstacles";

// Hard fps cap + pause-when-hidden, implemented with a manual render loop.
// The Canvas runs with frameloop="never" and we call `advance` ourselves at the
// target rate; when `running` is false (tab/canvas hidden) we stop advancing,
// which fully pauses rendering.
//
// It also looks after sharpness. The world starts at the tier's sharpest
// setting. If this phone then draws well under its target rate for four seconds,
// the picture is made one step softer. If it runs easily for six seconds, it is
// made one step sharper, up to the sharpest worth drawing. The frame target
// moves the same way: a phone at its softest that still cannot reach 60 is
// held to a steady 30, and a phone guessed at 30 that has room is given 60. A level that proved
// too much is not tried again, so the picture never flips back and forth. The first seconds are ignored: loading the street stutters on
// any phone. So a strong phone stays crisp and a weak one stays smooth, without
// anyone choosing a setting.
function FrameGovernor({ fps, running, maxDpr, minDpr, climb }: { fps: number; running: boolean; maxDpr: number; minDpr: number; climb: boolean }) {
  const advance = useThree((s) => s.advance);
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    // a little under the true interval: screens tick at 16.6 ms, and waiting for a
    // full 16.67 skipped every other tick and halved a 60 fps target to 30
    let rate = fps; // the frame target: it starts at the tier's guess and is adjusted like the sharpness
    let interval = 1000 / rate - 3;
    let ticks = 0, tickMs = 0, lastTick = 0, tried60 = false, windows = 0;
    // The tier is a first guess from what the phone says about itself, and phones
    // say little. So the guess is only where it STARTS: a phone that proves quick
    // is taken up a step at a time to the sharpest worth drawing (2, or the
    // screen's own limit), and one that proves slow is taken down. This is what
    // makes an unknown phone come out right.
    const top = climb ? Math.min(2, window.devicePixelRatio || 1) : Math.min(maxDpr, window.devicePixelRatio || 1); // a level the player chose is the ceiling
    const cap = Math.min(maxDpr, top); const floor = Math.min(minDpr, cap);
    let dpr = cap; let frames = 0; let since = 0; let slow = 0; let quick = 0; let tooMuch = Infinity; let born = 0;
    setDpr(dpr);
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // how often the screen itself ticks, drawn or not: at a 30 target every other tick is
      // skipped, and ticks that still arrive on time say the phone has room for more
      if (lastTick && t - lastTick < 500) { ticks++; tickMs += t - lastTick; }
      lastTick = t;
      if (t - last >= interval) {
        const gap = last ? t - last : 0;
        last = t;
        if (!born) born = t;
        if (gap > 0 && gap < 500 && t - born > 5000) { // a long gap is a hidden tab or a load, not a slow phone
          frames++; since += gap;
          if (since >= 2000) {
            const got = (frames * 1000) / since; frames = 0; since = 0;
            const tick = ticks ? tickMs / ticks : 0; ticks = 0; tickMs = 0;
            if (process.env.NODE_ENV !== "production") (window as unknown as { __gov?: unknown }).__gov = { got: Math.round(got), rate, dpr, tick: Math.round(tick) };
            // After twenty seconds of play it has found its level: keep it for the next visit,
            // and tell the dashboard once what this device is and how it ran.
            windows++;
            if (windows === 10) { if (climb) rememberSettled(dpr, rate); track("device_profile", { ...deviceFacts(), game: "UP NEPA 3D", settled_dpr: dpr, settled_fps: rate, got_fps: Math.round(got) }); }
            slow = got < rate * 0.72 ? slow + 1 : 0; quick = got > rate * 0.93 ? quick + 1 : 0;
            if (slow >= 2 && dpr > floor) { tooMuch = dpr; dpr = Math.max(floor, dpr - 0.25); setDpr(dpr); slow = 0; quick = 0; }
            // As soft as it goes and still short of 60: a steady 30 looks and feels better
            // than a 60 that stutters. This is the phone that pasted the link into Chrome,
            // has plenty of memory and cores on paper, and a slow graphics chip.
            else if (slow >= 2 && rate > 30) { rate = 30; interval = 1000 / rate - 3; slow = 0; quick = 0; tried60 = true; }
            // six easy seconds: try one step sharper, unless that step already proved too much
            else if (quick >= 3 && dpr + 0.25 <= top && dpr + 0.25 < tooMuch) { dpr += 0.25; setDpr(dpr); quick = 0; }
            // already as sharp as is worth drawing, held to 30, and the screen still ticks on
            // time with every other frame skipped: this phone can do 60. Tried once only.
            else if (climb && quick >= 3 && rate < 60 && !tried60 && tick > 0 && tick < 19) { rate = 60; interval = 1000 / rate - 3; quick = 0; tried60 = true; }
          }
        }
        // In frameloop="never", R3F derives the per-frame delta as
        // (timestamp - clock.elapsedTime) and expects SECONDS. The rAF timestamp
        // is in MILLISECONDS, so pass seconds — otherwise every useFrame (and
        // Rapier's physics step) gets a ~60x-too-large delta and motion breaks.
        advance(t / 1000);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [advance, fps, running, maxDpr, minDpr, climb, setDpr]);
  return null;
}

// Dev-only: stash the R3F store on window so the headless QA harness can frame
// the camera (with __cineActive) and pump a frame. Mirrors __appStore/__wc.
function DevStoreHook() {
  const store = useStore();
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __r3fStore?: unknown }).__r3fStore = store;
  }, [store]);
  return null;
}

export default function Scene({
  isMobile,
  running,
}: {
  isMobile: boolean;
  running: boolean;
}) {
  const lowPerf = useWorldStore((s) => s.lowPerf);
  const setLowPerf = useWorldStore((s) => s.setLowPerf);
  const mode = useAppStore((s) => s.mode);
  const lobby = useAppStore((s) => s.lobby);

  // Parked-vehicle colliders exist only in free-roam; both game modes hide the
  // parked cars (moving traffic instead), so their colliders must be off there too.
  useEffect(() => {
    setObstaclesActive(mode === "menu");
    return () => setObstaclesActive(true);
  }, [mode]);

  return (
    <>
      <FrameGovernor fps={quality().fps} running={running} maxDpr={quality().dpr} minDpr={quality().minDpr} climb={quality().climb} />
      {process.env.NODE_ENV !== "production" && <DevStoreHook />}
      {process.env.NODE_ENV !== "production" && <PerfProbe />}

      {/* Degrade-only perf governor. */}
      <AdaptiveDpr pixelated={false} />
      <PerformanceMonitor
        onDecline={() => setLowPerf(true)}
        flipflops={3}
      />

      {/* Per-mode brains + interactive objects (no geometry in the directors). */}
      {mode === "intro" && <IntroDirector />}
      {mode === "charge" && (
        <>
          <NepaDirector />
          <GameDirector />
          <Devices />
          <Traffic />
          {/* A keke you can hop into for fast traversal between devices (hop off to
              charge — see the directors' driving guard). */}
          <DriveableKeke position={[2.4, 0, 12]} />
          <Pickups />
          <GuideArrow />
        </>
      )}
      {mode === "restore" && (
        <>
          <RestoreDirector />
          <PowerPoints />
          <Traffic />
          {/* Ride a keke to sprint between breakers; hop off to flip/save them. */}
          <DriveableKeke position={[2.4, 0, 12]} />
          <Pickups />
          <GuideArrow />
        </>
      )}

      {/* Warm reactive light rig. */}
      <Lights lowPerf={lowPerf} />

      {/* Subtle, network-free environment for soft specular (computed once). */}
      <Environment resolution={64} frames={1} background={false}>
        <Lightformer intensity={1.2} color="#ffd9a0" position={[0, 8, 4]} scale={[12, 12, 1]} />
        <Lightformer intensity={0.5} color="#ff9e5e" position={[-8, 4, -6]} scale={[8, 8, 1]} />
      </Environment>

      <Street isMobile={isMobile} />
      {/* Phase 1 map: a side street branching off at the junction (free-roam only). */}
      {mode === "menu" && <Batch><SideStreet /></Batch>}
      {/* Loop roads: close the east cross-street into a drivable circuit. */}
      {mode === "menu" && <Batch><LoopRoads /></Batch>}
      <Batch><LagosBuildings /></Batch>
      <Billboard position={[7, 7, -30]} rotation={-0.6} />
      <Billboard position={[-7.5, 8, -70]} rotation={0.5} />
      <Trees />
      <Batch><GasStation position={[-12.5, 0, -40]} /></Batch>
      <Batch><StreetClutter /></Batch>
      <StreetProps />
      <Batch><Signboards /></Batch>
      <Generators />
      <Batch><PolesAndWires /></Batch>
      <LaundryLines />
      {/* Parked roadside vehicles — free-roam ONLY. Both game modes now carry the
          MOVING traffic (Traffic.tsx) in the lanes instead, so parked cars don't
          clutter the road or block the dodge. */}
      {mode === "menu" && (
        <>
          <Danfo position={[3.1, 0, -6]} rotation={0} variant={0} />
          <Danfo position={[-2.6, 0, 22]} rotation={Math.PI} variant={1} />
          <Keke position={[-3.0, 0, -18]} rotation={Math.PI + 0.2} />
          <Cars />
        </>
      )}
      <Suspense fallback={null}>
        {/* Free-roam runs on real Rapier physics (character + rideable keke +
            colliders). The game modes keep the hand-coded Player for now. */}
        {mode === "menu" ? <FreeRoam /> : <Player />}
        <Pedestrians />
      </Suspense>

      {/* User-controlled orbit. Player.tsx keeps `target` glued to the character
          (translating the camera by the same delta) so the angle YOU set is
          preserved while the camera follows you. Drag = rotate, wheel/pinch = zoom. */}
      <OrbitControls
        makeDefault
        // behind the lobby the street turns slowly on its own; the player cannot steer it
        autoRotate={lobby && mode === "menu"}
        autoRotateSpeed={0.45}
        enableRotate={!lobby}
        enableZoom={!lobby}
        enablePan={false}
        enableDamping
        dampingFactor={0.12}
        // a thumb travels less far than a mouse: turn further per swipe on a phone
        rotateSpeed={isMobile ? 1.05 : 0.7}
        onStart={() => { worldControls.lookedAt = performance.now(); }}
        onEnd={() => { worldControls.lookedAt = performance.now(); }}
        zoomSpeed={0.8}
        minDistance={isMobile ? 4 : 5}
        maxDistance={isMobile ? 14 : 18}
        minPolarAngle={0.35}
        maxPolarAngle={1.35}
        target={[0, 1.1, 0]}
      />

      {/* Premium post stack — desktop only (gated off on mobile to protect fps).
          Threshold bloom so ONLY the glowing bits bloom (device/transformer
          glows, the restore flare), a warm grade + a vignette to compose the frame. */}
      {!isMobile && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom luminanceThreshold={0.82} luminanceSmoothing={0.15} intensity={0.55} mipmapBlur />
          <HueSaturation saturation={0.12} />
          <BrightnessContrast brightness={0.01} contrast={0.12} />
          <Vignette offset={0.3} darkness={0.5} />
        </EffectComposer>
      )}
    </>
  );
}
