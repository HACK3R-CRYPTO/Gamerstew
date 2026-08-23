"use client";

// ─── /duel/create · open a room ──────────────────────────────────────────────
// Prize Pool (free entry, full prize, no cut) or Duel (stake, 10% treasury).
// Pick one or more games, set Public or Private (code / allowlist). Responsive
// + the same nav/width as the rest of the app.

import { useEffect, useState } from "react";
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

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const u = () => setIsDesktop(window.innerWidth >= 900);
    u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u);
  }, []);

  const [mode, setMode] = useState<"pool" | "duel">("pool");
  const [games, setGames] = useState<number[]>([2]);       // Stack default, multi-select
  const [amount, setAmount] = useState("50");
  const [capacity, setCapacity] = useState(20);
  const [hrs, setHrs] = useState(24);
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [gating, setGating] = useState<"code" | "allowlist">("code");
  const [code] = useState(randomCode());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPool = mode === "pool";
  const isPrivate = visibility === "private";

  function toggleGame(t: number) {
    setGames((g) => g.includes(t) ? (g.length > 1 ? g.filter((x) => x !== t) : g) : [...g, t]);
  }

  async function onCreate() {
    setErr(null);
    if (!isConnected || !address) { setErr("Connect your wallet first."); return; }
    const g = Number(amount);
    if (!(g > 0)) { setErr("Enter an amount greater than 0."); return; }
    if (capacity < 2) { setErr("At least 2 players."); return; }
    if (games.length === 0) { setErr("Pick at least one game."); return; }
    setBusy(true);
    try {
      const wei = parseEther(String(g));
      const useAllowlist = isPrivate && gating === "allowlist";
      const useCode = isPrivate && gating === "code";
      const id = await createRoom({
        gameType: games[0],
        games,
        stakeWei: isPool ? 0n : wei,
        seedWei: isPool ? wei : 0n,
        feeBps: isPool ? 0 : 1000,
        capacity,
        deadlineSec: BigInt(Math.floor(Date.now() / 1000) + hrs * 3600),
        code: useCode ? code : "",
        useAllowlist,
      });
      router.push(`/duel/${id}${useCode ? `?code=${code}` : ""}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/USER_REJECTED/.test(m) ? "Signature cancelled." : "Couldn't create the room. Try again.");
      setBusy(false);
    }
  }

  const Label = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{children}</div>
  );
  const Pill = ({ on, onClick, children, tint }: { on: boolean; onClick: () => void; children: React.ReactNode; tint?: string }) => (
    <button onClick={onClick} style={{
      padding: "9px 14px", borderRadius: 12, cursor: "pointer", border: `1px solid ${on ? "transparent" : T.hairline}`,
      background: on ? (tint ?? T.accent) : "rgba(255,255,255,0.04)", color: on ? "#150a2e" : T.inkDim,
      fontFamily: T.body, fontSize: 12.5, fontWeight: 800, transition: "all 0.12s",
    }}>{children}</button>
  );
  const inputBox: React.CSSProperties = { width: "100%", padding: "13px 15px", borderRadius: 14, border: `1px solid ${T.hairline}`, background: "rgba(255,255,255,0.05)", color: T.ink, outline: "none" };

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 640 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em" }}>ROOMS</div>
          <h1 style={{ fontFamily: T.display, fontSize: isDesktop ? 30 : 26, margin: "4px 0 0", letterSpacing: "-0.01em" }}>Create a room</h1>
        </div>

        {/* type */}
        <div>
          <Label>Type</Label>
          <div style={{ display: "flex", gap: 8 }}>
            <Pill on={isPool} onClick={() => setMode("pool")} tint={T.gold}>🏆 Prize pool</Pill>
            <Pill on={!isPool} onClick={() => setMode("duel")}>⚔️ Duel (staked)</Pill>
          </div>
          <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>
            {isPool ? "You put up the prize, entry is free, winner takes the full amount. No cut."
              : "Everyone stakes the same. Winner takes the pot, 10% goes to your treasury."}
          </div>
        </div>

        {/* amount */}
        <div>
          <Label>{isPool ? "Prize (G$)" : "Stake per player (G$)"}</Label>
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal"
            style={{ ...inputBox, fontFamily: T.display, fontSize: 22 }} />
        </div>

        {/* games · multi-select */}
        <div>
          <Label>Games {games.length > 1 ? `· ${games.length} selected` : ""}</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DUEL_GAMES.map((g) => <Pill key={g.type} on={games.includes(g.type)} onClick={() => toggleGame(g.type)}>{games.includes(g.type) ? "✓ " : ""}{g.label}</Pill>)}
          </div>
          {games.length > 1 && <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>Players compete across all {games.length} games. Scores are normalised per game so it&apos;s fair.</div>}
        </div>

        {/* players + duration */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>Players</Label>
            <input value={capacity} onChange={(e) => setCapacity(Math.max(2, Number(e.target.value.replace(/[^0-9]/g, "")) || 2))} inputMode="numeric" style={{ ...inputBox, fontSize: 15 }} />
          </div>
          <div style={{ flex: 1.4 }}>
            <Label>Ends in</Label>
            <select value={hrs} onChange={(e) => setHrs(Number(e.target.value))} style={{ ...inputBox, fontSize: 15 }}>
              {DURATIONS.map((d) => <option key={d.hrs} value={d.hrs} style={{ color: "#000" }}>{d.label}</option>)}
            </select>
          </div>
        </div>

        {/* visibility */}
        <div>
          <Label>Visibility</Label>
          <div style={{ display: "flex", gap: 8 }}>
            <Pill on={!isPrivate} onClick={() => setVisibility("public")} tint={T.green}>🌍 Public</Pill>
            <Pill on={isPrivate} onClick={() => setVisibility("private")}>🔒 Private</Pill>
          </div>
          <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>
            {isPrivate ? "Unlisted. Only people you invite (by code or wallet) can find and join." : "Listed in the Rooms hub. Anyone can find and join."}
          </div>
        </div>

        {/* gating (private only) */}
        {isPrivate && (
          <div>
            <Label>Who can join</Label>
            <div style={{ display: "flex", gap: 8 }}>
              <Pill on={gating === "code"} onClick={() => setGating("code")}>🔑 Share a code</Pill>
              <Pill on={gating === "allowlist"} onClick={() => setGating("allowlist")} tint={T.cyan}>✅ Approve wallets</Pill>
            </div>
            <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>
              {gating === "code"
                ? <>Give the code to whoever did the task (e.g. voted). Your code: <strong style={{ color: T.gold }}>{code}</strong></>
                : "After you create it, paste the exact wallets (your voted + verified list) that may join."}
            </div>
          </div>
        )}

        {err && <div style={{ color: "#fca5a5", fontSize: 12.5, fontWeight: 700 }}>{err}</div>}

        <button onClick={onCreate} disabled={busy}
          style={{ marginTop: 4, padding: "15px 20px", borderRadius: 16, border: "none", cursor: busy ? "wait" : "pointer",
            background: `linear-gradient(160deg, ${T.gold}, #f59e0b)`, color: "#150a2e", fontFamily: T.display, fontSize: 17, letterSpacing: "0.02em", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Confirming on Celo…" : isPool ? `Put up ${amount || 0} G$ prize` : `Create duel · ${amount || 0} G$`}
        </button>
        <div style={{ fontSize: 10.5, color: T.inkSoft, textAlign: "center", lineHeight: 1.5 }}>
          One signature. Your {isPool ? "prize" : "stake"} is escrowed on-chain and paid out automatically to the winner.
        </div>
      </div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
