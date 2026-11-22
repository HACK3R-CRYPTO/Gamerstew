"use client";

// ─── Batch — collapse a static subtree into ONE draw call ────────────────────
// The street is built from hundreds of small boxes and cylinders, each with a
// plain coloured material. Rendered separately that is hundreds of draw calls,
// which is what makes a phone struggle. Wrap any STATIC part of the scene in
// <Batch> and, once it has mounted, every plain-colour mesh inside is baked
// into a single vertex-coloured geometry and the originals are hidden.
//
// Second pass: whatever is left that SHARES a material with something else
// (glowing window panels, lamp heads, textured walls) is merged per material
// and keeps that material, so a glow that follows the power still works: the
// material is the same object, there is just one mesh wearing it instead of
// thirty.
//
// Left alone (they keep rendering as they are): anything instanced or skinned,
// anything with more than one material, a material used only once, and any
// subtree marked `userData={{ noBatch: true }}` (vehicles, animated props).

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

let shared: THREE.MeshStandardMaterial | null = null;
const batchMaterial = () =>
  (shared ||= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 }));

function bakeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
  if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || !m.visible || m.userData.batched) return false;
  const mat = m.material as THREE.MeshStandardMaterial;
  if (Array.isArray(mat) || !mat?.isMeshStandardMaterial) return false;
  if (mat.map || mat.emissiveMap || mat.transparent || mat.vertexColors || mat.side !== THREE.FrontSide) return false;
  if (mat.emissive && mat.emissive.r + mat.emissive.g + mat.emissive.b > 0.001) return false;
  return !!m.geometry?.getAttribute("position");
}

export default function Batch({ children }: { children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const [meshes, setMeshes] = useState<THREE.Mesh[]>([]);

  useLayoutEffect(() => {
    const g = root.current;
    if (!g) return;
    g.updateMatrixWorld(true);
    const inv = g.matrixWorld.clone().invert();
    const found: THREE.Mesh[] = [];
    const walk = (o: THREE.Object3D) => {
      if (o.userData.noBatch || !o.visible) return;
      if (bakeable(o)) found.push(o);
      for (const c of o.children) walk(c);
    };
    walk(g);
    const made: THREE.Mesh[] = [];
    const hidden: THREE.Mesh[] = [];
    const disposeList: THREE.BufferGeometry[] = [];

    // ── pass 2 first (it only looks at meshes pass 1 will not take) ──
    const taken = new Set<THREE.Object3D>(found.length >= 2 ? found : []);
    const byMat = new Map<string, THREE.Mesh[]>();
    const walk2 = (o: THREE.Object3D) => {
      if (o.userData.noBatch || !o.visible) return;
      const m = o as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
      if (m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh && !m.userData.batched && !taken.has(m) && !Array.isArray(m.material) && m.material && m.geometry?.getAttribute("position")) {
        const k = (m.material as THREE.Material).uuid;
        (byMat.get(k) ?? byMat.set(k, []).get(k)!).push(m);
      }
      for (const c of o.children) walk2(c);
    };
    walk2(g);
    for (const group of byMat.values()) {
      if (group.length < 2) continue;
      const mat = group[0].material as THREE.MeshStandardMaterial;
      const needUv = !!(mat.map || mat.emissiveMap);
      if (needUv && group.some((m) => !m.geometry.getAttribute("uv"))) continue;
      const geos = group.map((m) => {
        const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", src.getAttribute("position"));
        if (src.getAttribute("normal")) geo.setAttribute("normal", src.getAttribute("normal"));
        if (needUv) geo.setAttribute("uv", src.getAttribute("uv"));
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        if (!geo.getAttribute("normal")) geo.computeVertexNormals();
        return geo;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((x) => x.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const out = new THREE.Mesh(merged, mat);
      out.castShadow = group[0].castShadow;
      out.receiveShadow = group[0].receiveShadow;
      out.renderOrder = group[0].renderOrder;
      out.userData.batched = true;
      made.push(out);
      disposeList.push(merged);
      for (const m of group) { m.visible = false; hidden.push(m); }
    }
    const finish = () => {
      setMeshes(made);
      return () => {
        for (const m of hidden) m.visible = true;
        for (const x of disposeList) x.dispose();
        setMeshes([]);
      };
    };
    if (found.length < 2) return finish();

    let total = 0;
    const parts = found.map((m) => {
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      total += geo.getAttribute("position").count;
      return { geo, color: (m.material as THREE.MeshStandardMaterial).color };
    });
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let o = 0;
    for (const p of parts) {
      const a = p.geo.getAttribute("position");
      pos.set(a.array as Float32Array, o * 3);
      for (let i = 0; i < a.count; i++) {
        col[(o + i) * 3] = p.color.r;
        col[(o + i) * 3 + 1] = p.color.g;
        col[(o + i) * 3 + 2] = p.color.b;
      }
      o += a.count;
      p.geo.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    const out = new THREE.Mesh(merged, batchMaterial());
    out.castShadow = true;
    out.receiveShadow = true;
    out.userData.batched = true;
    for (const m of found) { m.visible = false; hidden.push(m); }
    made.push(out);
    disposeList.push(merged);
    return finish();
  }, []);

  return (
    <group ref={root} name="batch-root">
      {children}
      {meshes.map((m) => <primitive key={m.uuid} object={m} />)}
    </group>
  );
}
