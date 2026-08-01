"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GUEST_PLAY_LIMIT } from "@/lib/guestLimit";

// ─── GuestLimitPrompt ─────────────────────────────────────────────────────────
// Shown when a guest has used up their free runs of a skill game. Blocks a new
// run and offers the one tap that unlocks unlimited play + saving: sign in.
// Same gold funnel styling as GuestScorePrompt so it reads as a sibling.

const FONT = 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif';

export default function GuestLimitPrompt({
  open,
  onClose,
  game,
}: {
  open: boolean;
  onClose: () => void;
  game: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(6,2,26,0.72)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 360, borderRadius: 20, overflow: "hidden",
          background: "linear-gradient(180deg, rgba(48,22,110,0.96) 0%, rgba(20,8,52,0.98) 100%)",
          border: "1px solid rgba(251,191,36,0.28)",
          boxShadow: "0 24px 60px -24px rgba(0,0,0,0.9)",
          padding: "22px 20px 18px", position: "relative",
        }}
      >
        <span aria-hidden style={{
          position: "absolute", top: -50, right: -40, width: 150, height: 150, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(251,191,36,0.22) 0%, transparent 70%)", pointerEvents: "none",
        }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "#fbbf24", boxShadow: "0 0 8px #fbbf24" }} />
          <span style={{ fontFamily: FONT, color: "#fde68a", fontSize: 10, fontWeight: 800, letterSpacing: "0.2em", textTransform: "uppercase" }}>
            Free plays used
          </span>
        </div>

        <div style={{ fontFamily: FONT, color: "rgba(255,255,255,0.95)", fontSize: 17, fontWeight: 800, lineHeight: 1.3, marginTop: 10 }}>
          That&apos;s your {GUEST_PLAY_LIMIT} free {game} runs.
        </div>
        <div style={{ fontFamily: FONT, color: "rgba(220,210,255,0.65)", fontSize: 12.5, fontWeight: 500, lineHeight: 1.5, marginTop: 6 }}>
          Sign in to keep playing — it&apos;s free. Unlock unlimited runs, land on the leaderboard, earn XP, and hatch your pet.
        </div>

        <button
          onClick={() => router.push("/home")}
          style={{
            marginTop: 16, width: "100%", cursor: "pointer", borderRadius: 12, padding: "12px",
            fontFamily: FONT, fontSize: 12.5, fontWeight: 900, letterSpacing: "0.12em", color: "#231005", border: "none",
            background: "linear-gradient(180deg, #fde68a 0%, #fbbf24 55%, #d97706 100%)",
            boxShadow: "0 8px 20px -8px rgba(251,191,36,0.7)",
          }}
        >
          SIGN IN &amp; KEEP PLAYING
        </button>
        <button
          onClick={onClose}
          style={{
            marginTop: 8, width: "100%", cursor: "pointer", borderRadius: 12, padding: "10px",
            fontFamily: FONT, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em",
            color: "rgba(220,210,255,0.6)", background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          NOT NOW
        </button>
      </div>
    </div>
  );
}
