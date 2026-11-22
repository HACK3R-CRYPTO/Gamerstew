"use client";

// ─── Moving traffic — the Lagos road as a hazard (Restore mode) ──────────────
// Danfos, kekes and taxis drive up and down the two road lanes. You zigzag
// across the road between breakers, so you have to DODGE them. Get clipped and a
// car knocks you down: Hit By Car reaction + camera shake + a stun AND a lost
// life, then ~4.2s of invincibility (you flicker) so no car can chain-hit you
// before you're back on your feet. Reuses the Meshy vehicle GLBs; collision is
// a tight box (narrow across the road, long front-to-back) so the kerb is safe.
//
// LAGOS "IRRATIONAL" DRIVING: speeds are NOT steady — each vehicle keeps
// re-rolling a new target speed (crawl → surge) every couple of seconds, and
// weaves side-to-side within its lane, so the road is unpredictable and you have
// to actually read the traffic to cross. A car-following gate still stops them
// phasing THROUGH each other (brake to keep a gap), but that's the only order.
// They wrap far off in the fog so the loop isn't visible.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import { worldControls } from "./controls";
import { useFx } from "./fx";
import { useShout, pick, LINES } from "./shout";
import { useRestoreStore } from "./restore";
import { useGameStore } from "./game";
import Occupant from "./Occupant";
import { DanfoBus, TaxiCar, KekeModel, OkadaBike } from "./LowPolyCar";
import { playHorn, driverShout } from "./audio";
import { stylizeOnce } from "./theme";


const WRAP = 58; // loop point just past the modelled street

// wx/wz = the vehicle's HALF width (across the road) and HALF length (front-to-
// back) for the hit box. A car is narrow but long, so a tight box across X keeps
// the kerb/breakers (x = ±4.3) safe — a circular radius wrongly reached them.
// Scales chosen so each vehicle is REAL-world size next to the ~1.77 m player:
// the taxi-meshy base mesh is already a 4.3 m / 1.9 m-tall saloon at scale 1.0
// (matches parked Cars.tsx), so it rides at 1.0 — NOT 2.3, which made it a ~10 m
// monster towering over the character. Danfo (1.9 m base → 5.3 m bus) and keke
// (1.9 m base → 2.6 m) are already real at their scales. wx/wz are WORLD-space
// half-extents for the hit box (independent of the visual scale).
//
// `face` rotates the model so its front points along +Z (travel). The keke and
// danfo meshes face -X (→ +π/2); the taxi mesh's length is already along Z and
// its front is +Z (→ 0, matching parked Cars.tsx) — rotating it π/2 like the
// others laid it SIDEWAYS across the lane, which is the bug this fixes.
//
// `seats` put PEOPLE in every moving vehicle — a driver up front plus passengers
// — so the road isn't ghost-driven. Positions are model-local (same frame as the
// mesh, before `face`/scale), reusing the seat tuning already proven on the parked
// Danfo/Cars. `occRot` turns the seated figure (which faces -Z) to look out the
// front; `occScale` is relative to the vehicle's own scale.
type Seat = readonly [number, number, number];
const CFG = {
  // danfo + taxi are self-contained models in metres (LowPolyCar.tsx): front +Z,
  // on the ground, dark glass, so they carry no separate occupants.
  danfo: { wx: 1.1, wz: 2.6 },
  taxi: { wx: 0.95, wz: 2.2 },
  keke: { wx: 0.72, wz: 1.35 },
  okada: { wx: 0.42, wz: 1.05 },
} as const;
const PLAYER_HALF = 0.4; // player body half-width for the hit box
type Kind = keyof typeof CFG;

// lane x (±1.6 = the two central driving lanes, clear of the parked vehicles on
// the outer road), direction, CRUISE speed (its max when the road ahead is
// clear), start z. THREE per lane, spaced well apart with similar speeds so they
// hold their spacing and flow instead of piling into a stationary clump.
const CARS: { type: Kind; x: number; dir: number; speed: number; z: number }[] = [
  // right lane → travelling +z (~38 apart)
  { type: "danfo", x: 1.6, dir: 1, speed: 5.2, z: -46 },
  { type: "keke", x: 1.6, dir: 1, speed: 4.8, z: -8 },
  { type: "taxi", x: 1.6, dir: 1, speed: 5.6, z: 30 },
  { type: "okada", x: 1.6, dir: 1, speed: 6.4, z: 11 },
  // left lane → travelling -z (~38 apart)
  { type: "taxi", x: -1.6, dir: -1, speed: 5.6, z: 46 },
  { type: "danfo", x: -1.6, dir: -1, speed: 5.0, z: 8 },
  { type: "keke", x: -1.6, dir: -1, speed: 4.8, z: -30 },
  { type: "okada", x: -1.6, dir: -1, speed: 6.4, z: -11 },
];

// Gaps are centre-to-centre; the vehicles are ~5-6 m long, so MIN_GAP keeps a
// real bumper gap instead of letting them overlap.
const CRUISE_GAP = 13; // start easing off the throttle within this gap (m)
const MIN_GAP = 7.5; // bumper-to-bumper floor — match the leader's speed here
// Irrational-speed band each car re-rolls between (m/s): some crawl, some fly.
const SPD_MIN = 2.6;
const SPD_MAX = 8.2;
const LANE_WEAVE = 0.5; // metres a car drifts either side of its lane centre (kept off the kerb)
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Near-miss dodging: slip just past a car's flank (outside its hit box) while
// it's beside you and moving fast → a DODGE. The lateral band outside the hit
// box that counts, the min car speed, and how much the traffic speeds up as the
// street lights back up (so late crossings are the tensest).
const NEAR_DX = 0.8;
const NEAR_SPD = 4.0;
const RAMP_MAX = 0.5; // +50% top speed by a full restore

function useVehicle(url: string, scale: number) {
  const { scene } = useGLTF(url);
  stylizeOnce(scene);
  return useMemo(() => {
    const s = scene.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    s.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s);
    return { model: s, yOff: -box.min.y * scale };
  }, [scene]);
}

export default function Traffic() {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const zs = useRef<number[]>(CARS.map((c) => c.z));
  const spd = useRef<number[]>(CARS.map((c) => c.speed)); // live speed (brakes/accelerates)
  const tgtSpd = useRef<number[]>(CARS.map((c) => c.speed)); // the speed it's currently chasing
  const spdTimer = useRef<number[]>(CARS.map(() => rand(0.5, 3))); // time to next speed re-roll
  const xCur = useRef<number[]>(CARS.map((c) => c.x)); // live lane offset (weaving)
  const xTgt = useRef<number[]>(CARS.map((c) => c.x));
  const xTimer = useRef<number[]>(CARS.map(() => rand(1, 4))); // time to next weave target
  const dodgeArmed = useRef<boolean[]>(CARS.map(() => true)); // one dodge per car-pass
  const honkT = useRef<number[]>(CARS.map(() => rand(1, 6))); // time to this car's next horn

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    worldControls.invuln = Math.max(0, worldControls.invuln - dt);
    const p = worldControls.playerPos;
    let hit = false;
    let nearMiss = false;

    // Traffic is a hazard in BOTH game modes. It tightens as the run progresses:
    // in Restore with the fraction lit, in Charge with the light-window index — so
    // the late crossings are the tensest either way.
    const rs0 = useRestoreStore.getState();
    const gs0 = useGameStore.getState();
    const restorePlaying = rs0.mode === "playing";
    const chargePlaying = gs0.mode === "playing";
    const playing = restorePlaying || chargePlaying;
    const frac = restorePlaying
      ? (rs0.total > 0 ? rs0.restored / rs0.total : 0)
      : chargePlaying ? Math.min(1, gs0.windowIndex / 5) : 0;
    const spdMul = 1 + frac * RAMP_MAX;

    for (let i = 0; i < CARS.length; i++) {
      const c = CARS[i];
      const zi = zs.current[i];

      // ── Irrational speed: re-roll a new target (crawl↔surge) now and then. ──
      spdTimer.current[i] -= dt;
      if (spdTimer.current[i] <= 0) {
        tgtSpd.current[i] = rand(SPD_MIN, SPD_MAX) * spdMul;
        spdTimer.current[i] = rand(1.2, 3.5);
      }
      // ── Weave: pick a new target offset within the lane now and then. ──────
      xTimer.current[i] -= dt;
      if (xTimer.current[i] <= 0) {
        xTgt.current[i] = c.x + rand(-LANE_WEAVE, LANE_WEAVE);
        xTimer.current[i] = rand(1.5, 4);
      }
      xCur.current[i] += (xTgt.current[i] - xCur.current[i]) * Math.min(1, dt * 1.6);

      // ── Car-following gate: brake for the nearest car AHEAD in the lane so
      //    they can't phase through each other. ───────────────────────────────
      let gap = Infinity;
      let leaderSpd = tgtSpd.current[i];
      for (let j = 0; j < CARS.length; j++) {
        if (j === i || CARS[j].x !== c.x || CARS[j].dir !== c.dir) continue;
        let ahead = (zs.current[j] - zi) * c.dir;
        if (ahead < 0) ahead += 2 * WRAP; // the car ahead may be past the wrap
        if (ahead < gap) {
          gap = ahead;
          leaderSpd = spd.current[j];
        }
      }
      let desired = tgtSpd.current[i];
      if (gap < CRUISE_GAP) {
        const t = THREE.MathUtils.clamp((gap - MIN_GAP) / (CRUISE_GAP - MIN_GAP), 0, 1);
        desired = Math.min(tgtSpd.current[i], leaderSpd + (tgtSpd.current[i] - leaderSpd) * t);
        if (gap < MIN_GAP) desired = Math.min(desired, leaderSpd * THREE.MathUtils.clamp(gap / MIN_GAP, 0, 1));
      }
      // Brake HARD, accelerate quick-ish (jerky Lagos driving).
      const rate = desired < spd.current[i] ? 7 : 3.2;
      spd.current[i] += (desired - spd.current[i]) * Math.min(1, dt * rate);

      let z = zi + c.dir * spd.current[i] * dt;
      if (c.dir > 0 && z > WRAP) z = -WRAP;
      else if (c.dir < 0 && z < -WRAP) z = WRAP;
      zs.current[i] = z;
      const g = refs.current[i];
      if (g) {
        g.position.z = z;
        g.position.x = xCur.current[i];
      }

      // Tight box hit test: you're only clipped when actually under the car, not
      // when it passes in the lane while you stand on the kerb.
      const dx = p.x - xCur.current[i];
      const dz = p.z - z;
      // ── Horn + mouth: a Lagos driver leans on the horn the moment you're in his
      //    lane ahead of him, and shouts. Otherwise the road honks at nothing in
      //    particular, quieter with distance and panned to where the car is. ────
      honkT.current[i] -= dt;
      if (honkT.current[i] <= 0) {
        const ahead = dz * c.dir; // +ve = the player is in front of this car
        const dist = Math.hypot(dx, dz);
        const vol = THREE.MathUtils.clamp(1 - dist / 42, 0, 1);
        const pan = THREE.MathUtils.clamp(-dx / 7, -1, 1);
        const inPath = playing && ahead > 1 && ahead < 16 && Math.abs(dx) < 1.9;
        if (inPath) {
          playHorn(c.type === "keke" || c.type === "okada" ? "keke" : ahead < 7 ? "long" : c.type, pan, 1);
          if (Math.random() < 0.55) {
            const line = driverShout(1);
            if (line) useShout.getState().shout(line, "bad");
          }
          honkT.current[i] = rand(0.9, 1.8);
        } else if (vol > 0.12 && Math.random() < 0.6) {
          const kind = c.type === "okada" ? "keke" : c.type === "danfo" && Math.random() < 0.35 ? "electric" : c.type;
          playHorn(kind, pan, vol * 0.45);
          honkT.current[i] = rand(5, 13);
        } else {
          honkT.current[i] = rand(2, 6);
        }
      }

      const hitX = CFG[c.type].wx + PLAYER_HALF;
      const hitZ = CFG[c.type].wz + PLAYER_HALF;
      const adx = Math.abs(dx);
      const adz = Math.abs(dz);
      if (adx < hitX && adz < hitZ) {
        hit = true;
      } else if (
        playing &&
        adx < hitX + NEAR_DX && // just outside the flank, not under it
        adz < hitZ && // the car is level with you (a real pass, not approaching)
        spd.current[i] > NEAR_SPD && // it's actually moving fast
        Math.abs(p.x) < 2.6 && // you're in the lanes, not watching from the kerb
        worldControls.invuln <= 0 && // not mid-knockdown i-frames
        dodgeArmed.current[i]
      ) {
        dodgeArmed.current[i] = false; // count this pass once
        nearMiss = true;
      }
      // Re-arm once this car is well clear, so the next pass can score again.
      if (adz > hitZ + 4) dodgeArmed.current[i] = true;
    }

    // A near-miss (and you weren't actually clipped this frame): bank a DODGE.
    // (No dodging/hits while you're IN the keke — you're protected in the vehicle.)
    if (nearMiss && !hit && playing && !worldControls.driving) {
      worldControls.shake = Math.max(worldControls.shake, 0.16);
      useFx.getState().flash(false);
      if (restorePlaying) {
        const rs = useRestoreStore.getState();
        rs.addDodge();
        const st = useRestoreStore.getState().dodgeStreak;
        if (st === 1 || st % 3 === 0) {
          useShout.getState().shout(st >= 3 ? `DODGE ×${st}! 😮‍💨` : "CLOSE! 😮‍💨", "good");
        }
      } else {
        // Charge: GameDirector reads this one-shot and pays a small dodge bonus.
        worldControls.trafficDodge = true;
        useShout.getState().shout("CLOSE! 😮‍💨", "good");
      }
    }

    if (hit && worldControls.invuln <= 0 && playing && !worldControls.driving) {
      // i-frames span the knock-down (2.38s) + a little, so no car can re-hit you
      // while you're down — then you RESPAWN on the nearest kerb, safely off the
      // road, so you never climb to your feet in the lane. Visuals are the same in
      // both modes; only the cost (a life vs a strike) differs.
      worldControls.invuln = 3.0;
      worldControls.respawn = { x: p.x >= 0 ? 4.0 : -4.0, z: p.z };
      worldControls.react = "hit"; // full Hit By Car knock-down reaction
      worldControls.shake = 0.6;
      worldControls.stun = 2.38; // knocked down + gets up — costs real time
      useFx.getState().shock();
      useShout.getState().shout(pick(LINES.traffic), "bad");
      if (restorePlaying) {
        useRestoreStore.getState().loseLife(); // a heart gone
      } else {
        worldControls.trafficHit = true; // Charge: GameDirector turns this into a strike
      }
    }
  });

  return (
    <>
      {CARS.map((c, i) => {
        const setRef = (el: THREE.Group | null) => {
          refs.current[i] = el;
        };
        const speed = () => spd.current[i];
        return (
          <group key={i} ref={setRef} position={[c.x, 0, c.z]} rotation={[0, c.dir > 0 ? 0 : Math.PI, 0]}>
            {c.type === "danfo" ? (
              <DanfoBus variant={i + 20} speed={speed} />
            ) : c.type === "taxi" ? (
              <TaxiCar speed={speed} seed={i} />
            ) : c.type === "keke" ? (
              <KekeModel seed={i + 60} speed={speed} />
            ) : (
              <OkadaBike seed={i} speed={speed} />
            )}
          </group>
        );
      })}
    </>
  );
}
