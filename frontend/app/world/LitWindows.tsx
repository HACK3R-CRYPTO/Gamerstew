"use client";

// ─── Lit windows — glowing window grid down both building walls ──────────────
// The Kenney building models read as dark flat blocks at night because their
// windows don't emit. This adds a cheap instanced layer of glowing window quads
// along the street-facing walls, in varied warm/cool/green hues, that BRIGHTEN as
// the street goes dark (reads as "lights on during the blackout") and fade out in
// daylight. One InstancedMesh = one draw call. Keyed to worldControls.lit so it
// tracks the NEPA cycle + the Restore-the-Light relight for free.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { worldControls } from "./controls";
import { STREET } from "./Street";

// Window palette — mostly warm tungsten, some cool, a few Naija green/amber.
// Values push past 1.0 so bloom catches the brightest ones.
const HUES = [
  [2.8, 1.9, 0.7],
  [3.0, 2.1, 0.9],
  [2.4, 1.5, 0.5],
  [1.0, 1.8, 2.8], // cool
  [0.9, 2.5, 1.4], // green
  [3.0, 1.4, 0.4], // amber
];

export default function LitWindows() {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const col = useRef(new THREE.Color());

  const { matrices, colors, count } = useMemo(() => {
    const mats: THREE.Matrix4[] = [];
    const cols: number[] = [];
    const wallX = STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH + 0.25;
    const half = STREET.STREET_LENGTH / 2 - 3;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let seed = 1234;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let side = -1; side <= 1; side += 2) {
      const rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      for (let z = -half; z <= half; z += 2.4) {
        const rows = 5 + Math.floor(rnd() * 3);
        for (let r = 0; r < rows; r++) {
          if (rnd() < 0.3) continue; // some windows dark
          const y = 2.4 + r * 2.5 + (rnd() - 0.5) * 0.4;
          pos.set(side * wallX, y, z + (rnd() - 0.5) * 0.8);
          scl.set(0.85, 1.05 + rnd() * 0.3, 1);
          m.compose(pos, q, scl);
          mats.push(m.clone());
          const h = HUES[Math.floor(rnd() * HUES.length)];
          cols.push(h[0], h[1], h[2]);
        }
      }
    }
    return { matrices: mats, colors: new Float32Array(cols), count: mats.length };
  }, []);

  useFrame(() => {
    // Windows glow when the street is dark, fade out when it's bright/day.
    const dark = 1 - worldControls.lit;
    const k = 0.06 + dark * 0.95 + worldControls.surge * 0.3;
    if (matRef.current) matRef.current.color.copy(col.current.setScalar(Math.min(1.3, k)));
  });

  return (
    <instancedMesh
      args={[undefined, undefined, count]}
      frustumCulled={false}
      ref={(inst) => {
        if (!inst) return;
        matrices.forEach((mat, i) => inst.setMatrixAt(i, mat));
        inst.instanceMatrix.needsUpdate = true;
        inst.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        inst.instanceColor.needsUpdate = true;
      }}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial ref={matRef} toneMapped={false} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}
