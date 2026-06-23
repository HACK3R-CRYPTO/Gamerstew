"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract } from "wagmi";
import { celo } from "viem/chains";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import { fetchAllTimeLeaderboard, fetchPlayerAllTimeCombinedStats, type AllTimeEntry, type GameTypeId } from "@/lib/subgraph";
import { fetchPreview } from "@/lib/leaderboardPreview";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

// ─── tokens (kept in sync with /home + Onboarding) ───────────────────────
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
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "2px 2px 4px" }}>
      <span style={{ fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>{children}</span>
      {action}
    </div>
  );
}

const ICON_PATHS: Record<string, string> = {
  chev: "M9 6l6 6-6 6",
  sparkle: "M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6zM5 17l.8 2.2L8 20l-2.2.8L5 23l-.8-2.2L2 20l2.2-.8zM19 14l.6 1.6L21 16l-1.4.4L19 18l-.6-1.6L17 16l1.4-.4z",
  target: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12m0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6z",
  play: "M8 5v14l11-7z",
};
function Icon({ name, size = 16, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d={ICON_PATHS[name] || ""} /></svg>;
}

// ─── games (mirrors the actual games shipped) ───────────────────────────
// Order matters · the first entry becomes the home hero banner. Stack Tower
// is listed first while it's the new-launch feature; rotate as new games drop.
// `art` is either a PNG path or an inline SVG element · HeroCard and
// GamesGrid branch on typeof to render both.
type Game = {
  id: string;
  title: string;
  subtitle: string;
  art: string | React.ReactNode;
  bg: string;
  glow: string;
  desc: string;
  active: boolean;
  href: string;
  isNew?: boolean;
};

const STACK_ART = (
  // Inline SVG rainbow tower · matches the games-hub card identity so the
  // home hero banner and the /games card show the same artwork.
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
);

const GAMES: Game[] = [
  {
    id: "stack", title: "Stack Tower", subtitle: "Stack & survive · don't drop",
    art: STACK_ART, bg: "linear-gradient(155deg, #f97316 0%, #c2410c 55%, #7c2d12 100%)", glow: "#fb923c",
    desc: "Drop the falling block. Chain perfect stacks. Miss once, the tower falls.",
    active: true, href: "/games/stack", isNew: true,
  },
  {
    id: "rhythm", title: "Rhythm Rush", subtitle: "Tap to the beat · combo to climb",
    art: "/games/rhythm.png", bg: "linear-gradient(155deg, #c026d3 0%, #7c1d9e 55%, #4c1d95 100%)", glow: "#c026d3",
    desc: "Tap to the beat, chain combos, top the weekly leaderboard.", active: true, href: "/games/rhythm",
  },
  {
    id: "simon", title: "Simon Memory", subtitle: "Sequence memory · go deeper",
    art: "/games/simon.png", bg: "linear-gradient(155deg, #0e7490 0%, #075985 55%, #1e1b4b 100%)", glow: "#06b6d4",
    desc: "Repeat the color run. Go deeper than everyone else for a top rank.", active: true, href: "/games/simon",
  },
  {
    id: "arena", title: "Challenge AI", subtitle: "Wager G$ · beat MARKOV",
    art: "/games/challenge-ais.png", bg: "linear-gradient(155deg, #14532d 0%, #064e3b 55%, #022c22 100%)", glow: "#22c55e",
    desc: "Duel MARKOV, the on-chain AI agent. Best of 3, ties go to you.", active: true, href: "/games/challenge-ai",
  },
];

// ─── data hooks ─────────────────────────────────────────────────────────
type DashData = {
  totalPlayers: number;
  totalMatches: number;
  climb: { phase: string; endsAt: string; rank: number; matches: number } | null;
  top3: AllTimeEntry[];
};

const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.0/gn";

async function fetchGlobalStat() {
  try {
    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{ globalStat(id: "global") { totalPlayers totalScores } }` }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = await res.json();
    const g = j?.data?.globalStat;
    return g ? { totalPlayers: Number(g.totalPlayers), totalScores: Number(g.totalScores) } : null;
  } catch { return null; }
}

function climbPillLabel(climb: { phase: string; endsAt: string } | null): string {
  if (!climb || climb.phase !== "live") return "BETA · LIVE ON CELO";
  const msLeft = new Date(climb.endsAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  if (daysLeft <= 0) return "BETA · LIVE ON CELO";
  if (daysLeft === 1) return "MARKOV CLIMB · FINAL DAY";
  return `MARKOV CLIMB · ${daysLeft} DAYS LEFT`;
}

// ─── page ───────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [dash, setDash] = useState<DashData | null>(null);
  const [me, setMe] = useState<{ rank: number; peak: number; bestRhythm: number; bestSimon: number } | null>(null);
  // Live level + streak from games-backend (same source the AppHeader uses).
  // Was hardcoded `LV 1` + `0-day streak` in the WELCOME pills · which made
  // them look fake even for players with real progression. Refetches when
  // the wallet flips so a wallet swap shows that wallet's numbers.
  const [userMeta, setUserMeta] = useState<{ level: number; streak: number } | null>(null);
  // Per-game loading overlay state · same pattern as /games/page.tsx ·
  // holds the tapped game's identity so the loader paints its art/title
  // /glow during the hub → lobby transition.
  const [loadingGame, setLoadingGame] = useState<typeof GAMES[number] | null>(null);

  // Has the wallet minted a GamePass? Used to surface "Sign in to claim"
  // vs the real claim card. Players without a pass aren't fully onboarded.
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

  // MiniPay path · no Privy auth, identity is the injected wallet itself.
  // Once they've minted GamePass they're a fully connected player.
  const isMiniPay = useIsMiniPay();
  const connected = (authenticated || isMiniPay) && !!address && hasMinted === true;
  // Display name = on-chain slime name. Never the email or address.
  const username = (chainUsername as string | undefined) || "";

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Public live data — works for both guests and connected players.
  useEffect(() => {
    let cancelled = false;
    const climbReq = fetch("/api/markov-climb", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => d ? { event: d.event ?? null, leaderboard: d.leaderboard ?? [] } : null)
      .catch(() => null);
    Promise.all([fetchGlobalStat(), fetchAllTimeLeaderboard(3), climbReq])
      .then(([stat, top, climbRes]) => {
        if (cancelled || !stat) return;
        const climbRow = address && climbRes?.leaderboard
          ? climbRes.leaderboard.find((r: { wallet?: string }) => r.wallet?.toLowerCase() === address.toLowerCase())
          : null;
        setDash({
          totalPlayers: stat.totalPlayers,
          totalMatches: stat.totalScores,
          top3: top,
          climb: climbRes?.event ? {
            phase: String(climbRes.event.phase ?? ""),
            endsAt: String(climbRes.event.endsAt ?? ""),
            rank: climbRow?.rank ?? 0,
            matches: climbRow?.matches ?? 0,
          } : null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [address]);

  // Personal stats for connected players. fetchPlayerAllTimeCombinedStats
  // pulls the player's rank + peak score from the subgraph.
  useEffect(() => {
    if (!connected || !address) { setMe(null); return; }
    let cancelled = false;
    fetchPlayerAllTimeCombinedStats(address)
      .then(r => { if (!cancelled) setMe(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, address]);

  // Live level + play_streak from games-backend (same source the AppHeader
  // uses · /api/user/{addr}). Feeds the WELCOME pills below the greeting
  // so they reflect the player's actual progression, not a hardcoded "LV 1
  // · 0-day streak". Refetches every 30s so the chip stays current after a
  // game submit on another route updates the row.
  useEffect(() => {
    if (!connected || !address) { setUserMeta(null); return; }
    let cancelled = false;
    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    const load = () => {
      fetch(`${backend}/api/user/${address}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (cancelled || !d) return;
          setUserMeta({ level: Number(d.level ?? 1), streak: Number(d.streak ?? 0) });
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connected, address]);

  const onPlayGame = async (id: string) => {
    // Spam-tap guard · ignore while a load is in flight (the overlay
    // covers the cards anyway, but this stops queued promises racing).
    if (loadingGame) return;
    const g = GAMES.find(x => x.id === id);
    if (!g?.active) return;

    // Show per-game loading overlay with this game's art/title/glow.
    setLoadingGame(g);

    // Concurrent wait: leaderboard prefetch OR min 600ms (whichever
    // longer). Loader never feels rushed on a fast connection, never
    // feels stuck on a slow one. Same pattern as /games/page.tsx.
    const gameType: GameTypeId | null =
      id === "rhythm" ? 0 : id === "simon" ? 1 : id === "stack" ? 2 : null;
    const tasks: Promise<unknown>[] = [new Promise(r => setTimeout(r, 600))];
    if (gameType !== null) tasks.push(fetchPreview(gameType).catch(() => null));
    await Promise.all(tasks);

    router.push(g.href);
    // Overlay stays mounted until the route change unmounts the page ·
    // clearing here would cause a brief blank flash.
  };
  // Always route Sign-in / Connect taps to /home — that's the canonical
  // entry point where the Privy modal lives + the onboarding overlay
  // takes over for first-time signers. Opening the Privy modal directly
  // from a feed-style screen drops players into a disconnected popup
  // with no surrounding context.
  const onConnect = () => router.push("/home");
  const recommended = GAMES[0];

  return (
    <div style={{
      minHeight: "100vh", width: "100%",
      background: T.bg,
      color: T.ink,
      fontFamily: T.body,
    }}>
      {/* Persistent header — full-viewport sticky band; content centers itself
          inside. The band carries the dark glass, the content sits on the
          page's column. */}
      <AppHeader />

      {/* Guest banner — only when the player hasn't finished onboarding. The
          design uses this strip as the soft second-prompt to sign in. */}
      {!connected && (
        <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "8px auto 0" }}>
          <GuestBanner onConnect={onConnect} />
        </div>
      )}

      <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "0 auto", padding: isDesktop ? "8px 32px 130px" : "4px 16px 110px", display: "flex", flexDirection: "column", gap: T.gap + 2 }}>

        {/* Greeting — design pattern: pills appear only for connected players.
            Guests see "WELCOME / Player" with no chips, just like the design. */}
        <div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.14em" }}>{connected ? "WELCOME BACK" : "WELCOME"}</div>
          <h2 style={{ fontFamily: T.display, fontSize: isDesktop ? 30 : 24, color: T.ink, margin: "3px 0 0", letterSpacing: "-0.01em" }}>{connected ? (username || "Player") : "Player"}</h2>
          {connected && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {/* Live streak from /api/user · "🔥 New" reads warmer than
                  "🔥 0-day streak" for a fresh player; once they hit day 1
                  the real number shows. */}
              <Pill color="#bae6fd">
                🔥 {userMeta && userMeta.streak > 0 ? `${userMeta.streak}-day streak` : "New"}
              </Pill>
              <Pill color="#a78bfa">LV {userMeta?.level ?? 1}</Pill>
              {me && me.peak > 0 && <Pill color="#fbbf24">PEAK {me.peak}</Pill>}
            </div>
          )}
        </div>

        {isDesktop ? (
          <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 16, alignItems: "start" }}>
            <DashLeft connected={connected} recommended={recommended} onPlayGame={onPlayGame} router={router} />
            <DashRight connected={connected} dash={dash} me={me} address={address ?? null} onConnect={onConnect} router={router} />
          </div>
        ) : (
          <>
            <ClaimCard connected={connected} onConnect={onConnect} router={router} />
            <HeroCard game={recommended} onPlayGame={onPlayGame} />
            <SectionLabel action={<ViewAll onClick={() => router.push("/games")} />}>Games</SectionLabel>
            <GamesGrid onPlayGame={onPlayGame} excludeId={recommended.id} />
            <SectionLabel>Daily missions</SectionLabel>
            <MissionCard connected={connected} onConnect={onConnect} />
            <SectionLabel action={<ViewAll onClick={() => router.push("/leaderboard")} />}>Your cup</SectionLabel>
            <ClimbCard connected={connected} dash={dash} address={address ?? null} onConnect={onConnect} router={router} />
            <SectionLabel action={<ViewAll onClick={() => router.push("/leaderboard")} />}>Live activity</SectionLabel>
            {(() => {
              const feed = buildFeed(dash, me, connected);
              return feed.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {feed.slice(0, 3).map((it, i) => <FeedRow key={i} item={it} />)}
                </div>
              ) : (
                <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, padding: "6px 4px" }}>Nothing happening yet — play a game to be first.</div>
              );
            })()}
          </>
        )}
      </div>

      {/* Bottom nav — Home / Play / Events / Pet per CLAUDE.md IA. Renders
          as a floating pill on desktop and a full-width bar on mobile. */}
      <AppBottomNav wide={isDesktop} />

      {/* Per-game loading overlay · branded transition while the lobby's
          top-3 leaderboard cache warms up. Each game shows its own
          art/title/glow so the loader reads as part of that game. */}
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

function DashLeft({ connected, recommended, onPlayGame, router }: {
  connected: boolean;
  recommended: typeof GAMES[number];
  onPlayGame: (id: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <HeroCard game={recommended} onPlayGame={onPlayGame} />
      <SectionLabel action={<ViewAll onClick={() => router.push("/games")} />}>Games</SectionLabel>
      <GamesGrid onPlayGame={onPlayGame} excludeId={recommended.id} />
      <SectionLabel>Daily missions</SectionLabel>
      <MissionCard connected={connected} onConnect={() => router.push("/home")} />
    </div>
  );
}

function DashRight({ connected, dash, me, address, onConnect, router }: {
  connected: boolean;
  dash: DashData | null;
  me: { rank: number; peak: number } | null;
  address: string | null;
  onConnect: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const feed = buildFeed(dash, me, connected);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ClaimCard connected={connected} onConnect={onConnect} router={router} />
      <SectionLabel action={<ViewAll onClick={() => router.push("/leaderboard")} />}>Your cup</SectionLabel>
      <ClimbCard connected={connected} dash={dash} address={address} onConnect={onConnect} router={router} />
      <SectionLabel action={<ViewAll onClick={() => router.push("/leaderboard")} />}>Live activity</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {feed.length ? feed.slice(0, 5).map((it, i) => <FeedRow key={i} item={it} />) : (
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, padding: "6px 4px" }}>Nothing happening yet — play a game to be first.</div>
        )}
      </div>
    </div>
  );
}

// ─── blocks ─────────────────────────────────────────────────────────────
// Slim "you're playing free" strip with a Sign in chip · design pattern.
function GuestBanner({ onConnect }: { onConnect: () => void }) {
  return (
    <div style={{
      margin: "0 16px",
      padding: "9px 12px", borderRadius: 13,
      background: `linear-gradient(90deg, ${T.accent}1f, rgba(255,255,255,0.02))`,
      border: `1px solid ${T.accent}44`,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>🎁</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: T.body, fontSize: 11, color: T.ink, fontWeight: 700, lineHeight: 1.3 }}>
          You&apos;re playing free.
        </span>
        <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, lineHeight: 1.3 }}>
          {" "}Sign in to win G$, save your pet &amp; climb the board.
        </span>
      </div>
      <button onClick={onConnect} style={{
        flexShrink: 0, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
        background: T.accent, border: "none",
        color: "#fff", fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em",
        boxShadow: `0 4px 12px -3px ${T.accent}aa`,
      }}>SIGN IN</button>
    </div>
  );
}

// Single feed row · matches design's FeedRow exactly.
type FeedItem = { icon: string; color: string; title: string; sub: string; tag?: string; tagColor?: string; onClick?: () => void };
function FeedRow({ item }: { item: FeedItem }) {
  return (
    <button onClick={item.onClick} style={{
      display: "flex", alignItems: "center", gap: 11,
      padding: "10px 12px", borderRadius: 14,
      background: T.surface,
      border: `1px solid ${T.hairline}`,
      cursor: item.onClick ? "pointer" : "default",
      textAlign: "left", width: "100%",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        background: `radial-gradient(circle at 35% 30%, ${item.color}cc, ${item.color}33)`,
        border: `1px solid ${item.color}66`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 15,
      }}>{item.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.ink, fontWeight: 700, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
        <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkDim, lineHeight: 1.3, marginTop: 1 }}>{item.sub}</div>
      </div>
      {item.tag && <Pill color={item.tagColor || T.accent}>{item.tag}</Pill>}
    </button>
  );
}

// Build the Live activity feed from real data only — climb, top scorer,
// community totals. No mocked rows.
function buildFeed(dash: DashData | null, me: { rank: number } | null, connected: boolean): FeedItem[] {
  if (!dash) return [];
  const out: FeedItem[] = [];

  if (dash.climb && dash.climb.phase === "live") {
    const msLeft = new Date(dash.climb.endsAt).getTime() - Date.now();
    const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    out.push({
      icon: "🏆", color: "#fbbf24",
      title: connected && dash.climb.rank > 0
        ? `You're #${dash.climb.rank} in MARKOV Climb`
        : "MARKOV Climb is live",
      sub: `${daysLeft === 1 ? "Final day" : `${daysLeft} days left`} · $5 USDC + 1,000 G$ pool`,
      tag: connected && dash.climb.rank > 0 ? "YOU" : "OPEN",
      tagColor: connected && dash.climb.rank > 0 ? "#fbbf24" : "#22c55e",
    });
  }

  const topScorer = dash.top3[0];
  if (topScorer) {
    const name = topScorer.username || `${topScorer.player.slice(0, 6)}…${topScorer.player.slice(-4)}`;
    out.push({
      icon: "🥁", color: "#c026d3",
      title: `@${name.replace(/^@/, "")} leads the boards`,
      sub: `${topScorer.score} pts combined · beat them`,
    });
  }

  if (dash.totalMatches > 0) {
    out.push({
      icon: "🌍", color: "#86efac",
      title: `${dash.totalPlayers} players · ${dash.totalMatches.toLocaleString()} matches`,
      sub: "Live community total · all-time",
    });
  }

  if (me && me.rank > 0) {
    out.push({
      icon: "💎", color: "#22d3ee",
      title: `You're #${me.rank} all-time`,
      sub: "Keep playing to climb",
      tag: "YOU", tagColor: "#22d3ee",
    });
  }

  return out;
}

function ViewAll({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} style={{ fontFamily: T.body, fontSize: 10, color: T.accent, fontWeight: 800, letterSpacing: "0.08em", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>VIEW ALL ›</button>;
}

// G$ claim card — mirrors the main-branch profile pattern exactly:
//   1. Not signed in  → "Sign in to claim" → /home
//   2. !isVerified    → "Verify to unlock" → /verify
//   3. entitlement>0  → "Claim X G$" CTA  → triggers claimG$() inline
//   4. else (verified, no entitlement) → "Claimed today" dimmed
// No "checking" intermediate — the main branch never had one and the
// SDK status call hydrates isVerified within a second on the happy path.
// A cache hit (gd_verified_<addr> in localStorage) makes step 2 invisible
// for returning players; cold-start users see it for a beat.
function ClaimCard({ connected, onConnect, router }: { connected: boolean; onConnect: () => void; router: ReturnType<typeof useRouter> }) {
  const { isVerified, entitlement, claimG$ } = useSelfVerification();
  const [claiming, setClaiming] = useState(false);

  if (!connected) {
    return (
      <button onClick={onConnect} style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 16, background: `linear-gradient(135deg, ${T.accent}2e, rgba(15,8,40,0.6))`, border: `1px solid ${T.accent}55`, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🎁</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.body, fontSize: 10, color: T.accent, fontWeight: 800, letterSpacing: "0.12em" }}>FREE DAILY G$</div>
            <div style={{ fontFamily: T.display, fontSize: 16, color: T.ink, marginTop: 1 }}>Sign in to claim</div>
          </div>
          <Icon name="chev" size={16} color={T.inkSoft} />
        </div>
      </button>
    );
  }

  if (!isVerified) {
    return (
      <button onClick={() => router.push(`/verify?next=${encodeURIComponent("/dashboard")}`)} style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 16, background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(20,83,45,0.45) 100%)", border: "1px solid rgba(134,239,172,0.4)", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 999, background: "radial-gradient(circle at 35% 35%, #fde68a, #b45309)", boxShadow: "0 0 12px rgba(251,191,36,0.6)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.body, fontSize: 10, color: "#86efac", fontWeight: 800, letterSpacing: "0.12em" }}>FREE DAILY G$</div>
            <div style={{ fontFamily: T.display, fontSize: 18, color: T.ink, marginTop: 1 }}>Verify to unlock</div>
          </div>
          <Icon name="chev" size={16} color={T.inkSoft} />
        </div>
      </button>
    );
  }

  if (entitlement === 0n) {
    return (
      <div style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 16, background: "rgba(20,10,50,0.4)", border: `1px solid ${T.hairline}`, opacity: 0.7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 999, background: "radial-gradient(circle at 35% 35%, #4b3a05, #1a1305)", display: "flex", alignItems: "center", justifyContent: "center", color: "#86efac", fontSize: 16 }}>✓</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.12em" }}>FREE DAILY G$</div>
            <div style={{ fontFamily: T.display, fontSize: 16, color: T.ink, marginTop: 1 }}>Claimed today</div>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, marginTop: 2 }}>Come back tomorrow.</div>
          </div>
        </div>
      </div>
    );
  }

  const amount = (Number(entitlement) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const onClaim = async () => {
    if (claiming) return;
    setClaiming(true);
    try { await claimG$(); }
    finally { setClaiming(false); }
  };
  return (
    <button onClick={onClaim} disabled={claiming} style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 16, background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(20,83,45,0.45) 100%)", border: "1px solid rgba(134,239,172,0.4)", cursor: claiming ? "not-allowed" : "pointer", opacity: claiming ? 0.75 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 999, background: "radial-gradient(circle at 35% 35%, #fde68a, #b45309)", boxShadow: "0 0 12px rgba(251,191,36,0.6)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.body, fontSize: 10, color: "#86efac", fontWeight: 800, letterSpacing: "0.12em" }}>FREE DAILY G$</div>
          <div style={{ fontFamily: T.display, fontSize: 18, color: T.ink, marginTop: 1 }}>{claiming ? "Claiming…" : `Claim ${amount} G$`}</div>
        </div>
        {!claiming && <Icon name="chev" size={16} color={T.inkSoft} />}
      </div>
    </button>
  );
}

function HeroCard({ game, onPlayGame }: { game: typeof GAMES[number]; onPlayGame: (id: string) => void }) {
  return (
    <button onClick={() => onPlayGame(game.id)} style={{
      position: "relative", overflow: "hidden", width: "100%", padding: 0, border: "none", cursor: "pointer",
      borderRadius: 20, textAlign: "left", background: game.bg,
      boxShadow: `0 16px 36px -12px ${game.glow}88, inset 0 1px 0 rgba(255,255,255,0.12)`,
      minHeight: 150, display: "flex", flexDirection: "column", justifyContent: "space-between",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.22), transparent 60%)", pointerEvents: "none" }} />
      {typeof game.art === "string" ? (
        <img src={game.art} alt="" style={{ position: "absolute", right: -16, bottom: -10, width: 150, height: 150, objectFit: "contain", filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.5))", pointerEvents: "none" }} />
      ) : (
        <div style={{ position: "absolute", right: -8, bottom: -4, width: 150, height: 150, pointerEvents: "none" }}>{game.art}</div>
      )}
      <div style={{ padding: "14px 14px 0" }}>
        <Pill color="#fde68a">{game.isNew ? "✨ NEW GAME" : "▶ JUMP BACK IN"}</Pill>
      </div>
      <div style={{ padding: "12px 14px 14px", maxWidth: "64%", position: "relative", zIndex: 1 }}>
        <div style={{ fontFamily: T.display, fontSize: 23, color: "#fff", lineHeight: 1, textShadow: "0 2px 6px rgba(0,0,0,0.45)" }}>{game.title}</div>
        <div style={{ fontFamily: T.body, fontSize: 11, color: "rgba(255,255,255,0.78)", marginTop: 5, lineHeight: 1.35 }}>{game.desc}</div>
      </div>
    </button>
  );
}

function GamesGrid({ onPlayGame, excludeId }: { onPlayGame: (id: string) => void; excludeId?: string }) {
  // The hero banner already features `excludeId` so the grid skips it · keeps
  // the row at 3 cards and avoids showing the same game twice.
  const cards = GAMES.filter(g => g.id !== excludeId);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      {cards.map(g => (
        <button key={g.id} onClick={() => onPlayGame(g.id)} style={{
          position: "relative", overflow: "hidden", borderRadius: 14, border: "none", padding: 0, textAlign: "left",
          background: g.bg, cursor: "pointer",
          boxShadow: `0 8px 18px -8px ${g.glow}88`,
        }}>
          <div style={{ height: 70, position: "relative" }}>
            {typeof g.art === "string" ? (
              <img src={g.art} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", padding: 8 }} />
            ) : (
              <div style={{ position: "absolute", inset: 0, padding: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>{g.art}</div>
            )}
          </div>
          {/* Text panel · subtitle wraps to 2 lines on narrow screens so
              full copy stays readable on every device. minHeight keeps the
              row even when one card's subtitle wraps and another's doesn't. */}
          <div style={{ padding: "8px 10px 10px", background: "rgba(0,0,0,0.35)", minHeight: 56, display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
            <div style={{ fontFamily: T.display, fontSize: 12, color: "#fff", lineHeight: 1.1 }}>{g.title}</div>
            <div style={{
              fontFamily: T.body, fontSize: 8.5, color: "rgba(255,255,255,0.6)", fontWeight: 700,
              marginTop: 3, lineHeight: 1.3,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{g.subtitle}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// Real daily-missions surface. Mirrors main's wiring exactly:
//   • GET /api/missions/today/{address} → { missions[], secondsUntilReset }
//   • POST /api/missions/claim → marks claimed, refetches
// Per-mission state machine: in-progress (purple bar) → ready (gold +
// CLAIM button) → claimed (green ✓ CLAIMED, dimmed). All three missions
// show together so a player who's done one can see what's left.
type ApiMission = { id: number; missionId: string; label: string; progress: number; target: number; completed: boolean; claimed: boolean; rewardXp: number };
const MISSIONS_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

function fmtMissionCountdown(s: number) {
  if (s <= 0) return "Resetting…";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function MissionCard({ connected, onConnect }: { connected: boolean; onConnect: () => void }) {
  const { address } = useAccount();
  const [missions, setMissions] = useState<ApiMission[] | null>(null);
  const [resetSec, setResetSec] = useState(0);
  const [claimingId, setClaimingId] = useState<number | null>(null);

  const refetch = () => {
    if (!address) { setMissions(null); return; }
    fetch(`${MISSIONS_BACKEND_URL}/api/missions/today/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setMissions([]); return; }
        setMissions(d.missions || []);
        setResetSec(Number(d.secondsUntilReset ?? 0));
      })
      .catch(() => setMissions([]));
  };

  useEffect(() => { if (connected) refetch(); else setMissions(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [connected, address]);

  // Live countdown — ticks down once per second so the player sees the
  // reset window shrink in real time instead of a static stamp.
  useEffect(() => {
    if (!connected || resetSec <= 0) return;
    const t = setInterval(() => setResetSec(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [connected, resetSec]);

  const claim = async (id: number) => {
    if (!address || claimingId !== null) return;
    setClaimingId(id);
    try {
      // Backend expects { wallet, missionId } · sending walletAddress/
      // missionDbId returned 400 "Missing wallet or missionId" so claims
      // silently failed and the row stayed in CLAIM-able state forever.
      await fetch(`${MISSIONS_BACKEND_URL}/api/missions/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, missionId: id }),
      });
    } catch { /* fall through to refetch — server is the source of truth */ }
    setClaimingId(null);
    refetch();
  };

  // ── GUEST · single CTA tile, no fake missions ─────────────────────────
  if (!connected) {
    return (
      <button onClick={onConnect} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderRadius: 15, background: T.surface, border: `1px solid ${T.hairline}`, cursor: "pointer", textAlign: "left" }}>
        <div style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0, background: "rgba(167,139,250,0.16)", border: "1px solid rgba(167,139,250,0.4)", display: "flex", alignItems: "center", justifyContent: "center", color: "#a78bfa" }}>
          <Icon name="target" size={16} color="currentColor" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.body, fontSize: 10, color: T.accent, fontWeight: 800, letterSpacing: "0.12em" }}>DAILY MISSIONS</div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.ink, fontWeight: 700, marginTop: 2 }}>Sign in for missions</div>
        </div>
        <Icon name="chev" size={15} color={T.inkSoft} />
      </button>
    );
  }

  // ── CONNECTED · full list ─────────────────────────────────────────────
  const allClaimed = missions !== null && missions.length > 0 && missions.every(m => m.claimed);

  return (
    <div style={{ borderRadius: 16, background: T.surface, border: `1px solid ${T.hairline}`, overflow: "hidden" }}>
      {/* Header · reset countdown lives on the right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.hairline}` }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 24, height: 24, borderRadius: 8, background: "rgba(167,139,250,0.16)", border: "1px solid rgba(167,139,250,0.4)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#a78bfa" }}>
            <Icon name="target" size={13} color="currentColor" />
          </span>
          <span style={{ fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.14em", color: T.inkDim, textTransform: "uppercase" }}>Daily missions</span>
        </div>
        {resetSec > 0 && (
          <span style={{ fontFamily: "ui-monospace, SF Mono, Menlo, monospace", fontSize: 10, fontWeight: 800, color: "#fde68a", textShadow: "0 0 6px rgba(251,191,36,0.5)" }}>
            {fmtMissionCountdown(resetSec)}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {missions === null ? (
          <div style={{ padding: "14px 6px", textAlign: "center", color: T.inkSoft, fontSize: 11, fontWeight: 700 }}>Loading…</div>
        ) : missions.length === 0 ? (
          <div style={{ padding: "14px 6px", textAlign: "center", color: T.inkSoft, fontSize: 11, fontWeight: 700 }}>No missions today. Check back tomorrow.</div>
        ) : (
          missions.map(m => {
            const pct = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
            const ready = m.completed && !m.claimed;
            const done = m.claimed;
            const barColor = done ? "#22c55e" : ready ? "#fbbf24" : T.accent;
            const tileBg = done
              ? "linear-gradient(180deg, rgba(34,197,94,0.08) 0%, rgba(0,0,0,0.18) 100%)"
              : ready
                ? "linear-gradient(180deg, rgba(251,191,36,0.16) 0%, rgba(0,0,0,0.18) 100%)"
                : "rgba(255,255,255,0.03)";
            const border = `1px solid ${done ? "rgba(34,197,94,0.45)" : ready ? "rgba(251,191,36,0.6)" : T.hairline}`;
            return (
              <div key={m.id} style={{
                borderRadius: 12,
                background: tileBg,
                border,
                boxShadow: ready ? "0 0 14px rgba(251,191,36,0.32)" : "none",
                padding: "10px 11px",
                display: "flex", flexDirection: "column", gap: 6,
                opacity: done ? 0.7 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: T.body, fontSize: 11.5, fontWeight: 700, color: T.ink, lineHeight: 1.3 }}>{m.label}</div>
                  <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 900, color: "#fde68a", whiteSpace: "nowrap", flexShrink: 0 }}>+{m.rewardXp} XP</div>
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 700 }}>{m.progress} / {m.target}</span>
                    <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 700 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: "rgba(0,0,0,0.45)", overflow: "hidden", border: "1px solid rgba(167,139,250,0.1)" }}>
                    <div style={{
                      width: `${pct}%`, height: "100%", borderRadius: 999,
                      background: barColor,
                      boxShadow: ready ? "0 0 6px rgba(251,191,36,0.6)" : "none",
                      transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                    }} />
                  </div>
                </div>
                {done ? (
                  <div style={{ textAlign: "center", color: "#22c55e", fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em" }}>✓ CLAIMED</div>
                ) : ready ? (
                  <button
                    onClick={() => claim(m.id)}
                    disabled={claimingId === m.id}
                    style={{
                      cursor: claimingId === m.id ? "wait" : "pointer",
                      borderRadius: 9,
                      padding: "6px 10px",
                      background: "linear-gradient(180deg, #fbbf24 0%, #b45309 100%)",
                      border: "1px solid rgba(255,255,255,0.4)",
                      boxShadow: "inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 3px rgba(0,0,0,0.3), 0 6px 14px -4px rgba(251,191,36,0.6)",
                      color: "#fff",
                      fontFamily: T.body, fontSize: 11, fontWeight: 900, letterSpacing: "0.14em",
                      textShadow: "0 1px 2px rgba(0,0,0,0.4)",
                    }}
                  >{claimingId === m.id ? "CLAIMING…" : `CLAIM +${m.rewardXp} XP`}</button>
                ) : null}
              </div>
            );
          })
        )}
        {allClaimed && (
          <div style={{ padding: "8px 6px 2px", textAlign: "center", fontFamily: T.body, fontSize: 10.5, color: "#86efac", fontWeight: 700 }}>
            ✦ All missions claimed · new set in {fmtMissionCountdown(resetSec)}
          </div>
        )}
      </div>
    </div>
  );
}

function ClimbCard({ connected, dash, address, onConnect, router }: {
  connected: boolean;
  dash: DashData | null;
  address: string | null;
  onConnect: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const inEvent = connected && address && dash?.climb && dash.climb.rank > 0;
  return (
    <button onClick={() => connected ? router.push("/games/challenge-ai") : onConnect()} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderRadius: 15, background: "linear-gradient(135deg, rgba(251,191,36,0.12), rgba(180,83,9,0.28))", border: "1px solid rgba(251,191,36,0.35)", cursor: "pointer", textAlign: "left" }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>🏆</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.body, fontSize: 9, color: "#fde68a", fontWeight: 800, letterSpacing: "0.12em" }}>{climbPillLabel(dash?.climb ?? null)}</div>
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.ink, fontWeight: 700, marginTop: 2 }}>
          {inEvent
            ? `You're #${dash!.climb!.rank} · ${dash!.climb!.matches} matches`
            : connected
              ? "Play MARKOV to enter · $5 USDC + 1,000 G$ pool"
              : "Sign in to enter · $5 USDC + 1,000 G$ pool"}
        </div>
      </div>
      <Icon name="chev" size={15} color={T.inkSoft} />
    </button>
  );
}

