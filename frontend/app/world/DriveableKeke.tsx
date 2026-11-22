"use client";

// ─── DriveableKeke — hop in and drive ────────────────────────────────────────
// A parked keke you can enter (walk close + press E / tap ENTER) and drive with
// WASD. Driving is CAMERA-RELATIVE, exactly like walking: the direction you press
// is the direction the keke travels ON SCREEN, whatever angle you've orbited to —
// it just moves faster and heavier, and the body smoothly yaws to face travel.
// (It used to be car-style tank steering — A/D rotate the nose, W drives along it
// — but the camera never rotates to follow, so once you'd turned, W went off at an
// angle and A/D felt inverted. That fixed-camera-vs-nose mismatch read as "wrong"
// on desktop.) While driving, this owns the camera focus (writes
// worldControls.playerPos to itself) and the Player hides + freezes. Press E again
// to hop out beside it.
//
// Orientation matches Keke.tsx: the model front faces -X, so an inner FACE
// rotation makes it face +Z at yaw 0; the outer group's rotation.y IS the yaw, and
// forward is (sin yaw, 0, cos yaw) — so yaw = atan2(velX, velZ) faces travel.

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, Clone, Html } from "@react-three/drei";
import * as THREE from "three";
import { worldControls } from "./controls";
import { useWorldStore } from "./store";
import { stylizeOnce } from "./theme";
import { KekeModel } from "./LowPolyCar";

// Use the nicer RIDE keke model (same one free-roam uses), not the plain meshy one.
const URL = "/world/models/keke-ride.glb";
useGLTF.preload(URL);

const SCALE = 1.1;          // matches RideKeke's tuning for keke-ride.glb (~2.1 m)
const FACE = Math.PI / 2;   // model front → faces +Z at yaw 0 (same as RideKeke)
const MAX_SPEED = 7.5;      // m/s top speed (faster than the ~4 m/s run)
const ACCEL = 3.2;          // how fast velocity eases up to target under input
const DECEL = 4.5;          // coast-down friction when you release
const TURN_RATE = 1.35;     // steering: max nose turn (rad/s) at speed. ~75°/s: a 9 m road needs gentle hands
const BRAKE = 6;            // braking is quicker than accelerating
const REVERSE_SCALE = 0.38; // reverse top speed, as a share of MAX_SPEED
const CAM_SWING = 1.6;      // how quickly the camera settles behind the keke
const ENTER_DIST = 2.9;     // how close you must be to hop in
const HALF_WIDTH = 5.2;     // keep the keke on the street
const HALF_LENGTH = 54;

// Camera-basis scratch (module-level temps — no per-frame allocation).
const UP = new THREE.Vector3(0, 1, 0);
const _camF = new THREE.Vector3();

// Signed smallest rotation from `from` to `to`, in (-π, π]. Keeps the body turn
// from spinning the long way round when travel direction wraps past ±π.
function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export default function DriveableKeke({
  position = [2.0, 0, 6] as [number, number, number],
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

  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const yaw = useRef(rotation);
  const vel = useRef(new THREE.Vector3()); // world-space velocity (m/s), derived from speed along the nose
  const speed = useRef(0); // signed speed along the nose (m/s); negative = reversing
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    if (!g) return;
    const wc = worldControls;

    if (!wc.driving) {
      // Not in a vehicle: proximity check to offer the ENTER prompt.
      const dx = wc.playerPos.x - g.position.x;
      const dz = wc.playerPos.z - g.position.z;
      const n = dx * dx + dz * dz < ENTER_DIST * ENTER_DIST;
      if (n !== nearRef.current) {
        nearRef.current = n;
        setNear(n);
      }
      if (wc.enterExit) {
        wc.enterExit = false;
        // One-tap DRIVE always works: if you're not already next to the keke,
        // summon it to your side so you never have to hunt for it.
        if (!n) {
          g.position.x = THREE.MathUtils.clamp(wc.playerPos.x + 1.2, -HALF_WIDTH, HALF_WIDTH);
          g.position.z = THREE.MathUtils.clamp(wc.playerPos.z, -HALF_LENGTH, HALF_LENGTH);
        }
        // Face the keke the way you'll drive off (into the scene, away from the
        // camera) so it never starts out pointing at you and looking like it reverses.
        // Same camera-position-based "into the scene" vector the driving code uses.
        _camF.set(g.position.x - camera.position.x, 0, g.position.z - camera.position.z);
        if (_camF.lengthSq() < 1e-6) _camF.set(0, 0, -1);
        _camF.normalize();
        yaw.current = Math.atan2(_camF.x, _camF.z);
        g.rotation.y = yaw.current;
        wc.driving = true;
        useWorldStore.getState().setDriving(true);
        nearRef.current = false;
        setNear(false);
      }
      return;
    }

    // Driving. Only one DriveableKeke in the scene, so driving === this one.
    // ── Real steering: plain car controls, relative to the KEKE ──────────────
    // Stick up = accelerate, down = brake then reverse, left/right = steer. It
    // only ever rolls along its own nose, so it cannot crab sideways or travel
    // tail-first. Steering is judged from the keke, not the camera, so the
    // controls mean the same thing whichever way the camera is looking; the chase
    // camera below keeps "up" pointing where the nose points.
    const steer = THREE.MathUtils.clamp(wc.input.x, -1, 1);
    // input.z follows the screen: UP (W / stick up) is NEGATIVE. Flip it so up = gas.
    const gas = THREE.MathUtils.clamp(-wc.input.z, -1, 1);
    const hasInput = Math.abs(steer) > 0.08 || Math.abs(gas) > 0.08;
    let target = 0;
    if (gas < -0.3 && speed.current < 1.0) {
      target = MAX_SPEED * REVERSE_SCALE * gas; // negative: backing up
    } else if (gas >= -0.3) {
      // a sideways push still creeps forward, so a thumb pointing "right" turns
      // right instead of doing nothing; full lock trims the top speed a little
      const throttle = Math.min(1, Math.max(gas, Math.abs(steer) * 0.55, 0));
      target = MAX_SPEED * throttle * (1 - 0.3 * Math.abs(steer));
    } // else: pulling back while rolling forward = brake (target stays 0)
    if (Math.abs(steer) > 0.08) {
      // steering bites harder once it is rolling; a parked keke barely pivots.
      // Nose is (sin yaw, cos yaw), so turning RIGHT lowers yaw; in reverse the
      // tail swings the other way, as on a real vehicle.
      const grip = Math.min(1, Math.abs(speed.current) / 1.6 + 0.12);
      yaw.current -= steer * TURN_RATE * grip * dt * (speed.current < -0.05 ? -1 : 1);
      g.rotation.y = yaw.current;
    }
    const rate = hasInput ? (Math.abs(target) > Math.abs(speed.current) ? ACCEL : BRAKE) : DECEL;
    speed.current += (target - speed.current) * (1 - Math.exp(-rate * dt));
    if (!hasInput && Math.abs(speed.current) < 0.05) speed.current = 0;

    const nx = Math.sin(yaw.current);
    const nz = Math.cos(yaw.current);
    vel.current.set(nx * speed.current, 0, nz * speed.current);
    const px = g.position.x + vel.current.x * dt;
    const pz = g.position.z + vel.current.z * dt;
    g.position.x = THREE.MathUtils.clamp(px, -HALF_WIDTH, HALF_WIDTH);
    g.position.z = THREE.MathUtils.clamp(pz, -HALF_LENGTH, HALF_LENGTH);
    // Met the kerb or the end of the street: scrub a little speed and let the
    // wall turn the nose along itself, the way a real kerb deflects a wheel, so
    // you slide back into the road instead of grinding nose-first against it.
    const hitX = g.position.x !== px;
    const hitZ = g.position.z !== pz;
    if ((hitX || hitZ) && Math.abs(speed.current) > 0.2) {
      speed.current *= 1 - Math.min(1, dt * 1.5);
      const along = hitX ? (Math.cos(yaw.current) >= 0 ? 0 : Math.PI) : Math.sin(yaw.current) >= 0 ? Math.PI / 2 : -Math.PI / 2;
      yaw.current += shortestAngle(yaw.current, along) * Math.min(1, dt * 3.2);
      g.rotation.y = yaw.current;
    }

    // ── Chase camera ─────────────────────────────────────────────────────────
    // While you are rolling forward the camera drifts round to sit behind the
    // keke, so "stick up" keeps meaning "go where the nose points". It only
    // rotates the camera about the keke (same distance and height), and it lets
    // go the moment you stop, so you can still orbit freely when parked.
    if (speed.current > 1.2) {
      const ox = camera.position.x - g.position.x;
      const oz = camera.position.z - g.position.z;
      const r = Math.hypot(ox, oz);
      if (r > 0.5) {
        const cur = Math.atan2(ox, oz);
        const behind = yaw.current + Math.PI;
        const k = Math.min(1, dt * CAM_SWING * Math.min(1, speed.current / MAX_SPEED + 0.3));
        const ang = cur + shortestAngle(cur, behind) * k;
        camera.position.x = g.position.x + Math.sin(ang) * r;
        camera.position.z = g.position.z + Math.cos(ang) * r;
      }
    }

    // Camera follows the keke while driving.
    wc.playerPos.set(g.position.x, 0, g.position.z);

    if (wc.enterExit) {
      wc.enterExit = false;
      wc.driving = false;
      useWorldStore.getState().setDriving(false);
      vel.current.set(0, 0, 0);
      speed.current = 0;
      // Drop the player just BEHIND the keke's nose (Player reads playerPos on exit)
      // so you never climb out on top of it.
      wc.playerPos.set(
        g.position.x - Math.sin(yaw.current) * 1.7,
        0,
        g.position.z - Math.cos(yaw.current) * 1.7,
      );
    }
  });

  return (
    <group ref={group} position={[position[0], position[1], position[2]]} rotation={[0, rotation, 0]}>
      <KekeModel seed={41} pax={0} speed={() => speed.current} driver={false} player={() => worldControls.driving} />
      {near && (
        <Html center position={[0, 2.5, 0]} distanceFactor={10} zIndexRange={[25, 0]} style={{ pointerEvents: "auto" }}>
          <button
            onClick={(e) => { e.stopPropagation(); worldControls.enterExit = true; }}
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
            🛺 Tap to ride
          </button>
        </Html>
      )}
    </group>
  );
}
