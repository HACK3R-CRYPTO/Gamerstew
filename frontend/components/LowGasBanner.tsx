"use client";

// ─── LowGasBanner ────────────────────────────────────────────────────────────
// Lobby-level status strip that surfaces the player's gas posture BEFORE
// they tap START. Two visible states · returns null when the player is
// safe, a guest, or on MiniPay (those have nothing to act on).
//
//   warn  · amber strip, soft tone, START still works · "fund up after"
//   block · stronger red-amber strip, conveys "you can't save scores yet"
//           and acts as the tappable handoff into GasHelpSheet
//
// Designed to sit between the leaderboard preview and the START button on
// each game's idle view. ~44px tall, full lobby width with a sensible cap.
// Tappable in both states so the player has one path to the help sheet.

import type { GasBucket } from "@/hooks/useGasStatus";

const T = {
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
};

// `score` · rhythm / simon / stack lobbies · player is trying to save a run
// `wager` · MARKOV / Arena lobby · player is trying to start a match
// Defaults to score because that's three of the four lobbies. The copy
// shift is small but makes the warning match what the player is actually
// trying to do · "scores won't save" reads wrong on a match-start screen.
export type LowGasContext = "score" | "wager";

type Props = {
  status: GasBucket;
  approxSavesLeft?: number | null;
  onOpenHelp: () => void;
  context?: LowGasContext;
};

export function LowGasBanner({ status, approxSavesLeft, onOpenHelp, context = "score" }: Props) {
  if (status !== "warn" && status !== "block") return null;

  const isBlock = status === "block";
  const isWager = context === "wager";
  const bg = isBlock
    ? "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(251,146,60,0.18))"
    : "linear-gradient(135deg, rgba(251,191,36,0.16), rgba(251,146,60,0.12))";
  const border = isBlock ? "rgba(251,146,60,0.55)" : "rgba(251,191,36,0.45)";
  const titleColor = isBlock ? "#fda4af" : "#fbbf24";
  const subColor = isBlock ? "rgba(253,186,116,0.85)" : "rgba(253,230,138,0.85)";
  const glow = isBlock ? "rgba(239,68,68,0.35)" : "rgba(251,191,36,0.3)";

  // Unit the player thinks in · "saves" for score-tracking games, "matches"
  // for the wager arena. Drives both the title (block-state) and the
  // "N left" subtitle (warn-state).
  const unitPlural = isWager ? "matches" : "saves";
  const title = isBlock
    ? (isWager ? "Out of gas · can't start a match" : "Out of gas · scores won't save")
    : "Gas getting low";
  const sub = isBlock
    ? "Tap to ask for a top-up in Telegram"
    : approxSavesLeft && approxSavesLeft > 0
      ? `About ${approxSavesLeft} ${unitPlural} left · top up soon`
      : (isWager ? "Top up soon to keep starting matches" : "Top up soon to keep saving scores");

  return (
    <button
      onClick={onOpenHelp}
      style={{
        width: "min(320px, 86vw)",
        padding: "11px 14px",
        borderRadius: 14,
        border: `1.5px solid ${border}`,
        background: bg,
        boxShadow: `0 0 22px ${glow}, 0 6px 18px -6px ${glow}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        textAlign: "left",
        animation: isBlock ? "lgb-pulse 1.8s ease-in-out infinite" : undefined,
      }}
    >
      <style>{`
        @keyframes lgb-pulse {
          0%, 100% { box-shadow: 0 0 22px ${glow}, 0 6px 18px -6px ${glow}; }
          50%      { box-shadow: 0 0 32px ${glow}, 0 6px 22px -4px ${glow}; }
        }
      `}</style>
      <div style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        background: isBlock ? "rgba(239,68,68,0.22)" : "rgba(251,191,36,0.22)",
        border: `1px solid ${border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
      }}>
        {isBlock ? "⛔" : "⚠️"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: T.display, fontSize: 13, color: titleColor, lineHeight: 1.15,
          textShadow: `0 0 8px ${glow}`, letterSpacing: "0.02em",
        }}>{title}</div>
        <div style={{
          fontFamily: T.body, fontSize: 10.5, color: subColor, lineHeight: 1.4, marginTop: 2,
          fontWeight: 700,
        }}>{sub}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={titleColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
