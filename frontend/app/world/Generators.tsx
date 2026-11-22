"use client";

// ─── Roadside generators ("I better pass my neighbour") ──────────────────────
// Small petrol gensets outside the shops — the backbone of Nigerian power and
// bang on theme for a NEPA game. Built from primitives: red housing, black
// frame, a fuel tank, an exhaust with a rising smoke puff, and a green "running"
// LED. Each one trembles slightly like it's actually running.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

// x on the sidewalk (inside the signboards, clear of the road + devices), z, facing.
const GENS: [number, number, number][] = [
  [-6.0, -18, 0.5],
  [6.1, 8.6, -0.6],
  [-6.1, 6, 0.2],
  [6.0, 20, Math.PI],
  [-6.0, 44, -0.4],
];

function GenMesh({ x, z, rot, phase }: { x: number; z: number; rot: number; phase: number }) {
  const body = useRef<THREE.Group>(null);
  const ledMat = useRef<THREE.MeshStandardMaterial>(null);
  const smoke = useRef<THREE.Mesh>(null);
  const smokeMat = useRef<THREE.MeshBasicMaterial>(null);

  const genTex = useTexture("/world/textures/generator.jpg");
  const housingMats = useMemo(() => {
    genTex.colorSpace = THREE.SRGBColorSpace;
    const skin = new THREE.MeshStandardMaterial({ map: genTex, roughness: 0.6, metalness: 0.25 });
    const red = new THREE.MeshStandardMaterial({ color: "#b5281f", roughness: 0.6, metalness: 0.2 });
    // front (+z) wears the panel; other faces stay red metal
    return [red, red, red, red, skin, red];
  }, [genTex]);

  useFrame(() => {
    const t = performance.now() * 0.001 + phase;
    if (body.current) body.current.position.y = Math.sin(t * 34) * 0.004; // idle tremble
    if (ledMat.current) ledMat.current.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 6);
    // smoke puff rises + fades on a loop
    if (smoke.current && smokeMat.current) {
      const f = (t * 0.6) % 1; // 0..1
      smoke.current.position.y = 0.62 + f * 0.6;
      const s = 0.06 + f * 0.16;
      smoke.current.scale.setScalar(s);
      smokeMat.current.opacity = 0.35 * (1 - f);
    }
  });

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <group ref={body}>
        {/* black frame base */}
        <mesh position={[0, 0.08, 0]} receiveShadow>
          <boxGeometry args={[0.56, 0.1, 0.42]} />
          <meshStandardMaterial color="#1b1b1e" roughness={0.9} />
        </mesh>
        {/* red housing (front panel wears the real generator texture) */}
        <mesh position={[0, 0.3, 0]} material={housingMats}>
          <boxGeometry args={[0.5, 0.3, 0.36]} />
        </mesh>
        {/* fuel tank on top */}
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[0.44, 0.12, 0.3]} />
          <meshStandardMaterial color="#d23a2f" roughness={0.5} />
        </mesh>
        {/* exhaust pipe */}
        <mesh position={[0.2, 0.46, -0.16]} rotation={[0.3, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.035, 0.22, 8]} />
          <meshStandardMaterial color="#444" metalness={0.6} roughness={0.5} />
        </mesh>
        {/* running LED */}
        <mesh position={[-0.18, 0.34, 0.185]}>
          <boxGeometry args={[0.04, 0.03, 0.01]} />
          <meshStandardMaterial ref={ledMat} color="#4bed6a" emissive="#4bed6a" emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
        {/* pull-start handle */}
        <mesh position={[-0.27, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, 0.14, 6]} />
          <meshStandardMaterial color="#222" roughness={0.8} />
        </mesh>
      </group>
      {/* smoke puff */}
      <mesh ref={smoke} position={[0.2, 0.62, -0.2]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial ref={smokeMat} color="#6b6b6b" transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

export default function Generators() {
  return (
    <>
      {GENS.map(([x, z, rot], i) => (
        <GenMesh key={i} x={x} z={z} rot={rot} phase={i * 1.7} />
      ))}
    </>
  );
}
