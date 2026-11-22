// ─── World theme — one palette, one look ─────────────────────────────────────
// Every colour the street uses lives here, so the whole world reads as ONE
// stylised piece instead of photo textures next to low-poly models. The recipe
// (borrowed from the best stylised web runners): flat shading, a strict palette,
// fog that matches the horizon, one warm sun, and windows that glow at night.
//
// The palette is GameArena's: deep purple dusk (the brand gradient), gold
// (coins, the mascot, lit windows) and arena green (the primary button, and the
// green/white Lagos kerb). Tune colours here, never inline in components.

import * as THREE from "three";

export const GA = {
  purple: "#7c3aed",
  purpleDeep: "#2a1240",
  purpleNight: "#0a0120",
  gold: "#fbbf24",
  goldLight: "#ffd56b",
  green: "#22c55e",
  greenDeep: "#15803d",
  hot: "#ff4fd8",
  ink: "#f4f1ea",
} as const;

// A time preset = sky + fog + lights. `lit` (power on → 1, blackout → 0)
// lerps between DUSK and BLACKOUT every frame in Lights.tsx.
export interface TimePreset {
  skyTop: string;
  skyBottom: string;
  skyMid: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunI: number;
  sunPos: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  ambI: number;
  disc: string; // sun / moon disc colour
  discPos: [number, number, number];
  discSize: number;
  stars: boolean;
  windowGlow: number; // 0..1 lit-window strength (power on → 1; a few on gen in a blackout)
  exposure: number;
}

export const DUSK: TimePreset = {
  skyTop: "#4a2380",
  skyMid: "#d0629a",
  skyBottom: "#ffb36b",
  fog: "#c98468",
  fogNear: 14,
  fogFar: 76,
  sun: "#ffb060",
  sunI: 2.5,
  sunPos: [18, 24, 10],
  hemiSky: "#d8a8ff",
  hemiGround: "#5a3a2a",
  hemiI: 0.8,
  ambI: 0.38,
  disc: "#ffd27a",
  discPos: [-60, 26, -110],
  discSize: 14,
  stars: false,
  windowGlow: 1,
  exposure: 1.05,
};

export const BLACKOUT: TimePreset = {
  skyTop: "#070414",
  skyMid: "#120b26",
  skyBottom: "#221538",
  fog: "#0e0a1c",
  fogNear: 6,
  fogFar: 34,
  sun: "#3250a0",
  sunI: 0.24,
  sunPos: [18, 6, 10],
  hemiSky: "#1a1f4a",
  hemiGround: "#04060e",
  hemiI: 0.34,
  ambI: 0.16,
  disc: "#dfe6ff",
  discPos: [50, 48, -110],
  discSize: 3.2,
  stars: true,
  windowGlow: 0.07,
  exposure: 1.05,
};

// The street palette (world surfaces, buildings, foliage).
export const WORLD = {
  ground: "#1b1030", // earth beyond the kerbs — deep purple, never black
  road: "#3d3a4a", // purple-grey tarmac
  roadLine: "#f4e9c8",
  gutter: "#120c1c",
  sidewalk: "#b9b0c2", // warm-cool concrete with a lavender cast
  sidewalkEdge: "#d9d2e0",
  kerb: [GA.green, GA.ink] as [string, string], // the green/white Lagos kerb
  walls: [
    "#dccfe8", "#eac9b4", "#cfdbc8", "#eadaa6",
    "#d9c3dc", "#f0dfc0", "#c9d4e2", "#e8b9a9",
  ],
  roof: "#3a2a4a",
  parapet: "#2a1d3a",
  glass: "#24203a",
  windowFrame: "#efe9f4",
  windowGlow: GA.gold,
  shopBand: ["#2b1f3f", "#3b2a52", "#1f2a3f", "#3f2a2a"],
  awning: [GA.green, GA.gold, GA.purple, "#e11d48"],
  foliage: ["#2f9e5a", "#3fb36a", "#1f7a44", "#58c47a"],
  trunk: "#7a5a3a",
  palm: "#3cb371",
  metal: "#3a3a44",
  coin: GA.gold,
} as const;

// ── Flat-shaded material cache ───────────────────────────────────────────────
// One MeshStandardMaterial per (colour, options) key, shared by every mesh that
// asks for it, so a street of hundreds of parts costs a handful of materials.
const cache = new Map<string, THREE.MeshStandardMaterial>();

export interface FlatOpts {
  emissive?: string;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  fog?: boolean;
  side?: THREE.Side;
}

export function flat(color: string, o: FlatOpts = {}): THREE.MeshStandardMaterial {
  const key = [
    color,
    o.emissive ?? "",
    o.emissiveIntensity ?? "",
    o.map?.uuid ?? "",
    o.emissiveMap?.uuid ?? "",
    o.roughness ?? "",
    o.metalness ?? "",
    o.opacity ?? 1,
    o.fog === false ? 0 : 1,
    o.side ?? "",
  ].join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: o.roughness ?? 0.92,
    metalness: o.metalness ?? 0,
    map: o.map ?? null,
    emissiveMap: o.emissiveMap ?? null,
    emissive: o.emissive ?? "#000000",
    emissiveIntensity: o.emissiveIntensity ?? 1,
    fog: o.fog !== false,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.opacity != null && o.opacity < 1) {
    m.transparent = true;
    m.opacity = o.opacity;
    m.depthWrite = false;
  }
  cache.set(key, m);
  return m;
}

// Restyle a loaded GLB in place: every mesh goes flat-shaded in the palette
// (textures dropped), so bought/CC models sit in the same world as the
// procedural street. `pick` maps a mesh/material name to a palette colour;
// return null to leave that part's own colour.
export function restyle(
  root: THREE.Object3D,
  pick: (meshName: string, matName: string, base: THREE.Color) => string | null,
) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const next = mats.map((src) => {
      const std = src as THREE.MeshStandardMaterial;
      const base = std.color ? std.color.clone() : new THREE.Color("#888");
      const c = pick(m.name, src.name, base) ?? `#${base.getHexString()}`;
      return flat(c, {
        roughness: 0.85,
        metalness: 0,
        emissive: std.emissive && std.emissiveIntensity > 0 ? `#${std.emissive.getHexString()}` : undefined,
        emissiveIntensity: std.emissiveIntensity,
      });
    });
    m.material = Array.isArray(m.material) ? next : next[0];
  });
}

// ── Stylise a bought / generated vehicle so it sits in the flat world ────────
// AI- and scan-made models arrive with noisy photo-style textures plus normal /
// roughness maps, which fight the clean palette street. This keeps the model's
// own paint job but repaints it small (so detail collapses into flat colour
// areas, like a hand-painted low-poly texture), lifts the saturation, and drops
// every other map. Runs once per source scene; clones share the materials.
// Flat-paint filter: coloured pixels have their lightness squeezed toward a mid
// tone and their saturation lifted, so weathering, rust and baked shadows
// collapse into clean paint. Yellow / orange / brown all snap to one danfo
// yellow. Near-black (stripes, lettering, tyres, glass) and near-white stay.
function repaint(g: CanvasRenderingContext2D, w: number, h: number) {
  let data: ImageData;
  try {
    data = g.getImageData(0, 0, w, h);
  } catch {
    return; // tainted canvas: keep the plain downsample
  }
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    let l = (mx + mn) / 2;
    const dl = mx - mn;
    if (dl < 0.08) {
      // greys: push to clean dark / light so lettering stays crisp
      l = l < 0.3 ? l * 0.7 : l > 0.7 ? 0.7 + (l - 0.7) * 1.1 : l;
      const v = Math.min(255, Math.round(l * 255));
      d[i] = d[i + 1] = d[i + 2] = v;
      continue;
    }
    let s = dl / (1 - Math.abs(2 * l - 1) || 1);
    let hh = mx === r ? ((gg - b) / dl) % 6 : mx === gg ? (b - r) / dl + 2 : (r - gg) / dl + 4;
    hh = (hh * 60 + 360) % 360;
    if (l < 0.14) continue; // deep shadow / black trim
    const warm = hh >= 12 && hh <= 68;
    if (warm) {
      hh = 45;
      s = Math.max(s, 0.92);
      l = 0.5 + (l - 0.5) * 0.22 + 0.02;
    } else {
      s = Math.min(1, s * 1.25);
      l = 0.5 + (l - 0.5) * 0.5;
    }
    const c2 = (1 - Math.abs(2 * l - 1)) * s;
    const x2 = c2 * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = l - c2 / 2;
    const [r2, g2, b2] = hh < 60 ? [c2, x2, 0] : hh < 120 ? [x2, c2, 0] : hh < 180 ? [0, c2, x2] : hh < 240 ? [0, x2, c2] : hh < 300 ? [x2, 0, c2] : [c2, 0, x2];
    d[i] = Math.round((r2 + m) * 255);
    d[i + 1] = Math.round((g2 + m) * 255);
    d[i + 2] = Math.round((b2 + m) * 255);
  }
  g.putImageData(data, 0, 0);
}

const stylized = new WeakSet<THREE.Object3D>();
export function stylizeOnce(root: THREE.Object3D, res = 256) {
  if (stylized.has(root) || typeof document === "undefined") return;
  stylized.add(root);
  const done = new Set<string>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const tris = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const m = mat as THREE.MeshStandardMaterial;
      if (!m.isMeshStandardMaterial || done.has(m.uuid)) continue;
      done.add(m.uuid);
      const img = m.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
      if (m.map && img && img.width) {
        const k = res / Math.max(img.width, img.height);
        const c = document.createElement("canvas");
        c.width = Math.max(8, Math.round(img.width * k));
        c.height = Math.max(8, Math.round(img.height * k));
        const g = c.getContext("2d");
        if (g) {
          g.imageSmoothingQuality = "high";
          g.drawImage(img, 0, 0, c.width, c.height);
          repaint(g, c.width, c.height);
          const t = new THREE.CanvasTexture(c);
          t.flipY = m.map.flipY;
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = m.map.wrapS;
          t.wrapT = m.map.wrapT;
          t.repeat.copy(m.map.repeat);
          t.offset.copy(m.map.offset);
          t.magFilter = THREE.LinearFilter;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          m.map = t;
        }
      }
      m.normalMap = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
      m.aoMap = null;
      m.roughness = 0.72;
      m.metalness = 0.04;
      m.envMapIntensity = 0.6;
      m.flatShading = tris < 6000;
      m.needsUpdate = true;
    }
  });
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
