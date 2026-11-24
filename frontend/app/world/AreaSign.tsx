"use client";

// ─── AreaSign — a Lagos neighbourhood gantry ("WELCOME TO AJEGUNLE") ──────────
// Names a district: a wide board on two posts spanning the road, wearing a
// canvas-drawn area name in the painted green/yellow Lagos style. Reusable —
// pass the area text + where it stands. This is how the map reads as real places
// (Ajegunle, Mile 2, Oshodi, …) rather than one anonymous street.

import { useMemo } from "react";
import * as THREE from "three";

export default function AreaSign({
  position = [0, 0, 0] as [number, number, number],
  rotation = 0,
  text = "AJEGUNLE",
  sub = "WELCOME TO",
  width = 11,
  color = "#0f7a3a",
}: {
  position?: [number, number, number];
  rotation?: number;
  text?: string;
  sub?: string;
  width?: number;
  color?: string;
}) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    // border
    g.strokeStyle = "#f4d03f";
    g.lineWidth = 14;
    g.strokeRect(10, 10, c.width - 20, c.height - 20);
    g.textAlign = "center";
    g.textBaseline = "middle";
    // sub line
    g.fillStyle = "#f4d03f";
    g.font = "700 46px system-ui, sans-serif";
    g.fillText(sub.toUpperCase(), c.width / 2, 58);
    // main name
    g.fillStyle = "#ffffff";
    g.font = "900 128px system-ui, sans-serif";
    g.fillText(text.toUpperCase(), c.width / 2, 158);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [text, sub, color]);

  const postMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a3a3e", roughness: 0.7, metalness: 0.4 }), []);
  const boardH = 1.6;
  const boardY = 5.2;

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* posts */}
      {[-width / 2 + 0.3, width / 2 - 0.3].map((x) => (
        <mesh key={x} position={[x, boardY / 2 + 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.16, boardY + 1.2, 10]} />
          <primitive object={postMat} attach="material" />
        </mesh>
      ))}
      {/* board */}
      <mesh position={[0, boardY + 0.6, 0]} castShadow>
        <boxGeometry args={[width, boardH, 0.18]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* printed name (both faces) */}
      {[0.1, -0.1].map((zo, i) => (
        <mesh key={i} position={[0, boardY + 0.6, zo]} rotation={[0, i ? Math.PI : 0, 0]}>
          <planeGeometry args={[width - 0.3, boardH - 0.2]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
