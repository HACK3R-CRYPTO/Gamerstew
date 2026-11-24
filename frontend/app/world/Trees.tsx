"use client";

// ─── Lagos street trees + palms — real artist low-poly models ────────────────
// Clean low-poly palm + leafy tree GLBs (Poly by Google, CC-BY) dotted along the
// kerbs, each with its own scale + yaw so they don't look stamped. Replaces the
// old flat icosahedron blobs now that the vehicles read realistic.

import { useMemo } from "react";
import { useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import { WORLD } from "./theme";

const PALM_URL = "/world/models/palm-tree.glb";
const LEAF_URL = "/world/models/leaf-tree.glb";
useGLTF.preload(PALM_URL);
useGLTF.preload(LEAF_URL);

const PALM_SCALE = 0.62; // raw height ~7.75 → ~4.8 m
const LEAF_SCALE = 0.0075; // raw height ~509 → ~3.8 m

// [x, z, scale-mult, kind, yaw]
const TREES: [number, number, number, "leaf" | "palm", number][] = [
  [-6.6, -32, 1.0, "leaf", 0.6],
  [-6.6, -11, 1.1, "palm", 1.9],
  [-6.6, 30, 0.95, "leaf", 2.7],
  [6.6, -26, 1.05, "palm", -0.8],
  [6.6, -9.5, 1.0, "leaf", 4.0],
  [6.6, 24, 1.1, "leaf", 1.2],
  [6.6, 50, 0.95, "palm", 3.3],
  [-6.6, 52, 1.0, "leaf", -2.1],
];

// Bake each tree to flat palette colours: trunk below `split` of its height,
// foliage above (a few greens by position, so the canopy has depth), and drop
// the photo texture. One shared material for every tree.
let treeMat: THREE.MeshStandardMaterial | null = null;
function useTreeModel(url: string, split: number, seed: number) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const s = scene.clone(true);
    s.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s);
    const h = box.max.y - box.min.y || 1;
    const trunk = new THREE.Color(WORLD.trunk);
    const greens = WORLD.foliage.map((c) => new THREE.Color(c));
    treeMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const v = new THREE.Vector3();
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = (m.geometry = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
      const pos = g.getAttribute("position");
      const col = new Float32Array(pos.count * 3);
      for (let t = 0; t < pos.count; t += 3) {
        // classify by the face centre so a triangle is one flat colour
        let y = 0, x = 0, z = 0;
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, t + k).applyMatrix4(m.matrixWorld);
          y += v.y; x += v.x; z += v.z;
        }
        const f = (y / 3 - box.min.y) / h;
        const c = f < split ? trunk : greens[Math.abs(Math.floor((x + z) * 3.1 + f * 7 + seed)) % greens.length];
        for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (t + k) * 3);
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      m.material = treeMat!;
      m.castShadow = true;
      m.receiveShadow = false;
    });
    return s;
  }, [scene, split, seed]);
}

export default function Trees() {
  const palm = useTreeModel(PALM_URL, 0.62, 1);
  const leaf = useTreeModel(LEAF_URL, 0.4, 2);

  return (
    <>
      {TREES.map(([x, z, s, kind, yaw], i) => {
        const model = kind === "palm" ? palm : leaf;
        const base = kind === "palm" ? PALM_SCALE : LEAF_SCALE;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, yaw, 0]} scale={base * s}>
            <Clone object={model} />
          </group>
        );
      })}
    </>
  );
}
