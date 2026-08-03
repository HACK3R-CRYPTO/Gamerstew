"use client";

// ─── Passport top bar ────────────────────────────────────────────────────────
// The passport is a public landing page — a visitor may have NO history and an
// owner arrives from inside the app. Back goes to history when there is one,
// home otherwise; the wordmark is always a door into the arena.

import { useRouter } from "next/navigation";

export default function PassTopBar() {
  const router = useRouter();
  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1 && document.referrer.startsWith(window.location.origin)) {
      router.back();
    } else {
      router.push("/");
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
      <button
        onClick={back}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", color: "rgba(220,210,255,0.7)", fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 11.5, fontWeight: 700 }}
      >
        ‹ Back
      </button>
      <button
        onClick={() => router.push("/")}
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 15, color: "#fff", letterSpacing: "0.04em", textShadow: "0 0 16px rgba(167,139,250,0.6)" }}
      >
        🎮 GAME ARENA
      </button>
    </div>
  );
}
