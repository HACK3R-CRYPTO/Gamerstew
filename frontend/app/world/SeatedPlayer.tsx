"use client";

// ─── SeatedPlayer — YOUR character at the controls ───────────────────────────
// When you hop into a keke the walking character is hidden; this puts the same
// character in the driver's seat playing the Mixamo "Driving" clip, so it is
// visibly you driving. It only exists while `active()` is true.
//
// The clip comes "Without Skin" like the other animations, so its tracks are
// rewritten onto the character's bone prefix. The hips track is pinned (no
// drift) and its seated height is used to drop the character onto the seat.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";

const CHAR_URL = "/world/models/player.glb";
const DRIVE_URL = "/world/models/anim/drive.glb";
useGLTF.preload(DRIVE_URL);

export default function SeatedPlayer({
  active,
  seat = [0, 0.7, 0.2] as [number, number, number], // top of the seat cushion, vehicle space
  scale = 1,
}: {
  active: () => boolean;
  seat?: [number, number, number];
  scale?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(CHAR_URL);
  const driveG = useGLTF(DRIVE_URL);

  const { model, clip, hipsY } = useMemo(() => {
    const model = skeletonClone(scene) as THREE.Group;
    let prefix = "";
    model.traverse((o) => {
      if (!prefix && o.name.includes(":Hips")) prefix = o.name.split(":")[0];
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false; // skinned bounds are the standing pose
      }
    });
    let hipsY = 0;
    const src = driveG.animations[0];
    const clip = src ? src.clone() : new THREE.AnimationClip("Drive", 0.1, []);
    clip.name = "Drive";
    for (const tr of clip.tracks) {
      const colon = tr.name.indexOf(":");
      if (prefix && colon >= 0) tr.name = prefix + tr.name.slice(colon);
      if (/Hips\.position$/i.test(tr.name)) {
        const v = tr.values as unknown as Float32Array;
        hipsY = v[1];
        for (let i = 0; i + 2 < v.length; i += 3) {
          v[i] = 0;
          v[i + 1] = hipsY; // hold the seated height: no bounce through the seat
          v[i + 2] = 0;
        }
      }
    }
    return { model, clip, hipsY };
  }, [scene, driveG]);

  const { actions } = useAnimations([clip], group);
  useEffect(() => {
    const a = actions.Drive;
    if (!a) return;
    a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    return () => {
      a.stop();
    };
  }, [actions]);

  useFrame(() => {
    if (group.current) group.current.visible = active();
  });

  // The hips bone sits `hipsY` (model units) above the model origin while seated;
  // lift/drop the whole character so the hips rest just above the cushion.
  const y = seat[1] + 0.16 - hipsY * scale;
  return (
    <group ref={group} position={[seat[0], y, seat[2]]} scale={scale} visible={false}>
      <primitive object={model} />
    </group>
  );
}
