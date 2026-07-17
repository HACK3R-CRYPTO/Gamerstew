"use client";

import { useRouter } from "next/navigation";

// ─── GuestScorePrompt ─────────────────────────────────────────────────────────
// Shown on a game's finish screen in place of RewardPanel when the player
// is in free-play (no wallet session). Guest runs are never submitted —
// there's no session ticket, no voucher, no on-chain write — so instead of
// a silent gap where the rank/XP strip would be, we tell the player what
// they're missing and give them a one-tap path back to the home page where
// the Sign in flow lives. nextPath is kept on the type to stay
// backwards-compatible with callers, but it's no longer used since the
// auth entry now sits on /home, not on a separate /connect screen.
// Copy is overridable because not every game has a "run" or a "score".
// Challenge AI has a MATCH and a LADDER, and telling a player to "save your
// run" there reads as boilerplate. Defaults keep every existing caller
// byte-identical.
export default function GuestScorePrompt({
  nextPath: _nextPath,
  eyebrow = "Free play · run not saved",
  headline = "Sign in to save your next run.",
  sub = "Land on the leaderboard, earn XP, hatch your pet.",
  cta = "SIGN IN & COMPETE",
}: {
  nextPath: string;
  eyebrow?: string;
  headline?: string;
  sub?: string;
  cta?: string;
}) {
  const router = useRouter();
  return (
    <div style={{
      marginTop: 18,
      borderRadius: 16,
      background: "linear-gradient(180deg, rgba(251,191,36,0.06) 0%, rgba(232,121,249,0.04) 100%)",
      border: "1px solid rgba(251,191,36,0.22)",
      padding: "14px 14px 12px",
      textAlign: "left",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* soft glow accent in top-right corner — gives the panel some life
          without the heavy outer drop-shadow the old design relied on */}
      <span aria-hidden style={{
        position: "absolute", top: -40, right: -40, width: 120, height: 120,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(251,191,36,0.18) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Eyebrow row · status pill + dot */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 6, height: 6, borderRadius: 999,
          background: "#fbbf24", boxShadow: "0 0 8px #fbbf24",
        }} />
        <span style={{
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
          color: "#fde68a", fontSize: 10, fontWeight: 800, letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}>{eyebrow}</span>
      </div>

      <div style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
        color: "rgba(255,255,255,0.92)", fontSize: 14, fontWeight: 700,
        lineHeight: 1.35, marginTop: 8,
        letterSpacing: "-0.005em",
      }}>
        {headline}
      </div>
      <div style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
        color: "rgba(220,210,255,0.6)", fontSize: 12, fontWeight: 500,
        lineHeight: 1.5, marginTop: 4,
      }}>
        {sub}
      </div>

      {/* Sign-in CTA · matches the FinishedView's primary button shape */}
      <button
        onClick={() => router.push("/home")}
        style={{
          marginTop: 12, width: "100%", cursor: "pointer",
          borderRadius: 12, padding: "11px 12px",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
          fontSize: 12.5, fontWeight: 900, letterSpacing: "0.12em",
          color: "#231005",
          background: "linear-gradient(180deg, #fde68a 0%, #fbbf24 55%, #d97706 100%)",
          border: "1px solid rgba(255,255,255,0.45)",
          boxShadow: "0 10px 22px -6px rgba(251,191,36,0.5), inset 0 1px 0 rgba(255,255,255,0.55)",
        }}
      >
        {cta}
      </button>
    </div>
  );
}

// Small chip for idle/start screens — tells guests they're welcome to play
// and what signing in adds, without blocking anything.
export function GuestPlayChip() {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "6px 12px", borderRadius: 999,
      background: "rgba(251,191,36,0.08)",
      border: "1px solid rgba(251,191,36,0.28)",
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: 999,
        background: "#fbbf24", boxShadow: "0 0 6px #fbbf24",
      }} />
      <span style={{
        color: "rgba(253,230,138,0.92)", fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}>Free play · sign in to save</span>
    </div>
  );
}

// Signed-in-but-unminted twin of GuestPlayChip: play works, saving
// doesn't — because setup isn't finished, NOT because of gas. Every game
// lobby shows this instead of the misleading "out of gas" banner for
// unminted players, with the one tap that fixes it.
export function SetupPlayChip({ onFinishSetup }: { onFinishSetup: () => void }) {
  return (
    <button onClick={onFinishSetup} style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "8px 14px", borderRadius: 999, cursor: "pointer",
      background: "rgba(251,191,36,0.1)",
      border: "1px solid rgba(251,191,36,0.45)",
      fontFamily: "inherit",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: "#fbbf24", boxShadow: "0 0 6px #fbbf24" }} />
      <span style={{ color: "rgba(253,230,138,0.95)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Free play · finish setup to save scores ›
      </span>
    </button>
  );
}
