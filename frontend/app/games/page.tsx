"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import BottomNav from "@/components/BottomNav";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// ─── Splash icons ─────────────────────────────────────────────────────────────
const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";
const V = "/splash_screen_icons/vending.png";

// Desktop decoratives — full rich 7+6 set. Hidden on mobile via
// `.icon-float--desktop`.
const LEFT_ICONS = [
  { src: D, top: "1%",  left: "-18px", size: 120, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18 },
  { src: M, top: "8%",  left: "34px",  size: 80,  delay: 0.7, dur: 4.3, glow: "#ffaa00", rotate: 12  },
  { src: G, top: "24%", left: "6px",   size: 110, delay: 1.4, dur: 6.0, glow: "#aa88ff", rotate: -6  },
  { src: D, top: "36%", left: "72px",  size: 140, delay: 0.3, dur: 4.8, glow: "#cc44ff", rotate: 16  },
  { src: J, top: "54%", left: "-10px", size: 105, delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8  },
  { src: G, top: "72%", left: "4px",   size: 108, delay: 2.8, dur: 5.0, glow: "#aa88ff", rotate: -14 },
  { src: D, top: "88%", left: "60px",  size: 95,  delay: 1.9, dur: 4.6, glow: "#cc44ff", rotate: 10  },
];

const RIGHT_ICONS = [
  { src: D, top: "0%",  right: "-22px", size: 115, delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20  },
  { src: J, top: "16%", right: "54px",  size: 100, delay: 1.2, dur: 4.8, glow: "#22aaff", rotate: 8   },
  { src: V, top: "30%", right: "0px",   size: 120, delay: 2.0, dur: 6.2, glow: "#ff44cc", rotate: -4  },
  { src: M, top: "50%", right: "44px",  size: 82,  delay: 0.6, dur: 4.0, glow: "#ffaa00", rotate: -16 },
  { src: D, top: "65%", right: "-8px",  size: 100, delay: 2.4, dur: 5.2, glow: "#cc44ff", rotate: 10  },
  { src: G, top: "80%", right: "58px",  size: 108, delay: 1.8, dur: 5.8, glow: "#aa88ff", rotate: -10 },
];

// Mobile decoratives — 3+3 at viewport edges, matches home/leaderboard.
// Small + translucent, tucked past the edge so half bleeds off-screen —
// atmosphere without competing with the game cards. Hidden on desktop.
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

// ─── Data ─────────────────────────────────────────────────────────────────────

const GAMES = [
  {
    id: "rhythm",
    title: "RHYTHM RUSH",
    wager: "1 G$",
    payout: "1.3×",
    path: "/games/rhythm",
    active: true,
    artGrad: "linear-gradient(160deg, #7e22ce 0%, #a21caf 55%, #6d28d9 100%)",
    glow: "#c026d3",
    accent: "#e879f9",
    showWager: true,
    borderColor: "#f59e0b",
    startWall: "#7c2d00",
    startGrad: "linear-gradient(160deg, #fde68a 0%, #f59e0b 50%, #b45309 100%)",
    startGlow: "rgba(245,158,11,0.75)",
    art: (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/games/rhythm.png" alt="Rhythm Rush" style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.7))" }} />
    ),
  },
  {
    id: "simon",
    title: "SIMON MEMORY",
    wager: "1 G$",
    payout: "1.3×",
    path: "/games/simon",
    active: true,
    artGrad: "linear-gradient(160deg, #0e4f6b 0%, #075985 55%, #0c3f5e 100%)",
    glow: "#06b6d4",
    accent: "#67e8f9",
    showWager: false,
    borderColor: "#22c55e",
    startWall: "#003a00",
    startGrad: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
    startGlow: "rgba(34,197,94,0.75)",
    art: (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/games/simon.png" alt="Simon Memory" style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.7))" }} />
    ),
  },
  {
    id: "coming-soon",
    title: "COMING SOON",
    wager: "—",
    payout: "—",
    path: "",
    active: false,
    artGrad: "linear-gradient(160deg, #2a1860 0%, #1a0c40 55%, #0a0420 100%)",
    glow: "#a78bfa",
    accent: "#a78bfa",
    showWager: false,
    borderColor: "#a78bfa",
    startWall: "#1a0550",
    startGrad: "linear-gradient(160deg, #6b7280 0%, #4b5563 50%, #1f2937 100%)",
    startGlow: "rgba(107,114,128,0.4)",
    art: (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/games/coming-soon.png" alt="Coming Soon" style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.7))" }} />
    ),
  },
];

// ─── Nav sidebar icons ─────────────────────────────────────────────────────────
const NAV_ITEMS = [
  {
    label: "Home",
    path: "/home",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
      </svg>
    ),
  },
  {
    label: "Games",
    path: "/games",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 6H3a1 1 0 00-1 1v10a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zm-10 7H9v2H7v-2H5v-2h2V9h2v2h2v2zm4.5 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-3a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/>
      </svg>
    ),
  },
  {
    label: "Leaderboard",
    path: "/leaderboard",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11 21H5a2 2 0 01-2-2v-7a2 2 0 012-2h6v11zm2 0V6a2 2 0 012-2h4a2 2 0 012 2v13h-8z"/>
      </svg>
    ),
  },
  {
    label: "Profile",
    path: "/profile",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
      </svg>
    ),
  },
];

// ─── Stats data ────────────────────────────────────────────────────────────────
// Stat pill icons + colors. Values come from /api/stats at runtime.
const STAT_ICONS = {
  players: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>,
  games:   <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3a1 1 0 00-1 1v10a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zm-10 7H9v2H7v-2H5v-2h2V9h2v2h2v2zm4.5 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-3a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>,
  pot:     <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/></svg>,
};

function fmtNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000)    return `${Math.round(n / 1000)}K`;
  if (n >= 1_000)     return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function GamesPage() {
  const router = useRouter();
  const activePath = "/games";
  const { address } = useAccount();
  // Mobile swaps the 68px left sidebar for a fixed bottom tab bar.
  const isMobile = useIsMobile();
  const [streak, setStreak] = useState<{ streak: number; playedToday: boolean } | null>(null);

  useEffect(() => {
    if (!address) { setStreak(null); return; }
    fetch(`${BACKEND_URL}/api/streak/${address}`)
      .then(r => r.json())
      .then(data => setStreak({ streak: data.streak || 0, playedToday: !!data.playedToday }))
      .catch(() => setStreak(null));
  }, [address]);

  // Daily missions
  type Mission = { id: number; missionId: string; label: string; progress: number; target: number; completed: boolean; claimed: boolean; rewardXp: number };
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionResetSec, setMissionResetSec] = useState(0);
  const refetchMissions = () => {
    if (!address) { setMissions([]); return; }
    fetch(`${BACKEND_URL}/api/missions/today/${address}`)
      .then(r => r.json())
      .then(d => { setMissions(d.missions || []); setMissionResetSec(d.secondsUntilReset || 0); })
      .catch(() => setMissions([]));
  };
  useEffect(() => { refetchMissions(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [address]);
  useEffect(() => {
    if (missionResetSec <= 0) return;
    const t = setInterval(() => setMissionResetSec(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [missionResetSec]);
  function fmtCountdown(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  // GoodDollar daily claim entitlement (for the EVENTS section)
  const { isVerified, entitlement, claimG$ } = useSelfVerification();
  const claimableG = entitlement && Number(entitlement) > 0;

  // Global stats for the top pills (PLAYERS / GAMES / POT)
  const [stats, setStats] = useState<{ totalUsers: number; totalGames: number; estimatedPrizePot: string }>({
    totalUsers: 0, totalGames: 0, estimatedPrizePot: "0",
  });
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/stats`)
      .then(r => r.json())
      .then(d => setStats({
        totalUsers: d.totalUsers || 0,
        totalGames: d.totalGames || 0,
        estimatedPrizePot: d.estimatedPrizePot || "0",
      }))
      .catch(() => {});
  }, []);

  // EVENTS data — real season countdown + 3-week competition state
  type EventCard = { icon: string; color: string; title: string; subtitle: string; onClick?: () => void };
  const [seasonInfo, setSeasonInfo] = useState<{ season: number; endsAt: number } | null>(null);
  const [compInfo, setCompInfo] = useState<{ weeksLeft: number; total: number } | null>(null);
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/seasons`)
      .then(r => r.json())
      .then(d => setSeasonInfo({ season: d.currentSeason || 0, endsAt: d.currentEndsAt || 0 }))
      .catch(() => {});
    fetch(`${BACKEND_URL}/api/competition`)
      .then(r => r.json())
      .then(d => {
        if (d?.weeksLeft > 0) {
          const total = (d.prizes?.first || 0) + (d.prizes?.second || 0) + (d.prizes?.third || 0);
          setCompInfo({ weeksLeft: d.weeksLeft, total });
        }
      })
      .catch(() => {});
  }, []);
  // Real-time countdown to season end (re-renders every minute, not every second to save CPU)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60000);
    return () => clearInterval(t);
  }, []);
  function fmtShortCountdown(secondsLeft: number) {
    if (secondsLeft <= 0) return "ended";
    const d = Math.floor(secondsLeft / 86400);
    const h = Math.floor((secondsLeft % 86400) / 3600);
    if (d > 0) return `${d}d ${h}h`;
    const m = Math.floor((secondsLeft % 3600) / 60);
    return `${h}h ${m}m`;
  }

  // SMART NEWS — curated highlights from real backend data:
  //   - This week's leaders (rhythm + simon)
  //   - Most recent championship winner
  //   - 3-week competition leader
  type NewsItem = { icon: string; color: string; title: string; subtitle: string };
  const [news, setNews] = useState<NewsItem[]>([]);
  useEffect(() => {
    const shortName = (addr: string, name?: string | null) =>
      name || `${addr.slice(0, 4)}...${addr.slice(-3)}`;

    Promise.all([
      fetch(`${BACKEND_URL}/api/leaderboard?game=rhythm&offset=0&limit=1`).then(r => r.json()).catch(() => null),
      fetch(`${BACKEND_URL}/api/leaderboard?game=simon&offset=0&limit=1`).then(r => r.json()).catch(() => null),
      fetch(`${BACKEND_URL}/api/seasons`).then(r => r.json()).catch(() => null),
      fetch(`${BACKEND_URL}/api/competition`).then(r => r.json()).catch(() => null),
    ]).then(([rhythmLb, simonLb, seasons, comp]) => {
      const items: NewsItem[] = [];
      const rLeader = rhythmLb?.leaderboard?.[0];
      const sLeader = simonLb?.leaderboard?.[0];
      if (rLeader) items.push({
        icon: "🥁", color: "#c026d3",
        title: `${shortName(rLeader.player, rLeader.username)} leads Rhythm Rush`,
        subtitle: `${rLeader.score} pts this week`,
      });
      if (sLeader) items.push({
        icon: "🧠", color: "#06b6d4",
        title: `${shortName(sLeader.player, sLeader.username)} tops Simon Memory`,
        subtitle: `${sLeader.score} pts this week`,
      });
      const lastChamp = seasons?.past?.[0];
      const champWinner = lastChamp?.rhythm?.[0] || lastChamp?.simon?.[0];
      if (lastChamp && champWinner) items.push({
        icon: "👑", color: "#fbbf24",
        title: `${shortName(champWinner.player, champWinner.username)} won Season ${lastChamp.season}`,
        subtitle: `${lastChamp.totalPlayers || 0} players competed`,
      });
      const compLeader = comp?.rankings?.[0];
      if (compLeader && comp?.weeksLeft > 0) items.push({
        icon: "🏆", color: "#fbbf24",
        title: `${shortName(compLeader.wallet, compLeader.username)} leads 3-Week Cup`,
        subtitle: `${compLeader.total} pts · ${comp.weeksLeft} weeks left`,
      });
      setNews(items.slice(0, 4));
    });
  }, []);
  async function claimMission(id: number) {
    if (!address) return;
    try {
      await fetch(`${BACKEND_URL}/api/missions/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, missionId: id }),
      });
    } catch {}
    refetchMissions();
  }

  // Activity card — missions + events + highlights. Rendered on the desktop
  // right sidebar AND below the game cards on mobile (fills what was dead
  // viewport below the cards — top games always have live content there).
  const activityCard = (
    <div style={{
      borderRadius: "16px",
      background: "rgba(20,10,50,0.82)",
      border: "1px solid rgba(255,255,255,0.1)",
      overflow: "hidden",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        background: "linear-gradient(135deg, #3b1fa3 0%, #6d28d9 60%, #3b1fa3 100%)",
        padding: "12px 14px",
        position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "50%",
          background: "linear-gradient(180deg,rgba(255,255,255,0.28) 0%,transparent 100%)",
          pointerEvents: "none",
        }}/>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", position: "relative", zIndex: 1 }}>
          <span style={{ fontSize: "14px" }}>🎯</span>
          <span style={{ color: "white", fontSize: "13px", fontWeight: 900, letterSpacing: "0.1em" }}>DAILY MISSIONS</span>
        </div>
        {address && missions.length > 0 && (
          <div style={{ position: "relative", zIndex: 1, color: "#fbbf24", fontSize: "10px", fontWeight: 900, fontFamily: "monospace", textShadow: "0 0 8px rgba(251,191,36,0.6)" }}>
            {fmtCountdown(missionResetSec)}
          </div>
        )}
      </div>

      {/* Body — desktop sidebar has fixed height, so inner scroll makes
          sense there. On mobile the card sits inside the page's own
          scroll column, so nesting another scroll is disorienting — use
          natural height instead. */}
      <div style={{
        padding: "10px 12px",
        display: "flex", flexDirection: "column", gap: "10px",
        overflowY: isMobile ? "visible" : "auto",
        flex: isMobile ? "0 0 auto" : 1,
      }}>
        {/* MISSIONS */}
        {!address ? (
          <div style={{ padding: "20px 8px", textAlign: "center", color: "rgba(200,180,255,0.5)", fontSize: "10px", fontWeight: 700 }}>
            Connect wallet to see daily missions
          </div>
        ) : missions.length === 0 ? (
          <div style={{ padding: "20px 8px", textAlign: "center", color: "rgba(200,180,255,0.5)", fontSize: "10px", fontWeight: 700 }}>
            Loading missions...
          </div>
        ) : (
          missions.map(m => {
            const pct = Math.round((m.progress / m.target) * 100);
            const ready = m.completed && !m.claimed;
            const done  = m.claimed;
            return (
              <div key={m.id} style={{
                borderRadius: "12px",
                background: done
                  ? "linear-gradient(180deg, rgba(34,197,94,0.08) 0%, rgba(0,0,0,0.2) 100%)"
                  : ready
                    ? "linear-gradient(180deg, rgba(251,191,36,0.18) 0%, rgba(0,0,0,0.2) 100%)"
                    : "rgba(255,255,255,0.04)",
                border: `1.5px solid ${done ? "rgba(34,197,94,0.45)" : ready ? "#fbbf24" : "rgba(167,139,250,0.22)"}`,
                boxShadow: ready ? "0 0 12px rgba(251,191,36,0.4)" : "none",
                padding: "9px 10px",
                display: "flex", flexDirection: "column", gap: "6px",
                opacity: done ? 0.6 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "6px" }}>
                  <div style={{ color: "white", fontSize: "10px", fontWeight: 700, lineHeight: 1.3, flex: 1 }}>{m.label}</div>
                  <div style={{ color: "#fbbf24", fontSize: "9px", fontWeight: 900, whiteSpace: "nowrap", flexShrink: 0 }}>+{m.rewardXp} XP</div>
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                    <span style={{ color: "rgba(200,180,255,0.55)", fontSize: "8px", fontWeight: 700 }}>{m.progress} / {m.target}</span>
                    <span style={{ color: "rgba(200,180,255,0.55)", fontSize: "8px", fontWeight: 700 }}>{pct}%</span>
                  </div>
                  <div style={{ height: "5px", borderRadius: "999px", background: "rgba(0,0,0,0.5)", overflow: "hidden", border: "1px solid rgba(167,139,250,0.12)" }}>
                    <div style={{
                      width: `${pct}%`, height: "100%", borderRadius: "999px",
                      background: done ? "#22c55e" : ready ? "#fbbf24" : "#a78bfa",
                      boxShadow: ready ? "0 0 6px rgba(251,191,36,0.6)" : "none",
                      transition: "width 0.3s",
                    }} />
                  </div>
                </div>
                {done ? (
                  <div style={{ textAlign: "center", color: "#22c55e", fontSize: "9px", fontWeight: 900, letterSpacing: "0.1em" }}>✓ CLAIMED</div>
                ) : ready ? (
                  <div role="button" tabIndex={0} onClick={() => claimMission(m.id)} style={{ cursor: "pointer", userSelect: "none" }}>
                    <div style={{
                      borderRadius: "8px",
                      background: "linear-gradient(180deg, #fbbf24 0%, #b45309 100%)",
                      padding: "5px", textAlign: "center",
                      border: "1.5px solid rgba(255,255,255,0.45)",
                      boxShadow: "inset 0 3px 6px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.3)",
                    }}>
                      <span style={{ color: "white", fontSize: "10px", fontWeight: 900, letterSpacing: "0.14em", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>CLAIM</span>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        {/* EVENTS */}
        <div style={{ fontSize: "9px", fontWeight: 900, letterSpacing: "0.15em", color: "rgba(200,180,255,0.7)", marginTop: "6px" }}>EVENTS</div>
        {(() => {
          const events: EventCard[] = [];
          if (seasonInfo && seasonInfo.endsAt > 0) {
            events.push({
              icon: "🗓️", color: "#a78bfa",
              title: `Season ${seasonInfo.season} — ends in ${fmtShortCountdown(seasonInfo.endsAt - now)}`,
              subtitle: "Top 3 win · View →",
              onClick: () => router.push("/leaderboard"),
            });
          }
          if (compInfo) {
            events.push({
              icon: "🏆", color: "#fbbf24",
              title: `3-Week Cup — ${compInfo.weeksLeft} week${compInfo.weeksLeft !== 1 ? "s" : ""} left`,
              subtitle: `$${compInfo.total} pool · Cumulative · View →`,
              onClick: () => router.push("/leaderboard"),
            });
          }
          if (isVerified && claimableG) {
            events.push({
              icon: "💰", color: "#22c55e",
              title: "Daily G$ ready to claim",
              subtitle: `${(Number(entitlement) / 1e18).toFixed(2)} G$ · Tap to claim`,
              onClick: () => claimG$(),
            });
          }
          if (events.length === 0) {
            return <div style={{ padding: "10px 4px", textAlign: "center", color: "rgba(200,180,255,0.4)", fontSize: "9px", fontWeight: 700 }}>No active events</div>;
          }
          return events.map((e, i) => {
            const interactive = !!e.onClick;
            return (
              <div key={i}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={e.onClick}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: "10px",
                  border: `1px solid ${e.color}33`,
                  padding: "7px 9px",
                  cursor: interactive ? "pointer" : "default",
                  userSelect: "none",
                  transition: "transform 0.15s, border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={el => {
                  if (!interactive) return;
                  const t = el.currentTarget as HTMLDivElement;
                  t.style.transform = "translateY(-1px)";
                  t.style.background = "rgba(255,255,255,0.07)";
                  t.style.borderColor = `${e.color}88`;
                }}
                onMouseLeave={el => {
                  const t = el.currentTarget as HTMLDivElement;
                  t.style.transform = "";
                  t.style.background = "rgba(255,255,255,0.04)";
                  t.style.borderColor = `${e.color}33`;
                }}
              >
                <div style={{
                  width: "28px", height: "28px", borderRadius: "8px", flexShrink: 0,
                  background: `radial-gradient(circle at 35% 30%, ${e.color}cc, ${e.color}44)`,
                  border: `1px solid ${e.color}66`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "14px", boxShadow: `0 0 8px ${e.color}33`,
                }}>{e.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "white", fontSize: "10px", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</div>
                  <div style={{ color: "rgba(200,180,255,0.55)", fontSize: "8px", fontWeight: 700, marginTop: "1px" }}>{e.subtitle}</div>
                </div>
              </div>
            );
          });
        })()}

        {/* HIGHLIGHTS */}
        <div style={{ fontSize: "9px", fontWeight: 900, letterSpacing: "0.15em", color: "rgba(200,180,255,0.7)", marginTop: "6px" }}>HIGHLIGHTS</div>
        {news.length === 0 ? (
          <div style={{ padding: "10px 4px", textAlign: "center", color: "rgba(200,180,255,0.4)", fontSize: "9px", fontWeight: 700 }}>Loading highlights...</div>
        ) : news.map((n, i) => (
          <div key={i}
            role="button" tabIndex={0}
            onClick={() => router.push("/leaderboard")}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "10px",
              border: `1px solid ${n.color}33`,
              padding: "7px 9px",
              cursor: "pointer", userSelect: "none",
              transition: "transform 0.15s, border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={el => {
              const t = el.currentTarget as HTMLDivElement;
              t.style.transform = "translateY(-1px)";
              t.style.background = "rgba(255,255,255,0.07)";
              t.style.borderColor = `${n.color}88`;
            }}
            onMouseLeave={el => {
              const t = el.currentTarget as HTMLDivElement;
              t.style.transform = "";
              t.style.background = "rgba(255,255,255,0.04)";
              t.style.borderColor = `${n.color}33`;
            }}
          >
            <div style={{
              width: "28px", height: "28px", borderRadius: "8px", flexShrink: 0,
              background: `radial-gradient(circle at 35% 30%, ${n.color}cc, ${n.color}44)`,
              border: `1px solid ${n.color}66`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "14px", boxShadow: `0 0 8px ${n.color}33`,
            }}>{n.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "white", fontSize: "10px", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</div>
              <div style={{ color: "rgba(200,180,255,0.55)", fontSize: "8px", fontWeight: 700, marginTop: "1px" }}>{n.subtitle}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "linear-gradient(160deg, #4c1d95 0%, #3b0a9e 35%, #1e0762 65%, #0d0230 100%)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Left icons — desktop only (hidden on mobile via CSS) */}
      {LEFT_ICONS.map((icon, i) => (
        <div
          key={`l-${i}`}
          className="icon-float icon-float--desktop"
          style={{
            position: "absolute",
            top: icon.top,
            left: icon.left,
            width: icon.size,
            height: icon.size,
            transform: `rotate(${icon.rotate}deg)`,
            filter: `drop-shadow(0 0 8px ${icon.glow}99)`,
            ["--dur" as string]: `${icon.dur}s`,
            ["--delay" as string]: `${icon.delay}s`,
            userSelect: "none",
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon.src} alt="" width={icon.size} height={icon.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}

      {/* Right icons — desktop only */}
      {RIGHT_ICONS.map((icon, i) => (
        <div
          key={`r-${i}`}
          className="icon-float icon-float--desktop"
          style={{
            position: "absolute",
            top: icon.top,
            right: icon.right,
            width: icon.size,
            height: icon.size,
            transform: `rotate(${icon.rotate}deg)`,
            filter: `drop-shadow(0 0 8px ${icon.glow}99)`,
            ["--dur" as string]: `${icon.dur}s`,
            ["--delay" as string]: `${icon.delay}s`,
            userSelect: "none",
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon.src} alt="" width={icon.size} height={icon.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}

      {/* Mobile decoratives — 3+3 hidden on desktop via CSS */}
      {MOBILE_LEFT_ICONS.map((icon, i) => (
        <div
          key={`ml-${i}`}
          className="icon-float icon-float--mobile"
          style={{
            position: "absolute",
            top: icon.top,
            left: icon.left,
            width: icon.size,
            height: icon.size,
            transform: `rotate(${icon.rotate}deg)`,
            filter: `drop-shadow(0 0 6px ${icon.glow}55)`,
            opacity: icon.opacity,
            ["--dur" as string]: `${icon.dur}s`,
            ["--delay" as string]: `${icon.delay}s`,
            userSelect: "none",
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon.src} alt="" width={icon.size} height={icon.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}
      {MOBILE_RIGHT_ICONS.map((icon, i) => (
        <div
          key={`mr-${i}`}
          className="icon-float icon-float--mobile"
          style={{
            position: "absolute",
            top: icon.top,
            right: icon.right,
            width: icon.size,
            height: icon.size,
            transform: `rotate(${icon.rotate}deg)`,
            filter: `drop-shadow(0 0 6px ${icon.glow}55)`,
            opacity: icon.opacity,
            ["--dur" as string]: `${icon.dur}s`,
            ["--delay" as string]: `${icon.delay}s`,
            userSelect: "none",
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon.src} alt="" width={icon.size} height={icon.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}

      {/* ── Body (sidebar + center + news). Sidebar hides on mobile; a
              fixed BottomNav renders at the bottom of the page instead. ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative", zIndex: 2 }}>

        {/* ── Left nav sidebar — desktop only ── */}
        {!isMobile && <div style={{
          width: "68px", flexShrink: 0,
          alignSelf: "stretch",
          background: "rgba(4,1,18,0.95)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "16px 0",
          gap: "6px",
        }}>
          {/* Streak chip — Duolingo style, persistent across pages.
              • Played today → warm orange flame, alive.
              • Not played today → FROZEN (blue flame via hue-rotate),
                universally readable "streak on ice, play to thaw" signal. */}
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
              cursor: "default",
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

          {/* Spacer to vertically center the nav */}
          <div style={{ flex: 1 }} />

          {NAV_ITEMS.map(item => {
            const isActive = item.path === activePath;
            return (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                style={{
                  width: "54px",
                  borderRadius: "12px",
                  padding: "8px 4px 6px",
                  background: isActive ? "rgba(255,255,255,0.18)" : "transparent",
                  border: "none",
                  color: isActive ? "white" : "rgba(255,255,255,0.55)",
                  display: "flex", flexDirection: "column", alignItems: "center",
                  gap: "4px",
                  cursor: "pointer", fontFamily: "inherit",
                  transition: "all 0.15s",
                  boxShadow: isActive
                    ? "0 0 0 1px rgba(255,255,255,0.15), 0 4px 12px rgba(0,0,0,0.4)"
                    : "none",
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.55)"; }}
              >
                {item.icon}
                <span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em" }}>
                  {item.label.toUpperCase()}
                </span>
              </button>
            );
          })}

          {/* Bottom spacer to keep nav centered */}
          <div style={{ flex: 1 }} />
        </div>}

        {/* ── Center: stats + logo + game cards ── */}
        <div style={{
          flex: 1, minWidth: 0,
          overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
        <div style={{
          flex: 1,
          display: "flex", flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "flex-start" : "center",
          // Extra bottom padding on mobile so game cards clear the 64px
          // fixed BottomNav instead of scrolling behind it.
          padding: isMobile ? "14px 14px 96px" : "14px 12px 16px",
          gap: isMobile ? "14px" : "12px",
          overflowY: "auto",
        }}>

          {/* Stats pills — compact on mobile. On mobile we also append a
              STREAK pill as the 4th member when the user is connected
              with a non-zero streak, instead of floating a separate chip
              that overlaps the POT pill edge. */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: isMobile ? "6px" : "10px",
            flexWrap: isMobile ? "nowrap" : "wrap",
            flexShrink: 0,
            width: "100%",
          }}>
            {(() => {
              type Pill = {
                icon: React.ReactNode; label: string; value: string;
                borderColor: string; textColor: string;
                // Streak pill uses a hot/frozen visual to mirror the
                // desktop sidebar; regular stats pills just have one color.
                streakMode?: "hot" | "frozen";
              };
              const pills: Pill[] = [
                { icon: STAT_ICONS.players, label: "PLAYERS", value: fmtNumber(stats.totalUsers), borderColor: "#a78bfa", textColor: "#c4b5fd" },
                { icon: STAT_ICONS.games,   label: "GAMES",   value: fmtNumber(stats.totalGames), borderColor: "#a78bfa", textColor: "#c4b5fd" },
                { icon: STAT_ICONS.pot,     label: "POT",     value: isMobile ? `${Number(stats.estimatedPrizePot).toFixed(0)}` : `${Number(stats.estimatedPrizePot).toFixed(2)} G$`, borderColor: "#fbbf24", textColor: "#fde68a" },
              ];
              if (isMobile && address && streak && streak.streak > 0) {
                const hot = streak.playedToday;
                pills.push({
                  icon: <span style={{
                    fontSize: "13px", lineHeight: 1,
                    filter: hot
                      ? "drop-shadow(0 0 4px rgba(249,115,22,0.9))"
                      : "hue-rotate(190deg) saturate(1.3) brightness(0.95) drop-shadow(0 0 3px rgba(56,189,248,0.7))",
                  }}>🔥</span>,
                  label: "STREAK",
                  value: String(streak.streak),
                  borderColor: hot ? "#f97316" : "#38bdf8",
                  textColor: hot ? "#fbbf24" : "#bae6fd",
                  streakMode: hot ? "hot" : "frozen",
                });
              }
              return pills.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center",
                  gap: isMobile ? "4px" : "7px",
                  padding: isMobile ? "5px 9px" : "7px 16px",
                  borderRadius: "24px",
                  background: "rgba(8,2,28,0.65)",
                  border: `${isMobile ? 1.5 : 2}px solid ${s.borderColor}`,
                  boxShadow: `0 0 ${isMobile ? 10 : 16}px ${s.borderColor}55, inset 0 1px 0 rgba(255,255,255,0.06)`,
                  minWidth: 0,
                }}>
                  <span style={{ color: s.textColor, display: "flex" }}>
                    {s.streakMode
                      ? s.icon
                      : isMobile
                        ? <span style={{ width: 14, height: 14, display: "inline-flex" }}>{s.icon}</span>
                        : s.icon}
                  </span>
                  {/* Label — tiny on mobile, standard on desktop. Streak
                      pill drops the label on mobile (the 🔥 is self-explanatory
                      and the pill is already the 4th one in a tight row). */}
                  {!(isMobile && s.streakMode) && (
                    <span style={{
                      color: s.textColor,
                      fontSize: isMobile ? "8px" : "10px",
                      fontWeight: 700,
                      letterSpacing: isMobile ? "0.1em" : "0.12em",
                    }}>{s.label}{isMobile ? "" : ":"}</span>
                  )}
                  <span style={{
                    color: s.streakMode ? s.textColor : "white",
                    fontSize: isMobile ? "11px" : "13px",
                    fontWeight: 900,
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                    textShadow: s.streakMode === "hot"
                      ? "0 0 6px rgba(251,191,36,0.7)"
                      : s.streakMode === "frozen"
                        ? "0 0 5px rgba(56,189,248,0.6)"
                        : undefined,
                  }}>{s.value}{isMobile && s.label === "POT" ? " G$" : ""}</span>
                </div>
              ));
            })()}
          </div>

          {/* Logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/components/game_arena_text.png"
            alt="Game Arena"
            style={{
              width: isMobile ? "clamp(180px, 55vw, 280px)" : "clamp(180px, 32vw, 420px)",
              height: "auto",
              filter: "drop-shadow(0 0 24px rgba(160,100,255,0.6))",
              flexShrink: 0,
            }}
          />

          {/* Game cards — desktop shows a 3-column row with fixed height,
              mobile stacks horizontal cards (art left, info right) so each
              game gets real estate and all three fit without cramping. */}
          <div style={{
            display: isMobile ? "flex" : "grid",
            flexDirection: isMobile ? "column" : undefined,
            gridTemplateColumns: isMobile ? undefined : "repeat(3, 1fr)",
            gap: isMobile ? "12px" : "14px",
            width: "100%",
            maxWidth: "680px",
            height: isMobile ? "auto" : "clamp(280px, 48vh, 420px)",
          }}>
            {GAMES.map(g => (
              <GameCard
                key={g.id}
                game={g}
                isMobile={isMobile}
                onStart={() => g.path && router.push(g.path)}
              />
            ))}
          </div>

          {/* Mobile activity panel — same card as the desktop sidebar,
              rendered inside the scrollable center so it fills what was
              dead space below the cards. Top-game menus keep users in the
              app with live missions/events/highlights. */}
          {isMobile && (
            <div style={{ width: "100%", maxWidth: "680px", marginTop: "4px" }}>
              {activityCard}
            </div>
          )}
        </div>
        </div>

        {/* ── Right: NEWS / EVENTS panel — desktop only. On mobile the
              same panel is rendered below the game cards (inside the
              center scrollable area) so that dead viewport is filled
              with live content. ── */}
        {!isMobile && <div style={{
          width: "clamp(220px, 24vw, 290px)", flexShrink: 0,
          alignSelf: "center",
          display: "flex", flexDirection: "column",
          padding: "0 12px 0 8px",
        }}>
          {activityCard}
        </div>}
      </div>

      {/* Mobile bottom tab nav — replaces the desktop sidebar when < 768px */}
      {isMobile && <BottomNav />}
      {/* Streak is rendered inline as the 4th stats pill on mobile (see
          the pills array above), not as a floating chip — avoids the
          edge collision with the POT pill. */}
    </div>
  );
}


// ─── GameCard ─────────────────────────────────────────────────────────────────
function GameCard({
  game,
  isMobile,
  onStart,
}: {
  game: typeof GAMES[number];
  isMobile: boolean;
  onStart: () => void;
}) {
  // Mobile: horizontal layout — art left (fixed), info column right.
  // Keeps each card compact (~120px tall) so all 3 games fit without
  // forcing long scrolls, and each one reads as a clean list item.
  if (isMobile) {
    return (
      <div
        onClick={() => game.active && onStart()}
        style={{
          cursor: game.active ? "pointer" : "default",
          borderRadius: "18px",
          padding: "2px",
          background: `linear-gradient(135deg, ${game.borderColor} 0%, ${game.borderColor}66 100%)`,
          boxShadow: `0 10px 26px -6px ${game.glow}77, 0 0 0 1px ${game.borderColor}33`,
        }}
      >
        <div style={{
          borderRadius: "16px",
          background: "linear-gradient(135deg, #230d6b 0%, #0e0535 70%, #060118 100%)",
          display: "flex",
          alignItems: "stretch",
          overflow: "hidden",
          minHeight: "104px",
        }}>
          {/* Art tile — left side, fixed square */}
          <div style={{
            width: "104px", flexShrink: 0,
            background: game.artGrad,
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: "45%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)",
              pointerEvents: "none",
            }} />
            <div style={{
              width: "82%", height: "82%",
              filter: !game.active ? "opacity(0.4) grayscale(0.7)" : "drop-shadow(0 4px 10px rgba(0,0,0,0.7))",
            }}>
              {game.art}
            </div>
          </div>

          {/* Info column — title on top, wager + START on bottom row.
              Card is tappable as a whole; START is a juicy accent, not a
              full-width slab. ~140px button reads as a call-to-action,
              not "this whole thing is one giant button". */}
          <div style={{
            flex: 1, minWidth: 0,
            padding: "12px 12px 12px 14px",
            display: "flex", flexDirection: "column", gap: "10px",
            justifyContent: "space-between",
          }}>
            <div>
              <div style={{
                color: "white",
                fontSize: "15px", fontWeight: 900,
                letterSpacing: "0.04em", lineHeight: 1.15,
                textShadow: `0 0 12px ${game.borderColor}cc, 0 2px 4px rgba(0,0,0,0.9)`,
              }}>
                {game.title}
              </div>
              {/* Wager pill sits under the title — more prominent than a
                  tiny corner chip, and balances the START button below. */}
              {game.active && (
                <div style={{
                  display: "inline-flex", alignItems: "baseline", gap: "5px",
                  padding: "2px 9px",
                  marginTop: "6px",
                  borderRadius: "999px",
                  background: "rgba(0,0,0,0.45)",
                  border: `1px solid ${game.borderColor}55`,
                }}>
                  <span style={{ color: "rgba(200,170,255,0.8)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.08em" }}>
                    BET {game.wager}
                  </span>
                  <span style={{ color: game.borderColor, fontSize: "10px", fontWeight: 900 }}>
                    · {game.payout}
                  </span>
                </div>
              )}
            </div>

            {/* Bottom action — compact START, right-aligned. */}
            {game.active ? (
              <div
                role="button" tabIndex={0}
                onClick={e => { e.stopPropagation(); onStart(); }}
                style={{
                  cursor: "pointer", userSelect: "none",
                  alignSelf: "flex-end",
                  minWidth: "128px",
                  transition: "transform 0.12s",
                }}
                onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(2px)"; }}
                onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
              >
                <div style={{
                  borderRadius: "12px",
                  background: game.startWall,
                  paddingBottom: "4px",
                  boxShadow: `0 6px 14px -2px ${game.startGlow}`,
                }}>
                  <div style={{
                    borderRadius: "10px 10px 8px 8px",
                    background: game.startGrad,
                    padding: "8px 18px",
                    textAlign: "center",
                    border: "2px solid rgba(255,255,255,0.5)",
                    boxShadow: "inset 0 4px 10px rgba(255,255,255,0.6), inset 0 -2px 6px rgba(0,0,0,0.3)",
                  }}>
                    <span style={{
                      color: "white", fontSize: "12px", fontWeight: 900,
                      letterSpacing: "0.18em",
                      textShadow: "0 1px 3px rgba(0,0,0,0.5)",
                    }}>START ▸</span>
                  </div>
                </div>
              </div>
            ) : (
              // LOCKED — right-aligned + compact, mirroring START's width
              // so the three cards feel visually consistent.
              <div style={{
                alignSelf: "flex-end",
                minWidth: "128px",
                borderRadius: "12px", padding: "10px 18px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                textAlign: "center", color: "rgba(180,150,255,0.35)",
                fontSize: "11px", fontWeight: 800, letterSpacing: "0.18em",
              }}>LOCKED</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Desktop: unchanged 3-column tall cards.
  return (
    <div
      style={{
        height: "100%",
        transition: "transform 0.18s cubic-bezier(0.34,1.56,0.64,1)",
        cursor: game.active ? "pointer" : "default",
      }}
      onMouseEnter={e => { if (game.active) (e.currentTarget as HTMLDivElement).style.transform = "scale(1.04) translateY(-6px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"; }}
    >
      {/* Neon border wrapper — gradient border + glow */}
      <div style={{
        height: "100%",
        borderRadius: "22px",
        padding: "3px",
        background: `linear-gradient(180deg, ${game.borderColor} 0%, ${game.borderColor}88 100%)`,
        boxShadow: [
          `0 0 0 1px ${game.borderColor}44`,
          `0 0 20px ${game.borderColor}88`,
          `0 0 50px ${game.borderColor}33`,
          `0 20px 50px -10px ${game.glow}88`,
        ].join(", "),
      }}>
        {/* Card inner — flex column filling full height */}
        <div style={{
          height: "100%",
          borderRadius: "20px",
          background: "linear-gradient(180deg, #230d6b 0%, #0e0535 60%, #060118 100%)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>

          {/* ── Title strip ── */}
          <div style={{
            padding: "12px 8px 10px",
            textAlign: "center",
            flexShrink: 0,
            background: `linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 100%)`,
          }}>
            <span style={{
              color: "white",
              fontSize: "15px",
              fontWeight: 900,
              letterSpacing: "0.06em",
              lineHeight: 1.1,
              display: "block",
              textShadow: `0 0 16px ${game.borderColor}dd, 0 2px 6px rgba(0,0,0,0.9)`,
            }}>
              {game.title.replace(" ", "\n")}
            </span>
          </div>

          {/* ── Art — grows to fill available space ── */}
          <div style={{
            flex: 1, minHeight: 0,
            background: game.artGrad,
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", overflow: "hidden",
          }}>
            {/* Top gloss */}
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: "35%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 100%)",
              pointerEvents: "none",
            }} />
            {/* Bottom fade into card */}
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0, height: "30%",
              background: "linear-gradient(0deg, rgba(6,1,24,0.7) 0%, transparent 100%)",
              pointerEvents: "none",
            }} />
            {!game.active && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(5,1,20,0.7)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{
                  fontSize: "9px", fontWeight: 900, letterSpacing: "0.16em",
                  color: "rgba(180,150,255,0.85)",
                  border: "1px solid rgba(140,80,255,0.5)", padding: "5px 12px",
                  borderRadius: "20px", background: "rgba(40,10,80,0.8)",
                }}>COMING SOON</span>
              </div>
            )}
            <div style={{
              filter: !game.active ? "opacity(0.35) grayscale(0.7)" : "drop-shadow(0 6px 16px rgba(0,0,0,0.8))",
              zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {game.art}
            </div>
          </div>

          {/* ── BET / WIN — only for games that have a wager ── */}
          {game.active && game.showWager && (
            <div style={{
              display: "flex",
              borderTop: `1px solid ${game.borderColor}44`,
              borderBottom: `1px solid ${game.borderColor}22`,
              flexShrink: 0,
            }}>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ color: "rgba(200,170,255,0.5)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.1em" }}>BET</div>
                <div style={{ color: "white", fontSize: "13px", fontWeight: 900 }}>{game.wager}</div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px" }}>
                <div style={{ color: "rgba(200,170,255,0.5)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.1em" }}>WIN</div>
                <div style={{ color: game.borderColor, fontSize: "13px", fontWeight: 900 }}>{game.payout}</div>
              </div>
            </div>
          )}

          {/* ── START button ── */}
          <div style={{ padding: "10px 10px 12px", flexShrink: 0 }}>
            {game.active ? (
              <div
                role="button"
                tabIndex={0}
                onClick={onStart}
                style={{ cursor: "pointer", userSelect: "none" }}
                onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.94) translateY(4px)"; }}
                onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"; }}
              >
                {/* Wall gives 3D depth */}
                <div style={{
                  borderRadius: "14px",
                  background: game.startWall,
                  paddingBottom: "5px",
                  boxShadow: `0 10px 24px -4px ${game.startGlow}, 0 0 0 1px rgba(255,255,255,0.06)`,
                }}>
                  {/* Face */}
                  <div style={{
                    borderRadius: "12px 12px 10px 10px",
                    background: game.startGrad,
                    padding: "11px 10px",
                    textAlign: "center",
                    position: "relative", overflow: "hidden",
                    border: "2px solid rgba(255,255,255,0.5)",
                    boxShadow: "inset 0 6px 14px rgba(255,255,255,0.7), inset 0 -3px 8px rgba(0,0,0,0.3)",
                  }}>
                    {/* Gloss crescent */}
                    <div style={{
                      position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
                      background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)",
                      borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
                    }} />
                    {/* Specular dot */}
                    <div style={{
                      position: "absolute", top: "3px", left: "16%", width: "18px", height: "6px",
                      borderRadius: "50%", background: "rgba(255,255,255,0.85)", pointerEvents: "none",
                    }} />
                    <span style={{
                      color: "white", fontSize: "15px", fontWeight: 900, letterSpacing: "0.16em",
                      textShadow: "0px 2px 5px rgba(0,0,0,0.45)",
                      position: "relative", zIndex: 1,
                    }}>START</span>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                borderRadius: "14px", padding: "11px",
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                textAlign: "center", color: "rgba(180,150,255,0.3)",
                fontSize: "13px", fontWeight: 700, letterSpacing: "0.14em",
              }}>LOCKED</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
