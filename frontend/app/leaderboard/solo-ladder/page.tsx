"use client";

// Solo Ladder · dedicated route page.
// Layout mirrors the reference UX the user provided:
//   1. Top nav (back + page pill)
//   2. "Your position" card (player's snapshot, prominent)
//   3. "How points are calculated" card (formula + modifier chips)
//   4. Flat leaderboard list (every player, divider rows, stats inline)

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useIsMobile } from "@/hooks/useIsMobile";
import BottomNav from "@/components/BottomNav";

type SoloRow = {
  wallet: string;
  rank: number;
  points: number;
  games?: number;
  wins?: number;
  claims?: number;
};

type LbResponse = {
  meta: { endsAt: string; soloLadderPool: string };
  soloLadder?: SoloRow[];
  soloTop10?: SoloRow[];
};

type MeResponse = {
  wallet: string;
  soloPoints: number;
  soloRank: number | null;
  soloBreakdown?: Record<string, { count: number; points: number }>;
  referralCount: number;
};

function fmtCountdown(toIso: string): string {
  const ms = new Date(toIso).getTime() - Date.now();
  if (ms <= 0) return "ENDED";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-3)}` : a;
}

// Per-row stats line. Skips zero-count actions so a brand new player's
// row reads cleanly instead of "0 games · 0 wins · 0 claims".
function statsLine(games?: number, wins?: number, claims?: number, refs?: number): string {
  // Labels match the chip strip on the formula card so a player can map
  // "5 wager wins" in their stats line to the "+15 Wager win" chip
  // without confusion. "wins" alone reads as "games won" which is wrong.
  const parts: string[] = [];
  if (games && games > 0) parts.push(`${games} game${games === 1 ? "" : "s"}`);
  if (wins && wins > 0) parts.push(`${wins} wager win${wins === 1 ? "" : "s"}`);
  if (claims && claims > 0) parts.push(`${claims} claim${claims === 1 ? "" : "s"}`);
  if (refs && refs > 0) parts.push(`${refs} ref${refs === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

// Medal slot — gold/silver/bronze badge for top 3, gray number for the rest.
function MedalSlot({ rank }: { rank: number | null }) {
  if (rank === 1) {
    return (
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(160deg, #fde68a 0%, #f59e0b 50%, #b45309 100%)",
        boxShadow: "0 0 12px rgba(251,191,36,0.55), inset 0 1px 0 rgba(255,255,255,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
      }}>🥇</div>
    );
  }
  if (rank === 2) {
    return (
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(160deg, #f1f5f9 0%, #cbd5e1 50%, #64748b 100%)",
        boxShadow: "0 0 10px rgba(203,213,225,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
      }}>🥈</div>
    );
  }
  if (rank === 3) {
    return (
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(160deg, #fed7aa 0%, #fb923c 50%, #9a3412 100%)",
        boxShadow: "0 0 10px rgba(251,146,60,0.45), inset 0 1px 0 rgba(255,255,255,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
      }}>🥉</div>
    );
  }
  return (
    <div style={{
      width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
      background: "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "rgba(220,210,255,0.55)", fontSize: 16, fontWeight: 800,
      fontFamily: "monospace",
    }}>{rank ?? "—"}</div>
  );
}

// One row of the leaderboard. Flat, divider underneath, no pill.
function LadderRow({
  rank, wallet, points, isMe, games, wins, claims,
}: {
  rank: number | null;
  wallet: string;
  points: number;
  isMe: boolean;
  games?: number;
  wins?: number;
  claims?: number;
}) {
  const stats = statsLine(games, wins, claims);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px",
      padding: "12px 4px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      background: isMe ? "rgba(134,239,172,0.05)" : "transparent",
    }}>
      <MedalSlot rank={rank} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: isMe ? "#86efac" : "white",
          fontSize: "14px", fontWeight: 800, lineHeight: 1.15,
          fontFamily: "monospace",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{isMe ? "YOU" : shortAddr(wallet)}</div>
        {stats && (
          <div style={{
            color: "rgba(220,210,255,0.5)",
            fontSize: "11px", fontWeight: 700, marginTop: "2px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{stats}</div>
        )}
      </div>
      <div style={{ flexShrink: 0, textAlign: "right" }}>
        <div style={{
          color: "#fbbf24",
          fontSize: "14px", fontWeight: 900,
          fontFamily: "monospace",
          textShadow: "0 0 6px rgba(251,191,36,0.35)",
          letterSpacing: "-0.01em",
        }}>{points.toLocaleString()}</div>
        <div style={{
          color: "rgba(251,191,36,0.55)",
          fontSize: "9px", fontWeight: 800, letterSpacing: "0.16em",
          marginTop: "1px",
        }}>PTS</div>
      </div>
    </div>
  );
}

export default function SoloLadderPage() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { address } = useAccount();
  const [lb, setLb] = useState<LbResponse | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchLb = useCallback(async () => {
    try {
      const r = await fetch("/api/season/leaderboard?limit=500", { cache: "no-store" });
      if (!r.ok) return;
      setLb(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    void fetchLb();
    const i = setInterval(fetchLb, 10000);
    return () => clearInterval(i);
  }, [fetchLb]);

  useEffect(() => {
    if (!address) { setMe(null); return; }
    let cancelled = false;
    const fetchMe = async () => {
      try {
        const r = await fetch(`/api/season/me/${address.toLowerCase()}`, { cache: "no-store" });
        if (!r.ok || cancelled) return;
        if (!cancelled) setMe(await r.json());
      } catch {}
    };
    void fetchMe();
    const i = setInterval(fetchMe, 30000);
    return () => { cancelled = true; clearInterval(i); };
  }, [address]);

  const ladder = useMemo<SoloRow[]>(() => (lb?.soloLadder ?? lb?.soloTop10 ?? []), [lb]);

  // YOUR POSITION stats — pulled from the per-user breakdown.
  const myGames = me?.soloBreakdown?.game_played?.count ?? 0;
  const myWins = me?.soloBreakdown?.wager_won?.count ?? 0;
  const myClaims = me?.soloBreakdown?.daily_claim?.count ?? 0;
  const myRefs = me?.referralCount ?? 0;
  const myStats = statsLine(myGames, myWins, myClaims, myRefs);
  const myRank = me?.soloRank ?? null;
  const myPoints = me?.soloPoints ?? 0;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #1a0550 0%, #04001a 65%, #02000d 100%)",
      color: "white",
      paddingBottom: isMobile ? "96px" : "32px",
    }}>
      <div style={{
        maxWidth: 680, margin: "0 auto",
        padding: "20px clamp(14px, 4vw, 20px) 0",
        display: "flex", flexDirection: "column",
        gap: "clamp(10px, 2.4vw, 14px)",
      }}>

        {/* Top nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => router.push("/leaderboard?tab=seasons")} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 11px", borderRadius: 999,
            background: "rgba(0,0,0,0.45)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(220,210,255,0.75)",
            fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
            cursor: "pointer",
          }}>← BACK</button>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 11px", borderRadius: 999,
            background: "rgba(251,191,36,0.18)",
            border: "1px solid rgba(251,191,36,0.55)",
            color: "#fde68a", fontSize: 10, fontWeight: 900, letterSpacing: "0.18em",
          }}>
            <span style={{ fontSize: 12, lineHeight: 1 }}>📊</span>
            SOLO LADDER
          </div>
        </div>

        {/* Meta strip — countdown + pool */}
        {lb && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 2px",
            fontSize: "11px", fontWeight: 800, letterSpacing: "0.04em",
          }}>
            <span style={{ color: "rgba(220,210,255,0.6)" }}>
              Top 10 split <strong style={{ color: "#fde68a" }}>1,200 G$</strong>
            </span>
            <span style={{ color: "#fde68a", fontFamily: "monospace" }}>
              ⏳ {fmtCountdown(lb.meta.endsAt)}
            </span>
          </div>
        )}

        {/* YOUR POSITION — subtle elevated card, rank as colored pill on the
            left. Same row anatomy as the list below for visual consistency,
            but lifted onto its own card so the player always sees it. */}
        {address && (
          <div style={{
            borderRadius: "14px",
            background: "rgba(20,10,50,0.78)",
            border: "1px solid rgba(167,139,250,0.18)",
            padding: "14px 14px 12px",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: "12px",
            }}>
              {/* Rank pill — amber rounded chip like Focus Pet's "#17" */}
              <div style={{
                minWidth: 44, height: 36,
                borderRadius: 999,
                padding: "0 12px",
                background: "linear-gradient(160deg, #fed7aa 0%, #fb923c 60%, #c2410c 100%)",
                color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 900,
                textShadow: "0 1px 2px rgba(0,0,0,0.45)",
                boxShadow: "0 0 10px rgba(251,146,60,0.45), inset 0 1px 0 rgba(255,255,255,0.35)",
              }}>{myRank ? `#${myRank}` : "—"}</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: "white", fontSize: "15px", fontWeight: 900,
                  lineHeight: 1.1,
                  textShadow: "0 1px 2px rgba(0,0,0,0.4)",
                }}>Your position</div>
                {myStats && (
                  <div style={{
                    color: "rgba(220,210,255,0.55)",
                    fontSize: "11px", fontWeight: 700, marginTop: "4px",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{myStats}</div>
                )}
              </div>

              <div style={{ flexShrink: 0, textAlign: "right" }}>
                <div style={{
                  color: "#fbbf24",
                  fontSize: "22px", fontWeight: 900,
                  fontFamily: "monospace", letterSpacing: "-0.01em",
                  textShadow: "0 0 8px rgba(251,191,36,0.45)",
                  lineHeight: 1,
                }}>{myPoints.toLocaleString()}</div>
                <div style={{
                  color: "rgba(251,191,36,0.6)",
                  fontSize: "9px", fontWeight: 800, letterSpacing: "0.2em",
                  marginTop: "4px",
                }}>PTS</div>
              </div>
            </div>
          </div>
        )}

        {/* HOW POINTS ARE CALCULATED — formula + 3 modifier chips. Helps
            new players understand the system without reading a wiki. */}
        <div style={{
          borderRadius: "14px",
          background: "rgba(20,10,50,0.78)",
          border: "1px solid rgba(167,139,250,0.18)",
          padding: "14px",
        }}>
          <div style={{
            color: "rgba(220,210,255,0.6)",
            fontSize: "10px", fontWeight: 900, letterSpacing: "0.22em",
            marginBottom: "10px",
          }}>HOW POINTS ARE CALCULATED</div>
          <div style={{
            color: "rgba(230,220,255,0.92)",
            fontSize: "clamp(12px, 3vw, 13.5px)", fontWeight: 700,
            lineHeight: 1.5,
          }}>
            <span style={{ color: "#fde68a" }}>games (1-15 by score)</span>
            <span style={{ color: "rgba(220,210,255,0.4)" }}> + </span>
            <span style={{ color: "#fde68a" }}>wager wins × 15</span>
            <span style={{ color: "rgba(220,210,255,0.4)" }}> + </span>
            <span style={{ color: "#fde68a" }}>habitats × 30</span>
            <span style={{ color: "rgba(220,210,255,0.4)" }}> + </span>
            <span style={{ color: "#fde68a" }}>claims × 5</span>
            <span style={{ color: "rgba(220,210,255,0.4)" }}> + </span>
            <span style={{ color: "#86efac" }}>refs × 100</span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "6px",
            marginTop: "12px",
          }}>
            {[
              { icon: "🎮", v: "1-15",  sub: "By score" },
              { icon: "🏆", v: "+15",   sub: "Wager win" },
              { icon: "🏛️", v: "+30",   sub: "Per habitat" },
              { icon: "💰", v: "+5",    sub: "Per claim" },
              { icon: "🔗", v: "+100",  sub: "Per referral" },
            ].map(c => (
              <div key={c.sub} style={{
                padding: "8px 4px",
                background: "rgba(0,0,0,0.32)",
                border: "1px solid rgba(167,139,250,0.16)",
                borderRadius: "10px",
                textAlign: "center",
                minWidth: 0,
              }}>
                <div style={{ fontSize: "15px", lineHeight: 1 }}>{c.icon}</div>
                <div style={{
                  color: "#fde68a",
                  fontSize: "12.5px", fontWeight: 900,
                  fontFamily: "monospace", marginTop: "4px",
                  textShadow: "0 0 6px rgba(251,191,36,0.4)",
                }}>{c.v}</div>
                <div style={{
                  color: "rgba(220,210,255,0.5)",
                  fontSize: "8.5px", fontWeight: 700, letterSpacing: "0.04em",
                  marginTop: "2px",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* One-line note explaining what "by score" actually means —
              the only words that matter: score in, points out, cap. */}
          <div style={{
            marginTop: "10px",
            padding: "9px 12px",
            background: "rgba(0,0,0,0.28)",
            border: "1px solid rgba(167,139,250,0.18)",
            borderRadius: "10px",
            color: "rgba(230,220,255,0.85)",
            fontSize: "11.5px", fontWeight: 600, lineHeight: 1.5,
          }}>
            🎯 Based on your score — the better you play, the more points you earn, <strong style={{ color: "#fde68a" }}>up to 15 per game</strong>.
          </div>
        </div>

        {/* Leaderboard list — flat rows with dividers, stats per row */}
        <div style={{
          borderRadius: "14px",
          background: "rgba(20,10,50,0.78)",
          border: "1px solid rgba(167,139,250,0.18)",
          padding: "4px 14px 8px",
        }}>
          {ladder.length === 0 ? (
            <div style={{
              padding: "22px",
              color: "rgba(220,210,255,0.5)",
              fontSize: "12px", textAlign: "center", fontStyle: "italic",
            }}>No points logged yet. Be the first.</div>
          ) : (
            <div>
              {ladder.map(r => (
                <LadderRow
                  key={r.wallet}
                  rank={r.rank}
                  wallet={r.wallet}
                  points={r.points}
                  isMe={!!address && r.wallet.toLowerCase() === address.toLowerCase()}
                  games={r.games}
                  wins={r.wins}
                  claims={r.claims}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {isMobile && <BottomNav />}
    </div>
  );
}
