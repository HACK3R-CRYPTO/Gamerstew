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
const SHEET_W = 0.6, SHEET_H = 0.78;
const ROCK_GLB = "/games/challenge-ai-v2/models/rock.glb";
const SCISSORS_GLB = "/games/challenge-ai-v2/models/scissors.glb";

interface Slot {
  root: THREE.Group; rock: THREE.Object3D; paper: THREE.Group; halves: [THREE.Mesh, THREE.Mesh]; base: [Float32Array, Float32Array];
  scissors: THREE.Group; blades: [THREE.Object3D, THREE.Object3D];
}

// The sheet's face: ruled notebook paper with a red margin and a smug look.
// Eyes sit above the middle and the smirk below, so a cut runs between them.
let paperTex: THREE.CanvasTexture | null = null;
function paperTexture() {
  if (paperTex) return paperTex;
  const W = 256, H = 332;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#fffdf3"); g.addColorStop(1, "#f1ead2");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = "#9cc0ee"; c.lineWidth = 2.5;
  for (let y = 44; y < H - 10; y += 26) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.strokeStyle = "#f28b8b"; c.lineWidth = 3; c.beginPath(); c.moveTo(40, 0); c.lineTo(40, H); c.stroke();
  c.fillStyle = "#e9e1c6"; for (const y of [50, 166, 282]) { c.beginPath(); c.arc(18, y, 8, 0, Math.PI * 2); c.fill(); } // punch holes
  c.fillStyle = "#2a2140"; c.strokeStyle = "#2a2140"; c.lineCap = "round";
  for (const x of [104, 184]) { // half-lidded eyes
    c.beginPath(); c.ellipse(x, 120, 17, 13, 0, 0, Math.PI); c.fill();
    c.lineWidth = 7; c.beginPath(); c.moveTo(x - 22, 118); c.lineTo(x + 22, 118); c.stroke();
    c.fillStyle = "#ffffff"; c.beginPath(); c.arc(x + 6, 124, 4, 0, Math.PI * 2); c.fill(); c.fillStyle = "#2a2140";
  }
  c.lineWidth = 7; c.beginPath(); c.moveTo(112, 208); c.quadraticCurveTo(150, 232, 186, 196); c.stroke(); // smirk
  c.strokeStyle = "rgba(0,0,0,0.12)"; c.lineWidth = 6; c.strokeRect(0, 0, W, H);
  paperTex = new THREE.CanvasTexture(cv); paperTex.colorSpace = THREE.SRGBColorSpace; paperTex.anisotropy = 4;
  return paperTex;
}

// Rock and scissors are modelled in Blender (tools/blender/rps.py). The paper is
// built here, because it has to bend: it curls like a scroll, wraps and tears.
function MoveObject({ slot }: { slot: React.MutableRefObject<Slot | null> }) {
  const rockFile = useGLTF(ROCK_GLB);
  const scFile = useGLTF(SCISSORS_GLB);
  const built = useMemo(() => {
    const root = new THREE.Group();
    const lift = (o: THREE.Object3D, glow: number) => o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const one = (src: THREE.Material) => {
        const c = (src as THREE.MeshStandardMaterial).clone();
        // no environment map in this scene, so tone the metal down and let colour carry it
        c.metalness = Math.min(c.metalness, 0.35);
        if (c.emissive.getHex() === 0) { c.emissive = c.color.clone(); c.emissiveIntensity = glow; }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
    });
    const rock = rockFile.scene.clone(true); lift(rock, 0.12); rock.scale.setScalar(1.1);
    root.add(rock);
    // paper: a top and a bottom half, so scissors can cut straight across it
    const paper = new THREE.Group();
    const tex = paperTexture();
    const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.32 });
    const halves = [1, -1].map((sy) => {
      const g = new THREE.PlaneGeometry(SHEET_W, SHEET_H / 2, 12, 12);
      g.translate(0, (sy * SHEET_H) / 4, 0);
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.5 + (sy > 0 ? 0.5 : 0));
      const m = new THREE.Mesh(g, pm);
      paper.add(m);
      return m;
    }) as unknown as [THREE.Mesh, THREE.Mesh];
    const base = halves.map((h) => Float32Array.from(h.geometry.getAttribute("position").array as Float32Array)) as [Float32Array, Float32Array];
    root.add(paper);
    const scissors = new THREE.Group();
    const sc = scFile.scene.clone(true); lift(sc, 0.2); sc.scale.setScalar(0.8);
    scissors.add(sc);
    const blades = [sc.getObjectByName("armA") ?? new THREE.Group(), sc.getObjectByName("armB") ?? new THREE.Group()] as [THREE.Object3D, THREE.Object3D];
    root.add(scissors);
    root.visible = false;
    return { root, rock, paper, halves, base, scissors, blades };
  }, [rockFile, scFile]);
  useEffect(() => { slot.current = built; return () => { slot.current = null; }; }, [built, slot]);
  return <primitive object={built.root} />;
}

// Shape the sheet. At rest it is a scroll: the top rolls forward, the foot kicks
// out, and it ripples in the air. `wrap` (0..1) folds it round a ball of radius R.
function shapePaper(sl: Slot, t: number, wrap: number, R: number) {
  const top = SHEET_H / 2 - 0.13, foot = -(SHEET_H / 2 - 0.09), r1 = 0.05, r2 = 0.07;
  for (let h = 0; h < 2; h++) {
    const pos = sl.halves[h].geometry.getAttribute("position") as THREE.BufferAttribute;
    const b = sl.base[h];
    for (let i = 0; i < pos.count; i++) {
      const x = b[i * 3], y = b[i * 3 + 1];
      let fy = y, fz = Math.sin(x * 8 + t * 7) * 0.018 + Math.sin(y * 6 + t * 5) * 0.022;
      if (y > top) { const a = (y - top) / r1; fy = top + r1 * Math.sin(a); fz += r1 * (1 - Math.cos(a)); }
      else if (y < foot) { const a = (foot - y) / r2; fy = foot - r2 * Math.sin(a); fz += r2 * (1 - Math.cos(a)); }
      if (wrap <= 0) { pos.setXYZ(i, x, fy, fz); continue; }
      // lay the sheet over the ball: x spreads round it, y over the top
      const th = (x / (SHEET_W / 2)) * 1.25, ph = (y / (SHEET_H / 2)) * 1.15;
      const wx = Math.sin(th) * Math.cos(ph) * R, wy = Math.sin(ph) * R, wz = Math.cos(th) * Math.cos(ph) * R;
      pos.setXYZ(i, x + (wx - x) * wrap, fy + (wy - fy) * wrap, fz + (wz - fz) * wrap);
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
      sl.rock.position.set(0, 0, 0); sl.rock.rotation.set(0, Math.sin(e * 5) * 0.25, Math.sin(e * 7) * 0.12); sl.rock.scale.setScalar(1.1);
      sl.paper.position.set(0, 0, 0); sl.paper.rotation.set(0, 0, 0);
      sl.halves[0].position.set(0, 0, 0); sl.halves[1].position.set(0, 0, 0); sl.halves[0].rotation.set(0, 0, 0); sl.halves[1].rotation.set(0, 0, 0);
      sl.scissors.position.set(0, 0, 0); sl.scissors.rotation.set(0, 0, 0);
      sl.blades[0].position.set(0, 0, 0); sl.blades[1].position.set(0, 0, 0); sl.blades[0].rotation.set(0, 0, 0); sl.blades[1].rotation.set(0, 0, 0);
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
      W.rock.scale.setScalar(1.1 + Math.sin(k * Math.PI) * 0.4);
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
      shapePaper(W, e, wrap, 0.4);
      W.paper.rotation.y = (1 - wrap) * 0.2;
      // the rock stops spinning and is carried down inside the sheet
      L.rock.rotation.set(0, 0, 0);
      const drop = ease(after / 0.6) * 0.16;
      W.root.position.y -= drop; L.root.position.y -= drop;
      L.rock.scale.setScalar(1.1 - wrap * 0.3);
      ring(lx, 0.84, 0.26);
    } else {
      // SCISSORS CUT PAPER: blades snip through, the two halves part and fall
      W.root.position.x += (lx - wdir * 0.1 - W.root.position.x) * k + wdir * ease(after / 0.35) * 0.34;
      snip(W, 0.34 * Math.abs(Math.cos(e * 16)));
      if (e > 0.52) {
        const t2 = e - 0.52;
        for (let i = 0; i < 2; i++) {
          const sg = i ? 1 : -1;
          const sg2 = -sg; // halves[0] is the top
          L.halves[i].position.set(sg2 * t2 * 0.14, sg2 * 0.09 * Math.min(1, t2 * 5) - t2 * t2 * 1.7, sg2 * t2 * 0.12);
          L.halves[i].rotation.set(-sg2 * t2 * 2.0, t2 * 0.9, sg2 * t2 * 1.5);
        }
        L.root.scale.setScalar(Math.max(0, 1 - Math.max(0, t2 - 0.5) / 0.6));
      }
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
