"use client";
import { track } from "@/lib/track";
import { HowToButton } from "@/components/HowToPlay";
import EnergyLine from "@/components/EnergyLine";
import GuestLine from "@/components/GuestLine";

// ─── Street Strike — Lagos street bowling ────────────────────────────────────
// Not a neon alley. You roll an old tyre (the childhood game) down a Lagos
// street to knock over ten glass bottles set on the tarmac. The lane is the
// road between the green/white kerbs, the gutters are real open gutters, and
// the calls are Pidgin. Scoring is ordinary ten-pin (strike / spare) over five
// frames, so anyone can pick it up.
//
// Physics is Rapier: the tyre is a sphere collider (a real upright disc is
// unstable) wearing a tyre mesh that is kept upright and spun to match its
// travel. A throw is four numbers, the same idea real bowling games use:
//   x     where you release it across the road
//   angle the direction you send it
//   speed how hard
//   spin  the hook, which only bites on the far half of the road
// On a phone: start your swipe where you want to release, swipe up to roll,
// and curve the swipe to hook.

import { toast } from "@/lib/toast";
import TxStatus from "@/components/TxStatus";
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, MeshReflectorMaterial } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import RAPIER from "@dimforge/rapier3d-compat";
import { simulate, cleanThrow, STEP as SIM_STEP, type SimResult } from "./sim";
import { useRankedRun } from "@/hooks/useRankedRun";
import { useGuestGate } from "@/hooks/useGuestGate";

// What is on screen is a PLAYBACK of the lane simulation (./sim.ts), not live
// physics. The simulation decides the roll in one go; these puppets are moved
// through its recorded steps. The server runs the same simulation on the same
// throw, so the bottles the player watched fall are the bottles it counts.
class Puppet {
  p = new THREE.Vector3();
  q = new THREE.Quaternion();
  v = new THREE.Vector3(); // metres a second, from the last two steps
  w = new THREE.Vector3(); // turn speed in x; only its size is used
  translation() { return this.p; }
  rotation() { return this.q; }
  linvel() { return this.v; }
  angvel() { return this.w; }
}
type RapierRigidBody = Puppet;
import * as THREE from "three";
import { GA, WORLD, flat } from "../world/theme";
import Sky, { type SkyHandle } from "../world/Sky";
import { setFacadeGlow } from "../world/facade";
import { worldControls } from "../world/controls";
import { DanfoBus } from "../world/LowPolyCar";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import WindowBlock from "../world/WindowBlock";
import Batch from "../world/Batch";
import { score, PINS, type ScoreState } from "./scoring";
import { ADS, type Ad } from "./ads";
import { net, explain, type Room, type Session } from "./online";
import { openRoomSocket } from "@/lib/roomSocket";
import AutoSharpness from "../world/AutoSharpness";
import { armSfx, closeSfx, setMuted, setRumble, bottleHit, bottleRoll, sfxCount, thud, buzz, crowdSound } from "./sfx";

// ── Tuning (metres, seconds) ─────────────────────────────────────────────────
const FRAMES = 5;
const LANE_W = 1.9; // rolling strip of road
const LANE_LEN = 12.5; // release line (z = 0) to the head bottle: short enough to read the bottles on a phone
const GUTTER_W = 0.5;
const GUTTER_DROP = 0.16;
const SPACING = 0.4; // bottle to bottle
const ROW = SPACING * Math.sin(Math.PI / 3);
const BOTTLE_H = 0.335;
const START_Z = -0.6;
const HOOK = 0.032; // lateral accel per unit spin on the far half
const SPEED_MIN = 5;
const SPEED_MAX = 11;

const HOME: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let r = 0; r < 4; r++) for (let i = 0; i <= r; i++) out.push([(i - r / 2) * SPACING, -LANE_LEN - r * ROW]);
  return out;
})();
const DECK_END = -LANE_LEN - 3 * ROW - 0.9;

export interface Throw {
  x: number;
  angle: number;
  speed: number;
  spin: number;
}
// strike cam state, shared by the roll loop and the camera
const cine = { t: -1, side: 1, armed: true };
type Phase = "lobby" | "aim" | "rolling" | "settling" | "over";

// Three tyres that really play differently, like choosing a ball at an alley.
// `mass` decides how hard it drives through the bottles; `hook` scales how much
// a curved swipe bends it on the far half of the road.
export const TYRES = [
  { id: "keke", name: "Keke tyre", note: "Small and light. Bends hard", r: 0.23, mass: 4.4, hook: 1.45, power: 2, curve: 5, control: 3, paint: ["#fbbf24", "#ff5fb0", "#4ade80"] },
  { id: "danfo", name: "Danfo tyre", note: "Big and heavy. Scatters all", r: 0.3, mass: 17, hook: 0.7, power: 5, curve: 2, control: 2, paint: ["#fbbf24", "#f4f1ea", "#fbbf24"] },
  { id: "okada", name: "Okada tyre", note: "Thin. Goes where you aim", r: 0.27, mass: 6.6, hook: 0.12, power: 3, curve: 1, control: 5, paint: ["#5fd4ff", "#f4f1ea", "#c084fc"] },
] as const;

// One shared "the street is cheering" signal: the crowd and the confetti read it.
const cheer = { t: 0, key: 0 };
// What the crowd should do about the last roll. They only react when there is
// something to react to: wild for a strike or spare, a clap for a good roll,
// heads down for a gutter or a weak one. Otherwise they just stand and watch.
const crowd = { key: 0, mood: "wild" as "wild" | "clap" | "boo" };
const react = (mood: typeof crowd.mood, loud: "wild" | "yeah" | "clap" | "boo" = mood) => { crowd.mood = mood; crowd.key++; crowdSound(loud); };

const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';
const BODY = '"Fredoka", system-ui, sans-serif';

const CALLS = {
  strike: ["GBAM! STRIKE!", "E SCATTER! STRIKE!", "CLEAN SWEEP!", "NA YOU BE THIS!"],
  spare: ["You clear am!", "Spare! Sharp guy", "E no remain!"],
  gutter: ["E enter gutter o!", "Chai! Inside gutter", "Gutter don collect am"],
  good: ["Correct!", "E make sense!", "On am!"],
  weak: ["Small small", "Try again", "Aim am well"],
};
const say = (k: keyof typeof CALLS) => CALLS[k][Math.floor(Math.random() * CALLS[k].length)];

// ── Shared geometry / materials ──────────────────────────────────────────────
// Built once and shared by every bottle in every rack (a fresh set per bottle
// per rack was never freed and piled up over a long session).
let bottleGeo: { body: THREE.LatheGeometry; label: THREE.CylinderGeometry; cap: THREE.CylinderGeometry } | null = null;
function useBottleGeo() {
  if (!bottleGeo) {
    const pts = [
      [0, 0], [0.056, 0], [0.06, 0.02], [0.06, 0.165], [0.05, 0.205], [0.026, 0.245],
      [0.022, 0.3], [0.027, 0.305], [0.027, 0.33], [0, 0.335],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const body = new THREE.LatheGeometry(pts, 12);
    const label = new THREE.CylinderGeometry(0.0615, 0.0615, 0.075, 12, 1, true);
    label.translate(0, 0.105, 0);
    const cap = new THREE.CylinderGeometry(0.029, 0.029, 0.02, 10);
    cap.translate(0, 0.335, 0);
    bottleGeo = { body, label, cap };
  }
  return bottleGeo;
}
const glassMats = new Map<string, THREE.MeshStandardMaterial>();
function glassMat(color: string) {
  let m = glassMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.25, flatShading: true, emissive: color, emissiveIntensity: 0.55 });
    glassMats.set(color, m);
  }
  return m;
}
const GLASS = ["#1f7a44", "#7a4a1e", "#1f7a44", "#c9e2d3", "#7a4a1e"]; // green, brown, clear
const LABELS = ["#f4f1ea", "#e11d48", "#fbbf24", "#f4f1ea", "#2563eb"];

function Bottle({ i, api }: { i: number; api: React.MutableRefObject<(RapierRigidBody | null)[]> }) {
  const geo = useBottleGeo();
  const glass = glassMat(GLASS[i % GLASS.length]);
  const label = useMemo(() => flat(LABELS[(i * 3) % LABELS.length], { roughness: 0.8 }), [i]);
  const cap = useMemo(() => flat(GA.gold, { roughness: 0.4, metalness: 0.5 }), []);
  const g = useRef<THREE.Group>(null);
  const pup = useMemo(() => { const u = new Puppet(); u.p.set(HOME[i][0], 0.002, HOME[i][1]); return u; }, [i]);
  useEffect(() => {
    api.current[i] = pup;
    return () => { if (api.current[i] === pup) api.current[i] = null; };
  }, [api, i, pup]);
  useFrame(() => {
    if (!g.current) return;
    g.current.position.copy(pup.p);
    g.current.quaternion.copy(pup.q);
  });
  return (
    <group ref={g} position={[HOME[i][0], 0.002, HOME[i][1]]}>
      <mesh geometry={geo.body} material={glass} castShadow />
      <mesh geometry={geo.label} material={label} />
      <mesh geometry={geo.cap} material={cap} />
    </group>
  );
}

// The tyre: follows the physics ball, stays upright, spins with travel. The
// model is ours (tools/blender/tyre.py): chunky tread, white-wall, steel rim.
const tyreUrl = (id: string) => `/world/models/tyre-${id}.glb`;
["keke", "danfo", "okada"].forEach((id) => useGLTF.preload(tyreUrl(id)));
function Tyre({ ball, paint, id, r }: { ball: React.MutableRefObject<RapierRigidBody | null>; paint: readonly string[]; id: string; r: number }) {
  const g = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Group>(null);
  const { scene } = useGLTF(tyreUrl(id));
  const model = useMemo(() => {
    const m = scene.clone(true);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const slot: Record<string, number> = { stripe: 0, pink: 1, green: 2 };
      const recolour = (src: THREE.Material) => {
        const c = (src as THREE.MeshStandardMaterial).clone();
        c.flatShading = true;
        if (src.name in slot) {
          c.color.set(paint[slot[src.name]]);
          c.emissive.set(paint[slot[src.name]]);
          c.emissiveIntensity = 0.45;
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolour) : recolour(mesh.material);
    });
    return m;
  }, [scene, paint]);
  const last = useRef(new THREE.Vector3());
  useFrame(() => {
    const b = ball.current;
    if (!b || !g.current || !wheel.current) return;
    const p = b.translation();
    const v = b.linvel();
    g.current.position.set(p.x, p.y, p.z);
    const dist = Math.hypot(p.x - last.current.x, p.z - last.current.z);
    last.current.set(p.x, p.y, p.z);
    wheel.current.rotation.x -= (dist / r) * Math.sign(-v.z || 1);
    // Rolling: face along travel and lean into the hook. Waiting at the line: turn
    // three-quarters to the camera so you see the white-wall and the rim, not just
    // the dark edge of the tread, and rock gently so it feels alive.
    const sp = Math.hypot(v.x, v.z);
    const want = sp > 0.4 ? Math.atan2(-v.x, -v.z) : 0.62 + Math.sin(performance.now() / 700) * 0.06;
    g.current.rotation.y += (want - g.current.rotation.y) * (sp > 0.4 ? 0.35 : 0.1);
    g.current.rotation.z = THREE.MathUtils.clamp(-v.x * 0.06, -0.3, 0.3);
  });
  return (
    <group ref={g}>
      <group ref={wheel}>
        <primitive object={model} />
      </group>
      {/* its own warm light, so the tyre is never a silhouette on the dark road */}
      <pointLight position={[0.5, 0.55, 0.9]} intensity={3.2} distance={3.2} decay={2} color="#ffd9a0" />
    </group>
  );
}

// ── Night street party: the mood ─────────────────────────────────────────────
// A dark street with points of warm light is what makes the bottles and the
// tyre pop: deep purple sky with an afterglow on the horizon, a cool moon for
// shape, warm street-lamp pools down the road, and a spotlight on the bottles.
function NightRig({ lowPerf }: { lowPerf: boolean }) {
  const sky = useRef<SkyHandle>(null);
  const { scene, gl } = useThree();
  useEffect(() => {
    // dev only: lets a test read how much the scene costs to draw
    if (process.env.NODE_ENV !== "production") (window as unknown as { __bowlInfo?: () => unknown }).__bowlInfo = () => ({ calls: gl.info.render.calls, tris: gl.info.render.triangles, geos: gl.info.memory.geometries, tex: gl.info.memory.textures });
  }, [gl]);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, 0.1, -LANE_LEN - ROW * 1.5);
    return o;
  }, []);
  useEffect(() => {
    scene.fog = new THREE.Fog("#1c0f38", 9, 58);
    scene.background = null;
    gl.toneMappingExposure = 1.12;
    setFacadeGlow(1);
    const prev = worldControls.lit;
    worldControls.lit = 0.2; // vehicles read this to turn their headlamps up
    return () => {
      worldControls.lit = prev;
      scene.fog = null;
    };
  }, [scene, gl]);
  useFrame(() => {
    const k = sky.current;
    if (!k) return;
    k.top.set("#090418");
    k.mid.set("#3a1668");
    k.bottom.set("#c2508a");
    k.disc.set("#e8ecff");
    k.discPos.set(46, 52, -100);
    k.discSize.value = 3.4;
    k.stars.value = 0.95;
  });
  return (
    <>
      <Sky ref={sky} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#7a5ae0", "#1a0f20", 0.6]} />
      <directionalLight position={[-7, 13, 5]} intensity={0.55} color="#9aa6ff" castShadow={!lowPerf} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-22} shadow-camera-far={50} shadow-bias={-0.0005} />
      {[-1.5, -6.5, -11].map((z, i) => (
        <pointLight key={z} position={[i % 2 ? 2.4 : -2.4, 3.4, z]} intensity={16} distance={11} decay={2} color="#ffbf73" />
      ))}
      <primitive object={target} />
      <spotLight position={[0, 5.4, -LANE_LEN + 3.2]} target={target} intensity={90} angle={0.52} penumbra={0.7} distance={16} decay={2} color="#fff1cf" castShadow={!lowPerf} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.0006} />
    </>
  );
}

// Festoon bulbs strung across the street, the way a Lagos street party is lit.
const BULBS = ["#ffd56b", "#ff5fb0", "#4ade80", "#5fd4ff", "#fff3cf"];
function Festoons({ span }: { span: number }) {
  const N = 13;
  const rows = [-0.5, -3.4, -6.3, -9.2, -12.1, -15];
  const mesh = useRef<THREE.InstancedMesh>(null);
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const z of rows) {
      for (let i = 0; i < N - 1; i++) {
        for (const t of [i / (N - 1), (i + 1) / (N - 1)]) {
          const u = t * 2 - 1;
          pts.push(u * span, 4.9 - 0.85 * (1 - u * u) + 0.06, z);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    let k = 0;
    rows.forEach((z, r) => {
      for (let i = 0; i < N; i++) {
        const u = (i / (N - 1)) * 2 - 1;
        d.position.set(u * span, 4.9 - 0.85 * (1 - u * u), z);
        d.updateMatrix();
        m.setMatrixAt(k, d.matrix);
        m.setColorAt(k, c.set(BULBS[(i + r) % BULBS.length]));
        k++;
      }
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span]);
  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#0d0a16" />
      </lineSegments>
      <instancedMesh ref={mesh} args={[undefined, undefined, rows.length * N]}>
        <sphereGeometry args={[0.085, 8, 6]} />
        <meshBasicMaterial toneMapped={false} fog={false} />
      </instancedMesh>
    </group>
  );
}

// Neon shop signs: glowing letters on dark boards above the shopfronts.
function neonTex(text: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0714";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeRect(10, 10, 492, 108);
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 70;
  g.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
  while (g.measureText(text).width > 440 && size > 20) {
    size -= 4;
    g.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
  }
  g.fillStyle = "#ffffff";
  g.shadowBlur = 26;
  g.fillText(text, 256, 66);
  g.fillStyle = color;
  g.shadowBlur = 10;
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SIGNS: [string, string][] = [["SUYA SPOT", "#ff5fb0"], ["COLD DRINKS", "#5fd4ff"], ["MAMA PUT", "#ffd56b"], ["BARBING SALON", "#4ade80"], ["VIEWING CENTRE", "#ff8a4a"], ["PHONE CHARGE", "#c084fc"]];
function Neons({ x }: { x: number }) {
  const mats = useMemo(() => SIGNS.map(([t, c]) => new THREE.MeshBasicMaterial({ map: neonTex(t, c), toneMapped: false })), []);
  return (
    <group>
      {SIGNS.map((_, i) => {
        const s = i % 2 ? 1 : -1;
        return (
          <mesh key={i} position={[s * x, 3.75, -1.6 - Math.floor(i / 2) * 5 - (i % 2) * 2.2]} rotation={[0, (-s * Math.PI) / 2, 0]} material={mats[i]}>
            <planeGeometry args={[2.9, 0.72]} />
          </mesh>
        );
      })}
    </group>
  );
}

// ── Billboards: the street's ad space ────────────────────────────────────────
// Lagos roads are lined with them, so they belong here, and each one is a slot
// a brand can buy (see ads.ts). A board cycles through the ad list on its own.
function adTex(ad: Ad, onLoad: () => void) {
  const W = 1024, H = 512;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const bgd = g.createLinearGradient(0, 0, W, H); bgd.addColorStop(0, ad.bg[0]); bgd.addColorStop(1, ad.bg[1]);
  g.fillStyle = bgd; g.fillRect(0, 0, W, H);
  // big soft shapes so a poster never reads as a flat colour
  g.globalAlpha = 0.16; g.fillStyle = ad.accent;
  g.beginPath(); g.arc(W * 0.86, H * 0.18, 230, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(W * 0.1, H * 1.05, 260, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  g.fillStyle = ad.accent; g.fillRect(64, 96, 12, H - 192);
  g.textBaseline = "middle"; g.textAlign = "left";
  const fit = (text: string, weight: number, size: number, max: number) => { do { g.font = `${weight} ${size}px "Arial Black", "Fredoka", system-ui, sans-serif`; size -= 6; } while (g.measureText(text).width > max && size > 30); };
  if (ad.kicker) { fit(ad.kicker, 800, 46, W - 190); g.fillStyle = ad.accent; g.fillText(ad.kicker, 104, 140); }
  fit(ad.title, 900, 150, W - 190); g.fillStyle = ad.ink; g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 18; g.fillText(ad.title, 104, 262); g.shadowBlur = 0;
  if (ad.sub) { fit(ad.sub, 700, 50, W - 190); g.fillStyle = "rgba(255,255,255,0.88)"; g.fillText(ad.sub, 104, 384); }
  if (ad.image) {
    const img = new Image();
    img.onload = () => { g.drawImage(img, 0, 0, W, H); t.needsUpdate = true; onLoad(); };
    img.src = ad.image;
  }
  return t;
}
// where the boards stand: [x, y, z, width, height, turn toward the lane, ad offset, legs]
const BOARDS: [number, number, number, number, number, number, number, number][] = [
  [2.75, 4.05, DECK_END - 3.1, 4.6, 2.3, -0.2, 0, 2], // the big one over the end wall
  [-2.9, 3.7, DECK_END - 3.5, 3.6, 1.8, 0.24, 1, 1],
  [-(LANE_W / 2 + GUTTER_W + 3.05), 1.5, -8.6, 1.5, 0.75, 1.15, 2, 2], // a roadside lightbox
  [LANE_W / 2 + GUTTER_W + 3.05, 1.5, -5.6, 1.5, 0.75, -1.15, 3, 2],
];
function Billboards({ lowPerf }: { lowPerf: boolean }) {
  const { invalidate } = useThree();
  const texs = useMemo(() => ADS.map((a) => adTex(a, invalidate)), [invalidate]);
  const mats = useMemo(() => BOARDS.map((b) => new THREE.MeshBasicMaterial({ map: texs[b[6] % texs.length], toneMapped: false })), [texs]);
  const steel = useMemo(() => flat("#2a2438", { roughness: 0.6, metalness: 0.4 }), []);
  const lamp = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fff3cf", toneMapped: false }), []);
  // every board turns to its next ad on a slow clock, staggered so they never all change together
  const clock = useRef(0);
  const shown = useRef(BOARDS.map((b) => b[6]));
  useFrame((_, dt) => {
    clock.current += dt;
    BOARDS.forEach((b, i) => {
      const ix = (b[6] + Math.floor((clock.current + i * 3.5) / 14)) % texs.length;
      if (ix !== shown.current[i]) { shown.current[i] = ix; mats[i].map = texs[ix]; mats[i].needsUpdate = true; }
    });
  });
  const list = lowPerf ? BOARDS.slice(0, 3) : BOARDS;
  return (
    <group>
      {list.map(([x, y, z, w, h, ry, , legs], i) => (
        <group key={i} position={[x, 0, z]} rotation={[0, ry, 0]}>
          <mesh position={[0, y, 0]} material={steel}><boxGeometry args={[w + 0.22, h + 0.22, 0.16]} /></mesh>
          <mesh position={[0, y, 0.085]} material={mats[i]}><planeGeometry args={[w, h]} /></mesh>
          {(legs === 2 ? [-w * 0.32, w * 0.32] : [0]).map((lx) => (
            <mesh key={lx} position={[lx, (y - h / 2) / 2, -0.06]} material={steel}><boxGeometry args={[legs === 2 ? 0.1 : 0.26, y - h / 2, 0.1]} /></mesh>
          ))}
          {/* a row of lamps washing the poster from below, the way real boards are lit */}
          {h > 1 && [-0.34, 0, 0.34].map((k) => (
            <mesh key={k} position={[k * w, y - h / 2 - 0.1, 0.34]} material={lamp}><boxGeometry args={[0.2, 0.05, 0.1]} /></mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ── The street the game is played on ─────────────────────────────────────────
function Street({ lowPerf }: { lowPerf: boolean }) {
  const M = useMemo(
    () => ({
      road: flat(WORLD.road, { roughness: 0.95 }),
      lane: flat("#2b2444", { roughness: 0.35, metalness: 0.35 }), // dark and glossy: wet tarmac
      gutter: flat(WORLD.gutter, { roughness: 1 }),
      walk: flat("#6f6787", { roughness: 1 }),
      chalk: new THREE.MeshBasicMaterial({ color: "#f4f1ea", transparent: true, opacity: 0.85, toneMapped: false }),
      chalkGold: new THREE.MeshBasicMaterial({ color: GA.goldLight, transparent: true, opacity: 0.9, toneMapped: false }),
      kerb: [flat(WORLD.kerb[0], { roughness: 0.9 }), flat(WORLD.kerb[1], { roughness: 0.9 })],
      ground: flat(WORLD.ground, { roughness: 1 }),
    }),
    [],
  );
  // the wall at the end of the street: hand-painted, like a Lagos compound wall
  const mural = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, "#7c3aed");
    grad.addColorStop(0.5, "#c2578f");
    grad.addColorStop(1, "#f97316");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i < 9; i++) g.fillRect(i * 128 + 40, 0, 26, 256);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = '900 120px "Arial Black", system-ui, sans-serif';
    g.lineWidth = 14;
    g.strokeStyle = "#15131b";
    g.strokeText("STREET STRIKE", 512, 110);
    g.fillStyle = "#ffd56b";
    g.fillText("STREET STRIKE", 512, 110);
    g.font = '700 40px system-ui, sans-serif';
    g.fillStyle = "#f4f1ea";
    g.fillText("GAME ARENA  •  NO PARKING  •  POST NO BILL", 512, 206);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, emissive: "#ffffff", emissiveMap: t, emissiveIntensity: 0.35 });
  }, []);
  const half = LANE_W / 2;
  const zc = -(LANE_LEN / 2) - 2;
  const len = LANE_LEN + 14;
  const kerbX = half + GUTTER_W + 0.17;
  const blocks = Math.floor(len / 1.6);
  const buildings = useMemo(() => {
    const out: { x: number; z: number; w: number; h: number; d: number; s: number; wi: number; awn: number; r: number }[] = [];
    let seed = 5;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (const s of [-1, 1]) {
      let z = 6;
      while (z > -LANE_LEN - 12) {
        const w = 6 + rnd() * 5;
        const h = 8 + rnd() * 9;
        const d = 6;
        z -= w / 2;
        out.push({ x: s * (kerbX + 3.4 + d / 2), z, w, h, d, s, wi: Math.floor(rnd() * 8), awn: Math.floor(rnd() * 4), r: rnd() });
        z -= w / 2 + 0.4;
      }
    }
    return out;
  }, [kerbX]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -GUTTER_DROP - 0.03, zc]} material={M.ground}>
        <planeGeometry args={[120, 120]} />
      </mesh>
      {/* the rolling strip, proud of the gutters */}
      <mesh position={[0, -0.1, zc]} receiveShadow material={M.lane}>
        <boxGeometry args={[LANE_W, 0.2, len]} />
      </mesh>
      {/* wet tarmac: on a capable device the strip mirrors the bulbs, signs and bottles */}
      {!lowPerf && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, zc]} receiveShadow>
          <planeGeometry args={[LANE_W, len]} />
          <MeshReflectorMaterial resolution={512} blur={[260, 90]} mixBlur={1.1} mixStrength={2.4} mirror={0.55} color="#2b2444" metalness={0.45} roughness={0.55} depthScale={1} minDepthThreshold={0.4} maxDepthThreshold={1.3} />
        </mesh>
      )}
      <Festoons span={kerbX + 2.6} />
      <Neons x={kerbX + 3.32} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (half + GUTTER_W / 2), -GUTTER_DROP - 0.05, zc]} material={M.gutter}>
            <boxGeometry args={[GUTTER_W, 0.1, len]} />
          </mesh>
          <mesh position={[s * (kerbX + 1.9), -0.02, zc]} receiveShadow material={M.walk}>
            <boxGeometry args={[3.4, 0.2, len]} />
          </mesh>
          {Array.from({ length: blocks }, (_, i) => (
            <mesh key={i} position={[s * kerbX, 0.02, 5 - 0.8 - i * 1.6]} material={M.kerb[i % 2]} castShadow>
              <boxGeometry args={[0.34, 0.26, 1.52]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* chalk lines down both edges of the strip */}
      {[-1, 1].map((sd) => (
        <mesh key={sd} rotation={[-Math.PI / 2, 0, 0]} position={[sd * (half - 0.04), 0.004, zc]} material={M.chalk}>
          <planeGeometry args={[0.05, len]} />
        </mesh>
      ))}
      {/* chalk: release line, aiming arrows, the triangle for the bottles */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} material={M.chalk}>
        <planeGeometry args={[LANE_W, 0.06]} />
      </mesh>
      {[-0.6, -0.3, 0, 0.3, 0.6].map((x, k) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.004, -4.6 - (2 - Math.abs(k - 2)) * 0.5]} material={M.chalkGold}>
          <coneGeometry args={[0.07, 0.22, 3]} />
        </mesh>
      ))}
      {/* chalk spots where the bottles stand */}
      {HOME.map(([x, z], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.004, z]} material={M.chalk}>
          <ringGeometry args={[0.075, 0.09, 14]} />
        </mesh>
      ))}
      {/* the neighbourhood, same blocks as UP NEPA */}
      {(
        <Batch>
          {buildings.map((b, i) => (
            <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.s < 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
              <WindowBlock w={b.w} h={b.h} d={b.d} wi={b.wi} awn={b.awn} r={Math.max(0.001, b.r)} dish={i % 3 === 0} />
            </group>
          ))}
        </Batch>
      )}
      {/* end wall: a painted compound wall the bottles crash against */}
      <mesh position={[0, 0.75, DECK_END - 1.7]} material={mural}>
        <boxGeometry args={[LANE_W + 2 * GUTTER_W + 4, 1.9, 0.3]} />
      </mesh>
      <mesh position={[0, 1.76, DECK_END - 1.7]} material={flat(GA.gold, { roughness: 0.7 })}>
        <boxGeometry args={[LANE_W + 2 * GUTTER_W + 4.1, 0.12, 0.36]} />
      </mesh>
    </group>
  );
}

// Static colliders: road strip, sunken gutters, kerbs, the pit behind the bottles.
// ── Game brain ────────────────────────────────────────────
interface Api {
  throwIt: (t: Throw) => void;
  aimX: (x: number) => void;
}
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
function Brain({
  phase,
  standing,
  apiRef,
  onResult,
  onPhase,
  rackKey,
  tyre,
  setSlow: setSlowProp,
  onThrow,
}: {
  tyre: (typeof TYRES)[number];
  phase: Phase;
  standing: boolean[];
  apiRef: React.MutableRefObject<Api | null>;
  onResult: (down: boolean[], gutter: boolean) => void;
  onPhase: (p: Phase) => void;
  rackKey: number;
  setSlow: (on: boolean) => void;
  /** every throw as it is released, so a ranked game can be replayed by the server */
  onThrow?: (t: { tyre: string; x: number; angle: number; speed: number; spin: number }) => void;
}) {
  const ball = useRef<RapierRigidBody | null>(new Puppet());
  // the roll being played back, and how far through it we are
  const play = useRef<{ res: SimResult; frames: Float32Array; n: number; t: number } | null>(null);
  const engineReady = useRef(false);
  useEffect(() => { let on = true; void RAPIER.init().then(() => { if (on) engineReady.current = true; }); return () => { on = false; }; }, []);
  const standingRef = useRef(standing);
  standingRef.current = standing;
  const slowMo = useRef(false);
  const setSlow = (on: boolean) => { slowMo.current = on; setSlowProp(on); };
  const onThrowRef = useRef(onThrow);
  onThrowRef.current = onThrow;
  const bottles = useRef<(RapierRigidBody | null)[]>([]);
  // per-bottle sound memory: last velocity (to spot an impact), turn since the last roll knock, cooldown
  const voice = useRef(Array.from({ length: 10 }, () => ({ x: 0, y: 0, z: 0, has: false, turn: 0, cool: 0 })));
  const aim = useRef(0);
  const spin = useRef(0);
  const hookMul = useRef(1);
  const tyreRef = useRef(tyre);
  tyreRef.current = tyre;
  const t = useRef(0);
  const settle = useRef(0);
  const wentGutter = useRef(false);
  // The brain keeps its OWN phase, changed synchronously. React state lags a
  // frame behind, and acting on the stale value snapped the tyre back to the
  // line right after release and counted one roll many times. "counted" is the
  // gap between reporting a result and the next roll being set up.
  const phaseRef = useRef<Phase | "counted">(phase);
  const lastProp = useRef<Phase>(phase);
  if (lastProp.current !== phase) {
    lastProp.current = phase;
    if (phase === "aim" || phase === "over" || phase === "lobby") phaseRef.current = phase;
  }
  const go = (ph: Phase) => {
    phaseRef.current = ph;
    onPhase(ph);
  };
  const { camera } = useThree();
  const camZ = useRef(2.3);

  useEffect(() => {
    apiRef.current = {
      aimX: (x) => {
        if (phaseRef.current === "aim") aim.current = THREE.MathUtils.clamp(x, -(LANE_W / 2 - tyreRef.current.r - 0.02), LANE_W / 2 - tyreRef.current.r - 0.02);
      },
      throwIt: (th) => {
        const b = ball.current;
        if (!b || phaseRef.current !== "aim" || !engineReady.current) return;
        // Decide the whole roll now, then play it back. The throw is tidied to the
        // exact numbers the server will be sent.
        const clean = cleanThrow(tyreRef.current.id, th);
        const res = simulate(RAPIER, { tyre: tyreRef.current.id, throw: clean, standing: standingRef.current }, { record: true });
        play.current = { res, frames: res.frames!, n: res.steps, t: 0 };
        onThrowRef.current?.({ tyre: tyreRef.current.id, ...clean });
        spin.current = clean.spin;
        b.p.set(clean.x, tyreRef.current.r + 0.01, START_Z);
        t.current = 0;
        settle.current = 0;
        wentGutter.current = false;
        go("rolling");
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRef, onPhase]);

  // a fresh rack stands the bottles up via remount (key); a second ball re-spots
  // whatever is still standing so a nudged bottle is not left leaning.
  const respot = useCallback(() => {
    standing.forEach((up, i) => {
      const rb = bottles.current[i];
      if (!up || !rb) return;
      rb.p.set(HOME[i][0], 0.002, HOME[i][1]);
      rb.q.identity();
      rb.v.set(0, 0, 0);
      rb.w.set(0, 0, 0);
    });
  }, [standing]);
  useEffect(() => {
    standing.forEach((up, i) => {
      if (!up) bottles.current[i] = null;
    });
    if (phase === "aim") respot();
  }, [phase, respot, rackKey, standing]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const b = ball.current;
    if (!b) return;
    // move every puppet to where the simulation had it at this moment
    const pl = play.current;
    if (pl && (phaseRef.current === "rolling" || phaseRef.current === "settling")) {
      pl.t += dt * (slowMo.current ? 0.25 : 1);
      const at = Math.min(pl.t / SIM_STEP, pl.n - 1);
      const i0 = Math.floor(at), i1 = Math.min(i0 + 1, pl.n - 1), f = at - i0;
      for (let k = 0; k <= PINS; k++) {
        const u = k === 0 ? b : bottles.current[k - 1];
        if (!u) continue;
        const a = i0 * 77 + k * 7, c = i1 * 77 + k * 7, F = pl.frames;
        if (F[a + 1] < -40) continue; // a bottle that was not on the road for this roll
        u.p.set(F[a] + (F[c] - F[a]) * f, F[a + 1] + (F[c + 1] - F[a + 1]) * f, F[a + 2] + (F[c + 2] - F[a + 2]) * f);
        qA.set(F[a + 3], F[a + 4], F[a + 5], F[a + 6]); qB.set(F[c + 3], F[c + 4], F[c + 5], F[c + 6]);
        u.q.slerpQuaternions(qA, qB, f);
        u.v.set((F[c] - F[a]) / SIM_STEP, (F[c + 1] - F[a + 1]) / SIM_STEP, (F[c + 2] - F[a + 2]) / SIM_STEP);
        u.w.set(qA.angleTo(qB) / SIM_STEP, 0, 0);
      }
    }
    const p = b.translation();
    const v = b.linvel();
    const ph = phaseRef.current;

    if (ph === "aim" || ph === "over" || ph === "lobby") {
      // hold the tyre at the release line
      // keep the tyre inside the lane even after switching to a bigger one
      const lim = LANE_W / 2 - tyreRef.current.r - 0.02;
      aim.current = THREE.MathUtils.clamp(aim.current, -lim, lim);
      b.p.set(aim.current, tyreRef.current.r + 0.01, START_Z);
      b.v.set(0, 0, 0);
      b.w.set(0, 0, 0);
      setRumble(0);
      for (const m of voice.current) m.has = false;
    } else {
      t.current += dt;
      const onRoad = Math.abs(p.x) < LANE_W / 2 && p.y > tyreRef.current.r * 0.6;
      if (!onRoad && p.z > -LANE_LEN + 0.6 && !wentGutter.current) {
        wentGutter.current = true;
        thud();
      }
      // rumble only while the tyre is rolling down the road: silent once it is through the bottles
      setRumble(ph === "rolling" && onRoad && p.z > -LANE_LEN - 0.2 ? Math.hypot(v.x, v.z) : 0);
      // Each bottle makes its own sound from its own motion. A sudden change of
      // speed in one frame is an impact (struck by the tyre or another bottle, or
      // landing on the road). A bottle lying down and turning knocks the road
      // softly once per half turn. A bottle at rest is silent.
      for (let i = 0; i < PINS; i++) {
        const rb = standing[i] ? bottles.current[i] : null; // a removed bottle's handle is dead
        const m = voice.current[i];
        if (!rb) { m.has = false; continue; }
        const l = rb.linvel(), w = rb.angvel(), q = rb.rotation(), pos = rb.translation();
        const pan = THREE.MathUtils.clamp(pos.x / 1.6, -1, 1);
        m.cool -= dt;
        if (m.has) {
          const jolt = Math.hypot(l.x - m.x, l.y - m.y, l.z - m.z);
          if (jolt > 0.55 && m.cool <= 0) {
            bottleHit(i, (jolt - 0.4) / 4.5, pan);
            m.cool = 0.11;
            m.turn = 0;
          }
        }
        const upY = 1 - 2 * (q.x * q.x + q.z * q.z); // 1 = standing, 0 = lying flat
        const spin = Math.hypot(w.x, w.y, w.z);
        if (upY < 0.45 && pos.y < 0.2 && spin > 1.2) {
          m.turn += spin * dt;
          if (m.turn > Math.PI) { m.turn = 0; if (m.cool <= 0) bottleRoll(i, spin / 14, pan); }
        }
        m.x = l.x; m.y = l.y; m.z = l.z; m.has = true;
      }
      const past = p.z < -LANE_LEN - 0.3;
      const dead = Math.hypot(v.x, v.z) < 0.35 && t.current > 1.2;
      if (ph === "rolling" && (past || dead || t.current > 9)) go("settling");
      if ((ph === "rolling" || ph === "settling") && pl && pl.t >= pl.n * SIM_STEP) {
        setRumble(0);
        phaseRef.current = "counted"; // report once
        play.current = null;
        onResult(pl.res.down, pl.res.gutter);
      }
    }

    // STRIKE CAM. The moment the last bottle goes over, the roll gets the big
    // treatment: time slows, and the camera drops beside the rack and circles up
    // and round it, so you watch every bottle down and the street going wild.
    // It fires on what really happened, never on a guess.
    if (ph === "aim") cine.armed = true;
    if ((ph === "rolling" || ph === "settling") && cine.armed && cine.t < 0 && p.z < -LANE_LEN + 0.4) {
      let left = 0;
      for (let i = 0; i < PINS; i++) {
        const rb = standing[i] ? bottles.current[i] : null;
        if (!rb) continue;
        const q = rb.rotation();
        const t = rb.translation();
        const gone = 1 - 2 * (q.x * q.x + q.z * q.z) < 0.55 || t.y < -0.06 || Math.hypot(t.x - HOME[i][0], t.z - HOME[i][1]) > 0.55;
        if (!gone) left++;
      }
      if (left === 0) {
        cine.armed = false;
        cine.t = 0;
        cine.side = p.x >= 0 ? -1 : 1;
        setSlow(true);
      }
    }
    if (cine.t >= 0) {
      cine.t += rawDt;
      const k = Math.min(1, cine.t / 3.4);
      const e = k * k * (3 - 2 * k);
      const th = cine.side * (1.35 - e * 1.15), rad = 1.9 + e * 1.7;
      const cx = Math.sin(th) * rad, cy = 0.4 + e * 1.35, cz = -LANE_LEN - 0.5 + Math.cos(th) * rad;
      const f = Math.min(1, rawDt * 7);
      camera.position.set(camera.position.x + (cx - camera.position.x) * f, camera.position.y + (cy - camera.position.y) * f, camera.position.z + (cz - camera.position.z) * f);
      camera.lookAt(0, 0.2 + e * 0.5, -LANE_LEN - 0.6);
      if (cine.t > 0.9) setSlow(false); // slow for the fall, full speed for the party
      if (cine.t > 3.6 || ph === "aim" || ph === "over") { cine.t = -1; setSlow(false); }
      else { camZ.current = camera.position.z; return; }
    }

    // camera: sits behind the release line, rides after the tyre, stops short of the bottles
    const target = ph === "aim" || ph === "over" || ph === "lobby" ? 2.3 : THREE.MathUtils.clamp(p.z + 3.2, -LANE_LEN + 3.4, 2.3);
    camZ.current += (target - camZ.current) * Math.min(1, dt * (ph === "aim" ? 3 : 5));
    const rollX = (ph === "aim" || ph === "lobby" ? aim.current * 0.35 : THREE.MathUtils.clamp(p.x * 0.35, -0.4, 0.4)) + 0.42;
    camera.position.set(rollX, 1.42 + (ph === "aim" || ph === "lobby" ? 0 : 0.28), camZ.current);
    camera.lookAt((rollX - 0.42) * 0.6, 0.32, camZ.current - 6.5);
  });

  return (
    <>
      <Tyre ball={ball} paint={tyre.paint} id={tyre.id} r={tyre.r} />
      <group key={rackKey}>
        {standing.map((up, i) => (up ? <Bottle key={i} i={i} api={bottles} /> : null))}
      </group>
    </>
  );
}

// ── The neighbours: spectators along both kerbs who jump when you strike ─────
const FAN_URL = "/world/models/fan.glb";
useGLTF.preload(FAN_URL);
const FAN_SHIRTS = ["#e11d48", "#2563eb", "#22c55e", "#f4f1ea", "#7c3aed", "#f97316", "#facc15", "#06b6d4", "#ec4899"];
const FAN_SKINS = ["#6b4226", "#8a5a3a", "#4a2d1a", "#7a4b2a"];
const FAN_PANTS = ["#23203a", "#1f3a5f", "#3a2a1a", "#2a2a2a"];
function Fan({ x, z, side, seed }: { x: number; z: number; side: number; seed: number }) {
  const { scene } = useGLTF(FAN_URL);
  const root = useRef<THREE.Group>(null);
  const built = useMemo(() => {
    let sd = (seed * 2654435761) >>> 0 || 1;
    const r = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pick = (a: string[]) => a[Math.floor(r() * a.length)];
    const col: Record<string, string> = { shirt: pick(FAN_SHIRTS), skin: pick(FAN_SKINS), pants: pick(FAN_PANTS), hair: r() < 0.3 ? pick(FAN_SHIRTS) : "#16110f", shoe: "#f4f1ea" };
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const m = scene.clone(true);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = (src: THREE.Material) => {
        let c = mats.get(src.name);
        if (!c) {
          c = (src as THREE.MeshStandardMaterial).clone();
          c.flatShading = true;
          if (col[src.name]) c.color.set(col[src.name]);
          mats.set(src.name, c);
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });
    return { m, L: m.getObjectByName("armL") ?? null, R: m.getObjectByName("armR") ?? null, phase: r() * 6.28, h: 0.92 + r() * 0.16, keen: 0.6 + r() * 0.4 };
  }, [scene, seed]);
  const st = useRef({ seen: crowd.key, mood: "" as "" | "wild" | "clap" | "boo", t0: 0, dur: 0, wait: -1, style: 0 });
  useFrame((state) => {
    const g = root.current;
    if (!g) return;
    const now = state.clock.elapsedTime;
    const s = st.current;
    if (crowd.key !== s.seen) {
      s.seen = crowd.key;
      s.wait = now + ((seed * 37) % 10) * 0.06; // each a beat apart
    }
    if (s.wait >= 0 && now >= s.wait) {
      s.wait = -1;
      s.mood = crowd.mood;
      s.t0 = now;
      s.dur = (s.mood === "wild" ? 3.6 : s.mood === "clap" ? 2 : 2.8) + ((seed * 13) % 10) * 0.1;
      s.style = (seed + crowd.key) % 3; // a different move from the neighbour, and from last time
    }
    const e = now - s.t0;
    if (s.mood && e > s.dur) s.mood = "";
    // ease in and out of the reaction so nobody snaps
    const k = s.mood ? Math.min(1, e / 0.18) * Math.min(1, (s.dur - e) / 0.4) : 0;
    const t = now * built.keen + built.phase;
    let y = 0, lean = 0, turn = Math.sin(t * 1.3) * 0.04, tilt = Math.sin(t * 1.1) * 0.03;
    let rz = 0.12, lz = -0.12, rx = 0, lx = 0;
    if (s.mood === "wild") {
      if (s.style === 0) {
        // both arms up, jumping
        y = Math.abs(Math.sin(e * 8.5)) * 0.42;
        rz = 2.75 + Math.sin(e * 17) * 0.2; lz = -rz;
      } else if (s.style === 1) {
        // fist pump, one arm then the other, quick hops
        y = Math.abs(Math.sin(e * 11)) * 0.26;
        rz = 1.5 + Math.sin(e * 11) * 1.25; lz = -(1.5 - Math.sin(e * 11) * 1.25);
        turn = Math.sin(e * 5.5) * 0.3;
      } else {
        // arms wide, spinning round on the spot between jumps
        y = Math.abs(Math.sin(e * 7)) * 0.34;
        rz = 2.1 + Math.sin(e * 9) * 0.5; lz = -(2.1 + Math.cos(e * 9) * 0.5);
        turn = e * 5.2; tilt = Math.sin(e * 7) * 0.12;
      }
    } else if (s.mood === "clap") {
      // hands together out in front, a small bounce
      const c = Math.sin(e * 15);
      rx = lx = -1.35;
      rz = -0.32 - c * 0.22; lz = 0.32 + c * 0.22;
      y = Math.abs(Math.sin(e * 7.5)) * 0.07;
    } else if (s.mood === "boo") {
      if (s.style === 0) {
        // hands on head, leaning back: "ah ah!"
        rz = 2.55; lz = -2.55; lean = -0.16; turn = Math.sin(e * 6) * 0.22;
      } else if (s.style === 1) {
        // slumped, shaking the head
        lean = 0.3; turn = Math.sin(e * 7) * 0.26; rz = 0.05; lz = -0.05;
      } else {
        // one arm thrown out at the road, then dropped
        const th = Math.max(0, 1 - e / 1.1);
        rx = -1.5 * th; rz = 0.3; lean = 0.12; tilt = -0.1;
      }
    }
    g.position.y = y * k;
    g.rotation.set(lean * k, turn * (s.mood ? k : 1), tilt);
    if (built.R) built.R.rotation.set(rx * k, 0, 0.12 + (rz - 0.12) * k);
    if (built.L) built.L.rotation.set(lx * k, 0, -0.12 + (lz + 0.12) * k);
  });
  return (
    <group position={[x, 0.08, z]} rotation={[0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0]} scale={built.h}>
      <group ref={root}>
        <primitive object={built.m} />
      </group>
    </group>
  );
}

// Real animated people in the crowd: the street's own pedestrians playing
// motion-captured clips. They stand and clap between rolls, and go wild on a
// strike. One shared set of clips is bound to each character's skeleton.
const PEOPLE = ["ch17", "ch21", "ch28", "ch06", "ch41", "ch22", "ch20", "prisoner", "ch46"].map((n) => `/world/models/peds/${n}.glb`);
const CLIPS = { idle: "/world/models/anim/idle.glb", idleStandard: "/world/models/anim/idle-standard.glb", idleLook: "/world/models/anim/idle-look.glb", idleWait: "/world/models/anim/idle-wait.glb", idleHeavy: "/world/models/anim/idle-heavy.glb", idleHeavy2: "/world/models/anim/idle-heavy2.glb", clap: "/world/models/anim/clap-standing.glb", quick: "/world/models/anim/clap.glb", happy: "/world/models/anim/cheer-happy.glb", excited: "/world/models/anim/cheer-excited.glb", rally: "/world/models/anim/cheer-rally.glb", rejected: "/world/models/anim/boo-rejected.glb", badshot: "/world/models/anim/boo-badshot.glb", sad: "/world/models/anim/sad-idle.glb" } as const;
type ClipName = keyof typeof CLIPS;
const CLIP_NAMES = Object.keys(CLIPS) as ClipName[];
// Reactions are dealt round the crowd in order, so two people standing together
// never do the same move, and the deal shifts every roll so nobody repeats.
const WILD: ClipName[] = ["happy", "clap", "excited", "rally", "quick"];
const CLAP: ClipName[] = ["clap", "idle", "quick", "happy"];
const BOO: ClipName[] = ["rejected", "sad", "badshot", "idle"];
// Everyone stands their own way while they watch: weight on one leg, looking
// round, waiting. Dealt by place in the crowd, like the reactions.
const STAND: ClipName[] = ["idleStandard", "idleLook", "idleHeavy", "idle", "idleWait", "idleHeavy2"];
const TALL = 1.78; // everyone is brought to about this height, give or take
// No blanket preload here. Each spectator fetches only their own body and the
// clips they can play, so a phone showing two people does not download nine.
const REF_HIPS = 0.979; // hip height (m) of the body the clips were recorded on
function bindClip(clip: THREE.AnimationClip, prefix: string, name: string, hips: number) {
  const c = clip.clone();
  for (const tr of c.tracks) {
    if (prefix) tr.name = tr.name.replace(/^mixamorig\d*/, prefix);
    if (/Hips\.position$/i.test(tr.name)) {
      // stay on the spot: keep the bounce, drop the drift
      const v = tr.values as unknown as Float32Array;
      // and fit the hip height to this body, so short and tall people both stand on the ground
      const k = hips > 0 && v[1] > 0 ? hips / REF_HIPS : 1;
      const x0 = v[0] * k, z0 = v[2] * k;
      for (let i = 0; i + 2 < v.length; i += 3) { v[i] = x0; v[i + 1] *= k; v[i + 2] = z0; }
    }
  }
  c.name = name;
  return c;
}
// On a phone each spectator knows four moves (stand, cheer, clap, sulk) instead of
// fourteen: about 0.5 MB of animation to fetch instead of 2.6 MB.
const LITE: ClipName[] = ["idleStandard", "happy", "clap", "rejected"];
function Person({ x, z, side, seed, who, slot, lite }: { x: number; z: number; side: number; seed: number; who: number; slot: number; lite: boolean }) {
  const model = useGLTF(PEOPLE[who % PEOPLE.length]);
  const names = lite ? LITE : CLIP_NAMES;
  const clipFiles = useGLTF(names.map((k) => CLIPS[k]));
  const built = useMemo(() => {
    const obj = skeletonClone(model.scene);
    let prefix = "";
    obj.traverse((o) => {
      const m = o.name.match(/^(mixamorig\d*)/);
      if (!prefix && m) prefix = m[1];
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        // a little of their own colour glows back, so faces and clothes read on a night street
        const lift = (src: THREE.Material) => {
          const c = (src as THREE.MeshStandardMaterial).clone();
          if (c.map) { c.emissive = new THREE.Color("#ffffff"); c.emissiveMap = c.map; c.emissiveIntensity = 0.3; }
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(lift) : lift(mesh.material);
      }
    });
    let hips = 0;
    obj.traverse((o) => { if (!hips && /Hips$/.test(o.name)) hips = o.position.y; });
    const box = new THREE.Box3().setFromObject(obj);
    const tall = box.max.y - box.min.y;
    const mixer = new THREE.AnimationMixer(obj);
    const acts = {} as Record<ClipName, THREE.AnimationAction | null>;
    CLIP_NAMES.forEach((k) => { acts[k] = null; });
    names.forEach((k, i) => {
      const src = (clipFiles as unknown as { animations: THREE.AnimationClip[] }[])[i].animations[0];
      acts[k] = src ? mixer.clipAction(bindClip(src, prefix, k, hips)) : null;
    });
    let sd = (seed * 2654435761) >>> 0 || 1;
    const r = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pick = (a: ClipName[]) => a[Math.floor(r() * a.length)];
    return { obj, mixer, acts, r, pick, size: tall > 0.5 ? (TALL * (0.94 + r() * 0.1)) / tall : 1 };
  }, [model, clipFiles, seed, names]);
  const base = lite ? "idleStandard" : STAND[slot % STAND.length];
  const st = useRef({ cur: base, seen: crowd.key, until: 0, wait: -1 });
  useEffect(() => {
    const a = built.acts[base];
    if (a) { a.play(); a.time = built.r() * 3; a.timeScale = 0.9 + built.r() * 0.2; }
    return () => { built.mixer.stopAllAction(); };
  }, [built, base]);
  const to = (name: ClipName, fade = 0.3) => {
    const s = st.current;
    if (s.cur === name) return;
    const from = built.acts[s.cur], next = built.acts[name];
    if (!next) return;
    next.reset().play();
    if (from) next.crossFadeFrom(from, fade, false);
    s.cur = name;
  };
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const now = state.clock.elapsedTime;
    if (crowd.key !== s.seen) {
      // something happened: react, each person a beat apart and in their own way
      s.seen = crowd.key;
      s.wait = now + built.r() * 0.7;
    }
    if (s.wait >= 0 && now >= s.wait) {
      s.wait = -1;
      const m = crowd.mood;
      const pool = m === "wild" ? WILD : m === "clap" ? CLAP : BOO;
      // deal from the moves this person actually has
      const have = pool.filter((n) => n === "idle" || built.acts[n]);
      const dealt = have.length ? have[(slot + crowd.key) % have.length] : "idle";
      const name = dealt === "idle" ? base : dealt; // "idle" in a pool means: this one just keeps watching
      to(name, 0.22);
      // nobody moves at quite the same pace either
      const act = built.acts[name];
      if (act && name !== base) { act.timeScale = 0.88 + built.r() * 0.3; act.time = built.r() * 0.4; }
      s.until = now + (m === "wild" ? 3.4 : m === "clap" ? 1.9 : 2.6) + built.r() * 1.2;
    } else if (s.until && now > s.until) {
      s.until = 0;
      to(base, 0.6); // back to watching, in their own stance
    }
    built.mixer.update(dt);
  });
  // face the road, turned a little toward the bottles
  return (
    <group position={[x, 0.08, z]} rotation={[0, (side < 0 ? Math.PI / 2 : -Math.PI / 2) + side * 0.35, 0]} scale={built.size}>
      <primitive object={built.obj} />
    </group>
  );
}

function Crowd({ lowPerf }: { lowPerf: boolean }) {
  const kerbX = LANE_W / 2 + GUTTER_W + 0.17;
  const spots = useMemo(() => {
    const out: { x: number; z: number; side: number; seed: number; real: boolean; who: number; slot: number }[] = [];
    let people = 0;
    const n = lowPerf ? 3 : 7;
    for (const side of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const z = -6.5 - (i / Math.max(1, n - 1)) * (LANE_LEN - 3.5) + (i % 2 ? 0.4 : -0.3);
        if (side < 0 && z > -7.4) continue; // the parked danfo stands here
        // mix: animated people at the front by the kerb, simple figures filling in behind
        const real = lowPerf ? i === n - 1 : i % 3 !== 1;
        out.push({ x: side * (kerbX + (real ? 0.62 : 1.05 + (i % 3) * 0.3)), z, side, seed: i * 7 + (side > 0 ? 100 : 1), real, who: people + (lowPerf ? 3 : 0), slot: real ? people++ : 0 });
      }
    }
    return out;
  }, [kerbX, lowPerf]);
  return (
    <group>
      {spots.map(({ real, who, slot, ...sp }) => (real ? <Person key={sp.seed} who={who} slot={slot} lite={lowPerf} {...sp} /> : <Fan key={sp.seed} {...sp} />))}
    </group>
  );
}

// Confetti over the bottles when the street cheers.
function Confetti() {
  const N = 90;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), life: 0 })), []);
  const seen = useRef(cheer.key); // not 0: a strike from an earlier visit must not fire confetti on re-entry
  const d = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) m.setColorAt(i, c.set(BULBS[i % BULBS.length]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    cheer.t = Math.max(0, cheer.t - dt * 0.42);
    const m = mesh.current;
    if (!m) return;
    if (cheer.key !== seen.current) {
      seen.current = cheer.key;
      for (const q of parts) {
        q.p.set((Math.random() - 0.5) * 1.4, 0.3 + Math.random() * 0.4, -LANE_LEN - ROW * 1.5 + (Math.random() - 0.5) * 1.2);
        q.v.set((Math.random() - 0.5) * 4.2, 4 + Math.random() * 4.5, (Math.random() - 0.5) * 3 + 1.2);
        q.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        q.life = 1.6 + Math.random() * 1.2;
      }
    }
    for (let i = 0; i < N; i++) {
      const q = parts[i];
      if (q.life > 0) {
        q.life -= dt;
        q.v.y -= 7.5 * dt;
        q.v.multiplyScalar(1 - 0.9 * dt);
        q.p.addScaledVector(q.v, dt);
        q.r.x += dt * 9;
        q.r.z += dt * 7;
        d.position.copy(q.p);
        d.rotation.set(q.r.x, q.r.y, q.r.z);
        d.scale.setScalar(q.p.y < 0.02 ? 0 : 1);
      } else d.scale.setScalar(0);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false}>
      <planeGeometry args={[0.09, 0.14]} />
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}

// Optional scenery: suspends on its own and, if a file fails, simply is not there.
class SceneryGuard extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };
  static getDerivedStateFromError() { return { dead: true }; }
  render() { return this.state.dead ? null : this.props.children; }
}
function Scenery({ children }: { children: ReactNode }) {
  return <SceneryGuard><Suspense fallback={null}>{children}</Suspense></SceneryGuard>;
}

// ── Page shell: canvas + HUD + input ─────────────────────────────────────────
export default function Game() {
  // Ranked solo games: the throws go to the server, which replays them through
  // the same simulation and records the score on-chain (hooks/useRankedRun.ts).
  const ranked = useRankedRun("strike");
  const gate = useGuestGate("strike", "Street Strike");
  const rankedRef = useRef(ranked);
  rankedRef.current = ranked;
  const throwLog = useRef<{ tyre: string; x: number; angle: number; speed: number; spin: number }[]>([]);
  const gameT0 = useRef(0);
  const [rankedGame, setRankedGame] = useState(false);
  const [quitAsk, setQuitAsk] = useState(false); // "End this game?": leaving a ranked game ends it, it does not throw it away
  const endedRef = useRef(false); // the game was ended early: a tyre still rolling must not add to the closed card
  const onThrow = useCallback((t: { tyre: string; x: number; angle: number; speed: number; spin: number }) => { throwLog.current.push(t); }, []);
  // Who is playing. One list of rolls per seat; `turn` is the seat on the line.
  const [mode, setMode] = useState<Mode>("solo");
  const [level, setLevel] = useState(1); // CPU: 0 easy, 1 medium, 2 hard
  const [setup, setSetup] = useState(true); // the "how do you want to play" sheet
  // ── watching someone else's lane (/bowling?watch=…) ──────────────────────
  // The page plays the followed player's throws through this same street, so a
  // watcher sees the real tyre and the real bottles. Nothing can be thrown.
  const [watchId, setWatchId] = useState("");
  const watching = !!watchId; const watchingRef = useRef(false); watchingRef.current = watching;
  const [lane, setLane] = useState<Room | null>(null);   // the lane being watched
  const [laneGone, setLaneGone] = useState(false);
  const [follow, setFollow] = useState(0);                // whose card is on screen
  const [lineUp, setLineUp] = useState(false);            // true while the server is pushing the lane to us
  const [kick, setKick] = useState(0);
  // Online: a room on the server. Everyone in it bowls at once on their own phone.
  const [room, setRoom] = useState<Room | null>(null);
  const sess = useRef<Session | null>(null);
  const roundRef = useRef(0);
  const [nick, setNick] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [netErr, setNetErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const online = mode === "online";
  const seats = useMemo(() => (mode === "online" && room ? room.players.map((p) => ({ name: p.name, cpu: false })) : seatsFor(mode)), [mode, room]);
  const [allRolls, setAllRolls] = useState<number[][]>([[]]);
  const allRef = useRef<number[][]>([[]]);
  const [turn, setTurn] = useState(0);
  const turnRef = useRef(0);
  const modeRef = useRef<Mode>("solo");
  const [handoff, setHandoff] = useState(false); // pass-the-phone: wait for the next player to say ready
  const [hint, setHint] = useState<string | null>(null);
  const [slow, setSlow] = useState(false); // strike cam: time runs at a quarter speed
  const slowRef = useRef(false);
  const setSlowOnce = useCallback((on: boolean) => { if (slowRef.current !== on) { slowRef.current = on; setSlow(on); } }, []);
  const [pickOpen, setPickOpen] = useState(false);
  const [idle, setIdle] = useState(false); // nobody has rolled for a while: show how again
  const [touch] = useState(() => typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0));
  const rolls = allRolls[turn] ?? [];
  const [phase, setPhase] = useState<Phase>("aim");
  const [standing, setStanding] = useState<boolean[]>(() => Array(PINS).fill(true));
  const [rackKey, setRackKey] = useState(0);
  const [banner, setBanner] = useState<{ text: string; tone: "big" | "good" | "bad"; key: number } | null>(null);
  const [mute, setMute] = useState(false);
  const [started, setStarted] = useState(false);
  // Known on the very first render (this page never renders on the server), so a
  // phone gets the light renderer and the small crowd from the start.
  const [isMobile] = useState(() => typeof navigator !== "undefined" && (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 760));
  const [best, setBest] = useState<number | null>(null);
  const [beat, setBeat] = useState(false); // this game beat the best that stood before it
  const [tyreIx, setTyreIx] = useState(0);
  const tyre = TYRES[tyreIx];
  const apiRef = useRef<Api | null>(null);
  const standingRef = useRef(standing);
  standingRef.current = standing;
  const s: ScoreState = useMemo(() => score(rolls, FRAMES), [rolls]);
  // online, the other players' cards come from the server; mine is always my own
  const cards = useMemo(() => seats.map((_, i) => score(online && room && i !== turn ? room.players[i]?.rolls ?? [] : allRolls[i] ?? [], FRAMES)), [seats, allRolls, online, room, turn]);
  const allOver = online ? room?.status === "over" : true;
  const meIx = online ? turn : mode === "cpu" ? 0 : -1;
  const me = seats[turn] ?? seats[0];
  const canPlay = phase === "aim" && !setup && !handoff && !me.cpu && !watching;
  const turnLabel = online ? "Your lane" : me.name === "You" ? "Your turn" : `${me.name}'s turn`;

  useEffect(() => {
    try {
      const b = Number(localStorage.getItem("streetstrike.best"));
      if (b > 0) setBest(b);
    } catch { /* ignore */ }
    return () => closeSfx();
  }, []);

  const say2 = (text: string, tone: "big" | "good" | "bad") => setBanner({ text, tone, key: Date.now() });

  const onResult = useCallback((down: boolean[], gutter: boolean) => {
    if (endedRef.current) return;
    const before = standingRef.current;
    const count = down.filter(Boolean).length;
    const seat = turnRef.current;
    const prevFrame = score(allRef.current[seat] ?? [], FRAMES).frame;
    const nextRolls = [...(allRef.current[seat] ?? []), count];
    allRef.current = allRef.current.map((r, i) => (i === seat ? nextRolls : r));
    const st = score(nextRolls, FRAMES);
    // With more than one seat, players swap after each frame. Whoever still has
    // frames left goes next; when nobody does, the game is over.
    const live = modeRef.current === "online"; // online, nobody swaps: this lane is mine alone
    const n = live ? 1 : allRef.current.length;
    let next = seat;
    if (n > 1 && (st.done || st.frame > prevFrame)) {
      next = -1;
      for (let k = 1; k <= n; k++) { const c = (seat + k) % n; if (!score(allRef.current[c], FRAMES).done) { next = c; break; } }
    }
    const allDone = n > 1 ? next === -1 : st.done;
    const cleared = before.filter(Boolean).length === count;
    const mark = [...st.frames].reverse().find((f) => f.marks.length)?.marks.slice(-1)[0];
    if (mark === "X") {
      say2(say("strike"), "big");
      cheer.t = 1.7;
      cheer.key++;
      react("wild");
      buzz([40, 40, 40, 40, 140]);
    } else if (mark === "/" || cleared) {
      say2(say("spare"), "good");
      cheer.t = 1.1;
      cheer.key++;
      react("wild", "yeah");
      buzz([30, 40, 80]);
    } else if (gutter) {
      say2(say("gutter"), "bad");
      react("boo");
      buzz(120);
    } else if (count >= 7) {
      cheer.t = 0.6;
      react("clap");
      say2(`${count}! ${say("good")}`, "good");
    }
    else {
      if (count <= 2) react("boo");
      say2(count === 0 ? "Zero! " + say("weak") : `${count} down`, count === 0 ? "bad" : "good");
    }

    setAllRolls(allRef.current);
    setHint(null);
    if (live && sess.current) net.roll(sess.current, nextRolls, throwLog.current.slice()).then(setRoom).catch(() => { /* the next poll sends it again */ });
    if (allDone) {
      setPhase("over");
      if (process.env.NODE_ENV !== "production") (window as unknown as { __strikeProbe?: (x: unknown) => void }).__strikeProbe?.({ mode: modeRef.current, total: score(allRef.current[0], FRAMES).total, throws: throwLog.current.slice() });
      if (modeRef.current === "solo" && rankedRef.current.hasTicket()) {
        void rankedRef.current.finish({ score: score(allRef.current[0], FRAMES).total, gameTime: Date.now() - gameT0.current, proof: { strikeThrows: throwLog.current.slice() } });
      }
      // your best is your own score: seat 0, and never in pass-the-phone
      if (modeRef.current !== "pass" && !watchingRef.current) try {
        const mine = score(allRef.current[live ? seat : 0], FRAMES).total;
        const prev = Number(localStorage.getItem("streetstrike.best")) || 0;
        if (mine > prev) {
          localStorage.setItem("streetstrike.best", String(mine));
          setBest(mine);
          setBeat(true);
        }
      } catch { /* ignore */ }
      return;
    }
    // hold on the result for a beat, then set up the next roll
    window.setTimeout(() => {
      if (next !== seat) {
        // the next player always starts on a full rack
        turnRef.current = next;
        setTurn(next);
        setStanding(Array(PINS).fill(true));
        setRackKey((k) => k + 1);
        const who = seatsFor(modeRef.current)[next];
        if (modeRef.current === "pass") setHandoff(true);
        else say2(who.cpu ? "CPU's turn" : "Your turn", "good");
      } else if (st.freshRack) {
        setStanding(Array(PINS).fill(true));
        setRackKey((k) => k + 1);
      } else {
        setStanding(before.map((up, i) => up && !down[i]));
      }
      setPhase("aim");
    }, cleared ? 3000 : 1000); // a cleared rack holds longer: the strike camera is still circling
  }, []);

  /** Leave a ranked game part-way: the throws not made count as misses, the card is
   *  closed and handed in. The server replays the throws and works out the same total. */
  const endNow = () => {
    setQuitAsk(false);
    endedRef.current = true;
    const made = allRef.current[0] ?? [];
    track("run_quit", { game: "Street Strike", saved: made.reduce((a, b) => a + b, 0) > 0, ranked: true });
    const card = made.slice();
    for (let k = 0; k < 16 && !score(card, FRAMES).done; k++) card.push(0);
    allRef.current = [card];
    setAllRolls(allRef.current);
    setHint(null);
    setPhase("over");
    if (rankedRef.current.hasTicket() && made.reduce((a, b) => a + b, 0) > 0) {
      void rankedRef.current.finish({ score: score(card, FRAMES).total, gameTime: Date.now() - gameT0.current, proof: { strikeThrows: throwLog.current.slice(), endedEarly: true } });
    }
  };

  const restart = (m: Mode = modeRef.current) => {
    endedRef.current = false;
    throwLog.current = [];
    gameT0.current = Date.now();
    setRankedGame(false);
    // a solo game by a signed-in player is ranked; the ticket is opened in the
    // background so the first throw is never held up
    if (m === "solo" && !watchingRef.current && rankedRef.current.canRank) void rankedRef.current.start().then((o) => { if (o.success) { gameT0.current = Date.now(); setRankedGame(true); } else toast("This game is not ranked: the game server could not open it. You can still play."); }).catch(() => toast("This game is not ranked: the game server could not open it. You can still play."));
    modeRef.current = m;
    setMode(m);
    allRef.current = seatsFor(m).map(() => []);
    setAllRolls(allRef.current);
    turnRef.current = 0;
    setTurn(0);
    setHandoff(false);
    setHint(null);
    setStanding(Array(PINS).fill(true));
    setRackKey((k) => k + 1);
    setBanner(null);
    setBeat(false);
    setPhase("aim");
  };

  // ── watching: follow the lane, and play its throws ─────────────────────────
  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("watch") || "";
    if (/^[0-9a-f]{8}$/.test(w)) setWatchId(w); else if (/^[A-Za-z0-9]{5}$/.test(w)) setWatchId(w.toUpperCase());
  }, []);
  useEffect(() => {
    if (!watchId) return;
    let live = true; let up = false;
    setSetup(false); // a watcher never sees the "how do you want to play" sheet
    track("room_watched", { game: "Street Strike" });
    const look = () => { if (up) return; net.watch(watchId).then((v) => { if (live) setLane(v); }).catch((e: Error) => { if (live && e.message === "no_room") setLaneGone(true); }); };
    const sock = openRoomSocket<Room>({ watch: watchId }, { view: (v) => { if (live) setLane(v); }, gone: () => { if (live) setLaneGone(true); }, state: (x) => { up = x; setLineUp(x); if (!x) look(); } }, "strike");
    look(); const id = window.setInterval(look, 1200);
    return () => { live = false; window.clearInterval(id); sock.close(); };
  }, [watchId]);

  // How far this screen has got through the followed player's throws, and which
  // round and seat that count belongs to.
  const played = useRef(0); const shown = useRef({ round: -1, seat: -1 });
  const followed = lane?.players[follow]; const shots = followed?.throws ?? []; const laneRolls = followed?.rolls ?? [];
  /** Put the card and the rack where they stand after the first `k` rolls, with
   *  no animation: used to join a game part-way, to switch player, and to catch
   *  up when this screen has fallen behind. The rack is found by replaying the
   *  throws since the last fresh one. */
  const jumpTo = useCallback(async (k: number, rolls: number[], throws: { tyre: string; x: number; angle: number; speed: number; spin: number }[]) => {
    const done = rolls.slice(0, k);
    let from = k; while (from > 0 && !score(done.slice(0, from), FRAMES).freshRack) from--;
    let rack = Array(PINS).fill(true) as boolean[];
    if (from < k) {
      try { await RAPIER.init(); } catch { /* the rack is shown full if the engine cannot load */ }
      for (let i = from; i < k; i++) {
        const t = throws[i];
        if (t) { try { const res = simulate(RAPIER, { tyre: t.tyre, throw: cleanThrow(t.tyre, t), standing: rack }); rack = rack.map((upright, j) => upright && !res.down[j]); continue; } catch { /* fall through to a count */ } }
        let left = done[i] ?? 0; rack = rack.map((upright) => (upright && left-- > 0 ? false : upright)); // an older phone sent no throw: knock down the right number
      }
    }
    modeRef.current = "solo"; setMode("solo");
    allRef.current = [done]; setAllRolls(allRef.current);
    turnRef.current = 0; setTurn(0); setHandoff(false); setHint(null); setBanner(null); setBeat(false);
    setStanding(rack); setRackKey((x) => x + 1);
    throwLog.current = []; played.current = k;
    setPhase(score(done, FRAMES).done ? "over" : "aim");
  }, []);
  useEffect(() => {
    if (!watching || !lane) return;
    setSetup(false);
    if (phase !== "aim" && phase !== "over") return; // a roll is playing: let it land first
    if (lane.status === "waiting") { if (shown.current.round !== -2) { shown.current = { round: -2, seat: follow }; void jumpTo(0, [], []); } return; }
    // a new round, another player, or this screen is more than a throw behind: go straight to where they are
    const behind = Math.min(shots.length, laneRolls.length) - played.current;
    const stale = shots.length < laneRolls.length; // rolls with no throws to replay
    if (shown.current.round !== lane.round || shown.current.seat !== follow || behind > 2 || (stale && played.current !== laneRolls.length) || played.current > laneRolls.length) {
      const first = shown.current.round !== lane.round || shown.current.seat !== follow;
      shown.current = { round: lane.round, seat: follow };
      // joining a lane: show the last throw happen, so the watcher has something to see at once
      void jumpTo(stale ? laneRolls.length : Math.max(0, first ? shots.length - 1 : shots.length - 1), laneRolls, shots);
      return;
    }
    if (phase !== "aim" || played.current >= shots.length) return;
    const next = shots[played.current];
    const ix = Math.max(0, TYRES.findIndex((t) => t.id === next.tyre));
    if (ix !== tyreIx) { setTyreIx(ix); return; } // the tyre they chose, then the throw on the next pass
    const before = throwLog.current.length;
    apiRef.current?.throwIt({ x: next.x, angle: next.angle, speed: next.speed, spin: next.spin });
    if (throwLog.current.length > before) played.current += 1;
    else { const t = window.setTimeout(() => setKick((x) => x + 1), 350); return () => window.clearTimeout(t); } // the street is still loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, lane, follow, phase, tyreIx, kick, jumpTo]);

  // ── swipe to roll ──────────────────────────────────────────────────────────
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);
  const finger = useRef<number | null>(null);
  const toLaneX = (px: number, w: number) => ((px / w) - 0.5) * LANE_W * 1.15;
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    armSfx();
    if (!canPlay) return;
    setIdle(false);
    // one finger owns a swipe. A second finger used to get mixed into the same
    // trail and could fire a full-power throw nobody made.
    if (finger.current !== null) return;
    finger.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    trail.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    apiRef.current?.aimX(toLaneX(e.clientX, window.innerWidth));
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== finger.current || !trail.current.length) return;
    trail.current.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    // until the finger starts going up, dragging just positions the tyre
    const a = trail.current[0];
    if (a.y - e.clientY < 24) {
      apiRef.current?.aimX(toLaneX(e.clientX, window.innerWidth));
      trail.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    }
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== finger.current) return;
    finger.current = null;
    armSfx(); // wakes the sound again if the phone put it to sleep
    const pts = trail.current;
    trail.current = [];
    if (pts.length < 2 || !canPlay) return;
    const a = pts[0];
    const b = { x: e.clientX, y: e.clientY, t: performance.now() };
    const dy = a.y - b.y;
    if (dy < 36) { // a tap or a sideways drag: just positioning
      if (dy > 8 || pts.length > 4) setHint("Swipe UP toward the bottles, a bit longer");
      return;
    }
    const dx = b.x - a.x;
    const ms = Math.max(40, b.t - a.t);
    const speed = SPEED_MIN + Math.min(1, Math.max(0, (dy / ms - 0.35) / 1.7)) * (SPEED_MAX - SPEED_MIN);
    const angle = Math.atan2(dx, dy) * 0.22;
    // hook = how much the swipe bent: compare its first and second halves
    const mid = pts[Math.floor(pts.length / 2)];
    const d1 = Math.atan2(mid.x - a.x, Math.max(1, a.y - mid.y));
    const d2 = Math.atan2(b.x - mid.x, Math.max(1, mid.y - b.y));
    const spin = THREE.MathUtils.clamp((d2 - d1) * 26, -20, 20);
    setStarted(true);
    apiRef.current?.throwIt({ x: toLaneX(a.x, window.innerWidth), angle, speed, spin });
  };

  // keyboard: left / right to line up, space or enter to roll
  const keyX = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canPlay || (e.target as HTMLElement)?.tagName === "BUTTON") return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        keyX.current = THREE.MathUtils.clamp(keyX.current + (e.key === "ArrowLeft" ? -0.08 : 0.08), -LANE_W / 2, LANE_W / 2);
        apiRef.current?.aimX(keyX.current);
        e.preventDefault();
      } else if ((e.key === " " || e.key === "Enter") && !watchingRef.current) {
        armSfx();
        setStarted(true);
        apiRef.current?.throwIt({ x: keyX.current, angle: 0, speed: 8.6, spin: 0 });
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPlay]);

  // ── online room ────────────────────────────────────────────────────────────
  const beginRound = useCallback((v: Room) => {
    roundRef.current = v.round;
    throwLog.current = []; // this round's throws, sent with each roll so the lane can be watched
    modeRef.current = "online";
    allRef.current = v.players.map(() => []);
    setAllRolls(allRef.current);
    turnRef.current = v.you;
    setTurn(v.you);
    setStanding(Array(PINS).fill(true));
    setRackKey((k) => k + 1);
    setBanner(null);
    setBeat(false);
    setHandoff(false);
    setHint(null);
    setPhase("aim");
    setSetup(false);
  }, []);
  const takeRoom = useCallback((v: Room) => {
    setRoom(v);
    if (v.status === "playing" && v.round !== roundRef.current && v.you >= 0) beginRound(v);
    // a roll the server never got (a dropped request) is sent again here
    const mine = allRef.current[v.you] ?? [];
    if (v.status === "playing" && v.round === roundRef.current && v.you >= 0 && sess.current && (v.players[v.you]?.rolls.length ?? 0) < mine.length) net.roll(sess.current, mine, throwLog.current.slice()).catch(() => {});
  }, [beginRound]);
  const leaveRoom = useCallback(() => {
    if (sess.current) net.leave(sess.current);
    sess.current = null;
    roundRef.current = 0;
    setRoom(null);
    setNetErr(null);
  }, []);
  const hasRoom = !!room;
  useEffect(() => {
    if (!hasRoom) return;
    let live = true;
    const tick = () => {
      const s0 = sess.current;
      if (!s0) return;
      net.get(s0).then((v) => { if (live && sess.current === s0) takeRoom(v); }).catch((e: Error) => {
        if (live && e.message === "no_room") { leaveRoom(); setNetErr("The room closed."); setSetup(true); }
      });
    };
    // the live line pushes the lane the moment a roll lands; asking is the fallback when it is down
    let up = false; const s1 = sess.current;
    const sock = s1 ? openRoomSocket<Room>({ code: s1.code, token: s1.token }, { view: (v) => { if (live && sess.current === s1) takeRoom(v); }, state: (x) => { up = x; } }, "strike") : null;
    const id = window.setInterval(() => { if (!up) tick(); }, 1500);
    const slow = window.setInterval(tick, 9000);
    return () => { live = false; window.clearInterval(id); window.clearInterval(slow); sock?.close(); };
  }, [hasRoom, takeRoom, leaveRoom]);
  const enterRoom = async (how: "create" | "join") => {
    const who = nick.trim() || "Player";
    try { localStorage.setItem("streetstrike.name", who); } catch { /* ignore */ }
    setBusy(true);
    setNetErr(null);
    try {
      const s1 = how === "create" ? await net.create(who) : await net.join(joinCode.trim().toUpperCase(), who);
      sess.current = s1;
      takeRoom(await net.get(s1));
    } catch (e) {
      sess.current = null;
      setNetErr(explain((e as Error).message));
    }
    setBusy(false);
  };
  const hostDo = async (what: "start" | "rematch") => {
    if (!sess.current) return;
    setBusy(true);
    setNetErr(null);
    try { takeRoom(await net[what](sess.current)); } catch (e) { setNetErr(explain((e as Error).message)); }
    setBusy(false);
  };
  const shareUrl = room && typeof window !== "undefined" ? `${window.location.origin}/bowling?room=${room.code}` : "";
  // a shared link opens straight on the join form with the code filled in
  useEffect(() => {
    try {
      const n = localStorage.getItem("streetstrike.name");
      if (n) setNick(n);
      const c = new URLSearchParams(window.location.search).get("room");
      if (c && /^[A-Za-z0-9]{5}$/.test(c)) { setMode("online"); setJoinCode(c.toUpperCase()); }
    } catch { /* ignore */ }
    return () => { if (sess.current) net.leave(sess.current); };
  }, []);

  // If a player is on the line and nothing happens for a few seconds, play the
  // "how to roll" demo again. Most people who stall simply do not know the move.
  useEffect(() => {
    setIdle(false);
    if (!canPlay) return;
    const id = window.setTimeout(() => setIdle(true), 5000);
    return () => window.clearTimeout(id);
  }, [canPlay, rolls.length, turn, tyreIx]);

  // The computer's roll. It aims at the middle of whatever is still standing and
  // misses by an amount set by the difficulty, so Easy really is beatable.
  useEffect(() => {
    if (phase !== "aim" || setup || !me.cpu) return;
    const id = window.setTimeout(() => {
      const up = standingRef.current.map((u, i) => (u ? HOME[i][0] : null)).filter((v): v is number => v !== null);
      const aim = up.length ? up.reduce((a, b) => a + b, 0) / up.length : 0;
      const miss = [0.5, 0.27, 0.1][level] ?? 0.27;
      const r = () => Math.random() * 2 - 1;
      apiRef.current?.throwIt({ x: THREE.MathUtils.clamp(aim + r() * miss, -LANE_W / 2, LANE_W / 2), angle: r() * miss * 0.08, speed: 8.2 + Math.random() * 1.6, spin: r() * 4 * (1 - level * 0.3) });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [phase, setup, me.cpu, turn, rolls.length, level]);

  // dev hook for automated play-tests
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __bowl?: unknown }).__bowl = {
      throwIt: (t: Throw) => apiRef.current?.throwIt(t),
      setTyre: (i: number) => setTyreIx(i),
      sound: () => ({ ...sfxCount }),
      start: (m: Mode, lv = 1) => { setLevel(lv); restart(m); setSetup(false); },
      ready: () => setHandoff(false),
      room: () => room,
      state: () => ({ phase, mode: modeRef.current, turn: turnRef.current, handoff, setup, all: allRef.current, totals: allRef.current.map((r) => score(r, FRAMES).total), rolls: allRef.current[turnRef.current], total: score(allRef.current[turnRef.current], FRAMES).total, standing: standingRef.current.filter(Boolean).length, done: allRef.current.every((r) => score(r, FRAMES).done) }),
    };
  });

  // the three tyres as cards: used in the start sheet and in the swap sheet
  const tyreCards = (
    <>
          {TYRES.map((t, i) => {
            const on = i === tyreIx;
            return (
              <button key={t.id} onClick={() => { setTyreIx(i); setPickOpen(false); }} aria-pressed={on} style={{ pointerEvents: "auto", cursor: "pointer", flex: "1 1 0", minWidth: 0, maxWidth: 150, padding: "8px 6px 9px", borderRadius: 14, textAlign: "center", color: "#fff", background: on ? "linear-gradient(180deg, #7c3aed, #5b21b6)" : "#2a1a52", border: `1px solid ${on ? GA.goldLight : "rgba(255,255,255,0.16)"}`, boxShadow: on ? "0 0 16px -4px rgba(251,191,36,0.7)" : "none", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>
                <div style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 5 }}>
                  {t.paint.map((c, k) => <i key={k} style={{ width: 14, height: 5, borderRadius: 3, background: c }} />)}
                </div>
                <div style={{ fontFamily: DISPLAY, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                <div style={{ fontSize: 10.5, fontWeight: 500, color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 6 }}>{t.note}</div>
                {([["Power", t.power, "#ff8a4a"], ["Curve", t.curve, "#c084fc"], ["Control", t.control, "#4ade80"]] as const).map(([label, n, c]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                    <span style={{ width: 40, textAlign: "left", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.04em", color: "rgba(255,255,255,0.9)" }}>{label}</span>
                    <span style={{ flex: 1, display: "flex", gap: 2 }} aria-label={`${label} ${n} of 5`}>
                      {[1, 2, 3, 4, 5].map((k) => <i key={k} style={{ flex: 1, height: 5, borderRadius: 2, background: k <= n ? c : "rgba(255,255,255,0.22)" }} />)}
                    </span>
                  </div>
                ))}
              </button>
            );
          })}
    </>
  );
  const tone = banner?.tone === "big" ? GA.goldLight : banner?.tone === "bad" ? "#ff8a8a" : "#8ff0a4";
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: GA.purpleNight, touchAction: "none", fontFamily: BODY }}>
      <Canvas shadows={!isMobile} dpr={[1, 2]} gl={{ antialias: !isMobile, powerPreference: "high-performance" }} camera={{ position: [0, 1.45, 2.4], fov: 50, near: 0.1, far: 140 }}
        onCreated={({ gl, camera }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.outputColorSpace = THREE.SRGBColorSpace; camera.lookAt(0, 0.32, -4.1); /* down the road while models load, not at the floor */ }}>
        {/* sharp where the phone can take it, softer where it cannot: the same check UP NEPA 3D uses */}
        <AutoSharpness game="Street Strike" />
        <NightRig lowPerf={isMobile} />
        <Street lowPerf={isMobile} />
        {/* Scenery loads on its own. The tyre and bottles must never wait for the
            crowd, and a spectator file that fails to load must not take the game down. */}
        <Scenery>
          {/* a danfo parked on the kerb with its lamps on: someone always stops to watch */}
          <group position={[-(LANE_W / 2 + GUTTER_W + 2.2), 0.08, -4.2]} rotation={[0, 0.05, 0]}>
            <DanfoBus variant={7} full={0.45} />
          </group>
        </Scenery>
        <Scenery>
          <Crowd lowPerf={isMobile} />
        </Scenery>
        <Scenery>
          <Billboards lowPerf={isMobile} />
        </Scenery>
        <Suspense fallback={null}>
          <Brain phase={phase} standing={standing} apiRef={apiRef} onResult={onResult} onPhase={setPhase} rackKey={rackKey} tyre={tyre} setSlow={setSlowOnce} onThrow={onThrow} />
          <Confetti />
        </Suspense>
        {!isMobile && (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom luminanceThreshold={0.72} luminanceSmoothing={0.2} intensity={0.85} mipmapBlur />
            <Vignette offset={0.28} darkness={0.62} />
          </EffectComposer>
        )}
      </Canvas>

      {/* swipe surface */}
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(e) => { if (e.pointerId === finger.current) { finger.current = null; trail.current = []; } }} style={{ position: "absolute", inset: 0, zIndex: 5, cursor: phase === "aim" ? "grab" : "default" }} />

      {/* top bar */}
      <div style={{ position: "absolute", top: "calc(12px + env(safe-area-inset-top))", left: 12, right: 12, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "space-between", pointerEvents: "none" }}>
        <Link href="/dashboard" onClick={(e) => { if (rankedGame && mode === "solo" && phase !== "over" && !setup && (allRef.current[0]?.length ?? 0) > 0) { e.preventDefault(); setQuitAsk(true); } }} style={{ ...chip, pointerEvents: "auto", textDecoration: "none" }}>← Arena</Link>
        <div style={{ fontFamily: DISPLAY, fontSize: 18, color: "#fff", textShadow: "0 2px 12px rgba(124,58,237,0.8)" }}>
          Street <span style={{ color: GA.goldLight }}>Strike</span>
        </div>
        <button onClick={() => { setMute(!mute); setMuted(!mute); }} style={{ ...chip, pointerEvents: "auto", cursor: "pointer" }} aria-label={mute ? "Unmute" : "Mute"}>{mute ? "🔇" : "🔊"}</button>
      </div>

      {/* scorecard: one row of frames each. The row that is lit is the player on the line. */}
      <div style={{ position: "absolute", top: "calc(58px + env(safe-area-inset-top))", left: 0, right: 0, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, pointerEvents: "none", opacity: setup ? 0 : 1, transition: "opacity .3s" }}>
        {cards.map((card, p) => {
          const duel = seats.length > 1;
          const mine = !duel || p === turn;
          return (
            <div key={p} style={{ display: "flex", alignItems: "stretch", gap: duel ? 4 : 5, padding: duel ? "4px 6px" : 0, borderRadius: 14, background: duel ? (mine && phase !== "over" ? "linear-gradient(180deg, rgba(124,58,237,0.6), rgba(42,18,64,0.86))" : "rgba(10,1,32,0.6)") : "none", border: duel ? `1.5px solid ${mine && phase !== "over" ? GA.goldLight : "rgba(255,255,255,0.1)"}` : "none", boxShadow: duel && mine && phase !== "over" ? "0 0 18px rgba(251,191,36,0.35)" : "none", opacity: duel && !mine && phase !== "over" ? 0.72 : 1, transition: "all .25s" }}>
              {duel && (
                <div style={{ width: 62, display: "flex", flexDirection: "column", justifyContent: "center", color: "#fff", paddingLeft: 2 }}>
                  <div style={{ fontFamily: DISPLAY, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{seats[p].name}</div>
                  <div style={{ fontSize: 9, letterSpacing: "0.1em", fontWeight: 600, color: mine && phase !== "over" ? GA.goldLight : "rgba(244,241,234,0.5)" }}>{online ? (p === turn ? "YOU" : room?.players[p]?.away ? "AWAY" : card.done ? "DONE" : `FRAME ${card.frame + 1}`) : mine && phase !== "over" ? "ROLLING" : card.done ? "DONE" : "WAITING"}</div>
                </div>
              )}
              {card.frames.map((f, i) => {
                const active = mine && !card.done && i === card.frame;
                return (
                  <div key={i} style={{ width: duel ? (i === FRAMES - 1 ? 50 : 38) : (i === FRAMES - 1 ? 74 : 56), borderRadius: duel ? 8 : 12, padding: duel ? "2px 3px 3px" : "5px 6px 6px", textAlign: "center", color: "#fff", background: active ? "linear-gradient(180deg, rgba(124,58,237,0.75), rgba(42,18,64,0.9))" : "rgba(10,1,32,0.72)", border: `1px solid ${active ? GA.goldLight : "rgba(255,255,255,0.14)"}`, boxShadow: active && !duel ? "0 0 14px rgba(251,191,36,0.4)" : "none" }}>
                    {!duel && <div style={{ fontSize: 9.5, letterSpacing: "0.12em", opacity: 0.6 }}>{i + 1}</div>}
                    <div style={{ fontFamily: DISPLAY, fontSize: duel ? 11.5 : 15, minHeight: duel ? 15 : 20, color: f.marks.includes("X") ? GA.goldLight : f.marks.includes("/") ? "#8ff0a4" : "#fff" }}>{f.marks.join(" ") || " "}</div>
                    <div style={{ fontFamily: DISPLAY, fontSize: duel ? 12.5 : 17, minHeight: duel ? 16 : 22, fontVariantNumeric: "tabular-nums" }}>{f.total ?? ""}</div>
                  </div>
                );
              })}
              {duel && <div style={{ width: 40, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontSize: 19, color: GA.goldLight, fontVariantNumeric: "tabular-nums" }}>{card.total}</div>}
            </div>
          );
        })}
      </div>

      {/* banner */}
      {banner && (
        <div key={banner.key} style={{ position: "absolute", top: "30%", left: 0, right: 0, zIndex: 12, textAlign: "center", pointerEvents: "none", fontFamily: DISPLAY, fontSize: banner.text.length > 14 ? "clamp(20px,6.2vw,40px)" : banner.tone === "big" ? "clamp(34px,10vw,64px)" : "clamp(24px,7vw,40px)", padding: "0 12px", color: tone, textShadow: "0 4px 0 rgba(0,0,0,0.35), 0 0 30px rgba(0,0,0,0.6)", animation: "ssPop 1.5s ease-out forwards" }}>
          {banner.text}
        </div>
      )}

      {/* whose turn it is, and what to do. Always on screen while a roll is owed. */}
      {phase === "aim" && !setup && !handoff && (
        <div style={{ position: "absolute", bottom: "calc(58px + env(safe-area-inset-bottom))", left: 0, right: 0, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none" }}>
          <div style={{ ...chip, fontSize: 14, borderColor: me.cpu ? "rgba(255,255,255,0.18)" : GA.goldLight }}>
            {me.cpu ? "CPU is rolling…" : <><b style={{ color: GA.goldLight, fontWeight: 400 }}>{turnLabel}</b>{` · Frame ${Math.min(s.frame + 1, FRAMES)} · Roll ${s.ball + 1}`}</>}
          </div>
          {!me.cpu && hint && <div style={{ ...chip, fontFamily: BODY, fontWeight: 500, fontSize: 13, background: "rgba(10,1,32,0.78)", textAlign: "center", lineHeight: 1.35, maxWidth: "86%" }}>{hint ?? (touch ? "Slide to pick your spot · swipe up to roll" : "Drag sideways to aim · drag up to roll")}</div>}
        </div>
      )}

      {/* The move, shown like a game tutorial: a hand slides up the road from the
          tyre, again and again, until the player rolls. It comes back if they stall. */}
      {canPlay && (!started || idle) && (
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: "36%", bottom: "calc(176px + env(safe-area-inset-bottom))", zIndex: 9, pointerEvents: "none", display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative", width: 120, height: "100%" }}>
            <div style={{ position: "absolute", left: 57, top: "8%", bottom: "6%", width: 6, borderRadius: 3, background: `repeating-linear-gradient(180deg, ${GA.goldLight} 0 10px, transparent 10px 20px)`, opacity: 0.85, animation: "ssDash 0.5s linear infinite", filter: `drop-shadow(0 0 8px ${GA.gold})` }} />
            <div style={{ position: "absolute", left: 60, top: "8%", width: 0, height: 0, marginLeft: -15, marginTop: -22, borderLeft: "15px solid transparent", borderRight: "15px solid transparent", borderBottom: `24px solid ${GA.goldLight}`, filter: `drop-shadow(0 0 10px ${GA.gold})` }} />
            <div style={{ position: "absolute", left: 60, bottom: "0%", marginLeft: -27, fontSize: 54, lineHeight: 1, animation: "ssSwipe 1.5s cubic-bezier(.5,0,.2,1) infinite", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.7))" }}>👆</div>
            <div style={{ position: "absolute", left: "50%", top: "-4%", transform: "translate(-50%, -100%)", whiteSpace: "nowrap", fontFamily: DISPLAY, fontSize: "clamp(22px,6.4vw,34px)", color: "#fff", textShadow: `0 0 18px ${GA.purple}, 0 3px 0 rgba(0,0,0,0.5)`, animation: "ssPulse 1.5s ease-in-out infinite" }}>{touch ? "SWIPE UP TO ROLL" : "DRAG UP TO ROLL"}</div>
            {!touch && <div style={{ position: "absolute", left: "50%", top: "-4%", transform: "translate(-50%, 4px)", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, color: "rgba(244,241,234,0.85)", textShadow: "0 1px 4px #000" }}>or press SPACE · arrows to aim</div>}
          </div>
        </div>
      )}

      {/* pass the phone: nobody can roll until the next player says they have it */}
      {handoff && phase === "aim" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#ffffff", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
          <div style={{ width: "100%", maxWidth: 360, borderRadius: 26, padding: "22px 18px 18px", textAlign: "center", color: "#22104f", background: "linear-gradient(180deg, #ffffff, #ffffff)", border: `1.5px solid ${GA.goldLight}`, boxShadow: "0 18px 50px rgba(76,29,149,0.22)" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.22em", fontWeight: 600, color: "rgba(34,16,79,0.68)" }}>PASS THE PHONE</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 34, lineHeight: 1.1, color: "#92400e", margin: "6px 0 4px" }}>{me.name}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#22104f", marginBottom: 6 }}>It is your turn · Frame {Math.min(s.frame + 1, FRAMES)}</div>
            <div style={{ fontSize: 13, color: "rgba(34,16,79,0.68)", marginBottom: 14 }}>{seats.map((p, i) => `${p.name} ${cards[i].total}`).join("  ·  ")}</div>
            <button onClick={() => { armSfx(); setHandoff(false); }} style={{ width: "100%", padding: "14px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 19, color: "#06230f", background: "linear-gradient(180deg, #4ade80, #22c55e)", boxShadow: "0 4px 0 #15803d" }}>I have the phone</button>
          </div>
        </div>
      )}

      {/* how do you want to play: the first thing anyone sees */}
      {setup && (
        <div style={{ position: "absolute", inset: 0, zIndex: 22, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 12px calc(env(safe-area-inset-bottom, 0px) + 14px)", background: "linear-gradient(180deg, rgba(10,1,32,0) 0%, rgba(10,1,32,0.1) 30%, #ffffff 62%)" }}>
          <div style={{ width: "100%", maxWidth: 460, maxHeight: "calc(100dvh - 64px)", overflowY: "auto", borderRadius: 26, padding: "16px 14px 14px", color: "#22104f", background: "linear-gradient(180deg, #ffffff, #ffffff)", border: "1px solid rgba(76,29,149,0.16)", boxShadow: "0 -10px 40px rgba(76,29,149,0.22)" }}>
            <div style={{ textAlign: "center", fontFamily: DISPLAY, fontSize: 30, lineHeight: 1.05 }}>Street <span style={{ color: "#92400e" }}>Strike</span></div>
            <div style={{ textAlign: "center", fontSize: 13.5, fontWeight: 500, color: "rgba(34,16,79,0.68)", marginBottom: 8 }}>Roll the tyre. Scatter the bottles.</div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><HowToButton game="strike" /></div>
            <div style={{ display: room ? "none" : "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {MODES.map((m) => {
                const on = m.id === mode;
                return (
                  <button key={m.id} onClick={() => { setMode(m.id); setNetErr(null); }} aria-pressed={on} style={{ minWidth: 0, cursor: "pointer", padding: "9px 3px 8px", borderRadius: 16, textAlign: "center", color: on ? "#fff" : "#22104f", background: on ? "linear-gradient(180deg, #7c3aed, #6d28d9)" : "rgba(255,255,255,0.06)", border: `1.5px solid ${on ? GA.goldLight : "rgba(255,255,255,0.14)"}`, boxShadow: on ? "0 0 18px rgba(251,191,36,0.3)" : "none" }}>
                    <div style={{ display: "inline-block", marginBottom: 4, padding: "2px 7px", borderRadius: 999, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", lineHeight: 1.4, whiteSpace: "nowrap", background: m.ranked ? "#fde68a" : on ? "rgba(255,255,255,0.2)" : "rgba(76,29,149,0.08)", color: m.ranked ? "#3b0764" : on ? "#fff" : "rgba(34,16,79,0.62)" }}>{m.ranked ? "RANKED" : "FOR FUN"}</div>
                    <div style={{ fontSize: 24, lineHeight: 1.1 }}>{m.icon}</div>
                    <div style={{ fontFamily: DISPLAY, fontSize: 13, marginTop: 3, whiteSpace: "nowrap" }}>{m.name}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 500, color: on ? "rgba(255,255,255,0.88)" : "rgba(34,16,79,0.68)", lineHeight: 1.25, marginTop: 2 }}>{m.note}</div>
                  </button>
                );
              })}
            </div>
            {mode === "cpu" && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, padding: 4, borderRadius: 14, background: "rgba(76,29,149,0.05)" }}>
                {["Easy", "Medium", "Hard"].map((l, i) => (
                  <button key={l} onClick={() => setLevel(i)} aria-pressed={level === i} style={{ flex: 1, cursor: "pointer", padding: "8px 0", borderRadius: 10, border: "none", fontFamily: DISPLAY, fontSize: 14, color: level === i ? "#1a0b33" : "#22104f", background: level === i ? "#fff" : "transparent" }}>{l}</button>
                ))}
              </div>
            )}

<div style={{ fontSize: 10.5, letterSpacing: "0.18em", fontWeight: 600, color: "rgba(34,16,79,0.68)", margin: "12px 0 6px", textAlign: "center" }}>PICK YOUR TYRE</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>{tyreCards}</div>
            {!online && (
              <button onClick={() => { if (!gate.allow()) return; armSfx(); track("game_start", { game: "Street Strike", mode }); restart(mode); setSetup(false); }} style={{ width: "100%", marginTop: 10, padding: "14px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 20, color: "#fff", background: "linear-gradient(180deg, #7c3aed, #6d28d9)", boxShadow: "0 5px 0 #4c1d95" }}>Start</button>
            )}
            {online && !room && (
              <div style={{ marginTop: 10 }}>
                <input value={nick} onChange={(e) => setNick(e.target.value.slice(0, 14))} placeholder="Your name" maxLength={14} aria-label="Your name" style={field} />
                <button disabled={busy} onClick={() => { armSfx(); enterRoom("create"); }} style={{ width: "100%", marginTop: 8, padding: "13px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 18, color: "#fff", background: "linear-gradient(180deg, #7c3aed, #6d28d9)", boxShadow: "0 5px 0 #4c1d95", opacity: busy ? 0.6 : 1 }}>Create a room</button>
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 8px", fontSize: 11, letterSpacing: "0.16em", fontWeight: 600, color: "rgba(34,16,79,0.68)" }}><i style={{ flex: 1, height: 1, background: "rgba(76,29,149,0.05)" }} />OR JOIN A FRIEND<i style={{ flex: 1, height: 1, background: "rgba(76,29,149,0.05)" }} /></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5))} placeholder="CODE" aria-label="Room code" autoCapitalize="characters" style={{ ...field, flex: 1, textAlign: "center", letterSpacing: "0.3em", fontFamily: DISPLAY, fontSize: 20 }} />
                  <button disabled={busy || joinCode.length !== 5} onClick={() => { armSfx(); enterRoom("join"); }} style={{ padding: "0 22px", borderRadius: 14, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 17, color: "#fff", background: "#22104f", opacity: busy || joinCode.length !== 5 ? 0.45 : 1 }}>Join</button>
                </div>
                {netErr && <div style={{ fontSize: 13, color: "#be123c", marginTop: 8, textAlign: "center" }}>{netErr}</div>}
              </div>
            )}
            {online && room && (
              <div style={{ marginTop: 4, textAlign: "center" }}>
                <div style={{ fontSize: 10.5, letterSpacing: "0.2em", fontWeight: 600, color: "rgba(34,16,79,0.68)" }}>ROOM CODE</div>
                <div style={{ fontFamily: DISPLAY, fontSize: 46, lineHeight: 1.1, letterSpacing: "0.18em", color: "#92400e" }}>{room.code}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(34,16,79,0.68)", marginBottom: 10 }}>Send this to your friend. They tap Online, type the code and join.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`Come bowl me on Street Strike 🛞 Room ${room.code}: ${shareUrl}`)}`} target="_blank" rel="noreferrer" style={{ flex: 1, padding: "11px 0", borderRadius: 14, textDecoration: "none", fontFamily: DISPLAY, fontSize: 15, color: "#06230f", background: "#25d366" }}>WhatsApp</a>
                  <button onClick={() => { navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => {}); }} style={{ flex: 1, padding: "11px 0", borderRadius: 14, cursor: "pointer", fontFamily: DISPLAY, fontSize: 15, color: "#22104f", background: "rgba(76,29,149,0.05)", border: "1px solid rgba(76,29,149,0.16)" }}>{copied ? "Copied ✓" : "Copy link"}</button>
                </div>
                <div style={{ margin: "12px 0 10px", padding: "8px 10px", borderRadius: 14, background: "rgba(76,29,149,0.05)", textAlign: "left" }}>
                  {room.players.map((pl, k) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", fontSize: 15, fontWeight: 500 }}>
                      <i style={{ width: 9, height: 9, borderRadius: 9, background: pl.away ? "#6b6480" : "#4ade80", boxShadow: pl.away ? "none" : "0 0 8px #4ade80" }} />
                      <span style={{ flex: 1 }}>{pl.name}{k === room.you ? " (you)" : ""}</span>
                      {pl.host && <span style={{ fontSize: 10.5, letterSpacing: "0.12em", fontWeight: 600, color: "#92400e" }}>HOST</span>}
                    </div>
                  ))}
                  {room.players.length < 2 && <div style={{ padding: "5px 2px", fontSize: 13.5, color: "rgba(34,16,79,0.68)", animation: "ssPulse2 1.4s ease-in-out infinite" }}>Waiting for a friend to join…</div>}
                </div>
                {room.players[room.you]?.host
                  ? <button disabled={busy || room.players.length < 2} onClick={() => { armSfx(); hostDo("start"); }} style={{ width: "100%", padding: "14px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 20, color: "#fff", background: "linear-gradient(180deg, #7c3aed, #6d28d9)", boxShadow: "0 5px 0 #4c1d95", opacity: busy || room.players.length < 2 ? 0.45 : 1 }}>{room.players.length < 2 ? "Need 2 players" : "Start the game"}</button>
                  : <div style={{ padding: "13px 0", borderRadius: 16, fontFamily: DISPLAY, fontSize: 16, color: "#22104f", background: "rgba(76,29,149,0.05)" }}>You are in. Waiting for the host to start…</div>}
                {netErr && <div style={{ fontSize: 13, color: "#be123c", marginTop: 8 }}>{netErr}</div>}
                <button onClick={leaveRoom} style={{ marginTop: 8, background: "none", border: "none", cursor: "pointer", color: "#9b93b8", fontSize: 13 }}>Leave room</button>
              </div>
            )}
            <div style={{ textAlign: "center", fontSize: 12, color: "rgba(34,16,79,0.68)", marginTop: 8 }}>{online ? "Everyone bowls at the same time, each on their own phone. 5 frames." : mode === "pass" ? "Two players, one phone. You swap after every frame." : mode === "cpu" ? "You and the computer swap after every frame. 5 frames each." : ranked.canRank ? "Ranked: 5 frames. Your score is checked and goes on the weekly board." : "5 frames. Just me is the ranked mode: sign in and your score goes on the board."}</div>
            {mode === "solo" && !online && <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}><EnergyLine /></div>}
            {!online && <div style={{ marginTop: 6 }}><GuestLine left={gate.left} /></div>}
          </div>
        </div>
      )}

      {/* The play screen stays clear: the tyre must be visible and under the thumb.
          One small button swaps tyres between rolls. */}
      {canPlay && !s.done && !pickOpen && (
        <button onClick={() => setPickOpen(true)} style={{ ...chip, position: "absolute", left: 12, bottom: "calc(14px + env(safe-area-inset-bottom))", zIndex: 10, cursor: "pointer", fontSize: 12.5, padding: "8px 12px" }}>🛞 {tyre.name.replace(" tyre", "")} ⇄</button>
      )}
      {canPlay && pickOpen && (
        <div onClick={() => setPickOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 16, display: "flex", alignItems: "flex-end", background: "rgba(10,1,32,0.45)" }}>
          <div style={{ width: "100%", display: "flex", justifyContent: "center", gap: 8, padding: "0 12px calc(14px + env(safe-area-inset-bottom))" }}>{tyreCards}</div>
        </div>
      )}

      {/* end sheet */}
      {watching && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 45, padding: "10px 12px calc(12px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none", fontFamily: BODY }}>
          <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 720 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, background: laneGone ? "#475569" : "#dc2626", color: "#fff", fontWeight: 800, fontSize: 12.5, letterSpacing: "0.08em" }}>{laneGone ? "ENDED" : <><i style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} /> LIVE</>}</span>
            {lineUp && !laneGone && <span style={{ padding: "7px 12px", borderRadius: 999, background: "#22c55e", color: "#052e16", fontWeight: 800, fontSize: 12.5 }}>⚡ Instant</span>}
            {(lane?.watching ?? 0) > 0 && <span style={{ padding: "7px 12px", borderRadius: 999, background: "rgba(10,2,32,0.72)", color: "#fff", fontWeight: 700, fontSize: 12.5 }}>👁 {lane!.watching}</span>}
          </div>
          <div style={{ pointerEvents: "auto", width: "100%", maxWidth: 720, padding: 10, borderRadius: 20, background: "rgba(255,255,255,0.96)", boxShadow: "0 18px 40px -18px rgba(0,0,0,0.7)", display: "grid", gap: 8, color: "#22104f" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(34,16,79,0.7)", textAlign: "center" }}>
              {laneGone ? "This lane has closed." : !lane ? "Finding the lane…" : lane.status === "waiting" ? "Waiting for the host to start the game." : followed?.done ? `${followed.name} has finished: ${score(laneRolls, FRAMES).total}` : `Watching ${followed?.name ?? "the lane"} bowl. Tap a player to follow them.`}
            </div>
            {lane && <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
              {lane.players.map((p, i) => (
                <button key={i} onClick={() => setFollow(i)} aria-pressed={follow === i} style={{ flex: "1 0 auto", minWidth: 96, minHeight: 52, padding: "6px 12px", borderRadius: 14, border: "none", cursor: "pointer", textAlign: "left", background: follow === i ? "#22104f" : "#f1ecfb", color: follow === i ? "#fff" : "#22104f", opacity: p.away && !p.done ? 0.6 : 1 }}>
                  <b style={{ display: "block", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{p.name}</b>
                  <span style={{ fontFamily: DISPLAY, fontSize: 20, lineHeight: 1 }}>{score(p.rolls, FRAMES).total}</span><span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.75 }}> {p.done ? "done" : `frame ${Math.min(FRAMES, score(p.rolls, FRAMES).frame + 1)}`}</span>
                </button>
              ))}
            </div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { window.location.href = "/watch"; }} style={{ flex: 1, minHeight: 46, borderRadius: 14, border: "2px solid rgba(109,40,217,0.3)", background: "#fff", color: "#6d28d9", fontWeight: 800, fontSize: 14.5, cursor: "pointer" }}>← All live rounds</button>
              <button onClick={() => { window.location.href = "/bowling"; }} style={{ flex: 1, minHeight: 46, borderRadius: 14, border: "none", background: "linear-gradient(180deg,#7c3aed,#6d28d9)", boxShadow: "0 4px 0 #4c1d95", color: "#fff", fontWeight: 800, fontSize: 14.5, cursor: "pointer" }}>Play it yourself</button>
            </div>
          </div>
        </div>
      )}
      {quitAsk && (
        <div role="dialog" aria-modal="true" aria-label="End this game?" style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 12px calc(env(safe-area-inset-bottom, 0px) + 14px)", background: "rgba(10,1,32,0.62)" }}>
          <div style={{ width: "100%", maxWidth: 420, borderRadius: 24, padding: "20px 18px 16px", textAlign: "center", color: "#22104f", background: "#fff", border: "1px solid rgba(76,29,149,0.16)", boxShadow: "0 18px 50px rgba(10,1,32,0.45)" }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 24, lineHeight: 1.15 }}>End this game?</div>
            <p style={{ margin: "8px 0 16px", fontSize: 14, lineHeight: 1.45, color: "rgba(34,16,79,0.78)" }}>
              {(allRef.current[0] ?? []).reduce((a, b) => a + b, 0) > 0
                ? "This is a ranked game. If you leave now it ends here: the throws you have not made count as misses, and your score is saved."
                : "This is a ranked game. Nothing is down yet, so leaving now ends it with no score."}
            </p>
            <button onClick={() => setQuitAsk(false)} style={{ width: "100%", padding: "13px 0", borderRadius: 14, border: "none", background: "#6d28d9", color: "#fff", fontFamily: BODY, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Keep playing</button>
            <button onClick={endNow} style={{ width: "100%", marginTop: 8, padding: "12px 0", borderRadius: 14, border: "1px solid rgba(76,29,149,0.22)", background: "transparent", color: "#4c1d95", fontFamily: BODY, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>End the game</button>
          </div>
        </div>
      )}

      {phase === "over" && !watching && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 12px calc(env(safe-area-inset-bottom, 0px) + 14px)", background: "linear-gradient(180deg, rgba(10,1,32,0) 0%, rgba(10,1,32,0.2) 40%, #ffffff 100%)" }}>
          <div style={{ width: "100%", maxWidth: 460, borderRadius: 26, padding: "18px 16px 14px", textAlign: "center", color: "#22104f", background: "linear-gradient(180deg, #ffffff, #ffffff)", border: "1px solid rgba(76,29,149,0.16)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.22em", fontWeight: 600, color: "rgba(34,16,79,0.68)" }}>STREET STRIKE · FINAL</div>
            {seats.length > 1 ? (
              <>
                <div style={{ fontFamily: DISPLAY, fontSize: "clamp(30px,9vw,44px)", lineHeight: 1.1, color: "#92400e" }}>{(allOver ? verdict(seats, cards, meIx) : "Waiting for the others…")}</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 18, margin: "8px 0 4px" }}>
                  {seats.map((p, k) => (
                    <div key={k}><div style={{ fontFamily: DISPLAY, fontSize: 34, lineHeight: 1 }}>{cards[k].total}</div><div style={{ fontSize: 12, fontWeight: 600, color: "rgba(34,16,79,0.68)" }}>{p.name}</div></div>
                  ))}
                </div>
              </>
            ) : <div style={{ fontFamily: DISPLAY, fontSize: "clamp(44px,13vw,68px)", lineHeight: 1.05, color: "#92400e" }}>{cards[0].total}</div>}
            <div style={{ fontSize: 14, fontWeight: 500, color: "rgba(34,16,79,0.68)", marginBottom: 12 }}>
              {online ? (allOver ? "Good game!" : `${seats.filter((_, k) => !cards[k].done && !room?.players[k]?.away).map((p) => p.name).join(", ")} still bowling`) : mode === "pass" ? "Run it back?" : beat ? "New best! Street champion 🏆" : best != null && best > cards[0].total ? `Your best ${best}. ${best - cards[0].total} more to beat it` : best != null ? `Your best ${best}` : "out of 150"}
            </div>
            {online ? (
              <>
                {allOver && room?.players[turn]?.host && <button disabled={busy} onClick={() => hostDo("rematch")} style={{ width: "100%", padding: "14px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 19, color: "#06230f", background: "linear-gradient(180deg, #4ade80, #22c55e)", boxShadow: "0 4px 0 #15803d" }}>Rematch</button>}
                {allOver && !room?.players[turn]?.host && <div style={{ padding: "12px 0", fontSize: 14, fontWeight: 500, color: "rgba(34,16,79,0.68)" }}>Waiting for the host to start a rematch…</div>}
                {netErr && <div style={{ fontSize: 13, color: "#ff8a8a", marginTop: 6 }}>{netErr}</div>}
                <button onClick={() => { leaveRoom(); restart("solo"); setSetup(true); }} style={{ width: "100%", marginTop: 8, padding: "11px 0", borderRadius: 14, cursor: "pointer", fontFamily: DISPLAY, fontSize: 15, color: "#22104f", background: "rgba(76,29,149,0.05)", border: "1px solid rgba(76,29,149,0.16)" }}>Leave room</button>
              </>
            ) : (
              <>
            {mode === "solo" && <a href="/bowling/leaderboard" style={{ display: "block", margin: "0 0 8px", fontFamily: BODY, fontSize: 12.5, fontWeight: 700, color: "#22104f" }}>This week's leaderboard</a>}
            {mode === "solo" && (
              <div role="status" style={{ margin: "0 0 10px", fontFamily: BODY, fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, color: "rgba(34,16,79,0.68)" }}>
                {!rankedGame ? (ranked.canRank ? null : "Sign in to rank your score.")
                  : ranked.status === "checking" ? "Checking your throws…"
                  : ranked.status === "wallet" ? "Confirm in your wallet to save…"
                  : ranked.status === "saving" ? "Saving to the leaderboard…"
                  : ranked.status === "saved" ? <>{ranked.result?.queued ? "Saved · waiting to be sent" : "Saved"}{ranked.result?.rank ? ` · rank #${ranked.result.rank}` : ""}{ranked.result?.xpEarned ? ` · +${ranked.result.xpEarned} XP` : ""}{ranked.result?.txHash ? <div style={{ marginTop: 4, display: "flex", justifyContent: "center" }}><TxStatus hash={ranked.result.txHash} compact /></div> : null}</>
                  : ranked.status === "error" ? ranked.error : null}
              </div>
            )}
            <button onClick={() => restart()} style={{ width: "100%", padding: "14px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 19, color: "#06230f", background: "linear-gradient(180deg, #4ade80, #22c55e)", boxShadow: "0 4px 0 #15803d, 0 12px 24px -8px rgba(34,197,94,0.6)" }}>Play again</button>
            <button onClick={() => { restart(); setSetup(true); }} style={{ width: "100%", marginTop: 8, padding: "11px 0", borderRadius: 14, cursor: "pointer", fontFamily: DISPLAY, fontSize: 15, color: "#22104f", background: "rgba(76,29,149,0.05)", border: "1px solid rgba(76,29,149,0.16)" }}>Change mode</button>
              </>
            )}
            <Link href="/games" style={{ display: "inline-block", marginTop: 10, color: "#9b93b8", fontSize: 13, textDecoration: "none" }}>← Arena</Link>
          </div>
        </div>
      )}
      <style>{`@keyframes ssSwipe { 0% { transform: translateY(0) scale(1); opacity: 0; } 12% { opacity: 1; } 70% { opacity: 1; } 100% { transform: translateY(-34vh) scale(0.8); opacity: 0; } } @keyframes ssDash { to { background-position: 0 -20px; } } @keyframes ssPulse2 { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } } @keyframes ssPulse { 0%, 100% { transform: translate(-50%, -100%) scale(1); } 50% { transform: translate(-50%, -100%) scale(1.07); } } @keyframes ssPop { 0% { opacity: 0; transform: scale(0.6); } 12% { opacity: 1; transform: scale(1.12); } 22% { transform: scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(-18px); } }`}</style>
      {gate.prompt}
    </div>
  );
}

type Mode = "solo" | "cpu" | "pass" | "online";
interface Seat { name: string; cpu: boolean }
// `ranked`: the one mode whose score goes on the board. Every card says which it is, so nobody has to guess.
const MODES: { id: Mode; icon: string; name: string; note: string; ranked: boolean }[] = [
  { id: "solo", icon: "🎯", name: "Just me", note: "Beat your best", ranked: true },
  { id: "cpu", icon: "🤖", name: "Vs CPU", note: "Take turns", ranked: false },
  { id: "pass", icon: "👥", name: "2 players", note: "Pass the phone", ranked: false },
  { id: "online", icon: "🌍", name: "Online", note: "Play a friend", ranked: false },
];
function seatsFor(m: Mode): Seat[] {
  if (m === "cpu") return [{ name: "You", cpu: false }, { name: "CPU", cpu: true }];
  if (m === "pass") return [{ name: "Player 1", cpu: false }, { name: "Player 2", cpu: false }];
  return [{ name: "You", cpu: false }];
}
function verdict(seats: Seat[], cards: ScoreState[], meIx: number) {
  const top = Math.max(...cards.map((c) => c.total));
  const who = seats.map((_, i) => i).filter((i) => cards[i].total === top);
  if (who.length > 1) return "It's a draw!";
  return who[0] === meIx ? "You win! 🏆" : `${seats[who[0]].name} wins!`;
}

const field: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(76,29,149,0.2)", background: "#fff", color: "#22104f", fontFamily: BODY, fontSize: 16, fontWeight: 500, outline: "none" };

const chip: CSSProperties = {
  color: "#fff",
  fontFamily: DISPLAY,
  fontSize: 14,
  lineHeight: 1,
  padding: "8px 14px",
  borderRadius: 999,
  background: "linear-gradient(180deg, rgba(42,18,64,0.82), rgba(10,1,32,0.86))",
  border: "1px solid rgba(255,255,255,0.18)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};
