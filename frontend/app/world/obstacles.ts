"use client";

// ─── Obstacle colliders ──────────────────────────────────────────────────────
// Circular colliders for the vehicles on the road, so the player routes AROUND
// them instead of walking through. Positions mirror the danfo/keke in Scene.tsx
// and the cars in Cars.tsx — keep them in sync. Devices/transformers are targets,
// not obstacles, so they are deliberately NOT here. The sidewalk clutter
// (generators, signboards, pedestrians) sits outside the player's x-bound, so it
// needs no colliders.

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export const OBSTACLES: Collider[] = [
  // danfos (yellow buses) — Scene.tsx
  { x: 3.1, z: -6, r: 1.85 },
  { x: -2.6, z: 22, r: 1.85 },
  // kekes (tricycles) — Scene.tsx
  { x: 2.4, z: 9, r: 0.95 },
  { x: -3.0, z: -18, r: 0.95 },
  // parked cars — Cars.tsx
  { x: 3.7, z: 42, r: 1.35 },
  { x: -3.7, z: -3, r: 1.35 },
  { x: -3.7, z: 47, r: 1.35 },
  { x: 3.7, z: -34, r: 1.35 },
  { x: -3.7, z: -47, r: 1.35 },
];

// Static props that sit ON the sidewalks, in the pedestrians' lanes. Pedestrians
// steer around these on the x-axis so they stop walking through them. Mirrors the
// generators in Generators.tsx, the signboards in Signboards.tsx and the left
// market cluster in StreetProps.tsx — keep in sync. (The player never reaches
// these, so they are not in OBSTACLES above.)
export const SIDEWALK_OBSTACLES: Collider[] = [
  // generators
  { x: -6.0, z: -18, r: 0.6 }, { x: 6.1, z: 2, r: 0.6 }, { x: -6.1, z: 6, r: 0.6 },
  { x: 6.0, z: 20, r: 0.6 }, { x: -6.0, z: 44, r: 0.6 },
  // signboards
  { x: -6.8, z: -6, r: 0.7 }, { x: 6.9, z: 10, r: 0.7 }, { x: -6.9, z: 18, r: 0.7 },
  { x: 6.8, z: -22, r: 0.7 }, { x: -6.7, z: 34, r: 0.7 }, { x: 6.9, z: 30, r: 0.7 },
  { x: -6.8, z: -32, r: 0.7 }, { x: 6.7, z: 44, r: 0.7 },
  // left-side market stalls / umbrellas (building edge)
  { x: -7.5, z: -14, r: 0.8 }, { x: -7.5, z: -7.8, r: 0.8 }, { x: -7.5, z: -1.6, r: 0.8 },
  { x: -7.5, z: 4.6, r: 0.8 }, { x: -7.5, z: 10.8, r: 0.8 },
];

// The parked-vehicle colliders are disabled in Restore mode (the parked cars are
// hidden there — the road carries MOVING traffic instead, which the player dodges
// rather than routes around). Set by Scene.tsx on mode change.
let obstaclesActive = true;
export function setObstaclesActive(v: boolean) {
  obstaclesActive = v;
}

/** Push (x,z) out of any overlapping collider; a couple of passes handle
 *  overlapping pairs. Returns the resolved position. */
export function resolveObstacles(x: number, z: number, playerR: number): [number, number] {
  if (!obstaclesActive) return [x, z];
  for (let iter = 0; iter < 2; iter++) {
    for (const o of OBSTACLES) {
      const dx = x - o.x;
      const dz = z - o.z;
      const min = o.r + playerR;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2);
        if (d > 1e-4) {
          const k = (min - d) / d;
          x += dx * k;
          z += dz * k;
        } else {
          x += min; // degenerate: shove along +x
        }
      }
    }
  }
  return [x, z];
}
