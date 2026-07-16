"use client";

import { useState } from "react";
import { usePerks } from "@/hooks/usePerks";
import { type Perk } from "@/lib/perks";

// ─── PerkShelf ──────────────────────────────────────────────────────────────
// The shop-side surface for the M1 "G$ Perk Economy". Each perk is a shop card
// with its own generated art (public/perks/<id>.jpg), grouped into three sets:
// Save your run · Keep playing · Collectibles. Every purchase pays in G$;
// 85% streams to the GoodCollective UBI pool. Casual mode only.

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

export default function PerkShelf({ isDesktop }: { isDesktop: boolean }) {
  const { perks, gBalance, ubiContributed, ownsCosmetic, buyPerk } = usePerks();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errId, setErrId] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [justBought, setJustBought] = useState<number | null>(null);

  const handleBuy = async (perk: Perk) => {
    if (busyId != null) return;
    setBusyId(perk.id);
    setErrId(null);
    setErrMsg(null);
    try {
      await buyPerk(perk);
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
      setBusyId(null);
    }
  };

  // ── One perk card ────────────────────────────────────────────────────────────
  // Moderate + calm: a short 4:3 art strip, a tight title, price, and a single
  // accent that lives ONLY on the Buy button (the one thing to click). Neutral
  // border, no per-card glow — game color is just a whisper on the tag.
  const Card = ({ perk }: { perk: Perk }) => {
    const accent = GAME_ACCENT[perk.game];
    const owned = perk.kind === "cosmetic" && ownsCosmetic(perk.id);
    const canAfford = gBalance >= perk.priceG$;
    const isBusy = busyId === perk.id;
    const bought = justBought === perk.id;
    const showErr = errId === perk.id;

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
            <span style={{ fontFamily: T.body, fontSize: 8, fontWeight: 900, letterSpacing: "0.1em", color: accent, textTransform: "uppercase", padding: "2px 7px", borderRadius: 999, background: "rgba(6,2,22,0.55)", backdropFilter: "blur(4px)" }}>{perk.gameLabel}</span>
          </div>
          {perk.kind === "cosmetic" && (
            <div style={{ position: "absolute", top: 7, right: 7 }}>
              <span style={{ fontFamily: T.body, fontSize: 7.5, fontWeight: 900, letterSpacing: "0.1em", color: T.gold, padding: "2px 6px", borderRadius: 999, background: "rgba(251,191,36,0.16)", backdropFilter: "blur(4px)" }}>FOREVER</span>
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
              <span style={{ fontFamily: T.body, fontSize: 10.5, fontWeight: 800, color: T.good }}>✓ Owned</span>
            ) : (
              <button
                onClick={() => handleBuy(perk)}
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

          {showErr && <div style={{ fontFamily: T.body, fontSize: 10, color: "#fb7185", lineHeight: 1.4 }}>{errMsg}</div>}
        </div>
      </div>
    );
  };

  const Group = ({ title, hint, items }: { title: string; hint: string; items: Perk[] }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "2px 2px 0" }}>
        <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink }}>{title}</span>
        <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 600 }}>· {hint}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(4, 1fr)" : "repeat(2, 1fr)", gap: 11 }}>
        {items.map(perk => <Card key={perk.id} perk={perk} />)}
      </div>
    </div>
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

      <Group title="Save your run" hint="live rescue when you fall" items={saves} />
      <Group title="Keep playing" hint="retries & rematch" items={retries} />
      <Group title="Collectibles" hint="yours forever" items={cosmetics} />
    </div>
  );
}
