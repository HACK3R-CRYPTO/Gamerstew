// ─── Shared per-frame mutable world controls ────────────────────────────────
// A single module-level singleton holding data that changes EVERY frame (player
// input, the NEPA light level, the power phase). It is mutated imperatively and
// read inside useFrame loops so none of it triggers React re-renders — the
// standard react-three-fiber pattern for hot values. There is only ever one
// /world instance mounted, so a module singleton is safe and avoids context
// plumbing. React-reactive bits (HUD banner, perf flags) live in ./store.ts.

import * as THREE from "three";

export type NepaPhase = "on" | "warn" | "cut" | "relight";

export interface WorldControls {
  /** Raw analogue input in the camera plane, each component in [-1, 1].
   *  x = strafe (right +), z = forward (up on stick / W = -1). */
  input: { x: number; z: number };
  /** Current global light level 0 (full blackout) → 1 (full power). Ramped
   *  smoothly by the NepaDirector; read by every light/emissive each frame. */
  lit: number;
  /** Which stage of the NEPA cycle we are in. */
  phase: NepaPhase;
  /** Set true by the "N" key or the on-screen button to force the next
   *  transition; the NepaDirector consumes (clears) it. */
  pendingToggle: boolean;
  /** Warm RELIGHT overshoot, 0 → 1 → 0. Spikes to 1 the instant power floods
   *  back and decays over ~1s. Every light + emissive adds a touch of this so
   *  the whole street "surges" warm together when UP NEPA lands. */
  surge: number;
  /** The player's live world position, written each frame by Player.tsx and read
   *  by the gameplay (GameDirector) for device proximity. Not reactive. */
  playerPos: THREE.Vector3;
  /** Seconds of light left before the next blackout (NepaDirector writes it;
   *  the HUD shows it as the "race" countdown). 0 during a cut. */
  lightLeft: number;
  /** Which light window we are in this round (0-based). Rises each window; the
   *  gameplay uses it to escalate device values. Reset on round start. */
  windowIndex: number;
  /** A shared discrete "action" input (screen tap / FLIP button / Space press).
   *  Set by World, consumed (cleared) by whichever mode director is active.
   *  Restore uses it for the single-TAP breaker flip. */
  actionTap: boolean;
  /** Live HOLD state for Charge's press-and-hold "charge the device" verb: true
   *  while the PUMP button / Space / a still canvas press is held down. The Charge
   *  director fills the device while this is true and banks on RELEASE. Separate
   *  channel from the discrete actionTap so Restore (tap) and Charge (hold) feel
   *  genuinely different. Cleared when a drag turns the press into a camera orbit. */
  actionHeld: boolean;
  /** One-shot: set the single frame the hold is RELEASED cleanly (NOT when a drag
   *  cancels it into an orbit). The Charge director banks the current charge level
   *  on this edge, then clears it. */
  actionUp: boolean;
  /** Camera-shake amplitude (metres). Directors spike it on big hits / the
   *  blackout; Player.tsx jitters the camera by it each frame and decays it. */
  shake: number;
  /** when the player last turned the view by hand (ms), so the camera does not fight their thumb */
  lookedAt: number;
  /** Guidance: the active mode writes the world-space position of your NEXT
   *  target (nearest unlit breaker / chargeable device) here, and GuideArrow
   *  points at it. guide.active is false when there's nothing to point at. */
  guide: { x: number; z: number; active: boolean };
  /** Walking-speed multiplier (1 = normal). The Charge director lowers it while
   *  you carry something heavy; Player multiplies its move speed by it. */
  speedMul: number;
  /** Which way the player faces (radians about Y) and how fast they are moving
   *  (m/s). Player.tsx writes both; a carried device reads them to sit in the
   *  hands and bob with the stride. */
  playerYaw: number;
  playerSpeed: number;
  /** Set true by a director on a successful hit; Player plays the flip/plug
   *  gesture once, then consumes (clears) it. */
  gesture: boolean;
  /** Set true by a director on a MISTIMED tap; Player plays the electric-shock
   *  jolt (recoil + blue glow) once, then consumes (clears) it. */
  zap: boolean;
  /** World-space position of the thing being flipped/plugged, so the character
   *  can turn to face it while playing the gesture. Set alongside `gesture`. */
  gestureFace: { x: number; z: number };
  /** Seconds the player is stunned (hit by traffic): Player.tsx zeroes input
   *  while > 0 and decays it. A hit sets this + zap + shake. */
  stun: number;
  /** One-shot full-body reaction request, consumed (cleared) by Player.tsx:
   *  "hit" = knocked by a car (Hit By Car clip), "shock" = electrocuted on a
   *  mistimed flip (Being Electrocuted clip). "" = nothing pending. */
  react: "" | "hit" | "shock";
  /** Seconds of post-hit invincibility left. Traffic sets it when a car clips
   *  you (spanning the knock-down PLUS a recovery grace) and ignores collisions
   *  while it's > 0, so one car can't chain-hit you the instant you get up.
   *  Player.tsx flickers the body while it's > 0 so you can SEE you're safe. */
  invuln: number;
  /** Pending respawn: Traffic sets this to the nearest kerb when a car clips you,
   *  and Player applies it when the knock-down finishes — you get up back on the
   *  SIDEWALK, safely off the road, instead of lying in the lane to be hit again.
   *  null when there's nothing pending. */
  respawn: { x: number; z: number } | null;
  /** Driving: true while the player is piloting a vehicle. The DriveableVehicle
   *  owns the motion and writes playerPos so the camera follows the vehicle;
   *  Player hides + freezes while this is true. */
  driving: boolean;
  /** One-shot enter/exit-vehicle request (E key / on-screen button), consumed
   *  by the DriveableVehicle. */
  enterExit: boolean;
  /** One-shot: Traffic sets this when a car clips the player in CHARGE mode (restore
   *  handles its own hit via the restore store directly). GameDirector consumes it
   *  → a strike. Lets the same Traffic component be a hazard in both modes. */
  trafficHit: boolean;
  /** One-shot: Traffic sets this on a near-miss in CHARGE mode; GameDirector
   *  consumes it → a small dodge bonus. */
  trafficDodge: boolean;
  /** One-shot: Pickups.tsx sets this to the KIND of power-up the player just ran
   *  over ("overdrive"|"cash"|"life"|"stabilizer"|"jumpstart"); the active mode's
   *  director consumes (clears) it and applies the effect, where its score/lives/
   *  restored refs live. null when nothing was grabbed. */
  pickup: string | null;
}

export const worldControls: WorldControls = {
  input: { x: 0, z: 0 },
  lit: 1,
  phase: "on",
  pendingToggle: false,
  surge: 0,
  playerPos: new THREE.Vector3(0, 0, 0),
  lightLeft: 0,
  windowIndex: 0,
  actionTap: false,
  actionHeld: false,
  actionUp: false,
  shake: 0,
  lookedAt: 0,
  guide: { x: 0, z: 0, active: false },
  speedMul: 1,
  playerYaw: 0,
  playerSpeed: 0,
  gesture: false,
  zap: false,
  gestureFace: { x: 0, z: 0 },
  stun: 0,
  react: "",
  invuln: 0,
  respawn: null,
  driving: false,
  enterExit: false,
  trafficHit: false,
  trafficDodge: false,
  pickup: null,
};

/** Reset to the default POWER-ON state (called when the world mounts). */
export function resetWorldControls() {
  worldControls.input.x = 0;
  worldControls.input.z = 0;
  worldControls.lit = 1;
  worldControls.phase = "on";
  worldControls.pendingToggle = false;
  worldControls.surge = 0;
  worldControls.playerPos.set(0, 0, 0);
  worldControls.lightLeft = 0;
  worldControls.windowIndex = 0;
  worldControls.actionTap = false;
  worldControls.actionHeld = false;
  worldControls.actionUp = false;
  worldControls.shake = 0;
  worldControls.guide.active = false;
  worldControls.speedMul = 1;
  worldControls.gesture = false;
  worldControls.zap = false;
  worldControls.stun = 0;
  worldControls.react = "";
  worldControls.invuln = 0;
  worldControls.respawn = null;
  worldControls.driving = false;
  worldControls.enterExit = false;
  worldControls.trafficHit = false;
  worldControls.trafficDodge = false;
  worldControls.pickup = null;
}

// Dev-only: expose the hot controls so the headless harness can drive movement
// and read the player position for QA. Never referenced in production.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __wc?: WorldControls }).__wc = worldControls;
}
