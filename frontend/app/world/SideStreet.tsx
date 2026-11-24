"use client";

// ─── SideStreet — a perpendicular road branching off the main street ─────────
// Phase 1 of the map (PRD §8): grow the single street into a junction. A side
// road runs along +X from the main street's right kerb, with its own sidewalks,
// lane dashes and textured Lagos buildings facing it. The junction itself (where
// they cross) is left open; LagosBuildings skips its right-side buildings there,
// and FreeRoam opens the wall + adds this road's colliders.
//
// Same technique as Street.tsx + LagosBuildings.tsx: real CC0 PBR tarmac/kerb
// textures on simple geometry, facade quads on boxes.

import { useMemo } from "react";
import * as THREE from "three";
import { STREET } from "./Street";
import GasStation from "./GasStation";
import Danfo from "./Danfo";
import Keke from "./Keke";
import AreaSign from "./AreaSign";
import { WORLD, flat } from "./theme";
import WindowBlock from "./WindowBlock";

const ROAD_W = STREET.ROAD_WIDTH; // 9, matches the main road
const SW = STREET.SIDEWALK_WIDTH; // 3.5
export const SIDE = {
  START: STREET.ROAD_WIDTH / 2, // 4.5 — main road edge (junction mouth)
  LEN: 52, // road reaches the filling station at the far end
  ROAD_W,
  SW,
  BUILDING_Z: ROAD_W / 2 + SW + 0.1, // ±8.1 building line
};

// Colourful parasol — a pole + a cone canopy, the classic Lagos market umbrella.
function Umbrella({ pos, color }: { pos: [number, number, number]; color: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 2.0, 8]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>
      <mesh position={[0, 2.05, 0]} castShadow>
        <coneGeometry args={[1.25, 0.7, 10]} />
        <meshStandardMaterial color={color} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// A stall: a table with a few produce crates on top.
function Stall({ pos }: { pos: [number, number, number] }) {
  const crates = [
    { x: -0.4, c: "#c0392b" },
    { x: 0.0, c: "#e67e22" },
    { x: 0.42, c: "#27ae60" },
  ];
  return (
    <group position={pos}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.1, 0.8]} />
        <meshStandardMaterial color="#6b4e2e" roughness={1} />
      </mesh>
      {[-0.5, 0.5].map((x) => (
        <mesh key={x} position={[x, 0.25, 0]}>
          <boxGeometry args={[0.08, 0.5, 0.7]} />
          <meshStandardMaterial color="#4a3620" />
        </mesh>
      ))}
      {crates.map((c, i) => (
        <mesh key={i} position={[c.x, 0.62, 0]} castShadow>
          <boxGeometry args={[0.32, 0.18, 0.5]} />
          <meshStandardMaterial color={c.c} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// The NEPA transformer — the junction landmark (PRD §8). A grey metal tank on a
// concrete plinth with bushings + a hazard stripe, the thing the whole game is
// named after.
function Transformer({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      {/* concrete plinth */}
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.6, 1.3]} />
        <meshStandardMaterial color="#8a857c" roughness={1} />
      </mesh>
      {/* main tank */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[1.1, 1.3, 0.95]} />
        <meshStandardMaterial color="#6b7066" roughness={0.6} metalness={0.5} />
      </mesh>
      {/* cooling fins (sides) */}
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 1.25, 0]} castShadow>
          <boxGeometry args={[0.12, 1.1, 0.8]} />
          <meshStandardMaterial color="#565b52" roughness={0.6} metalness={0.5} />
        </mesh>
      ))}
      {/* hazard stripe */}
      <mesh position={[0, 0.72, 0.49]}>
        <planeGeometry args={[1.1, 0.16]} />
        <meshStandardMaterial color="#e6b400" emissive="#5a4600" emissiveIntensity={0.3} />
      </mesh>
      {/* bushings on top */}
      {[-0.3, 0, 0.3].map((x) => (
        <group key={x} position={[x, 1.95, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.07, 0.1, 0.35, 10]} />
            <meshStandardMaterial color="#b0603a" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.24, 0]}>
            <sphereGeometry args={[0.07, 10, 8]} />
            <meshStandardMaterial color="#8a4a2a" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// A bus-stop shelter — a simple roof on posts with a bench.
function Shelter({ pos, rot = 0 }: { pos: [number, number, number]; rot?: number }) {
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      {[-1.4, 1.4].map((x) => (
        <mesh key={x} position={[x, 1.1, -0.4]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 2.2, 8]} />
          <meshStandardMaterial color="#3a3a3e" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 2.25, -0.2]} rotation={[0.12, 0, 0]} castShadow>
        <boxGeometry args={[3.4, 0.08, 1.4]} />
        <meshStandardMaterial color="#1c5fa8" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.45, -0.5]} castShadow>
        <boxGeometry args={[3.0, 0.1, 0.4]} />
        <meshStandardMaterial color="#6b4e2e" roughness={1} />
      </mesh>
    </group>
  );
}

// Mile 2 motor park — the signature of the area: danfos lined up loading, a
// shelter, at the far end of the main road under the MILE 2 gantry.
function MotorPark() {
  const danfos: { pos: [number, number, number]; rot: number; v: number }[] = [
    { pos: [3.2, 0, -50], rot: 0, v: 0 },
    { pos: [3.2, 0, -55.5], rot: 0, v: 1 },
    { pos: [-3.2, 0, -52], rot: Math.PI, v: 1 },
    { pos: [-3.2, 0, -57.5], rot: Math.PI, v: 0 },
  ];
  return (
    <group>
      {danfos.map((d, i) => (
        <Danfo key={i} position={d.pos} rotation={d.rot} variant={d.v} />
      ))}
      <Shelter pos={[6.3, 0.16, -53]} rot={-Math.PI / 2} />
    </group>
  );
}

function Market() {
  const cols = ["#e74c3c", "#2980b9", "#27ae60", "#f39c12", "#8e44ad"];
  // line the far end of the side street, both kerbs
  const items: { x: number; z: number }[] = [];
  for (let i = 0; i < 4; i++) items.push({ x: 33 + i * 3.4, z: 6.0 });
  for (let i = 0; i < 4; i++) items.push({ x: 34 + i * 3.4, z: -6.0 });
  return (
    <group>
      {items.map((it, i) => (
        <group key={i}>
          <Umbrella pos={[it.x, 0.16, it.z]} color={cols[i % cols.length]} />
          <Stall pos={[it.x, 0.16, it.z + (it.z > 0 ? -0.9 : 0.9)]} />
        </group>
      ))}
    </group>
  );
}

export default function SideStreet() {
  const matRoad = useMemo(() => flat(WORLD.road, { roughness: 0.95 }), []);
  const matWalk = useMemo(() => flat(WORLD.sidewalk, { roughness: 1 }), []);
  const matLine = useMemo(() => flat(WORLD.roadLine, { roughness: 0.6, emissive: "#3a3410", emissiveIntensity: 0.2 }), []);
  const matKerb = useMemo(() => [flat(WORLD.kerb[0], { roughness: 0.9 }), flat(WORLD.kerb[1], { roughness: 0.9 })], []);

  const len = SIDE.LEN - SIDE.START;
  const midX = (SIDE.START + SIDE.LEN) / 2;

  // Lane dashes along X.
  const dashes = useMemo(() => {
    const arr: number[] = [];
    const n = Math.floor(len / 5);
    const gap = len / n;
    for (let i = 0; i < n; i++) arr.push(SIDE.START + gap / 2 + i * gap);
    return arr;
  }, [len]);

  // Buildings lining each side of the road (facing the road).
  const buildings = useMemo(() => {
    const out: { x: number; z: number; w: number; h: number; d: number; rotY: number; wi: number; awn: number; dish: boolean }[] = [];
    let seed = 71;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let side = -1; side <= 1; side += 2) {
      const z = side * (SIDE.BUILDING_Z + 2.5); // behind the sidewalk
      const rotY = side < 0 ? 0 : Math.PI; // face +Z / -Z toward the road
      let x = SIDE.START + 4;
      let n = 0;
      while (x < SIDE.LEN - 2) {
        const w = 7 + rnd() * 6;
        const h = 8 + rnd() * 10;
        const d = 5.5 + rnd() * 3;
        x += w / 2;
        out.push({ x, z, w, h, d, rotY, wi: Math.floor(rnd() * 8), awn: n % 3, dish: n % 3 === 0 });
        x += w / 2 + 0.5;
        n++;
      }
    }
    return out;
  }, []);

  return (
    <group>
      {/* Road tarmac along X. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[midX, 0.0, 0]} receiveShadow>
        <planeGeometry args={[len, ROAD_W]} />
        <primitive object={matRoad} attach="material" />
      </mesh>

      {/* Centre dashes. */}
      {dashes.map((x, i) => (
        <mesh key={i} position={[x, 0.03, 0]}>
          <boxGeometry args={[2.2, 0.01, 0.18]} />
          <primitive object={matLine} attach="material" />
        </mesh>
      ))}

      {/* Sidewalks each side (run along X). */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[midX, 0.08, s * (ROAD_W / 2 + SW / 2)]} receiveShadow castShadow>
          <boxGeometry args={[len, 0.16, SW]} />
          <primitive object={matWalk} attach="material" />
        </mesh>
      ))}

      {/* Green/white kerb along both cross streets (east: Ajegunle, west: Oshodi). */}
      {[[SIDE.START + SW, SIDE.LEN], [-41, -(SIDE.START + SW)]].flatMap(([x0, x1], k) =>
        [-1, 1].flatMap((sd) =>
          Array.from({ length: Math.floor((x1 - x0) / 1.6) }, (_, i) => (
            <mesh key={`${k}_${sd}_${i}`} position={[x0 + 0.8 + i * 1.6, 0.1, sd * (ROAD_W / 2 + 0.17)]} castShadow>
              <boxGeometry args={[1.52, 0.2, 0.34]} />
              <primitive object={matKerb[i % 2]} attach="material" />
            </mesh>
          )),
        ),
      )}

      {/* District name gantries — the map reads as real Lagos areas. */}
      <AreaSign position={[9.6, 0, 0]} rotation={Math.PI / 2} sub="welcome to" text="AJEGUNLE" width={12.6} color="#15803d" />
      <AreaSign position={[0, 0, -50]} rotation={0} sub="this way" text="MILE 2" width={11} color="#1c5fa8" />
      <AreaSign position={[0, 0, 42]} rotation={0} sub="you dey" text="OJUELEGBA" width={12} color="#7a1f2b" />

      {/* Mile 2 motor park at the far end of the main road. */}
      <MotorPark />

      {/* NEPA transformer — the junction landmark. */}
      <Transformer pos={[8, 0.16, 7.2]} />

      {/* Filling station at the far end — the fuel-run destination (PRD Phase 1).
          Rotated so its fascia + pumps face back down the street (toward -X). */}
      <group position={[52, 0, 0]} rotation={[0, Math.PI, 0]}>
        <GasStation position={[0, 0, 0]} />
      </group>

      {/* A couple of parked vehicles so the side street feels used. They sit
          along the road facing down it (rotated a quarter-turn from the main
          street's orientation). */}
      <Danfo position={[18, 0, 3.1]} rotation={Math.PI / 2} variant={0} />
      <Keke position={[30, 0, -3.0]} rotation={-Math.PI / 2} />

      {/* Market / buka corner near the far end — gives the side street somewhere
          to go: colourful umbrellas, stall tables and produce crates. */}
      <Market />

      {/* ── OSHODI — the left branch, a packed market crossroad ─────────────── */}
      <group>
        {/* road (along -X) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-22.75, 0, 0]} receiveShadow>
          <planeGeometry args={[36.5, ROAD_W]} />
          <primitive object={matRoad} attach="material" />
        </mesh>
        {/* sidewalks */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[-22.75, 0.08, s * (ROAD_W / 2 + SW / 2)]} receiveShadow castShadow>
            <boxGeometry args={[36.5, 0.16, SW]} />
            <primitive object={matWalk} attach="material" />
          </mesh>
        ))}
        {/* buildings */}
        {[-12, -20, -28, -36].flatMap((x, n) =>
          [-1, 1].map((s) => (
            <group key={`${x}_${s}`} position={[x, 0, s * (SIDE.BUILDING_Z + 2.5)]} rotation={[0, s < 0 ? 0 : Math.PI, 0]}>
              <WindowBlock w={9} h={11 + (n % 3) * 2} d={6} wi={n * 2 + (s > 0 ? 1 : 0)} awn={n % 3} dish={n % 2 === 0} />
            </group>
          )),
        )}
        {/* packed market (Oshodi!) — umbrellas + stalls both kerbs, close together */}
        {[-9, -13.5, -18, -22.5, -27, -31.5, -36].flatMap((x, i) =>
          [6.0, -6.0].map((z) => (
            <group key={`${x}_${z}`}>
              <Umbrella pos={[x, 0.16, z]} color={["#e74c3c", "#2980b9", "#27ae60", "#f39c12", "#8e44ad"][(i + (z > 0 ? 0 : 3)) % 5]} />
              <Stall pos={[x, 0.16, z + (z > 0 ? -0.9 : 0.9)]} />
            </group>
          )),
        )}
        <AreaSign position={[-9.6, 0, 0]} rotation={Math.PI / 2} sub="welcome to" text="OSHODI" width={12.6} color="#b8860b" />
      </group>

      {/* Buildings. */}
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.rotY, 0]}>
          <WindowBlock w={b.w} h={b.h} d={b.d} wi={b.wi} awn={b.awn} dish={b.dish} />
        </group>
      ))}
    </group>
  );
}
