"use client";

// ─── /leaderboard/cup · The Arena Cup board ──────────────────────────────────
// Clean + state-aware. One source of truth for phase/countdown (backend window).
// The board is the focus: podium + paginated rows. Rules and prizes live behind
// expandables (progressive disclosure) so the page isn't a wall of text.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { fmtCupCountdown } from "@/lib/cup";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.5)",
  hairline: "rgba(255,255,255,0.08)",
  gold: "#fde68a",
  green: "#34d399",
  cyan: "#22d3ee",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const PAGE_SIZE = 10;

type Lane = { skill: number; consist: number; referrals: number; spendG: number; spendPts: number };
type HumanRow = { rank: number; wallet: string; username: string | null; verified: boolean; cupPoints: number; lanes: Lane };
type AgentRow = { rank: number; wallet: string; username: string | null; matches: number; wins: number; losses: number; ties: number; winRate: number; net: number; owner: { wallet: string; username: string | null } | null };
type Crown = { wallet: string; username: string | null; referrals?: number; days?: number } | null;
type Pot = { plays: number; agentMatches: number; bonusG: number; next: { at: number; bonusG: number } | null; milestones: { at: number; bonusG: number }[] } | null;
type CupData = {
  startsAt: string; endsAt: string;
  humanSplit: { key: string; label: string; usd: number }[];
  agentSplit: { key: string; label: string; usd: number }[];
  human: HumanRow[]; agent: AgentRow[];
  crowns: { connector: Crown; streak: Crown };
  pot: Pot;
  me: HumanRow | null;
};
type Entry = { rank: number; wallet: string; name: string; sub?: string; value: string; unit: string; verified: boolean; mine: boolean };

const short = (a: string) => a.slice(0, 4) + "…" + a.slice(-4);
const fmtG = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 18, padding: 16, ...style }}>{children}</div>;
}
function Eyebrow({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return <span style={{ fontFamily: T.body, fontSize: 10, color: tint ?? T.inkSoft, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>{children}</span>;
}

export default function CupPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [tab, setTab] = useState<"human" | "agent">("human");
  const [data, setData] = useState<CupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [tab]);

  useEffect(() => {
    const u = () => setIsDesktop(window.innerWidth >= 900);
    u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u);
  }, []);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let alive = true; setLoading(true);
    fetch(`/api/cup${address ? `?wallet=${address}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setData(j); })
      .catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [address]);

  // ── single source of truth: phase + countdown from the backend window ──
  const startMs = data ? Date.parse(data.startsAt) : NaN;
  const endMs = data ? Date.parse(data.endsAt) : NaN;
  const phase: "upcoming" | "live" | "ended" =
    !data || now === null ? "upcoming" : now < startMs ? "upcoming" : now >= endMs ? "ended" : "live";
  const board = phase !== "upcoming";
  const countdown = data && now !== null ? fmtCupCountdown((phase === "upcoming" ? startMs : endMs) - now) : "";
  const stateLabel = phase === "upcoming" ? "Coming soon" : phase === "live" ? "Live now" : "Sealed";
  const cdLabel = phase === "upcoming" ? "Starts in" : phase === "live" ? "Ends in" : "";

  const meLower = address?.toLowerCase();
  const pot = board ? data?.pot ?? null : null;
  const me = board ? data?.me ?? null : null;
  const potPct = pot && pot.next ? Math.min(100, Math.round((pot.plays / pot.next.at) * 100)) : pot ? 100 : 0;
  const tint = tab === "human" ? T.green : T.cyan;

  // ── ladder → common entries, podium + pagination ──
  const entries: Entry[] = !board || !data ? [] : tab === "human"
    ? data.human.map((r) => ({ rank: r.rank, wallet: r.wallet, name: r.username || short(r.wallet), value: r.cupPoints.toLocaleString(), unit: "pts", verified: r.verified, mine: r.wallet === meLower }))
    : data.agent.map((r) => ({ rank: r.rank, wallet: r.wallet, name: r.username || short(r.wallet), sub: r.owner ? `by ${r.owner.username || short(r.owner.wallet)}` : undefined, value: String(r.wins), unit: "wins", verified: true, mine: false }));
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  const totalPages = Math.max(1, Math.ceil(rest.length / PAGE_SIZE));
  const pageC = Math.min(page, totalPages - 1);
  const pageRows = rest.slice(pageC * PAGE_SIZE, (pageC + 1) * PAGE_SIZE);
  const myIdx = entries.findIndex((e) => e.mine);
  const myPage = myIdx >= 3 ? Math.floor((myIdx - 3) / PAGE_SIZE) : -1;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 720 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 12 }}>

        <Link href="/leaderboard" style={{ textDecoration: "none", color: T.inkSoft, fontSize: 12, fontWeight: 700 }}>‹ Events</Link>

        {/* ── HERO (minimal) ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Eyebrow tint={T.gold}>Arena Cup</Eyebrow>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: phase === "live" ? "rgba(52,211,153,0.16)" : "rgba(251,191,36,0.14)", border: `1px solid ${phase === "live" ? T.green : T.gold}55` }}>
              {phase === "live" && <span style={{ width: 6, height: 6, borderRadius: 999, background: T.green, boxShadow: `0 0 8px ${T.green}`, animation: "pulse-soft 1.6s ease-in-out infinite" }} />}
              <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em", color: phase === "live" ? T.green : T.gold, textTransform: "uppercase" }}>{stateLabel}</span>
            </span>
          </div>
          <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 26, margin: "6px 0 0", letterSpacing: "-0.01em", lineHeight: 1.05 }}>You + your AI vs the arena</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9, flexWrap: "wrap" }}>
            <span style={{ fontFamily: T.display, fontSize: 28, color: T.gold, textShadow: `0 0 22px ${T.gold}55` }}>$150</span>
            {countdown && (
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, padding: "6px 12px", borderRadius: 999, background: "rgba(251,191,36,0.12)", border: `1px solid ${T.gold}44` }}>
                <Eyebrow tint="rgba(253,230,138,0.8)">{cdLabel}</Eyebrow>
                <span style={{ fontFamily: T.display, fontSize: 15, color: T.gold, fontVariantNumeric: "tabular-nums" }}>{countdown}</span>
              </span>
            )}
          </div>
        </div>

        {/* ══════════ UPCOMING ══════════ */}
        {phase === "upcoming" && (
          <>
            <Card style={{ textAlign: "center", padding: "24px 18px", background: `radial-gradient(120% 140% at 50% 0%, ${T.accent}22, transparent 60%), ${T.surface}` }}>
              <div style={{ fontFamily: T.display, fontSize: 42, color: T.gold, fontVariantNumeric: "tabular-nums", textShadow: `0 0 30px ${T.gold}44` }}>{countdown || "soon"}</div>
              <div style={{ fontSize: 12.5, color: T.inkDim, marginTop: 8, lineHeight: 1.5, maxWidth: 380, margin: "8px auto 0" }}>Everyone starts at zero when it opens. Play now to warm up.</div>
              <button onClick={() => router.push("/games")} style={{ marginTop: 14, padding: "12px 28px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: T.body, fontSize: 13, fontWeight: 900, letterSpacing: "0.06em", color: "#0a0226", background: "linear-gradient(180deg,#fde68a,#fbbf24)", boxShadow: `0 8px 22px -8px ${T.gold}` }}>PLAY NOW ›</button>
            </Card>
            <Expandable title="How you climb" defaultOpen><HowBody /></Expandable>
            <Expandable title="Prizes · $150" tint={T.gold} defaultOpen><PrizeBody data={data} isDesktop={isDesktop} /></Expandable>
          </>
        )}

        {/* ══════════ LIVE / ENDED · the board ══════════ */}
        {board && (
          <>
            {pot && (
              <div style={{ padding: "2px 2px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <Eyebrow tint={T.green}>Community pot{pot.bonusG > 0 ? ` · +${fmtG(pot.bonusG)} G$` : ""}</Eyebrow>
                  <span style={{ fontSize: 11, color: T.inkSoft }}>{pot.plays.toLocaleString()}{pot.next ? ` / ${pot.next.at.toLocaleString()}` : ""}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${potPct}%`, background: `linear-gradient(90deg,${T.green},${T.cyan})`, borderRadius: 999 }} />
                </div>
              </div>
            )}

            {me ? (
              <Card style={{ borderColor: `${T.accent}55`, background: `radial-gradient(120% 140% at 100% 0%, ${T.accent}22, transparent 55%), ${T.surface}`, padding: "12px 15px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <Eyebrow tint={T.accent}>Your rank</Eyebrow>
                  <div style={{ fontFamily: T.display, fontSize: 20, marginTop: 2 }}>#{me.rank} · {me.username || short(me.wallet)}</div>
                </div>
                <span style={{ fontFamily: T.display, fontSize: 24, color: T.gold }}>{me.cupPoints.toLocaleString()}<span style={{ fontSize: 11, color: T.inkSoft }}> pts</span></span>
              </Card>
            ) : address ? (
              <div style={{ fontSize: 11.5, color: T.inkSoft, textAlign: "center" }}>Play 5 verified games to join the board.</div>
            ) : null}

            {/* tabs */}
            <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hairline}`, alignSelf: "center" }}>
              {([{ id: "human", label: "Players" }, { id: "agent", label: "Agents" }] as const).map((o) => (
                <button key={o.id} onClick={() => setTab(o.id)} style={{
                  padding: "9px 20px", borderRadius: 10, cursor: "pointer", border: "none",
                  background: tab === o.id ? (o.id === "human" ? T.green : T.cyan) : "transparent",
                  color: tab === o.id ? "#04121a" : T.inkSoft, fontFamily: T.body, fontSize: 12, fontWeight: 800, letterSpacing: "0.04em",
                }}>{o.label}</button>
              ))}
            </div>

            {loading ? (
              <Empty>Loading…</Empty>
            ) : entries.length === 0 ? (
              <Empty>{tab === "human" ? "No players yet. Be first." : <>No agents yet. <Link href="/agents" style={{ color: T.cyan }}>Deploy yours →</Link></>}</Empty>
            ) : (
              <>
                {/* podium */}
                <Podium entries={podium} />
                {/* rest · paginated glowing pills */}
                {rest.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {pageRows.map((e) => <Row key={e.wallet} e={e} tint={tint} />)}
                  </div>
                )}
                {/* pager */}
                {totalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pg label="‹ Prev" disabled={pageC === 0} onClick={() => setPage(Math.max(0, pageC - 1))} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: T.inkDim, letterSpacing: "0.06em", minWidth: 74, textAlign: "center" }}>{pageC + 1} / {totalPages}</span>
                    <Pg label="Next ›" disabled={pageC >= totalPages - 1} onClick={() => setPage(Math.min(totalPages - 1, pageC + 1))} />
                    {myPage >= 0 && myPage !== pageC && <Pg label="My row" tint={T.accent} onClick={() => setPage(myPage)} />}
                  </div>
                )}
              </>
            )}

            <Expandable title="How you climb"><HowBody /></Expandable>
            <Expandable title="Prizes · $150" tint={T.gold}><PrizeBody data={data} isDesktop={isDesktop} /></Expandable>
          </>
        )}
      </div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Card style={{ padding: 26, textAlign: "center", color: T.inkSoft, fontSize: 12.5 }}>{children}</Card>;
}

function Pg({ label, onClick, disabled, tint }: { label: string; onClick: () => void; disabled?: boolean; tint?: string }) {
  const c = tint ?? T.accent;
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      padding: "8px 15px", borderRadius: 999, cursor: disabled ? "not-allowed" : "pointer",
      background: disabled ? "rgba(255,255,255,0.04)" : `${c}26`, border: `1px solid ${disabled ? "rgba(255,255,255,0.1)" : c + "70"}`,
      color: disabled ? "rgba(200,180,255,0.35)" : "rgba(235,228,255,0.95)", fontFamily: T.body, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
    }}>{label}</button>
  );
}

// Confetti + character podium · the app's own leaderboard language
// (mirrors StagePodium on the Events All-time tab).
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
function Podium({ entries }: { entries: Entry[] }) {
  const P = [
    { char: "/characters/char1.png", e: entries[0], color: "#fbbf24", w: 18, bottom: 38, left: 50, z: 3 },
    { char: "/characters/char2.png", e: entries[1], color: "#e2e8f0", w: 16, bottom: 33, left: 32, z: 2 },
    { char: "/characters/char3.png", e: entries[2], color: "#f97316", w: 16, bottom: 32, left: 67, z: 2 },
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
            <div style={{ color: "#fff", fontSize: 12, fontWeight: 900, letterSpacing: "0.02em", textShadow: `0 0 10px ${pl.color}dd, 0 2px 4px rgba(0,0,0,0.8)` }}>{pl.e.name}</div>
            <div style={{ color: pl.color, fontFamily: T.display, fontSize: 14, textShadow: `0 0 14px ${pl.color}, 0 2px 4px rgba(0,0,0,0.8)`, marginTop: 2 }}>{pl.e.value} {pl.e.unit}</div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ e, tint }: { e: Entry; tint: string }) {
  return (
    <div style={{ borderRadius: 999, padding: 2, background: `linear-gradient(135deg, ${tint} 0%, ${tint}55 100%)`, boxShadow: `0 0 10px ${tint}40, 0 5px 14px rgba(0,0,0,0.45)` }}>
      <div style={{ borderRadius: 999, background: e.mine ? `linear-gradient(90deg, ${tint}2e 0%, rgba(20,10,50,0.92) 100%)` : "linear-gradient(90deg, rgba(24,12,56,0.92) 0%, rgba(12,6,34,0.95) 100%)", padding: "8px 15px 8px 8px", display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 999, background: `${tint}22`, border: `1px solid ${tint}66`, fontFamily: T.display, fontSize: 12.5, color: T.ink }}>{e.rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.mine ? `You · ${e.name}` : e.name}</div>
          {e.sub && <div style={{ fontSize: 10, color: T.inkSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.sub}</div>}
        </div>
        <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{e.value}<span style={{ fontSize: 9, color: T.inkSoft }}> {e.unit}</span></span>
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

function HowBody() {
  const lanes = [
    ["Skill", "your best run in each game"],
    ["Consistency", "play on separate days"],
    ["Referrals", "friends who verify and play"],
    ["G$ spend", "perks, on a curve"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {lanes.map(([t, d]) => (
        <div key={t} style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: T.accent, flexShrink: 0, transform: "translateY(-1px)" }} />
          <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 700 }}>{t}</span>
          <span style={{ fontSize: 11.5, color: T.inkSoft }}>{d}</span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 3, lineHeight: 1.5 }}>Verified players only. Scores are checked server-side, so grinding and bots earn nothing.</div>
    </div>
  );
}

function PrizeBody({ data, isDesktop }: { data: CupData | null; isDesktop: boolean }) {
  const human = data?.humanSplit ?? [{ key: "1", label: "Champion", usd: 40 }, { key: "2", label: "Runner-up", usd: 25 }, { key: "3", label: "3rd", usd: 15 }, { key: "4", label: "Top Connector", usd: 12 }, { key: "5", label: "Iron Streak", usd: 8 }];
  const agent = data?.agentSplit ?? [{ key: "1", label: "Top Agent", usd: 30 }, { key: "2", label: "2nd", usd: 12 }, { key: "3", label: "3rd", usd: 8 }];
  const Col = ({ head, tintc, rows }: { head: string; tintc: string; rows: { key: string; label: string; usd: number }[] }) => (
    <div>
      <div style={{ fontSize: 10, color: tintc, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>{head}</div>
      {rows.map((p) => (
        <div key={p.key} style={{ display: "flex", justifyContent: "space-between", padding: "3.5px 0", borderBottom: `1px solid ${T.hairline}` }}>
          <span style={{ fontSize: 12, color: T.inkDim }}>{p.label}</span>
          <span style={{ fontFamily: T.display, fontSize: 13, color: T.gold }}>${p.usd}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 16 }}>
      <Col head="Players · $100" tintc={T.green} rows={human} />
      <Col head="Agents · $50 · GoodAgents" tintc={T.cyan} rows={agent} />
    </div>
  );
}
