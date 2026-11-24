"use client";

// ─── Parked danfo ────────────────────────────────────────────────────────────
// Thin placement wrapper around the DanfoBus model (see LowPolyCar.tsx).
// Front faces +Z at rotation 0.

import { DanfoBus } from "./LowPolyCar";

export default function Danfo({
  position = [3, 0, -6] as [number, number, number],
  rotation = 0,
  variant = 0,
}: {
  position?: [number, number, number];
  rotation?: number;
  variant?: number;
}) {
  // Every parked bus is its own bus: fold where it stands into its seed.
  const seed = variant + Math.round(Math.abs(position[0] * 7 + position[2] * 13));
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <DanfoBus variant={seed} full={0.55} />
    </group>
  );
}
