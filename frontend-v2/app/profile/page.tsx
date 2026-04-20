"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract } from "wagmi";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import { playCoin, playTabSwitch } from "@/hooks/useAppAudio";
import { useIsMobile } from "@/hooks/useIsMobile";
import BottomNav from "@/components/BottomNav";
import MobileStreakChip from "@/components/MobileStreakChip";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// GamePass NFT — source of truth for username, games played, best score
const GAME_PASS_ADDRESS = (process.env.NEXT_PUBLIC_GAME_PASS || "0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE") as `0x${string}`;
const GAME_PASS_ABI = [
  { name: "getUsername", inputs: [{ type: "address" }], outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
  { name: "gamesPlayed", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { name: "bestScore", inputs: [{ type: "address" }, { type: "uint8" }], outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { name: "weeklyBest", inputs: [{ type: "address" }, { type: "uint8" }], outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { name: "hasMinted", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
] as const;

// Badge from backend /api/badges/:address
type ApiBadge = { season: number; game: string; rank: number; type: "gold" | "silver" | "bronze"; awardedAt: number };
type BadgeData = {
  badges: ApiBadge[];
  summary: { totalGold: number; totalSilver: number; totalBronze: number; streakLabel: string | null };
};

// ─── Splash icons ──────────────────────────────────────────────────────────────
const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";
const V = "/splash_screen_icons/vending.png";

// Desktop decoratives — curated 3+3 at edges. Matches other pages.
const LEFT_ICONS = [
  { src: D, top: "2%",  left: "-22px", size: 110, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18, opacity: 0.8 },
  { src: J, top: "48%", left: "-14px", size: 90,  delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8,  opacity: 0.65 },
  { src: G, top: "82%", left: "-10px", size: 100, delay: 2.8, dur: 5.0, glow: "#aa88ff", rotate: -14, opacity: 0.7 },
];
const RIGHT_ICONS = [
  { src: D, top: "4%",  right: "-24px", size: 100, delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20,  opacity: 0.75 },
  { src: V, top: "44%", right: "-8px",  size: 105, delay: 2.0, dur: 6.2, glow: "#ff44cc", rotate: -4,  opacity: 0.65 },
  { src: M, top: "80%", right: "-6px",  size: 86,  delay: 0.6, dur: 4.0, glow: "#ffaa00", rotate: -16, opacity: 0.7 },
];

// Mobile decoratives — 3+3 tucked past the viewport edges.
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
  { src: D, top: "6%",  left: "-24px", size: 60, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18, opacity: 0.45 },
  { src: J, top: "48%", left: "-22px", size: 54, delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8,  opacity: 0.4  },
  { src: G, top: "84%", left: "-18px", size: 58, delay: 2.8, dur: 5.0, glow: "#aa88ff", rotate: -14, opacity: 0.4  },
];
const MOBILE_RIGHT_ICONS: MobileIcon[] = [
  { src: D, top: "10%", right: "-26px", size: 58, delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20,  opacity: 0.45 },
  { src: V, top: "52%", right: "-20px", size: 62, delay: 2.0, dur: 6.2, glow: "#ff44cc", rotate: -4,  opacity: 0.4  },
  { src: M, top: "86%", right: "-18px", size: 52, delay: 0.6, dur: 4.0, glow: "#ffaa00", rotate: -16, opacity: 0.45 },
];

const NAV_ITEMS = [
  { label: "Home", path: "/home", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg> },
  { label: "Games", path: "/games", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3a1 1 0 00-1 1v10a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zm-10 7H9v2H7v-2H5v-2h2V9h2v2h2v2zm4.5 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-3a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" /></svg> },
  { label: "Leaderboard", path: "/leaderboard", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21H5a2 2 0 01-2-2v-7a2 2 0 012-2h6v11zm2 0V6a2 2 0 012-2h4a2 2 0 012 2v13h-8z" /></svg> },
  { label: "Profile", path: "/profile", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" /></svg> },
];

// DiceBear avatar — unique face per wallet (matches leaderboard rows)
function avatarUrl(address: string, username?: string | null) {
  const seed = `${username || ""}-${address}`;
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&backgroundColor=ffdfbf,ffd5dc,c0aede,b6e3f4,d1d4f9`;
}

// Rank tier system — Clash Royale / LoL inspired metallic tiers
type Tier = { name: string; color: string; ringGrad: string };
const TIERS: Tier[] = [
  { name: "BRONZE", color: "#cd7f32", ringGrad: "conic-gradient(from 0deg, #cd7f32, #8b4513, #f0a060, #cd7f32)" },
  { name: "SILVER", color: "#c0c0c0", ringGrad: "conic-gradient(from 0deg, #f1f5f9, #94a3b8, #e2e8f0, #f1f5f9)" },
  { name: "GOLD", color: "#fbbf24", ringGrad: "conic-gradient(from 0deg, #fde68a, #d97706, #fef3c7, #fde68a)" },
  { name: "PLATINUM", color: "#67e8f9", ringGrad: "conic-gradient(from 0deg, #a5f3fc, #0e7490, #cffafe, #a5f3fc)" },
  { name: "DIAMOND", color: "#a78bfa", ringGrad: "conic-gradient(from 0deg, #c4b5fd, #6d28d9, #ddd6fe, #c4b5fd)" },
  { name: "MASTER", color: "#f472b6", ringGrad: "conic-gradient(from 0deg, #f9a8d4, #be185d, #fce7f3, #f9a8d4)" },
];
// Tier pyramid (elite tiers stay rare):
//   #1 = MASTER, #2-3 = DIAMOND, #4-6 = PLATINUM, #7-15 = GOLD, #16-50 = SILVER, #51+ = BRONZE
function tierFromRank(rank: number): { tier: Tier; division: string } {
  if (rank === 1) return { tier: TIERS[5], division: "I" };
  if (rank <= 3) return { tier: TIERS[4], division: rank === 2 ? "I" : "II" };
  if (rank <= 6) return { tier: TIERS[3], division: rank === 4 ? "I" : rank === 5 ? "II" : "III" };
  if (rank <= 15) return { tier: TIERS[2], division: rank <= 9 ? "I" : rank <= 12 ? "II" : "III" };
  if (rank <= 50) return { tier: TIERS[1], division: rank <= 25 ? "I" : rank <= 38 ? "II" : "III" };
  return { tier: TIERS[0], division: rank <= 100 ? "I" : rank <= 200 ? "II" : "III" };
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "stats", label: "STATS", icon: "📊" },
  { id: "matches", label: "MATCHES", icon: "⚔️" },
  { id: "achievements", label: "TROPHIES", icon: "🏆" },
  { id: "settings", label: "SETTINGS", icon: "⚙️" },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Match types & helpers ────────────────────────────────────────────────────
type ActivityRow = { player: string; game: string; score: number; tx_hash: string; timestamp: number; username?: string | null };

// Win threshold per game (matches the wager contract logic)
const WIN_THRESHOLD: Record<string, number> = { rhythm: 350, simon: 7 };

function timeAgo(ts: number) {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const GAME_DISPLAY: Record<string, { name: string; icon: string }> = {
  rhythm: { name: "Rhythm Rush", icon: "🥁" },
  simon: { name: "Simon Memory", icon: "🧠" },
};

// All achievements use the gold reward color. Locked = grayscale.
const ACHIEVEMENT_COLOR = "#fbbf24";

// ─── Pet evolution stages ─────────────────────────────────────────────────────
// Each stage unlocks at a level threshold. Pet image lives on profile hero card +
// mini chip in sidebar. Evolution moments are huge dopamine hooks (Adopt Me / Tamagotchi pattern).
type PetStage = { id: string; name: string; src: string; minLevel: number; nextAt: number | null; color: string };
const PET_STAGES: PetStage[] = [
  { id: "egg", name: "Mystery Egg", src: "/pets/stage-1-egg.png", minLevel: 1, nextAt: 5, color: "#e2e8f0" },
  { id: "baby", name: "Baby Slime", src: "/pets/stage-2-baby.png", minLevel: 5, nextAt: 15, color: "#22c55e" },
  { id: "teen", name: "Teen Slime", src: "/pets/stage-3-teen.png", minLevel: 15, nextAt: 30, color: "#a78bfa" },
  { id: "crystal", name: "Crystal Slime", src: "/pets/stage-4-crystal.png", minLevel: 30, nextAt: 50, color: "#06b6d4" },
  { id: "king", name: "King Slime", src: "/pets/stage-5-king.png", minLevel: 50, nextAt: null, color: "#fbbf24" },
];
function petForLevel(level: number): PetStage {
  let stage = PET_STAGES[0];
  for (const s of PET_STAGES) if (level >= s.minLevel) stage = s;
  return stage;
}

type Achievement = {
  id: string; icon: string; name: string; desc: string;
  unlocked: boolean; unlockedAt: number | null;
  nftTokenId: number | null; txHash: string | null;
};

// ─── Juicy Button ─────────────────────────────────────────────────────────────
function JuicyBtn({
  label, wallColor, faceGrad, glowColor, onClick, fullWidth, fontSize = 13, padding = "11px 18px",
}: {
  label: string; wallColor: string; faceGrad: string; glowColor: string;
  onClick?: () => void; fullWidth?: boolean; fontSize?: number; padding?: string;
}) {
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      style={{ cursor: "pointer", userSelect: "none", width: fullWidth ? "100%" : "auto" }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97) translateY(3px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{ borderRadius: "14px", background: wallColor, paddingBottom: "5px", boxShadow: `0 10px 24px -4px ${glowColor}` }}>
        <div style={{
          borderRadius: "12px 12px 10px 10px", background: faceGrad,
          padding, textAlign: "center", position: "relative", overflow: "hidden",
          border: "2px solid rgba(255,255,255,0.45)",
          boxShadow: "inset 0 6px 14px rgba(255,255,255,0.65), inset 0 -3px 6px rgba(0,0,0,0.3)",
        }}>
          <div style={{
            position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)",
            borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
          }} />
          <span style={{ color: "white", fontSize, fontWeight: 900, letterSpacing: "0.14em", position: "relative", zIndex: 1 }}>
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Pill Tab (matches leaderboard) ────────────────────────────────────────────
function PillTab({ label, icon, active, onClick, compact = false, iconOnly = false }: {
  label: string; icon: string; active: boolean; onClick: () => void;
  // compact: tighter padding + smaller text for mobile where 4 pills fight
  // for a 360px viewport. iconOnly: drop the label entirely (e.g. SETTINGS
  // reads as a gear icon — utility signal, distinct from primary tabs).
  compact?: boolean; iconOnly?: boolean;
}) {
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      aria-label={iconOnly ? label : undefined}
      // Opt out of global UI click blip — the tab-switch tick fires from the
      // onClick handler instead (only on actual tab change, not same-tab taps)
      data-no-click-sound="true"
      style={{ cursor: "pointer", userSelect: "none", flex: "0 0 auto", transition: "transform 0.15s" }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.95) translateY(2px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{
        borderRadius: "999px",
        background: active ? "#083a6b" : "#1a0550",
        paddingBottom: compact ? "4px" : "5px",
        boxShadow: active
          ? "0 0 0 2px #3b82f6, 0 0 20px rgba(59,130,246,0.7), 0 0 40px rgba(59,130,246,0.5), 0 10px 24px -4px rgba(59,130,246,0.7)"
          : "0 6px 16px -4px rgba(0,0,0,0.5)",
        transition: "all 0.2s",
      }}>
        <div style={{
          borderRadius: "999px",
          background: active ? "linear-gradient(180deg, #60a5fa 0%, #2563eb 50%, #1e40af 100%)" : "linear-gradient(180deg, #3b1fa3 0%, #1e0762 100%)",
          padding: iconOnly ? "7px 9px" : compact ? "7px 11px" : "9px 18px",
          textAlign: "center",
          position: "relative", overflow: "hidden",
          border: active ? "2px solid rgba(255,255,255,0.5)" : "2px solid rgba(255,255,255,0.12)",
          boxShadow: active
            ? "inset 0 6px 14px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.35)"
            : "inset 0 3px 8px rgba(255,255,255,0.06), inset 0 -2px 5px rgba(0,0,0,0.35)",
          display: "flex", alignItems: "center", gap: iconOnly ? 0 : compact ? "5px" : "7px",
        }}>
          {active && (
            <div style={{
              position: "absolute", top: "2px", left: "6%", right: "6%", height: "46%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)",
              borderRadius: "999px", pointerEvents: "none",
            }} />
          )}
          <span style={{ position: "relative", zIndex: 1, fontSize: compact ? "14px" : "13px" }}>{icon}</span>
          {!iconOnly && (
            <span style={{
              position: "relative", zIndex: 1,
              color: active ? "white" : "rgba(220,200,255,0.6)",
              fontSize: compact ? "10px" : "11px",
              fontWeight: 900, letterSpacing: compact ? "0.08em" : "0.1em",
              textShadow: active ? "0 2px 4px rgba(0,0,0,0.4)" : "none",
            }}>{label}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stat Gem ──────────────────────────────────────────────────────────────────
function StatGem({ value, label, color, wall }: { value: string; label: string; color: string; wall: string }) {
  return (
    <div style={{
      borderRadius: "16px", background: wall, paddingBottom: "5px",
      boxShadow: `0 8px 22px -4px ${color}88, 0 0 0 1.5px ${color}88, 0 0 24px ${color}33`,
    }}>
      <div style={{
        borderRadius: "14px 14px 11px 11px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.3) 100%)",
        padding: "12px 8px 10px", textAlign: "center",
        border: `1.5px solid ${color}55`, position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: 0, left: "8%", right: "8%", height: "45%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)",
          borderRadius: "14px 14px 60px 60px", pointerEvents: "none",
        }} />
        <div style={{
          position: "relative", zIndex: 1,
          fontSize: "20px", fontWeight: 900, color, lineHeight: 1,
          textShadow: `0 0 16px ${color}, 0 2px 4px rgba(0,0,0,0.6)`,
        }}>{value}</div>
        <div style={{
          position: "relative", zIndex: 1,
          fontSize: "8px", fontWeight: 800, color: "rgba(200,180,255,0.6)",
          letterSpacing: "0.15em", marginTop: "6px",
        }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Toggle Switch (juicy) ─────────────────────────────────────────────────────
function ToggleSwitch({ on, color, onChange }: { on: boolean; color: string; onChange: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onChange}
      style={{
        width: "52px", height: "30px", borderRadius: "999px",
        background: on ? `linear-gradient(180deg, ${color} 0%, ${color}99 100%)` : "linear-gradient(180deg, #1a0550 0%, #07021a 100%)",
        border: "2px solid rgba(255,255,255,0.2)",
        boxShadow: on
          ? `0 0 14px ${color}88, inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.3)`
          : "inset 0 2px 6px rgba(0,0,0,0.6)",
        position: "relative", cursor: "pointer", transition: "all 0.2s",
      }}>
      <div style={{
        position: "absolute", top: "2px",
        left: on ? "24px" : "2px",
        width: "22px", height: "22px", borderRadius: "50%",
        background: on ? "linear-gradient(180deg, white 0%, #e5e7eb 100%)" : "linear-gradient(180deg, #6b7280 0%, #374151 100%)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.6)",
        transition: "left 0.2s, background 0.2s",
      }} />
    </div>
  );
}

// ─── Volume Slider (juicy) ─────────────────────────────────────────────────────
function VolumeSlider({ value, color, onChange }: { value: number; color: string; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
      <div style={{
        flex: 1, height: "10px", borderRadius: "999px",
        background: "rgba(0,0,0,0.5)",
        border: "1.5px solid rgba(160,100,255,0.25)",
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6)",
        position: "relative", cursor: "pointer", overflow: "hidden",
      }}
        onClick={e => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
          onChange(Math.round(pct));
        }}
      >
        <div style={{
          width: `${value}%`, height: "100%", borderRadius: "999px",
          background: `linear-gradient(90deg, ${color}aa 0%, ${color} 100%)`,
          boxShadow: `0 0 10px ${color}88, inset 0 2px 4px rgba(255,255,255,0.4)`,
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "55%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, transparent 100%)",
            borderRadius: "999px 999px 0 0", pointerEvents: "none",
          }} />
        </div>
      </div>
      <div style={{
        minWidth: "32px", textAlign: "right",
        color, fontSize: "11px", fontWeight: 900,
        textShadow: `0 0 8px ${color}88`,
      }}>{value}%</div>
    </div>
  );
}

// ─── Settings Row ──────────────────────────────────────────────────────────────
function SettingsRow({ icon, label, color, children }: { icon: string; label: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px",
      padding: "12px 14px",
      borderRadius: "14px",
      background: "linear-gradient(90deg, rgba(20,10,50,0.7) 0%, rgba(10,5,30,0.6) 100%)",
      border: `1.5px solid ${color}33`,
      boxShadow: `0 0 16px ${color}22`,
    }}>
      <div style={{
        width: "38px", height: "38px", borderRadius: "10px", flexShrink: 0,
        background: `radial-gradient(circle at 35% 30%, ${color}cc, ${color}44)`,
        border: `1.5px solid ${color}77`,
        boxShadow: `0 0 10px ${color}66`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "18px",
      }}>{icon}</div>
      <div style={{
        flex: 1, color: "white", fontSize: "12px", fontWeight: 800,
        letterSpacing: "0.06em",
      }}>{label}</div>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

// ─── Pet Slot — compact pet display that lives inside the trainer card ────────
function PetSlot({ pet, compact = false }: { pet: PetStage; compact?: boolean }) {
  const isEgg = pet.id === "egg";
  const [poking, setPoking] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);

  const phrases = isEgg
    ? ["It's warm.", "Cozy in here.", "Boop!", "I hear tapping!"]
    : ["Hi!", "Boop!", "Let's play!", "Squish!"];

  const handlePoke = () => {
    setPoking(false);
    requestAnimationFrame(() => setPoking(true));
    setBubble(phrases[Math.floor(Math.random() * phrases.length)]);
    setTimeout(() => setPoking(false), 600);
    setTimeout(() => setBubble(null), 1500);
  };

  const idleClass = poking ? "pet-poke" : (isEgg ? "egg-wobble" : "slime-idle");

  return (
    <div
      role="button" tabIndex={0} onClick={handlePoke}
      style={{
        flexShrink: 0,
        width: compact ? "82px" : "108px",
        height: compact ? "92px" : "118px",
        position: "relative",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        cursor: "pointer", userSelect: "none",
      }}
    >
      {bubble && (
        <div className="pet-bubble" style={{
          position: "absolute", top: "-10px", left: "50%", transform: "translateX(-50%)",
          padding: "4px 10px", borderRadius: "999px",
          background: "white",
          border: `1.5px solid ${pet.color}`,
          boxShadow: `0 4px 10px rgba(0,0,0,0.5)`,
          whiteSpace: "nowrap", zIndex: 5,
        }}>
          <span style={{ color: "#1a0550", fontSize: "9px", fontWeight: 900 }}>{bubble}</span>
          <div style={{
            position: "absolute", bottom: "-4px", left: "50%", transform: "translateX(-50%) rotate(45deg)",
            width: "7px", height: "7px",
            background: "white",
            borderRight: `1.5px solid ${pet.color}`,
            borderBottom: `1.5px solid ${pet.color}`,
          }} />
        </div>
      )}
      {/* Soft ground glow */}
      <div style={{
        position: "absolute", bottom: "0", left: "50%", transform: "translateX(-50%)",
        width: "85%", height: "16px",
        borderRadius: "50%",
        background: `radial-gradient(ellipse at 50% 50%, ${pet.color}88 0%, transparent 70%)`,
        filter: "blur(3px)",
      }} />
      <div className={idleClass} style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        pointerEvents: "none",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pet.src} alt={pet.name} draggable={false}
          style={{
            width: "100%", height: "100%", objectFit: "contain",
            filter: `drop-shadow(0 0 12px ${pet.color}aa) drop-shadow(0 6px 8px rgba(0,0,0,0.5))`,
          }} />
      </div>
    </div>
  );
}

// ─── Combined progress bar — XP fill + pet evolution context ──────────────────
function CombinedProgressBar({
  pet, playerLevel, xpCurrent, xpToNext, xpPct,
}: { pet: PetStage; playerLevel: number; xpCurrent: number; xpToNext: number; xpPct: number }) {
  const nextStage = pet.nextAt ? PET_STAGES.find(s => s.minLevel === pet.nextAt) : null;
  const levelsToEvolve = pet.nextAt ? Math.max(0, pet.nextAt - playerLevel) : 0;

  return (
    <div style={{ width: "100%", marginTop: "16px" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: "5px",
      }}>
        <span style={{ color: "rgba(200,180,255,0.7)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.12em" }}>
          {nextStage
            ? (levelsToEvolve === 0 ? `READY! ${pet.name.toUpperCase()} → ${nextStage.name.toUpperCase()}` : `XP TO LV.${playerLevel + 1} · PET EVOLVES AT LV.${pet.nextAt}`)
            : `XP TO LV.${playerLevel + 1} · ✨ PET MAXED`}
        </span>
        <span style={{ color: "#fbbf24", fontSize: "10px", fontWeight: 900, textShadow: "0 0 8px rgba(251,191,36,0.6)" }}>
          {xpCurrent}/{xpToNext}
        </span>
      </div>
      <div style={{
        height: "12px", borderRadius: "999px",
        background: "rgba(0,0,0,0.5)",
        border: "1.5px solid rgba(160,100,255,0.25)",
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6)",
        overflow: "hidden", position: "relative",
      }}>
        <div style={{
          width: `${xpPct}%`, height: "100%", borderRadius: "999px",
          background: nextStage
            ? `linear-gradient(90deg, ${pet.color} 0%, ${nextStage.color} 100%)`
            : `linear-gradient(90deg, #fbbf24 0%, #f97316 50%, ${pet.color} 100%)`,
          boxShadow: `0 0 12px ${pet.color}aa, inset 0 2px 4px rgba(255,255,255,0.4)`,
          transition: "width 0.3s",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "55%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, transparent 100%)",
            borderRadius: "999px 999px 0 0", pointerEvents: "none",
          }} />
        </div>
      </div>
    </div>
  );
}

// ─── (legacy) Standalone PetCard — kept temporarily, no longer rendered ───────
function PetCard({ pet, playerLevel }: { pet: PetStage; playerLevel: number }) {
  const nextStage = pet.nextAt ? PET_STAGES.find(s => s.minLevel === pet.nextAt) : null;
  const levelsToEvolve = pet.nextAt ? Math.max(0, pet.nextAt - playerLevel) : 0;
  const stageStart = pet.minLevel;
  const stageEnd = pet.nextAt ?? playerLevel;
  const stagePct = pet.nextAt
    ? Math.min(100, Math.round(((playerLevel - stageStart) / (stageEnd - stageStart)) * 100))
    : 100;

  const isEgg = pet.id === "egg";
  const [poking, setPoking] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);

  const phrases = isEgg
    ? (levelsToEvolve <= 1 ? ["Something stirs inside…", "It's shaking!", "Almost hatching!"]
      : levelsToEvolve <= 3 ? ["I hear tapping!", "Soon…", "Keep playing!"]
        : ["It's warm.", "Cozy in here.", "Play more games!", "Boop!"])
    : nextStage
      ? (levelsToEvolve === 0 ? ["Ready to evolve!", "I feel different…", "Big change coming!"]
        : levelsToEvolve <= 2 ? ["Almost there!", `Just ${levelsToEvolve} more!`, "Don't stop now!"]
          : ["Hi! Play more!", "Let's level up!", "Boop!", `${levelsToEvolve} levels to go!`])
      : ["I'm the king! 👑", "Bow before me!", "Maxed out!", "Boop!"];

  const handlePoke = () => {
    setPoking(false);
    requestAnimationFrame(() => setPoking(true));
    setBubble(phrases[Math.floor(Math.random() * phrases.length)]);
    setTimeout(() => setPoking(false), 600);
    setTimeout(() => setBubble(null), 1800);
  };

  const idleClass = poking ? "pet-poke" : (isEgg ? "egg-wobble" : "slime-idle");

  return (
    <div style={{
      width: "100%", maxWidth: "640px", flexShrink: 0,
      borderRadius: "22px", padding: "2.5px",
      background: `linear-gradient(180deg, ${pet.color} 0%, ${pet.color}55 100%)`,
      boxShadow: `0 0 24px ${pet.color}55, 0 12px 30px rgba(0,0,0,0.7)`,
    }}>
      <div style={{
        borderRadius: "20px",
        background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 50%, #07021a 100%)",
        padding: "18px 20px",
        display: "flex", flexDirection: "column", alignItems: "center",
        position: "relative",
      }}>
        {/* Top label pill */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "5px",
          padding: "2px 10px", borderRadius: "999px",
          background: `${pet.color}1a`, border: `1px solid ${pet.color}66`,
          marginBottom: "10px",
        }}>
          <span style={{ color: pet.color, fontSize: "9px", fontWeight: 900, letterSpacing: "0.16em" }}>YOUR PET</span>
        </div>

        {/* Pet — centered, big, tap to interact */}
        <div
          role="button" tabIndex={0} onClick={handlePoke}
          style={{
            width: "140px", height: "140px",
            position: "relative",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            cursor: "pointer", userSelect: "none",
          }}
        >
          {/* Speech bubble on poke */}
          {bubble && (
            <div className="pet-bubble" style={{
              position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)",
              padding: "5px 12px", borderRadius: "999px",
              background: "white",
              border: `1.5px solid ${pet.color}`,
              boxShadow: `0 4px 12px rgba(0,0,0,0.5), 0 0 14px ${pet.color}55`,
              whiteSpace: "nowrap", zIndex: 5,
            }}>
              <span style={{ color: "#1a0550", fontSize: "10px", fontWeight: 900, letterSpacing: "0.04em" }}>{bubble}</span>
              <div style={{
                position: "absolute", bottom: "-5px", left: "50%", transform: "translateX(-50%) rotate(45deg)",
                width: "8px", height: "8px",
                background: "white",
                borderRight: `1.5px solid ${pet.color}`,
                borderBottom: `1.5px solid ${pet.color}`,
              }} />
            </div>
          )}

          {/* Subtle ground glow */}
          <div style={{
            position: "absolute", bottom: "-4px", left: "50%", transform: "translateX(-50%)",
            width: "80%", height: "18px",
            borderRadius: "50%",
            background: `radial-gradient(ellipse at 50% 50%, ${pet.color}66 0%, transparent 70%)`,
            filter: "blur(4px)",
            zIndex: 0,
          }} />

          {/* Pet image */}
          <div className={idleClass} style={{
            width: "100%", height: "100%", position: "relative", zIndex: 1,
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            pointerEvents: "none",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pet.src}
              alt={pet.name}
              draggable={false}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                filter: `drop-shadow(0 0 14px ${pet.color}aa) drop-shadow(0 6px 8px rgba(0,0,0,0.5))`,
              }}
            />
          </div>
        </div>

        {/* Name — centered under pet */}
        <div style={{
          color: "white", fontSize: "18px", fontWeight: 900,
          letterSpacing: "0.04em", textShadow: `0 0 14px ${pet.color}aa`,
          marginTop: "12px", textAlign: "center",
        }}>{pet.name}</div>

        <div style={{
          color: "rgba(200,180,255,0.55)", fontSize: "10px", fontWeight: 700,
          letterSpacing: "0.08em", marginTop: "2px",
        }}>
          Stage {PET_STAGES.findIndex(s => s.id === pet.id) + 1} of {PET_STAGES.length} · LV.{playerLevel}
        </div>

        {/* Progress bar — evolution */}
        {nextStage ? (
          <div style={{ width: "100%", maxWidth: "320px", marginTop: "12px" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginBottom: "5px",
            }}>
              <span style={{ color: "rgba(200,180,255,0.65)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.1em" }}>
                {levelsToEvolve === 0 ? "READY TO EVOLVE" : `NEXT: ${nextStage.name.toUpperCase()}`}
              </span>
              <span style={{ color: pet.color, fontSize: "10px", fontWeight: 900 }}>
                {levelsToEvolve === 0 ? "✨" : `${levelsToEvolve} LV`}
              </span>
            </div>
            <div style={{
              height: "8px", borderRadius: "999px",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(167,139,250,0.18)",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${stagePct}%`, height: "100%", borderRadius: "999px",
                background: `linear-gradient(90deg, ${pet.color} 0%, ${nextStage.color} 100%)`,
                boxShadow: `0 0 8px ${pet.color}88`, transition: "width 0.3s",
              }} />
            </div>
          </div>
        ) : (
          <div style={{
            color: "#fbbf24", fontSize: "12px", fontWeight: 900,
            letterSpacing: "0.14em", marginTop: "12px",
            textShadow: "0 0 12px rgba(251,191,36,0.7)",
          }}>
            ✨ MAX EVOLUTION REACHED
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const router = useRouter();
  const { logout, authenticated } = usePrivy();
  // Mobile swaps the 68px left sidebar for a fixed bottom tab bar.
  const isMobile = useIsMobile();
  const { address } = useAccount();
  const { isVerified, entitlement, claimG$ } = useSelfVerification();

  const [activeTab, setActiveTab] = useState<TabId>("stats");

  // Settings — persisted in localStorage via useAudioSettings hook.
  // Every game on the platform reads from the same source, so changes here
  // take effect immediately the next time the player starts a round.
  const { musicOn, sfxOn, appAudioOn, musicVol, sfxVol, appAudioVol, notifOn, hapticsOn, update: updateSettings } = useAudioSettings();
  const setMusicOn = (v: boolean) => updateSettings({ musicOn: v });
  const setSfxOn = (v: boolean) => updateSettings({ sfxOn: v });
  const setAppAudioOn = (v: boolean) => updateSettings({ appAudioOn: v });
  const setMusicVol = (v: number) => updateSettings({ musicVol: v });
  const setSfxVol = (v: number) => updateSettings({ sfxVol: v });
  const setAppAudioVol = (v: number) => updateSettings({ appAudioVol: v });
  const setNotifOn = (v: boolean) => updateSettings({ notifOn: v });
  const setHapticsOn = (v: boolean) => updateSettings({ hapticsOn: v });

  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";

  // Read real on-chain stats from GamePass NFT
  const { data: onchainUsername } = useReadContract({
    address: GAME_PASS_ADDRESS, abi: GAME_PASS_ABI, functionName: "getUsername",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const { data: gamesPlayedRaw } = useReadContract({
    address: GAME_PASS_ADDRESS, abi: GAME_PASS_ABI, functionName: "gamesPlayed",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const { data: rhythmBest } = useReadContract({
    address: GAME_PASS_ADDRESS, abi: GAME_PASS_ABI, functionName: "bestScore",
    args: address ? [address, 0] : undefined, query: { enabled: !!address },
  });
  const { data: simonBest } = useReadContract({
    address: GAME_PASS_ADDRESS, abi: GAME_PASS_ABI, functionName: "bestScore",
    args: address ? [address, 1] : undefined, query: { enabled: !!address },
  });

  const username = (onchainUsername as string) || "Player";
  const totalGames = Number(gamesPlayedRaw || 0);

  // Real XP / Level from backend (Phase 2). Falls back to derived value while loading.
  const [userMeta, setUserMeta] = useState<{ xp: number; level: number; xpInLevel: number; xpToNext: number } | null>(null);
  useEffect(() => {
    if (!address) { setUserMeta(null); return; }
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.json())
      .then(d => setUserMeta({ xp: d.xp || 0, level: d.level || 1, xpInLevel: d.xpInLevel || 0, xpToNext: d.xpToNext || 100 }))
      .catch(() => setUserMeta(null));
  }, [address]);

  const playerLevel = userMeta?.level ?? 1;
  const xpCurrent = userMeta?.xpInLevel ?? 0;
  const xpToNext = userMeta?.xpToNext ?? 100;
  const xpPct = Math.round((xpCurrent / xpToNext) * 100);
  // Fetch player's real leaderboard rank — best across both games
  const [playerRank, setPlayerRank] = useState<number>(0);
  useEffect(() => {
    if (!address) { setPlayerRank(0); return; }
    Promise.all([
      fetch(`${BACKEND_URL}/api/leaderboard?game=rhythm&offset=0&limit=500`).then(r => r.json()).catch(() => ({ leaderboard: [] })),
      fetch(`${BACKEND_URL}/api/leaderboard?game=simon&offset=0&limit=500`).then(r => r.json()).catch(() => ({ leaderboard: [] })),
    ]).then(([rh, sm]) => {
      const findRank = (data: { leaderboard?: { player: string }[] }) => {
        const i = (data.leaderboard || []).findIndex(e => e.player.toLowerCase() === address.toLowerCase());
        return i >= 0 ? i + 1 : 0;
      };
      const ranks = [findRank(rh), findRank(sm)].filter(r => r > 0);
      setPlayerRank(ranks.length ? Math.min(...ranks) : 0);
    });
  }, [address]);

  const { tier, division } = tierFromRank(playerRank || 9999);

  // Fetch real championship badges from backend
  const [badgeData, setBadgeData] = useState<BadgeData | null>(null);
  useEffect(() => {
    if (!address) { setBadgeData(null); return; }
    fetch(`${BACKEND_URL}/api/badges/${address}`)
      .then(r => r.json())
      .then(data => setBadgeData({ badges: data.badges || [], summary: data.summary || {} }))
      .catch(() => setBadgeData(null));
  }, [address]);

  // Fetch milestone achievements (off-chain for now; NFT minting comes later)
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  useEffect(() => {
    if (!address) { setAchievements([]); return; }
    fetch(`${BACKEND_URL}/api/achievements/${address}`)
      .then(r => r.json())
      .then(d => setAchievements(d.achievements || []))
      .catch(() => setAchievements([]));
  }, [address]);

  // Fetch streak (for sidebar chip)
  const [streak, setStreak] = useState<{ streak: number; playedToday: boolean } | null>(null);
  useEffect(() => {
    if (!address) { setStreak(null); return; }
    fetch(`${BACKEND_URL}/api/streak/${address}`)
      .then(r => r.json())
      .then(d => setStreak({ streak: d.streak || 0, playedToday: !!d.playedToday }))
      .catch(() => setStreak(null));
  }, [address]);

  // Fetch this player's recent matches. Passes ?player=... so the backend
  // scopes the query server-side — no client-side filtering, no risk of
  // showing other players' rows if the list is mis-shaped. We also keep a
  // defensive client-side filter in case the backend hasn't been redeployed
  // with the new query param yet (old backend ignores ?player= and returns
  // global rows, which without this filter would show other players).
  const [matches, setMatches] = useState<ActivityRow[]>([]);
  useEffect(() => {
    if (!address) { setMatches([]); return; }
    const lower = address.toLowerCase();
    fetch(`${BACKEND_URL}/api/activity?player=${address}`)
      .then(r => r.json())
      .then(d => {
        const list: ActivityRow[] = d.activity || [];
        const mine = list.filter(a => (a.player || "").toLowerCase() === lower).slice(0, 8);
        setMatches(mine);
      })
      .catch(() => setMatches([]));
  }, [address]);

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "radial-gradient(ellipse 80% 60% at 50% 15%, #6a18c8 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Floating bg icons — split by breakpoint via CSS. No SSR flash. */}
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

      {/* Body row: sidebar + center (sidebar hidden on mobile, BottomNav
          renders at the bottom of the page instead) */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative", zIndex: 2 }}>

        {/* Sidebar — desktop only */}
        {!isMobile && <div style={{
          width: "68px", flexShrink: 0, alignSelf: "stretch",
          background: "rgba(4,1,18,0.95)", borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "16px 0", gap: "6px",
        }}>
          {/* Streak chip — two clear states with universal game-language signals:
              • PLAYED TODAY: warm orange flame, gold number, full glow. Alive.
              • NOT PLAYED: FROZEN. hue-rotate turns the 🔥 glyph cool blue,
                icy cyan border + ice-blue number + subtle blue glow. Reads as
                "your streak is on ice — play today to thaw it". Duolingo's
                streak freeze uses the same warm-vs-cold visual contrast —
                universally readable. Number stays equally visible so the
                player never loses sight of their count. */}
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
                // hue-rotate 190deg turns the orange 🔥 glyph into cool blue —
                // the "frozen flame" trope. Classic game language for "your
                // streak is paused, not dead".
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
            const active = item.path === "/profile";
            return (
              <button key={item.path} onClick={() => router.push(item.path)} style={{
                width: "54px", borderRadius: "12px", padding: "8px 4px 6px",
                background: active ? "rgba(255,255,255,0.18)" : "transparent", border: "none",
                color: active ? "white" : "rgba(255,255,255,0.55)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
                cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                boxShadow: active ? "0 0 0 1px rgba(255,255,255,0.15), 0 4px 12px rgba(0,0,0,0.4)" : "none",
              }}>
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
            // Extra bottom padding on mobile so content clears the fixed
            // 64px BottomNav (+ safe-area inset via the nav itself).
            padding: isMobile ? "16px 14px 96px" : "16px 16px 24px",
            gap: "14px", overflowY: "auto",
          }}>

            {/* ── HERO CARD: character portrait + info ── */}
            <div style={{
              width: "100%", maxWidth: "640px", flexShrink: 0,
              borderRadius: "26px", background: "#1a0550", paddingBottom: "7px",
              boxShadow: "0 0 0 3px #5b21b6, 0 0 50px rgba(109,40,217,0.55), 0 24px 60px rgba(0,0,0,0.85)",
            }}>
              <div style={{
                borderRadius: "24px 24px 20px 20px",
                background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 50%, #07021a 100%)",
                border: "2px solid rgba(255,255,255,0.12)",
                overflow: "hidden", padding: "18px 18px 16px",
                position: "relative",
              }}>
                {/* Top gloss */}
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: "90px",
                  background: "linear-gradient(180deg, rgba(200,160,255,0.18) 0%, transparent 100%)",
                  pointerEvents: "none",
                }} />

                {/* ═══ TRAINER CARD: avatar + pet side-by-side, info below ═══ */}
                <div style={{ position: "relative", zIndex: 1 }}>

                  {/* TOP ROW — avatar + center info + pet (Pokémon GO trainer card pattern) */}
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px" }}>

                    {/* LEFT — DiceBear avatar with metallic tier ring.
                        Mobile shrinks 118→92 so the center column has real
                        estate for "OGAZBOIZ" + tier pill without ellipsis. */}
                    <div style={{ flexShrink: 0, position: "relative", width: isMobile ? "92px" : "118px" }}>
                      <div style={{
                        width: isMobile ? "92px" : "118px",
                        height: isMobile ? "92px" : "118px",
                        borderRadius: "50%",
                        padding: "4px",
                        background: tier.ringGrad,
                        boxShadow: `0 0 24px ${tier.color}88, 0 0 50px ${tier.color}33, 0 10px 24px rgba(0,0,0,0.6)`,
                      }}>
                        <div style={{
                          width: "100%", height: "100%", borderRadius: "50%",
                          background: "linear-gradient(180deg, #2a0c6e 0%, #07021a 100%)",
                          padding: "3px",
                          boxShadow: "inset 0 0 16px rgba(0,0,0,0.7)",
                        }}>
                          {address ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatarUrl(address, username)} alt=""
                              style={{ width: "100%", height: "100%", borderRadius: "50%", display: "block", objectFit: "cover" }} />
                          ) : (
                            <div style={{
                              width: "100%", height: "100%", borderRadius: "50%",
                              background: "linear-gradient(135deg, #4c1d95, #1a0550)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: "rgba(200,180,255,0.4)", fontSize: "30px", fontWeight: 900,
                            }}>?</div>
                          )}
                        </div>
                      </div>
                      {/* LV badge */}
                      <div style={{
                        position: "absolute", bottom: "-4px", left: "50%", transform: "translateX(-50%)",
                        borderRadius: "12px",
                        background: "linear-gradient(180deg, #fbbf24 0%, #b45309 100%)",
                        border: "2px solid rgba(255,255,255,0.6)",
                        padding: "3px 12px",
                        boxShadow: "0 4px 10px rgba(251,191,36,0.55)",
                        whiteSpace: "nowrap",
                      }}>
                        <span style={{ color: "white", fontSize: "11px", fontWeight: 900, letterSpacing: "0.1em", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                          LV.{playerLevel}
                        </span>
                      </div>
                    </div>

                    {/* CENTER — name + tier + verified */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "7px" }}>
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: "8px",
                        padding: "3px 4px 3px 10px", borderRadius: "18px",
                        background: `linear-gradient(180deg, ${tier.color}33 0%, rgba(20,10,50,0.8) 100%)`,
                        border: `1.5px solid ${tier.color}`,
                        boxShadow: `0 0 14px ${tier.color}55`,
                        alignSelf: "flex-start",
                      }}>
                        <span style={{ color: tier.color, fontSize: "9px", fontWeight: 900, letterSpacing: "0.12em", textShadow: `0 0 8px ${tier.color}aa`, whiteSpace: "nowrap" }}>
                          {tier.name} {division}
                        </span>
                        <div style={{
                          padding: "1px 7px", borderRadius: "10px",
                          background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                        }}>
                          <span style={{ color: "rgba(220,200,255,0.8)", fontSize: "8px", fontWeight: 800 }}>#{playerRank}</span>
                        </div>
                      </div>

                      <div>
                        <div style={{
                          color: "white", fontSize: "18px", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.1,
                          textShadow: "0 0 14px rgba(192,132,252,0.7), 0 2px 6px rgba(0,0,0,0.6)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{username.toUpperCase()}</div>
                        <div style={{
                          color: "rgba(180,150,255,0.55)", fontSize: "10px", fontWeight: 700,
                          marginTop: "2px",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{shortAddr}</div>
                      </div>

                      {isVerified ? (
                        <div style={{
                          display: "inline-flex", alignItems: "center", gap: "5px",
                          padding: "2px 10px", borderRadius: "999px",
                          background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.5)",
                          alignSelf: "flex-start",
                        }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="#22c55e"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                          <span style={{ fontSize: "8px", fontWeight: 800, color: "#22c55e", letterSpacing: "0.1em" }}>VERIFIED</span>
                        </div>
                      ) : (
                        <div role="button" tabIndex={0} onClick={() => router.push("/verify")}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: "5px",
                            padding: "2px 10px", borderRadius: "999px",
                            background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.5)",
                            cursor: "pointer", alignSelf: "flex-start",
                          }}>
                          <span style={{ fontSize: "8px", fontWeight: 800, color: "#fbbf24", letterSpacing: "0.1em" }}>⚠ VERIFY</span>
                        </div>
                      )}
                    </div>

                    {/* RIGHT — Pet (compact on mobile so center gets space) */}
                    <PetSlot pet={petForLevel(playerLevel)} compact={isMobile} />
                  </div>

                  {/* BOTTOM ROW — combined XP / pet evolution bar (full width, dual meaning) */}
                  <CombinedProgressBar
                    pet={petForLevel(playerLevel)}
                    playerLevel={playerLevel}
                    xpCurrent={xpCurrent}
                    xpToNext={xpToNext}
                    xpPct={xpPct}
                  />
                </div>
              </div>
            </div>


            {/* ── PILL TABS ── On mobile: compact padding so 4 pills fit
                one row on a 360px phone, and SETTINGS becomes icon-only
                (utility, visually distinct from primary tabs). */}
            <div style={{
              display: "flex",
              gap: isMobile ? "6px" : "8px",
              flexShrink: 0,
              flexWrap: isMobile ? "nowrap" : "wrap",
              justifyContent: "center",
              width: "100%",
            }}>
              {TABS.map(t => (
                <PillTab key={t.id} label={t.label} icon={t.icon} active={activeTab === t.id}
                  compact={isMobile}
                  iconOnly={isMobile && t.id === "settings"}
                  onClick={() => { if (activeTab !== t.id) playTabSwitch(); setActiveTab(t.id); }} />
              ))}
            </div>

            {/* ── TAB CONTENT ── */}
            <div style={{ width: "100%", maxWidth: "640px", flexShrink: 0 }}>

              {/* STATS TAB */}
              {activeTab === "stats" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Stat gems */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                    <StatGem value={String(totalGames)} label="GAMES" color="#a78bfa" wall="#1a0550" />
                    <StatGem value={String(Math.max(Number(rhythmBest || 0), Number(simonBest || 0)))} label="BEST SCORE" color="#a78bfa" wall="#1a0550" />
                    <StatGem value={badgeData ? String(badgeData.summary.totalGold + badgeData.summary.totalSilver + badgeData.summary.totalBronze) : "0"} label="BADGES" color="#fbbf24" wall="#2a1800" />
                    <StatGem value={`LV.${playerLevel}`} label="LEVEL" color="#fbbf24" wall="#2a1800" />
                  </div>

                  {/* G$ Claim — NOTE: use explicit boolean comparison, not
                      short-circuit on BigInt. A raw `entitlement && …` yields
                      `0n` when entitlement is zero, which React renders as "0"
                      between the stat gems and the game cards. */}
                  {isVerified && Number(entitlement ?? 0) > 0 && (
                    <div style={{
                      borderRadius: "18px", background: "#003a00", paddingBottom: "5px",
                      boxShadow: "0 0 0 2px #15803d, 0 0 30px rgba(34,197,94,0.4), 0 16px 40px rgba(0,0,0,0.6)",
                    }}>
                      <div style={{
                        borderRadius: "16px 16px 14px 14px",
                        background: "linear-gradient(180deg, #064e20 0%, #022010 100%)",
                        border: "2px solid rgba(134,239,172,0.3)",
                        padding: "14px 18px",
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
                        position: "relative", overflow: "hidden",
                      }}>
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%", background: "linear-gradient(180deg, rgba(134,239,172,0.12) 0%, transparent 100%)", pointerEvents: "none" }} />
                        <div style={{ position: "relative", zIndex: 1 }}>
                          <div style={{ fontSize: "10px", fontWeight: 800, color: "rgba(134,239,172,0.7)", letterSpacing: "0.14em" }}>DAILY REWARD READY</div>
                          <div style={{ fontSize: "22px", fontWeight: 900, color: "#86efac", textShadow: "0 0 16px rgba(134,239,172,0.7)", marginTop: "3px" }}>
                            {(Number(entitlement) / 1e18).toFixed(2)} G$
                          </div>
                        </div>
                        <div style={{ position: "relative", zIndex: 1 }}>
                          <JuicyBtn label="CLAIM" wallColor="#003a00" faceGrad="linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)" glowColor="rgba(34,197,94,0.7)" onClick={() => { playCoin(); claimG$(); }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Game stats cards — best score per game from on-chain GamePass */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
                    {[
                      { name: "RHYTHM RUSH", best: Number(rhythmBest || 0), color: "#c026d3", grad: "linear-gradient(160deg,#7e22ce 0%,#a21caf 100%)", icon: "🥁" },
                      { name: "SIMON MEMORY", best: Number(simonBest || 0), color: "#06b6d4", grad: "linear-gradient(160deg,#0e4f6b 0%,#075985 100%)", icon: "🧠" },
                    ].map((g, i) => (
                      <div key={i} style={{
                        borderRadius: "18px", padding: "2.5px",
                        background: `linear-gradient(180deg, ${g.color} 0%, ${g.color}55 100%)`,
                        boxShadow: `0 0 18px ${g.color}55, 0 12px 26px rgba(0,0,0,0.7)`,
                      }}>
                        <div style={{
                          borderRadius: "16px", background: g.grad,
                          padding: "14px 12px 12px", textAlign: "center",
                          display: "flex", flexDirection: "column", gap: "6px",
                          position: "relative", overflow: "hidden",
                        }}>
                          <div style={{
                            position: "absolute", top: 0, left: "8%", right: "8%", height: "40%",
                            background: "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, transparent 100%)",
                            borderRadius: "16px 16px 60px 60px", pointerEvents: "none",
                          }} />
                          <div style={{ fontSize: "30px", filter: `drop-shadow(0 0 10px ${g.color})`, position: "relative", zIndex: 1 }}>{g.icon}</div>
                          <div style={{
                            position: "relative", zIndex: 1,
                            fontSize: "10px", fontWeight: 900, color: "white", letterSpacing: "0.08em",
                            textShadow: `0 0 10px ${g.color}cc`,
                          }}>{g.name}</div>
                          <div style={{ position: "relative", zIndex: 1, marginTop: "2px" }}>
                            <div style={{
                              fontSize: "26px", fontWeight: 900, color: g.color,
                              textShadow: `0 0 14px ${g.color}, 0 2px 6px rgba(0,0,0,0.6)`, lineHeight: 1,
                            }}>{g.best}</div>
                            <div style={{ fontSize: "8px", fontWeight: 800, color: "rgba(255,255,255,0.5)", letterSpacing: "0.16em", marginTop: "5px" }}>BEST SCORE</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* MATCHES TAB */}
              {activeTab === "matches" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {matches.length === 0 ? (
                    <div style={{
                      padding: "30px 20px", textAlign: "center",
                      borderRadius: "14px",
                      background: "rgba(20,10,50,0.5)",
                      border: "1px dashed rgba(255,255,255,0.12)",
                    }}>
                      <div style={{ fontSize: "30px", marginBottom: "6px" }}>🎮</div>
                      <div style={{ color: "rgba(200,180,255,0.55)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em" }}>
                        NO MATCHES YET
                      </div>
                      <div style={{ color: "rgba(180,150,255,0.35)", fontSize: "9px", marginTop: "4px" }}>
                        Play a game to see your match history here
                      </div>
                    </div>
                  ) : (
                    matches.map((m, i) => {
                      const display = GAME_DISPLAY[m.game] || { name: m.game.toUpperCase(), icon: "🎮" };
                      const threshold = WIN_THRESHOLD[m.game] ?? 0;
                      const isWin = m.score >= threshold;
                      const color = isWin ? "#22c55e" : "#ef4444";
                      const result = isWin ? "WIN" : "LOSS";
                      return (
                        <div key={`${m.tx_hash}-${i}`} style={{
                          display: "flex", gap: "12px", alignItems: "center",
                          borderRadius: "14px",
                          background: "linear-gradient(90deg, rgba(20,10,50,0.85) 0%, rgba(10,5,30,0.9) 100%)",
                          border: `1.5px solid ${color}44`,
                          boxShadow: `0 0 14px ${color}22, 0 6px 16px rgba(0,0,0,0.6)`,
                          padding: "10px 14px",
                        }}>
                          <div style={{
                            width: "42px", height: "42px", borderRadius: "12px", flexShrink: 0,
                            background: `radial-gradient(circle at 35% 30%, ${color}cc, ${color}44)`,
                            border: `1.5px solid ${color}77`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "20px", boxShadow: `0 0 10px ${color}77`,
                          }}>{display.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: "white", fontSize: "13px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display.name}</div>
                            <div style={{ color: "rgba(180,150,255,0.55)", fontSize: "10px", fontWeight: 700, marginTop: "2px" }}>{timeAgo(m.timestamp)}</div>
                          </div>
                          <div style={{
                            padding: "4px 10px", borderRadius: "10px",
                            background: isWin ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
                            border: `1.5px solid ${color}77`, flexShrink: 0,
                          }}>
                            <span style={{ fontSize: "10px", fontWeight: 900, color, letterSpacing: "0.1em" }}>{result}</span>
                          </div>
                          <div style={{
                            color: "#fbbf24", fontSize: "14px", fontWeight: 900,
                            textShadow: "0 0 10px rgba(251,191,36,0.7)", minWidth: "44px", textAlign: "right",
                          }}>{m.score}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* ACHIEVEMENTS TAB */}
              {activeTab === "achievements" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

                  {/* CHAMPIONSHIP BADGES (real data from backend) */}
                  <div>
                    <div style={{
                      fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em",
                      color: "rgba(200,180,255,0.8)", textAlign: "center",
                      textShadow: "0 0 14px rgba(160,100,255,0.8)", marginBottom: "10px",
                    }}>── CHAMPIONSHIP BADGES ──</div>

                    {badgeData && badgeData.badges.length > 0 ? (
                      <>
                        {/* Summary chips */}
                        <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
                          {badgeData.summary.totalGold > 0 && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "4px 12px", borderRadius: "999px", background: "rgba(251,191,36,0.15)", border: "1.5px solid #fbbf24", boxShadow: "0 0 10px rgba(251,191,36,0.4)" }}>
                              <span style={{ fontSize: "14px" }}>🥇</span>
                              <span style={{ color: "#fbbf24", fontSize: "11px", fontWeight: 900 }}>{badgeData.summary.totalGold}</span>
                            </div>
                          )}
                          {badgeData.summary.totalSilver > 0 && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "4px 12px", borderRadius: "999px", background: "rgba(226,232,240,0.15)", border: "1.5px solid #e2e8f0", boxShadow: "0 0 10px rgba(226,232,240,0.4)" }}>
                              <span style={{ fontSize: "14px" }}>🥈</span>
                              <span style={{ color: "#e2e8f0", fontSize: "11px", fontWeight: 900 }}>{badgeData.summary.totalSilver}</span>
                            </div>
                          )}
                          {badgeData.summary.totalBronze > 0 && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "4px 12px", borderRadius: "999px", background: "rgba(249,115,22,0.15)", border: "1.5px solid #f97316", boxShadow: "0 0 10px rgba(249,115,22,0.4)" }}>
                              <span style={{ fontSize: "14px" }}>🥉</span>
                              <span style={{ color: "#f97316", fontSize: "11px", fontWeight: 900 }}>{badgeData.summary.totalBronze}</span>
                            </div>
                          )}
                          {badgeData.summary.streakLabel && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "4px 12px", borderRadius: "999px", background: "rgba(192,38,211,0.15)", border: "1.5px solid #c026d3", boxShadow: "0 0 10px rgba(192,38,211,0.4)" }}>
                              <span style={{ fontSize: "14px" }}>👑</span>
                              <span style={{ color: "#c026d3", fontSize: "10px", fontWeight: 900, letterSpacing: "0.06em" }}>{badgeData.summary.streakLabel}</span>
                            </div>
                          )}
                        </div>

                        {/* Badge grid */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
                          {badgeData.badges.slice(0, 8).map((b, i) => {
                            const color = b.type === "gold" ? "#fbbf24" : b.type === "silver" ? "#e2e8f0" : "#f97316";
                            const medal = b.type === "gold" ? "🥇" : b.type === "silver" ? "🥈" : "🥉";
                            const gameName = b.game === "rhythm" ? "Rhythm Rush" : b.game === "simon" ? "Simon Memory" : b.game.toUpperCase();
                            return (
                              <div key={i} style={{
                                borderRadius: "16px", padding: "14px 12px",
                                background: `linear-gradient(180deg, ${color}22 0%, rgba(20,10,50,0.7) 100%)`,
                                border: `1.5px solid ${color}77`,
                                boxShadow: `0 0 16px ${color}44, 0 6px 16px rgba(0,0,0,0.6)`,
                                display: "flex", gap: "12px", alignItems: "center",
                                position: "relative", overflow: "hidden",
                              }}>
                                <div style={{
                                  position: "absolute", top: 0, left: 0, right: 0, height: "40%",
                                  background: `linear-gradient(180deg, ${color}22 0%, transparent 100%)`,
                                  pointerEvents: "none",
                                }} />
                                <div style={{
                                  width: "44px", height: "44px", borderRadius: "12px", flexShrink: 0,
                                  background: `radial-gradient(circle at 35% 30%, ${color}cc, ${color}55)`,
                                  border: `1.5px solid ${color}aa`,
                                  boxShadow: `0 0 12px ${color}77`,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: "22px", position: "relative", zIndex: 1,
                                }}>{medal}</div>
                                <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
                                  <div style={{
                                    color: "white", fontSize: "12px", fontWeight: 900,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    textShadow: `0 0 10px ${color}cc`,
                                  }}>WEEK {b.season}</div>
                                  <div style={{ color: "rgba(200,180,255,0.7)", fontSize: "9px", fontWeight: 700, marginTop: "2px" }}>
                                    {gameName} · #{b.rank}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div style={{
                        padding: "20px 16px", textAlign: "center",
                        borderRadius: "14px",
                        background: "rgba(20,10,50,0.5)",
                        border: "1px dashed rgba(255,255,255,0.12)",
                      }}>
                        <div style={{ fontSize: "30px", marginBottom: "6px" }}>🏆</div>
                        <div style={{ color: "rgba(200,180,255,0.55)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em" }}>
                          NO CHAMPIONSHIP BADGES YET
                        </div>
                        <div style={{ color: "rgba(180,150,255,0.35)", fontSize: "9px", marginTop: "4px" }}>
                          Finish in the top 3 of any weekly leaderboard to earn one
                        </div>
                      </div>
                    )}
                  </div>

                  {/* MILESTONE ACHIEVEMENTS — real unlock state, NFT mint upgrade coming later */}
                  <div>
                    <div style={{
                      fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em",
                      color: "rgba(200,180,255,0.8)", textAlign: "center",
                      textShadow: "0 0 14px rgba(160,100,255,0.8)", marginBottom: "6px",
                    }}>── MILESTONE ACHIEVEMENTS ──</div>
                    <div style={{
                      textAlign: "center", padding: "4px 8px 10px",
                      color: "rgba(200,180,255,0.5)", fontSize: "9px", fontWeight: 700,
                      letterSpacing: "0.12em",
                    }}>
                      {achievements.filter(a => a.unlocked).length} / {achievements.length} UNLOCKED
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
                      {achievements.map((a, i) => (
                        <div key={i} style={{
                          borderRadius: "16px",
                          padding: "14px 12px",
                          background: a.unlocked
                            ? `linear-gradient(180deg, ${ACHIEVEMENT_COLOR}22 0%, rgba(20,10,50,0.7) 100%)`
                            : "rgba(20,10,50,0.5)",
                          border: `1.5px solid ${a.unlocked ? ACHIEVEMENT_COLOR + "77" : "rgba(255,255,255,0.06)"}`,
                          boxShadow: a.unlocked ? `0 0 16px ${ACHIEVEMENT_COLOR}44, 0 6px 16px rgba(0,0,0,0.6)` : "none",
                          display: "flex", gap: "12px", alignItems: "center",
                          opacity: a.unlocked ? 1 : 0.5,
                          position: "relative", overflow: "hidden",
                        }}>
                          {a.unlocked && (
                            <div style={{
                              position: "absolute", top: 0, left: 0, right: 0, height: "40%",
                              background: `linear-gradient(180deg, ${ACHIEVEMENT_COLOR}22 0%, transparent 100%)`,
                              pointerEvents: "none",
                            }} />
                          )}
                          <div style={{
                            width: "44px", height: "44px", borderRadius: "12px", flexShrink: 0,
                            background: a.unlocked ? `radial-gradient(circle at 35% 30%, ${ACHIEVEMENT_COLOR}cc, ${ACHIEVEMENT_COLOR}55)` : "rgba(255,255,255,0.05)",
                            border: `1.5px solid ${a.unlocked ? ACHIEVEMENT_COLOR + "aa" : "rgba(255,255,255,0.1)"}`,
                            boxShadow: a.unlocked ? `0 0 12px ${ACHIEVEMENT_COLOR}77` : "none",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "22px", position: "relative", zIndex: 1,
                            filter: a.unlocked ? "none" : "grayscale(1)",
                          }}>{a.icon}</div>
                          <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
                            <div style={{
                              color: a.unlocked ? "white" : "rgba(255,255,255,0.4)",
                              fontSize: "12px", fontWeight: 900,
                              letterSpacing: "0.04em",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              textShadow: a.unlocked ? `0 0 10px ${ACHIEVEMENT_COLOR}cc` : "none",
                            }}>{a.name}</div>
                            <div style={{
                              color: a.unlocked ? "rgba(200,180,255,0.7)" : "rgba(180,150,255,0.35)",
                              fontSize: "9px", fontWeight: 700, marginTop: "2px",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{a.desc}</div>
                          </div>
                          {a.unlocked && (
                            <svg style={{ flexShrink: 0, position: "relative", zIndex: 1 }} width="14" height="14" viewBox="0 0 24 24" fill={ACHIEVEMENT_COLOR}><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeTab === "settings" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {/* AUDIO */}
                  <div style={{
                    fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em",
                    color: "rgba(200,180,255,0.8)",
                    textShadow: "0 0 14px rgba(160,100,255,0.8)",
                    paddingLeft: "4px",
                  }}>── AUDIO ──</div>
                  <SettingsRow icon="🎵" label="Music" color="#a78bfa">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "180px" }}>
                      <ToggleSwitch on={musicOn} color="#a78bfa" onChange={() => setMusicOn(!musicOn)} />
                      <VolumeSlider value={musicOn ? musicVol : 0} color="#a78bfa" onChange={setMusicVol} />
                    </div>
                  </SettingsRow>
                  <SettingsRow icon="🔊" label="Sound FX" color="#a78bfa">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "180px" }}>
                      <ToggleSwitch on={sfxOn} color="#a78bfa" onChange={() => setSfxOn(!sfxOn)} />
                      <VolumeSlider value={sfxOn ? sfxVol : 0} color="#a78bfa" onChange={setSfxVol} />
                    </div>
                  </SettingsRow>
                  <SettingsRow icon="✨" label="App Audio" color="#a78bfa">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "180px" }}>
                      <ToggleSwitch on={appAudioOn} color="#a78bfa" onChange={() => setAppAudioOn(!appAudioOn)} />
                      <VolumeSlider value={appAudioOn ? appAudioVol : 0} color="#a78bfa" onChange={setAppAudioVol} />
                    </div>
                  </SettingsRow>

                  {/* GAMEPLAY */}
                  <div style={{
                    fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em",
                    color: "rgba(200,180,255,0.8)",
                    textShadow: "0 0 14px rgba(160,100,255,0.8)",
                    paddingLeft: "4px", marginTop: "4px",
                  }}>── GAMEPLAY ──</div>
                  <SettingsRow icon="📳" label="Haptic Feedback" color="#a78bfa">
                    <ToggleSwitch on={hapticsOn} color="#a78bfa" onChange={() => setHapticsOn(!hapticsOn)} />
                  </SettingsRow>
                  <SettingsRow icon="🔔" label="Push Notifications" color="#a78bfa">
                    <ToggleSwitch on={notifOn} color="#a78bfa" onChange={() => setNotifOn(!notifOn)} />
                  </SettingsRow>

                  {/* ACCOUNT */}
                  <div style={{
                    fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em",
                    color: "rgba(200,180,255,0.8)",
                    textShadow: "0 0 14px rgba(160,100,255,0.8)",
                    paddingLeft: "4px", marginTop: "4px",
                  }}>── ACCOUNT ──</div>
                  <SettingsRow icon="📋" label="Copy Wallet Address" color="#a78bfa">
                    <JuicyBtn
                      label="COPY"
                      wallColor="#1a0550"
                      faceGrad="linear-gradient(160deg, #c084fc 0%, #a78bfa 50%, #6b21a8 100%)"
                      glowColor="rgba(167,139,250,0.6)"
                      fontSize={10}
                      padding="7px 14px"
                      onClick={() => { if (address) navigator.clipboard.writeText(address); }}
                    />
                  </SettingsRow>
                  {authenticated && (
                    <SettingsRow icon="🚪" label="Disconnect Wallet" color="#ef4444">
                      <JuicyBtn
                        label="LOGOUT"
                        wallColor="#3a0000"
                        faceGrad="linear-gradient(160deg, #ff6060 0%, #ee1111 50%, #b00000 100%)"
                        glowColor="rgba(200,0,0,0.5)"
                        fontSize={10}
                        padding="7px 14px"
                        onClick={() => { logout(); router.push("/home"); }}
                      />
                    </SettingsRow>
                  )}
                </div>
              )}

            </div>

          </div>
        </div>
      </div>

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
