"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { playClick } from "@/hooks/useAppAudio";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { fetchPreview } from "@/lib/leaderboardPreview";
import type { GameTypeId } from "@/lib/subgraph";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";

// ─── tokens (in sync with /dashboard + /home) ────────────────────────────
const T = {
  bg: "linear-gradient(180deg, #f3eeff 0%, #e6dcff 100%)",
  ink: "#22104f",
  inkDim: "rgba(34,16,79,0.68)",
  inkSoft: "rgba(34,16,79,0.5)",
  hairline: "rgba(76,29,149,0.14)",
  accent: "#6d28d9",
  gap: 12,
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// ─── 3D games · full worlds you move around in ─────────────────────────────
// Kept as their own shelf so the hub reads as two kinds of game: the 3D worlds
// (heavier, landscape or portrait, physics) and the quick classic 2D games.
// Each card shows the REAL game: a cover captured from live play, with its title
// over it and a Play button in a glass bar (so you see what you are about to
// play before you tap, instead of an icon on a colour).
const GAMES_3D = [
  {
    id: "upnepa3d",
    title: "UP NEPA 3D",
    meta: "LAGOS · OPEN STREET · 2 MODES",
    blurb: "NEPA don take light. Run the street, flip the breakers, dodge the danfo and bring the whole area back.",
    cover: "/games/covers/upnepa3d.jpg",
    focus: "58% 40%",
    accent: "#b45309",
    badge: "FEATURED",
    href: "/world",
  },
  {
    id: "streetstrike",
    title: "Street Strike",
    meta: "BOWLING · PHYSICS · 5 FRAMES",
    blurb: "Roll the tyre down the road and scatter the bottles. Curve your swipe to hook. No enter gutter o!",
    cover: "/games/covers/streetstrike.jpg",
    focus: "50% 30%",
    accent: "#a855f7",
    badge: "NEW",
    href: "/bowling",
  },
];

// ─── games (real project assets · ordered by gameplay weight) ────────────
const GAMES = [
  {
    id: "rhythm",
    cover: "/games/covers/rhythm.jpg",
    focus: "50% 40%",
    title: "Rhythm Rush",
    subtitle: "Tap to the beat · combo to climb",
    art: "/games/rhythm.png",
    bg: "linear-gradient(155deg, #c026d3 0%, #7c1d9e 55%, #4c1d95 100%)",
    glow: "#c026d3",
    active: true,
    href: "/games/rhythm",
  },
  {
    id: "simon",
    cover: "/games/covers/simon.jpg",
    focus: "50% 45%",
    title: "Simon Memory",
    subtitle: "Sequence memory · go deeper",
    art: "/games/simon.png",
    bg: "linear-gradient(155deg, #0e7490 0%, #075985 55%, #1e1b4b 100%)",
    glow: "#06b6d4",
    active: true,
    href: "/games/simon",
  },
  // Slime Survivor — temporarily hidden from the hub. The route and game
  // code at /games/survivor still work for anyone with the direct link;
  // this just removes the card from the games lobby. Un-comment to bring
  // it back when ready.
  // {
  //   id: "survivor",
  //   title: "SLIME SURVIVOR",
  //   wager: "FREE",
  //   payout: "—",
  //   path: "/games/survivor",
  //   active: true,
  //   artGrad: "linear-gradient(160deg, #14532d 0%, #166534 55%, #052e16 100%)",
  //   glow: "#15803d",
  //   accent: "#15803d",
  //   showWager: false,
  //   borderColor: "#15803d",
  //   startWall: "#14532d",
  //   startGrad: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
  //   startGlow: "rgba(34,197,94,0.75)",
  //   art: (
  //     // Your pet IS the runner — the card art sells the hook directly.
  //     // eslint-disable-next-line @next/next/no-img-element
  //     <img src="/pets/stage-3-teen.png" alt="Slime Survivor" width={1024} height={1024} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.7))" }} />
  //   ),
  // },
  {
    // Stack Tower's old palette (teal → navy) was nearly identical to
    // Simon's, so two cards in the row read as one block on mobile. New
    // warm amber palette claims the fourth color quadrant in the row
    // (alongside Rhythm magenta, Simon teal, Challenge AI green) and
    // reads as "wood blocks under stadium lights" — fits the gameplay
    // identity. Schema also normalized from artGrad/path to bg/href so
    // the card actually paints (the render reads game.bg, game.href).
    id: "stack",
    cover: "/games/covers/stack.jpg",
    focus: "50% 60%",
    title: "Stack Tower",
    subtitle: "Stack & survive · don't drop",
    art: (
      // Inline SVG stacked-blocks illustration — no PNG asset needed.
      // Rainbow hue spectrum (cyan → pink) kept on purpose against the
      // warm amber bg: the cool blocks pop hard off the orange backdrop,
      // which makes the tower the visual hero of the card.
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.7))" }}>
        {[
          { y: 76, x: 22, w: 56, hue: 195 },
          { y: 60, x: 26, w: 50, hue: 215 },
          { y: 44, x: 30, w: 42, hue: 245 },
          { y: 28, x: 32, w: 38, hue: 275 },
          { y: 12, x: 36, w: 30, hue: 300 },
        ].map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={b.y + 2} width={b.w} height={12} rx={2} fill={`hsl(${b.hue} 78% 32%)`} />
            <rect x={b.x} y={b.y} width={b.w} height={10} rx={2} fill={`hsl(${b.hue} 78% 56%)`} />
            <rect x={b.x} y={b.y} width={b.w} height={2.5} fill="rgba(255,255,255,0.4)" rx={1} />
          </g>
        ))}
      </svg>
    ),
    bg: "linear-gradient(155deg, #f97316 0%, #c2410c 55%, #7c2d12 100%)",
    glow: "#c2410c",
    active: true,
    href: "/games/stack",
  },
  {
    id: "challenge-ai",
    cover: "/games/covers/challenge-ai.jpg",
    focus: "50% 55%",
    title: "Challenge AI",
    subtitle: "Outsmart MARKOV · or send your own AI",
    art: "/games/challenge-ais.png",
    bg: "linear-gradient(155deg, #14532d 0%, #064e3b 55%, #022c22 100%)",
    glow: "#15803d",
    active: true,
    href: "/games/challenge-ai",
  },
  {
    // NEPA: Up Light — charge devices before NEPA takes the light. Inline-SVG
    // card art (no PNG asset needed): a glossy socket strip with a lit bulb,
    // neon purple/gold to match the lobby.
    id: "nepa",
    cover: "/games/covers/nepa.jpg",
    focus: "60% 30%",
    title: "NEPA: Up Light",
    subtitle: "Charge fast · beat the blackout",
    art: (
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.7))" }}>
        {/* glow halo */}
        <circle cx="50" cy="34" r="26" fill="rgba(251,191,36,0.22)" />
        {/* bulb */}
        <circle cx="50" cy="34" r="15" fill="url(#nepaBulb)" stroke="#b45309" strokeWidth="1.5" />
        <rect x="44" y="47" width="12" height="7" rx="1.5" fill="#a16207" />
        <rect x="45" y="54" width="10" height="4" rx="1.5" fill="#713f12" />
        {/* socket strip */}
        <rect x="18" y="70" width="64" height="20" rx="5" fill="#2a1d55" stroke="#a855f7" strokeWidth="1.5" />
        {[28, 50, 72].map((cx, i) => (
          <g key={i}>
            <circle cx={cx} cy="80" r="6" fill="#140a2e" stroke="#7e22ce" strokeWidth="1" />
            <rect x={cx - 2.6} y="77.5" width="1.6" height="3" rx="0.6" fill="#7e22ce" />
            <rect x={cx + 1} y="77.5" width="1.6" height="3" rx="0.6" fill="#7e22ce" />
          </g>
        ))}
        <defs>
          <radialGradient id="nepaBulb" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#fffbeb" />
            <stop offset="55%" stopColor="#b45309" />
            <stop offset="100%" stopColor="#d97706" />
          </radialGradient>
        </defs>
      </svg>
    ),
    bg: "linear-gradient(155deg, #7c3aed 0%, #5b21b6 55%, #2e1065 100%)",
    glow: "#b45309",
    active: true,
    isNew: true,
    href: "/games/nepa",
  },
  {
    id: "coming-soon",
    title: "More coming",
    subtitle: "Coming soon",
    art: "/games/coming-soon.png",
    bg: "linear-gradient(155deg, #3a2a5e 0%, #2a1d4a 55%, #1a1235 100%)",
    glow: "#7c6db8",
    active: false,
    href: "",
  },
];

// ─── primitives ─────────────────────────────────────────────────────────
function GuestBanner({ onConnect, needsSetup }: { onConnect: () => void; needsSetup?: boolean }) {
  // Two truths, one strip: guests need to SIGN IN; signed-in players who
  // never finished onboarding need to FINISH SETUP. Telling the second
  // group to "sign in" reads as "your sign-in didn't work".
  return (
    <div style={{
      margin: "0 16px",
      padding: "9px 12px", borderRadius: 13,
      background: needsSetup
        ? "linear-gradient(90deg, rgba(251,191,36,0.14), rgba(76,29,149,0.02))"
        : `linear-gradient(90deg, ${T.accent}1f, rgba(76,29,149,0.02))`,
      border: needsSetup ? "1px solid rgba(251,191,36,0.4)" : `1px solid ${T.accent}44`,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>{needsSetup ? "🐣" : "🎁"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: T.body, fontSize: 11, color: T.ink, fontWeight: 700, lineHeight: 1.3 }}>
          {needsSetup ? "You're signed in." : "You're playing free."}
        </span>
        <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, lineHeight: 1.3 }}>
          {needsSetup
            ? " Name your slime to save scores & win G$."
            : " Sign in to win G$, save your pet & climb the board."}
        </span>
      </div>
      <button onClick={onConnect} style={{
        flexShrink: 0, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
        background: needsSetup ? "#b45309" : T.accent, border: "none",
        color: needsSetup ? "#231005" : "#fff", fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em",
        boxShadow: needsSetup ? "0 4px 12px -3px rgba(251,191,36,0.7)" : `0 4px 12px -3px ${T.accent}aa`,
      }}>{needsSetup ? "FINISH SETUP" : "SIGN IN"}</button>
    </div>
  );
}

// A 3D game card: full-bleed cover from the real game, a shade so text stays
// readable, badge + meta line, big title, two-line blurb, and a glass dock with
// the Play button. The first card is the hero and gets a larger title.
function Card3D({ game, hero, wide, onClick }: { game: typeof GAMES_3D[number]; hero: boolean; wide: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Play ${game.title}`}
      style={{
        position: "relative", display: "flex", flexDirection: "column", justifyContent: "flex-end",
        width: "100%", aspectRatio: wide ? "16 / 10" : hero ? "4 / 4.5" : "4 / 3.9",
        padding: 0, border: "none", borderRadius: 24, overflow: "hidden", textAlign: "left", cursor: "pointer",
        color: "#fff", background: "#0b0c12", isolation: "isolate",
        boxShadow: `0 28px 56px -30px rgba(0,0,0,0.95), 0 30px 70px -45px ${game.accent}`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={game.cover} alt="" loading={hero ? "eager" : "lazy"} decoding="async" style={{ position: "absolute", left: 0, top: 0, width: "100%", height: wide ? "100%" : "64%", objectFit: "cover", objectPosition: game.focus, zIndex: 0 }} />
      <span style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", background: wide ? "linear-gradient(rgba(5,6,10,0.4) 0%, rgba(5,6,10,0) 22%, rgba(5,6,10,0) 40%, rgba(5,6,10,0.85) 70%, rgba(5,6,10,0.97) 100%)" : "linear-gradient(rgba(5,6,10,0.35) 0%, rgba(5,6,10,0) 16%, rgba(5,6,10,0) 40%, rgba(11,12,18,0.9) 60%, #0b0c12 66%)" }} />
      <span style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none", borderRadius: 24, boxShadow: "inset 0 0 0 1px rgba(76,29,149,0.1), inset 0 1px rgba(76,29,149,0.14)" }} />
      <span style={{ position: "absolute", top: 14, left: 14, zIndex: 3, display: "inline-flex", alignItems: "center", gap: 7, height: 26, padding: "0 11px", borderRadius: 999, fontFamily: T.body, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", color: game.badge === "NEW" ? "#ffd56b" : "rgba(255,255,255,0.92)", background: "rgba(10,11,16,0.5)", border: `1px solid ${game.badge === "NEW" ? "rgba(255,213,107,0.45)" : "rgba(76,29,149,0.16)"}`, backdropFilter: "blur(14px) saturate(1.4)", WebkitBackdropFilter: "blur(14px) saturate(1.4)" }}>
        <i style={{ width: 6, height: 6, borderRadius: "50%", background: game.accent, boxShadow: `0 0 10px ${game.accent}` }} />
        {game.badge}
      </span>
      <span style={{ position: "relative", zIndex: 3, display: "flex", flexDirection: "column", gap: 6, padding: "0 18px" }}>
        <span style={{ fontFamily: T.body, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.74)", textShadow: "0 1px 12px rgba(0,0,0,0.9)" }}>{game.meta}</span>
        <b style={{ fontFamily: T.display, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", fontSize: hero ? "clamp(32px, 9vw, 46px)" : "clamp(26px, 7vw, 34px)", textShadow: "0 2px 24px rgba(0,0,0,0.55)" }}>{game.title}</b>
        <small style={{ fontFamily: T.body, fontSize: 13.5, fontWeight: 500, lineHeight: 1.42, color: "rgba(255,255,255,0.74)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", maxWidth: 480 }}>{game.blurb}</small>
      </span>
      <span style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "14px 10px 10px", padding: "7px 7px 7px 14px", borderRadius: 17, background: "rgba(76,29,149,0.08)", border: "1px solid rgba(76,29,149,0.12)", backdropFilter: "blur(20px) saturate(1.5)", WebkitBackdropFilter: "blur(20px) saturate(1.5)" }}>
        <span style={{ fontFamily: T.body, fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.82)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Free to play · no download</span>
        <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 3, height: 40, padding: "0 16px 0 20px", borderRadius: 12, background: "#fff", color: "#0a0b10", fontFamily: T.display, fontSize: 15, boxShadow: "0 8px 20px -8px rgba(0,0,0,0.6)" }}>
          Play
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </span>
      </span>
    </button>
  );
}

function ShelfLabel({ tag, text, note }: { tag: string; text: string; note: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
      <span style={{ fontFamily: T.display, fontSize: 12, color: "#1a1400", background: "linear-gradient(180deg, #fde68a 0%, #fbbf24 100%)", borderRadius: 8, padding: "3px 8px" }}>{tag}</span>
      <span style={{ fontFamily: T.display, fontSize: 18, color: T.ink }}>{text}</span>
      <span style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft }}>{note}</span>
    </div>
  );
}

// A 2D game card, same idea as the 3D ones at a smaller size: a cover captured
// from the real game on top, then the title, one line about it, and Play.
function Card2D({ game, onClick }: { game: typeof GAMES[number]; onClick: () => void }) {
  const g = game as typeof game & { cover?: string; focus?: string; isNew?: boolean };
  if (!g.active || !g.cover) return <GameCard game={game} onClick={onClick} />;
  return (
    <button
      onClick={onClick}
      aria-label={`Play ${g.title}`}
      style={{
        position: "relative", display: "flex", flexDirection: "column", width: "100%", padding: 0, border: "none",
        borderRadius: 20, overflow: "hidden", textAlign: "left", cursor: "pointer", color: "#fff", background: "#0b0c12", isolation: "isolate",
        boxShadow: `0 20px 40px -24px rgba(0,0,0,0.95), 0 22px 46px -32px ${g.glow}`,
      }}
    >
      <span style={{ position: "relative", display: "block", width: "100%", aspectRatio: "1 / 0.86", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={g.cover} alt="" loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: g.focus }} />
        <span style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(rgba(5,6,10,0.3) 0%, rgba(5,6,10,0) 26%, rgba(5,6,10,0) 62%, #0b0c12 100%)" }} />
      </span>
      <span style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none", borderRadius: 20, boxShadow: "inset 0 0 0 1px rgba(76,29,149,0.1), inset 0 1px rgba(76,29,149,0.14)" }} />
      {g.isNew && (
        <span style={{ position: "absolute", top: 10, left: 10, zIndex: 3, display: "inline-flex", alignItems: "center", gap: 6, height: 22, padding: "0 9px", borderRadius: 999, fontFamily: T.body, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em", color: "#ffd56b", background: "rgba(10,11,16,0.55)", border: "1px solid rgba(255,213,107,0.45)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
          <i style={{ width: 5, height: 5, borderRadius: "50%", background: g.glow, boxShadow: `0 0 8px ${g.glow}` }} />
          NEW
        </span>
      )}
      <span style={{ position: "relative", zIndex: 3, display: "flex", flexDirection: "column", gap: 4, padding: "2px 12px 0", flex: 1 }}>
        <b style={{ fontFamily: T.display, fontWeight: 700, fontSize: 17, lineHeight: 1.1, letterSpacing: "-0.01em" }}>{g.title}</b>
        <small style={{ fontFamily: T.body, fontSize: 11.5, fontWeight: 500, lineHeight: 1.35, color: "rgba(255,255,255,0.68)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 31 }}>{g.subtitle}</small>
      </span>
      <span style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "10px 8px 8px", padding: "5px 5px 5px 11px", borderRadius: 13, background: "rgba(76,29,149,0.08)", border: "1px solid rgba(76,29,149,0.12)" }}>
        <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.78)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Free</span>
        <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 2, height: 30, padding: "0 10px 0 13px", borderRadius: 9, background: "#fff", color: "#0a0b10", fontFamily: T.display, fontSize: 13 }}>
          Play
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </span>
      </span>
    </button>
  );
}

function GameCard({ game, onClick }: { game: typeof GAMES[number]; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={!game.active} style={{
      width: "100%", padding: 0, border: "none",
      borderRadius: 18, overflow: "hidden",
      background: game.bg, opacity: game.active ? 1 : 0.55,
      cursor: game.active ? "pointer" : "not-allowed", textAlign: "left",
      boxShadow: game.active ? `0 8px 18px -6px ${game.glow}66` : "none",
      position: "relative",
      // Flex column so the dark text panel can stretch with flex: 1
      // and reach the card's bottom edge regardless of subtitle wrap.
      // Without this, single-line subtitles (Challenge AI) left a strip
      // of game.bg visible below the dark band on rows where another
      // card's subtitle wrapped to 2 lines.
      display: "flex", flexDirection: "column",
    }}>
      {!game.active && (
        <span style={{ position: "absolute", top: 8, right: 8, padding: "2px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(76,29,149,0.2)", color: "#fff", fontFamily: T.body, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", zIndex: 2 }}>SOON</span>
      )}
      {game.active && (game as { isNew?: boolean }).isNew && (
        <span style={{ position: "absolute", top: 8, right: 8, padding: "2px 8px", borderRadius: 999, background: "linear-gradient(180deg, #fde68a 0%, #fbbf24 100%)", border: "1px solid rgba(255,255,255,0.35)", color: "#231005", fontFamily: T.body, fontSize: 9, fontWeight: 900, letterSpacing: "0.1em", zIndex: 2, boxShadow: "0 2px 8px rgba(251,191,36,0.6)" }}>NEW</span>
      )}
      <div style={{ height: 110, position: "relative", overflow: "hidden" }}>
        {/* Cards can declare `art` as either a string path (rhythm /
            simon use real PNGs) OR a JSX element (stack tower uses an
            inline SVG of stacked blocks). The earlier render passed
            the JSX through `<img src={...}>` which fell back to the
            broken-image triangle + alt-text — looked like a missing
            asset. Branching on type lets both schemas coexist. */}
        {typeof game.art === "string" ? (
          <img src={game.art} alt={game.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", padding: 12 }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, padding: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{game.art}</div>
        )}
      </div>
      <div style={{ padding: "12px 14px 14px", background: "rgba(0,0,0,0.35)", flex: 1 }}>
        <div style={{ fontFamily: T.display, fontSize: 16, color: "#fff", lineHeight: 1.1, letterSpacing: "0.01em" }}>{game.title}</div>
        <div style={{ fontFamily: T.body, fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 700, marginTop: 3 }}>
          {game.subtitle}
        </div>
      </div>
    </button>
  );
}

// ─── page ───────────────────────────────────────────────────────────────
export default function GamesPage() {
  const router = useRouter();
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  // Per-game loading overlay state · holds the tapped game's identity so
  // the loader shows the right art/title/glow. Cleared when the route
  // change unmounts the page (and re-cleared on back-nav return).
  const [loadingGame, setLoadingGame] = useState<typeof GAMES[number] | null>(null);

  // Same gate as /dashboard — "connected" means full onboarding (Privy + GamePass mint).
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  // MiniPay users skip Privy · their injected wallet is the identity.
  const isMiniPay = useIsMiniPay();
  const connected = (authenticated || isMiniPay) && !!address && hasMinted === true;
  // Signed in, never minted — needs FINISH SETUP, not another "sign in".
  const authedUnminted = (authenticated || isMiniPay) && !!address && hasMinted === false;
  // Unknown mint state = loading, not guest — don't flash the sign-in
  // banner at players whose wallet is still hydrating.
  const identityResolving = (authenticated || isMiniPay) && (!address || hasMinted === undefined);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Always route Sign-in taps to /home — the Privy modal lives behind
  // the home page button so first-timers land in a real onboarding
  // surface, not an orphan popup over a feed.
  const onConnect = () => router.push("/home?signin=1");
  const onPlay = async (id: string) => {
    // Spam-tap guard · ignore further taps while a load is already in
    // flight. The overlay covers the page so the player can't see the
    // cards anyway, but this stops queued promises from racing.
    if (loadingGame) return;
    const g = GAMES.find(x => x.id === id);
    if (!g?.active) return;
    playClick();

    // Show the per-game loading overlay with the game's own art + title
    // + glow color. It covers the screen instantly so the player sees a
    // branded transition instead of an empty hub-to-lobby gap.
    setLoadingGame(g);

    // Run both concurrently:
    //   1. fetchPreview · pulls the lobby's top-3 leaderboard so the
    //      cache is warm by the time the route lands.
    //   2. 600ms min-duration timer · guarantees the loader gets at
    //      least one breath even when the prefetch resolves in 100ms.
    // Promise.all means we wait for the SLOWER of the two · loader
    // never feels rushed on a fast connection, never feels stuck on a
    // slow one.
    const gameType: GameTypeId | null =
      id === "rhythm" ? 0 : id === "simon" ? 1 : id === "stack" ? 2 : id === "nepa" ? 4 : null;
    const tasks: Promise<unknown>[] = [new Promise(r => setTimeout(r, 600))];
    if (gameType !== null) tasks.push(fetchPreview(gameType).catch(() => null));
    await Promise.all(tasks);

    router.push(g.href);
    // Loader stays visible until the new route's first paint; clearing
    // here would cause a brief blank flash between overlay-dismiss and
    // lobby-mount. The page unmount on route change drops it for us.
  };

  return (
    <div style={{
      minHeight: "100vh", width: "100%",
      background: T.bg,
      color: T.ink,
      fontFamily: T.body,
    }}>
      {/* Full-viewport sticky header. Content centers itself inside. */}
      <AppHeader />

      {/* Guest banner — only when not fully onboarded. Same pattern as /dashboard. */}
      {!connected && !identityResolving && (
        <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "8px auto 0" }}>
          <GuestBanner needsSetup={authedUnminted} onConnect={authedUnminted ? () => router.push("/home?ob=1") : onConnect} />
        </div>
      )}

      <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: T.gap + 4 }}>

        {/* Heading · matches design's "PLAY · SKILL ARENA / All games" */}
        <div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em" }}>PLAY · SKILL ARENA</div>
          <h2 style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 24, color: T.ink, margin: "4px 0 0", letterSpacing: "-0.01em" }}>All games</h2>
        </div>

        {/* Shelf 1 · 3D worlds */}
        <ShelfLabel tag="3D" text="3D games" note="Full worlds. Move, drive, roll" />
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(2, 1fr)" : "1fr", gap: 14 }}>
          {GAMES_3D.map((g, i) => (
            <Card3D key={g.id} game={g} hero={i === 0} wide={isDesktop} onClick={() => { playClick(); router.push(g.href); }} />
          ))}
        </div>

        {/* Shelf 2 · classic 2D · 2 cols mobile, 3 cols desktop */}
        <ShelfLabel tag="2D" text="Classic games" note="Quick skill games" />
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(3, 1fr)" : "repeat(2, 1fr)", gap: 12 }}>
          {GAMES.map(g => <Card2D key={g.id} game={g} onClick={() => onPlay(g.id)} />)}
        </div>
      </div>

      <AppBottomNav wide={isDesktop} />

      {/* Per-game loading overlay · shown while we warm the lobby's
          leaderboard cache. Renders the tapped game's art + title +
          glow so the transition reads as part of THAT game's identity. */}
      {loadingGame && (
        <GameLoadingScreen
          title={loadingGame.title}
          art={loadingGame.art}
          bg={loadingGame.bg}
          glow={loadingGame.glow}
        />
      )}
    </div>
  );
}
