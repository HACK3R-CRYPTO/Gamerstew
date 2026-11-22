"use client";

// ─── Street furniture + NEPA-reactive lamps + emergency glows ────────────────
// Repeated props (lamp poles, lamp heads, market umbrellas, stall canopies) use
// drei <Instances> so each prop type is a single draw call. The lamp HEADS and
// the street point-lights brighten with the NEPA light level; the EMERGENCY
// glows (a generator lamp, a phone-screen glow) do the opposite — they only
// show when the block is dark (intensity ∝ 1 - lit), so during a blackout the
// street is lit by moonlight plus those two faint sources, exactly like a real
// NEPA night.

import { quality } from "./quality";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Instances, Instance, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { worldControls } from "./controls";
import { STREET } from "./Street";

const LAMP_H = 4.2;

export default function StreetProps() {
  // On phones the lamps, lanterns and phone screens still glow (emissive), but
  // they stop being real lights: every real light is paid for on every surface.
  const real = quality().propLights;
  const canopyTex = useTexture("/world/textures/canopy.jpg");
  useMemo(() => {
    canopyTex.colorSpace = THREE.SRGBColorSpace;
    canopyTex.wrapS = canopyTex.wrapT = THREE.RepeatWrapping;
    canopyTex.repeat.set(3, 1);
  }, [canopyTex]);
  const lampHeadMat = useRef<THREE.MeshStandardMaterial>(null);
  const lampLights = useRef<THREE.PointLight[]>([]);
  const genLight = useRef<THREE.PointLight>(null);
  const phoneLight = useRef<THREE.PointLight>(null);
  const phoneLight2 = useRef<THREE.PointLight>(null);
  const lanternMat = useRef<THREE.MeshStandardMaterial>(null);
  const lanternLights = useRef<THREE.PointLight[]>([]);

  // Lamp posts down both kerbs.
  const lamps = useMemo(() => {
    const out: [number, number][] = [];
    const x = STREET.ROAD_WIDTH / 2 + 0.6;
    const n = 6;
    const span = STREET.STREET_LENGTH - 20;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const z = -span / 2 + (i / (n - 1)) * span;
        out.push([side * x, z]);
      }
    }
    return out;
  }, []);

  // A cluster of market umbrellas + stalls on one sidewalk pocket.
  const market = useMemo(() => {
    const umbrellas: [number, number][] = [];
    const stalls: [number, number][] = [];
    const baseX = -(STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH - 0.6);
    for (let i = 0; i < 10; i++) {
      const z = -14 + i * 3.1;
      umbrellas.push([baseX + (i % 2 === 0 ? 0 : -0.8), z]);
      if (i % 2 === 0) stalls.push([baseX - 0.2, z]);
    }
    return { umbrellas, stalls };
  }, []);

  // A couple of lanterns glowing in doorways/windows during a blackout.
  const lanterns = useMemo<[number, number, number][]>(
    () => [
      [STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH - 0.3, 2.4, -14],
      [-(STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH - 0.3), 3.1, 20],
    ],
    [],
  );

  lampLights.current = [];
  lanternLights.current = [];

  useFrame(() => {
    const lit = worldControls.lit;
    const dark = 1 - lit;
    const surge = worldControls.surge;
    const now = performance.now();
    if (lampHeadMat.current) lampHeadMat.current.emissiveIntensity = 0.1 + lit * 2.2 + surge * 2.5;
    for (const l of lampLights.current) if (l) l.intensity = lit * 6 + surge * 4;
    // Emergency sources only matter in the dark, and flicker a touch.
    if (genLight.current) genLight.current.intensity = dark * (5 + Math.sin(now * 0.02) * 0.6);
    if (phoneLight.current) phoneLight.current.intensity = dark * 2.4;
    if (phoneLight2.current) phoneLight2.current.intensity = dark * (1.8 + Math.sin(now * 0.004) * 0.5);
    // Warm lanterns: a soft candle-like flicker, only while the block is dark.
    const lanternGlow = dark * (1 + Math.sin(now * 0.009) * 0.18);
    if (lanternMat.current) lanternMat.current.emissiveIntensity = 0.3 + dark * 2.4;
    for (const l of lanternLights.current) if (l) l.intensity = lanternGlow * 3.2;
  });

  return (
    <group>
      {/* Lamp poles (instanced) */}
      <Instances limit={lamps.length} castShadow>
        <cylinderGeometry args={[0.08, 0.1, LAMP_H, 8]} />
        <meshStandardMaterial color="#3b3b42" roughness={0.7} metalness={0.3} />
        {lamps.map(([x, z], i) => (
          <Instance key={i} position={[x, LAMP_H / 2, z]} />
        ))}
      </Instances>

      {/* Lamp heads (instanced, emissive — react to NEPA) */}
      <Instances limit={lamps.length}>
        <boxGeometry args={[0.5, 0.25, 0.5]} />
        <meshStandardMaterial ref={lampHeadMat} color="#2a2a2a" emissive="#ffd27a" emissiveIntensity={2.2} />
        {lamps.map(([x, z], i) => (
          <Instance key={i} position={[x - Math.sign(x) * 0.35, LAMP_H, z]} />
        ))}
      </Instances>

      {/* A few real point-lights at lamp positions (no shadow — cheap). */}
      {real && lamps
        .filter((_, i) => i % 2 === 0)
        .map(([x, z], i) => (
          <pointLight
            key={i}
            ref={(l) => {
              if (l) lampLights.current.push(l);
            }}
            position={[x - Math.sign(x) * 0.35, LAMP_H - 0.2, z]}
            color="#ffcf87"
            intensity={6}
            distance={12}
            decay={2}
          />
        ))}

      {/* Market umbrellas (instanced cone canopy + instanced pole) */}
      <Instances limit={market.umbrellas.length} castShadow>
        <coneGeometry args={[1.6, 1.0, 10]} />
        <meshStandardMaterial map={canopyTex} color="#ffffff" roughness={0.9} side={THREE.DoubleSide} />
        {market.umbrellas.map(([x, z], i) => (
          <Instance key={i} position={[x, 2.1, z]} />
        ))}
      </Instances>
      <Instances limit={market.umbrellas.length}>
        <cylinderGeometry args={[0.04, 0.04, 2.1, 6]} />
        <meshStandardMaterial color="#6b6b6b" />
        {market.umbrellas.map(([x, z], i) => (
          <Instance key={i} position={[x, 1.05, z]} />
        ))}
      </Instances>

      {/* Market stall tables (instanced) */}
      <Instances limit={market.stalls.length} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.8, 1.0]} />
        <meshStandardMaterial color="#8a5a34" roughness={0.95} />
        {market.stalls.map(([x, z], i) => (
          <Instance key={i} position={[x, 0.5, z]} />
        ))}
      </Instances>

      {/* Rooftop-style water tank near one building edge */}
      <group position={[STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH - 0.8, 0, 16]}>
        {[
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
        ].map(([dx, dz], i) => (
          <mesh key={i} position={[dx, 0.75, dz]} castShadow>
            <boxGeometry args={[0.12, 1.5, 0.12]} />
            <meshStandardMaterial color="#4a4a4a" />
          </mesh>
        ))}
        <mesh position={[0, 1.9, 0]} castShadow>
          <cylinderGeometry args={[0.9, 0.9, 1.3, 16]} />
          <meshStandardMaterial color="#1f6f8b" roughness={0.6} />
        </mesh>
      </group>

      {/* Emergency generator (box) + warm glow that only shows in a blackout */}
      <group position={[-(STREET.ROAD_WIDTH / 2 + STREET.SIDEWALK_WIDTH - 1.2), 0, 10]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <boxGeometry args={[1.2, 1.0, 0.8]} />
          <meshStandardMaterial color="#d9a441" roughness={0.6} metalness={0.3} />
        </mesh>
        <pointLight ref={genLight} position={[0, 1.2, 0.6]} color="#ffb347" intensity={0} distance={9} decay={2} />
      </group>
      {/* Faint phone-screen glows — cold blue points that only show in the dark */}
      {real && <pointLight
        ref={phoneLight}
        position={[-(STREET.ROAD_WIDTH / 2 + 1.5), 1.4, -2]}
        color="#9fd0ff"
        intensity={0}
        distance={4}
        decay={2}
      />}
      {real && <pointLight
        ref={phoneLight2}
        position={[STREET.ROAD_WIDTH / 2 + 1.2, 1.3, 7]}
        color="#bfe0ff"
        intensity={0}
        distance={3.5}
        decay={2}
      />}

      {/* Window/doorway lanterns — warm emissive cubes + point lights that glow
          only during a blackout (the classic NEPA-night lantern). */}
      <Instances limit={lanterns.length}>
        <boxGeometry args={[0.28, 0.4, 0.28]} />
        <meshStandardMaterial ref={lanternMat} color="#3a2a12" emissive="#ffb347" emissiveIntensity={0.3} />
        {lanterns.map((p, i) => (
          <Instance key={i} position={p} />
        ))}
      </Instances>
      {real && lanterns.map((p, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            if (l) lanternLights.current.push(l);
          }}
          position={p}
          color="#ffbe6b"
          intensity={0}
          distance={5}
          decay={2}
        />
      ))}
    </group>
  );
}
