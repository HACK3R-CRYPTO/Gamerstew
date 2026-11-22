"use client";

// ─── LowPolyCar — the world's vehicles ───────────────────────────────────────
// Clean low-poly cars built from the CC0 Kenney Car Kit (van, taxi, sedan, SUV,
// hatchback: ~2,000 triangles each, wheels as separate named nodes). At load
// each model's palette texture is baked into VERTEX COLOURS and the texture is
// dropped, so every car is pure flat colour in the world palette and ALL cars
// share one material. While baking, the model's own paint is swapped for the
// colour we ask for, glass goes dark, and lights / trim keep their role.
//
// Space: metres, origin on the ground under the car's centre, FRONT = +Z.
// Wheels are separate meshes and spin from the `speed` you pass (m/s).
//
// <DanfoBus> dresses the van as a Lagos danfo: yellow with the black stripes,
// a loaded roof rack, a lit destination board, plates and lamps.
// <TaxiCar> is the yellow Lagos cab. <KitCar> is everything else.

import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { GA, flat } from "./theme";
import { worldControls } from "./controls";
import { conductorCall } from "./audio";
import SeatedPlayer from "./SeatedPlayer";

export type CarKind = "van" | "taxi" | "sedan" | "suv" | "hatch";

const BASE = "/world/kenney/cars/";
const FILE: Record<CarKind, string> = {
  van: "van.glb",
  taxi: "taxi.glb",
  sedan: "sedan.glb",
  suv: "suv.glb",
  hatch: "hatchback-sports.glb",
};
// The kit is toy-proportioned (short and tall). Per-axis scale brings each to a
// real footprint: [across, up, along] → roughly the metres in the comment.
const FIT: Record<CarKind, [number, number, number]> = {
  van: [1.3, 1.5, 1.78], // danfo ~1.95 × 2.2 × 4.9 m
  taxi: [1.2, 1.2, 1.57], // ~1.8 × 1.9 (with sign) × 4.3 m
  sedan: [1.2, 1.2, 1.7],
  suv: [1.25, 1.32, 1.76],
  hatch: [1.3, 1.25, 1.43],
};
Object.values(FILE).forEach((f) => useGLTF.preload(BASE + f));

const GLASS = new THREE.Color("#221f33");
const LAMP = new THREE.Color("#fff3cf");
const TYRE = new THREE.Color("#17151d");
const RIM = new THREE.Color("#c9c4d6");
const TRIM = new THREE.Color("#3d3a4c");

interface Kit {
  body: THREE.BufferGeometry;
  wheels: { geo: THREE.BufferGeometry; pos: [number, number, number] }[];
  w: number; // full width (x)
  h: number; // roof height above ground
  l: number; // full length (z)
  zMin: number;
  zMax: number;
  wheelR: number;
}

const kits = new Map<string, Kit>();
let carMat: THREE.MeshStandardMaterial | null = null;
function material() {
  return (carMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.08 }));
}

function hsl(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (d < 1e-4) return [0, 0, l] as const;
  const s = d / (1 - Math.abs(2 * l - 1) || 1);
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l] as const;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function buildKit(scene: THREE.Object3D, kind: CarKind, paint: string): Kit {
  const [sx, sy, sz] = FIT[kind];
  const kw = (sy + sz) / 2; // wheels scale uniformly so they stay round
  const lift = 0.3 * (kw - sy); // keep the arches centred on the bigger wheels
  scene.updateMatrixWorld(true);

  // Read the palette texture once.
  let pix: ImageData | null = null;
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    const img = m?.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (pix || !img?.width) return;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    pix = g.getImageData(0, 0, c.width, c.height);
  });
  const sample = (u: number, v: number, out: THREE.Color) => {
    if (!pix) return out.set("#888");
    const p = pix as ImageData;
    const x = Math.min(p.width - 1, Math.floor((((u % 1) + 1) % 1) * p.width));
    const y = Math.min(p.height - 1, Math.floor((((v % 1) + 1) % 1) * p.height));
    const i = (y * p.width + x) * 4;
    return out.setRGB(p.data[i] / 255, p.data[i + 1] / 255, p.data[i + 2] / 255);
  };

  const paintC = new THREE.Color(paint);
  const tmp = new THREE.Color();
  const out = new THREE.Color();

  // Pass 1 (body only): which hue is this model's paint? The saturated hue
  // covering the most faces.
  const bodyMesh = scene.getObjectByName("body") as THREE.Mesh;
  const hueArea = new Float32Array(36);
  {
    const g = bodyMesh.geometry;
    const uv = g.getAttribute("uv");
    const idx = g.index;
    const n = idx ? idx.count : uv.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t;
      sample(uv.getX(a), uv.getY(a), tmp);
      const [h, s, l] = hsl(tmp.r, tmp.g, tmp.b);
      if (s > 0.3 && l > 0.2) hueArea[Math.floor(h / 10) % 36] += 1;
    }
  }
  let paintHue = 0;
  for (let i = 1; i < 36; i++) if (hueArea[i] > hueArea[paintHue]) paintHue = i;
  paintHue = paintHue * 10 + 5;

  // Pass 2: bake one geometry (flat, vertex-coloured, in metres).
  const bake = (mesh: THREE.Mesh, isWheel: boolean, matrix: THREE.Matrix4, scale: THREE.Vector3) => {
    const g = mesh.geometry.clone().toNonIndexed();
    g.applyMatrix4(matrix);
    g.scale(scale.x, scale.y, scale.z);
    const uv = g.getAttribute("uv");
    const col = new Float32Array(uv.count * 3);
    for (let t = 0; t < uv.count; t += 3) {
      sample(uv.getX(t), uv.getY(t), tmp);
      const [h, s, l] = hsl(tmp.r, tmp.g, tmp.b);
      if (s > 0.3 && l > 0.2 && !isWheel && hueGap(h, paintHue) < 24) {
        out.copy(paintC).multiplyScalar(Math.min(1.12, Math.max(0.72, 0.92 + (l - 0.6) * 0.8)));
      } else if (s > 0.3 && l > 0.2) {
        out.setRGB(tmp.r, tmp.g, tmp.b, THREE.SRGBColorSpace); // tail lights, indicators
      } else if (l > 0.75) {
        out.copy(tmp.b - tmp.r > 0.05 ? GLASS : LAMP);
      } else if (isWheel) {
        out.copy(l < 0.24 ? TYRE : RIM);
      } else if (l < 0.26) {
        out.copy(TYRE);
      } else {
        out.copy(TRIM).multiplyScalar(0.7 + l);
      }
      for (let k = 0; k < 3; k++) {
        col[(t + k) * 3] = out.r;
        col[(t + k) * 3 + 1] = out.g;
        col[(t + k) * 3 + 2] = out.b;
      }
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    g.computeVertexNormals();
    return g;
  };

  const fit = new THREE.Vector3(sx, sy, sz);
  const parts: THREE.BufferGeometry[] = [bake(bodyMesh, false, bodyMesh.matrixWorld, fit)];
  const wheels: Kit["wheels"] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.name.startsWith("wheel-")) return;
    const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
    if (!/-(left|right)$/.test(m.name)) {
      parts.push(bake(m, true, m.matrixWorld, fit)); // SUV spare: part of the body
      return;
    }
    const rot = m.matrixWorld.clone().setPosition(0, 0, 0);
    wheels.push({ geo: bake(m, true, rot, new THREE.Vector3(kw, kw, kw)), pos: [p.x * sx, 0.3 * kw, p.z * sz] });
  });
  const body = parts[0];
  body.translate(0, lift, 0);
  // (the SUV spare is rare enough to keep as its own tiny merged-later mesh)
  const extra = parts.slice(1).map((g) => g.translate(0, lift, 0));
  const merged = extra.length ? mergeFlat([body, ...extra]) : body;
  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  return {
    body: merged,
    wheels,
    w: bb.max.x - bb.min.x,
    h: bb.max.y,
    l: bb.max.z - bb.min.z,
    zMin: bb.min.z,
    zMax: bb.max.z,
    wheelR: 0.3 * kw,
  };
}

function mergeFlat(gs: THREE.BufferGeometry[]) {
  const names = ["position", "normal", "color"] as const;
  const g = new THREE.BufferGeometry();
  for (const n of names) {
    const total = gs.reduce((s, x) => s + x.getAttribute(n).array.length, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const x of gs) {
      arr.set(x.getAttribute(n).array as Float32Array, o);
      o += x.getAttribute(n).array.length;
    }
    g.setAttribute(n, new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

export function useCarKit(kind: CarKind, paint: string): Kit {
  const { scene } = useGLTF(BASE + FILE[kind]);
  return useMemo(() => {
    const key = `${kind}|${paint}`;
    let k = kits.get(key);
    if (!k) kits.set(key, (k = buildKit(scene, kind, paint)));
    return k;
  }, [scene, kind, paint]);
}

/** Speed source for wheel spin: a number, or a getter read every frame. */
export type Speed = number | (() => number);

export function KitCar({
  kind,
  paint,
  speed = 0,
  lamps = true,
  children,
}: {
  kind: CarKind;
  paint: string;
  speed?: Speed;
  lamps?: boolean;
  children?: (kit: Kit) => ReactNode;
}) {
  const kit = useCarKit(kind, paint);
  const wheelRefs = useRef<(THREE.Mesh | null)[]>([]);
  const bodyRef = useRef<THREE.Group>(null);
  const t = useRef(Math.random() * 10);

  const M = useMemo(
    () => ({
      head: flat("#fff6d8", { emissive: "#ffe9a8", emissiveIntensity: 1.6, roughness: 0.4 }),
      tail: flat("#ff3b3b", { emissive: "#ff1e1e", emissiveIntensity: 1.2, roughness: 0.4 }),
    }),
    [],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const v = typeof speed === "function" ? speed() : speed;
    if (v !== 0) {
      const dr = (v * dt) / kit.wheelR;
      for (const w of wheelRefs.current) if (w) w.rotation.x += dr;
    }
    // A touch of suspension life: the body rides a few millimetres on the road,
    // more the faster it goes. Parked cars sit still.
    if (bodyRef.current) {
      t.current += dt * (6 + Math.abs(v));
      bodyRef.current.position.y = v !== 0 ? Math.sin(t.current) * 0.012 * Math.min(1, Math.abs(v) / 4) : 0;
    }
    // Headlamps come up as the street goes dark.
    M.head.emissiveIntensity = 0.9 + (1 - worldControls.lit) * 2.2;
  });

  const lampY = kit.h * 0.36;
  const lampX = kit.w * 0.33;
  return (
    <group userData={{ noBatch: true }}>
      <group ref={bodyRef}>
        <mesh geometry={kit.body} material={material()} castShadow />
        {lamps && (
          <>
            {[-1, 1].map((s) => (
              <mesh key={`h${s}`} position={[s * lampX, lampY, kit.zMax + 0.005]} material={M.head}>
                <boxGeometry args={[0.26, 0.14, 0.03]} />
              </mesh>
            ))}
            {[-1, 1].map((s) => (
              <mesh key={`t${s}`} position={[s * lampX, lampY + 0.08, kit.zMin - 0.005]} material={M.tail}>
                <boxGeometry args={[0.24, 0.12, 0.03]} />
              </mesh>
            ))}
          </>
        )}
        {children?.(kit)}
      </group>
      {kit.wheels.map((w, i) => (
        <mesh
          key={i}
          ref={(el) => {
            wheelRefs.current[i] = el;
          }}
          geometry={w.geo}
          material={material()}
          position={w.pos}
          castShadow
        />
      ))}
    </group>
  );
}

// ── Destination / plate text on a small canvas (cached) ──────────────────────
const textCache = new Map<string, THREE.CanvasTexture>();
function textTex(text: string, bg: string, fg: string, w = 512, h = 128) {
  const key = `${text}|${bg}|${fg}|${w}x${h}`;
  let t = textCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = h * 0.72;
  g.font = `900 ${size}px system-ui, sans-serif`;
  while (g.measureText(text).width > w * 0.9 && size > 10) {
    size -= 4;
    g.font = `900 ${size}px system-ui, sans-serif`;
  }
  g.fillText(text, w / 2, h / 2 + size * 0.04);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textCache.set(key, t);
  return t;
}

// ── Danfo individuality ──────────────────────────────────────────────────────
// No two danfos on a Lagos road look the same: each owner paints a different
// slogan, a different picture, a different shade of yellow. Everything below is
// picked from a per-bus seed, so a bus keeps its look but its neighbour differs.
const YELLOWS = ["#f7b500", "#ffc21a", "#f2a400", "#ffd034", "#eeb211", "#ffb000"];
const STRIPES = ["#15131b", "#15131b", "#15131b", "#14224f", "#0f3b25"];
const ROUTES = ["OJUELEGBA", "MILE 2", "OSHODI", "CMS", "IKORODU", "YABA", "AJEGUNLE", "OBALENDE", "MUSHIN", "BERGER"];
const SLOGANS = [
  "NO FOOD FOR LAZY MAN", "GOD'S TIME IS BEST", "NO CONDITION IS PERMANENT", "OMOLUABI", "E GO BETTER",
  "LET THEM SAY", "SHINE YOUR EYE", "WHO KNOW TOMORROW", "MAN NO DIE MAN NO ROTTEN", "SLOW AND STEADY",
  "TRUST NOBODY", "NA GOD", "UP NEPA", "BLESSED BOY", "NO KING AS GOD", "REMEMBER SIX FEET",
];
const REAR = ["HORN BEFORE OVERTAKE", "NO STANDING", "KEEP DISTANCE", "BACK TO SENDER", "SAFE JOURNEY", "ONE WAY NA SIN", "NO VEX", "GOD DEY"];
const INKS = ["#15131b", "#b91c1c", "#1d4ed8", "#166534", "#7c2d12", "#6d28d9"];
const CLOTHES = ["#e11d48", "#2563eb", "#22c55e", "#f4f1ea", "#7c3aed", "#f97316", "#facc15", "#06b6d4", "#ec4899", "#84cc16", "#f43f5e", "#0ea5e9", "#a16207", "#14b8a6"];
const LOADS = ["#8a5a2e", "#5a6a8a", "#a8433a", "#3f7a55", "#c9a13a", "#6a4a7a", "#2f6f8f", "#b5651d", "#4b5563", "#9f1239"];
const SKINS = ["#6b4226", "#8a5a3a", "#4a2d1a", "#7a4b2a", "#5c3a21"];

function seeded(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// The hand-painted pictures owners put on their buses, drawn as simple shapes.
type Icon = (g: CanvasRenderingContext2D, r: number) => void;
const ICONS: Icon[] = [
  // star
  (g, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.42 : r; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); } g.closePath(); g.fill(); },
  // crescent + star
  (g, r) => { g.beginPath(); g.arc(0, 0, r, 0.6, Math.PI * 2 - 0.6); g.arc(r * 0.34, 0, r * 0.78, Math.PI * 2 - 0.85, 0.85, true); g.closePath(); g.fill(); g.beginPath(); g.arc(r * 0.55, 0, r * 0.2, 0, 7); g.fill(); },
  // heart
  (g, r) => { g.beginPath(); g.moveTo(0, r * 0.9); g.bezierCurveTo(-r * 1.5, -r * 0.2, -r * 0.6, -r * 1.2, 0, -r * 0.4); g.bezierCurveTo(r * 0.6, -r * 1.2, r * 1.5, -r * 0.2, 0, r * 0.9); g.fill(); },
  // lightning bolt (NEPA!)
  (g, r) => { g.beginPath(); g.moveTo(r * 0.25, -r); g.lineTo(-r * 0.55, r * 0.12); g.lineTo(-r * 0.05, r * 0.12); g.lineTo(-r * 0.3, r); g.lineTo(r * 0.6, -r * 0.2); g.lineTo(r * 0.08, -r * 0.2); g.closePath(); g.fill(); },
  // cross
  (g, r) => { g.fillRect(-r * 0.16, -r, r * 0.32, r * 2); g.fillRect(-r * 0.6, -r * 0.5, r * 1.2, r * 0.32); },
  // crown
  (g, r) => { g.beginPath(); g.moveTo(-r, r * 0.6); g.lineTo(-r, -r * 0.5); g.lineTo(-r * 0.5, 0); g.lineTo(0, -r * 0.8); g.lineTo(r * 0.5, 0); g.lineTo(r, -r * 0.5); g.lineTo(r, r * 0.6); g.closePath(); g.fill(); },
  // football
  (g, r) => { g.lineWidth = r * 0.16; g.beginPath(); g.arc(0, 0, r * 0.9, 0, 7); g.stroke(); g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 5; g.lineTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4); } g.closePath(); g.fill(); },
  // eagle: spread wings
  (g, r) => { g.beginPath(); g.moveTo(0, r * 0.5); g.quadraticCurveTo(-r * 0.5, -r * 0.2, -r * 1.3, -r * 0.7); g.quadraticCurveTo(-r * 0.7, r * 0.1, -r * 0.2, r * 0.3); g.lineTo(0, -r * 0.2); g.lineTo(r * 0.2, r * 0.3); g.quadraticCurveTo(r * 0.7, r * 0.1, r * 1.3, -r * 0.7); g.quadraticCurveTo(r * 0.5, -r * 0.2, 0, r * 0.5); g.fill(); },
  // rising sun
  (g, r) => { g.beginPath(); g.arc(0, r * 0.5, r * 0.6, Math.PI, 0); g.fill(); g.lineWidth = r * 0.13; for (let i = 0; i < 7; i++) { const a = Math.PI + (i * Math.PI) / 6; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.75, r * 0.5 + Math.sin(a) * r * 0.75); g.lineTo(Math.cos(a) * r * 1.1, r * 0.5 + Math.sin(a) * r * 1.1); g.stroke(); } },
  // palm tree
  (g, r) => { g.fillRect(-r * 0.08, -r * 0.2, r * 0.16, r * 1.2); g.lineWidth = r * 0.2; g.lineCap = "round"; for (const a of [-2.7, -2.1, -1.57, -1.0, -0.45]) { g.beginPath(); g.moveTo(0, -r * 0.2); g.quadraticCurveTo(Math.cos(a) * r * 0.6, -r * 0.2 + Math.sin(a) * r * 0.9, Math.cos(a) * r * 1.1, -r * 0.2 + Math.sin(a) * r * 0.45); g.stroke(); } },
];

/** A painted panel: [picture] SLOGAN [picture], transparent background. */
function artTex(key: string, text: string, ink: string, accent: string, iconA: number, iconB: number, w: number, h: number, twoLine = false) {
  const k = `art|${key}|${text}|${ink}|${accent}|${iconA}|${iconB}|${w}x${h}|${twoLine}`;
  let t = textCache.get(k);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const r = h * (twoLine ? 0.2 : 0.36);
  const pad = r * 2.6;
  const drawIcon = (i: number, x: number, y: number) => {
    g.save();
    g.translate(x, y);
    g.fillStyle = accent;
    g.strokeStyle = accent;
    ICONS[i % ICONS.length](g, r);
    g.restore();
  };
  g.fillStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const fit = (str: string, maxW: number, start: number) => {
    let size = start;
    g.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
    while (g.measureText(str).width > maxW && size > 10) {
      size -= 3;
      g.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
    }
  };
  if (twoLine) {
    const words = text.split(" ");
    const mid = Math.ceil(words.length / 2);
    const l1 = words.slice(0, mid).join(" ");
    const l2 = words.slice(mid).join(" ");
    drawIcon(iconA, w / 2, h * 0.22);
    fit(l1, w * 0.92, h * 0.26);
    g.fillText(l1, w / 2, h * 0.56);
    if (l2) {
      fit(l2, w * 0.92, h * 0.26);
      g.fillText(l2, w / 2, h * 0.84);
    }
  } else {
    drawIcon(iconA, pad / 2, h / 2);
    drawIcon(iconB, w - pad / 2, h / 2);
    fit(text, w - pad * 2, h * 0.7);
    g.fillText(text, w / 2, h / 2 + 2);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textCache.set(k, t);
  return t;
}

// ── Collapse a scripted vehicle into a handful of draw calls ─────────────────
// The exported models are one mesh per material per part (a full danfo is ~90).
// After the per-vehicle colours are set, everything solid is baked into ONE
// vertex-coloured mesh; glass, headlamps and the other lights get one mesh
// each; each wheel becomes one mesh on its own node so it can still spin.
let solidMat: THREE.MeshStandardMaterial | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;
const SOLID = () => (solidMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.05 }));
const GLOW = () => (glowMat ||= new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));

function mergeInto(meshes: THREE.Mesh[], space: THREE.Matrix4): THREE.BufferGeometry | null {
  if (!meshes.length) return null;
  let total = 0;
  const parts = meshes.map((m) => {
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(space, m.matrixWorld));
    total += geo.getAttribute("position").count;
    return { geo, color: (m.material as THREE.MeshStandardMaterial).color };
  });
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    const a = p.geo.getAttribute("position");
    pos.set(a.array as Float32Array, o * 3);
    for (let i = 0; i < a.count; i++) {
      col[(o + i) * 3] = p.color.r;
      col[(o + i) * 3 + 1] = p.color.g;
      col[(o + i) * 3 + 2] = p.color.b;
    }
    o += a.count;
    p.geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

interface Baked {
  model: THREE.Group;
  wheels: THREE.Object3D[];
  lamp: THREE.MeshStandardMaterial | null;
  driver: THREE.Object3D | null;
}
/** `src` must already carry its per-vehicle materials and part visibility. */
function bakeVehicle(src: THREE.Object3D, lampMat: THREE.MeshStandardMaterial | null, keepDriver = false): Baked {
  src.updateMatrixWorld(true);
  const inv = src.matrixWorld.clone().invert();
  const out = new THREE.Group();
  out.userData.noBatch = true;
  const solid: THREE.Mesh[] = [], glass: THREE.Mesh[] = [], lamps: THREE.Mesh[] = [], glow: THREE.Mesh[] = [], drv: THREE.Mesh[] = [];
  const wheels: THREE.Object3D[] = [];
  const sort = (root: THREE.Object3D, into?: THREE.Mesh[]) =>
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const n = (m.material as THREE.Material).name;
      (into ?? (n === "glass" ? glass : n === "lamp" ? lamps : n === "tail" || n === "amber" ? glow : solid)).push(m);
    });
  let glassMat: THREE.Material | null = null;
  for (const part of src.children) {
    if (!part.visible && part.name !== "driver") continue;
    if (/^wheel_\d$/.test(part.name)) {
      const ms: THREE.Mesh[] = [];
      sort(part, ms);
      part.updateMatrixWorld(true);
      const geo = mergeInto(ms, part.matrixWorld.clone().invert());
      if (!geo) continue;
      const w = new THREE.Mesh(geo, SOLID());
      w.castShadow = true;
      // wheel node sits directly under the model root, so its local transform carries over
      w.position.copy(part.position);
      w.quaternion.copy(part.quaternion);
      w.scale.copy(part.scale);
      out.add(w);
      wheels.push(w);
    } else if (keepDriver && part.name === "driver") {
      sort(part, drv);
    } else {
      sort(part);
    }
  }
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.Material).name === "glass") glassMat = m.material as THREE.Material;
  });
  const add = (meshes: THREE.Mesh[], mat: THREE.Material, shadow: boolean) => {
    const geo = mergeInto(meshes, inv);
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    out.add(m);
    return m;
  };
  add(solid, SOLID(), true);
  if (glassMat) add(glass, glassMat, false);
  if (lampMat) add(lamps, lampMat, false);
  add(glow, GLOW(), false);
  const driver = add(drv, SOLID(), true);
  return { model: out, wheels, lamp: lampMat, driver };
}

// Pack several small painted textures onto one image and their planes into one
// mesh: one draw for the lot instead of one each.
interface Decal { tex: THREE.Texture; w: number; h: number; pos: [number, number, number]; rotY: number }
function decalSheet(items: Decal[], makeMat: (map: THREE.Texture) => THREE.Material): THREE.Mesh {
  const imgs = items.map((d) => d.tex.image as HTMLCanvasElement);
  const uniq = [...new Set(imgs)];
  const PAD = 4;
  const W = Math.max(...uniq.map((c) => c.width));
  const H = uniq.reduce((a, c) => a + c.height + PAD, 0);
  const sheet = document.createElement("canvas");
  sheet.width = W;
  sheet.height = H;
  const g = sheet.getContext("2d")!;
  const at = new Map<HTMLCanvasElement, number>();
  let y = 0;
  for (const c of uniq) {
    g.drawImage(c, 0, y);
    at.set(c, y);
    y += c.height + PAD;
  }
  const geos = items.map((d, i) => {
    const c = imgs[i];
    const geo = new THREE.PlaneGeometry(d.w, d.h).toNonIndexed();
    const uv = geo.getAttribute("uv");
    const u1 = c.width / W;
    const top = at.get(c)!;
    for (let k = 0; k < uv.count; k++) {
      // plane uv: (0,0) bottom-left .. (1,1) top-right; canvas y runs downward
      uv.setXY(k, uv.getX(k) * u1, 1 - (top + (1 - uv.getY(k)) * c.height) / H);
    }
    geo.rotateY(d.rotY);
    geo.translate(d.pos[0], d.pos[1], d.pos[2]);
    return geo;
  });
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((x) => x.dispose());
  const map = new THREE.CanvasTexture(sheet);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  for (const t of new Set(items.map((d) => d.tex))) t.dispose(); // the small ones are no longer needed
  return new THREE.Mesh(merged, makeMat(map));
}

const DANFO_URL = "/world/models/danfo.glb";
useGLTF.preload(DANFO_URL);

/**
 * The Lagos danfo. The body is our own model (tools/blender/danfo.py → danfo.glb):
 * snub nose, raked screen, black stripes, sliding door, loaded roof rack, four
 * separate wheels. Here it gets its route board, slogan and plates, spinning
 * wheels, suspension bob, and headlamps that brighten as the street goes dark.
 */
export function DanfoBus({ variant = 0, speed = 0, full = 0.8 }: { variant?: number; speed?: Speed; full?: number }) {
  const v = Math.abs(variant);
  const { scene } = useGLTF(DANFO_URL);

  // Everything that makes THIS bus itself, from its seed.
  const look = useMemo(() => {
    const r = seeded(v + 1);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
    return {
      yellow: pick(YELLOWS),
      stripe: pick(STRIPES),
      route: ROUTES[v % ROUTES.length],
      slogan: SLOGANS[(v * 7 + 3) % SLOGANS.length],
      slogan2: SLOGANS[(v * 5 + 9) % SLOGANS.length],
      rear: REAR[(v * 3 + 1) % REAR.length],
      ink: pick(INKS),
      ink2: pick(INKS),
      accent: pick(["#b91c1c", "#1d4ed8", "#166534", "#15131b", "#6d28d9"]),
      icons: [Math.floor(r() * ICONS.length), Math.floor(r() * ICONS.length), Math.floor(r() * ICONS.length)],
      plate: `${pick(["LSD", "KJA", "APP", "EPE", "FST", "MUS", "AGL", "IKD"])} ${100 + Math.floor(r() * 899)} ${pick(["XA", "GA", "LG", "KD", "AA", "FK"])}`,
      rackTilt: (r() - 0.5) * 0.08,
    };
  }, [v]);

  const { model, wheels, lamp } = useMemo(() => {
    const m = scene.clone(true);
    const r = seeded(v * 13 + 5);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
    // Per-bus materials: its own yellow, stripe colour, a fresh set of clothes for
    // the passengers and a different pile on the roof.
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const own = (src: THREE.MeshStandardMaterial) => {
      let c = mats.get(src.name);
      if (c) return c;
      c = src.clone();
      c.flatShading = true;
      if (src.name === "paint") c.color.set(look.yellow);
      else if (src.name === "stripe") c.color.set(look.stripe);
      else if (src.name.startsWith("shirt")) c.color.set(pick(CLOTHES));
      else if (src.name.startsWith("load")) c.color.set(pick(LOADS));
      else if (src.name.startsWith("skin")) c.color.set(pick(SKINS));
      else if (src.name === "glass") {
        c.transparent = true;
        c.opacity = 0.32;
        c.depthWrite = false;
        c.side = THREE.DoubleSide;
      }
      mats.set(src.name, c);
      return c;
    };
    m.traverse((o) => {
      if (/^pax_\d+$/.test(o.name) && r() > full) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false; // self-shadowing stripes the flat paint
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((x) => own(x as THREE.MeshStandardMaterial))
        : own(mesh.material as THREE.MeshStandardMaterial);
    });
    const b = bakeVehicle(m, mats.get("lamp") ?? null);
    return { model: b.model, wheels: b.wheels, lamp: b.lamp };
  }, [scene, v, full, look]);

  // This bus's own paint: route board, slogans, pictures, plates. Each used to
  // be its own textured plane (6 draws per bus). They are now packed onto two
  // shared images, one for the unlit signs and one for the painted panels, so
  // the whole paint job is 2 draws.
  const decals = useMemo(() => {
    const plate = textTex(look.plate, "#f4f1ea", "#15131b", 256, 96);
    const signs = decalSheet(
      [
        { tex: textTex(look.route, "#15131b", GA.goldLight), w: 1.22, h: 0.2, pos: [0, 2.27, 1.675], rotY: 0 },
        { tex: plate, w: 0.46, h: 0.15, pos: [0, 0.43, 2.525], rotY: 0 },
        { tex: plate, w: 0.46, h: 0.15, pos: [0, 0.43, -2.505], rotY: Math.PI },
      ],
      (map) => new THREE.MeshBasicMaterial({ map, toneMapped: false }),
    );
    const paint = decalSheet(
      [
        { tex: artTex("s", look.slogan, look.ink, look.accent, look.icons[0], look.icons[1], 1024, 104), w: 2.9, h: 0.3, pos: [0.948, 0.68, 0.3], rotY: Math.PI / 2 },
        { tex: artTex("d", look.slogan2, look.ink2, look.accent, look.icons[2], look.icons[0], 640, 72), w: 1.7, h: 0.19, pos: [-0.948, 0.68, -1.3], rotY: -Math.PI / 2 },
        { tex: artTex("r", look.rear, look.ink, look.accent, look.icons[2], 0, 512, 256, true), w: 1.25, h: 0.62, pos: [0, 0.86, -2.418], rotY: Math.PI },
      ],
      (map) => new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.35, roughness: 0.7, flatShading: true }),
    );
    return [signs, paint];
  }, [look]);
  useEffect(
    () => () => {
      for (const d of decals) {
        d.geometry.dispose();
        const m = d.material as THREE.MeshBasicMaterial;
        m.map?.dispose();
        m.dispose();
      }
    },
    [decals],
  );

  const body = useRef<THREE.Group>(null);
  const t = useRef(Math.random() * 10);
  const callT = useRef(4 + Math.random() * 10);
  const wp = useRef(new THREE.Vector3());
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const sp = typeof speed === "function" ? speed() : speed;
    if (sp !== 0) for (const w of wheels) w.rotateY(-(sp * dt) / 0.37);
    if (body.current) {
      t.current += dt * (6 + Math.abs(sp));
      body.current.position.y = sp !== 0 ? Math.sin(t.current) * 0.014 * Math.min(1, Math.abs(sp) / 4) : 0;
      body.current.rotation.x = sp !== 0 ? Math.sin(t.current * 0.5) * 0.004 : 0;
      // The conductor calls his route when you walk up to the bus.
      callT.current -= dt;
      if (callT.current <= 0) {
        callT.current = 3;
        body.current.getWorldPosition(wp.current);
        const d = wp.current.distanceTo(worldControls.playerPos);
        if (d < 9 && conductorCall(look.route, Math.max(0.35, 1 - d / 12))) callT.current = 14 + Math.random() * 12;
      }
    }
    if (lamp) lamp.emissiveIntensity = 1.2 + (1 - worldControls.lit) * 3;
  });

  return (
    <group ref={body} userData={{ noBatch: true }}>
      <primitive object={model} />
      {decals.map((d) => <primitive key={d.uuid} object={d} />)}
    </group>
  );
}

// ── Keke + okada (tools/blender/keke.py, okada.py) ───────────────────────────
// Same idea as the danfo: one scripted model each, then every instance gets its
// own colours, riders and details from a seed so the road never repeats itself.
const PLAYER_IN_KEKE = 1; // matched to the on-foot player scale below
const KEKE_URL = "/world/models/keke.glb";
const OKADA_URL = "/world/models/okada-bike.glb";
useGLTF.preload(KEKE_URL);
useGLTF.preload(OKADA_URL);
const KEKE_PAINT = ["#f7b500", "#ffc21a", "#f2a400", "#ffd034", "#f7b500", "#eeb211"];
const CANOPY = ["#15131b", "#15131b", "#14224f", "#4a1024", "#0f3b25", "#3b3b46", "#5b2a8a"];
const BIKE_PAINT = ["#e11d48", "#2563eb", "#15131b", "#16a34a", "#f97316", "#7c3aed", "#0ea5e9", "#facc15"];
const HELMETS = ["#facc15", "#f4f1ea", "#e11d48", "#15131b", "#2563eb", "#22c55e"];
const KEKE_REAR = ["GOD DEY", "NO VEX", "SHARP SHARP", "E GO BETTER", "MARWA", "JEJE", "UP NEPA", "ONE LOVE", "NA GRACE", "SMALL BUT MIGHTY"];

function useScripted(
  url: string,
  seed: number,
  recolour: (name: string, pick: <T>(a: readonly T[]) => T) => string | null,
  show: (name: string, r: () => number) => boolean,
) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const m = scene.clone(true);
    const r = seeded(seed * 31 + 7);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const own = (src: THREE.MeshStandardMaterial) => {
      let c = mats.get(src.name);
      if (c) return c;
      c = src.clone();
      c.flatShading = true;
      const col = recolour(src.name, pick);
      if (col) c.color.set(col);
      else if (src.name.startsWith("shirt")) c.color.set(pick(CLOTHES));
      else if (src.name.startsWith("skin")) c.color.set(pick(SKINS));
      else if (src.name === "glass") {
        c.transparent = true;
        c.opacity = 0.32;
        c.depthWrite = false;
        c.side = THREE.DoubleSide;
      }
      mats.set(src.name, c);
      return c;
    };
    m.traverse((o) => {
      if (/^(pax_\d+|driver)$/.test(o.name)) o.visible = show(o.name, r);
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((x) => own(x as THREE.MeshStandardMaterial))
        : own(mesh.material as THREE.MeshStandardMaterial);
    });
    return bakeVehicle(m, mats.get("lamp") ?? null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, seed]);
}

function useRolling(wheels: THREE.Object3D[], lamp: THREE.MeshStandardMaterial | null, speed: Speed, wheelR: number, bob = 0.012) {
  const body = useRef<THREE.Group>(null);
  const t = useRef(Math.random() * 10);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const sp = typeof speed === "function" ? speed() : speed;
    if (sp !== 0) for (const w of wheels) w.rotateY(-(sp * dt) / wheelR);
    if (body.current) {
      t.current += dt * (7 + Math.abs(sp));
      body.current.position.y = sp !== 0 ? Math.sin(t.current) * bob * Math.min(1, Math.abs(sp) / 4) : 0;
    }
    if (lamp) lamp.emissiveIntensity = 1.2 + (1 - worldControls.lit) * 3;
  });
  return body;
}

/**
 * Keke napep. `driver`: show the driver (pass a getter for rideable kekes so he
 * appears when someone is driving). `pax`: chance each back seat is taken.
 */
export function KekeModel({
  seed = 0,
  speed = 0,
  driver = true,
  pax = 0.6,
  player,
}: {
  seed?: number;
  speed?: Speed;
  driver?: boolean | (() => boolean);
  pax?: number;
  /** Rideable kekes: when this returns true, YOUR character sits in the driver's seat. */
  player?: () => boolean;
}) {
  const v = Math.abs(Math.round(seed));
  const k = useScripted(
    KEKE_URL,
    v,
    (n, pick) => (n === "paint" ? pick(KEKE_PAINT) : n === "canopy" ? pick(CANOPY) : null),
    (n, r) => (n === "driver" ? true : r() < pax),
  );
  const body = useRolling(k.wheels, k.lamp, speed, 0.24);
  useFrame(() => {
    if (k.driver) k.driver.visible = typeof driver === "function" ? driver() : driver;
  });
  const rear = useMemo(() => {
    const r = seeded(v + 3);
    const ink = INKS[Math.floor(r() * INKS.length)];
    const text = KEKE_REAR[v % KEKE_REAR.length];
    return new THREE.MeshStandardMaterial({
      map: artTex("k", text, ink, ink, Math.floor(r() * ICONS.length), 0, 512, 200, true),
      transparent: true,
      alphaTest: 0.35,
      roughness: 0.7,
    });
  }, [v]);
  return (
    <group ref={body} userData={{ noBatch: true }}>
      <primitive object={k.model} />
      <mesh position={[0, 0.8, -1.31]} rotation={[0, Math.PI, 0]} material={rear}>
        <planeGeometry args={[0.8, 0.32]} />
      </mesh>
      {player && (
        <Suspense fallback={null}>
          <SeatedPlayer active={player} seat={[0, 0.7, 0.2]} scale={PLAYER_IN_KEKE} />
        </Suspense>
      )}
    </group>
  );
}

/** Okada: bike, helmeted rider, and usually a passenger on the back. */
export function OkadaBike({ seed = 0, speed = 0, pax = 0.7, rider = true }: { seed?: number; speed?: Speed; pax?: number; rider?: boolean }) {
  const k = useScripted(
    OKADA_URL,
    Math.abs(Math.round(seed)) + 1000,
    (n, pick) => (n === "paint" ? pick(BIKE_PAINT) : n === "helmet" ? pick(HELMETS) : null),
    (n, r) => (n === "driver" ? rider : rider && r() < pax),
  );
  const body = useRolling(k.wheels, k.lamp, speed, 0.3, 0.008);
  return (
    <group ref={body} userData={{ noBatch: true }}>
      <primitive object={k.model} />
    </group>
  );
}

/** The yellow Lagos cab. */
const CAB_PAINT = ["#ffc21a", "#f7b500", "#ffd034", "#f2a400"];
export function TaxiCar({ speed = 0, seed = 0 }: { speed?: Speed; seed?: number }) {
  const v = Math.abs(Math.round(seed));
  const kind: CarKind = v % 3 === 2 ? "sedan" : "taxi"; // some cabs are plain yellow saloons
  const plate = useMemo(() => {
    const r = seeded(v + 77);
    const txt = `${["LSR", "KTU", "AKD", "BDG"][Math.floor(r() * 4)]} ${100 + Math.floor(r() * 899)} ${["TX", "CB", "LA"][Math.floor(r() * 3)]}`;
    return new THREE.MeshBasicMaterial({ map: textTex(txt, "#f4f1ea", "#15131b", 256, 96), toneMapped: false });
  }, [v]);
  return (
    <KitCar kind={kind} paint={CAB_PAINT[v % CAB_PAINT.length]} speed={speed}>
      {(k) => (
        <>
          {/* the black cab stripe down each flank */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (k.w / 2 + 0.006), k.h * 0.34, (k.zMin + k.zMax) / 2]} material={flat("#15131b", { roughness: 0.7 })}>
              <boxGeometry args={[0.012, 0.09, k.l * 0.78]} />
            </mesh>
          ))}
          <mesh position={[0, k.h * 0.2, k.zMin - 0.012]} rotation={[0, Math.PI, 0]} material={plate}>
            <planeGeometry args={[0.44, 0.15]} />
          </mesh>
        </>
      )}
    </KitCar>
  );
}
