"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import { fetchPlayerAllTimeCombinedStats } from "@/lib/subgraph";
import { HABITATS as HABITAT_TIERS, type HabitatTier } from "@/lib/habitats";
import { useHabitats } from "@/hooks/useHabitats";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { HabitatBackground } from "@/components/HabitatBackground";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// ─── tokens (in sync with /home + /dashboard + /games) ───────────────────
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  gap: 12,
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// ─── primitives ─────────────────────────────────────────────────────────
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

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "2px 2px 8px" }}>
      <span style={{ fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>{children}</span>
      {action}
    </div>
  );
}

const ICON_PATHS: Record<string, string> = {
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m9 4c0-.4 0-.8-.1-1.1l2.1-1.6-2-3.5L18.5 7c-.5-.4-1.1-.7-1.7-1l-.4-2.5h-4l-.4 2.5c-.6.3-1.2.6-1.7 1l-2.5-1.2-2 3.5L8 10.9V13l-2 1.6 2 3.5 2.5-1.2c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.5 1.2 2-3.5L20 13.1c0-.4 0-.7 0-1.1",
  lock: "M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5m-3 8V7a3 3 0 1 1 6 0v3z",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6z",
};
function Icon({ name, size = 16, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d={ICON_PATHS[name] || ""} /></svg>;
}

// ─── pet evolution stages ───────────────────────────────────────────────
// Maps player's level to which slime art to show. Thresholds mirror the
// main branch's PET_STAGES exactly (5 / 15 / 30 / 50) so the pet a
// player sees on the new UI matches what they see on gamearenahq.xyz.
// Tier labels (GOLD / PLATINUM / DIAMOND / MASTER) are layered on top
// of those thresholds — they don't change the slime image, just the
// pill colour next to the name.
type PetStage = { src: string; label: string; nextAt: number; tierLabel: string; tierColor: string };
function petStageFor(level: number): PetStage {
  if (level >= 50) return { src: "/pets/stage-5-king.png",    label: "KING SLIME",    nextAt: 999, tierLabel: "MASTER",   tierColor: "#fbbf24" };
  if (level >= 30) return { src: "/pets/stage-4-crystal.png", label: "CRYSTAL SLIME", nextAt: 50,  tierLabel: "DIAMOND",  tierColor: "#06b6d4" };
  if (level >= 15) return { src: "/pets/stage-3-teen.png",    label: "TEEN SLIME",    nextAt: 30,  tierLabel: "PLATINUM", tierColor: "#a78bfa" };
  if (level >= 5)  return { src: "/pets/stage-2-baby.png",    label: "BABY SLIME",    nextAt: 15,  tierLabel: "GOLD",     tierColor: "#22c55e" };
  return                  { src: "/pets/stage-1-egg.png",    label: "MYSTERY EGG",   nextAt: 5,   tierLabel: "NEW",      tierColor: "#e2e8f0" };
}

// Level + XP come from games-backend (`/api/user/{address}`) — it owns the
// XP curve and computes the level the rest of the app shares. A previous
// drift derived `level = floor(score/100)+1` here, which spat out
// "LV 311" for normal players because rhythm scores commonly land in the
// 30k+ range. Falling back to the backend's authoritative number.
function fallbackLevel(): { level: number; xp: number; xpNext: number; xpPct: number } {
  return { level: 1, xp: 0, xpNext: 100, xpPct: 0 };
}

// ─── guest gate ─────────────────────────────────────────────────────────
// Profile is the "you have something to lose" moment, so the design hides
// the empty profile shell behind an egg + adopt prompt — the pet is the hook.
function GuestProfileGate({ onConnect, isDesktop }: { onConnect: () => void; isDesktop: boolean }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: isDesktop ? "60px 24px" : "32px 24px", gap: 16, textAlign: "center", position: "relative" }}>
      <div style={{ position: "relative", width: 168, height: 168, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle, ${T.accent}33, transparent 70%)`, filter: "blur(10px)" }} />
        <img src="/pets/stage-1-egg.png" alt="" style={{ width: 150, height: 150, objectFit: "contain", filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.5))", animation: "profile-float-gentle 3s ease-in-out infinite", position: "relative", zIndex: 1 }} />
        <div style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", padding: "4px 12px", borderRadius: 999, background: "rgba(0,0,0,0.6)", border: `1px solid ${T.hairlineHi}`, fontFamily: T.body, fontSize: 10, color: T.inkDim, fontWeight: 800, letterSpacing: "0.12em", whiteSpace: "nowrap" }}>
          NOT ADOPTED YET
        </div>
      </div>
      <div>
        <h2 style={{ fontFamily: T.display, fontSize: 26, color: T.ink, margin: 0, letterSpacing: "-0.005em" }}>Adopt your pet</h2>
        <p style={{ fontFamily: T.body, fontSize: 13, color: T.inkDim, margin: "8px auto 0", maxWidth: 300, lineHeight: 1.5 }}>
          Sign in to name your pet, save your level &amp; streak, and watch it evolve from egg to King Slime as you play.
        </p>
      </div>
      <div style={{ display: "flex", gap: 22, padding: "12px 20px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hairline}` }}>
        {[
          { label: "Evolutions", value: "5" },
          { label: "Habitats", value: "6" },
          { label: "Achievements", value: "14" },
        ].map((s, i, arr) => (
          <div key={s.label} style={{ display: "flex" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontFamily: T.display, fontSize: 20, color: T.ink, lineHeight: 1 }}>{s.value}</span>
              <span style={{ fontFamily: T.body, fontSize: 9, color: T.inkSoft, letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase" }}>{s.label}</span>
            </div>
            {i < arr.length - 1 && <span style={{ width: 1, marginLeft: 22, background: T.hairline }} />}
          </div>
        ))}
      </div>
      <button onClick={onConnect} style={{
        fontFamily: T.display, fontSize: 18, color: "#fff",
        padding: "15px 36px", borderRadius: 15,
        background: `linear-gradient(180deg, ${T.accent}, ${T.accent}cc)`,
        border: `1.5px solid ${T.accent}`,
        boxShadow: `0 12px 26px -6px ${T.accent}aa, inset 0 1px 0 rgba(255,255,255,0.4)`,
        cursor: "pointer", letterSpacing: "0.02em", marginTop: 4,
        display: "inline-flex", alignItems: "center", gap: 9,
      }}>
        <Icon name="bolt" size={16} color="#fff" /> Sign in &amp; adopt
      </button>
      <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft }}>Keep playing free — your pet waits here.</span>
    </div>
  );
}

// ─── achievements catalog (matches design's 14-item set) ─────────────────
type Stats = {
  petName: string;
  level: number;
  xp: number; xpNext: number; xpPct: number;
  streak: number; playedToday: boolean;
  gamesPlayed: number; gamesThisWeek: number;
  bestScore: number; bestRhythm: number; bestSimon: number;
  // Rank across the all-time combined leaderboard (Rhythm + Simon).
  // rank=null while loading or if the player has no recorded score yet.
  rank: number | null; totalPlayers: number;
};

// Local catalog · only used as a fallback if the games-backend
// /api/achievements endpoint is unreachable. Each entry pairs the unlock
// rule with a player-facing description so the cards don't render with
// cryptic short codes like "FC" or "MM 5".
const ACHIEVEMENTS: Array<{ id: string; icon: string; name: string; color: string; unlock: (s: Stats) => boolean }> = [
  { id: "first_win",  icon: "🥇", name: "First Win",         color: "#fbbf24", unlock: s => s.gamesPlayed >= 1 },
  { id: "streak_3",   icon: "🔥", name: "3-Day Streak",      color: "#f97316", unlock: s => s.streak >= 3 },
  { id: "streak_7",   icon: "🔥", name: "Week Warrior",      color: "#f97316", unlock: s => s.streak >= 7 },
  { id: "streak_30",  icon: "🔥", name: "Month Master",      color: "#f97316", unlock: s => s.streak >= 30 },
  { id: "games_5",    icon: "🎮", name: "Getting Started",   color: "#a78bfa", unlock: s => s.gamesPlayed >= 5 },
  { id: "games_25",   icon: "🎮", name: "Regular",           color: "#a78bfa", unlock: s => s.gamesPlayed >= 25 },
  { id: "games_100",  icon: "💎", name: "Veteran",           color: "#22d3ee", unlock: s => s.gamesPlayed >= 100 },
  // Rhythm Rush scoring goes deep — top players post 400k+. The old
  // 300/500/700 unlocked everything on every casual attempt. New scale:
  // Apprentice 60k → Master 200k → Legend 400k. Geometric 2× steps so
  // the gap between tiers feels like a real climb. Daily missions sit
  // BELOW this curve (30k / 80k) so they're achievable each session.
  { id: "rhythm_300", icon: "🥁", name: "Drum Apprentice",   color: "#c026d3", unlock: s => s.bestRhythm >= 60_000 },
  { id: "rhythm_500", icon: "🥁", name: "Rhythm Master",     color: "#c026d3", unlock: s => s.bestRhythm >= 200_000 },
  { id: "rhythm_700", icon: "👑", name: "Rhythm Legend",     color: "#fbbf24", unlock: s => s.bestRhythm >= 400_000 },
  { id: "simon_5",    icon: "🧠", name: "Memory Apprentice", color: "#06b6d4", unlock: s => s.bestSimon >= 5 },
  { id: "simon_10",   icon: "🧠", name: "Memory Master",     color: "#06b6d4", unlock: s => s.bestSimon >= 10 },
  { id: "rhythm_fc",  icon: "✨", name: "Full Combo",        color: "#fbbf24", unlock: () => false },
  { id: "champion",   icon: "🏆", name: "Champion",          color: "#fbbf24", unlock: s => s.rank !== null && s.rank <= 10 },
];

// Player-facing description for each achievement. Lives next to the rules
// (not in the catalog row) because the strings deserve to wrap a bit more
// than a single-line short code.
function descFor(id: string): string {
  switch (id) {
    case "first_win":  return "Play your very first run.";
    case "streak_3":   return "Play 3 days in a row.";
    case "streak_7":   return "Keep your streak alive for a week.";
    case "streak_30":  return "Show up every day for a month.";
    case "games_5":    return "Finish 5 games total.";
    case "games_25":   return "Finish 25 games total.";
    case "games_100":  return "Finish 100 games total.";
    case "rhythm_300": return "Score 60,000+ on Rhythm Rush.";
    case "rhythm_500": return "Score 200,000+ on Rhythm Rush.";
    case "rhythm_700": return "Score 400,000+ on Rhythm Rush.";
    case "simon_5":    return "Reach round 5 on Simon Memory.";
    case "simon_10":   return "Reach round 10 on Simon Memory.";
    case "rhythm_fc":  return "Hit every note in one run — no misses.";
    case "champion":   return "Crack the all-time top 10.";
    default:           return "";
  }
}

// Subgraph fetch for the global player count. Inlined so the profile owns
// its own data without depending on /home's helper.
const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL || "https://api.goldsky.com/api/public/project_cmewi5xpsk7zk01ya4lmw0nhc/subgraphs/gamearena/0.1.0/gn";
async function fetchTotalPlayers(): Promise<number> {
  try {
    const r = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{ globalStat(id: "global") { totalPlayers } }` }),
    });
    if (!r.ok) return 0;
    const j = await r.json();
    return Number(j?.data?.globalStat?.totalPlayers ?? 0);
  } catch { return 0; }
}

// Real habitat catalog now comes from lib/habitats (HABITAT_TIERS — the 10
// canonical tiers with full CSS-art HabitatBackground scenes). The old
// emoji + flat-gradient list shipped in the redesign drift was replaced
// so the profile renders the same legacy scenes the rest of the app uses.

const KEYFRAMES = `
  @keyframes profile-float-gentle {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
`;

// ─── page ───────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const router = useRouter();
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: chainUsername } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "getUsername",
    args: address ? [address] : undefined,
    query: { enabled: !!address && hasMinted === true },
  });
  // GamePass on-chain reads: cumulative games-played counter + per-game
  // best score. weeklyBest takes (season, player, gameType) on-chain and
  // isn't shown today, so it's not in the batch.
  const { data: chainCounters } = useReadContracts({
    contracts: address ? [
      { address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`, abi: GAME_PASS_ABI, functionName: "gamesPlayed", args: [address] as const },
      { address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`, abi: GAME_PASS_ABI, functionName: "bestScore",   args: [address, 0] as const },
      { address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`, abi: GAME_PASS_ABI, functionName: "bestScore",   args: [address, 1] as const },
    ] : [],
    query: { enabled: !!address && hasMinted === true, refetchInterval: 30_000 },
  });
  // MiniPay path · injected wallet identity, no Privy login required.
  const isMiniPay = useIsMiniPay();
  // Verification drives the upsell card below the hero · shown only to
  // connected-but-unverified players. Verified players see the green ✓
  // on their avatar (top-left header) plus the verified pill on their
  // hero · no card here.
  const { isVerified } = useSelfVerification();
  const connected = (authenticated || isMiniPay) && !!address && hasMinted === true;

  // Level / XP / streak / games-this-week all live in games-backend
  // (off-chain). The contract only counts cumulative gamesPlayed.
  const [backendMeta, setBackendMeta] = useState<{
    level: number; xpInLevel: number; xpToNext: number;
    streak: number; playedToday: boolean; gamesThisWeek: number;
  } | null>(null);

  // Championship badges + milestone achievements come from games-backend.
  // Badges are real podium finishes (top 3 of any weekly leaderboard), and
  // achievements are descriptive milestones the player can chase — both
  // owned authoritatively by the backend, not faked client-side.
  type ApiBadge = { season: number; game: string; rank: number; type: "gold" | "silver" | "bronze"; awardedAt: number };
  type ApiAchievement = { id: string; icon: string; name: string; desc: string; unlocked: boolean; unlockedAt: number | null };
  const [badgeData, setBadgeData] = useState<{ badges: ApiBadge[]; summary: { totalGold: number; totalSilver: number; totalBronze: number; streakLabel: string | null } } | null>(null);
  const [backendAchievements, setBackendAchievements] = useState<ApiAchievement[]>([]);
  useEffect(() => {
    if (!connected || !address) { setBadgeData(null); setBackendAchievements([]); return; }
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/badges/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setBadgeData({ badges: d.badges || [], summary: d.summary || { totalGold: 0, totalSilver: 0, totalBronze: 0, streakLabel: null } }); })
      .catch(() => {});
    fetch(`${BACKEND_URL}/api/achievements/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.achievements) setBackendAchievements(d.achievements); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, address]);

  // Legacy useHabitats hook: drives ownership (HabitatRegistry reads),
  // equip persistence (localStorage + /api/habitat backend), and exposes
  // tap-to-equip via equipHabitat(). Pass the live backend level so free
  // tiers unlock as the player climbs without a remount. The full
  // unlock+modal flow lives at /shop — the profile only handles equip.
  const playerLevel = backendMeta?.level ?? 1;
  const { ownedPaidTierIds, equipped: equippedHabitatFromHook, equipHabitat } = useHabitats(playerLevel);
  const ownedPaidIds = ownedPaidTierIds;

  // All-time combined rank + global player count (subgraph). Pairs with
  // the streak/games/best tiles as the "standing" pillar of the snapshot.
  const [standing, setStanding] = useState<{ rank: number | null; totalPlayers: number }>({ rank: null, totalPlayers: 0 });
  useEffect(() => {
    if (!connected || !address) { setStanding({ rank: null, totalPlayers: 0 }); return; }
    let cancelled = false;
    Promise.all([fetchPlayerAllTimeCombinedStats(address), fetchTotalPlayers()])
      .then(([r, tp]) => {
        if (cancelled) return;
        setStanding({ rank: r?.rank ?? null, totalPlayers: tp || 0 });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, address]);
  useEffect(() => {
    if (!connected || !address) { setBackendMeta(null); return; }
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setBackendMeta({
          level: Number(d.level ?? 1),
          xpInLevel: Number(d.xpInLevel ?? 0),
          xpToNext: Number(d.xpToNext ?? 100),
          streak: Number(d.streak ?? 0),
          playedToday: !!d.playedToday,
          gamesThisWeek: Number(d.weeklyGames ?? d.gamesThisWeek ?? 0),
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, address]);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Build the player's stats entirely from chain truth (GamePass NFT) plus
  // games-backend for streak/weekly counters that aren't recorded on-chain.
  // Win-rate stays at 0 — there's no win/loss tally surfaced for skill
  // games today (Challenge AI is the only PvP source and lives elsewhere).
  useEffect(() => {
    if (!connected || !address) { setStats(null); return; }
    const gamesPlayed = chainCounters?.[0]?.status === "success" ? Number(chainCounters[0].result as bigint) : 0;
    const bestRhythm  = chainCounters?.[1]?.status === "success" ? Number(chainCounters[1].result as bigint) : 0;
    const bestSimon   = chainCounters?.[2]?.status === "success" ? Number(chainCounters[2].result as bigint) : 0;
    // Backend-authoritative level + XP. Fall back to LV 1 while the
    // fetch is in flight — no more divide-by-100 garbage.
    const lv = backendMeta
      ? {
          level: backendMeta.level,
          xp: backendMeta.xpInLevel,
          xpNext: backendMeta.xpToNext || 100,
          xpPct: Math.round(((backendMeta.xpInLevel || 0) / (backendMeta.xpToNext || 100)) * 100),
        }
      : fallbackLevel();
    setStats({
      petName: (chainUsername as string | undefined) || "Player",
      level: lv.level, xp: lv.xp, xpNext: lv.xpNext, xpPct: lv.xpPct,
      streak: backendMeta?.streak ?? 0,
      playedToday: backendMeta?.playedToday ?? false,
      gamesPlayed,
      gamesThisWeek: backendMeta?.gamesThisWeek ?? 0,
      bestScore: Math.max(bestRhythm, bestSimon),
      bestRhythm, bestSimon,
      rank: standing.rank, totalPlayers: standing.totalPlayers,
    });
  }, [connected, address, chainUsername, chainCounters, backendMeta, standing]);

  // Always route Connect/Sign-in taps to /home so the Privy modal opens
  // from the home page surface (with onboarding overlay) instead of as
  // an orphan popup from inside a feature screen.
  const onConnect = () => router.push("/home");

  // ── GUEST · adopt-your-pet gate ────────────────────────────────────────
  if (!connected) {
    return (
      <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
        <style>{KEYFRAMES}</style>
        <AppHeader />
        <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "0 auto", padding: isDesktop ? "0 32px 130px" : "0 16px 110px", display: "flex", flexDirection: "column" }}>
          <GuestProfileGate onConnect={onConnect} isDesktop={isDesktop} />
        </div>
        <AppBottomNav wide={isDesktop} />
      </div>
    );
  }

  // ── CONNECTED · full profile ───────────────────────────────────────────
  const s = stats;
  const stage = s ? petStageFor(s.level) : null;
  // unlockedAchievements lived on the old 14-tile grid header — the new
  // Milestone Achievements section computes its own count inline now.
  // Equipped habitat comes from the useHabitats hook — it already handles
  // localStorage / backend sync and the fallback to defaultEquipped(). The
  // local `s` guard here just makes the type narrower for downstream JSX.
  const equippedHabitat: HabitatTier = s ? equippedHabitatFromHook : HABITAT_TIERS[0];
  const unlockedHabitats = HABITAT_TIERS.filter(h =>
    h.type === "free"
      ? (s ? s.level >= (h.unlockLevel ?? 1) : false)
      : ownedPaidIds.includes(h.id)
  ).length;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <style>{KEYFRAMES}</style>
      <AppHeader />

      <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: T.gap + 4 }}>

        {/* Heading row · YOUR PET + Settings */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em" }}>YOUR PET</div>
          <button onClick={() => router.push("/settings")} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px 8px 11px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim, fontFamily: T.body, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em" }}>
            <Icon name="settings" size={15} color="currentColor" /> Settings
          </button>
        </div>

        {/* PET CARD · slime portrait sitting inside its equipped habitat
            (legacy HabitatBackground scene). Stats column overlays the
            scene with a subtle dark veil for readability. */}
        {s && stage && (
          <div style={{
            position: "relative", overflow: "hidden",
            borderRadius: 24,
            border: `1px solid ${T.hairlineHi}`,
            minHeight: isDesktop ? 230 : 320,
            display: "flex",
            flexDirection: isDesktop ? "row" : "column",
          }}>
            {/* Habitat scene fills the whole card; the legacy component
                positions absolute inset:0 so we don't need a wrapper here. */}
            <HabitatBackground habitat={equippedHabitat} radius={24} glow={true} showLabel={true} />

            {/* Readability veil — gradient from transparent top to dark
                bottom so the slime stays bright but the text strip below
                doesn't fight the habitat color. */}
            <div style={{
              position: "absolute", inset: 0,
              background: isDesktop
                ? "linear-gradient(90deg, transparent 0%, transparent 40%, rgba(8,2,28,0.78) 100%)"
                : "linear-gradient(180deg, transparent 0%, transparent 45%, rgba(8,2,28,0.78) 100%)",
              pointerEvents: "none", zIndex: 1,
            }} />

            {/* Slime sits in the scene */}
            <div style={{
              position: "relative", zIndex: 2,
              width: isDesktop ? 220 : "100%",
              height: isDesktop ? "auto" : 200,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: isDesktop ? "26px 0 26px 22px" : "20px 18px 8px",
            }}>
              <img src={stage.src} alt={s.petName} width={150} height={150} style={{ width: 150, height: 150, objectFit: "contain", filter: `drop-shadow(0 0 24px ${equippedHabitat.bg.accent}66) drop-shadow(0 14px 26px rgba(0,0,0,0.55))`, animation: "profile-float-gentle 3s ease-in-out infinite" }} />
            </div>

            {/* Name + tier + xp */}
            <div style={{
              position: "relative", zIndex: 2,
              flex: 1, minWidth: 0,
              padding: isDesktop ? "26px 28px 22px" : "0 18px 20px",
              display: "flex", flexDirection: "column", justifyContent: "center",
              textAlign: isDesktop ? "left" : "center",
            }}>
              <div style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 26, color: T.ink, lineHeight: 1, letterSpacing: "-0.005em", textShadow: "0 2px 12px rgba(0,0,0,0.55)" }}>{s.petName}</div>
              <div style={{ display: "flex", gap: 6, justifyContent: isDesktop ? "flex-start" : "center", flexWrap: "wrap", marginTop: 9 }}>
                <Pill color={stage.tierColor}>{stage.tierLabel}</Pill>
                <Pill color={T.accent} soft>{stage.label}</Pill>
                <Pill color={equippedHabitat.bg.accent} soft>{equippedHabitat.name}</Pill>
              </div>
              <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, marginTop: 9 }}>
                {stage.nextAt < 999
                  ? <>Next evolution at <strong style={{ color: T.accent }}>LV {stage.nextAt}</strong></>
                  : <>Max evolution unlocked 👑</>}
              </div>
              <div style={{ marginTop: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.08em" }}>
                  <span>LV {s.level} · {s.xp}/{s.xpNext} XP</span>
                  <span>{s.xpPct}%</span>
                </div>
                <div style={{ height: 7, borderRadius: 999, background: "rgba(0,0,0,0.4)", overflow: "hidden", marginTop: 5 }}>
                  <div style={{ width: `${s.xpPct}%`, height: "100%", background: `linear-gradient(90deg, ${T.accent}, ${T.accent}99)`, boxShadow: `0 0 8px ${T.accent}` }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VERIFY CARD · only for connected players who haven't verified
            yet. Hides itself the moment isVerified flips true, so verified
            players never see lingering "go verify" CTAs · the badge on
            their avatar + the pills on their hero are the reward. Routes
            to /verify which already owns the actual flow. */}
        {connected && !isVerified && (
          <button
            onClick={() => router.push("/verify?next=/profile")}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 14,
              padding: "14px 16px", borderRadius: 16, cursor: "pointer",
              background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(6,182,212,0.10))",
              border: "1px solid rgba(134,239,172,0.45)",
              boxShadow: "0 0 18px rgba(34,197,94,0.15)",
              textAlign: "left",
            }}
          >
            {/* Green check tile · matches the badge color so the player
                visually associates this card with the reward they're about
                to earn. */}
            <div style={{
              width: 38, height: 38, borderRadius: 12, flexShrink: 0,
              background: "rgba(34,197,94,0.22)",
              border: "1px solid rgba(134,239,172,0.55)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#86efac",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.display, fontSize: 15, color: T.ink, lineHeight: 1.15 }}>
                Verify your humanity
              </div>
              <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim, marginTop: 3, lineHeight: 1.4 }}>
                Unlock the green check next to your name. Takes 60 seconds. Free.
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(134,239,172,0.85)" style={{ flexShrink: 0 }}>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}

        {/* STAT TILES · 2-col mobile, 4-col desktop */}
        {s && (
          <div style={{
            display: "grid",
            gridTemplateColumns: isDesktop ? "repeat(4, 1fr)" : "repeat(2, 1fr)",
            gap: 10,
          }}>
            {[
              { label: "Streak", value: `${s.streak}d`, sub: s.playedToday ? "Alive" : "Frozen", color: s.playedToday ? "#fb923c" : "#38bdf8", icon: "🔥" },
              { label: "Games played", value: s.gamesPlayed, sub: `+${s.gamesThisWeek} this week`, color: T.accent, icon: "🎮" },
              { label: "Best score", value: s.bestScore, sub: s.bestRhythm >= s.bestSimon ? "Rhythm Rush" : "Simon Memory", color: "#c026d3", icon: "🥁" },
              // All-time combined rank. Sub-label turns the raw number
              // into a status story ("Top 8%") — more motivating than
              // the position alone, especially as the player base grows.
              // Shows "Loading…" while the subgraph query is in flight
              // and "Play to rank up" if they haven't posted a score.
              { label: "Rank", value: s.rank === null ? "—" : `#${s.rank}`, sub: (() => {
                if (s.rank === null) return s.bestScore === 0 ? "Play to rank up" : "Loading…";
                if (!s.totalPlayers || s.totalPlayers < 2) return "Of everyone";
                const pct = Math.max(1, Math.min(99, Math.round((s.rank / s.totalPlayers) * 100)));
                return `Top ${pct}%`;
              })(), color: "#fbbf24", icon: "🏆" },
            ].map(t => (
              <div key={t.label} style={{
                padding: "14px 14px", borderRadius: 16,
                background: T.surface, border: `1px solid ${T.hairline}`,
                display: "flex", flexDirection: "column", gap: 6,
                position: "relative", overflow: "hidden",
              }}>
                <div style={{ position: "absolute", top: -10, right: -10, fontSize: 56, opacity: 0.08 }}>{t.icon}</div>
                <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, letterSpacing: "0.14em", fontWeight: 800 }}>{t.label.toUpperCase()}</span>
                <span style={{ fontFamily: T.display, fontSize: 24, color: t.color, lineHeight: 1, letterSpacing: "0.01em" }}>{t.value}</span>
                <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkDim, fontWeight: 700 }}>{t.sub}</span>
              </div>
            ))}
          </div>
        )}

        {/* HABITATS · slim teaser. Three tiles tell the player they have
            a home (equipped), a near-term goal (next free unlock), and a
            premium option (cheapest unowned paid). The full catalog +
            unlock flow lives at /shop — separates browsing from buying so
            the profile stays scannable and Badges/Achievements stay
            visible above the fold of the second scroll. */}
        {s && (() => {
          const teaserTiles = (() => {
            const eq = equippedHabitat;
            // Next free unlock = first free tier above current level.
            const nextFree = HABITAT_TIERS.find(h => h.type === "free" && s.level < (h.unlockLevel ?? 1)) ?? null;
            // Featured paid = cheapest unowned paid tier.
            const nextPaid = HABITAT_TIERS
              .filter(h => h.type === "paid" && !ownedPaidIds.includes(h.id))
              .sort((a, b) => Number(a.costG$ ?? 0n) - Number(b.costG$ ?? 0n))[0] ?? null;
            // De-dupe: don't show equipped twice if it happens to be the same tier.
            const picked = [eq, nextFree, nextPaid].filter((t): t is HabitatTier => !!t);
            const seen = new Set<number>();
            return picked.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true))).slice(0, 3);
          })();
          return (
            <div>
              <SectionLabel action={
                <button onClick={() => router.push("/shop")} style={{
                  fontFamily: T.body, fontSize: 10.5, color: T.accent, letterSpacing: "0.1em", fontWeight: 800,
                  background: "transparent", border: "none", padding: 0, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>VIEW SHOP →</button>
              }>Habitats · {unlockedHabitats}/{HABITAT_TIERS.length}</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${teaserTiles.length}, 1fr)`, gap: 10 }}>
                {teaserTiles.map(h => {
                  const lvl = s.level;
                  const unlocked = h.type === "free"
                    ? lvl >= (h.unlockLevel ?? 1)
                    : ownedPaidIds.includes(h.id);
                  const isEquipped = h.id === equippedHabitat.id;
                  const canEquip = unlocked && !isEquipped;
                  const isBuyable = !unlocked && h.type === "paid";
                  // Owned-but-not-equipped → quick equip (no shop trip needed).
                  // Anything else (locked free or buyable paid) → shop.
                  const handleClick = canEquip
                    ? () => { equipHabitat(h.id); }
                    : () => router.push("/shop");
                  const badge = isEquipped
                    ? "EQUIPPED"
                    : unlocked
                      ? "OWNED"
                      : h.type === "free"
                        ? `LV ${h.unlockLevel}`
                        : `${Number(h.costG$ ?? 0n) / 1e18} G$`;
                  return (
                    <div
                      key={h.id}
                      role="button" tabIndex={0}
                      onClick={handleClick}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
                      style={{
                        position: "relative", overflow: "hidden",
                        borderRadius: 14, minHeight: 116,
                        border: `1px solid ${isEquipped ? h.bg.accent + "88" : isBuyable ? h.bg.accent + "55" : "rgba(255,255,255,0.08)"}`,
                        boxShadow: isEquipped ? `0 0 16px ${h.bg.accent}55` : isBuyable ? `0 0 12px ${h.bg.accent}22` : "none",
                        display: "flex", flexDirection: "column",
                        background: "rgba(8,2,28,0.6)",
                        cursor: "pointer",
                        transition: "transform 0.15s",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
                    >
                      <div style={{
                        position: "absolute", inset: 0,
                        filter: unlocked ? "none" : isBuyable ? "saturate(0.85) brightness(0.85)" : "grayscale(0.7) brightness(0.55)",
                      }}>
                        <HabitatBackground habitat={h} radius={14} glow={unlocked || isBuyable} />
                      </div>
                      <div style={{
                        position: "relative", zIndex: 2,
                        marginTop: "auto",
                        padding: "8px 10px",
                        background: "linear-gradient(180deg, transparent 0%, rgba(4,2,18,0.88) 60%)",
                      }}>
                        <div style={{ fontFamily: T.display, fontSize: 12.5, color: T.ink, letterSpacing: "-0.005em", lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</div>
                      </div>
                      <div style={{
                        position: "absolute", top: 8, left: 8, zIndex: 2,
                        padding: "3px 8px", borderRadius: 999,
                        background: "rgba(0,0,0,0.6)",
                        border: `1px solid ${isEquipped ? h.bg.accent + "88" : isBuyable ? "rgba(251,191,36,0.55)" : "rgba(255,255,255,0.12)"}`,
                        fontFamily: T.body, fontSize: 8.5, fontWeight: 900, letterSpacing: "0.12em",
                        color: isEquipped ? h.bg.accent : isBuyable ? "#fde68a" : T.inkDim,
                        textShadow: isBuyable ? "0 0 6px rgba(251,191,36,0.5)" : "none",
                      }}>{badge}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* CHAMPIONSHIP BADGES · real top-3 finishes from /api/badges.
            Only renders the section header + summary chips if the player
            has at least one badge; otherwise the empty-state card pitches
            them on how to earn one. */}
        {s && (
          <div>
            <SectionLabel action={
              badgeData && badgeData.badges.length > 0 ? (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {badgeData.summary.totalGold > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 999, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.55)" }}>
                      <span style={{ fontSize: 11 }}>🥇</span>
                      <span style={{ fontFamily: T.body, color: "#fbbf24", fontSize: 10, fontWeight: 900 }}>{badgeData.summary.totalGold}</span>
                    </span>
                  )}
                  {badgeData.summary.totalSilver > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 999, background: "rgba(226,232,240,0.1)", border: "1px solid rgba(226,232,240,0.4)" }}>
                      <span style={{ fontSize: 11 }}>🥈</span>
                      <span style={{ fontFamily: T.body, color: "#e2e8f0", fontSize: 10, fontWeight: 900 }}>{badgeData.summary.totalSilver}</span>
                    </span>
                  )}
                  {badgeData.summary.totalBronze > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 999, background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.55)" }}>
                      <span style={{ fontSize: 11 }}>🥉</span>
                      <span style={{ fontFamily: T.body, color: "#f97316", fontSize: 10, fontWeight: 900 }}>{badgeData.summary.totalBronze}</span>
                    </span>
                  )}
                </div>
              ) : null
            }>Championship badges</SectionLabel>
            {badgeData && badgeData.badges.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(4, 1fr)" : "repeat(2, 1fr)", gap: 10 }}>
                {badgeData.badges.slice(0, 8).map((b, i) => {
                  const color = b.type === "gold" ? "#fbbf24" : b.type === "silver" ? "#e2e8f0" : "#f97316";
                  const medal = b.type === "gold" ? "🥇" : b.type === "silver" ? "🥈" : "🥉";
                  const gameName = b.game === "rhythm" ? "Rhythm Rush" : b.game === "simon" ? "Simon Memory" : b.game.toUpperCase();
                  return (
                    <div key={i} style={{
                      borderRadius: 16, padding: "12px 12px",
                      background: `linear-gradient(180deg, ${color}1a 0%, rgba(20,10,50,0.6) 100%)`,
                      border: `1px solid ${color}55`,
                      boxShadow: `0 0 14px ${color}22`,
                      display: "flex", gap: 11, alignItems: "center",
                      position: "relative", overflow: "hidden",
                    }}>
                      <div style={{
                        position: "absolute", top: 0, left: 0, right: 0, height: "40%",
                        background: `linear-gradient(180deg, ${color}11 0%, transparent 100%)`,
                        pointerEvents: "none",
                      }} />
                      <div style={{
                        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                        background: `radial-gradient(circle at 35% 30%, ${color}cc, ${color}55)`,
                        border: `1px solid ${color}aa`, boxShadow: `0 0 10px ${color}55`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 20, position: "relative", zIndex: 1,
                      }}>{medal}</div>
                      <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
                        <div style={{ fontFamily: T.display, color: T.ink, fontSize: 13, lineHeight: 1.1, letterSpacing: "-0.005em", textShadow: `0 0 8px ${color}66`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Week {b.season}</div>
                        <div style={{ fontFamily: T.body, color: T.inkDim, fontSize: 10, fontWeight: 700, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {gameName} · #{b.rank}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                padding: "18px 14px", textAlign: "center",
                borderRadius: 16,
                background: "rgba(20,10,50,0.4)",
                border: `1px dashed ${T.hairline}`,
              }}>
                <div style={{ fontSize: 26 }}>🏆</div>
                <div style={{ fontFamily: T.body, color: T.inkSoft, fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", marginTop: 6 }}>NO BADGES YET</div>
                <div style={{ fontFamily: T.body, color: T.inkSoft, fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
                  Finish in the top 3 of any weekly leaderboard to earn one.
                </div>
              </div>
            )}
          </div>
        )}

        {/* MILESTONE ACHIEVEMENTS · descriptive cards with full name +
            explanatory text. Data comes from /api/achievements/{address};
            falls back to the local catalog if the backend is unreachable
            so the section never goes blank. */}
        {s && (() => {
          const list: { id: string; icon: string; name: string; desc: string; unlocked: boolean }[] =
            backendAchievements.length > 0
              ? backendAchievements.map(a => ({ id: a.id, icon: a.icon, name: a.name, desc: a.desc, unlocked: a.unlocked }))
              : ACHIEVEMENTS.map(a => ({ id: a.id, icon: a.icon, name: a.name, desc: descFor(a.id), unlocked: a.unlock(s) }));
          const unlocked = list.filter(a => a.unlocked).length;
          const ACH_COLOR = "#fbbf24";
          return (
            <div>
              <SectionLabel action={
                <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, letterSpacing: "0.1em", fontWeight: 700 }}>{unlocked}/{list.length} UNLOCKED</span>
              }>Milestone achievements</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(2, 1fr)" : "repeat(1, 1fr)", gap: 10 }}>
                {list.map(a => (
                  <div key={a.id} style={{
                    borderRadius: 16, padding: "12px 12px",
                    background: a.unlocked
                      ? `linear-gradient(180deg, ${ACH_COLOR}1a 0%, rgba(20,10,50,0.6) 100%)`
                      : "rgba(20,10,50,0.4)",
                    border: `1px solid ${a.unlocked ? ACH_COLOR + "55" : T.hairline}`,
                    boxShadow: a.unlocked ? `0 0 14px ${ACH_COLOR}22` : "none",
                    display: "flex", gap: 11, alignItems: "center",
                    opacity: a.unlocked ? 1 : 0.6,
                    position: "relative", overflow: "hidden",
                  }}>
                    {a.unlocked && (
                      <div style={{
                        position: "absolute", top: 0, left: 0, right: 0, height: "40%",
                        background: `linear-gradient(180deg, ${ACH_COLOR}11 0%, transparent 100%)`,
                        pointerEvents: "none",
                      }} />
                    )}
                    <div style={{
                      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                      background: a.unlocked
                        ? `radial-gradient(circle at 35% 30%, ${ACH_COLOR}cc, ${ACH_COLOR}55)`
                        : "rgba(255,255,255,0.04)",
                      border: `1px solid ${a.unlocked ? ACH_COLOR + "aa" : T.hairline}`,
                      boxShadow: a.unlocked ? `0 0 10px ${ACH_COLOR}55` : "none",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 20, position: "relative", zIndex: 1,
                      filter: a.unlocked ? "none" : "grayscale(1)",
                    }}>{a.icon}</div>
                    <div style={{ flex: 1, minWidth: 0, position: "relative", zIndex: 1 }}>
                      <div style={{
                        fontFamily: T.display,
                        color: a.unlocked ? T.ink : "rgba(255,255,255,0.5)",
                        fontSize: 13.5, lineHeight: 1.15, letterSpacing: "-0.005em",
                        textShadow: a.unlocked ? `0 0 8px ${ACH_COLOR}66` : "none",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{a.name}</div>
                      <div style={{
                        fontFamily: T.body,
                        color: a.unlocked ? T.inkDim : T.inkSoft,
                        fontSize: 11, fontWeight: 600, marginTop: 3, lineHeight: 1.35,
                      }}>{a.desc}</div>
                    </div>
                    {a.unlocked ? (
                      <svg style={{ flexShrink: 0, position: "relative", zIndex: 1 }} width="14" height="14" viewBox="0 0 24 24" fill={ACH_COLOR}><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                    ) : (
                      <div style={{ flexShrink: 0, position: "relative", zIndex: 1, color: T.inkSoft }}>
                        <Icon name="lock" size={13} color="currentColor" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      </div>


      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
