"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy, useLogin, useConnectWallet } from "@privy-io/react-auth";
import { useAccount, useDisconnect } from "wagmi";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { playClick, playWhooshIn } from "@/hooks/useAppAudio";
import { type AllTimeEntry } from "@/lib/subgraph";
import { getHomeData } from "@/lib/homePreload";
import Onboarding, { type OnboardingResult } from "@/components/Onboarding";

const ONBOARDED_KEY = "gamearena:onboarded";

function fmtNum(n: number): string {
  const trim = (s: string) => s.replace(/\.0+$|(\.\d*?)0+$/, "$1");
  if (n >= 1e9) return `${trim((n / 1e9).toFixed(2))}B`;
  if (n >= 1e6) return `${trim((n / 1e6).toFixed(2))}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

// ─── tokens ──────────────────────────────────────────────────────────────
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// ─── primitives ──────────────────────────────────────────────────────────
function Pill({ children, color, soft = true }: { children: React.ReactNode; color: string; soft?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 9px", borderRadius: 999,
      fontFamily: "inherit", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.04em",
      background: soft ? color + "1f" : color,
      color: soft ? color : "#fff",
      border: `1px solid ${soft ? color + "55" : "transparent"}`,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Stat({ label, value, size = "md" }: { label: string; value: string; size?: "sm" | "md" | "lg" }) {
  const fs = size === "lg" ? 28 : size === "sm" ? 16 : 19;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: T.display, fontSize: fs, color: T.ink, lineHeight: 1, letterSpacing: "0.01em" }}>{value}</span>
      <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>{label}</span>
    </div>
  );
}

// Telegram community entry point · styled to match the top-bar ABOUT link
// (same body font, size, weight, tracking, inkSoft colour) so it reads as a
// sibling secondary link, not a foreign pill. Small monochrome Telegram glyph
// (currentColor) for recognition. Opens the community in a new tab.
function TelegramLink() {
  return (
    <a
      href="https://t.me/gamearenaHQ"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join the GameArena community on Telegram"
      style={{
        fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700,
        letterSpacing: "0.12em", textDecoration: "none",
        display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 0",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
      </svg>
      COMMUNITY
    </a>
  );
}

// About sheet · the real "what is GameArena" surface behind the ABOUT link
// (previously a dead route to /games). Matches the app's modal aesthetic:
// backdrop blur, surface gradient, T tokens. Bottom sheet on mobile, centred
// card on desktop. Closes on backdrop tap, ESC, or the X.
const ABOUT_GAMES: { name: string; trains: string; color: string }[] = [
  { name: "Simon Memory", trains: "recall",             color: "#06b6d4" },
  { name: "Stack Tower",  trains: "precision",          color: "#fb923c" },
  { name: "Rhythm Rush",  trains: "focus & timing",     color: "#e879f9" },
  { name: "Challenge AI", trains: "outsmarting MARKOV",  color: "#34d399" },
];
function AboutSheet({ onClose, onPlayFree, isDesktop }: { onClose: () => void; onPlayFree: () => void; isDesktop: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(6,2,26,0.72)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        display: "flex", alignItems: isDesktop ? "center" : "flex-end", justifyContent: "center",
        animation: "about-fade 0.22s ease both",
        padding: isDesktop ? 24 : 0,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="About GameArena"
        style={{
          width: "100%", maxWidth: 460,
          maxHeight: isDesktop ? "86vh" : "88dvh", overflowY: "auto",
          background: "linear-gradient(180deg, rgba(42,18,100,0.98) 0%, rgba(20,6,60,0.99) 55%, rgba(10,2,38,1) 100%)",
          border: `1px solid ${T.hairlineHi}`,
          borderRadius: isDesktop ? 22 : "24px 24px 0 0",
          boxShadow: `0 0 60px ${T.accent}26, 0 -12px 44px rgba(0,0,0,0.6)`,
          padding: "22px 20px calc(env(safe-area-inset-bottom, 0px) + 22px)",
          animation: "about-up 0.32s cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.accent, textTransform: "uppercase" }}>What is</div>
            <div style={{ fontFamily: T.display, fontSize: 26, color: T.ink, lineHeight: 1.05, marginTop: 2 }}>Game Arena</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
            background: "rgba(255,255,255,0.06)", border: `1px solid ${T.hairlineHi}`,
            color: T.inkDim, fontSize: 15, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        <p style={{ fontFamily: T.body, fontSize: 14, lineHeight: 1.55, color: T.inkDim, margin: "14px 0 0" }}>
          Quick skill games that actually make you sharper, and pay you to play. Thirty seconds a game, but you feel yourself improve.
        </p>

        {/* the games */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "16px 0" }}>
          {ABOUT_GAMES.map(g => (
            <div key={g.name} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 12,
              background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hairline}`,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: g.color, boxShadow: `0 0 8px ${g.color}`, flexShrink: 0 }} />
              <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 800, color: T.ink }}>{g.name}</span>
              <span style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft }}>· trains {g.trains}</span>
            </div>
          ))}
        </div>

        <p style={{ fontFamily: T.body, fontSize: 13, lineHeight: 1.6, color: T.inkDim, margin: "0 0 6px" }}>
          The leaderboards are <strong style={{ color: T.ink }}>verified humans only</strong>, so you compete against real people, never bots.
        </p>
        <p style={{ fontFamily: T.body, fontSize: 13, lineHeight: 1.6, color: T.inkDim, margin: 0 }}>
          Play free. Sign in to rank, verify once, and earn real <strong style={{ color: T.ink }}>G$ every day</strong>. It runs on Celo and works in your browser or inside MiniPay.
        </p>

        {/* actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={() => { onClose(); onPlayFree(); }} style={{
            flex: 1, fontFamily: T.display, fontSize: 16, color: "#fff",
            minHeight: 50, borderRadius: 14,
            background: `linear-gradient(180deg, ${T.accent} 0%, ${T.accent}cc 100%)`,
            border: `1.5px solid ${T.accent}`, cursor: "pointer",
            boxShadow: `0 10px 26px -8px ${T.accent}88`,
          }}>Play free</button>
          <a href="https://t.me/gamearenaHQ" target="_blank" rel="noopener noreferrer" style={{
            flex: 1, fontFamily: T.body, fontSize: 13, fontWeight: 800, color: T.ink,
            minHeight: 50, borderRadius: 14, textDecoration: "none",
            background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairlineHi}`,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#2ca5e0" aria-hidden="true"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>
            Community
          </a>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "2px 2px 8px" }}>
      <span style={{ fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>{children}</span>
    </div>
  );
}

const ICON_PATHS: Record<string, string> = {
  play: "M8 5v14l11-7z",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6z",
};

function Icon({ name, size = 20, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d={ICON_PATHS[name] || ""} /></svg>;
}

function SoundToggle({ muted, onToggle, size = 38 }: { muted: boolean; onToggle: () => void; size?: number }) {
  return (
    <button onClick={onToggle} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"} style={{
      position: "relative", width: size, height: size, borderRadius: 12, flexShrink: 0,
      background: muted ? "rgba(244,63,94,0.12)" : "rgba(255,255,255,0.05)",
      border: `1px solid ${muted ? "rgba(244,63,94,0.4)" : T.hairline}`,
      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
      color: muted ? "#fda4af" : T.inkDim, transition: "all 0.15s",
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M4 9v6h3.5L13 19.5V4.5L7.5 9H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ) : (
          <path d="M16.5 8.5a5 5 0 0 1 0 7M18.8 6.2a8.5 8.5 0 0 1 0 11.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        )}
      </svg>
    </button>
  );
}

const KEYFRAMES = `
  @keyframes home-float-gentle {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
  @keyframes about-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes about-up   { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
`;

// ─── HomeScreen · mobile ─────────────────────────────────────────────────
function HomeScreenMobile({
  onPlayFree, onConnect, onAbout, onMute, muted, banner,
}: {
  onPlayFree: () => void;
  banner?: React.ReactNode;
  onConnect: () => void;
  onAbout: () => void;
  onMute: () => void;
  muted: boolean;
}) {
  return (
    // height: 100dvh uses the dynamic viewport on mobile so iOS Safari's
    // address bar can't push the Sign-in button off-screen. overflow:
    // hidden locks the surface so it never scrolls. Padding uses the
    // device safe-area insets · without them, the top sits flush against
    // the status bar and the bottom hugs the home indicator, which is
    // also what made the hero feel sit-above-center: top was 16px while
    // the bottom buttons block was implicitly ~140px of content, so
    // visually the logo was always above the screen midpoint.
    <div style={{
      flex: 1, position: "relative", overflow: "hidden",
      display: "flex", flexDirection: "column",
      padding: "calc(env(safe-area-inset-top, 0px) + 12px) 24px calc(env(safe-area-inset-bottom, 0px) + 40px)",
      height: "100dvh", minHeight: "100svh",
    }}>
      <img src="/splash_screen_icons/dice.png" alt="" style={{ position: "absolute", top: "8%", left: -24, width: 96, opacity: 0.16, transform: "rotate(-18deg)", filter: "drop-shadow(0 0 20px #c026d3)" }} />
      <img src="/splash_screen_icons/joystick.png" alt="" style={{ position: "absolute", bottom: "26%", right: -18, width: 84, opacity: 0.16, transform: "rotate(14deg)", filter: "drop-shadow(0 0 20px #06b6d4)" }} />
      <img src="/splash_screen_icons/gamepad.png" alt="" style={{ position: "absolute", top: "30%", right: -10, width: 64, opacity: 0.1, transform: "rotate(8deg)", filter: "drop-shadow(0 0 16px #a78bfa)" }} />

      {/* Top row — mute (left) + About (right) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 2 }}>
        <SoundToggle muted={muted} onToggle={onMute} size={36} />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <TelegramLink />
          <button onClick={onAbout} style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.12em", background: "transparent", border: "none", cursor: "pointer", padding: "4px 0" }}>ABOUT</button>
        </div>
      </div>

      {/* Hero — logo + one headline + one line. Auto-sized (no flex: 1)
          so it doesn't absorb middle whitespace · the bottom block sits
          right under it with a controlled clamped gap, and any remaining
          viewport height falls as empty space BELOW the buttons. This is
          what compresses the layout: the old flex: 1 hero was eating all
          leftover height, opening a ~40% dead gap between hero and CTAs. */}
      <div style={{ display: "flex", flexDirection: "column", paddingTop: "clamp(72px, 15vh, 136px)", position: "relative", zIndex: 2, gap: 20 }}>
        <img src="/logo-full.png" alt="Game Arena" style={{ width: "82%", maxWidth: 360, alignSelf: "center", filter: "drop-shadow(0 4px 28px rgba(167,139,250,0.6))" }} />
        <h1 style={{ fontFamily: T.display, fontSize: 34, lineHeight: 1.0, color: T.ink, margin: 0, textAlign: "center", letterSpacing: "-0.01em" }}>
          Play. Compete. <span style={{ color: T.accent, textShadow: `0 0 18px ${T.accent}` }}>Win.</span>
        </h1>
        <p style={{ fontFamily: T.body, fontSize: 14, lineHeight: 1.5, color: T.inkDim, textAlign: "center", margin: "0 12px" }}>
          Quick skill games. Climb the board, win G$.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: "clamp(56px, 12vh, 124px)", position: "relative", zIndex: 2 }}>
        {banner}
        {/* Stacked CTAs share the same min-height so they read as
            intentional alignment. Hierarchy lives in fill + label weight,
            not size: Play free carries the accent gradient + display font
            + 22px label so the eye lands there; Sign in is outline + body
            font + 14px label so it reads secondary without dropping the
            tap target. iOS HIG / Material both call this out for stacked
            actions and most polished mobile games follow it. */}
        <button onClick={onPlayFree} style={{
          fontFamily: T.display, fontSize: 22, color: "#fff",
          minHeight: 60, padding: "0 24px", borderRadius: 18,
          background: `linear-gradient(180deg, ${T.accent} 0%, ${T.accent}cc 100%)`,
          border: `1.5px solid ${T.accent}`,
          boxShadow: `0 12px 30px -8px ${T.accent}88, 0 0 0 0.5px rgba(255,255,255,0.5) inset, 0 -3px 0 rgba(0,0,0,0.25) inset`,
          cursor: "pointer", letterSpacing: "0.02em",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        }}>
          <Icon name="play" size={18} color="#fff" /> Play free
        </button>
        <button onClick={onConnect} style={{
          fontFamily: T.body, fontSize: 14, color: T.ink, fontWeight: 800,
          minHeight: 60, padding: "0 16px", borderRadius: 14,
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${T.hairlineHi}`,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <Icon name="bolt" size={15} color={T.accent} /> Sign in
        </button>
        <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center", lineHeight: 1.4, marginTop: 2 }}>
          Free to play. Sign in anytime to win G$ &amp; save your pet.
        </div>
      </div>
    </div>
  );
}

// ─── HomeScreen · desktop ────────────────────────────────────────────────
function HomeScreenDesktop({
  onPlayFree, onConnect, onAbout, onMute, muted, live, banner,
}: {
  onPlayFree: () => void;
  banner?: React.ReactNode;
  onConnect: () => void;
  onAbout: () => void;
  onMute: () => void;
  muted: boolean;
  live: LiveData | null;
}) {
  return (
    <div style={{ display: "flex", overflow: "hidden", padding: "32px 40px", gap: 48, alignItems: "center", justifyContent: "center", minHeight: "100vh", maxWidth: 1180, margin: "0 auto", width: "100%" }}>
      {/* left — copy */}
      <div style={{ flex: 1, maxWidth: 540, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Pill color="#a78bfa">{climbPillLabel(live?.climb ?? null)}</Pill>
          <SoundToggle muted={muted} onToggle={onMute} size={34} />
          <TelegramLink />
        </div>
        <img src="/logo-full.png" alt="Game Arena" style={{ width: "clamp(280px, 32vw, 440px)", height: "auto", filter: "drop-shadow(0 4px 32px rgba(167,139,250,0.55))" }} />
        <h1 style={{ fontFamily: T.display, fontSize: 56, lineHeight: 1.02, color: T.ink, margin: 0, letterSpacing: "-0.015em" }}>
          Play. Compete. <span style={{ color: T.accent, textShadow: `0 0 28px ${T.accent}` }}>Win.</span>
        </h1>
        <p style={{ fontFamily: T.body, fontSize: 16, lineHeight: 1.55, color: T.inkDim, margin: 0, maxWidth: 480 }}>
          Fun mini-games, live leaderboards, real prizes. Your onchain spot to kick back and play.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>
          {banner}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onPlayFree} style={{
              fontFamily: T.display, fontSize: 19, color: "#fff",
              padding: "15px 30px", borderRadius: 16,
              background: `linear-gradient(180deg, ${T.accent}, ${T.accent}cc)`,
              border: `1.5px solid ${T.accent}`,
              boxShadow: `0 14px 32px -8px ${T.accent}88, inset 0 1px 0 rgba(255,255,255,0.4)`,
              cursor: "pointer", letterSpacing: "0.02em",
              display: "inline-flex", alignItems: "center", gap: 9,
            }}>
              <Icon name="play" size={15} color="#fff" /> Play free
            </button>
            <button onClick={onConnect} style={{
              fontFamily: T.body, fontSize: 14, fontWeight: 800, color: T.ink,
              padding: "15px 24px", borderRadius: 16,
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${T.hairlineHi}`,
              cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 8,
            }}>
              <Icon name="bolt" size={14} color={T.accent} /> Sign in
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: T.body, fontSize: 12, color: T.inkSoft }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
            Free to start. Sign in later to win G$ &amp; save your progress.
            <button onClick={onAbout} style={{ background: "none", border: "none", color: T.accent, fontFamily: T.body, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, marginLeft: 2 }}>How it works ›</button>
          </div>
        </div>
        <a
          href="/impact"
          onClick={() => playClick()}
          aria-label="See the G$ economy"
          style={{
            textDecoration: "none", color: "inherit",
            display: "flex", gap: 32, marginTop: 18,
            padding: "16px 22px", borderRadius: 18,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${T.hairline}`,
            alignSelf: "flex-start", cursor: "pointer", textAlign: "left",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <Stat label="Players" value={live ? String(live.totalPlayers) : "—"} size="lg" />
          <span style={{ width: 1, background: T.hairline }} />
          <Stat label="Matches" value={live ? fmtNum(live.totalMatches) : "—"} size="lg" />
          <span style={{ width: 1, background: T.hairline }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Stat label="G$ to UBI ›" value={live ? fmtNum(live.totalUbiDonatedG) : "—"} size="lg" />
          </div>
        </a>
      </div>
      {/* right — pet + leaderboard preview */}
      <div style={{ flex: 1, maxWidth: 460, display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
        <div style={{
          position: "relative", padding: "28px 24px 24px",
          borderRadius: 28,
          background: `radial-gradient(ellipse at 30% 20%, ${T.accent}33 0%, transparent 60%), linear-gradient(160deg, rgba(60,28,140,0.55), rgba(15,5,50,0.85))`,
          border: `1px solid ${T.hairline}`,
          overflow: "hidden",
        }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.08), transparent 60%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Pill color="#fde68a">YOUR PET · WAITING</Pill>
            <div style={{ position: "relative", width: 180, height: 180, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src="/pets/stage-1-egg.png" alt="" style={{ width: 160, height: 160, objectFit: "contain", filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.5))", animation: "home-float-gentle 3s ease-in-out infinite" }} />
            </div>
            <div style={{ fontFamily: T.display, fontSize: 22, color: T.ink, letterSpacing: "0.01em" }}>Not adopted yet</div>
            <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, textAlign: "center", lineHeight: 1.45, maxWidth: 280 }}>
              Connect to claim your pet. It evolves from <strong style={{ color: T.accent }}>egg → King Slime</strong> as you play.
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 4, padding: "8px 14px", borderRadius: 10, background: "rgba(0,0,0,0.25)", border: `1px solid ${T.hairline}` }}>
              <Stat label="Stages" value="5" size="sm" />
              <span style={{ width: 1, background: T.hairline }} />
              <Stat label="Habitats" value="6" size="sm" />
              <span style={{ width: 1, background: T.hairline }} />
              <Stat label="Badges" value="14" size="sm" />
            </div>
          </div>
        </div>
        <div style={{ padding: 16, borderRadius: 18, background: T.surface, border: `1px solid ${T.hairline}` }}>
          <SectionLabel>Top players · all time</SectionLabel>
          {(live?.top3 ?? []).map((r, i) => {
            const color = i === 0 ? "#fbbf24" : i === 1 ? "#a78bfa" : "#f472b6";
            const name = r.username || shortAddr(r.player);
            return (
              <div key={r.player} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px" }}>
                <span style={{ fontFamily: T.display, fontSize: 14, color, width: 22, textShadow: `0 0 8px ${color}88` }}>#{i + 1}</span>
                <span style={{ flex: 1, fontFamily: T.body, fontSize: 12, color: T.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                <span style={{ fontFamily: T.display, fontSize: 14, color: T.ink, letterSpacing: "0.02em" }}>{r.score}</span>
              </div>
            );
          })}
          {!live && (
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, padding: "8px 4px" }}>Loading live standings…</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── /home page ──────────────────────────────────────────────────────────
type LiveData = {
  totalPlayers: number;
  totalMatches: number;
  totalUbiDonatedG: number;
  top3: AllTimeEntry[];
  climb: { phase: string; endsAt: string } | null;
};

function climbPillLabel(climb: { phase: string; endsAt: string } | null): string {
  if (!climb || climb.phase !== "live") return "BETA · LIVE ON CELO";
  const msLeft = new Date(climb.endsAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  if (daysLeft <= 0) return "BETA · LIVE ON CELO";
  if (daysLeft === 1) return "MARKOV CLIMB · FINAL DAY";
  return `MARKOV CLIMB · ${daysLeft} DAYS LEFT`;
}

export default function HomePage() {
  const router = useRouter();
  const { authenticated, user, ready, logout } = usePrivy();
  // Privy's useLogin gives us a guaranteed onComplete callback that fires
  // after auth (and embedded-wallet creation) finishes. This is the source
  // of truth for "the user is now signed in" · using it instead of watching
  // [authenticated, walletAddress] removes the race where the modal closes
  // before wagmi has resolved the wallet and the navigation never fires.
  //
  // Gas faucet does NOT fire here. It fires inside the Onboarding modal
  // right before the GamePass mint · so only players who actually proceed
  // to mint get the drip. Saves a drip per "signed in then bounced"
  // visitor, which is most of the sybil-risk traffic.
  const { login } = useLogin({
    onComplete: () => {
      // Land on the naming step, NOT /verify. Pushing /verify here made
      // fresh sign-ins skip "Name your slime" entirely. The Onboarding
      // overlay owns the routing: minted wallets short-circuit through,
      // verified wallets skip the verify pitch, new players name their
      // slime first — the intended order.
      setShowOnboarding(true);
    },
  });
  const { address: walletAddress } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { connectWallet } = useConnectWallet();
  const audio = useAudioSettings();
  // Safety redirect for MiniPay users · the splash already routes them to
  // /dashboard, but a back-nav or direct deep link to /home would land them
  // on the Play Free / Sign In page they don't need. This catches that
  // case and bounces them through /verify like a signed-in player.
  const isMiniPay = useIsMiniPay();
  useEffect(() => {
    if (isMiniPay) {
      router.replace(`/verify?next=${encodeURIComponent("/dashboard")}`);
    }
  }, [isMiniPay, router]);
  // Mute icon only kills the ambient pad (constant menu loop). UI SFX,
  // game SFX, and in-game music are untouched — Settings → Audio is
  // the place for granular per-channel mute.
  const muted = !audio.appAudioOn;
  const [isDesktop, setIsDesktop] = useState(false);
  const [live, setLive] = useState<LiveData | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  // Lock html + body overflow while /home is mounted so iOS Safari can't
  // drag-scroll the page when its address bar collapses (which changes the
  // dvh value mid-gesture and creates a few px of overflow underneath my
  // wrapper). overflow: hidden on the React container alone wasn't enough
  // because <html>/<body> live above it in the cascade. Restoring on
  // unmount means other routes (which DO scroll) aren't affected.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    const prevHtmlPos = html.style.position;
    const prevBodyPos = body.style.position;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    // position: fixed on body kills the iOS bounce/drag that overflow
    // alone can't fully suppress when the address bar is in motion.
    // width/height anchor it so layout doesn't collapse to zero.
    html.style.position = "fixed";
    body.style.position = "fixed";
    html.style.width = "100%";
    body.style.width = "100%";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      html.style.position = prevHtmlPos;
      body.style.position = prevBodyPos;
      html.style.width = "";
      body.style.width = "";
    };
  }, []);

  // Auto-open onboarding the first time a wallet signs in. The onboarded key
  // is keyed by wallet address so a different account on the same browser
  // still gets the flow. ?ob=1 forces it open for testing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const forced = new URLSearchParams(window.location.search).get("ob") === "1";
    if (forced) { setShowOnboarding(true); return; }
    if (!authenticated) return;
    // Require BOTH a Privy session and a live wallet connection. A
    // stale Privy session whose underlying wallet has been disconnected
    // (e.g. user logged out of Rabby) should NOT auto-trigger
    // onboarding — the mint tx inside would fail without an active
    // signer anyway, and the surprise modal reads as a bug.
    const addr = user?.wallet?.address?.toLowerCase();
    if (!addr || !walletAddress) return;
    try {
      // Respect an explicit close: if the player X'd the overlay this
      // session, don't shove it back in their face on every /home visit.
      // (?ob=1 and the Sign in button still open it on demand.)
      const dismissed = window.sessionStorage.getItem(`ob_dismissed_${addr}`);
      if (dismissed) return;
      const done = window.localStorage.getItem(ONBOARDED_KEY);
      if (done?.toLowerCase() !== addr) setShowOnboarding(true);
    } catch {}
  }, [authenticated, user?.wallet?.address, walletAddress]);

  // Closing the overlay (X or the switch-account link) is a real choice —
  // remember it for this session so the auto-open doesn't trap the player
  // in a loop they can't escape.
  const dismissOnboarding = () => {
    const addr = user?.wallet?.address?.toLowerCase();
    if (addr) {
      try { window.sessionStorage.setItem(`ob_dismissed_${addr}`, "1"); } catch {}
    }
    setShowOnboarding(false);
  };

  const completeOnboarding = (r: OnboardingResult) => {
    const addr = user?.wallet?.address?.toLowerCase();
    if (addr) {
      try { window.localStorage.setItem(ONBOARDED_KEY, addr); } catch {}
    }
    setShowOnboarding(false);
    // Match main's flow: every post-mint hand-off routes through
    // /verify, which auto-advances verified players (~200ms via the
    // direct on-chain whitelist read) and shows the actual verify CTA
    // to anyone who isn't. `r.verified` is just a hint about whether
    // the player tapped the verify button in onboarding — the page
    // itself is the source of truth either way.
    void r;
    router.push(`/verify?next=${encodeURIComponent("/dashboard")}`);
  };

  const toggleMute = () => {
    // Flip the ambient pad only. SFX + in-game music untouched.
    audio.update({ appAudioOn: muted });
    playClick();
  };

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Joins the flight the splash already started (instant when warm);
    // starts fresh only on direct /home navigation or hard refresh.
    getHomeData()
      .then(({ stat, top3, climb }) => {
        if (cancelled || !stat) return;
        setLive({
          totalPlayers: stat.totalPlayers,
          totalMatches: stat.totalScores,
          totalUbiDonatedG: stat.totalUbiDonatedG,
          top3,
          climb,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const onPlayFree = () => { playWhooshIn(); router.push("/dashboard"); };
  // Three states:
  //   1. Privy authed AND wallet connected  → /verify (whitelist gate)
  //   2. Privy authed but wallet DISCONNECTED (Rabby logged out, etc.)
  //      → stale session; drop it and reopen the login modal so the
  //      player can pick a fresh wallet. Without this, tapping "Sign
  //      in" routed them straight into /games on a session they thought
  //      they'd already left.
  //   3. Not authed at all → call login() · useLogin's onComplete
  //      handles the route once Privy confirms auth + wallet are ready.
  //      The old justSignedInRef + watching-effect pattern is gone:
  //      that race was the reason players had to tap Sign in twice.
  const onConnect = async () => {
    playClick();
    // Never silently destroy a session. Three honest states:
    //   fully signed in (auth + wallet)  → continue into the app
    //   half-dead (auth, no wallet)      → reconnect the SAME identity
    //   signed out                        → open the login modal
    if (authenticated && walletAddress) {
      // Same single entry point as a fresh login: the Onboarding overlay
      // short-circuits minted wallets onward and gives unminted ones the
      // naming step + the "Wrong account? Switch account" escape.
      setShowOnboarding(true);
      return;
    }
    if (authenticated && !walletAddress) {
      connectWallet();
      return;
    }
    login();
  };

  const onAbout = () => { playClick(); setShowAbout(true); };

  // Half-dead session banner · shown right here on home, where the player
  // actually is. Privy still signed in, wallet disconnected from the
  // extension → say so, with the two honest exits.
  const zombie = ready && authenticated && !walletAddress && !isMiniPay;
  const zombieBanner = zombie ? (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      padding: "10px 14px", borderRadius: 13,
      background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)",
    }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
      <span style={{ flex: 1, minWidth: 160, fontFamily: T.body, fontSize: 11.5, color: "rgba(240,230,255,0.85)", lineHeight: 1.4 }}>
        Signed in, but your wallet is disconnected.
      </span>
      <button onClick={() => { playClick(); connectWallet(); }} style={{
        flexShrink: 0, padding: "7px 13px", borderRadius: 999,
        background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.55)",
        color: "#86efac", fontFamily: T.body, fontSize: 10.5, fontWeight: 800,
        letterSpacing: "0.06em", cursor: "pointer",
      }}>RECONNECT</button>
      <button onClick={async () => { playClick(); try { await disconnectAsync(); } catch {} try { await logout(); } catch {} }} style={{
        flexShrink: 0, padding: "7px 13px", borderRadius: 999,
        background: "rgba(244,63,94,0.15)", border: "1px solid rgba(244,63,94,0.5)",
        color: "#fda4af", fontFamily: T.body, fontSize: 10.5, fontWeight: 800,
        letterSpacing: "0.06em", cursor: "pointer",
      }}>LOG OUT</button>
    </div>
  ) : null;

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div style={{
        // Mobile: lock to the dynamic viewport so iOS Safari's address bar
        // can't push content off-screen. Desktop keeps min-height so longer
        // marketing content can grow if needed.
        minHeight: isDesktop ? "100vh" : "100dvh",
        height: isDesktop ? undefined : "100dvh",
        width: "100%",
        background: T.bg,
        color: T.ink,
        fontFamily: T.body,
        overflow: isDesktop ? undefined : "hidden",
      }}>
        {isDesktop ? (
          <HomeScreenDesktop
            banner={zombieBanner}
            onPlayFree={onPlayFree}
            onConnect={onConnect}
            onAbout={onAbout}
            onMute={toggleMute}
            muted={muted}
            live={live}
          />
        ) : (
          <div style={{ maxWidth: 480, margin: "0 auto", height: "100dvh", display: "flex", flexDirection: "column" }}>
            <HomeScreenMobile
              banner={zombieBanner}
              onPlayFree={onPlayFree}
              onConnect={onConnect}
              onAbout={onAbout}
              onMute={toggleMute}
              muted={muted}
            />
          </div>
        )}
      </div>
      {showOnboarding && (
        <Onboarding
          onComplete={completeOnboarding}
          onClose={dismissOnboarding}
          onPlayFree={() => { dismissOnboarding(); router.push("/dashboard"); }}
        />
      )}
      {showAbout && (
        <AboutSheet
          onClose={() => setShowAbout(false)}
          onPlayFree={onPlayFree}
          isDesktop={isDesktop}
        />
      )}
    </>
  );
}
