"use client";

// ─── AccountSheet ────────────────────────────────────────────────────────────
// Tap the dual-token chip in the AppHeader → this slide-up sheet opens.
// Three sections in one place:
//   1. Identity strip · avatar + name + LV/streak + verified ✓ if applicable
//   2. Wallet · G$ and CELO rows, both tappable
//        · G$ tap drills into <WalletSheet /> for Send / Receive / address QR
//        · CELO tap copies the wallet address with a confirmation chip
//          (native CELO send is not built yet · MiniPay handles top-ups
//          for the audience that doesn't already hold CELO)
//   3. Quick nav · Profile and Settings shortcuts so the chip becomes a
//      true account hub, not just a wallet popout
//
// Address-gated: nothing renders when the wallet isn't connected. Self-
// contained data fetching (useReadContract for chainUsername, useBalance
// for CELO, useReadContract for G$) so the sheet works on any page that
// mounts <AppHeader />.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { celo } from "viem/chains";
import { formatEther } from "viem";
import { CONTRACT_ADDRESSES, ERC20_ABI, GAME_PASS_ABI } from "@/lib/contracts";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { WalletSheet } from "@/components/WalletSheet";

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// Same compact formatters used in the header chip · keep balance display
// identical between the chip the player tapped and the sheet that opened.
function fmtCelo(wei?: bigint) {
  if (!wei) return "0";
  const n = Number(formatEther(wei));
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toFixed(4);
}
function fmtG(rawWei?: bigint) {
  if (!rawWei) return "0";
  const whole = Number(rawWei / BigInt(1e18));
  if (whole >= 1000) return `${(whole / 1000).toFixed(1)}k`;
  return String(whole);
}

export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { address } = useAccount();
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Player identity · same gates AppHeader uses, fetched here so the sheet
  // doesn't depend on a wired-through prop bundle. Wagmi caches the read so
  // there's no real network cost compared to AppHeader's own fetches.
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address && open },
  });
  const { data: chainUsername } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "getUsername",
    args: address ? [address] : undefined,
    query: { enabled: !!address && hasMinted === true && open },
  });
  const { data: celoBal } = useBalance({
    address,
    chainId: celo.id,
    query: { enabled: !!address && open, refetchInterval: 15_000 },
  });
  const { data: gBal } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && open, refetchInterval: 30_000 },
  });
  const { isVerified } = useSelfVerification();

  // Level + streak · live from games-backend, same fetch the AppHeader uses.
  const [meta, setMeta] = useState<{ level: number; streak: number } | null>(null);
  useEffect(() => {
    if (!open || !address) { setMeta(null); return; }
    let cancelled = false;
    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    fetch(`${backend}/api/user/${address}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setMeta({ level: Number(d.level ?? 1), streak: Number(d.streak ?? 0) });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, address]);

  // ESC closes from the sheet (and from any nested view above it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock the body while open so the page behind can't drag-scroll under
  // the sheet · same trick used on /home for iOS Safari. Without this the
  // sticky AppHeader stays in its own stacking context and the page
  // underneath visibly shifts when the player taps anywhere outside.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [open]);

  // Desktop vs mobile detection · sheet is slide-up from bottom on mobile
  // (matches Settings, WalletSheet, finished-views), centered modal on
  // desktop (a bottom sheet pinned to a 1920px-wide window looks orphaned
  // off in the corner). Synchronous read on mount + resize listener.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (!open) return;
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  if (!open || !address) return null;

  const username = (chainUsername as string | undefined) || "";
  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;

  const goTo = (path: string) => {
    onClose();
    router.push(path);
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked · player can long-press the address row instead */ }
  };

  // AccountSheet is mounted inside AppHeader (so onClose state lives next
  // to the chip that opens it). But AppHeader has backdropFilter on its
  // <header>, which creates a CONTAINING BLOCK that traps position: fixed
  // children to the header's bounds instead of the viewport. Render through
  // a portal into document.body to escape that trap · same pattern
  // NotificationsSheet uses for the exact same reason.
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* Backdrop · z-index well above the sticky AppHeader (z-50) and any
          page-level fixed elements. 0.92 opacity instead of 0.78 so the
          page behind is properly obscured · earlier 0.78 was bleeding the
          profile content through on bright pages. Mobile: backdrop holds
          the sheet at the bottom (flex-end). Desktop: centered modal so
          a narrow sheet doesn't sit lost in the corner of a wide window. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(2,0,12,0.92)",
          backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
          display: "flex", flexDirection: "column",
          justifyContent: isDesktop ? "center" : "flex-end",
          alignItems: "center",
          padding: isDesktop ? 24 : 0,
          animation: "acct-fade 0.22s ease both",
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: 520,
            background: "linear-gradient(180deg, rgba(20,8,52,0.98) 0%, rgba(8,2,28,0.99) 100%)",
            // Bottom-sheet on mobile (rounded top corners only), full card
            // on desktop (rounded all corners).
            borderRadius: isDesktop ? 22 : "26px 26px 0 0",
            border: `1px solid ${T.hairlineHi}`,
            borderBottom: isDesktop ? `1px solid ${T.hairlineHi}` : "none",
            boxShadow: isDesktop
              ? `0 24px 60px -10px ${T.accent}55, 0 0 0 1px rgba(255,255,255,0.04)`
              : `0 -24px 60px -10px ${T.accent}33`,
            padding: isDesktop
              ? "18px 18px 22px"
              : "10px 16px calc(env(safe-area-inset-bottom, 0px) + 24px)",
            display: "flex", flexDirection: "column", gap: 14,
            animation: isDesktop
              ? "acct-zoom 0.32s cubic-bezier(0.16, 1, 0.3, 1) both"
              : "acct-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
            maxHeight: isDesktop ? "min(720px, calc(100dvh - 48px))" : "calc(100dvh - 60px)",
            overflowY: "auto",
          }}
        >
          <style>{`
            @keyframes acct-fade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes acct-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
            @keyframes acct-zoom { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          `}</style>

          {/* Drag handle on mobile · close button on desktop. Bottom sheets
              get a handle (gestural close), centered modals get an X (no
              gesture target on desktop, so an explicit affordance). */}
          {isDesktop ? (
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 0 4px" }}>
              <button onClick={onClose} aria-label="Close" style={{
                width: 32, height: 32, borderRadius: 999, cursor: "pointer",
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${T.hairline}`,
                color: T.inkDim,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", padding: "2px 0 4px" }}>
              <div style={{ width: 44, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
            </div>
          )}

          {/* ─── Identity strip ─────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 4px 2px" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: `radial-gradient(circle at 35% 30%, ${T.accent}dd, ${T.accent}33)`,
                border: `1.5px solid ${T.accent}66`,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `0 0 14px ${T.accent}33`,
              }}>
                <img src="/pets/stage-2-baby.png" alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
              </div>
              {isVerified && (
                <span aria-label="Verified human" style={{
                  position: "absolute", right: -3, bottom: -3,
                  width: 18, height: 18, borderRadius: 999,
                  background: "#22c55e",
                  border: "1.5px solid #050010",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 1px 4px rgba(34,197,94,0.55)",
                }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.display, fontSize: 18, color: T.ink, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {username ? `@${username}` : "Player"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontFamily: T.body, fontSize: 10.5, color: T.inkDim, fontWeight: 700 }}>
                <span>LV {meta?.level ?? 1}</span>
                <span>·</span>
                <span style={{ color: "#bae6fd" }}>
                  🔥 {meta && meta.streak > 0 ? `${meta.streak}-day` : "New"}
                </span>
              </div>
            </div>
            {/* Copy address chip · primary way to grab the wallet to share
                with a friend who wants to send G$ in. Tapping the chip
                anywhere in the row also works for accessibility. */}
            <button
              onClick={copyAddress}
              title="Copy wallet address"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "6px 10px", borderRadius: 999, cursor: "pointer",
                background: copied ? "rgba(34,197,94,0.16)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${copied ? "rgba(134,239,172,0.5)" : T.hairline}`,
                color: copied ? "#86efac" : T.inkDim,
                fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em",
              }}
            >
              {copied ? "COPIED" : shortAddr}
            </button>
          </div>

          {/* ─── Wallet section ────────────────────────────────────────── */}
          <div>
            <SectionLabel>Your wallet</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* G$ row · taps into WalletSheet for Send / Receive / QR */}
              <TokenRow
                icon={<img src="/tokens/g-dollar.svg" alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain" }} />}
                label="G$"
                sub="Real GoodDollar money · send, receive, or spend in-game"
                amount={fmtG(gBal as bigint | undefined)}
                amountColor="#fde68a"
                onClick={() => setWalletSheetOpen(true)}
              />
              {/* CELO row · receive-only for now (no native send built yet).
                  Tap copies the address so a friend on MiniPay can top it up. */}
              <TokenRow
                icon={<img src="/tokens/celo.png" alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain" }} />}
                label="CELO"
                sub="Network gas · tap to copy address for top-up"
                amount={fmtCelo(celoBal?.value)}
                amountColor={T.ink}
                onClick={copyAddress}
              />
            </div>
          </div>

          {/* ─── Quick nav · profile + settings ─────────────────────────── */}
          <div>
            <SectionLabel>Account</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <NavRow icon="🐣" label="My pet · profile" sub="Stats, achievements, equipped habitat" onClick={() => goTo("/profile")} />
              <NavRow icon="⚙️" label="Settings" sub="Audio, notifications, verification, sign out" onClick={() => goTo("/settings")} />
            </div>
          </div>
        </div>
      </div>

      {/* Drill-down · existing WalletSheet handles G$ Send/Receive/QR.
          Renders ON TOP of AccountSheet, dismisses back to it on close. */}
      <WalletSheet
        open={walletSheetOpen}
        onClose={() => setWalletSheetOpen(false)}
        address={address as `0x${string}` | undefined}
      />
    </>,
    document.body,
  );
}

// ─── primitives · keep visual idiom consistent with Settings rows ───────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "2px 4px 8px", fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function TokenRow({
  icon, label, sub, amount, amountColor, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  amount: string;
  amountColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px", borderRadius: 14, cursor: "pointer",
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${T.hairline}`,
        textAlign: "left",
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${T.hairline}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.display, fontSize: 14, color: T.ink, lineHeight: 1.15 }}>{label}</div>
        <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, marginTop: 2, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: T.display, fontSize: 16, color: amountColor, lineHeight: 1, textShadow: amountColor === "#fde68a" ? "0 0 8px rgba(251,191,36,0.4)" : "none" }}>
          {amount}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="rgba(255,255,255,0.4)">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>
    </button>
  );
}

function NavRow({
  icon, label, sub, onClick,
}: {
  icon: string;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "11px 14px", borderRadius: 14, cursor: "pointer",
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${T.hairline}`,
        textAlign: "left",
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: `${T.accent}1f`,
        border: `1px solid ${T.accent}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.display, fontSize: 14, color: T.ink, lineHeight: 1.15 }}>{label}</div>
        <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, marginTop: 2, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="rgba(255,255,255,0.4)">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
