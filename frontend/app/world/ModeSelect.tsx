"use client";

// ─── UP NEPA lobby ───────────────────────────────────────────────────────────
// The first thing you see on /world: the live street behind a light scrim, a
// big title, ONE hero mode tile with its own Play button, a row of secondary
// tiles, and a quiet "coming soon" line. Everything a new player needs is on
// one screen and each tile says what you do in it (recognition over recall).
// Nothing here blocks the view of the world: the panel docks to the bottom on
// phones and sits centred on wider screens.

import type { CSSProperties } from "react";
import { useAppStore } from "./appStore";
import { useGameStore } from "./game";
import { useRestoreStore } from "./restore";
import { GA } from "./theme";

const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';
const BODY = '"Fredoka", system-ui, sans-serif';

const SOON = ["🔦 Torch in the Dark", "⛽ Generator Hustle", "🔌 Power Thief"];

export default function ModeSelect({ onClose }: { onClose?: () => void }) {
  const setMode = useAppStore((s) => s.setMode);
  const chargeReset = useGameStore((s) => s.backToIdle);
  const restoreReset = useRestoreStore((s) => s.reset);

  const pick = (m: "restore" | "charge") => {
    if (m === "charge") chargeReset();
    else restoreReset();
    setMode(m);
  };

  return (
    <div style={wrap} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ textAlign: "center" }}>
          <div style={eyebrow}>GAME ARENA · LAGOS</div>
          <h1 style={title}>
            UP <span style={{ color: GA.goldLight }}>NEPA</span>
          </h1>
          <div style={tagline}>Bring the light back to the street</div>
        </div>

        {/* HERO: the simplest mode, with its own Play button */}
        <button style={hero} onClick={() => pick("restore")} aria-label="Play Restore the Light">
          <span style={heroIcon}>💡</span>
          <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
            <b style={{ fontFamily: DISPLAY, fontSize: 21, display: "block", lineHeight: 1.1 }}>Restore the Light</b>
            <span style={sub}>Flip every breaker before the clock runs out</span>
          </span>
          <span style={play}>Play</span>
        </button>

        <div style={row}>
          <button style={tile} onClick={() => pick("charge")} aria-label="Play Charge Rush">
            <span style={tileIcon}>⚡</span>
            <b style={tileTitle}>Charge Rush</b>
            <span style={tileSub}>Bank cash before the cut</span>
          </button>
          <button style={tile} onClick={onClose} aria-label="Explore the city">
            <span style={tileIcon}>🛺</span>
            <b style={tileTitle}>Explore</b>
            <span style={tileSub}>Walk or ride a keke</span>
          </button>
        </div>

        <div style={soon}>
          <span style={{ opacity: 0.7 }}>Coming soon</span>
          {SOON.map((s) => (
            <span key={s} style={chip}>{s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const wrap: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 30,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: "0 12px calc(env(safe-area-inset-bottom, 0px) + 14px)",
  // light scrim: darker at the bottom where the panel sits, street visible above
  background: "linear-gradient(180deg, rgba(10,1,32,0) 0%, rgba(10,1,32,0.12) 38%, rgba(10,1,32,0.72) 100%)",
  fontFamily: BODY,
};

const panel: CSSProperties = {
  width: "100%",
  maxWidth: 460,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "16px 14px 14px",
  borderRadius: 26,
  background: "linear-gradient(180deg, rgba(42,18,64,0.78), rgba(10,1,32,0.9))",
  border: "1px solid rgba(255,255,255,0.14)",
  backdropFilter: "blur(14px) saturate(1.3)",
  WebkitBackdropFilter: "blur(14px) saturate(1.3)",
  boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8), inset 0 1px rgba(255,255,255,0.12)",
  color: GA.ink,
};

const eyebrow: CSSProperties = { fontSize: 10.5, letterSpacing: "0.22em", fontWeight: 600, color: "rgba(244,241,234,0.62)" };
const title: CSSProperties = {
  margin: "2px 0 0",
  fontFamily: DISPLAY,
  fontSize: "clamp(34px, 10vw, 46px)",
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: "-0.01em",
  color: "#fff",
  textShadow: "0 2px 24px rgba(124,58,237,0.7)",
};
const tagline: CSSProperties = { marginTop: 4, fontSize: 13.5, fontWeight: 500, color: "rgba(244,241,234,0.72)" };

const hero: CSSProperties = {
  cursor: "pointer",
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "13px 12px 13px 14px",
  borderRadius: 20,
  color: "#fff",
  fontFamily: BODY,
  background: "linear-gradient(135deg, rgba(124,58,237,0.55), rgba(42,18,64,0.85))",
  border: `1.5px solid ${GA.goldLight}`,
  boxShadow: "0 0 28px -6px rgba(251,191,36,0.55), inset 0 1px rgba(255,255,255,0.18)",
};
const heroIcon: CSSProperties = { fontSize: 34, lineHeight: 1, filter: "drop-shadow(0 0 10px rgba(255,213,107,0.8))" };
const sub: CSSProperties = { display: "block", marginTop: 3, fontSize: 13, fontWeight: 500, color: "rgba(244,241,234,0.78)" };
const play: CSSProperties = {
  flex: "none",
  padding: "11px 20px",
  borderRadius: 14,
  fontFamily: DISPLAY,
  fontWeight: 700,
  fontSize: 17,
  color: "#06230f",
  background: `linear-gradient(180deg, #4ade80, ${GA.green})`,
  boxShadow: `0 4px 0 ${GA.greenDeep}, 0 10px 20px -6px rgba(34,197,94,0.6)`,
};

const row: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const tile: CSSProperties = {
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 3,
  padding: "12px 13px",
  borderRadius: 18,
  color: "#fff",
  fontFamily: BODY,
  textAlign: "left",
  background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03))",
  border: "1px solid rgba(255,255,255,0.14)",
};
const tileIcon: CSSProperties = { fontSize: 24, lineHeight: 1 };
const tileTitle: CSSProperties = { fontFamily: DISPLAY, fontSize: 16, marginTop: 4 };
const tileSub: CSSProperties = { fontSize: 12, fontWeight: 500, color: "rgba(244,241,234,0.66)" };

const soon: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 500,
  color: "rgba(244,241,234,0.7)",
};
const chip: CSSProperties = {
  padding: "3px 9px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.1)",
};
