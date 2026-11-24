"use client";

// Watch a friend room: type the room's code and look on without playing.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WatchHome() {
  const router = useRouter(); const [code, setCode] = useState("");
  const ok = /^[A-Za-z0-9]{5}$/.test(code);
  return (
    <main style={{ minHeight: "100dvh", background: "radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #efe6ff 55%, #e6dbff 100%)", color: "#22104f", display: "grid", placeItems: "center", padding: "calc(20px + env(safe-area-inset-top)) 20px 20px", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) router.push(`/watch/${code.toUpperCase()}`); }} style={{ width: "100%", maxWidth: 380, display: "grid", gap: 14, textAlign: "center" }}>
        <h1 style={{ fontFamily: "\"Melon Pop\", sans-serif", fontWeight: 400, fontSize: 34, margin: 0 }}>Watch a room</h1>
        <p style={{ margin: 0, color: "rgba(34,16,79,0.72)", fontSize: 15.5, lineHeight: 1.45 }}>Friends playing together? Enter their room code and follow the round live.</p>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase())} placeholder="CODE" inputMode="text" autoCapitalize="characters" autoFocus aria-label="Room code" style={{ padding: "16px 14px", borderRadius: 16, border: "2px solid rgba(109,40,217,0.3)", fontSize: 28, fontWeight: 800, letterSpacing: 10, textAlign: "center", color: "#22104f", background: "#fff" }} />
        <button disabled={!ok} style={{ padding: "15px 0", minHeight: 52, border: "none", borderRadius: 16, background: "linear-gradient(180deg,#7c3aed,#6d28d9)", boxShadow: "0 5px 0 #4c1d95", color: "#fff", fontWeight: 800, fontSize: 17, opacity: ok ? 1 : 0.5, cursor: ok ? "pointer" : "default" }}>Watch</button>
        <button type="button" onClick={() => router.push("/dashboard")} style={{ background: "none", border: "none", color: "#6d28d9", fontWeight: 700, fontSize: 15, padding: 10, cursor: "pointer" }}>Back to games</button>
      </form>
    </main>
  );
}
