"use client";

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

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, MeshReflectorMaterial } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Physics, RigidBody, CuboidCollider, CylinderCollider, BallCollider, type RapierRigidBody } from "@react-three/rapier";
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
  return (
    <RigidBody
      ref={(rb) => {
        api.current[i] = rb;
      }}
      position={[HOME[i][0], 0.002, HOME[i][1]]}
      colliders={false}
      friction={0.55}
      restitution={0.25}
      linearDamping={0.12}
      angularDamping={0.35}
      ccd
    >
      <CylinderCollider args={[0.105, 0.06]} position={[0, 0.105, 0]} mass={0.75} />
      <CylinderCollider args={[0.062, 0.026]} position={[0, 0.272, 0]} mass={0.12} />
      <mesh geometry={geo.body} material={glass} castShadow />
      <mesh geometry={geo.label} material={label} />
      <mesh geometry={geo.cap} material={cap} />
    </RigidBody>
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
function Colliders() {
  const half = LANE_W / 2;
  const zc = -(LANE_LEN / 2) - 2;
  const hl = (LANE_LEN + 14) / 2;
  return (
    <RigidBody type="fixed" colliders={false} friction={0.6} restitution={0.05}>
      <CuboidCollider args={[half, 0.1, hl]} position={[0, -0.1, zc]} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <CuboidCollider args={[GUTTER_W / 2, 0.05, hl]} position={[s * (half + GUTTER_W / 2), -GUTTER_DROP - 0.05, zc]} friction={0.9} />
          <CuboidCollider args={[0.17, 0.4, hl]} position={[s * (half + GUTTER_W + 0.17), 0.1, zc]} />
        </group>
      ))}
      <CuboidCollider args={[half + GUTTER_W + 2, 1.1, 0.15]} position={[0, 0.9, DECK_END - 1.7]} restitution={0.2} />
      <CuboidCollider args={[half + GUTTER_W + 2, 1.1, 0.15]} position={[0, 0.9, 4.5]} />
    </RigidBody>
  );
}

// ── Game brain (inside <Physics>) ────────────────────────────────────────────
interface Api {
  throwIt: (t: Throw) => void;
  aimX: (x: number) => void;
}
function Brain({
  phase,
  standing,
  apiRef,
  onResult,
  onPhase,
  rackKey,
  tyre,
  setSlow,
}: {
  tyre: (typeof TYRES)[number];
  phase: Phase;
  standing: boolean[];
  apiRef: React.MutableRefObject<Api | null>;
  onResult: (down: boolean[], gutter: boolean) => void;
  onPhase: (p: Phase) => void;
  rackKey: number;
  setSlow: (on: boolean) => void;
}) {
  const ball = useRef<RapierRigidBody | null>(null);
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
        if (!b || phaseRef.current !== "aim") return;
        hookMul.current = tyreRef.current.hook;
        const x = THREE.MathUtils.clamp(th.x, -(LANE_W / 2 - tyreRef.current.r - 0.02), LANE_W / 2 - tyreRef.current.r - 0.02);
        const a = THREE.MathUtils.clamp(th.angle, -0.1, 0.1);
        const sp = THREE.MathUtils.clamp(th.speed, SPEED_MIN, SPEED_MAX);
        spin.current = THREE.MathUtils.clamp(th.spin, -20, 20);
        b.setTranslation({ x, y: tyreRef.current.r + 0.01, z: START_Z }, true);
        b.setLinvel({ x: Math.sin(a) * sp, y: 0, z: -Math.cos(a) * sp }, true);
        b.setAngvel({ x: -sp / tyreRef.current.r, y: 0, z: 0 }, true);
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
      rb.setTranslation({ x: HOME[i][0], y: 0.002, z: HOME[i][1] }, true);
      rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
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
    const p = b.translation();
    const v = b.linvel();
    const ph = phaseRef.current;

    if (ph === "aim" || ph === "over" || ph === "lobby") {
      // hold the tyre at the release line
      // keep the tyre inside the lane even after switching to a bigger one
      const lim = LANE_W / 2 - tyreRef.current.r - 0.02;
      aim.current = THREE.MathUtils.clamp(aim.current, -lim, lim);
      b.setTranslation({ x: aim.current, y: tyreRef.current.r + 0.01, z: START_Z }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      setRumble(0);
      for (const m of voice.current) m.has = false;
    } else {
      t.current += dt;
      const onRoad = Math.abs(p.x) < LANE_W / 2 && p.y > tyreRef.current.r * 0.6;
      if (!onRoad && p.z > -LANE_LEN + 0.6 && !wentGutter.current) {
        wentGutter.current = true;
        thud();
      }
      // the hook: nothing early, building over the far half
      if (ph === "rolling" && onRoad && p.z < -LANE_LEN * 0.4 && p.z > -LANE_LEN - 0.4) {
        const zone = Math.min(1, (-p.z - LANE_LEN * 0.4) / (LANE_LEN * 0.45));
        b.applyImpulse({ x: spin.current * HOOK * hookMul.current * zone * tyreRef.current.mass * dt, y: 0, z: 0 }, true);
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
      if (ph === "settling") {
        settle.current += dt;
        let moving = false;
        for (let i = 0; i < PINS; i++) {
          // only bottles still in play: a removed bottle's handle is dead, and
          // asking the physics engine about it crashes the step
          const rb = standing[i] ? bottles.current[i] : null;
          if (!rb) continue;
          const lv = rb.linvel();
          const av = rb.angvel();
          if (Math.hypot(lv.x, lv.y, lv.z) > 0.25 || Math.hypot(av.x, av.y, av.z) > 1.2) moving = true;
        }
        if ((settle.current > 1.4 && !moving) || settle.current > 4.2) {
          const down = standing.map((up, i) => {
            if (!up) return false;
            const rb = bottles.current[i];
            if (!rb) return false;
            const q = rb.rotation();
            const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
            const pos = rb.translation();
            return upY < 0.8 || pos.y < -0.06 || Math.hypot(pos.x - HOME[i][0], pos.z - HOME[i][1]) > 0.55;
          });
          setRumble(0);
          phaseRef.current = "counted"; // report once
          onResult(down, wentGutter.current && !down.some(Boolean));
        }
      }
    }

    // STRIKE CAM. A tyre that arrives dead on the head bottle with a full rack is
    // about to scatter everything, so that roll gets the big-moment treatment:
    // time slows and the camera drops low beside the rack to watch the bottles fly.
    if (ph === "aim") cine.armed = true;
    if (ph === "rolling" && cine.armed && cine.t < 0 && p.z < -LANE_LEN + 1.1 && Math.abs(p.x) < 0.17 && standing.every(Boolean)) {
      cine.armed = false;
      cine.t = 0;
      cine.side = p.x >= 0 ? -1 : 1;
      setSlow(true);
    }
    if (cine.t >= 0) {
      cine.t += rawDt;
      const k = Math.min(1, cine.t / 1.7);
      const e = k * k * (3 - 2 * k);
      const cx = cine.side * (1.75 - e * 0.7), cy = 0.42 + e * 0.5, cz = -LANE_LEN + 1.5 + e * 1.1;
      const f = Math.min(1, rawDt * 9);
      camera.position.set(camera.position.x + (cx - camera.position.x) * f, camera.position.y + (cy - camera.position.y) * f, camera.position.z + (cz - camera.position.z) * f);
      camera.lookAt(0, 0.22, -LANE_LEN - 0.55);
      if (cine.t > 1.7 || ph === "aim" || ph === "over") { cine.t = -1; setSlow(false); }
      else {
        if (cine.t > 1.0) setSlow(false); // back to full speed for the last half, still on the close camera
        camZ.current = camera.position.z;
        return;
      }
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
      <RigidBody
        key={tyre.id}
        ref={ball}
        position={[0, tyre.r + 0.01, START_Z]}
        colliders={false}
        friction={0.45}
        restitution={0.12}
        linearDamping={0.04}
        angularDamping={0.25}
        ccd
        canSleep={false}
      >
        <BallCollider args={[tyre.r]} mass={tyre.mass} />
      </RigidBody>
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
  // Who is playing. One list of rolls per seat; `turn` is the seat on the line.
  const [mode, setMode] = useState<Mode>("solo");
  const [level, setLevel] = useState(1); // CPU: 0 easy, 1 medium, 2 hard
  const [setup, setSetup] = useState(true); // the "how do you want to play" sheet
  const seats = useMemo(() => seatsFor(mode), [mode]);
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
  const cards = useMemo(() => seats.map((_, i) => score(allRolls[i] ?? [], FRAMES)), [seats, allRolls]);
  const me = seats[turn] ?? seats[0];
  const canPlay = phase === "aim" && !setup && !handoff && !me.cpu;
  const turnLabel = me.name === "You" ? "Your turn" : `${me.name}'s turn`;

  useEffect(() => {
    try {
      const b = Number(localStorage.getItem("streetstrike.best"));
      if (b > 0) setBest(b);
    } catch { /* ignore */ }
    return () => closeSfx();
  }, []);

  const say2 = (text: string, tone: "big" | "good" | "bad") => setBanner({ text, tone, key: Date.now() });

  const onResult = useCallback((down: boolean[], gutter: boolean) => {
    const before = standingRef.current;
    const count = down.filter(Boolean).length;
    const seat = turnRef.current;
    const prevFrame = score(allRef.current[seat] ?? [], FRAMES).frame;
    const nextRolls = [...(allRef.current[seat] ?? []), count];
    allRef.current = allRef.current.map((r, i) => (i === seat ? nextRolls : r));
    const st = score(nextRolls, FRAMES);
    // With more than one seat, players swap after each frame. Whoever still has
    // frames left goes next; when nobody does, the game is over.
    const n = allRef.current.length;
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
    if (allDone) {
      setPhase("over");
      // your best is your own score: seat 0, and never in pass-the-phone
      if (modeRef.current !== "pass") try {
        const mine = score(allRef.current[0], FRAMES).total;
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
    }, cleared ? 1500 : 1000);
  }, []);

  const restart = (m: Mode = modeRef.current) => {
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
      } else if (e.key === " " || e.key === "Enter") {
        armSfx();
        setStarted(true);
        apiRef.current?.throwIt({ x: keyX.current, angle: 0, speed: 8.6, spin: 0 });
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPlay]);

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
      state: () => ({ phase, mode: modeRef.current, turn: turnRef.current, handoff, setup, all: allRef.current, totals: allRef.current.map((r) => score(r, FRAMES).total), rolls: allRef.current[turnRef.current], total: score(allRef.current[turnRef.current], FRAMES).total, standing: standingRef.current.filter(Boolean).length, done: allRef.current.every((r) => score(r, FRAMES).done) }),
    };
  });

  const tone = banner?.tone === "big" ? GA.goldLight : banner?.tone === "bad" ? "#ff8a8a" : "#8ff0a4";
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: GA.purpleNight, touchAction: "none", fontFamily: BODY }}>
      <Canvas shadows={!isMobile} dpr={[1, isMobile ? 1.5 : 2]} gl={{ antialias: !isMobile, powerPreference: "high-performance" }} camera={{ position: [0, 1.45, 2.4], fov: 50, near: 0.1, far: 140 }}
        onCreated={({ gl, camera }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.outputColorSpace = THREE.SRGBColorSpace; camera.lookAt(0, 0.32, -4.1); /* down the road while models load, not at the floor */ }}>
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
          <Physics gravity={[0, -9.81, 0]} timeStep={slow ? 1 / 240 : 1 / 60}>
            <Colliders />
            <Brain phase={phase} standing={standing} apiRef={apiRef} onResult={onResult} onPhase={setPhase} rackKey={rackKey} tyre={tyre} setSlow={setSlowOnce} />
          </Physics>
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
      <div style={{ position: "absolute", top: "calc(12px + env(safe-area-inset-top))", left: 12, right: 12, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", pointerEvents: "none" }}>
        <Link href="/games" style={{ ...chip, pointerEvents: "auto", textDecoration: "none" }}>← Arena</Link>
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
                  <div style={{ fontSize: 9, letterSpacing: "0.1em", fontWeight: 600, color: mine && phase !== "over" ? GA.goldLight : "rgba(244,241,234,0.5)" }}>{mine && phase !== "over" ? "ROLLING" : card.done ? "DONE" : "WAITING"}</div>
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
        <div key={banner.key} style={{ position: "absolute", top: "30%", left: 0, right: 0, zIndex: 12, textAlign: "center", pointerEvents: "none", fontFamily: DISPLAY, fontSize: banner.tone === "big" ? "clamp(34px,10vw,64px)" : "clamp(24px,7vw,40px)", color: tone, textShadow: "0 4px 0 rgba(0,0,0,0.35), 0 0 30px rgba(0,0,0,0.6)", animation: "ssPop 1.5s ease-out forwards" }}>
          {banner.text}
        </div>
      )}

      {/* whose turn it is, and what to do. Always on screen while a roll is owed. */}
      {phase === "aim" && !setup && !handoff && (
        <div style={{ position: "absolute", bottom: `calc(${me.cpu ? 40 : 138}px + env(safe-area-inset-bottom))`, left: 0, right: 0, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none" }}>
          <div style={{ ...chip, fontSize: 14, borderColor: me.cpu ? "rgba(255,255,255,0.18)" : GA.goldLight }}>
            {me.cpu ? "CPU is rolling…" : <><b style={{ color: GA.goldLight, fontWeight: 400 }}>{turnLabel}</b>{` · Frame ${Math.min(s.frame + 1, FRAMES)} · Roll ${s.ball + 1}`}</>}
          </div>
          {!me.cpu && (hint || !started) && <div style={{ ...chip, fontFamily: BODY, fontWeight: 500, fontSize: 13, background: "rgba(10,1,32,0.78)", textAlign: "center", lineHeight: 1.35, maxWidth: "86%" }}>{hint ?? (touch ? "Slide to pick your spot · swipe up to roll" : "Drag sideways to aim · drag up to roll")}</div>}
        </div>
      )}

      {/* The move, shown like a game tutorial: a hand slides up the road from the
          tyre, again and again, until the player rolls. It comes back if they stall. */}
      {canPlay && (!started || idle) && (
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: "34%", bottom: "calc(150px + env(safe-area-inset-bottom))", zIndex: 9, pointerEvents: "none", display: "flex", justifyContent: "center" }}>
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
        <div style={{ position: "absolute", inset: 0, zIndex: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(10,1,32,0.62)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
          <div style={{ width: "100%", maxWidth: 360, borderRadius: 26, padding: "22px 18px 18px", textAlign: "center", color: "#fff", background: "linear-gradient(180deg, rgba(42,18,64,0.95), rgba(10,1,32,0.97))", border: `1.5px solid ${GA.goldLight}`, boxShadow: "0 18px 50px rgba(0,0,0,0.6)" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.22em", fontWeight: 600, color: "rgba(244,241,234,0.62)" }}>PASS THE PHONE</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 34, lineHeight: 1.1, color: GA.goldLight, margin: "6px 0 4px" }}>{me.name}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "rgba(244,241,234,0.8)", marginBottom: 6 }}>It is your turn · Frame {Math.min(s.frame + 1, FRAMES)}</div>
            <div style={{ fontSize: 13, color: "rgba(244,241,234,0.6)", marginBottom: 14 }}>{seats.map((p, i) => `${p.name} ${cards[i].total}`).join("  ·  ")}</div>
            <button onClick={() => { armSfx(); setHandoff(false); }} style={{ width: "100%", padding: "14px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 19, color: "#06230f", background: "linear-gradient(180deg, #4ade80, #22c55e)", boxShadow: "0 4px 0 #15803d" }}>I have the phone</button>
          </div>
        </div>
      )}

      {/* how do you want to play: the first thing anyone sees */}
      {setup && (
        <div style={{ position: "absolute", inset: 0, zIndex: 22, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 12px calc(env(safe-area-inset-bottom, 0px) + 14px)", background: "linear-gradient(180deg, rgba(10,1,32,0) 0%, rgba(10,1,32,0.1) 30%, rgba(10,1,32,0.8) 62%)" }}>
          <div style={{ width: "100%", maxWidth: 460, borderRadius: 26, padding: "16px 14px 14px", color: "#fff", background: "linear-gradient(180deg, rgba(42,18,64,0.9), rgba(10,1,32,0.96))", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 -10px 40px rgba(0,0,0,0.5)" }}>
            <div style={{ textAlign: "center", fontFamily: DISPLAY, fontSize: 30, lineHeight: 1.05 }}>Street <span style={{ color: GA.goldLight }}>Strike</span></div>
            <div style={{ textAlign: "center", fontSize: 13.5, fontWeight: 500, color: "rgba(244,241,234,0.72)", marginBottom: 12 }}>Roll the tyre. Scatter the bottles.</div>
            <div style={{ display: "flex", gap: 8 }}>
              {MODES.map((m) => {
                const on = m.id === mode;
                return (
                  <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={on} style={{ flex: "1 1 0", minWidth: 0, cursor: "pointer", padding: "10px 6px 9px", borderRadius: 16, textAlign: "center", color: "#fff", background: on ? "linear-gradient(180deg, rgba(124,58,237,0.85), rgba(76,29,149,0.9))" : "rgba(255,255,255,0.06)", border: `1.5px solid ${on ? GA.goldLight : "rgba(255,255,255,0.14)"}`, boxShadow: on ? "0 0 18px rgba(251,191,36,0.3)" : "none" }}>
                    <div style={{ fontSize: 24, lineHeight: 1.1 }}>{m.icon}</div>
                    <div style={{ fontFamily: DISPLAY, fontSize: 14.5, marginTop: 3 }}>{m.name}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 500, color: "rgba(244,241,234,0.7)", lineHeight: 1.25, marginTop: 2 }}>{m.note}</div>
                  </button>
                );
              })}
            </div>
            {mode === "cpu" && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, padding: 4, borderRadius: 14, background: "rgba(255,255,255,0.06)" }}>
                {["Easy", "Medium", "Hard"].map((l, i) => (
                  <button key={l} onClick={() => setLevel(i)} aria-pressed={level === i} style={{ flex: 1, cursor: "pointer", padding: "8px 0", borderRadius: 10, border: "none", fontFamily: DISPLAY, fontSize: 14, color: level === i ? "#1a0b33" : "#fff", background: level === i ? "#fff" : "transparent" }}>{l}</button>
                ))}
              </div>
            )}
            <button onClick={() => { armSfx(); restart(mode); setSetup(false); }} style={{ width: "100%", marginTop: 10, padding: "14px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 20, color: "#06230f", background: "linear-gradient(180deg, #4ade80, #22c55e)", boxShadow: "0 4px 0 #15803d" }}>Start</button>
            <ol style={{ margin: "12px 0 0", padding: "10px 12px 10px 30px", borderRadius: 14, background: "rgba(255,255,255,0.05)", fontSize: 13, fontWeight: 500, lineHeight: 1.6, color: "rgba(244,241,234,0.86)" }}>
              <li><b style={{ color: GA.goldLight }}>Slide</b> the tyre to pick your spot.</li>
              <li><b style={{ color: GA.goldLight }}>Swipe up</b> to roll: faster swipe, faster tyre.</li>
              <li><b style={{ color: GA.goldLight }}>Curve</b> your swipe to hook it.</li>
            </ol>
            <div style={{ textAlign: "center", fontSize: 12, color: "rgba(244,241,234,0.55)", marginTop: 8 }}>{mode === "pass" ? "Two players, one phone. You swap after every frame." : mode === "cpu" ? "You and the computer swap after every frame. 5 frames each." : "5 frames. Beat your own best."}</div>
          </div>
        </div>
      )}

      {/* pick your tyre: each one really rolls differently */}
      {canPlay && !s.done && (
        <div style={{ position: "absolute", bottom: "calc(14px + env(safe-area-inset-bottom))", left: 0, right: 0, zIndex: 10, display: "flex", justifyContent: "center", gap: 8, padding: "0 12px", pointerEvents: "none" }}>
          {TYRES.map((t, i) => {
            const on = i === tyreIx;
            return (
              <button key={t.id} onClick={() => setTyreIx(i)} aria-pressed={on} style={{ pointerEvents: "auto", cursor: "pointer", flex: "1 1 0", minWidth: 0, maxWidth: 150, padding: "8px 6px 9px", borderRadius: 14, textAlign: "center", color: "#fff", background: on ? "linear-gradient(180deg, rgba(124,58,237,0.85), rgba(42,18,64,0.92))" : "rgba(10,1,32,0.72)", border: `1px solid ${on ? GA.goldLight : "rgba(255,255,255,0.16)"}`, boxShadow: on ? "0 0 16px -4px rgba(251,191,36,0.7)" : "none", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>
                <div style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 5 }}>
                  {t.paint.map((c, k) => <i key={k} style={{ width: 14, height: 5, borderRadius: 3, background: c }} />)}
                </div>
                <div style={{ fontFamily: DISPLAY, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                <div style={{ fontSize: 10.5, fontWeight: 500, color: "rgba(244,241,234,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 6 }}>{t.note}</div>
                {([["Power", t.power, "#ff8a4a"], ["Curve", t.curve, "#c084fc"], ["Control", t.control, "#4ade80"]] as const).map(([label, n, c]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                    <span style={{ width: 40, textAlign: "left", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.04em", color: "rgba(244,241,234,0.72)" }}>{label}</span>
                    <span style={{ flex: 1, display: "flex", gap: 2 }} aria-label={`${label} ${n} of 5`}>
                      {[1, 2, 3, 4, 5].map((k) => <i key={k} style={{ flex: 1, height: 5, borderRadius: 2, background: k <= n ? c : "rgba(255,255,255,0.14)" }} />)}
                    </span>
                  </div>
                ))}
              </button>
            );
          })}
        </div>
      )}

      {/* end sheet */}
      {phase === "over" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 12px calc(env(safe-area-inset-bottom, 0px) + 14px)", background: "linear-gradient(180deg, rgba(10,1,32,0) 0%, rgba(10,1,32,0.2) 40%, rgba(10,1,32,0.8) 100%)" }}>
          <div style={{ width: "100%", maxWidth: 460, borderRadius: 26, padding: "18px 16px 14px", textAlign: "center", color: "#fff", background: "linear-gradient(180deg, rgba(42,18,64,0.82), rgba(10,1,32,0.94))", border: "1px solid rgba(255,255,255,0.14)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.22em", fontWeight: 600, color: "rgba(244,241,234,0.62)" }}>STREET STRIKE · FINAL</div>
            {seats.length > 1 ? (
              <>
                <div style={{ fontFamily: DISPLAY, fontSize: "clamp(30px,9vw,44px)", lineHeight: 1.1, color: GA.goldLight }}>{verdict(seats, cards)}</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 18, margin: "8px 0 4px" }}>
                  {seats.map((p, k) => (
                    <div key={k}><div style={{ fontFamily: DISPLAY, fontSize: 34, lineHeight: 1 }}>{cards[k].total}</div><div style={{ fontSize: 12, fontWeight: 600, color: "rgba(244,241,234,0.7)" }}>{p.name}</div></div>
                  ))}
                </div>
              </>
            ) : <div style={{ fontFamily: DISPLAY, fontSize: "clamp(44px,13vw,68px)", lineHeight: 1.05, color: GA.goldLight }}>{cards[0].total}</div>}
            <div style={{ fontSize: 14, fontWeight: 500, color: "rgba(244,241,234,0.78)", marginBottom: 12 }}>
              {mode === "pass" ? "Run it back?" : beat ? "New best! Street champion 🏆" : best != null && best > cards[0].total ? `Your best ${best}. ${best - cards[0].total} more to beat it` : best != null ? `Your best ${best}` : "out of 150"}
            </div>
            <button onClick={() => restart()} style={{ width: "100%", padding: "14px 0", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: DISPLAY, fontSize: 19, color: "#06230f", background: "linear-gradient(180deg, #4ade80, #22c55e)", boxShadow: "0 4px 0 #15803d, 0 12px 24px -8px rgba(34,197,94,0.6)" }}>Play again</button>
            <button onClick={() => { restart(); setSetup(true); }} style={{ width: "100%", marginTop: 8, padding: "11px 0", borderRadius: 14, cursor: "pointer", fontFamily: DISPLAY, fontSize: 15, color: "#fff", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)" }}>Change mode</button>
            <Link href="/games" style={{ display: "inline-block", marginTop: 10, color: "#9b93b8", fontSize: 13, textDecoration: "none" }}>← Arena</Link>
          </div>
        </div>
      )}
      <style>{`@keyframes ssSwipe { 0% { transform: translateY(0) scale(1); opacity: 0; } 12% { opacity: 1; } 70% { opacity: 1; } 100% { transform: translateY(-34vh) scale(0.8); opacity: 0; } } @keyframes ssDash { to { background-position: 0 -20px; } } @keyframes ssPulse { 0%, 100% { transform: translate(-50%, -100%) scale(1); } 50% { transform: translate(-50%, -100%) scale(1.07); } } @keyframes ssPop { 0% { opacity: 0; transform: scale(0.6); } 12% { opacity: 1; transform: scale(1.12); } 22% { transform: scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(-18px); } }`}</style>
    </div>
  );
}

type Mode = "solo" | "cpu" | "pass";
interface Seat { name: string; cpu: boolean }
const MODES: { id: Mode; icon: string; name: string; note: string }[] = [
  { id: "solo", icon: "🎯", name: "Just me", note: "Beat your best" },
  { id: "cpu", icon: "🤖", name: "Vs computer", note: "Take turns with the CPU" },
  { id: "pass", icon: "👥", name: "2 players", note: "Pass the phone" },
];
function seatsFor(m: Mode): Seat[] {
  if (m === "cpu") return [{ name: "You", cpu: false }, { name: "CPU", cpu: true }];
  if (m === "pass") return [{ name: "Player 1", cpu: false }, { name: "Player 2", cpu: false }];
  return [{ name: "You", cpu: false }];
}
function verdict(seats: Seat[], cards: ScoreState[]) {
  const top = Math.max(...cards.map((c) => c.total));
  const who = seats.filter((_, i) => cards[i].total === top);
  if (who.length > 1) return "It's a draw!";
  return who[0].name === "You" ? "You win! 🏆" : `${who[0].name} wins!`;
}

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
