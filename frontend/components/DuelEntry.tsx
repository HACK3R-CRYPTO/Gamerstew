"use client";

// ─── DuelEntry ───────────────────────────────────────────────────────────────
// A G$ duel, started from inside the game in one tap.
//
// Pick an entry (50 to 1,000 G$), tap Challenge, and a two-player room exists
// on-chain with your stake in it. You get a link to send; your friend opens
// it, matches the stake, and both of you play ranked. The higher score takes
// the pot, less 10%.
//
// It is seamless for anyone signed in with Google or email: their wallet lives
// inside the app and signs without a pop-up, so the tap is the whole step.
// The G$ never leaves the chain's escrow contract; the app does not hold it.
//
// Duels made here are always private (opened by link). Staked matches against
// strangers are deliberately not offered: the games run on the player's phone,
// and money against strangers needs scoring the server can fully verify first.

import { useEffect, useState } from "react";
import Link from "next/link";
import { erc20Abi, formatEther, parseEther } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { DUEL_GAMES } from "@/lib/duel";
import { useDuel } from "@/hooks/useDuel";

export type DuelGame = "rhythm" | "simon" | "stack" | "challenge-ai";

const G_TOKEN = CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`;
const ENTRIES = [50, 100, 250, 500, 1000] as const;
const FEE_BPS = 1000; // 10% of the pot
const RUNS_HOURS = 24;
const GOLD = "#fbbf24";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

/** What the winner receives from a two-player duel at this entry. */
export const winnerTakes = (entry: number) => Math.floor(entry * 2 * (1 - FEE_BPS / 10000));

export default function DuelEntry({ game, compact = false }: { game: DuelGame; compact?: boolean }) {
  const { address, isConnected } = useAccount();
  const { createRoom } = useDuel();
  const [entry, setEntry] = useState<number>(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: number; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Closed, it is one slim row: the game's own START button must stay on screen.
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  // On a short phone the closed row drops its second line, so START stays in view.
  const [tight, setTight] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); setTight(window.innerHeight < 700); }, []);

  const { data: raw } = useReadContract({ address: G_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address, refetchOnWindowFocus: true } });
  const balance = raw === undefined ? null : Math.floor(Number(formatEther(raw as bigint)));
  const type = DUEL_GAMES.find((g) => g.key === game)?.type ?? 0;
  const label = DUEL_GAMES.find((g) => g.key === game)?.label ?? "this game";
  const short = balance !== null && balance < entry;

  async function challenge() {
    if (!isConnected || !address || busy) return;
    setErr(null);
    setBusy(true);
    const code = newCode();
    try {
      const id = await createRoom({
        gameType: type, games: [type],
        stakeWei: parseEther(String(entry)), seedWei: 0n, feeBps: FEE_BPS, capacity: 2,
        deadlineSec: BigInt(Math.floor(Date.now() / 1000) + RUNS_HOURS * 3600),
        code,
      });
      setMade({ id, code });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/USER_REJECTED|rejected|denied/i.test(m) ? "Cancelled. Nothing was staked." : /insufficient|exceeds balance/i.test(m) ? "Not enough G$ for that entry." : "Could not open the duel. Nothing was staked. Try again.");
    }
    setBusy(false);
  }

  const box: React.CSSProperties = {
    width: "100%", maxWidth: 360, margin: compact ? "8px auto 0" : "10px auto 0", boxSizing: "border-box",
    borderRadius: 16, padding: "10px 12px",
    background: "linear-gradient(115deg, rgba(120,53,15,0.42) 0%, rgba(30,14,74,0.72) 60%, rgba(20,8,52,0.9) 100%)",
    border: "1px solid rgba(251,191,36,0.38)", boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
    fontFamily: "ui-sans-serif, system-ui, sans-serif", textAlign: "left", color: "#fff",
  };
  const ghost: React.CSSProperties = { textDecoration: "none", padding: "8px 12px", borderRadius: 11, fontSize: 12.5, fontWeight: 800, color: "#fff", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.22)", cursor: "pointer", textAlign: "center" };

  // ── the duel exists: hand over the link ──
  if (made) {
    const url = `${origin}/duel/${made.id}?code=${made.code}`;
    const text = `I staked ${entry} G$ on ${label}. Beat my score and take ${winnerTakes(entry)} G$: ${url}`;
    return (
      <div style={box}>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>⚔️ Duel open · {entry} G$ staked</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.72)", lineHeight: 1.35, marginTop: 3 }}>
          Send the link. Then play a ranked run: your best score in the next {RUNS_HOURS} hours is the one that counts. Winner takes <b style={{ color: GOLD }}>{winnerTakes(entry)} G$</b>.
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" style={{ ...ghost, flex: 1, color: "#06230f", background: "#25d366", border: "none", fontWeight: 900 }}>WhatsApp</a>
          <button onClick={() => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => {}); }} style={{ ...ghost, flex: 1 }}>{copied ? "Copied ✓" : "Copy link"}</button>
          <Link href={`/duel/${made.id}?code=${made.code}`} style={ghost}>Room</Link>
        </div>
      </div>
    );
  }

  // Short phone: a single pill, as small as a control can be and still be tappable.
  if (!open && tight) {
    return (
      <button onClick={() => setOpen(true)} aria-expanded={false} style={{ display: "block", margin: "3px auto 0", padding: "6px 14px", borderRadius: 999, cursor: "pointer", fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 12.5, fontWeight: 800, color: "#fde68a", background: "rgba(120,53,15,0.45)", border: "1px solid rgba(251,191,36,0.45)" }}>
        ⚔️ Duel a friend for G$ ›
      </button>
    );
  }
  if (!open) {
    return (
      <div style={{ ...box, padding: tight ? "5px 10px" : "8px 10px", margin: tight ? "4px auto 0" : box.margin, display: "flex", alignItems: "center", gap: 9 }}>
        <div aria-hidden style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>⚔️</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.2 }}>Duel a friend for G$</div>
          {!tight && <div style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.66)", lineHeight: 1.25, marginTop: 1 }}>Both stake. Higher score takes the pot.</div>}
        </div>
        <button onClick={() => setOpen(true)} aria-expanded={false} style={{ flexShrink: 0, padding: "8px 12px", borderRadius: 11, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 900, color: "#1a0b33", background: GOLD, boxShadow: "0 3px 0 #b45309" }}>Stake</button>
        <Link href="/duel" style={{ ...ghost, flexShrink: 0 }}>Join</Link>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>⚔️ Duel a friend</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {balance !== null && <span style={{ fontSize: 11, fontWeight: 800, color: GOLD, whiteSpace: "nowrap" }}>You have {balance.toLocaleString()} G$</span>}
          <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: 15, fontWeight: 900, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>✕</button>
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.68)", lineHeight: 1.3, marginTop: 2 }}>
        Both stake G$. Higher score takes the pot, less 10%.
      </div>
      <div role="radiogroup" aria-label="Entry in G$" style={{ display: "flex", gap: 5, marginTop: 8 }}>
        {ENTRIES.map((e) => {
          const on = e === entry;
          const cannot = balance !== null && balance < e;
          return (
            <button key={e} role="radio" aria-checked={on} onClick={() => { setEntry(e); setErr(null); }} style={{ flex: 1, minWidth: 0, padding: "7px 0", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 900, color: on ? "#1a0b33" : cannot ? "rgba(255,255,255,0.4)" : "#fff", background: on ? GOLD : "rgba(255,255,255,0.08)", border: `1px solid ${on ? GOLD : "rgba(255,255,255,0.18)"}` }}>
              {e.toLocaleString()}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {isConnected ? (
          <button onClick={challenge} disabled={busy || short} style={{ flex: 1, padding: "10px 0", borderRadius: 11, border: "none", cursor: busy || short ? "default" : "pointer", fontSize: 13, fontWeight: 900, color: "#1a0b33", background: GOLD, boxShadow: "0 3px 0 #b45309", opacity: busy || short ? 0.55 : 1 }}>
            {busy ? "Opening the duel…" : short ? `You need ${entry.toLocaleString()} G$` : `Challenge · stake ${entry.toLocaleString()} G$`}
          </button>
        ) : (
          <Link href="/home" style={{ ...ghost, flex: 1, color: "#1a0b33", background: GOLD, border: "none", fontWeight: 900, boxShadow: "0 3px 0 #b45309" }}>Sign in to stake G$</Link>
        )}
        <Link href="/duel" style={ghost}>Join</Link>
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: err ? "#fca5a5" : "rgba(255,255,255,0.55)", marginTop: 6, lineHeight: 1.3 }}>
        {err ?? `Winner takes ${winnerTakes(entry).toLocaleString()} G$. Your stake waits in the on-chain escrow, not with us.`}
      </div>
    </div>
  );
}
