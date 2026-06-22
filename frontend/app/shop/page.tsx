"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import { HABITATS as HABITAT_TIERS, type HabitatTier } from "@/lib/habitats";
import { useHabitats } from "@/hooks/useHabitats";
import { HabitatBackground } from "@/components/HabitatBackground";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// Token system mirrors /profile so the two surfaces share one design.
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const ICON_PATHS: Record<string, string> = {
  lock: "M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5m-3 8V7a3 3 0 1 1 6 0v3z",
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z",
};
function Icon({ name, size = 16, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d={ICON_PATHS[name] || ""} /></svg>;
}

export default function ShopPage() {
  const router = useRouter();
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Gate: shop is for players who've onboarded (minted GamePass). Guests
  // and authenticated-but-no-pass users see a soft prompt instead — they
  // don't even have G$ to spend yet.
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const connected = authenticated && !!address && hasMinted === true;

  // Player level — drives free-tier unlocks and useHabitats's equipped
  // resolution. Same fetch the profile uses (single source of truth).
  const [playerLevel, setPlayerLevel] = useState<number>(1);
  useEffect(() => {
    if (!connected || !address) { setPlayerLevel(1); return; }
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setPlayerLevel(Number(d.level ?? 1)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, address]);

  const { ownedPaidTierIds, equipped, equipHabitat, unlock, gBalance } = useHabitats(playerLevel);
  const ownedPaidIds = ownedPaidTierIds;
  const unlockedHabitats = HABITAT_TIERS.filter(h =>
    h.type === "free"
      ? playerLevel >= (h.unlockLevel ?? 1)
      : ownedPaidIds.includes(h.id)
  ).length;

  // Unlock modal state machine — mirrors the legacy HabitatsPanel flow.
  const [unlockTarget, setUnlockTarget] = useState<HabitatTier | null>(null);
  const [unlockStep, setUnlockStep] = useState<"idle" | "approving" | "success" | "error">("idle");
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const closeUnlockModal = () => {
    if (unlockStep === "approving") return;
    setUnlockTarget(null);
    setUnlockStep("idle");
    setUnlockErr(null);
  };
  const confirmUnlock = async () => {
    if (!unlockTarget) return;
    setUnlockStep("approving");
    setUnlockErr(null);
    try {
      await unlock(unlockTarget);
      setUnlockStep("success");
      equipHabitat(unlockTarget.id);
    } catch (e) {
      setUnlockErr(e instanceof Error ? e.message : "Unlock failed");
      setUnlockStep("error");
    }
  };

  // Featured upsell: cheapest paid tier the player doesn't yet own.
  const nextPaid = HABITAT_TIERS
    .filter(h => h.type === "paid" && !ownedPaidIds.includes(h.id))
    .sort((a, b) => Number(a.costG$ ?? 0n) - Number(b.costG$ ?? 0n))[0] ?? null;
  const fmtCost = (cost?: bigint) => cost ? `${(Number(cost) / 1e18).toLocaleString()}` : "—";
  const canAffordNext = nextPaid && nextPaid.costG$ != null && gBalance >= nextPaid.costG$;

  // Guest / not-yet-connected — soft prompt, no fake catalog.
  if (!connected) {
    return (
      <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
        <AppHeader />
        <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "0 auto", padding: isDesktop ? "60px 32px 130px" : "40px 16px 110px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center" }}>
          <div style={{ fontSize: 56 }}>🏛️</div>
          <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 26, color: T.ink, margin: 0, letterSpacing: "-0.005em" }}>Habitat shop</h1>
          <p style={{ fontFamily: T.body, fontSize: 13, color: T.inkDim, margin: "0 auto", maxWidth: 320, lineHeight: 1.5 }}>
            Sign in to browse the 10 habitats and unlock premium scenes with G$. 85% of every donation routes to the GoodCollective UBI pool.
          </p>
          <button onClick={() => router.push("/home")} style={{
            fontFamily: T.display, fontSize: 16, color: "#fff",
            padding: "13px 30px", borderRadius: 14,
            background: `linear-gradient(180deg, ${T.accent}, ${T.accent}cc)`,
            border: `1.5px solid ${T.accent}`,
            boxShadow: `0 12px 26px -6px ${T.accent}aa, inset 0 1px 0 rgba(255,255,255,0.4)`,
            cursor: "pointer", marginTop: 4,
          }}>Sign in</button>
        </div>
        <AppBottomNav wide={isDesktop} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />

      <div style={{ maxWidth: isDesktop ? 1180 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* HEADER · back + title + balance */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button onClick={() => router.back()} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px 8px 9px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim, fontFamily: T.body, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em" }}>
            <Icon name="back" size={15} color="currentColor" /> Back
          </button>
          <div style={{ display: "inline-flex", alignItems: "baseline", gap: 5, padding: "8px 14px", borderRadius: 999, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)" }}>
            <span style={{ fontFamily: T.display, fontSize: 14, color: "#fde68a", lineHeight: 1, textShadow: "0 0 8px rgba(251,191,36,0.5)" }}>{(Number(gBalance) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            <span style={{ fontFamily: T.body, fontSize: 10, color: "#fde68a", fontWeight: 900, letterSpacing: "0.12em" }}>G$</span>
          </div>
        </div>

        {/* TITLE */}
        <div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>Shop · Habitats</div>
          <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 32 : 26, color: T.ink, margin: "4px 0 0", lineHeight: 1.1, letterSpacing: "-0.005em" }}>Your pet&apos;s home</h1>
          <p style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, margin: "6px 0 0", lineHeight: 1.5, maxWidth: 480 }}>
            Free tiers unlock with level. Premium tiers cost G$ — 85% routes to the GoodCollective UBI pool.
          </p>
        </div>

        {/* FEATURED · only when something paid is left to buy */}
        {nextPaid && (
          <div
            role="button" tabIndex={0}
            onClick={() => { setUnlockTarget(nextPaid); setUnlockStep("idle"); setUnlockErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setUnlockTarget(nextPaid); setUnlockStep("idle"); setUnlockErr(null); } }}
            style={{
              position: "relative", overflow: "hidden",
              borderRadius: 22, marginTop: 4,
              minHeight: isDesktop ? 200 : 170,
              border: `1px solid ${nextPaid.bg.accent}66`,
              boxShadow: `0 0 30px ${nextPaid.bg.accent}33`,
              cursor: "pointer",
              background: "rgba(8,2,28,0.6)",
              transition: "transform 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
          >
            <div style={{ position: "absolute", inset: 0 }}>
              <HabitatBackground habitat={nextPaid} radius={22} glow={true} />
            </div>
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg, rgba(4,2,18,0.82) 0%, rgba(4,2,18,0.5) 55%, rgba(4,2,18,0.2) 100%)",
              pointerEvents: "none", zIndex: 1,
            }} />
            <div style={{
              position: "relative", zIndex: 2,
              padding: isDesktop ? "26px 28px" : "20px 18px",
              display: "flex", flexDirection: isDesktop ? "row" : "column",
              gap: isDesktop ? 22 : 14,
              alignItems: isDesktop ? "center" : "flex-start",
              height: "100%",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: `${nextPaid.bg.accent}26`, border: `1px solid ${nextPaid.bg.accent}66` }}>
                  <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.22em", color: nextPaid.bg.accent, textTransform: "uppercase" }}>★ Featured</span>
                </div>
                <div style={{ fontFamily: T.display, fontSize: isDesktop ? 26 : 22, color: T.ink, marginTop: 8, lineHeight: 1.1, letterSpacing: "-0.005em", textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>{nextPaid.name}</div>
                <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, marginTop: 5, lineHeight: 1.45, maxWidth: 420 }}>
                  {nextPaid.blurb} <span style={{ color: T.inkSoft }}>· 85% to UBI pool.</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: isDesktop ? "flex-end" : "flex-start", gap: 8, flexShrink: 0 }}>
                <div style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: T.display, fontSize: 30, color: "#fde68a", textShadow: "0 0 16px rgba(251,191,36,0.55)", lineHeight: 1 }}>{fmtCost(nextPaid.costG$)}</span>
                  <span style={{ fontFamily: T.body, fontSize: 12, color: "#fde68a", fontWeight: 900, letterSpacing: "0.12em" }}>G$</span>
                </div>
                <div style={{
                  padding: "9px 18px", borderRadius: 999,
                  background: canAffordNext
                    ? `linear-gradient(180deg, ${nextPaid.bg.accent}, ${nextPaid.bg.accent}cc)`
                    : "rgba(255,255,255,0.08)",
                  border: `1px solid ${canAffordNext ? nextPaid.bg.accent : "rgba(255,255,255,0.18)"}`,
                  boxShadow: canAffordNext ? `0 8px 20px -4px ${nextPaid.bg.accent}aa, inset 0 1px 0 rgba(255,255,255,0.4)` : "none",
                  fontFamily: T.body, fontSize: 11.5, fontWeight: 900, letterSpacing: "0.16em",
                  color: canAffordNext ? "#fff" : T.inkDim,
                }}>{canAffordNext ? "UNLOCK NOW" : "TAP TO PREVIEW"}</div>
              </div>
            </div>
          </div>
        )}

        {/* COLLECTION HEADER */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "8px 2px 0" }}>
          <span style={{ fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>Collection</span>
          <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, letterSpacing: "0.1em", fontWeight: 700 }}>{unlockedHabitats}/{HABITAT_TIERS.length}</span>
        </div>

        {/* GRID · all 10 tiers */}
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(4, 1fr)" : "repeat(2, 1fr)", gap: 10 }}>
          {HABITAT_TIERS.map(h => {
            const unlocked = h.type === "free"
              ? playerLevel >= (h.unlockLevel ?? 1)
              : ownedPaidIds.includes(h.id);
            const isEquipped = h.id === equipped.id;
            const canEquip = unlocked && !isEquipped;
            const isBuyable = !unlocked && h.type === "paid";
            const canAfford = isBuyable && h.costG$ != null && gBalance >= h.costG$;
            const handleClick = canEquip
              ? () => { equipHabitat(h.id); }
              : isBuyable
                ? () => { setUnlockTarget(h); setUnlockStep("idle"); setUnlockErr(null); }
                : undefined;
            const hint = isEquipped
              ? "Equipped"
              : canEquip
                ? "Tap to equip"
                : h.type === "free"
                  ? `Unlocks at LV ${h.unlockLevel ?? 1}`
                  : canAfford ? "Tap to unlock" : "Earn more G$";
            return (
              <div
                key={h.id}
                role={handleClick ? "button" : undefined}
                tabIndex={handleClick ? 0 : -1}
                onClick={handleClick}
                onKeyDown={handleClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } } : undefined}
                style={{
                  position: "relative", overflow: "hidden",
                  borderRadius: 14,
                  border: `1px solid ${isEquipped ? h.bg.accent + "88" : isBuyable ? h.bg.accent + "55" : "rgba(255,255,255,0.08)"}`,
                  boxShadow: isEquipped ? `0 0 16px ${h.bg.accent}55` : isBuyable ? `0 0 12px ${h.bg.accent}22` : "none",
                  minHeight: 140,
                  display: "flex", flexDirection: "column",
                  background: "rgba(8,2,28,0.6)",
                  cursor: handleClick ? "pointer" : "default",
                  transition: "transform 0.15s",
                }}
                onMouseEnter={handleClick ? (e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; } : undefined}
                onMouseLeave={handleClick ? (e) => { (e.currentTarget as HTMLDivElement).style.transform = ""; } : undefined}
              >
                <div style={{
                  position: "absolute", inset: 0,
                  filter: unlocked ? "none" : isBuyable ? "saturate(0.85) brightness(0.85)" : "grayscale(0.7) brightness(0.55)",
                }}>
                  <HabitatBackground habitat={h} radius={14} glow={unlocked || isBuyable} />
                </div>

                <div style={{
                  position: "relative", zIndex: 2,
                  marginTop: "auto",
                  padding: "9px 10px 9px",
                  background: "linear-gradient(180deg, transparent 0%, rgba(4,2,18,0.88) 60%)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: T.display, fontSize: 13, color: T.ink, letterSpacing: "-0.005em", lineHeight: 1.1, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                    {isEquipped && (
                      <span style={{ fontFamily: T.body, fontSize: 8.5, color: h.bg.accent, fontWeight: 900, letterSpacing: "0.12em", padding: "2px 6px", borderRadius: 999, background: `${h.bg.accent}22`, border: `1px solid ${h.bg.accent}66`, whiteSpace: "nowrap" }}>EQUIPPED</span>
                    )}
                  </div>
                  <span style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 700 }}>{hint}</span>
                </div>

                {h.type === "paid" ? (
                  <div style={{ position: "absolute", top: 8, left: 8, zIndex: 2, display: "inline-flex", alignItems: "baseline", gap: 3, padding: "4px 9px", borderRadius: 999, background: "rgba(0,0,0,0.6)", border: `1px solid ${h.bg.accent}66`, boxShadow: `0 0 8px ${h.bg.accent}33` }}>
                    <span style={{ fontFamily: T.display, fontSize: 13, color: "#fde68a", textShadow: "0 0 6px rgba(251,191,36,0.5)", lineHeight: 1 }}>{fmtCost(h.costG$)}</span>
                    <span style={{ fontFamily: T.body, fontSize: 8.5, color: "#fde68a", fontWeight: 900, letterSpacing: "0.12em" }}>G$</span>
                  </div>
                ) : null}

                {!unlocked && h.type === "free" && (
                  <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2, padding: "4px 6px", borderRadius: 8, background: "rgba(0,0,0,0.55)", border: `1px solid ${T.hairline}`, color: T.inkDim, display: "flex", alignItems: "center" }}>
                    <Icon name="lock" size={11} color="currentColor" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* UNLOCK MODAL */}
      {unlockTarget && (
        <div
          onClick={closeUnlockModal}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(2,0,12,0.78)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            animation: "shop-sheet-fade 0.24s ease both",
          }}
        >
          <style>{`
            @keyframes shop-sheet-fade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes shop-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
            @keyframes shop-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          `}</style>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "100%", maxWidth: 520,
            borderRadius: "26px 26px 0 0",
            background: "linear-gradient(180deg, rgba(20,8,52,0.98) 0%, rgba(8,2,28,0.99) 100%)",
            border: `1px solid ${unlockTarget.bg.accent}55`,
            borderBottom: "none",
            boxShadow: `0 -24px 60px -10px ${unlockTarget.bg.accent}33`,
            paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))",
            animation: "shop-sheet-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
          }}>
            <div style={{ padding: "10px 0 4px", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 44, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
            </div>
            <div style={{ padding: "6px 22px 18px" }}>
              <div style={{ position: "relative", borderRadius: 18, overflow: "hidden", height: 160 }}>
                <HabitatBackground habitat={unlockTarget} radius={18} glow={true} />
              </div>
              <div style={{ fontFamily: T.body, color: unlockTarget.bg.accent, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.22em", textTransform: "uppercase", marginTop: 14 }}>{unlockTarget.type === "paid" ? "Premium habitat" : "Free habitat"}</div>
              <div style={{ fontFamily: T.display, color: T.ink, fontSize: 24, marginTop: 4, letterSpacing: "-0.005em" }}>{unlockTarget.name}</div>
              <div style={{ fontFamily: T.body, color: T.inkDim, fontSize: 12.5, marginTop: 5, lineHeight: 1.5 }}>{unlockTarget.blurb}</div>

              <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hairline}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontFamily: T.body, color: T.inkSoft, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>Cost</div>
                  <div style={{ display: "inline-flex", alignItems: "baseline", gap: 4, marginTop: 3 }}>
                    <span style={{ fontFamily: T.display, color: "#fde68a", fontSize: 22, lineHeight: 1, textShadow: "0 0 14px rgba(251,191,36,0.5)" }}>{unlockTarget.costG$ ? (Number(unlockTarget.costG$) / 1e18).toLocaleString() : "—"}</span>
                    <span style={{ fontFamily: T.body, color: "#fde68a", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em" }}>G$</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: T.body, color: T.inkSoft, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>Your G$</div>
                  <div style={{ fontFamily: T.display, color: T.ink, fontSize: 18, marginTop: 3, lineHeight: 1 }}>{(Number(gBalance) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </div>
              </div>
              <div style={{ fontFamily: T.body, color: T.inkSoft, fontSize: 11, lineHeight: 1.5, marginTop: 8, padding: "0 4px" }}>
                85% of every donation routes to the <strong style={{ color: "#86efac" }}>GoodCollective UBI pool</strong>. 15% supports the platform.
              </div>

              {unlockStep === "error" && unlockErr && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", color: "rgba(252,165,165,0.95)", fontFamily: T.body, fontSize: 11.5, fontWeight: 700, lineHeight: 1.45 }}>
                  {unlockErr}
                </div>
              )}
              {unlockStep === "success" && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.35)", color: "#86efac", fontFamily: T.body, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.02em", textAlign: "center" }}>
                  ✓ Unlocked — {unlockTarget.name} is now your habitat.
                </div>
              )}

              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                {unlockStep === "success" ? (
                  <button onClick={closeUnlockModal} style={{
                    flex: 1, padding: "13px 10px", borderRadius: 14, cursor: "pointer",
                    background: `linear-gradient(180deg, ${unlockTarget.bg.accent}, ${unlockTarget.bg.accent}cc)`,
                    border: `1px solid ${unlockTarget.bg.accent}`,
                    boxShadow: `0 10px 22px -6px ${unlockTarget.bg.accent}88, inset 0 1px 0 rgba(255,255,255,0.35)`,
                    color: "#fff", fontFamily: T.body, fontSize: 12.5, fontWeight: 900, letterSpacing: "0.14em",
                  }}>DONE</button>
                ) : (
                  <>
                    <button onClick={closeUnlockModal} disabled={unlockStep === "approving"} style={{
                      flex: 1, padding: "13px 10px", borderRadius: 14, cursor: unlockStep === "approving" ? "not-allowed" : "pointer",
                      background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hairline}`,
                      color: T.inkDim, fontFamily: T.body, fontSize: 12.5, fontWeight: 800, letterSpacing: "0.14em",
                      opacity: unlockStep === "approving" ? 0.5 : 1,
                    }}>CANCEL</button>
                    <button
                      onClick={confirmUnlock}
                      disabled={unlockStep === "approving" || !unlockTarget.costG$ || gBalance < unlockTarget.costG$}
                      style={{
                        flex: 1.4, padding: "13px 10px", borderRadius: 14,
                        cursor: (unlockStep === "approving" || gBalance < (unlockTarget.costG$ ?? 0n)) ? "not-allowed" : "pointer",
                        background: gBalance >= (unlockTarget.costG$ ?? 0n)
                          ? `linear-gradient(180deg, ${unlockTarget.bg.accent}, ${unlockTarget.bg.accent}cc)`
                          : "rgba(255,255,255,0.06)",
                        border: `1px solid ${gBalance >= (unlockTarget.costG$ ?? 0n) ? unlockTarget.bg.accent : T.hairline}`,
                        boxShadow: gBalance >= (unlockTarget.costG$ ?? 0n)
                          ? `0 10px 22px -6px ${unlockTarget.bg.accent}88, inset 0 1px 0 rgba(255,255,255,0.35)`
                          : "none",
                        color: gBalance >= (unlockTarget.costG$ ?? 0n) ? "#fff" : T.inkSoft,
                        fontFamily: T.body, fontSize: 12.5, fontWeight: 900, letterSpacing: "0.14em",
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                      }}
                    >
                      {unlockStep === "approving" && (
                        <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", animation: "shop-spin 0.8s linear infinite" }} />
                      )}
                      {unlockStep === "approving"
                        ? "UNLOCKING…"
                        : gBalance < (unlockTarget.costG$ ?? 0n)
                          ? "NOT ENOUGH G$"
                          : "CONFIRM UNLOCK"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
