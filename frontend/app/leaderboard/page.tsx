"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useIsMobile } from "@/hooks/useIsMobile";
import BottomNav from "@/components/BottomNav";
import MobileStreakChip from "@/components/MobileStreakChip";
import { useChallenge } from "@/components/ChallengeBanner";
import { HabitatChip } from "@/components/HabitatChip";
import { fetchLeaderboard, fetchAllTimeLeaderboard, fetchPlayerAllTimeCombinedStats, type AllTimeEntry } from "@/lib/subgraph";

// ─── Splash icons ──────────────────────────────────────────────────────────────
const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";
const V = "/splash_screen_icons/vending.png";

// Desktop decoratives — curated 3+3 at the edges. Matches home/games.
// Hidden on mobile via `.icon-float--desktop`.
const LEFT_ICONS = [
  { src: D, top: "2%", left: "-22px", size: 110, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18, opacity: 0.8 },
  { src: J, top: "48%", left: "-14px", size: 90, delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8, opacity: 0.65 },
  { src: G, top: "82%", left: "-10px", size: 100, delay: 2.8, dur: 5.0, glow: "#aa88ff", rotate: -14, opacity: 0.7 },
];
const RIGHT_ICONS = [
  { src: D, top: "4%", right: "-24px", size: 100, delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20, opacity: 0.75 },
  { src: V, top: "44%", right: "-8px", size: 105, delay: 2.0, dur: 6.2, glow: "#ff44cc", rotate: -4, opacity: 0.65 },
  { src: M, top: "80%", right: "-6px", size: 86, delay: 0.6, dur: 4.0, glow: "#ffaa00", rotate: -16, opacity: 0.7 },
];

// Mobile decoratives — 3+3 smaller at viewport edges. Podium art is the
// hero, so icons are pushed past the edge and half-visible, reading as
// atmosphere rather than competing elements. Hidden on desktop via CSS.
type MobileIcon = {
  src: string;
  top: string;
  left?: string;
  right?: string;
  size: number;
  delay: number;
  dur: number;
  glow: string;
  rotate: number;
  opacity: number;
};
const MOBILE_LEFT_ICONS: MobileIcon[] = [
  { src: D, top: "6%", left: "-24px", size: 60, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18, opacity: 0.45 },
  { src: J, top: "48%", left: "-22px", size: 54, delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8, opacity: 0.4 },
  { src: G, top: "84%", left: "-18px", size: 58, delay: 2.8, dur: 5.0, glow: "#aa88ff", rotate: -14, opacity: 0.4 },
];
const MOBILE_RIGHT_ICONS: MobileIcon[] = [
  { src: D, top: "10%", right: "-26px", size: 58, delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20, opacity: 0.45 },
  { src: V, top: "52%", right: "-20px", size: 62, delay: 2.0, dur: 6.2, glow: "#ff44cc", rotate: -4, opacity: 0.4 },
  { src: M, top: "86%", right: "-18px", size: 52, delay: 0.6, dur: 4.0, glow: "#ffaa00", rotate: -16, opacity: 0.45 },
];

const NAV_ITEMS = [
  { label: "Home", path: "/home", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg> },
  { label: "Games", path: "/games", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3a1 1 0 00-1 1v10a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zm-10 7H9v2H7v-2H5v-2h2V9h2v2h2v2zm4.5 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-3a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" /></svg> },
  { label: "Leaderboard", path: "/leaderboard", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21H5a2 2 0 01-2-2v-7a2 2 0 012-2h6v11zm2 0V6a2 2 0 012-2h4a2 2 0 012 2v13h-8z" /></svg> },
  { label: "Profile", path: "/profile", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" /></svg> },
];

const TABS = [
  { id: "rankings", label: "WEEKLY",    mobileLabel: "WEEKLY",   wallColor: "#083a6b", faceGrad: "linear-gradient(180deg, #60a5fa 0%, #2563eb 50%, #1e40af 100%)", glow: "rgba(59,130,246,0.7)" },
  { id: "alltime",  label: "ALL-TIME",  mobileLabel: "ALL-TIME", wallColor: "#083a6b", faceGrad: "linear-gradient(180deg, #60a5fa 0%, #2563eb 50%, #1e40af 100%)", glow: "rgba(59,130,246,0.7)" },
  { id: "seasons",  label: "SEASONS",   mobileLabel: "SEASONS",  wallColor: "#083a6b", faceGrad: "linear-gradient(180deg, #60a5fa 0%, #2563eb 50%, #1e40af 100%)", glow: "rgba(59,130,246,0.7)" },
  { id: "pvp",      label: "PVP ARENA", mobileLabel: "PVP",      wallColor: "#083a6b", faceGrad: "linear-gradient(180deg, #60a5fa 0%, #2563eb 50%, #1e40af 100%)", glow: "rgba(59,130,246,0.7)" },
];

const GAME_TABS = [
  { id: "rhythm", label: "RHYTHM_RUSH", accent: "#c026d3" },
  { id: "simon", label: "SIMON_MEMORY", accent: "#06b6d4" },
];

// Tier pyramid — elite tiers stay rare (like LoL: <1% Master, ~3% Diamond).
//   #1       → MASTER    (the king)
//   #2-3     → DIAMOND   (podium runners-up)
//   #4-6     → PLATINUM  (elite competitive)
//   #7-15    → GOLD      (solid regulars)
//   #16-50   → SILVER    (active players)
//   #51+     → BRONZE    (everyone else)
function rowColorByRank(rank: number): string {
  if (rank === 1) return "#f472b6"; // MASTER
  if (rank <= 3) return "#a78bfa"; // DIAMOND
  if (rank <= 6) return "#67e8f9"; // PLATINUM
  if (rank <= 15) return "#fbbf24"; // GOLD
  if (rank <= 50) return "#c0c0c0"; // SILVER
  return "#cd7f32";                    // BRONZE
}

function tierLabelByRank(rank: number): string {
  if (rank === 1) return "MASTER I";
  if (rank <= 3) return `DIAMOND ${rank === 2 ? "I" : "II"}`;
  if (rank <= 6) return `PLATINUM ${rank === 4 ? "I" : rank === 5 ? "II" : "III"}`;
  if (rank <= 15) return `GOLD ${rank <= 9 ? "I" : rank <= 12 ? "II" : "III"}`;
  if (rank <= 50) return `SILVER ${rank <= 25 ? "I" : rank <= 38 ? "II" : "III"}`;
  if (rank <= 200) return `BRONZE ${rank <= 100 ? "I" : "II"}`;
  return "BRONZE III";
}

type Entry = { player: string; username?: string; score: number; timestamp: number; streak?: number };

// /api/seasons response
type PastSeason = {
  season: number;
  startTs: number;
  endTs: number;
  prizePot: number;
  sealedAt: number;
  totalPlayers?: number;
  rhythm: Entry[];
  simon: Entry[];
};
type SeasonsData = {
  currentSeason: number;
  currentEndsAt: number;
  live: { rhythm: Entry[]; simon: Entry[] };
  past: PastSeason[];
};

// /api/competition response
type CompRanking = { wallet: string; username: string | null; total: number; totalRhythm: number; totalSimon: number };
type CompetitionData = {
  weeks: number[];
  prizes: { first: number; second: number; third: number };
  compEnd: number;
  weeksLeft: number;
  currentWeek: number;
  rankings: CompRanking[];
};

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

function fmtName(addr: string, username?: string | null) {
  if (username) return username;
  return `${addr.slice(0, 4)}...${addr.slice(-3)}`;
}
function avatarUrl(address: string, username?: string | null) {
  // Always seed with BOTH username and address — guarantees uniqueness per wallet.
  const seed = `${username || ""}-${address}`;
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&backgroundColor=ffdfbf,ffd5dc,c0aede,b6e3f4,d1d4f9,fbbf24,f97316,c026d3`;
}

// ─── Juicy Pill Tab ────────────────────────────────────────────────────────────
function PillTab({
  label, active, wallColor, faceGrad, glow, onClick, compact = false,
}: {
  label: string; active: boolean; wallColor: string; faceGrad: string;
  glow: string; onClick: () => void;
  // compact: mobile shrinks padding, font, shadow spread. The default
  // shadow blooms ~40px past the pill — on a 390px viewport that caused
  // the active pill's glow to bleed off-screen.
  compact?: boolean;
}) {
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      style={{ cursor: "pointer", userSelect: "none", transition: "transform 0.15s" }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.95) translateY(3px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{
        borderRadius: "999px",
        background: active ? wallColor : "#1a0550",
        paddingBottom: compact ? "4px" : "5px",
        boxShadow: active
          ? compact
            ? `0 0 0 1.5px #3b82f6, 0 0 12px ${glow}, 0 6px 16px -4px ${glow}`
            : `0 0 0 2px #3b82f6, 0 0 20px ${glow}, 0 0 40px ${glow}, 0 10px 24px -4px ${glow}`
          : "0 6px 16px -4px rgba(0,0,0,0.5)",
        transition: "all 0.2s",
      }}>
        <div style={{
          borderRadius: "999px",
          background: active ? faceGrad : "linear-gradient(180deg, #3b1fa3 0%, #1e0762 100%)",
          padding: compact ? "7px 14px" : "10px 22px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
          border: active ? "2px solid rgba(255,255,255,0.5)" : "2px solid rgba(255,255,255,0.12)",
          boxShadow: active
            ? "inset 0 6px 14px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.35)"
            : "inset 0 3px 8px rgba(255,255,255,0.06), inset 0 -2px 5px rgba(0,0,0,0.35)",
        }}>
          {/* Gloss crescent */}
          {active && (
            <div style={{
              position: "absolute", top: "2px", left: "6%", right: "6%", height: "46%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)",
              borderRadius: "999px", pointerEvents: "none",
            }} />
          )}
          <span style={{
            position: "relative", zIndex: 1,
            color: active ? "white" : "rgba(220,200,255,0.6)",
            fontSize: compact ? "11px" : "13px",
            fontWeight: 900, letterSpacing: "0.08em",
            textShadow: active ? "0 2px 4px rgba(0,0,0,0.4)" : "none",
            whiteSpace: "nowrap",
          }}>{label}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Confetti sparkle particles ────────────────────────────────────────────────
const CONFETTI = [
  { left: "8%", top: "25%", color: "#f9a8d4", size: 10, shape: "star", dur: 3.5, delay: 0.0 },
  { left: "15%", top: "60%", color: "#fbbf24", size: 12, shape: "triangle", dur: 4.2, delay: 0.5 },
  { left: "22%", top: "20%", color: "#22d3ee", size: 8, shape: "dot", dur: 3.0, delay: 1.0 },
  { left: "30%", top: "45%", color: "#fb923c", size: 11, shape: "note", dur: 4.8, delay: 1.5 },
  { left: "38%", top: "15%", color: "#e879f9", size: 9, shape: "star", dur: 3.2, delay: 0.3 },
  { left: "48%", top: "35%", color: "#fde68a", size: 13, shape: "sparkle", dur: 4.0, delay: 0.8 },
  { left: "58%", top: "18%", color: "#60a5fa", size: 10, shape: "triangle", dur: 3.6, delay: 1.3 },
  { left: "68%", top: "50%", color: "#f472b6", size: 11, shape: "star", dur: 4.5, delay: 0.2 },
  { left: "78%", top: "28%", color: "#34d399", size: 9, shape: "dot", dur: 3.3, delay: 1.1 },
  { left: "86%", top: "55%", color: "#c084fc", size: 12, shape: "note", dur: 4.1, delay: 0.7 },
  { left: "92%", top: "22%", color: "#fbbf24", size: 10, shape: "sparkle", dur: 3.9, delay: 1.6 },
  { left: "10%", top: "40%", color: "#22d3ee", size: 11, shape: "triangle", dur: 4.3, delay: 1.8 },
];

function ConfettiParticle({ p }: { p: typeof CONFETTI[number] }) {
  const base = {
    position: "absolute" as const,
    left: p.left, top: p.top,
    width: p.size, height: p.size,
    animation: `icon-float ${p.dur}s ease-in-out ${p.delay}s infinite`,
    pointerEvents: "none" as const,
    filter: `drop-shadow(0 0 6px ${p.color})`,
  };
  if (p.shape === "dot") return <div style={{ ...base, background: p.color, borderRadius: "50%" }} />;
  if (p.shape === "triangle") return (
    <div style={{ ...base, width: 0, height: 0, borderLeft: `${p.size / 2}px solid transparent`, borderRight: `${p.size / 2}px solid transparent`, borderBottom: `${p.size}px solid ${p.color}`, background: "transparent" }} />
  );
  if (p.shape === "note") return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>♪</div>;
  if (p.shape === "sparkle") return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>✦</div>;
  return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>★</div>;
}

// ─── Stage Podium (podium.png background + 3 character PNGs on top) ────────────
function StagePodium({ podium }: { podium: Entry[] }) {
  const first = podium[0];
  const second = podium[1];
  const third = podium[2];

  // LOCKED — character placements tuned to podium.png (1536x1024). Don't change
  // unless you also regenerate the podium image with different pedestal positions.
  const placements = [
    { char: "/characters/char1.png", entry: first, color: "#fbbf24", rank: 1, widthPct: 18, bottomPct: 38, leftPct: 50, z: 3 },
    { char: "/characters/char2.png", entry: second, color: "#e2e8f0", rank: 2, widthPct: 16, bottomPct: 33, leftPct: 32, z: 2 },
    { char: "/characters/char3.png", entry: third, color: "#f97316", rank: 3, widthPct: 16, bottomPct: 32, leftPct: 67, z: 2 },
  ];

  return (
    <div style={{
      position: "relative",
      width: "100%", maxWidth: "620px",
      aspectRatio: "3 / 2",
      margin: "0 auto",
    }}>
      {/* Podium background */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/characters/podium.png"
        alt="podium"
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "contain",
          filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.6))",
          zIndex: 1,
        }}
      />

      {/* Floating confetti sparkles */}
      {CONFETTI.map((p, i) => <ConfettiParticle key={i} p={p} />)}

      {/* Characters */}
      {placements.map((pl) => (
        <div key={pl.rank} style={{
          position: "absolute",
          left: `${pl.leftPct}%`,
          bottom: `${pl.bottomPct}%`,
          transform: "translateX(-50%)",
          width: `${pl.widthPct}%`,
          zIndex: pl.z,
          display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pl.char}
            alt={`rank ${pl.rank}`}
            style={{
              width: "100%", height: "auto",
              objectFit: "contain",
              filter: `drop-shadow(0 4px 8px rgba(0,0,0,0.5)) drop-shadow(0 0 14px ${pl.color}55)`,
            }}
          />
        </div>
      ))}

      {/* Name + score labels — placed just above the character's head */}
      {placements.map((pl) => {
        // Character portrait is 2:3 so visible height = widthPct * 1.5 (as % of container width).
        // Container is 3:2 so 1% of container height = 1.5% of container width.
        // Character height as % of container height = widthPct * 1.5 / 1.5 * 1.5 = widthPct * 1.5.
        // Actually: height_in_px = widthPct/100 * W * 1.5;  height_pct_of_H = (widthPct/100 * W * 1.5) / (W * 2/3) * 100 = widthPct * 2.25
        const charHeightPct = pl.widthPct * 2.25;
        const labelBottom = pl.bottomPct + charHeightPct + 1;
        return (
          <div key={`label-${pl.rank}`} style={{
            position: "absolute",
            left: `${pl.leftPct}%`,
            bottom: `${labelBottom}%`,
            transform: "translateX(-50%)",
            textAlign: "center",
            zIndex: 4,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}>
            <div style={{
              color: "white", fontSize: "12px", fontWeight: 900,
              letterSpacing: "0.04em",
              textShadow: `0 0 10px ${pl.color}dd, 0 2px 4px rgba(0,0,0,0.8)`,
            }}>
              {pl.entry ? fmtName(pl.entry.player, pl.entry.username) : "—"}
            </div>
            <div style={{
              color: pl.color, fontSize: "13px", fontWeight: 900,
              textShadow: `0 0 14px ${pl.color}, 0 2px 4px rgba(0,0,0,0.8)`,
              marginTop: "2px",
            }}>
              {pl.entry ? pl.entry.score : 0}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Player Row (neon bordered pill) ───────────────────────────────────────────
// Compact number formatter for the breakdown chip. Below 10k stays exact
// because Simon scores live in single digits to low hundreds and need to
// be readable as-is. Above 10k collapses to "Xk" so a long Rhythm score
// doesn't push the row off-screen.
function fmtCompact(n: number): string {
  if (n < 10000) return n.toLocaleString();
  return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}k`;
}

function PlayerRow({
  entry, rank, color, isMe, breakdown,
}: {
  entry: Entry;
  rank: number;
  color: string;
  isMe: boolean;
  // Optional R/S split for the ALL-TIME tab. Renders a small line under
  // the total so players can read "this player is rhythm-heavy" at a glance.
  breakdown?: { rhythm: number; simon: number };
}) {
  return (
    <div style={{
      borderRadius: "999px",
      padding: "2.5px",
      background: `linear-gradient(135deg, ${color} 0%, ${color}77 100%)`,
      boxShadow: `0 0 14px ${color}66, 0 0 28px ${color}33, 0 8px 18px rgba(0,0,0,0.6)`,
    }}>
      <div style={{
        borderRadius: "999px",
        background: isMe
          ? `linear-gradient(90deg, ${color}26 0%, rgba(20,10,50,0.9) 100%)`
          : "linear-gradient(90deg, rgba(20,10,50,0.92) 0%, rgba(10,5,30,0.95) 100%)",
        padding: "8px 14px 8px 10px",
        display: "flex", alignItems: "center", gap: "10px",
        position: "relative", overflow: "hidden",
      }}>
        {/* Rank */}
        <div style={{
          minWidth: "22px", textAlign: "center",
          color: color, fontSize: "15px", fontWeight: 900,
          textShadow: `0 0 10px ${color}`,
        }}>{rank}</div>
        {/* Avatar — DiceBear personas face */}
        <div style={{
          width: "34px", height: "34px", borderRadius: "50%",
          border: `2px solid ${color}aa`,
          boxShadow: `0 0 8px ${color}77`,
          flexShrink: 0, overflow: "hidden",
          background: "#1a0550",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl(entry.player, entry.username)}
            alt=""
            width={34}
            height={34}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
        {/* Name + tier subtitle (Wild Rift style — tier explicit under the name) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <HabitatChip address={entry.player} size={18} />
            <div style={{
              color: isMe ? color : "white",
              fontSize: "12px", fontWeight: 800, lineHeight: 1.15,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              minWidth: 0, flex: 1,
            }}>
              {isMe ? "YOU" : fmtName(entry.player, entry.username)}
            </div>
          </div>
          <div style={{
            color: color, fontSize: "8.5px", fontWeight: 800,
            letterSpacing: "0.1em", marginTop: "1px",
            textShadow: `0 0 6px ${color}88`,
          }}>
            {tierLabelByRank(rank)}
          </div>
        </div>
        {/* Streak flex chip — shown after at least one return (>= 2 days) */}
        {entry.streak && entry.streak >= 2 && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "3px",
            padding: "2px 7px", borderRadius: "999px",
            background: "rgba(249,115,22,0.15)",
            border: "1px solid rgba(249,115,22,0.5)",
            boxShadow: "0 0 8px rgba(249,115,22,0.35)",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: "10px" }}>🔥</span>
            <span style={{ color: "#fbbf24", fontSize: "10px", fontWeight: 900, textShadow: "0 0 6px rgba(251,191,36,0.6)" }}>{entry.streak}</span>
          </div>
        )}
        {/* Score (with optional R/S breakdown for ALL-TIME) */}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{
            color: "#fbbf24", fontSize: "11px", fontWeight: 900,
            letterSpacing: "0.12em",
            textShadow: "0 0 10px rgba(251,191,36,0.7)",
          }}>
            {entry.score.toLocaleString()}
          </div>
          {breakdown && (
            <div style={{
              color: "rgba(254,215,170,0.6)",
              fontSize: "8px", fontWeight: 800,
              letterSpacing: "0.06em",
              marginTop: "2px",
              fontFeatureSettings: '"tnum" 1',
            }}>
              R {fmtCompact(breakdown.rhythm)} · S {fmtCompact(breakdown.simon)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
function LeaderboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address } = useAccount();
  // Mobile swaps the 68px left sidebar for a fixed bottom tab bar.
  const isMobile = useIsMobile();
  // Deep-link support: ?tab=seasons routes from the Games page 3-Week
  // Cup event card directly to the Seasons tab where the Cup rankings
  // live. Before this, the event card always landed on Rankings, which
  // is a different leaderboard entirely.
  const initialTab = (() => {
    const t = searchParams.get("tab");
    if (t === "seasons" || t === "pvp" || t === "alltime") return t;
    return "rankings";
  })();
  const [activeTab, setActiveTab] = useState<"rankings" | "alltime" | "seasons" | "pvp">(initialTab);
  const [gameTab, setGameTab] = useState<"rhythm" | "simon">("rhythm");

  // 72-hour Arena Cup — shared hook returns null outside the event window,
  // so the banner below only renders while the challenge is live.
  const challenge = useChallenge(address);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [streak, setStreak] = useState<{ streak: number; playedToday: boolean } | null>(null);

  useEffect(() => {
    if (!address) { setStreak(null); return; }
    fetch(`${BACKEND_URL}/api/streak/${address}`)
      .then(r => r.json())
      .then(d => setStreak({ streak: d.streak || 0, playedToday: !!d.playedToday }))
      .catch(() => setStreak(null));
  }, [address]);

  // Weekly community challenge — shown in the EVENTS section alongside
  // 72-hr cups and the 3-week competition so players see it in context.
  const [weeklyChallengeLB, setWeeklyChallengeLB] = useState<{
    target: number; progress: number; playersIn: number;
    hit: boolean; daysLeft: number; rewardG: number; ubiG: number;
    capPerPlayer: number; myContribution: number | null; windowEnd: string;
  } | null>(null);

  // Seasons + competition data (for SEASONS tab)
  const [seasonsData, setSeasonsData] = useState<SeasonsData | null>(null);
  const [competition, setCompetition] = useState<CompetitionData | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<PastSeason | null>(null);
  // Past hosted challenges (72-hr Arena Cup and future short-burst events).
  // Each row is a frozen snapshot written at event end, immutable. Rendered
  // alongside past seasons in the Seasons tab so players see every past
  // competition we've run in one place.
  type PastChallenge = {
    id: string;
    name: string;
    starts_at: string;
    ends_at: string;
    min_plays: number;
    top_n: number;
    prize_usdc: number;
    winners: { rank: number; wallet: string; username: string | null; plays: number }[];
  };
  type PastCompetition = {
    id: string;
    name: string;
    starts_at: string;
    ends_at: string;
    weeks: number[];
    prizes: { first: number; second: number; third: number };
    winners: { rank: number; wallet: string; username: string | null; total: number; totalRhythm: number; totalSimon: number }[];
  };
  type SelectedEvent =
    | { type: "challenge"; data: PastChallenge }
    | { type: "competition"; data: PastCompetition };
  const [pastChallenges, setPastChallenges] = useState<PastChallenge[]>([]);
  const [pastCompetitions, setPastCompetitions] = useState<PastCompetition[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  useEffect(() => {
    if (activeTab !== "seasons") return;
    fetch(`${BACKEND_URL}/api/seasons`).then(r => r.json()).then(setSeasonsData).catch(() => setSeasonsData(null));
    fetch(`${BACKEND_URL}/api/competition`).then(r => r.json()).then(setCompetition).catch(() => setCompetition(null));
    fetch(`${BACKEND_URL}/api/challenges/past`)
      .then(r => r.json())
      .then(d => setPastChallenges(d.challenges || []))
      .catch(() => setPastChallenges([]));
    fetch(`${BACKEND_URL}/api/competition/past`)
      .then(r => r.json())
      .then(d => setPastCompetitions(d.competitions || []))
      .catch(() => setPastCompetitions([]));
    const wUrl = address
      ? `${BACKEND_URL}/api/weekly-challenge?wallet=${address}`
      : `${BACKEND_URL}/api/weekly-challenge`;
    fetch(wUrl).then(r => r.json()).then(setWeeklyChallengeLB).catch(() => {});
  }, [activeTab, address]);

  // Live countdown to season end (refreshes every second)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (activeTab !== "seasons") return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [activeTab]);
  function formatCountdown(secondsLeft: number) {
    if (secondsLeft <= 0) return "ENDED";
    const d = Math.floor(secondsLeft / 86400);
    const h = Math.floor((secondsLeft % 86400) / 3600);
    const m = Math.floor((secondsLeft % 3600) / 60);
    const s = secondsLeft % 60;
    if (d > 0) return `${d}D ${h}H ${m}M`;
    if (h > 0) return `${h}H ${m}M ${s}S`;
    return `${m}M ${s}S`;
  }

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      // Match the backend's season math exactly so the leaderboard rolls
      // over the moment a new season starts, not 7 days later. Backend uses
      // SEASON_EPOCH = 1770249600 with 7-day weeks; we mirror it here.
      const SEASON_EPOCH = 1770249600;
      const WEEK_SECONDS = 7 * 86400;
      const nowSec = Math.floor(Date.now() / 1000);
      const elapsed = nowSec - SEASON_EPOCH;
      const seasonNumber = Math.floor(elapsed / WEEK_SECONDS) + 1;
      const seasonStart = SEASON_EPOCH + (seasonNumber - 1) * WEEK_SECONDS;
      const gameType = gameTab === "rhythm" ? 0 : 1;
      const fetched = await fetchLeaderboard(gameType, seasonStart, 20);
      setEntries(fetched);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [gameTab]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // All-time combined leaderboard — best rhythm + best simon per player.
  // ONE global ranking, no game split. Players see their forever standing
  // overall instead of a per-game peak. Fetches lazily on tab activation.
  // Pulls a wide window (500) so client-side pagination has headroom even
  // as the population grows. Page size of 16 (even) so the 2-column grid
  // on desktop fills cleanly (8 + 8) — odd page sizes left an orphan row
  // at the bottom of every page. The orphan only appears now on the last
  // page when total entries aren't divisible by 16, which is expected.
  const ALL_TIME_PAGE_SIZE = 16;
  // AllTimeEntry extends Entry with bestRhythm + bestSimon so PlayerRow's
  // breakdown chip ("R 290k · S 768") can render under the total score.
  const [allTimeEntries, setAllTimeEntries] = useState<AllTimeEntry[]>([]);
  const [allTimeLoading, setAllTimeLoading] = useState(false);
  const [allTimePage, setAllTimePage] = useState(0);
  const fetchAllTime = useCallback(async () => {
    setAllTimeLoading(true);
    try {
      const fetched = await fetchAllTimeLeaderboard(500);
      setAllTimeEntries(fetched);
    } catch {
      setAllTimeEntries([]);
    } finally {
      setAllTimeLoading(false);
    }
  }, []);
  useEffect(() => {
    if (activeTab === "alltime") fetchAllTime();
  }, [activeTab, fetchAllTime]);

  // Reset to page 1 whenever the player switches into the ALL-TIME tab so
  // the experience always opens at the top of the board.
  useEffect(() => {
    if (activeTab === "alltime") setAllTimePage(0);
  }, [activeTab]);

  // Player's own all-time combined rank + peak — used by the sticky
  // "Your rank" chip that's ALWAYS visible regardless of which page is
  // currently showing. Computed from the fetched window when possible
  // (cheap), falls back to a dedicated subgraph query for players outside
  // the 500-entry fetch window.
  const [myAllTime, setMyAllTime] = useState<{ rank: number; peak: number } | null>(null);
  useEffect(() => {
    if (activeTab !== "alltime" || !address) { setMyAllTime(null); return; }
    const idx = allTimeEntries.findIndex(e => e.player.toLowerCase() === address.toLowerCase());
    if (idx >= 0) {
      setMyAllTime({ rank: idx + 1, peak: allTimeEntries[idx].score });
      return;
    }
    fetchPlayerAllTimeCombinedStats(address).then(s => {
      if (s) setMyAllTime({ rank: s.rank, peak: s.peak });
    });
  }, [activeTab, address, allTimeEntries]);

  // Pagination math — the top 3 (podium) stay visible on every page so
  // the "champions" you're chasing are always in view. Pagination only
  // applies to ranks 4+ in the grid below the podium.
  const allTimePodium = allTimeEntries.slice(0, 3);
  const allTimeRestEntries = allTimeEntries.slice(3);
  const allTimeTotalPages = Math.max(1, Math.ceil(allTimeRestEntries.length / ALL_TIME_PAGE_SIZE));
  const allTimePageEntries = allTimeRestEntries.slice(
    allTimePage * ALL_TIME_PAGE_SIZE,
    (allTimePage + 1) * ALL_TIME_PAGE_SIZE,
  );
  // myAllTimePage = which page the player's row lives on (-1 if podium or none)
  const myAllTimePage = myAllTime
    ? (myAllTime.rank <= 3 ? -1 : Math.floor((myAllTime.rank - 4) / ALL_TIME_PAGE_SIZE))
    : -1;

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3, 13);

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "radial-gradient(ellipse 80% 60% at 50% 15%, #6a18c8 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Floating icons — split by breakpoint via CSS. No SSR flash. */}
      {LEFT_ICONS.map((ic, i) => (
        <div key={`l${i}`} className="icon-float icon-float--desktop" style={{
          position: "absolute", top: ic.top, left: ic.left, width: ic.size, height: ic.size,
          transform: `rotate(${ic.rotate}deg)`, filter: `drop-shadow(0 0 8px ${ic.glow}77)`,
          opacity: ic.opacity,
          ["--dur" as string]: `${ic.dur}s`, ["--delay" as string]: `${ic.delay}s`,
          userSelect: "none", pointerEvents: "none", zIndex: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ic.src} alt="" width={ic.size} height={ic.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}
      {RIGHT_ICONS.map((ic, i) => (
        <div key={`r${i}`} className="icon-float icon-float--desktop" style={{
          position: "absolute", top: ic.top, right: ic.right, width: ic.size, height: ic.size,
          transform: `rotate(${ic.rotate}deg)`, filter: `drop-shadow(0 0 8px ${ic.glow}77)`,
          opacity: ic.opacity,
          ["--dur" as string]: `${ic.dur}s`, ["--delay" as string]: `${ic.delay}s`,
          userSelect: "none", pointerEvents: "none", zIndex: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ic.src} alt="" width={ic.size} height={ic.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}
      {MOBILE_LEFT_ICONS.map((ic, i) => (
        <div key={`ml${i}`} className="icon-float icon-float--mobile" style={{
          position: "absolute", top: ic.top, left: ic.left, width: ic.size, height: ic.size,
          transform: `rotate(${ic.rotate}deg)`, filter: `drop-shadow(0 0 6px ${ic.glow}55)`,
          opacity: ic.opacity,
          ["--dur" as string]: `${ic.dur}s`, ["--delay" as string]: `${ic.delay}s`,
          userSelect: "none", pointerEvents: "none", zIndex: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ic.src} alt="" width={ic.size} height={ic.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}
      {MOBILE_RIGHT_ICONS.map((ic, i) => (
        <div key={`mr${i}`} className="icon-float icon-float--mobile" style={{
          position: "absolute", top: ic.top, right: ic.right, width: ic.size, height: ic.size,
          transform: `rotate(${ic.rotate}deg)`, filter: `drop-shadow(0 0 6px ${ic.glow}55)`,
          opacity: ic.opacity,
          ["--dur" as string]: `${ic.dur}s`, ["--delay" as string]: `${ic.delay}s`,
          userSelect: "none", pointerEvents: "none", zIndex: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ic.src} alt="" width={ic.size} height={ic.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}

      {/* Body row: sidebar + center */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative", zIndex: 2 }}>

        {/* Sidebar — desktop only; mobile uses BottomNav below */}
        {!isMobile && <div style={{
          width: "68px", flexShrink: 0, alignSelf: "stretch",
          background: "rgba(4,1,18,0.95)", borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "16px 0", gap: "6px",
        }}>
          {/* Streak chip — played today warm orange, not played today FROZEN
              (blue flame via hue-rotate + cyan glow). Same chip across
              profile / games / leaderboard. */}
          {address && streak && streak.streak > 0 && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: "1px",
              padding: "7px 6px", borderRadius: "12px",
              background: streak.playedToday
                ? "linear-gradient(180deg, #7c2d00 0%, #3f1300 100%)"
                : "linear-gradient(180deg, #0c2742 0%, #041022 100%)",
              border: `2px solid ${streak.playedToday ? "#f97316" : "#38bdf8"}`,
              boxShadow: streak.playedToday
                ? "0 0 14px rgba(249,115,22,0.7), 0 0 28px rgba(249,115,22,0.3), inset 0 1px 0 rgba(255,255,255,0.15)"
                : "0 0 10px rgba(56,189,248,0.45), 0 0 22px rgba(56,189,248,0.15), inset 0 1px 0 rgba(186,230,253,0.15)",
              minWidth: "46px",
            }}>
              <span style={{
                fontSize: "16px", lineHeight: 1,
                filter: streak.playedToday
                  ? "drop-shadow(0 0 6px rgba(249,115,22,0.9))"
                  : "hue-rotate(190deg) saturate(1.3) brightness(0.95) drop-shadow(0 0 4px rgba(56,189,248,0.7))",
              }}>🔥</span>
              <span style={{
                color: streak.playedToday ? "#fbbf24" : "#bae6fd",
                fontSize: "13px", fontWeight: 900, lineHeight: 1.1,
                textShadow: streak.playedToday
                  ? "0 0 8px rgba(251,191,36,0.7)"
                  : "0 0 6px rgba(56,189,248,0.6)",
              }}>{streak.streak}</span>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {NAV_ITEMS.map(item => {
            const active = item.path === "/leaderboard";
            return (
              <button key={item.path} onClick={() => router.push(item.path)} style={{
                width: "54px", borderRadius: "12px", padding: "8px 4px 6px",
                background: active ? "rgba(255,255,255,0.18)" : "transparent", border: "none",
                color: active ? "white" : "rgba(255,255,255,0.55)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
                cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                boxShadow: active ? "0 0 0 1px rgba(255,255,255,0.15), 0 4px 12px rgba(0,0,0,0.4)" : "none",
              }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.55)"; }}
              >
                {item.icon}
                <span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em" }}>{item.label.toUpperCase()}</span>
              </button>
            );
          })}

          <div style={{ flex: 1 }} />
        </div>}

        {/* Center */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center",
            // Top padding on mobile needs to clear the active tab's glow
            // shadow (~20px) or the pill clips against the viewport edge.
            // Extra bottom padding clears the fixed BottomNav.
            padding: isMobile ? "24px 14px 96px" : "18px 16px 20px",
            gap: "14px", overflowY: "auto",
          }}>

            {/* Cup banner intentionally NOT rendered at the top of the
                leaderboard. The full live participation card lives inside
                the Seasons tab below, alongside the 3-Week Cup and past
                events. Two surfaces for the same event would split focus
                and double-count attention; leaderboard is the data home,
                /games and /home stay the urgency surfaces. */}

            {/* Juicy pill tabs — compact on mobile, with horizontal scroll
                fallback so 4 tabs never get clipped on narrow viewports.
                Mobile labels shorten where useful (PVP ARENA → PVP) so we
                rarely have to scroll, but the scroll is there as a safety
                net for any future tab additions. */}
            <div
              className="hide-scrollbar"
              style={{
                display: "flex", gap: isMobile ? "6px" : "10px",
                flexShrink: 0,
                overflowX: "auto",
                overflowY: "hidden",
                WebkitOverflowScrolling: "touch",
                // Padding prevents the active tab's glow from being clipped
                // by the scroll container's edges.
                padding: "4px 2px",
                margin: "-4px -2px",
              }}
            >
              {TABS.map(t => (
                <PillTab
                  key={t.id}
                  label={isMobile ? t.mobileLabel : t.label}
                  active={activeTab === t.id}
                  wallColor={t.wallColor}
                  faceGrad={t.faceGrad}
                  glow={t.glow}
                  compact={isMobile}
                  onClick={() => setActiveTab(t.id as typeof activeTab)}
                />
              ))}
            </div>

            {/* Game sub-tabs — stronger fill/border on mobile so the
                active state reads as a real selection, not a ghost.
                Hidden on ALL-TIME because that view combines both games
                (best rhythm + best simon) into one global ranking. */}
            {activeTab !== "pvp" && activeTab !== "alltime" && (
              <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                {GAME_TABS.map(t => {
                  const active = gameTab === t.id;
                  return (
                    <button key={t.id} onClick={() => setGameTab(t.id as typeof gameTab)} style={{
                      padding: isMobile ? "7px 16px" : "6px 14px",
                      borderRadius: "999px", fontFamily: "inherit",
                      background: active
                        ? `linear-gradient(180deg, ${t.accent}55 0%, ${t.accent}22 100%)`
                        : "rgba(255,255,255,0.04)",
                      border: `1.5px solid ${active ? t.accent : "rgba(255,255,255,0.14)"}`,
                      color: active ? "white" : "rgba(200,180,255,0.65)",
                      fontSize: isMobile ? "11px" : "10px",
                      fontWeight: 800, letterSpacing: "0.1em",
                      cursor: "pointer", transition: "all 0.15s",
                      boxShadow: active
                        ? `0 0 18px ${t.accent}77, inset 0 1px 0 rgba(255,255,255,0.15)`
                        : "none",
                      textShadow: active ? `0 0 10px ${t.accent}` : "none",
                    }}>{t.label}</button>
                  );
                })}
              </div>
            )}

            {/* RANKINGS — Podium + rows */}
            {activeTab === "rankings" && (
              <>
                {loading ? (
                  <div style={{ padding: "60px", color: "rgba(200,180,255,0.5)", fontSize: "11px", letterSpacing: "0.15em" }}>LOADING...</div>
                ) : entries.length === 0 ? (
                  <div style={{
                    width: "100%", maxWidth: "440px",
                    margin: "20px auto",
                    padding: "32px 24px",
                    borderRadius: "20px",
                    background: "linear-gradient(180deg, rgba(167,139,250,0.12) 0%, rgba(20,10,50,0.8) 100%)",
                    border: "1.5px solid rgba(167,139,250,0.4)",
                    boxShadow: "0 0 30px rgba(167,139,250,0.2), 0 12px 30px rgba(0,0,0,0.5)",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: "44px", marginBottom: "10px" }}>🏆</div>
                    <div style={{
                      color: "white", fontSize: "16px", fontWeight: 900, letterSpacing: "0.04em",
                      textShadow: "0 0 12px rgba(167,139,250,0.7)",
                    }}>
                      Be the first on the board
                    </div>
                    <div style={{
                      color: "rgba(200,180,255,0.75)", fontSize: "12px",
                      marginTop: "10px", lineHeight: 1.6,
                    }}>
                      No {gameTab === "rhythm" ? "Rhythm Rush" : "Simon Memory"} scores yet this week.
                      Play a round and your name lands on the leaderboard.
                    </div>
                    <button
                      onClick={() => router.push(`/games/${gameTab}`)}
                      style={{
                        marginTop: "18px",
                        padding: "11px 24px", borderRadius: "999px",
                        background: "linear-gradient(180deg, #c084fc 0%, #7c3aed 100%)",
                        border: "none",
                        color: "white", fontSize: "12px", fontWeight: 900, letterSpacing: "0.12em",
                        cursor: "pointer",
                        boxShadow: "0 0 20px rgba(124,58,237,0.5), 0 6px 14px rgba(0,0,0,0.4)",
                      }}
                    >
                      PLAY {gameTab === "rhythm" ? "RHYTHM" : "SIMON"} →
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Podium with character PNGs */}
                    <StagePodium podium={podium} />

                    {/* Rows grid — 1 column on mobile (each row reads
                        left-to-right as a full-width list item), 2 columns
                        from tablet up. The old fixed 2-col layout put
                        rank 4 next to rank 5 on a 360px phone, each
                        squeezed into ~168px, and the alternating pairs
                        felt like random clusters instead of a ranking.
                        A vertical stack is the universal leaderboard
                        pattern on mobile (PUBG, Clash Royale, Brawl
                        Stars) and lets each row breathe. */}
                    <div style={{
                      width: "100%", maxWidth: "720px",
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)",
                      gap: isMobile ? "8px" : "10px 14px",
                      marginTop: "4px",
                    }}>
                      {rest.map((e, i) => {
                        const rank = i + 4;
                        const color = rowColorByRank(rank);
                        const isMe = !!address && e.player.toLowerCase() === address.toLowerCase();
                        return <PlayerRow key={e.player} entry={e} rank={rank} color={color} isMe={isMe} />;
                      })}
                    </div>

                    {/* Player-not-on-board chip — when the connected wallet
                        has not posted a score this season they see no
                        familiar row on the list. Show a small CTA so they
                        know how to get on the board. Skipped if they're
                        already in `entries` (they have a row to find). */}
                    {address && !entries.find(e => e.player.toLowerCase() === address.toLowerCase()) && entries.length > 3 && (
                      <div style={{
                        width: "100%", maxWidth: "520px", marginTop: "12px",
                        padding: "12px 16px", borderRadius: "14px",
                        background: "rgba(167,139,250,0.1)",
                        border: "1px solid rgba(167,139,250,0.35)",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: "10px", flexWrap: "wrap",
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: "white", fontSize: "12px", fontWeight: 900, letterSpacing: "0.04em" }}>
                            You&apos;re not on the board yet
                          </div>
                          <div style={{ color: "rgba(200,180,255,0.7)", fontSize: "10.5px", marginTop: "2px" }}>
                            Play one round to claim your rank.
                          </div>
                        </div>
                        <button onClick={() => router.push(`/games/${gameTab}`)}
                          style={{
                            padding: "8px 16px", borderRadius: "999px",
                            background: "linear-gradient(180deg, #c084fc 0%, #7c3aed 100%)",
                            border: "none",
                            color: "white", fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em",
                            cursor: "pointer",
                            boxShadow: "0 0 14px rgba(124,58,237,0.5)",
                          }}>
                          PLAY ▸
                        </button>
                      </div>
                    )}

                    {/* Sparse-list empty state — instead of a huge void
                        below the podium when there are only 1-3 entries,
                        show a CTA card that fills the space and pushes
                        users to play. Top-game leaderboards never leave
                        this dead; they always drive the next action. */}
                    {entries.length <= 3 && (
                      <div style={{
                        width: "100%", maxWidth: "520px", marginTop: "12px",
                        borderRadius: "18px",
                        padding: "2.5px",
                        background: "linear-gradient(135deg, #fbbf24 0%, #f97316 50%, #c026d3 100%)",
                        boxShadow: "0 16px 36px -8px rgba(251,191,36,0.4), 0 0 40px rgba(192,38,211,0.25)",
                      }}>
                        <div style={{
                          borderRadius: "16px",
                          background: "linear-gradient(180deg, #1a0550 0%, #0a0230 100%)",
                          padding: "18px 18px 16px",
                          textAlign: "center",
                          border: "1.5px solid rgba(255,255,255,0.08)",
                        }}>
                          <div style={{ fontSize: "28px", marginBottom: "6px" }}>🏆</div>
                          <div style={{
                            color: "white", fontSize: "13px", fontWeight: 900,
                            letterSpacing: "0.08em", marginBottom: "4px",
                            textShadow: "0 0 14px rgba(251,191,36,0.6)",
                          }}>
                            FRESH LEADERBOARD
                          </div>
                          <div style={{
                            color: "rgba(200,170,255,0.75)", fontSize: "11px",
                            lineHeight: 1.5, marginBottom: "14px",
                          }}>
                            Only {entries.length} player{entries.length > 1 ? "s have" : " has"} posted a score this week. Play now to claim a spot on the podium before it fills up.
                          </div>
                          <div role="button" tabIndex={0}
                            onClick={() => router.push("/games")}
                            style={{ cursor: "pointer", userSelect: "none", display: "inline-block" }}
                            onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(2px)"; }}
                            onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
                          >
                            <div style={{
                              borderRadius: "12px",
                              background: "#7c2d00",
                              paddingBottom: "4px",
                              boxShadow: "0 8px 18px -4px rgba(251,191,36,0.6)",
                            }}>
                              <div style={{
                                borderRadius: "10px 10px 8px 8px",
                                background: "linear-gradient(160deg, #fde68a 0%, #f59e0b 50%, #b45309 100%)",
                                padding: "9px 26px",
                                border: "2px solid rgba(255,255,255,0.5)",
                                boxShadow: "inset 0 4px 10px rgba(255,255,255,0.6), inset 0 -2px 6px rgba(0,0,0,0.3)",
                              }}>
                                <span style={{
                                  color: "white", fontSize: "12px", fontWeight: 900,
                                  letterSpacing: "0.18em",
                                  textShadow: "0 1px 3px rgba(0,0,0,0.5)",
                                }}>PLAY NOW ▸</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* ─── ALL-TIME TAB ───────────────────────────────────────────────
                Combined-game forever leaderboard. Best Rhythm + Best Simon
                per player, summed. Never resets. No prizes. Pure status.
                Rendered with the same StagePodium + PlayerRow components
                as the WEEKLY tab so the layout is instantly familiar. */}
            {activeTab === "alltime" && (
              <>
                {allTimeLoading ? (
                  <div style={{ padding: "60px", color: "rgba(200,180,255,0.5)", fontSize: "11px", letterSpacing: "0.15em" }}>LOADING...</div>
                ) : allTimeEntries.length === 0 ? (
                  <div style={{
                    width: "100%", maxWidth: "440px",
                    margin: "20px auto",
                    padding: "32px 24px",
                    borderRadius: "20px",
                    background: "linear-gradient(180deg, rgba(167,139,250,0.12) 0%, rgba(20,10,50,0.8) 100%)",
                    border: "1.5px solid rgba(167,139,250,0.4)",
                    boxShadow: "0 0 30px rgba(167,139,250,0.2), 0 12px 30px rgba(0,0,0,0.5)",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: "44px", marginBottom: "10px" }}>🏆</div>
                    <div style={{ color: "white", fontSize: "16px", fontWeight: 900, letterSpacing: "0.04em", textShadow: "0 0 12px rgba(167,139,250,0.7)" }}>
                      Be the first on the all-time board
                    </div>
                    <div style={{ color: "rgba(200,180,255,0.75)", fontSize: "12px", marginTop: "10px", lineHeight: 1.6 }}>
                      No scores recorded yet. Play a round in either game and your name lands here forever.
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Sticky "Your position" chip — ALWAYS visible regardless
                        of which page is showing. Tells the player where they
                        stand at a glance. If they're on a different page than
                        their own row, JUMP TO MY ROW seeks to that page. */}
                    {address && myAllTime && (
                      <div style={{
                        width: "100%", maxWidth: "520px",
                        margin: "0 auto",
                        padding: "10px 14px", borderRadius: "12px",
                        background: "rgba(124,58,237,0.18)",
                        border: "1.5px solid rgba(167,139,250,0.55)",
                        boxShadow: "0 0 14px rgba(124,58,237,0.25)",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: "10px", flexWrap: "wrap",
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: "white", fontSize: "12px", fontWeight: 900, letterSpacing: "0.04em" }}>
                            You&apos;re #{myAllTime.rank}
                          </div>
                          <div style={{ color: "rgba(220,210,255,0.75)", fontSize: "10.5px", marginTop: "2px" }}>
                            Combined best: {myAllTime.peak.toLocaleString()}
                          </div>
                        </div>
                        {myAllTimePage >= 0 && myAllTimePage !== allTimePage && (
                          <button
                            onClick={() => setAllTimePage(myAllTimePage)}
                            style={{
                              padding: "7px 14px", borderRadius: "999px",
                              background: "linear-gradient(180deg, #c084fc 0%, #7c3aed 100%)",
                              border: "none", color: "white",
                              fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em",
                              cursor: "pointer",
                              boxShadow: "0 0 12px rgba(124,58,237,0.45)",
                            }}
                          >JUMP TO MY ROW</button>
                        )}
                      </div>
                    )}

                    {/* Podium ALWAYS visible — top 3 are the champions you're
                        chasing, so they stay in view on every page. Keeps the
                        aspirational target onscreen even when scrolling deeper. */}
                    <StagePodium podium={allTimePodium} />

                    <div style={{
                      width: "100%", maxWidth: "720px",
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)",
                      gap: isMobile ? "8px" : "10px 14px",
                      marginTop: "4px",
                    }}>
                      {allTimePageEntries.map((e, i) => {
                        const rank = 4 + allTimePage * ALL_TIME_PAGE_SIZE + i;
                        const color = rowColorByRank(rank);
                        const isMe = !!address && e.player.toLowerCase() === address.toLowerCase();
                        return (
                          <PlayerRow
                            key={e.player}
                            entry={e}
                            rank={rank}
                            color={color}
                            isMe={isMe}
                            breakdown={{ rhythm: e.bestRhythm, simon: e.bestSimon }}
                          />
                        );
                      })}
                    </div>

                    {/* Pagination controls — only shown when there's more than
                        one page worth of entries. Buttons disable at boundaries
                        so players can't seek past the ends. */}
                    {allTimeTotalPages > 1 && (
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        gap: "12px", marginTop: "16px",
                      }}>
                        <button
                          onClick={() => setAllTimePage(p => Math.max(0, p - 1))}
                          disabled={allTimePage === 0}
                          style={{
                            padding: "8px 14px", borderRadius: "999px",
                            background: allTimePage === 0 ? "rgba(255,255,255,0.04)" : "rgba(124,58,237,0.18)",
                            border: `1.5px solid ${allTimePage === 0 ? "rgba(255,255,255,0.12)" : "rgba(167,139,250,0.5)"}`,
                            color: allTimePage === 0 ? "rgba(200,180,255,0.35)" : "rgba(230,220,255,0.95)",
                            fontSize: "10.5px", fontWeight: 800, letterSpacing: "0.1em",
                            cursor: allTimePage === 0 ? "not-allowed" : "pointer",
                          }}
                        >‹ PREV</button>
                        <span style={{
                          color: "rgba(200,180,255,0.85)",
                          fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em",
                        }}>PAGE {allTimePage + 1} / {allTimeTotalPages}</span>
                        <button
                          onClick={() => setAllTimePage(p => Math.min(allTimeTotalPages - 1, p + 1))}
                          disabled={allTimePage === allTimeTotalPages - 1}
                          style={{
                            padding: "8px 14px", borderRadius: "999px",
                            background: allTimePage === allTimeTotalPages - 1 ? "rgba(255,255,255,0.04)" : "rgba(124,58,237,0.18)",
                            border: `1.5px solid ${allTimePage === allTimeTotalPages - 1 ? "rgba(255,255,255,0.12)" : "rgba(167,139,250,0.5)"}`,
                            color: allTimePage === allTimeTotalPages - 1 ? "rgba(200,180,255,0.35)" : "rgba(230,220,255,0.95)",
                            fontSize: "10.5px", fontWeight: 800, letterSpacing: "0.1em",
                            cursor: allTimePage === allTimeTotalPages - 1 ? "not-allowed" : "pointer",
                          }}
                        >NEXT ›</button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* SEASONS / PVP placeholders */}
            {activeTab === "seasons" && (
              <div style={{ width: "100%", maxWidth: "720px", display: "flex", flexDirection: "column", gap: "16px" }}>

                {/* ── ACTIVE SEASON HERO ── */}
                {seasonsData && (() => {
                  const liveEntries = (gameTab === "rhythm" ? seasonsData.live.rhythm : seasonsData.live.simon) || [];
                  const top3 = liveEntries.slice(0, 3);
                  const myEntry = address ? liveEntries.find(e => e.player.toLowerCase() === address.toLowerCase()) : undefined;
                  const myRank = myEntry ? liveEntries.findIndex(e => e.player.toLowerCase() === address!.toLowerCase()) + 1 : 0;
                  const secondsLeft = Math.max(0, seasonsData.currentEndsAt - now);
                  return (
                    <div style={{
                      borderRadius: "20px", padding: "3px",
                      background: "linear-gradient(135deg, #fbbf24 0%, #f97316 50%, #fbbf24 100%)",
                      boxShadow: "0 0 32px rgba(251,191,36,0.4), 0 0 60px rgba(249,115,22,0.2), 0 12px 30px rgba(0,0,0,0.6)",
                    }}>
                      <div style={{
                        borderRadius: "18px",
                        background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 50%, #07021a 100%)",
                        padding: "18px 18px 16px",
                        position: "relative", overflow: "hidden",
                      }}>
                        {/* Top gloss */}
                        <div style={{
                          position: "absolute", top: 0, left: 0, right: 0, height: "60px",
                          background: "linear-gradient(180deg, rgba(251,191,36,0.18) 0%, transparent 100%)",
                          pointerEvents: "none",
                        }} />

                        {/* Header row */}
                        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
                          <div>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                              <span style={{ display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e", animation: "icon-float 1.5s ease-in-out infinite" }} />
                              <span style={{ color: "#22c55e", fontSize: "9px", fontWeight: 900, letterSpacing: "0.18em" }}>LIVE NOW</span>
                            </div>
                            <div style={{ color: "white", fontSize: "20px", fontWeight: 900, letterSpacing: "0.04em", textShadow: "0 0 16px rgba(251,191,36,0.6)" }}>
                              SEASON {seasonsData.currentSeason}
                            </div>
                          </div>
                          {/* Countdown */}
                          <div style={{
                            padding: "6px 12px", borderRadius: "12px",
                            background: "rgba(0,0,0,0.5)",
                            border: "1.5px solid rgba(251,191,36,0.6)",
                            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6)",
                            textAlign: "right",
                          }}>
                            <div style={{ color: "rgba(251,191,36,0.7)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.14em" }}>ENDS IN</div>
                            <div style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 900, fontFamily: "monospace", textShadow: "0 0 8px rgba(251,191,36,0.7)" }}>
                              {formatCountdown(secondsLeft)}
                            </div>
                          </div>
                        </div>

                        {/* Players chip only — prize pool hidden for now.
                            Players thought the 50 G$ was a real-money
                            entry fee or a cash prize, not a free in-game
                            currency, and bounced. We'll bring it back once
                            the explainer on /about makes G$ obvious. */}
                        <div style={{ position: "relative", zIndex: 1, marginBottom: "14px" }}>
                          <div style={{
                            borderRadius: "14px",
                            background: "linear-gradient(180deg, rgba(167,139,250,0.18) 0%, rgba(0,0,0,0.3) 100%)",
                            border: "1.5px solid rgba(167,139,250,0.5)",
                            padding: "10px 14px",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                          }}>
                            <span style={{ color: "#a78bfa", fontSize: "22px", fontWeight: 900, textShadow: "0 0 14px rgba(167,139,250,0.7)" }}>
                              {liveEntries.length}
                            </span>
                            <span style={{ color: "rgba(200,180,255,0.75)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em" }}>
                              PLAYER{liveEntries.length !== 1 ? "S" : ""} THIS SEASON
                            </span>
                          </div>
                        </div>

                        {/* Mini podium (top 3 chips) */}
                        {top3.length > 0 && (
                          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ color: "rgba(200,180,255,0.7)", fontSize: "9px", fontWeight: 900, letterSpacing: "0.16em", marginBottom: "2px" }}>
                              CURRENT TOP 3 — {gameTab === "rhythm" ? "RHYTHM RUSH" : "SIMON MEMORY"}
                            </div>
                            {top3.map((e, i) => {
                              const medalColor = i === 0 ? "#fbbf24" : i === 1 ? "#e2e8f0" : "#f97316";
                              const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
                              const isMe = !!address && e.player.toLowerCase() === address.toLowerCase();
                              return (
                                <div key={e.player} style={{
                                  display: "flex", alignItems: "center", gap: "10px",
                                  padding: "7px 12px", borderRadius: "10px",
                                  background: isMe ? `${medalColor}26` : "rgba(255,255,255,0.04)",
                                  border: `1px solid ${isMe ? medalColor : "rgba(255,255,255,0.07)"}`,
                                }}>
                                  <span style={{ fontSize: "16px" }}>{medal}</span>
                                  <span style={{ flex: 1, color: isMe ? medalColor : "white", fontSize: "11px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {isMe ? "YOU" : fmtName(e.player, e.username)}
                                  </span>
                                  <span style={{ color: medalColor, fontSize: "13px", fontWeight: 900, textShadow: `0 0 8px ${medalColor}` }}>{e.score}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Your status */}
                        {myEntry && myRank > 3 && (
                          <div style={{
                            position: "relative", zIndex: 1, marginTop: "10px",
                            padding: "8px 12px", borderRadius: "10px",
                            background: "rgba(192,38,211,0.12)",
                            border: "1px solid rgba(192,38,211,0.45)",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                          }}>
                            <span style={{ color: "rgba(244,182,253,0.85)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.08em" }}>
                              YOU&apos;RE #{myRank}
                            </span>
                            <span style={{ color: "#e879f9", fontSize: "13px", fontWeight: 900, textShadow: "0 0 8px rgba(232,121,249,0.6)" }}>
                              {myEntry.score} pts
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* ── EVENTS — unified section for all live + past competitions.
                    Arena Cups, 3-Week Competition, and future events all live
                    here so players have one place to check what's running and
                    what's already ended. ── */}
                {(challenge || (competition && competition.weeksLeft > 0) || pastChallenges.length > 0 || pastCompetitions.length > 0) && (
                  <div style={{
                    fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em",
                    color: "rgba(251,215,100,0.9)", textAlign: "center",
                    textShadow: "0 0 14px rgba(251,191,36,0.7)",
                  }}>── EVENTS ──</div>
                )}

                {/* Empty state when no live cup AND no active competition.
                    The header still shows because past events exist below;
                    leaving the gap blank reads as a layout bug. Calm violet
                    treatment (no golden glow) so it never gets mistaken for
                    a live event. The CTA drives notification opt-ins —
                    aligned with the "real players hear about future events
                    first" community strategy. */}
                {!challenge && (!competition || competition.weeksLeft === 0) && (pastChallenges.length > 0 || pastCompetitions.length > 0) && (
                  <div style={{
                    borderRadius: "16px",
                    background: "linear-gradient(180deg, rgba(20,10,50,0.7) 0%, rgba(10,5,30,0.85) 100%)",
                    border: "1px dashed rgba(167,139,250,0.35)",
                    padding: "18px 18px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: "26px", marginBottom: "6px" }}>🏁</div>
                    <div style={{
                      color: "rgba(230,220,255,0.92)",
                      fontSize: "13px", fontWeight: 900, letterSpacing: "0.04em",
                    }}>
                      No live event right now
                    </div>
                    <div style={{
                      color: "rgba(200,180,255,0.6)",
                      fontSize: "11px", fontWeight: 600,
                      marginTop: "6px", lineHeight: 1.5,
                      maxWidth: "320px", margin: "6px auto 0",
                    }}>
                      The next one drops without warning. Players with notifications on hear first.
                    </div>
                    <button
                      onClick={() => router.push("/profile?tab=settings")}
                      style={{
                        marginTop: "12px",
                        display: "inline-flex", alignItems: "center", gap: "6px",
                        padding: "7px 14px", borderRadius: "999px",
                        background: "rgba(124,58,237,0.18)",
                        border: "1.5px solid rgba(167,139,250,0.55)",
                        boxShadow: "0 0 12px rgba(124,58,237,0.3)",
                        color: "rgba(230,220,255,0.95)",
                        fontSize: "10.5px", fontWeight: 800, letterSpacing: "0.1em",
                        cursor: "pointer",
                      }}
                    >
                      <span>🔔</span>
                      <span>TURN ON NOTIFICATIONS</span>
                      <span style={{ fontSize: "12px", lineHeight: 1 }}>›</span>
                    </button>
                  </div>
                )}

                {/* ── COMMUNITY CHALLENGE — weekly community games milestone ─ */}
                {weeklyChallengeLB && !weeklyChallengeLB.hit && (
                  <div style={{
                    borderRadius: "18px", padding: "2px",
                    background: "linear-gradient(180deg, #22c55e 0%, #16a34a 50%, #065f46 100%)",
                    boxShadow: "0 0 22px rgba(34,197,94,0.25), 0 10px 24px rgba(0,0,0,0.6)",
                  }}>
                    <div style={{
                      borderRadius: "16px",
                      background: "linear-gradient(180deg, #2a0c6e 0%, #07021a 100%)",
                      padding: "clamp(12px,3.5vw,18px) clamp(14px,4vw,20px)",
                      position: "relative", overflow: "hidden",
                      display: "flex", flexDirection: "column", gap: "clamp(10px,2.4vw,14px)",
                    }}>
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "55%", background: "linear-gradient(180deg, rgba(34,197,94,0.1) 0%, transparent 100%)", pointerEvents: "none" }} />

                      {/* Header */}
                      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                        <div>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px", borderRadius: "999px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.5)", marginBottom: "6px" }}>
                            <span style={{ color: "#86efac", fontSize: "8px", fontWeight: 900, letterSpacing: "0.16em" }}>COMMUNITY EVENT</span>
                          </div>
                          <div style={{ color: "white", fontSize: "clamp(14px,4vw,16px)", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.1 }}>
                            WEEKLY CHALLENGE
                          </div>
                        </div>
                        <div style={{ padding: "5px 10px", borderRadius: "10px", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(34,197,94,0.4)", textAlign: "right", flexShrink: 0 }}>
                          <div style={{ color: "rgba(134,239,172,0.7)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.14em" }}>{weeklyChallengeLB.daysLeft}d LEFT</div>
                          <div style={{ color: "#86efac", fontSize: "clamp(13px,3.6vw,16px)", fontWeight: 900, lineHeight: 1 }}>
                            {weeklyChallengeLB.progress}<span style={{ fontSize: "10px", color: "rgba(134,239,172,0.5)" }}>/{weeklyChallengeLB.target}</span>
                          </div>
                        </div>
                      </div>

                      {/* Prize + progress */}
                      <div style={{ position: "relative", zIndex: 1, padding: "10px 12px", borderRadius: "10px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(34,197,94,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                        <div>
                          <div style={{ color: "rgba(134,239,172,0.7)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.12em" }}>PRIZE POOL</div>
                          <div style={{ color: "#fbbf24", fontSize: "clamp(13px,3.6vw,15px)", fontWeight: 900, marginTop: "2px" }}>{weeklyChallengeLB.rewardG} G$ split</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ color: "rgba(134,239,172,0.7)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.12em" }}>PLAYERS IN</div>
                          <div style={{ color: "#86efac", fontSize: "clamp(13px,3.6vw,15px)", fontWeight: 900, marginTop: "2px" }}>{weeklyChallengeLB.playersIn}</div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div style={{ position: "relative", zIndex: 1 }}>
                        <div style={{ height: "6px", borderRadius: "999px", background: "rgba(0,0,0,0.5)", overflow: "hidden", border: "1px solid rgba(34,197,94,0.15)" }}>
                          <div style={{ width: `${Math.min(100, Math.round((weeklyChallengeLB.progress / weeklyChallengeLB.target) * 100))}%`, height: "100%", borderRadius: "999px", background: "linear-gradient(90deg, #16a34a 0%, #86efac 100%)", transition: "width 0.6s" }} />
                        </div>
                        <div style={{ color: "rgba(134,239,172,0.45)", fontSize: "8px", fontWeight: 700, marginTop: "4px" }}>
                          Max {weeklyChallengeLB.capPerPlayer} games per player · {weeklyChallengeLB.ubiG} G$ to GoodDollar when hit
                        </div>
                      </div>

                      {/* Your share */}
                      {weeklyChallengeLB.myContribution != null && (
                        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: "10px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)" }}>
                          <span style={{ color: "rgba(254,215,170,0.85)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.08em" }}>YOUR SHARE</span>
                          <span style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 900 }}>{weeklyChallengeLB.myContribution} / {weeklyChallengeLB.capPerPlayer}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {weeklyChallengeLB?.hit && (
                  <div style={{ borderRadius: "16px", background: "rgba(20,10,50,0.6)", border: "1.5px solid rgba(134,239,172,0.45)", padding: "14px 16px", textAlign: "center" }}>
                    <div style={{ color: "#86efac", fontSize: "13px", fontWeight: 900 }}>🎉 Community milestone hit!</div>
                    <div style={{ color: "rgba(134,239,172,0.65)", fontSize: "10px", marginTop: "4px" }}>{weeklyChallengeLB.rewardG} G$ split among all players · {weeklyChallengeLB.ubiG} G$ to GoodDollar</div>
                  </div>
                )}

                {/* ── 72-HR ARENA CUP — live participation board ──
                    Pinned above the 3-Week Competition because it's the
                    most time-bound thing on the screen. Shows the top
                    challenge.topN players (matches the actual prize
                    structure), the prize line, the live countdown, and
                    the user's own rank chip if they're on the board.
                    Visible only while the event is active or pending. */}
                {challenge && (
                  <div style={{
                    borderRadius: "18px", padding: "2px",
                    background: "linear-gradient(180deg, #fbbf24 0%, #f97316 50%, #c026d3 100%)",
                    boxShadow: "0 0 22px rgba(251,191,36,0.35), 0 10px 24px rgba(0,0,0,0.6)",
                  }}>
                    <div style={{
                      borderRadius: "16px",
                      background: "linear-gradient(180deg, #2a0c6e 0%, #07021a 100%)",
                      padding: "clamp(12px, 3.5vw, 18px) clamp(14px, 4vw, 20px)",
                      position: "relative", overflow: "hidden",
                      display: "flex", flexDirection: "column",
                      gap: "clamp(10px, 2.4vw, 14px)",
                    }}>
                      <div style={{
                        position: "absolute", top: 0, left: 0, right: 0, height: "55%",
                        background: "linear-gradient(180deg, rgba(251,191,36,0.1) 0%, transparent 100%)",
                        pointerEvents: "none",
                      }} />

                      {/* Header — title + countdown chip */}
                      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            display: "inline-flex", alignItems: "center", gap: "5px",
                            padding: "2px 8px", borderRadius: "999px",
                            background: challenge.pending ? "rgba(167,139,250,0.18)" : "rgba(251,191,36,0.18)",
                            border: `1px solid ${challenge.pending ? "rgba(167,139,250,0.5)" : "rgba(251,191,36,0.5)"}`,
                            marginBottom: "6px",
                          }}>
                            <span style={{
                              color: challenge.pending ? "#e9d5ff" : "#fbbf24",
                              fontSize: "8px", fontWeight: 900, letterSpacing: "0.16em",
                            }}>{challenge.pending ? "STARTING SOON" : "LIVE NOW"}</span>
                          </div>
                          <div style={{
                            color: "white",
                            fontSize: "clamp(14px, 4vw, 16px)",
                            fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.1,
                          }}>
                            {challenge.name.toUpperCase()}
                          </div>
                        </div>
                        <div style={{
                          padding: "5px 10px", borderRadius: "10px",
                          background: "rgba(0,0,0,0.5)",
                          border: `1px solid ${challenge.pending ? "rgba(167,139,250,0.4)" : "rgba(251,191,36,0.4)"}`,
                          textAlign: "right", flexShrink: 0,
                        }}>
                          <div style={{
                            color: challenge.pending ? "rgba(233,213,255,0.7)" : "rgba(254,215,170,0.7)",
                            fontSize: "8px", fontWeight: 800, letterSpacing: "0.14em",
                          }}>{challenge.pending ? "STARTS IN" : "TIME LEFT"}</div>
                          <div style={{
                            color: challenge.pending ? "#e9d5ff" : "#fbbf24",
                            fontSize: "clamp(13px, 3.6vw, 16px)", fontWeight: 900, lineHeight: 1,
                            fontFamily: "monospace",
                          }}>
                            {formatCountdown(challenge.pending ? challenge.secondsUntilStart : challenge.secondsLeft)}
                          </div>
                        </div>
                      </div>

                      {/* Prize line — single chip because every winner gets same amount */}
                      <div style={{
                        position: "relative", zIndex: 1,
                        padding: "10px 12px", borderRadius: "10px",
                        background: "rgba(0,0,0,0.35)",
                        border: "1px solid rgba(251,191,36,0.4)",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: "10px",
                      }}>
                        <div>
                          <div style={{ color: "rgba(254,215,170,0.7)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.14em" }}>PRIZE POOL</div>
                          <div style={{ color: "#fbbf24", fontSize: "clamp(13px, 3.6vw, 15px)", fontWeight: 900, marginTop: "2px" }}>
                            ${challenge.totalPrizePool} USDC · top {challenge.topN}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ color: "rgba(254,215,170,0.7)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.14em" }}>EACH WINS</div>
                          <div style={{ color: "#fbbf24", fontSize: "clamp(13px, 3.6vw, 15px)", fontWeight: 900, marginTop: "2px" }}>
                            ${challenge.prizeUsdc}
                          </div>
                        </div>
                      </div>

                      {/* Live top N — only render when event has actually started */}
                      {!challenge.pending && challenge.rankings.length > 0 && (
                        <div style={{
                          position: "relative", zIndex: 1,
                          display: "flex", flexDirection: "column",
                          gap: "6px",
                        }}>
                          <div style={{
                            color: "rgba(254,215,170,0.7)",
                            fontSize: "9px", fontWeight: 800, letterSpacing: "0.18em",
                          }}>LIVE TOP 5 · {challenge.minPlays} PLAYS TO QUALIFY</div>
                          {challenge.rankings.slice(0, 5).map((p, i) => {
                            const isMe = address && p.wallet.toLowerCase() === address.toLowerCase();
                            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏅";
                            return (
                              <div key={p.wallet} style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                gap: "10px",
                                padding: "8px 10px", borderRadius: "10px",
                                background: isMe ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.04)",
                                border: isMe ? "1px solid rgba(251,191,36,0.5)" : "1px solid rgba(255,255,255,0.08)",
                              }}>
                                <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                                  <span style={{
                                    fontSize: "12px",
                                    color: isMe ? "#fbbf24" : "rgba(255,255,255,0.55)",
                                    fontWeight: 900, letterSpacing: "0.05em",
                                    flexShrink: 0, minWidth: "22px",
                                  }}>#{i + 1}</span>
                                  <span style={{ fontSize: "13px", flexShrink: 0 }}>{medal}</span>
                                  <span style={{
                                    color: isMe ? "#fde68a" : p.qualified ? "rgba(255,255,255,0.92)" : "rgba(200,180,255,0.7)",
                                    fontSize: "clamp(11.5px, 2.9vw, 12.5px)",
                                    fontWeight: isMe ? 900 : 700,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  }}>
                                    {p.username || `${p.wallet.slice(0, 4)}…${p.wallet.slice(-3)}`}
                                    {isMe && <span style={{ marginLeft: "6px", color: "#fbbf24", fontSize: "9px", letterSpacing: "0.1em" }}>YOU</span>}
                                  </span>
                                </span>
                                <span style={{
                                  color: p.qualified ? "#86efac" : "#fde68a",
                                  fontSize: "clamp(12px, 3.2vw, 13px)", fontWeight: 900,
                                  fontFamily: "monospace",
                                  flexShrink: 0,
                                }}>
                                  {p.plays}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* My rank chip — when player is in top 20 but outside top N */}
                      {!challenge.pending && address && (() => {
                        const myIdx = challenge.rankings.findIndex(r => r.wallet.toLowerCase() === address.toLowerCase());
                        if (myIdx < 0 || myIdx < challenge.topN) return null;
                        const me = challenge.rankings[myIdx];
                        return (
                          <div style={{
                            position: "relative", zIndex: 1,
                            padding: "8px 12px", borderRadius: "10px",
                            background: "rgba(251,191,36,0.08)",
                            border: "1px solid rgba(251,191,36,0.4)",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                          }}>
                            <span style={{ color: "rgba(254,215,170,0.85)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.08em" }}>
                              YOU&apos;RE #{myIdx + 1} · KEEP PLAYING
                            </span>
                            <span style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 900 }}>
                              {me.plays} plays
                            </span>
                          </div>
                        );
                      })()}

                      {/* Empty state — pending or no qualifiers yet */}
                      {!challenge.pending && challenge.rankings.length === 0 && (
                        <div style={{
                          position: "relative", zIndex: 1,
                          padding: "14px 12px", borderRadius: "10px",
                          background: "rgba(0,0,0,0.3)",
                          color: "rgba(200,180,255,0.55)",
                          fontSize: "11px", textAlign: "center", fontWeight: 700,
                        }}>
                          No plays yet. Be the first to qualify.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── 3-WEEK COMPETITION SPECIAL EVENT — single gold accent ── */}
                {competition && competition.weeksLeft > 0 && (
                  <div style={{
                    borderRadius: "18px", padding: "2px",
                    background: "linear-gradient(180deg, #fbbf24 0%, #b45309 100%)",
                    boxShadow: "0 0 18px rgba(251,191,36,0.3), 0 10px 24px rgba(0,0,0,0.6)",
                  }}>
                    <div style={{
                      borderRadius: "16px",
                      background: "linear-gradient(180deg, #2a0c6e 0%, #07021a 100%)",
                      padding: "16px 18px",
                      position: "relative", overflow: "hidden",
                    }}>
                      <div style={{
                        position: "absolute", top: 0, left: 0, right: 0, height: "55%",
                        background: "linear-gradient(180deg, rgba(251,191,36,0.1) 0%, transparent 100%)",
                        pointerEvents: "none",
                      }} />
                      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
                        <div>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "2px 8px", borderRadius: "999px", background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.5)", marginBottom: "6px" }}>
                            <span style={{ color: "#fbbf24", fontSize: "8px", fontWeight: 900, letterSpacing: "0.16em" }}>SPECIAL EVENT</span>
                          </div>
                          <div style={{ color: "white", fontSize: "15px", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.1 }}>
                            3-WEEK COMPETITION
                          </div>
                        </div>
                        <div style={{
                          padding: "5px 10px", borderRadius: "10px",
                          background: "rgba(0,0,0,0.5)",
                          border: "1px solid rgba(251,191,36,0.4)",
                          textAlign: "right",
                        }}>
                          <div style={{ color: "rgba(254,215,170,0.7)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.14em" }}>
                            {competition.weeksLeft === 1 ? "FINAL WEEK" : "WEEKS LEFT"}
                          </div>
                          <div style={{ color: "#fbbf24", fontSize: "16px", fontWeight: 900, lineHeight: 1 }}>
                            {competition.weeksLeft === 1 ? "🏁" : competition.weeksLeft}
                          </div>
                        </div>
                      </div>
                      <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                        {[
                          { rank: "1ST", emoji: "🥇", color: "#fbbf24", prize: competition.prizes.first },
                          { rank: "2ND", emoji: "🥈", color: "#e2e8f0", prize: competition.prizes.second },
                          { rank: "3RD", emoji: "🥉", color: "#f97316", prize: competition.prizes.third },
                        ].map(p => (
                          <div key={p.rank} style={{
                            borderRadius: "10px",
                            background: "rgba(0,0,0,0.35)",
                            border: `1px solid ${p.color}55`,
                            padding: "8px 4px", textAlign: "center",
                          }}>
                            <div style={{ fontSize: "14px" }}>{p.emoji}</div>
                            <div style={{ color: p.color, fontSize: "15px", fontWeight: 900, marginTop: "2px" }}>
                              ${p.prize}
                            </div>
                            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.1em", marginTop: "1px" }}>{p.rank}</div>
                          </div>
                        ))}
                      </div>
                      {address && (() => {
                        const myCompRank = competition.rankings.findIndex(r => r.wallet === address.toLowerCase());
                        if (myCompRank < 0) return null;
                        const me = competition.rankings[myCompRank];
                        return (
                          <div style={{
                            position: "relative", zIndex: 1, marginTop: "10px",
                            padding: "8px 12px", borderRadius: "10px",
                            background: "rgba(251,191,36,0.08)",
                            border: "1px solid rgba(251,191,36,0.4)",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                          }}>
                            <span style={{ color: "rgba(254,215,170,0.85)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.08em" }}>
                              YOU&apos;RE #{myCompRank + 1} OVERALL
                            </span>
                            <span style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 900 }}>
                              {me.total} pts
                            </span>
                          </div>
                        );
                      })()}

                      {/* ── 3-WEEK CUP RANKINGS ──
                          Full cumulative leaderboard for the competition.
                          Was previously only accessible via the /api/competition
                          endpoint with no UI — users saw the "3-WEEK COMPETITION"
                          card advertising $15/$10/$5 prizes but had no way to
                          check who was winning or where they stood (unless they
                          were already in the top 20).
                          Top 10 shown; the "you're #N" chip above covers ranks
                          beyond that. Rhythm+Simon split in the score cell so
                          players see both contributions at a glance. */}
                      {competition.rankings.length > 0 && (
                        <div style={{
                          position: "relative", zIndex: 1, marginTop: "14px",
                          padding: "12px",
                          borderRadius: "12px",
                          background: "rgba(0,0,0,0.3)",
                          border: "1px solid rgba(251,191,36,0.2)",
                        }}>
                          <div style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            marginBottom: "10px",
                          }}>
                            <span style={{
                              color: "rgba(254,215,170,0.9)", fontSize: "10px",
                              fontWeight: 900, letterSpacing: "0.16em",
                            }}>CUP RANKINGS</span>
                            <span style={{
                              color: "rgba(200,180,255,0.55)", fontSize: "9px",
                              fontWeight: 700, letterSpacing: "0.08em",
                            }}>RHYTHM + SIMON COMBINED</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                            {competition.rankings.slice(0, 10).map((r, i) => {
                              const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                              const medalColor = i === 0 ? "#fbbf24" : i === 1 ? "#e2e8f0" : i === 2 ? "#f97316" : "rgba(200,180,255,0.6)";
                              const isMe = !!address && r.wallet === address.toLowerCase();
                              const display = r.username || `${r.wallet.slice(0, 4)}...${r.wallet.slice(-3)}`;
                              return (
                                <div key={r.wallet} style={{
                                  display: "flex", alignItems: "center", gap: "10px",
                                  padding: "7px 10px",
                                  borderRadius: "8px",
                                  background: isMe ? "rgba(251,191,36,0.12)" : (i < 3 ? `${medalColor}10` : "rgba(255,255,255,0.025)"),
                                  border: isMe ? "1px solid rgba(251,191,36,0.45)" : `1px solid ${i < 3 ? medalColor + "33" : "transparent"}`,
                                }}>
                                  <span style={{
                                    minWidth: "22px", textAlign: "center",
                                    fontSize: medal ? "14px" : "10px",
                                    color: medalColor,
                                    fontWeight: 800,
                                  }}>
                                    {medal || `#${i + 1}`}
                                  </span>
                                  <span style={{
                                    flex: 1, minWidth: 0,
                                    color: isMe ? "#fde68a" : "white",
                                    fontSize: "11.5px",
                                    fontWeight: isMe ? 900 : 700,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  }}>
                                    {isMe ? "YOU" : display}
                                  </span>
                                  <span style={{
                                    color: "rgba(200,180,255,0.5)",
                                    fontSize: "9px", fontWeight: 700,
                                    letterSpacing: "0.04em",
                                    whiteSpace: "nowrap",
                                  }}>
                                    🥁 {r.totalRhythm} · 🧠 {r.totalSimon}
                                  </span>
                                  <span style={{
                                    minWidth: "48px", textAlign: "right",
                                    color: isMe ? "#fbbf24" : (i < 3 ? medalColor : "white"),
                                    fontSize: "13px", fontWeight: 900,
                                    textShadow: i < 3 ? `0 0 8px ${medalColor}66` : "none",
                                  }}>
                                    {r.total}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── COMPLETED EVENTS — grid cards matching Completed Seasons style ── */}
                {(pastChallenges.length > 0 || pastCompetitions.length > 0) && (
                  <div>
                    <div style={{
                      fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em",
                      color: "rgba(254,215,170,0.85)", textAlign: "center",
                      textShadow: "0 0 14px rgba(251,191,36,0.6)", marginBottom: "12px",
                    }}>── COMPLETED EVENTS ──</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "10px" }}>
                      {pastCompetitions.map(comp => {
                        const winner = comp.winners[0];
                        const myFinish = address ? (comp.winners.find(w => w.wallet.toLowerCase() === address.toLowerCase())?.rank ?? 0) : 0;
                        const placed = myFinish > 0 && myFinish <= 3;
                        const myMedalColor = myFinish === 1 ? "#fbbf24" : myFinish === 2 ? "#e2e8f0" : myFinish === 3 ? "#f97316" : null;
                        const myMedal = myFinish === 1 ? "🥇" : myFinish === 2 ? "🥈" : myFinish === 3 ? "🥉" : null;
                        return (
                          <div key={comp.id}
                            role="button" tabIndex={0}
                            onClick={() => setSelectedEvent({ type: "competition", data: comp })}
                            style={{
                              borderRadius: "14px",
                              background: "rgba(20,10,50,0.6)",
                              border: placed ? `1.5px solid ${myMedalColor}88` : "1px solid rgba(251,191,36,0.18)",
                              boxShadow: placed ? `0 0 12px ${myMedalColor}33, 0 6px 14px rgba(0,0,0,0.5)` : "0 6px 14px rgba(0,0,0,0.5)",
                              padding: "12px 14px", cursor: "pointer", userSelect: "none",
                              transition: "transform 0.15s, border-color 0.15s",
                            }}
                            onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = "translateY(-2px)"; if (!placed) el.style.borderColor = "rgba(251,191,36,0.45)"; }}
                            onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ""; if (!placed) el.style.borderColor = "rgba(251,191,36,0.18)"; }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                              <div style={{ color: "#fbbf24", fontSize: "12px", fontWeight: 900, letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                {comp.name.toUpperCase()}
                              </div>
                              {myMedal && (
                                <div style={{ padding: "2px 8px", borderRadius: "999px", background: `${myMedalColor}1a`, border: `1px solid ${myMedalColor}66`, flexShrink: 0, marginLeft: "6px" }}>
                                  <span style={{ fontSize: "10px" }}>{myMedal}</span>
                                  <span style={{ color: myMedalColor!, fontSize: "9px", fontWeight: 900, marginLeft: "4px" }}>YOU</span>
                                </div>
                              )}
                            </div>
                            {winner ? (
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", marginBottom: "8px" }}>
                                <span style={{ fontSize: "13px" }}>🏆</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ color: "rgba(254,215,170,0.65)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.1em" }}>WINNER</div>
                                  <div style={{ color: "white", fontSize: "11px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {winner.username || `${winner.wallet.slice(0, 4)}…${winner.wallet.slice(-3)}`}
                                  </div>
                                </div>
                                <div style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 900 }}>{winner.total}</div>
                              </div>
                            ) : (
                              <div style={{ color: "rgba(200,180,255,0.4)", fontSize: "10px", textAlign: "center", padding: "12px 0" }}>No results</div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "rgba(200,180,255,0.55)", fontSize: "9px", fontWeight: 700 }}>
                              <span>💰 ${comp.prizes.first + comp.prizes.second + comp.prizes.third} pool</span>
                              <span style={{ color: "rgba(251,191,36,0.7)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em" }}>VIEW →</span>
                            </div>
                          </div>
                        );
                      })}
                      {pastChallenges.map(ch => {
                        const winner = ch.winners[0];
                        const myFinish = address ? (ch.winners.find(w => w.wallet.toLowerCase() === address.toLowerCase())?.rank ?? 0) : 0;
                        const placed = myFinish > 0 && myFinish <= ch.top_n;
                        const myMedalColor = myFinish === 1 ? "#fbbf24" : myFinish === 2 ? "#e2e8f0" : myFinish === 3 ? "#f97316" : myFinish > 0 ? "#a78bfa" : null;
                        const myMedal = myFinish === 1 ? "🥇" : myFinish === 2 ? "🥈" : myFinish === 3 ? "🥉" : myFinish > 0 ? "🏅" : null;
                        return (
                          <div key={ch.id}
                            role="button" tabIndex={0}
                            onClick={() => setSelectedEvent({ type: "challenge", data: ch })}
                            style={{
                              borderRadius: "14px",
                              background: "rgba(20,10,50,0.6)",
                              border: placed ? `1.5px solid ${myMedalColor}88` : "1px solid rgba(251,191,36,0.18)",
                              boxShadow: placed ? `0 0 12px ${myMedalColor}33, 0 6px 14px rgba(0,0,0,0.5)` : "0 6px 14px rgba(0,0,0,0.5)",
                              padding: "12px 14px", cursor: "pointer", userSelect: "none",
                              transition: "transform 0.15s, border-color 0.15s",
                            }}
                            onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = "translateY(-2px)"; if (!placed) el.style.borderColor = "rgba(251,191,36,0.45)"; }}
                            onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ""; if (!placed) el.style.borderColor = "rgba(251,191,36,0.18)"; }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                              <div style={{ color: "#fbbf24", fontSize: "12px", fontWeight: 900, letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                {ch.name.toUpperCase()}
                              </div>
                              {myMedal && (
                                <div style={{ padding: "2px 8px", borderRadius: "999px", background: `${myMedalColor}1a`, border: `1px solid ${myMedalColor}66`, flexShrink: 0, marginLeft: "6px" }}>
                                  <span style={{ fontSize: "10px" }}>{myMedal}</span>
                                  <span style={{ color: myMedalColor!, fontSize: "9px", fontWeight: 900, marginLeft: "4px" }}>YOU</span>
                                </div>
                              )}
                            </div>
                            {winner ? (
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", marginBottom: "8px" }}>
                                <span style={{ fontSize: "13px" }}>🏆</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ color: "rgba(254,215,170,0.65)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.1em" }}>WINNER</div>
                                  <div style={{ color: "white", fontSize: "11px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {winner.username || `${winner.wallet.slice(0, 4)}…${winner.wallet.slice(-3)}`}
                                  </div>
                                </div>
                                <div style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 900 }}>{winner.plays}</div>
                              </div>
                            ) : (
                              <div style={{ color: "rgba(200,180,255,0.4)", fontSize: "10px", textAlign: "center", padding: "12px 0" }}>No results</div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "rgba(200,180,255,0.55)", fontSize: "9px", fontWeight: 700 }}>
                              <span>🏅 {ch.winners.length}/{ch.top_n} qualified</span>
                              <span style={{ color: "rgba(251,191,36,0.7)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em" }}>VIEW →</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── PAST SEASONS HISTORY ── */}
                {seasonsData && seasonsData.past.length > 0 && (
                  <div>
                    <div style={{
                      fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em",
                      color: "rgba(200,180,255,0.8)", textAlign: "center",
                      textShadow: "0 0 14px rgba(160,100,255,0.8)", marginBottom: "12px",
                    }}>── COMPLETED SEASONS ──</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
                      {seasonsData.past.slice(0, 12).map(s => {
                        const entries = (gameTab === "rhythm" ? s.rhythm : s.simon) || [];
                        const winner = entries[0];
                        const myFinish = address ? entries.findIndex(e => e.player.toLowerCase() === address.toLowerCase()) + 1 : 0;
                        const placedTop3 = myFinish > 0 && myFinish <= 3;
                        const myMedalColor = myFinish === 1 ? "#fbbf24" : myFinish === 2 ? "#e2e8f0" : myFinish === 3 ? "#f97316" : null;
                        const myMedal = myFinish === 1 ? "🥇" : myFinish === 2 ? "🥈" : myFinish === 3 ? "🥉" : null;
                        return (
                          <div key={s.season}
                            role="button" tabIndex={0}
                            onClick={() => setSelectedSeason(s)}
                            style={{
                              borderRadius: "14px",
                              background: "rgba(20,10,50,0.6)",
                              border: placedTop3
                                ? `1.5px solid ${myMedalColor}88`
                                : "1px solid rgba(167,139,250,0.18)",
                              boxShadow: placedTop3
                                ? `0 0 12px ${myMedalColor}33, 0 6px 14px rgba(0,0,0,0.5)`
                                : "0 6px 14px rgba(0,0,0,0.5)",
                              padding: "12px 14px",
                              cursor: "pointer", userSelect: "none",
                              transition: "transform 0.15s, border-color 0.15s",
                            }}
                            onMouseEnter={e => {
                              const el = e.currentTarget as HTMLDivElement;
                              el.style.transform = "translateY(-2px)";
                              if (!placedTop3) el.style.borderColor = "rgba(167,139,250,0.5)";
                            }}
                            onMouseLeave={e => {
                              const el = e.currentTarget as HTMLDivElement;
                              el.style.transform = "";
                              if (!placedTop3) el.style.borderColor = "rgba(167,139,250,0.18)";
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                              <div style={{ color: "white", fontSize: "13px", fontWeight: 900, letterSpacing: "0.06em" }}>
                                SEASON {s.season}
                              </div>
                              {myMedal && (
                                <div style={{
                                  padding: "2px 8px", borderRadius: "999px",
                                  background: `${myMedalColor}1a`, border: `1px solid ${myMedalColor}66`,
                                }}>
                                  <span style={{ fontSize: "10px" }}>{myMedal}</span>
                                  <span style={{ color: myMedalColor!, fontSize: "9px", fontWeight: 900, marginLeft: "4px" }}>YOU</span>
                                </div>
                              )}
                            </div>
                            {winner ? (
                              <div style={{
                                display: "flex", alignItems: "center", gap: "8px",
                                padding: "6px 8px", borderRadius: "8px",
                                background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)",
                                marginBottom: "8px",
                              }}>
                                <span style={{ fontSize: "13px" }}>🏆</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ color: "rgba(254,215,170,0.65)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.1em" }}>WINNER</div>
                                  <div style={{ color: "white", fontSize: "11px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {fmtName(winner.player, winner.username)}
                                  </div>
                                </div>
                                <div style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 900 }}>
                                  {winner.score}
                                </div>
                              </div>
                            ) : (
                              <div style={{ color: "rgba(200,180,255,0.4)", fontSize: "10px", textAlign: "center", padding: "12px 0" }}>
                                No scores
                              </div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "rgba(200,180,255,0.55)", fontSize: "9px", fontWeight: 700 }}>
                              <span>👥 {s.totalPlayers || entries.length} player{(s.totalPlayers || entries.length) !== 1 ? "s" : ""}</span>
                              <span style={{ color: "rgba(167,139,250,0.7)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em" }}>VIEW →</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!seasonsData && (
                  <div style={{
                    padding: "40px 20px", textAlign: "center",
                    color: "rgba(200,180,255,0.5)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em",
                  }}>LOADING SEASONS...</div>
                )}

                {/* (Old "PAST CHALLENGES" block lived here. It moved up
                    next to the live cup so the cup family stays grouped.) */}
              </div>
            )}

            {activeTab === "pvp" && (
              <div style={{
                width: "100%", maxWidth: "540px",
                padding: "30px 20px", borderRadius: "18px",
                background: "rgba(20,10,50,0.6)", border: "1px solid rgba(168,85,247,0.2)",
                boxShadow: "0 0 30px rgba(168,85,247,0.15)",
                textAlign: "center",
              }}>
                <div style={{ fontSize: "36px", marginBottom: "10px" }}>⚔️</div>
                <div style={{ color: "white", fontSize: "14px", fontWeight: 900, letterSpacing: "0.1em", marginBottom: "6px" }}>PVP ARENA</div>
                <div style={{ color: "rgba(200,180,255,0.55)", fontSize: "11px", lineHeight: 1.5 }}>
                  1v1 challenges with G$ wagers — top wins ranking coming here.
                </div>
              </div>
            )}
            <div style={{ flex: 1 }} />
          </div>
        </div>
      </div>

      {/* ── Season Detail Modal ── */}
      {selectedSeason && (() => {
        const s = selectedSeason;
        const entries = (gameTab === "rhythm" ? s.rhythm : s.simon) || [];
        const top10 = entries.slice(0, 10);
        const myRank = address ? entries.findIndex(e => e.player.toLowerCase() === address.toLowerCase()) + 1 : 0;
        const startDate = new Date(s.startTs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const endDate = new Date(s.endTs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return (
          <div onClick={() => setSelectedSeason(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 100,
              background: "rgba(4,0,20,0.78)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "20px",
            }}
          >
            <div onClick={e => e.stopPropagation()} style={{
              width: "100%", maxWidth: "440px", maxHeight: "88vh",
              borderRadius: "24px",
              background: "#1a0550", paddingBottom: "6px",
              boxShadow: "0 0 0 3px #5b21b6, 0 0 50px rgba(109,40,217,0.5), 0 30px 60px rgba(0,0,0,0.9)",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{
                flex: 1, minHeight: 0,
                borderRadius: "22px 22px 18px 18px",
                background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 50%, #07021a 100%)",
                border: "2px solid rgba(255,255,255,0.12)",
                display: "flex", flexDirection: "column", overflow: "hidden",
              }}>
                {/* Header */}
                <div style={{
                  padding: "16px 18px",
                  borderBottom: "1px solid rgba(167,139,250,0.18)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "linear-gradient(180deg, rgba(167,139,250,0.1) 0%, transparent 100%)",
                }}>
                  <div>
                    <div style={{ color: "white", fontSize: "16px", fontWeight: 900, letterSpacing: "0.06em" }}>
                      SEASON {s.season}
                    </div>
                    <div style={{ color: "rgba(200,180,255,0.55)", fontSize: "10px", fontWeight: 700, marginTop: "2px" }}>
                      {startDate} – {endDate} · {gameTab === "rhythm" ? "RHYTHM RUSH" : "SIMON MEMORY"}
                    </div>
                  </div>
                  <button onClick={() => setSelectedSeason(null)} style={{
                    width: "32px", height: "32px", borderRadius: "50%",
                    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                    color: "rgba(200,180,255,0.7)", fontSize: "16px", cursor: "pointer", fontFamily: "inherit",
                  }}>×</button>
                </div>

                {/* Stats strip */}
                <div style={{
                  padding: "10px 18px",
                  display: "flex", justifyContent: "space-between", gap: "8px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}>
                  <div>
                    <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.12em" }}>PLAYERS</div>
                    <div style={{ color: "#a78bfa", fontSize: "14px", fontWeight: 900 }}>{s.totalPlayers || entries.length}</div>
                  </div>
                  <div>
                    <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.12em" }}>POOL</div>
                    <div style={{ color: "#fbbf24", fontSize: "14px", fontWeight: 900 }}>{s.prizePot || 50} G$</div>
                  </div>
                  {myRank > 0 && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.12em" }}>YOUR FINISH</div>
                      <div style={{
                        color: myRank <= 3 ? (myRank === 1 ? "#fbbf24" : myRank === 2 ? "#e2e8f0" : "#f97316") : "#a78bfa",
                        fontSize: "14px", fontWeight: 900,
                      }}>#{myRank}</div>
                    </div>
                  )}
                </div>

                {/* Top 10 list */}
                <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
                  {top10.length === 0 ? (
                    <div style={{ padding: "30px", textAlign: "center", color: "rgba(200,180,255,0.5)", fontSize: "11px" }}>
                      No scores recorded for this season
                    </div>
                  ) : top10.map((e, i) => {
                    const rank = i + 1;
                    const isMe = !!address && e.player.toLowerCase() === address.toLowerCase();
                    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
                    const medalColor = rank === 1 ? "#fbbf24" : rank === 2 ? "#e2e8f0" : rank === 3 ? "#f97316" : null;
                    return (
                      <div key={e.player} style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "8px 10px", borderRadius: "10px",
                        background: isMe ? "rgba(167,139,250,0.15)" : "transparent",
                        border: `1px solid ${isMe ? "rgba(167,139,250,0.4)" : "transparent"}`,
                        marginBottom: "4px",
                      }}>
                        <div style={{
                          minWidth: "26px", textAlign: "center",
                          color: medalColor || "rgba(200,180,255,0.6)",
                          fontSize: medal ? "16px" : "11px", fontWeight: 900,
                        }}>{medal || `#${rank}`}</div>
                        <div style={{
                          width: "30px", height: "30px", borderRadius: "50%",
                          border: "1.5px solid rgba(167,139,250,0.4)", flexShrink: 0, overflow: "hidden",
                          background: "#1a0550",
                        }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={avatarUrl(e.player, e.username)} alt="" width={30} height={30}
                            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                        <div style={{
                          flex: 1, minWidth: 0, color: isMe ? "#a78bfa" : "white", fontSize: "12px", fontWeight: 800,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                        }}>
                          {isMe ? "YOU" : fmtName(e.player, e.username)}
                        </div>
                        <div style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 900, flexShrink: 0 }}>
                          {e.score}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Event Detail Modal — same pattern as Season Detail Modal ── */}
      {selectedEvent && (() => {
        const isChallenge = selectedEvent.type === "challenge";
        const name = isChallenge ? selectedEvent.data.name : selectedEvent.data.name;
        const endsAt = isChallenge ? selectedEvent.data.ends_at : selectedEvent.data.ends_at;
        const endDate = new Date(endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        type AnyWinner = { rank: number; wallet: string; username: string | null; plays?: number; total?: number; totalRhythm?: number; totalSimon?: number };
        const winners: AnyWinner[] = isChallenge ? selectedEvent.data.winners : selectedEvent.data.winners;
        const prizeFor = (rank: number) =>
          isChallenge
            ? selectedEvent.data.prize_usdc
            : rank === 1 ? selectedEvent.data.prizes.first : rank === 2 ? selectedEvent.data.prizes.second : selectedEvent.data.prizes.third;
        const scoreLabel = isChallenge ? "plays" : "pts";
        const scoreOf = (w: AnyWinner) => isChallenge ? (w.plays ?? 0) : (w.total ?? 0);
        const subLabel = (w: AnyWinner) =>
          !isChallenge && w.totalRhythm != null
            ? `🥁 ${w.totalRhythm} + 🧠 ${w.totalSimon}`
            : isChallenge ? `${selectedEvent.data.min_plays} plays to qualify` : "";
        const rankColor = (r: number) => r === 1 ? "#fbbf24" : r === 2 ? "#e2e8f0" : r === 3 ? "#f97316" : "#a78bfa";
        const rankMedal = (r: number) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "🏅";
        return (
          <div onClick={() => setSelectedEvent(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 100,
              background: "rgba(4,0,20,0.78)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "20px",
            }}
          >
            <div onClick={e => e.stopPropagation()} style={{
              width: "100%", maxWidth: "440px", maxHeight: "88vh",
              borderRadius: "24px",
              background: "#1a0520", paddingBottom: "6px",
              boxShadow: "0 0 0 3px #92400e, 0 0 50px rgba(251,191,36,0.35), 0 30px 60px rgba(0,0,0,0.9)",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{
                flex: 1, minHeight: 0,
                borderRadius: "22px 22px 18px 18px",
                background: "linear-gradient(180deg, #2a1000 0%, #13060a 50%, #07021a 100%)",
                border: "2px solid rgba(251,191,36,0.2)",
                display: "flex", flexDirection: "column", overflow: "hidden",
              }}>
                {/* Header */}
                <div style={{
                  padding: "16px 18px",
                  borderBottom: "1px solid rgba(251,191,36,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "linear-gradient(180deg, rgba(251,191,36,0.08) 0%, transparent 100%)",
                }}>
                  <div>
                    <div style={{ color: "#fbbf24", fontSize: "16px", fontWeight: 900, letterSpacing: "0.06em" }}>
                      {name.toUpperCase()}
                    </div>
                    <div style={{ color: "rgba(254,215,170,0.55)", fontSize: "10px", fontWeight: 700, marginTop: "2px" }}>
                      ENDED {endDate}
                    </div>
                  </div>
                  <button onClick={() => setSelectedEvent(null)} style={{
                    width: "32px", height: "32px", borderRadius: "50%",
                    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                    color: "rgba(255,255,255,0.7)", fontSize: "16px", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✕</button>
                </div>
                {/* Finalists list */}
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "7px" }}>
                  <div style={{ color: "rgba(254,215,170,0.6)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.18em", marginBottom: "4px" }}>
                    FINAL STANDINGS · {winners.length} {isChallenge ? "QUALIFIER" : "FINALIST"}{winners.length !== 1 ? "S" : ""}
                  </div>
                  {winners.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", color: "rgba(200,180,255,0.4)", fontSize: "11px", fontWeight: 700 }}>
                      No results recorded
                    </div>
                  ) : winners.map(w => {
                    const isMe = !!address && w.wallet.toLowerCase() === address.toLowerCase();
                    const rc = rankColor(w.rank);
                    const rm = rankMedal(w.rank);
                    const sub = subLabel(w);
                    return (
                      <div key={w.wallet} style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 12px", borderRadius: "12px",
                        background: isMe ? `${rc}18` : w.rank <= 3 ? `${rc}0d` : "rgba(255,255,255,0.03)",
                        border: isMe ? `1.5px solid ${rc}77` : `1px solid ${w.rank <= 3 ? rc + "33" : "rgba(255,255,255,0.07)"}`,
                      }}>
                        <span style={{ fontSize: "18px", flexShrink: 0 }}>{rm}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: isMe ? rc : "white", fontSize: "13px", fontWeight: isMe ? 900 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {isMe ? "YOU" : (w.username || `${w.wallet.slice(0, 4)}…${w.wallet.slice(-3)}`)}
                          </div>
                          {sub && (
                            <div style={{ color: "rgba(200,180,255,0.5)", fontSize: "9px", fontWeight: 700, marginTop: "2px" }}>
                              {sub}
                            </div>
                          )}
                          <div style={{ color: "rgba(200,180,255,0.5)", fontSize: "9px", fontWeight: 700, marginTop: "1px" }}>
                            RANK #{w.rank} · ${prizeFor(w.rank)} USDC
                          </div>
                        </div>
                        <div style={{ color: rc, fontSize: "14px", fontWeight: 900, textShadow: `0 0 8px ${rc}88`, flexShrink: 0 }}>
                          {scoreOf(w)} {scoreLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Mobile bottom tab nav — replaces the desktop sidebar when < 768px */}
      {isMobile && <BottomNav />}

      {/* Mobile streak chip — sidebar is hidden on mobile so this floats
          top-right instead. */}
      {isMobile && streak && (
        <MobileStreakChip streak={streak.streak} playedToday={streak.playedToday} />
      )}
    </div>
  );
}

// useSearchParams requires a Suspense boundary in the app router, matching
// the pattern used on /verify and /mint elsewhere in this app.
export default function LeaderboardPage() {
  return (
    <Suspense>
      <LeaderboardInner />
    </Suspense>
  );
}