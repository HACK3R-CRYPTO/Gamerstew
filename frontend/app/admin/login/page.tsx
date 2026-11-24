"use client";

import { useState } from "react";

const WORDS: Record<string, string> = { wrong: "That email and password do not match.", locked: "Too many wrong tries. Wait 15 minutes and try again.", unreachable: "The game server cannot be reached.", missing: "Enter your email and password." };

export default function AdminLogin() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (r.ok) { window.location.href = "/admin"; return; }
      const j = await r.json().catch(() => ({})); setError(WORDS[j.error] ?? "Sign-in failed. Try again.");
    } catch { setError(WORDS.unreachable); } finally { setBusy(false); }
  };
  const field: React.CSSProperties = { width: "100%", padding: "13px 14px", borderRadius: 14, border: "1px solid rgba(76,29,149,0.2)", fontSize: 16, color: "#22104f", background: "#fff" };
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "radial-gradient(120% 60% at 50% 0%, #fbf8ff, #f0e8ff 45%, #e2d6ff)", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 24, padding: 24, border: "1px solid rgba(76,29,149,0.16)", boxShadow: "0 30px 60px -40px rgba(76,29,149,0.7)", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", color: "#6d28d9" }}>GAMEARENA</div>
          <h1 style={{ margin: "4px 0 0", fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontWeight: 400, fontSize: 30, color: "#22104f" }}>Admin sign in</h1>
        </div>
        <label style={{ display: "grid", gap: 6, fontSize: 13.5, fontWeight: 700, color: "#22104f" }}>Email
          <input style={field} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 13.5, fontWeight: 700, color: "#22104f" }}>Password
          <input style={field} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div role="alert" style={{ color: "#b91c1c", fontSize: 14, fontWeight: 600 }}>{error}</div>}
        <button disabled={busy} style={{ padding: "14px 0", borderRadius: 16, border: "none", background: "linear-gradient(180deg,#7c3aed,#6d28d9)", boxShadow: "0 5px 0 #4c1d95", color: "#fff", fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 19, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
