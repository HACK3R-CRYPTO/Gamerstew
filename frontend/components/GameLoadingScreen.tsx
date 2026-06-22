"use client";

import React from "react";

// Per-game loading overlay shown during the hub → lobby transition.
//
// Why this exists: tapping a game card used to either flash an empty
// "Loading…" card in the lobby (cold cache) or — on slower connections —
// render the lobby with empty leaderboard slots for ~400ms before data
// landed. Both read as "slow app." Modern mobile games (Candy Crush,
// Subway Surfers, every Supercell title) cover this gap with a branded
// loading moment that holds for a beat, then reveals the lobby fully
// hydrated. Same trick here: hold for `max(prefetch_done, 600ms)` while
// the caller pulls the leaderboard, then route. The lobby renders with
// real data on first paint.
//
// Theming is per-game: the caller passes the game's title, art, bg
// gradient, and glow color. That keeps each loader recognizable as the
// game the player just tapped into · the brand beat is real, not generic.

type GameLoadingScreenProps = {
  title: string;
  art: string | React.ReactNode;   // PNG path string OR inline JSX (stack)
  bg: string;                       // game's identity gradient
  glow: string;                     // accent color for the spinner + drop-shadow
};

export function GameLoadingScreen({ title, art, bg, glow }: GameLoadingScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Loading ${title}`}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: bg,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 28, padding: "40px 24px",
        animation: "gameLoad-fade 0.18s ease both",
      }}
    >
      <style>{`
        @keyframes gameLoad-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes gameLoad-float {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-8px) scale(1.02); }
        }
        @keyframes gameLoad-pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>

      {/* Decorative ambient halo behind the art · sits behind the float so
          the glow appears anchored while the art breathes above it. */}
      <div style={{
        position: "absolute",
        width: "min(420px, 80vw)",
        height: "min(420px, 80vw)",
        borderRadius: "50%",
        background: `radial-gradient(circle at 50% 50%, ${glow}3a 0%, transparent 65%)`,
        filter: "blur(20px)",
        pointerEvents: "none",
      }} />

      {/* Game art · PNG OR JSX. drop-shadow uses the game's glow color so
          rhythm's pink, simon's cyan, and stack's amber each get their own
          lit-from-behind effect — same identity each game owns on its card. */}
      <div style={{
        position: "relative",
        width: "clamp(160px, 42vw, 220px)",
        height: "clamp(160px, 42vw, 220px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        filter: `drop-shadow(0 14px 40px ${glow}aa) drop-shadow(0 0 60px ${glow}66)`,
        animation: "gameLoad-float 2.6s ease-in-out infinite",
      }}>
        {typeof art === "string" ? (
          <img
            src={art}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%" }}>{art}</div>
        )}
      </div>

      {/* Title · same Melon Pop display font the lobby uses, so the loader
          reads as a continuation of the game's identity, not a separate
          system screen. */}
      <div style={{
        fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif',
        fontSize: "clamp(26px, 7vw, 38px)",
        fontWeight: 900,
        color: "#fff",
        letterSpacing: "0.04em",
        textAlign: "center",
        lineHeight: 1.1,
        textShadow: `0 0 24px ${glow}aa, 0 4px 10px rgba(0,0,0,0.7)`,
      }}>
        {title}
      </div>

      {/* Three-dot pulse · staggered so it reads as motion, not a freeze.
          Color matches the game's glow so even the loader stays on brand. */}
      <div style={{ display: "flex", gap: 10, marginTop: 2 }} aria-hidden>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: 999,
            background: glow,
            boxShadow: `0 0 12px ${glow}, 0 0 24px ${glow}aa`,
            animation: `gameLoad-pulse 1.2s ease-in-out ${i * 0.18}s infinite`,
          }} />
        ))}
      </div>

      {/* Subtle eyebrow · sets expectation that something is happening
          without competing with the title for attention. */}
      <div style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
        fontSize: 11, color: "rgba(255,255,255,0.55)",
        fontWeight: 800, letterSpacing: "0.32em",
        textTransform: "uppercase",
      }}>
        Loading
      </div>
    </div>
  );
}
