"use client";

// ─── Pedestrians — people walking the sidewalks ──────────────────────────────
// A varied crowd of three realistic Mixamo characters (a hi-vis worker, a
// casual guy, a woman), distinct from the player, each walking a fixed lane and
// turning at the ends.
//
// Rig note: GLTFLoader strips the colon from Mixamo bone names, so a loaded
// character's bones read "mixamorigN<Bone>" (e.g. "mixamorig1Hips") and the
// clips read "mixamorig4<Bone>". The ONE shared Walk/Idle clip pair is bound to
// each character by rewriting that numeric prefix (mixamorig4 → the char's own
// mixamorigN) per character. That binds cleanly with no visible distortion
// (verified in the preview harness across all three bodies).
//
// IMPORTANT: the actions are started in a useEffect, NOT in the useMemo. In
// React StrictMode (Next dev) effects run mount→cleanup→mount, and the cleanup
// calls mixer.stopAllAction(); if play() lived in the memo it would never re-run
// after that cleanup, leaving every clip frozen at frame 0 (the "gliding").
//
// Each clip's Hips X/Z translation is zeroed (kept Y bob) so OUR code owns
// travel and the clip only cycles the body. Stride is locked to the ground with
// timeScale = speed / CLIP_WALK_SPEED (the walk clip's measured ground speed).

import { quality } from "./quality";
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { SIDEWALK_OBSTACLES } from "./obstacles";

// 0 = hi-vis worker, 1 = casual, 2 = woman.
// Desktop characters are built from 6 to 8 separate skinned parts each (body,
// boots, vest, hair...), so ten of them cost about 70 draw calls on their own.
// Phones use characters that are ONE skinned mesh each: one draw call a person.
const PED_MODELS = quality().mobile
  ? ["/world/models/peds/ch06.glb", "/world/models/peds/ch20.glb", "/world/models/peds/ch06.glb"]
  : ["/world/models/peds/ch17.glb", "/world/models/peds/ch28.glb", "/world/models/peds/ch41.glb"];
const WALK_URL = "/world/models/anim/walk.glb";
const IDLE_URL = "/world/models/anim/idle.glb";
const SCALE = 1.0; // Mixamo characters are ~1.8 m, origin at the feet
const RANGE = 48; // walk z within [-RANGE, RANGE]
const PED_R = 0.35;
const AVOID_Z = 4.2;
const CLIP_WALK_SPEED = 1.68; // measured walk-clip ground speed (m/s)

// Rewrite the clip's "mixamorig4" prefix to the target character's own prefix,
// and zero the Hips X/Z translation (keep Y bob) so our code drives travel.
function retarget(clip: THREE.AnimationClip, prefix: string, name: string): THREE.AnimationClip {
  const c = clip.clone();
  for (const tr of c.tracks) {
    if (prefix) tr.name = tr.name.replace(/^mixamorig\d+/, prefix);
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
}

// x = sidewalk lane, char = index into PED_MODELS.
const PEDS = [
  { x: 6.4, z: -30, dir: 1, speed: 1.25, char: 1, walkDur: [8, 14], pauseDur: [0.4, 1.4] },
  { x: -6.4, z: 8, dir: -1, speed: 0.68, char: 2, walkDur: [3, 6], pauseDur: [2, 4.5] },
  { x: 6.9, z: 22, dir: -1, speed: 0.6, char: 0, walkDur: [1.5, 3.5], pauseDur: [4, 9] },
  { x: -6.9, z: -12, dir: 1, speed: 0.95, char: 1, walkDur: [5, 9], pauseDur: [1.5, 3] },
  { x: 6.2, z: -45, dir: 1, speed: 1.1, char: 0, walkDur: [6, 11], pauseDur: [0.8, 2.2] },
  { x: -6.2, z: 40, dir: -1, speed: 0.78, char: 2, walkDur: [4, 7], pauseDur: [2, 5] },
  { x: -5.9, z: 15, dir: -1, speed: 0.9, char: 1, walkDur: [5, 9], pauseDur: [1.5, 3] },
  { x: 5.9, z: 5, dir: 1, speed: 1.05, char: 2, walkDur: [6, 10], pauseDur: [1, 2.5] },
  { x: -7.2, z: 2, dir: 1, speed: 0.5, char: 0, walkDur: [0.4, 1], pauseDur: [50, 90] },
  { x: 7.1, z: -22, dir: -1, speed: 0.5, char: 1, walkDur: [0.4, 1], pauseDur: [40, 80] },
];

const rnd = (r: readonly [number, number] | number[]) => r[0] + Math.random() * (r[1] - r[0]);

interface Ped {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction | null;
  idle: THREE.AnimationAction | null;
  startOffset: number;
  laneX: number;
  curX: number;
  z: number;
  dir: number;
  speed: number;
  curSpeed: number;
  state: "walk" | "pause";
  timer: number;
  heading: number;
  walkDur: number[];
  pauseDur: number[];
}

export default function Pedestrians() {
  const chars = useGLTF(PED_MODELS);
  const walkG = useGLTF(WALK_URL);
  const idleG = useGLTF(IDLE_URL);

  // Per character: its own scene + Walk/Idle clips retargeted to its skeleton.
  const charData = useMemo(() => {
    return (chars as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] }[]).map((c) => {
      let prefix = "";
      c.scene.traverse((o) => {
        const m = o.name.match(/^(mixamorig\d+)/);
        if (!prefix && m) prefix = m[1];
      });
      return {
        scene: c.scene,
        walk: walkG.animations[0] ? retarget(walkG.animations[0], prefix, "Walk") : null,
        idle: idleG.animations[0] ? retarget(idleG.animations[0], prefix, "Idle") : null,
      };
    });
  }, [chars, walkG, idleG]);

  const peds = useMemo<Ped[]>(() => {
    return PEDS.slice(0, quality().peds).map((p) => {
      const cd = charData[p.char] ?? charData[0];
      const obj = skeletonClone(cd.scene);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) {
          mesh.castShadow = true;
          mesh.frustumCulled = false;
        }
      });
      const group = new THREE.Group();
      group.scale.setScalar(SCALE);
      group.add(obj);
      const mixer = new THREE.AnimationMixer(obj);
      const walk = cd.walk ? mixer.clipAction(cd.walk) : null;
      const idle = cd.idle ? mixer.clipAction(cd.idle) : null;
      const startOffset = cd.walk ? Math.random() * cd.walk.duration : 0;
      const startWalking = Math.random() > 0.3;
      return {
        group,
        mixer,
        walk,
        idle,
        startOffset,
        laneX: p.x,
        curX: p.x,
        z: p.z,
        dir: p.dir,
        speed: p.speed,
        curSpeed: startWalking ? p.speed : 0,
        state: startWalking ? "walk" : "pause",
        timer: rnd(startWalking ? p.walkDur : p.pauseDur) * Math.random(),
        heading: p.dir > 0 ? 0 : Math.PI,
        walkDur: p.walkDur,
        pauseDur: p.pauseDur,
      };
    });
  }, [charData]);

  useEffect(() => {
    for (const p of peds) {
      if (p.walk) {
        p.walk.reset();
        p.walk.time = p.startOffset;
        p.walk.setEffectiveWeight(p.state === "walk" ? 1 : 0).play();
      }
      if (p.idle) p.idle.reset().setEffectiveWeight(p.state === "pause" ? 1 : 0).play();
    }
    return () => {
      for (const p of peds) p.mixer.stopAllAction();
    };
  }, [peds]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    for (const p of peds) {
      p.mixer.update(dt);

      p.timer -= dt;
      if (p.timer <= 0) {
        if (p.state === "walk") {
          p.state = "pause";
          p.timer = rnd(p.pauseDur);
        } else {
          p.state = "walk";
          p.timer = rnd(p.walkDur);
        }
      }
      const target = p.state === "walk" ? p.speed : 0;
      p.curSpeed += (target - p.curSpeed) * Math.min(1, dt * 4);

      const walkAmt = THREE.MathUtils.clamp(p.curSpeed / 0.2, 0, 1);
      if (p.walk) {
        p.walk.setEffectiveWeight(walkAmt);
        p.walk.timeScale = THREE.MathUtils.clamp(p.curSpeed / CLIP_WALK_SPEED, 0, 1.3);
      }
      if (p.idle) p.idle.setEffectiveWeight(1 - walkAmt);

      p.z += p.dir * p.curSpeed * dt;
      if (p.z > RANGE) {
        p.z = RANGE;
        p.dir = -1;
      } else if (p.z < -RANGE) {
        p.z = -RANGE;
        p.dir = 1;
      }

      const s = p.laneX >= 0 ? 1 : -1;
      let dodge = p.laneX;
      for (const o of SIDEWALK_OBSTACLES) {
        if ((o.x >= 0 ? 1 : -1) !== s) continue;
        const dz = p.z - o.z;
        if (Math.abs(dz) > AVOID_Z) continue;
        const reach = o.r + PED_R + 0.35;
        if (Math.abs(p.laneX - o.x) >= reach) continue;
        const zf = Math.min(1, (1 - Math.abs(dz) / AVOID_Z) * 1.6);
        const curbSide = o.x - s * reach;
        const cand = p.laneX + (curbSide - p.laneX) * zf;
        dodge = s > 0 ? Math.min(dodge, cand) : Math.max(dodge, cand);
      }
      dodge = s > 0 ? Math.max(5.0, dodge) : Math.min(-5.0, dodge);
      const oldX = p.curX;
      p.curX += (dodge - p.curX) * Math.min(1, dt * 6);
      const vx = dt > 0 ? (p.curX - oldX) / dt : 0;
      const vz = p.dir * p.curSpeed;

      p.group.position.set(p.curX, 0, p.z);
      if (p.curSpeed > 0.08 || Math.abs(vx) > 0.04) {
        const tgt = Math.atan2(vx, vz);
        let d = tgt - p.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        p.heading += d * Math.min(1, dt * 9);
        p.group.rotation.y = p.heading;
      }
    }
  });

  return (
    <>
      {peds.map((p, i) => (
        <primitive key={i} object={p.group} />
      ))}
    </>
  );
}

PED_MODELS.forEach((u) => useGLTF.preload(u));
