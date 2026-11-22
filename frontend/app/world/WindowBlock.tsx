"use client";

// ─── WindowBlock — the one Lagos building every street uses ──────────────────
// A flat-shaded pastel block in the world palette wearing the shared facade
// material (windows on every face that glow when the power is on), a dark
// ground-floor shop band with a lit shopfront and a striped awning, a parapet
// roof with the black water tank every Lagos roof has, and optional balcony /
// AC units / dish for relief. All colours come from theme.ts; all materials are
// cached and shared, so a street of these costs a handful of draw-state changes.
//
// Convention: the caller positions + rotates the wrapping group so the block's
// local +Z faces the road; the shop awning hangs off that street face.

import { useMemo } from "react";
import * as THREE from "three";
import { WORLD, GA, flat } from "./theme";
import { facadeMaterial, shopfrontMaterial } from "./facade";

export const WALLS = WORLD.walls;

export interface WindowBlockProps {
  w: number;
  h: number;
  d: number;
  wi?: number; // wall-colour index
  awn?: number; // awning-colour index
  dish?: boolean; // rooftop satellite dish
  shop?: boolean; // ground-floor shop band + awning on the street face (default on)
  r?: number; // 0..1 per-building random → which relief add-ons it wears
}

const SHOP_H = 3.0;

export default function WindowBlock({ w, h, d, wi = 0, awn = 0, dish = false, shop = true, r = 0 }: WindowBlockProps) {
  const wall = WALLS[wi % WALLS.length];
  const awnColor = WORLD.awning[awn % WORLD.awning.length];
  const m = useMemo(
    () => ({
      wall: facadeMaterial(wall, w, h),
      band: flat(WORLD.shopBand[(wi + awn) % WORLD.shopBand.length], { roughness: 0.9 }),
      // the shopfront glass: warm light spilling onto the pavement
      front: shopfrontMaterial(),
      awn: flat(awnColor, { roughness: 0.85 }),
      valance: flat(GA.ink, { roughness: 0.9 }),
      parapet: flat(WORLD.parapet, { roughness: 1 }),
      roof: flat(WORLD.roof, { roughness: 1 }),
      tank: flat("#15101f", { roughness: 0.8 }),
      metal: flat(WORLD.metal, { roughness: 0.6, metalness: 0.3 }),
      slab: flat("#8d8499", { roughness: 1 }),
      ac: flat("#e4dfea", { roughness: 0.8 }),
      dish: flat("#e4dfea", { roughness: 0.6, side: THREE.DoubleSide }),
    }),
    [wall, w, h, wi, awn, awnColor],
  );

  const z0 = d / 2; // street-facing plane
  return (
    <group>
      {/* the block — windows on every face, tinted, glowing with the power */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow material={m.wall}>
        <boxGeometry args={[w, h, d]} />
      </mesh>

      {shop && (
        <>
          {/* ground-floor shop band, just proud of the facade */}
          <mesh position={[0, SHOP_H / 2, z0 + 0.03]} material={m.band}>
            <boxGeometry args={[w + 0.02, SHOP_H, 0.06]} />
          </mesh>
          {/* lit shopfronts: two or three bays */}
          {(w > 10 ? [-0.3, 0, 0.3] : [-0.22, 0.22]).map((fx) => (
            <mesh key={fx} position={[fx * w, 1.15, z0 + 0.07]} material={m.front}>
              <boxGeometry args={[w * (w > 10 ? 0.2 : 0.3), 1.9, 0.02]} />
            </mesh>
          ))}
          {/* awning + white valance */}
          <group position={[0, 2.62, z0]}>
            <mesh position={[0, 0, 0.6]} rotation={[0.42, 0, 0]} castShadow material={m.awn}>
              <boxGeometry args={[w * 0.94, 0.08, 1.3]} />
            </mesh>
            <mesh position={[0, -0.29, 1.15]} rotation={[0.42, 0, 0]} material={m.valance}>
              <boxGeometry args={[w * 0.94, 0.24, 0.04]} />
            </mesh>
          </group>
        </>
      )}

      {/* balcony on an upper floor — about half the buildings */}
      {r > 0.5 && (
        <group position={[0, Math.min(h * 0.5, h - 3), z0]}>
          <mesh position={[0, 0, 0.45]} castShadow receiveShadow material={m.slab}>
            <boxGeometry args={[w * 0.6, 0.16, 0.9]} />
          </mesh>
          <mesh position={[0, 0.42, 0.88]} material={m.metal}>
            <boxGeometry args={[w * 0.6, 0.72, 0.06]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (w * 0.3 - 0.03), 0.42, 0.45]} material={m.metal}>
              <boxGeometry args={[0.06, 0.72, 0.9]} />
            </mesh>
          ))}
        </group>
      )}

      {/* window AC units — about a third of the buildings */}
      {r > 0 && r < 0.34 && (
        <>
          <mesh position={[-w * 0.26, h * 0.62, z0 + 0.16]} castShadow material={m.ac}>
            <boxGeometry args={[0.7, 0.42, 0.34]} />
          </mesh>
          <mesh position={[w * 0.22, h * 0.42, z0 + 0.16]} castShadow material={m.ac}>
            <boxGeometry args={[0.7, 0.42, 0.34]} />
          </mesh>
        </>
      )}

      {/* rooftop: parapet, roof deck, water tank, dish */}
      <group position={[0, h, 0]}>
        <mesh position={[0, 0.18, 0]} material={m.parapet}>
          <boxGeometry args={[w + 0.2, 0.36, d + 0.2]} />
        </mesh>
        <mesh position={[0, 0.37, 0]} material={m.roof}>
          <boxGeometry args={[w - 0.4, 0.02, d - 0.4]} />
        </mesh>
        <group position={[w * 0.26, 0.36, -d * 0.15]}>
          <mesh position={[0, 0.3, 0]} material={m.metal}>
            <boxGeometry args={[0.7, 0.6, 0.7]} />
          </mesh>
          <mesh position={[0, 1.05, 0]} castShadow material={m.tank}>
            <cylinderGeometry args={[0.5, 0.5, 0.9, 8]} />
          </mesh>
          <mesh position={[0, 1.55, 0]} material={m.tank}>
            <cylinderGeometry args={[0.2, 0.34, 0.14, 8]} />
          </mesh>
        </group>
        {dish && (
          <mesh position={[-w * 0.18, 0.8, d * 0.2]} rotation={[0.5, 0.4, 0]} material={m.dish}>
            <sphereGeometry args={[0.45, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
          </mesh>
        )}
      </group>
    </group>
  );
}
