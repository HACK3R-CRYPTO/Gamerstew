// ─── Facade materials — windows that come on with the power ──────────────────
// One canvas pair shared by every building: a colour map (white wall so the
// wall tint is exact, dark glass, light frames, floor bands) and an emissive
// map (which windows are lit). Materials are cached per (wall colour, repeat),
// so a whole neighbourhood costs a few dozen materials. Lights.tsx drives every
// facade's emissive strength from the NEPA light level each frame: power on →
// the street's windows glow gold, NEPA takes the light → they die, bar a few
// on generator.

import * as THREE from "three";
import { WORLD } from "./theme";

const S = 256;
const COLS = 4;
const ROWS = 4;

let maps: { map: THREE.CanvasTexture; emap: THREE.CanvasTexture } | null | undefined;

function build() {
  if (maps !== undefined) return maps;
  if (typeof document === "undefined") return (maps = null);
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    return [c, c.getContext("2d")!] as const;
  };
  const [c1, x] = mk();
  const [c2, e] = mk();
  let seed = 11;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, S, S);
  e.fillStyle = "#000000";
  e.fillRect(0, 0, S, S);
  const cw = S / COLS;
  const ch = S / ROWS;
  for (let r = 0; r < ROWS; r++) {
    // floor band: a soft shadow line under each storey
    x.fillStyle = "rgba(60,40,90,0.16)";
    x.fillRect(0, r * ch + ch - 5, S, 5);
    for (let col = 0; col < COLS; col++) {
      const px = col * cw;
      const py = r * ch;
      const mx = cw * 0.22;
      const my = ch * 0.18;
      const ww = cw - 2 * mx;
      const wh = ch - 2 * my - 4;
      x.fillStyle = WORLD.windowFrame;
      x.fillRect(px + mx - 3, py + my - 3, ww + 6, wh + 6);
      x.fillStyle = WORLD.glass;
      x.fillRect(px + mx, py + my, ww, wh);
      // mullion
      x.fillStyle = WORLD.windowFrame;
      x.fillRect(px + cw / 2 - 1, py + my, 2, wh);
      // sill
      x.fillStyle = "rgba(40,20,70,0.28)";
      x.fillRect(px + mx - 3, py + my + wh + 3, ww + 6, 3);
      // lit window: full pane, or a half-drawn curtain for variety
      const roll = rnd();
      if (roll < 0.36) {
        e.fillStyle = roll < 0.07 ? "#ffffff" : roll < 0.3 ? "#d8d8d8" : "#9a9a9a";
        e.fillRect(px + mx, py + my, ww, wh);
        if (rnd() < 0.35) {
          e.fillStyle = "#000000";
          e.fillRect(px + mx, py + my, ww * 0.45, wh);
        }
        e.fillStyle = "#000000";
        e.fillRect(px + cw / 2 - 1, py + my, 2, wh);
      }
    }
  }
  const fin = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return (maps = { map: fin(c1, true), emap: fin(c2, true) });
}

// Every facade material, so the light rig can drive their glow together.
export const facadeMaterials = new Set<THREE.MeshStandardMaterial>();
const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Wall material for a block w×h metres, tinted `wall`. */
export function facadeMaterial(wall: string, w: number, h: number): THREE.MeshStandardMaterial {
  const rx = Math.max(1, Math.round(w / 8));
  const ry = Math.max(1, Math.round(h / 11));
  const key = `${wall}|${rx}|${ry}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = build();
  const m = new THREE.MeshStandardMaterial({ color: wall, roughness: 0.95, metalness: 0, flatShading: true });
  if (base) {
    const map = base.map.clone();
    const emap = base.emap.clone();
    for (const t of [map, emap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.needsUpdate = true;
    }
    m.map = map;
    m.emissiveMap = emap;
    m.emissive = new THREE.Color(WORLD.windowGlow);
    m.emissiveIntensity = 1;
  }
  cache.set(key, m);
  facadeMaterials.add(m);
  return m;
}

/** Called once per frame by the light rig. `glow` is 0..1. */
export function setFacadeGlow(glow: number) {
  const v = glow * 1.35;
  facadeMaterials.forEach((m) => {
    m.emissiveIntensity = v;
  });
}

// Shopfront glass: warm light spilling onto the pavement, on the same switch.
let shop: THREE.MeshStandardMaterial | null = null;
export function shopfrontMaterial(): THREE.MeshStandardMaterial {
  if (shop) return shop;
  shop = new THREE.MeshStandardMaterial({ color: "#2a1d14", emissive: new THREE.Color("#ffd08a"), emissiveIntensity: 1, roughness: 0.6, flatShading: true });
  facadeMaterials.add(shop);
  return shop;
}
