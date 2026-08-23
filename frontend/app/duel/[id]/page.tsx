"use client";

// ─── /duel/[id] · a room ─────────────────────────────────────────────────────
// View a room, join it (code from the link, or allowlist), share it, manage the
// allowlist if you're the creator, and see the winner once it's sealed.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { useDuel } from "@/hooks/useDuel";
import { gameLabel, gameKey, duelPhase, type DuelRoom, type DuelParticipant } from "@/lib/duel";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff", inkDim: "rgba(220,210,255,0.7)", inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.5)", hairline: "rgba(255,255,255,0.08)",
  gold: "#fde68a", green: "#34d399", cyan: "#22d3ee", accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
function fmtLeft(ms: number): string {
  if (ms <= 0) return "ended";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const id = Number(params?.id);
  const urlCode = search?.get("code") || "";
  const { address } = useAccount();
  const { joinRoom, addToAllowlist } = useDuel();

  const [room, setRoom] = useState<DuelRoom | null>(null);
  const [players, setPlayers] = useState<DuelParticipant[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [allowText, setAllowText] = useState("");
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const r = await fetch(`/api/duel/room/${id}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setRoom(j.room); setPlayers(j.players || []);
    } catch { /* ignore */ }
  };
  useEffect(() => { if (id) load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const meLower = address?.toLowerCase();
  const joined = useMemo(() => players.some((p) => p.wallet.toLowerCase() === meLower), [players, meLower]);
  const isCreator = room && meLower === room.creator.toLowerCase();
  const phase = room ? duelPhase(room, now) : "live";
  const isPool = room ? Number(room.seed_wei) > 0 && Number(room.stake_wei) === 0 : false;
  const prizeG = room ? formatEther(BigInt(room.seed_wei) + BigInt(room.stake_wei) * BigInt(room.capacity)) : "0";
  const stakeG = room ? formatEther(BigInt(room.stake_wei)) : "0";
  const full = room ? players.length >= room.capacity : false;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/duel/${id}${urlCode ? `?code=${urlCode}` : ""}` : "";

  async function onJoin() {
    if (!room) return;
    setErr(null); setBusy(true);
    try {
      await joinRoom(id, urlCode, BigInt(room.stake_wei));
      await load();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/USER_REJECTED/.test(m) ? "Cancelled." : /bad code/i.test(m) ? "Wrong code." : /allowlist/i.test(m) ? "Your wallet isn't on the list yet." : "Couldn't join. Try again.");
    }
    setBusy(false);
  }

  async function onAllow() {
    setErr(null);
    const wallets = allowText.split(/[\s,]+/).map((w) => w.trim()).filter((w) => /^0x[0-9a-fA-F]{40}$/.test(w)) as `0x${string}`[];
    if (!wallets.length) { setErr("Paste at least one valid wallet."); return; }
    setBusy(true);
    try {
      await addToAllowlist(id, wallets);
      setAllowText("");
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error && /USER_REJECTED/.test(e.message) ? "Cancelled." : "Couldn't update the list.");
    }
    setBusy(false);
  }

  const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 18, padding: 16, ...style }}>{children}</div>
  );

  if (!room) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.body }}>
        <AppHeader />
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 16px", textAlign: "center", color: T.inkSoft }}>Loading room…</div>
        <AppBottomNav wide={false} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "12px 16px 120px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* hero */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: T.gold, textTransform: "uppercase" }}>{isPool ? "Prize pool" : "Duel"}</span>
            <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.12em", color: phase === "live" ? T.green : T.inkSoft, textTransform: "uppercase" }}>
              {phase === "live" ? `• ends in ${fmtLeft(Date.parse(room.deadline) - now)}` : room.status === "resolved" ? "• sealed" : "• closed"}
            </span>
          </div>
          <h1 style={{ fontFamily: T.display, fontSize: 30, margin: "6px 0 0", color: T.gold }}>{prizeG} G$</h1>
          <div style={{ fontSize: 12.5, color: T.inkDim, marginTop: 2 }}>
            {gameLabel(room.game_type)} · highest score wins{isPool ? " · winner takes it all" : ` · stake ${stakeG} G$`}
          </div>
        </div>

        {/* result */}
        {room.status === "resolved" && room.winner && (
          <Card style={{ borderColor: `${T.gold}55`, background: `radial-gradient(120% 140% at 100% 0%, ${T.gold}22, transparent 55%), ${T.surface}` }}>
            <div style={{ fontSize: 10, color: T.gold, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Winner</div>
            <div style={{ fontFamily: T.display, fontSize: 20, marginTop: 2 }}>🏆 {short(room.winner)}</div>
          </Card>
        )}

        {/* players */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 11, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Players</span>
            <span style={{ fontSize: 12, color: T.inkDim }}>{players.length} / {room.capacity}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {players.map((p) => (
              <div key={p.wallet} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: p.wallet.toLowerCase() === meLower ? T.gold : T.ink }}>
                <span>{p.wallet.toLowerCase() === room.creator.toLowerCase() ? "👑 " : ""}{short(p.wallet)}{p.wallet.toLowerCase() === meLower ? " (you)" : ""}</span>
                <span style={{ color: T.inkSoft }}>{p.score != null ? `${p.score} pts` : "—"}</span>
              </div>
            ))}
            {players.length === 0 && <div style={{ fontSize: 12, color: T.inkSoft }}>No one yet. Be first.</div>}
          </div>
        </Card>

        {/* actions */}
        {phase === "live" && (
          <>
            {!joined && !full && (
              <button onClick={onJoin} disabled={busy} style={{ padding: "15px", borderRadius: 16, border: "none", cursor: busy ? "wait" : "pointer", background: `linear-gradient(160deg, ${T.green}, #16a34a)`, color: "#04121a", fontFamily: T.display, fontSize: 16 }}>
                {busy ? "Confirming on Celo…" : isPool ? "Join (free)" : `Join · stake ${stakeG} G$`}
              </button>
            )}
            {joined && (
              <button onClick={() => router.push(`/games/${gameKey(room.game_type)}`)} style={{ padding: "15px", borderRadius: 16, border: "none", cursor: "pointer", background: `linear-gradient(160deg, ${T.gold}, #f59e0b)`, color: "#150a2e", fontFamily: T.display, fontSize: 16 }}>
                Play your run →
              </button>
            )}
            {full && !joined && <div style={{ textAlign: "center", fontSize: 12.5, color: T.inkSoft }}>Room is full.</div>}
          </>
        )}

        {/* share (code rooms) */}
        {urlCode && phase === "live" && (
          <Card>
            <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Invite link</div>
            <div style={{ fontSize: 11.5, color: T.inkDim, wordBreak: "break-all", marginBottom: 10 }}>{shareUrl}</div>
            <button onClick={() => { navigator.clipboard?.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              style={{ padding: "10px 16px", borderRadius: 12, border: `1px solid ${T.hairline}`, background: "rgba(255,255,255,0.05)", color: T.ink, fontFamily: T.body, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              {copied ? "Copied ✓" : "Copy invite link"}
            </button>
          </Card>
        )}

        {/* admin allowlist */}
        {isCreator && room.gating === "allowlist" && phase === "live" && (
          <Card>
            <div style={{ fontSize: 11, color: T.cyan, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Admin · approve wallets</div>
            <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 8, lineHeight: 1.5 }}>Paste the wallets that may join (your voted + verified list), one per line or comma-separated.</div>
            <textarea value={allowText} onChange={(e) => setAllowText(e.target.value)} rows={4} placeholder="0xabc…\n0xdef…"
              style={{ width: "100%", padding: 12, borderRadius: 12, border: `1px solid ${T.hairline}`, background: "rgba(255,255,255,0.05)", color: T.ink, fontFamily: "ui-monospace, monospace", fontSize: 12, outline: "none", resize: "vertical" }} />
            <button onClick={onAllow} disabled={busy} style={{ marginTop: 8, padding: "11px 16px", borderRadius: 12, border: "none", background: T.cyan, color: "#04121a", fontFamily: T.body, fontSize: 13, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
              {busy ? "Confirming…" : "Add to allowlist"}
            </button>
          </Card>
        )}

        {err && <div style={{ color: "#fca5a5", fontSize: 12.5, fontWeight: 700, textAlign: "center" }}>{err}</div>}
      </div>
      <AppBottomNav wide={false} />
    </div>
  );
}
