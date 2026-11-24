"use client";

// ─── FreeRoam — the physics layer for the open street ───────────────────────
// Wraps a Rapier <Physics> world around the free-roam character + a rideable
// keke, plus INVISIBLE colliders that mirror the visual street: the ground, the
// raised kerbs (you step up onto them), the building fronts on each side, the
// ends of the block, and the parked vehicles. The visual world (Street,
// buildings, vehicles) stays rendered in Scene.tsx as before; these colliders
// just give it physical substance so movement collides for real.
//
// Mounted only in free-roam ("menu"). The game modes keep the old Player for now.

import { Physics, RigidBody, CuboidCollider, CylinderCollider } from "@react-three/rapier";
import PhysicsPlayer from "./PhysicsPlayer";
import RideKeke from "./RideKeke";

// Parked-vehicle colliders (mirror Scene.tsx + Cars.tsx). The ridable keke owns
// its own body, so its spot (≈2.4, 9) is deliberately left out here.
const VEHICLES: { x: number; z: number; r: number; h: number }[] = [
  { x: 3.1, z: -6, r: 1.85, h: 1.3 }, // danfo
  { x: -2.6, z: 22, r: 1.85, h: 1.3 }, // danfo
  { x: -3.0, z: -18, r: 0.95, h: 1.1 }, // static keke
  { x: 3.7, z: 42, r: 1.35, h: 1.0 }, // cars
  { x: -3.7, z: -3, r: 1.35, h: 1.0 },
  { x: -3.7, z: 47, r: 1.35, h: 1.0 },
  { x: 3.7, z: -34, r: 1.35, h: 1.0 },
  { x: -3.7, z: -47, r: 1.35, h: 1.0 },
  // side street (SideStreet.tsx)
  { x: 18, z: 3.1, r: 1.85, h: 1.3 }, // parked danfo
  { x: 30, z: -3.0, r: 0.95, h: 1.1 }, // parked keke
  // Mile 2 motor park (far main-street end)
  { x: 3.2, z: -50, r: 1.85, h: 1.3 },
  { x: 3.2, z: -55.5, r: 1.85, h: 1.3 },
  { x: -3.2, z: -52, r: 1.85, h: 1.3 },
  { x: -3.2, z: -57.5, r: 1.85, h: 1.3 },
];

export default function FreeRoam({ debug = false }: { debug?: boolean }) {
  return (
    <Physics gravity={[0, -18, 0]} timeStep={1 / 60} debug={debug}>
      {/* Static world shell (main street + the side-street junction). */}
      <RigidBody type="fixed" colliders={false}>
        {/* Ground — main street + the side road along +X. */}
        <CuboidCollider args={[12, 0.1, 62]} position={[0, -0.1, 0]} />
        <CuboidCollider args={[26.75, 0.1, 8]} position={[31.25, -0.1, 0]} />
        {/* Loop legs: east road (x=45, along Z) + north connector (z=40, along X). */}
        <CuboidCollider args={[4.5, 0.1, 24.5]} position={[45, -0.1, 20]} />
        <CuboidCollider args={[27, 0.1, 4.5]} position={[22.5, -0.1, 40]} />
        {/* Raised kerbs on the main street. */}
        <CuboidCollider args={[1.75, 0.08, 60]} position={[6.25, 0.08, 0]} />
        <CuboidCollider args={[1.75, 0.08, 60]} position={[-6.25, 0.08, 0]} />
        {/* Building fronts — both split to leave the crossroads mouths open (z ±6).
            The right (+X) front also opens at z 35.5..44.5 for the north connector. */}
        <CuboidCollider args={[0.4, 3, 14.75]} position={[8.4, 3, 20.75]} />
        <CuboidCollider args={[0.4, 3, 8.25]} position={[8.4, 3, 52.75]} />
        <CuboidCollider args={[0.4, 3, 27.5]} position={[8.4, 3, -33.5]} />
        <CuboidCollider args={[0.4, 3, 27.5]} position={[-8.4, 3, 33.5]} />
        <CuboidCollider args={[0.4, 3, 27.5]} position={[-8.4, 3, -33.5]} />
        {/* Ajegunle side-street (+X) fronts — north front opens at x 40.5..49.5 for
            the east road; far end past the filling station stays walled. */}
        <CuboidCollider args={[18, 3, 0.4]} position={[22.5, 3, 8.5]} />
        <CuboidCollider args={[4.25, 3, 0.4]} position={[53.75, 3, 8.5]} />
        <CuboidCollider args={[26.75, 3, 0.4]} position={[31.25, 3, -8.5]} />
        <CuboidCollider args={[0.4, 3, 8.5]} position={[58, 3, 0]} />
        {/* Loop corridor walls — inner block faces + outer edges. */}
        <CuboidCollider args={[0.4, 3, 13.5]} position={[40.1, 3, 22]} />
        <CuboidCollider args={[16, 3, 0.4]} position={[24.45, 3, 35.1]} />
        <CuboidCollider args={[0.4, 3, 20]} position={[49.9, 3, 24.5]} />
        <CuboidCollider args={[27, 3, 0.4]} position={[22.7, 3, 44.9]} />
        {/* Oshodi side-street (-X) ground, fronts + far end. */}
        <CuboidCollider args={[18.5, 0.1, 8]} position={[-23, -0.1, 0]} />
        <CuboidCollider args={[18.5, 3, 0.4]} position={[-23, 3, 8.5]} />
        <CuboidCollider args={[18.5, 3, 0.4]} position={[-23, 3, -8.5]} />
        <CuboidCollider args={[0.4, 3, 8.5]} position={[-41.5, 3, 0]} />
        {/* Main-street block ends (leave the right side open where the side road is). */}
        <CuboidCollider args={[8.4, 3, 0.4]} position={[0, 3, 60.4]} />
        <CuboidCollider args={[8.4, 3, 0.4]} position={[0, 3, -60.4]} />
      </RigidBody>

      {/* Parked vehicles — upright cylinders you route around. */}
      {VEHICLES.map((v, i) => (
        <RigidBody key={i} type="fixed" colliders={false} position={[v.x, v.h, v.z]}>
          <CylinderCollider args={[v.h, v.r]} />
        </RigidBody>
      ))}

      <PhysicsPlayer />
      <RideKeke />
    </Physics>
  );
}
