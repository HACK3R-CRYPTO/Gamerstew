"use client";

// ─── FightStage3D ────────────────────────────────────────────────────────────
// Challenge AI as an actual fight. Two 3D fighters stand on a glowing platform
// in front of the painted arena (the canvas is transparent, so the crowd shows
// through). The match itself is unchanged: the server still decides every
// round. This only ACTS OUT what happened, on the same four beats the page
// already runs:
//   banner / armed  both in a fighting stance, weight shifting
//   shaking         both wind up, bouncing on the spot (the ROCK-PAPER-SCISSORS chant)
//   impact          the winner lunges and hurls their move across the ring;
//                   it hits, the loser is knocked back; a tie is a mid-air clash
// A match win ends with the winner celebrating and the loser slumped.
//
// Characters and clips are the ones the street games already ship, so this
// adds almost nothing to download.

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";

export type FightBeat = "banner" | "armed" | "shaking" | "impact";
export interface FightProps {
  beat: FightBeat;
  result: "win" | "loss" | "tie" | null; // the round just resolved, from the player's side
  playerMove: number | null;
  aiMove: number | null;
  moveArt: readonly string[]; // rock, paper, scissors images
  matchOver: "win" | "loss" | null;
  playerColor: string;
  danger: boolean; // sudden death
}

const HERO = "/world/models/player.glb";
const BOT = "/world/models/peds/ch06.glb";
const CLIPS = {
  stance: "/world/models/anim/idle-heavy.glb",
  hit: "/world/models/anim/hit.glb",
  win: "/world/models/anim/cheer-excited.glb",
  lose: "/world/models/anim/sad-idle.glb",
} as const;
type Clip = keyof typeof CLIPS;
const CLIP_KEYS = Object.keys(CLIPS) as Clip[];
const GOLD = "#fbbf24";
const SIDE = 0.82; // how far each fighter stands from the centre

function bind(clip: THREE.AnimationClip, prefix: string, name: string, hips: number) {
  const c = clip.clone();
  for (const tr of c.tracks) {
    if (prefix) tr.name = tr.name.replace(/^mixamorig\d*/, prefix);
    if (/Hips\.position$/i.test(tr.name)) {
      const v = tr.values as unknown as Float32Array;
      const k = hips > 0 && v[1] > 0 ? hips / 0.979 : 1;
      const x0 = v[0] * k, z0 = v[2] * k;
      for (let i = 0; i + 2 < v.length; i += 3) { v[i] = x0; v[i + 1] *= k; v[i + 2] = z0; }
    }
  }
  c.name = name;
  return c;
}

// One fighter. `dir` is +1 for the player (left, facing right) and -1 for MARKOV.
function Fighter({ url, dir, tint, state }: { url: string; dir: 1 | -1; tint: string | null; state: React.MutableRefObject<Shared> }) {
  const model = useGLTF(url);
  const files = useGLTF(CLIP_KEYS.map((k) => CLIPS[k]));
  const root = useRef<THREE.Group>(null);
  const built = useMemo(() => {
    const obj = skeletonClone(model.scene);
    let prefix = "", hips = 0;
    obj.traverse((o) => {
      const m = o.name.match(/^(mixamorig\d*)/);
      if (!prefix && m) prefix = m[1];
      if (!hips && /Hips$/.test(o.name)) hips = o.position.y;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const paint = (src: THREE.Material) => {
        const c = (src as THREE.MeshStandardMaterial).clone();
        if (tint) {
          // MARKOV: the same body cast in gold, so it reads as a machine
          c.map = null;
          c.color = new THREE.Color(tint);
          c.metalness = 0.85;
          c.roughness = 0.28;
          c.emissive = new THREE.Color(tint);
          c.emissiveIntensity = 0.16;
        } else if (c.map) {
          c.emissive = new THREE.Color("#ffffff");
          c.emissiveMap = c.map;
          c.emissiveIntensity = 0.22;
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(paint) : paint(mesh.material);
    });
    const box = new THREE.Box3().setFromObject(obj);
    const tall = box.max.y - box.min.y;
    const mixer = new THREE.AnimationMixer(obj);
    const acts = {} as Record<Clip, THREE.AnimationAction | null>;
    CLIP_KEYS.forEach((k, i) => {
      const src = (files as unknown as { animations: THREE.AnimationClip[] }[])[i].animations[0];
      acts[k] = src ? mixer.clipAction(bind(src, prefix, k, hips)) : null;
    });
    return { obj, mixer, acts, scale: tall > 0.5 ? 1.62 / tall : 1 };
  }, [model, files, tint]);
  const cur = useRef<Clip>("stance");
  useEffect(() => {
    const a = built.acts.stance;
    if (a) { a.play(); a.time = dir > 0 ? 0 : 1.7; }
    return () => { built.mixer.stopAllAction(); };
  }, [built, dir]);
  const to = (name: Clip, fade = 0.18) => {
    if (cur.current === name) return;
    const from = built.acts[cur.current], next = built.acts[name];
    if (!next) return;
    next.reset().play();
    if (name === "hit") { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    if (from) next.crossFadeFrom(from, fade, false);
    cur.current = name;
  };
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = root.current;
    const s = state.current;
    if (!g) return;
    const me = dir > 0 ? "player" : "ai";
    const iWon = s.winner === me, iLost = s.winner !== null && s.winner !== "tie" && !iWon;
    let x = -dir * SIDE, y = 0, lean = 0, squash = 1;
    if (s.over) {
      to(s.over === me ? "win" : "lose", 0.35);
    } else if (s.beat === "shaking") {
      to("stance");
      // wind-up: three bounces in time with the chant, leaning in
      const b = Math.abs(Math.sin(s.t * 9));
      y = b * 0.13;
      lean = 0.16 + b * 0.08;
      squash = 1 - b * 0.04;
    } else if (s.beat === "impact") {
      const e = s.t;
      if (s.winner === "tie") {
        // both charge, meet in the middle, bounce back
        const k = e < 0.22 ? e / 0.22 : Math.max(0, 1 - (e - 0.22) / 0.45);
        x += dir * 0.62 * k;
        lean = 0.3 * k;
        to("stance");
      } else if (iWon) {
        // lunge forward as the move is thrown, then settle back
        const k = e < 0.16 ? e / 0.16 : Math.max(0, 1 - (e - 0.16) / 0.5);
        x += dir * 0.62 * k;
        lean = 0.5 * k;
        y = Math.sin(Math.min(1, e / 0.3) * Math.PI) * 0.1;
        to("stance");
      } else if (iLost) {
        // the throw lands at ~0.26 s: knocked back
        if (e > 0.26) {
          to("hit", 0.06);
          const k = Math.min(1, (e - 0.26) / 0.22);
          x -= dir * 0.5 * (1 - Math.pow(1 - k, 2));
          lean = -0.42 * (1 - Math.min(1, (e - 0.26) / 0.7));
        } else to("stance");
      }
    } else {
      to("stance", 0.3);
    }
    g.position.x += (x - g.position.x) * Math.min(1, dt * 22);
    g.position.y += (y - g.position.y) * Math.min(1, dt * 26);
    g.rotation.z += (-dir * lean - g.rotation.z) * Math.min(1, dt * 18);
    g.scale.set(built.scale, built.scale * squash, built.scale);
    built.mixer.update(dt);
  });
  return (
    <group ref={root} position={[-dir * SIDE, 0, 0]} rotation={[0, (dir * Math.PI) / 2, 0]}>
      <primitive object={built.obj} />
    </group>
  );
}

interface Shared { beat: FightBeat; t: number; winner: "player" | "ai" | "tie" | null; over: "player" | "ai" | null; pMove: number; aMove: number }

// The move itself, thrown across the ring as a spinning picture of rock, paper or scissors.
function Throws({ art, state }: { art: readonly string[]; state: React.MutableRefObject<Shared> }) {
  const tex = useTexture(art as string[]);
  const a = useRef<THREE.Sprite>(null);
  const b = useRef<THREE.Sprite>(null);
  const flash = useRef<THREE.Mesh>(null);
  const mats = useMemo(() => tex.map((t) => { t.colorSpace = THREE.SRGBColorSpace; return new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }); }), [tex]);
  useFrame(() => {
    const s = state.current;
    const show = s.beat === "impact" && s.winner !== null;
    const e = s.t;
    const place = (sp: THREE.Sprite | null, from: 1 | -1, on: boolean, move: number, reach: number) => {
      if (!sp) return;
      sp.visible = on && e < 0.42;
      if (!sp.visible) return;
      sp.material = mats[move] ?? mats[0];
      const k = Math.min(1, e / 0.26);
      sp.position.set(-from * (SIDE - 0.25) + from * reach * k, 1.15 + Math.sin(k * Math.PI) * 0.35, 0.2);
      sp.material.rotation = from * e * 14;
      const sc = 0.5 + k * 0.3;
      sp.scale.set(sc, sc, sc);
    };
    const tie = s.winner === "tie";
    // winner's move flies the whole way; in a tie both fly to the middle
    place(a.current, 1, show && (s.winner === "player" || tie), s.pMove, tie ? SIDE - 0.3 : SIDE * 2 - 0.5);
    place(b.current, -1, show && (s.winner === "ai" || tie), s.aMove, tie ? SIDE - 0.3 : SIDE * 2 - 0.5);
    if (flash.current) {
      const at = 0.26, k = show && e >= at ? Math.max(0, 1 - (e - at) / 0.3) : 0;
      flash.current.visible = k > 0;
      const hitX = tie ? 0 : s.winner === "player" ? SIDE - 0.2 : -(SIDE - 0.2);
      flash.current.position.set(hitX, 1.15, 0.3);
      flash.current.scale.setScalar(0.4 + (1 - k) * 1.6);
      (flash.current.material as THREE.MeshBasicMaterial).opacity = k * 0.9;
    }
  });
  return (
    <>
      <sprite ref={a} visible={false} />
      <sprite ref={b} visible={false} />
      <mesh ref={flash} visible={false}>
        <ringGeometry args={[0.32, 0.5, 24]} />
        <meshBasicMaterial color="#fff7d6" transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

function Rig({ state }: { state: React.MutableRefObject<Shared> }) {
  useFrame(({ camera }, rawDt) => {
    const s = state.current;
    s.t += Math.min(rawDt, 0.05);
    // a short shake when the throw lands
    const e = s.t;
    const k = s.beat === "impact" && s.winner && e > 0.26 && e < 0.55 ? 1 - (e - 0.26) / 0.29 : 0;
    camera.position.set(Math.sin(e * 70) * 0.05 * k, 1.75 + Math.cos(e * 55) * 0.04 * k, 5.3);
    camera.lookAt(0, 0.82, 0);
  });
  return null;
}

function Platform({ playerColor, danger }: { playerColor: string; danger: boolean }) {
  const rim = danger ? "#f87171" : "#c084fc";
  return (
    <group>
      <mesh position={[0, -0.09, 0]}>
        <cylinderGeometry args={[1.85, 2.0, 0.18, 6]} />
        <meshStandardMaterial color="#160b3d" metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[1.68, 1.84, 6]} />
        <meshBasicMaterial color={rim} toneMapped={false} />
      </mesh>
      {([[-SIDE, playerColor], [SIDE, GOLD]] as [number, string][]).map(([x, c]) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.008, 0]}>
          <ringGeometry args={[0.4, 0.48, 28]} />
          <meshBasicMaterial color={c} toneMapped={false} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

export default function FightStage3D(p: FightProps) {
  const state = useRef<Shared>({ beat: p.beat, t: 0, winner: null, over: null, pMove: 0, aMove: 0 });
  // Mirror the page's beat into the scene, restarting the beat clock on a change.
  const s = state.current;
  if (s.beat !== p.beat) { s.beat = p.beat; s.t = 0; }
  s.winner = p.beat === "impact" && p.result ? (p.result === "win" ? "player" : p.result === "loss" ? "ai" : "tie") : null;
  s.over = p.matchOver === "win" ? "player" : p.matchOver === "loss" ? "ai" : null;
  s.pMove = p.playerMove ?? 0;
  s.aMove = p.aiMove ?? 0;
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 1.75, 5.3], fov: 34, near: 0.1, far: 40 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
    >
      <ambientLight intensity={0.75} />
      <hemisphereLight args={["#c9b8ff", "#1a0b40", 0.9]} />
      <directionalLight position={[-3, 5, 4]} intensity={1.5} color="#e9ddff" />
      <pointLight position={[-2.2, 2.4, 1.6]} intensity={14} distance={8} color={p.playerColor} />
      <pointLight position={[2.2, 2.4, 1.6]} intensity={16} distance={8} color={GOLD} />
      <Rig state={state} />
      <Platform playerColor={p.playerColor} danger={p.danger} />
      <Suspense fallback={null}>
        <Fighter url={HERO} dir={1} tint={null} state={state} />
        <Fighter url={BOT} dir={-1} tint={GOLD} state={state} />
        <Throws art={p.moveArt} state={state} />
      </Suspense>
    </Canvas>
  );
}
