"use client";

// ─── OJU OIL petrol station — the iconic Lagos filling station ────────────────
// A canopy on pillars with the OJU OIL / PMS price fascia, two fuel pumps and a
// little kiosk, set back on the left kerb in a gap between the buildings. On
// theme for a NEPA game (everyone's buying petrol for the gen during a blackout).
// Fascia sign: Stable Studio (flat illustration).

import { useMemo } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

export default function GasStation({ position = [-12, 0, -40] as [number, number, number] }) {
  const sign = useTexture("/world/textures/ojuoil.jpg");
  useMemo(() => {
    sign.colorSpace = THREE.SRGBColorSpace;
    sign.anisotropy = 8;
  }, [sign]);

  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: "#e9e6dc", roughness: 0.7 }), []);
  const green = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0f7a3a", roughness: 0.6 }), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2a2a2e", roughness: 0.7, metalness: 0.3 }), []);
  const PAD_W = 9;
  const PAD_D = 11;

  const pump = (x: number, z: number) => (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.78, 0]} castShadow>
        <boxGeometry args={[0.7, 1.5, 0.55]} />
        <primitive object={white} attach="material" />
      </mesh>
      {/* display */}
      <mesh position={[0.36, 1.1, 0]}>
        <boxGeometry args={[0.04, 0.4, 0.4]} />
        <meshStandardMaterial color="#0a1a0a" emissive="#35e06a" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {/* nozzle holster + hose */}
      <mesh position={[-0.3, 1.0, 0.2]}>
        <boxGeometry args={[0.12, 0.3, 0.12]} />
        <primitive object={dark} attach="material" />
      </mesh>
      <mesh position={[0, 1.55, 0]}>
        <boxGeometry args={[0.75, 0.12, 0.6]} />
        <primitive object={green} attach="material" />
      </mesh>
    </group>
  );

  return (
    <group position={position}>
      {/* forecourt pad */}
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[PAD_W, 0.12, PAD_D]} />
        <meshStandardMaterial color="#6f6f72" roughness={0.95} />
      </mesh>
      {/* canopy pillars */}
      {[[-PAD_W / 2 + 0.8, -PAD_D / 2 + 1.2], [PAD_W / 2 - 0.8, -PAD_D / 2 + 1.2], [-PAD_W / 2 + 0.8, PAD_D / 2 - 1.2], [PAD_W / 2 - 0.8, PAD_D / 2 - 1.2]].map(
        ([px, pz], i) => (
          <mesh key={i} position={[px, 2.2, pz]} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 4.4, 10]} />
            <primitive object={white} attach="material" />
          </mesh>
        ),
      )}
      {/* canopy roof */}
      <mesh position={[0, 4.5, 0]} castShadow>
        <boxGeometry args={[PAD_W + 0.6, 0.5, PAD_D - 1]} />
        <primitive object={white} attach="material" />
      </mesh>
      {/* green fascia band facing the road (+x) with the OJU OIL sign */}
      <mesh position={[PAD_W / 2 + 0.32, 4.2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[PAD_D - 1, 1.0, 0.12]} />
        <primitive object={green} attach="material" />
      </mesh>
      <mesh position={[PAD_W / 2 + 0.4, 4.2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[PAD_D - 1.4, 0.9]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
      {/* pumps (toward the road) */}
      {pump(PAD_W / 2 - 1.6, -2)}
      {pump(PAD_W / 2 - 1.6, 2)}
      {/* kiosk at the back */}
      <mesh position={[-PAD_W / 2 + 1.2, 1.2, 0]} castShadow>
        <boxGeometry args={[2.2, 2.4, 4]} />
        <primitive object={white} attach="material" />
      </mesh>
      <mesh position={[-PAD_W / 2 + 2.35, 1.4, 0]}>
        <boxGeometry args={[0.06, 1.0, 3]} />
        <meshStandardMaterial color="#123a1f" emissive="#1f7a3a" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}
