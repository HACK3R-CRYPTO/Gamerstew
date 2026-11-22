"use client";

// ─── Hand-painted Naija signboards ───────────────────────────────────────────
// Roadside shop signs — bold uppercase pidgin/English on loud colour blocks,
// painted to a CanvasTexture and mounted on simple posts facing the street. One
// of the cheapest, strongest "this na Lagos" signals. No real brands. A couple
// are on-theme for a power game ("WE CHARGE FONE", "GENERATOR REPAIR").

import { useMemo } from "react";
import * as THREE from "three";

interface Sign {
  x: number;
  z: number;
  rot: number;
  text: string;
  bg: string;
  fg: string;
}

const SIGNS: Sign[] = [
  { x: -6.8, z: -6, rot: Math.PI / 2, text: "COLD MINERALS\n& PURE WATER", bg: "#1f8a4c", fg: "#ffffff" },
  { x: 6.9, z: 10, rot: -Math.PI / 2, text: "MAMA PUT\nRICE • BEANS • EBA", bg: "#c0392b", fg: "#ffe14d" },
  { x: -6.9, z: 18, rot: Math.PI / 2, text: "WE CHARGE FONE\n& POWERBANK", bg: "#ffcf33", fg: "#111111" },
  { x: 6.8, z: -22, rot: -Math.PI / 2, text: "OK BARBING\nSALON", bg: "#2a66c4", fg: "#ffffff" },
  { x: -6.7, z: 34, rot: Math.PI / 2, text: "GOD'S TIME\nNA THE BEST", bg: "#111111", fg: "#ffcf33" },
  { x: 6.9, z: 30, rot: -Math.PI / 2, text: "GENERATOR\nREPAIR — WE DEY", bg: "#e67e22", fg: "#111111" },
  { x: -6.8, z: -32, rot: Math.PI / 2, text: "NO URINATING\nHERE — ₦500", bg: "#ffffff", fg: "#c0392b" },
  { x: 6.7, z: 44, rot: -Math.PI / 2, text: "SUYA SPOT\nHOT HOT", bg: "#8e2de2", fg: "#ffe14d" },
];

function makeSignTexture(text: string, bg: string, fg: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const w = 512;
  const h = 320;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // weathered border
  ctx.strokeStyle = fg;
  ctx.lineWidth = 14;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = text.split("\n");
  const size = lines.length > 1 ? 58 : 72;
  ctx.font = `900 ${size}px system-ui, -apple-system, sans-serif`;
  const lh = size * 1.1;
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function SignMesh({ sign }: { sign: Sign }) {
  const tex = useMemo(() => makeSignTexture(sign.text, sign.bg, sign.fg), [sign.text, sign.bg, sign.fg]);
  return (
    <group position={[sign.x, 0, sign.z]} rotation={[0, sign.rot, 0]}>
      {/* two posts */}
      {[-0.45, 0.45].map((px) => (
        <mesh key={px} position={[px, 0.7, 0]}>
          <cylinderGeometry args={[0.04, 0.045, 1.4, 6]} />
          <meshStandardMaterial color="#4a3f33" roughness={0.9} />
        </mesh>
      ))}
      {/* board */}
      <mesh position={[0, 1.35, 0]}>
        <boxGeometry args={[1.25, 0.78, 0.06]} />
        <meshStandardMaterial color={sign.bg} roughness={0.85} />
      </mesh>
      {tex && (
        <mesh position={[0, 1.35, 0.035]}>
          <planeGeometry args={[1.2, 0.74]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

export default function Signboards() {
  return (
    <>
      {SIGNS.map((s, i) => (
        <SignMesh key={i} sign={s} />
      ))}
    </>
  );
}
