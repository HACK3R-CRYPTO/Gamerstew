"use client";

// Events page · matches the legacy /leaderboard's data model 1:1.
//
// LIVE tab    → events happening now:
//                 · 3-Week Cup (api/competition)
//                 · Current Season (api/seasons)
//                 · Community Challenge (api/weekly-challenge)
//                 · MARKOV Climb (api/markov-climb)
//
// PAST tab    → ── COMPLETED EVENTS ── (newest first, all three types
//                                       interleaved by sealed-at date):
//                 · Past Seasons     (api/season/past) — Team Wars + Solo Ladder
//                 · Past Cups        (api/competition/past) — 3-Week competitions
//                 · Past Challenges  (api/challenges/past) — weekly community challenges
//
// ALL-TIME tab → cross-game all-time combined leaderboard (subgraph).
//                Per-game leaderboards live INSIDE each game; this is the
//                arena-wide ladder.

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { fetchAllTimeLeaderboard, fetchPlayerAllTimeCombinedStats, type AllTimeEntry } from "@/lib/subgraph";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
const PAGE_SIZE = 16;

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// ─── data shapes (mirror the legacy types) ──────────────────────────────
type CompPrizes = { first: number; second: number; third: number };
type CompetitionData = {
  weeks: number[];
  prizes: CompPrizes;
  compEnd: number;
  weeksLeft: number;
  currentWeek: number;
  rankings: Array<{ wallet: string; username: string | null; total: number; totalRhythm: number; totalSimon: number }>;
};
type SeasonsMeta = { currentSeason: number; currentEndsAt: number; currentStartsAt?: number };
// Real shape from games-backend (matches legacy weeklyChallengeLB).
type WeeklyChallengeData = {
  target: number;
  progress: number;
  playersIn: number;
  hit: boolean;
  daysLeft: number;
  rewardG: number;
  ubiG: number;
  capPerPlayer: number;
  myContribution: number | null;
  windowEnd: string;
  contributors?: Array<{ wallet: string; username: string | null; games: number }>;
};
type PastSeasonV1 = {
  season_id: number;
  starts_at: string;
  ends_at: string;
  standings: {
    teams: Array<{ team: string; counted: number }>;
    soloTop10: Array<{ rank: number; username?: string; wallet?: string; points: number }>;
  };
  prize_winners?: { closing_surprise?: { username?: string; wallet: string; amount_usdc?: number } };
};
// Real shapes from games-backend (legacy /leaderboard uses these exact fields).
type PastCompetition = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  weeks: number[];
  prizes: CompPrizes;
  winners: Array<{ rank: number; wallet: string; username: string | null; total: number; totalRhythm?: number; totalSimon?: number }>;
};
type PastChallenge = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  min_plays: number;
  top_n: number;
  prize_usdc: number;
  winners: Array<{ rank: number; wallet: string; username: string | null; plays: number }>;
};
type MarkovClimbData = {
  event?: { phase: string; endsAt: string; minMatchesToQualify?: number; prizes?: { first?: { usdc?: number; g_dollar?: number } } };
  leaderboard?: Array<{ rank: number; wallet: string; username: string; matches: number }>;
};

type Tab = "live" | "past" | "all-time";

// ─── helpers ────────────────────────────────────────────────────────────
function fmtCountdown(endsAt: number): string {
  const left = endsAt - Math.floor(Date.now() / 1000);
  if (left <= 0) return "Ended";
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  if (d >= 1) return `${d}d ${h}h left`;
  if (h >= 1) return `${h}h ${m}m left`;
  return `${m}m left`;
}
function fmtName(addr: string, username?: string | null): string {
  if (username && username.trim()) return `@${username.replace(/^@/, "")}`;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
function safeDate(input: string | number | undefined): Date | null {
  if (!input) return null;
  const d = typeof input === "number" ? new Date(input * 1000) : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDateRange(start: Date | null, end: Date | null): string {
  if (!start || !end) return "";
  const s = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const e = end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${s} → ${e}`;
}

// ─── unified past-event card (works for season, cup, or challenge) ──────
type SelectedEvent =
  | { type: "season"; data: PastSeasonV1 }
  | { type: "cup"; data: PastCompetition }
  | { type: "challenge"; data: PastChallenge }
  // LIVE variants — clicking a live card opens its current data in the same
  // modal infrastructure so the page reads as interactive end-to-end.
  | { type: "live-cup"; data: CompetitionData }
  | { type: "live-community"; data: WeeklyChallengeData }
  | { type: "live-climb"; data: MarkovClimbData };

// Card layout supports up to three highlighted rows so the season card
// can show team winner + solo #1 + closing surprise simultaneously
// (matching the legacy /leaderboard card 1:1). icon overridable per row
// so each detail can carry its own visual hook (🏆 / 🥇 / 🎁).
type DetailRow = { label: string; name: string; value: string; tint: string; icon?: string };
type UnifiedPastEvent = {
  key: string;
  kind: "season" | "cup" | "challenge";
  sortTs: number;
  title: string;
  dateRange: string;
  primary: DetailRow | null;
  secondary?: DetailRow;
  tertiary?: DetailRow;
  myMedal?: { color: string; medal: string };
  accent: string;
  raw: SelectedEvent;
};

function PastEventCard({ ev, onClick }: { ev: UnifiedPastEvent; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{
        borderRadius: 14,
        background: "rgba(20,10,50,0.6)",
        border: ev.myMedal ? `1.5px solid ${ev.myMedal.color}88` : "1px solid rgba(167,139,250,0.28)",
        boxShadow: ev.myMedal
          ? `0 0 12px ${ev.myMedal.color}33, 0 6px 14px rgba(0,0,0,0.5)`
          : "0 6px 14px rgba(0,0,0,0.5)",
        padding: "12px 14px",
        cursor: "pointer", userSelect: "none",
        transition: "transform 0.15s, border-color 0.15s",
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = "translateY(-2px)"; if (!ev.myMedal) el.style.borderColor = "rgba(167,139,250,0.6)"; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ""; if (!ev.myMedal) el.style.borderColor = "rgba(167,139,250,0.28)"; }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ color: ev.accent, fontSize: 11, fontWeight: 900, letterSpacing: "0.05em" }}>{ev.title}</div>
        {ev.myMedal && (
          <div style={{ padding: "2px 8px", borderRadius: 999, background: `${ev.myMedal.color}1a`, border: `1px solid ${ev.myMedal.color}66` }}>
            <span style={{ fontSize: 10 }}>{ev.myMedal.medal}</span>
            <span style={{ color: ev.myMedal.color, fontSize: 9, fontWeight: 900, marginLeft: 4 }}>YOU</span>
          </div>
        )}
      </div>
      {[ev.primary, ev.secondary, ev.tertiary].filter((r): r is DetailRow => !!r).map((row, i, all) => (
        <div key={`${row.label}-${i}`} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 8px", borderRadius: 8,
          background: `${row.tint}14`, border: `1px solid ${row.tint}44`,
          marginBottom: i === all.length - 1 ? 8 : 6,
        }}>
          <span style={{ fontSize: 13 }}>{row.icon ?? (i === 0 ? "🏆" : i === 1 ? "🥇" : "🎁")}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: row.tint, fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", opacity: 0.75 }}>{row.label}</div>
            <div style={{ color: "#fff", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</div>
          </div>
          <div style={{ color: row.tint, fontSize: 12, fontWeight: 900 }}>{row.value}</div>
        </div>
      ))}
      <div style={{ color: "rgba(200,180,255,0.5)", fontSize: 9, fontWeight: 700 }}>{ev.dateRange}</div>
    </div>
  );
}

// ─── live event card (one of: cup, season, community, climb) ────────────
function LiveEventCard({ icon, color, tag, title, sub, progress, rightAction, onClick }: {
  icon: string; color: string; tag: string; title: string; sub: string;
  progress?: { value: number; total: number };
  rightAction?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      style={{
        padding: "14px 16px", borderRadius: 16,
        background: T.surface,
        border: `1px solid ${color}44`,
        display: "flex", flexDirection: "column", gap: 8,
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.15s, border-color 0.15s",
      }}
      onMouseEnter={onClick ? e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.borderColor = `${color}88`; } : undefined}
      onMouseLeave={onClick ? e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.borderColor = `${color}44`; } : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 11, flexShrink: 0,
          background: `radial-gradient(circle at 35% 30%, ${color}cc, ${color}33)`,
          border: `1px solid ${color}66`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
        }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: "#f43f5e", boxShadow: "0 0 6px #f43f5e" }} />
            <span style={{ fontFamily: T.body, fontSize: 8.5, color, fontWeight: 800, letterSpacing: "0.12em" }}>{tag}</span>
          </div>
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink, fontWeight: 700, marginTop: 2 }}>{title}</div>
        </div>
        {rightAction}
      </div>
      <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, lineHeight: 1.4 }}>{sub}</div>
      {progress && progress.total > 0 && (
        <div style={{ height: 5, borderRadius: 999, background: "rgba(0,0,0,0.45)", overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, (progress.value / progress.total) * 100)}%`, height: "100%", background: `linear-gradient(90deg, ${color}99, ${color})`, boxShadow: `0 0 8px ${color}` }} />
        </div>
      )}
    </div>
  );
}

// ─── 3-Week Cup featured card · headline LIVE event ─────────────────────
function CupFeatureCard({ comp, isDesktop, address, onClick }: { comp: CompetitionData; isDesktop: boolean; address?: string; onClick?: () => void }) {
  const myIdx = address ? comp.rankings.findIndex(r => r.wallet.toLowerCase() === address.toLowerCase()) : -1;
  const myRank = myIdx >= 0 ? myIdx + 1 : 0;
  const myPoints = myIdx >= 0 ? comp.rankings[myIdx].total : 0;
  const isFinal = comp.weeksLeft === 1;
  const totalPot = comp.prizes.first + comp.prizes.second + comp.prizes.third;

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      style={{
        gridColumn: isDesktop ? "1 / -1" : "auto",
        padding: isDesktop ? "20px 24px" : "16px 18px",
        borderRadius: 20,
        background: "linear-gradient(135deg, rgba(251,191,36,0.15), rgba(180,83,9,0.35))",
        border: "1px solid rgba(251,191,36,0.4)",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.15s, border-color 0.15s",
      }}
      onMouseEnter={onClick ? e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(251,191,36,0.7)"; } : undefined}
      onMouseLeave={onClick ? e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(251,191,36,0.4)"; } : undefined}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, background: "rgba(244,63,94,0.16)", border: "1px solid rgba(244,63,94,0.5)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#f43f5e", boxShadow: "0 0 8px #f43f5e" }} />
              <span style={{ fontFamily: T.body, fontSize: 9, color: "#fda4af", fontWeight: 800, letterSpacing: "0.1em" }}>LIVE</span>
            </span>
            <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 999, fontFamily: T.body, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.04em", background: "#fbbf241f", color: "#fbbf24", border: "1px solid #fbbf2455" }}>
              3-WEEK CUP{isFinal ? " · FINAL WEEK" : ` · WEEK ${comp.currentWeek}`}
            </span>
          </div>
          <div style={{ fontFamily: T.display, fontSize: isDesktop ? 26 : 21, color: T.ink, marginTop: 8, letterSpacing: "-0.005em" }}>
            ${totalPot} prize pool
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, marginTop: 3 }}>
            Cumulative points across all games · {fmtCountdown(comp.compEnd)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: T.display, fontSize: 28, color: T.ink, lineHeight: 1 }}>{myRank > 0 ? `#${myRank}` : "—"}</span>
            <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>Your rank</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: T.display, fontSize: 28, color: T.ink, lineHeight: 1 }}>{myPoints.toLocaleString()}</span>
            <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>Your pts</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        {[
          { r: "1st", p: `$${comp.prizes.first}`, c: "#fbbf24" },
          { r: "2nd", p: `$${comp.prizes.second}`, c: "#cbd5e1" },
          { r: "3rd", p: `$${comp.prizes.third}`,  c: "#cd7f32" },
        ].map(x => (
          <div key={x.r} style={{ flex: 1, textAlign: "center", padding: "8px 6px", borderRadius: 12, background: "rgba(0,0,0,0.25)", border: `1px solid ${x.c}44` }}>
            <div style={{ fontFamily: T.body, fontSize: 9, color: x.c, fontWeight: 800, letterSpacing: "0.1em" }}>{x.r}</div>
            <div style={{ fontFamily: T.display, fontSize: 17, color: T.ink, marginTop: 2 }}>{x.p}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── confetti + StagePodium + PlayerRow for ALL-TIME tab ────────────────
const CONFETTI = [
  { left: "8%",  top: "25%", color: "#f9a8d4", size: 10, shape: "star",     dur: 3.5, delay: 0.0 },
  { left: "15%", top: "60%", color: "#fbbf24", size: 12, shape: "triangle", dur: 4.2, delay: 0.5 },
  { left: "22%", top: "20%", color: "#22d3ee", size: 8,  shape: "dot",      dur: 3.0, delay: 1.0 },
  { left: "30%", top: "45%", color: "#fb923c", size: 11, shape: "note",     dur: 4.8, delay: 1.5 },
  { left: "38%", top: "15%", color: "#e879f9", size: 9,  shape: "star",     dur: 3.2, delay: 0.3 },
  { left: "48%", top: "35%", color: "#fde68a", size: 13, shape: "sparkle",  dur: 4.0, delay: 0.8 },
  { left: "58%", top: "18%", color: "#60a5fa", size: 10, shape: "triangle", dur: 3.6, delay: 1.3 },
  { left: "68%", top: "50%", color: "#f472b6", size: 11, shape: "star",     dur: 4.5, delay: 0.2 },
  { left: "78%", top: "28%", color: "#34d399", size: 9,  shape: "dot",      dur: 3.3, delay: 1.1 },
  { left: "86%", top: "55%", color: "#c084fc", size: 12, shape: "note",     dur: 4.1, delay: 0.7 },
];
function ConfettiParticle({ p }: { p: typeof CONFETTI[number] }) {
  const base = { position: "absolute" as const, left: p.left, top: p.top, width: p.size, height: p.size, animation: `icon-float ${p.dur}s ease-in-out ${p.delay}s infinite`, pointerEvents: "none" as const, filter: `drop-shadow(0 0 6px ${p.color})` };
  if (p.shape === "dot") return <div style={{ ...base, background: p.color, borderRadius: "50%" }} />;
  if (p.shape === "triangle") return <div style={{ ...base, width: 0, height: 0, borderLeft: `${p.size / 2}px solid transparent`, borderRight: `${p.size / 2}px solid transparent`, borderBottom: `${p.size}px solid ${p.color}`, background: "transparent" }} />;
  if (p.shape === "note") return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>♪</div>;
  if (p.shape === "sparkle") return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>✦</div>;
  return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>★</div>;
}
function StagePodium({ podium }: { podium: (AllTimeEntry | undefined)[] }) {
  const placements = [
    { char: "/characters/char1.png", entry: podium[0], color: "#fbbf24", rank: 1, widthPct: 18, bottomPct: 38, leftPct: 50, z: 3 },
    { char: "/characters/char2.png", entry: podium[1], color: "#e2e8f0", rank: 2, widthPct: 16, bottomPct: 33, leftPct: 32, z: 2 },
    { char: "/characters/char3.png", entry: podium[2], color: "#f97316", rank: 3, widthPct: 16, bottomPct: 32, leftPct: 67, z: 2 },
  ];
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 620, aspectRatio: "3 / 2", margin: "0 auto" }}>
      <img src="/characters/podium.png" alt="podium" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.6))", zIndex: 1 }} />
      {CONFETTI.map((p, i) => <ConfettiParticle key={i} p={p} />)}
      {placements.map(pl => (
        <div key={pl.rank} style={{ position: "absolute", left: `${pl.leftPct}%`, bottom: `${pl.bottomPct}%`, transform: "translateX(-50%)", width: `${pl.widthPct}%`, zIndex: pl.z, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <img src={pl.char} alt={`rank ${pl.rank}`} style={{ width: "100%", height: "auto", objectFit: "contain", filter: `drop-shadow(0 4px 8px rgba(0,0,0,0.5)) drop-shadow(0 0 14px ${pl.color}55)` }} />
        </div>
      ))}
      {placements.map(pl => {
        const charHeightPct = pl.widthPct * 2.25;
        const labelBottom = pl.bottomPct + charHeightPct + 1;
        return (
          <div key={`label-${pl.rank}`} style={{ position: "absolute", left: `${pl.leftPct}%`, bottom: `${labelBottom}%`, transform: "translateX(-50%)", textAlign: "center", zIndex: 4, pointerEvents: "none", whiteSpace: "nowrap" }}>
            <div style={{ color: "white", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em", textShadow: `0 0 10px ${pl.color}dd, 0 2px 4px rgba(0,0,0,0.8)` }}>{pl.entry ? fmtName(pl.entry.player, pl.entry.username) : "—"}</div>
            <div style={{ color: pl.color, fontSize: 13, fontWeight: 900, textShadow: `0 0 14px ${pl.color}, 0 2px 4px rgba(0,0,0,0.8)`, marginTop: 2 }}>{pl.entry ? pl.entry.score.toLocaleString() : 0}</div>
          </div>
        );
      })}
    </div>
  );
}
function PlayerRow({ entry, rank, isMe }: { entry: AllTimeEntry; rank: number; isMe: boolean }) {
  const color = T.accent;
  return (
    <div style={{ borderRadius: 999, padding: 2.5, background: `linear-gradient(135deg, ${color} 0%, ${color}77 100%)`, boxShadow: `0 0 14px ${color}66, 0 0 28px ${color}33, 0 8px 18px rgba(0,0,0,0.6)` }}>
      <div style={{ borderRadius: 999, background: isMe ? `linear-gradient(90deg, ${color}26 0%, rgba(20,10,50,0.9) 100%)` : "linear-gradient(90deg, rgba(20,10,50,0.92) 0%, rgba(10,5,30,0.95) 100%)", padding: "8px 14px 8px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 999, background: `${color}1f`, border: `1px solid ${color}66`, fontFamily: T.display, fontSize: 13, color: T.ink, letterSpacing: "0.02em" }}>#{rank}</span>
        <span style={{ flex: 1, fontFamily: T.body, fontSize: 13, color: T.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isMe ? `You · ${fmtName(entry.player, entry.username)}` : fmtName(entry.player, entry.username)}</span>
        <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink, letterSpacing: "0.02em" }}>{entry.score.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ─── page ───────────────────────────────────────────────────────────────
export default function EventsPage() {
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [tab, setTab] = useState<Tab>("live");

  const [meta, setMeta] = useState<SeasonsMeta | null>(null);
  const [comp, setComp] = useState<CompetitionData | null>(null);
  const [community, setCommunity] = useState<WeeklyChallengeData | null>(null);
  const [climb, setClimb] = useState<MarkovClimbData | null>(null);
  const [pastSeasons, setPastSeasons] = useState<PastSeasonV1[] | null>(null);
  const [pastCups, setPastCups] = useState<PastCompetition[] | null>(null);
  const [pastChallenges, setPastChallenges] = useState<PastChallenge[] | null>(null);
  // All-time tab state
  const [allEntries, setAllEntries] = useState<AllTimeEntry[] | null>(null);
  const [allPage, setAllPage] = useState(0);
  const [myAllRank, setMyAllRank] = useState<{ rank: number; peak: number } | null>(null);
  // Detail modal · opens when a past event card is tapped.
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // LIVE + PAST data — pulled from the same endpoints the legacy /leaderboard uses.
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/seasons`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setMeta({ currentSeason: d.currentSeason, currentEndsAt: d.currentEndsAt, currentStartsAt: d.currentStartsAt }); })
      .catch(() => {});
    fetch(`${BACKEND_URL}/api/competition`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setComp(d as CompetitionData); })
      .catch(() => {});
    fetch(`${BACKEND_URL}/api/weekly-challenge`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setCommunity(d as WeeklyChallengeData); })
      .catch(() => {});
    fetch("/api/markov-climb", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setClimb(d as MarkovClimbData); })
      .catch(() => {});

    fetch("/api/season/past", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.seasons) setPastSeasons(d.seasons as PastSeasonV1[]); else if (!cancelled) setPastSeasons([]); })
      .catch(() => { if (!cancelled) setPastSeasons([]); });
    fetch(`${BACKEND_URL}/api/competition/past`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.competitions) setPastCups(d.competitions as PastCompetition[]); else if (!cancelled) setPastCups([]); })
      .catch(() => { if (!cancelled) setPastCups([]); });
    fetch(`${BACKEND_URL}/api/challenges/past`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.challenges) setPastChallenges(d.challenges as PastChallenge[]); else if (!cancelled) setPastChallenges([]); })
      .catch(() => { if (!cancelled) setPastChallenges([]); });
    return () => { cancelled = true; };
  }, []);

  // ALL-TIME data — fetched lazily on tab activation (subgraph query).
  useEffect(() => {
    if (tab !== "all-time" || allEntries !== null) return;
    let cancelled = false;
    fetchAllTimeLeaderboard(500)
      .then(r => { if (!cancelled) setAllEntries(r); })
      .catch(() => { if (!cancelled) setAllEntries([]); });
    return () => { cancelled = true; };
  }, [tab, allEntries]);

  useEffect(() => {
    if (!address || !allEntries) { setMyAllRank(null); return; }
    const i = allEntries.findIndex(e => e.player.toLowerCase() === address.toLowerCase());
    if (i >= 0) { setMyAllRank({ rank: i + 1, peak: allEntries[i].score }); return; }
    let cancelled = false;
    fetchPlayerAllTimeCombinedStats(address).then(s => {
      if (cancelled) return;
      setMyAllRank(s ? { rank: s.rank, peak: s.peak } : null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [address, allEntries]);

  // Combined PAST events list, sorted by sealed_at (newest first).
  const pastUnified: UnifiedPastEvent[] = useMemo(() => {
    const out: UnifiedPastEvent[] = [];
    (pastSeasons ?? []).forEach(s => {
      const teamWinner = s.standings.teams[0];
      const soloWinner = s.standings.soloTop10[0];
      const closing = s.prize_winners?.closing_surprise;
      const teamColor = teamWinner?.team === "alpha" ? "#fb923c" : teamWinner?.team === "nova" ? "#67e8f9" : teamWinner?.team === "pulse" ? "#a78bfa" : "#fbbf24";
      const myFinish = address ? s.standings.soloTop10.findIndex(p => p.wallet?.toLowerCase() === address.toLowerCase()) + 1 : 0;
      const myMedal = myFinish === 1 ? { color: "#fbbf24", medal: "🥇" } : myFinish === 2 ? { color: "#e2e8f0", medal: "🥈" } : myFinish === 3 ? { color: "#f97316", medal: "🥉" } : undefined;
      const start = safeDate(s.starts_at);
      const end = safeDate(s.ends_at);
      out.push({
        key: `season-${s.season_id}`,
        kind: "season",
        sortTs: end ? end.getTime() : 0,
        title: `SEASON ${s.season_id} · TEAM WARS`,
        dateRange: fmtDateRange(start, end),
        primary: teamWinner ? { label: "TEAM WINNER", name: teamWinner.team.toUpperCase(), value: String(teamWinner.counted ?? 0), tint: teamColor, icon: "🏆" } : null,
        secondary: soloWinner ? { label: "SOLO #1", name: soloWinner.username || (soloWinner.wallet ? fmtName(soloWinner.wallet) : "anon"), value: String(soloWinner.points), tint: "#fbbf24", icon: "🥇" } : undefined,
        tertiary: closing ? { label: "CLOSING SURPRISE", name: closing.username || fmtName(closing.wallet), value: `$${closing.amount_usdc ?? 10}`, tint: "#22c55e", icon: "🎁" } : undefined,
        myMedal,
        accent: "#c4b5fd",
        raw: { type: "season", data: s },
      });
    });
    (pastCups ?? []).forEach(c => {
      const winner = c.winners?.[0];
      const myFinish = address ? (c.winners.find(w => w.wallet.toLowerCase() === address.toLowerCase())?.rank ?? 0) : 0;
      const myMedal = myFinish === 1 ? { color: "#fbbf24", medal: "🥇" } : myFinish === 2 ? { color: "#e2e8f0", medal: "🥈" } : myFinish === 3 ? { color: "#f97316", medal: "🥉" } : undefined;
      const start = safeDate(c.starts_at);
      const end = safeDate(c.ends_at);
      out.push({
        key: `cup-${c.id}`,
        kind: "cup",
        sortTs: end ? end.getTime() : 0,
        title: c.name?.toUpperCase() || "3-WEEK CUP",
        dateRange: fmtDateRange(start, end),
        primary: winner ? { label: "WINNER", name: fmtName(winner.wallet, winner.username), value: `${winner.total} pts`, tint: "#fbbf24" } : null,
        myMedal,
        accent: "#fde68a",
        raw: { type: "cup", data: c },
      });
    });
    (pastChallenges ?? []).forEach(ch => {
      const winner = ch.winners?.[0];
      const myFinish = address ? (ch.winners.find(w => w.wallet.toLowerCase() === address.toLowerCase())?.rank ?? 0) : 0;
      const myMedal = myFinish === 1 ? { color: "#fbbf24", medal: "🥇" } : myFinish === 2 ? { color: "#e2e8f0", medal: "🥈" } : myFinish === 3 ? { color: "#f97316", medal: "🥉" } : undefined;
      const start = safeDate(ch.starts_at);
      const end = safeDate(ch.ends_at);
      out.push({
        key: `challenge-${ch.id}`,
        kind: "challenge",
        sortTs: end ? end.getTime() : 0,
        title: ch.name?.toUpperCase() || "WEEKLY CHALLENGE",
        dateRange: fmtDateRange(start, end),
        primary: winner ? { label: "TOP GRINDER", name: fmtName(winner.wallet, winner.username), value: `${winner.plays} plays`, tint: "#22c55e" } : null,
        myMedal,
        accent: "#86efac",
        raw: { type: "challenge", data: ch },
      });
    });
    out.sort((a, b) => b.sortTs - a.sortTs);
    return out;
  }, [pastSeasons, pastCups, pastChallenges, address]);

  // ALL-TIME pagination
  const podium = (allEntries ?? []).slice(0, 3);
  const restAll = (allEntries ?? []).slice(3);
  const totalPages = Math.max(1, Math.ceil(restAll.length / PAGE_SIZE));
  const rest = restAll.slice(allPage * PAGE_SIZE, (allPage + 1) * PAGE_SIZE);
  const myAllPage = myAllRank ? (myAllRank.rank <= 3 ? -1 : Math.floor((myAllRank.rank - 4) / PAGE_SIZE)) : -1;

  const pastLoading = pastSeasons === null || pastCups === null || pastChallenges === null;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />

      <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 16 }}>

        <div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em" }}>EVENTS</div>
          <h2 style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 24, color: T.ink, margin: "4px 0 0", letterSpacing: "-0.01em" }}>Live &amp; past events</h2>
        </div>

        {/* LIVE / PAST / ALL-TIME tab switcher */}
        <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hairline}`, alignSelf: "flex-start" }}>
          {([
            { id: "live" as Tab, label: "LIVE" },
            { id: "past" as Tab, label: "PAST" },
            { id: "all-time" as Tab, label: "ALL-TIME" },
          ]).map(opt => {
            const active = tab === opt.id;
            return (
              <button key={opt.id} onClick={() => setTab(opt.id)} style={{
                padding: "8px 18px", borderRadius: 10, cursor: "pointer",
                background: active ? T.accent : "transparent", border: "none",
                color: active ? "#fff" : T.inkSoft,
                fontFamily: T.body, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em",
                boxShadow: active ? `0 6px 14px -4px ${T.accent}aa, inset 0 1px 0 rgba(255,255,255,0.3)` : "none",
              }}>{opt.label}</button>
            );
          })}
        </div>

        {/* LIVE */}
        {tab === "live" && (
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 12 }}>
            {comp && comp.weeksLeft > 0 && <CupFeatureCard comp={comp} isDesktop={isDesktop} address={address} onClick={() => setSelectedEvent({ type: "live-cup", data: comp })} />}

            {meta && (
              <LiveEventCard
                icon="💎"
                color={T.accent}
                tag={`SEASON ${meta.currentSeason} · ACTIVE`}
                title={`Season ends in ${fmtCountdown(meta.currentEndsAt)}`}
                sub="Open Rhythm or Simon to see the season's per-game standings"
              />
            )}

            {community && community.target > 0 && !community.hit && (
              <LiveEventCard
                icon="🌍"
                color="#22c55e"
                tag={`COMMUNITY · ${community.daysLeft}D LEFT`}
                title={`${community.progress.toLocaleString()} / ${community.target.toLocaleString()} games played`}
                sub={`Hit the milestone to split ${community.rewardG.toLocaleString()} G$${community.ubiG ? ` · ${community.ubiG} G$ to GoodDollar` : ""}${community.myContribution != null ? ` · You: ${community.myContribution}/${community.capPerPlayer}` : ` · Cap ${community.capPerPlayer}/player`}`}
                progress={{ value: community.progress, total: community.target }}
                onClick={() => setSelectedEvent({ type: "live-community", data: community })}
              />
            )}
            {community && community.hit && (
              <LiveEventCard
                icon="🎉"
                color="#22c55e"
                tag="COMMUNITY · MILESTONE HIT"
                title={`${community.progress.toLocaleString()} / ${community.target.toLocaleString()} games played`}
                sub={`${community.rewardG.toLocaleString()} G$ splitting now between ${community.playersIn} qualifying players`}
                progress={{ value: community.progress, total: community.target }}
                onClick={() => setSelectedEvent({ type: "live-community", data: community })}
              />
            )}

            {climb && climb.event && climb.event.phase === "live" && (
              <LiveEventCard
                icon="🤖"
                color="#22c55e"
                tag="MARKOV CLIMB"
                title={`${fmtCountdown(new Date(climb.event.endsAt).getTime() / 1000)} · ${climb.event.minMatchesToQualify ?? 30}+ matches qualifies`}
                sub={climb.event.prizes?.first ? `Top 3 take $${climb.event.prizes.first.usdc ?? 0} USDC + ${(climb.event.prizes.first.g_dollar ?? 0).toLocaleString()} G$` : "Top 3 take the climb pool"}
                onClick={() => setSelectedEvent({ type: "live-climb", data: climb })}
              />
            )}

            {!comp && !meta && !community && !climb && (
              <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px" }}>Loading live events…</div>
            )}
          </div>
        )}

        {/* PAST — all sealed events, newest first, type-agnostic grid */}
        {tab === "past" && (
          <>
            <div style={{
              fontSize: 10, fontWeight: 900, letterSpacing: "0.2em",
              color: "rgba(254,215,170,0.85)", textAlign: "center",
              textShadow: "0 0 14px rgba(251,191,36,0.6)", marginBottom: 4,
            }}>── COMPLETED EVENTS ──</div>
            {pastLoading && (
              <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px", textAlign: "center" }}>Loading past events…</div>
            )}
            {!pastLoading && pastUnified.length === 0 && (
              <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px", textAlign: "center" }}>No sealed events yet — check back after the first cycle closes.</div>
            )}
            {pastUnified.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {pastUnified.map(ev => <PastEventCard key={ev.key} ev={ev} onClick={() => setSelectedEvent(ev.raw)} />)}
              </div>
            )}
          </>
        )}

        {/* ALL-TIME — cross-game ladder */}
        {tab === "all-time" && (
          <>
            {/* Personal-status chip in same slot as per-game leaderboards. */}
            {address && allEntries && myAllRank && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 14, background: `linear-gradient(90deg, ${T.accent}1f, rgba(0,0,0,0.25))`, border: `1px solid ${T.accent}55` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: T.display, fontSize: 16, color: T.ink, letterSpacing: "0.01em" }}>You&apos;re #{myAllRank.rank}</div>
                  <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkDim, marginTop: 2 }}>Combined best: {myAllRank.peak.toLocaleString()}</div>
                </div>
                {myAllPage >= 0 && myAllPage !== allPage && (
                  <button onClick={() => setAllPage(myAllPage)} style={{ padding: "7px 14px", borderRadius: 999, background: `linear-gradient(180deg, #c084fc 0%, ${T.accent} 100%)`, border: "none", color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", cursor: "pointer", boxShadow: `0 0 12px ${T.accent}55` }}>JUMP TO MY ROW</button>
                )}
              </div>
            )}
            {address && allEntries && !myAllRank && (
              <a href="/games" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: `1px dashed ${T.accent}55`, textDecoration: "none" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: T.display, fontSize: 16, color: T.ink, letterSpacing: "0.01em" }}>Not ranked yet</div>
                  <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkDim, marginTop: 2 }}>Play a game to claim a spot on the board</div>
                </div>
                <span style={{ padding: "7px 14px", borderRadius: 999, background: `linear-gradient(180deg, #c084fc 0%, ${T.accent} 100%)`, color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", boxShadow: `0 0 12px ${T.accent}55` }}>PLAY ›</span>
              </a>
            )}

            <StagePodium podium={podium} />

            {allEntries === null && <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, textAlign: "center", padding: "12px 0" }}>Loading all-time ladder…</div>}

            {rest.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(2, 1fr)" : "1fr", gap: isDesktop ? "8px 14px" : 8 }}>
                {rest.map((e, i) => {
                  const rank = 4 + allPage * PAGE_SIZE + i;
                  const isMe = !!address && e.player.toLowerCase() === address.toLowerCase();
                  return <PlayerRow key={e.player} entry={e} rank={rank} isMe={isMe} />;
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 4 }}>
                <button onClick={() => setAllPage(p => Math.max(0, p - 1))} disabled={allPage === 0} style={{ padding: "8px 14px", borderRadius: 999, background: allPage === 0 ? "rgba(255,255,255,0.04)" : `${T.accent}2e`, border: `1.5px solid ${allPage === 0 ? "rgba(255,255,255,0.12)" : T.accent + "80"}`, color: allPage === 0 ? "rgba(200,180,255,0.35)" : "rgba(230,220,255,0.95)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", cursor: allPage === 0 ? "not-allowed" : "pointer", fontFamily: T.body }}>‹ PREV</button>
                <span style={{ color: T.inkDim, fontFamily: T.body, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>PAGE {allPage + 1} / {totalPages}</span>
                <button onClick={() => setAllPage(p => Math.min(totalPages - 1, p + 1))} disabled={allPage === totalPages - 1} style={{ padding: "8px 14px", borderRadius: 999, background: allPage === totalPages - 1 ? "rgba(255,255,255,0.04)" : `${T.accent}2e`, border: `1.5px solid ${allPage === totalPages - 1 ? "rgba(255,255,255,0.12)" : T.accent + "80"}`, color: allPage === totalPages - 1 ? "rgba(200,180,255,0.35)" : "rgba(230,220,255,0.95)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", cursor: allPage === totalPages - 1 ? "not-allowed" : "pointer", fontFamily: T.body }}>NEXT ›</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail modal · opens on past-event card click. Click backdrop or
          ✕ to dismiss. Mirrors the legacy /leaderboard event detail layout. */}
      {selectedEvent && <EventDetailSheet sel={selectedEvent} onClose={() => setSelectedEvent(null)} address={address} />}

      <AppBottomNav wide={isDesktop} />
    </div>
  );
}

// ─── detail bottom sheet ────────────────────────────────────────────────
// Bottom-sheet pattern matches modern mobile UX (Pokémon Unite, Brawl Stars,
// Instagram, TikTok, Discord). Slides up from the bottom edge with spring
// physics, rounded only at the top, drag handle indicator, scrollable body.
// On desktop the sheet anchors to the bottom with a max-width so the same
// component reads great on both surfaces — no responsive switch needed.
const SHEET_KEYFRAMES = `
  @keyframes ev-sheet-fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes ev-sheet-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }
`;

function EventDetailSheet({ sel, onClose, address }: { sel: SelectedEvent; onClose: () => void; address?: string }) {
  // Header copy per event type · LIVE variants surface "happening now"
  // framing; PAST variants show the sealed end date.
  let name = "";
  let subline = "";
  let accent = "#fbbf24";
  if (sel.type === "season") {
    name = `SEASON ${sel.data.season_id} · TEAM WARS`;
    subline = `ENDED ${new Date(sel.data.ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    accent = "#a78bfa";
  } else if (sel.type === "cup" || sel.type === "challenge") {
    name = sel.data.name?.toUpperCase() || (sel.type === "cup" ? "3-WEEK CUP" : "WEEKLY CHALLENGE");
    subline = `ENDED ${new Date(sel.data.ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    accent = sel.type === "cup" ? "#fbbf24" : "#86efac";
  } else if (sel.type === "live-cup") {
    name = `3-WEEK CUP · WEEK ${sel.data.currentWeek}${sel.data.weeksLeft === 1 ? " · FINAL" : ""}`;
    subline = `LIVE · ${fmtCountdown(sel.data.compEnd)}`;
    accent = "#fbbf24";
  } else if (sel.type === "live-community") {
    name = "COMMUNITY CHALLENGE";
    subline = sel.data.hit ? "LIVE · MILESTONE HIT" : `LIVE · ${sel.data.daysLeft}d LEFT`;
    accent = "#22c55e";
  } else if (sel.type === "live-climb") {
    const ev = sel.data.event;
    name = "MARKOV CLIMB · LIVE";
    subline = ev ? `LIVE · ${fmtCountdown(Math.floor(new Date(ev.endsAt).getTime() / 1000))}` : "LIVE";
    accent = "#22c55e";
  }

  // Light haptic-feeling spring on enter via cubic-bezier(0.16, 1, 0.3, 1) —
  // the iOS sheet curve. Backdrop fades in slightly slower so the sheet
  // arrives before the screen behind goes dark, which reads as more responsive.
  return (
    <>
      <style>{SHEET_KEYFRAMES}</style>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(4,0,20,0.72)", backdropFilter: "blur(10px)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          animation: "ev-sheet-fade 0.22s ease both",
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={name}
          style={{
            width: "100%",
            maxWidth: 520,
            maxHeight: "88vh",
            borderRadius: "24px 24px 0 0",
            background: "linear-gradient(180deg, rgba(30,12,80,0.98) 0%, rgba(12,4,40,0.99) 60%, rgba(7,2,26,1) 100%)",
            border: `1px solid ${accent}33`,
            borderBottom: "none",
            boxShadow: `0 0 60px ${accent}26, 0 -16px 50px rgba(0,0,0,0.7)`,
            display: "flex", flexDirection: "column", overflow: "hidden",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            animation: "ev-sheet-up 0.34s cubic-bezier(0.16, 1, 0.3, 1) both",
          }}
        >
          {/* Drag handle · visual affordance that this is a sheet you can dismiss */}
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px", flexShrink: 0 }}>
            <span style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.22)" }} />
          </div>

          {/* Header */}
          <div style={{
            padding: "10px 18px 14px",
            borderBottom: `1px solid ${accent}1a`,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            flexShrink: 0,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: accent, fontSize: 16, fontWeight: 900, letterSpacing: "0.06em", fontFamily: T.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
              <div style={{ color: T.inkSoft, fontSize: 10.5, fontWeight: 700, marginTop: 2, fontFamily: T.body, letterSpacing: "0.04em" }}>{subline}</div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{
              width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.7)", fontSize: 15, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>✕</button>
          </div>

          {/* Body — discriminated by event type */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 20px", WebkitOverflowScrolling: "touch" }}>
            {(sel.type === "challenge" || sel.type === "cup") && <ChallengeOrCupBody sel={sel} address={address} />}
            {sel.type === "season" && <SeasonBody data={sel.data} address={address} />}
            {sel.type === "live-cup" && <LiveCupBody data={sel.data} address={address} />}
            {sel.type === "live-community" && <LiveCommunityBody data={sel.data} address={address} />}
            {sel.type === "live-climb" && <LiveClimbBody data={sel.data} address={address} />}
          </div>
        </div>
      </div>
    </>
  );
}

function ChallengeOrCupBody({ sel, address }: { sel: Extract<SelectedEvent, { type: "cup" | "challenge" }>; address?: string }) {
  const isChallenge = sel.type === "challenge";
  const winners = sel.data.winners ?? [];
  const rankColor = (r: number) => r === 1 ? "#fbbf24" : r === 2 ? "#e2e8f0" : r === 3 ? "#f97316" : "#a78bfa";
  const rankMedal = (r: number) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "🏅";

  return (
    <>
      <div style={{ color: "rgba(254,215,170,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 8, fontFamily: T.body }}>
        FINAL STANDINGS · {winners.length} {isChallenge ? "QUALIFIER" : "FINALIST"}{winners.length !== 1 ? "S" : ""}
      </div>
      {winners.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "rgba(200,180,255,0.4)", fontSize: 11, fontWeight: 700 }}>No results recorded</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {winners.map(w => {
            const isMe = !!address && w.wallet.toLowerCase() === address.toLowerCase();
            const rc = rankColor(w.rank);
            const rm = rankMedal(w.rank);
            const score = isChallenge ? `${(w as PastChallenge["winners"][number]).plays} plays` : `${(w as PastCompetition["winners"][number]).total} pts`;
            const sub = !isChallenge && (w as PastCompetition["winners"][number]).totalRhythm != null
              ? `🥁 ${(w as PastCompetition["winners"][number]).totalRhythm} + 🧠 ${(w as PastCompetition["winners"][number]).totalSimon}`
              : isChallenge ? `${sel.data.min_plays} plays to qualify` : "";
            const prize = isChallenge ? sel.data.prize_usdc : w.rank === 1 ? sel.data.prizes.first : w.rank === 2 ? sel.data.prizes.second : w.rank === 3 ? sel.data.prizes.third : 0;
            return (
              <div key={w.wallet + w.rank} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 12,
                background: isMe ? `${rc}18` : w.rank <= 3 ? `${rc}0d` : "rgba(255,255,255,0.03)",
                border: isMe ? `1.5px solid ${rc}77` : `1px solid ${w.rank <= 3 ? rc + "33" : "rgba(255,255,255,0.07)"}`,
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{rm}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: isMe ? rc : "#fff", fontSize: 13, fontWeight: isMe ? 900 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: T.body }}>
                    {isMe ? "YOU" : (w.username || fmtName(w.wallet))}
                  </div>
                  {sub && <div style={{ color: "rgba(200,180,255,0.5)", fontSize: 9, fontWeight: 700, marginTop: 2 }}>{sub}</div>}
                  <div style={{ color: "rgba(200,180,255,0.5)", fontSize: 9, fontWeight: 700, marginTop: 1 }}>RANK #{w.rank} · ${prize} USDC</div>
                </div>
                <div style={{ color: rc, fontSize: 14, fontWeight: 900, textShadow: `0 0 8px ${rc}88`, flexShrink: 0, fontFamily: T.display }}>{score}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function SeasonBody({ data, address }: { data: PastSeasonV1; address?: string }) {
  const teams = data.standings.teams ?? [];
  const solo = data.standings.soloTop10 ?? [];
  const closing = data.prize_winners?.closing_surprise;
  const teamColor = (team: string) => team === "alpha" ? "#fb923c" : team === "nova" ? "#67e8f9" : team === "pulse" ? "#a78bfa" : "#fbbf24";
  const rankColor = (r: number) => r === 1 ? "#fbbf24" : r === 2 ? "#e2e8f0" : r === 3 ? "#f97316" : "#a78bfa";
  const rankMedal = (r: number) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "🏅";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Team standings */}
      {teams.length > 0 && (
        <div>
          <div style={{ color: "rgba(254,215,170,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 8, fontFamily: T.body }}>TEAM STANDINGS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {teams.map((t, i) => {
              const tc = teamColor(t.team);
              return (
                <div key={t.team} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: `${tc}14`, border: `1px solid ${tc}44` }}>
                  <span style={{ width: 22, textAlign: "center", fontSize: 13, fontWeight: 900, color: tc, fontFamily: T.display }}>#{i + 1}</span>
                  <span style={{ flex: 1, color: "#fff", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", fontFamily: T.body }}>{t.team.toUpperCase()}</span>
                  <span style={{ color: tc, fontSize: 13, fontWeight: 900, fontFamily: T.display }}>{t.counted}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Solo top 10 */}
      {solo.length > 0 && (
        <div>
          <div style={{ color: "rgba(254,215,170,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 8, fontFamily: T.body }}>SOLO TOP {Math.min(10, solo.length)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {solo.slice(0, 10).map(p => {
              const isMe = !!address && p.wallet?.toLowerCase() === address.toLowerCase();
              const rc = rankColor(p.rank);
              const rm = rankMedal(p.rank);
              return (
                <div key={p.wallet} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderRadius: 10,
                  background: isMe ? `${rc}18` : p.rank <= 3 ? `${rc}0d` : "rgba(255,255,255,0.03)",
                  border: isMe ? `1.5px solid ${rc}77` : `1px solid ${p.rank <= 3 ? rc + "33" : "rgba(255,255,255,0.07)"}`,
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{rm}</span>
                  <span style={{ flex: 1, color: isMe ? rc : "#fff", fontSize: 12, fontWeight: isMe ? 900 : 700, fontFamily: T.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {isMe ? "YOU" : (p.username || (p.wallet ? fmtName(p.wallet) : "anon"))}
                  </span>
                  <span style={{ color: rc, fontSize: 13, fontWeight: 900, fontFamily: T.display, textShadow: `0 0 6px ${rc}66` }}>{p.points}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Closing surprise */}
      {closing && (
        <div style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.4)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🎁</span>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#86efac", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.14em", fontFamily: T.body }}>CLOSING SURPRISE</div>
            <div style={{ color: "#fff", fontSize: 12, fontWeight: 800, marginTop: 2, fontFamily: T.body }}>{closing.username || fmtName(closing.wallet)}</div>
          </div>
          <div style={{ color: "#22c55e", fontSize: 13, fontWeight: 900, fontFamily: T.display }}>${closing.amount_usdc ?? 10}</div>
        </div>
      )}
    </div>
  );
}

// ─── LIVE event detail bodies ────────────────────────────────────────────
// Cup body · cumulative standings (top 25) + your row highlighted + prize ladder.
function LiveCupBody({ data, address }: { data: CompetitionData; address?: string }) {
  const top = data.rankings.slice(0, 25);
  const myIdx = address ? data.rankings.findIndex(r => r.wallet.toLowerCase() === address.toLowerCase()) : -1;
  const myRank = myIdx >= 0 ? myIdx + 1 : 0;
  const rankColor = (r: number) => r === 1 ? "#fbbf24" : r === 2 ? "#e2e8f0" : r === 3 ? "#f97316" : "#a78bfa";
  const rankMedal = (r: number) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "🏅";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Prize ladder reminder */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { r: "1st", p: `$${data.prizes.first}`, c: "#fbbf24" },
          { r: "2nd", p: `$${data.prizes.second}`, c: "#cbd5e1" },
          { r: "3rd", p: `$${data.prizes.third}`,  c: "#cd7f32" },
        ].map(x => (
          <div key={x.r} style={{ flex: 1, textAlign: "center", padding: "6px 4px", borderRadius: 10, background: "rgba(0,0,0,0.3)", border: `1px solid ${x.c}33` }}>
            <div style={{ color: x.c, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", fontFamily: T.body }}>{x.r}</div>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 900, marginTop: 2, fontFamily: T.display }}>{x.p}</div>
          </div>
        ))}
      </div>
      {myRank > 0 && (
        <div style={{ padding: "8px 12px", borderRadius: 10, background: `${T.accent}1f`, border: `1px solid ${T.accent}55`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, fontWeight: 700 }}>Your position</span>
          <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink, letterSpacing: "0.02em" }}>#{myRank} · {data.rankings[myIdx].total} pts</span>
        </div>
      )}
      <div>
        <div style={{ color: "rgba(254,215,170,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 6, fontFamily: T.body }}>CURRENT STANDINGS · TOP {top.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {top.map((r, i) => {
            const isMe = !!address && r.wallet.toLowerCase() === address.toLowerCase();
            const rc = rankColor(i + 1);
            return (
              <div key={r.wallet} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: isMe ? `${rc}18` : i < 3 ? `${rc}0d` : "rgba(255,255,255,0.03)", border: isMe ? `1.5px solid ${rc}77` : `1px solid ${i < 3 ? rc + "33" : "rgba(255,255,255,0.07)"}` }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{rankMedal(i + 1)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: isMe ? rc : "#fff", fontSize: 12, fontWeight: isMe ? 900 : 700, fontFamily: T.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isMe ? "YOU" : (r.username || fmtName(r.wallet))}</div>
                  <div style={{ color: "rgba(200,180,255,0.5)", fontSize: 9, fontWeight: 700, marginTop: 1 }}>🥁 {r.totalRhythm} · 🧠 {r.totalSimon}</div>
                </div>
                <span style={{ color: rc, fontSize: 13, fontWeight: 900, fontFamily: T.display, textShadow: `0 0 6px ${rc}66` }}>{r.total}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Community body · headline progress + top contributors + your contribution.
function LiveCommunityBody({ data, address }: { data: WeeklyChallengeData; address?: string }) {
  const pct = Math.min(100, Math.round((data.progress / Math.max(1, data.target)) * 100));
  const contributors = data.contributors ?? [];
  const myContrib = data.myContribution ?? 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Headline progress */}
      <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.4)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ color: "#86efac", fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", fontFamily: T.body }}>COMMUNITY GOAL</span>
          <span style={{ color: data.hit ? "#86efac" : "rgba(134,239,172,0.7)", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", fontFamily: T.body }}>{data.hit ? "MILESTONE HIT 🎉" : `${data.daysLeft}D LEFT`}</span>
        </div>
        <div style={{ fontFamily: T.display, fontSize: 22, color: "#fff", marginTop: 4 }}>
          {data.progress.toLocaleString()} <span style={{ color: "rgba(134,239,172,0.6)", fontSize: 14 }}>/ {data.target.toLocaleString()}</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: "rgba(0,0,0,0.4)", overflow: "hidden", marginTop: 8 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #16a34a, #86efac)", boxShadow: "0 0 8px #22c55e" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontFamily: T.body, fontSize: 10.5, color: "rgba(220,230,220,0.85)", fontWeight: 700 }}>
          <span>🎁 {data.rewardG.toLocaleString()} G$ split{data.ubiG ? ` · ${data.ubiG} G$ to GoodDollar` : ""}</span>
          <span>👥 {data.playersIn} qualifying</span>
        </div>
      </div>

      {/* Your contribution */}
      {address && (
        <div style={{ padding: "10px 14px", borderRadius: 12, background: `${T.accent}1f`, border: `1px solid ${T.accent}55`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, fontWeight: 700 }}>Your contribution</span>
          <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink, letterSpacing: "0.02em" }}>{myContrib} / {data.capPerPlayer}</span>
        </div>
      )}

      {/* Contributors list */}
      {contributors.length > 0 && (
        <div>
          <div style={{ color: "rgba(254,215,170,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 6, fontFamily: T.body }}>TOP CONTRIBUTORS · {contributors.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {contributors.slice(0, 25).map((c, i) => {
              const isMe = !!address && c.wallet.toLowerCase() === address.toLowerCase();
              const rc = i === 0 ? "#fbbf24" : i === 1 ? "#e2e8f0" : i === 2 ? "#f97316" : "#86efac";
              const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🌍";
              return (
                <div key={c.wallet + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: isMe ? `${rc}18` : i < 3 ? `${rc}0d` : "rgba(255,255,255,0.03)", border: isMe ? `1.5px solid ${rc}77` : `1px solid ${i < 3 ? rc + "33" : "rgba(255,255,255,0.07)"}` }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{medal}</span>
                  <span style={{ flex: 1, color: isMe ? rc : "#fff", fontSize: 12, fontWeight: isMe ? 900 : 700, fontFamily: T.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isMe ? "YOU" : (c.username || fmtName(c.wallet))}</span>
                  <span style={{ color: rc, fontSize: 12, fontWeight: 900, fontFamily: T.display }}>{c.games} games</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Climb body · MARKOV climb standings (match count, qualified flag).
function LiveClimbBody({ data, address }: { data: MarkovClimbData; address?: string }) {
  const ev = data.event;
  const board = data.leaderboard ?? [];
  const minQ = ev?.minMatchesToQualify ?? 30;
  const rankColor = (r: number) => r === 1 ? "#fbbf24" : r === 2 ? "#e2e8f0" : r === 3 ? "#f97316" : "#22c55e";
  const rankMedal = (r: number) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "🤖";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {ev?.prizes?.first && (
        <div style={{ padding: "10px 14px", borderRadius: 12, background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(22,101,52,0.4) 100%)", border: "1px solid rgba(34,197,94,0.4)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ color: "#86efac", fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", fontFamily: T.body }}>1ST PRIZE</span>
            <span style={{ color: "rgba(134,239,172,0.7)", fontSize: 10, fontWeight: 700, fontFamily: T.body }}>{minQ}+ matches qualifies</span>
          </div>
          <div style={{ fontFamily: T.display, fontSize: 18, color: "#fff", marginTop: 4 }}>
            ${ev.prizes.first.usdc ?? 0} USDC + {(ev.prizes.first.g_dollar ?? 0).toLocaleString()} G$
          </div>
        </div>
      )}
      <div>
        <div style={{ color: "rgba(254,215,170,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 6, fontFamily: T.body }}>CLIMB STANDINGS · {board.length}</div>
        {board.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "rgba(200,180,255,0.4)", fontSize: 11 }}>No challengers yet — be first.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {board.slice(0, 25).map(r => {
              const isMe = !!address && r.wallet.toLowerCase() === address.toLowerCase();
              const rc = rankColor(r.rank);
              const remaining = Math.max(0, minQ - r.matches);
              return (
                <div key={r.wallet} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: isMe ? `${rc}18` : r.rank <= 3 ? `${rc}0d` : "rgba(255,255,255,0.03)", border: isMe ? `1.5px solid ${rc}77` : `1px solid ${r.rank <= 3 ? rc + "33" : "rgba(255,255,255,0.07)"}` }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{rankMedal(r.rank)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: isMe ? rc : "#fff", fontSize: 12, fontWeight: isMe ? 900 : 700, fontFamily: T.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isMe ? "YOU" : r.username}</div>
                    <div style={{ color: remaining === 0 ? "#86efac" : "rgba(200,180,255,0.5)", fontSize: 9, fontWeight: 700, marginTop: 1 }}>{remaining === 0 ? "QUALIFIED" : `${remaining} more to qualify`}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <span style={{ color: rc, fontSize: 14, fontWeight: 900, fontFamily: T.display }}>{r.matches}</span>
                    <span style={{ color: "rgba(200,180,255,0.45)", fontSize: 8, fontWeight: 700, letterSpacing: "0.08em" }}>MATCHES</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
