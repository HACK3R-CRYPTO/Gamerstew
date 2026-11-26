"use client";

// How many ranked runs a player has left today, where they can see it before
// they play: a chip in the header and a line on each game's start screen.
// Tapping it opens the energy sheet, where a pack can be bought.
//
// It renders nothing for a guest, and nothing while energy is switched off on
// the server, so it can sit on every screen.

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getEnergy } from "@/app/actions/perks";
import { ENERGY_CHANGED, openEnergy, type EnergyState } from "@/lib/energy";

export function useEnergy(): EnergyState | null {
  const { address } = useAccount();
  const [state, setState] = useState<EnergyState | null>(null);
  const read = useCallback(async () => {
    if (!address) { setState(null); return; }
    const s = await getEnergy(address);
    setState(s.on ? (s as EnergyState) : null);
  }, [address]);
  useEffect(() => {
    void read();
    const again = () => { if (document.visibilityState === "visible") void read(); };
    window.addEventListener(ENERGY_CHANGED, again); document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener(ENERGY_CHANGED, again); document.removeEventListener("visibilitychange", again); };
  }, [read]);
  return state;
}

/** `chip`: the small count for the header. `line`: a sentence for a start screen. `dark` for a line over a game scene. */
export default function EnergyLine({ as = "line", dark = false }: { as?: "chip" | "line"; dark?: boolean }) {
  const e = useEnergy();
  if (!e) return null;
  const low = e.left <= 1;
  if (as === "chip") {
    return (
      <button type="button" onClick={() => openEnergy(e)} aria-label={`${e.left} ranked runs left today. Tap for more.`} title="Ranked runs left today"
        style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 999, border: "none", cursor: "pointer", background: low ? "#fee2e2" : "rgba(109,40,217,0.1)", color: low ? "#b91c1c" : "#4c1d95", font: '800 10.5px "Fredoka", system-ui, sans-serif', lineHeight: 1.3 }}>
        <span aria-hidden>⚡</span>{e.left}
      </button>
    );
  }
  const ink = dark ? "rgba(255,255,255,0.9)" : "rgba(34,16,79,0.74)"; const strong = dark ? "#fff" : "#22104f";
  return (
    <button type="button" onClick={() => openEnergy(e)}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "2px 8px", minHeight: 36, padding: "5px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${dark ? "rgba(255,255,255,0.24)" : low ? "#fecaca" : "rgba(76,29,149,0.16)"}`, background: dark ? "rgba(20,8,40,0.55)" : low ? "#fef2f2" : "#fff", color: ink, font: '600 13px "Fredoka", system-ui, sans-serif', lineHeight: 1.3 }}>
      <span><span aria-hidden>⚡ </span><b style={{ color: low && !dark ? "#b91c1c" : strong }}>{e.left}</b> ranked {e.left === 1 ? "run" : "runs"} left today</span>
      <span style={{ color: dark ? "#fde68a" : "#6d28d9", fontWeight: 700 }}>{e.left === 0 ? "Get more" : "Details"}</span>
    </button>
  );
}
