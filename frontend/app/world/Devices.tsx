"use client";

// ─── Devices — the chargeable appliances around the neighbourhood ────────────
// Small Blender-built models (see MODEL below): a phone, a rechargeable lantern
// and a power bank on their stools, a standing fan whose blades spin while
// charging, an inverter with its battery, and a fridge.
//
// Each device shares ONE emissive "glow" material across its lit parts; the
// GameDirector-owned hot state (deviceState[idx]: progress / cooldown / flash)
// drives that glow, the spinning blades, a flat ground ring marking the charge
// radius, and a billboard progress bar. All in useFrame, no React re-renders.

import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
const _tagAt = new THREE.Vector3();
import { worldControls } from "./controls";
import { DEVICES, STATION, SOCKET_COUNT, live, hands, naira, rush, perks, type DeviceDef } from "./game";
import { GA } from "./theme";
import { quality } from "./quality";

// A device's floating "icon ₦value" label, drawn to a canvas and used as a
// texture on a billboard plane — fully in-canvas, so no drei <Html> React root
// (which clashes with our manual render loop). Returns null during SSR.
function makeLabelTexture(icon: string, value: string, color: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const w = 256;
  const h = 72;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const round = (x: number, y: number, ww: number, hh: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, r);
    ctx.arcTo(x + ww, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + ww, y, r);
    ctx.closePath();
  };
  ctx.fillStyle = "rgba(8,6,20,0.86)";
  round(4, 4, w - 8, h - 8, 26);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = color;
  round(4, 4, w - 8, h - 8, 26);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 38px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${icon} ${value}`, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const DEVICE_SCALE = 2.1; // bump model size so they read clearly from the follow cam
// Height to float the progress bar above each device type (pre-scale).
const BAR_Y: Record<string, number> = {
  phone: 0.95,
  lamp: 0.95,
  powerbank: 0.95,
  fan: 1.35,
  inverter: 1.0,
  fridge: 1.75,
};

// ── The models ───────────────────────────────────────────────────────────────
// Built in Blender from tools/blender/build_devices.py and exported as small GLB
// files (10 to 130 KB). Each is at most four meshes:
//   body    everything solid, coloured per vertex, so every device in the world
//           shares ONE material
//   glow    the parts that light while charging
//   blades  the fan only, spun here
//   stand   the stool a small device waits on. It stays at the spot when the
//           device is carried off, which also marks where it lives.
// That is two or three draw calls a device, where the old in-code props were
// five to twelve.
const MODEL = (id: string) => `/world/models/charge-${id}.glb`;
const BODY_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
const SHADOWS = quality().tier === "high"; // small props casting shadows is a cost phones do not need
/** How high a small device sits on its stool (model metres). */
const STAND_H: Record<string, number> = { phone: 0.28, lamp: 0.22, powerbank: 0.28 };

interface Part { geometry: THREE.BufferGeometry; position: THREE.Vector3 }
function useParts(id: string): Record<string, Part> {
  const { scene } = useGLTF(MODEL(id));
  return useMemo(() => {
    const out: Record<string, Part> = {};
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      // the loader turns Blender's "body.003" into "body003": keep the word, drop the number
      if (m.isMesh) out[m.name.replace(/[._]?\d+$/, "")] = { geometry: m.geometry, position: m.position.clone() };
    });
    return out;
  }, [scene]);
}

// The device itself (no stool). `glowMat` lights its lit parts; `bladeRef` is the fan's.
function Body({ id, glowMat, bladeRef }: { id: string; glowMat: THREE.MeshStandardMaterial; bladeRef: RefObject<THREE.Group | null> }) {
  const p = useParts(id);
  return (
    <group>
      {p.body && <mesh geometry={p.body.geometry} position={p.body.position} material={BODY_MAT} castShadow={SHADOWS} />}
      {p.glow && <mesh geometry={p.glow.geometry} position={p.glow.position} material={glowMat} />}
      {p.blades && (
        <group ref={bladeRef} position={p.blades.position}>
          <mesh geometry={p.blades.geometry} material={BODY_MAT} />
        </group>
      )}
    </group>
  );
}
function Stand({ id }: { id: string }) {
  const p = useParts(id);
  return p.stand ? <mesh geometry={p.stand.geometry} position={p.stand.position} material={BODY_MAT} /> : null;
}

// Where each socket's device sits on the box (box-local metres, +Z toward the road).
const SLOT_X = [-0.95, 0, 0.95];
/** Long things are carried lying down. */
const LIES_DOWN = new Set(["fan", "fridge"]);
/** The charging table is drawn this much bigger than it was modelled, so it reads from the follow camera. */
const TABLE_SCALE = 1.4;
const TABLE_TOP = 0.16 + 0.47 * TABLE_SCALE;
const BAR_W = 1.1;

// One device. It lives at its spot, rides above your head while carried, and sits
// on its socket while charging, with a fill bar that turns green when full.
function DeviceMesh({ def, idx }: { def: DeviceDef; idx: number }) {
  const root = useRef<THREE.Group>(null);
  const bladeRef = useRef<THREE.Group>(null);
  const label = useRef<THREE.Mesh>(null);
  const bar = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const inner = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  // a soft column of light in the device's colour, so its spot can be found from across the street
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false }), [def.color]);
  const want = useMemo(() => new THREE.Vector3(), []);
  const wantYaw = useRef(0);
  const tilt = useRef(0);
  const scale = useRef(DEVICE_SCALE);
  const placed = useRef(false);

  const glowMat = useMemo(() => new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.4, roughness: 0.4 }), [def.color]);
  const labelTex = useMemo(() => makeLabelTexture(def.icon, naira(def.value), def.color), [def]);
  const labelMat = useMemo(() => new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false, toneMapped: false, fog: false }), [labelTex]);
  const fillMat = useMemo(() => new THREE.MeshBasicMaterial({ color: GA.gold, toneMapped: false, fog: false }), []);
  const backMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#0a0120", transparent: true, opacity: 0.8, toneMapped: false, fog: false }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }), [def.color]);
  const gold = useMemo(() => new THREE.Color(GA.gold), []);
  const green = useMemo(() => new THREE.Color(GA.green), []);
  const top = (BAR_Y[def.id] ?? 1) * DEVICE_SCALE;

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = root.current;
    if (!g) return;
    const d = live[idx];
    const t = state.clock.elapsedTime;
    g.visible = d.respawn <= 0;

    // Where it should be, which way it faces, and how big, for its state. It
    // then GLIDES there (below), so a pick-up, a plug-in and a put-down are each
    // a short hop instead of a jump cut.
    let s = DEVICE_SCALE;
    let lift = 0; // the device without its stool sits this much lower
    const stand = STAND_H[def.id] ?? 0;
    if (d.where === "carried") {
      const p = worldControls.playerPos;
      const yaw = worldControls.playerYaw;
      const step = Math.sin(t * 11) * 0.025 * Math.min(1, worldControls.playerSpeed / 2); // it bobs with your stride, and is still when you are
      // Everything rides up on your head, steadied with both hands, the way
      // loads are carried on the street. It is also the one place the camera,
      // which sits behind and above you, can always see it.
      want.set(p.x, 1.82 + step, p.z);
      s = def.id === "fridge" ? 1.05 : def.id === "fan" ? 1.15 : def.id === "inverter" ? 1.25 : 1.5;
      tilt.current = LIES_DOWN.has(def.id) ? -Math.PI / 2 : 0;
      wantYaw.current = yaw;
      lift = stand;
    } else if (d.where === "socket") {
      want.set(STATION[0] + 0.45, TABLE_TOP, STATION[1] + SLOT_X[d.socket] * TABLE_SCALE);
      s = def.id === "fridge" ? 1.0 : def.id === "fan" ? 1.15 : 1.5;
      wantYaw.current = -Math.PI / 2; // facing the road
      tilt.current = 0;
      lift = stand;
    } else {
      want.set(def.pos[0], 0.16, def.pos[1]);
      wantYaw.current = def.pos[0] > 0 ? -Math.PI / 2 : Math.PI / 2; // facing the road from either pavement
      tilt.current = 0;
    }
    if (!placed.current || d.respawn > 0) { g.position.copy(want); g.rotation.y = wantYaw.current; placed.current = true; }
    const k = 1 - Math.exp(-dt * (d.where === "carried" ? 16 : 9));
    const far = Math.hypot(want.x - g.position.x, want.z - g.position.z);
    g.position.x += (want.x - g.position.x) * k;
    g.position.z += (want.z - g.position.z) * k;
    // a little arc while it is travelling between places
    g.position.y += (want.y + Math.min(0.5, far * 0.3) - g.position.y) * k;
    let dy = wantYaw.current - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * k;
    if (inner.current) {
      inner.current.position.y += (-lift - inner.current.position.y) * k;
      inner.current.rotation.x += (tilt.current - inner.current.rotation.x) * k;
    }
    scale.current += (s - scale.current) * k;
    const pop = 1 + d.pulse * 0.18;
    g.scale.setScalar(scale.current * pop);

    const charging = d.where === "socket" && !d.ready && worldControls.lit > 0.5;
    glowMat.emissiveIntensity = d.ready ? 1.4 + Math.sin(t * 8) * 0.5 : charging ? 0.5 + d.progress * 1.1 : 0.25 * worldControls.lit;
    if (bladeRef.current && charging) bladeRef.current.rotation.z += dt * (4 + d.progress * 18);

    // value tag: only while it is waiting at its spot
    if (label.current) {
      label.current.visible = d.where === "home";
      label.current.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion); // the device now turns, the tag must not
      // a price tag is a label, not scenery: about the same size on screen wherever the camera is,
      // so one near the lens no longer fills a corner of a phone
      label.current.scale.setScalar(THREE.MathUtils.clamp(camera.position.distanceTo(g.getWorldPosition(_tagAt)) / 12, 0.45, 1.15));
    }
    if (beam.current) {
      // a neighbour's rush job burns gold and brighter, and shows even while your hands are full
      const rushed = rush.idx === idx;
      beam.current.visible = d.where === "home" && (hands.idx < 0 || rushed);
      beamMat.color.set(rushed ? GA.gold : def.color);
      beamMat.opacity = rushed ? 0.5 + Math.sin(t * 7) * 0.2 : 0.2 + Math.sin(t * 2.4 + idx) * 0.08;
      beam.current.scale.setScalar(rushed ? 1.5 : 1);
    }
    if (ring.current) {
      ring.current.visible = d.where === "home";
      ringMat.opacity = 0.35 + Math.sin(t * 3 + idx) * 0.2;
    }
    // charge bar: only in a socket
    if (bar.current && fill.current) {
      bar.current.visible = d.where === "socket";
      bar.current.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion);
      const f = Math.max(0.02, d.progress);
      fill.current.scale.x = f;
      fill.current.position.x = -(BAR_W * (1 - f)) / 2;
      fillMat.color.copy(d.ready ? green : gold);
      if (d.ready) bar.current.position.y = top + 0.5 + Math.sin(t * 7) * 0.06;
    }
  });

  return (
    <>
    {/* the stool stays at the spot, whether the device is on it or not */}
    <group position={[def.pos[0], 0.16, def.pos[1]]} rotation={[0, def.pos[0] > 0 ? -Math.PI / 2 : Math.PI / 2, 0]} scale={DEVICE_SCALE} userData={{ noBatch: true }}>
      <Stand id={def.id} />
      <mesh ref={beam} position={[0, 2.2, 0]} material={beamMat} renderOrder={3}>
        <cylinderGeometry args={[0.16, 0.5, 4.4, 14, 1, true]} />
      </mesh>
    </group>
    <group ref={root} userData={{ noBatch: true }}>
      <group ref={inner}>
        <Body id={def.id} glowMat={glowMat} bladeRef={bladeRef} />
      </group>
      <mesh ref={label} position={[0, (top + 0.55) / DEVICE_SCALE, 0]} material={labelMat} renderOrder={5}>
        <planeGeometry args={[1.25, 0.35]} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={ringMat}>
        <ringGeometry args={[0.62, 0.74, 28]} />
      </mesh>
      <group ref={bar} position={[0, top + 0.5, 0]} scale={1 / DEVICE_SCALE} renderOrder={6}>
        <mesh material={backMat}>
          <planeGeometry args={[BAR_W + 0.12, 0.26]} />
        </mesh>
        <mesh ref={fill} position={[0, 0, 0.01]} material={fillMat}>
          <planeGeometry args={[BAR_W, 0.16]} />
        </mesh>
      </group>
    </group>
    </>
  );
}

// The board over the charging point, drawn once to a canvas.
function makeSignTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 1024; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a1458"; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = "#ffd36a"; g.lineWidth = 14; g.strokeRect(12, 12, 1000, 232);
  g.fillStyle = "#ffd36a"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "900 132px system-ui, -apple-system, 'Segoe UI', sans-serif";
  g.fillText("⚡ CHARGE HERE", 512, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// The extension box: a low wooden table against the wall with a fat white power
// strip, three sockets with a status light each, and a cable up to the pole.
function Station() {
  const table = useParts("station");
  const lamps = useRef<(THREE.Mesh | null)[]>([]);
  const halo = useRef<THREE.Mesh>(null);
  const pillar = useRef<THREE.Mesh>(null);
  const M = useMemo(
    () => ({
      post: new THREE.MeshStandardMaterial({ color: "#3b2f57", roughness: 0.8 }),
      board: new THREE.MeshStandardMaterial({ color: GA.ink, roughness: 0.7 }),
      sign: new THREE.MeshBasicMaterial({ map: makeSignTexture(), toneMapped: false, fog: false }),
      bulbs: new THREE.MeshBasicMaterial({ color: GA.gold, toneMapped: false }),
      paint: new THREE.MeshBasicMaterial({ map: makeSignTexture(), transparent: true, opacity: 0.92, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      pillar: new THREE.MeshBasicMaterial({ color: GA.gold, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false }),
      halo: new THREE.MeshBasicMaterial({ color: GA.gold, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }),
      lamps: SLOT_X.map(() => new THREE.MeshStandardMaterial({ color: "#222", emissive: "#000", emissiveIntensity: 1, roughness: 0.4 })),
    }),
    [],
  );
  const off = useMemo(() => new THREE.Color("#3a3848"), []);
  const amber = useMemo(() => new THREE.Color(GA.gold), []);
  const green = useMemo(() => new THREE.Color(GA.green), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const powered = worldControls.lit > 0.5;
    let wants = hands.idx >= 0;
    for (let s = 0; s < SOCKET_COUNT; s++) {
      const d = live.find((x) => x.where === "socket" && x.socket === s);
      const m = M.lamps[s];
      if (!d) {
        m.emissive.copy(off);
        m.emissiveIntensity = 0.3;
      } else if (d.ready) {
        wants = true;
        m.emissive.copy(green);
        m.emissiveIntensity = 2 + Math.sin(t * 8) * 0.8;
      } else {
        m.emissive.copy(amber);
        m.emissiveIntensity = powered ? 1 + Math.sin(t * 5 + s) * 0.5 : 0.15;
      }
    }
    // the board dims with the street: it is on NEPA's light like everything else
    M.sign.color.setScalar(0.35 + 0.65 * worldControls.lit);
    M.paint.color.setScalar(0.4 + 0.6 * worldControls.lit);
    M.bulbs.color.copy(amber).multiplyScalar(powered ? 0.75 + Math.sin(t * 6) * 0.25 : 0.12);
    if (pillar.current) { pillar.current.visible = wants; M.pillar.opacity = 0.16 + Math.sin(t * 3) * 0.07; }
    // the ground ring only shows when the box has business for you
    if (halo.current) {
      halo.current.visible = wants;
      M.halo.opacity = 0.3 + Math.sin(t * 4) * 0.2;
      halo.current.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
    }
  });

  return (
    <group position={[STATION[0] + 0.55, 0.16, STATION[1]]} userData={{ noBatch: true }}>
      <group scale={TABLE_SCALE}>
      {/* the table, the extension box, its cable: one mesh, from Blender */}
      {table.body && <mesh geometry={table.body.geometry} position={table.body.position} material={BODY_MAT} castShadow={SHADOWS} receiveShadow />}
      {/* a status light beside each socket */}
      {SLOT_X.map((z, s) => (
        <mesh key={s} ref={(el) => { lamps.current[s] = el; }} position={[0.3, 0.585, z + 0.2]} material={M.lamps[s]}>
          <sphereGeometry args={[0.05, 8, 6]} />
        </mesh>
      ))}
      </group>
      {/* The sign. Two posts and a lit board behind the table, facing the road,
          so the charging point is a landmark and not a small table to hunt for. */}
      {[-1.9, 1.9].map((z) => (
        <mesh key={z} position={[0.75, 1.55, z]} material={M.post}>
          <boxGeometry args={[0.09, 3.1, 0.09]} />
        </mesh>
      ))}
      <mesh position={[0.72, 2.75, 0]} material={M.board}>
        <boxGeometry args={[0.1, 1.15, 4.1]} />
      </mesh>
      <mesh position={[0.665, 2.75, 0]} rotation={[0, -Math.PI / 2, 0]} material={M.sign}>
        <planeGeometry args={[3.9, 0.98]} />
      </mesh>
      {/* bulbs along the bottom of the board: gold while the light is on */}
      <mesh position={[0.66, 2.12, 0]} material={M.bulbs}>
        <boxGeometry args={[0.06, 0.07, 3.9]} />
      </mesh>
      {/* The same words painted on the pavement in front of the table. The camera
          looks down from behind you, so the ground is the surface it reads best. */}
      <mesh position={[-1.75, 0.012, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} material={M.paint}>
        <planeGeometry args={[4.4, 1.1]} />
      </mesh>
      {/* and a column of light when the box has business for you */}
      <mesh ref={pillar} position={[-0.2, 3.2, 0]} material={M.pillar} renderOrder={3}>
        <cylinderGeometry args={[0.5, 1.3, 6.4, 18, 1, true]} />
      </mesh>
      {/* "come here" ring on the pavement in front of the box */}
      <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[-0.55, 0.02, 0]} material={M.halo}>
        <ringGeometry args={[1.5, 1.72, 40]} />
      </mesh>
    </group>
  );
}

export default function Devices() {
  // local development only: lets a test stage a carried or plugged-in device
  if (process.env.NODE_ENV === "development" && typeof window !== "undefined") (window as unknown as { __charge?: unknown }).__charge = { live, hands, worldControls, DEVICES, perks, rush };
  return (
    <>
      <Station />
      {DEVICES.map((def, i) => (
        <DeviceMesh key={def.id} def={def} idx={i} />
      ))}
    </>
  );
}

["phone", "lamp", "powerbank", "fan", "inverter", "fridge", "station"].forEach((id) => useGLTF.preload(MODEL(id)));
