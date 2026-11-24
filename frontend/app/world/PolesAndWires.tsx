"use client";

// ─── Electric poles + the Lagos overhead cable spaghetti ─────────────────────
// Poles down BOTH kerbs, each with a crossarm carrying several sagging lines that
// run along the street, PLUS cross-street wires strung between opposite poles and
// a few random droops — the tangle of cables over every Lagos street. All wires
// bake into one LineSegments (a single draw call). Purely decorative.

import { useMemo } from "react";
import * as THREE from "three";
import { STREET } from "./Street";

const POLE_H = 6.4;
const CROSSARM_Y = 5.5;

export default function PolesAndWires() {
  const { poles, wireGeo } = useMemo(() => {
    const x = STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH - 0.4;
    const n = 7;
    const span = STREET.STREET_LENGTH - 16;
    const zs: number[] = [];
    for (let i = 0; i < n; i++) {
      const z = -span / 2 + (i / (n - 1)) * span;
      zs.push(Math.abs(z) < 6.4 ? 6.4 : z); // keep the crossroads mouth clear
    }

    const positions: number[] = [];
    const addWire = (a: THREE.Vector3, b: THREE.Vector3, sag: number, segs = 10) => {
      let prev: THREE.Vector3 | null = null;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const p = new THREE.Vector3().lerpVectors(a, b, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        if (prev) positions.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    };

    const armOffsets = [-0.95, -0.45, 0, 0.45, 0.95];
    const polesOut: [number, number][] = [];
    for (const side of [-1, 1]) {
      const px = side * x;
      zs.forEach((z) => polesOut.push([px, z]));
      // lines running ALONG the street on this kerb
      for (let i = 0; i < zs.length - 1; i++) {
        for (const off of armOffsets) {
          addWire(new THREE.Vector3(px + off, CROSSARM_Y, zs[i]), new THREE.Vector3(px + off, CROSSARM_Y, zs[i + 1]), 0.7);
        }
      }
    }
    // cross-street wires between opposite poles (every other one) + a service drop
    for (let i = 0; i < zs.length; i += 2) {
      addWire(new THREE.Vector3(-x, CROSSARM_Y, zs[i]), new THREE.Vector3(x, CROSSARM_Y - 0.3, zs[i]), 1.1, 14);
    }
    // a couple of stray diagonal droops for the tangle
    for (let i = 1; i < zs.length - 1; i += 2) {
      addWire(new THREE.Vector3(x - 0.9, CROSSARM_Y, zs[i]), new THREE.Vector3(x + 0.9, CROSSARM_Y - 0.6, zs[i + 1]), 0.5, 10);
      addWire(new THREE.Vector3(-x + 0.9, CROSSARM_Y, zs[i]), new THREE.Vector3(-x - 0.6, CROSSARM_Y - 1.4, zs[i]), 0.3, 6);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return { poles: polesOut, wireGeo: geo };
  }, []);

  return (
    <group>
      {poles.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, POLE_H / 2, 0]}>
            <cylinderGeometry args={[0.1, 0.14, POLE_H, 7]} />
            <meshStandardMaterial color="#5a4631" roughness={0.95} />
          </mesh>
          <mesh position={[0, CROSSARM_Y, 0]}>
            <boxGeometry args={[0.12, 0.12, 2.4]} />
            <meshStandardMaterial color="#4a3a28" roughness={0.95} />
          </mesh>
          <mesh position={[0, CROSSARM_Y + 0.35, 0]}>
            <boxGeometry args={[0.1, 0.1, 1.6]} />
            <meshStandardMaterial color="#4a3a28" roughness={0.95} />
          </mesh>
          {/* ceramic insulators */}
          {[-0.95, -0.45, 0.45, 0.95].map((o) => (
            <mesh key={o} position={[0, CROSSARM_Y + 0.12, o]}>
              <cylinderGeometry args={[0.05, 0.06, 0.14, 6]} />
              <meshStandardMaterial color="#b7ab92" roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}
      <lineSegments geometry={wireGeo}>
        <lineBasicMaterial color="#14100b" />
      </lineSegments>
    </group>
  );
}
