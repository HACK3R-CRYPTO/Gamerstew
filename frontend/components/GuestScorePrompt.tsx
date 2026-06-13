"use client";

import { useRouter } from "next/navigation";

// ─── GuestScorePrompt ─────────────────────────────────────────────────────────
// Shown on a game's finish screen in place of RewardPanel when the player
// is in free-play (no wallet session). Guest runs are never submitted —
// there's no session ticket, no voucher, no on-chain write — so instead of
// a silent gap where the rank/XP strip would be, we tell the player what
// they're missing and give them a one-tap path into the connect flow.
//
// The connect flow's next= param brings them straight back to the game,
// so the loop is: play free → get hooked → sign in → next run counts.
export default function GuestScorePrompt({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  return (
    <div style={{
      marginTop: "16px", padding: "14px 12px",
      borderRadius: "12px",
      background: "linear-gradient(180deg, rgba(251,191,36,0.12) 0%, rgba(251,191,36,0.05) 100%)",
      border: "1px solid rgba(251,191,36,0.35)",
      boxShadow: "0 0 20px rgba(251,191,36,0.15)",
      textAlign: "center",
    }}>
      <div style={{
        color: "#fbbf24", fontSize: "11px", fontWeight: 900, letterSpacing: "0.16em",
        textShadow: "0 0 12px rgba(251,191,36,0.5)",
      }}>
        FREE PLAY — SCORE NOT SAVED
      </div>
      <div style={{
        color: "rgba(220,200,255,0.75)", fontSize: "11px", fontWeight: 700,
        lineHeight: 1.5, marginTop: "6px",
      }}>
        Sign in to put your next run on the leaderboard,
        earn XP, and hatch your pet.
      </div>
      <button
        onClick={() => router.push(`/connect?next=${encodeURIComponent(nextPath)}`)}
        style={{
          marginTop: "10px", width: "100%",
          borderRadius: "12px", border: "none", cursor: "pointer",
          background: "#7c5004", paddingBottom: "4px", fontFamily: "inherit",
          boxShadow: "0 8px 18px -4px rgba(251,191,36,0.5)",
        }}
      >
        <div style={{
          borderRadius: "10px 10px 8px 8px",
          background: "linear-gradient(160deg, #fde68a 0%, #fbbf24 50%, #d97706 100%)",
          border: "2px solid rgba(255,255,255,0.45)",
          padding: "10px 12px",
          boxShadow: "inset 0 4px 8px rgba(255,255,255,0.5)",
        }}>
          <span style={{
            color: "#451a03", fontSize: "13px", fontWeight: 900, letterSpacing: "0.12em",
          }}>SIGN IN &amp; COMPETE</span>
        </div>
      </button>
    </div>
  );
}

// Small chip for idle/start screens — tells guests they're welcome to play
// and what signing in adds, without blocking anything.
export function GuestPlayChip() {
  return (
    <div style={{
      padding: "6px 14px", borderRadius: "999px",
      background: "rgba(251,191,36,0.1)",
      border: "1px solid rgba(251,191,36,0.3)",
      color: "rgba(253,230,138,0.9)",
      fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
      textAlign: "center",
    }}>
      FREE PLAY · SIGN IN TO SAVE SCORES &amp; EARN XP
    </div>
  );
}
