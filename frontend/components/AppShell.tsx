"use client";

// ─── AppShell ────────────────────────────────────────────────────────────────
// Persistent chrome that wraps every gameplay page: left nav rail, right
// activity rail, top bar with chain status + balances + bell, and a mobile
// bottom tab bar. Pages render their main content in the children slot.
//
// The goal of this shell is "always-on context" — wherever you are in the
// app, the things that matter most stay visible: your level, your streak,
// your daily G$ claim, what's happening in the community, and friends.
// It's the same pattern Discord, Slack, Linear and Twitter use, adapted
// for a mobile-first Web3 game arena.
//
// Desktop layout (>= 1024px):
//   ┌──────────┬─────────────────────────────────┬──────────┐
//   │ left rail│  top bar  (60px sticky)         │ right    │
//   │  260px   ├─────────────────────────────────┤ rail     │
//   │          │                                 │ 320px    │
//   │  logo    │   {children}                    │          │
//   │  profile │                                 │ claim    │
//   │  nav     │                                 │ activity │
//   │  streak  │                                 │ friends  │
//   └──────────┴─────────────────────────────────┴──────────┘
//
// Mobile layout (< 1024px):
//   ┌────────────────────────────────────┐
//   │ slim top bar (logo + bell + bal)   │
//   ├────────────────────────────────────┤
//   │                                    │
//   │   {children}                       │
//   │                                    │
//   │   (right-rail panels inline)       │
//   │                                    │
//   ├────────────────────────────────────┤
//   │ bottom tabs (Home Play Lb Pet)     │
//   └────────────────────────────────────┘

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES, ERC20_ABI } from "@/lib/contracts";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { petForLevel } from "@/lib/pets";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// ─── Nav model ────────────────────────────────────────────────────────────────
// 4 first-class destinations. "Play" replaces "Games" (action over noun),
// "Pet" replaces "Profile" (your pet IS your progress — most engaging
// frame for a non-crypto-native audience). All four icons feel like
// game-UI affordances, not generic flat outlines.
type Tab = { label: string; path: string; emoji: string; svg: ReactNode };
const TABS: Tab[] = [
  { label: "Home",        path: "/home",        emoji: "🏠", svg: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg> },
  { label: "Play",        path: "/games",       emoji: "🎮", svg: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> },
  { label: "Leaderboard", path: "/leaderboard", emoji: "🏆", svg: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21H5a2 2 0 01-2-2v-7a2 2 0 012-2h6v11zm2 0V6a2 2 0 012-2h4a2 2 0 012 2v13h-8z"/></svg> },
  { label: "Pet",         path: "/profile",     emoji: "🐾", svg: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="6.5" cy="9" r="2"/><circle cx="17.5" cy="9" r="2"/><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/><path d="M12 11c-3 0-6 2.5-6 5.5C6 19 8 20 12 20s6-1 6-3.5c0-3-3-5.5-6-5.5z"/></svg> },
];

// ─── Common formatters ───────────────────────────────────────────────────────
function fmtBal(raw: bigint | undefined, decimals = 18, max = 2): string {
  if (raw === undefined) return "—";
  const whole = raw / 10n ** BigInt(decimals);
  const frac  = raw % 10n ** BigInt(decimals);
  const num   = Number(whole) + Number(frac) / Number(10n ** BigInt(decimals));
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toFixed(max).replace(/\.?0+$/, "") || "0";
}

function fmtCountdown(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Public component ────────────────────────────────────────────────────────
type Props = {
  children: ReactNode;
  /** Override the auto-derived active tab (e.g. /games/rhythm → /games). */
  activeTab?: string;
};

export default function AppShell({ children, activeTab }: Props) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const active = activeTab ?? TABS.find(t => pathname?.startsWith(t.path))?.path ?? "/games";

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "linear-gradient(160deg, #4c1d95 0%, #3b0a9e 35%, #1e0762 65%, #0d0230 100%)",
      display: "flex", flexDirection: "column", overflow: "hidden",
      color: "white", fontFamily: "inherit",
    }}>
      <TopBar isMobile={isMobile} />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {!isMobile && <LeftRail activePath={active} />}
        <main style={{
          flex: 1, minWidth: 0,
          overflowY: "auto",
          padding: isMobile ? "14px 14px 96px" : "20px 24px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255,255,255,0.18) transparent",
        }}>
          {children}
          {isMobile && (
            <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <DailyClaimPanel compact />
              <ActivityFeed compact />
            </div>
          )}
        </main>
        {!isMobile && <RightRail />}
      </div>
      {isMobile && <MobileTabBar active={active} />}
    </div>
  );
}

// ─── Top bar ─────────────────────────────────────────────────────────────────
function TopBar({ isMobile }: { isMobile: boolean }) {
  const { address } = useAccount();
  const { data: celoNative } = useBalance({ address, query: { enabled: !!address, refetchInterval: 30_000 } });
  const { data: gBal } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  // Season countdown — read from /api/competition. Cheap fetch, refreshed
  // on a slow cadence; this is decorative urgency, not a game timer.
  const [seasonSecLeft, setSeasonSecLeft] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`${BACKEND_URL}/api/competition`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { endsAt?: number } | null) => {
        if (cancelled || !d?.endsAt) return;
        setSeasonSecLeft(Math.max(0, d.endsAt - Math.floor(Date.now() / 1000)));
      })
      .catch(() => {});
    load();
    const i = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);
  useEffect(() => {
    if (seasonSecLeft <= 0) return;
    const t = setInterval(() => setSeasonSecLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [seasonSecLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <header style={{
      flexShrink: 0,
      display: "flex", alignItems: "center",
      gap: isMobile ? "8px" : "16px",
      padding: isMobile ? "10px 14px" : "12px 24px",
      background: "rgba(8,2,32,0.65)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      backdropFilter: "blur(12px)",
      zIndex: 5,
    }}>
      {isMobile && (
        <div style={{
          fontSize: "12px", fontWeight: 900, letterSpacing: "0.18em",
          color: "white", textShadow: "0 0 10px rgba(232,121,249,0.6)",
        }}>
          GAME ARENA
        </div>
      )}
      {!isMobile && (
        <>
          <ChainBadge />
          {seasonSecLeft > 0 && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ color: "rgba(220,200,255,0.55)", fontSize: "9px", fontWeight: 900, letterSpacing: "0.14em" }}>
                SEASON 3
              </span>
              <span style={{ color: "white", fontSize: "12px", fontWeight: 800 }}>
                {fmtCountdown(seasonSecLeft)} LEFT
              </span>
            </div>
          )}
        </>
      )}
      <div style={{ flex: 1 }} />
      <BalanceChip color="#fbbf24" symbol="CELO" value={fmtBal((celoNative?.value ?? undefined) as bigint | undefined)} />
      <BalanceChip color="#86efac" symbol="G$" value={fmtBal(gBal as bigint | undefined)} />
      <NotificationBell />
    </header>
  );
}

function ChainBadge() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      padding: "6px 12px",
      borderRadius: "999px",
      background: "rgba(34,197,94,0.12)",
      border: "1.5px solid rgba(34,197,94,0.55)",
      boxShadow: "0 0 14px rgba(34,197,94,0.25)",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
      <span style={{ color: "#86efac", fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em" }}>
        LIVE ON CELO
      </span>
    </div>
  );
}

function BalanceChip({ color, symbol, value }: { color: string; symbol: string; value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      padding: "5px 12px 5px 5px",
      borderRadius: "999px",
      background: "rgba(20,10,50,0.7)",
      border: `1.5px solid ${color}55`,
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, ${color}, ${color}88)`,
        boxShadow: `0 0 10px ${color}66, inset 0 1px 2px rgba(255,255,255,0.5)`,
      }} />
      <span style={{ color: "white", fontSize: "12px", fontWeight: 900 }}>{value}</span>
      <span style={{ color: "rgba(220,200,255,0.6)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.08em" }}>
        {symbol}
      </span>
    </div>
  );
}

function NotificationBell() {
  return (
    <button
      aria-label="Notifications"
      style={{
        width: 36, height: 36, borderRadius: "50%",
        background: "rgba(20,10,50,0.7)",
        border: "1.5px solid rgba(255,255,255,0.12)",
        color: "rgba(220,200,255,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11a6 6 0 00-5-5.9V4a1 1 0 10-2 0v1.1A6 6 0 006 11v5l-2 2v1h16v-1l-2-2z"/>
      </svg>
    </button>
  );
}

// ─── Left rail ───────────────────────────────────────────────────────────────
function LeftRail({ activePath }: { activePath: string }) {
  const router = useRouter();
  const { address } = useAccount();

  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: "rgba(4,1,18,0.6)",
      borderRight: "1px solid rgba(255,255,255,0.06)",
      display: "flex", flexDirection: "column",
      padding: "18px 14px",
      gap: "14px",
    }}>
      <button
        onClick={() => router.push("/home")}
        style={{
          display: "flex", alignItems: "center", gap: "10px",
          background: "transparent", border: "none", cursor: "pointer",
          padding: "2px 4px", color: "inherit", fontFamily: "inherit",
        }}
      >
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: "linear-gradient(135deg, #e879f9 0%, #6d28d9 100%)",
          boxShadow: "0 0 18px rgba(232,121,249,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "18px",
        }}>🎮</div>
        <span style={{
          color: "white", fontSize: "14px", fontWeight: 900, letterSpacing: "0.16em",
          textShadow: "0 0 12px rgba(232,121,249,0.5)",
        }}>
          GAME ARENA
        </span>
      </button>

      <ProfileChip address={address} onClick={() => router.push("/profile")} />

      <nav style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
        {TABS.map(t => {
          const isActive = activePath === t.path;
          return (
            <button
              key={t.path}
              onClick={() => router.push(t.path)}
              style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "11px 12px", borderRadius: "12px",
                background: isActive
                  ? "linear-gradient(95deg, rgba(232,121,249,0.18) 0%, rgba(232,121,249,0.04) 100%)"
                  : "transparent",
                border: "1.5px solid",
                borderColor: isActive ? "rgba(232,121,249,0.45)" : "transparent",
                color: isActive ? "white" : "rgba(220,200,255,0.65)",
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: isActive ? "0 0 16px rgba(232,121,249,0.18)" : "none",
                transition: "all 0.15s",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, color: isActive ? "#f0abfc" : "currentColor" }}>
                {t.svg}
              </span>
              <span style={{ fontSize: "13px", fontWeight: 800, letterSpacing: "0.06em" }}>
                {t.label}
              </span>
              {isActive && (
                <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "#f0abfc", boxShadow: "0 0 8px #f0abfc" }} />
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <StreakChip address={address} />
    </aside>
  );
}

// ─── Profile chip (left rail top) ────────────────────────────────────────────
function ProfileChip({ address, onClick }: { address: string | undefined; onClick: () => void }) {
  const [data, setData] = useState<{ username: string | null; level: number; xp: number; nextLevelXp: number } | null>(null);

  useEffect(() => {
    if (!address) { setData(null); return; }
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.json())
      .then(d => setData({
        username: d.username || null,
        level: d.level || 1,
        xp: d.xp || 0,
        nextLevelXp: d.nextLevelXp || 100,
      }))
      .catch(() => {});
  }, [address]);

  const pet = petForLevel(data?.level ?? 1);
  const xpPct = data ? Math.min(100, Math.round(((data.xp - levelStartXp(data.level)) / (data.nextLevelXp - levelStartXp(data.level))) * 100)) : 0;
  const safePct = isFinite(xpPct) && xpPct >= 0 ? xpPct : 0;
  const username = data?.username || (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "GUEST");

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "10px",
        borderRadius: "14px",
        background: "rgba(20,10,50,0.7)",
        border: `1.5px solid ${pet.color}33`,
        boxShadow: `0 0 18px ${pet.color}1f`,
        cursor: "pointer", fontFamily: "inherit",
        textAlign: "left",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pet.src} alt={pet.name} width={1024} height={1024}
        style={{
          width: 40, height: 40, borderRadius: 10,
          objectFit: "contain",
          background: `linear-gradient(135deg, ${pet.color}33, ${pet.color}11)`,
          padding: 2,
          flexShrink: 0,
          filter: `drop-shadow(0 0 8px ${pet.color}88)`,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "white", fontSize: "12px", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          @{username}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
          <span style={{ color: pet.color, fontSize: "9px", fontWeight: 900, letterSpacing: "0.1em" }}>
            LV {data?.level ?? 1}
          </span>
          <div style={{
            flex: 1, height: 4, borderRadius: 999,
            background: "rgba(0,0,0,0.5)", overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{
              width: `${safePct}%`, height: "100%",
              background: `linear-gradient(90deg, ${pet.color}, #fbbf24)`,
              transition: "width 0.4s",
            }} />
          </div>
        </div>
      </div>
    </button>
  );
}
function levelStartXp(level: number) { return 50 * level * (level - 1); }

// ─── Streak chip (left rail bottom) ──────────────────────────────────────────
function StreakChip({ address }: { address: string | undefined }) {
  const [streak, setStreak] = useState<{ streak: number; playedToday: boolean } | null>(null);
  useEffect(() => {
    if (!address) { setStreak(null); return; }
    fetch(`${BACKEND_URL}/api/streak/${address}`)
      .then(r => r.json())
      .then(d => setStreak({ streak: d.streak || 0, playedToday: !!d.playedToday }))
      .catch(() => setStreak(null));
  }, [address]);

  if (!streak || streak.streak === 0) return null;
  const live = streak.playedToday;

  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: "14px",
      background: live
        ? "linear-gradient(160deg, #7c2d00 0%, #2a0e00 100%)"
        : "linear-gradient(160deg, #0c2742 0%, #041022 100%)",
      border: `1.5px solid ${live ? "#f97316" : "#38bdf8"}`,
      boxShadow: live
        ? "0 0 16px rgba(249,115,22,0.45)"
        : "0 0 14px rgba(56,189,248,0.35)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          color: live ? "#fde68a" : "#bae6fd",
          fontSize: "9px", fontWeight: 900, letterSpacing: "0.18em",
        }}>
          {live ? "ON FIRE" : "STREAK FROZEN"}
        </span>
        <span style={{
          fontSize: "16px", lineHeight: 1,
          filter: live
            ? "drop-shadow(0 0 6px rgba(249,115,22,0.9))"
            : "hue-rotate(190deg) saturate(1.3) drop-shadow(0 0 4px rgba(56,189,248,0.7))",
        }}>🔥</span>
      </div>
      <div style={{
        marginTop: "4px",
        color: live ? "#fbbf24" : "#bae6fd",
        fontSize: "26px", fontWeight: 900, lineHeight: 1.1,
        textShadow: live
          ? "0 0 12px rgba(251,191,36,0.7)"
          : "0 0 10px rgba(56,189,248,0.6)",
      }}>
        {streak.streak}<span style={{ fontSize: "12px", fontWeight: 800, marginLeft: 4, opacity: 0.7 }}>days</span>
      </div>
      <div style={{
        marginTop: "4px",
        color: "rgba(220,200,255,0.55)",
        fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em",
        lineHeight: 1.4,
      }}>
        {live ? "Keep playing to extend it" : "Play any game to thaw it"}
      </div>
    </div>
  );
}

// ─── Right rail ──────────────────────────────────────────────────────────────
function RightRail() {
  return (
    <aside style={{
      width: 320, flexShrink: 0,
      background: "rgba(4,1,18,0.45)",
      borderLeft: "1px solid rgba(255,255,255,0.06)",
      overflowY: "auto",
      padding: "20px 16px",
      display: "flex", flexDirection: "column", gap: "16px",
    }}>
      <DailyClaimPanel />
      <ActivityFeed />
      <FriendsOnline />
    </aside>
  );
}

// ─── Daily claim panel ───────────────────────────────────────────────────────
function DailyClaimPanel({ compact }: { compact?: boolean } = {}) {
  const { address } = useAccount();
  const { isVerified, entitlement, claimG$ } = useSelfVerification();
  const router = useRouter();

  const amountG = entitlement ? Number(entitlement) / 1e18 : 0;
  const ready = isVerified && amountG > 0;

  return (
    <section>
      <SectionLabel>DAILY CLAIM</SectionLabel>
      <button
        onClick={() => {
          if (!address) router.push("/connect");
          else if (!isVerified) router.push("/verify");
          else if (ready) claimG$();
        }}
        style={{
          width: "100%", textAlign: "left",
          padding: compact ? "12px" : "14px",
          borderRadius: "14px",
          background: ready
            ? "linear-gradient(160deg, rgba(251,191,36,0.16) 0%, rgba(20,10,50,0.7) 100%)"
            : "rgba(20,10,50,0.7)",
          border: ready ? "1.5px solid #fbbf24" : "1.5px solid rgba(255,255,255,0.08)",
          boxShadow: ready ? "0 0 24px rgba(251,191,36,0.25)" : "none",
          cursor: "pointer", fontFamily: "inherit",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <div style={{
            width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
            background: "radial-gradient(circle at 35% 30%, #fde68a, #d97706)",
            boxShadow: "0 0 16px rgba(251,191,36,0.55), inset 0 2px 4px rgba(255,255,255,0.55)",
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: ready ? "#86efac" : "rgba(220,200,255,0.55)",
              fontSize: "9px", fontWeight: 900, letterSpacing: "0.18em",
            }}>
              {!address ? "CONNECT" : !isVerified ? "VERIFY" : ready ? "READY" : "CHECK BACK"}
            </div>
            <div style={{
              color: "white", fontSize: "16px", fontWeight: 900,
              marginTop: "2px",
            }}>
              {ready ? `Claim ${amountG.toFixed(2)} G$` : "Daily G$ from GoodDollar"}
            </div>
            <div style={{
              color: "rgba(220,200,255,0.55)", fontSize: "10px", fontWeight: 700,
              marginTop: "4px", lineHeight: 1.45,
            }}>
              {!address
                ? "Sign in to claim free G$ daily."
                : !isVerified
                  ? "1-min face verify unlocks the daily drip."
                  : ready
                    ? "Resets at midnight UTC. 30% of every play funds UBI."
                    : "You've claimed today. Comes back at midnight UTC."}
            </div>
          </div>
          <span style={{ color: ready ? "#fbbf24" : "rgba(220,200,255,0.35)", fontSize: "20px", flexShrink: 0 }}>›</span>
        </div>
      </button>
    </section>
  );
}

// ─── Activity feed ───────────────────────────────────────────────────────────
type Activity = {
  id: string;
  icon: string;
  iconBg: string;
  title: string;
  body: string;
  tag?: { label: string; color: string };
};

function ActivityFeed({ compact }: { compact?: boolean } = {}) {
  const { address } = useAccount();
  const router = useRouter();
  const [items, setItems] = useState<Activity[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next: Activity[] = [];

      // 1. Your weekly cup rank
      if (address) {
        try {
          const r = await fetch(`${BACKEND_URL}/api/pvp-leaderboard?address=${address}`);
          if (r.ok) {
            const d = await r.json();
            const me = d?.me;
            if (me?.rank) {
              next.push({
                id: "self-rank",
                icon: "🏆", iconBg: "linear-gradient(135deg, #fbbf24, #b45309)",
                title: `You're #${me.rank} this week`,
                body: `${me.points ?? 0} pts · keep playing`,
                tag: { label: "YOU", color: "#fbbf24" },
              });
            }
          }
        } catch {}
      }

      // 2. Community challenge
      try {
        const r = await fetch(`${BACKEND_URL}/api/weekly-challenge${address ? `?wallet=${address}` : ""}`);
        if (r.ok) {
          const d = await r.json();
          if (d?.title) {
            next.push({
              id: "challenge",
              icon: "🌍", iconBg: "linear-gradient(135deg, #22d3ee, #0e7490)",
              title: d.title,
              body: d.description || "Community challenge live now",
              tag: { label: "OPEN", color: "#22d3ee" },
            });
          }
        }
      } catch {}

      // 3. Season info
      try {
        const r = await fetch(`${BACKEND_URL}/api/competition`);
        if (r.ok) {
          const d = await r.json();
          if (d?.endsAt) {
            const left = Math.max(0, d.endsAt - Math.floor(Date.now() / 1000));
            next.push({
              id: "season",
              icon: "💎", iconBg: "linear-gradient(135deg, #a78bfa, #4f46e5)",
              title: `Season ends in ${fmtCountdown(left)}`,
              body: "Top 3 win NFT champion badge",
            });
          }
        }
      } catch {}

      if (!cancelled) setItems(next);
    };
    load();
    const i = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [address]);

  if (compact && items.length === 0) return null;

  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <SectionLabel inline>LIVE ACTIVITY</SectionLabel>
        <button
          onClick={() => router.push("/leaderboard")}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "rgba(220,200,255,0.55)", fontSize: "9px", fontWeight: 900,
            letterSpacing: "0.14em", fontFamily: "inherit",
          }}
        >
          VIEW ALL ›
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {items.length === 0 ? (
          <EmptyHint>Live stats arrive once you start playing.</EmptyHint>
        ) : items.map(a => (
          <div key={a.id} style={{
            display: "flex", alignItems: "flex-start", gap: "10px",
            padding: "10px",
            borderRadius: "12px",
            background: "rgba(20,10,50,0.7)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: a.iconBg,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "16px",
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.4)",
            }}>{a.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: "white", fontSize: "11.5px", fontWeight: 800, lineHeight: 1.3,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{a.title}</div>
              <div style={{
                color: "rgba(220,200,255,0.55)", fontSize: "10px", fontWeight: 700,
                marginTop: "2px", lineHeight: 1.4,
              }}>{a.body}</div>
            </div>
            {a.tag && (
              <span style={{
                padding: "3px 8px", borderRadius: 999,
                background: `${a.tag.color}22`,
                border: `1px solid ${a.tag.color}66`,
                color: a.tag.color,
                fontSize: "9px", fontWeight: 900, letterSpacing: "0.1em",
                flexShrink: 0,
              }}>{a.tag.label}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Friends online ──────────────────────────────────────────────────────────
function FriendsOnline() {
  // No social graph yet — render as an empty-state stub so the rail
  // composition stays balanced. When friends launch this slot becomes
  // the always-on community presence.
  return (
    <section>
      <SectionLabel>FRIENDS ONLINE</SectionLabel>
      <EmptyHint>
        Invite a friend to play and they'll show up here.
      </EmptyHint>
    </section>
  );
}

// ─── Mobile tab bar ──────────────────────────────────────────────────────────
function MobileTabBar({ active }: { active: string }) {
  const router = useRouter();
  return (
    <nav style={{
      position: "fixed", left: 0, right: 0, bottom: 0,
      zIndex: 60,
      background: "rgba(4,1,18,0.96)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 -8px 24px rgba(0,0,0,0.5)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      <div style={{ display: "flex", padding: "8px 6px 6px" }}>
        {TABS.map(t => {
          const isActive = active === t.path;
          return (
            <button
              key={t.path}
              onClick={() => router.push(t.path)}
              aria-current={isActive ? "page" : undefined}
              style={{
                flex: "1 1 0",
                padding: "6px 4px",
                borderRadius: "12px",
                background: isActive ? "rgba(232,121,249,0.15)" : "transparent",
                border: "none",
                color: isActive ? "white" : "rgba(220,200,255,0.55)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
                cursor: "pointer", fontFamily: "inherit",
                minHeight: 54,
              }}
            >
              {t.svg}
              <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.06em" }}>
                {t.label.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────
function SectionLabel({ children, inline }: { children: ReactNode; inline?: boolean }) {
  return (
    <div style={{
      color: "rgba(220,200,255,0.65)",
      fontSize: "10px", fontWeight: 900, letterSpacing: "0.18em",
      marginBottom: inline ? 0 : "10px",
    }}>{children}</div>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: "16px 14px", borderRadius: 12,
      background: "rgba(20,10,50,0.5)",
      border: "1px dashed rgba(255,255,255,0.08)",
      color: "rgba(220,200,255,0.5)", fontSize: "10.5px", fontWeight: 700,
      textAlign: "center", lineHeight: 1.5,
    }}>{children}</div>
  );
}
