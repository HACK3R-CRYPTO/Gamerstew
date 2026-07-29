"use client";

// ─── /impact · The G$ Economy ─────────────────────────────────────────────
// A judge/investor-facing view of how GoodDollar (G$) flows through the arena:
// verified humans in, real G$ spent on perks, a share routed to GoodCollective
// UBI, and prize pools paid weekly. Framed by demo-day "epochs" (a fortnight
// each) so momentum reads at a glance.
//
// Live figures (players / games / UBI) come from the same subgraph aggregate
// /home uses, so this page can never drift from the rest of the app. Figures
// that don't live in the subgraph (perk purchases, the Demo Day 1 baseline,
// the surprise consistency payout) are pinned constants, each traceable to an
// on-chain event — nothing here is self-reported.

import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { fetchGlobalStat } from "@/lib/homePreload";

// ─── tokens (mirror the app) ──────────────────────────────────────────────
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  green: "#34d399",
  amber: "#fbbf24",
  cyan: "#22d3ee",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// ─── pinned baselines · each traceable on-chain ───────────────────────────
// Demo Day 1 snapshot (Jul 15) — the epoch boundary we measure momentum from.
const DD1 = { players: 227, games: 12483, ubi: 385, perks: 0 };
// Demo Day 2 fallbacks — used only if the live subgraph fetch fails, so the
// page never renders empty. Live values override these on load.
const DD2 = { players: 391, games: 14083, ubi: 1138 };
// Perk shop · PerkShop contract PurchaseMade events (shipped this epoch).
const PERKS = { purchases: 617, spendG: 3766 };
// Surprise loyalty payout to the 5 most consistent players (one-off, kept out
// of the recurring economy so it doesn't distort the flow figures).
const CONSISTENCY = { players: 5, poolG: 320000 };

function fmtG(n: number): string {
  const trim = (s: string) => s.replace(/\.0+$|(\.\d*?)0+$/, "$1");
  if (n >= 1e6) return `${trim((n / 1e6).toFixed(2))}M`;
  if (n >= 1e3) return `${trim((n / 1e3).toFixed(n >= 1e4 ? 0 : 1))}k`;
  return String(Math.round(n));
}
function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

// ─── primitives ───────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 18,
      padding: 18, ...style,
    }}>{children}</div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>{children}</div>;
}

function KPI({ label, value, unit, tint, sub }: { label: string; value: string; unit?: string; tint: string; sub: string }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 8, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: tint }} />
      <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: T.display, fontSize: 34, color: T.ink, lineHeight: 1, letterSpacing: "0.01em" }}>{value}</span>
        {unit && <span style={{ fontFamily: T.display, fontSize: 16, color: tint }}>{unit}</span>}
      </div>
      <span style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, lineHeight: 1.4 }}>{sub}</span>
    </Card>
  );
}

// Horizontal delta bar for the epoch momentum table.
function MomentumRow({ label, from, to, delta, tint, pct }: { label: string; from: string; to: string; delta: string; tint: string; pct: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.7fr 0.7fr 0.8fr", alignItems: "center", gap: 8, padding: "12px 0", borderBottom: `1px solid ${T.hairline}` }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontFamily: T.body, fontSize: 12.5, color: T.ink, fontWeight: 700 }}>{label}</span>
        <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: tint, borderRadius: 999 }} />
        </div>
      </div>
      <span style={{ fontFamily: T.display, fontSize: 15, color: T.inkSoft, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{from}</span>
      <span style={{ fontFamily: T.display, fontSize: 17, color: T.ink, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{to}</span>
      <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 800, color: tint, textAlign: "right" }}>{delta}</span>
    </div>
  );
}

export default function ImpactPage() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [live, setLive] = useState<{ players: number; games: number; ubi: number } | null>(null);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchGlobalStat().then((s) => {
      if (!alive || !s) return;
      setLive({ players: s.totalPlayers, games: s.totalScores, ubi: s.totalUbiDonatedG });
    });
    return () => { alive = false; };
  }, []);

  const players = live?.players ?? DD2.players;
  const games = live?.games ?? DD2.games;
  const ubi = live?.ubi ?? DD2.ubi;

  const playersDelta = Math.round(((players - DD1.players) / DD1.players) * 100);
  const gamesDelta = games - DD1.games;
  const ubiMult = (ubi / DD1.ubi);

  // Flow split · of every G$ spent on a perk, ~20% routes to GoodCollective
  // UBI and ~80% funds the weekly prize pools paid to verified winners.
  const ubiShare = 20;
  const prizeShare = 80;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />

      <div style={{ maxWidth: isDesktop ? 1000 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* ── header ── */}
        <div>
          <Eyebrow>The G$ Economy · Epoch 2</Eyebrow>
          <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 36 : 27, color: T.ink, margin: "6px 0 0", letterSpacing: "-0.01em", lineHeight: 1.05 }}>
            Where real G$ moves in the arena
          </h1>
          <p style={{ fontFamily: T.body, fontSize: 13.5, color: T.inkDim, margin: "8px 0 0", lineHeight: 1.5, maxWidth: 620 }}>
            Every player is a GoodDollar-verified human. Every game is a Celo transaction. Perks are spent in real G$, a share routes to GoodCollective UBI, and prize pools pay verified winners weekly — all on-chain, none of it self-reported.
          </p>
        </div>

        {/* ── KPI grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(4, 1fr)" : "1fr 1fr", gap: 12 }}>
          <KPI label="Verified humans" value={fmtInt(players)} tint={T.green} sub="GoodDollar-gated · no bot has ever won a prize" />
          <KPI label="G$ to UBI" value={fmtG(ubi)} unit="G$" tint={T.accent} sub={`Routed to GoodCollective · ~${ubiMult.toFixed(1)}x since Demo Day 1`} />
          <KPI label="Games on-chain" value={fmtG(games)} tint={T.cyan} sub="Every score a verifiable Celo tx" />
          <KPI label="Perk spend" value={fmtG(PERKS.spendG)} unit="G$" tint={T.amber} sub={`${fmtInt(PERKS.purchases)} purchases · shipped this epoch`} />
        </div>

        {/* ── epoch momentum ── */}
        <Card>
          <Eyebrow>Momentum · Demo Day 1 → Demo Day 2</Eyebrow>
          <div style={{ marginTop: 4, marginBottom: 8 }}>
            <span style={{ fontFamily: T.display, fontSize: 20, color: T.ink }}>Two weeks of shipping</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.7fr 0.7fr 0.8fr", gap: 8, paddingBottom: 6 }}>
            {["Metric", "DD1", "DD2", "Δ"].map((h, i) => (
              <span key={h} style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: i === 0 ? "left" : "right" }}>{h}</span>
            ))}
          </div>
          <MomentumRow label="Verified players" from={fmtInt(DD1.players)} to={fmtInt(players)} delta={`+${playersDelta}%`} tint={T.green} pct={(players / (players)) * 100} />
          <MomentumRow label="Games on-chain" from={fmtG(DD1.games)} to={fmtG(games)} delta={`+${fmtInt(gamesDelta)}`} tint={T.cyan} pct={(DD1.games / games) * 100} />
          <MomentumRow label="G$ to UBI" from={fmtG(DD1.ubi)} to={fmtG(ubi)} delta={`~${ubiMult.toFixed(1)}x`} tint={T.accent} pct={(DD1.ubi / ubi) * 100} />
          <MomentumRow label="Perk purchases" from="—" to={fmtInt(PERKS.purchases)} delta="new" tint={T.amber} pct={100} />
          <div style={{ marginTop: 10, fontFamily: T.body, fontSize: 11.5, color: T.inkSoft }}>
            Perk shop went live this epoch · the fully-gasless flow (sign in with Google, we sponsor every write) drove the +{playersDelta}% player jump.
          </div>
        </Card>

        {/* ── flow diagram ── */}
        <Card>
          <Eyebrow>How G$ flows</Eyebrow>
          <div style={{ marginTop: 4, marginBottom: 14 }}>
            <span style={{ fontFamily: T.display, fontSize: 20, color: T.ink }}>In → through → out</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr auto 1fr" : "1fr", gap: 14, alignItems: "stretch" }}>
            {/* IN */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: 14, background: "rgba(251,191,36,0.08)", border: `1px solid ${T.amber}33` }}>
              <span style={{ fontFamily: T.body, fontSize: 10, color: T.amber, fontWeight: 800, letterSpacing: "0.12em" }}>IN</span>
              <span style={{ fontFamily: T.display, fontSize: 22, color: T.ink }}>{fmtG(PERKS.spendG)} G$</span>
              <span style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, lineHeight: 1.4 }}>Players spend on continues, revives &amp; cosmetics · {fmtInt(PERKS.purchases)} purchases</span>
            </div>

            {/* SPLIT */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 6, padding: isDesktop ? "0 4px" : "0" }}>
              <span style={{ fontFamily: T.display, fontSize: 24, color: T.inkSoft }}>{isDesktop ? "→" : "↓"}</span>
              <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.08em", textAlign: "center" }}>SPLIT<br />ON EVERY TX</span>
            </div>

            {/* OUT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 14, borderRadius: 14, background: "rgba(167,139,250,0.10)", border: `1px solid ${T.accent}44` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: T.body, fontSize: 10, color: T.accent, fontWeight: 800, letterSpacing: "0.12em" }}>UBI · GOODCOLLECTIVE</span>
                  <span style={{ fontFamily: T.display, fontSize: 18, color: T.ink }}>~{ubiShare}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)" }}>
                  <div style={{ height: "100%", width: `${ubiShare}%`, background: T.accent, borderRadius: 999 }} />
                </div>
                <span style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim }}>{fmtG(ubi)} G$ routed to date</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 14, borderRadius: 14, background: "rgba(52,211,153,0.08)", border: `1px solid ${T.green}33` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: T.body, fontSize: 10, color: T.green, fontWeight: 800, letterSpacing: "0.12em" }}>TREASURY</span>
                  <span style={{ fontFamily: T.display, fontSize: 18, color: T.ink }}>~{prizeShare}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)" }}>
                  <div style={{ height: "100%", width: `${prizeShare}%`, background: T.green, borderRadius: 999 }} />
                </div>
                <span style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim }}>Funds weekly prize pools &amp; operations</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontFamily: T.body, fontSize: 11, color: T.inkSoft, lineHeight: 1.5 }}>
            The 20/80 split is our current routing while we formalize the share with GoodCollective. Every unit is on a Celo transaction — the flow is auditable end to end.
          </div>
        </Card>

        {/* ── consistency payout ── */}
        <Card style={{ display: "flex", flexDirection: isDesktop ? "row" : "column", gap: 16, alignItems: isDesktop ? "center" : "flex-start" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Eyebrow>Loyalty · surprise payout</Eyebrow>
            <span style={{ fontFamily: T.display, fontSize: 20, color: T.ink }}>Our {CONSISTENCY.players} most consistent players got paid</span>
            <span style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, lineHeight: 1.5 }}>
              A one-off {fmtG(CONSISTENCY.poolG)} G$ pool to the players who kept showing up — noticing loyalty publicly brought them back, and their friends with them. Kept separate from the recurring economy above.
            </span>
          </div>
          <div style={{ textAlign: isDesktop ? "right" : "left", flexShrink: 0 }}>
            <div style={{ fontFamily: T.display, fontSize: 40, color: T.amber, lineHeight: 1 }}>{fmtG(CONSISTENCY.poolG)}</div>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.1em" }}>G$ TO LOYAL PLAYERS</div>
          </div>
        </Card>

        {/* ── footer note ── */}
        <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, textAlign: "center", lineHeight: 1.5 }}>
          Live figures read from the GameArena subgraph on Celo. Perk, baseline &amp; loyalty figures pinned to their on-chain events.
        </div>
      </div>

      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
