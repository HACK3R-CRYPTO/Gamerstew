"use client";

// ─── CityFacades — real PBR apartment facades lining the street ──────────────
// Replaces the flat Kenney boxes with Poly Haven's "Modular Urban Apartments
// Facade" (CC0, photogrammetry-grade PBR: plaster, trim, glass, with normal +
// roughness maps). One module is 147 tiny meshes / 5 materials, which is far too
// many to place hundreds of times — so on load we MERGE the module down to one
// geometry per material (baked into module-local space, centred, base at y=0),
// then draw the whole city as ONE InstancedMesh per material. A full street of
// ~hundreds of modules costs ~5 draw calls. The glass pane material glows at
// night (reads as lit windows) via a per-frame emissive keyed to the NEPA light.
//
// Asset: Poly Haven — modular_urban_apartments_facade (CC0, polyhaven.com).

import { useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STREET } from "./Street";
import { worldControls } from "./controls";

const URL = "/world/city/apartments/modular_urban_apartments_facade_1k.gltf";
const MOD_W = 3.78; // module width (tiles along the street)
const MOD_H = 3.06; // one floor
const MOD_D = 3.63; // depth (how far it sits off the building line)
const FLOORS = 4;

// Keep only position/normal/uv so every mesh in a material group merges cleanly
// (drop aoMap-only uv2 variance by dropping aoMap on the materials below).
function sanitize(src: THREE.BufferGeometry, world: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute("position");
  g.setAttribute("position", pos.clone());
  g.setAttribute("normal", (src.getAttribute("normal") ?? pos).clone());
  const uv = src.getAttribute("uv");
  g.setAttribute(
    "uv",
    uv ? uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2),
  );
  if (src.index) g.setIndex(src.index.clone());
  g.applyMatrix4(world);
  return g;
}

interface Group {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  isGlass: boolean;
}

function buildGroups(scene: THREE.Object3D): Group[] {
  scene.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(sanitize(mesh.geometry, mesh.matrixWorld));
  });

  // Recentre everything: combine bbox, shift so module is centred in x/z and its
  // base sits at y=0, with the detailed front facing +Z.
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const geos of byMat.values())
    for (const g of geos) {
      g.computeBoundingBox();
      tmp.copy(g.boundingBox!);
      box.union(tmp);
    }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const shift = new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz);

  const groups: Group[] = [];
  for (const [mat, geos] of byMat) {
    geos.forEach((g) => g.applyMatrix4(shift));
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const m = (mat as THREE.MeshStandardMaterial).clone();
    m.aoMap = null; // avoid uv2 requirement after the merge
    m.side = THREE.DoubleSide;
    const isGlass = /glass/i.test(mat.name);
    if (isGlass) {
      m.transparent = false;
      m.emissive = new THREE.Color("#ffcf8a");
      m.emissiveIntensity = 0;
      m.toneMapped = false;
    }
    groups.push({ geometry: merged, material: m, isGlass });
  }
  return groups;
}

function buildInstances(): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const BL = STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH + 0.1; // building line
  const half = STREET.STREET_LENGTH / 2 - 1;
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  for (let side = -1; side <= 1; side += 2) {
    const rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const x = side * (BL + MOD_D / 2);
    for (let z = -half; z <= half; z += MOD_W) {
      for (let f = 0; f < FLOORS; f++) {
        pos.set(x, f * MOD_H, z);
        out.push(new THREE.Matrix4().compose(pos, q, scl));
      }
    }
  }
  return out;
}

export default function CityFacades() {
  const { scene } = useGLTF(URL);
  const groups = useMemo(() => buildGroups(scene), [scene]);
  const instances = useMemo(() => buildInstances(), []);
  const glassMats = useRef<THREE.MeshStandardMaterial[]>([]);
  glassMats.current = groups.filter((g) => g.isGlass).map((g) => g.material);

  useFrame(() => {
    // Windows glow when the street is dark, fade out in daylight.
    const glow = Math.max(0, 1 - worldControls.lit) * 2.4 + worldControls.surge * 0.6;
    for (const m of glassMats.current) m.emissiveIntensity = glow;
  });

  return (
    <group>
      {groups.map((g, i) => (
        <instancedMesh
          key={i}
          args={[g.geometry, g.material, instances.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
          ref={(inst) => {
            if (!inst) return;
            instances.forEach((m, j) => inst.setMatrixAt(j, m));
            inst.instanceMatrix.needsUpdate = true;
          }}
        />
      ))}
    </group>
  );
}

useGLTF.preload(URL);
