"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import HomeGames from "@/components/home/HomeGames";
import { useAccount, useReadContract } from "wagmi";
import { celo } from "viem/chains";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import { fetchAllTimeLeaderboard, fetchPlayerAllTimeCombinedStats, type AllTimeEntry, type GameTypeId } from "@/lib/subgraph";
import { fetchPreview } from "@/lib/leaderboardPreview";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useSignMessage } from "wagmi";
import { claimMission, claimMissionMiniPay } from "@/app/actions/missions";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import CupCountdown from "@/components/CupCountdown";
import { cupIsStaleNow } from "@/lib/cup";

// ─── tokens (kept in sync with /home + Onboarding) ───────────────────────
const T = {
  bg: "linear-gradient(180deg, #f3eeff 0%, #e6dcff 100%)",
  ink: "#22104f",
  inkDim: "rgba(34,16,79,0.68)",
  inkSoft: "rgba(34,16,79,0.66)",
  surface: "#ffffff",
  hairline: "rgba(76,29,149,0.14)",
  hairlineHi: "rgba(76,29,149,0.24)",
  accent: "#6d28d9",
  gap: 12,
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// One calm colour for the greeting stat pills — informative, not a rainbow.
const PILL_MUTED = "#6d28d9";

// The page itself is light lilac; T above stays the palette for the deep-purple
// cards that sit on it (daily claim, missions, vote, rank, activity).
const P = {
  bg: "linear-gradient(180deg, #f3eeff 0%, #e6dcff 100%)",
  ink: "#22104f",
  dim: "rgba(34,16,79,0.62)",
  line: "rgba(76,29,149,0.14)",
  accent: "#6d28d9",
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
      <span style={{ fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: P.dim, textTransform: "uppercase" }}>{children}</span>
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
  weekly?: WeeklyInfo; // live numbers for the "weekly" hero
  kind?: "event" | "aimode" | "tug" | "weekly"; // "event" → Arena Cup gold teaser (its copy is
                                     // hardcoded, so it is NOT a generic event slide)
                                     // "aimode" → cyan AI feature-drop
                                     // "tug"    → Verified Tug of War
};

// AI-mode feature drop — the discovery surface for the new "build your own AI"
// mode, which otherwise only lives on the buried YOU/YOUR AI switch inside the
// Challenge lobby and a menu row. Leads the hero rotation so every player sees
// it. Powered by GoodAgents (the deploy widget is theirs), so credited here.
const AI_HERO: Game = {
  id: "aimode",
  kind: "aimode",
  title: "Build your AI. Fight MARKOV.",
  subtitle: "New mode",
  desc: "Deploy your own AI agent and watch it climb the ladder against MARKOV.",
  art: "/ai-vs-markov.png",
  bg: "linear-gradient(150deg, #0b3b52 0%, #241466 58%, #170a3e 100%)",
  glow: "#0e7490",
  active: true,
  href: "/games/challenge-ai",
};

// Upcoming prize event — leads the hero rotation as a gold slide. $150 Top-5
// G$ pool. GoodAgents supports the pool (their contribution folds in), credited
// as a supporter, not the headline — this is the normal competition, not an
// AI/agents event. Routes to the events/leaderboard page.
// RETIRED — the $150 Challenge ran 2026-04-28 → 2026-05-01 and is over.
// Not referenced by heroList any more; kept only as the shape to copy if a
// fixed-prize event returns. Wire any revival to /api/challenge's live window,
// never to a hardcoded subtitle.
const EVENT_HERO: Game = {
  id: "event",
  kind: "event",
  title: "$150 Event",
  subtitle: "Coming soon",
  desc: "Top 5 players split $150, paid in G$. Keep playing to lock a spot.",
  art: "/event-prize.png",
  bg: "linear-gradient(115deg, #7c3a0d 0%, #2a1266 55%, #170a3e 100%)",
  glow: "#f59e0b",
  active: true,
  href: "/leaderboard",
};

// Tug of War lives in the hero rail from the day it is announced, not from the
// day it starts. The pre-event window is when a player has to get VERIFIED —
// the bounty is first-come and a first-ever GoodDollar check is a real face
// scan, so anyone who turns up on day one unverified has already lost slots.
// The weekly community challenge, as the server reports it right now. The hero
// that leads the home screen is built from this and nothing else, so it can
// never show an event that has ended: the last two event heroes were constants,
// and both stayed on the busiest screen for months after their events closed.
interface WeeklyInfo { target: number; progress: number; playersIn: number; hit: boolean; daysLeft: number; rewardG: number; capPerPlayer: number; perGameG: number; myContribution: number | null; myProjectedG: number | null }
function weeklyHero(w: WeeklyInfo): Game {
  return {
    id: "weekly",
    title: "This week's challenge",
    subtitle: `${w.daysLeft} day${w.daysLeft === 1 ? "" : "s"} left`,
    desc: `Every game you finish earns ${w.perGameG} G$ once we reach ${w.target.toLocaleString()} games together.`,
    art: "/event-prize.png",
    bg: "linear-gradient(115deg, #78350f 0%, #2a1266 55%, #14532d 100%)",
    glow: "#b45309",
    active: true,
    href: "/leaderboard",
    kind: "weekly",
    weekly: w,
  };
}

const TUG_HERO: Game = {
  id: "tug",
  title: "Tug of War",
  subtitle: "Starts Wednesday",
  desc: "Two sides, one rope, 1,000,000 G$. First 160 verified players get 2,500 G$ guaranteed.",
  art: "/event-prize.png",
  bg: "linear-gradient(115deg, #7f1d1d 0%, #2a1266 52%, #0e7490 100%)",
  glow: "#dc2626",
  active: true,
  href: "/tug",
  kind: "tug",
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

// The 3D games lead with a real picture of the game, not an illustration:
// seeing the street or the bottles tells a new player what they are about to
// play faster than any drawing. Covers are captured from live play.
const COVERS: Record<string, { src: string; focus: string }> = {
  upnepa3d: { src: "/games/covers/upnepa3d.jpg", focus: "58% 45%" },
  streetstrike: { src: "/games/covers/streetstrike.jpg", focus: "50% 55%" },
  stack: { src: "/games/covers/stack.jpg", focus: "50% 60%" },
  rhythm: { src: "/games/covers/rhythm.jpg", focus: "50% 40%" },
  simon: { src: "/games/covers/simon.jpg", focus: "50% 45%" },
  arena: { src: "/games/covers/challenge-ai.jpg", focus: "50% 55%" },
};
const GAMES_3D: Game[] = [
  {
    id: "upnepa3d", title: "UP NEPA 3D", subtitle: "Lagos street · 2 modes",
    desc: "NEPA don take light. Run the street, flip the breakers and bring the whole area back.",
    art: "/games/covers/upnepa3d.jpg", bg: "#0b0c12", glow: "#b45309", active: true, href: "/world", isNew: true,
  },
  {
    id: "streetstrike", title: "Street Strike", subtitle: "3D bowling · tyre and bottles",
    desc: "Roll the tyre down the road and scatter the bottles while the whole street watches.",
    art: "/games/covers/streetstrike.jpg", bg: "#0b0c12", glow: "#a855f7", active: true, href: "/bowling", isNew: true,
  },
];

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
    id: "arena", title: "Challenge AI", subtitle: "Outsmart MARKOV · or send your own AI",
    art: "/games/challenge-ais.png", bg: "linear-gradient(155deg, #14532d 0%, #064e3b 55%, #022c22 100%)", glow: "#22c55e",
    desc: "Beat the AI that learns your patterns — or deploy your own AI to fight it. Free, weekly ladder.", active: true, href: "/games/challenge-ai",
    isNew: true,
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
  // Signed in, never minted — needs FINISH SETUP, not another "sign in".
  const authedUnminted = (authenticated || isMiniPay) && !!address && hasMinted === false;
  // Unknown mint state = loading, not guest — don't flash the sign-in
  // banner at players whose wallet is still hydrating.
  const identityResolving = (authenticated || isMiniPay) && (!address || hasMinted === undefined);
  // UBI claim is GoodDollar's, gated only by GoodDollar's OWN whitelist
  // (the ClaimCard checks isVerified internally). Requiring a GamePass
  // mint on top is redundant friction that blocks verified humans from
  // their UBI · a whitelisted wallet reaching the dashboard via free
  // play should claim without minting anything. GamePass still gates OUR
  // features (scores, leaderboards, pools); it does not gate UBI.
  const walletReady = (authenticated || isMiniPay) && !!address;
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
    const id = setInterval(() => { if (!document.hidden) void load(); }, 60_000) /* a tab nobody is looking at does not need fresh data */;
    return () => { cancelled = true; clearInterval(id); };
  }, [connected, address]);

  const onPlayGame = async (id: string) => {
    // The event hero isn't a game — it routes to the Arena Cup board.
    if (id === "event") { router.push("/leaderboard/cup"); return; }
    // The AI-mode hero routes into the Challenge lobby, where the YOU/YOUR AI
    // switch and the deploy-on-GoodAgents CTA both live.
    if (id === "aimode") { router.push("/games/challenge-ai"); return; }
    // The weekly challenge counts every game, so its button goes straight into
    // the game most people here play. The full board is one tap away on the card.
    if (id === "weekly") { router.push("/games/stack"); return; } // opens the game; the player starts it
    // 3D games open straight into their own world.
    const world = GAMES_3D.find(x => x.id === id);
    if (world) { router.push(world.href); return; }
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
    // Open the game at once. This used to wait a fixed 600 ms on every tap so the
    // loading card could be seen, then wait again for the leaderboard preview.
    // A wait the player can feel is never worth a prettier loading card. The
    // preview is still fetched; it just no longer holds the door.
    if (gameType !== null) fetchPreview(gameType).catch(() => null);

    router.push(g.href);
    // Overlay stays mounted until the route change unmounts the page ·
    // clearing here would cause a brief blank flash.
  };
  // Always route Sign-in / Connect taps to /home — that's the canonical
  // entry point where the Privy modal lives + the onboarding overlay
  // takes over for first-time signers. Opening the Privy modal directly
  // from a feed-style screen drops players into a disconnected popup
  // with no surrounding context.
  const onConnect = () => router.push("/home?signin=1"); // opens the sign-in directly
  // Hero rotation · every game flagged isNew takes a turn as the banner
  // (Stack Tower launch + the Challenge AI rebuild). Crossfades every 6s;
  // falls back to the first game when nothing is flagged.
  const heroes = GAMES.filter(g => g.isNew);
  // Event teaser leads the rotation, then the new-game heroes cycle after it.
  // EVENT_HERO deliberately removed from the rail: it is hardcoded to the $150
  // Challenge, which ended 2026-05-01 (backend CHALLENGE_END, /api/challenge
  // reports active:false) yet still rendered "Coming soon" four months later.
  // A dead promise on the app's busiest surface costs more trust than an empty
  // slot. If a fixed-prize event runs again, drive this from /api/challenge
  // rather than a constant so it can never outlive its own window again.
  // What leads the home screen, in order:
  //   1. this week's challenge, when the server says one is running. It is the
  //      one thing that has reliably brought players back.
  //   2. Stack Tower. It is more than half of all games played here.
  //   3. the 3D games, MARKOV, then anything else flagged new.
  // TUG_HERO is gone from the rail: Tug of War ended on 30 September and the
  // card still said "Starts Wednesday".
  const [weekly, setWeekly] = useState<WeeklyInfo | null>(null);
  const [today, setToday] = useState<null | "claim" | "missions" | "vote" | "cup">(null);
  const { address: heroAddress } = useAccount();
  useEffect(() => {
    let live = true;
    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    fetch(`${backend}/api/weekly-challenge${heroAddress ? `?wallet=${heroAddress.toLowerCase()}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && typeof d.target === "number" && d.target > 0 && typeof d.daysLeft === "number") setWeekly(d as WeeklyInfo); })
      .catch(() => { /* no card is better than a wrong card */ });
    return () => { live = false; };
  }, [heroAddress]);
  // Fetch the 2D games' code while the player is still looking at this screen,
  // so the game opens the moment they tap. The 3D worlds are left out: they are
  // large, and fetching them unasked would cost data on a phone.
  useEffect(() => {
    const t = setTimeout(() => { for (const href of ["/games/stack", "/games/simon", "/games/rhythm", "/games/challenge-ai"]) router.prefetch(href); }, 1200);
    return () => clearTimeout(t);
  }, [router]);
  const stack = GAMES.find((g) => g.id === "stack") ?? GAMES[0];
  const heroList = [...(weekly ? [weeklyHero(weekly)] : []), stack, ...GAMES_3D, AI_HERO, ...heroes.filter((g) => g.id !== stack.id)];
  const [heroIdx, setHeroIdx] = useState(0);
  // Manual interactions (dot tap / swipe) bump this to restart the timer —
  // auto-advance snatching the banner right after a swipe feels broken.
  const [heroBump, setHeroBump] = useState(0);
  const goToHero = useCallback((i: number) => {
    setHeroIdx((cur) => {
      const len = heroList.length;
      return ((typeof i === "number" ? i : cur) % len + len) % len;
    });
    setHeroBump((b) => b + 1);
  }, [heroList.length]);
  // The first slide always leads. It used to be picked at random, which gave
  // the week's event the front of the home screen one visit in six. When the
  // weekly card arrives (it loads a moment after the page) the rail returns to it.
  useEffect(() => { if (weekly) setHeroIdx(0); }, [weekly]);
  // Slides advance on their own. The weekly card holds twice as long: it has
  // numbers to read and a button to press, and six seconds took it away first.
  const onWeekly = !!weekly && heroIdx % heroList.length === 0;
  useEffect(() => {
    if (heroList.length < 2) return;
    const t = setTimeout(() => setHeroIdx(i => (i + 1) % heroList.length), onWeekly ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [heroList.length, heroBump, heroIdx, onWeekly]);

  return (
    <div style={{
      minHeight: "100vh", width: "100%",
      background: P.bg,
      color: P.ink,
      fontFamily: T.body,
    }}>
      {/* Persistent header — full-viewport sticky band; content centers itself
          inside. The band carries the dark glass, the content sits on the
          page's column. */}
      <AppHeader tone="light" />


      <div style={{ maxWidth: 1180, margin: "0 auto", padding: isDesktop ? "22px 32px 70px" : "14px 16px 110px", display: "flex", flexDirection: "column", gap: T.gap + 8 }}>

        {/* Greeting — one quiet line so the hero (and the event) leads. Pills
            share a single muted style: informative, not a rainbow. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: T.display, fontSize: isDesktop ? 22 : 18, color: P.ink, lineHeight: 1 }}>
            {connected ? `Welcome back, ${username || "Player"}` : "Welcome"} <span style={{ fontSize: isDesktop ? 17 : 15 }}>👋</span>
          </div>
          {connected && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {/* Live streak · "🔥 New" reads warmer than "0-day streak". */}
              <Pill color={PILL_MUTED}>🔥 {userMeta && userMeta.streak > 0 ? `${userMeta.streak}d` : "New"}</Pill>
              <Pill color={PILL_MUTED}>LV {userMeta?.level ?? 1}</Pill>
              {me && me.peak > 0 && <Pill color={PILL_MUTED}>PEAK {me.peak}</Pill>}
            </div>
          )}
        </div>

        {/* The home screen is the games. One Play button, one line for this
            week's challenge, then the gallery (components/home/HomeGames.tsx).
            The same layout serves every screen size. */}
        <HomeGames weekly={weekly} display={T.display} />

        {/* The sign-in nudge sits under the games now. Above them it pushed the
            first row of games off a phone's screen. */}
        {!connected && !identityResolving && (
          <GuestBanner needsSetup={authedUnminted} onConnect={authedUnminted ? () => router.push("/home?ob=1") : onConnect} />
        )}

        {/* Everything that is not a game waits behind four chips, so the page
            stays one screen long. A chip opens its card right here. */}
        <VerificationExpiryBanner router={router} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }} role="tablist" aria-label="Today">
          {([["claim", "🎁 Daily G$"], ["missions", "🎯 Missions"], ["vote", "🗳️ Vote"], ["cup", "🏆 Your rank"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={today === id} onClick={() => setToday(today === id ? null : id)} style={{
              cursor: "pointer", padding: "9px 14px", borderRadius: 999, fontFamily: T.body, fontSize: 13, fontWeight: 800,
              color: today === id ? "#fff" : P.ink, background: today === id ? P.accent : "#fff",
              border: `1px solid ${today === id ? P.accent : P.line}`, boxShadow: "0 8px 18px -14px rgba(76,29,149,0.6)", transition: "background .18s ease, color .18s ease",
            }}>{label}</button>
          ))}
        </div>
        {today === "claim" && <ClaimCard connected={walletReady} onConnect={onConnect} router={router} />}
        {today === "missions" && <MissionCard connected={connected} onConnect={onConnect} />}
        {today === "vote" && <VoteCard connected={walletReady} onConnect={onConnect} router={router} />}
        {today === "cup" && <ClimbCard connected={connected} dash={dash} address={address ?? null} onConnect={onConnect} router={router} />}

        {(() => {
          const feed = buildFeed(dash, me, connected);
          return feed.length ? (
            <>
              <SectionLabel action={<ViewAll onClick={() => router.push("/leaderboard")} />}>Live activity</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 6 }}>
                {feed.slice(0, 3).map((it, i) => <FeedRow key={i} item={it} />)}
              </div>
            </>
          ) : null;
        })()}
      </div>

      {/* Bottom nav — Home / Play / Events / Pet per CLAUDE.md IA. Renders
          as a floating pill on desktop and a full-width bar on mobile. */}
      <AppBottomNav wide={isDesktop} tone="light" />

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

function DashLeft({ connected, onPlayGame, router, heroes, heroActive, onHeroDot, dash, me }: {
  connected: boolean;
  onPlayGame: (id: string) => void;
  router: ReturnType<typeof useRouter>;
  heroes: (typeof GAMES[number])[];
  heroActive: number;
  onHeroDot: (i: number) => void;
  dash: DashData | null;
  me: { rank: number; peak: number } | null;
}) {
  const feed = buildFeed(dash, me, connected);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <HeroCarousel heroes={heroes} active={heroActive} onPlayGame={onPlayGame} onDot={onHeroDot} />
      <SectionLabel action={<ViewAll onClick={() => router.push("/games")} />}>Games</SectionLabel>
      <GamesGrid onPlayGame={onPlayGame} />
      <SectionLabel action={<ViewAll onClick={() => router.push("/leaderboard")} />}>Live activity</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {feed.length ? feed.slice(0, 5).map((it, i) => <FeedRow key={i} item={it} />) : (
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, padding: "6px 4px" }}>Nothing happening yet — play a game to be first.</div>
        )}
      </div>
    </div>
  );
}

function DashRight({ connected, walletReady, dash, address, onConnect, router }: {
  connected: boolean;
  walletReady: boolean;
  dash: DashData | null;
  me: { rank: number; peak: number } | null;
  address: string | null;
  onConnect: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ClaimCard connected={walletReady} onConnect={onConnect} router={router} />
      <VoteCard connected={walletReady} onConnect={onConnect} router={router} />
      <SectionLabel action={<ViewAll onClick={() => router.push("/leaderboard")} />}>Your cup</SectionLabel>
      <ClimbCard connected={connected} dash={dash} address={address} onConnect={onConnect} router={router} />
      <SectionLabel>Daily missions</SectionLabel>
      <MissionCard connected={connected} onConnect={onConnect} />
    </div>
  );
}

// ─── blocks ─────────────────────────────────────────────────────────────
// Slim "you're playing free" strip with a Sign in chip · design pattern.
function GuestBanner({ onConnect, needsSetup }: { onConnect: () => void; needsSetup?: boolean }) {
  // Two truths, one strip: guests need to SIGN IN; signed-in players who
  // never finished onboarding need to FINISH SETUP. Telling the second
  // group to "sign in" reads as "your sign-in didn't work".
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 20,
      background: "#fff",
      border: needsSetup ? "1px solid rgba(217,119,6,0.45)" : `1px solid ${P.line}`,
      boxShadow: "0 16px 34px -26px rgba(76,29,149,0.7)",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>{needsSetup ? "🐣" : "🎁"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: T.body, fontSize: 13, color: P.ink, fontWeight: 800, lineHeight: 1.3 }}>
          {needsSetup ? "You're signed in." : "You're playing free."}
        </span>
        <span style={{ fontFamily: T.body, fontSize: 13, color: P.dim, lineHeight: 1.3 }}>
          {needsSetup
            ? " Name your slime to save scores & win G$."
            : " Sign in to win G$, save your pet & climb the board."}
        </span>
      </div>
      <button onClick={onConnect} style={{
        flexShrink: 0, padding: "9px 16px", borderRadius: 999, cursor: "pointer",
        background: needsSetup ? "#b45309" : P.accent, border: "none",
        color: needsSetup ? "#231005" : "#fff", fontFamily: T.body, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em",
        boxShadow: needsSetup ? "0 4px 12px -3px rgba(251,191,36,0.7)" : "0 8px 16px -8px rgba(109,40,217,0.9)",
      }}>{needsSetup ? "FINISH SETUP" : "SIGN IN"}</button>
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
      icon: "🏆", color: "#6d28d9",
      title: connected && dash.climb.rank > 0
        ? `You're #${dash.climb.rank} in MARKOV Climb`
        : "MARKOV Climb is live",
      sub: `${daysLeft === 1 ? "Final day" : `${daysLeft} days left`} · $5 USDC + 1,000 G$ pool`,
      tag: connected && dash.climb.rank > 0 ? "YOU" : "OPEN",
      tagColor: connected && dash.climb.rank > 0 ? "#b45309" : "#15803d",
    });
  }

  const topScorer = dash.top3[0];
  if (topScorer) {
    const name = topScorer.username || `${topScorer.player.slice(0, 6)}…${topScorer.player.slice(-4)}`;
    out.push({
      icon: "🥁", color: "#6d28d9",
      title: `@${name.replace(/^@/, "")} leads the boards`,
      sub: `${topScorer.score} pts combined · beat them`,
    });
  }

  if (dash.totalMatches > 0) {
    out.push({
      icon: "🌍", color: "#6d28d9",
      title: `${dash.totalPlayers} players · ${dash.totalMatches.toLocaleString()} matches`,
      sub: "Live community total · all-time",
    });
  }

  if (me && me.rank > 0) {
    out.push({
      icon: "💎", color: "#6d28d9",
      title: `You're #${me.rank} all-time`,
      sub: "Keep playing to climb",
      tag: "YOU", tagColor: "#0e7490",
    });
  }

  return out;
}

function ViewAll({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} style={{ fontFamily: T.body, fontSize: 10, color: P.accent, fontWeight: 800, letterSpacing: "0.08em", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>VIEW ALL ›</button>;
}

// G$ claim card — mirrors the main-branch profile pattern exactly:
//   1. Not signed in  → "Sign in to claim" → /home
//   2. whitelist still resolving → dimmed "Checking..." placeholder
//   3. !isVerified    → "Verify to unlock" → /verify
//   4. entitlement>0  → "Claim X G$" CTA  → triggers claimG$() inline
//   5. else (verified, no entitlement) → "Claimed today" dimmed
// Step 2 exists so a verified player never sees "Verify to unlock" flash
// before the on-chain read lands. A cache hit (gd_verified_<addr> in
// localStorage) resolves it before paint for returning players; cold-start
// users see the placeholder for a beat instead of a wrong CTA.
// ─── Verification expiry warning ─────────────────────────────────────────────
// GoodDollar expires a player's FIRST verification after 3 days; the second one
// lasts 180. Players were never told, so they simply stopped counting as
// verified — 313 of 752 are currently lapsed. This is the in-app half of the
// warning (the cron sends the push / bell notification); it only appears inside
// the last day, and only to someone who still has something to lose.
function VerificationExpiryBanner({ router }: { router: ReturnType<typeof useRouter> }) {
  const { isVerified, isVerificationResolved, identityExpiry } = useSelfVerification();
  if (!isVerificationResolved || !isVerified) return null;
  if (!identityExpiry.expiresAt || identityExpiry.daysLeft > 1) return null;
  return (
    <button
      onClick={() => router.push(`/verify?next=${encodeURIComponent("/dashboard")}`)}
      style={{
        width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 14, cursor: "pointer",
        background: "linear-gradient(135deg, rgba(251,191,36,0.16), rgba(120,53,15,0.35))",
        border: "1px solid rgba(251,191,36,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }}>🪪</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.body, fontSize: 10, color: "#b45309", fontWeight: 800, letterSpacing: "0.12em" }}>
            {identityExpiry.daysLeft <= 0 ? "EXPIRES TODAY" : "EXPIRES TOMORROW"}
          </div>
          <div style={{ fontFamily: T.display, fontSize: 15, color: T.ink, marginTop: 1 }}>Keep your verification</div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 600, marginTop: 2 }}>
            One 30-second check — this time it lasts 180 days.
          </div>
        </div>
        <Icon name="chev" size={16} color={T.inkSoft} />
      </div>
    </button>
  );
}

function ClaimCard({ connected, onConnect, router }: { connected: boolean; onConnect: () => void; router: ReturnType<typeof useRouter> }) {
  const { isVerified, isVerificationResolved, hasLapsed, entitlement, claimG$ } = useSelfVerification();
  const [claiming, setClaiming] = useState(false);

  if (!connected) {
    return (
      <button onClick={onConnect} style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 16, background: `linear-gradient(135deg, ${T.accent}1f, #ffffff)`, border: `1px solid ${T.accent}55`, cursor: "pointer" }}>
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

  // Whitelist read hasn't answered yet — show a neutral placeholder rather
  // than guessing "unverified" and flipping a beat later.
  if (!isVerificationResolved) {
    return (
      <div style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 16, background: "rgba(20,10,50,0.4)", border: `1px solid ${T.hairline}`, opacity: 0.6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 999, background: "rgba(134,239,172,0.12)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.12em" }}>FREE DAILY G$</div>
            <div style={{ fontFamily: T.display, fontSize: 16, color: T.inkSoft, marginTop: 1 }}>Checking…</div>
          </div>
        </div>
      </div>
    );
  }

  if (!isVerified) {
    return (
      <button onClick={() => router.push(`/verify?next=${encodeURIComponent("/dashboard")}`)} style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 16, background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(20,83,45,0.45) 100%)", border: "1px solid rgba(134,239,172,0.4)", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 999, background: "radial-gradient(circle at 35% 35%, #fde68a, #b45309)", boxShadow: "0 0 12px rgba(251,191,36,0.6)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.body, fontSize: 10, color: hasLapsed ? "#b45309" : "#15803d", fontWeight: 800, letterSpacing: "0.12em" }}>
              {hasLapsed ? "CHECK EXPIRED" : "FREE DAILY G$"}
            </div>
            <div style={{ fontFamily: T.display, fontSize: 18, color: T.ink, marginTop: 1 }}>
              {hasLapsed ? "Re-check to keep claiming" : "Verify to unlock"}
            </div>
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
          <span style={{ width: 30, height: 30, borderRadius: 999, background: "radial-gradient(circle at 35% 35%, #4b3a05, #1a1305)", display: "flex", alignItems: "center", justifyContent: "center", color: "#15803d", fontSize: 16 }}>✓</span>
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
          <div style={{ fontFamily: T.body, fontSize: 10, color: "#15803d", fontWeight: 800, letterSpacing: "0.12em" }}>FREE DAILY G$</div>
          <div style={{ fontFamily: T.display, fontSize: 18, color: T.ink, marginTop: 1 }}>{claiming ? "Claiming…" : `Claim ${amount} G$`}</div>
        </div>
        {!claiming && <Icon name="chev" size={16} color={T.inkSoft} />}
      </div>
    </button>
  );
}

// VoteCard · surfaces the GoodBuilders community vote as a funnel. Same
// button-card idiom as ClaimCard, purple accent so it reads distinct from
// the green claim card. Adapts to the player's state so it's a reason to
// sign in + verify, not just something verified players see:
//   guest        → "Sign in to vote"  → onboarding
//   unverified   → "Verify to vote"   → /verify
//   verified     → "Vote for GameArena" → /vote
function VoteCard({ connected, onConnect, router }: { connected: boolean; onConnect: () => void; router: ReturnType<typeof useRouter> }) {
  const { isVerified } = useSelfVerification();
  const state = !connected ? "guest" : !isVerified ? "unverified" : "ready";
  const title = state === "guest" ? "Sign in to vote" : state === "unverified" ? "Verify to vote" : "Vote for GameArena";
  const onClick =
    state === "guest" ? onConnect
    : state === "unverified" ? () => router.push(`/verify?next=${encodeURIComponent("/vote")}`)
    : () => router.push("/vote");
  return (
    <button onClick={onClick} style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 16, background: `linear-gradient(135deg, ${T.accent}1f, #ffffff)`, border: `1px solid ${T.accent}55`, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 999, background: `radial-gradient(circle at 35% 35%, ${T.accent}, #4c1d95)`, boxShadow: `0 0 12px ${T.accent}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🗳️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.body, fontSize: 10, color: T.accent, fontWeight: 800, letterSpacing: "0.12em" }}>COMMUNITY VOTE</div>
          <div style={{ fontFamily: T.display, fontSize: 16, color: T.ink, marginTop: 1 }}>{title}</div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, marginTop: 2 }}>Back GameArena · grow the prize pools</div>
        </div>
        <Icon name="chev" size={16} color={T.inkSoft} />
      </div>
    </button>
  );
}

function HeroCarousel({ heroes, active, onPlayGame, onDot }: {
  heroes: (typeof GAMES[number])[];
  active: number;
  onPlayGame: (id: string) => void;
  onDot: (i: number) => void;
}) {
  // Swipe navigation: horizontal drag > 48px flips a slide. A swipe that
  // ends on the card must NOT count as a tap — capture-phase click guard.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) { touch.current = { x: t.clientX, y: t.clientY }; swiped.current = false; }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current; touch.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiped.current = true;
      onDot(active + (dx < 0 ? 1 : -1));
    }
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; }
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClickCapture={onClickCapture}
      style={{ position: "relative", overflow: "hidden", borderRadius: 20, touchAction: "pan-y" }}
    >
      {/* sliding track · one viewport-width per slide */}
      <div style={{
        display: "flex",
        width: `${heroes.length * 100}%`,
        transform: `translateX(-${(active / heroes.length) * 100}%)`,
        transition: "transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
      }}>
        {heroes.map(g => (
          <div key={g.id} style={{ width: `${100 / heroes.length}%`, flexShrink: 0 }}>
            <HeroCard game={g} onPlayGame={onPlayGame} />
          </div>
        ))}
      </div>
      {/* dots · tappable */}
      {heroes.length > 1 && (
        <div style={{ position: "absolute", top: 16, right: 14, display: "flex", gap: 5, zIndex: 2 }}>
          {heroes.map((_, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); onDot(i); }} aria-label={`slide ${i + 1}`} style={{
              width: i === active ? 16 : 6, height: 6, borderRadius: 999, border: "none", padding: 0, cursor: "pointer",
              background: i === active ? "#fff" : "rgba(255,255,255,0.4)",
              transition: "width 0.3s ease, background 0.3s ease",
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroCard({ game, onPlayGame }: { game: typeof GAMES[number]; onPlayGame: (id: string) => void }) {
  // AI-mode slide — cyan feature-drop variant. Surfaces the "build your own
  // AI" mode, which is otherwise invisible outside the Challenge lobby.
  if (game.kind === "aimode") {
    return (
      <button onClick={() => onPlayGame(game.id)} style={{
        position: "relative", overflow: "hidden", width: "100%", padding: 0, border: "1px solid rgba(34,211,238,0.35)", cursor: "pointer",
        borderRadius: 20, textAlign: "left", background: game.bg,
        boxShadow: `0 16px 36px -12px ${game.glow}88, inset 0 1px 0 rgba(76,29,149,0.12)`,
        minHeight: 178, display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}>
        <div style={{ position: "absolute", top: -40, right: -30, width: 190, height: 190, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,211,238,0.28), transparent 70%)", pointerEvents: "none" }} />
        {/* Agent-vs-MARKOV art — `screen` blend drops its black background */}
        <img src={typeof game.art === "string" ? game.art : ""} alt="" style={{ position: "absolute", right: -22, bottom: -22, width: 184, height: 184, objectFit: "contain", mixBlendMode: "screen", pointerEvents: "none" }} />
        <div style={{ padding: "14px 14px 0", position: "relative", zIndex: 1 }}>
          <Pill color="#0e7490" soft={false}>✨ NEW MODE</Pill>
        </div>
        <div style={{ padding: "8px 14px 14px", maxWidth: "70%", position: "relative", zIndex: 1 }}>
          <div style={{ fontFamily: T.display, fontSize: 21, lineHeight: 1.06, textShadow: "0 0 18px rgba(34,211,238,0.4)" }}>
            <span style={{ color: "#fff" }}>Build your AI.</span><br />
            <span style={{ color: "#0e7490" }}>Fight MARKOV.</span>
          </div>
          <div style={{ fontFamily: T.body, fontSize: 10.5, color: "rgba(207,250,254,0.82)", marginTop: 6, lineHeight: 1.4 }}>Deploy your agent · watch it climb</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8 }}>
            <img src="/goodagents-logo.png" alt="" width={14} height={14} style={{ display: "block" }} />
            <span style={{ fontFamily: T.body, fontSize: 9, color: "rgba(207,250,254,0.65)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Powered by GoodAgents</span>
          </div>
        </div>
      </button>
    );
  }

  // Tug of War slide. It needs its own branch rather than reusing "event":
  // that branch's copy is hardcoded to the Arena Cup ($150, the cup countdown,
  // the GoodAgents credit), so anything else routed through it silently renders
  // as the Cup regardless of its own title and prize.
  if (game.kind === "weekly" && game.weekly) {
    const w = game.weekly;
    const pct = Math.max(0, Math.min(100, Math.round((w.progress / w.target) * 100)));
    const mine = w.myContribution ?? 0;
    const left = Math.max(0, w.target - w.progress);
    return (
      <div style={{
        position: "relative", overflow: "hidden", width: "100%", borderRadius: 20, textAlign: "left",
        border: "1px solid rgba(251,191,36,0.5)", background: game.bg,
        boxShadow: `0 16px 36px -12px ${game.glow}99, inset 0 1px 0 rgba(76,29,149,0.14)`,
        minHeight: 178, display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 90% at 92% 8%, rgba(251,191,36,0.28) 0%, transparent 55%)" }} />
        <div style={{ padding: "14px 14px 0", position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {/* the countdown rides in the pill: the slide dots sit in the top-right corner */}
          <Pill color="#b45309">🏆 THIS WEEK · {game.subtitle.toUpperCase()}</Pill>
        </div>
        <div style={{ padding: "8px 14px 0", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: T.display, fontSize: 30, color: "#fff", lineHeight: 1, textShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>{w.rewardG.toLocaleString()} G$</span>
            <span style={{ fontFamily: T.body, fontSize: 12.5, fontWeight: 800, color: "rgba(255,255,255,0.8)" }}>to share</span>
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.86)", marginTop: 5, lineHeight: 1.35 }}>
            {w.hit ? `Unlocked! Every game this week pays ${w.perGameG} G$.` : game.desc}
          </div>
        </div>
        <div style={{ padding: "10px 14px 14px", position: "relative", zIndex: 1 }}>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={w.target} aria-valuenow={w.progress} style={{ height: 9, borderRadius: 6, background: "rgba(0,0,0,0.42)", overflow: "hidden", border: "1px solid rgba(76,29,149,0.14)" }}>
            <div style={{ width: `${Math.max(pct, w.progress > 0 ? 3 : 0)}%`, height: "100%", borderRadius: 6, background: "linear-gradient(90deg, #fbbf24, #4ade80)", transition: "width .6s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5, fontFamily: T.body, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.78)" }}>
            <span>{w.hit ? "Target reached" : `${w.progress.toLocaleString()} of ${w.target.toLocaleString()} games · ${left.toLocaleString()} to go`}</span>
            <span>{mine > 0 ? `You: ${mine} game${mine === 1 ? "" : "s"}${w.myProjectedG ? ` · ${w.myProjectedG.toLocaleString()} G$` : ""}` : `${w.playersIn} playing`}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => onPlayGame(game.id)} style={{ flex: 1, cursor: "pointer", border: "none", borderRadius: 12, padding: "11px 0", fontFamily: T.display, fontSize: 15, color: "#1a0b33", background: "#b45309", boxShadow: "0 3px 0 #b45309" }}>
              {mine >= w.capPerPlayer ? "You hit the cap. Keep playing" : mine > 0 ? "Play another" : "Play to earn"}
            </button>
            <Link href="/leaderboard" style={{ textDecoration: "none", borderRadius: 12, padding: "11px 14px", fontFamily: T.body, fontSize: 13, fontWeight: 800, color: "#fff", background: "rgba(76,29,149,0.12)", border: "1px solid rgba(255,255,255,0.22)" }}>Board</Link>
          </div>
        </div>
      </div>
    );
  }

  if (game.kind === "tug") {
    return (
      <button onClick={() => onPlayGame(game.id)} style={{
        position: "relative", overflow: "hidden", width: "100%", padding: 0, cursor: "pointer",
        border: "1px solid rgba(220,38,38,0.45)", borderRadius: 20, textAlign: "left",
        background: game.bg,
        boxShadow: `0 16px 36px -12px ${game.glow}99, inset 0 1px 0 rgba(76,29,149,0.12)`,
        minHeight: 178, display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}>
        {/* Generated key art, dimmed and pushed right so the copy stays legible
            over it. The card previously carried no art at all while every other
            slide had some, which made the newest event look the least finished. */}
        <img
          src="/tug/card.jpg"
          alt=""
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "60% 50%", opacity: 0.55, pointerEvents: "none",
          }}
        />
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "linear-gradient(100deg, rgba(20,4,40,0.92) 0%, rgba(20,4,40,0.72) 42%, rgba(20,4,40,0.18) 100%)",
        }} />

        {/* The rope, as a one-glance motif, pinned to the base of the card.
            It sat at top:50% first, which ran the stripe straight through the
            headline and parked the medallion on top of the "G$" — the motif
            fighting the copy instead of supporting it. Along the bottom edge it
            reads as the contested line it is meant to be, and the medallion is
            dropped at this size because a 24px disc on a 6px band is noise. */}
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6 }}>
          <div style={{ position: "absolute", inset: 0, background: "#0e7490", opacity: 0.85 }} />
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: "54%",
            background: "repeating-linear-gradient(45deg, #dc2626 0 6px, #7f1d1d 6px 12px)",
          }} />
          {/* the seam where the two sides meet */}
          <div style={{
            position: "absolute", left: "54%", top: -3, bottom: -3, width: 2, marginLeft: -1,
            background: "rgba(255,255,255,0.85)",
          }} />
        </div>
        <div style={{ padding: "14px 14px 0", position: "relative", zIndex: 1 }}>
          <Pill color="#b91c1c">🪢 TUG OF WAR</Pill>
        </div>
        <div style={{ padding: "8px 14px 18px", position: "relative", zIndex: 1, maxWidth: "80%" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: T.display, fontSize: 30, color: "#fff", lineHeight: 1, textShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>
              1,000,000
            </span>
            <span style={{ fontFamily: T.body, fontSize: 9, color: "rgba(255,255,255,0.8)", fontWeight: 800, letterSpacing: "0.14em" }}>
              G$
            </span>
          </div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: "rgba(255,255,255,0.82)", marginTop: 5, lineHeight: 1.35 }}>
            {game.desc}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8,
            padding: "4px 10px", borderRadius: 999,
            background: "rgba(76,29,149,0.14)", border: "1px solid rgba(255,255,255,0.3)",
          }}>
            <span style={{ fontFamily: T.body, fontSize: 8.5, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(255,255,255,0.85)" }}>
              {game.subtitle.toUpperCase()}
            </span>
          </div>
        </div>
      </button>
    );
  }

  // Event slide — gold teaser variant of the hero. NOTE: its copy is specific
  // to the Arena Cup, not generic.
  if (game.kind === "event") {
    return (
      <button onClick={() => onPlayGame(game.id)} style={{
        position: "relative", overflow: "hidden", width: "100%", padding: 0, border: "1px solid rgba(251,191,36,0.4)", cursor: "pointer",
        borderRadius: 20, textAlign: "left", background: game.bg,
        boxShadow: `0 16px 36px -12px ${game.glow}99, inset 0 1px 0 rgba(76,29,149,0.12)`,
        minHeight: 178, display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}>
        <div style={{ position: "absolute", top: -40, right: -30, width: 190, height: 190, borderRadius: "50%", background: "radial-gradient(circle, rgba(251,191,36,0.3), transparent 70%)", pointerEvents: "none" }} />
        {/* Trophy art — `screen` blend drops its dark background into the card */}
        <img src={typeof game.art === "string" ? game.art : ""} alt="" style={{ position: "absolute", right: -14, bottom: -14, width: 172, height: 172, objectFit: "contain", mixBlendMode: "screen", pointerEvents: "none" }} />
        <div style={{ padding: "14px 14px 0", position: "relative", zIndex: 1 }}>
          <Pill color="#b45309">⚡ ARENA CUP</Pill>
        </div>
        <div style={{ padding: "8px 14px 14px", maxWidth: "72%", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: T.display, fontSize: 30, color: "#b45309", lineHeight: 1, textShadow: "0 0 20px rgba(180,83,9,0.75)" }}>$150</span>
            <span style={{ fontFamily: T.body, fontSize: 9, color: "rgba(180,83,9,1)", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>in G$</span>
          </div>
          {/* Live countdown */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 7, padding: "4px 10px", borderRadius: 999, background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.4)" }}>
            <CupCountdown
              labelStyle={{ fontFamily: T.body, fontSize: 8.5, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(180,83,9,1)", textTransform: "uppercase" }}
              timeStyle={{ fontFamily: T.display, fontSize: 13, color: "#b45309" }}
              gap={5}
            />
          </div>
          {/* GoodAgents supports the pool · credited, not the headline. */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8 }}>
            <img src="/goodagents-logo.png" alt="" width={14} height={14} style={{ display: "block" }} />
            <span style={{ fontFamily: T.body, fontSize: 9, color: "rgba(180,83,9,0.95)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Supported by GoodAgents</span>
          </div>
        </div>
      </button>
    );
  }
  // 3D games: the real game fills the banner, with the words over a shade.
  const cover = GAMES_3D.some(x => x.id === game.id) ? COVERS[game.id] : null;
  if (cover) {
    return (
      <button onClick={() => onPlayGame(game.id)} aria-label={`Play ${game.title}`} style={{
        position: "relative", overflow: "hidden", width: "100%", padding: 0, border: "none", cursor: "pointer",
        borderRadius: 20, textAlign: "left", background: "#0b0c12", color: "#fff",
        boxShadow: `0 16px 36px -12px ${game.glow}88, inset 0 1px 0 rgba(76,29,149,0.12)`,
        minHeight: 178, display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover.src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: cover.focus }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(90deg, rgba(5,6,10,0.88) 0%, rgba(5,6,10,0.55) 46%, rgba(5,6,10,0) 78%), linear-gradient(rgba(5,6,10,0.35) 0%, rgba(5,6,10,0) 34%, rgba(5,6,10,0.5) 100%)" }} />
        <div style={{ padding: "14px 14px 0", position: "relative", zIndex: 1, display: "flex", gap: 6 }}>
          <Pill color="#b45309">✨ NEW · 3D</Pill>
        </div>
        <div style={{ padding: "10px 14px 14px", maxWidth: "72%", position: "relative", zIndex: 1 }}>
          <div style={{ fontFamily: T.display, fontSize: 25, lineHeight: 1, textShadow: "0 2px 14px rgba(0,0,0,0.7)" }}>{game.title}</div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: "rgba(255,255,255,0.84)", marginTop: 5, lineHeight: 1.35, textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>{game.desc}</div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 10, height: 30, padding: "0 10px 0 14px", borderRadius: 10, background: "#fff", color: "#0a0b10", fontFamily: T.display, fontSize: 13, boxShadow: "0 8px 18px -8px rgba(0,0,0,0.7)" }}>
            Play
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
          </span>
        </div>
      </button>
    );
  }
  return (
    <button onClick={() => onPlayGame(game.id)} style={{
      position: "relative", overflow: "hidden", width: "100%", padding: 0, border: "none", cursor: "pointer",
      borderRadius: 20, textAlign: "left", background: game.bg,
      boxShadow: `0 16px 36px -12px ${game.glow}88, inset 0 1px 0 rgba(76,29,149,0.12)`,
      minHeight: 178, display: "flex", flexDirection: "column", justifyContent: "space-between",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.22), transparent 60%)", pointerEvents: "none" }} />
      {typeof game.art === "string" ? (
        <img src={game.art} alt="" style={{ position: "absolute", right: -16, bottom: -10, width: 150, height: 150, objectFit: "contain", filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.5))", pointerEvents: "none" }} />
      ) : (
        <div style={{ position: "absolute", right: -8, bottom: -4, width: 150, height: 150, pointerEvents: "none" }}>{game.art}</div>
      )}
      <div style={{ padding: "14px 14px 0" }}>
        <Pill color="#b45309">{game.id === "arena" ? "⚡ BIG UPDATE" : game.isNew ? "✨ NEW GAME" : "▶ JUMP BACK IN"}</Pill>
      </div>
      <div style={{ padding: "12px 14px 14px", maxWidth: "64%", position: "relative", zIndex: 1 }}>
        <div style={{ fontFamily: T.display, fontSize: 23, color: "#fff", lineHeight: 1, textShadow: "0 2px 6px rgba(0,0,0,0.45)" }}>{game.title}</div>
        <div style={{ fontFamily: T.body, fontSize: 11, color: "rgba(255,255,255,0.78)", marginTop: 5, lineHeight: 1.35 }}>{game.desc}</div>
      </div>
    </button>
  );
}

function GamesGrid({ onPlayGame }: { onPlayGame: (id: string) => void }) {
  // Overview PREVIEW — a clean row of 3; the full roster lives behind "View
  // all". Fixed set so it never reflows or orphans as the hero rotates.
  // The two 3D games lead, then the newest classic.
  const cards = [...GAMES_3D, GAMES[0]];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      {cards.map(g => {
        const cover = COVERS[g.id];
        const is3d = GAMES_3D.some(x => x.id === g.id);
        return (
          <button key={g.id} onClick={() => onPlayGame(g.id)} aria-label={`Play ${g.title}`} style={{
            position: "relative", overflow: "hidden", borderRadius: 14, border: "none", padding: 0, textAlign: "left",
            background: "#0b0c12", cursor: "pointer", display: "flex", flexDirection: "column",
            boxShadow: `0 8px 18px -8px ${g.glow}88, inset 0 0 0 1px rgba(76,29,149,0.1)`,
          }}>
            <div style={{ height: 78, position: "relative", width: "100%" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover.src} alt="" loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: cover.focus }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(11,12,18,0) 55%, #0b0c12 100%)" }} />
              {is3d && <span style={{ position: "absolute", top: 6, left: 6, padding: "2px 6px", borderRadius: 6, fontFamily: T.display, fontSize: 9, color: "#231005", background: "linear-gradient(180deg, #fde68a, #fbbf24)" }}>3D</span>}
            </div>
            {/* subtitle wraps to 2 lines on narrow screens; minHeight keeps the row even */}
            <div style={{ padding: "6px 10px 10px", minHeight: 54, display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
              <div style={{ fontFamily: T.display, fontSize: 12, color: "#fff", lineHeight: 1.1 }}>{g.title}</div>
              <div style={{
                fontFamily: T.body, fontSize: 8.5, color: "rgba(255,255,255,0.62)", fontWeight: 700,
                marginTop: 3, lineHeight: 1.3,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>{g.subtitle}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Real daily-missions surface. Mirrors main's wiring exactly:
//   • GET /api/missions/today/{address} → { missions[], secondsUntilReset }
//   • POST /api/missions/claim → marks claimed, refetches
// Per-mission state machine: in-progress (purple bar) → ready (gold +
// CLAIM button) → claimed (green ✓ CLAIMED, dimmed). All three missions
// show together so a player who's done one can see what's left.
type ApiMission = { id: number; missionId: string; game?: string | null; label: string; progress: number; target: number; completed: boolean; claimed: boolean; rewardXp: number };
// where a mission about one game is played
const MISSION_GAME_HREF: Record<string, string> = { stack: "/games/stack", simon: "/games/simon", rhythm: "/games/rhythm", ladder: "/games/ladder", strike: "/bowling", nepa3d: "/world" };
const MISSIONS_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

function fmtMissionCountdown(s: number) {
  if (s <= 0) return "Resetting…";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function MissionCard({ connected: signedIn, onConnect }: { connected: boolean; onConnect: () => void }) {
  const { address: realAddress } = useAccount();
  // dev only: lets an automated check see the card for a test wallet without signing in
  const devWallet = process.env.NODE_ENV !== "production" && typeof window !== "undefined" ? (window as unknown as { __inboxWallet?: string }).__inboxWallet : undefined;
  const address = realAddress ?? devWallet;
  const connected = signedIn || !!devWallet;
  const isMiniPay = useIsMiniPay();
  const { getAccessToken } = usePrivy();
  const { signMessageAsync } = useSignMessage();
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
      // Claims prove wallet control before the server forwards them:
      // MiniPay signs a scoped message, everyone else presents their
      // Privy access token. Direct browser->backend claiming is gone.
      if (isMiniPay) {
        const message = `GameArena|mission|${id}|${Date.now()}`;
        const sig = await signMessageAsync({ message });
        await claimMissionMiniPay(sig, message, address, id);
      } else {
        const token = await getAccessToken();
        if (token) await claimMission(token, address, id);
      }
    } catch { /* fall through to refetch — server is the source of truth */ }
    setClaimingId(null);
    refetch();
  };

  // ── GUEST · single CTA tile, no fake missions ─────────────────────────
  if (!connected) {
    return (
      <button onClick={onConnect} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderRadius: 15, background: T.surface, border: `1px solid ${T.hairline}`, cursor: "pointer", textAlign: "left" }}>
        <div style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0, background: "rgba(109,40,217,0.41)", border: "1px solid rgba(109,40,217,0.65)", display: "flex", alignItems: "center", justifyContent: "center", color: "#6d28d9" }}>
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
          <span style={{ width: 24, height: 24, borderRadius: 8, background: "rgba(109,40,217,0.41)", border: "1px solid rgba(109,40,217,0.65)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#6d28d9" }}>
            <Icon name="target" size={13} color="currentColor" />
          </span>
          <span style={{ fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.14em", color: T.inkDim, textTransform: "uppercase" }}>Daily missions</span>
        </div>
        {resetSec > 0 && (
          <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 800, color: T.inkDim, fontVariantNumeric: "tabular-nums" }}>{resetSec >= 3600 ? `New set in ${Math.floor(resetSec / 3600)}h ${Math.floor((resetSec % 3600) / 60)}m` : `New set in ${Math.max(1, Math.ceil(resetSec / 60))}m`}</span>
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
            const href = m.game ? MISSION_GAME_HREF[m.game] : "/dashboard";
            return (
              <div key={m.id} style={{ borderRadius: 16, padding: "12px 13px", display: "flex", flexDirection: "column", gap: 8, background: done ? "#f0fdf4" : "#fff", border: `1px solid ${done ? "rgba(22,163,74,0.4)" : ready ? "#6d28d9" : T.hairline}`, boxShadow: ready ? "0 0 0 3px rgba(109,40,217,0.12)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: T.body, fontSize: 14, fontWeight: 800, color: T.ink, lineHeight: 1.3 }}>{m.label}</div>
                    <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: done ? "#166534" : T.inkDim, marginTop: 1 }}>{done ? `Done · +${m.rewardXp} XP claimed` : ready ? "Finished. Claim your reward." : `${m.progress} of ${m.target} · +${m.rewardXp} XP`}</div>
                  </div>
                  {done ? (
                    <span aria-hidden style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 999, display: "grid", placeItems: "center", background: "#dcfce7", color: "#166534", fontWeight: 900 }}>✓</span>
                  ) : ready ? (
                    <button onClick={() => claim(m.id)} disabled={claimingId === m.id} style={{ flexShrink: 0, cursor: claimingId === m.id ? "wait" : "pointer", borderRadius: 12, padding: "9px 14px", whiteSpace: "nowrap", background: "linear-gradient(180deg, #7c3aed, #6d28d9)", border: "none", boxShadow: "0 3px 0 #4c1d95", color: "#fff", fontFamily: T.body, fontSize: 13, fontWeight: 800 }}>{claimingId === m.id ? "Claiming…" : `Claim +${m.rewardXp} XP`}</button>
                  ) : (
                    <Link href={href} style={{ flexShrink: 0, borderRadius: 12, padding: "8px 14px", background: "#ede9fe", color: "#4c1d95", fontFamily: T.body, fontSize: 13, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" }}>Play ›</Link>
                  )}
                </div>
                {!done && (
                  <div role="img" aria-label={`${pct}% done`} style={{ height: 7, borderRadius: 999, background: "rgba(76,29,149,0.12)", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #a78bfa, #6d28d9)", transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)" }} />
                  </div>
                )}
              </div>
            );
          })
        )}
        {allClaimed && (
          <div style={{ padding: "8px 6px 2px", textAlign: "center", fontFamily: T.body, fontSize: 10.5, color: "#15803d", fontWeight: 700 }}>
            ✦ All missions claimed · new set in {fmtMissionCountdown(resetSec)}
          </div>
        )}
      </div>
    </div>
  );
}

function ClimbCard({ router }: {
  connected: boolean;
  dash: DashData | null;
  address: string | null;
  onConnect: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  // "Your cup" tracks the live Arena Cup (single source of truth in lib/cup),
  // NOT the ended June MARKOV Climb — which used to render as "BETA · LIVE ON
  // CELO" with a stale rank long after it finished. CupCountdown self-ticks and
  // handles upcoming → live → ended, so this reads like a real cup at every phase.
  //
  // The whole card retires with the cup. Hiding only the countdown inside it
  // would leave a headless "ARENA CUP · $150 IN G$" row pointing at an event
  // that finished a month ago.
  // Pure read — see cupIsStaleNow in lib/cup. No state, no effect, no interval.
  if (cupIsStaleNow()) return null;

  return (
    <button onClick={() => router.push("/leaderboard/cup")} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderRadius: 15, background: "linear-gradient(135deg, rgba(251,191,36,0.12), rgba(180,83,9,0.28))", border: "1px solid rgba(251,191,36,0.35)", cursor: "pointer", textAlign: "left" }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>🏆</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.body, fontSize: 9, color: "#b45309", fontWeight: 800, letterSpacing: "0.12em" }}>ARENA CUP · $150 IN G$</div>
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.ink, fontWeight: 700, marginTop: 2 }}>
          <CupCountdown
            labelStyle={{ fontFamily: T.body, fontSize: 12, color: T.ink, fontWeight: 700 }}
            timeStyle={{ fontFamily: T.body, fontSize: 12, color: "#b45309", fontWeight: 800 }}
          />
        </div>
      </div>
      <Icon name="chev" size={15} color={T.inkSoft} />
    </button>
  );
}

