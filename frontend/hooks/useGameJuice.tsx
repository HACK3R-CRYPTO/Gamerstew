"use client";

// ─── useGameJuice ─────────────────────────────────────────────────────────────
// Shared "game feel" primitives, lifted out of Slime Survivor so Rhythm Rush
// and Simon Memory can adopt the same pattern without copy-paste. Returns
// state + helpers + the JSX layer to drop into a game page's render tree.
//
// What it provides:
//   • Floating score popups ("+10", "+50 ✦", "-1 ❤")
//   • Screen shake (small/medium/big presets)
//   • Big combo callouts at milestones (5/10/25/50/100…)
//   • Time-pressure red vignette (auto-enables in the last N seconds)
//
// Coordinates: popups use SCREEN coords (clientX/Y from a getBoundingClientRect
// or canvas-local px). The Overlay positions them inside its own container,
// so pass coords relative to whatever element wraps it. For percent-based
// hits (e.g. Rhythm lanes 0..100%), pass `xPct` + `yPct` and the overlay
// handles positioning.

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

export type Popup = {
  id: number;
  // Position is provided as percentages of the overlay container so the
  // caller doesn't have to care about canvas pixels.
  xPct: number;
  yPct: number;
  text: string;
  color: string;
  size: number;     // base font size in px
  born: number;     // wall-clock ms (performance.now())
  life: number;     // ms before fade-out completes
};

export type Callout = {
  id: number;
  text: string;
  sub?: string;
  color: string;
};

export function useGameJuice() {
  const [popups, setPopups] = useState<Popup[]>([]);
  const [callout, setCallout] = useState<Callout | null>(null);
  // Screen shake = current decaying intensity, in px. RAF or pure setTimeout
  // can decay it; for solo games we let the page's existing loop decay if
  // it has one, else this handles it with a self-driven RAF.
  const [shake, setShake] = useState(0);
  // Auto-decay shake without a RAF loop in pages that don't have one.
  useEffect(() => {
    if (shake <= 0) return;
    const id = requestAnimationFrame(() => setShake(s => Math.max(0, s - 0.6)));
    return () => cancelAnimationFrame(id);
  }, [shake]);

  const idRef = useRef(1);
  const lastCalloutMilestoneRef = useRef(0);

  // ── Spawn a floating popup. Auto-cleans after life expires. ──
  const popup = useCallback((p: Omit<Popup, "id" | "born">) => {
    const born = performance.now();
    const id = idRef.current++;
    setPopups(prev => [...prev, { ...p, id, born }]);
    // Clean up well after the fade so the overlay isn't holding stale items.
    setTimeout(() => setPopups(prev => prev.filter(x => x.id !== id)), p.life + 100);
  }, []);

  // ── Convenience: spawn the appropriate popup for a score gain. ──
  const scorePopup = useCallback((xPct: number, yPct: number, points: number, kind: "perfect" | "good" | "gem" = "good") => {
    const color = kind === "gem" ? "#86efac" : kind === "perfect" ? "#fbbf24" : "#fde68a";
    const size = kind === "gem" ? 18 : kind === "perfect" ? 17 : 14;
    const text = kind === "gem" ? `+${points} ✦` : `+${points}`;
    popup({ xPct, yPct, text, color, size, life: 850 });
  }, [popup]);

  // ── Negative-event popup ("-1 ❤", "MISS"). ──
  const lossPopup = useCallback((xPct: number, yPct: number, text: string = "MISS") => {
    popup({ xPct, yPct, text, color: "#fca5a5", size: 16, life: 750 });
  }, [popup]);

  // ── Trigger screen shake. Magnitude in px (6 small, 12 medium, 22 big). ──
  const bump = useCallback((magnitude: number) => {
    setShake(s => Math.max(s, magnitude));
  }, []);

  // ── Trigger a big center callout. `milestone` prevents duplicates. ──
  const fireCallout = useCallback((c: Omit<Callout, "id">, milestone?: number) => {
    if (milestone !== undefined) {
      if (milestone <= lastCalloutMilestoneRef.current) return;
      lastCalloutMilestoneRef.current = milestone;
    }
    const id = idRef.current++;
    setCallout({ ...c, id });
    setTimeout(() => {
      setCallout(prev => (prev?.id === id ? null : prev));
    }, 1200);
  }, []);

  // Default combo milestones — same set Survivor uses, opt-in per game.
  const comboCallout = useCallback((streak: number) => {
    const table: Record<number, { text: string; sub: string; color: string }> = {
      5:  { text: "WARMED UP",   sub: "Keep going",   color: "#86efac" },
      10: { text: "ON FIRE 🔥",  sub: "2× combo",     color: "#f0abfc" },
      25: { text: "UNSTOPPABLE", sub: "3× combo",     color: "#f0abfc" },
      50: { text: "GOD MODE",    sub: "6× combo",     color: "#fbbf24" },
      100:{ text: "LEGENDARY",   sub: "11× combo",    color: "#fbbf24" },
    };
    const entry = table[streak];
    if (entry) fireCallout(entry, streak);
  }, [fireCallout]);

  // Reset everything (call when a new run starts).
  const reset = useCallback(() => {
    setPopups([]);
    setCallout(null);
    setShake(0);
    lastCalloutMilestoneRef.current = 0;
  }, []);

  return { popups, callout, shake, popup, scorePopup, lossPopup, bump, fireCallout, comboCallout, reset };
}

// ─── Render layer ─────────────────────────────────────────────────────────────
// Drop <JuiceOverlay {...juice} /> over the play area. It's pointerEvents:none
// so it can't block input. The overlay's container should be `position:relative`
// (or fixed/absolute) so the percent coords resolve correctly.

export function JuiceOverlay({
  popups, callout, shake, timeLeft, dangerSeconds = 0,
}: {
  popups: Popup[];
  callout: Callout | null;
  shake: number;
  /** Optional: seconds remaining in the run. Drives the danger vignette. */
  timeLeft?: number;
  /** Show pulsing red vignette when timeLeft <= this value. 0 disables. */
  dangerSeconds?: number;
}) {
  // Two layers: shake transform wraps popups + vignette (those move with
  // the shake), callout sits outside the transform so the milestone text
  // doesn't jiggle while it's being read.
  const wobble = shake > 0
    ? `translate(${(Math.random() - 0.5) * shake * 2}px, ${(Math.random() - 0.5) * shake * 2}px)`
    : undefined;

  const showVignette = dangerSeconds > 0 && timeLeft !== undefined && timeLeft <= dangerSeconds && timeLeft > 0;
  const vignetteAlpha = showVignette
    ? Math.min(0.38, 0.14 + (1 - (timeLeft! / dangerSeconds)) * 0.32)
    : 0;

  return (
    <>
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        transform: wobble,
        zIndex: 14,
      }}>
        {/* Danger vignette — pulses red around the edges when time is low. */}
        {showVignette && (
          <div style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(ellipse at center, transparent 38%, rgba(239,68,68,${vignetteAlpha}) 100%)`,
            animation: "juice-pulse 0.9s ease-in-out infinite",
            pointerEvents: "none",
          }} />
        )}

        {/* Popups */}
        {popups.map(p => (
          <PopupItem key={p.id} popup={p} />
        ))}
      </div>

      {/* Combo callout sits OUTSIDE the shake transform so it stays readable. */}
      {callout && (
        <CalloutItem key={callout.id} callout={callout} />
      )}

      <style jsx global>{`
        @keyframes juice-pulse {
          0%, 100% { opacity: 0.85; }
          50%      { opacity: 1; }
        }
        @keyframes juice-popup-rise {
          0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
          15%  { transform: translate(-50%, -65%) scale(1.15); opacity: 1; }
          100% { transform: translate(-50%, -150%) scale(1); opacity: 0; }
        }
        @keyframes juice-callout-in {
          0%   { transform: scale(0.5); opacity: 0; }
          30%  { transform: scale(1.15); opacity: 1; }
          70%  { transform: scale(1); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
      `}</style>
    </>
  );
}

function PopupItem({ popup: p }: { popup: Popup }) {
  return (
    <span
      style={{
        position: "absolute",
        left: `${p.xPct}%`,
        top: `${p.yPct}%`,
        fontSize: `${p.size}px`,
        fontWeight: 900,
        color: p.color,
        textShadow: "0 2px 6px rgba(0,0,0,0.7), 0 0 10px rgba(0,0,0,0.5)",
        WebkitTextStroke: "1px rgba(0,0,0,0.45)",
        letterSpacing: "0.04em",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        animation: `juice-popup-rise ${p.life}ms cubic-bezier(0.2, 0.8, 0.3, 1) both`,
      }}
    >
      {p.text}
    </span>
  );
}

function CalloutItem({ callout: c }: { callout: Callout }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "38%", left: "50%",
        transform: "translate(-50%, -50%)",
        textAlign: "center",
        pointerEvents: "none",
        zIndex: 16,
        animation: "juice-callout-in 1.1s cubic-bezier(0.34, 1.56, 0.64, 1) both",
      }}
    >
      <div style={{
        color: c.color,
        fontSize: "clamp(34px, 8.5vw, 64px)",
        fontWeight: 900,
        letterSpacing: "0.06em",
        lineHeight: 1,
        textShadow: `0 0 24px ${c.color}, 0 0 56px ${c.color}88, 0 4px 10px rgba(0,0,0,0.75)`,
        WebkitTextStroke: "1.5px rgba(0,0,0,0.4)",
      }}>
        {c.text}
      </div>
      {c.sub && (
        <div style={{
          marginTop: 8,
          color: "white",
          fontSize: 12,
          fontWeight: 900,
          letterSpacing: "0.18em",
          textShadow: "0 2px 8px rgba(0,0,0,0.8)",
        }}>{c.sub}</div>
      )}
    </div>
  );
}

// Helper alias so games can use a single import.
export default useGameJuice;
