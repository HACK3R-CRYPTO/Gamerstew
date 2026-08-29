"use client";

// ─── /sprint · the private sprint board ──────────────────────────────────────
// Invite-only. The 15 roster players (and the host) open this to see the prize,
// a live countdown, and themselves ranked across the 3 skill games. Everyone
// else sees "private, invite only". Same scoring as the end-of-sprint payout.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff", inkDim: "rgba(220,210,255,0.7)", inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.5)", hairline: "rgba(255,255,255,0.08)",
  gold: "#fde68a", green: "#34d399", cyan: "#22d3ee", accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const GAME_HREF: Record<string, string> = { "Rhythm Rush": "/games/rhythm", "Simon Memory": "/games/simon", Stack: "/games/stack" };

type Row = { rank: number | null; wallet: string; name: string | null; score: number; prizeG: number; you: boolean };
type Sprint = {
  event: { title: string; startsAt: string; endsAt: string; usd: number; poolG: number; winners: number; games: { type: number; name: string }[]; rosterSize: number } | null;
  viewer: { allowed: boolean; isHost?: boolean; rank?: number | null; score?: number };
  board: Row[];
};

function fmtLeft(ms: number): string {
  if (ms <= 0) return "0m";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const fmtG = (g: number) => (g >= 1000 ? `${Math.round(g / 1000)}k` : `${g}`);
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

export default function SprintPage() {
  const { address } = useAccount();
  const [data, setData] = useState<Sprint | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => { const u = () => setIsDesktop(window.innerWidth >= 900); u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const q = address ? `?wallet=${address}` : "";
    fetch(`/api/sprint${q}`, { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => {});
    const t = setInterval(() => {
      fetch(`/api/sprint${q}`, { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => {});
    }, 20000);
    return () => clearInterval(t);
  }, [address]);

  const ev = data?.event;
  const phase = ev ? (now < Date.parse(ev.startsAt) ? "upcoming" : now < Date.parse(ev.endsAt) ? "live" : "ended") : "upcoming";
  const clock = ev ? (phase === "upcoming" ? `starts in ${fmtLeft(Date.parse(ev.startsAt) - now)}`
    : phase === "live" ? `ends in ${fmtLeft(Date.parse(ev.endsAt) - now)}` : "sprint ended") : "";

  const wrap = (child: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 640 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 16 }}>{child}</div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );

  if (!data) return wrap(<div style={{ color: T.inkSoft, fontSize: 13, paddingTop: 40, textAlign: "center" }}>Loading the room…</div>);

  if (!data.viewer?.allowed) {
    return wrap(
      <div style={{ paddingTop: 30, textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <h1 style={{ fontFamily: T.display, fontSize: 24, margin: 0 }}>Private sprint</h1>
        <div style={{ color: T.inkDim, fontSize: 13.5, maxWidth: 320, lineHeight: 1.5 }}>
          This event is invite only. {address ? "Your wallet isn't on the roster." : "Connect the wallet you were invited with to see the board."}
        </div>
      </div>,
    );
  }

  const yourRank = data.viewer.rank;
  return wrap(
    <>
      {/* header */}
      <div>
        <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em" }}>INVITE ONLY · {ev!.rosterSize} PLAYERS</div>
        <h1 style={{ fontFamily: T.display, fontSize: 27, margin: "4px 0 0", letterSpacing: "-0.01em" }}>{ev!.title}</h1>
      </div>

      {/* prize + clock */}
      <div style={{ background: T.surface, border: `1px solid ${T.gold}44`, borderRadius: 18, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: T.gold, textTransform: "uppercase" }}>Prize pool</div>
          <div style={{ fontFamily: T.display, fontSize: 26, color: T.gold, marginTop: 2 }}>${ev!.usd} in G$</div>
          <div style={{ fontSize: 11.5, color: T.inkDim, marginTop: 1 }}>top {ev!.winners} split · winner takes the most</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: phase === "live" ? T.green : phase === "upcoming" ? T.cyan : T.inkSoft, letterSpacing: "0.04em" }}>
            {phase === "live" ? "● LIVE" : phase === "upcoming" ? "UPCOMING" : "ENDED"}
          </div>
          <div style={{ fontSize: 13, color: T.ink, marginTop: 3, fontWeight: 700 }}>{clock}</div>
        </div>
      </div>

      {/* your standing */}
      {!data.viewer.isHost && (
        <div style={{ background: "rgba(52,211,153,0.12)", border: `1px solid ${T.green}55`, borderRadius: 14, padding: "10px 14px", fontSize: 13 }}>
          {yourRank ? <>You're <b style={{ color: T.green }}>#{yourRank}</b> · {data.viewer.score} pts. {yourRank <= ev!.winners ? "In the money — keep climbing." : `Crack the top ${ev!.winners} to win.`}</>
            : <>You haven't scored yet. Play any of the 3 games to get on the board.</>}
        </div>
      )}
      {data.viewer.isHost && (
        <div style={{ background: "rgba(167,139,250,0.12)", border: `1px solid ${T.accent}55`, borderRadius: 14, padding: "10px 14px", fontSize: 12.5, color: T.inkDim }}>
          Host view — you can see the room, you're not competing.
        </div>
      )}

      {/* play the games */}
      <div>
        <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Play — any of these count</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {ev!.games.map((g) => (
            <Link key={g.type} href={GAME_HREF[g.name] || "/games"} style={{ textDecoration: "none" }}>
              <div style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 14, padding: "12px 8px", textAlign: "center", color: T.ink }}>
                <div style={{ fontSize: 12.5, fontWeight: 800 }}>{g.name}</div>
                <div style={{ fontSize: 10, color: T.cyan, marginTop: 3 }}>play ›</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* the board */}
      <div>
        <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Live board</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.board.map((r) => {
            const inMoney = r.rank != null && r.rank <= ev!.winners;
            return (
              <div key={r.wallet} style={{
                background: r.you ? "rgba(52,211,153,0.14)" : T.surface,
                border: `1px solid ${r.you ? `${T.green}66` : inMoney ? `${T.gold}33` : T.hairline}`,
                borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ width: 26, textAlign: "center", fontFamily: T.display, fontSize: 16, color: r.rank == null ? T.inkSoft : inMoney ? T.gold : T.inkDim }}>
                  {r.rank == null ? "–" : r.rank}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.name || short(r.wallet)}{r.you ? " (you)" : ""}
                  </div>
                  <div style={{ fontSize: 10.5, color: T.inkSoft }}>{r.rank == null ? "not played yet" : `${r.score} pts`}</div>
                </div>
                {inMoney && <div style={{ fontFamily: T.display, fontSize: 14, color: T.gold }}>{fmtG(r.prizeG)} G$</div>}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10.5, color: T.inkSoft, marginTop: 10, lineHeight: 1.5 }}>
          Ranked by best score in each game, added up. Only Rhythm Rush, Simon Memory and Stack count. Winners paid in G$ when the clock stops.
        </div>
      </div>
    </>,
  );
}
