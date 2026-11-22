"use client";

// ─── City buildings: real CC0 low-poly models (Kenney City Kit, Commercial) ──
// Replaces the old procedural window-grid boxes with actual modelled storefronts,
// mid-rises and glass skyscrapers, tiled edge-to-edge down both sides of the
// street to form a proper city wall. All share one colormap texture (loaded from
// /world/kenney/buildings/Textures/colormap.png, referenced by the GLBs). They
// are lit by the scene rig, so they darken with everything else on a NEPA cut
// (the individual window glow is gone, but the street reads far more real).
//
// Each building faces the street (rotated ±90°, since the models face +Z), and
// is scaled up from Kenney's ~1-unit grid to our metre street. Placement is
// deterministic (cumulative along Z by footprint) so the wall is gap-free and
// stable across renders. Clones share geometry/material → cheap.

import { useMemo } from "react";
import { useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import { STREET } from "./Street";

const BASE = "/world/kenney/buildings/";

// key + natural bounding size (from the GLBs), in Kenney units.
const BUILD = [
  { k: "building-a", w: 0.88, d: 0.94 },
  { k: "building-b", w: 0.97, d: 0.94 },
  { k: "building-c", w: 0.88, d: 1.09 },
  { k: "building-d", w: 0.84, d: 0.9 },
  { k: "building-e", w: 1.64, d: 1.01 },
  { k: "building-f", w: 0.84, d: 1.03 },
  { k: "building-g", w: 0.97, d: 0.92 },
  { k: "building-h", w: 0.88, d: 1.01 },
  { k: "building-skyscraper-a", w: 1.36, d: 1.36 },
  { k: "building-skyscraper-b", w: 1.36, d: 1.36 },
  { k: "building-skyscraper-c", w: 1.28, d: 1.39 },
  { k: "building-skyscraper-e", w: 1.29, d: 1.24 },
] as const;

const URLS = BUILD.map((b) => BASE + b.k + ".glb");
URLS.forEach((u) => useGLTF.preload(u));

const SCALE = 6;
const GAP = 0.3; // metres between buildings along the street

// Deterministic varied order: mid-rises with a skyscraper every few slots.
const ORDER = [0, 5, 2, 8, 1, 6, 3, 9, 4, 7, 10, 2, 0, 11, 5, 3, 6, 1, 8, 7];

// Weathered Lagos paint, one muted tone per building TYPE (so materials stay
// shared per type and the recolour costs no extra draw calls). Multiplied onto
// the Kenney colourmap, so window/detail variation survives while the walls
// read as painted-then-faded concrete, not generic storefronts.
const TINTS = [
  "#c7a85f", "#b06a4a", "#5f918c", "#a9bcc6", "#86a06d", "#c492a4",
  "#d2c4a6", "#caa33f", "#9a5a4e", "#93aac0", "#c9b68f", "#97a681",
];

interface Placed {
  bi: number;
  x: number;
  z: number;
  rotY: number;
}

export default function Buildings() {
  const gltfs = useGLTF(URLS);

  // Clone each building TYPE once with its own cloned, Lagos-tinted materials.
  // Cloning (rather than mutating the cached gltf) keeps the recolour out of the
  // useGLTF cache and safe across hot reloads. All placements of a type Clone
  // from its tinted scene, so geometry + material stay shared (no extra draws).
  const tinted = useMemo(() => {
    return gltfs.map((g, i) => {
      const scene = g.scene.clone(true);
      const tint = new THREE.Color(TINTS[i % TINTS.length]);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        if (!src || !src.isMaterial) return;
        const m = src.clone();
        m.color.multiply(tint);
        m.roughness = Math.min(1, (m.roughness ?? 0.8) + 0.15); // weather it
        m.needsUpdate = true;
        mesh.material = m;
      });
      return scene;
    });
  }, [gltfs]);

  const placed = useMemo<Placed[]>(() => {
    const out: Placed[] = [];
    const offset = STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH + 0.2;
    const half = STREET.STREET_LENGTH / 2 - 2;
    for (let side = -1; side <= 1; side += 2) {
      let z = -half;
      let n = 0;
      while (z < half) {
        const bi = ORDER[(n + (side === 1 ? 4 : 0)) % ORDER.length];
        const b = BUILD[bi];
        const footprint = b.w * SCALE; // original width → along-street after ±90° turn
        z += footprint / 2;
        out.push({
          bi,
          // original depth becomes the X extent after the turn; set front at `offset`.
          x: side * (offset + (b.d * SCALE) / 2),
          z,
          rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        });
        z += footprint / 2 + GAP;
        n++;
      }
    }
    return out;
  }, []);

  return (
    <>
      {placed.map((p, i) => (
        <Clone
          key={i}
          object={tinted[p.bi]}
          position={[p.x, 0, p.z]}
          rotation={[0, p.rotY, 0]}
          scale={SCALE}
          receiveShadow
        />
      ))}
    </>
  );
}
