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
  /** shown under the loading dots: a hint for this game */
  tip?: React.ReactNode;
  art: string | React.ReactNode;   // PNG path string OR inline JSX (stack)
  bg: string;                       // game's identity gradient
  glow: string;                     // accent color for the spinner + drop-shadow
};

export function GameLoadingScreen({ title, art, tip }: GameLoadingScreenProps) {
  // `bg` and `glow` are still accepted, and ignored: every loader now wears the
  // app's one look instead of a different dark gradient per game.
  return (
    <div className="gload" role="status" aria-live="polite" aria-label={`Loading ${title}`}>
      <div className="gload-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {typeof art === "string" ? <img src={art} alt="" /> : <div style={{ width: "100%", height: "100%" }}>{art}</div>}
      </div>
      <div className="gload-title">{title}</div>
      <div className="gload-dots" aria-hidden><i /><i /><i /></div>
      <div className="gload-word">Loading</div>
      {/* something worth knowing while they wait, when the game has it */}
      {tip ? <div style={{ marginTop: 10 }}>{tip}</div> : null}
      <style>{`
        .gload { position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 40px 24px; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #f0e8ff 45%, #e2d6ff 100%); color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; animation: gloadIn .18s ease both; }
        @keyframes gloadIn { from { opacity: 0; } }
        .gload-art { width: clamp(150px, 40vw, 210px); aspect-ratio: 1; padding: 14px; border-radius: 34px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.14), 0 30px 44px -28px rgba(76,29,149,0.8); transform: rotate(-3deg); animation: gloadFloat 2.6s ease-in-out infinite; }
        .gload-art img { width: 100%; height: 100%; object-fit: cover; border-radius: 22px; }
        @keyframes gloadFloat { 50% { transform: rotate(-3deg) translateY(-8px); } }
        .gload-title { font-family: "Melon Pop", "Fredoka", system-ui, sans-serif; font-size: clamp(26px, 7vw, 38px); line-height: 1.1; text-align: center; }
        .gload-dots { display: flex; gap: 9px; }
        .gload-dots i { width: 10px; height: 10px; border-radius: 999px; background: #6d28d9; animation: gloadPulse 1.2s ease-in-out infinite; }
        .gload-dots i:nth-child(2) { animation-delay: .18s; } .gload-dots i:nth-child(3) { animation-delay: .36s; }
        @keyframes gloadPulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); } 40% { opacity: 1; transform: scale(1.15); } }
        .gload-word { font-size: 13px; font-weight: 700; color: rgba(34,16,79,0.66); }
        @media (prefers-reduced-motion: reduce) { .gload-art, .gload-dots i { animation: none; } }
      `}</style>
    </div>
  );
}
