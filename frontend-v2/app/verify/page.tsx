"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";

const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";

const BG_ICONS = [
  { src: D, top: "3%",  left: "-14px", size: 100, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18 },
  { src: G, top: "30%", left: "6px",   size: 90,  delay: 1.4, dur: 6.0, glow: "#aa88ff", rotate: -6  },
  { src: J, top: "65%", left: "-6px",  size: 85,  delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8  },
  { src: D, top: "0%",  right: "-18px",size: 95,  delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20  },
  { src: J, top: "25%", right: "44px", size: 80,  delay: 1.2, dur: 4.8, glow: "#22aaff", rotate: 8   },
  { src: G, top: "70%", right: "6px",  size: 92,  delay: 1.8, dur: 5.8, glow: "#aa88ff", rotate: -10 },
];

// Recessed info panel
function InfoCard({ children, accentColor }: { children: React.ReactNode; accentColor?: string }) {
  return (
    <div style={{
      borderRadius: "14px",
      background: "linear-gradient(180deg, rgba(12,4,40,0.95) 0%, rgba(6,1,22,0.98) 100%)",
      border: `1px solid ${accentColor ? accentColor + "60" : "rgba(110,60,220,0.4)"}`,
      boxShadow: [
        `0 0 18px ${accentColor ? accentColor + "25" : "rgba(100,50,200,0.2)"}`,
        "inset 0 3px 10px rgba(0,0,0,0.75)",
        "inset 0 0 30px rgba(40,0,100,0.3)",
      ].join(", "),
      padding: "12px 14px",
      position: "relative", overflow: "hidden",
    }}>
      {accentColor && (
        <div style={{
          position: "absolute", top: 0, left: 0, bottom: 0, width: "3px",
          background: `linear-gradient(180deg, ${accentColor} 0%, ${accentColor}55 100%)`,
          borderRadius: "14px 0 0 14px",
          boxShadow: `0 0 10px ${accentColor}99`,
        }} />
      )}
      <div style={{ paddingLeft: accentColor ? "10px" : 0 }}>{children}</div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{ flex: 1, height: "1px", background: "linear-gradient(90deg, transparent 0%, rgba(140,80,255,0.7) 100%)" }} />
      <span style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.18em", color: "rgba(190,150,255,0.9)", textShadow: "0 0 14px rgba(160,100,255,0.9)", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: "1px", background: "linear-gradient(90deg, rgba(140,80,255,0.7) 0%, transparent 100%)" }} />
    </div>
  );
}

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/games";

  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const { isVerified, isVerifying, verifyIdentity } = useSelfVerification();

  // Guard: must be connected to be on this page
  useEffect(() => {
    const connected = authenticated || (isMiniPay && !!address);
    if (!connected) {
      router.replace(`/connect?next=${encodeURIComponent(next)}`);
    }
  }, [authenticated, address, isMiniPay, next, router]);

  // Auto-advance if already verified
  useEffect(() => {
    if (isVerified) {
      router.replace(next);
    }
  }, [isVerified, next, router]);

  const unlocks = [
    { icon: "💰", label: "CLAIM G$ WEEKLY", desc: "Free GoodDollar every week. No purchase needed.", accent: "#fde68a" },
    { icon: "🏆", label: "TOP THE LEADERBOARD", desc: "Your verified score counts. Unverified plays don't rank.", accent: "#c084fc" },
    { icon: "⚡", label: "WAGER & WIN", desc: "Place wagers in skill games. Win real G$.", accent: "#86efac" },
  ];

  const steps = [
    { num: "1", text: "Tap Verify below. We generate a secure link." },
    { num: "2", text: "A GoodDollar tab opens. Complete the face scan." },
    { num: "3", text: "Return here. You're verified for life." },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, overflow: "hidden",
      background: "radial-gradient(ellipse 80% 60% at 50% 15%, #6a18c8 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)",
    }}>
      {/* Vignette */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 50%, transparent 35%, rgba(5,1,20,0.55) 100%)",
      }} />

      {/* Background floating icons */}
      {BG_ICONS.map((icon, i) => (
        <div key={i} className="icon-float" style={{
          position: "absolute",
          top: icon.top,
          ...("left" in icon ? { left: icon.left as string } : { right: icon.right as string }),
          width: icon.size, height: icon.size,
          transform: `rotate(${icon.rotate}deg)`,
          filter: `drop-shadow(0 0 8px ${icon.glow}99)`,
          ["--dur" as string]: `${icon.dur}s`,
          ["--delay" as string]: `${icon.delay}s`,
          userSelect: "none", pointerEvents: "none",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon.src} alt="" width={icon.size} height={icon.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}

      <main style={{
        position: "absolute", inset: 0, overflowY: "auto",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "20px", gap: "24px",
      }}>
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/components/game_arena_text.png"
          alt="Game Arena"
          style={{ width: "clamp(180px, 28vw, 380px)", height: "auto", animation: "bounce-scale-in 0.7s cubic-bezier(0.34,1.56,0.64,1) both", flexShrink: 0 }}
        />

        {/* Panel wall */}
        <div style={{
          width: "100%", maxWidth: "420px",
          borderRadius: "28px",
          background: "#1a0550",
          paddingBottom: "8px",
          boxShadow: "0 0 0 3px #5b21b6, 0 0 60px rgba(109,40,217,0.6), 0 40px 80px rgba(0,0,0,0.95)",
          animation: "scaleIn 0.25s cubic-bezier(0.16,1,0.3,1) both",
        }}>
          {/* Panel face */}
          <div style={{
            borderRadius: "26px 26px 20px 20px",
            background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 45%, #07021a 100%)",
            border: "2px solid rgba(255,255,255,0.12)",
            boxShadow: "inset 0 8px 24px rgba(160,100,255,0.15)",
            overflow: "hidden", position: "relative",
          }}>
            {/* Top gloss */}
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: "70px",
              background: "linear-gradient(180deg, rgba(200,160,255,0.14) 0%, transparent 100%)",
              borderRadius: "26px 26px 0 0", pointerEvents: "none",
            }} />

            {/* Header */}
            <div style={{
              background: "linear-gradient(90deg, #4c1d95 0%, #7c3aed 40%, #9333ea 60%, #7c3aed 80%, #4c1d95 100%)",
              padding: "18px 24px",
              borderBottom: "2px solid rgba(255,255,255,0.18)",
              boxShadow: "inset 0 6px 16px rgba(255,255,255,0.2)",
              position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: "55%",
                background: "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, transparent 100%)",
                borderRadius: "26px 26px 60px 60px", pointerEvents: "none",
              }} />
              <h2 style={{
                margin: 0, fontSize: "15px", fontWeight: 900, letterSpacing: "0.12em",
                color: "white", textShadow: "0px 2px 4px rgba(0,0,0,0.5), 0 0 20px rgba(200,150,255,0.6)",
                position: "relative", zIndex: 1,
              }}>ONE-TIME SETUP</h2>
              <p style={{
                margin: "4px 0 0", fontSize: "12px", color: "rgba(255,255,255,0.7)",
                position: "relative", zIndex: 1,
              }}>Verify once. Unlock everything. Never again.</p>
            </div>

            {/* Content */}
            <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>

              <SectionDivider label="WHAT YOU UNLOCK" />

              {unlocks.map(u => (
                <InfoCard key={u.label} accentColor={u.accent}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "22px", flexShrink: 0 }}>{u.icon}</span>
                    <div>
                      <div style={{ color: "white", fontSize: "12px", fontWeight: 900, letterSpacing: "0.06em" }}>{u.label}</div>
                      <div style={{ color: "rgba(180,150,255,0.8)", fontSize: "11.5px", marginTop: "2px", lineHeight: 1.4 }}>{u.desc}</div>
                    </div>
                  </div>
                </InfoCard>
              ))}

              <SectionDivider label="HOW IT WORKS" />

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {steps.map(s => (
                  <InfoCard key={s.num}>
                    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                      <div style={{
                        flexShrink: 0, width: "24px", height: "24px", borderRadius: "50%",
                        background: "radial-gradient(circle at 38% 32%, #c084fc, #5b21b6 70%)",
                        border: "1.5px solid rgba(200,150,255,0.5)",
                        boxShadow: "0 0 10px rgba(140,70,255,0.55)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <span style={{ fontSize: "11px", fontWeight: 900, color: "white" }}>{s.num}</span>
                      </div>
                      <div style={{ color: "rgba(200,175,255,0.85)", fontSize: "12.5px", lineHeight: 1.5, paddingTop: "2px" }}>{s.text}</div>
                    </div>
                  </InfoCard>
                ))}
              </div>

              {/* Verify CTA button */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => !isVerifying && verifyIdentity()}
                style={{
                  cursor: isVerifying ? "default" : "pointer",
                  userSelect: "none",
                  transition: "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
                  opacity: isVerifying ? 0.85 : 1,
                  marginTop: "4px",
                }}
                onMouseEnter={e => { if (!isVerifying) (e.currentTarget as HTMLDivElement).style.transform = "scale(1.03) translateY(-3px)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"; }}
                onMouseDown={e => { if (!isVerifying) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(5px)"; }}
                onMouseUp={e => { if (!isVerifying) (e.currentTarget as HTMLDivElement).style.transform = "scale(1.03) translateY(-3px)"; }}
              >
                {/* Wall */}
                <div style={{
                  borderRadius: "20px",
                  background: isVerifying ? "#1a4a00" : "#003a00",
                  paddingBottom: "7px",
                  boxShadow: `0 12px 28px -6px ${isVerifying ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.65)"}, inset 0 -3px 8px rgba(0,0,0,0.4)`,
                }}>
                  {/* Face */}
                  <div style={{
                    borderRadius: "18px 18px 14px 14px",
                    background: isVerifying
                      ? "linear-gradient(160deg, #4ade80 0%, #16a34a 50%, #166534 100%)"
                      : "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
                    padding: "18px 24px",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "12px",
                    position: "relative", overflow: "hidden",
                    border: "2.5px solid rgba(255,255,255,0.45)",
                    boxShadow: "inset 0 10px 22px rgba(255,255,255,0.8), inset 0 -5px 12px rgba(0,0,0,0.25)",
                  }}>
                    {/* Gloss */}
                    <div style={{
                      position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
                      background: "linear-gradient(180deg, rgba(255,255,255,0.75) 0%, transparent 100%)",
                      borderRadius: "16px 16px 80px 80px", pointerEvents: "none",
                    }} />
                    {/* Specular */}
                    <div style={{
                      position: "absolute", top: "8px", left: "20px", width: "32px", height: "12px",
                      background: "rgba(255,255,255,0.9)", borderRadius: "50%",
                      filter: "blur(2px)", transform: "rotate(-15deg)", pointerEvents: "none",
                    }} />
                    {isVerifying ? (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" style={{ zIndex: 1, animation: "icon-float 1s ease-in-out infinite" }}>
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style={{ zIndex: 1, filter: "drop-shadow(0px 2px 3px rgba(0,0,0,0.4))" }}>
                        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                      </svg>
                    )}
                    <span style={{
                      zIndex: 1, color: "white", fontSize: "16px", fontWeight: 900,
                      letterSpacing: "0.06em", textShadow: "0px 2px 4px rgba(0,0,0,0.35)",
                    }}>
                      {isVerifying ? "VERIFYING..." : "VERIFY WITH GOODDOLLAR"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Skip */}
              <button
                onClick={() => router.push(next)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "rgba(160,130,210,0.55)", fontSize: "11.5px",
                  letterSpacing: "0.06em", textAlign: "center", fontFamily: "inherit",
                  padding: "4px 0 8px",
                }}
              >
                Skip for now — I'll verify later
              </button>
            </div>
          </div>
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
