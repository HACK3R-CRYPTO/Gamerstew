"use client";

// ─── Drying clothes on lines — the signature Lagos street detail ─────────────
// Colourful wrappers and shirts pegged to sagging ropes strung along both kerbs,
// above the sidewalk so they frame the street without blocking the play area or
// camera. The ropes are one LineSegments (1 draw call) and ALL the clothes are a
// single InstancedMesh with per-item colour (1 draw call), so the whole thing is
// cheap. A gentle breeze sway is baked into the instanced material's vertex
// shader (top pegged, hem drifts), so it reads as alive with no per-frame CPU.

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { STREET } from "./Street";

// bright ankara / everyday-wear palette
const PALETTE = ["#d83a3a", "#2e7bd6", "#39a845", "#e8a21c", "#e65fa0", "#efe9dd", "#7a3fb0", "#15b8a6", "#f2f0ea"];

const LINE_X = STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH - 1.4; // ~6.6, over the sidewalk
const LINE_Y = 3.5; // rope height at the posts
const SAG = 0.5; // rope droop at mid-span
const CLOTH_W = 0.5;
const CLOTH_H = 0.62;

// Zones of washing down each side (z-centre, half-length). Gaps between them so
// it looks lived-in, not a continuous curtain.
const ZONES = [-40, -22, -4, 16, 34];
const ZONE_HALF = 6;
const STEP = 1.15; // spacing of clothes along a rope

function rnd(seed: number) {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

interface Item {
  x: number;
  y: number;
  z: number;
  rotY: number;
  color: THREE.Color;
  scale: number;
}

export default function LaundryLines() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const timeRef = useRef({ value: 0 });

  const { items, ropeGeo } = useMemo(() => {
    const items: Item[] = [];
    const ropePos: number[] = [];
    let seed = 1;
    for (let side = -1; side <= 1; side += 2) {
      const x = side * LINE_X;
      for (const zc of ZONES) {
        const z0 = zc - ZONE_HALF;
        const z1 = zc + ZONE_HALF;
        // rope as a sagging catenary, baked into the shared LineSegments
        const segs = 14;
        let prev: THREE.Vector3 | null = null;
        for (let s = 0; s <= segs; s++) {
          const t = s / segs;
          const y = LINE_Y - Math.sin(t * Math.PI) * SAG;
          const p = new THREE.Vector3(x, y, z0 + (z1 - z0) * t);
          if (prev) ropePos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
          prev = p;
        }
        // clothes pegged along it
        for (let z = z0 + 0.7; z <= z1 - 0.4; z += STEP) {
          const t = (z - z0) / (z1 - z0);
          const topY = LINE_Y - Math.sin(t * Math.PI) * SAG;
          const r = rnd(seed++);
          if (r < 0.18) continue; // some gaps on the line
          items.push({
            x,
            y: topY,
            z,
            rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2, // face across the street
            color: new THREE.Color(PALETTE[Math.floor(rnd(seed++) * PALETTE.length)]),
            scale: 0.85 + rnd(seed++) * 0.4,
          });
        }
      }
    }
    const ropeGeo = new THREE.BufferGeometry();
    ropeGeo.setAttribute("position", new THREE.Float32BufferAttribute(ropePos, 3));
    return { items, ropeGeo };
  }, []);

  // Place instances + colours once.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const e = new THREE.Euler();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      e.set(0, it.rotY, 0);
      q.setFromEuler(e);
      pos.set(it.x, it.y, it.z);
      scl.set(it.scale, it.scale, 1);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);

  // Breeze sway: pegged at the top (local y≈0), hem (local y≈-CLOTH_H) drifts.
  const onBeforeCompile = useMemo(
    () => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTime = timeRef.current;
      shader.vertexShader =
        "uniform float uTime;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float hang = clamp(-transformed.y / ${CLOTH_H.toFixed(2)}, 0.0, 1.0);
           float phase = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.5;
           float sway = sin(uTime * 1.6 + phase) * 0.12 * hang;
           transformed.x += sway;
           transformed.z += cos(uTime * 1.3 + phase) * 0.05 * hang;`,
        );
    },
    [],
  );

  useFrame((_, dt) => {
    timeRef.current.value += Math.min(dt, 0.1);
  });

  // Cloth plane with pivot at the TOP edge so it hangs from the rope.
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, 1, 3);
    g.translate(0, -CLOTH_H / 2, 0);
    return g;
  }, []);

  return (
    <group>
      <lineSegments geometry={ropeGeo}>
        <lineBasicMaterial color="#2a2118" />
      </lineSegments>
      <instancedMesh ref={meshRef} args={[geom, undefined, items.length]} castShadow={false}>
        <meshStandardMaterial
          ref={matRef}
          side={THREE.DoubleSide}
          roughness={0.95}
          metalness={0}
          onBeforeCompile={onBeforeCompile}
        />
      </instancedMesh>
    </group>
  );
}
