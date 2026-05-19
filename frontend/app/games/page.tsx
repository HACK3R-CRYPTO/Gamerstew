"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import BottomNav from "@/components/BottomNav";
import LevelUpToast from "@/components/LevelUpToast";
import ChallengeBanner, { useChallenge } from "@/components/ChallengeBanner";

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
    showWager: false,
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
    id: "challenge-ai",
    title: "CHALLENGE AI",
    wager: "—",
    payout: "—",
    path: "/games/challenge-ai",
    active: true,
    artGrad: "linear-gradient(160deg, #4a006b 0%, #6b21a8 55%, #312e81 100%)",
    glow: "#a78bfa",
    accent: "#d8b4fe",
    showWager: false,
    borderColor: "#a78bfa",
    startWall: "#4a006b",
    startGrad: "linear-gradient(160deg, #d8b4fe 0%, #9333ea 50%, #6b21a8 100%)",
    startGlow: "rgba(167,139,250,0.75)",
    art: (
      // 3 AI personality emojis stacked — gives a "roster" feel without
      // a new asset. Players see the visual cue that this is a multi-opponent
      // hub, not a single game.
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 4, height: "100%",
        filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.7))",
      }}>
        <div style={{ fontSize: 48 }}>🔮</div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ fontSize: 24 }}>🪞</div>
          <div style={{ fontSize: 24 }}>🎲</div>
        </div>
      </div>
    ),
  },
  // Coming-soon teaser — deliberately muted vs active games. The chassis
  // stays consistent (border / shadow / dimensions) but the wager fields are
  // empty and the START button is replaced with a NOTIFY pill that hooks
  // into the existing push opt-in flow. Slot is permanent — when a real game
  // ships, this card stays at the bottom signaling further roster growth.
  {
    id: "coming-soon",
    title: "MORE COMING",
    wager: "—",
    payout: "—",
    path: "",
    active: false,
    artGrad: "linear-gradient(160deg, #3a2a5e 0%, #2a1d4a 55%, #1a1235 100%)",
    glow: "#7c6db8",
    accent: "#a89dd1",
    showWager: false,
    borderColor: "#6d5db0",
    startWall: "#2a1d4a",
    startGrad: "linear-gradient(160deg, #b9a7e8 0%, #7c6db8 50%, #4b3a85 100%)",
    startGlow: "rgba(124,109,184,0.55)",
    art: (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/games/coming-soon.png" alt="More games coming soon"
        style={{
          width: "100%", height: "100%", objectFit: "contain",
          filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.6))",
        }} />
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

// DiceBear avatar — unique face per wallet, same as profile + leaderboard
function avatarUrl(address: string, username?: string | null) {
  const seed = `${username || ""}-${address}`;
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&backgroundColor=ffdfbf,ffd5dc,c0aede,b6e3f4,d1d4f9`;
}

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

  // Slider scroll state — tracks whether the slider can scroll further
  // left / right so the chevron buttons fade in and out cleanly. Without
  // this, you'd see two dead buttons always rendered.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 6);
    // 6px slack so a tiny rounding error doesn't keep the chevron alive
    // when the player is already at the right edge.
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 6);
  }, []);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState]);
  // Scroll by one card-width per chevron click. Matches scroll-snap so
  // the slider lands cleanly on a card every time.
  const scrollByCard = useCallback((dir: "left" | "right") => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = 246; // 232px card + 14px gap
    el.scrollBy({ left: dir === "left" ? -step : step, behavior: "smooth" });
  }, []);

  // Push notifications — wired to the "MORE COMING" NOTIFY pill so players
  // can opt-in for the next-game-drop ping with a single tap.
  const { state: pushState, subscribe: subscribePush } = usePushNotifications(address);
  const [notifyToast, setNotifyToast] = useState<{ msg: string; ok: boolean } | null>(null);
  async function onComingSoonNotify() {
    if (!address) {
      setNotifyToast({ msg: "Connect your wallet first.", ok: false });
      setTimeout(() => setNotifyToast(null), 2400);
      return;
    }
    if (pushState === "subscribed") {
      setNotifyToast({ msg: "✅ You're already on the list — we'll ping you.", ok: true });
      setTimeout(() => setNotifyToast(null), 2400);
      return;
    }
    if (pushState === "denied" || pushState === "unsupported") {
      setNotifyToast({ msg: "Notifications blocked. Enable in your browser settings.", ok: false });
      setTimeout(() => setNotifyToast(null), 3000);
      return;
    }
    const ok = await subscribePush();
    setNotifyToast({
      msg: ok ? "🔔 You're in — we'll ping you on every new game drop." : "Couldn't subscribe right now. Try again later.",
      ok,
    });
    setTimeout(() => setNotifyToast(null), 2800);
  }

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
  // Level-up celebration. Fires when a mission claim pushes the player
  // across a level threshold. Before this fix, claimMission discarded the
  // backend response so the toast never fired for mission-driven level-ups,
  // making it look like level-ups only happened at level 2 (from games).
  const [levelUpToastLevel, setLevelUpToastLevel] = useState<number | null>(null);
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

  // Global stats for the top pills (PLAYERS / GAMES / POT) and the
  // community UBI impact card below the events strip.
  const [stats, setStats] = useState<{
    totalUsers: number; totalGames: number; estimatedPrizePot: string;
    totalUbiDonatedG: string; totalTreasuryG: string; totalHabitatUnlocks: number;
  }>({
    totalUsers: 0, totalGames: 0, estimatedPrizePot: "0",
    totalUbiDonatedG: "0", totalTreasuryG: "0", totalHabitatUnlocks: 0,
  });
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/stats`)
      .then(r => r.json())
      .then(d => setStats({
        totalUsers: d.totalUsers || 0,
        totalGames: d.totalGames || 0,
        estimatedPrizePot: d.estimatedPrizePot || "0",
        totalUbiDonatedG: d.totalUbiDonatedG || "0",
        totalTreasuryG: d.totalTreasuryG || "0",
        totalHabitatUnlocks: d.totalHabitatUnlocks || 0,
      }))
      .catch(() => {});
  }, []);


  // Weekly community challenge — includes player's personal contribution
  // when wallet is connected so the "Your share: X/70" bar can render.
  const [weeklyChallenge, setWeeklyChallenge] = useState<{
    target: number; progress: number; playersIn: number;
    hit: boolean; daysLeft: number; rewardG: number; ubiG: number;
    capPerPlayer: number; myContribution: number | null;
    contributors: { wallet: string; username: string | null; games: number }[]; windowEnd: string;
  } | null>(null);
  useEffect(() => {
    const url = address
      ? `${BACKEND_URL}/api/weekly-challenge?wallet=${address}`
      : `${BACKEND_URL}/api/weekly-challenge`;
    fetch(url)
      .then(r => r.json())
      .then(d => setWeeklyChallenge(d))
      .catch(() => {});
  }, [address]);

  // EVENTS data — real season countdown + 3-week competition state
  type EventCard = {
    icon: string; color: string; title: string; subtitle: string;
    onClick?: () => void;
    // Optional progress bar — used by the community challenge card so it
    // shows alongside season/cup events with a live progress indicator.
    progress?: { value: number; total: number; myShare?: number; myCap?: number };
  };
  const [seasonInfo, setSeasonInfo] = useState<{ season: number; endsAt: number } | null>(null);
  const [compInfo, setCompInfo] = useState<{ weeksLeft: number; total: number } | null>(null);

  // Community UBI total — read directly from the Goldsky subgraph so the
  // event card surfaces an honest "we routed X G$ to UBI" message even
  // when the backend is offline.
  const [ubiTotal, setUbiTotal] = useState<{ amount: string; unlocks: number } | null>(null);
  useEffect(() => {
    const SUBGRAPH = process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
      "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.0/gn";
    fetch(SUBGRAPH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{ globalStat(id: "global") { totalUbiDonatedG totalHabitatUnlocks } }` }),
    })
      .then(r => r.json())
      .then(j => {
        const g = j?.data?.globalStat;
        if (!g) return;
        const whole = BigInt(g.totalUbiDonatedG || "0") / 10n ** 18n;
        setUbiTotal({ amount: Number(whole).toLocaleString(), unlocks: Number(g.totalHabitatUnlocks || 0) });
      })
      .catch(() => {});
  }, []);

  // 72-hour Arena Challenge — shared hook polls /api/challenge every 30s
  // and returns null when the event is not active, so the banner below
  // only renders during the window.
  const challenge = useChallenge(address);

  // Season 1 — Team Wars + Solo Ladder. Same poll cadence as the other
  // events panel data sources; null while there is no active season so
  // the cards just don't render. Includes the player's join state so the
  // event card can swap between a "join now" CTA and the standings view.
  const [season1, setSeason1] = useState<{
    startsAt: string;
    endsAt: string;
    targetPerTeam: number;
    topTeam: { team: string; counted: number } | null;
    topSolo: { wallet: string; points: number } | null;
    myTeam: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchSeason = async () => {
      try {
        // Public leaderboard for meta + standings. /me only if connected;
        // anon visitors should still see the join CTA on the card.
        const [lbRes, meRes] = await Promise.all([
          fetch("/api/season/leaderboard", { cache: "no-store" }),
          address
            ? fetch(`/api/season/me/${address.toLowerCase()}`, { cache: "no-store" })
            : Promise.resolve(null as Response | null),
        ]);
        if (cancelled) return;
        if (!lbRes.ok) return;
        const j = await lbRes.json();
        if (cancelled) return;
        if (!j?.meta?.endsAt) { setSeason1(null); return; }
        const teams = (j.teams ?? []) as { team: string; counted: number }[];
        const top = teams.length > 0 ? teams[0] : null;
        const solo = (j.soloTop10 ?? [])[0] ?? null;
        let myTeam: string | null = null;
        if (meRes && meRes.ok) {
          const me = await meRes.json();
          myTeam = me?.team ?? null;
        }
        setSeason1({
          startsAt: j.meta.startsAt,
          endsAt: j.meta.endsAt,
          targetPerTeam: j.meta.targetPerTeam ?? 500,
          topTeam: top ? { team: top.team, counted: top.counted } : null,
          topSolo: solo ? { wallet: solo.wallet, points: solo.points } : null,
          myTeam,
        });
      } catch {}
    };
    void fetchSeason();
    const i = setInterval(fetchSeason, 30000);
    return () => { cancelled = true; clearInterval(i); };
  }, [address]);

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
        subtitle: comp.weeksLeft === 1
          ? `${compLeader.total} pts · Final week`
          : `${compLeader.total} pts · ${comp.weeksLeft} weeks left`,
      });
      setNews(items.slice(0, 4));
    });
  }, []);
  async function claimMission(id: number) {
    if (!address) return;
    try {
      const r = await fetch(`${BACKEND_URL}/api/missions/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, missionId: id }),
      });
      // Backend returns { leveledUp, level, xpAwarded, xp } — fire the
      // full-screen level-up toast when the claim tips the player into a
      // new level. This is the only spot outside rhythm/simon that awards
      // XP, so without this wire-up mission level-ups happened silently.
      const d = await r.json().catch(() => null);
      if (d?.leveledUp && typeof d.level === "number") {
        setLevelUpToastLevel(d.level);
      }
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

        {/* (Challenge banner moved to page top as a hero strip so it reads
            as a "this-is-happening-right-now" signal on both mobile and
            desktop, instead of competing with Season/Cup rows here.) */}

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
          // Season 1 — Team Wars + Solo Ladder. Card shape adapts to:
          //   1. pre-launch (now < startsAt): "starts <weekday>" with the
          //      join CTA front-and-centre so people lock in a team early
          //   2. live + not joined: same join CTA + countdown
          //   3. live + joined: standings (leader, your team progress)
          // Solo Ladder always renders alongside since it's independent
          // of team membership — every game already counts toward it.
          if (season1) {
            const startSec = Math.floor(new Date(season1.startsAt).getTime() / 1000);
            const endSec = Math.floor(new Date(season1.endsAt).getTime() / 1000);
            const left = endSec - now;
            const preLaunch = now < startSec;
            const notJoined = !season1.myTeam;
            if (left > 0) {
              if (preLaunch) {
                const startWd = new Date(season1.startsAt).toLocaleDateString("en-US", { weekday: "long" });
                events.push({
                  icon: "⚔️", color: "#f97316",
                  title: notJoined ? "Season 1 · Pick a Team" : `Team Wars · You're in Team ${season1.myTeam!.toUpperCase()}`,
                  subtitle: notJoined
                    ? `Starts ${startWd} · 4,200 G$ pool · Tap to join →`
                    : `Starts ${startWd} · 4,200 G$ pool`,
                  onClick: () => router.push("/leaderboard?tab=seasons#team-wars-card"),
                });
              } else if (notJoined) {
                events.push({
                  icon: "⚔️", color: "#f97316",
                  title: "Team Wars · Pick a Team",
                  subtitle: `${fmtShortCountdown(left)} left · 4,200 G$ pool · Tap to join →`,
                  onClick: () => router.push("/leaderboard?tab=seasons#team-wars-card"),
                });
              } else {
                events.push({
                  icon: "🏟️", color: "#f97316",
                  title: `Team Wars — ${fmtShortCountdown(left)} left`,
                  subtitle: season1.topTeam
                    ? `Leader: Team ${season1.topTeam.team.toUpperCase()} · ${season1.topTeam.counted}/${season1.targetPerTeam} games`
                    : "Race starts now · 4,200 G$ pool",
                  onClick: () => router.push("/leaderboard?tab=seasons#team-wars-card"),
                  ...(season1.topTeam ? {
                    progress: {
                      value: season1.topTeam.counted,
                      total: season1.targetPerTeam,
                    },
                  } : {}),
                });
              }
              events.push({
                icon: "📊", color: "#fbbf24",
                title: preLaunch
                  ? `Solo Ladder · Starts ${new Date(season1.startsAt).toLocaleDateString("en-US", { weekday: "short" })}`
                  : `Solo Ladder — ${fmtShortCountdown(left)} left`,
                subtitle: season1.topSolo
                  ? `${season1.topSolo.wallet.slice(0, 4)}…${season1.topSolo.wallet.slice(-3)} · ${season1.topSolo.points.toLocaleString()} pts · View →`
                  : "Every action counts · 1,200 G$ pool",
                onClick: () => router.push("/leaderboard?tab=seasons"),
              });
            }
          }
          if (compInfo) {
            // weeksLeft counts the current week as remaining, so "1" means
            // we ARE in the final week, not "one more week to go." Display
            // the honest message in either case.
            const isFinal = compInfo.weeksLeft === 1;
            events.push({
              icon: "🏆", color: "#fbbf24",
              title: isFinal
                ? `3-Week Cup — Final week, ends soon`
                : `3-Week Cup — ${compInfo.weeksLeft} weeks left`,
              subtitle: `$${compInfo.total} pool · Cumulative · View →`,
              // Deep-link to the Seasons tab where the Cup prizes, your
              // standing, and the full cumulative ranking list live.
              // Previously this landed on the Rankings tab (weekly
              // leaderboard) which is a different competition entirely.
              onClick: () => router.push("/leaderboard?tab=seasons"),
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
          if (ubiTotal && Number(ubiTotal.amount.replace(/,/g, "")) > 0) {
            events.push({
              icon: "🌍", color: "#86efac",
              title: `${ubiTotal.amount} G$ funded for UBI`,
              subtitle: `${ubiTotal.unlocks} habitat${ubiTotal.unlocks === 1 ? "" : "s"} unlocked · Verified on Celo`,
              onClick: () => router.push("/profile?tab=habitats"),
            });
          }
          // Community challenge — shows as an event card exactly like
          // the season countdown and cup events, with a live progress bar.
          if (weeklyChallenge) {
            const endDay = weeklyChallenge.windowEnd
              ? new Date(weeklyChallenge.windowEnd).toLocaleDateString("en-US", { weekday: "short" })
              : "Sun";
            events.push({
              icon: "🌍", color: "#22c55e",
              title: weeklyChallenge.hit
                ? `Community · Milestone hit! 🎉`
                : `Community · ${weeklyChallenge.progress}/${weeklyChallenge.target} games`,
              subtitle: weeklyChallenge.hit
                ? `${weeklyChallenge.rewardG} G$ split · Payouts coming`
                : `${weeklyChallenge.rewardG} G$ split · Ends ${endDay}`,
              progress: weeklyChallenge.hit ? undefined : {
                value: weeklyChallenge.progress,
                total: weeklyChallenge.target,
                myShare: weeklyChallenge.myContribution ?? 0,
                myCap: weeklyChallenge.capPerPlayer,
              },
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
                  {/* Progress bar — community challenge only */}
                  {e.progress && (
                    <div style={{ marginTop: "5px", display: "flex", flexDirection: "column", gap: "3px" }}>
                      <div style={{ height: "4px", borderRadius: "999px", background: "rgba(0,0,0,0.5)", overflow: "hidden" }}>
                        <div style={{
                          width: `${Math.min(100, Math.round((e.progress.value / e.progress.total) * 100))}%`,
                          height: "100%", borderRadius: "999px",
                          background: `linear-gradient(90deg, ${e.color}99 0%, ${e.color} 100%)`,
                          transition: "width 0.5s",
                        }} />
                      </div>
                      {e.progress.myShare != null && e.progress.myCap && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: `${e.color}88`, fontSize: "7.5px", fontWeight: 700 }}>
                            Your share: {e.progress.myShare}/{e.progress.myCap}
                          </span>
                          <span style={{ color: `${e.color}88`, fontSize: "7.5px", fontWeight: 700 }}>
                            {e.progress.value}/{e.progress.total} total
                          </span>
                        </div>
                      )}
                    </div>
                  )}
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

          {/* 72-hour Arena Cup — hero strip at the top of the page so every
              visitor sees it first on both mobile and desktop. Previously
              buried inside the events list where mobile users had to scroll
              past the game cards to reach it. Full-width but clamped so it
              reads as a focused hero, not a wall. */}
          {challenge && (
            <div style={{ width: "100%", maxWidth: "680px", flexShrink: 0 }}>
              <ChallengeBanner challenge={challenge} compact={isMobile} />
            </div>
          )}


          {/* Season 1 hero strip — replaces the Community Challenge
              banner that used to live here. Lives above the stats pills
              so it's the first thing players notice; tap to drop into the
              Seasons tab where joining + standings happen. Status pill
              swaps between JOIN → (CTA) and JOINED ✓ (acknowledgement)
              so anyone glancing knows where they stand. Community
              Challenge still surfaces in the events sidebar — this slot
              is reserved for the headline event. */}
          {season1 && (() => {
            const startSec = Math.floor(new Date(season1.startsAt).getTime() / 1000);
            const endSec = Math.floor(new Date(season1.endsAt).getTime() / 1000);
            if (endSec - now <= 0) return null;
            const preLaunch = now < startSec;
            const notJoined = !season1.myTeam;
            const startWd = new Date(season1.startsAt).toLocaleDateString("en-US", { weekday: "short" });
            const subtitle = preLaunch
              ? (notJoined ? `Starts ${startWd} · Pick a team` : `Starts ${startWd} · Team ${season1.myTeam!.toUpperCase()}`)
              : (notJoined ? `Pick your team · ${fmtShortCountdown(endSec - now)} left` : `Team ${season1.myTeam!.toUpperCase()} · ${fmtShortCountdown(endSec - now)} left`);
            return (
              <div
                role="button"
                tabIndex={0}
                onClick={() => router.push("/leaderboard?tab=seasons#team-wars-card")}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push("/leaderboard?tab=seasons#team-wars-card"); }}
                style={{
                  width: "100%", maxWidth: "680px", flexShrink: 0,
                  borderRadius: "12px", padding: "9px 14px",
                  background: "linear-gradient(90deg, rgba(124,45,18,0.45) 0%, rgba(40,10,5,0.6) 100%)",
                  border: "1px solid rgba(251,191,36,0.4)",
                  boxShadow: "0 0 14px rgba(249,115,22,0.18)",
                  display: "flex", alignItems: "center", gap: "10px",
                  flexWrap: "wrap",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: "14px", flexShrink: 0 }}>⚔️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: "#fbbf24", fontSize: "10px", fontWeight: 900, letterSpacing: "0.06em" }}>SEASON 1 · TEAM WARS</span>
                  <span style={{ color: "rgba(254,215,170,0.65)", fontSize: "9px", fontWeight: 700 }}> · {subtitle}</span>
                </div>
                <div style={{
                  padding: "3px 10px", borderRadius: "999px", flexShrink: 0,
                  background: notJoined ? "rgba(251,191,36,0.16)" : "rgba(134,239,172,0.16)",
                  border: notJoined ? "1px solid rgba(251,191,36,0.55)" : "1px solid rgba(134,239,172,0.45)",
                }}>
                  <span style={{
                    color: notJoined ? "#fbbf24" : "#86efac",
                    fontSize: "9px", fontWeight: 900, letterSpacing: "0.08em",
                  }}>
                    {notJoined ? "JOIN →" : "JOINED ✓"}
                  </span>
                </div>
              </div>
            );
          })()}

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

          {/* Game cards — no tray. Cards live directly on the page
              atmosphere (Apple Arcade / PSN / Stake pattern). The bg
              icons that used to leak through gaps are dimmed by a soft
              radial vignette behind the slider — same protection, no
              visible frame. Chevrons appear over the cards on demand
              and fade based on scroll position. */}
          <div style={{
            position: "relative",
            width: "100%",
            maxWidth: isMobile ? "680px" : "920px",
          }}>
            {/* Soft atmospheric dim — kills the decorative-icon noise
                under the slider area without putting the slider in a
                visible box. Sits behind the cards, blurred + low
                opacity so it reads as ambient, not as a container. */}
            {!isMobile && (
              <div aria-hidden style={{
                position: "absolute",
                inset: "-30px -50px -20px -50px",
                background: "radial-gradient(ellipse at center, rgba(8,2,32,0.62) 0%, rgba(8,2,32,0.42) 45%, rgba(8,2,32,0.12) 78%, transparent 100%)",
                pointerEvents: "none",
                filter: "blur(18px)",
                zIndex: 0,
              }} />
            )}

            <div
              ref={scrollerRef}
              className="hide-scrollbar"
              style={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                gap: isMobile ? "12px" : "14px",
                width: "100%",
                height: isMobile ? "auto" : "clamp(328px, 56vh, 488px)",
                overflowX: isMobile ? "visible" : "auto",
                overflowY: isMobile ? "visible" : "hidden",
                scrollSnapType: isMobile ? "none" : "x mandatory",
                // scroll-padding-left matches paddingLeft so snap lands
                // the first card at the visual gutter, not flush against
                // the clip edge (which was the source of the left clip).
                scrollPaddingLeft: isMobile ? 0 : "20px",
                scrollPaddingRight: isMobile ? 0 : "60px",
                // Horizontal breathing room. The first card needs room
                // to scale-grow leftward on hover (~8px each side) —
                // without paddingLeft the leftmost card's hover gets
                // clipped by overflow:hidden the same way the top was.
                paddingLeft: isMobile ? 0 : "20px",
                paddingRight: isMobile ? 0 : "60px",
                // Vertical breathing room. Hover does translateY(-8) +
                // scale(1.04), which extends the card up to ~16px above
                // its rest position. Symmetric buffers across both axes.
                paddingTop: isMobile ? 0 : "24px",
                paddingBottom: isMobile ? 0 : "24px",
                scrollBehavior: "smooth",
              }}
            >
              {GAMES.map(g => (
                <GameCard
                  key={g.id}
                  game={g}
                  isMobile={isMobile}
                  onStart={() => g.path && router.push(g.path)}
                  onNotify={onComingSoonNotify}
                  pushState={pushState}
                />
              ))}
            </div>

            {/* Right-edge peek — softer, no border-radius (no tray to
                follow). Fades a moving piece of the next card into the
                page atmosphere. */}
            {!isMobile && (
              <div aria-hidden style={{
                position: "absolute",
                top: 0, right: 0, bottom: 4,
                width: 80,
                pointerEvents: "none",
                background: "linear-gradient(90deg, transparent 0%, rgba(8,2,32,0.55) 45%, rgba(8,2,32,0.92) 100%)",
                opacity: canScrollRight ? 1 : 0,
                transition: "opacity 0.25s",
                zIndex: 2,
              }} />
            )}
            {!isMobile && (
              <div aria-hidden style={{
                position: "absolute",
                top: 0, left: 0, bottom: 4,
                width: 60,
                pointerEvents: "none",
                background: "linear-gradient(270deg, transparent 0%, rgba(8,2,32,0.55) 45%, rgba(8,2,32,0.92) 100%)",
                opacity: canScrollLeft ? 1 : 0,
                transition: "opacity 0.25s",
                zIndex: 2,
              }} />
            )}

            {/* ◀ ▶ chevron buttons — desktop only. The explicit "I am a
                slider" affordance. Fades in only when scroll is possible
                in that direction; smooth scroll-by-one-card per click. */}
            {!isMobile && (
              <>
                <button
                  type="button"
                  aria-label="Previous games"
                  onClick={() => scrollByCard("left")}
                  style={{
                    position: "absolute",
                    top: "50%", left: "10px",
                    transform: "translateY(-50%)",
                    width: 42, height: 42,
                    borderRadius: 999,
                    cursor: "pointer",
                    padding: 0,
                    background: "rgba(8,2,32,0.88)",
                    border: "1px solid rgba(255,255,255,0.22)",
                    color: "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 8px 22px -6px rgba(0,0,0,0.55)",
                    backdropFilter: "blur(6px)",
                    opacity: canScrollLeft ? 1 : 0,
                    pointerEvents: canScrollLeft ? "auto" : "none",
                    transition: "opacity 0.25s, transform 0.15s, background 0.15s",
                    zIndex: 3,
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.transform = "translateY(-50%) scale(1.08)";
                    el.style.background = "rgba(20,8,52,0.95)";
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.transform = "translateY(-50%) scale(1)";
                    el.style.background = "rgba(8,2,32,0.88)";
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="15 6 9 12 15 18" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="More games"
                  onClick={() => scrollByCard("right")}
                  style={{
                    position: "absolute",
                    top: "50%", right: "10px",
                    transform: "translateY(-50%)",
                    width: 42, height: 42,
                    borderRadius: 999,
                    cursor: "pointer",
                    padding: 0,
                    background: "rgba(8,2,32,0.88)",
                    border: "1px solid rgba(255,255,255,0.22)",
                    color: "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 8px 22px -6px rgba(0,0,0,0.55)",
                    backdropFilter: "blur(6px)",
                    opacity: canScrollRight ? 1 : 0,
                    pointerEvents: canScrollRight ? "auto" : "none",
                    transition: "opacity 0.25s, transform 0.15s, background 0.15s",
                    zIndex: 3,
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.transform = "translateY(-50%) scale(1.08)";
                    el.style.background = "rgba(20,8,52,0.95)";
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.transform = "translateY(-50%) scale(1)";
                    el.style.background = "rgba(8,2,32,0.88)";
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Notify toast — fixed-position pill so it doesn't shift layout */}
          {notifyToast && (
            <div style={{
              position: "fixed",
              bottom: isMobile ? "calc(78px + env(safe-area-inset-bottom))" : "32px",
              left: "50%", transform: "translateX(-50%)",
              zIndex: 80,
              padding: "12px 18px", borderRadius: 14,
              background: notifyToast.ok ? "rgba(134,239,172,0.16)" : "rgba(251,191,36,0.16)",
              border: `1px solid ${notifyToast.ok ? "rgba(134,239,172,0.55)" : "rgba(251,191,36,0.55)"}`,
              boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
              backdropFilter: "blur(12px)",
              color: notifyToast.ok ? "#86efac" : "#fde68a",
              fontSize: 12.5, fontWeight: 800, letterSpacing: "0.04em",
              maxWidth: "min(90vw, 360px)", textAlign: "center", lineHeight: 1.35,
            }}>{notifyToast.msg}</div>
          )}

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

      {/* Level-up celebration — fires for mission-claim level-ups here,
          since rhythm/simon finish screens handle their own in-game case. */}
      <LevelUpToast
        level={levelUpToastLevel}
        onClose={() => setLevelUpToastLevel(null)}
      />
    </div>
  );
}


// ─── GameCard ─────────────────────────────────────────────────────────────────
function GameCard({
  game,
  isMobile,
  onStart,
  onNotify,
  pushState,
}: {
  game: typeof GAMES[number];
  isMobile: boolean;
  onStart: () => void;
  onNotify?: () => void;
  pushState?: "unsupported" | "default" | "granted" | "denied" | "subscribing" | "subscribed";
}) {
  const isComingSoon = game.id === "coming-soon";
  const notifySubscribed = pushState === "subscribed";
  // ─── Mobile: coming-soon variant ─────────────────────────────────────────
  // Shorter, muted card. Same chassis (border, shadow, dimensions language)
  // but ~70% the height of active cards and the START button is replaced
  // with a 🔔 NOTIFY pill that wires into push subscriptions.
  if (isMobile && isComingSoon) {
    const notifyLabel = pushState === "subscribing"
      ? "SUBSCRIBING…"
      : notifySubscribed
        ? "🔔 SUBSCRIBED"
        : "🔔 NOTIFY ME";
    return (
      <div style={{
        borderRadius: "18px",
        padding: "2px",
        background: `linear-gradient(135deg, ${game.borderColor}aa 0%, ${game.borderColor}44 100%)`,
        boxShadow: `0 6px 18px -6px ${game.glow}55, 0 0 0 1px ${game.borderColor}22`,
      }}>
        <div style={{
          borderRadius: "16px",
          background: "linear-gradient(135deg, #1b1240 0%, #0b0626 80%)",
          display: "flex", alignItems: "stretch", overflow: "hidden",
          minHeight: "76px",
        }}>
          <div style={{
            width: "76px", flexShrink: 0,
            background: game.artGrad,
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ width: "84%", height: "84%", opacity: 0.85, filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.5))" }}>
              {game.art}
            </div>
          </div>
          <div style={{
            flex: 1, minWidth: 0,
            padding: "10px 12px",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
          }}>
            <div>
              <div style={{
                color: "rgba(232,225,255,0.95)",
                fontSize: "13px", fontWeight: 900, letterSpacing: "0.06em", lineHeight: 1.15,
                textShadow: `0 0 10px ${game.borderColor}66`,
              }}>{game.title}</div>
              <div style={{
                color: "rgba(200,180,255,0.55)", fontSize: "10px", fontWeight: 700,
                letterSpacing: "0.04em", marginTop: 3,
              }}>Tap to get pinged when they drop</div>
            </div>
            <div
              role="button" tabIndex={0}
              onClick={e => { e.stopPropagation(); onNotify?.(); }}
              style={{
                alignSelf: "flex-end",
                padding: "6px 11px", borderRadius: 999,
                background: notifySubscribed
                  ? "rgba(134,239,172,0.16)"
                  : "rgba(255,255,255,0.07)",
                border: notifySubscribed
                  ? "1px solid rgba(134,239,172,0.5)"
                  : `1px solid ${game.borderColor}aa`,
                color: notifySubscribed ? "#86efac" : "rgba(232,225,255,0.92)",
                fontSize: "10.5px", fontWeight: 900, letterSpacing: "0.12em",
                cursor: "pointer", userSelect: "none",
              }}
            >{notifyLabel}</div>
          </div>
        </div>
      </div>
    );
  }

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
              {/* Wager pill — only shown for games that actually wager. Rhythm
                  Rush and Simon are skill-based earners (no wager), so they
                  read as cleaner without a misleading BET pill. */}
              {game.active && game.showWager && (
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

  // Desktop: tall cards inside a horizontal scroller (set by the parent).
  // Fixed min-width + scroll-snap means the layout grows cleanly as more
  // games are added — no grid refactor needed.
  return (
    <div
      style={{
        height: "100%",
        flex: "0 0 auto",
        minWidth: "232px",
        maxWidth: "232px",
        scrollSnapAlign: "start",
        transition: "transform 0.18s cubic-bezier(0.34,1.56,0.64,1)",
        cursor: game.active ? "pointer" : "default",
      }}
      // Hover lifts + scales the card with a brightness boost. The
      // scroller has top/bottom padding so the grown box has room to
      // breathe inside the overflowY:hidden clip area.
      onMouseEnter={e => {
        if (!game.active) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "translateY(-8px) scale(1.04)";
        el.style.filter = "brightness(1.08) saturate(1.05)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "translateY(0) scale(1)";
        el.style.filter = "none";
      }}
    >
      {/* Tinted border — keeps the per-game identity color (orange for
          Rhythm Rush, green for Simon, etc) but drops the heavy neon halo
          shadows that competed with the new contained tray surface. */}
      <div style={{
        height: "100%",
        borderRadius: "22px",
        padding: "2px",
        background: `linear-gradient(180deg, ${game.borderColor}cc 0%, ${game.borderColor}55 100%)`,
        boxShadow: "0 14px 32px -12px rgba(0,0,0,0.55)",
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
            ) : isComingSoon ? (
              // Coming-soon card swaps START for a 🔔 NOTIFY pill wired to
              // the push opt-in flow. Visually still "card-shaped" so it
              // doesn't break the row rhythm, but tinted muted-green when
              // already subscribed so the player gets clear feedback.
              <div
                role="button" tabIndex={0}
                onClick={onNotify}
                style={{
                  cursor: "pointer", userSelect: "none",
                  borderRadius: "14px", padding: "11px",
                  textAlign: "center",
                  background: notifySubscribed
                    ? "rgba(134,239,172,0.14)"
                    : "rgba(124,109,184,0.18)",
                  border: notifySubscribed
                    ? "1px solid rgba(134,239,172,0.5)"
                    : `1px solid ${game.borderColor}aa`,
                  color: notifySubscribed ? "#86efac" : "rgba(232,225,255,0.9)",
                  fontSize: "12.5px", fontWeight: 900, letterSpacing: "0.14em",
                  transition: "background 0.18s, color 0.18s",
                }}
                onMouseEnter={e => { if (!notifySubscribed) (e.currentTarget as HTMLDivElement).style.background = "rgba(124,109,184,0.28)"; }}
                onMouseLeave={e => { if (!notifySubscribed) (e.currentTarget as HTMLDivElement).style.background = "rgba(124,109,184,0.18)"; }}
              >
                {pushState === "subscribing"
                  ? "SUBSCRIBING…"
                  : notifySubscribed
                    ? "🔔 SUBSCRIBED"
                    : "🔔 NOTIFY ME"}
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
