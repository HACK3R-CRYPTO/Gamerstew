"use client";

import { useEffect, useState } from "react";
import { CUP_STARTS_MS, CUP_ENDS_MS, cupPhase, fmtCupCountdown } from "@/lib/cup";

// Self-ticking Arena Cup countdown. Renders "STARTS IN 2d 04h 11m" before the
// event, "ENDS IN …" during, "LIVE NOW" / "ENDED" at the edges. Guards SSR
// hydration by rendering nothing until mounted (server has no stable clock).
export default function CupCountdown({
  labelStyle,
  timeStyle,
  gap = 6,
}: {
  labelStyle?: React.CSSProperties;
  timeStyle?: React.CSSProperties;
  gap?: number;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;

  const phase = cupPhase(now);
  const label = phase === "upcoming" ? "Starts in" : phase === "live" ? "Ends in" : "Cup ended";
  const target = phase === "upcoming" ? CUP_STARTS_MS : CUP_ENDS_MS;
  const time = phase === "ended" ? "" : fmtCupCountdown(target - now);

  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap }}>
      <span style={labelStyle}>{label}</span>
      {time && <span style={{ fontVariantNumeric: "tabular-nums", ...timeStyle }}>{time}</span>}
    </span>
  );
}
