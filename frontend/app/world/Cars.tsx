"use client";

// ─── Parked cars along the kerb ──────────────────────────────────────────────
// Yellow Lagos cabs plus a few private cars in the world palette, all from the
// low-poly kit (LowPolyCar.tsx). Front faces +Z at rotation 0.

import { KitCar, TaxiCar, type CarKind } from "./LowPolyCar";
import { GA } from "./theme";

const PLACED: [number, number, number, CarKind | "cab", string?][] = [
  [3.7, 42, 0, "cab"],
  [-3.7, -3, Math.PI, "sedan", GA.purple],
  [-3.7, 47, Math.PI, "cab"],
  [3.7, -34, 0, "suv", "#e11d48"],
  [-3.7, -47, Math.PI, "hatch", GA.green],
];

export default function Cars() {
  return (
    <>
      {PLACED.map(([x, z, rotY, kind, paint], i) => (
        <group key={i} position={[x, 0, z]} rotation={[0, rotY, 0]}>
          {kind === "cab" ? <TaxiCar seed={i + 3} /> : <KitCar kind={kind} paint={paint ?? GA.purple} />}
        </group>
      ))}
    </>
  );
}
