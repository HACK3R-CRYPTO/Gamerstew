"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { playClick } from "@/hooks/useAppAudio";

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
    subtitle: "Skill · Climb the board",
    art: "/games/rhythm.png",
    bg: "linear-gradient(155deg, #c026d3 0%, #7c1d9e 55%, #4c1d95 100%)",
    glow: "#c026d3",
    active: true,
    href: "/games/rhythm",
  },
  {
    id: "simon",
    title: "Simon Memory",
    subtitle: "Skill · Climb the board",
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
    id: "stack",
    title: "STACK TOWER",
    wager: "FREE",
    payout: "—",
    path: "/games/stack",
    active: true,
    artGrad: "linear-gradient(160deg, #0e7490 0%, #075985 55%, #0c4a6e 100%)",
    glow: "#22d3ee",
    accent: "#67e8f9",
    showWager: false,
    borderColor: "#22d3ee",
    startWall: "#075985",
    startGrad: "linear-gradient(160deg, #a5f3fc 0%, #22d3ee 50%, #0e7490 100%)",
    startGlow: "rgba(34,211,238,0.75)",
    art: (
      // Inline SVG stacked-blocks illustration so we don't need a new
      // /public/games/stack.png asset. Reads instantly as "stacking game"
      // at thumbnail size, scales clean on any DPR.
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
  },
  {
    id: "challenge-ai",
    title: "Challenge AI",
    subtitle: "Wager · Beat MARKOV",
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

function GameCard({ game, onClick }: { game: typeof GAMES[number]; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={!game.active} style={{
      width: "100%", padding: 0, border: "none",
      borderRadius: 18, overflow: "hidden",
      background: game.bg, opacity: game.active ? 1 : 0.55,
      cursor: game.active ? "pointer" : "not-allowed", textAlign: "left",
      boxShadow: game.active ? `0 8px 18px -6px ${game.glow}66` : "none",
      position: "relative",
    }}>
      {!game.active && (
        <span style={{ position: "absolute", top: 8, right: 8, padding: "2px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontFamily: T.body, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", zIndex: 2 }}>SOON</span>
      )}
      <div style={{ height: 110, position: "relative", overflow: "hidden" }}>
        <img src={game.art} alt={game.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", padding: 12 }} />
      </div>
      <div style={{ padding: "12px 14px 14px", background: "rgba(0,0,0,0.35)" }}>
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

  // Same gate as /dashboard — "connected" means full onboarding (Privy + GamePass mint).
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const connected = authenticated && !!address && hasMinted === true;

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
  const onPlay = (id: string) => {
    const g = GAMES.find(x => x.id === id);
    if (!g?.active) return;
    playClick();
    router.push(g.href);
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
          <GuestBanner onConnect={onConnect} />
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
    </div>
  );
}
