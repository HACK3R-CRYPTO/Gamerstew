"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { track } from "@/lib/track";
import { usePerks } from "@/hooks/usePerks";
import { useLivePerk } from "@/hooks/useLivePerk";
import { useEnergy } from "@/components/EnergyLine";
import { energyChanged, timeUntil } from "@/lib/energy";
import { type Perk } from "@/lib/perks";
import { useEquipped } from "@/lib/cosmetics";

// ─── PerkShelf ──────────────────────────────────────────────────────────────
// Everything a player can buy, in three shelves a person can tell apart:
//   Energy        more ranked runs today (shown only while energy is on)
//   Keep playing  a second chance inside a run: a save, a retry, one more life, more matches
//   Collectibles  looks that are yours forever
// Each card says what the item does, which game it is for, how many you hold
// and what it costs. An item the shop's owner has not priced is not shown.
// Art: public/perks/<id>.jpg.

const T = {
  ink: "#22104f",
  inkDim: "rgba(34,16,79,0.74)",
  inkSoft: "rgba(34,16,79,0.56)",
  surface: "#ffffff",
  hairline: "rgba(76,29,149,0.14)",
  gold: "#92400e",
  good: "#047857",
  accent: "#6d28d9",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: '"Fredoka", ui-sans-serif, system-ui, sans-serif',
};

// Per-game accent — the card's glow + game label color.
const GAME_ACCENT: Record<Perk["game"], string> = {
  rhythm: "#be185d",
  stack: "#0369a1",
  simon: "#6d28d9",
  "challenge-ai": "#b45309",
  nepa3d: "#b45309",
  ladder: "#0f766e",
  strike: "#7c3aed",
  all: "#6d28d9",
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
        color: equipped ? "#fff" : T.inkDim,
        background: equipped ? T.good : "rgba(76,29,149,0.08)",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: 999,
        background: equipped ? "#fff" : "rgba(34,16,79,0.5)",
      }} />
      {equipped ? "Equipped" : "Equip"}
    </button>
  );
}

// ── One perk card ────────────────────────────────────────────────────────────
// MODULE-LEVEL + memoized on purpose: defined inside PerkShelf, every card
// remounted on each wallet re-render. As a stable memoized component only the
// card whose props changed re-renders.
type PerkCardProps = {
  perk: Perk;
  owned: boolean;
  canAfford: boolean;
  isBusy: boolean;
  bought: boolean;
  errMsg: string | null;   // non-null only for the card that errored
  stockCount: number;
  signedIn: boolean;
  onBuy: (perk: Perk) => void;
};

const PerkCard = memo(function PerkCard({ perk, owned, canAfford, isBusy, bought, errMsg, stockCount, signedIn, onBuy }: PerkCardProps) {
  const accent = GAME_ACCENT[perk.game];
  const label = isBusy ? "Buying…" : bought ? "Bought ✓" : !signedIn ? "Sign in" : canAfford ? "Buy" : "Need G$";
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", height: "100%", borderRadius: 20, background: T.surface, boxShadow: `0 0 0 1px ${owned ? T.good + "66" : T.hairline}, 0 8px 20px rgba(76,29,149,0.08)` }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", overflow: "hidden", background: "#26105a" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url('/perks/${perk.id}.jpg')`, backgroundSize: "cover", backgroundPosition: "center" }} />
        <span style={{ position: "absolute", top: 8, left: 8, fontFamily: T.body, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#fff", textTransform: "uppercase", padding: "3px 8px", borderRadius: 999, background: "rgba(20,8,40,0.72)", boxShadow: `inset 0 0 0 1px ${accent}` }}>{perk.gameLabel}</span>
        {perk.kind === "cosmetic" && !owned && <span style={{ position: "absolute", bottom: 8, left: 8, fontFamily: T.body, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#3b0764", padding: "3px 8px", borderRadius: 999, background: "#fde68a" }}>FOREVER</span>}
        {stockCount > 0 && <span style={{ position: "absolute", top: 8, right: 8, fontFamily: T.body, fontSize: 11, fontWeight: 700, color: "#fff", padding: "3px 9px", borderRadius: 999, background: T.good }}>You have {stockCount}</span>}
        {owned && <span style={{ position: "absolute", top: 8, right: 8, fontFamily: T.body, fontSize: 11, fontWeight: 700, color: "#fff", padding: "3px 9px", borderRadius: 999, background: T.good }}>Owned</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "11px 12px 12px", flex: 1 }}>
        <div style={{ fontFamily: T.display, fontSize: 17, color: T.ink, lineHeight: 1.1 }}>{perk.name}</div>
        {/* what it does, in the game's own words: nobody should have to buy it to find out */}
        <div style={{ fontFamily: T.body, fontSize: 13, color: T.inkDim, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{perk.blurb}</div>
        <div style={{ marginTop: "auto", paddingTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontFamily: T.display, fontSize: 18, color: T.ink, lineHeight: 1, whiteSpace: "nowrap" }}>{fmtG(perk.priceG$)} <small style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.inkSoft }}>G$</small></span>
          {owned ? <EquipToggle perkId={perk.id} /> : (
            <button onClick={() => onBuy(perk)} disabled={isBusy || (signedIn && !canAfford)}
              style={{ cursor: isBusy || (signedIn && !canAfford) ? "default" : "pointer", minHeight: 40, padding: "0 16px", borderRadius: 12, border: "none", fontFamily: T.body, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", color: bought ? "#fff" : !signedIn || canAfford ? "#fff" : T.inkSoft, background: bought ? T.good : !signedIn || canAfford ? "linear-gradient(180deg, #7c3aed, #6d28d9)" : "rgba(76,29,149,0.08)", boxShadow: (!signedIn || canAfford) && !bought ? "0 3px 0 #4c1d95" : "none" }}>
              {label}
            </button>
          )}
        </div>
        {errMsg && <div role="alert" style={{ fontFamily: T.body, fontSize: 12.5, fontWeight: 600, color: "#b91c1c", lineHeight: 1.35 }}>{errMsg}</div>}
      </div>
    </div>
  );
});

// A shelf: a title a person can read, one line on what is on it, and the cards.
function Group({ title, hint, isDesktop, children }: { title: string; hint: string; isDesktop: boolean; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: T.display, fontSize: 22, color: T.ink, lineHeight: 1.15 }}>{title}</h2>
        <p style={{ margin: "2px 0 0", fontFamily: T.body, fontSize: 14, color: T.inkDim }}>{hint}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(auto-fill, minmax(200px, 1fr))" : "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

interface PotNow { on: boolean; pot: number; game: string | null }

export default function PerkShelf({ isDesktop }: { isDesktop: boolean }) {
  const { address } = useAccount();
  const router = useRouter();
  const { perks, gBalance, ubiContributed, ownsCosmetic, stock, buyAndStock } = usePerks();
  const life = useLivePerk(9);       // one more life, UP NEPA 3D: on the shelf once the shop has priced it
  const pack = useLivePerk(10);      // the energy pack
  const energy = useEnergy();
  const [pot, setPot] = useState<PotNow | null>(null);
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    fetch(`${base}/api/pot`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.on) setPot(d as PotNow); }).catch(() => {});
  }, []);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errId, setErrId] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [justBought, setJustBought] = useState<number | null>(null);
  // a ref, so handleBuy keeps one identity across renders and PerkCard's memo holds
  const busyRef = useRef(false);
  const signedIn = !!address; const signedInRef = useRef(signedIn); signedInRef.current = signedIn;

  const handleBuy = useCallback(async (perk: Perk) => {
    if (!signedInRef.current) { router.push("/home?signin=1"); return; }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(perk.id); setErrId(null); setErrMsg(null);
    try {
      await buyAndStock(perk);
      if (perk.id === 10) energyChanged();
      track("shop_bought", { item: perk.id, name: perk.name, price: perk.priceLabel });
      setJustBought(perk.id);
      setTimeout(() => setJustBought(cur => (cur === perk.id ? null : cur)), 2400);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setErrId(perk.id);
      setErrMsg(/insufficient|balance/i.test(raw) ? "Not enough G$." : /cancel|reject|denied/i.test(raw) ? "Cancelled. Nothing was spent." : /already/i.test(raw) ? "You already own this." : "That did not go through. Nothing was spent.");
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }, [buyAndStock, router]);

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
      signedIn={signedIn}
      onBuy={handleBuy}
    />
  );

  // a second chance inside a run, every game's together: saves, the retry, the extra life, the match pack
  const keep = [...perks.filter((p) => p.kind === "save"), ...perks.filter((p) => p.kind === "retry" && p.game !== "challenge-ai"), ...(life ? [life] : []), ...perks.filter((p) => p.game === "challenge-ai")];
  const cosmetics = perks.filter((p) => p.kind === "cosmetic");
  const packBusy = busyId === 10, packBought = justBought === 10, packAfford = !!pack && gBalance >= pack.priceG$;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {ubiContributed > 0n && (
        <div style={{ fontFamily: T.body, fontSize: 13.5, color: T.good, fontWeight: 700 }}>
          ♥ You have given {fmtG(ubiContributed)} G$ to the GoodDollar UBI pool
        </div>
      )}

      {/* ENERGY: the thing a player buys most often, so it comes first and gets the wide card */}
      {pack && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: T.display, fontSize: 22, color: T.ink, lineHeight: 1.15 }}>Energy</h2>
            <p style={{ margin: "2px 0 0", fontFamily: T.body, fontSize: 14, color: T.inkDim }}>A ranked run uses one energy. Everyone gets {energy?.free ?? 5} free every day.</p>
          </div>
          <div className="psh-energy">
            <div className="psh-energy-art" style={{ backgroundImage: "url('/perks/10.jpg')" }} role="img" aria-label="Energy pack" />
            <div className="psh-energy-body">
              <div style={{ fontFamily: T.display, fontSize: isDesktop ? 30 : 24, color: T.ink, lineHeight: 1.1 }}>{energy?.packPlays ?? 5} more ranked runs</div>
              <p style={{ margin: "6px 0 0", fontFamily: T.body, fontSize: 15, lineHeight: 1.45, color: T.inkDim }}>Out of free runs and still want to climb the board? A pack gives you {energy?.packPlays ?? 5} more, in any game. <b style={{ color: T.ink }}>Bought runs never expire.</b></p>
              {energy && (
                <div style={{ marginTop: 10, display: "inline-flex", flexWrap: "wrap", gap: "2px 10px", padding: "7px 12px", borderRadius: 12, background: energy.left <= 1 ? "#fef2f2" : "#f3effc", fontFamily: T.body, fontSize: 14, color: T.inkDim }}>
                  <span>⚡ <b style={{ color: energy.left <= 1 ? "#b91c1c" : T.ink }}>{energy.left}</b> left today{energy.bought > 0 ? <> ({energy.bought} bought)</> : null}</span>
                  <span>Free runs back in <b style={{ color: T.ink }}>{timeUntil(energy.resetsAt)}</b></span>
                </div>
              )}
              {pot?.on && <p style={{ margin: "10px 0 0", fontFamily: T.body, fontSize: 13.5, lineHeight: 1.4, color: T.inkDim }}>Most of every pack goes into the day&apos;s prize pot{pot.pot > 0 ? <>: <b style={{ color: T.ink }}>{pot.pot.toLocaleString()} G$</b> so far today</> : null}. The top third of players split it.</p>}
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <button onClick={() => handleBuy(pack)} disabled={packBusy || (signedIn && !packAfford)}
                  style={{ minHeight: 52, padding: "0 26px", borderRadius: 16, border: "none", cursor: packBusy || (signedIn && !packAfford) ? "default" : "pointer", fontFamily: T.display, fontSize: 19, color: !signedIn || packAfford || packBought ? "#fff" : T.inkSoft, background: packBought ? T.good : !signedIn || packAfford ? "linear-gradient(180deg, #7c3aed, #6d28d9)" : "rgba(76,29,149,0.08)", boxShadow: (!signedIn || packAfford) && !packBought ? "0 4px 0 #4c1d95" : "none" }}>
                  {packBusy ? "Buying…" : packBought ? "Added ✓" : !signedIn ? "Sign in to buy" : packAfford ? `Buy for ${pack.priceLabel}` : `You need ${pack.priceLabel}`}
                </button>
                {!signedIn && <span style={{ fontFamily: T.display, fontSize: 20, color: T.ink }}>{pack.priceLabel} <small style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.inkSoft }}>a pack</small></span>}
                {errId === 10 && errMsg && <span role="alert" style={{ fontFamily: T.body, fontSize: 13.5, fontWeight: 600, color: "#b91c1c" }}>{errMsg}</span>}
              </div>
            </div>
          </div>
        </section>
      )}

      <Group title="Keep playing" hint="A second chance in the middle of a run. A ranked run keeps the score it had before; what you add after is for fun." isDesktop={isDesktop}>{keep.map(cardFor)}</Group>
      <Group title="Collectibles" hint="Looks for your games. Buy once, yours forever." isDesktop={isDesktop}>{cosmetics.map(cardFor)}</Group>

      <style>{`
        .psh-energy { display: grid; grid-template-columns: 1fr; overflow: hidden; border-radius: 24px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.14), 0 10px 26px rgba(76,29,149,0.1); }
        .psh-energy-art { aspect-ratio: 16 / 9; background-color: #26105a; background-size: cover; background-position: center; }
        .psh-energy-body { padding: 16px 16px 18px; }
        @media (min-width: 760px) { .psh-energy { grid-template-columns: 300px 1fr; } .psh-energy-art { aspect-ratio: auto; min-height: 250px; } .psh-energy-body { padding: 22px 26px; } }
      `}</style>
    </div>
  );
}
