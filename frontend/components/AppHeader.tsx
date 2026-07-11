"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { celo } from "viem/chains";
import { formatEther } from "viem";
import { CONTRACT_ADDRESSES, ERC20_ABI, GAME_PASS_ABI } from "@/lib/contracts";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { AccountSheet } from "@/components/AccountSheet";
import { playClick } from "@/hooks/useAppAudio";
import NotificationsSheet, { useUnreadNotificationsCount } from "@/components/NotificationsSheet";
import { useGasStatus } from "@/hooks/useGasStatus";

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const BoltIcon = ({ size = 13 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>;
const BellIcon = ({ size = 17 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22m7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1z" /></svg>;

// Compact 2-3 decimal formatter for native CELO display.
function fmtCelo(wei?: bigint) {
  if (!wei) return "0";
  const n = Number(formatEther(wei));
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toFixed(4);
}

// Round-down G$ to whole units (token is 18 decimals).
function fmtG(rawWei?: bigint) {
  if (!rawWei) return "0";
  const whole = Number(rawWei / BigInt(1e18));
  if (whole >= 1000) return `${(whole / 1000).toFixed(1)}k`;
  return String(whole);
}

export default function AppHeader() {
  const router = useRouter();
  const { authenticated, logout } = usePrivy();
  const { address } = useAccount();
  const audio = useAudioSettings();
  // Notifications sheet · slides up from the bottom when the bell is
  // tapped. Wires to the player's recent score events + achievement
  // unlocks; the unread count drives the red dot on the bell.
  const [notifOpen, setNotifOpen] = useState(false);
  // Dual-token chip opens the AccountSheet · the slide-up hub for wallet
  // (G$ send/receive, CELO address copy) + quick nav (profile, settings).
  // Replaces the previous "tap chip → /profile" routing, which made the
  // chip a dead-end for the daily action (send G$) that actually matters.
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const unreadCount = useUnreadNotificationsCount(address);
  // Gas-low signal on the dual-token chip. Same source of truth as the
  // lobby gate + AccountSheet status pill · pulses on the CELO icon so a
  // player tapping into ANY surface sees the warning without having to
  // open the sheet first. Tap behavior is unchanged (still opens
  // AccountSheet) so the rich top-up flow stays in one place.
  const { status: gasStatus } = useGasStatus();
  const showGasDot = gasStatus === "warn" || gasStatus === "block";
  const gasDotColor = gasStatus === "block" ? "#fb7185" : "#fbbf24";
  // Mute icon only kills the ambient pad (the constant loop on menu
  // surfaces). UI feedback, SFX, and in-game music are untouched —
  // granular per-channel control lives in Settings → Audio.
  const muted = !audio.appAudioOn;
  // Breakpoint mirrors /dashboard's so the centered content column lines up
  // with the page's content. Header band itself spans the full viewport.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const innerMax = isDesktop ? 1180 : 480;
  const innerPad = isDesktop ? "0 32px" : "0 16px";

  // GamePass gate — "connected" means the player has finished onboarding
  // (mint completed). Authenticated-only users haven't picked a slime name
  // yet, so the design treats them as guests until the pass lands.
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

  // MiniPay users never sign in to Privy (the canonical MiniPay flow
  // skips Privy entirely · injected wallet is the identity). Treat them
  // as authenticated once they've minted GamePass · same gate as Privy
  // users from there.
  const isMiniPay = useIsMiniPay();
  const connected = (authenticated || isMiniPay) && !!address && hasMinted === true;
  // Signed in but never minted a GamePass — the "wrong Gmail / bailed on
  // onboarding" state. Gets its own header treatment (finish setup +
  // switch account) instead of masquerading as Guest.
  const authedUnminted = (authenticated || isMiniPay) && !!address && hasMinted === false;
  // GoodDollar / Self verification status · drives the ✓ overlay on the
  // avatar. Only shows when the player is fully connected AND verified ·
  // unverified state shows no badge at all (per design: never mark people
  // with a negative badge, just reward the positive).
  const { isVerified } = useSelfVerification();

  // Real on-chain balances — only fetched when fully connected.
  const { data: celoBal } = useBalance({
    address,
    chainId: celo.id,
    query: { enabled: connected, refetchInterval: 60_000 },
  });
  const { data: gBal } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: connected, refetchInterval: 90_000 },
  });

  // Display name = on-chain GamePass username (the slime name they picked).
  // We deliberately NEVER fall back to the wallet address — the design
  // treats anyone without a username as a guest.
  const name = (chainUsername as string | undefined) || "";

  // Real level + streak come from games-backend (`/api/user/{address}`),
  // same source profile uses. A previous version hardcoded `LV 1` and
  // streak `0` so the header didn't reflect any actual play.
  const [meta, setMeta] = useState<{ level: number; streak: number } | null>(null);
  useEffect(() => {
    if (!connected || !address) { setMeta(null); return; }
    let cancelled = false;
    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    fetch(`${backend}/api/user/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setMeta({ level: Number(d.level ?? 1), streak: Number(d.streak ?? 0) });
      })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [connected, address]);

  const toggleMute = () => {
    // Flip the ambient pad only. SFX + in-game music untouched.
    audio.update({ appAudioOn: muted });
    playClick();
  };

  return (
    <header style={{
      // Full-viewport sticky band. Background fills edge-to-edge so the
      // dark strip never breaks at the content gutter — same pattern every
      // modern game lobby uses (Discord, Riot launcher, Apple Arcade).
      position: "sticky", top: 0, zIndex: 50,
      width: "100%",
      background: "rgba(6,1,24,0.78)",
      backdropFilter: "blur(16px) saturate(160%)",
      WebkitBackdropFilter: "blur(16px) saturate(160%)",
      borderBottom: `1px solid ${T.hairline}`,
      // Soft shadow that only registers once you scroll under it — gives
      // the band depth without weight at rest.
      boxShadow: "0 8px 20px -16px rgba(0,0,0,0.6)",
    }}>
      <div style={{
        maxWidth: innerMax, margin: "0 auto",
        padding: innerPad,
        display: "flex", alignItems: "center",
        // Tighter gap on mobile so the daily-use cluster (mute · shop ·
        // wallet) doesn't get crowded against the avatar / name block.
        // Desktop keeps the original spacing now that it carries an
        // extra icon (bell) and the dual-token pill.
        gap: isDesktop ? 12 : 8,
        height: 68,
      }}>
        {/* Pet avatar · taps to /profile · verified players get a ✓ overlay
            (green = GoodDollar's G$ green, universally readable). The
            overlay anchors to a relative wrapper around the button so it
            never breaks layout flex alignment. */}
        <div style={{ position: "relative", flexShrink: 0 }}>
        <button onClick={() => router.push("/profile")} style={{
          width: 42, height: 42, borderRadius: 14,
          background: connected
            ? `radial-gradient(circle at 35% 30%, ${T.accent}dd, ${T.accent}33)`
            : "radial-gradient(circle at 35% 30%, rgba(148,163,184,0.6), rgba(148,163,184,0.12))",
          border: `1.5px solid ${connected ? T.accent + "66" : "rgba(148,163,184,0.4)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0, cursor: "pointer",
          boxShadow: connected ? `0 0 14px ${T.accent}33, inset 0 1px 0 rgba(255,255,255,0.2)` : "inset 0 1px 0 rgba(255,255,255,0.15)",
        }}>
          <img src="/pets/stage-2-baby.png" alt="" style={{ width: 34, height: 34, objectFit: "contain", filter: connected ? "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" : "grayscale(0.7) brightness(0.9)" }} />
        </button>
        {connected && isVerified && (
          <span
            aria-label="Verified human"
            title="Verified human"
            style={{
              position: "absolute", right: -3, bottom: -3,
              width: 16, height: 16, borderRadius: 999,
              background: "#22c55e",
              border: "1.5px solid #050010",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 4px rgba(34,197,94,0.55)",
              pointerEvents: "none",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          </span>
        )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.body, fontSize: 14, color: T.ink, fontWeight: 700, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {connected ? name : authedUnminted ? "Almost there" : "Guest"}
          </div>
          {connected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
              <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, letterSpacing: "0.06em", fontWeight: 700 }}>LV {meta?.level ?? 1}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 10, filter: "hue-rotate(180deg) saturate(1.2)" }}>🔥</span>
                <span style={{ fontFamily: T.body, fontSize: 10, color: "#bae6fd", fontWeight: 800, lineHeight: 1 }}>{meta?.streak ?? 0}</span>
              </span>
            </div>
          ) : authedUnminted ? (
            // Signed in but no GamePass — an account exists, setup was never
            // finished (or they signed into the wrong Gmail and bailed).
            // Copy stays SHORT and the row is wrap-proof: on a narrow
            // phone this column sits beside four buttons, and the longer
            // "finish your setup" line exploded into a 4-line tower.
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, minWidth: 0 }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: "#fbbf24", boxShadow: "0 0 6px #fbbf24", flexShrink: 0 }} />
              <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkDim, fontWeight: 700, letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Signed in</span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
              <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkDim, fontWeight: 700, letterSpacing: "0.02em" }}>Playing free · no sign-up</span>
            </div>
          )}
        </div>

        {/* Mute · always visible */}
        <button onClick={toggleMute} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"} style={{
          position: "relative", width: 38, height: 38, borderRadius: 12, flexShrink: 0,
          background: muted ? "rgba(244,63,94,0.12)" : "rgba(255,255,255,0.05)",
          border: `1px solid ${muted ? "rgba(244,63,94,0.4)" : T.hairline}`,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          color: muted ? "#fda4af" : T.inkDim,
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M4 9v6h3.5L13 19.5V4.5L7.5 9H4z" fill="currentColor" />
            {muted ? (
              <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M16.5 8.5a5 5 0 0 1 0 7M18.8 6.2a8.5 8.5 0 0 1 0 11.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            )}
          </svg>
        </button>

        {/* Bell · opens the notifications sheet (slide-up from the bottom).
            Unread count drives the small accent dot in the top-right
            corner — capped at 9+ so the badge never gets wide enough to
            push the button. */}
        <button onClick={() => { playClick(); setNotifOpen(true); }} aria-label="Notifications" title="Notifications" style={{
          position: "relative", width: 38, height: 38, borderRadius: 12, flexShrink: 0,
          background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: T.inkDim,
        }}>
          <BellIcon />
          {unreadCount > 0 && (
            <span style={{
              position: "absolute", top: 4, right: 4,
              minWidth: 14, height: 14, padding: "0 4px",
              borderRadius: 999,
              background: T.accent,
              border: "1.5px solid rgba(6,1,24,1)",
              boxShadow: `0 0 8px ${T.accent}99`,
              fontFamily: T.body, fontSize: 8.5, fontWeight: 900,
              color: "#fff", letterSpacing: "0.02em",
              display: "flex", alignItems: "center", justifyContent: "center",
              lineHeight: 1,
            }}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {/* Right cluster · dual-token wallet pill (connected) OR Sign in
          (guest). CELO (gas) on the left, G$ (engagement currency) on
          the right with a subtle gold wash. Players need both visible —
          CELO so they can spot empty-gas before a tx, G$ so they always
          know what they can spend in the shop. */}
        {connected ? (
          <button onClick={() => { playClick(); setAccountSheetOpen(true); }} aria-label="Open account" title="Account · wallet, profile, settings" style={{
            display: "flex", alignItems: "stretch",
            padding: 0, borderRadius: 12, cursor: "pointer", flexShrink: 0,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${T.hairline}`,
            height: 38,
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 9px" }} title={showGasDot ? (gasStatus === "block" ? "CELO · out of gas, scores can't save" : "CELO · running low, top up soon") : "CELO · network gas"}>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <img src="/tokens/celo.png" alt="" width={14} height={14} style={{ width: 14, height: 14, objectFit: "contain" }} />
                {/* Status dot · pulses on block (urgent), steady on warn
                    (informational). 8×8 with a dark ring so it reads on
                    any header background. Tap inherits from the chip ·
                    opens AccountSheet which has the full top-up row. */}
                {showGasDot && (
                  <span aria-hidden style={{
                    position: "absolute", top: -3, right: -4,
                    width: 8, height: 8, borderRadius: 999,
                    background: gasDotColor,
                    border: "1.5px solid #0a0228",
                    boxShadow: `0 0 6px ${gasDotColor}, 0 0 12px ${gasDotColor}66`,
                    animation: gasStatus === "block" ? "hdr-gas-pulse 1.4s ease-in-out infinite" : undefined,
                  }} />
                )}
              </span>
              <span style={{ fontFamily: T.display, fontSize: 12.5, color: showGasDot ? gasDotColor : T.ink, lineHeight: 1 }}>{fmtCelo(celoBal?.value)}</span>
              <style>{`
                @keyframes hdr-gas-pulse {
                  0%, 100% { transform: scale(1); opacity: 1; }
                  50%      { transform: scale(1.25); opacity: 0.7; }
                }
              `}</style>
            </span>
            <span style={{ width: 1, background: T.hairline }} />
            <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 11px 0 9px", background: "linear-gradient(90deg, transparent, rgba(251,191,36,0.08))" }} title="G$ · game token">
              <img src="/tokens/g-dollar.svg" alt="" width={14} height={14} style={{ width: 14, height: 14, objectFit: "contain" }} />
              <span style={{ fontFamily: T.display, fontSize: 12.5, color: "#fde68a", lineHeight: 1 }}>{fmtG(gBal as bigint | undefined)}</span>
            </span>
          </button>
        ) : authedUnminted ? (
          <>
            {/* Two exits from the half-done state: finish setup (reopens
                the onboarding overlay via ?ob=1) or switch account (the
                escape hatch for "I signed in with the wrong Gmail" —
                without it that player is permanently stuck). */}
            <button onClick={() => router.push("/home?ob=1")} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "9px 14px", borderRadius: 999, cursor: "pointer", flexShrink: 0,
              background: "linear-gradient(180deg, #fde68a, #d97706)",
              border: "1px solid rgba(251,191,36,0.8)",
              boxShadow: "0 6px 16px -4px rgba(251,191,36,0.5), inset 0 1px 0 rgba(255,255,255,0.45)",
              color: "#231005", fontFamily: T.body, fontSize: 12, fontWeight: 800, letterSpacing: "0.03em",
            }}>
              Finish setup
            </button>
            <button
              onClick={async () => { playClick(); await logout(); router.push("/home"); }}
              title="Switch account" aria-label="Switch account"
              style={{
                width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: T.inkDim,
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 17l5-5-5-5M21 12H9M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8" />
              </svg>
            </button>
          </>
        ) : (
          <button onClick={() => router.push("/home")} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: 999, cursor: "pointer", flexShrink: 0,
            background: `linear-gradient(180deg, ${T.accent}, ${T.accent}cc)`,
            border: `1px solid ${T.accent}`,
            boxShadow: `0 6px 16px -4px ${T.accent}88, inset 0 1px 0 rgba(255,255,255,0.35)`,
            color: "#fff", fontFamily: T.body, fontSize: 12.5, fontWeight: 800, letterSpacing: "0.03em",
          }}>
            <BoltIcon /> Sign in
          </button>
        )}

      </div>

      {/* Notifications · mounted at header root so the sheet overlays
          the whole viewport regardless of which page the header is
          rendered inside. */}
      <NotificationsSheet address={address} open={notifOpen} onClose={() => setNotifOpen(false)} />

      {/* Account hub · opens from the dual-token chip. Includes the player
          identity strip + wallet (G$ tappable for Send/Receive, CELO for
          copy-address) + quick nav to profile / settings. Address-gated
          internally so guest taps no-op. */}
      <AccountSheet open={accountSheetOpen} onClose={() => setAccountSheetOpen(false)} />
    </header>
  );
}
