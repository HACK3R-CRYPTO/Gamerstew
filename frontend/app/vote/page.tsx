"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

// ─── /vote ────────────────────────────────────────────────────────────────
// Helps GoodDollar-verified players cast a community vote for GameArena on
// Flow State (the GoodBuilders funding platform). ~25% of our grant stream
// comes from verified-citizen votes. The catch: a player's verified address
// is a Privy embedded wallet scoped to THIS app — Flow State's own login
// mints a different address, so the only way to vote with the verified
// address is to export it into a standalone wallet (MetaMask/Rabby) and
// connect that. This page walks them through it safely, using Privy's
// secure export modal (the key loads in an isolated iframe our app can't
// read). MiniPay users already hold a standalone wallet, so they skip export.
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  accent: "#a78bfa",
  danger: "#f43f5e",
  good: "#22c55e",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const FLOW_STATE_URL =
  "https://flowstate.network/flow-councils/42220/0x582e3314d4ef56c18930acb10bb64313525e7820";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{
        flexShrink: 0, width: 26, height: 26, borderRadius: 999,
        background: "rgba(167,139,250,0.18)", border: `1px solid ${T.hairline}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: T.display, fontSize: 13, color: T.accent, fontWeight: 800,
      }}>{n}</div>
      <div style={{ paddingTop: 1 }}>
        <div style={{ fontFamily: T.body, fontSize: 14, fontWeight: 700, color: T.ink, lineHeight: 1.35 }}>{title}</div>
        <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, lineHeight: 1.5, marginTop: 3 }}>{children}</div>
      </div>
    </div>
  );
}

export default function VotePage() {
  const router = useRouter();
  const isMiniPay = useIsMiniPay();
  // Match the rest of the app · bottom nav switches to its wide desktop
  // layout at ≥900px (same breakpoint AppHeader + dashboard use).
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(FLOW_STATE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked · the Open button still works */ }
  };

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, paddingBottom: 92 }}>
      <AppHeader />

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "8px 16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Hero */}
        <div style={{ textAlign: "center", paddingTop: 6 }}>
          <div style={{ fontSize: 40, lineHeight: 1 }}>🗳️</div>
          <h1 style={{ fontFamily: T.display, fontSize: 26, color: T.ink, margin: "10px 0 0", letterSpacing: "-0.01em" }}>
            Vote for GameArena
          </h1>
          <p style={{ fontFamily: T.body, fontSize: 13.5, color: T.inkDim, lineHeight: 1.5, margin: "8px auto 0", maxWidth: 320 }}>
            You get a <strong style={{ color: T.ink }}>fresh vote every Wednesday</strong>. It grows the prize pools you play for.
          </p>
        </div>

        {/* ── RETURNING / WEEKLY · the fast path for anyone already set up ──
            Green-accented and placed FIRST so voters who did the one-time
            setup (imported wallet, or MiniPay) just vote again in seconds
            without scrolling past onboarding steps. */}
        <div style={{ background: "linear-gradient(180deg, rgba(34,197,94,0.1), rgba(40,18,100,0.4))", border: "1px solid rgba(52,211,153,0.35)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: T.good, boxShadow: `0 0 8px ${T.good}` }} />
            <SectionLabel>Voted before? · 10 seconds</SectionLabel>
          </div>
          <Step n={1} title="Open your wallet">The one you imported into last time {isMiniPay ? "(MiniPay)" : "(MetaMask, Rabby...)"}.</Step>
          <Step n={2} title="Open Flow State in it">Copy the link below, paste it in your wallet&apos;s browser.</Step>
          <Step n={3} title="Give GameArena your full vote">Do it again every <strong style={{ color: T.ink }}>Wednesday</strong> · fresh allocation each week.</Step>

          <a
            href={FLOW_STATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              width: "100%", textAlign: "center", textDecoration: "none",
              borderRadius: 12, padding: "13px", fontFamily: T.display, fontSize: 15,
              color: "#04160a", background: "linear-gradient(180deg, #6ee76e 0%, #22c55e 55%, #15803d 100%)",
              border: "1px solid rgba(255,255,255,0.4)",
              boxShadow: "0 8px 18px -6px rgba(34,197,94,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            Open Flow State to vote →
          </a>
          <button
            onClick={copyLink}
            style={{
              width: "100%", cursor: "pointer",
              borderRadius: 12, padding: "11px", fontFamily: T.body, fontSize: 13, fontWeight: 700,
              color: copied ? T.good : T.inkDim,
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${copied ? "rgba(34,197,94,0.4)" : T.hairline}`,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}
          >
            {copied ? "✓ Link copied — paste it in your wallet browser" : "📋 Copy voting link"}
          </button>
        </div>

        {/* ── FIRST TIME · the one-time setup, secondary and below. MiniPay
            users already hold a standalone wallet, so they skip it entirely. ── */}
        {!isMiniPay && (
          <div style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <SectionLabel>First time? · one-time setup</SectionLabel>
            <Step n={1} title="Export your key">In <strong style={{ color: T.ink }}>Settings → Export wallet key</strong>.</Step>
            <Step n={2} title="Import into a wallet">MetaMask, Rabby or any wallet — app on phone, extension on PC.</Step>
            <Step n={3} title="Then vote">Come back here and use the steps above. After this, it&apos;s 10 seconds a week.</Step>

            {/* Warning · same danger-tint idiom as the Settings gas-block row */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", borderRadius: 12, padding: "11px 12px" }}>
              <span style={{ fontSize: 16, lineHeight: 1.2 }}>🔒</span>
              <div style={{ fontFamily: T.body, fontSize: 12, color: "#fda4af", lineHeight: 1.5 }}>
                Your key controls your money. Never share it. GameArena will <strong style={{ color: "#fecdd3" }}>never</strong> DM you for it.
              </div>
            </div>

            <button
              onClick={() => router.push("/settings")}
              style={{
                width: "100%", cursor: "pointer",
                borderRadius: 12, padding: "13px", fontFamily: T.display, fontSize: 15,
                color: "#1a0552", background: "linear-gradient(180deg, #c4b5fd 0%, #a78bfa 100%)",
                border: "1px solid rgba(255,255,255,0.35)",
              }}
            >
              🔑 Export in Settings
            </button>
          </div>
        )}

        <button
          onClick={() => router.push("/dashboard")}
          style={{ background: "none", border: "none", color: T.inkSoft, fontFamily: T.body, fontSize: 13, cursor: "pointer", padding: 6 }}
        >
          Maybe later
        </button>
      </div>

      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
