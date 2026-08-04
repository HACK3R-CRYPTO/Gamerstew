"use client";

// ─── /leaderboard/cup · The Arena Cup board ──────────────────────────────────
// Two ladders on one page (🎮 Human Cup + 🤖 Agent Cup), the community pot, and
// your own standing. Before the event it shows the countdown + how-to-climb;
// during/after it shows live ranks from /api/cup.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import CupCountdown from "@/components/CupCountdown";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  gold: "#fde68a",
  green: "#34d399",
  cyan: "#22d3ee",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

type Lane = { skill: number; consist: number; referrals: number; spendG: number; spendPts: number };
type HumanRow = { rank: number; wallet: string; username: string | null; verified: boolean; cupPoints: number; lanes: Lane };
type AgentRow = { rank: number; wallet: string; username: string | null; matches: number; wins: number; losses: number; ties: number; winRate: number; net: number; owner: { wallet: string; username: string | null } | null };
type Crown = { wallet: string; username: string | null; referrals?: number; days?: number } | null;
type Pot = { plays: number; agentMatches: number; bonusG: number; next: { at: number; bonusG: number } | null; milestones: { at: number; bonusG: number }[] } | null;
type CupData = {
  phase: "upcoming" | "live" | "ended";
  humanSplit: { key: string; label: string; usd: number }[];
  agentSplit: { key: string; label: string; usd: number }[];
  human: HumanRow[]; agent: AgentRow[];
  crowns: { connector: Crown; streak: Crown };
  pot: Pot;
  me: HumanRow | null;
};

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const fmtG = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 18, padding: 16, ...style }}>{children}</div>;
}
function Eyebrow({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return <div style={{ fontFamily: T.body, fontSize: 10.5, color: tint ?? T.inkSoft, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>{children}</div>;
}
const medal = (r: number) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `${r}`);

export default function CupPage() {
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [tab, setTab] = useState<"human" | "agent">("human");
  const [data, setData] = useState<CupData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u = () => setIsDesktop(window.innerWidth >= 900);
    u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/cup${address ? `?wallet=${address}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setData(j); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [address]);

  const phase = data?.phase ?? "upcoming";
  const pot = data?.pot ?? null;
  const potPct = pot && pot.next ? Math.min(100, Math.round((pot.plays / pot.next.at) * 100)) : pot ? 100 : 0;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 900 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 14 }}>

        <Link href="/leaderboard" style={{ textDecoration: "none", color: T.inkSoft, fontFamily: T.body, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>‹ Events</Link>

        {/* ── header ── */}
        <div>
          <Eyebrow tint={T.gold}>Arena Cup · {phase === "live" ? "Live now" : phase === "ended" ? "Sealed" : "Coming soon"}</Eyebrow>
          <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 34 : 26, margin: "6px 0 0", letterSpacing: "-0.01em" }}>You + your AI vs the arena</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: T.display, fontSize: 26, color: T.gold, textShadow: `0 0 20px ${T.gold}55` }}>$150</span>
            <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>in G$</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 999, background: "rgba(251,191,36,0.14)", border: `1px solid ${T.gold}55` }}>
              <CupCountdown
                labelStyle={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(253,230,138,0.8)", textTransform: "uppercase" }}
                timeStyle={{ fontFamily: T.display, fontSize: 15, color: T.gold }}
              />
            </span>
          </div>
        </div>

        {/* ── community pot ── */}
        {pot && (
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <Eyebrow tint={T.green}>Community pot</Eyebrow>
              <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim }}>{pot.plays.toLocaleString()} plays{pot.next ? ` / ${pot.next.at.toLocaleString()}` : ""}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${potPct}%`, background: `linear-gradient(90deg, ${T.green}, ${T.cyan})`, borderRadius: 999 }} />
            </div>
            <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkSoft, marginTop: 7 }}>
              {pot.bonusG > 0 && <span style={{ color: T.green, fontWeight: 700 }}>+{fmtG(pot.bonusG)} G$ unlocked. </span>}
              {pot.next ? `Hit ${pot.next.at.toLocaleString()} plays → +${fmtG(pot.next.bonusG)} G$ for everyone.` : "Every play grows the side-pool for all qualifiers."}
            </div>
          </Card>
        )}

        {/* ── how to climb (always shown; the only content pre-launch) ── */}
        <Card>
          <Eyebrow>How you climb — 4 lanes, each capped</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 8, marginTop: 10 }}>
            {[
              { i: "🎯", t: "Skill", d: "Your best run per game. Peak, not grind." },
              { i: "📅", t: "Consistency", d: "Play on distinct days. One per day." },
              { i: "🤝", t: "Referrals", d: "Friends who verify + play. Sybil-proof." },
              { i: "💠", t: "G$ spend", d: "Perks in G$. Rewarded on a √ curve." },
            ].map((l) => (
              <div key={l.t} style={{ display: "flex", gap: 9, padding: "8px 4px" }}>
                <span style={{ fontSize: 18 }}>{l.i}</span>
                <div>
                  <div style={{ fontFamily: T.body, fontSize: 12.5, fontWeight: 800, color: T.ink }}>{l.t}</div>
                  <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, lineHeight: 1.4 }}>{l.d}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>
            Verified humans only. Server-checked scores. No farming — skill decides it.
          </div>
        </Card>

        {/* ── my standing ── */}
        {data?.me && (
          <Card style={{ borderColor: `${T.accent}55`, background: `radial-gradient(120% 140% at 100% 0%, ${T.accent}22, transparent 55%), ${T.surface}` }}>
            <Eyebrow tint={T.accent}>Your standing</Eyebrow>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontFamily: T.display, fontSize: 22 }}>#{data.me.rank} · {data.me.username || short(data.me.wallet)}</span>
              <span style={{ fontFamily: T.display, fontSize: 22, color: T.gold }}>{data.me.cupPoints.toLocaleString()} <span style={{ fontSize: 12, color: T.inkSoft }}>pts</span></span>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, marginTop: 6 }}>
              Skill {data.me.lanes.skill} · Days {data.me.lanes.consist} · Refs {data.me.lanes.referrals} · Spend {data.me.lanes.spendPts}
            </div>
          </Card>
        )}

        {/* ── crowns ── */}
        {(data?.crowns?.connector || data?.crowns?.streak) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {data.crowns.connector && (
              <Card><Eyebrow tint={T.green}>Top Connector · $12</Eyebrow><div style={{ fontFamily: T.display, fontSize: 16, marginTop: 6 }}>{data.crowns.connector.username || short(data.crowns.connector.wallet)}</div><div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft }}>{data.crowns.connector.referrals} verified referrals</div></Card>
            )}
            {data.crowns.streak && (
              <Card><Eyebrow tint={T.cyan}>Iron Streak · $8</Eyebrow><div style={{ fontFamily: T.display, fontSize: 16, marginTop: 6 }}>{data.crowns.streak.username || short(data.crowns.streak.wallet)}</div><div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft }}>{data.crowns.streak.days} days played</div></Card>
            )}
          </div>
        )}

        {/* ── ladder tabs ── */}
        <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hairline}`, alignSelf: "flex-start" }}>
          {([{ id: "human", label: "🎮 Human Cup" }, { id: "agent", label: "🤖 Agent Cup" }] as const).map((o) => (
            <button key={o.id} onClick={() => setTab(o.id)} style={{
              padding: "9px 16px", borderRadius: 10, cursor: "pointer", border: "none",
              background: tab === o.id ? (o.id === "human" ? T.green : T.cyan) : "transparent",
              color: tab === o.id ? "#04121a" : T.inkSoft, fontFamily: T.body, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em",
            }}>{o.label}</button>
          ))}
        </div>

        {/* ── ladder ── */}
        <Card style={{ padding: 6 }}>
          {loading ? (
            <div style={{ padding: 28, textAlign: "center", color: T.inkSoft, fontFamily: T.body, fontSize: 12 }}>Loading the board…</div>
          ) : phase === "upcoming" ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontFamily: T.display, fontSize: 18, color: T.ink }}>The board opens Friday.</div>
              <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkSoft, marginTop: 6 }}>Play now to warm up — the ladder resets to zero when the Cup starts. Everyone starts fair.</div>
            </div>
          ) : tab === "human" ? (
            (data?.human ?? []).length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: T.inkSoft, fontFamily: T.body, fontSize: 12 }}>No qualifying players yet. Be first.</div>
            ) : (
              data!.human.map((r) => (
                <Row key={r.wallet} rank={r.rank} name={r.username || short(r.wallet)} highlight={r.wallet === address?.toLowerCase()} verified={r.verified}
                  right={`${r.cupPoints.toLocaleString()} pts`} sub={`Skill ${r.lanes.skill} · Days ${r.lanes.consist} · Refs ${r.lanes.referrals} · Spend ${r.lanes.spendPts}`} tint={T.green} />
              ))
            )
          ) : (
            (data?.agent ?? []).length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: T.inkSoft, fontFamily: T.body, fontSize: 12 }}>No agents in the arena yet. <Link href="/agents" style={{ color: T.cyan }}>Deploy yours →</Link></div>
            ) : (
              data!.agent.map((r) => (
                <Row key={r.wallet} rank={r.rank} name={`🤖 ${r.username || short(r.wallet)}`} verified
                  right={`${r.wins}W`}
                  sub={`${r.owner ? `by ${r.owner.username || short(r.owner.wallet)} · ` : ""}${r.matches} matches · ${r.winRate}% win`} tint={T.cyan} />
              ))
            )
          )}
        </Card>

        {/* ── prize split ── */}
        {data && (
          <Card>
            <Eyebrow tint={T.gold}>Where the $150 goes</Eyebrow>
            <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 14, marginTop: 10 }}>
              <div>
                <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.green, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>🎮 Human Cup · $100</div>
                {data.humanSplit.map((p) => <SplitRow key={p.key} label={p.label} usd={p.usd} />)}
              </div>
              <div>
                <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.cyan, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>🤖 Agent Cup · $50 · GoodAgents</div>
                {data.agentSplit.map((p) => <SplitRow key={p.key} label={p.label} usd={p.usd} />)}
              </div>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, marginTop: 10, lineHeight: 1.5 }}>
              Everyone who plays ≥5 verified games + a new personal best earns a Passport badge and a share of the community G$ side-pool.
            </div>
          </Card>
        )}
      </div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );
}

function Row({ rank, name, right, sub, tint, highlight, verified }: { rank: number; name: string; right: string; sub: string; tint: string; highlight?: boolean; verified?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 12, background: highlight ? `${tint}1a` : "transparent", borderBottom: `1px solid ${T.hairline}` }}>
      <span style={{ fontFamily: T.display, fontSize: rank <= 3 ? 18 : 14, width: 30, textAlign: "center", color: rank <= 3 ? T.gold : T.inkSoft }}>{medal(rank)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
          {verified && <span title="GoodDollar verified" style={{ fontSize: 10 }}>✅</span>}
        </div>
        <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, marginTop: 1 }}>{sub}</div>
      </div>
      <span style={{ fontFamily: T.display, fontSize: 16, color: tint, fontVariantNumeric: "tabular-nums" }}>{right}</span>
    </div>
  );
}

function SplitRow({ label, usd }: { label: string; usd: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${T.hairline}` }}>
      <span style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim }}>{label}</span>
      <span style={{ fontFamily: T.display, fontSize: 13, color: T.gold }}>${usd}</span>
    </div>
  );
}
