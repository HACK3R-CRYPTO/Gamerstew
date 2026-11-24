"use client";

// ─── RideKeke — a rideable Lagos keke on real Rapier physics ─────────────────
// The body is a generated/optimised keke model (keke-ride.glb). The chassis is
// a dynamic Rapier rigid body, so it has momentum (it coasts), it collides with
// buildings and parked vehicles for real, and it can't be driven through a wall.
// It leans into a turn, and a driver sits in it (Occupant) so it reads as a
// normal, populated game asset whether parked or ridden. If the model exposes
// named wheel / steer nodes they also spin + steer; otherwise motion carries it.
//
// Convention: the keke's FORWARD is +Z at yaw 0 (matches the character + camera).

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Html } from "@react-three/drei";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import Occupant from "./Occupant";
import { worldControls } from "./controls";
import { useWorldStore } from "./store";
import { stylizeOnce } from "./theme";
import { KekeModel } from "./LowPolyCar";

const URL = "/world/models/keke-ride.glb";
useGLTF.preload(URL);

// ── TUNED to keke-ride.glb (Sketchfab Keke Napep by Flashtech, CC-BY; 1.9 long) ──
const SCALE = 1.1; // ~2.09 m keke
const FACE = Math.PI / 2; // model front → face +Z (travel direction) at yaw 0
// This keke has its own modelled seats; no extra driver (scale 0 hides the Occupant).
const DRIVER = { pos: [0.1, 0.5, 0.2] as [number, number, number], rot: Math.PI, scale: 0 };
// ─────────────────────────────────────────────────
const MAX_SPEED = 8.5;
const ACCEL = 3.6;
const REVERSE_SCALE = 0.4;
const STEER_RATE = 2.0; // physical yaw rate (rad/s) scaled by speed
const STEER_VIS = 0.5; // front-wheel visual steer (rad), if a steer node exists
const LEAN_MAX = 0.15; // body roll into a turn (rad)
const ENTER_DIST = 3.0;
const ROAD_HALF = 4.0; // keep the keke on the tarmac
const WHEEL_R = 0.3; // for wheel spin, if wheel nodes exist

export default function RideKeke({
  position = [2.4, 0.05, 9] as [number, number, number],
}: {
  position?: [number, number, number];
}) {
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null); // gets the lean
  const steerNode = useRef<THREE.Object3D | null>(null);
  const spinNodes = useRef<THREE.Object3D[]>([]);

  const speed = useRef(0);
  const steerVis = useRef(0);
  const leanZ = useRef(0);
  const spin = useRef(0);
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);
  const fwd = useRef(new THREE.Vector3());

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

  // Collect the wheel/steer nodes from the ACTUAL rendered model after commit
  // (doing it in useMemo mutated refs during render, which React's dev double-
  // render desynced from the model on screen — so the spin hit off-screen nodes).
  useEffect(() => {
    const wheels: THREE.Object3D[] = [];
    steerNode.current = null;
    model.traverse((o) => {
      if (/steer/i.test(o.name)) { steerNode.current = o; o.matrixAutoUpdate = true; }
      if (/wheel/i.test(o.name)) { wheels.push(o); o.matrixAutoUpdate = true; }
    });
    spinNodes.current = wheels;
  }, [model]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const b = body.current;
    if (!b) return;
    const t = b.translation();

    // ── Parked: proximity → prompt; enterExit → start riding (summon if far) ──
    if (!worldControls.driving) {
      const dx = worldControls.playerPos.x - t.x;
      const dz = worldControls.playerPos.z - t.z;
      const n = dx * dx + dz * dz < ENTER_DIST * ENTER_DIST;
      if (n !== nearRef.current) {
        nearRef.current = n;
        setNear(n);
      }
      if (worldControls.enterExit) {
        worldControls.enterExit = false;
        if (!n) {
          const sx = THREE.MathUtils.clamp(worldControls.playerPos.x, -ROAD_HALF, ROAD_HALF);
          b.setTranslation({ x: sx, y: position[1], z: worldControls.playerPos.z }, true);
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        worldControls.driving = true;
        useWorldStore.getState().setDriving(true);
        nearRef.current = false;
        setNear(false);
      } else {
        speed.current *= Math.exp(-2 * dt);
      }
      updateVisual(dt);
      return;
    }

    // ── Riding ──────────────────────────────────────────────────────────────
    const rot = b.rotation();
    const yaw = Math.atan2(
      2 * (rot.w * rot.y + rot.x * rot.z),
      1 - 2 * (rot.y * rot.y + rot.z * rot.z),
    );
    fwd.current.set(Math.sin(yaw), 0, Math.cos(yaw));

    const throttle = -worldControls.input.z;
    const steer = worldControls.input.x;
    const target = (throttle >= 0 ? throttle : throttle * REVERSE_SCALE) * MAX_SPEED;
    speed.current += (target - speed.current) * (1 - Math.exp(-ACCEL * dt));
    if (Math.abs(speed.current) < 0.03) speed.current = 0;

    const vy = b.linvel().y;
    b.setLinvel({ x: fwd.current.x * speed.current, y: vy, z: fwd.current.z * speed.current }, true);
    const roll = Math.min(1, Math.abs(speed.current) / 2.5);
    const yawRate = -steer * STEER_RATE * roll * (speed.current >= 0 ? 1 : -1);
    b.setAngvel({ x: 0, y: yawRate, z: 0 }, true);

    // No hard road clamp — the Rapier walls bound the keke, so it can turn off
    // the main road into the side street at the junction.
    worldControls.playerPos.set(t.x, 0, t.z);

    updateVisual(dt);

    // Exit: hop off beside the keke.
    if (worldControls.enterExit) {
      worldControls.enterExit = false;
      worldControls.driving = false;
      useWorldStore.getState().setDriving(false);
      speed.current = 0;
      b.setLinvel({ x: 0, y: b.linvel().y, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      worldControls.playerPos.set(t.x - Math.cos(yaw) * 1.4, 0, t.z + Math.sin(yaw) * 1.4);
    }
  });

  function updateVisual(dt: number) {
    const steer = worldControls.driving ? worldControls.input.x : 0;
    // Lean the body into the turn, proportional to speed.
    const speedF = Math.min(1, Math.abs(speed.current) / MAX_SPEED);
    const targetLean = -steer * LEAN_MAX * speedF * (speed.current >= 0 ? 1 : -1);
    leanZ.current += (targetLean - leanZ.current) * Math.min(1, dt * 8);
    if (visual.current) visual.current.rotation.z = leanZ.current;
    // Steer + spin named nodes if the model exposes them.
    if (steerNode.current) {
      const target = -steer * STEER_VIS;
      steerVis.current += (target - steerVis.current) * Math.min(1, dt * 10);
      steerNode.current.rotation.y = steerVis.current;
    }
    if (spinNodes.current.length) {
      spin.current += (speed.current * dt) / WHEEL_R;
      // Wheels' axle is the model-local Z (verified from the GLB node layout),
      // so rolling is a rotation about Z.
      for (const w of spinNodes.current) w.rotation.z = spin.current;
    }
  }

  return (
    <RigidBody
      ref={body}
      type="dynamic"
      colliders={false}
      position={position}
      enabledRotations={[false, true, false]}
      linearDamping={0.7}
      angularDamping={4}
      canSleep={false}
      ccd
    >
      {/* Chassis collider — spans the body, bottom at local y=0.
          After FACE: world width≈1.0 (x), length≈2.1 (z). */}
      <CuboidCollider args={[0.5, 0.55, 1.05]} position={[0, 0.55, 0]} />

      {/* Body (gets the lean) + seated driver. */}
      <group ref={visual}>
        <KekeModel seed={23} pax={0} speed={() => speed.current} driver={false} player={() => worldControls.driving} />
        {DRIVER.scale > 0 && <Occupant position={DRIVER.pos} rotation={DRIVER.rot} scale={DRIVER.scale} />}
      </group>

      {near && (
        <Html center position={[0, 2.1, 0]} distanceFactor={10} zIndexRange={[25, 0]} style={{ pointerEvents: "auto" }}>
          <button data-ride-prompt=""
            onClick={(e) => {
              e.stopPropagation();
              worldControls.enterExit = true;
            }}
            style={{
              fontFamily: "system-ui, sans-serif", fontWeight: 900, fontSize: 15,
              color: "#05010f", background: "#fbbf24", padding: "8px 16px",
              borderRadius: 999, whiteSpace: "nowrap", boxShadow: "0 4px 14px rgba(0,0,0,0.55)",
              border: "none", cursor: "pointer",
            }}
          >
            🛺 Tap to ride
          </button>
        </Html>
      )}
    </RigidBody>
  );
}
