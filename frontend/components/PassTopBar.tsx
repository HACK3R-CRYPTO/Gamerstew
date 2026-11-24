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
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 999, background: "#fff", border: "1px solid rgba(76,29,149,0.16)", cursor: "pointer", color: "#22104f", fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 13, fontWeight: 700 }}
      >
        ‹ Back
      </button>
      <button
        onClick={() => router.push("/")}
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 16, color: "#22104f" }}
      >
        GameArena
      </button>
    </div>
  );
}
