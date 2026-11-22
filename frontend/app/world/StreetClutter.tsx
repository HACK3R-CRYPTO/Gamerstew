"use client";

// ─── Street-level Lagos clutter — jerry cans, sacks, goods, suya grill ───────
// Small props dotted along the kerbs that sell the "lived-in Lagos street" feel:
// jerry cans of fuel (very on-theme for a blackout), stacked sacks + crates, a
// wheelbarrow, a tyre stack, and a glowing suya grill with smoke. Flat low-poly.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

function JerryCan({ x, z, c = "#e0a21c", r = 0 }: { x: number; z: number; c?: string; r?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, r, 0]}>
      <mesh position={[0, 0.26, 0]} castShadow>
        <boxGeometry args={[0.32, 0.5, 0.22]} />
        <meshStandardMaterial color={c} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.54, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.08, 8]} />
        <meshStandardMaterial color="#1c1c1e" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.46, -0.12]}>
        <boxGeometry args={[0.18, 0.04, 0.04]} />
        <meshStandardMaterial color="#1c1c1e" roughness={0.7} />
      </mesh>
    </group>
  );
}

function Sacks({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[[-0.2, 0.2, 0], [0.22, 0.22, 0.1], [0.0, 0.58, 0.05]].map(([dx, dy, dz], i) => (
        <mesh key={i} position={[dx, dy, dz]} rotation={[0, i * 0.4, 0]} castShadow>
          <boxGeometry args={[0.44, 0.38, 0.34]} />
          <meshStandardMaterial color={i % 2 ? "#cdbf93" : "#e3d7ad"} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function Crates({ x, z }: { x: number; z: number }) {
  const cols = ["#9a3b2e", "#2e6b9a", "#2e9a4b", "#c9a21c"];
  return (
    <group position={[x, 0, z]}>
      {[[-0.25, 0.2, 0], [0.25, 0.2, 0], [0, 0.56, 0]].map(([dx, dy, dz], i) => (
        <mesh key={i} position={[dx, dy, dz]} castShadow>
          <boxGeometry args={[0.42, 0.36, 0.42]} />
          <meshStandardMaterial color={cols[i % cols.length]} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function Wheelbarrow({ x, z, r = 0 }: { x: number; z: number; r?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, r, 0]}>
      <mesh position={[0, 0.5, 0]} rotation={[0.15, 0, 0]} castShadow>
        <boxGeometry args={[0.7, 0.3, 1.0]} />
        <meshStandardMaterial color="#5a6a52" roughness={0.7} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.2, 0.7]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.1, 14]} />
        <meshStandardMaterial color="#1c1c1e" roughness={0.9} />
      </mesh>
      {[-0.28, 0.28].map((hx) => (
        <mesh key={hx} position={[hx, 0.5, -0.7]} rotation={[0.15, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1.1, 6]} />
          <meshStandardMaterial color="#3a2a18" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function TyreStack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[0.16, 0.42, 0.68].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, i]} castShadow>
          <torusGeometry args={[0.32, 0.13, 8, 16]} />
          <meshStandardMaterial color="#141416" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function SuyaGrill({ x, z, r = 0 }: { x: number; z: number; r?: number }) {
  const smoke = useRef<THREE.Mesh>(null);
  const smokeMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const t = (performance.now() * 0.0004) % 1;
    if (smoke.current) {
      smoke.current.position.y = 1.0 + t * 1.3;
      smoke.current.scale.setScalar(0.1 + t * 0.4);
    }
    if (smokeMat.current) smokeMat.current.opacity = 0.3 * (1 - t);
  });
  return (
    <group position={[x, 0, z]} rotation={[0, r, 0]}>
      {/* legs + grill tray */}
      {[[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.4, lz]}>
          <boxGeometry args={[0.06, 0.8, 0.06]} />
          <meshStandardMaterial color="#2a2a2e" metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 0.82, 0]} castShadow>
        <boxGeometry args={[1.0, 0.14, 0.6]} />
        <meshStandardMaterial color="#1a1a1e" roughness={0.8} metalness={0.3} />
      </mesh>
      {/* glowing coals */}
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[0.9, 0.05, 0.5]} />
        <meshStandardMaterial color="#ff5a1a" emissive="#ff3a00" emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      {/* skewers */}
      {[-0.3, -0.1, 0.1, 0.3].map((sx) => (
        <mesh key={sx} position={[sx, 0.95, 0]} rotation={[0, 0, 0]}>
          <boxGeometry args={[0.03, 0.03, 0.5]} />
          <meshStandardMaterial color="#6b3a1a" roughness={0.8} />
        </mesh>
      ))}
      {/* smoke puff */}
      <mesh ref={smoke} position={[0, 1.0, 0]}>
        <sphereGeometry args={[1, 7, 7]} />
        <meshBasicMaterial ref={smokeMat} color="#8a8a8a" transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

export default function StreetClutter() {
  return (
    <>
      <JerryCan x={-6.2} z={-36} c="#e0a21c" />
      <JerryCan x={-5.9} z={-36.4} c="#d23a2f" r={0.5} />
      <JerryCan x={5.9} z={7.6} c="#e0a21c" r={0.3} />
      <JerryCan x={6.1} z={8} c="#2e6b9a" />
      <JerryCan x={6.0} z={21} c="#d23a2f" />
      <Sacks x={-6.1} z={14} />
      <Sacks x={6.0} z={-14} />
      <Crates x={6.2} z={36} />
      <Crates x={-6.0} z={-8} />
      <Wheelbarrow x={5.8} z={-20} r={0.6} />
      <TyreStack x={-6.2} z={24} />
      <TyreStack x={6.2} z={-45} />
      <SuyaGrill x={-5.7} z={6} r={0.3} />
      <SuyaGrill x={6.0} z={44} r={-0.4} />
    </>
  );
}
