"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// ─── TugTeaser ──────────────────────────────────────────────────────────────
// Upcoming/live teaser for Verified Tug of War. Deliberately built on the same
// shape as EventTeaser (the Arena Cup card) so the events page keeps one
// visual grammar for "here is an event" rather than gaining a second one.
//
// It is phase-aware for the same reason EventTeaser is: a finished event that
// lingers as a live headline is what left "$150 · Coming soon" on this app four
// months after that challenge ended. This hides itself once the window closes.

const T = {
  ink: "#ffffff",
  inkDim: "rgba(224,215,255,0.78)",
  red: "#dc2626",
  blue: "#67e8f9",
  gold: "#fde68a",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// The window comes from the API, which reads it from the backend's own config.
// It was briefly duplicated here as NEXT_PUBLIC_TUG_STARTS_AT — two independent
// sources of truth that agreed only because their hardcoded defaults matched.
// Change one and this card counts down to a different moment than the event
// page honours, which is precisely the kind of thing that only shows up on
// launch day. These constants remain ONLY as a fallback for when the API is
// unreachable, so the card still renders rather than vanishing.
const FALLBACK_STARTS_MS = Date.parse("2026-09-23T17:00:00Z");
const FALLBACK_ENDS_MS = Date.parse("2026-09-30T17:00:00Z");

export type TugPhase = "upcoming" | "live" | "ended";

function fmt(ms: number): string {
  if (ms <= 0) return "";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function TugTeaser({ isDesktop = false }: { isDesktop?: boolean }) {
  // Mounted clock — SSR has no reliable time. Assume "upcoming" before mount so
  // the card renders immediately rather than flashing in.
  const [win, setWin] = useState<{ startsMs: number; endsMs: number } | null>(null);
  useEffect(() => {
    let alive = true;
    // /api/tug is edge-cached and 310 bytes, so this is effectively free and
    // guarantees the card and the event page agree on when the event is.
    fetch("/api/tug")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d?.startsAt || !d?.endsAt) return;
        setWin({ startsMs: Date.parse(d.startsAt), endsMs: Date.parse(d.endsAt) });
      })
      .catch(() => { /* fall back to the constants above */ });
    return () => { alive = false; };
  }, []);

  const startsMs = win?.startsMs ?? FALLBACK_STARTS_MS;
  const endsMs = win?.endsMs ?? FALLBACK_ENDS_MS;

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // The first read is deferred to a timeout rather than called straight from
    // the effect body. Setting state synchronously inside an effect triggers a
    // cascading render, which React 19's lint flags — and the deferral is
    // imperceptible (next tick) while still filling the clock before the 1s
    // interval would. EventTeaser and CupCountdown still do this the old way;
    // no reason to copy the flaw forward.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);

  const phase: TugPhase =
    now === null ? "upcoming" : now < startsMs ? "upcoming" : now >= endsMs ? "ended" : "live";
  if (phase === "ended") return null;

  const upcoming = phase === "upcoming";
  const target = upcoming ? startsMs : endsMs;
  const countdown = now === null ? "" : fmt(target - now);

  return (
    <Link href="/tug" style={{
      display: "block", textDecoration: "none", color: "inherit",
      position: "relative", overflow: "hidden", borderRadius: 18,
      padding: isDesktop ? "18px 22px" : "15px 16px",
      background: "linear-gradient(115deg, rgba(127,29,29,0.62) 0%, rgba(30,14,74,0.78) 52%, rgba(14,116,144,0.55) 100%)",
      border: "1px solid rgba(220,38,38,0.42)",
      boxShadow: "0 14px 40px -18px rgba(220,38,38,0.5)",
    }}>
      {/* key art, dimmed and pushed right so the copy stays readable over it */}
      <img
        src="/tug/card.jpg"
        alt=""
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          objectFit: "cover", objectPosition: "62% 50%", opacity: 0.5, pointerEvents: "none",
        }}
      />
      <div aria-hidden style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "linear-gradient(100deg, rgba(16,4,38,0.94) 0%, rgba(16,4,38,0.76) 46%, rgba(16,4,38,0.16) 100%)",
      }} />

      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 10px", borderRadius: 999, background: "rgba(220,38,38,0.2)", border: "1px solid rgba(220,38,38,0.5)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: T.red, boxShadow: `0 0 8px ${T.red}` }} />
            <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.18em", color: "#fca5a5", textTransform: "uppercase" }}>
              Tug of War
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 10 }}>
            <span style={{ fontFamily: T.display, fontSize: isDesktop ? 40 : 31, color: T.ink, lineHeight: 1, textShadow: "0 2px 16px rgba(0,0,0,0.6)" }}>
              1,000,000
            </span>
            <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 900, color: "rgba(255,255,255,0.82)", letterSpacing: "0.1em" }}>G$</span>
          </div>
          <div style={{ fontFamily: T.body, fontSize: 10, color: "rgba(224,215,255,0.72)", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 4 }}>
            Prize pool · two sides, one rope
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 11, padding: "6px 13px", borderRadius: 999, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.28)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: upcoming ? T.gold : "#22c55e", boxShadow: `0 0 8px ${upcoming ? T.gold : "#22c55e"}`, animation: "pulse-soft 1.6s ease-in-out infinite" }} />
            <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.8)", textTransform: "uppercase" }}>
              {upcoming ? "Starts in" : "Ends in"}
            </span>
            <span style={{ fontFamily: T.display, fontSize: isDesktop ? 16 : 14, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
              {countdown}
            </span>
          </div>

          <p style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, margin: "9px 0 0", lineHeight: 1.5, maxWidth: 440 }}>
            {upcoming
              ? "Verify before it opens and you're drawn onto a side. Every verified human on your team pulls the rope — and the first 160 verified players get 2,500 G$ guaranteed, whoever wins."
              : "It's live. Every verified human on your side pulls the rope. The first 160 verified players get 2,500 G$ guaranteed, whoever wins."}
          </p>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            {(["R", "B"] as const).map((l, i) => (
              <span key={l} style={{
                width: 22, height: 22, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: i === 0 ? T.red : T.blue, color: i === 0 ? "#fff" : "#06323b",
                fontFamily: T.display, fontSize: 11, border: "1.5px solid rgba(255,255,255,0.4)",
              }}>{l}</span>
            ))}
            <span style={{ fontFamily: T.body, fontSize: 10, color: "rgba(224,215,255,0.7)", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Red or Blue
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
