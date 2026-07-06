"use client";

import { useRouter } from "next/navigation";

// ─── MintScorePrompt ──────────────────────────────────────────────────────────
// Shown on a game's finish screen when the player HAS a connected wallet
// (often a GoodDollar-whitelisted one that came in to claim UBI) but has
// NOT minted a GamePass yet. Their score can't be saved on-chain without a
// pass (GamePass.recordScoreWithBackendSig reverts "No game pass"), so
// instead of firing a wallet tx that fails, we meet them at peak intent —
// they just posted a score and want it on the board — and invite the mint.
//
// This is a conversion moment, not an error. Play and UBI stay free; the
// mint is the one-tap upgrade that unlocks saving + the leaderboard. The
// GamePass mint self-funds its gas, so it's genuinely free to the player.
export default function MintScorePrompt({ score }: { score?: number }) {
  const router = useRouter();
  return (
    <div style={{
      marginTop: 18,
      borderRadius: 16,
      background: "linear-gradient(180deg, rgba(134,239,172,0.08) 0%, rgba(251,191,36,0.05) 100%)",
      border: "1px solid rgba(134,239,172,0.3)",
      padding: "14px 14px 12px",
      textAlign: "left",
      position: "relative",
      overflow: "hidden",
    }}>
      <span aria-hidden style={{
        position: "absolute", top: -40, right: -40, width: 120, height: 120,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(134,239,172,0.2) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "#4ade80", boxShadow: "0 0 8px #4ade80" }} />
        <span style={{
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
          color: "#86efac", fontSize: 10, fontWeight: 800, letterSpacing: "0.2em",
          textTransform: "uppercase",
        }}>Score not saved yet</span>
      </div>

      <div style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
        color: "rgba(255,255,255,0.92)", fontSize: 14, fontWeight: 700,
        lineHeight: 1.35, marginTop: 8, letterSpacing: "-0.005em",
      }}>
        {typeof score === "number" && score > 0
          ? `${score.toLocaleString()} points · get your free pass to save it.`
          : "Get your free pass to save your score."}
      </div>
      <div style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
        color: "rgba(220,210,255,0.6)", fontSize: 12, fontWeight: 500,
        lineHeight: 1.5, marginTop: 4,
      }}>
        One tap. Gas is on us.
      </div>

      <button
        onClick={() => router.push("/home")}
        style={{
          marginTop: 12, width: "100%", cursor: "pointer",
          borderRadius: 12, padding: "11px 12px",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
          fontSize: 12.5, fontWeight: 900, letterSpacing: "0.1em",
          color: "#04160a",
          background: "linear-gradient(180deg, #6ee76e 0%, #22c55e 55%, #15803d 100%)",
          border: "1px solid rgba(255,255,255,0.45)",
          boxShadow: "0 10px 22px -6px rgba(34,197,94,0.5), inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        GET FREE PASS &amp; SAVE
      </button>
    </div>
  );
}
