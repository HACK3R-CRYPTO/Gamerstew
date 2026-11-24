"use client";

// ─── PowerPoints — the breaker boxes you switch on in Restore the Light ──────
// One per POWER_POINTS entry: a box on a short pole with an indicator + a lamp
// head, plus a ground ring and a floating beacon so you can spot the ones still
// OFF from across the dark street. OFF reads as a pulsing cyan target; the moment
// you flip it on it flares warm gold and the lamp lights, and its ring/beacon
// fade out. All animation reads the hot pointState[idx] in useFrame.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { POWER_POINTS, pointState, ACTIVATE_RADIUS, CRITICAL_TIME, timing, VIP_INDEX } from "./restore";

const OFF = new THREE.Color("#35e0ff"); // cyan "go here" target
const ON = new THREE.Color("#ffcf6a"); // warm restored glow
const WARN = new THREE.Color("#ffae3a"); // amber "this one is going"
const CRIT = new THREE.Color("#ff3b2f"); // red critical "save it NOW"
const SPARK = new THREE.Color("#a9d6ff"); // electric-blue shock spark

function PointMesh({ idx }: { idx: number }) {
  const indicatorMat = useRef<THREE.MeshStandardMaterial>(null);
  const lampMat = useRef<THREE.MeshStandardMaterial>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const beaconRef = useRef<THREE.Group>(null);
  const beaconMat = useRef<THREE.MeshBasicMaterial>(null);
  const burstRef = useRef<THREE.Mesh>(null);
  const burstMat = useRef<THREE.MeshBasicMaterial>(null);
  const sparkRef = useRef<THREE.Mesh>(null);
  const sparkMat = useRef<THREE.MeshBasicMaterial>(null);
  const leverRef = useRef<THREE.Group>(null);

  const tmp = useMemo(() => new THREE.Color(), []);

  const transTex = useTexture("/world/textures/transformer.jpg");
  const cabinetMats = useMemo(() => {
    transTex.colorSpace = THREE.SRGBColorSpace;
    transTex.anisotropy = 8;
    const skin = new THREE.MeshStandardMaterial({ map: transTex, roughness: 0.72, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: "#363c33", roughness: 0.8, metalness: 0.3 });
    // box faces: +x, -x, +y(top), -y(bottom), +z(front → street), -z(back)
    return [skin, skin, dark, dark, skin, dark];
  }, [transTex]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const st = pointState[idx];
    const t = performance.now() * 0.004;
    const pulse = 0.5 + 0.5 * Math.sin(t + idx);
    // Triage states: a lit breaker can be stable (gold), WARNING (amber, pulsing),
    // or CRITICAL (red, fast strobe) in its last second before it trips. A warning
    // breaker reads as a target again (beacon + ring return) so you can run to save it.
    const warning = st.on && st.warnT > 0;
    const critical = warning && st.warnT <= CRITICAL_TIME;
    const warnPulse = 0.5 + 0.5 * Math.sin(performance.now() * (critical ? 0.03 : 0.012) + idx);
    const baseCol = critical ? CRIT : warning ? WARN : st.on ? ON : OFF;
    const showTarget = !st.on || warning; // beacon + ring for unlit OR dying breakers

    // Indicator + lamp: cyan off, gold on, amber/red while a lit breaker is dying.
    tmp.copy(baseCol);
    if (indicatorMat.current) {
      indicatorMat.current.color.copy(tmp);
      indicatorMat.current.emissive.copy(tmp);
      const target = warning
        ? (critical ? 1.4 : 0.9) + warnPulse * 1.4
        : st.on ? 0.8 + st.flash * 3 : 0.5 + pulse * 0.6;
      indicatorMat.current.emissiveIntensity += (target - indicatorMat.current.emissiveIntensity) * Math.min(1, dt * 12);
    }
    if (lampMat.current) {
      lampMat.current.color.copy(baseCol);
      lampMat.current.emissive.copy(baseCol);
      const target = warning
        ? (critical ? 2.2 : 1.4) * (0.5 + warnPulse)
        : st.on ? 1.6 + st.flash * 2 : 0.08;
      lampMat.current.emissiveIntensity += (target - lampMat.current.emissiveIntensity) * Math.min(1, dt * 8);
    }
    // Flip burst: a bright sphere flares out and fades the instant it lights.
    if (burstRef.current && burstMat.current) {
      const f = st.flash;
      burstRef.current.visible = f > 0.01;
      const s = 0.4 + (1 - f) * 2.4;
      burstRef.current.scale.setScalar(s);
      burstMat.current.opacity = f * 0.6;
    }
    // Disconnect lever: thrown DOWN toward you when the breaker is on, resting
    // up when off — the thing your character reaches out and operates.
    if (leverRef.current) {
      const target = st.on ? 1.15 : -0.12;
      leverRef.current.rotation.x += (target - leverRef.current.rotation.x) * Math.min(1, dt * 9);
    }
    // Shock spark: a spiky blue flare when you mistime THIS breaker's switch.
    if (sparkRef.current && sparkMat.current) {
      const m = timing.activeIdx === idx ? timing.miss : 0;
      sparkRef.current.visible = m > 0.01;
      sparkRef.current.scale.setScalar(0.3 + m * 1.4);
      sparkRef.current.rotation.z += dt * 12;
      sparkMat.current.opacity = m * 0.85;
    }
    // Ground ring: a target ring for unlit OR dying breakers; fades out when stable.
    if (ringMat.current) {
      ringMat.current.color.copy(baseCol);
      const o = showTarget ? (warning ? 0.4 + warnPulse * 0.5 : 0.3 + pulse * 0.4) : 0.0;
      ringMat.current.opacity += (o - ringMat.current.opacity) * Math.min(1, dt * 8);
    }
    // Beacon: bobs + visible while a breaker is a target (unlit or dying); it spins
    // fast and red when the breaker is critical, so a dying one grabs your eye.
    if (beaconRef.current) {
      beaconRef.current.position.y = 2.2 + Math.sin(t + idx) * 0.15;
      beaconRef.current.rotation.y += dt * (critical ? 6 : 1.5);
      const s = showTarget ? 1 : 0;
      beaconRef.current.scale.x += (s - beaconRef.current.scale.x) * Math.min(1, dt * 10);
      beaconRef.current.scale.y = beaconRef.current.scale.z = beaconRef.current.scale.x;
      beaconRef.current.visible = beaconRef.current.scale.x > 0.03;
    }
    if (beaconMat.current) beaconMat.current.color.copy(baseCol);
  });

  const [x, z] = POWER_POINTS[idx];
  return (
    <group position={[x, 0, z]}>
      {/* ── NEPA distribution transformer (scaled up so it reads from afar) ── */}
      <group scale={1.3}>
      {/* concrete platform */}
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 0.2, 0.82]} />
        <meshStandardMaterial color="#8c867b" roughness={1} />
      </mesh>
      {/* cabinet (wears the real Lagos State Electricity Board transformer skin,
          front face toward the street) */}
      <mesh position={[0, 0.62, 0]} castShadow material={cabinetMats}>
        <boxGeometry args={[0.78, 0.72, 0.56]} />
      </mesh>
      {/* lid */}
      <mesh position={[0, 1.0, 0]}>
        <boxGeometry args={[0.82, 0.07, 0.6]} />
        <meshStandardMaterial color="#2f362b" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* three ceramic HV bushings on top */}
      {[-0.15, 0, 0.15].map((bx) => (
        <group key={bx} position={[bx, 1.03, 0.06]}>
          <mesh>
            <cylinderGeometry args={[0.035, 0.055, 0.16, 8]} />
            <meshStandardMaterial color="#d9d0c0" roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.1, 0]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#9c948a" roughness={0.5} metalness={0.4} />
          </mesh>
        </group>
      ))}
      {/* warning / status plate on the tank (glows red when off, gold when on) */}
      <mesh position={[0, 0.66, 0.305]}>
        <boxGeometry args={[0.16, 0.16, 0.02]} />
        <meshStandardMaterial ref={indicatorMat} emissive={OFF} emissiveIntensity={0.5} toneMapped={false} />
      </mesh>
      {/* indicator lamp on the lid (floods bright when restored) */}
      <mesh position={[0, 1.1, 0]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial ref={lampMat} emissive={OFF} emissiveIntensity={0.08} toneMapped={false} />
      </mesh>
      {/* flip burst — a bright flare that pops when the transformer lights */}
      <mesh ref={burstRef} position={[0, 1.0, 0]} visible={false}>
        <sphereGeometry args={[0.45, 14, 14]} />
        <meshBasicMaterial ref={burstMat} color={ON} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* disconnect lever on the front — reaches out and throws it on */}
      <group position={[0.18, 0.5, 0.32]}>
        {/* pivot housing */}
        <mesh>
          <boxGeometry args={[0.12, 0.12, 0.08]} />
          <meshStandardMaterial color="#2a2a2e" roughness={0.6} metalness={0.5} />
        </mesh>
        <group ref={leverRef}>
          {/* arm */}
          <mesh position={[0, 0.17, 0.02]}>
            <boxGeometry args={[0.035, 0.34, 0.035]} />
            <meshStandardMaterial color="#454549" roughness={0.5} metalness={0.6} />
          </mesh>
          {/* red handle knob */}
          <mesh position={[0, 0.35, 0.02]}>
            <sphereGeometry args={[0.06, 10, 10]} />
            <meshStandardMaterial color="#d23a2f" roughness={0.45} />
          </mesh>
        </group>
      </group>
      {/* shock spark — a spiky blue flare on a mistimed switch */}
      <mesh ref={sparkRef} position={[0, 0.75, 0.2]} visible={false}>
        <octahedronGeometry args={[0.4, 0]} />
        <meshBasicMaterial ref={sparkMat} color={SPARK} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      </group>

      {/* ground target ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[ACTIVATE_RADIUS - 0.18, ACTIVATE_RADIUS, 44]} />
        <meshBasicMaterial ref={ringMat} color={OFF} transparent opacity={0.4} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>

      {/* floating beacon (OFF only) */}
      <Billboard>
        <group ref={beaconRef} position={[0, 2.2, 0]}>
          <mesh>
            <octahedronGeometry args={[0.2, 0]} />
            <meshBasicMaterial ref={beaconMat} color={OFF} toneMapped={false} />
          </mesh>
        </group>
      </Billboard>

      {/* VIP hospital marker — a permanent red-cross sign floating above THE one
          breaker that must never trip, so you can pick it out of the street at a
          glance (losing it costs a life). Only on the VIP index. */}
      {idx === VIP_INDEX && (
        <Billboard position={[0, 3.0, 0]}>
          <mesh>
            <planeGeometry args={[0.6, 0.6]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <planeGeometry args={[0.36, 0.12]} />
            <meshBasicMaterial color="#e5342a" toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <planeGeometry args={[0.12, 0.36]} />
            <meshBasicMaterial color="#e5342a" toneMapped={false} depthWrite={false} />
          </mesh>
        </Billboard>
      )}
    </group>
  );
}

const METER_W = 1.6; // world width of the timing bar

// The "throw the switch" timing meter — a single meter that jumps to whichever
// breaker you are lined up on, with a sweeping needle and a green sweet-spot.
function TimingMeter() {
  const grp = useRef<THREE.Group>(null);
  const sweet = useRef<THREE.Mesh>(null);
  const needle = useRef<THREE.Mesh>(null);
  const needleMat = useRef<THREE.MeshBasicMaterial>(null);
  const bgMat = useRef<THREE.MeshBasicMaterial>(null);
  const green = useMemo(() => new THREE.Color("#4bed6a"), []);
  const red = useMemo(() => new THREE.Color("#ff5a5a"), []);
  const white = useMemo(() => new THREE.Color("#ffffff"), []);
  const gold = useMemo(() => new THREE.Color("#ffd27a"), []);

  useFrame(() => {
    const g = grp.current;
    if (!g) return;
    if (timing.activeIdx == null) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const [x, z] = POWER_POINTS[timing.activeIdx];
    g.position.set(x, 2.2, z);

    if (sweet.current) {
      sweet.current.scale.x = Math.max(0.001, 2 * timing.sweetW);
      sweet.current.position.x = (timing.sweetC - 0.5) * METER_W;
    }
    if (needle.current) needle.current.position.x = (timing.needle - 0.5) * METER_W;
    if (needleMat.current) {
      needleMat.current.color.copy(timing.lock > 0 ? red : white);
    }
    if (bgMat.current) {
      // flash gold on a hit, red on a miss
      const c = timing.result > 0 ? gold : timing.miss > 0 ? red : null;
      if (c) bgMat.current.color.lerp(c, 0.5);
      else bgMat.current.color.lerp(new THREE.Color("#0a0a12"), 0.2);
    }
  });

  return (
    <group ref={grp} visible={false}>
      <Billboard>
        {/* track */}
        <mesh>
          <planeGeometry args={[METER_W + 0.1, 0.24]} />
          <meshBasicMaterial ref={bgMat} color="#0a0a12" transparent opacity={0.85} toneMapped={false} depthWrite={false} />
        </mesh>
        {/* sweet spot (scaled on x each frame) */}
        <mesh ref={sweet} position={[0, 0, 0.01]}>
          <planeGeometry args={[METER_W, 0.18]} />
          <meshBasicMaterial color="#2a7d3a" transparent opacity={0.9} toneMapped={false} depthWrite={false} />
        </mesh>
        {/* needle */}
        <mesh ref={needle} position={[0, 0, 0.02]}>
          <planeGeometry args={[0.05, 0.3]} />
          <meshBasicMaterial ref={needleMat} color="#ffffff" toneMapped={false} depthWrite={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

export default function PowerPoints() {
  return (
    <>
      {POWER_POINTS.map((_, i) => (
        <PointMesh key={i} idx={i} />
      ))}
      <TimingMeter />
    </>
  );
}
