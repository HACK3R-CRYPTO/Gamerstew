"use client";

// ─── Billboard — a big lit Lagos advertising hoarding over the street ────────
// A classic Lagos street billboard on a steel gantry, wearing an AI-generated
// Lagos advert. Glows at night so it reads as a backlit hoarding during the
// blackout. Texture: Stable Studio.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { worldControls } from "./controls";

export default function Billboard({
  position = [6.5, 7, -34] as [number, number, number],
  rotation = -0.5,
}) {
  const tex = useTexture("/world/textures/billboard.jpg");
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
  }, [tex]);
  useFrame(() => {
    // backlit at night, plain by day
    if (mat.current) mat.current.emissiveIntensity = 0.15 + (1 - worldControls.lit) * 0.9;
  });
  const W = 8;
  const H = 4.2;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* dark backing frame */}
      <mesh position={[0, 0, -0.08]}>
        <boxGeometry args={[W + 0.4, H + 0.4, 0.2]} />
        <meshStandardMaterial color="#1c1c20" roughness={0.8} metalness={0.4} />
      </mesh>
      {/* advert panel (glows at night) */}
      <mesh>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial ref={mat} map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.2} roughness={0.85} toneMapped={false} />
      </mesh>
      {/* support legs down to the ground */}
      {[-W / 3, W / 3].map((x) => (
        <mesh key={x} position={[x, -H / 2 - position[1] / 2, 0.1]}>
          <boxGeometry args={[0.3, position[1], 0.3]} />
          <meshStandardMaterial color="#26262b" roughness={0.9} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}
