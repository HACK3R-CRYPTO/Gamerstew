"use client";

// ─── Parked keke napep ───────────────────────────────────────────────────────
// Placement wrapper around KekeModel (LowPolyCar.tsx). Front faces +Z at
// rotation 0. Each parked keke is seeded from where it stands, so no two match.

import { KekeModel } from "./LowPolyCar";

export default function Keke({
  position = [0, 0, 0] as [number, number, number],
  rotation = 0,
}) {
  const seed = Math.round(Math.abs(position[0] * 11 + position[2] * 17));
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <KekeModel seed={seed} pax={0.5} />
    </group>
  );
}
