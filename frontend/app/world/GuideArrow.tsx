"use client";

// ─── GuideArrow — points you at your next target so you never wander ─────────
// A bright chevron that floats above the player and swings in the XZ plane to
// point at worldControls.guide (the nearest unlit breaker / ready device, set by
// the active mode's director). Hidden when there's nothing to point at or you're
// already on top of it. Bobs + pulses for visibility.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { worldControls } from "./controls";

export default function GuideArrow() {
  const grp = useRef<THREE.Group>(null);
  const spin = useRef(0);

  useFrame((_, rawDt) => {
    const g = grp.current;
    if (!g) return;
    if (!worldControls.guide.active) {
      g.visible = false;
      return;
    }
    const p = worldControls.playerPos;
    const dx = worldControls.guide.x - p.x;
    const dz = worldControls.guide.z - p.z;
    g.visible = true;
    const t = performance.now() * 0.004;
    g.position.set(p.x, 2.5 + Math.sin(t) * 0.12, p.z);
    g.rotation.y = Math.atan2(dx, dz); // aim local +Z at the target
    const s = 1 + Math.sin(t * 2) * 0.12;
    g.scale.setScalar(s);
    spin.current += rawDt;
  });

  return (
    <group ref={grp} visible={false}>
      {/* chevron: a flat 4-sided cone laid on its side, pointing local +Z */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.5]}>
        <coneGeometry args={[0.26, 0.5, 4]} />
        <meshBasicMaterial color="#ffe14d" toneMapped={false} transparent opacity={0.92} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[0.12, 0.08, 0.5]} />
        <meshBasicMaterial color="#ffe14d" toneMapped={false} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}
