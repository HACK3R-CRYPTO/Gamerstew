"use client";

// ─── Devices — the chargeable appliances around the neighbourhood ────────────
// Recognisable low-poly props built from primitives (no fetched models, so they
// stay cheap and run anywhere): a phone with a glowing screen, a rechargeable
// lantern, a power bank with LED dots, a standing fan whose blades spin while
// charging, an inverter with a display, and a fridge with a door seam + handle.
//
// Each device shares ONE emissive "glow" material across its lit parts; the
// GameDirector-owned hot state (deviceState[idx]: progress / cooldown / flash)
// drives that glow, the spinning blades, a flat ground ring marking the charge
// radius, and a billboard progress bar. All in useFrame, no React re-renders.

import { useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { worldControls } from "./controls";
import { DEVICES, STATION, SOCKET_COUNT, live, hands, naira, type DeviceDef } from "./game";
import { GA, flat } from "./theme";

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

const DEVICE_SCALE = 1.7; // bump model size so they read clearly from the follow cam
// Height to float the progress bar above each device type (pre-scale).
const BAR_Y: Record<string, number> = {
  phone: 0.95,
  lamp: 0.95,
  powerbank: 0.95,
  fan: 1.35,
  inverter: 1.0,
  fridge: 1.75,
};

const DARK = "#23252e";
const METAL = "#6b7079";
const WHITE = "#e9ecf1";

// Build the recognisable body for one device type. `glowMat` is shared across
// the lit parts; `bladeRef` is only used by the fan.
function Body({
  id,
  glowMat,
  bladeRef,
}: {
  id: string;
  glowMat: THREE.MeshStandardMaterial;
  bladeRef: RefObject<THREE.Group | null>;
}) {
  if (id === "phone") {
    return (
      <group>
        <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.34, 0.28, 0.3]} />
          <meshStandardMaterial color={DARK} roughness={0.9} />
        </mesh>
        {/* phone, leaning on the stand */}
        <group position={[0, 0.5, 0.02]} rotation={[-0.25, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.3, 0.56, 0.05]} />
            <meshStandardMaterial color="#111318" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.031]}>
            <planeGeometry args={[0.24, 0.48]} />
            <primitive object={glowMat} attach="material" />
          </mesh>
        </group>
      </group>
    );
  }

  if (id === "lamp") {
    return (
      <group>
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.17, 0.19, 0.1, 16]} />
          <meshStandardMaterial color={DARK} roughness={0.8} />
        </mesh>
        {/* glowing lantern body */}
        <mesh position={[0, 0.33, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.32, 16]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
        <mesh position={[0, 0.52, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.16, 0.08, 16]} />
          <meshStandardMaterial color={DARK} roughness={0.8} />
        </mesh>
        {/* handle */}
        <mesh position={[0, 0.63, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.08, 0.012, 8, 16, Math.PI]} />
          <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
    );
  }

  if (id === "powerbank") {
    return (
      <group>
        <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.24, 0.26]} />
          <meshStandardMaterial color={DARK} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.46, 0.02]} castShadow>
          <boxGeometry args={[0.3, 0.5, 0.12]} />
          <meshStandardMaterial color="#2b2f3a" roughness={0.55} metalness={0.2} />
        </mesh>
        {/* 4 LED dots */}
        {[-0.09, -0.03, 0.03, 0.09].map((x, i) => (
          <mesh key={i} position={[x, 0.62, 0.085]}>
            <boxGeometry args={[0.035, 0.035, 0.01]} />
            <primitive object={glowMat} attach="material" />
          </mesh>
        ))}
      </group>
    );
  }

  if (id === "fan") {
    return (
      <group>
        <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.24, 0.26, 0.06, 20]} />
          <meshStandardMaterial color={DARK} roughness={0.8} />
        </mesh>
        {/* power LED on the base */}
        <mesh position={[0, 0.07, 0.2]}>
          <boxGeometry args={[0.04, 0.02, 0.01]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.035, 0.9, 10]} />
          <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.5} />
        </mesh>
        {/* head at ~1.0m */}
        <group position={[0, 1.0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.07, 0.07, 0.12, 12]} />
            <meshStandardMaterial color={DARK} roughness={0.7} />
          </mesh>
          {/* spinning blades face +Z */}
          <group ref={bladeRef} position={[0, 0, 0.09]}>
            {[0, 1, 2, 3].map((i) => (
              <mesh key={i} rotation={[0, 0, (i * Math.PI) / 2]} position={[0, 0, 0]}>
                <boxGeometry args={[0.07, 0.24, 0.008]} />
                <meshStandardMaterial color="#c7d2e0" roughness={0.4} metalness={0.1} />
              </mesh>
            ))}
            <mesh>
              <cylinderGeometry args={[0.04, 0.04, 0.03, 10]} />
              <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.4} />
            </mesh>
          </group>
          {/* cage ring */}
          <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.28, 0.012, 8, 28]} />
            <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      </group>
    );
  }

  if (id === "inverter") {
    return (
      <group>
        <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.52, 0.42, 0.36]} />
          <meshStandardMaterial color="#3a3f4a" roughness={0.7} metalness={0.2} />
        </mesh>
        {/* vents */}
        {[-0.08, 0, 0.08].map((y, i) => (
          <mesh key={i} position={[0.17, 0.24 + y, 0.181]}>
            <boxGeometry args={[0.14, 0.02, 0.01]} />
            <meshStandardMaterial color="#1b1e25" roughness={0.9} />
          </mesh>
        ))}
        {/* display panel (glows) */}
        <mesh position={[-0.12, 0.3, 0.181]}>
          <boxGeometry args={[0.18, 0.1, 0.01]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
        {/* knob */}
        <mesh position={[-0.12, 0.13, 0.181]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.03, 12]} />
          <meshStandardMaterial color={DARK} roughness={0.6} />
        </mesh>
      </group>
    );
  }

  // fridge
  return (
    <group>
      <mesh position={[0, 0.68, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.66, 1.35, 0.6]} />
        <meshStandardMaterial color={WHITE} roughness={0.5} metalness={0.1} />
      </mesh>
      {/* door seam */}
      <mesh position={[0, 0.92, 0.301]}>
        <boxGeometry args={[0.66, 0.015, 0.01]} />
        <meshStandardMaterial color="#b9bdc6" roughness={0.6} />
      </mesh>
      {/* handle */}
      <mesh position={[0.26, 1.08, 0.31]} castShadow>
        <boxGeometry args={[0.03, 0.34, 0.05]} />
        <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.4} />
      </mesh>
      {/* status LED */}
      <mesh position={[-0.2, 1.22, 0.301]}>
        <boxGeometry args={[0.05, 0.03, 0.01]} />
        <primitive object={glowMat} attach="material" />
      </mesh>
    </group>
  );
}

// Where each socket's device sits on the box (box-local metres, +Z toward the road).
const SLOT_X = [-0.95, 0, 0.95];
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
    let s = DEVICE_SCALE;
    if (d.where === "carried") {
      // held up over your head, a little smaller so you can still see the road
      const p = worldControls.playerPos;
      g.position.set(p.x, 1.95 + Math.sin(t * 9) * 0.03, p.z);
      s = DEVICE_SCALE * (def.id === "fridge" || def.id === "inverter" ? 0.62 : 0.78);
    } else if (d.where === "socket") {
      g.position.set(STATION[0] + 0.55, 0.62, STATION[1] + SLOT_X[d.socket]);
      s = DEVICE_SCALE * 0.72;
    } else {
      g.position.set(def.pos[0], 0.16, def.pos[1]);
    }
    const pop = 1 + d.pulse * 0.18;
    g.scale.setScalar(s * pop);

    const charging = d.where === "socket" && !d.ready && worldControls.lit > 0.5;
    glowMat.emissiveIntensity = d.ready ? 1.4 + Math.sin(t * 8) * 0.5 : charging ? 0.5 + d.progress * 1.1 : 0.25 * worldControls.lit;
    if (bladeRef.current && charging) bladeRef.current.rotation.z += dt * (4 + d.progress * 18);

    // value tag: only while it is waiting at its spot
    if (label.current) {
      label.current.visible = d.where === "home";
      label.current.quaternion.copy(camera.quaternion);
    }
    if (ring.current) {
      ring.current.visible = d.where === "home";
      ringMat.opacity = 0.35 + Math.sin(t * 3 + idx) * 0.2;
    }
    // charge bar: only in a socket
    if (bar.current && fill.current) {
      bar.current.visible = d.where === "socket";
      bar.current.quaternion.copy(camera.quaternion);
      const f = Math.max(0.02, d.progress);
      fill.current.scale.x = f;
      fill.current.position.x = -(BAR_W * (1 - f)) / 2;
      fillMat.color.copy(d.ready ? green : gold);
      if (d.ready) bar.current.position.y = top + 0.5 + Math.sin(t * 7) * 0.06;
    }
  });

  return (
    <group ref={root} userData={{ noBatch: true }}>
      <Body id={def.id} glowMat={glowMat} bladeRef={bladeRef} />
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
  );
}

// The extension box: a low wooden table against the wall with a fat white power
// strip, three sockets with a status light each, and a cable up to the pole.
function Station() {
  const lamps = useRef<(THREE.Mesh | null)[]>([]);
  const halo = useRef<THREE.Mesh>(null);
  const M = useMemo(
    () => ({
      wood: flat("#8a5a2e", { roughness: 0.95 }),
      leg: flat("#5a3a1e", { roughness: 1 }),
      strip: flat(GA.ink, { roughness: 0.6 }),
      hole: flat("#15131b", { roughness: 0.8 }),
      cable: flat("#15131b", { roughness: 0.9 }),
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
    // the ground ring only shows when the box has business for you
    if (halo.current) {
      halo.current.visible = wants;
      M.halo.opacity = 0.3 + Math.sin(t * 4) * 0.2;
      halo.current.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
    }
  });

  return (
    <group position={[STATION[0] + 0.55, 0.16, STATION[1]]} userData={{ noBatch: true }}>
      {/* table */}
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow material={M.wood}>
        <boxGeometry args={[0.9, 0.08, 3.1]} />
      </mesh>
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => (
        <mesh key={`${a}${b}`} position={[a * 0.36, 0.2, b * 1.4]} material={M.leg}>
          <boxGeometry args={[0.08, 0.4, 0.08]} />
        </mesh>
      )))}
      {/* power strip along the back edge + three sockets */}
      <mesh position={[0.3, 0.5, 0]} material={M.strip} castShadow>
        <boxGeometry args={[0.2, 0.09, 2.9]} />
      </mesh>
      {SLOT_X.map((z, s) => (
        <group key={s} position={[0.3, 0.55, z]}>
          <mesh material={M.hole}>
            <boxGeometry args={[0.12, 0.012, 0.2]} />
          </mesh>
          <mesh ref={(el) => { lamps.current[s] = el; }} position={[0, 0.03, 0.26]} material={M.lamps[s]}>
            <sphereGeometry args={[0.055, 8, 6]} />
          </mesh>
        </group>
      ))}
      {/* cable up the wall */}
      <mesh position={[0.42, 1.6, -1.5]} material={M.cable}>
        <boxGeometry args={[0.035, 2.3, 0.035]} />
      </mesh>
      {/* "come here" ring on the pavement in front of the box */}
      <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[-0.55, 0.02, 0]} material={M.halo}>
        <ringGeometry args={[1.5, 1.72, 40]} />
      </mesh>
    </group>
  );
}

export default function Devices() {
  return (
    <>
      <Station />
      {DEVICES.map((def, i) => (
        <DeviceMesh key={def.id} def={def} idx={i} />
      ))}
    </>
  );
}
