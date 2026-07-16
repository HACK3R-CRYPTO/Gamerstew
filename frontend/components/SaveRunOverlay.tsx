"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePerks } from "@/hooks/usePerks";
import { savePerkFor, type Perk } from "@/lib/perks";

// ─── SaveRunOverlay ─────────────────────────────────────────────────────────
// The in-game perk prompt, shared by every game and styled like the shop:
// the perk's own generated art sits under a shrinking countdown ring, with the
// price on the art and a single accent CTA. One tap = one on-chain G$ purchase
// (85% to the UBI pool) and the run continues. Ignore = ring empties, run ends.
// Casual mode only — using a perk drops the run off the ranked ladder.
//
// Works for save / retry / rematch: the parent passes the perk (or lets it
// default to the game's save perk) and the copy adapts to perk.kind.

const T = {
  ink: "#ffffff",
  inkDim: "rgba(224,215,255,0.8)",
  inkSoft: "rgba(224,215,255,0.5)",
  good: "#34d399",
  purple: "#a78bfa",
  gold: "#fde68a",
  danger: "#fb7185",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const RING_R = 82;
const RING_C = 2 * Math.PI * RING_R;

// Copy per perk kind — keeps the one component usable across all games.
// The parent can override the wording (e.g. "Rematch") via titleOverride/ctaOverride.
const VERB: Record<Perk["kind"], { title: string; cta: string }> = {
  save:     { title: "Save your run",   cta: "Save my run" },
  retry:    { title: "Retry the round", cta: "Retry" },
  cosmetic: { title: "Unlock",          cta: "Unlock" },
};

type Props = {
  open: boolean;
  score: number;
  game: Perk["game"];
  onSaved: () => void;      // purchase confirmed on-chain → resume/restart
  onDecline: () => void;    // countdown ran out, or player tapped "no thanks"
  perk?: Perk;              // explicit perk; defaults to the game's save perk
  decideMs?: number;        // window before auto-decline (default 6s)
  headline?: string;        // e.g. "YOU FELL" / "TOWER TOPPLED" / "MARKOV WINS"
  titleOverride?: string;   // override the kind-derived title
  ctaOverride?: string;     // override the kind-derived CTA label
};

export default function SaveRunOverlay({
  open, score, game, onSaved, onDecline, perk: perkOverride, decideMs = 6000, headline = "RUN OVER",
  titleOverride, ctaOverride,
}: Props) {
  const perk = perkOverride ?? savePerkFor(game);
  const { gBalance, buyPerk } = usePerks();

  const [progress, setProgress] = useState(1);       // 1 → 0 over decideMs
  const [status, setStatus] = useState<"idle" | "buying" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const declinedRef = useRef(false);

  const canAfford = !!perk && gBalance >= perk.priceG$;

  // Run the countdown for the life of the overlay. The parent mounts this
  // fresh each time, so initial state is clean — the effect just drives the
  // ring via requestAnimationFrame (setState inside rAF, never sync here).
  useEffect(() => {
    if (!open) return;
    declinedRef.current = false;
    startRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const p = Math.max(0, 1 - elapsed / decideMs);
      setProgress(p);
      if (p <= 0) {
        if (!declinedRef.current) {
          declinedRef.current = true;
          onDecline();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [open, decideMs, onDecline]);

  const pauseCountdown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const handleBuy = useCallback(async () => {
    if (!perk || status === "buying") return;
    pauseCountdown();
    setStatus("buying");
    setErrMsg(null);
    try {
      await buyPerk(perk);
      onSaved();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = /insufficient|balance/i.test(raw)
        ? "Not enough G$. Top up and try again."
        : /reject|denied|cancell?ed/i.test(raw)
          ? "Purchase cancelled."
          : "Couldn't complete. Try again.";
      setErrMsg(msg);
      setStatus("error");
    }
  }, [perk, status, buyPerk, onSaved, pauseCountdown]);

  const handleDecline = useCallback(() => {
    if (declinedRef.current) return;
    declinedRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    onDecline();
  }, [onDecline]);

  if (!open || !perk) return null;

  const busy = status === "buying";
  const base = VERB[perk.kind];
  const verb = { title: titleOverride ?? base.title, cta: ctaOverride ?? base.cta };
  const ringColor = busy ? T.purple : progress < 0.34 ? T.danger : T.good;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 120,
        background: "radial-gradient(120% 90% at 50% 30%, rgba(20,4,60,0.88), rgba(5,1,20,0.96))",
        backdropFilter: "blur(8px)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 24, gap: 16, animation: "saveOverlayIn 220ms ease-out",
      }}
    >
      <style>{`
        @keyframes saveOverlayIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes savePulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.02) } }
      `}</style>

      {/* Headline + score */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: T.display, fontSize: 14, letterSpacing: "0.22em", color: T.danger }}>{headline}</div>
        <div style={{ fontFamily: T.display, fontSize: 40, color: T.ink, marginTop: 2, lineHeight: 1 }}>
          {score.toLocaleString()}
        </div>
        <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, marginTop: 2 }}>your score</div>
      </div>

      {/* Perk art under the countdown ring — the shop item, made urgent */}
      <div style={{ position: "relative", width: 196, height: 196, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="196" height="196" viewBox="0 0 196 196" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
          <circle cx="98" cy="98" r={RING_R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
          <circle
            cx="98" cy="98" r={RING_R} fill="none"
            stroke={ringColor} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress)}
            style={{ transition: busy ? "none" : "stroke 200ms linear" }}
          />
        </svg>
        {/* The perk's generated art */}
        <div style={{
          width: 140, height: 140, borderRadius: 26, overflow: "hidden",
          border: `1px solid ${ringColor}66`, boxShadow: `0 0 30px -6px ${ringColor}aa`,
          backgroundImage: `url('/perks/${perk.id}.jpg')`, backgroundSize: "cover", backgroundPosition: "center",
          animation: canAfford && !busy ? "savePulse 1.6s ease-in-out infinite" : "none",
        }} />
        {/* Price pill on the art */}
        <div style={{ position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "baseline", gap: 3, padding: "3px 11px", borderRadius: 999, background: "rgba(6,2,22,0.82)", border: `1px solid ${T.gold}55` }}>
          <span style={{ fontFamily: T.display, fontSize: 15, color: T.gold, lineHeight: 1 }}>{(Number(perk.priceG$) / 1e18).toLocaleString()}</span>
          <span style={{ fontFamily: T.body, fontSize: 9, color: T.gold, fontWeight: 900, letterSpacing: "0.08em" }}>G$</span>
        </div>
      </div>

      {/* Title */}
      <div style={{ fontFamily: T.display, fontSize: 19, color: T.ink, lineHeight: 1 }}>{verb.title}</div>

      {/* CTA — the single accent */}
      {canAfford ? (
        <button
          onClick={handleBuy}
          disabled={busy}
          style={{
            cursor: busy ? "default" : "pointer",
            padding: "13px 30px", borderRadius: 14, minWidth: 200,
            fontFamily: T.display, fontSize: 16, letterSpacing: "0.01em",
            color: "#03130b",
            background: "linear-gradient(180deg, #6ee7b7 0%, #34d399 55%, #059669 100%)",
            border: "1px solid rgba(255,255,255,0.4)",
            boxShadow: "0 10px 26px -8px rgba(52,211,153,0.6)",
          }}
        >
          {busy ? "Confirm in wallet…" : verb.cta}
        </button>
      ) : (
        <a href="/shop" style={{
          padding: "13px 30px", borderRadius: 14, minWidth: 200, textAlign: "center", textDecoration: "none",
          fontFamily: T.display, fontSize: 15, color: "#12043a",
          background: `linear-gradient(180deg, #d6c8ff, ${T.purple})`, border: "1px solid rgba(255,255,255,0.35)",
        }}>
          Get {perk.priceLabel} in shop →
        </a>
      )}

      {/* Trust line */}
      <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, textAlign: "center", maxWidth: 260, lineHeight: 1.5 }}>
        85% to the community UBI pool · casual mode only
      </div>

      {errMsg && <div style={{ fontFamily: T.body, fontSize: 12, color: T.danger, textAlign: "center" }}>{errMsg}</div>}

      <button
        onClick={handleDecline}
        disabled={busy}
        style={{ background: "none", border: "none", color: "rgba(224,215,255,0.55)", fontFamily: T.body, fontSize: 13.5, cursor: busy ? "default" : "pointer", padding: 6 }}
      >
        {status === "error" ? "Give up run" : "No thanks →"}
      </button>
    </div>
  );
}
