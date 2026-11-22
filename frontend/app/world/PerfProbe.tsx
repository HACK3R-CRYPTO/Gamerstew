"use client";

// ─── Dev-only perf probe ─────────────────────────────────────────────────────
// Exposes the live WebGLRenderer on window.__r3f_gl and a rolling snapshot on
// window.__perf ({ calls, tris, fps }) so draw-call / triangle / fps counts can
// be read from the running dev server (CDP, console, or a HUD). Mounted ONLY in
// development, so it ships nothing to production.

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

declare global {
  interface Window {
    __r3f_gl?: unknown;
    __r3f_scene?: THREE.Object3D;
    __cam?: THREE.Camera;
    __controls?: unknown;
    __perf?: { meshes: number; instanced: number; casters: number; sceneTris: number; fps: number };
  }
}

export default function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const last = useRef(performance.now());
  const fps = useRef(60);

  useFrame(() => {
    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    if (dt > 0) fps.current = fps.current * 0.9 + (1000 / dt) * 0.1;
    if (typeof window === "undefined") return;
    window.__cam = camera;
    window.__controls = controls;

    // Count renderable meshes directly off the graph — this is post-independent
    // (EffectComposer resets renderer.info each pass, so info.render.calls only
    // ever shows the final fullscreen pass). Each visible mesh ≈ one draw call;
    // an InstancedMesh is one draw call no matter how many instances.
    let meshes = 0;
    let instanced = 0;
    let casters = 0;
    let sceneTris = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
      if (!m.visible) return;
      const isInst = (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh;
      if (isInst) instanced++;
      else meshes++;
      if (m.castShadow) casters++;
      const g = m.geometry as THREE.BufferGeometry | undefined;
      const idx = g?.index;
      const pos = g?.attributes?.position;
      const count = isInst ? (m as unknown as THREE.InstancedMesh).count : 1;
      if (idx) sceneTris += (idx.count / 3) * count;
      else if (pos) sceneTris += (pos.count / 3) * count;
    });

    window.__r3f_gl = gl;
    window.__r3f_scene = scene;
    window.__perf = { meshes, instanced, casters, sceneTris: Math.round(sceneTris), fps: Math.round(fps.current) };
  });

  return null;
}
