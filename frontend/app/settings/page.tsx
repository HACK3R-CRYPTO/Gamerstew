"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract, useBalance, useDisconnect } from "wagmi";
import { celo } from "viem/chains";
import { formatEther } from "viem";
import { CONTRACT_ADDRESSES, ERC20_ABI, GAME_PASS_ABI } from "@/lib/contracts";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

// Token system matches /profile + /shop so the three surfaces read as
// one design system. Claude-design row pattern (icon tile + label + sub
// + control). Audio surface = main branch's three-channel mix (music /
// sfx / app audio), each with its own toggle and 0–100 slider — same
// wiring already shipped via useAudioSettings.
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  bgSolid: "#0a0226",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  danger: "#f43f5e",
  good: "#22c55e",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const ICONS: Record<string, string> = {
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z",
  copy: "M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H8V7h11z",
  chev: "M9 6l1.41 1.41L5.83 12l4.58 4.59L9 18l-6-6zM15 6l-1.41 1.41L18.17 12l-4.58 4.59L15 18l6-6z",
  chevR: "M9 6l6 6-6 6",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6z",
};
function Icon({ name, size = 16, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d={ICONS[name] || ""} /></svg>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "0 4px 8px", fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

// Claude-design Row: 34×34 accent-tinted icon tile · bold label + sub · right-aligned control.
function Row({
  icon, label, sub, children, onClick,
}: { icon: React.ReactNode; label: string; sub?: React.ReactNode; children?: React.ReactNode; onClick?: () => void }) {
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px",
        borderRadius: 14,
        background: T.surface,
        border: `1px solid ${T.hairline}`,
        cursor: interactive ? "pointer" : "default",
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        background: "rgba(167,139,250,0.14)",
        border: `1px solid ${T.accent}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink, fontWeight: 700, lineHeight: 1.2 }}>{label}</div>
        {sub && <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, marginTop: 2, lineHeight: 1.35 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

// Toggle dimensions match the Claude-design SettingsSheet: 46×27 pill,
// 21×21 white knob, accent glow when on.
function Toggle({ on, onChange, disabled = false }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!on); }}
      aria-pressed={on}
      disabled={disabled}
      style={{
        width: 46, height: 27, borderRadius: 999, flexShrink: 0, cursor: disabled ? "not-allowed" : "pointer",
        position: "relative", padding: 0,
        background: on ? T.accent : "rgba(255,255,255,0.12)",
        border: `1px solid ${on ? T.accent : T.hairlineHi}`,
        boxShadow: on ? `0 0 12px ${T.accent}66, inset 0 1px 0 rgba(255,255,255,0.3)` : "none",
        transition: "all 0.18s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 21 : 2,
        width: 21, height: 21, borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        transition: "left 0.18s",
      }} />
    </button>
  );
}

// Inline volume slider, lives next to the channel toggle. Disabled when
// the channel is off so it dims instead of pretending it does anything.
function Slider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <input
      type="range" min={0} max={100} value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: 90, height: 22,
        accentColor: T.accent,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    />
  );
}

function fmtCelo(wei?: bigint) {
  if (!wei) return "0";
  const n = Number(formatEther(wei));
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(5);
}
function fmtG(rawWei?: bigint) {
  if (!rawWei) return "0";
  const whole = Number(rawWei / BigInt(1e18));
  return whole.toLocaleString();
}

export default function SettingsPage() {
  const router = useRouter();
  const { authenticated, logout } = usePrivy();
  const { address } = useAccount();
  // Wagmi's disconnect tears down the connector's wallet link so the
  // browser extension reflects "disconnected" instead of staying lit
  // up after a Privy-only logout. Without this, Rabby / MetaMask kept
  // showing the dapp as connected because Privy only managed its own
  // session, not the underlying wagmi connector.
  const { disconnect } = useDisconnect();
  const audio = useAudioSettings();

  const [isDesktop, setIsDesktop] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // GamePass — username + minted state. Matches the AppHeader gate so
  // the profile section here lines up with what other screens show.
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
  const connected = authenticated && !!address && hasMinted === true;

  // Balances for the wallet card. Hidden when not connected so we never
  // show fake zeros to guests.
  const { data: celoBal } = useBalance({ address, chainId: celo.id, query: { enabled: connected, refetchInterval: 20_000 } });
  const { data: gBal } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: connected, refetchInterval: 30_000 },
  });

  const { isVerified } = useSelfVerification();

  // Real push subscribe/unsubscribe surface. Three terminal states:
  // - "denied" → browser-level block; open a help affordance instead of toggling
  // - "unsupported" → not in this browser; show the chip and disable the row
  // - everything else → live Toggle
  const { state: pushState, subscribe, unsubscribe } = usePushNotifications(address);
  const pushOn = pushState === "subscribed";

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const onSignOut = async () => {
    // Two-step teardown so the wallet extension also reflects the
    // logout, not just Privy:
    //   1. wagmi disconnect — removes the connector binding, which the
    //      extension picks up and flips its "Connected" indicator off.
    //   2. Privy logout — clears the auth session cookie.
    // Both are best-effort; a hard reload after them guarantees fresh
    // state regardless of either failing silently.
    try { disconnect(); } catch { /* connector may already be detached */ }
    try { await logout(); } catch { /* privy session may already be gone */ }
    if (typeof window !== "undefined") window.location.href = "/home";
  };

  // Mobile layout = slide-up bottom sheet (matches the Claude design's
  // SettingsSheet and the rest of the app's sheet pattern — Events
  // detail, GameOver). Desktop layout = centered card (no point in
  // sheet styling when there's no edge to slide from).
  const sheetWrap: React.CSSProperties = isDesktop ? {
    minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body,
  } : {
    minHeight: "100vh", width: "100%",
    background: "rgba(2,0,12,0.78)",
    backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
    display: "flex", flexDirection: "column", justifyContent: "flex-end",
    color: T.ink, fontFamily: T.body,
    animation: "settings-fade 0.24s ease both",
  };
  const sheetInner: React.CSSProperties = isDesktop ? {
    maxWidth: 1180, margin: "0 auto",
    padding: "16px 32px 130px",
    display: "flex", flexDirection: "column", gap: 18,
  } : {
    background: "linear-gradient(180deg, rgba(20,8,52,0.98) 0%, rgba(8,2,28,0.99) 100%)",
    borderRadius: "26px 26px 0 0",
    border: `1px solid ${T.hairlineHi}`,
    borderBottom: "none",
    boxShadow: `0 -24px 60px -10px ${T.accent}33`,
    padding: "0 16px calc(env(safe-area-inset-bottom, 0px) + 90px)",
    maxHeight: "calc(100vh - 60px)",
    overflowY: "auto",
    animation: "settings-up 0.42s cubic-bezier(0.16, 1, 0.3, 1) both",
    display: "flex", flexDirection: "column", gap: 16,
  };

  return (
    <div style={sheetWrap}>
      <style>{`
        @keyframes settings-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes settings-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
      {isDesktop && <AppHeader />}

      <div style={sheetInner}>

        {/* Drag handle · mobile only */}
        {!isDesktop && (
          <div style={{ padding: "10px 0 2px", display: "flex", justifyContent: "center" }}>
            <div style={{ width: 44, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
          </div>
        )}

        {/* Header · back + title. Mobile shows a close (×) on the right
            instead of a back chip; sheet UX expects an X. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: isDesktop ? 4 : 2 }}>
          {isDesktop ? (
            <button onClick={() => router.back()} aria-label="Back" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px 8px 9px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim, fontFamily: T.body, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em" }}>
              <Icon name="back" size={15} color="currentColor" /> Back
            </button>
          ) : null}
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>Account</div>
            <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 28 : 22, color: T.ink, margin: "2px 0 0", lineHeight: 1.1, letterSpacing: "-0.005em" }}>Settings</h1>
          </div>
          {!isDesktop && (
            <button onClick={() => router.back()} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {/* PROFILE — only when fully connected (has GamePass) */}
        {connected && (
          <section>
            <SectionLabel>Profile</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Row
                icon="🐣"
                label="Pet name"
                sub={<span style={{ color: T.ink }}>@{(chainUsername as string | undefined) || "—"}</span>}
              />
              <Row
                icon="👛"
                label="Wallet"
                sub={address ? <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 11, color: T.ink, letterSpacing: "0.02em" }}>{`${address.slice(0, 10)}…${address.slice(-8)}`}</span> : "Not connected"}
                onClick={address ? copyAddress : undefined}
              >
                {address && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 999, background: copied ? "rgba(34,197,94,0.16)" : "rgba(255,255,255,0.05)", border: `1px solid ${copied ? "rgba(134,239,172,0.5)" : T.hairline}`, color: copied ? "#86efac" : T.inkDim, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em" }}>
                    {copied ? "COPIED" : (<><Icon name="copy" size={12} color="currentColor" /> COPY</>)}
                  </span>
                )}
              </Row>
              <Row
                icon="🪪"
                label="GoodDollar verification"
                sub={isVerified ? "Verified · daily G$ unlocked" : "Verify with face check to claim daily G$"}
                onClick={isVerified ? undefined : () => router.push(`/verify?next=${encodeURIComponent("/settings")}`)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: isVerified ? "rgba(34,197,94,0.14)" : "rgba(167,139,250,0.14)", border: `1px solid ${isVerified ? "rgba(134,239,172,0.45)" : `${T.accent}55`}`, color: isVerified ? "#86efac" : T.accent, fontFamily: T.body, fontSize: 10, fontWeight: 900, letterSpacing: "0.1em" }}>
                  {isVerified ? "✓ VERIFIED" : "PENDING"}
                </span>
              </Row>
            </div>
          </section>
        )}

        {/* WALLET balances — connected only */}
        {connected && (
          <section>
            <SectionLabel>Wallet</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Row icon={<img src="/tokens/celo.png" alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain" }} />} label="CELO" sub="Network gas. Top up to send transactions.">
                <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink, lineHeight: 1 }}>{fmtCelo(celoBal?.value)}</span>
              </Row>
              <Row icon={<img src="/tokens/g-dollar.svg" alt="" width={24} height={24} style={{ width: 24, height: 24, objectFit: "contain" }} />} label="G$" sub="Game currency. Earn from claims and play, spend on habitats.">
                <span style={{ fontFamily: T.display, fontSize: 15, color: "#fde68a", lineHeight: 1, textShadow: "0 0 8px rgba(251,191,36,0.4)" }}>{fmtG(gBal as bigint | undefined)}</span>
              </Row>
            </div>
          </section>
        )}

        {/* AUDIO — 3-channel mix from useAudioSettings (matches main) */}
        <section>
          <SectionLabel>Audio &amp; feedback</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row icon="🎵" label="Music" sub="In-game soundtrack · rhythm + simon loops.">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Slider value={audio.musicOn ? audio.musicVol : 0} disabled={!audio.musicOn} onChange={(v) => audio.update({ musicVol: v })} />
                <Toggle on={audio.musicOn} onChange={(v) => audio.update({ musicOn: v })} />
              </div>
            </Row>
            <Row icon="🔊" label="Sound effects" sub="Taps, hits, misses, win stings.">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Slider value={audio.sfxOn ? audio.sfxVol : 0} disabled={!audio.sfxOn} onChange={(v) => audio.update({ sfxVol: v })} />
                <Toggle on={audio.sfxOn} onChange={(v) => audio.update({ sfxOn: v })} />
              </div>
            </Row>
            <Row icon="✨" label="App audio" sub="Ambient pad, UI clicks, level-up chimes.">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Slider value={audio.appAudioOn ? audio.appAudioVol : 0} disabled={!audio.appAudioOn} onChange={(v) => audio.update({ appAudioVol: v })} />
                <Toggle on={audio.appAudioOn} onChange={(v) => audio.update({ appAudioOn: v })} />
              </div>
            </Row>
            <Row icon="📳" label="Haptics" sub="Vibrate on hit, miss, claim.">
              <Toggle on={audio.hapticsOn} onChange={(v) => audio.update({ hapticsOn: v })} />
            </Row>
          </div>
        </section>

        {/* NOTIFICATIONS — single push toggle, handles browser block/unsupported */}
        {connected && (
          <section>
            <SectionLabel>Notifications</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Row
                icon="🔔"
                label="Push notifications"
                sub={
                  pushState === "denied"
                    ? "Blocked by browser. Unblock in site settings to enable."
                    : pushState === "unsupported"
                      ? "Not supported in this browser."
                      : "Streak nudges, event results, MARKOV rematch alerts."
                }
              >
                {pushState === "denied" ? (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 10px", borderRadius: 999, background: "rgba(252,165,165,0.12)", border: "1px solid rgba(252,165,165,0.4)", color: "rgba(252,165,165,0.95)", fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em" }}>
                    BLOCKED
                  </span>
                ) : pushState === "unsupported" ? (
                  <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em" }}>UNAVAILABLE</span>
                ) : (
                  <Toggle on={pushOn} onChange={async (v) => { if (v) { await subscribe(); } else { await unsubscribe(); } audio.update({ notifOn: v }); }} />
                )}
              </Row>
            </div>
          </section>
        )}

        {/* GAMEPLAY — only Language for now, faded read-only until i18n
            ships. Reduce-motion was dropped because the app's keyframes
            aren't gated on it; surfacing a toggle that doesn't change
            anything is worse than not having it. */}
        <section>
          <SectionLabel>Gameplay</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ opacity: 0.55, pointerEvents: "none" }} aria-disabled="true">
              <Row
                icon="🌐"
                label="Language"
                sub="More languages land when translations ship."
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, color: T.inkDim, fontFamily: T.body, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
                  English
                </span>
              </Row>
            </div>
          </div>
        </section>

        {/* ABOUT / LEGAL — link list (Claude design pattern) */}
        <section>
          <SectionLabel>About</SectionLabel>
          <div style={{ borderRadius: 14, background: T.surface, border: `1px solid ${T.hairline}`, overflow: "hidden" }}>
            {[
              { label: "How it works", href: "/pitch" },
              { label: "Provably fair · on-chain scores", href: "/pitch" },
              { label: "Terms of service", href: "/terms" },
              { label: "Privacy policy", href: "/privacy" },
            ].map((item, i, arr) => (
              <button
                key={item.label}
                onClick={() => router.push(item.href)}
                style={{
                  width: "100%",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 14px",
                  background: "transparent",
                  border: "none",
                  borderBottom: i < arr.length - 1 ? `1px solid ${T.hairline}` : "none",
                  cursor: "pointer",
                  fontFamily: T.body, fontSize: 12.5, color: T.inkDim, fontWeight: 600,
                  textAlign: "left",
                }}
              >
                {item.label}
                <Icon name="chevR" size={14} color={T.inkSoft} />
              </button>
            ))}
          </div>
        </section>

        {/* SIGN OUT / SIGN IN */}
        {authenticated ? (
          <section>
            <button
              onClick={onSignOut}
              style={{
                width: "100%", padding: "14px 14px",
                borderRadius: 16,
                background: "rgba(244,63,94,0.10)",
                border: `1px solid ${T.danger}44`,
                color: "#fda4af",
                fontFamily: T.body, fontSize: 13, fontWeight: 800, letterSpacing: "0.08em",
                cursor: "pointer",
              }}
            >
              SIGN OUT
            </button>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, marginTop: 6, padding: "0 4px", lineHeight: 1.4, textAlign: "center" }}>
              Drops your Privy session. On-chain progress stays · sign back in anytime.
            </div>
          </section>
        ) : (
          <section>
            <button
              onClick={() => router.push("/home")}
              style={{
                width: "100%", padding: "13px 14px",
                borderRadius: 14,
                background: `linear-gradient(180deg, ${T.accent}, ${T.accent}cc)`,
                border: `1px solid ${T.accent}`,
                boxShadow: `0 10px 22px -6px ${T.accent}88, inset 0 1px 0 rgba(255,255,255,0.35)`,
                color: "#fff",
                fontFamily: T.body, fontSize: 13, fontWeight: 900, letterSpacing: "0.1em",
                cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <Icon name="bolt" size={13} color="#fff" /> Sign in
            </button>
          </section>
        )}

        {/* Footer — matches Claude design's small build line */}
        <div style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, textAlign: "center", marginTop: 4, opacity: 0.65, letterSpacing: "0.04em" }}>
          Game Arena · v1.0 · Built on Celo
        </div>
      </div>

      {isDesktop && <AppBottomNav wide={isDesktop} />}
    </div>
  );
}
