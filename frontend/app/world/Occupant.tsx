"use client";

// ─── Occupant — OUR character, properly SEATED, with varied clothing ─────────
// passenger-seated.glb is OUR normal character (human.glb, the Quaternius casual
// everyday person) posed into a genuine sit in Blender and baked as its rest pose,
// so it loads already seated. The Quaternius palette atlas (human-skin.png: dark
// skin, GREEN top, khaki trousers) is baked into the material. Since every seated
// figure shares that one atlas, a street full of them all wore the same green shirt.
// So here we recolor JUST the green shirt region of the atlas to a per-passenger
// colour (preserving skin + trousers + the baked shading), cached per colour, so
// the vehicles carry a varied crowd instead of a fleet of identical green riders.
// ~1.37 m seated, faces -Z, grounded here (lowest point at local y=0).

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";

const URL = "/world/models/passenger-seated.glb";
useGLTF.preload(URL);

// A spread of everyday Lagos street-wear colours (plus a couple of greens kept, so
// green isn't banned — just no longer universal).
const SHIRTS = ["#c0392b", "#2563b8", "#e0a93b", "#6c3fb0", "#1f9d57", "#d9742b", "#e6e0d2", "#3a4049", "#b83280", "#2a9d9d"];

// Recoloured-atlas cache: one CanvasTexture per shirt colour, built from the base
// atlas image the first time it's needed. Keyed by the hex colour.
const texCache = new Map<string, THREE.Texture>();

function recolouredAtlas(src: THREE.Texture, hex: string): THREE.Texture {
  const cached = texCache.get(hex);
  if (cached) return cached;
  const img = src.image as (HTMLImageElement | HTMLCanvasElement | ImageBitmap) & { width: number; height: number };
  if (typeof document === "undefined" || !img || !img.width) return src; // SSR / no image → leave as-is
  try {
    const w = img.width;
    const h = img.height;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return src;
    ctx.drawImage(img as CanvasImageSource, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;
    const tr = parseInt(hex.slice(1, 3), 16);
    const tg = parseInt(hex.slice(3, 5), 16);
    const tb = parseInt(hex.slice(5, 7), 16);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // "shirt green" = green clearly dominant over red + blue. Skin (brownish) and
      // khaki trousers are NOT green-dominant, so they're left untouched.
      if (g > 40 && g > r * 1.25 && g > b * 1.25) {
        const f = Math.min(1.25, (g / 160)); // keep the baked light/shadow variation
        d[i] = Math.min(255, tr * f);
        d[i + 1] = Math.min(255, tg * f);
        d[i + 2] = Math.min(255, tb * f);
      }
    }
    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.flipY = src.flipY;
    tex.colorSpace = src.colorSpace;
    tex.wrapS = src.wrapS;
    tex.wrapT = src.wrapT;
    tex.magFilter = src.magFilter;
    tex.minFilter = src.minFilter;
    tex.needsUpdate = true;
    texCache.set(hex, tex);
    return tex;
  } catch {
    return src; // any canvas issue (tainted, etc.) → fall back to the original
  }
}

export default function Occupant({
  position = [0, 0, 0] as [number, number, number],
  rotation = 0,
  scale = 1,
  char = 0,
}: {
  position?: [number, number, number];
  rotation?: number;
  scale?: number;
  // `char` now PICKS the shirt colour so each seated figure is a different person.
  char?: number;
}) {
  const { scene } = useGLTF(URL);

  const { model, groundY } = useMemo(() => {
    const s = skeletonClone(scene) as THREE.Group;
    const hex = SHIRTS[((char % SHIRTS.length) + SHIRTS.length) % SHIRTS.length];
    s.traverse((o) => {
      const mesh = o as THREE.Mesh & { isSkinnedMesh?: boolean };
      if (mesh.isMesh || mesh.isSkinnedMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false; // partly inside the vehicle box
        // Clone the material (SkeletonUtils shares them) so this occupant's shirt
        // colour doesn't leak onto every other occupant, then swap in the recolour.
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.map) {
          const cm = mat.clone();
          cm.map = recolouredAtlas(mat.map, hex);
          mesh.material = cm;
        }
      }
    });
    s.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s);
    return { model: s, groundY: -box.min.y };
  }, [scene, char]);

  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <group position={[0, groundY, 0]}>
        <primitive object={model} />
      </group>
    </group>
  );
}
