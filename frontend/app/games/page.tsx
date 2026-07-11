"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { playClick } from "@/hooks/useAppAudio";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { fetchPreview } from "@/lib/leaderboardPreview";
import type { GameTypeId } from "@/lib/subgraph";
import { GameLoadingScreen } from "@/components/GameLoadingScreen";

// ─── tokens (in sync with /dashboard + /home) ────────────────────────────
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  accent: "#a78bfa",
  gap: 12,
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// ─── games (real project assets · ordered by gameplay weight) ────────────
const GAMES = [
  {
    id: "rhythm",
    title: "Rhythm Rush",
    subtitle: "Tap to the beat · combo to climb",
    art: "/games/rhythm.png",
    bg: "linear-gradient(155deg, #c026d3 0%, #7c1d9e 55%, #4c1d95 100%)",
    glow: "#c026d3",
    active: true,
    href: "/games/rhythm",
  },
  {
    id: "simon",
    title: "Simon Memory",
    subtitle: "Sequence memory · go deeper",
    art: "/games/simon.png",
    bg: "linear-gradient(155deg, #0e7490 0%, #075985 55%, #1e1b4b 100%)",
    glow: "#06b6d4",
    active: true,
    href: "/games/simon",
  },
  // Slime Survivor — temporarily hidden from the hub. The route and game
  // code at /games/survivor still work for anyone with the direct link;
  // this just removes the card from the games lobby. Un-comment to bring
  // it back when ready.
  // {
  //   id: "survivor",
  //   title: "SLIME SURVIVOR",
  //   wager: "FREE",
  //   payout: "—",
  //   path: "/games/survivor",
  //   active: true,
  //   artGrad: "linear-gradient(160deg, #14532d 0%, #166534 55%, #052e16 100%)",
  //   glow: "#22c55e",
  //   accent: "#86efac",
  //   showWager: false,
  //   borderColor: "#22c55e",
  //   startWall: "#14532d",
  //   startGrad: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
  //   startGlow: "rgba(34,197,94,0.75)",
  //   art: (
  //     // Your pet IS the runner — the card art sells the hook directly.
  //     // eslint-disable-next-line @next/next/no-img-element
  //     <img src="/pets/stage-3-teen.png" alt="Slime Survivor" width={1024} height={1024} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.7))" }} />
  //   ),
  // },
  {
    // Stack Tower's old palette (teal → navy) was nearly identical to
    // Simon's, so two cards in the row read as one block on mobile. New
    // warm amber palette claims the fourth color quadrant in the row
    // (alongside Rhythm magenta, Simon teal, Challenge AI green) and
    // reads as "wood blocks under stadium lights" — fits the gameplay
    // identity. Schema also normalized from artGrad/path to bg/href so
    // the card actually paints (the render reads game.bg, game.href).
    id: "stack",
    title: "Stack Tower",
    subtitle: "Stack & survive · don't drop",
    art: (
      // Inline SVG stacked-blocks illustration — no PNG asset needed.
      // Rainbow hue spectrum (cyan → pink) kept on purpose against the
      // warm amber bg: the cool blocks pop hard off the orange backdrop,
      // which makes the tower the visual hero of the card.
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
    ),
    bg: "linear-gradient(155deg, #f97316 0%, #c2410c 55%, #7c2d12 100%)",
    glow: "#fb923c",
    active: true,
    href: "/games/stack",
  },
  {
    id: "challenge-ai",
    title: "Challenge AI",
    subtitle: "Free · instant · outsmart MARKOV",
    art: "/games/challenge-ais.png",
    bg: "linear-gradient(155deg, #14532d 0%, #064e3b 55%, #022c22 100%)",
    glow: "#22c55e",
    active: true,
    href: "/games/challenge-ai",
  },
  {
    id: "coming-soon",
    title: "More coming",
    subtitle: "Coming soon",
    art: "/games/coming-soon.png",
    bg: "linear-gradient(155deg, #3a2a5e 0%, #2a1d4a 55%, #1a1235 100%)",
    glow: "#7c6db8",
    active: false,
    href: "",
  },
];

// ─── primitives ─────────────────────────────────────────────────────────
function GuestBanner({ onConnect, needsSetup }: { onConnect: () => void; needsSetup?: boolean }) {
  // Two truths, one strip: guests need to SIGN IN; signed-in players who
  // never finished onboarding need to FINISH SETUP. Telling the second
  // group to "sign in" reads as "your sign-in didn't work".
  return (
    <div style={{
      margin: "0 16px",
      padding: "9px 12px", borderRadius: 13,
      background: needsSetup
        ? "linear-gradient(90deg, rgba(251,191,36,0.14), rgba(255,255,255,0.02))"
        : `linear-gradient(90deg, ${T.accent}1f, rgba(255,255,255,0.02))`,
      border: needsSetup ? "1px solid rgba(251,191,36,0.4)" : `1px solid ${T.accent}44`,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>{needsSetup ? "🐣" : "🎁"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: T.body, fontSize: 11, color: T.ink, fontWeight: 700, lineHeight: 1.3 }}>
          {needsSetup ? "You're signed in." : "You're playing free."}
        </span>
        <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, lineHeight: 1.3 }}>
          {needsSetup
            ? " Name your slime to save scores & win G$."
            : " Sign in to win G$, save your pet & climb the board."}
        </span>
      </div>
      <button onClick={onConnect} style={{
        flexShrink: 0, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
        background: needsSetup ? "#fbbf24" : T.accent, border: "none",
        color: needsSetup ? "#231005" : "#fff", fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em",
        boxShadow: needsSetup ? "0 4px 12px -3px rgba(251,191,36,0.7)" : `0 4px 12px -3px ${T.accent}aa`,
      }}>{needsSetup ? "FINISH SETUP" : "SIGN IN"}</button>
    </div>
  );
}

function GameCard({ game, onClick }: { game: typeof GAMES[number]; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={!game.active} style={{
      width: "100%", padding: 0, border: "none",
      borderRadius: 18, overflow: "hidden",
      background: game.bg, opacity: game.active ? 1 : 0.55,
      cursor: game.active ? "pointer" : "not-allowed", textAlign: "left",
      boxShadow: game.active ? `0 8px 18px -6px ${game.glow}66` : "none",
      position: "relative",
      // Flex column so the dark text panel can stretch with flex: 1
      // and reach the card's bottom edge regardless of subtitle wrap.
      // Without this, single-line subtitles (Challenge AI) left a strip
      // of game.bg visible below the dark band on rows where another
      // card's subtitle wrapped to 2 lines.
      display: "flex", flexDirection: "column",
    }}>
      {!game.active && (
        <span style={{ position: "absolute", top: 8, right: 8, padding: "2px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontFamily: T.body, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", zIndex: 2 }}>SOON</span>
      )}
      <div style={{ height: 110, position: "relative", overflow: "hidden" }}>
        {/* Cards can declare `art` as either a string path (rhythm /
            simon use real PNGs) OR a JSX element (stack tower uses an
            inline SVG of stacked blocks). The earlier render passed
            the JSX through `<img src={...}>` which fell back to the
            broken-image triangle + alt-text — looked like a missing
            asset. Branching on type lets both schemas coexist. */}
        {typeof game.art === "string" ? (
          <img src={game.art} alt={game.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", padding: 12 }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, padding: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{game.art}</div>
        )}
      </div>
      <div style={{ padding: "12px 14px 14px", background: "rgba(0,0,0,0.35)", flex: 1 }}>
        <div style={{ fontFamily: T.display, fontSize: 16, color: "#fff", lineHeight: 1.1, letterSpacing: "0.01em" }}>{game.title}</div>
        <div style={{ fontFamily: T.body, fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 700, marginTop: 3 }}>
          {game.subtitle}
        </div>
      </div>
    </button>
  );
}

// ─── page ───────────────────────────────────────────────────────────────
export default function GamesPage() {
  const router = useRouter();
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  // Per-game loading overlay state · holds the tapped game's identity so
  // the loader shows the right art/title/glow. Cleared when the route
  // change unmounts the page (and re-cleared on back-nav return).
  const [loadingGame, setLoadingGame] = useState<typeof GAMES[number] | null>(null);

  // Same gate as /dashboard — "connected" means full onboarding (Privy + GamePass mint).
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  // MiniPay users skip Privy · their injected wallet is the identity.
  const isMiniPay = useIsMiniPay();
  const connected = (authenticated || isMiniPay) && !!address && hasMinted === true;
  // Signed in, never minted — needs FINISH SETUP, not another "sign in".
  const authedUnminted = (authenticated || isMiniPay) && !!address && hasMinted === false;

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Always route Sign-in taps to /home — the Privy modal lives behind
  // the home page button so first-timers land in a real onboarding
  // surface, not an orphan popup over a feed.
  const onConnect = () => router.push("/home");
  const onPlay = async (id: string) => {
    // Spam-tap guard · ignore further taps while a load is already in
    // flight. The overlay covers the page so the player can't see the
    // cards anyway, but this stops queued promises from racing.
    if (loadingGame) return;
    const g = GAMES.find(x => x.id === id);
    if (!g?.active) return;
    playClick();

    // Show the per-game loading overlay with the game's own art + title
    // + glow color. It covers the screen instantly so the player sees a
    // branded transition instead of an empty hub-to-lobby gap.
    setLoadingGame(g);

    // Run both concurrently:
    //   1. fetchPreview · pulls the lobby's top-3 leaderboard so the
    //      cache is warm by the time the route lands.
    //   2. 600ms min-duration timer · guarantees the loader gets at
    //      least one breath even when the prefetch resolves in 100ms.
    // Promise.all means we wait for the SLOWER of the two · loader
    // never feels rushed on a fast connection, never feels stuck on a
    // slow one.
    const gameType: GameTypeId | null =
      id === "rhythm" ? 0 : id === "simon" ? 1 : id === "stack" ? 2 : null;
    const tasks: Promise<unknown>[] = [new Promise(r => setTimeout(r, 600))];
    if (gameType !== null) tasks.push(fetchPreview(gameType).catch(() => null));
    await Promise.all(tasks);

    router.push(g.href);
    // Loader stays visible until the new route's first paint; clearing
    // here would cause a brief blank flash between overlay-dismiss and
    // lobby-mount. The page unmount on route change drops it for us.
  };

  return (
    <div style={{
      minHeight: "100vh", width: "100%",
      background: T.bg,
      color: T.ink,
      fontFamily: T.body,
    }}>
      {/* Full-viewport sticky header. Content centers itself inside. */}
      <AppHeader />

      {/* Guest banner — only when not fully onboarded. Same pattern as /dashboard. */}
      {!connected && (
        <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "8px auto 0" }}>
          <GuestBanner needsSetup={authedUnminted} onConnect={authedUnminted ? () => router.push("/home?ob=1") : onConnect} />
        </div>
      )}

      <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: T.gap + 4 }}>

        {/* Heading · matches design's "PLAY · SKILL ARENA / All games" */}
        <div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em" }}>PLAY · SKILL ARENA</div>
          <h2 style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 24, color: T.ink, margin: "4px 0 0", letterSpacing: "-0.01em" }}>All games</h2>
        </div>

        {/* Grid · 2 cols mobile, 3 cols desktop */}
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(3, 1fr)" : "repeat(2, 1fr)", gap: 12 }}>
          {GAMES.map(g => <GameCard key={g.id} game={g} onClick={() => onPlay(g.id)} />)}
        </div>
      </div>

      <AppBottomNav wide={isDesktop} />

      {/* Per-game loading overlay · shown while we warm the lobby's
          leaderboard cache. Renders the tapped game's art + title +
          glow so the transition reads as part of THAT game's identity. */}
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
