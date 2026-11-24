// ─── Street Strike: the lane simulation ──────────────────────────────────────
// One throw in, which bottles fall out. This is the ONLY place that decides a
// throw. The phone runs it to show the roll; the server runs the same file on
// the same inputs to work out the score. Neither trusts the other's answer.
//
// It is exact, not approximate: fixed steps of 1/60 s, bodies always created in
// the same order, no clock, no randomness. The physics engine is handed in so
// the browser and the server each use their own copy of the same build.
//
// games-backend/src/modules/strike/sim.ts is a copy of this file. A backend
// test fails if the two differ. Change this one, then copy it across.

export const SIM_VERSION = 1; // bump on any change that alters a result
export const PINS = 10;
export const STEP = 1 / 60;

export const LANE_W = 1.9;
export const LANE_LEN = 12.5;
export const GUTTER_W = 0.5;
export const GUTTER_DROP = 0.16;
export const SPACING = 0.4;
export const ROW = SPACING * Math.sin(Math.PI / 3);
export const START_Z = -0.6;
export const HOOK = 0.032;
export const SPEED_MIN = 5;
export const SPEED_MAX = 11;
export const DECK_END = -LANE_LEN - 3 * ROW - 0.9;

export const HOME: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let r = 0; r < 4; r++) for (let i = 0; i <= r; i++) out.push([(i - r / 2) * SPACING, -LANE_LEN - r * ROW]);
  return out;
})();

/** The physical side of a tyre. The picker's bars and paint are not part of the simulation. */
export const SIM_TYRES: Record<string, { r: number; mass: number; hook: number }> = {
  keke: { r: 0.23, mass: 4.4, hook: 1.45 },
  danfo: { r: 0.3, mass: 17, hook: 0.7 },
  okada: { r: 0.27, mass: 6.6, hook: 0.12 },
};

export interface SimThrow { x: number; angle: number; speed: number; spin: number }
export interface SimInput { tyre: string; throw: SimThrow; standing: boolean[] }
export interface SimResult {
  down: boolean[];      // per bottle: knocked over by this throw
  gutter: boolean;      // went in the gutter and hit nothing
  steps: number;        // how long the roll lasted, in 1/60 s steps
  /** when asked for: every step's position (x,y,z) and rotation (x,y,z,w) of the
   *  tyre, then each of the ten bottles, 77 numbers a step. Lets a screen replay
   *  the exact roll the result came from. */
  frames?: Float32Array;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Put a throw inside what the game allows. Both sides clamp the same way, so a
 *  doctored request cannot throw harder than a player can. */
export function cleanThrow(tyre: string, t: SimThrow): SimThrow {
  const ty = SIM_TYRES[tyre] ?? SIM_TYRES.keke;
  const lim = LANE_W / 2 - ty.r - 0.02;
  // rounded so the phone and the server feed the engine the very same numbers
  const r = (v: number, lo: number, hi: number) => Math.round(clamp(num(v), lo, hi) * 10000) / 10000;
  return { x: r(t.x, -lim, lim), angle: r(t.angle, -0.1, 0.1), speed: r(t.speed, SPEED_MIN, SPEED_MAX), spin: r(t.spin, -20, 20) };
}

// The slice of the physics engine this file uses. Typed loosely on purpose: the
// browser and the server import the engine under different module systems.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Engine = any;

export function simulate(R: Engine, input: SimInput, opts: { record?: boolean } = {}): SimResult {
  const ty = SIM_TYRES[input.tyre] ?? SIM_TYRES.keke;
  const th = cleanThrow(input.tyre, input.throw);
  const standing = Array.from({ length: PINS }, (_, i) => input.standing[i] === true);

  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  try {
    // the road, both gutters with their kerbs, and the back and front walls
    const half = LANE_W / 2, zc = -(LANE_LEN / 2) - 2, hl = (LANE_LEN + 14) / 2;
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
    const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction = 0.6, restitution = 0.05) =>
      world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(restitution), ground);
    fixed(half, 0.1, hl, 0, -0.1, zc);
    for (const s of [-1, 1]) {
      fixed(GUTTER_W / 2, 0.05, hl, s * (half + GUTTER_W / 2), -GUTTER_DROP - 0.05, zc, 0.9);
      fixed(0.17, 0.4, hl, s * (half + GUTTER_W + 0.17), 0.1, zc);
    }
    fixed(half + GUTTER_W + 2, 1.1, 0.15, 0, 0.9, DECK_END - 1.7, 0.6, 0.2);
    fixed(half + GUTTER_W + 2, 1.1, 0.15, 0, 0.9, 4.5);

    // bottles still standing, each back on its spot
    const bottles: (Engine | null)[] = [];
    for (let i = 0; i < PINS; i++) {
      if (!standing[i]) { bottles.push(null); continue; }
      const rb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(HOME[i][0], 0.002, HOME[i][1]).setLinearDamping(0.12).setAngularDamping(0.35).setCcdEnabled(true));
      world.createCollider(R.ColliderDesc.cylinder(0.105, 0.06).setTranslation(0, 0.105, 0).setMass(0.75).setFriction(0.55).setRestitution(0.25), rb);
      world.createCollider(R.ColliderDesc.cylinder(0.062, 0.026).setTranslation(0, 0.272, 0).setMass(0.12).setFriction(0.55).setRestitution(0.25), rb);
      bottles.push(rb);
    }

    // the tyre, already released
    const ball = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(th.x, ty.r + 0.01, START_Z).setLinearDamping(0.04).setAngularDamping(0.25).setCcdEnabled(true).setCanSleep(false)
        .setLinvel(Math.sin(th.angle) * th.speed, 0, -Math.cos(th.angle) * th.speed).setAngvel({ x: -th.speed / ty.r, y: 0, z: 0 }),
    );
    world.createCollider(R.ColliderDesc.ball(ty.r).setMass(ty.mass).setFriction(0.45).setRestitution(0.12), ball);

    const MAX = Math.ceil((9 + 4.2) / STEP) + 2;
    const frames = opts.record ? new Float32Array(MAX * 77) : undefined;
    const isDown = (i: number) => {
      const rb = bottles[i]; if (!rb) return false;
      const q = rb.rotation(), p = rb.translation();
      return 1 - 2 * (q.x * q.x + q.z * q.z) < 0.8 || p.y < -0.06 || Math.hypot(p.x - HOME[i][0], p.z - HOME[i][1]) > 0.55;
    };

    let rolling = true, t = 0, settle = 0, gutter = false, steps = 0;
    for (; steps < MAX; steps++) {
      const p = ball.translation(), v = ball.linvel();
      const onRoad = Math.abs(p.x) < LANE_W / 2 && p.y > ty.r * 0.6;
      if (!onRoad && p.z > -LANE_LEN + 0.6) gutter = true;
      // the hook: nothing early, building over the far half of the road
      if (rolling && onRoad && p.z < -LANE_LEN * 0.4 && p.z > -LANE_LEN - 0.4) {
        const zone = Math.min(1, (-p.z - LANE_LEN * 0.4) / (LANE_LEN * 0.45));
        ball.applyImpulse({ x: th.spin * HOOK * ty.hook * zone * ty.mass * STEP, y: 0, z: 0 }, true);
      }
      world.step();
      t += STEP;
      if (frames) {
        let o = steps * 77;
        const put = (rb: Engine | null) => {
          if (!rb) { frames[o + 1] = -50; frames[o + 6] = 1; o += 7; return; } // parked far below the road
          const a = rb.translation(), q = rb.rotation();
          frames[o] = a.x; frames[o + 1] = a.y; frames[o + 2] = a.z; frames[o + 3] = q.x; frames[o + 4] = q.y; frames[o + 5] = q.z; frames[o + 6] = q.w; o += 7;
        };
        put(ball); for (let i = 0; i < PINS; i++) put(bottles[i]);
      }
      const p2 = ball.translation(), v2 = ball.linvel();
      if (rolling) {
        if (p2.z < -LANE_LEN - 0.3 || (Math.hypot(v2.x, v2.z) < 0.35 && t > 1.2) || t > 9) rolling = false;
      } else {
        settle += STEP;
        let moving = false;
        for (let i = 0; i < PINS; i++) {
          const rb = bottles[i]; if (!rb) continue;
          const lv = rb.linvel(), av = rb.angvel();
          if (Math.hypot(lv.x, lv.y, lv.z) > 0.25 || Math.hypot(av.x, av.y, av.z) > 1.2) { moving = true; break; }
        }
        if ((settle > 1.4 && !moving) || settle > 4.2) { steps++; break; }
      }
      void v;
    }
    const down = standing.map((up, i) => up && isDown(i));
    return { down, gutter: gutter && !down.some(Boolean), steps, frames: frames ? frames.subarray(0, steps * 77) : undefined };
  } finally {
    world.free();
  }
}
