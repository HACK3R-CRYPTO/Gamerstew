"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useIsMiniPay } from "@/hooks/useMiniPay";

const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";

const BG_ICONS = [
  { src: D, top: "2%",  left: "-16px",  size: 110, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18 },
  { src: G, top: "22%", left: "8px",    size: 100, delay: 1.4, dur: 6.0, glow: "#aa88ff", rotate: -6  },
  { src: J, top: "55%", left: "-8px",   size: 95,  delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8  },
  { src: M, top: "80%", left: "50px",   size: 80,  delay: 1.0, dur: 4.2, glow: "#ffaa00", rotate: 14  },
  { src: D, top: "0%",  right: "-20px", size: 105, delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20  },
  { src: J, top: "18%", right: "50px",  size: 90,  delay: 1.2, dur: 4.8, glow: "#22aaff", rotate: 8   },
  { src: G, top: "62%", right: "4px",   size: 100, delay: 1.8, dur: 5.8, glow: "#aa88ff", rotate: -10 },
  { src: D, top: "85%", right: "40px",  size: 88,  delay: 2.4, dur: 5.2, glow: "#cc44ff", rotate: 10  },
];

// Juicy button — same wall+face+gloss pattern as home page buttons
function JuicyBtn({
  onClick, wall, gradient, glow, icon, label, sub,
}: {
  onClick: () => void;
  wall: string;
  gradient: string;
  glow: string;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      style={{ cursor: "pointer", userSelect: "none", transition: "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.03) translateY(-3px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"; }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(5px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.03) translateY(-3px)"; }}
    >
      <div style={{
        borderRadius: "18px", background: wall, paddingBottom: "6px",
        boxShadow: `0 10px 24px -6px ${glow}, inset 0 -3px 8px rgba(0,0,0,0.4)`,
      }}>
        <div style={{
          borderRadius: "16px 16px 12px 12px",
          background: gradient,
          padding: "16px 20px",
          display: "flex", alignItems: "center", gap: "16px",
          position: "relative", overflow: "hidden",
          border: "2px solid rgba(255,255,255,0.4)",
          boxShadow: "inset 0 8px 18px rgba(255,255,255,0.7), inset 0 -4px 10px rgba(0,0,0,0.25)",
        }}>
          {/* Gloss crescent */}
          <div style={{
            position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.65) 0%, transparent 100%)",
            borderRadius: "14px 14px 60px 60px", pointerEvents: "none",
          }} />
          {/* Specular dot */}
          <div style={{
            position: "absolute", top: "7px", left: "14px", width: "28px", height: "10px",
            background: "rgba(255,255,255,0.88)", borderRadius: "50%",
            filter: "blur(2px)", transform: "rotate(-14deg)", pointerEvents: "none",
          }} />
          <div style={{ zIndex: 1, filter: "drop-shadow(0px 2px 3px rgba(0,0,0,0.4))", flexShrink: 0 }}>
            {icon}
          </div>
          <div style={{ zIndex: 1, flex: 1 }}>
            <div style={{ color: "white", fontSize: "15px", fontWeight: 900, letterSpacing: "0.06em", textShadow: "0px 2px 4px rgba(0,0,0,0.4)" }}>{label}</div>
            <div style={{ color: "rgba(255,255,255,0.82)", fontSize: "11.5px", marginTop: "2px", textShadow: "0px 1px 2px rgba(0,0,0,0.3)" }}>{sub}</div>
          </div>
          <div style={{ zIndex: 1 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/games";

  const { login, logout, authenticated, ready } = usePrivy();
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();

  const isConnected = ready && (authenticated || (isMiniPay && !!address));
  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;
  const source = isMiniPay ? "MiniPay" : "Privy";

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

      {/* Back button */}
      <button
        onClick={() => router.back()}
        style={{
          position: "absolute", top: "20px", left: "24px", zIndex: 10,
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: "12px", padding: "8px 16px",
          color: "rgba(255,255,255,0.8)", fontSize: "12px", fontWeight: 700,
          letterSpacing: "0.08em", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
          fontFamily: "inherit",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
        BACK
      </button>

      <main style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "20px", gap: "28px",
      }}>
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/components/game_arena_text.png"
          alt="Game Arena"
          style={{ width: "clamp(200px, 32vw, 420px)", height: "auto", animation: "bounce-scale-in 0.7s cubic-bezier(0.34,1.56,0.64,1) both" }}
        />

        {/* Panel wall */}
        <div style={{
          width: "100%", maxWidth: "400px",
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
              }}>CONNECT WALLET</h2>
              <p style={{
                margin: "4px 0 0", fontSize: "12px", color: "rgba(255,255,255,0.7)",
                letterSpacing: "0.03em", position: "relative", zIndex: 1,
              }}>Connect once. Play forever.</p>
            </div>

            {/* Content area — changes based on connection state */}
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {isConnected ? (
                // Already connected — show status + explicit Continue
                <>
                  {/* Connected status card */}
                  <div style={{
                    borderRadius: "14px",
                    background: "linear-gradient(180deg, rgba(12,4,40,0.95) 0%, rgba(6,1,22,0.98) 100%)",
                    border: "1px solid rgba(34,197,94,0.45)",
                    boxShadow: "0 0 18px rgba(34,197,94,0.15), inset 0 3px 10px rgba(0,0,0,0.75)",
                    padding: "14px 16px",
                    display: "flex", alignItems: "center", gap: "12px",
                  }}>
                    <div style={{
                      width: "10px", height: "10px", borderRadius: "50%",
                      background: "#22c55e", boxShadow: "0 0 10px rgba(34,197,94,0.8)",
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#86efac", fontSize: "12px", fontWeight: 900, letterSpacing: "0.06em" }}>WALLET CONNECTED</div>
                      <div style={{ color: "rgba(180,150,255,0.75)", fontSize: "11.5px", marginTop: "2px" }}>
                        {source} · {shortAddr ?? "embedded wallet"}
                      </div>
                    </div>
                    {/* Disconnect — lets user switch account */}
                    <button
                      onClick={() => logout()}
                      style={{
                        background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)",
                        borderRadius: "8px", padding: "5px 10px",
                        color: "rgba(252,165,165,0.85)", fontSize: "10px", fontWeight: 700,
                        letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit",
                        flexShrink: 0,
                      }}
                    >
                      SWITCH
                    </button>
                  </div>

                  {/* Continue juicy button */}
                  <JuicyBtn
                    onClick={() => router.push(`/verify?next=${encodeURIComponent(next)}`)}
                    wall="#003a00"
                    gradient="linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)"
                    glow="rgba(34,197,94,0.6)"
                    label="CONTINUE"
                    sub="Next: one-time GoodDollar setup"
                    icon={
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm3.707 9.293a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L12.586 13H8a1 1 0 110-2h4.586l-1.293-1.293a1 1 0 011.414-1.414l3 3z"/>
                      </svg>
                    }
                  />
                </>
              ) : (
                // Not connected — show wallet options
                <>
                  <JuicyBtn
                    onClick={login}
                    wall="#003a00"
                    gradient="linear-gradient(160deg, #6ee76e 0%, #22c55e 50%, #15803d 100%)"
                    glow="rgba(34,197,94,0.6)"
                    label="SOCIAL LOGIN"
                    sub="Google · Email — Best for new players"
                    icon={
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    }
                  />

                  <JuicyBtn
                    onClick={login}
                    wall="#003050"
                    gradient="linear-gradient(160deg, #67e8f9 0%, #06b6d4 50%, #0e7490 100%)"
                    glow="rgba(6,182,212,0.6)"
                    label="CRYPTO WALLET"
                    sub="MetaMask · MiniPay · WalletConnect"
                    icon={
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                        <rect x="2" y="5" width="20" height="14" rx="3" fill="none" stroke="white" strokeWidth="2"/>
                        <path d="M2 10h20" stroke="white" strokeWidth="2"/>
                        <circle cx="7" cy="15" r="1.5" fill="white"/>
                        <rect x="10" y="13.5" width="7" height="3" rx="1.5" fill="white"/>
                      </svg>
                    }
                  />

                  <p style={{
                    margin: 0, textAlign: "center", fontSize: "11px",
                    color: "rgba(180,150,255,0.6)", letterSpacing: "0.04em",
                  }}>
                    On Opera Mini? You auto-connect as MiniPay.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <Suspense>
      <ConnectInner />
    </Suspense>
  );
}
