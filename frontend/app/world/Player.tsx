"use client";

// ─── Controllable animated HUMAN character + third-person follow camera ──────
// CHARACTER: human.glb — Quaternius "Animated Human" (CC0, see human-LICENSE.txt),
// a casual everyday person (t-shirt + trousers), converted FBX→glTF. Its colour
// comes from a tiny palette atlas (human-skin.png, the ClothedDarkSkin variant:
// dark skin, green top, khaki trousers) applied as the baseColor map with
// flipY=false (glTF UV convention) + nearest filtering to keep the flat-shaded
// look. Clips are matched by name (/idle/i, /walk/i) since the FBX prefixes them
// "Human Armature|…". Mesh is ~5.5 units tall, so PLAYER_SCALE brings it to ~1.8m.
//
// CONTROLLER: WASD / arrows + the on-screen joystick feed worldControls.input.
// "Forward" is relative to WHERE THE CAMERA LOOKS, and the character turns
// (damped) to face the way it walks. Ground-clamped, kept inside the street.
//
// CAMERA: YOU control the angle. OrbitControls (in Scene.tsx) owns rotation/zoom
// via drag; this file only keeps the orbit TARGET glued to the character and
// translates the camera by the same delta each frame, so your chosen angle is
// preserved while the camera follows you. The camera never rotates on its own.

import { quality } from "./quality";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { DEVICES, hands } from "./game";
import { useAppStore } from "./appStore";
import { worldControls } from "./controls";
import { resolveObstacles } from "./obstacles";

const CHAR_URL = "/world/models/player.glb"; // Mixamo realistic character (ch12)
const IDLE_URL = "/world/models/anim/idle.glb";
const WALK_URL = "/world/models/anim/walk.glb";
const RUN_URL = "/world/models/anim/run.glb";
const HIT_URL = "/world/models/anim/hit.glb"; // knocked by a car
const SHOCK_URL = "/world/models/anim/shock.glb"; // electrocuted on a bad flip
// How long each one-shot reaction overrides locomotion (ms). The "Hit By Car"
// clip's neutral wind-up runs until ~1.5s, so we START at the impact (HIT_START)
// and play through the fall AND the get-up (the clip ends standing at ~4.83s),
// sped up ~1.4x, so the reaction recovers on its feet — no snap back to idle.
// A car knock-down is meant to hurt: it costs ~2.4s plus a life, so you dodge.
const HIT_MS = 2380;
const HIT_START = 1.5; // seconds into the hit clip where the impact lands
const HIT_TIMESCALE = 1.4;
const SHOCK_MS = 750;
const PLAYER_SCALE = 1.0; // Mixamo character is ~1.8 m, origin at the feet
// The Mixamo rig faces local +Z; the controller rotates local +Z to travel
// direction (rot.y = atan2(move.x, move.z) + offset), so offset 0 faces travel.
const MODEL_FACE_OFFSET = 0;
const MOVE_SPEED = 3.5; // m/s — a controlled jog
// Movement weight: ease velocity in/out instead of snapping to top speed so
// starts, stops and turns feel grounded (not "swishy"). Higher = snappier.
const ACCEL = 11; // how fast you reach top speed
const DECEL = 14; // how fast you coast to a stop when you let go
const LEAN_MAX = 0.17; // radians of forward body lean at full speed
const GESTURE_MS = 1050; // how long the "operate the breaker" reach plays
// Run clip's MEASURED ground speed in world m/s at timeScale 1 (16.0 units * 0.33).
// timeScale = MOVE_SPEED / CLIP_RUN_SPEED locks the feet to the ground. The old
// value (3.1) was far too low, so the legs cycled too fast and it looked sped-up.
const CLIP_RUN_SPEED = 4.46; // measured run-clip ground speed → feet lock to travel
const HALF_LENGTH = 54; // keep the player on the modelled stretch of street
// Keep the player on the road + curb (where the devices/transformers sit). This
// stops short of the sidewalk clutter (generators ±6, signboards ±6.7, peds ±6.4),
// so that clutter needs no colliders — only the vehicles on the road do.
const HALF_WIDTH = 5.6;
const PLAYER_RADIUS = 0.42; // body half-width for obstacle resolution

const TARGET_Y = 1.1; // orbit target height (roughly the character's chest)
const UP = new THREE.Vector3(0, 1, 0);

function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export default function Player() {
  const group = useRef<THREE.Group>(null);
  const heading = useRef(0); // character facing (radians)
  const wasDriving = useRef(false); // true on the frame we hop out of a vehicle
  const wasMoving = useRef(false);
  const didInitCam = useRef(false);
  const chase = useRef(new THREE.Vector3());

  const camForward = useRef(new THREE.Vector3());
  const camRight = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());
  const vel = useRef(new THREE.Vector3()); // smoothed world velocity (weight)
  const desiredVel = useRef(new THREE.Vector3());
  const smoothTarget = useRef(new THREE.Vector3(0, TARGET_Y, 0));
  const leanRef = useRef<THREE.Group>(null); // inner group: body lean + shock roll
  const leanX = useRef(0);

  const { scene } = useGLTF(CHAR_URL);
  const idleG = useGLTF(IDLE_URL);
  const walkG = useGLTF(WALK_URL);
  const runG = useGLTF(RUN_URL);
  const hitG = useGLTF(HIT_URL);
  const shockG = useGLTF(SHOCK_URL);
  // Mixamo clips come in separate "Without Skin" glbs (one "mixamo.com" clip
  // each). The character's bones carry a different prefix than the clips
  // (e.g. "mixamorig4:" vs "mixamorig:"), so rewrite each track to the
  // character's prefix before binding, then rename Idle/Walk/Run.
  const clips = useMemo(() => {
    let charPrefix = "";
    scene.traverse((o) => {
      if (!charPrefix && o.name.includes(":Hips")) charPrefix = o.name.split(":")[0];
    });
    // Flatten the Hips root: zero its X/Z translation (the sideways/forward
    // drift our code or the loop fights with → vibration + skip) but KEEP the
    // Y bob so the body still breathes/bounces, not a frozen mannequin.
    const build = (g: { animations: THREE.AnimationClip[] }, name: string) => {
      if (!g.animations[0]) return new THREE.AnimationClip(name, 0.1, []);
      const c = g.animations[0].clone();
      for (const tr of c.tracks) {
        const colon = tr.name.indexOf(":");
        if (charPrefix && colon >= 0) tr.name = charPrefix + tr.name.slice(colon);
        if (/Hips\.position$/i.test(tr.name)) {
          const v = tr.values as unknown as Float32Array | number[];
          for (let i = 0; i + 2 < v.length; i += 3) {
            v[i] = 0; // x
            v[i + 2] = 0; // z
          }
        }
      }
      c.name = name;
      return c;
    };
    // Hit/Shock are one-shot full-body REACTIONS; same flatten (stay on the
    // spot, keep the Y so the stagger/fall reads) so they don't slide the hero
    // off his ground ring.
    return [
      build(idleG, "Idle"),
      build(walkG, "Walk"),
      build(runG, "Run"),
      build(hitG, "Hit"),
      build(shockG, "Shock"),
    ];
  }, [scene, idleG, walkG, runG, hitG, shockG]);
  const { actions } = useAnimations(clips, group);
  const camera = useThree((s) => s.camera);
  // ── A phone is tall, not wide ──────────────────────────────────────────
  // The field of view is measured top to bottom. On a tall screen the same
  // number leaves a narrow slice from side to side: at 55 the street was a
  // 30 degree keyhole. A tall screen gets a wider lens, so the player sees the
  // road and both kerbs, and the camera sits closer and lower behind them.
  const size = useThree((s) => s.size);
  const tall = size.width / Math.max(1, size.height) < 0.8;
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    cam.fov = tall ? 70 : 55; cam.updateProjectionMatrix();
  }, [camera, tall]);
  const tallRef = useRef(tall); tallRef.current = tall;
  const touch = useMemo(() => typeof window !== "undefined" && (("ontouchstart" in window) || (navigator.maxTouchPoints ?? 0) > 0), []);
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null;

  // Resolve the idle/run clip keys once (FBX prefixes them "Human Armature|…").
  const idleKey = useRef<string | undefined>(undefined);
  const runKey = useRef<string | undefined>(undefined);
  const gestureKey = useRef<string | undefined>(undefined);
  const gesturing = useRef(false);
  const gestureEnd = useRef(0);
  // One-shot hit/shock reaction clips (car knock-down, electrocution).
  const hitKey = useRef<string | undefined>(undefined);
  const shockKey = useRef<string | undefined>(undefined);
  const reacting = useRef(false);
  const reactKind = useRef<"hit" | "shock">("hit");
  const reactEnd = useRef(0);
  // Electric-shock reaction on a mistimed tap.
  const mats = useRef<THREE.MeshStandardMaterial[]>([]);
  const zapT = useRef(0);
  const invulnGlow = useRef(false); // cyan shield glow is currently applied

  // Keep the Mixamo character's own textures; just enable shadows, stop wrong
  // frustum-culling of the skinned mesh, and add a warm rim so the hero pops.
  useEffect(() => {
    mats.current = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // animated bounds can cull a skinned mesh wrongly
      const std = mesh.material as THREE.MeshStandardMaterial;
      if (std && std.isMaterial) {
        mats.current.push(std);
        // Warm fresnel rim on the standard shader (guarded; a no-op if the
        // material isn't the standard type, so the textures stay intact).
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
    // Prefer Run for the hustle; fall back to Walk if a model lacks it.
    runKey.current = keys.find((k) => /run/i.test(k)) ?? keys.find((k) => /walk/i.test(k));
    // Operate the breaker/device. "Working" (a reach-and-fiddle loop) reads as
    // flipping a switch far better than "Punch" (which looks like hitting it); we
    // play a ~1s slice of it, capped by GESTURE_MS, then resume locomotion.
    gestureKey.current = keys.find((k) => /working/i.test(k)) ?? keys.find((k) => /punch/i.test(k));
    const g = gestureKey.current ? actions[gestureKey.current] : undefined;
    if (g) {
      g.setLoop(THREE.LoopOnce, 1);
      g.clampWhenFinished = true;
    }
    // Reaction clips play once and hold the last frame until we fade them out.
    hitKey.current = keys.find((k) => /^hit$/i.test(k)) ?? keys.find((k) => /hit/i.test(k));
    shockKey.current = keys.find((k) => /shock/i.test(k));
    for (const k of [hitKey.current, shockKey.current]) {
      const a = k ? actions[k] : undefined;
      if (a) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
    }
    const idle = idleKey.current ? actions[idleKey.current] : undefined;
    idle?.reset().play();
    return () => {
      Object.values(actions).forEach((a) => a?.stop());
    };
  }, [actions]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    if (!g) return;

    // Driving a vehicle: hide + freeze the character (the DriveableKeke owns the
    // camera focus). On the frame we hop out, pop back in at the vehicle-side
    // spot the keke wrote to playerPos.
    if (worldControls.driving) {
      if (g.visible) g.visible = false;
      wasDriving.current = true;
      // Keep the camera following the keke (it writes its position to playerPos),
      // preserving the user's orbit angle + zoom — same follow as on foot.
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
      g.position.set(worldControls.playerPos.x, 0, worldControls.playerPos.z);
      vel.current.set(0, 0, 0);
    }

    // CAMERA-RELATIVE movement: forward (W / stick up) is away from the camera,
    // using the live camera azimuth, so it always matches whatever angle you orbit to.
    camera.getWorldDirection(camForward.current);
    camForward.current.y = 0;
    camForward.current.normalize();
    camRight.current.crossVectors(camForward.current, UP).normalize();

    // Traffic-hit stun: frozen for a beat (no input) after a vehicle clips you.
    if (worldControls.stun > 0) worldControls.stun = Math.max(0, worldControls.stun - dt);
    const stunned = worldControls.stun > 0;

    const { x, z } = worldControls.input;
    move.current.set(0, 0, 0);
    move.current.addScaledVector(camForward.current, -z); // stick up / W => forward
    move.current.addScaledVector(camRight.current, x);
    if (stunned) move.current.set(0, 0, 0);

    const hasInput = move.current.lengthSq() > 0.0004;
    if (hasInput) move.current.normalize();

    // Ease the velocity toward the target (accelerate under input, coast to a
    // stop with friction when you let go) so motion has weight, then move.
    desiredVel.current.copy(move.current).multiplyScalar(hasInput ? MOVE_SPEED * worldControls.speedMul : 0);
    vel.current.lerp(desiredVel.current, 1 - Math.exp(-(hasInput ? ACCEL : DECEL) * dt));
    // Planted while operating a breaker/device, or while down in a hit/shock
    // reaction — don't glide off the spot.
    if (gesturing.current || reacting.current) vel.current.set(0, 0, 0);
    // local development only: a test can place the player (window.__warp = [x, z, yaw])
    if (process.env.NODE_ENV === "development") { const w = (window as unknown as { __warp?: number[] | null }).__warp; if (w) { g.position.x = w[0]; g.position.z = w[1]; heading.current = w[2] ?? 0; g.rotation.y = heading.current; vel.current.set(0, 0, 0); } }
    const speed = vel.current.length();
    worldControls.playerSpeed = speed;
    worldControls.playerYaw = g.rotation.y;
    if (speed < 0.03) vel.current.set(0, 0, 0);

    if (speed > 0.001) {
      g.position.addScaledVector(vel.current, dt);
      g.position.x = THREE.MathUtils.clamp(g.position.x, -HALF_WIDTH, HALF_WIDTH);
      g.position.z = THREE.MathUtils.clamp(g.position.z, -HALF_LENGTH, HALF_LENGTH);
      // Push out of any vehicle, so you slide AROUND it, then re-clamp to bounds.
      const [rx, rz] = resolveObstacles(g.position.x, g.position.z, PLAYER_RADIUS);
      g.position.x = THREE.MathUtils.clamp(rx, -HALF_WIDTH, HALF_WIDTH);
      g.position.z = THREE.MathUtils.clamp(rz, -HALF_LENGTH, HALF_LENGTH);
      // Face the way you're actually moving (keeps facing through the coast-out).
      if (speed > 0.25) {
        const targetHeading = Math.atan2(vel.current.x, vel.current.z) + MODEL_FACE_OFFSET;
        heading.current += shortestAngle(heading.current, targetHeading) * Math.min(1, dt * 14);
        g.rotation.y = heading.current;
      }
    }
    g.position.y = 0; // ground clamp
    worldControls.playerPos.copy(g.position); // share with the gameplay director

    const moving = speed > 0.12; // for the idle↔run crossfade below

    // Forward body lean proportional to speed — gives the run weight.
    const targetLean = Math.min(1, speed / MOVE_SPEED) * LEAN_MAX;
    leanX.current += (targetLean - leanX.current) * Math.min(1, dt * 9);
    if (leanRef.current) leanRef.current.rotation.x = leanX.current;

    const idle = idleKey.current ? actions[idleKey.current] : undefined;
    const run = runKey.current ? actions[runKey.current] : undefined;
    const gesture = gestureKey.current ? actions[gestureKey.current] : undefined;
    const hit = hitKey.current ? actions[hitKey.current] : undefined;
    const shock = shockKey.current ? actions[shockKey.current] : undefined;
    const now = performance.now();

    // ── Hit/Shock reaction: knocked by a car, or electrocuted on a bad flip.
    //    Plays solo over locomotion (and over any gesture), holds you in place
    //    for its window, then crossfades back to idle/run. ───────────────────
    if (worldControls.react) {
      const kind = worldControls.react;
      worldControls.react = "";
      const act = kind === "hit" ? hit : shock;
      if (act) {
        reacting.current = true;
        reactKind.current = kind;
        const ms = kind === "hit" ? HIT_MS : SHOCK_MS;
        reactEnd.current = now + ms;
        worldControls.stun = Math.max(worldControls.stun, ms / 1000); // frozen during it
        // A car hit yanks you straight to the kerb IMMEDIATELY, so the whole
        // knock-down + get-up plays on the SIDEWALK, off the road — no car can
        // drive through your downed body in the lane. Camera pans across on its
        // own (we only move the body).
        if (kind === "hit" && worldControls.respawn) {
          g.position.x = worldControls.respawn.x;
          g.position.z = worldControls.respawn.z;
          g.position.y = 0;
          worldControls.playerPos.copy(g.position);
          vel.current.set(0, 0, 0);
          worldControls.respawn = null;
        }
        gesturing.current = false;
        idle?.fadeOut(0.06);
        run?.fadeOut(0.06);
        gesture?.fadeOut(0.06);
        (kind === "hit" ? shock : hit)?.fadeOut(0.06);
        act.reset();
        act.time = kind === "hit" ? HIT_START : 0; // skip the hit clip's wind-up
        act.setEffectiveWeight(1).setEffectiveTimeScale(kind === "hit" ? HIT_TIMESCALE : 1.2).fadeIn(0.05).play();
      }
    }
    if (reacting.current && now >= reactEnd.current) {
      reacting.current = false;
      (reactKind.current === "hit" ? hit : shock)?.fadeOut(0.25);
      if (moving) run?.reset().setEffectiveWeight(1).fadeIn(0.2).play();
      else idle?.reset().setEffectiveWeight(1).fadeIn(0.2).play();
      wasMoving.current = moving;
    }

    // ── Flip/plug gesture: play it solo over locomotion, then resume ──────
    if (!reacting.current && worldControls.gesture) {
      worldControls.gesture = false;
      if (gesture) {
        // (Re)play even if a gesture is already running, so a quick second flip
        // on the next breaker still shows the reach instead of being swallowed.
        gesturing.current = true;
        // Turn to face the switch/device being flipped so the reach is visible.
        const fdx = worldControls.gestureFace.x - g.position.x;
        const fdz = worldControls.gestureFace.z - g.position.z;
        if (fdx * fdx + fdz * fdz > 0.02) {
          heading.current = Math.atan2(fdx, fdz) + MODEL_FACE_OFFSET;
          g.rotation.y = heading.current;
        }
        idle?.fadeOut(0.08);
        run?.fadeOut(0.08);
        gesture.reset().setEffectiveWeight(1).setEffectiveTimeScale(1.4).fadeIn(0.08).play();
        gestureEnd.current = now + GESTURE_MS;
      }
    }
    if (gesturing.current && now >= gestureEnd.current) {
      gesturing.current = false;
      gesture?.fadeOut(0.2);
      if (moving) run?.reset().setEffectiveWeight(1).fadeIn(0.18).play();
      else idle?.reset().setEffectiveWeight(1).fadeIn(0.18).play();
      wasMoving.current = moving;
    }

    // Idle <-> run crossfade + speed match (skipped while gesturing/reacting).
    if (!gesturing.current && !reacting.current && moving !== wasMoving.current) {
      if (moving) {
        run?.reset().setEffectiveWeight(1).fadeIn(0.15).play();
        idle?.fadeOut(0.15);
      } else {
        idle?.reset().setEffectiveWeight(1).fadeIn(0.15).play();
        run?.fadeOut(0.15);
      }
      wasMoving.current = moving;
    }
    // Leg cycle tracks ACTUAL speed so feet stay locked through the accel/decel
    // ramp (top speed 3.5/5.27 ≈ 0.66; a low floor avoids slide at low speed).
    if (run) run.timeScale = THREE.MathUtils.clamp(speed / CLIP_RUN_SPEED, 0.2, 1.4);

    // Once fully settled into idle, STOP the locomotion clip entirely. A
    // zero-weight action left "playing" still gets sampled every frame and can
    // add a faint high-frequency shimmer on top of the (otherwise calm) idle —
    // stopping it leaves idle as the only thing driving the rig.
    if (
      !moving &&
      !gesturing.current &&
      !reacting.current &&
      run &&
      run.isRunning() &&
      run.getEffectiveWeight() < 0.02
    ) {
      run.stop();
    }

    // ── Electric SHOCK on a mistimed tap: a recoil roll + blue flicker glow ──
    if (worldControls.zap) {
      worldControls.zap = false;
      zapT.current = 0.34; // sharp, quick flinch (not a long freeze)
    }
    const lean = leanRef.current;
    if (zapT.current > 0 && lean) {
      zapT.current = Math.max(0, zapT.current - dt);
      const k = zapT.current / 0.34; // 1 → 0
      const flick = 0.55 + 0.45 * Math.sin(now * 0.09);
      for (const m of mats.current) {
        m.emissive.setRGB(0.25 * k, 0.55 * k, 1.0 * k);
        m.emissiveIntensity = 2.0 * k * flick;
      }
      lean.rotation.z = (Math.random() - 0.5) * 0.3 * k; // flinch roll
    } else if (lean && lean.rotation.z !== 0) {
      lean.rotation.z += (0 - lean.rotation.z) * Math.min(1, dt * 14);
      if (Math.abs(lean.rotation.z) < 0.002) {
        lean.rotation.z = 0;
        for (const m of mats.current) {
          m.emissive.setRGB(0, 0, 0);
          m.emissiveIntensity = 1;
        }
      }
    }

    // ── Post-hit invincibility "ghost mode": while you're in i-frames after a
    //    car knock-down, strobe the body AND wrap it in a pulsing cyan shield
    //    glow so it's unmistakable you're untouchable. Traffic owns the countdown;
    //    we only read it. The glow uses emissive only (no transparency, so the
    //    face stays solid). A car hit never triggers the zap glow, so the two
    //    never fight; we only clear the shield once zap is also idle. ───────────
    const inv = worldControls.invuln;
    if (leanRef.current) {
      leanRef.current.visible = inv <= 0 || Math.floor(now / 110) % 2 === 0;
    }
    if (inv > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.012); // slow breathing pulse
      for (const m of mats.current) {
        m.emissive.setRGB(0.1, 0.7, 1.0); // cyan shield
        m.emissiveIntensity = 0.6 + 1.1 * pulse;
      }
      invulnGlow.current = true;
    } else if (invulnGlow.current && zapT.current <= 0) {
      for (const m of mats.current) {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 1;
      }
      invulnGlow.current = false;
    }

    // ── Dev cinematic camera: when a trailer-capture script sets __cineActive,
    // it drives the camera itself — skip the follow so it isn't overridden. ──
    const cineActive =
      process.env.NODE_ENV !== "production" &&
      (window as unknown as { __cineActive?: boolean }).__cineActive === true;
    if (cineActive) return;

    // ── Follow: keep the orbit target on the player, preserving your angle ──
    const tx = g.position.x;
    const tz = g.position.z;
    if (!didInitCam.current) {
      smoothTarget.current.set(tx, TARGET_Y, tz);
      // behind and above the player, looking up the street; closer on a tall phone so the character is not a speck
      if (tallRef.current) camera.position.set(tx, TARGET_Y + 3.4, tz + 6.6); else camera.position.set(tx, TARGET_Y + 5.5, tz + 10);
      if (controls) controls.target.copy(smoothTarget.current);
      didInitCam.current = true;
    }
    const prevX = smoothTarget.current.x;
    const prevZ = smoothTarget.current.z;
    const k = 1 - Math.exp(-12 * dt);
    smoothTarget.current.x += (tx - smoothTarget.current.x) * k;
    smoothTarget.current.z += (tz - smoothTarget.current.z) * k;
    smoothTarget.current.y = TARGET_Y;
    // Shift the camera by the same delta the target moved, so the user's orbit
    // offset (angle + zoom) is kept while the view follows the character.
    camera.position.x += smoothTarget.current.x - prevX;
    camera.position.z += smoothTarget.current.z - prevZ;
    // ── On a phone the camera helps steer ───────────────────────────────────
    // One thumb is on the stick, so the view cannot also be turned all the time.
    // While the player runs sideways the camera swings gently round behind them,
    // the way a third-person game on a phone does, so "forward" stays the way
    // they are going. It never does this while they run toward the camera (that
    // would spin the controls under their thumb), nor for a moment after they
    // turn the view themselves.
    if (touch && hasInput && !gesturing.current && !reacting.current && performance.now() - worldControls.lookedAt > 1400) {
      const side = move.current.dot(camRight.current), ahead = move.current.dot(camForward.current);
      if (ahead > -0.25 && Math.abs(side) > 0.18) {
        // gentle: a quarter turn takes about three seconds at full stick, so crossing the
        // street sideways still crosses it, and a long sideways run brings the view round
        chase.current.set(camera.position.x - smoothTarget.current.x, 0, camera.position.z - smoothTarget.current.z).applyAxisAngle(UP, -side * (0.34 + 0.2 * Math.max(0, ahead)) * dt);
        camera.position.x = smoothTarget.current.x + chase.current.x;
        camera.position.z = smoothTarget.current.z + chase.current.z;
      }
    }
    if (controls) {
      controls.target.copy(smoothTarget.current);
      controls.update();
    }

    // Camera punch: a quick jitter on big hits / the blackout, decayed each frame.
    // Applied AFTER controls.update() so it rides on top and self-clears next frame.
    if (worldControls.shake > 0.002) {
      const s = worldControls.shake;
      camera.position.x += (Math.random() - 0.5) * 2 * s;
      camera.position.y += (Math.random() - 0.5) * 2 * s;
      camera.position.z += (Math.random() - 0.5) * 2 * s;
      worldControls.shake *= Math.exp(-9 * dt);
      if (worldControls.shake < 0.002) worldControls.shake = 0;
    }
  });


  // ── Carrying: the arms take the load ────────────────────────────────────────
  // The run and idle clips swing the arms freely, which made a carried device
  // float beside a player who was not holding it. While something is in your
  // hands the upper arms and forearms are aimed instead: out in front for the
  // light things, up beside the head for the heavy ones. It runs after the
  // animation has posed the body this frame, and is blended in and out, so the
  // legs, the hips and the bounce of the stride are untouched.
  const arms = useMemo(() => {
    const find = (n: string) => { let b: THREE.Object3D | null = null; scene.traverse((o) => { if (!b && (o as THREE.Bone).isBone && o.name.endsWith(n) && !o.name.endsWith("Fore" + n)) b = o; /* the loader may drop the ":" from "mixamorig:LeftArm" */ }); return b as THREE.Object3D | null; };
    return { lu: find("LeftArm"), lf: find("LeftForeArm"), ru: find("RightArm"), rf: find("RightForeArm") };
  }, [scene]);
  const carryW = useRef(0);
  const carryKind = useRef(0); // 1 = in front, 2 = on the head
  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), pq: new THREE.Quaternion(), gq: new THREE.Quaternion(), v: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);
  useFrame((_, rawDt) => {
    const g = group.current;
    if (!g || !arms.lu || !arms.lf || !arms.ru || !arms.rf) return;
    // arms go up only in Charge Rush, and only while something is in them
    const held = useAppStore.getState().mode === "charge" && hands.idx >= 0 ? DEVICES[hands.idx].id : "";
    const kind = held ? 2 : 0; // everything is carried on the head: it is where the camera can see it
    if (kind) carryKind.current = kind;
    carryW.current += ((kind ? 1 : 0) - carryW.current) * (1 - Math.exp(-Math.min(rawDt, 0.1) * 12));
    const w = carryW.current;
    if (w < 0.01) return;
    // directions are in the character's own space (x: its left, y: up, z: ahead)
    const POSE = carryKind.current === 2
      ? { u: [0.5, 0.82, 0.12], f: [-0.42, 0.9, 0.05] }
      : { u: [0.22, -0.62, 0.55], f: [-0.3, 0.12, 0.95] };
    g.getWorldQuaternion(tmp.gq);
    const aim = (bone: THREE.Object3D, d: number[], side: number) => {
      bone.parent!.updateWorldMatrix(true, false);
      bone.parent!.getWorldQuaternion(tmp.pq);
      tmp.v.set(d[0] * side, d[1], d[2]).normalize().applyQuaternion(tmp.gq);
      // a Mixamo bone points along its own +Y: turn +Y onto the direction, then
      // express that in the parent's space
      tmp.q.setFromUnitVectors(tmp.up, tmp.v).premultiply(tmp.pq.invert());
      bone.quaternion.slerp(tmp.q, w);
    };
    aim(arms.lu, POSE.u, 1); aim(arms.lf, POSE.f, 1);
    aim(arms.ru, POSE.u, -1); aim(arms.rf, POSE.f, -1);
    if (process.env.NODE_ENV === "development") { arms.lf.updateWorldMatrix(true, false); (window as unknown as { __armDbg?: unknown }).__armDbg = { w: +w.toFixed(2), shoulderY: +arms.lu.getWorldPosition(tmp.v).y.toFixed(2), elbowY: +arms.lf.getWorldPosition(tmp.v).y.toFixed(2) }; }
  });

  return (
    <group ref={group} scale={PLAYER_SCALE} position={[0, 0, 0]}>
      {/* Inner group leans the body (forward lean while running, roll on a shock)
          pivoting at the feet, while the outer group owns heading + the ground ring. */}
      <group ref={leanRef}>
        <primitive object={scene} />
      </group>
      {/* Hero light: a soft warm pool that follows the player so he stays
          readable in the blackout (and carries a little light as he moves). */}
      <pointLight position={[0, 1.9, 0.5]} color="#ffe0a8" intensity={6} distance={6.5} decay={2} />
      {quality().propLights && <pointLight position={[0.3, 1.2, -0.6]} color="#bcd0ff" intensity={2} distance={4} decay={2} />}
      {/* Soft ground ring so the hero is always locatable. Local units (group is
          scaled PLAYER_SCALE 0.33) → ~0.85 m outer radius in world. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.62, 0.82, 40]} />
        <meshBasicMaterial color="#ffd48a" transparent opacity={0.4} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

useGLTF.preload(CHAR_URL);
useGLTF.preload(IDLE_URL);
useGLTF.preload(WALK_URL);
useGLTF.preload(RUN_URL);
useGLTF.preload(HIT_URL);
useGLTF.preload(SHOCK_URL);
