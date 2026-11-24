"use client";

// ─── LagosBuildings — the main street's blocks ───────────────────────────────
// Lays WindowBlock buildings down both kerbs with seeded variety (width, height,
// depth, wall colour, awning colour, relief add-ons), leaving gaps for the
// petrol station and the junction. The look itself lives in WindowBlock +
// facade.ts + theme.ts so every road in the map shares it.

import { useMemo } from "react";
import { STREET } from "./Street";
import WindowBlock, { WALLS } from "./WindowBlock";
import { WORLD } from "./theme";

interface B {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rotY: number;
  wi: number;
  r: number;
  awn: number;
}

export default function LagosBuildings() {
  const buildings = useMemo<B[]>(() => {
    const out: B[] = [];
    const BL = STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH + 0.1; // building line
    const half = STREET.STREET_LENGTH / 2 - 1;
    let seed = 20;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let side = -1; side <= 1; side += 2) {
      const rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      let z = -half;
      let n = 0;
      while (z < half) {
        const w = 7 + rnd() * 6;
        const h = 9 + rnd() * 12;
        const d = 6 + rnd() * 4;
        z += w / 2;
        // Gaps: left kerb for the OJU OIL petrol station, and the RIGHT kerb at
        // the junction (z≈0) where the side street branches off (see SideStreet).
        const petrolGap = side < 0 && z > -47 && z < -33;
        // Clear the whole cross street (road + its sidewalks) by EDGE, not centre,
        // so no corner block pokes into the junction and hides the area gantry.
        const junctionGap = z - w / 2 < 8.6 && z + w / 2 > -8.6;
        const r = rnd();
        if (!petrolGap && !junctionGap) {
          out.push({
            x: side * (BL + d / 2),
            z,
            w,
            h,
            d,
            rotY,
            wi: Math.floor(rnd() * WALLS.length),
            r,
            awn: Math.floor(rnd() * WORLD.awning.length),
          });
        }
        z += w / 2 + 0.4;
        n++;
      }
    }
    return out;
  }, []);

  return (
    <group>
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.rotY, 0]}>
          <WindowBlock w={b.w} h={b.h} d={b.d} wi={b.wi} awn={b.awn} r={Math.max(b.r, 0.001)} dish={i % 3 === 0} />
        </group>
      ))}
    </group>
  );
}
