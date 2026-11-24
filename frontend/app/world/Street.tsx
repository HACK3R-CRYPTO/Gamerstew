"use client";

// ─── Lagos street base: palette road + green/white kerb + sidewalks ──────────
// 1 three unit = 1 metre. The street runs along Z. Every surface is a flat
// palette colour from theme.ts (no photo textures) so the road sits in the same
// stylised world as the buildings and cars. The signature detail is the real
// Lagos kerb: alternating green/white blocks, which also happens to be the
// GameArena green. Desktop keeps a soft wet reflection so lit windows and the
// breaker glow bounce off the tarmac at night.

import { useMemo } from "react";
import { MeshReflectorMaterial } from "@react-three/drei";
import * as THREE from "three";
import { WORLD, flat } from "./theme";

const STREET_LENGTH = 120; // metres along Z
const ROAD_WIDTH = 9; // drivable tarmac
const SIDEWALK_WIDTH = 3.5;
const KERB_LEN = 1.6; // one painted kerb block
const JUNCTION = ROAD_WIDTH / 2; // the cross streets meet the main road for |z| < this
// Sidewalk / kerb / gutter runs either side of the junction mouth (z centre, length).
const SEG_LEN = STREET_LENGTH / 2 - JUNCTION;
const SEGS = [-1, 1].map((d) => d * (JUNCTION + SEG_LEN / 2));

export default function Street({ isMobile = false }: { isMobile?: boolean }) {
  // Centre-line dashes via instancing.
  const dashCount = 24;
  const dashMatrices = useMemo(() => {
    const arr: THREE.Matrix4[] = [];
    const gap = STREET_LENGTH / dashCount;
    const start = -STREET_LENGTH / 2 + gap / 2;
    for (let i = 0; i < dashCount; i++) {
      const m = new THREE.Matrix4();
      m.setPosition(0, 0.03, start + i * gap);
      arr.push(m);
    }
    return arr;
  }, []);

  // Kerb blocks: one instanced mesh per colour, alternating along each edge.
  const kerb = useMemo(() => {
    const perSide = Math.ceil(STREET_LENGTH / KERB_LEN);
    const green: THREE.Matrix4[] = [];
    const white: THREE.Matrix4[] = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < perSide; i++) {
        const z = -STREET_LENGTH / 2 + KERB_LEN / 2 + i * KERB_LEN;
        if (Math.abs(z) < JUNCTION + KERB_LEN / 2) continue; // open at the crossroads
        const m = new THREE.Matrix4();
        m.setPosition(s * (ROAD_WIDTH / 2 + 0.17), 0.1, z);
        (i % 2 === 0 ? green : white).push(m);
      }
    }
    return { green, white };
  }, []);

  const matGround = useMemo(() => flat(WORLD.ground, { roughness: 1 }), []);
  const matRoad = useMemo(() => flat(WORLD.road, { roughness: 0.95 }), []);
  const matGutter = useMemo(() => flat(WORLD.gutter, { roughness: 1 }), []);
  const matWalk = useMemo(() => flat(WORLD.sidewalk, { roughness: 1 }), []);
  const matWalkEdge = useMemo(() => flat(WORLD.sidewalkEdge, { roughness: 1 }), []);
  const matLine = useMemo(() => flat(WORLD.roadLine, { roughness: 0.6, emissive: "#3a3410", emissiveIntensity: 0.2 }), []);
  const matKerbGreen = useMemo(() => flat(WORLD.kerb[0], { roughness: 0.9 }), []);
  const matKerbWhite = useMemo(() => flat(WORLD.kerb[1], { roughness: 0.9 }), []);

  return (
    <group>
      {/* Ground beyond the kerbs (mostly hidden by the buildings). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} receiveShadow material={matGround}>
        <planeGeometry args={[220, 220]} />
      </mesh>

      {/* Tarmac — soft wet reflection on desktop, flat on mobile. */}
      {isMobile ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={matRoad}>
          <planeGeometry args={[ROAD_WIDTH, STREET_LENGTH]} />
        </mesh>
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[ROAD_WIDTH, STREET_LENGTH]} />
          <MeshReflectorMaterial
            resolution={512}
            blur={[320, 120]}
            mixBlur={1.4}
            mixStrength={0.9}
            mirror={0.16}
            color={WORLD.road}
            metalness={0.1}
            roughness={0.9}
            depthScale={1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
          />
        </mesh>
      )}

      {/* Dashed centre line (instanced). */}
      <instancedMesh
        args={[undefined, undefined, dashCount]}
        material={matLine}
        ref={(m) => {
          if (!m) return;
          dashMatrices.forEach((mat, i) => m.setMatrixAt(i, mat));
          m.instanceMatrix.needsUpdate = true;
        }}
      >
        <boxGeometry args={[0.18, 0.01, 2.2]} />
      </instancedMesh>

      {/* The green/white Lagos kerb, alternating blocks along both edges. */}
      {([
        [kerb.green, matKerbGreen],
        [kerb.white, matKerbWhite],
      ] as [THREE.Matrix4[], THREE.MeshStandardMaterial][]).map(([mats, mat], k) => (
        <instancedMesh
          key={k}
          args={[undefined, undefined, mats.length]}
          material={mat}
          castShadow
          receiveShadow
          ref={(m) => {
            if (!m) return;
            mats.forEach((mm, i) => m.setMatrixAt(i, mm));
            m.instanceMatrix.needsUpdate = true;
          }}
        >
          <boxGeometry args={[0.34, 0.2, KERB_LEN - 0.08]} />
        </instancedMesh>
      ))}

      {/* Junction mouths: tarmac carries straight through to the cross streets
          (the sidewalks, kerb and gutter all stop either side of it). */}
      {[-1, 1].map((s) => (
        <mesh key={s} rotation={[-Math.PI / 2, 0, 0]} position={[s * (ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2), 0.001, 0]} receiveShadow material={matRoad}>
          <planeGeometry args={[SIDEWALK_WIDTH + 0.2, JUNCTION * 2]} />
        </mesh>
      ))}

      {[-1, 1].flatMap((s) =>
        SEGS.map((zc) => (
          <group key={`${s}_${zc}`}>
            {/* open gutter channel */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[s * (ROAD_WIDTH / 2 + 0.55), 0.17, zc]} material={matGutter}>
              <planeGeometry args={[0.3, SEG_LEN]} />
            </mesh>
            {/* raised sidewalk */}
            <mesh position={[s * (ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2), 0.08, zc]} receiveShadow castShadow material={matWalk}>
              <boxGeometry args={[SIDEWALK_WIDTH, 0.16, SEG_LEN]} />
            </mesh>
            {/* lighter edge slab */}
            <mesh position={[s * (ROAD_WIDTH / 2 + 1.05), 0.165, zc]} receiveShadow material={matWalkEdge}>
              <boxGeometry args={[0.5, 0.01, SEG_LEN]} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

export const STREET = { STREET_LENGTH, ROAD_WIDTH, SIDEWALK_WIDTH };
