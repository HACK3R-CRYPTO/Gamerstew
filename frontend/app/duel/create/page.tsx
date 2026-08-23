"use client";

// ─── /duel/create · open a room ──────────────────────────────────────────────
// Two modes from the same primitive: a sponsored Prize Pool (free entry, you put
// up the prize, no cut, winner takes it all) or a Duel (everyone stakes, a fee
// goes to the treasury). Access is Code (share a link) or Allowlist (approve the
// exact wallets after). Matches the Arena Cup visual language.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { parseEther } from "viem";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { useDuel } from "@/hooks/useDuel";
import { DUEL_GAMES } from "@/lib/duel";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff", inkDim: "rgba(220,210,255,0.7)", inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.5)", hairline: "rgba(255,255,255,0.08)",
  gold: "#fde68a", green: "#34d399", cyan: "#22d3ee", accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const DURATIONS = [
  { label: "1 hour", hrs: 1 }, { label: "6 hours", hrs: 6 }, { label: "1 day", hrs: 24 },
  { label: "3 days", hrs: 72 }, { label: "7 days", hrs: 168 },
];

function randomCode(): string {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export default function CreateRoomPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { createRoom } = useDuel();

  const [mode, setMode] = useState<"pool" | "duel">("pool");
  const [gameType, setGameType] = useState(2); // Stack default
  const [amount, setAmount] = useState("50");   // prize (pool) or stake (duel), in G$
  const [capacity, setCapacity] = useState(20);
  const [hrs, setHrs] = useState(24);
  const [access, setAccess] = useState<"code" | "allowlist">("code");
  const [code] = useState(randomCode());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPool = mode === "pool";

  async function onCreate() {
    setErr(null);
    if (!isConnected || !address) { setErr("Connect your wallet first."); return; }
    const g = Number(amount);
    if (!(g > 0)) { setErr("Enter an amount greater than 0."); return; }
    if (capacity < 2) { setErr("At least 2 players."); return; }
    setBusy(true);
    try {
      const wei = parseEther(String(g));
      const id = await createRoom({
        gameType,
        stakeWei: isPool ? 0n : wei,
        seedWei: isPool ? wei : 0n,
        feeBps: isPool ? 0 : 1000,               // pool: no cut · duel: 10% to treasury
        capacity,
        deadlineSec: BigInt(Math.floor(Date.now() / 1000) + hrs * 3600),
        code: access === "code" ? code : "",
        useAllowlist: access === "allowlist",
      });
      // Carry the code so the room page can build the share link.
      router.push(`/duel/${id}${access === "code" ? `?code=${code}` : ""}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/USER_REJECTED/.test(m) ? "Signature cancelled." : "Couldn't create the room. Try again.");
      setBusy(false);
    }
  }

  const label = (s: string) => (
    <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{s}</div>
  );
  const Pill = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} style={{
      padding: "9px 14px", borderRadius: 12, cursor: "pointer", border: `1px solid ${on ? "transparent" : T.hairline}`,
      background: on ? T.accent : "rgba(255,255,255,0.04)", color: on ? "#150a2e" : T.inkDim,
      fontFamily: T.body, fontSize: 12.5, fontWeight: 800,
    }}>{children}</button>
  );

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "12px 16px 120px", display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ fontFamily: T.display, fontSize: 26, margin: "6px 0 0", letterSpacing: "-0.01em" }}>Create a room</h1>

        {/* mode */}
        <div>
          {label("Type")}
          <div style={{ display: "flex", gap: 8 }}>
            <Pill on={isPool} onClick={() => setMode("pool")}>🏆 Prize pool</Pill>
            <Pill on={!isPool} onClick={() => setMode("duel")}>⚔️ Duel (staked)</Pill>
          </div>
          <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>
            {isPool
              ? "You put up the prize, entry is free, winner takes the full amount. No cut."
              : "Everyone stakes the same. Winner takes the pot, 10% goes to your treasury."}
          </div>
        </div>

        {/* amount */}
        <div>
          {label(isPool ? "Prize (G$)" : "Stake per player (G$)")}
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal"
            style={{ width: "100%", padding: "13px 15px", borderRadius: 14, border: `1px solid ${T.hairline}`, background: "rgba(255,255,255,0.05)", color: T.ink, fontFamily: T.display, fontSize: 22, outline: "none" }} />
        </div>

        {/* game */}
        <div>
          {label("Game")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DUEL_GAMES.map((g) => <Pill key={g.type} on={gameType === g.type} onClick={() => setGameType(g.type)}>{g.label}</Pill>)}
          </div>
        </div>

        {/* players + duration */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            {label("Players")}
            <input value={capacity} onChange={(e) => setCapacity(Math.max(2, Number(e.target.value.replace(/[^0-9]/g, "")) || 2))} inputMode="numeric"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${T.hairline}`, background: "rgba(255,255,255,0.05)", color: T.ink, fontFamily: T.body, fontSize: 15, outline: "none" }} />
          </div>
          <div style={{ flex: 1.4 }}>
            {label("Ends in")}
            <select value={hrs} onChange={(e) => setHrs(Number(e.target.value))}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${T.hairline}`, background: "rgba(255,255,255,0.05)", color: T.ink, fontFamily: T.body, fontSize: 15, outline: "none" }}>
              {DURATIONS.map((d) => <option key={d.hrs} value={d.hrs} style={{ color: "#000" }}>{d.label}</option>)}
            </select>
          </div>
        </div>

        {/* access */}
        <div>
          {label("Who can join")}
          <div style={{ display: "flex", gap: 8 }}>
            <Pill on={access === "code"} onClick={() => setAccess("code")}>🔑 Share a code</Pill>
            <Pill on={access === "allowlist"} onClick={() => setAccess("allowlist")}>✅ Approve wallets</Pill>
          </div>
          <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>
            {access === "code"
              ? <>Only people with the code can join. Give it to whoever did the task (e.g. voted). Your code: <strong style={{ color: T.gold }}>{code}</strong></>
              : "Private and unlisted. After you create it, paste the exact wallets (your voted + verified list) that may join."}
          </div>
        </div>

        {err && <div style={{ color: "#fca5a5", fontSize: 12.5, fontWeight: 700 }}>{err}</div>}

        <button onClick={onCreate} disabled={busy}
          style={{ marginTop: 4, padding: "15px 20px", borderRadius: 16, border: "none", cursor: busy ? "wait" : "pointer",
            background: `linear-gradient(160deg, ${T.gold}, #f59e0b)`, color: "#150a2e", fontFamily: T.display, fontSize: 17, letterSpacing: "0.02em" }}>
          {busy ? "Confirming on Celo…" : isPool ? `Put up ${amount || 0} G$ prize` : `Create duel · ${amount || 0} G$`}
        </button>
        <div style={{ fontSize: 10.5, color: T.inkSoft, textAlign: "center", lineHeight: 1.5 }}>
          One signature. Your {isPool ? "prize" : "stake"} is escrowed on-chain and paid out automatically to the winner.
        </div>
      </div>
      <AppBottomNav wide={false} />
    </div>
  );
}
