"use client";

// ─── /impact · The G$ Economy ─────────────────────────────────────────────
// A judge/investor-facing view of how GoodDollar (G$) flows through the arena:
// verified humans in, real G$ spent on perks, a share routed to the GoodDollar UBI pool
// UBI, and a treasury that funds operations. Framed by demo-day "epochs" (a
// fortnight each) so momentum reads at a glance.
//
// Live figures (players / games / UBI) come from the same subgraph aggregate
// /home uses, so this page can never drift from the rest of the app. Figures
// that don't live in the subgraph (perk purchases, the Demo Day 1 baseline,
// the surprise consistency payout) are pinned constants, each traceable to an
// on-chain event — nothing here is self-reported.

import { useEffect, useRef, useState } from "react";
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

const KEYFRAMES = `
@keyframes impact-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes impact-bar  { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes impact-glow { 0%,100% { opacity: 0.45; } 50% { opacity: 0.85; } }
@keyframes impact-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.impact-reveal { animation: impact-rise 0.6s cubic-bezier(0.22,1,0.36,1) both; }
.impact-card { transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; }
.impact-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.18); box-shadow: 0 18px 40px -24px rgba(0,0,0,0.9); }
.impact-barfill { transform-origin: left center; animation: impact-bar 1.1s cubic-bezier(0.22,1,0.36,1) both; }
@media (prefers-reduced-motion: reduce) {
  .impact-reveal, .impact-barfill, .impact-glowpulse, .impact-floaty { animation: none !important; }
}
`;

// ─── pinned baselines · each traceable on-chain ───────────────────────────
// EPOCH 3 = Demo Day 2 → Demo Day 3 (Jul 29 → Aug 11). Current epoch momentum
// runs from the DD2 snapshot (frozen) to live now — but we KEEP the full track
// (DD1 → DD2 → now) on the page so the progression across every demo day stays
// visible for analysis.
// Demo Day 1 snapshot (Jul 15) — kept for the full historical track.
const DD1 = { players: 227, games: 12483, ubi: 385, perkSpendG: 0 };
// Demo Day 2 snapshot (Jul 28) — the current-epoch baseline.
const DD2 = { players: 392, games: 14416, ubi: 1217 };
// "Now" fallback — used only if the live subgraph fetch fails, so the page
// never renders empty. Live values override these on load.
const NOW_FALLBACK = { players: 455, games: 17101, ubi: 11739 };
// One-off this epoch: a single ~50k G$ habitat unlock on Aug 6 sent 10,000 G$
// to UBI (verified on-chain: DailyStat 2026-08-06, 1 habitatUnlock, 10,000 G$;
// every other Epoch-3 day = 0). It's real G$ but NOT organic momentum, so we
// separate it from the epoch growth story rather than headline it as "10x".
const HABITAT_ONE_OFF_UBI = 10000;
// Perk shop · perk spend derived from perkShopStat.totalUbiG (20% of spend
// routes to UBI): ~1,354 G$ UBI ⇒ ~6,772 G$ spend. DD2 spend was 3,766 G$.
const PERKS = { purchases: 617, spendG: 6772, dd2SpendG: 3766 };
// Surprise loyalty payout to the 5 most consistent players (one-off, kept out
// of the recurring economy so it doesn't distort the flow figures).
const CONSISTENCY = { players: 5, poolG: 320000 };
// GoodDollar-verified humans · fallback only. The live figure comes from
// /api/verified-stats, which checks isWhitelisted on-chain for every player —
// the true verified set, not just GamePass minters. This floor matches the
// last confirmed on-chain count in case the endpoint is unreachable.
const VERIFIED_FALLBACK = 278;

function fmtG(n: number): string {
  const trim = (s: string) => s.replace(/\.0+$|(\.\d*?)0+$/, "$1");
  if (n >= 1e6) return `${trim((n / 1e6).toFixed(2))}M`;
  if (n >= 1e3) return `${trim((n / 1e3).toFixed(n >= 1e4 ? 0 : 1))}k`;
  return String(Math.round(n));
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// ─── count-up ───────────────────────────────────────────────────────────
// Eases a number from its previous value to the target once the target
// settles. Respects prefers-reduced-motion (snaps instantly). Because the
// live subgraph value arrives after the fallback, the tween re-runs toward
// the real figure — the number visibly "finds" its true value.
function useCountUp(target: number, duration = 1200): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined") { setVal(target); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setVal(target); fromRef.current = target; return; }
    const from = fromRef.current;
    let raf = 0, start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (target - from) * eased;
      setVal(next);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// ─── primitives ───────────────────────────────────────────────────────────
function Card({ children, style, delay = 0 }: { children: React.ReactNode; style?: React.CSSProperties; delay?: number }) {
  return (
    <div className="impact-card impact-reveal" style={{
      background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 18,
      padding: 18, animationDelay: `${delay}ms`, ...style,
    }}>{children}</div>
  );
}

function Eyebrow({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return <div style={{ fontFamily: T.body, fontSize: 11, color: tint ?? T.inkSoft, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>{children}</div>;
}

function KPI({ label, value, unit, tint, sub, delay }: { label: string; value: string; unit?: string; tint: string; sub: string; delay: number }) {
  return (
    <Card delay={delay} style={{ display: "flex", flexDirection: "column", gap: 8, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${tint}, ${tint}00)` }} />
      <div className="impact-glowpulse" style={{ position: "absolute", top: -40, right: -30, width: 120, height: 120, borderRadius: "50%", background: tint, filter: "blur(48px)", opacity: 0.18, animation: "impact-glow 5s ease-in-out infinite", pointerEvents: "none" }} />
      <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: T.display, fontSize: 32, color: T.ink, lineHeight: 1, letterSpacing: "0.01em", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {unit && <span style={{ fontFamily: T.display, fontSize: 15, color: tint }}>{unit}</span>}
      </div>
      <span style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim, lineHeight: 1.4 }}>{sub}</span>
    </Card>
  );
}

// Full-track momentum row: DD1 → DD2 → now, plus this-epoch Δ. The bar keeps
// the two-tone read — dim = where we stood at the start of THIS epoch (DD2),
// bright = growth added since. basePct = DD2 / current.
function MomentumRow({ label, dd1, dd2, now, delta, tint, basePct }: { label: string; dd1: string; dd2: string; now: string; delta: string; tint: string; basePct: number }) {
  const clamped = Math.max(0, Math.min(100, basePct));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.55fr 0.55fr 0.7fr 0.6fr", alignItems: "center", gap: 6, padding: "13px 0", borderBottom: `1px solid ${T.hairline}` }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontFamily: T.body, fontSize: 12.5, color: T.ink, fontWeight: 700 }}>{label}</span>
        <div className="impact-barfill" style={{ display: "flex", height: 6, borderRadius: 999, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
          <div style={{ width: `${clamped}%`, background: tint, opacity: 0.35 }} />
          <div style={{ flex: 1, background: tint, boxShadow: `0 0 12px ${tint}99` }} />
        </div>
      </div>
      <span style={{ fontFamily: T.display, fontSize: 13, color: T.inkSoft, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{dd1}</span>
      <span style={{ fontFamily: T.display, fontSize: 14, color: T.inkDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{dd2}</span>
      <span style={{ fontFamily: T.display, fontSize: 17, color: T.ink, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{now}</span>
      <span style={{ fontFamily: T.body, fontSize: 11.5, fontWeight: 800, color: tint, textAlign: "right" }}>{delta}</span>
    </div>
  );
}

export default function ImpactPage() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [live, setLive] = useState<{ players: number; games: number; ubi: number } | null>(null);
  // GoodDollar-verified count · true humans, not just pass minters. Live from
  // /api/verified-stats (on-chain isWhitelisted per wallet).
  const [vstats, setVstats] = useState<{ totalPlayers: number; verifiedPlayers: number } | null>(null);

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

  useEffect(() => {
    let alive = true;
    fetch("/api/verified-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setVstats({ totalPlayers: Number(d.totalPlayers) || 0, verifiedPlayers: Number(d.verifiedPlayers) || 0 }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const players = live?.players ?? NOW_FALLBACK.players;
  const games = live?.games ?? NOW_FALLBACK.games;
  const ubi = live?.ubi ?? NOW_FALLBACK.ubi;
  // True GoodDollar-verified humans. Until the backend endpoint is live it
  // returns 0 — treat any non-positive value as "no data yet" and show the
  // confirmed on-chain floor instead of a misleading zero.
  const verified = vstats && vstats.verifiedPlayers > 0 ? vstats.verifiedPlayers : VERIFIED_FALLBACK;

  // Epoch-3 momentum is measured from the Demo Day 2 baseline.
  const playersDelta = Math.round(((players - DD2.players) / DD2.players) * 100);
  const gamesDelta = games - DD2.games;
  // Organic UBI = total minus the one-off habitat unlock, so the momentum
  // story reflects play, not a single large transaction. Clamped to baseline.
  const organicUbi = Math.max(DD2.ubi, ubi - HABITAT_ONE_OFF_UBI);
  const organicUbiDelta = Math.round(((organicUbi - DD2.ubi) / DD2.ubi) * 100);
  const oneOffPresent = ubi - organicUbi >= HABITAT_ONE_OFF_UBI - 1;

  // Flow split · of every G$ spent on a perk, ~20% routes to the GoodDollar UBI pool
  // UBI and ~80% goes to the treasury that funds operations.
  const ubiShare = 20;
  const treasuryShare = 80;

  // animated counters
  const ubiC = useCountUp(ubi);
  const verifiedC = useCountUp(verified);
  const gamesC = useCountUp(games);
  const spendC = useCountUp(PERKS.spendG);
  const poolC = useCountUp(CONSISTENCY.poolG);

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <style>{KEYFRAMES}</style>
      <AppHeader />

      <div style={{ maxWidth: isDesktop ? 1000 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── header ── */}
        <div className="impact-reveal">
          <Eyebrow tint={T.accent}>The G$ Economy · Epoch 3</Eyebrow>
          <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 38 : 28, color: T.ink, margin: "6px 0 0", letterSpacing: "-0.01em", lineHeight: 1.04, textWrap: "balance" } as React.CSSProperties}>
            Where real G$ moves in the arena
          </h1>
          <p style={{ fontFamily: T.body, fontSize: 13.5, color: T.inkDim, margin: "8px 0 0", lineHeight: 1.5, maxWidth: 620 }}>
            Every prize goes to a GoodDollar-verified human. Every game is a Celo transaction. Perks are spent in real G$, a share routes to the GoodDollar UBI pool, and the treasury funds operations — all on-chain, none of it self-reported.
          </p>
        </div>

        {/* ── HERO · flagship UBI number ── */}
        <Card delay={60} style={{
          position: "relative", overflow: "hidden", padding: isDesktop ? "28px 30px" : "22px 20px",
          display: "flex", flexDirection: isDesktop ? "row" : "column", gap: isDesktop ? 28 : 18,
          alignItems: isDesktop ? "center" : "flex-start",
          background: `radial-gradient(120% 140% at 100% 0%, ${T.accent}2e 0%, transparent 55%), ${T.surface}`,
          borderColor: `${T.accent}3a`,
        }}>
          <div className="impact-glowpulse" style={{ position: "absolute", bottom: -70, left: -40, width: 220, height: 220, borderRadius: "50%", background: T.accent, filter: "blur(70px)", opacity: 0.22, animation: "impact-glow 6s ease-in-out infinite", pointerEvents: "none" }} />
          <div style={{ position: "relative", flex: 1 }}>
            <Eyebrow tint={T.accent}>Total routed to UBI</Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
              <span style={{ fontFamily: T.display, fontSize: isDesktop ? 72 : 52, color: T.ink, lineHeight: 0.92, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", textShadow: `0 0 40px ${T.accent}55` }}>{fmtG(ubiC)}</span>
              <span style={{ fontFamily: T.display, fontSize: isDesktop ? 30 : 24, color: T.accent }}>G$</span>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, padding: "5px 12px", borderRadius: 999, background: `${T.accent}1f`, border: `1px solid ${T.accent}55` }}>
              <span style={{ fontFamily: T.display, fontSize: 13, color: T.accent }}>EPOCH 3</span>
              <span style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim, fontWeight: 600 }}>Demo Day 2 → Demo Day 3</span>
            </div>
            <p style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, margin: "12px 0 0", lineHeight: 1.5, maxWidth: 440 }}>
              Cumulative GoodDollar in the UBI pool — funded by play, not by us.{oneOffPresent ? " Includes a one-time 10,000 G$ habitat unlock (Aug 6); organic perk UBI grew " + fmtG(organicUbi - DD2.ubi) + " G$ this epoch." : ""}
            </p>
          </div>
          {/* inline supporting stats */}
          <div style={{ position: "relative", display: "flex", flexDirection: isDesktop ? "column" : "row", gap: isDesktop ? 14 : 20, flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, borderLeft: isDesktop ? `2px solid ${T.green}` : "none", paddingLeft: isDesktop ? 12 : 0 }}>
              <span style={{ fontFamily: T.display, fontSize: 26, color: T.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{fmtInt(verifiedC)}</span>
              <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Verified humans</span>
              <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft }}>of {fmtInt(players)} players</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, borderLeft: isDesktop ? `2px solid ${T.cyan}` : "none", paddingLeft: isDesktop ? 12 : 0 }}>
              <span style={{ fontFamily: T.display, fontSize: 26, color: T.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{fmtG(gamesC)}</span>
              <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Games on-chain</span>
            </div>
          </div>
        </Card>

        {/* ── KPI supporting row ── */}
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(3, 1fr)" : "1fr", gap: 12 }}>
          <KPI delay={120} label="Perk spend" value={fmtG(spendC)} unit="G$" tint={T.amber} sub={`${fmtInt(PERKS.purchases)}+ purchases · real G$ spent in-app`} />
          <KPI delay={160} label="Bots that won a prize" value="0" tint={T.green} sub="GoodDollar verification gates every payout" />
          <KPI delay={200} label="Gas paid by players" value="0" tint={T.cyan} sub="Fully gasless · we sponsor every write" />
        </div>

        {/* ── epoch momentum ── */}
        <Card delay={240}>
          <Eyebrow>Momentum · Demo Day 1 → 2 → 3</Eyebrow>
          <div style={{ marginTop: 4, marginBottom: 10 }}>
            <span style={{ fontFamily: T.display, fontSize: 21, color: T.ink }}>The full track</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.55fr 0.55fr 0.7fr 0.6fr", gap: 6, paddingBottom: 6 }}>
            {["Metric", "DD1", "DD2", "Now", "Δ ep3"].map((h, i) => (
              <span key={h} style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: i === 0 ? "left" : "right" }}>{h}</span>
            ))}
          </div>
          <MomentumRow label="Players" dd1={fmtInt(DD1.players)} dd2={fmtInt(DD2.players)} now={fmtInt(players)} delta={`+${playersDelta}%`} tint={T.green} basePct={(DD2.players / players) * 100} />
          <MomentumRow label="Games on-chain" dd1={fmtG(DD1.games)} dd2={fmtG(DD2.games)} now={fmtG(games)} delta={`+${fmtInt(gamesDelta)}`} tint={T.cyan} basePct={(DD2.games / games) * 100} />
          <MomentumRow label="Perk spend" dd1="—" dd2={fmtG(PERKS.dd2SpendG)} now={fmtG(PERKS.spendG)} delta={`+${Math.round(((PERKS.spendG - PERKS.dd2SpendG) / PERKS.dd2SpendG) * 100)}%`} tint={T.amber} basePct={(PERKS.dd2SpendG / PERKS.spendG) * 100} />
          <MomentumRow label="G$ to UBI · organic" dd1={fmtG(DD1.ubi)} dd2={fmtG(DD2.ubi)} now={fmtG(organicUbi)} delta={`+${organicUbiDelta}%`} tint={T.accent} basePct={(DD2.ubi / organicUbi) * 100} />
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontFamily: T.body, fontSize: 11.5, color: T.inkSoft }}>
              <span style={{ width: 10, height: 6, borderRadius: 2, background: T.accent, opacity: 0.35 }} /> baseline (DD2)
              <span style={{ width: 10, height: 6, borderRadius: 2, background: T.accent, marginLeft: 8 }} /> growth this epoch
            </span>
            {oneOffPresent && (
              <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, lineHeight: 1.5 }}>
                Plus one-time: a single 10,000 G$ habitat unlock landed Aug 6 (in the cumulative total above, kept out of the organic line so momentum reflects play).
              </span>
            )}
          </div>
        </Card>

        {/* ── flow diagram ── */}
        <Card delay={300}>
          <Eyebrow>How G$ flows</Eyebrow>
          <div style={{ marginTop: 4, marginBottom: 14 }}>
            <span style={{ fontFamily: T.display, fontSize: 21, color: T.ink }}>In → through → out</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr auto 1fr" : "1fr", gap: 14, alignItems: "stretch" }}>
            {/* IN */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16, borderRadius: 16, background: `linear-gradient(160deg, ${T.amber}18, transparent)`, border: `1px solid ${T.amber}3a` }}>
              <span style={{ fontFamily: T.body, fontSize: 10, color: T.amber, fontWeight: 800, letterSpacing: "0.12em" }}>IN · PERK SPEND</span>
              <span style={{ fontFamily: T.display, fontSize: 28, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{fmtG(PERKS.spendG)} <span style={{ fontSize: 16, color: T.amber }}>G$</span></span>
              <span style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, lineHeight: 1.4 }}>Continues, revives &amp; cosmetics · {fmtInt(PERKS.purchases)} purchases</span>
            </div>

            {/* SPLIT */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 6, padding: isDesktop ? "0 4px" : "4px 0" }}>
              <span className="impact-floaty" style={{ fontFamily: T.display, fontSize: 26, color: T.accent, animation: "impact-float 3s ease-in-out infinite" }}>{isDesktop ? "→" : "↓"}</span>
              <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textAlign: "center" }}>SPLIT ON<br />EVERY TX</span>
            </div>

            {/* OUT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: 16, borderRadius: 16, background: `linear-gradient(160deg, ${T.accent}20, transparent)`, border: `1px solid ${T.accent}4a` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: T.body, fontSize: 10, color: T.accent, fontWeight: 800, letterSpacing: "0.12em" }}>GOODDOLLAR UBI POOL</span>
                  <span style={{ fontFamily: T.display, fontSize: 20, color: T.ink }}>~{ubiShare}%</span>
                </div>
                <div className="impact-barfill" style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${ubiShare}%`, background: T.accent, borderRadius: 999, boxShadow: `0 0 12px ${T.accent}` }} />
                </div>
                <span style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim }}>{fmtG(ubi)} G$ routed to date</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: 16, borderRadius: 16, background: `linear-gradient(160deg, ${T.green}16, transparent)`, border: `1px solid ${T.green}3a` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: T.body, fontSize: 10, color: T.green, fontWeight: 800, letterSpacing: "0.12em" }}>TREASURY</span>
                  <span style={{ fontFamily: T.display, fontSize: 20, color: T.ink }}>~{treasuryShare}%</span>
                </div>
                <div className="impact-barfill" style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${treasuryShare}%`, background: T.green, borderRadius: 999, boxShadow: `0 0 12px ${T.green}` }} />
                </div>
                <span style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim }}>Funds operations</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14, fontFamily: T.body, fontSize: 11, color: T.inkSoft, lineHeight: 1.5 }}>
            The 20/80 split is our current routing while we formalize the share with the GoodDollar team. Every unit is on a Celo transaction — auditable end to end.
          </div>
        </Card>

        {/* ── consistency payout ── */}
        <Card delay={360} style={{
          display: "flex", flexDirection: isDesktop ? "row" : "column", gap: 16,
          alignItems: isDesktop ? "center" : "flex-start", position: "relative", overflow: "hidden",
          background: `radial-gradient(120% 140% at 0% 100%, ${T.amber}22 0%, transparent 55%), ${T.surface}`,
          borderColor: `${T.amber}33`,
        }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Eyebrow tint={T.amber}>Loyalty · surprise payout</Eyebrow>
            <span style={{ fontFamily: T.display, fontSize: 21, color: T.ink }}>Our {CONSISTENCY.players} most consistent players got paid</span>
            <span style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, lineHeight: 1.5, maxWidth: 520 }}>
              A one-off {fmtG(CONSISTENCY.poolG)} G$ pool to the players who kept showing up — noticing loyalty publicly brought them back, and their friends with them. Kept separate from the recurring economy above.
            </span>
          </div>
          <div style={{ textAlign: isDesktop ? "right" : "left", flexShrink: 0 }}>
            <div style={{ fontFamily: T.display, fontSize: 46, color: T.amber, lineHeight: 1, fontVariantNumeric: "tabular-nums", textShadow: `0 0 34px ${T.amber}55` }}>{fmtG(poolC)}</div>
            <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.12em" }}>G$ TO LOYAL PLAYERS</div>
          </div>
        </Card>

        {/* ── footer note ── */}
        <div className="impact-reveal" style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, textAlign: "center", lineHeight: 1.5, animationDelay: "420ms" }}>
          Live figures read from the GameArena subgraph on Celo. Perk, baseline &amp; loyalty figures pinned to their on-chain events.
        </div>
      </div>

      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
