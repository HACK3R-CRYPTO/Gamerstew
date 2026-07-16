"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePerks } from "@/hooks/usePerks";
import { savePerkFor, type Perk } from "@/lib/perks";

// ─── SaveRunOverlay ─────────────────────────────────────────────────────────
// The in-game "continue?" moment, rebuilt for clarity:
//   · one CTA that never flips — it waits for stock to resolve before showing
//   · the perk art as a clean circular medallion with a depleting timer ring
//     and a plain seconds number, so the countdown is unmistakable
//   · a clear "Confirming…" state so the wallet wait never looks frozen
// With stock, a save is free and instant (spends from inventory). At zero
// stock it's one gasless signature. A saved run continues and still submits —
// using a save counts on the weekly leaderboard.

const T = {
  ink: "#ffffff",
  inkDim: "rgba(224,215,255,0.82)",
  inkSoft: "rgba(224,215,255,0.5)",
  good: "#34d399",
  goodDeep: "#059669",
  purple: "#a78bfa",
  gold: "#fde68a",
  danger: "#fb7185",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const RING_R = 74;
const RING_C = 2 * Math.PI * RING_R;

// Title EXPLAINS what tapping does (first-timers won't know otherwise);
// the button is the action verb. Never make the two say the same thing.
const VERB: Record<Perk["kind"], { title: string; cta: string }> = {
  save:     { title: "Pick up where you fell", cta: "Save my run" },
  retry:    { title: "Play this round again",  cta: "Retry" },
  cosmetic: { title: "Unlock it forever",      cta: "Unlock" },
};

type Props = {
  open: boolean;
  score: number;
  game: Perk["game"];
  onSaved: () => void;
  onDecline: () => void;
  perk?: Perk;
  decideMs?: number;
  headline?: string;
  titleOverride?: string;
  ctaOverride?: string;
};

export default function SaveRunOverlay({
  open, score, game, onSaved, onDecline, perk: perkOverride, decideMs = 6000, headline = "RUN OVER",
  titleOverride, ctaOverride,
}: Props) {
  const perk = perkOverride ?? savePerkFor(game);
  const { gBalance, buyPerk, stock, stockReady, spendStock } = usePerks();
  const inStock = perk ? (stock[perk.id] ?? 0) : 0;

  const [progress, setProgress] = useState(1);
  const [status, setStatus] = useState<"idle" | "buying" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const declinedRef = useRef(false);

  const canAfford = !!perk && gBalance >= perk.priceG$;
  const busy = status === "buying";

  useEffect(() => {
    if (!open) return;
    declinedRef.current = false;
    startRef.current = performance.now();
    const tick = (now: number) => {
      const p = Math.max(0, 1 - (now - startRef.current) / decideMs);
      setProgress(p);
      if (p <= 0) {
        if (!declinedRef.current) { declinedRef.current = true; onDecline(); }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [open, decideMs, onDecline]);

  const pauseCountdown = useCallback(() => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const finishError = (raw: string) => {
    setErrMsg(
      /insufficient|balance/i.test(raw) ? "Not enough G$."
        : /reject|denied|cancell?ed/i.test(raw) ? "Cancelled."
          : "Couldn't complete. Try again.",
    );
    setStatus("error");
  };

  const handleBuy = useCallback(async () => {
    if (!perk || busy) return;
    pauseCountdown(); setStatus("buying"); setErrMsg(null);
    try { await buyPerk(perk); onSaved(); }
    catch (e) { finishError(e instanceof Error ? e.message : String(e)); }
  }, [perk, busy, buyPerk, onSaved, pauseCountdown]);

  const handleUse = useCallback(async () => {
    if (!perk || busy) return;
    pauseCountdown(); setStatus("buying"); setErrMsg(null);
    try {
      const ok = await spendStock(perk.id);
      if (ok) { onSaved(); return; }
      await buyPerk(perk); onSaved();
    } catch (e) { finishError(e instanceof Error ? e.message : String(e)); }
  }, [perk, busy, spendStock, buyPerk, onSaved, pauseCountdown]);

  const handleDecline = useCallback(() => {
    if (declinedRef.current) return;
    declinedRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    onDecline();
  }, [onDecline]);

  if (!open || !perk) return null;

  const base = VERB[perk.kind];
  const verb = { title: titleOverride ?? base.title, cta: ctaOverride ?? base.cta };
  const secondsLeft = Math.max(1, Math.ceil((progress * decideMs) / 1000));
  const ringColor = busy ? T.purple : progress < 0.34 ? T.danger : T.good;
  const usingStock = stockReady && inStock > 0;
  const canAct = usingStock || canAfford;
  // The single CTA's label — resolved once, never flips between buy/stock.
  const ctaLabel = !stockReady ? "" : busy ? "Confirming…" : usingStock ? verb.cta : canAfford ? verb.cta : `Get ${perk.priceLabel}`;
  const ctaSub = !stockReady ? "" : usingStock ? `${inStock} in stock · free` : `${perk.priceLabel} · one tap`;

  return (
    <div role="dialog" aria-modal="true" style={{
      position: "fixed", inset: 0, zIndex: 120,
      background: "radial-gradient(120% 90% at 50% 32%, rgba(24,6,66,0.9), rgba(4,1,16,0.97))",
      backdropFilter: "blur(10px)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 24, gap: 18, animation: "svIn 200ms ease-out",
    }}>
      <style>{`
        @keyframes svIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes svPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.035) } }
        @keyframes svSpin { to { transform: rotate(360deg) } }
      `}</style>

      {/* Headline + score */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: T.display, fontSize: 13, letterSpacing: "0.24em", color: T.danger }}>{headline}</div>
        <div style={{ fontFamily: T.display, fontSize: 44, color: T.ink, marginTop: 2, lineHeight: 1 }}>{score.toLocaleString()}</div>
        <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, marginTop: 2, letterSpacing: "0.02em" }}>your score</div>
      </div>

      {/* Circular medallion + depleting timer ring + seconds badge */}
      <div style={{ position: "relative", width: 172, height: 172, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="172" height="172" viewBox="0 0 172 172" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
          <circle cx="86" cy="86" r={RING_R} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="7" />
          <circle
            cx="86" cy="86" r={RING_R} fill="none"
            stroke={ringColor} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress)}
            style={{ transition: busy ? "none" : "stroke 200ms linear", filter: `drop-shadow(0 0 6px ${ringColor}aa)` }}
          />
        </svg>
        {/* Clean circular art */}
        <div style={{
          width: 122, height: 122, borderRadius: "50%",
          backgroundImage: `url('/perks/${perk.id}.jpg')`, backgroundSize: "cover", backgroundPosition: "center",
          boxShadow: `inset 0 0 0 2px rgba(255,255,255,0.08), 0 0 34px -6px ${ringColor}cc`,
          animation: canAct && !busy && stockReady ? "svPulse 1.5s ease-in-out infinite" : "none",
        }} />
        {/* Seconds number — unmistakable timer */}
        {!busy && (
          <div style={{
            position: "absolute", bottom: -4, left: "50%", transform: "translateX(-50%)",
            minWidth: 30, height: 30, padding: "0 9px", borderRadius: 999,
            background: "#0b0320", border: `2px solid ${ringColor}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: T.display, fontSize: 15, color: ringColor, lineHeight: 1,
          }}>{secondsLeft}</div>
        )}
      </div>

      {/* Title */}
      <div style={{ fontFamily: T.display, fontSize: 20, color: T.ink, lineHeight: 1, marginTop: 4 }}>{verb.title}</div>

      {/* Single state-aware CTA — never flips; blocks until stock is known */}
      {!stockReady ? (
        <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 230 }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.2)", borderTopColor: T.good, animation: "svSpin 0.7s linear infinite" }} />
        </div>
      ) : canAct ? (
        <button
          onClick={usingStock ? handleUse : handleBuy}
          disabled={busy}
          style={{
            cursor: busy ? "default" : "pointer", minWidth: 230,
            padding: "12px 30px", borderRadius: 16, border: "1px solid rgba(255,255,255,0.4)",
            background: `linear-gradient(180deg, #6ee7b7 0%, ${T.good} 55%, ${T.goodDeep} 100%)`,
            boxShadow: "0 12px 28px -8px rgba(52,211,153,0.65)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: T.display, fontSize: 17, color: "#03130b", lineHeight: 1 }}>
            {busy && <span style={{ width: 15, height: 15, borderRadius: "50%", border: "2.5px solid rgba(3,19,11,0.35)", borderTopColor: "#03130b", animation: "svSpin 0.7s linear infinite" }} />}
            {ctaLabel}
          </span>
          {!busy && <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 800, color: "rgba(3,19,11,0.72)" }}>{ctaSub}</span>}
        </button>
      ) : (
        <a href="/shop" style={{
          minWidth: 230, textAlign: "center", textDecoration: "none",
          padding: "13px 30px", borderRadius: 16, border: "1px solid rgba(255,255,255,0.35)",
          fontFamily: T.display, fontSize: 15, color: "#12043a",
          background: `linear-gradient(180deg, #d6c8ff, ${T.purple})`,
        }}>Get {perk.priceLabel} in shop →</a>
      )}

      {errMsg && <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.danger, textAlign: "center", marginTop: 2 }}>{errMsg}</div>}

      {/* Decline — quiet (no accent, so it never competes with the CTA) but
          clearly a tappable choice, sitting right under the button. */}
      <button
        onClick={handleDecline}
        disabled={busy}
        style={{
          background: "none", border: "none",
          color: "rgba(224,215,255,0.62)", fontFamily: T.body, fontSize: 14, fontWeight: 600,
          cursor: busy ? "default" : "pointer", padding: "8px 18px", marginTop: -6,
        }}
      >
        {status === "error" ? "Give up run" : "No thanks →"}
      </button>
    </div>
  );
}
