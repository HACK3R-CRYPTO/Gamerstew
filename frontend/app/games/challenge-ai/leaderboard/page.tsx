"use client";

// Challenge AI leaderboard · the legacy "PVP ARENA" tab moved into the
// game where it belongs. Reads /api/pvp-leaderboard (real source: 20+
// players, 700+ matches against MARKOV). Different shape from skill
// leaderboards — ranked by matches, with W / win-rate sub-context.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const PAGE_SIZE = 16;
const ACCENT = "#a5b4fc";   // matches the legacy PVP tab's indigo identity
const ChevLeft = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6l-6 6 6 6V6z" /></svg>;

type PvpEntry = { rank: number; wallet: string; username: string | null; matches: number; wins: number; ties: number; winRate: number };
type PvpData = { totalPlayers: number; totalMatches: number; leaderboard: PvpEntry[] };

function fmtName(wallet: string, username?: string | null): string {
  if (username && username.trim()) return `@${username.replace(/^@/, "")}`;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

// ─── confetti + podium · matches the other leaderboards 1:1 ──────────────
const CONFETTI = [
  { left: "8%",  top: "25%", color: "#f9a8d4", size: 10, shape: "star",     dur: 3.5, delay: 0.0 },
  { left: "15%", top: "60%", color: "#fbbf24", size: 12, shape: "triangle", dur: 4.2, delay: 0.5 },
  { left: "22%", top: "20%", color: "#22d3ee", size: 8,  shape: "dot",      dur: 3.0, delay: 1.0 },
  { left: "30%", top: "45%", color: "#fb923c", size: 11, shape: "note",     dur: 4.8, delay: 1.5 },
  { left: "38%", top: "15%", color: "#e879f9", size: 9,  shape: "star",     dur: 3.2, delay: 0.3 },
  { left: "48%", top: "35%", color: "#fde68a", size: 13, shape: "sparkle",  dur: 4.0, delay: 0.8 },
  { left: "58%", top: "18%", color: "#60a5fa", size: 10, shape: "triangle", dur: 3.6, delay: 1.3 },
  { left: "68%", top: "50%", color: "#f472b6", size: 11, shape: "star",     dur: 4.5, delay: 0.2 },
  { left: "78%", top: "28%", color: "#34d399", size: 9,  shape: "dot",      dur: 3.3, delay: 1.1 },
  { left: "86%", top: "55%", color: "#c084fc", size: 12, shape: "note",     dur: 4.1, delay: 0.7 },
];

function ConfettiParticle({ p }: { p: typeof CONFETTI[number] }) {
  const base = {
    position: "absolute" as const,
    left: p.left, top: p.top,
    width: p.size, height: p.size,
    animation: `icon-float ${p.dur}s ease-in-out ${p.delay}s infinite`,
    pointerEvents: "none" as const,
    filter: `drop-shadow(0 0 6px ${p.color})`,
  };
  if (p.shape === "dot") return <div style={{ ...base, background: p.color, borderRadius: "50%" }} />;
  if (p.shape === "triangle") return (
    <div style={{ ...base, width: 0, height: 0, borderLeft: `${p.size / 2}px solid transparent`, borderRight: `${p.size / 2}px solid transparent`, borderBottom: `${p.size}px solid ${p.color}`, background: "transparent" }} />
  );
  if (p.shape === "note") return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>♪</div>;
  if (p.shape === "sparkle") return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>✦</div>;
  return <div style={{ ...base, color: p.color, fontSize: `${p.size + 4}px`, fontWeight: 900 }}>★</div>;
}

function StagePodium({ podium }: { podium: (PvpEntry | undefined)[] }) {
  const placements = [
    { char: "/characters/char1.png", entry: podium[0], color: "#fbbf24", rank: 1, widthPct: 18, bottomPct: 38, leftPct: 50, z: 3 },
    { char: "/characters/char2.png", entry: podium[1], color: "#e2e8f0", rank: 2, widthPct: 16, bottomPct: 33, leftPct: 32, z: 2 },
    { char: "/characters/char3.png", entry: podium[2], color: "#f97316", rank: 3, widthPct: 16, bottomPct: 32, leftPct: 67, z: 2 },
  ];
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 620, aspectRatio: "3 / 2", margin: "0 auto" }}>
      <img src="/characters/podium.png" alt="podium" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.6))", zIndex: 1 }} />
      {CONFETTI.map((p, i) => <ConfettiParticle key={i} p={p} />)}
      {placements.map(pl => (
        <div key={pl.rank} style={{ position: "absolute", left: `${pl.leftPct}%`, bottom: `${pl.bottomPct}%`, transform: "translateX(-50%)", width: `${pl.widthPct}%`, zIndex: pl.z, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <img src={pl.char} alt={`rank ${pl.rank}`} style={{ width: "100%", height: "auto", objectFit: "contain", filter: `drop-shadow(0 4px 8px rgba(0,0,0,0.5)) drop-shadow(0 0 14px ${pl.color}55)` }} />
        </div>
      ))}
      {placements.map(pl => {
        const charHeightPct = pl.widthPct * 2.25;
        const labelBottom = pl.bottomPct + charHeightPct + 1;
        return (
          <div key={`label-${pl.rank}`} style={{ position: "absolute", left: `${pl.leftPct}%`, bottom: `${labelBottom}%`, transform: "translateX(-50%)", textAlign: "center", zIndex: 4, pointerEvents: "none", whiteSpace: "nowrap" }}>
            <div style={{ color: "white", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em", textShadow: `0 0 10px ${pl.color}dd, 0 2px 4px rgba(0,0,0,0.8)` }}>
              {pl.entry ? fmtName(pl.entry.wallet, pl.entry.username) : "—"}
            </div>
            <div style={{ color: pl.color, fontSize: 13, fontWeight: 900, textShadow: `0 0 14px ${pl.color}, 0 2px 4px rgba(0,0,0,0.8)`, marginTop: 2 }}>
              {pl.entry ? `${pl.entry.matches} matches` : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── pill row · ranks 4+ ─────────────────────────────────────────────────
function PvpRow({ entry, rank, isMe }: { entry: PvpEntry; rank: number; isMe: boolean }) {
  const sub = entry.matches >= 10 ? `${entry.wins}W · ${entry.winRate}%` : `${entry.wins}W`;
  return (
    <div style={{
      borderRadius: 999, padding: 2.5,
      background: `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT}77 100%)`,
      boxShadow: `0 0 14px ${ACCENT}66, 0 0 28px ${ACCENT}33, 0 8px 18px rgba(0,0,0,0.6)`,
    }}>
      <div style={{
        borderRadius: 999,
        background: isMe
          ? `linear-gradient(90deg, ${ACCENT}26 0%, rgba(20,10,50,0.9) 100%)`
          : "linear-gradient(90deg, rgba(20,10,50,0.92) 0%, rgba(10,5,30,0.95) 100%)",
        padding: "8px 14px 8px 10px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 28, borderRadius: 999,
          background: `${ACCENT}1f`, border: `1px solid ${ACCENT}66`,
          fontFamily: T.display, fontSize: 13, color: T.ink, letterSpacing: "0.02em",
        }}>#{rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isMe ? `You · ${fmtName(entry.wallet, entry.username)}` : fmtName(entry.wallet, entry.username)}
          </div>
          <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.04em", marginTop: 1 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink, letterSpacing: "0.02em" }}>{entry.matches}</span>
          <span style={{ fontFamily: T.body, fontSize: 9, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.08em" }}>MATCHES</span>
        </div>
      </div>
    </div>
  );
}

export default function ChallengeAILeaderboardPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [data, setData] = useState<PvpData | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pvp-leaderboard", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (cancelled) return; if (d) setData(d as PvpData); else setLoadErr(true); })
      .catch(() => { if (!cancelled) setLoadErr(true); });
    return () => { cancelled = true; };
  }, []);

  const myRow = useMemo(() => {
    if (!address || !data) return null;
    return data.leaderboard.find(r => r.wallet.toLowerCase() === address.toLowerCase()) ?? null;
  }, [address, data]);

  const podium = data ? data.leaderboard.slice(0, 3) : [];
  const restAll = data ? data.leaderboard.slice(3) : [];
  const totalPages = Math.max(1, Math.ceil(restAll.length / PAGE_SIZE));
  const rest = restAll.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const myPage = myRow ? (myRow.rank <= 3 ? -1 : Math.floor((myRow.rank - 4) / PAGE_SIZE)) : -1;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 760 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 16 }}>

        <button onClick={() => router.push("/games/challenge-ai")} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px 6px 8px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim, fontFamily: T.body, fontSize: 11.5, fontWeight: 700 }}>
          <ChevLeft /> Back to Challenge AI
        </button>

        {/* Header strip · PVP ARENA identity + totals */}
        <div style={{
          padding: "14px 18px", borderRadius: 16,
          background: "linear-gradient(180deg, rgba(99,102,241,0.18) 0%, rgba(20,10,50,0.7) 100%)",
          border: "1px solid rgba(99,102,241,0.4)",
          boxShadow: "0 0 22px rgba(99,102,241,0.25)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 22 }}>⚔️</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#fff", fontSize: 14, fontWeight: 900, letterSpacing: "0.06em" }}>PVP ARENA · vs MARKOV</div>
              <div style={{ color: "rgba(165,180,252,0.65)", fontSize: 10, fontWeight: 700, marginTop: 2 }}>
                All-time Challenge-AI standings · G$ wagers · settled on-chain
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div>
              <div style={{ color: "rgba(165,180,252,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em" }}>PLAYERS</div>
              <div style={{ color: ACCENT, fontSize: 16, fontWeight: 900 }}>{data?.totalPlayers ?? "—"}</div>
            </div>
            <div>
              <div style={{ color: "rgba(165,180,252,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em" }}>MATCHES</div>
              <div style={{ color: ACCENT, fontSize: 16, fontWeight: 900 }}>{data?.totalMatches ?? "—"}</div>
            </div>
          </div>
        </div>

        {loadErr && <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px" }}>Couldn&apos;t load standings.</div>}
        {!loadErr && !data && <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px" }}>Loading PVP standings…</div>}

        {data && data.leaderboard.length === 0 && (
          <div style={{
            width: "100%", maxWidth: 440, margin: "20px auto",
            padding: "32px 24px", borderRadius: 20,
            background: "linear-gradient(180deg, rgba(99,102,241,0.12) 0%, rgba(20,10,50,0.8) 100%)",
            border: "1.5px solid rgba(99,102,241,0.4)",
            boxShadow: "0 0 30px rgba(99,102,241,0.2)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🤖</div>
            <div style={{ color: "#fff", fontSize: 16, fontWeight: 900 }}>Be the first to challenge MARKOV</div>
            <div style={{ color: "rgba(200,180,255,0.75)", fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
              No matches resolved yet. Play one round, claim the top of the board.
            </div>
            <button onClick={() => router.push("/games/challenge-ai")} style={{
              marginTop: 18, padding: "11px 24px", borderRadius: 999,
              background: "linear-gradient(90deg, #6366f1 0%, #22d3ee 100%)",
              border: "none", color: "#fff", fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", cursor: "pointer",
              boxShadow: "0 0 20px rgba(99,102,241,0.5)",
            }}>PLAY MARKOV →</button>
          </div>
        )}

        {data && data.leaderboard.length > 0 && (
          <>
            {/* Personal-status chip */}
            {address && myRow && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 14, background: `linear-gradient(90deg, ${ACCENT}1f, rgba(0,0,0,0.25))`, border: `1px solid ${ACCENT}55` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: T.display, fontSize: 16, color: T.ink, letterSpacing: "0.01em" }}>You&apos;re #{myRow.rank}</div>
                  <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkDim, marginTop: 2 }}>{myRow.matches} matches · {myRow.wins}W · {myRow.winRate}% win rate</div>
                </div>
                {myPage >= 0 && myPage !== page && (
                  <button onClick={() => setPage(myPage)} style={{
                    padding: "7px 14px", borderRadius: 999,
                    background: `linear-gradient(180deg, #c084fc 0%, ${ACCENT} 100%)`,
                    border: "none", color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em",
                    cursor: "pointer", boxShadow: `0 0 12px ${ACCENT}55`,
                  }}>JUMP TO MY ROW</button>
                )}
              </div>
            )}
            {address && data && !myRow && (
              <a href="/games/challenge-ai" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: `1px dashed ${ACCENT}55`, textDecoration: "none" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: T.display, fontSize: 16, color: T.ink, letterSpacing: "0.01em" }}>Not ranked yet</div>
                  <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkDim, marginTop: 2 }}>Challenge MARKOV once to claim a spot</div>
                </div>
                <span style={{ padding: "7px 14px", borderRadius: 999, background: `linear-gradient(180deg, #c084fc 0%, ${ACCENT} 100%)`, color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", boxShadow: `0 0 12px ${ACCENT}55` }}>PLAY ›</span>
              </a>
            )}

            {/* Podium */}
            <StagePodium podium={podium} />

            {/* Rows 4+ */}
            {restAll.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                {rest.map((e, i) => {
                  const rank = 4 + page * PAGE_SIZE + i;
                  const isMe = !!address && e.wallet.toLowerCase() === address.toLowerCase();
                  return <PvpRow key={e.wallet + rank} entry={e} rank={rank} isMe={isMe} />;
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 4 }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{
                  padding: "8px 14px", borderRadius: 999,
                  background: page === 0 ? "rgba(255,255,255,0.04)" : `${ACCENT}2e`,
                  border: `1.5px solid ${page === 0 ? "rgba(255,255,255,0.12)" : ACCENT + "80"}`,
                  color: page === 0 ? "rgba(200,180,255,0.35)" : "rgba(230,220,255,0.95)",
                  fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em",
                  cursor: page === 0 ? "not-allowed" : "pointer", fontFamily: T.body,
                }}>‹ PREV</button>
                <span style={{ color: T.inkDim, fontFamily: T.body, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>PAGE {page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{
                  padding: "8px 14px", borderRadius: 999,
                  background: page === totalPages - 1 ? "rgba(255,255,255,0.04)" : `${ACCENT}2e`,
                  border: `1.5px solid ${page === totalPages - 1 ? "rgba(255,255,255,0.12)" : ACCENT + "80"}`,
                  color: page === totalPages - 1 ? "rgba(200,180,255,0.35)" : "rgba(230,220,255,0.95)",
                  fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em",
                  cursor: page === totalPages - 1 ? "not-allowed" : "pointer", fontFamily: T.body,
                }}>NEXT ›</button>
              </div>
            )}
          </>
        )}
      </div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
