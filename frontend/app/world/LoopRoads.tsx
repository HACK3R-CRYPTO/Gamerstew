"use client";

// ─── LoopRoads — closes the cross-street into a drivable circuit ─────────────
// The map was a dead-end cross: the main road (N-S, x=0) and the Ajegunle street
// (E-W, z=0) just stopped at their ends. This adds the two legs that close the
// east half into a RECTANGLE you can drive/walk right around, no dead-ends:
//
//        (0,N_Z) ┌────────── north connector ──────────┐ (E_X,N_Z)
//                │                                      │
//           main road (exists)                    east road (new)
//                │                                      │
//        (0,0) ──┴───────────── Ajegunle (exists) ──────┘ (E_X,0)
//
// So: up the main road, east along the top, down the east road, west back along
// Ajegunle to the junction. The filling station past x=E_X stays as a spur.
// Reuses Street.tsx's CC0 tarmac/kerb textures on simple geometry. Colliders for
// the loop live in FreeRoam.tsx; it's mounted menu-only in Scene.

import { useMemo } from "react";
import { STREET } from "./Street";
import { WORLD, flat } from "./theme";
import AreaSign from "./AreaSign";
import WindowBlock from "./WindowBlock";

const ROAD_W = STREET.ROAD_WIDTH; // 9
const SW = STREET.SIDEWALK_WIDTH; // 3.5
export const LOOP = { E_X: 45, N_Z: 40, ROAD_W, SW };

// A row of window-block buildings along a line, facing the road.
// axis "z": row runs along Z at fixed x, facing ±X. axis "x": runs along X at
// fixed z, facing ±Z. `face` is the outward normal the street faces point toward.
function BuildingRow({
  axis,
  fixed,
  from,
  to,
  face,
  seedBase,
}: {
  axis: "x" | "z";
  fixed: number;
  from: number;
  to: number;
  face: 1 | -1;
  seedBase: number;
}) {
  let seed = seedBase;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const items: { p: [number, number, number]; w: number; h: number; d: number; rotY: number; wi: number; awn: number; dish: boolean }[] = [];
  let t = from;
  let n = 0;
  while (t < to - 2) {
    const w = 7 + rnd() * 6;
    const h = 9 + rnd() * 10;
    const d = 5.5 + rnd() * 3;
    t += w / 2;
    const rotY =
      axis === "z"
        ? face > 0
          ? -Math.PI / 2
          : Math.PI / 2
        : face > 0
          ? 0
          : Math.PI;
    const p: [number, number, number] =
      axis === "z" ? [fixed + face * (d / 2), 0, t] : [t, 0, fixed + face * (d / 2)];
    items.push({ p, w, h, d, rotY, wi: Math.floor(rnd() * 8), awn: (n + seedBase) % 3, dish: n % 3 === 0 });
    t += w / 2 + 0.5;
    n++;
  }
  return (
    <>
      {items.map((b, i) => (
        <group key={i} position={b.p} rotation={[0, b.rotY, 0]}>
          <WindowBlock w={b.w} h={b.h} d={b.d} wi={b.wi} awn={b.awn} dish={b.dish} />
        </group>
      ))}
    </>
  );
}

export default function LoopRoads() {
  const { E_X, N_Z } = LOOP;
  // Same flat palette as the main street (theme.ts). These side roads used six
  // 2K photo textures, about 6 MB to download and far more in graphics memory,
  // and they did not match the stylised street they join.
  const roadMat = flat(WORLD.road, { roughness: 0.95 });
  const walkMat = flat(WORLD.sidewalk, { roughness: 1 });

  // East road: along Z at x=E_X, overlapping Ajegunle (z=0) and the north leg.
  const eZ0 = -ROAD_W / 2;
  const eZ1 = N_Z + ROAD_W / 2;
  const eLen = eZ1 - eZ0;
  const eMid = (eZ0 + eZ1) / 2;
  // North connector: along X at z=N_Z, overlapping the main road (x=0) and east road.
  const nX0 = -ROAD_W / 2;
  const nX1 = E_X + ROAD_W / 2;
  const nLen = nX1 - nX0;
  const nMid = (nX0 + nX1) / 2;

  const asphaltMat = <primitive object={roadMat} attach="material" />;

  // dashes
  const eDashes = useMemo(() => {
    const arr: number[] = [];
    const n = Math.floor((N_Z) / 5);
    for (let i = 0; i < n; i++) arr.push(2 + i * 5);
    return arr;
  }, [N_Z]);
  const nDashes = useMemo(() => {
    const arr: number[] = [];
    const n = Math.floor(E_X / 5);
    for (let i = 0; i < n; i++) arr.push(2 + i * 5);
    return arr;
  }, [E_X]);

  return (
    <group>
      {/* ── East road (along Z at x=E_X) ─────────────────────────────── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[E_X, 0, eMid]} receiveShadow>
        <planeGeometry args={[ROAD_W, eLen]} />
        {asphaltMat}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`es${s}`} position={[E_X + s * (ROAD_W / 2 + SW / 2), 0.08, N_Z / 2]} receiveShadow castShadow>
          <boxGeometry args={[SW, 0.16, N_Z - ROAD_W]} />
          <primitive object={walkMat} attach="material" />
        </mesh>
      ))}
      {eDashes.map((z, i) => (
        <mesh key={`ed${i}`} position={[E_X, 0.03, z]}>
          <boxGeometry args={[0.18, 0.01, 2.2]} />
          <meshStandardMaterial color="#e9d27a" roughness={0.6} emissive="#3a3410" emissiveIntensity={0.2} />
        </mesh>
      ))}

      {/* ── North connector (along X at z=N_Z) ───────────────────────── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[nMid, 0, N_Z]} receiveShadow>
        <planeGeometry args={[nLen, ROAD_W]} />
        {asphaltMat}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`ns${s}`} position={[E_X / 2, 0.08, N_Z + s * (ROAD_W / 2 + SW / 2)]} receiveShadow castShadow>
          <boxGeometry args={[E_X - ROAD_W, 0.16, SW]} />
          <primitive object={walkMat} attach="material" />
        </mesh>
      ))}
      {nDashes.map((x, i) => (
        <mesh key={`nd${i}`} position={[x, 0.03, N_Z]}>
          <boxGeometry args={[2.2, 0.01, 0.18]} />
          <meshStandardMaterial color="#e9d27a" roughness={0.6} emissive="#3a3410" emissiveIntensity={0.2} />
        </mesh>
      ))}

      {/* ── Buildings framing the loop so the roads aren't void-adjacent ── */}
      {/* outer east (face west toward the east road) */}
      <BuildingRow axis="z" fixed={E_X + ROAD_W / 2 + SW + 0.1} from={4} to={N_Z - 4} face={-1} seedBase={11} />
      {/* outer north (face south toward the connector) */}
      <BuildingRow axis="x" fixed={N_Z + ROAD_W / 2 + SW + 0.1} from={4} to={E_X - 4} face={-1} seedBase={23} />
      {/* inner block — east face (faces +X toward the east road) */}
      <BuildingRow axis="z" fixed={E_X - ROAD_W / 2 - SW - 0.1} from={14} to={N_Z - 14} face={1} seedBase={37} />
      {/* inner block — north face (faces +Z toward the connector) */}
      <BuildingRow axis="x" fixed={N_Z - ROAD_W / 2 - SW - 0.1} from={14} to={E_X - 14} face={1} seedBase={53} />

      {/* a district sign on the new top road */}
      <AreaSign position={[E_X, 0, N_Z]} rotation={0} sub="loop" text="SURULERE" width={12} color="#1c6ba8" />
    </group>
  );
}
