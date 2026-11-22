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
import { setObstaclesActive } from "./obstacles";

// Hard fps cap + pause-when-hidden, implemented with a manual render loop.
// The Canvas runs with frameloop="never" and we call `advance` ourselves at the
// target rate; when `running` is false (tab/canvas hidden) we stop advancing,
// which fully pauses rendering.
function FrameGovernor({ fps, running }: { fps: number; running: boolean }) {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    const interval = 1000 / fps;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= interval) {
        last = t;
        // In frameloop="never", R3F derives the per-frame delta as
        // (timestamp - clock.elapsedTime) and expects SECONDS. The rAF timestamp
        // is in MILLISECONDS, so pass seconds — otherwise every useFrame (and
        // Rapier's physics step) gets a ~60x-too-large delta and motion breaks.
        advance(t / 1000);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [advance, fps, running]);
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

  // Parked-vehicle colliders exist only in free-roam; both game modes hide the
  // parked cars (moving traffic instead), so their colliders must be off there too.
  useEffect(() => {
    setObstaclesActive(mode === "menu");
    return () => setObstaclesActive(true);
  }, [mode]);

  return (
    <>
      <FrameGovernor fps={quality().fps} running={running} />
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
        enablePan={false}
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.7}
        zoomSpeed={0.8}
        minDistance={5}
        maxDistance={18}
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
