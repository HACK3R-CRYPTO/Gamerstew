"use client";

// ─── Physics-driven character (Rapier kinematic character controller) ────────
// This is the FREE-ROAM character. Unlike the old Player.tsx (hand-coded
// position math + a circle-pushout hack), movement here goes through Rapier's
// kinematic character controller: you collide with buildings, kerbs and parked
// vehicles for real — you slide along a wall, you can't walk through a danfo,
// and gravity holds you on the ground. The visual is the same human.glb with
// idle/walk/run, and the camera follow matches the rest of the world.
//
// It owns the camera even while you're riding (worldControls.driving): the
// vehicle writes its position to worldControls.playerPos and we keep the orbit
// target glued to it, so the single follow-cam code lives in one place.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { RigidBody, CapsuleCollider, useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import type { Collider, KinematicCharacterController } from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { worldControls } from "./controls";

const CHAR_URL = "/world/models/player.glb";
const IDLE_URL = "/world/models/anim/idle.glb";
const WALK_URL = "/world/models/anim/walk.glb";
const RUN_URL = "/world/models/anim/run.glb";

const MOVE_SPEED = 3.6; // m/s — a controlled jog
const ACCEL = 11;
const DECEL = 14;
const LEAN_MAX = 0.17;
const CLIP_RUN_SPEED = 4.46; // measured run-clip ground speed → feet lock to travel
const PLAYER_SCALE = 1.0;

// Capsule: radius + half-height of the straight section. Body origin is the
// capsule CENTRE, so the visual (feet-origin human) is pushed down by FEET_OFF.
const CAP_R = 0.34;
const CAP_H = 0.58;
const FEET_OFF = CAP_R + CAP_H; // centre → feet
const SPAWN: [number, number, number] = [1.2, FEET_OFF, 8];

const TARGET_Y = 1.1;
const UP = new THREE.Vector3(0, 1, 0);

function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export default function PhysicsPlayer() {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<Collider>(null);
  const group = useRef<THREE.Group>(null); // visual (human + ring)
  const leanRef = useRef<THREE.Group>(null);
  const { world } = useRapier();
  const controller = useRef<KinematicCharacterController | null>(null);

  const heading = useRef(0);
  const yVel = useRef(0);
  const vel = useRef(new THREE.Vector3());
  const desiredVel = useRef(new THREE.Vector3());
  const leanX = useRef(0);
  const wasMoving = useRef(false);
  const wasDriving = useRef(false);
  const didInitCam = useRef(false);

  const camForward = useRef(new THREE.Vector3());
  const camRight = useRef(new THREE.Vector3());
  const moveV = useRef(new THREE.Vector3());
  const smoothTarget = useRef(new THREE.Vector3(SPAWN[0], TARGET_Y, SPAWN[2]));
  const tmp = useRef(new THREE.Vector3());

  const { scene } = useGLTF(CHAR_URL);
  const idleG = useGLTF(IDLE_URL);
  const walkG = useGLTF(WALK_URL);
  const runG = useGLTF(RUN_URL);

  // Rewrite the Mixamo clips onto the character's bone prefix, flatten the Hips
  // X/Z drift (keep the Y bob), and rename to Idle/Walk/Run. (Same recipe as
  // Player.tsx — the rig needs it to bind.)
  const clips = useMemo(() => {
    let charPrefix = "";
    scene.traverse((o) => {
      if (!charPrefix && o.name.includes(":Hips")) charPrefix = o.name.split(":")[0];
    });
    const build = (g: { animations: THREE.AnimationClip[] }, name: string) => {
      if (!g.animations[0]) return new THREE.AnimationClip(name, 0.1, []);
      const c = g.animations[0].clone();
      for (const tr of c.tracks) {
        const colon = tr.name.indexOf(":");
        if (charPrefix && colon >= 0) tr.name = charPrefix + tr.name.slice(colon);
        if (/Hips\.position$/i.test(tr.name)) {
          const v = tr.values as unknown as Float32Array;
          for (let i = 0; i + 2 < v.length; i += 3) {
            v[i] = 0;
            v[i + 2] = 0;
          }
        }
      }
      c.name = name;
      return c;
    };
    return [build(idleG, "Idle"), build(walkG, "Walk"), build(runG, "Run")];
  }, [scene, idleG, walkG, runG]);
  const { actions } = useAnimations(clips, group);

  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null;

  const idleKey = useRef<string | undefined>(undefined);
  const runKey = useRef<string | undefined>(undefined);

  // Enable shadows + a warm rim on the character (keeps its own textures).
  useEffect(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const std = mesh.material as THREE.MeshStandardMaterial;
      if (std && std.isMaterial) {
        std.onBeforeCompile = (shader) => {
          shader.uniforms.uRimColor = { value: new THREE.Color("#ffe6c0") };
          shader.uniforms.uRimStrength = { value: 0.32 };
          shader.fragmentShader =
            "uniform vec3 uRimColor;\nuniform float uRimStrength;\n" +
            shader.fragmentShader.replace(
              "#include <opaque_fragment>",
              `#include <opaque_fragment>
               float rim = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
               gl_FragColor.rgb += rim * uRimColor * uRimStrength;`,
            );
        };
        std.needsUpdate = true;
      }
    });
  }, [scene]);

  useEffect(() => {
    const keys = Object.keys(actions);
    idleKey.current = keys.find((k) => /idle/i.test(k));
    runKey.current = keys.find((k) => /run/i.test(k)) ?? keys.find((k) => /walk/i.test(k));
    const idle = idleKey.current ? actions[idleKey.current] : undefined;
    idle?.reset().play();
    return () => {
      Object.values(actions).forEach((a) => a?.stop());
    };
  }, [actions]);

  // Build the Rapier kinematic character controller once.
  useEffect(() => {
    const c = world.createCharacterController(0.02);
    c.enableAutostep(0.35, 0.18, true); // step up kerbs
    c.enableSnapToGround(0.4); // stick to the ground on slopes/kerbs
    c.setApplyImpulsesToDynamicBodies(true); // can nudge the parked/ridable vehicles
    c.setCharacterMass(1.2);
    controller.current = c;
    return () => {
      world.removeCharacterController(c);
      controller.current = null;
    };
  }, [world]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const b = body.current;
    const g = group.current;
    if (!b || !g) return;

    // ── Riding: hide + freeze the character; keep the camera glued to the
    //    vehicle (it writes worldControls.playerPos). Single follow-cam path. ──
    if (worldControls.driving) {
      if (g.visible) g.visible = false;
      wasDriving.current = true;
      const tx = worldControls.playerPos.x;
      const tz = worldControls.playerPos.z;
      const prevX = smoothTarget.current.x;
      const prevZ = smoothTarget.current.z;
      const k = 1 - Math.exp(-10 * dt);
      smoothTarget.current.x += (tx - smoothTarget.current.x) * k;
      smoothTarget.current.z += (tz - smoothTarget.current.z) * k;
      smoothTarget.current.y = TARGET_Y;
      camera.position.x += smoothTarget.current.x - prevX;
      camera.position.z += smoothTarget.current.z - prevZ;
      if (controls) {
        controls.target.copy(smoothTarget.current);
        controls.update();
      }
      return;
    }
    if (wasDriving.current) {
      wasDriving.current = false;
      g.visible = true;
      // Pop back in beside the vehicle (it wrote the dismount spot to playerPos).
      b.setNextKinematicTranslation({
        x: worldControls.playerPos.x,
        y: FEET_OFF,
        z: worldControls.playerPos.z,
      });
      vel.current.set(0, 0, 0);
      yVel.current = 0;
    }

    // Camera-relative movement basis.
    camera.getWorldDirection(camForward.current);
    camForward.current.y = 0;
    camForward.current.normalize();
    camRight.current.crossVectors(camForward.current, UP).normalize();

    const { x, z } = worldControls.input;
    moveV.current.set(0, 0, 0);
    moveV.current.addScaledVector(camForward.current, -z);
    moveV.current.addScaledVector(camRight.current, x);
    const hasInput = moveV.current.lengthSq() > 0.0004;
    if (hasInput) moveV.current.normalize();

    desiredVel.current.copy(moveV.current).multiplyScalar(hasInput ? MOVE_SPEED : 0);
    vel.current.lerp(desiredVel.current, 1 - Math.exp(-(hasInput ? ACCEL : DECEL) * dt));
    const speed = Math.hypot(vel.current.x, vel.current.z);
    if (speed < 0.03) {
      vel.current.x = 0;
      vel.current.z = 0;
    }

    // Gravity (kinematic controllers don't fall on their own).
    yVel.current -= 18 * dt;

    // Ask the controller how far we can actually move without penetrating.
    const col = collider.current;
    const ctrl = controller.current;
    if (col && ctrl) {
      tmp.current.set(vel.current.x * dt, yVel.current * dt, vel.current.z * dt);
      ctrl.computeColliderMovement(col, tmp.current);
      const mv = ctrl.computedMovement();
      const t = b.translation();
      b.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
      if (ctrl.computedGrounded()) yVel.current = 0;
    }

    // Share the FEET position with the rest of the world (directors, camera).
    const t = b.translation();
    worldControls.playerPos.set(t.x, 0, t.z);

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __ppOut?: unknown }).__ppOut = {
        tx: +t.x.toFixed(2), tz: +t.z.toFixed(2), speed: +speed.toFixed(2), dt: +dt.toFixed(4),
      };
    }

    // Face travel direction; forward body lean with speed.
    if (speed > 0.25) {
      const targetHeading = Math.atan2(vel.current.x, vel.current.z);
      heading.current += shortestAngle(heading.current, targetHeading) * Math.min(1, dt * 14);
    }
    const targetLean = Math.min(1, speed / MOVE_SPEED) * LEAN_MAX;
    leanX.current += (targetLean - leanX.current) * Math.min(1, dt * 9);

    // Drive the visual group (child of nothing in R3F — we place it ourselves to
    // match the physics body, since the RigidBody here is in another subtree).
    g.position.set(t.x, t.y - FEET_OFF, t.z);
    g.rotation.y = heading.current;
    if (leanRef.current) leanRef.current.rotation.x = leanX.current;

    // Animation: idle ↔ run crossfade + feet-locked timescale.
    const idle = idleKey.current ? actions[idleKey.current] : undefined;
    const run = runKey.current ? actions[runKey.current] : undefined;
    const moving = speed > 0.12;
    if (moving !== wasMoving.current) {
      if (moving) {
        run?.reset().setEffectiveWeight(1).fadeIn(0.15).play();
        idle?.fadeOut(0.15);
      } else {
        idle?.reset().setEffectiveWeight(1).fadeIn(0.15).play();
        run?.fadeOut(0.15);
      }
      wasMoving.current = moving;
    }
    if (run) run.timeScale = THREE.MathUtils.clamp(speed / CLIP_RUN_SPEED, 0.2, 1.4);
    if (!moving && run && run.isRunning() && run.getEffectiveWeight() < 0.02) run.stop();

    // ── Dev cinematic camera: when a capture script sets __cineActive, it drives
    // the camera itself — skip the follow so it isn't overridden (mirrors Player). ──
    if (
      process.env.NODE_ENV !== "production" &&
      (window as unknown as { __cineActive?: boolean }).__cineActive === true
    ) {
      return;
    }

    // ── Follow camera: keep the orbit target on the player, preserve your angle.
    const tx = t.x;
    const tz = t.z;
    if (!didInitCam.current) {
      smoothTarget.current.set(tx, TARGET_Y, tz);
      camera.position.set(tx, TARGET_Y + 5.5, tz + 10);
      if (controls) controls.target.copy(smoothTarget.current);
      didInitCam.current = true;
    }
    const prevX = smoothTarget.current.x;
    const prevZ = smoothTarget.current.z;
    const k = 1 - Math.exp(-12 * dt);
    smoothTarget.current.x += (tx - smoothTarget.current.x) * k;
    smoothTarget.current.z += (tz - smoothTarget.current.z) * k;
    smoothTarget.current.y = TARGET_Y;
    camera.position.x += smoothTarget.current.x - prevX;
    camera.position.z += smoothTarget.current.z - prevZ;
    if (controls) {
      controls.target.copy(smoothTarget.current);
      controls.update();
    }
  });

  return (
    <>
      {/* Physics body — invisible capsule; the controller moves it. */}
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={SPAWN}
        enabledRotations={[false, false, false]}
      >
        <CapsuleCollider ref={collider} args={[CAP_H, CAP_R]} />
      </RigidBody>

      {/* Visual — placed each frame to match the body (feet-origin human). */}
      <group ref={group} scale={PLAYER_SCALE} position={SPAWN}>
        <group ref={leanRef}>
          <primitive object={scene} />
        </group>
        <pointLight position={[0, 1.9, 0.5]} color="#ffe0a8" intensity={6} distance={6.5} decay={2} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[0.62, 0.82, 40]} />
          <meshBasicMaterial color="#ffd48a" transparent opacity={0.4} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}

useGLTF.preload(CHAR_URL);
useGLTF.preload(IDLE_URL);
useGLTF.preload(WALK_URL);
useGLTF.preload(RUN_URL);
