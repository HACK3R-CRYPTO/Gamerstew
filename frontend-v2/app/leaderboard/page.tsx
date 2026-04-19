"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";

// ─── Splash icons ──────────────────────────────────────────────────────────────
const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";
const V = "/splash_screen_icons/vending.png";

const LEFT_ICONS = [
  { src: D, top: "1%", left: "-18px", size: 120, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18 },
  { src: M, top: "8%", left: "34px", size: 80, delay: 0.7, dur: 4.3, glow: "#ffaa00", rotate: 12 },
  { src: G, top: "24%", left: "6px", size: 110, delay: 1.4, dur: 6.0, glow: "#aa88ff", rotate: -6 },
  { src: D, top: "36%", left: "72px", size: 140, delay: 0.3, dur: 4.8, glow: "#cc44ff", rotate: 16 },
  { src: J, top: "54%", left: "-10px", size: 105, delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8 },
  { src: G, top: "72%", left: "4px", size: 108, delay: 2.8, dur: 5.0, glow: "#aa88ff", rotate: -14 },
  { src: D, top: "88%", left: "60px", size: 95, delay: 1.9, dur: 4.6, glow: "#cc44ff", rotate: 10 },
];
const RIGHT_ICONS = [
  { src: D, top: "0%", right: "-22px", size: 115, delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20 },
  { src: J, top: "16%", right: "54px", size: 100, delay: 1.2, dur: 4.8, glow: "#22aaff", rotate: 8 },
  { src: V, top: "30%", right: "0px", size: 120, delay: 2.0, dur: 6.2, glow: "#ff44cc", rotate: -4 },
  { src: M, top: "50%", right: "44px", size: 82, delay: 0.6, dur: 4.0, glow: "#ffaa00", rotate: -16 },
  { src: D, top: "65%", right: "-8px", size: 100, delay: 2.4, dur: 5.2, glow: "#cc44ff", rotate: 10 },
  { src: G, top: "80%", right: "58px", size: 108, delay: 1.8, dur: 5.8, glow: "#aa88ff", rotate: -10 },
];

const NAV_ITEMS = [
  { label: "Home", path: "/home", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg> },
  { label: "Games", path: "/games", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3a1 1 0 00-1 1v10a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zm-10 7H9v2H7v-2H5v-2h2V9h2v2h2v2zm4.5 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-3a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" /></svg> },
  { label: "Leaderboard", path: "/leaderboard", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21H5a2 2 0 01-2-2v-7a2 2 0 012-2h6v11zm2 0V6a2 2 0 012-2h4a2 2 0 012 2v13h-8z" /></svg> },
  { label: "Profile", path: "/profile", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" /></svg> },
];

const TABS = [
  { id: "rankings", label: "RANKINGS", wallColor: "#083a6b", faceGrad: "linear-gradient(180deg, #60a5fa 0%, #2563eb 50%, #1e40af 100%)", glow: "rgba(59,130,246,0.7)" },
  { id: "seasons", label: "SEASONS", wallColor: "#083a6b", faceGrad: "linear-gradient(180deg, #60a5fa 0%, #2563eb 50%, #1e40af 100%)", glow: "rgba(59,130,246,0.7)" },
  { id: "pvp", label: "PVP ARENA", wallColor: "#083a6b", faceGrad: "linear-gradient(180deg, #60a5fa 0%, #2563eb 50%, #1e40af 100%)", glow: "rgba(59,130,246,0.7)" },
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
  if (rank === 1)   return "#f472b6"; // MASTER
  if (rank <= 3)    return "#a78bfa"; // DIAMOND
  if (rank <= 6)    return "#67e8f9"; // PLATINUM
  if (rank <= 15)   return "#fbbf24"; // GOLD
  if (rank <= 50)   return "#c0c0c0"; // SILVER
  return "#cd7f32";                    // BRONZE
}

function tierLabelByRank(rank: number): string {
  if (rank === 1)                  return "MASTER I";
  if (rank <= 3)                   return `DIAMOND ${rank === 2 ? "I" : "II"}`;
  if (rank <= 6)                   return `PLATINUM ${rank === 4 ? "I" : rank === 5 ? "II" : "III"}`;
  if (rank <= 15)                  return `GOLD ${rank <= 9 ? "I" : rank <= 12 ? "II" : "III"}`;
  if (rank <= 50)                  return `SILVER ${rank <= 25 ? "I" : rank <= 38 ? "II" : "III"}`;
  if (rank <= 200)                 return `BRONZE ${rank <= 100 ? "I" : "II"}`;
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

// ─── Dummy data for preview ────────────────────────────────────────────────────
const DUMMY_ENTRIES: Entry[] = [
  { player: "0xronayan0000000000000000000000000000a001", username: "Ronayan", score: 985, timestamp: 0 },
  { player: "0xmarina00000000000000000000000000000a002", username: "Marina", score: 942, timestamp: 0 },
  { player: "0xnedahom0000000000000000000000000000a003", username: "Nedahom", score: 918, timestamp: 0 },
  { player: "0xamanko00000000000000000000000000000a004", username: "Amanko", score: 870, timestamp: 0 },
  { player: "0xnichaina000000000000000000000000000a005", username: "Nichaina", score: 844, timestamp: 0 },
  { player: "0xbottak00000000000000000000000000000a006", username: "Bottak", score: 821, timestamp: 0 },
  { player: "0xlumos000000000000000000000000000000a007", username: "lumos", score: 796, timestamp: 0 },
  { player: "0xminimie0000000000000000000000000000a008", username: "Minimie", score: 754, timestamp: 0 },
  { player: "0xzuruonyx000000000000000000000000000a009", username: "zuruonyx", score: 720, timestamp: 0 },
  { player: "0xdevairmd000000000000000000000000000a010", username: "Devairmd", score: 688, timestamp: 0 },
  { player: "0xmarvysmind00000000000000000000000000a011", username: "Marvysmind", score: 651, timestamp: 0 },
  { player: "0xprince000000000000000000000000000000a012", username: "prince", score: 613, timestamp: 0 },
  { player: "0xsshdopey000000000000000000000000000a013", username: "sshdopey", score: 590, timestamp: 0 },
];

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
  label, active, wallColor, faceGrad, glow, onClick,
}: { label: string; active: boolean; wallColor: string; faceGrad: string; glow: string; onClick: () => void }) {
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
        paddingBottom: "5px",
        boxShadow: active
          ? `0 0 0 2px #3b82f6, 0 0 20px ${glow}, 0 0 40px ${glow}, 0 10px 24px -4px ${glow}`
          : "0 6px 16px -4px rgba(0,0,0,0.5)",
        transition: "all 0.2s",
      }}>
        <div style={{
          borderRadius: "999px",
          background: active ? faceGrad : "linear-gradient(180deg, #3b1fa3 0%, #1e0762 100%)",
          padding: "10px 22px",
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
            fontSize: "13px", fontWeight: 900, letterSpacing: "0.08em",
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
    { char: "/characters/char1.png", entry: first,  color: "#fbbf24", rank: 1, widthPct: 18, bottomPct: 38, leftPct: 50, z: 3 },
    { char: "/characters/char2.png", entry: second, color: "#e2e8f0", rank: 2, widthPct: 16, bottomPct: 33, leftPct: 32, z: 2 },
    { char: "/characters/char3.png", entry: third,  color: "#f97316", rank: 3, widthPct: 16, bottomPct: 32, leftPct: 67, z: 2 },
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
function PlayerRow({
  entry, rank, color, isMe,
}: { entry: Entry; rank: number; color: string; isMe: boolean }) {
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
          <div style={{
            color: isMe ? color : "white",
            fontSize: "12px", fontWeight: 800, lineHeight: 1.15,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {isMe ? "YOU" : fmtName(entry.player, entry.username)}
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
        {/* Score */}
        <div style={{
          color: "#fbbf24", fontSize: "11px", fontWeight: 900,
          letterSpacing: "0.12em",
          textShadow: "0 0 10px rgba(251,191,36,0.7)",
          flexShrink: 0,
        }}>
          {entry.score}
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [activeTab, setActiveTab] = useState<"rankings" | "seasons" | "pvp">("rankings");
  const [gameTab, setGameTab] = useState<"rhythm" | "simon">("rhythm");
  const [entries, setEntries] = useState<Entry[]>(DUMMY_ENTRIES);
  const [loading, setLoading] = useState(false);
  const [streak, setStreak] = useState<{ streak: number; playedToday: boolean } | null>(null);

  useEffect(() => {
    if (!address) { setStreak(null); return; }
    fetch(`${BACKEND_URL}/api/streak/${address}`)
      .then(r => r.json())
      .then(d => setStreak({ streak: d.streak || 0, playedToday: !!d.playedToday }))
      .catch(() => setStreak(null));
  }, [address]);

  // Seasons + competition data (for SEASONS tab)
  const [seasonsData, setSeasonsData] = useState<SeasonsData | null>(null);
  const [competition, setCompetition] = useState<CompetitionData | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<PastSeason | null>(null);
  useEffect(() => {
    if (activeTab !== "seasons") return;
    fetch(`${BACKEND_URL}/api/seasons`).then(r => r.json()).then(setSeasonsData).catch(() => setSeasonsData(null));
    fetch(`${BACKEND_URL}/api/competition`).then(r => r.json()).then(setCompetition).catch(() => setCompetition(null));
  }, [activeTab]);

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
      const res = await fetch(`${BACKEND_URL}/api/leaderboard?game=${gameTab}&offset=0&limit=20`);
      const data = await res.json();
      const fetched = data.leaderboard || [];
      // Pad with dummy entries so we always see a full preview of the tier system
      setEntries(fetched.length >= 10 ? fetched : DUMMY_ENTRIES);
    } catch {
      setEntries(DUMMY_ENTRIES);
    } finally {
      setLoading(false);
    }
  }, [gameTab]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3, 13);

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "radial-gradient(ellipse 80% 60% at 50% 15%, #6a18c8 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Floating icons */}
      {LEFT_ICONS.map((ic, i) => (
        <div key={`l${i}`} className="icon-float" style={{
          position: "absolute", top: ic.top, left: ic.left, width: ic.size, height: ic.size,
          transform: `rotate(${ic.rotate}deg)`, filter: `drop-shadow(0 0 8px ${ic.glow}99)`,
          ["--dur" as string]: `${ic.dur}s`, ["--delay" as string]: `${ic.delay}s`,
          userSelect: "none", pointerEvents: "none", zIndex: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ic.src} alt="" width={ic.size} height={ic.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}
      {RIGHT_ICONS.map((ic, i) => (
        <div key={`r${i}`} className="icon-float" style={{
          position: "absolute", top: ic.top, right: ic.right, width: ic.size, height: ic.size,
          transform: `rotate(${ic.rotate}deg)`, filter: `drop-shadow(0 0 8px ${ic.glow}99)`,
          ["--dur" as string]: `${ic.dur}s`, ["--delay" as string]: `${ic.delay}s`,
          userSelect: "none", pointerEvents: "none", zIndex: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ic.src} alt="" width={ic.size} height={ic.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}

      {/* Body row: sidebar + center */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative", zIndex: 2 }}>

        {/* Sidebar */}
        <div style={{
          width: "68px", flexShrink: 0, alignSelf: "stretch",
          background: "rgba(4,1,18,0.7)", borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "16px 0", gap: "6px",
        }}>
          {/* Streak chip */}
          {address && streak && streak.streak > 0 && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: "1px",
              padding: "7px 6px", borderRadius: "12px",
              background: streak.playedToday
                ? "linear-gradient(180deg, rgba(249,115,22,0.25) 0%, rgba(249,115,22,0.1) 100%)"
                : "linear-gradient(180deg, rgba(107,114,128,0.2) 0%, rgba(31,41,55,0.1) 100%)",
              border: `1.5px solid ${streak.playedToday ? "#f97316" : "rgba(107,114,128,0.5)"}`,
              boxShadow: streak.playedToday ? "0 0 16px rgba(249,115,22,0.6), 0 0 30px rgba(249,115,22,0.25)" : "none",
              minWidth: "44px",
            }}>
              <span style={{ fontSize: "16px", lineHeight: 1, filter: streak.playedToday ? "drop-shadow(0 0 6px rgba(249,115,22,0.9))" : "grayscale(0.5)" }}>🔥</span>
              <span style={{
                color: streak.playedToday ? "#fbbf24" : "rgba(200,180,255,0.5)",
                fontSize: "13px", fontWeight: 900, lineHeight: 1.1,
                textShadow: streak.playedToday ? "0 0 8px rgba(251,191,36,0.7)" : "none",
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
                color: active ? "white" : "rgba(255,255,255,0.38)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
                cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                boxShadow: active ? "0 0 0 1px rgba(255,255,255,0.15), 0 4px 12px rgba(0,0,0,0.4)" : "none",
              }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.38)"; }}
              >
                {item.icon}
                <span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em" }}>{item.label.toUpperCase()}</span>
              </button>
            );
          })}

          <div style={{ flex: 1 }} />
        </div>

        {/* Center */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center",
            padding: "18px 16px 20px", gap: "14px", overflowY: "auto",
          }}>

            {/* Juicy pill tabs */}
            <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
              {TABS.map(t => (
                <PillTab
                  key={t.id}
                  label={t.label}
                  active={activeTab === t.id}
                  wallColor={t.wallColor}
                  faceGrad={t.faceGrad}
                  glow={t.glow}
                  onClick={() => setActiveTab(t.id as typeof activeTab)}
                />
              ))}
            </div>

            {/* Game sub-tabs */}
            {activeTab !== "pvp" && (
              <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                {GAME_TABS.map(t => {
                  const active = gameTab === t.id;
                  return (
                    <button key={t.id} onClick={() => setGameTab(t.id as typeof gameTab)} style={{
                      padding: "6px 14px", borderRadius: "999px", fontFamily: "inherit",
                      background: active ? `${t.accent}22` : "rgba(255,255,255,0.04)",
                      border: `1.5px solid ${active ? t.accent : "rgba(255,255,255,0.1)"}`,
                      color: active ? t.accent : "rgba(200,180,255,0.5)",
                      fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em",
                      cursor: "pointer", transition: "all 0.15s",
                      boxShadow: active ? `0 0 16px ${t.accent}55` : "none",
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
                  <div style={{ padding: "40px", textAlign: "center" }}>
                    <div style={{ fontSize: "40px", marginBottom: "10px" }}>🎮</div>
                    <div style={{ color: "rgba(200,180,255,0.5)", fontSize: "11px", letterSpacing: "0.15em" }}>NO SCORES YET</div>
                  </div>
                ) : (
                  <>
                    {/* Podium with character PNGs */}
                    <StagePodium podium={podium} />

                    {/* Rows grid — 2 columns */}
                    <div style={{
                      width: "100%", maxWidth: "720px",
                      display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
                      gap: "10px 14px", marginTop: "4px",
                    }}>
                      {rest.map((e, i) => {
                        const rank = i + 4;
                        const color = rowColorByRank(rank);
                        const isMe = !!address && e.player.toLowerCase() === address.toLowerCase();
                        return <PlayerRow key={e.player} entry={e} rank={rank} color={color} isMe={isMe} />;
                      })}
                    </div>

                    {entries.length <= 3 && (
                      <div style={{ color: "rgba(200,180,255,0.5)", fontSize: "10px", letterSpacing: "0.15em", marginTop: "8px" }}>
                        TOP {entries.length} PLAYER{entries.length > 1 ? "S" : ""} SHOWN
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

                        {/* Prize pool + players */}
                        <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "2fr 1fr", gap: "10px", marginBottom: "14px" }}>
                          <div style={{
                            borderRadius: "14px",
                            background: "linear-gradient(180deg, rgba(251,191,36,0.18) 0%, rgba(0,0,0,0.3) 100%)",
                            border: "1.5px solid rgba(251,191,36,0.5)",
                            padding: "10px 14px",
                          }}>
                            <div style={{ color: "rgba(251,191,36,0.7)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.14em" }}>PRIZE POOL</div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: "5px", marginTop: "2px" }}>
                              <span style={{ color: "#fbbf24", fontSize: "20px", fontWeight: 900, textShadow: "0 0 14px rgba(251,191,36,0.7)" }}>50</span>
                              <span style={{ color: "rgba(254,215,170,0.85)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.1em" }}>G$</span>
                            </div>
                            <div style={{ display: "flex", gap: "8px", marginTop: "6px", fontSize: "8px", fontWeight: 800 }}>
                              <span style={{ color: "#fbbf24" }}>🥇 25</span>
                              <span style={{ color: "#e2e8f0" }}>🥈 15</span>
                              <span style={{ color: "#f97316" }}>🥉 10</span>
                            </div>
                          </div>
                          <div style={{
                            borderRadius: "14px",
                            background: "linear-gradient(180deg, rgba(167,139,250,0.18) 0%, rgba(0,0,0,0.3) 100%)",
                            border: "1.5px solid rgba(167,139,250,0.5)",
                            padding: "10px 12px", textAlign: "center",
                            display: "flex", flexDirection: "column", justifyContent: "center",
                          }}>
                            <div style={{ color: "#a78bfa", fontSize: "20px", fontWeight: 900, textShadow: "0 0 14px rgba(167,139,250,0.7)" }}>
                              {liveEntries.length}
                            </div>
                            <div style={{ color: "rgba(200,180,255,0.7)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.12em", marginTop: "2px" }}>PLAYERS</div>
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
                          <div style={{ color: "rgba(254,215,170,0.7)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.14em" }}>WEEKS LEFT</div>
                          <div style={{ color: "#fbbf24", fontSize: "16px", fontWeight: 900, lineHeight: 1 }}>
                            {competition.weeksLeft}
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
        const endDate   = new Date(s.endTs   * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
                        <div style={{ flex: 1, minWidth: 0, color: isMe ? "#a78bfa" : "white", fontSize: "12px", fontWeight: 800,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
    </div>
  );
}
