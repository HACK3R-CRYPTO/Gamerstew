"use client";

// ─── Pickups — grab-on-the-run power-ups that make every run different ────────
// A few glowing power-ups float around the street during a run. Run over one and
// the active mode's director applies its effect (Pickups just raises a one-shot
// `worldControls.pickup`, so the score/lives/restored state stays where it lives).
// Grabbing one usually means a detour across the traffic lanes — a real choice of
// "is it worth it?". They respawn in new spots with new kinds, so no two runs feel
// the same. Mode-aware: Charge gets ⚡/💵/❤️, Restore gets 🔧/💡/❤️.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { worldControls } from "./controls";
import { useAppStore } from "./appStore";
import { useGameStore } from "./game";
import { useRestoreStore } from "./restore";
import { playClutch } from "./audio";

type Kind = "overdrive" | "cash" | "life" | "stabilizer" | "jumpstart";
const CHARGE_KINDS: Kind[] = ["overdrive", "cash", "life"];
const RESTORE_KINDS: Kind[] = ["stabilizer", "jumpstart", "life"];
const META: Record<Kind, { emoji: string; color: string }> = {
  overdrive: { emoji: "⚡", color: "#ffd23b" },
  cash: { emoji: "💵", color: "#3bd16a" },
  life: { emoji: "❤️", color: "#ff5a7a" },
  stabilizer: { emoji: "🔧", color: "#5fd0ff" },
  jumpstart: { emoji: "💡", color: "#ffae3a" },
};

// Candidate spots along the street (mix of kerb + lanes), reachable on foot.
const SPOTS: [number, number][] = [
  [-4, -30], [4, -20], [-1.6, -10], [4, 0], [-4, 8],
  [1.6, 16], [-4, 24], [4, 32], [-1.6, -24], [4, -6],
];
const SLOTS = 3; // how many are live at once
const GRAB_R2 = 1.9 * 1.9;

function emojiTex(emoji: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.font = "92px system-ui, 'Apple Color Emoji', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, s / 2, s / 2 + 6);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Slot {
  kind: Kind;
  x: number;
  z: number;
  active: boolean;
  respawn: number; // seconds until it comes back after being grabbed
}

export default function Pickups() {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const iconMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const glowMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const ringMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const iconMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const prevMode = useRef<string>("");

  const texes = useMemo(() => {
    const m: Partial<Record<Kind, THREE.CanvasTexture | null>> = {};
    (Object.keys(META) as Kind[]).forEach((k) => { m[k] = emojiTex(META[k].emoji); });
    return m;
  }, []);
  const col = useMemo(() => new THREE.Color(), []);

  const kindsFor = (mode: string) => (mode === "charge" ? CHARGE_KINDS : RESTORE_KINDS);
  const slots = useRef<Slot[]>([]);

  function reseed(mode: string) {
    const ks = kindsFor(mode);
    const used = new Set<number>();
    slots.current = Array.from({ length: SLOTS }, () => {
      let si = (Math.random() * SPOTS.length) | 0;
      let guard = 0;
      while (used.has(si) && guard++ < 20) si = (Math.random() * SPOTS.length) | 0;
      used.add(si);
      return { kind: ks[(Math.random() * ks.length) | 0], x: SPOTS[si][0], z: SPOTS[si][1], active: true, respawn: 0 };
    });
  }

  function respawnSlot(s: Slot, mode: string, px: number, pz: number) {
    const ks = kindsFor(mode);
    s.kind = ks[(Math.random() * ks.length) | 0];
    // Pick a spot that isn't right on top of the player.
    let si = (Math.random() * SPOTS.length) | 0;
    for (let g = 0; g < 10; g++) {
      const [x, z] = SPOTS[si];
      if ((x - px) ** 2 + (z - pz) ** 2 > 36) break;
      si = (Math.random() * SPOTS.length) | 0;
    }
    s.x = SPOTS[si][0];
    s.z = SPOTS[si][1];
    s.active = true;
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const mode = useAppStore.getState().mode;
    const playing = mode === "charge"
      ? useGameStore.getState().mode === "playing"
      : mode === "restore" ? useRestoreStore.getState().mode === "playing" : false;

    // (Re)seed when a run starts or the mode changes.
    if (playing && (slots.current.length === 0 || prevMode.current !== mode)) reseed(mode);
    prevMode.current = mode;

    const p = worldControls.playerPos;
    const t = performance.now() * 0.0015;

    for (let i = 0; i < SLOTS; i++) {
      const s = slots.current[i];
      const g = groups.current[i];
      if (!s || !g) continue;

      if (!playing) { g.visible = false; continue; }

      if (!s.active) {
        s.respawn -= dt;
        if (s.respawn <= 0) respawnSlot(s, mode, p.x, p.z);
        g.visible = s.active;
        if (!s.active) continue;
      }

      // Grab test — can't grab while driving (you'd blow past them; keep it on-foot).
      if (!worldControls.driving) {
        const dx = p.x - s.x;
        const dz = p.z - s.z;
        if (dx * dx + dz * dz < GRAB_R2) {
          s.active = false;
          s.respawn = 4 + Math.random() * 4;
          worldControls.pickup = s.kind; // the active director applies it
          worldControls.shake = Math.max(worldControls.shake, 0.14);
          playClutch(Math.max(-1, Math.min(1, s.x / 6)));
          g.visible = false;
          continue;
        }
      }

      // Render: bob + spin the icon, pulse the glow, colour everything by kind.
      g.visible = true;
      g.position.set(s.x, 1.1 + Math.sin(t * 3 + i) * 0.12, s.z);
      col.copy(new THREE.Color(META[s.kind].color));
      const im = iconMeshes.current[i];
      if (im) im.rotation.y += dt * 1.6;
      if (texes[s.kind] && iconMats.current[i]) iconMats.current[i]!.map = texes[s.kind]!;
      if (glowMats.current[i]) { glowMats.current[i]!.color.copy(col); glowMats.current[i]!.opacity = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin(t * 5 + i)); }
      if (ringMats.current[i]) { ringMats.current[i]!.color.copy(col); ringMats.current[i]!.opacity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(t * 4 + i)); }
    }
  });

  return (
    <>
      {Array.from({ length: SLOTS }).map((_, i) => (
        <group key={i} ref={(el) => { groups.current[i] = el; }} visible={false}>
          {/* glow halo */}
          <mesh>
            <sphereGeometry args={[0.55, 16, 16]} />
            <meshBasicMaterial ref={(m) => { glowMats.current[i] = m; }} color="#ffffff" transparent opacity={0.35} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
          </mesh>
          {/* emoji icon on a billboard */}
          <Billboard>
            <mesh ref={(m) => { iconMeshes.current[i] = m; }}>
              <planeGeometry args={[0.7, 0.7]} />
              <meshBasicMaterial ref={(m) => { iconMats.current[i] = m; }} transparent depthWrite={false} toneMapped={false} />
            </mesh>
          </Billboard>
          {/* ground ring marking where to run */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.08, 0]}>
            <ringGeometry args={[0.7, 0.95, 32]} />
            <meshBasicMaterial ref={(m) => { ringMats.current[i] = m; }} color="#ffffff" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}
