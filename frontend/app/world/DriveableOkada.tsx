"use client";

// ─── DriveableOkada — hop on and ride ────────────────────────────────────────
// A parked okada (Lagos commercial motorcycle) with its rider BAKED INTO the
// model, so a person is always visibly on it (no glass, no hidden occupant).
// Same drive flow as DriveableKeke: tap DRIVE / press E to ride (one-tap summons
// it to you), WASD to ride, E to hop off; the Player hides while you ride and
// the camera follows the bike.
//
// TUNE after inspecting the generated GLB: SCALE (world size), FACE (rotate so
// the bike faces +Z at yaw 0), BASE_Y. The side-profile source means the bike's
// forward is along the model's X — FACE is likely ±90°.

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Clone, Html } from "@react-three/drei";
import * as THREE from "three";
import { worldControls } from "./controls";
import { useWorldStore } from "./store";
import { stylizeOnce } from "./theme";

const URL = "/world/models/okada.glb";
useGLTF.preload(URL);

// ── TUNED to okada.glb (dims x=1.90 length, y=0.86, z=1.50) ──
const SCALE = 1.15;         // ~2.2m bike
const FACE = -Math.PI / 2;  // model forward +X → face +Z at yaw 0 (verify by screenshot)
// ─────────────────────────────────────────────────────────────
const MAX_SPEED = 10.5;    // bikes are quicker than the keke
const ACCEL = 4.0;
const REVERSE_SCALE = 0.4;
const STEER_RATE = 2.4;    // snappier than the keke
const ENTER_DIST = 2.9;
const HALF_WIDTH = 5.2;
const HALF_LENGTH = 54;

export default function DriveableOkada({
  position = [-2.0, 0, 6] as [number, number, number],
  rotation = 0,
}) {
  const { scene } = useGLTF(URL);
  stylizeOnce(scene);
  const { model, yOff } = useMemo(() => {
    const s = scene.clone(true);
    s.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (m) m.envMapIntensity = 1.2;
      }
    });
    s.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s);
    return { model: s, yOff: -box.min.y * SCALE };
  }, [scene]);

  const group = useRef<THREE.Group>(null);
  const yaw = useRef(rotation);
  const speed = useRef(0);
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    if (!g) return;
    const wc = worldControls;

    if (!wc.driving) {
      const dx = wc.playerPos.x - g.position.x;
      const dz = wc.playerPos.z - g.position.z;
      const n = dx * dx + dz * dz < ENTER_DIST * ENTER_DIST;
      if (n !== nearRef.current) {
        nearRef.current = n;
        setNear(n);
      }
      if (wc.enterExit) {
        wc.enterExit = false;
        if (!n) {
          g.position.x = THREE.MathUtils.clamp(wc.playerPos.x + 1.2, -HALF_WIDTH, HALF_WIDTH);
          g.position.z = THREE.MathUtils.clamp(wc.playerPos.z, -HALF_LENGTH, HALF_LENGTH);
          yaw.current = 0;
          g.rotation.y = 0;
        }
        wc.driving = true;
        useWorldStore.getState().setDriving(true);
        nearRef.current = false;
        setNear(false);
      }
      return;
    }

    const throttle = -wc.input.z;
    const steer = wc.input.x;
    const target = (throttle >= 0 ? throttle : throttle * REVERSE_SCALE) * MAX_SPEED;
    speed.current += (target - speed.current) * (1 - Math.exp(-ACCEL * dt));
    if (Math.abs(speed.current) < 0.03) speed.current = 0;

    const roll = Math.min(1, Math.abs(speed.current) / 2.5);
    yaw.current -= steer * STEER_RATE * dt * roll * (speed.current >= 0 ? 1 : -1);

    g.position.x += Math.sin(yaw.current) * speed.current * dt;
    g.position.z += Math.cos(yaw.current) * speed.current * dt;
    g.position.x = THREE.MathUtils.clamp(g.position.x, -HALF_WIDTH, HALF_WIDTH);
    g.position.z = THREE.MathUtils.clamp(g.position.z, -HALF_LENGTH, HALF_LENGTH);
    g.rotation.y = yaw.current;

    wc.playerPos.set(g.position.x, 0, g.position.z);

    if (wc.enterExit) {
      wc.enterExit = false;
      wc.driving = false;
      useWorldStore.getState().setDriving(false);
      speed.current = 0;
      wc.playerPos.set(
        g.position.x - Math.cos(yaw.current) * 1.7,
        0,
        g.position.z + Math.sin(yaw.current) * 1.7,
      );
    }
  });

  return (
    <group ref={group} position={[position[0], position[1], position[2]]} rotation={[0, rotation, 0]}>
      <group rotation={[0, FACE, 0]} position={[0, yOff, 0]} scale={SCALE}>
        <Clone object={model} />
      </group>
      {near && (
        <Html center position={[0, 2.5, 0]} distanceFactor={10} style={{ pointerEvents: "auto" }}>
          {/* Tap the prompt on the bike to ride — the natural, no-corner-button way. */}
          <button data-ride-prompt=""
            onClick={(e) => {
              e.stopPropagation();
              worldControls.enterExit = true;
            }}
            style={{
              fontFamily: "system-ui, sans-serif",
              fontWeight: 900,
              fontSize: 15,
              color: "#05010f",
              background: "#fbbf24",
              padding: "8px 16px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              boxShadow: "0 4px 14px rgba(0,0,0,0.55)",
              letterSpacing: "0.02em",
              border: "none",
              cursor: "pointer",
            }}
          >
            🏍 Tap to ride
          </button>
        </Html>
      )}
    </group>
  );
}
