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
import { useGLTF } from "@react-three/drei";
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

// ─── The moves themselves, as real objects that do what the rule says ────────
// Each fighter throws their move into the middle of the ring, and then the
// winning move visibly beats the losing one:
//   rock beats scissors   the rock slams into the scissors and they fly apart
//   paper beats rock      the sheet flies over the rock and wraps round it
//   scissors beat paper   the blades snip through the sheet; the halves fall
//   same move             they crash together and bounce off
// All three are built here from simple shapes (no model files): a chipped
// boulder, a flexible sheet in two halves, and two blades on a pin.
const ROCK = 0, PAPER = 1, SCISSORS = 2;
const MID_Y = 1.22;
const HALF_W = 0.3, SHEET_H = 0.78;

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(0.3, 1);
  const p = g.getAttribute("position");
  let sd = 7;
  const r = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.82 + r() * 0.36); // the same bump for a shared corner, so faces stay joined
    const m = seen.get(k)!;
    p.setXYZ(i, p.getX(i) * m, p.getY(i) * m * 0.9, p.getZ(i) * m);
  }
  g.computeVertexNormals();
  return g;
}
function bladeGeometry() {
  const sh = new THREE.Shape();
  sh.moveTo(-0.06, -0.04); sh.lineTo(0.06, -0.04); sh.lineTo(0.05, 0.3); sh.lineTo(0, 0.6); sh.lineTo(-0.03, 0.3); sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false });
}

interface Slot {
  root: THREE.Group; rock: THREE.Mesh; paper: THREE.Group; halves: [THREE.Mesh, THREE.Mesh]; base: [Float32Array, Float32Array];
  scissors: THREE.Group; blades: [THREE.Group, THREE.Group];
}

function MoveObject({ slot }: { slot: React.MutableRefObject<Slot | null> }) {
  const built = useMemo(() => {
    const root = new THREE.Group();
    const rock = new THREE.Mesh(rockGeometry(), new THREE.MeshStandardMaterial({ color: "#8b93a7", roughness: 0.85, metalness: 0.05, flatShading: true }));
    root.add(rock);
    // paper: two half sheets side by side, so scissors can part them
    const paper = new THREE.Group();
    // a ruled sheet with a red margin, drawn once, so it reads as paper even when wrapped
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 256;
    const cx = cv.getContext("2d")!;
    cx.fillStyle = "#fbf7ea"; cx.fillRect(0, 0, 128, 256);
    cx.strokeStyle = "#8fb4e8"; cx.lineWidth = 2;
    for (let y = 30; y < 250; y += 20) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(128, y); cx.stroke(); }
    cx.strokeStyle = "#f08a8a"; cx.beginPath(); cx.moveTo(22, 0); cx.lineTo(22, 256); cx.stroke();
    const ptex = new THREE.CanvasTexture(cv); ptex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.9, side: THREE.DoubleSide, emissive: "#ffffff", emissiveMap: ptex, emissiveIntensity: 0.3 });
    const halves = [-1, 1].map((sx) => {
      const g = new THREE.PlaneGeometry(HALF_W, SHEET_H, 6, 12);
      g.translate((sx * HALF_W) / 2, 0, 0);
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (sx > 0 ? 0.5 : 0));
      const m = new THREE.Mesh(g, pm);
      paper.add(m);
      return m;
    }) as unknown as [THREE.Mesh, THREE.Mesh];
    const base = halves.map((h) => Float32Array.from(h.geometry.getAttribute("position").array as Float32Array)) as [Float32Array, Float32Array];
    root.add(paper);
    // scissors: two blades crossing at a pin, each with a ring handle
    const scissors = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: "#eef3fb", metalness: 0.55, roughness: 0.3, emissive: "#9fb4d8", emissiveIntensity: 0.25 });
    const grip = new THREE.MeshStandardMaterial({ color: "#f43f5e", roughness: 0.5 });
    const bg = bladeGeometry();
    const blades = [-1, 1].map((sx) => {
      const arm = new THREE.Group();
      const blade = new THREE.Mesh(bg, steel);
      blade.position.z = sx * 0.012;
      arm.add(blade);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.036, 8, 18), grip);
      ring.position.set(sx * 0.11, -0.24, 0.015);
      arm.add(ring);
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.03), steel);
      stem.position.set(sx * 0.05, -0.1, 0.015);
      stem.rotation.z = -sx * 0.4;
      arm.add(stem);
      scissors.add(arm);
      return arm;
    }) as [THREE.Group, THREE.Group];
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.07, 10), new THREE.MeshStandardMaterial({ color: "#fbbf24", metalness: 0.8, roughness: 0.3 }));
    pin.rotation.x = Math.PI / 2;
    scissors.add(pin);
    scissors.scale.setScalar(1.15);
    root.add(scissors);
    root.visible = false;
    return { root, rock, paper, halves, base, scissors, blades };
  }, []);
  useEffect(() => { slot.current = built; return () => { slot.current = null; }; }, [built, slot]);
  return <primitive object={built.root} />;
}

// Shape the sheet: a gentle flutter, and (wrap 0..1) curl it round a ball of radius R centred on the sheet.
function shapePaper(sl: Slot, t: number, wrap: number, R: number) {
  for (let h = 0; h < 2; h++) {
    const pos = sl.halves[h].geometry.getAttribute("position") as THREE.BufferAttribute;
    const b = sl.base[h];
    for (let i = 0; i < pos.count; i++) {
      const x = b[i * 3], y = b[i * 3 + 1];
      const fx = x, fy = y, fz = Math.sin(x * 9 + t * 7) * 0.02 + Math.sin(y * 6 + t * 5) * 0.025;
      if (wrap <= 0) { pos.setXYZ(i, fx, fy, fz); continue; }
      // lay the sheet over the ball: x spreads round it, y over the top
      const th = (x / HALF_W) * 1.25, ph = (y / (SHEET_H / 2)) * 1.15;
      const wx = Math.sin(th) * Math.cos(ph) * R, wy = Math.sin(ph) * R, wz = Math.cos(th) * Math.cos(ph) * R;
      pos.setXYZ(i, fx + (wx - fx) * wrap, fy + (wy - fy) * wrap, fz + (wz - fz) * wrap);
    }
    pos.needsUpdate = true;
    sl.halves[h].geometry.computeVertexNormals();
  }
}

function Clash({ state }: { state: React.MutableRefObject<Shared> }) {
  const a = useRef<Slot | null>(null); // the player's move
  const b = useRef<Slot | null>(null); // MARKOV's move
  const flash = useRef<THREE.Mesh>(null);
  const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  useFrame(() => {
    const s = state.current;
    if (process.env.NODE_ENV !== "production") {
      const f = (window as unknown as { __fightForce?: { p: number; a: number } }).__fightForce;
      if (f && s.winner) { s.pMove = f.p; s.aMove = f.a; const d = (f.p - f.a + 3) % 3; s.winner = d === 0 ? "tie" : d === 1 ? "player" : "ai"; }
    }
    const A = a.current, B = b.current;
    if (!A || !B) return;
    const on = s.beat === "impact" && s.winner !== null;
    A.root.visible = on; B.root.visible = on;
    if (flash.current) flash.current.visible = false;
    if (!on) return;
    const e = s.t;
    const set = (sl: Slot, move: number) => { sl.rock.visible = move === ROCK; sl.paper.visible = move === PAPER; sl.scissors.visible = move === SCISSORS; };
    set(A, s.pMove); set(B, s.aMove);
    // reset poses each frame; the rules below then act on them
    for (const sl of [A, B]) {
      sl.root.scale.setScalar(1); sl.root.rotation.set(0, 0, 0);
      sl.rock.position.set(0, 0, 0); sl.rock.rotation.set(e * 2.2, e * 1.6, 0); sl.rock.scale.setScalar(1);
      sl.paper.position.set(0, 0, 0); sl.paper.rotation.set(0, 0, 0);
      sl.halves[0].position.set(0, 0, 0); sl.halves[1].position.set(0, 0, 0); sl.halves[0].rotation.set(0, 0, 0); sl.halves[1].rotation.set(0, 0, 0);
      sl.scissors.position.set(0, 0, 0); sl.scissors.rotation.set(0, 0, 0);
      sl.blades[0].position.set(0, 0, 0); sl.blades[1].position.set(0, 0, 0);
    }
    const snip = (sl: Slot, open: number) => { sl.blades[0].rotation.z = open; sl.blades[1].rotation.z = -open; };
    snip(A, 0.32); snip(B, 0.32);
    shapePaper(A, e, 0, 0.3); shapePaper(B, e + 1.3, 0, 0.3);

    // 1. both moves are thrown in from their fighter and meet near the middle
    const fly = ease(e / 0.3);
    const meet = 0.34;
    const arc = Math.sin(fly * Math.PI) * 0.3;
    A.root.position.set(-(SIDE - 0.2) + (SIDE - 0.2 - meet) * fly, MID_Y + arc, 0.55);
    B.root.position.set((SIDE - 0.2) - (SIDE - 0.2 - meet) * fly, MID_Y + arc, 0.55);
    // scissors point at the opponent; paper faces the camera
    A.scissors.rotation.z = -Math.PI / 2; B.scissors.rotation.z = Math.PI / 2;

    const ring = (x: number, at: number, len = 0.32) => {
      const f = flash.current; if (!f) return;
      const k = e >= at ? Math.max(0, 1 - (e - at) / len) : 0;
      f.visible = k > 0; f.position.set(x, MID_Y, 0.7); f.scale.setScalar(0.35 + (1 - k) * 1.5);
      (f.material as THREE.MeshBasicMaterial).opacity = k * 0.9;
    };

    if (s.winner === "tie") {
      // crash together and bounce off
      const k = e < 0.3 ? 0 : Math.min(1, (e - 0.3) / 0.5);
      const back = Math.sin(k * Math.PI) * 0.26 + k * 0.1;
      A.root.position.x = -meet + 0.2 * (e < 0.3 ? 0 : 1) - back - 0.2;
      B.root.position.x = meet - 0.2 * (e < 0.3 ? 0 : 1) + back + 0.2;
      A.root.rotation.z = k * 1.4; B.root.rotation.z = -k * 1.4;
      ring(0, 0.3);
      return;
    }
    const W = s.winner === "player" ? A : B, L = s.winner === "player" ? B : A;
    const wm = s.winner === "player" ? s.pMove : s.aMove;
    const wdir = s.winner === "player" ? 1 : -1; // direction the winner's move travels
    const lx = wdir * meet;
    const k = ease((e - 0.3) / 0.28); // the strike
    const after = Math.max(0, e - 0.58);

    if (wm === ROCK) {
      // ROCK SMASHES SCISSORS: the rock drives through, the blades burst apart
      W.root.position.x += (lx - W.root.position.x) * k;
      W.rock.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.35);
      if (e > 0.5) {
        const t2 = e - 0.5;
        for (let i = 0; i < 2; i++) {
          const sg = i ? 1 : -1;
          L.blades[i].position.set(wdir * t2 * 1.5, sg * t2 * 1.5 - t2 * t2 * 2.4, sg * t2 * 0.5);
          L.blades[i].rotation.z += t2 * 11 * sg;
        }
        L.root.scale.setScalar(Math.max(0, 1 - t2 / 0.9));
      }
      ring(lx, 0.5);
    } else if (wm === PAPER) {
      // PAPER COVERS ROCK: the sheet sails over and wraps round it
      W.root.position.x += (lx - W.root.position.x) * k;
      W.root.position.y += Math.sin(k * Math.PI) * 0.16;
      const wrap = ease((e - 0.46) / 0.42);
      shapePaper(W, e, wrap, 0.36);
      W.paper.rotation.y = (1 - wrap) * 0.2;
      // the rock stops spinning and is carried down inside the sheet
      L.rock.rotation.set(0.4, 0.3, 0);
      const drop = ease(after / 0.6) * 0.16;
      W.root.position.y -= drop; L.root.position.y -= drop;
      L.rock.scale.setScalar(1 - wrap * 0.08);
      ring(lx, 0.84, 0.26);
    } else {
      // SCISSORS CUT PAPER: blades snip through, the two halves part and fall
      W.root.position.x += (lx - wdir * 0.1 - W.root.position.x) * k + wdir * ease(after / 0.35) * 0.34;
      snip(W, 0.34 * Math.abs(Math.cos(e * 16)));
      if (e > 0.52) {
        const t2 = e - 0.52;
        for (let i = 0; i < 2; i++) {
          const sg = i ? 1 : -1;
          L.halves[i].position.set(sg * t2 * 0.32, sg * 0.06 * Math.min(1, t2 * 4) - t2 * t2 * 1.7, sg * t2 * 0.12);
          L.halves[i].rotation.set(t2 * 2.2 * sg, t2 * 1.4, sg * t2 * 2.4);
        }
        L.root.scale.setScalar(Math.max(0, 1 - Math.max(0, t2 - 0.5) / 0.6));
      }
      // a sheet stands taller than it is wide, so the cut runs across the middle
      L.paper.rotation.z = Math.PI / 2;
      ring(lx, 0.52, 0.22);
    }
  });
  return (
    <>
      <MoveObject slot={a} />
      <MoveObject slot={b} />
      <mesh ref={flash} visible={false}>
        <ringGeometry args={[0.3, 0.46, 24]} />
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
        <Clash state={state} />
      </Suspense>
    </Canvas>
  );
}
