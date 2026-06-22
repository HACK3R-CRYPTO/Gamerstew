"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract } from "wagmi";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";

// Tokens shared with /shop, /settings, /profile so the verify screen
// feels like a continuation of the rest of the redesigned app.
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  good: "#22c55e",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

function CheckIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
function ChevRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
function SpinIcon({ size = 20 }: { size?: number }) {
  return (
    <span style={{
      display: "inline-block",
      width: size, height: size, borderRadius: "50%",
      border: "2.5px solid rgba(255,255,255,0.35)",
      borderTopColor: "#fff",
      animation: "verify-spin 0.8s linear infinite",
    }} />
  );
}

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  // The post-onboarding flow lands here. `next` defaults to /dashboard
  // (the new app home) instead of /games so verified players see their
  // pet + stats first, not the games hub.
  const next = params.get("next") ?? "/dashboard";

  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const { isVerified, isVerifying, verifyIdentity } = useSelfVerification();

  // GamePass username so the welcome line is real ("Welcome, @lyra!")
  // instead of generic. Reads only when minted; falls back to "player"
  // if the read hasn't returned yet.
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: chainUsername } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "getUsername",
    args: address ? [address] : undefined,
    query: { enabled: !!address && hasMinted === true },
  });
  const username = (chainUsername as string | undefined) || "player";

  // Auth guard: must be connected to be on this page.
  useEffect(() => {
    const connected = authenticated || (isMiniPay && !!address);
    if (!connected) {
      router.replace(`/home`);
    }
  }, [authenticated, address, isMiniPay, router]);

  // Auto-advance when verified — same hook as before, just with the new
  // /dashboard default for `next`.
  useEffect(() => {
    if (isVerified) {
      router.replace(next);
    }
  }, [isVerified, next, router]);

  const benefits = [
    { icon: "🪙", txt: "Claim free G$ every 24 hours" },
    { icon: "🏆", txt: "Enter prize pools & seasonal cups" },
    { icon: "🤖", txt: "Play head-to-head matches for G$" },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, overflow: "hidden",
      background: `radial-gradient(ellipse 95% 55% at 50% 16%, rgba(34,197,94,0.18) 0%, transparent 60%), ${T.bg}`,
      color: T.ink, fontFamily: T.body,
      animation: "verify-fade 0.25s ease both",
    }}>
      <style>{`
        @keyframes verify-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes verify-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes verify-float-gentle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes verify-sparkle-a { 0%, 100% { opacity: 0.7; transform: translateY(0) rotate(0); } 50% { opacity: 1; transform: translateY(-4px) rotate(8deg); } }
        @keyframes verify-sparkle-b { 0%, 100% { opacity: 0.6; transform: translateY(0) rotate(0); } 50% { opacity: 1; transform: translateY(-6px) rotate(-10deg); } }
      `}</style>

      <main style={{
        position: "absolute", inset: 0, overflowY: "auto",
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "clamp(20px, 4vw, 32px) clamp(16px, 4vw, 22px) clamp(24px, 5vw, 40px)",
        paddingTop: "max(clamp(20px, 4vw, 32px), env(safe-area-inset-top, 0px))",
        paddingBottom: "max(clamp(24px, 5vw, 40px), env(safe-area-inset-bottom, 0px))",
        gap: 16,
      }}>

        {/* Compact welcome — celebration folded in here, no separate
            "You're in → Continue" step. Lands directly on the choice. */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: T.body, fontSize: 11, color: "#86efac", fontWeight: 800, letterSpacing: "0.18em" }}>YOU&apos;RE IN 🎉</div>
          <h2 style={{ fontFamily: T.display, fontSize: 25, color: T.ink, margin: "5px 0 0", letterSpacing: "-0.01em" }}>Welcome, @{username}!</h2>
        </div>

        {/* G$ coin hero — green gradient sphere with soft glow + sparkles */}
        <div style={{ position: "relative", width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            position: "absolute", width: 120, height: 120, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(34,197,94,0.4), transparent 70%)",
            filter: "blur(10px)",
          }} />
          <span style={{
            position: "absolute", top: "6%", left: "12%", fontSize: 18,
            animation: "verify-sparkle-a 2.8s ease-in-out infinite",
          }}>✨</span>
          <span style={{
            position: "absolute", top: "16%", right: "10%", fontSize: 14,
            animation: "verify-sparkle-b 3.3s ease-in-out infinite 0.3s",
          }}>⭐</span>
          <div style={{
            width: 104, height: 104, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #86efac, #16a34a 55%, #14532d)",
            border: "3px solid rgba(255,255,255,0.45)",
            boxShadow: "0 0 36px rgba(34,197,94,0.5), inset 0 -6px 14px rgba(0,0,0,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", zIndex: 1,
            animation: "verify-float-gentle 3.4s ease-in-out infinite",
          }}>
            <span style={{
              fontFamily: T.display, fontSize: 40, color: "#fff",
              textShadow: "0 2px 6px rgba(0,0,0,0.35)",
            }}>G$</span>
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: T.body, fontSize: 11, color: "#86efac", fontWeight: 800, letterSpacing: "0.16em" }}>FREE DAILY REWARD</div>
          <h2 style={{ fontFamily: T.display, fontSize: 27, color: T.ink, margin: "6px 0 0", letterSpacing: "-0.01em" }}>Claim free G$ every day</h2>
        </div>

        {/* What verifying unlocks · three benefit rows */}
        <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 8 }}>
          {benefits.map((r, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 11,
              padding: "11px 13px", borderRadius: 13,
              background: T.surface, border: `1px solid ${T.hairline}`,
            }}>
              <span style={{ fontSize: 17, flexShrink: 0 }}>{r.icon}</span>
              <span style={{ flex: 1, fontFamily: T.body, fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{r.txt}</span>
              <span style={{ color: "#22c55e", display: "inline-flex" }}><CheckIcon /></span>
            </div>
          ))}
        </div>

        <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, textAlign: "center", marginTop: -6 }}>
          One quick face check proves you&apos;re human. Takes ~30s.
        </div>

        {/* Primary CTA — Verify & claim G$ (green gradient pill) */}
        <button
          onClick={() => { if (!isVerifying) verifyIdentity(); }}
          disabled={isVerifying}
          style={{
            width: "100%", maxWidth: 340,
            fontFamily: T.display, fontSize: 18, color: "#fff",
            padding: "16px", borderRadius: 16,
            background: "linear-gradient(180deg, #22c55e, #15803d)",
            border: "1.5px solid #22c55e",
            boxShadow: "0 14px 30px -8px rgba(34,197,94,0.6), inset 0 1px 0 rgba(255,255,255,0.4)",
            cursor: isVerifying ? "default" : "pointer",
            opacity: isVerifying ? 0.85 : 1,
            letterSpacing: "0.01em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
          }}
        >
          {isVerifying ? (
            <>
              <SpinIcon size={18} /> Verifying…
            </>
          ) : (
            <>
              <span style={{ fontSize: 17 }}>🌍</span> Verify &amp; claim G$
            </>
          )}
        </button>

        <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center", marginTop: -8, lineHeight: 1.4 }}>
          You can verify anytime from your profile.
        </div>

        {/* Skip — equal-weight outlined choice, not faint ghost text.
            Most casual players take this path; it must read as safe. */}
        <button
          onClick={() => router.push(next)}
          style={{
            width: "100%", maxWidth: 340,
            fontFamily: T.display, fontSize: 16, color: T.ink,
            padding: "14px", borderRadius: 16,
            background: "rgba(255,255,255,0.05)",
            border: `1.5px solid ${T.hairlineHi}`,
            cursor: "pointer", letterSpacing: "0.01em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          Skip — just start playing <ChevRightIcon />
        </button>

        <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center", marginTop: -8, lineHeight: 1.4 }}>
          No rush — this stays here for whenever.
        </div>
      </main>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
