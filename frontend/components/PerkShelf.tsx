"use client";

import { memo, useCallback, useRef, useState, type ReactNode } from "react";
import { usePerks } from "@/hooks/usePerks";
import { type Perk } from "@/lib/perks";
import { useEquipped } from "@/lib/cosmetics";

// ─── PerkShelf ──────────────────────────────────────────────────────────────
// The shop-side surface for the M1 "G$ Perk Economy". Each perk is a shop card
// with its own generated art (public/perks/<id>.jpg), grouped into three sets:
// Save your run · Keep playing · Collectibles. Every purchase pays in G$;
// 20% streams to the GoodCollective UBI pool. Casual mode only.

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.72)",
  inkSoft: "rgba(220,210,255,0.42)",
  surface: "rgba(22,9,60,0.6)",
  hairline: "rgba(255,255,255,0.08)",
  gold: "#fde68a",
  good: "#34d399",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// Per-game accent — the card's glow + game label color.
const GAME_ACCENT: Record<Perk["game"], string> = {
  rhythm: "#f472b6",
  stack: "#38bdf8",
  simon: "#a78bfa",
  "challenge-ai": "#fbbf24",
};

const fmtG = (v: bigint) => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 });

// Equip switch for an OWNED cosmetic. It's already theirs forever — this only
// controls whether the skin is currently applied in-game. A pill toggle reads
// as a state you own and flip, not a Buy action.
function EquipToggle({ perkId }: { perkId: number }) {
  const [equipped, setEquipped] = useEquipped(perkId);
  return (
    <button
      onClick={() => setEquipped(!equipped)}
      aria-pressed={equipped}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
        padding: "5px 10px 5px 8px", borderRadius: 999, border: "none",
        fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.02em",
        color: equipped ? "#03130b" : T.inkSoft,
        background: equipped ? T.good : "rgba(255,255,255,0.06)",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: 999,
        background: equipped ? "#03130b" : "rgba(220,210,255,0.4)",
      }} />
      {equipped ? "Equipped" : "Equip"}
    </button>
  );
}

// ── One perk card ────────────────────────────────────────────────────────────
// MODULE-LEVEL + memoized on purpose. Defining this inside PerkShelf remounted
// EVERY card on each wallet/block re-render — DOM churn, image re-decode, and
// effect re-runs (the EquipToggle flood). As a stable memoized component it
// never remounts, and only the card whose props changed re-renders. Moderate +
// calm: a 4:3 art strip, tight title, price, and one accent on the Buy button.
type PerkCardProps = {
  perk: Perk;
  owned: boolean;
  canAfford: boolean;
  isBusy: boolean;
  bought: boolean;
  errMsg: string | null;   // non-null only for the card that errored
  stockCount: number;
  onBuy: (perk: Perk) => void;
};

const PerkCard = memo(function PerkCard({ perk, owned, canAfford, isBusy, bought, errMsg, stockCount, onBuy }: PerkCardProps) {
  const accent = GAME_ACCENT[perk.game];
  return (
    <div style={{
      position: "relative", display: "flex", flexDirection: "column", overflow: "hidden",
      height: "100%",
      borderRadius: 14,
      background: T.surface,
      border: `1px solid ${owned ? T.good + "55" : T.hairline}`,
    }}>
      {/* Art — short strip so the card stays compact */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `url('/perks/${perk.id}.jpg')`,
          backgroundSize: "cover", backgroundPosition: "center",
        }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 55%, ${T.surface} 100%)` }} />
        <div style={{ position: "absolute", top: 7, left: 7 }}>
          <span style={{ fontFamily: T.body, fontSize: 8, fontWeight: 900, letterSpacing: "0.1em", color: accent, textTransform: "uppercase", padding: "2px 7px", borderRadius: 999, background: "rgba(6,2,22,0.72)" }}>{perk.gameLabel}</span>
        </div>
        {perk.kind === "cosmetic" && (
          <div style={{ position: "absolute", top: 7, right: 7 }}>
            <span style={{ fontFamily: T.body, fontSize: 7.5, fontWeight: 900, letterSpacing: "0.1em", color: T.gold, padding: "2px 6px", borderRadius: 999, background: "rgba(251,191,36,0.2)" }}>FOREVER</span>
          </div>
        )}
        {stockCount > 0 && (
          <div style={{ position: "absolute", top: 7, right: 7 }}>
            <span style={{ fontFamily: T.display, fontSize: 11, color: "#03130b", padding: "2px 8px", borderRadius: 999, background: T.good, boxShadow: "0 2px 8px -2px rgba(52,211,153,0.7)" }}>×{stockCount} in stock</span>
          </div>
        )}
      </div>

      {/* Body — title, then price + the single accent CTA pinned to the bottom */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "9px 11px 11px", flex: 1 }}>
        <div style={{ fontFamily: T.display, fontSize: 14, color: T.ink, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{perk.name}</div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
            <span style={{ fontFamily: T.display, fontSize: 15, color: T.gold, lineHeight: 1 }}>{fmtG(perk.priceG$)}</span>
            <span style={{ fontFamily: T.body, fontSize: 8.5, color: T.gold, fontWeight: 900, letterSpacing: "0.08em" }}>G$</span>
          </span>

          {owned ? (
            <EquipToggle perkId={perk.id} />
          ) : (
            <button
              onClick={() => onBuy(perk)}
              disabled={isBusy || !canAfford}
              style={{
                cursor: isBusy || !canAfford ? "default" : "pointer",
                padding: "7px 15px", borderRadius: 999,
                fontFamily: T.body, fontSize: 11, fontWeight: 900, letterSpacing: "0.04em",
                color: bought ? "#03130b" : canAfford ? "#12043a" : T.inkSoft,
                background: bought ? T.good : canAfford ? "linear-gradient(180deg, #d6c8ff, #a78bfa)" : "rgba(255,255,255,0.06)",
                border: "none",
                boxShadow: canAfford && !bought ? "0 6px 14px -5px rgba(167,139,250,0.8)" : "none",
              }}
            >
              {isBusy ? "…" : bought ? "✓" : canAfford ? "Buy" : "Need G$"}
            </button>
          )}
        </div>

        {errMsg && <div style={{ fontFamily: T.body, fontSize: 10, color: "#fb7185", lineHeight: 1.4 }}>{errMsg}</div>}
      </div>
    </div>
  );
});

// Section wrapper — module-level presentational shell (title + grid).
function Group({ title, hint, isDesktop, children }: { title: string; hint: string; isDesktop: boolean; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "2px 2px 0" }}>
        <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink }}>{title}</span>
        <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 600 }}>· {hint}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(4, 1fr)" : "repeat(2, 1fr)", gap: 11 }}>
        {children}
      </div>
    </div>
  );
}

export default function PerkShelf({ isDesktop }: { isDesktop: boolean }) {
  const { perks, gBalance, ubiContributed, ownsCosmetic, stock, buyAndStock } = usePerks();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errId, setErrId] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [justBought, setJustBought] = useState<number | null>(null);
  // Guard the concurrent-buy check via a ref so handleBuy has NO reactive
  // deps — it stays referentially stable across re-renders, which is what
  // keeps PerkCard's memo intact (a new onBuy each render would defeat it).
  const busyRef = useRef(false);

  const handleBuy = useCallback(async (perk: Perk) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(perk.id);
    setErrId(null);
    setErrMsg(null);
    try {
      await buyAndStock(perk);
      setJustBought(perk.id);
      setTimeout(() => setJustBought(cur => (cur === perk.id ? null : cur)), 2400);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setErrId(perk.id);
      setErrMsg(
        /insufficient|balance/i.test(raw) ? "Not enough G$"
          : /reject|denied|cancell?ed|already/i.test(raw) ? raw.replace(/^Error:\s*/, "")
            : "Purchase failed",
      );
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }, [buyAndStock]);

  // Render one card with its per-card props computed from the shared state.
  // Passing computed booleans (not raw state) lets React.memo skip every card
  // whose slice didn't change — so a single Buy click re-renders one card, not
  // the whole grid.
  const cardFor = (perk: Perk) => (
    <PerkCard
      key={perk.id}
      perk={perk}
      owned={perk.kind === "cosmetic" && ownsCosmetic(perk.id)}
      canAfford={gBalance >= perk.priceG$}
      isBusy={busyId === perk.id}
      bought={justBought === perk.id}
      errMsg={errId === perk.id ? errMsg : null}
      stockCount={stock[perk.id] ?? 0}
      onBuy={handleBuy}
    />
  );

  const saves = perks.filter(p => p.kind === "save");
  const retries = perks.filter(p => p.kind === "retry");
  const cosmetics = perks.filter(p => p.kind === "cosmetic");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {ubiContributed > 0n && (
        <div style={{ fontFamily: T.body, fontSize: 11, color: T.good, fontWeight: 700, padding: "0 2px" }}>
          ♥ You&apos;ve given {fmtG(ubiContributed)} G$ to community UBI
        </div>
      )}

      <Group title="Save your run" hint="live rescue when you fall" isDesktop={isDesktop}>{saves.map(cardFor)}</Group>
      <Group title="Keep playing" hint="retries & rematch" isDesktop={isDesktop}>{retries.map(cardFor)}</Group>
      <Group title="Collectibles" hint="yours forever" isDesktop={isDesktop}>{cosmetics.map(cardFor)}</Group>
    </div>
  );
}
