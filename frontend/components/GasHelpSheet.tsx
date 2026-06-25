"use client";

// ─── GasHelpSheet ────────────────────────────────────────────────────────────
// One sheet, three intents. Every "open the community for help" CTA in the
// app converges here so the destination, copy, and outbound deep-link
// behavior stay identical no matter where the player came from:
//
//   intent="gas-help"     · player is blocked or warned on the lobby gate
//                           OR a submit failed with insufficient-funds
//   intent="prize-claim"  · player wants to collect a weekly / season prize
//   intent="general"      · default community door (Settings, AccountSheet)
//
// Why a single sheet · the AccountSheet → WalletSheet pattern showed that
// branching the same shape into multiple components fragments the UX
// (one route polished, others rotting). One sheet, prop-driven copy.
//
// Why portal · AppHeader has `backdrop-filter` on its sticky header which
// creates a containing block for `position: fixed` children. Any sheet
// mounted inside AppHeader gets trapped there. `createPortal(jsx, body)`
// escapes the trap. Same fix WalletSheet + AccountSheet + NotificationsSheet
// already use.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import {
  openTelegramWithContext,
  buildTelegramMessage,
  type TelegramContext,
} from "@/lib/telegramDeepLink";

export type GasHelpIntent = "gas-help" | "prize-claim" | "general";

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  amber: "#fbbf24",
  warn: "#fdba74",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

type Props = {
  open: boolean;
  onClose: () => void;
  intent: GasHelpIntent;
  // Optional context the player just came from · used to enrich the message
  // pre-fill (game key, score, week number). All optional.
  game?: string;        // "stack" | "rhythm" | "simon" | "survivor"
  score?: number;
  week?: number;
};

export function GasHelpSheet({ open, onClose, intent, game, score, week }: Props) {
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // Close on ESC · matches AccountSheet behavior
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body lock so the page can't drag-scroll behind the sheet
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

  // Desktop vs mobile (centered modal vs bottom sheet) · same 900px break
  // AccountSheet uses
  useEffect(() => {
    if (!open) return;
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // Build the deep-link context · only enrich fields the caller passed.
  // Wallet pulled from wagmi here so callers don't have to remember to pass it.
  const buildContext = (): TelegramContext => {
    const wallet = address || undefined;
    if (intent === "gas-help") return { kind: "gas-help", wallet, game, score };
    if (intent === "prize-claim") return { kind: "prize-claim", wallet, week };
    return { kind: "general", wallet };
  };

  const ctx = buildContext();
  const preview = buildTelegramMessage(ctx);

  const onOpenTelegram = async () => {
    if (opening) return;
    setOpening(true);
    const { opened, copied } = await openTelegramWithContext(ctx);
    setOpening(false);
    if (copied) setToast("Message copied · paste it in Telegram when you join");
    else if (opened) setToast("Opening Telegram · paste your wallet address in chat");
    else setToast("Couldn't open Telegram · long-press the link to copy");
    setTimeout(() => setToast(null), 3500);
  };

  // Copy ONLY (no open) · escape hatch for the player who already has TG
  // open in another tab and just wants the formatted message.
  const onCopyOnly = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      setToast("Message copied to clipboard");
      setTimeout(() => setToast(null), 2500);
    } catch {
      setToast("Couldn't copy · select the preview to copy manually");
      setTimeout(() => setToast(null), 3500);
    }
  };

  // ─── Copy strings per intent ──────────────────────────────────────────────
  const copy = (() => {
    if (intent === "gas-help") return {
      icon: "⛽",
      eyebrow: "GAS NEEDED",
      title: "Your scores need a bit of CELO",
      body: "Each save records onchain and needs a small amount of CELO for gas. Drop your wallet in the community group and a teammate will top you up.",
      cta: "Open Telegram",
      accent: T.amber,
      eyebrowColor: T.amber,
    };
    if (intent === "prize-claim") return {
      icon: "🏆",
      eyebrow: "PRIZE CLAIM",
      title: "Send your wallet in the community",
      body: "Drop your wallet in the chat and the team will route your G$ once payouts open. Pre-filled message has everything we need.",
      cta: "Open Telegram",
      accent: "#86efac",
      eyebrowColor: "#86efac",
    };
    return {
      icon: "💬",
      eyebrow: "COMMUNITY",
      title: "Player chat",
      body: "Ask for help, share runs, claim prizes, and follow weekly events. Tap below to join the chat.",
      cta: "Open Telegram",
      accent: T.accent,
      eyebrowColor: T.accent,
    };
  })();

  return createPortal(
    <>
      {/* Backdrop · matches AccountSheet's 0.92 opacity + 14px blur so the
          stack of sheets reads consistently */}
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
          animation: "gh-fade 0.22s ease both",
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: 460,
            background: "linear-gradient(180deg, rgba(20,8,52,0.98) 0%, rgba(8,2,28,0.99) 100%)",
            borderRadius: isDesktop ? 22 : "26px 26px 0 0",
            border: `1px solid ${T.hairlineHi}`,
            borderBottom: isDesktop ? `1px solid ${T.hairlineHi}` : "none",
            boxShadow: isDesktop
              ? `0 24px 60px -10px ${copy.accent}55, 0 0 0 1px rgba(255,255,255,0.04)`
              : `0 -24px 60px -10px ${copy.accent}33`,
            padding: isDesktop
              ? "18px 20px 22px"
              : "10px 18px calc(env(safe-area-inset-bottom, 0px) + 22px)",
            display: "flex", flexDirection: "column", gap: 14,
            animation: isDesktop
              ? "gh-zoom 0.32s cubic-bezier(0.16, 1, 0.3, 1) both"
              : "gh-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
            maxHeight: isDesktop ? "min(720px, calc(100dvh - 48px))" : "calc(100dvh - 60px)",
            overflowY: "auto",
          }}
        >
          <style>{`
            @keyframes gh-fade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes gh-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
            @keyframes gh-zoom { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          `}</style>

          {/* Drag handle (mobile) / close X (desktop) · same idiom AccountSheet uses */}
          {isDesktop ? (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onClose} aria-label="Close" style={{
                width: 32, height: 32, borderRadius: 999, cursor: "pointer",
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${T.hairline}`, color: T.inkDim,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", padding: "2px 0 4px" }}>
              <div style={{ width: 44, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
            </div>
          )}

          {/* ─── Header · big icon, eyebrow, title, body copy ────────────── */}
          <div style={{ textAlign: "center", padding: "4px 4px 0" }}>
            <div style={{ fontSize: 42, lineHeight: 1, marginBottom: 4 }}>{copy.icon}</div>
            <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 900, letterSpacing: "0.22em", color: copy.eyebrowColor, textTransform: "uppercase" }}>
              {copy.eyebrow}
            </div>
            <div style={{ fontFamily: T.display, fontSize: 20, color: T.ink, lineHeight: 1.2, marginTop: 6 }}>
              {copy.title}
            </div>
            <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, lineHeight: 1.55, marginTop: 8, padding: "0 4px" }}>
              {copy.body}
            </div>
          </div>

          {/* ─── Message preview · what gets pasted ──────────────────────── */}
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${T.hairline}`,
            borderRadius: 12, padding: "10px 12px",
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            fontSize: 11.5, color: T.ink, lineHeight: 1.55,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 120, overflowY: "auto",
          }}>
            {preview}
          </div>

          {/* ─── Primary + secondary CTAs ────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={onOpenTelegram}
              disabled={opening}
              style={{
                width: "100%", padding: "14px 16px", borderRadius: 14, cursor: opening ? "wait" : "pointer",
                background: `linear-gradient(160deg, ${copy.accent} 0%, ${copy.accent}cc 100%)`,
                border: `1.5px solid ${copy.accent}66`,
                color: "#0a0228",
                fontFamily: T.display, fontSize: 15, fontWeight: 900, letterSpacing: "0.08em",
                boxShadow: `0 8px 22px -6px ${copy.accent}88`,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {opening ? "Opening…" : (
                <>
                  <svg width="16" height="16" viewBox="0 0 240 240" fill="currentColor" aria-hidden>
                    <path d="M120 0a120 120 0 1 0 0 240 120 120 0 0 0 0-240Zm56 78-19 89c-1 6-5 8-11 5l-30-22-14 14c-2 2-3 3-6 3l2-31 57-51c2-2 0-3-3-1l-70 44-30-9c-7-2-7-7 1-10l118-45c5-2 10 1 9 13Z" />
                  </svg>
                  {copy.cta}
                </>
              )}
            </button>
            <button
              onClick={onCopyOnly}
              style={{
                width: "100%", padding: "11px 16px", borderRadius: 14, cursor: "pointer",
                background: "transparent",
                border: `1px solid ${T.hairlineHi}`,
                color: T.inkDim,
                fontFamily: T.body, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em",
              }}
            >
              Copy message only
            </button>
          </div>

          {/* ─── Tiny footnote · explains the clipboard trick once ───────── */}
          <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center", lineHeight: 1.5, padding: "0 4px" }}>
            {intent === "gas-help"
              ? "Tap Open · join the group · paste the message. The team usually tops up in minutes."
              : intent === "prize-claim"
              ? "Tap Open · join the group · paste the message. The team will confirm your claim."
              : "Tap Open · join the group · paste your wallet address to say hi."}
          </div>
        </div>
      </div>

      {/* Toast · confirms what the player should do next */}
      {toast && (
        <div role="status" style={{
          position: "fixed", left: "50%", bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
          transform: "translateX(-50%)", zIndex: 10000,
          padding: "10px 14px", borderRadius: 999,
          background: "rgba(20,8,52,0.96)",
          border: `1px solid ${T.hairlineHi}`,
          color: T.ink, fontFamily: T.body, fontSize: 12, fontWeight: 700,
          boxShadow: `0 16px 36px -10px ${copy.accent}66`,
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          maxWidth: "calc(100vw - 24px)", textAlign: "center",
          animation: "gh-fade 0.2s ease both",
        }}>{toast}</div>
      )}
    </>,
    document.body,
  );
}
