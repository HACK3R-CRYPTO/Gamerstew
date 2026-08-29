"use client";

// ─── /sprint · the private sprint room ───────────────────────────────────────
// Invite-only. Built in the Arena Cup's board language (minimal hero, character
// podium + confetti, glowing gradient-ring pills, progressive-disclosure) plus a
// private-event identity: "invite only · N players", a who's-in reveal while it's
// upcoming, and a prominent 5-day countdown. Same scoring as the payout.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
const GAME_ICON: Record<string, string> = { "Rhythm Rush": "🎵", "Simon Memory": "🧠", Stack: "🧱" };

type Row = { rank: number | null; wallet: string; name: string | null; score: number; per: Record<string, number>; prizeG: number; you: boolean };
type Sprint = {
  event: { title: string; startsAt: string; endsAt: string; usd: number; poolG: number; winners: number; games: { type: number; name: string }[]; rosterSize: number } | null;
  prizeLadder?: number[];
  viewer: { allowed: boolean; isHost?: boolean; isRoster?: boolean; rank?: number | null; score?: number };
  board: Row[];
};

function fmtLeft(ms: number): string {
  if (ms <= 0) return "0m";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}
const fmtG = (g: number) => (g >= 1000 ? `${Math.round(g / 1000)}k` : `${g}`);
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 18, padding: 16, ...style }}>{children}</div>;
}
function Eyebrow({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return <span style={{ fontFamily: T.body, fontSize: 10, color: tint ?? T.inkSoft, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>{children}</span>;
}

const CONFETTI = [
  { left: "10%", top: "22%", color: "#f9a8d4", size: 9, shape: "star", dur: 3.5, delay: 0.0 },
  { left: "20%", top: "55%", color: "#fbbf24", size: 11, shape: "triangle", dur: 4.2, delay: 0.5 },
  { left: "30%", top: "18%", color: "#22d3ee", size: 8, shape: "dot", dur: 3.0, delay: 1.0 },
  { left: "46%", top: "10%", color: "#fde68a", size: 12, shape: "sparkle", dur: 4.0, delay: 0.8 },
  { left: "62%", top: "20%", color: "#e879f9", size: 9, shape: "star", dur: 3.2, delay: 0.3 },
  { left: "74%", top: "50%", color: "#34d399", size: 9, shape: "dot", dur: 3.3, delay: 1.1 },
  { left: "86%", top: "26%", color: "#c084fc", size: 11, shape: "note", dur: 4.1, delay: 0.7 },
];
function Confetti({ p }: { p: typeof CONFETTI[number] }) {
  const base = { position: "absolute" as const, left: p.left, top: p.top, width: p.size, height: p.size, animation: `icon-float ${p.dur}s ease-in-out ${p.delay}s infinite`, pointerEvents: "none" as const, filter: `drop-shadow(0 0 6px ${p.color})` };
  if (p.shape === "dot") return <div style={{ ...base, background: p.color, borderRadius: "50%" }} />;
  if (p.shape === "triangle") return <div style={{ ...base, width: 0, height: 0, borderLeft: `${p.size / 2}px solid transparent`, borderRight: `${p.size / 2}px solid transparent`, borderBottom: `${p.size}px solid ${p.color}`, background: "transparent" }} />;
  if (p.shape === "note") return <div style={{ ...base, color: p.color, fontSize: p.size + 4, fontWeight: 900 }}>♪</div>;
  if (p.shape === "sparkle") return <div style={{ ...base, color: p.color, fontSize: p.size + 4, fontWeight: 900 }}>✦</div>;
  return <div style={{ ...base, color: p.color, fontSize: p.size + 4, fontWeight: 900 }}>★</div>;
}

// Character podium · the app's own board language (mirrors the Cup).
function Podium({ rows, dollarOf }: { rows: Row[]; dollarOf: (g: number) => number }) {
  const P = [
    { char: "/characters/char1.png", e: rows[0], color: "#fbbf24", w: 18, bottom: 38, left: 50, z: 3 },
    { char: "/characters/char2.png", e: rows[1], color: "#e2e8f0", w: 16, bottom: 33, left: 32, z: 2 },
    { char: "/characters/char3.png", e: rows[2], color: "#f97316", w: 16, bottom: 32, left: 67, z: 2 },
  ];
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 520, aspectRatio: "3 / 2", margin: "0 auto" }}>
      <img src="/characters/podium.png" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.6))", zIndex: 1 }} />
      {CONFETTI.map((p, i) => <Confetti key={i} p={p} />)}
      {P.map((pl) => pl.e && (
        <img key={pl.left} src={pl.char} alt="" style={{ position: "absolute", left: `${pl.left}%`, bottom: `${pl.bottom}%`, transform: "translateX(-50%)", width: `${pl.w}%`, zIndex: pl.z, objectFit: "contain", filter: `drop-shadow(0 4px 8px rgba(0,0,0,0.5)) drop-shadow(0 0 14px ${pl.color}55)` }} />
      ))}
      {P.map((pl) => {
        if (!pl.e) return null;
        const labelBottom = pl.bottom + pl.w * 2.25 + 1;
        return (
          <div key={`l${pl.left}`} style={{ position: "absolute", left: `${pl.left}%`, bottom: `${labelBottom}%`, transform: "translateX(-50%)", textAlign: "center", zIndex: 4, pointerEvents: "none", whiteSpace: "nowrap" }}>
            <div style={{ color: "#fff", fontSize: 12, fontWeight: 900, letterSpacing: "0.02em", textShadow: `0 0 10px ${pl.color}dd, 0 2px 4px rgba(0,0,0,0.8)` }}>{pl.e.you ? "You" : (pl.e.name || short(pl.e.wallet))}</div>
            <div style={{ color: pl.color, fontFamily: T.display, fontSize: 14, textShadow: `0 0 14px ${pl.color}, 0 2px 4px rgba(0,0,0,0.8)`, marginTop: 2 }}>≈${dollarOf(pl.e.prizeG)}</div>
          </div>
        );
      })}
    </div>
  );
}

// Glowing gradient-ring pill · one board row (ranks 4+).
function Pill({ e, dollarOf, winners }: { e: Row; dollarOf: (g: number) => number; winners: number }) {
  const inMoney = e.rank != null && e.rank <= winners;
  const played = e.rank != null;
  const tint = e.you ? T.green : inMoney ? T.gold : T.accent;
  return (
    <div style={{ borderRadius: 999, padding: 2, background: `linear-gradient(135deg, ${tint} 0%, ${tint}55 100%)`, boxShadow: `0 0 10px ${tint}33, 0 5px 14px rgba(0,0,0,0.45)`, opacity: played ? 1 : 0.6 }}>
      <div style={{ borderRadius: 999, background: e.you ? `linear-gradient(90deg, ${tint}2e 0%, rgba(20,10,50,0.92) 100%)` : "linear-gradient(90deg, rgba(24,12,56,0.92) 0%, rgba(12,6,34,0.95) 100%)", padding: "8px 15px 8px 8px", display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 999, background: `${tint}22`, border: `1px solid ${tint}66`, fontFamily: T.display, fontSize: 12.5, color: T.ink, flexShrink: 0 }}>{e.rank ?? "–"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.you ? `You · ${e.name || short(e.wallet)}` : (e.name || short(e.wallet))}</div>
          <div style={{ fontSize: 10, color: T.inkSoft }}>{played ? `${e.score} pts` : "not played yet"}</div>
        </div>
        {inMoney
          ? <span style={{ fontFamily: T.display, fontSize: 14, color: T.gold, flexShrink: 0 }}>≈${dollarOf(e.prizeG)}</span>
          : played && <span style={{ fontSize: 9.5, color: T.inkSoft, flexShrink: 0, fontWeight: 700 }}>chasing top {winners}</span>}
      </div>
    </div>
  );
}

function GameShortcuts({ games }: { games: { type: number; name: string }[] }) {
  return (
    <div>
      <Eyebrow tint={T.cyan}>Play — any of these count</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 9 }}>
        {games.map((g) => (
          <Link key={g.type} href={GAME_HREF[g.name] || "/games"} style={{ textDecoration: "none" }}>
            <div style={{ background: `radial-gradient(120% 120% at 50% 0%, ${T.cyan}1c, transparent 60%), ${T.surface}`, border: `1px solid ${T.cyan}33`, borderRadius: 16, padding: "13px 6px", textAlign: "center", color: T.ink }}>
              <div style={{ fontSize: 20, lineHeight: 1 }}>{GAME_ICON[g.name] || "🎮"}</div>
              <div style={{ fontSize: 12, fontWeight: 800, marginTop: 6 }}>{g.name}</div>
              <div style={{ fontSize: 9.5, color: T.cyan, marginTop: 3, fontWeight: 800, letterSpacing: "0.04em" }}>PLAY ›</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Expandable({ title, tint, defaultOpen, children }: { title: string; tint?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Card style={{ padding: 0 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", background: "transparent", border: "none", cursor: "pointer" }}>
        <Eyebrow tint={tint}>{title}</Eyebrow>
        <span style={{ color: T.inkSoft, fontSize: 16, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", lineHeight: 1 }}>›</span>
      </button>
      {open && <div style={{ padding: "0 16px 15px" }}>{children}</div>}
    </Card>
  );
}

export default function SprintPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [data, setData] = useState<Sprint | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => { const u = () => setIsDesktop(window.innerWidth >= 900); u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const q = address ? `?wallet=${address}` : "";
    const load = () => fetch(`/api/sprint${q}`, { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [address]);

  const wrap = (child: React.ReactNode) => (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 720 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 13 }}>{child}</div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );

  if (!data) return wrap(<div style={{ color: T.inkSoft, fontSize: 13, paddingTop: 46, textAlign: "center" }}>Opening the room…</div>);

  const ev = data.event;

  // ── private gate ──
  if (!data.viewer?.allowed || !ev) {
    return wrap(
      <div style={{ paddingTop: 24 }}>
        <Card style={{ textAlign: "center", padding: "34px 22px", background: `radial-gradient(120% 120% at 50% 0%, ${T.gold}14, transparent 60%), ${T.surface}` }}>
          <div style={{ fontSize: 44 }}>🔒</div>
          <div style={{ fontFamily: T.display, fontSize: 24, marginTop: 8 }}>Private sprint</div>
          <Eyebrow tint={T.gold}>Invite only</Eyebrow>
          <div style={{ color: T.inkDim, fontSize: 13.5, maxWidth: 320, lineHeight: 1.55, margin: "14px auto 0" }}>
            {address ? "This wallet isn't on the roster. If you were invited, connect the wallet you play with." : "Connect the wallet you were invited with to open the room."}
          </div>
        </Card>
      </div>,
    );
  }

  const startMs = Date.parse(ev.startsAt), endMs = Date.parse(ev.endsAt);
  const phase: "upcoming" | "live" | "ended" = now < startMs ? "upcoming" : now < endMs ? "live" : "ended";
  const countdown = phase === "upcoming" ? fmtLeft(startMs - now) : phase === "live" ? fmtLeft(endMs - now) : "";
  const stateLabel = phase === "upcoming" ? "Upcoming" : phase === "live" ? "Live now" : "Ended";
  const stateTint = phase === "live" ? T.green : phase === "ended" ? T.inkSoft : T.cyan;
  const elapsedPct = Math.max(0, Math.min(100, ((now - startMs) / (endMs - startMs)) * 100));

  const ladder = data.prizeLadder || [];
  const dollarOf = (g: number) => Math.max(1, Math.round((g / ev.poolG) * ev.usd));
  const played = data.board.filter((r) => r.rank != null);
  const podium = played.slice(0, 3);
  const rest = played.slice(3);
  const notPlayed = data.board.filter((r) => r.rank == null);
  const yourRank = data.viewer.rank;

  // ── HERO (shared across states) ──
  const hero = (
    <div>
      <Link href="/leaderboard" style={{ textDecoration: "none", color: T.inkSoft, fontSize: 12, fontWeight: 700 }}>‹ Events</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <Eyebrow tint={T.gold}>Private Sprint</Eyebrow>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: `${stateTint}1e`, border: `1px solid ${stateTint}55` }}>
          {phase === "live" && <span style={{ width: 6, height: 6, borderRadius: 999, background: T.green, boxShadow: `0 0 8px ${T.green}`, animation: "pulse-soft 1.6s ease-in-out infinite" }} />}
          <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em", color: stateTint, textTransform: "uppercase" }}>{stateLabel}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999, background: "rgba(253,230,138,0.1)", border: `1px solid ${T.gold}44` }}>
          <span style={{ fontSize: 10 }}>🔒</span>
          <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.12em", color: T.gold, textTransform: "uppercase" }}>Invite only · {ev.rosterSize}</span>
        </span>
      </div>
      <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 27, margin: "7px 0 0", letterSpacing: "-0.01em", lineHeight: 1.05 }}>The {ev.rosterSize}. One board.</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9, flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.display, fontSize: 28, color: T.gold, textShadow: `0 0 22px ${T.gold}55` }}>${ev.usd}</span>
        <span style={{ fontSize: 11, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>in G$ · top {ev.winners} split</span>
        {countdown && (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, padding: "6px 12px", borderRadius: 999, background: "rgba(251,191,36,0.12)", border: `1px solid ${T.gold}44` }}>
            <Eyebrow tint="rgba(253,230,138,0.8)">{phase === "upcoming" ? "starts in" : "ends in"}</Eyebrow>
            <span style={{ fontFamily: T.display, fontSize: 15, color: T.gold, fontVariantNumeric: "tabular-nums" }}>{countdown}</span>
          </span>
        )}
      </div>
    </div>
  );

  // ── viewer status strip ──
  const statusStrip = data.viewer.isHost ? (
    <Card style={{ borderColor: `${T.accent}55`, background: `radial-gradient(120% 140% at 100% 0%, ${T.accent}22, transparent 55%), ${T.surface}`, padding: "11px 15px" }}>
      <Eyebrow tint={T.accent}>Host view</Eyebrow>
      <div style={{ fontSize: 12.5, color: T.inkDim, marginTop: 3 }}>You can see the whole room — you&apos;re running it, not competing.</div>
    </Card>
  ) : (
    <Card style={{ borderColor: `${(yourRank && yourRank <= ev.winners) ? T.green : T.accent}55`, background: `radial-gradient(120% 140% at 100% 0%, ${(yourRank && yourRank <= ev.winners) ? T.green : T.accent}22, transparent 55%), ${T.surface}`, padding: "12px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <Eyebrow tint={(yourRank && yourRank <= ev.winners) ? T.green : T.accent}>Your standing</Eyebrow>
        <div style={{ fontFamily: T.display, fontSize: 19, marginTop: 2 }}>
          {yourRank ? `#${yourRank}` : phase === "upcoming" ? "You're in" : "Not on the board yet"}
        </div>
        <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>
          {yourRank
            ? (yourRank <= ev.winners ? `In the money · ${data.viewer.score} pts · keep climbing` : `${data.viewer.score} pts · crack the top ${ev.winners} to win`)
            : phase === "upcoming" ? "Warm up now so you start strong" : "Play any of the 3 games to join the board"}
        </div>
      </div>
      {yourRank && yourRank <= ev.winners && <span style={{ fontFamily: T.display, fontSize: 20, color: T.gold, flexShrink: 0 }}>≈${dollarOf(ladder[yourRank - 1] || 0)}</span>}
    </Card>
  );

  return wrap(
    <>
      {hero}

      {/* time progress · only while live */}
      {phase === "live" && (
        <div style={{ padding: "0 2px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <Eyebrow tint={T.green}>Sprint progress</Eyebrow>
            <span style={{ fontSize: 11, color: T.inkSoft }}>{countdown} left</span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${elapsedPct}%`, background: `linear-gradient(90deg,${T.green},${T.cyan})`, borderRadius: 999 }} />
          </div>
        </div>
      )}

      {statusStrip}

      {/* ══ UPCOMING ══ */}
      {phase === "upcoming" && (
        <>
          <Card style={{ position: "relative", overflow: "hidden", textAlign: "center", padding: "20px 18px", background: `radial-gradient(120% 130% at 50% 0%, ${T.gold}1e, transparent 62%), ${T.surface}` }}>
            <div style={{ fontFamily: T.display, fontSize: 44, color: T.gold, fontVariantNumeric: "tabular-nums", textShadow: `0 0 28px ${T.gold}55`, lineHeight: 1 }}>{countdown}</div>
            <div style={{ fontSize: 10, color: "rgba(253,230,138,0.7)", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", marginTop: 7 }}>until the sprint opens</div>
            <div style={{ fontSize: 12.5, color: T.inkDim, lineHeight: 1.5, maxWidth: 360, margin: "11px auto 0" }}>You&apos;re one of {ev.rosterSize} invited. When it opens, your best scores across the 3 games start counting. Warm up now.</div>
          </Card>

          {/* who's in · the exclusivity reveal */}
          <div>
            <Eyebrow tint={T.accent}>Who&apos;s in the room</Eyebrow>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
              {data.board.map((r) => (
                <span key={r.wallet} style={{ fontSize: 11.5, fontWeight: 700, color: r.you ? "#04121a" : T.ink, background: r.you ? T.green : "rgba(255,255,255,0.06)", border: `1px solid ${r.you ? T.green : T.hairline}`, borderRadius: 999, padding: "4px 11px" }}>
                  {r.you ? "You" : (r.name || short(r.wallet))}
                </span>
              ))}
            </div>
          </div>

          {!data.viewer.isHost && <GameShortcuts games={ev.games} />}
        </>
      )}

      {/* ══ LIVE / ENDED · the board ══ */}
      {phase !== "upcoming" && (
        <>
          <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", alignSelf: "center", textAlign: "center", padding: "0 12px" }}>
            {phase === "ended" ? "Final board · winners paid in G$" : `Best score across the 3 games · top ${ev.winners} win`}
          </div>

          {played.length === 0 ? (
            <Card style={{ padding: 26, textAlign: "center", color: T.inkSoft, fontSize: 12.5 }}>No scores yet. Be the first on the board.</Card>
          ) : (
            <>
              <Podium rows={podium} dollarOf={dollarOf} />
              {rest.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {rest.map((e) => <Pill key={e.wallet} e={e} dollarOf={dollarOf} winners={ev.winners} />)}
                </div>
              )}
            </>
          )}

          {/* not-yet-played roster, dimmed, so everyone sees the full field */}
          {notPlayed.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, opacity: 0.9 }}>
              {notPlayed.map((e) => <Pill key={e.wallet} e={e} dollarOf={dollarOf} winners={ev.winners} />)}
            </div>
          )}

          {phase === "live" && !data.viewer.isHost && <GameShortcuts games={ev.games} />}
        </>
      )}

      {/* progressive disclosure */}
      <Expandable title="How you win" defaultOpen={phase !== "ended"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12, color: T.inkDim, lineHeight: 1.5 }}>
          <div>Post your best score in each of the 3 games — <b style={{ color: T.ink }}>Rhythm Rush, Simon Memory, Stack</b>. Only your top run in each counts. They&apos;re normalised so every game is worth the same, then added into one score.</div>
          <div>Highest combined score climbs. The <b style={{ color: T.gold }}>top {ev.winners}</b> when the clock stops split the ${ev.usd} pool — and the higher you finish, the bigger your slice.</div>
          <div style={{ color: T.inkSoft }}>Only the {ev.rosterSize} invited players are in. Winners paid straight to your wallet in G$.</div>
        </div>
      </Expandable>
      <Expandable title={`Prize ladder · $${ev.usd}`} tint={T.gold}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {ladder.map((g, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: `1px solid ${T.hairline}` }}>
              <span style={{ fontSize: 12, color: i < 3 ? T.ink : T.inkDim, fontWeight: i < 3 ? 800 : 500 }}>{["🥇","🥈","🥉"][i] || ""} #{i + 1}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 10.5, color: T.inkSoft }}>{fmtG(g)} G$</span>
                <span style={{ fontFamily: T.display, fontSize: 13, color: T.gold, minWidth: 34, textAlign: "right" }}>≈${dollarOf(g)}</span>
              </span>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>Winner-weighted split of the ${ev.usd} pool. Amounts shift slightly with the final field; paid in G$.</div>
        </div>
      </Expandable>
    </>,
  );
}
