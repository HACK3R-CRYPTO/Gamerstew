"use client";

import { useState } from "react";
import { HABITATS, type HabitatTier, formatG$ } from "@/lib/habitats";
import { HabitatBackground } from "./HabitatBackground";
import { SocialImpactSection } from "./SocialImpactSection";
import { useHabitats } from "@/hooks/useHabitats";
import { useIsMobile } from "@/hooks/useIsMobile";

// ─── HabitatsPanel ────────────────────────────────────────────────────────────
// Gallery of all 10 habitats. Free tiers render as "unlocked at level X".
// Paid tiers render as "donate Y G$ to unlock" with a confirm modal flow
// where each donation routes a portion to the GoodCollective UBI pool
// (verifiable on Celo) without exposing the exact split in the UI —
// players see magnitude, not internal accounting.
//
// Tap a tier card → modal opens → confirm donation → wagmi handles
// approve + unlock → state refreshes → modal closes.

export function HabitatsPanel({ playerLevel = 1 }: { playerLevel?: number }) {
  const { ownedPaidTierIds, ubiDonated, gBalance, unlock, equipped, equipHabitat } = useHabitats(playerLevel);
  const isMobile = useIsMobile();
  const [modal, setModal] = useState<HabitatTier | null>(null);
  const [busy, setBusy]   = useState(false);
  const [step, setStep]   = useState<"idle" | "approving" | "unlocking" | "success" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const ownedSet = new Set(ownedPaidTierIds);

  function isUnlocked(tier: HabitatTier): boolean {
    if (tier.type === "free") return playerLevel >= (tier.unlockLevel ?? 1);
    return ownedSet.has(tier.id);
  }

  async function handleConfirm() {
    if (!modal) return;
    setBusy(true);
    setErrMsg(null);
    try {
      setStep("approving");
      await unlock(modal);
      setStep("success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg);
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    if (busy) return;
    setModal(null);
    setStep("idle");
    setErrMsg(null);
  }

  return (
    <div style={{ width: "100%" }}>
      {/* Social impact storytelling — eyebrow + Social Impact title +
          three-sentence narrative + community/personal stats. Lives at the
          top of the Habitats tab so the UBI story frames every habitat
          decision below it. The split (UBI vs treasury) is intentionally
          hidden — players see scale, not accounting. */}
      <SocialImpactSection myUbiG={ubiDonated} />

      {/* Habitat collection header — short, just identifies the grid */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ color: "white", fontSize: "16px", fontWeight: 900, letterSpacing: "0.04em" }}>
          HABITATS
        </div>
        <div style={{ color: "rgba(200,180,255,0.65)", fontSize: "10px", marginTop: "2px" }}>
          Free tiers unlock with level. Paid tiers grow the community pool.
        </div>
      </div>

      {/* Habitat grid — 2 cols on mobile (clean preview at 360px), auto-fill on desktop */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(150px, 1fr))",
        gap: isMobile ? "8px" : "10px",
      }}>
        {HABITATS.map(tier => {
          const unlocked   = isUnlocked(tier);
          const canBuy     = tier.type === "paid" && !unlocked;
          const isEquipped = unlocked && equipped.id === tier.id;
          const canEquip   = unlocked && !isEquipped;

          const handleClick = canBuy
            ? () => setModal(tier)
            : canEquip
              ? () => equipHabitat(tier.id)
              : undefined;

          return (
            <div
              key={tier.id}
              role={handleClick ? "button" : undefined}
              tabIndex={handleClick ? 0 : -1}
              onClick={handleClick}
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                borderRadius: "14px",
                overflow: "hidden",
                cursor: handleClick ? "pointer" : "default",
                opacity: !unlocked && tier.type === "free" ? 0.4 : 1,
                transition: "transform 0.15s",
                outline: isEquipped ? `2px solid ${tier.bg.accent}` : "none",
                outlineOffset: isEquipped ? "-2px" : "0",
                boxShadow: isEquipped ? `0 0 14px ${tier.bg.accent}88` : "none",
              }}
              onMouseEnter={handleClick ? e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; } : undefined}
              onMouseLeave={handleClick ? e => { (e.currentTarget as HTMLDivElement).style.transform = ""; } : undefined}
            >
              <HabitatBackground habitat={tier} radius={14} glow={unlocked} animated={false} />
              {/* Tier number badge */}
              <div style={{
                position: "absolute", top: 6, right: 6,
                width: "22px", height: "22px",
                borderRadius: "50%",
                background: "rgba(0,0,0,0.55)",
                border: `1px solid ${tier.bg.accent}88`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: tier.bg.accent, fontSize: "10px", fontWeight: 900,
                zIndex: 5,
              }}>
                {tier.id}
              </div>
              {/* Equipped corner badge */}
              {isEquipped && (
                <div style={{
                  position: "absolute", top: 6, left: 6,
                  padding: "2px 7px", borderRadius: "999px",
                  background: tier.bg.accent,
                  color: "#1a0550", fontSize: 8, fontWeight: 900, letterSpacing: "0.1em",
                  boxShadow: `0 0 10px ${tier.bg.accent}`,
                  zIndex: 5,
                }}>
                  ★ EQUIPPED
                </div>
              )}
              {/* Status overlay */}
              <div style={{
                position: "absolute", left: 0, right: 0, bottom: 0,
                padding: "8px 10px",
                background: "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.85) 100%)",
                zIndex: 5,
              }}>
                <div style={{ color: "white", fontSize: "11px", fontWeight: 900, letterSpacing: "0.04em", textShadow: `0 0 8px ${tier.bg.accent}88` }}>
                  {tier.name}
                </div>
                <div style={{ marginTop: "2px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px" }}>
                  {unlocked ? (
                    <span style={{ color: "#86efac", fontSize: "9px", fontWeight: 800, letterSpacing: "0.08em" }}>✓ OWNED</span>
                  ) : tier.type === "free" ? (
                    <span style={{ color: "rgba(200,180,255,0.7)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.06em" }}>
                      LV {tier.unlockLevel}
                    </span>
                  ) : (
                    <span style={{ color: "#fde68a", fontSize: "9px", fontWeight: 800, letterSpacing: "0.06em" }}>
                      {formatG$(tier.costG$ ?? 0n)} G$
                    </span>
                  )}
                  {canBuy && (
                    <span style={{
                      padding: "2px 6px", borderRadius: "999px",
                      background: tier.bg.accent + "22",
                      border: `1px solid ${tier.bg.accent}88`,
                      color: tier.bg.accent, fontSize: "8px", fontWeight: 900, letterSpacing: "0.1em",
                    }}>UNLOCK</span>
                  )}
                  {canEquip && (
                    <span style={{
                      padding: "2px 6px", borderRadius: "999px",
                      background: tier.bg.accent + "22",
                      border: `1px solid ${tier.bg.accent}88`,
                      color: tier.bg.accent, fontSize: "8px", fontWeight: 900, letterSpacing: "0.1em",
                    }}>EQUIP</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Donation modal */}
      {modal && (
        <div onClick={closeModal} style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(4,0,20,0.78)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: isMobile ? "12px" : "20px",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: "100%", maxWidth: "420px",
            maxHeight: "92vh",
            borderRadius: isMobile ? "18px" : "20px",
            background: "#1a0550", padding: "3px",
            boxShadow: `0 0 0 2px ${modal.bg.accent}55, 0 0 50px ${modal.bg.accent}55, 0 30px 60px rgba(0,0,0,0.9)`,
            display: "flex", flexDirection: "column",
          }}>
            <div style={{
              flex: 1, minHeight: 0,
              borderRadius: isMobile ? "16px" : "18px",
              background: "linear-gradient(180deg, #2a0c6e 0%, #07021a 100%)",
              padding: "0", overflow: "hidden",
              display: "flex", flexDirection: "column",
            }}>
              {/* Hero preview */}
              <div style={{ position: "relative", height: isMobile ? "130px" : "160px", flexShrink: 0 }}>
                <HabitatBackground habitat={modal} radius={0} glow={true} />
                <div style={{
                  position: "absolute", inset: 0, zIndex: 5,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  padding: "20px",
                }}>
                  <div style={{ color: modal.bg.accent, fontSize: "9px", fontWeight: 900, letterSpacing: "0.2em", textShadow: `0 0 12px ${modal.bg.accent}` }}>
                    TIER {modal.id} · PAID
                  </div>
                  <div style={{ color: "white", fontSize: "22px", fontWeight: 900, marginTop: "4px", textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>
                    {modal.name}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", marginTop: "4px", fontStyle: "italic" }}>
                    {modal.blurb}
                  </div>
                </div>
              </div>

              {/* Body — scrollable so it fits any phone height */}
              <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1 }}>
                {step === "success" ? (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <div style={{ fontSize: "40px" }}>🎉</div>
                    <div style={{ color: "white", fontSize: "16px", fontWeight: 900, marginTop: "6px" }}>UNLOCKED</div>
                    <div style={{ color: "rgba(200,180,255,0.7)", fontSize: "11px", marginTop: "4px", lineHeight: 1.4 }}>
                      Your unlock helped grow our community UBI pool.
                      Thank you for being part of it.
                    </div>
                    <button onClick={closeModal} style={{
                      marginTop: "14px",
                      padding: "10px 24px", borderRadius: "999px",
                      background: modal.bg.accent, border: "none",
                      color: "#1a0550", fontSize: "12px", fontWeight: 900, letterSpacing: "0.08em",
                      cursor: "pointer",
                    }}>DONE</button>
                  </div>
                ) : (
                  <>
                    {/* Cost row + impact line. Internal split (UBI vs treasury)
                        is intentionally hidden — players see the magnitude,
                        not the accounting. The contract handles the split
                        on-chain and Celoscan keeps it verifiable for anyone
                        who wants to inspect. Same pattern Focus Pet uses. */}
                    <div style={{
                      padding: "12px 14px", borderRadius: "12px",
                      background: "rgba(34,197,94,0.06)",
                      border: "1px solid rgba(34,197,94,0.25)",
                      marginBottom: "12px",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700 }}>Total</span>
                        <span style={{ color: "white", fontSize: "18px", fontWeight: 900 }}>
                          {formatG$(modal.costG$ ?? 0n)} G$
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
                        <span style={{ fontSize: 12 }}>🌍</span>
                        <span style={{ color: "rgba(220,255,225,0.75)", fontSize: "10.5px", fontWeight: 700, lineHeight: 1.4 }}>
                          Funds GoodDollar Universal Basic Income
                        </span>
                        <span style={{
                          marginLeft: "auto",
                          padding: "2px 7px", borderRadius: "999px",
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#86efac", fontSize: "8.5px", fontWeight: 900,
                          letterSpacing: "0.1em",
                        }}>✓ ON CELO</span>
                      </div>
                    </div>

                    {/* Balance check */}
                    <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(200,180,255,0.6)", fontSize: "10px", marginBottom: "12px" }}>
                      <span>Your balance</span>
                      <span style={{ color: gBalance < (modal.costG$ ?? 0n) ? "#fca5a5" : "rgba(255,255,255,0.85)", fontWeight: 700 }}>
                        {formatG$(gBalance)} G$
                      </span>
                    </div>

                    {step === "error" && errMsg && (
                      <div style={{ padding: "8px 10px", borderRadius: "8px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", marginBottom: "10px" }}>
                        <div style={{ color: "#fca5a5", fontSize: "10px", fontWeight: 700, lineHeight: 1.4 }}>
                          {errMsg.length > 140 ? errMsg.slice(0, 140) + "…" : errMsg}
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={closeModal} disabled={busy} style={{
                        flex: 1, padding: "11px", borderRadius: "999px",
                        background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                        color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em",
                        cursor: busy ? "not-allowed" : "pointer",
                      }}>CANCEL</button>
                      <button
                        onClick={handleConfirm}
                        disabled={busy || gBalance < (modal.costG$ ?? 0n)}
                        style={{
                          flex: 2, padding: "11px", borderRadius: "999px",
                          background: gBalance < (modal.costG$ ?? 0n) ? "rgba(120,80,150,0.4)" : modal.bg.accent,
                          border: "none",
                          color: "#1a0550", fontSize: "11px", fontWeight: 900, letterSpacing: "0.1em",
                          cursor: busy || gBalance < (modal.costG$ ?? 0n) ? "not-allowed" : "pointer",
                          opacity: busy ? 0.7 : 1,
                          boxShadow: busy ? "none" : `0 0 20px ${modal.bg.accent}66`,
                        }}>
                        {busy
                          ? (step === "approving" ? "APPROVING G$…" : "DONATING…")
                          : gBalance < (modal.costG$ ?? 0n)
                            ? "INSUFFICIENT G$"
                            : "DONATE & UNLOCK"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
