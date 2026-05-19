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
  username?: string | null;
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
  username?: string | null;
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

// Canonical avatar URL — seed is `${username}-${wallet}` so the same
// player shows up under the same face on /profile, every leaderboard,
// and every event card. Palette mirrors /profile so the family of
// avatars feels cohesive.
function avatarUrl(wallet: string, username?: string | null): string {
  // DiceBear seeds are case-sensitive. wagmi returns checksummed (mixed-
  // case) addresses, the season API returns lowercase ones — so a player
  // can land on two different faces for the same wallet. Lowercasing
  // here normalises everything to the same seed.
  const seed = `${username || ""}-${wallet.toLowerCase()}`;
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&backgroundColor=ffdfbf,ffd5dc,c0aede,b6e3f4,d1d4f9`;
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

// Medal slot — bigger gold/silver/bronze badge for top 3, soft `#N` text
// for 4+. Mirrors the existing GameArena leaderboard's row anatomy so
// the Solo Ladder feels like the same competition surface.
function MedalSlot({ rank }: { rank: number | null }) {
  if (rank === 1) {
    return (
      <div style={{
        width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
        background: "radial-gradient(circle at 35% 30%, #fef3c7, #f59e0b 55%, #92400e 100%)",
        boxShadow: "0 0 18px rgba(251,191,36,0.6), 0 4px 10px rgba(0,0,0,0.45), inset 0 1px 2px rgba(255,255,255,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 22,
      }}>🥇</div>
    );
  }
  if (rank === 2) {
    return (
      <div style={{
        width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
        background: "radial-gradient(circle at 35% 30%, #f1f5f9, #cbd5e1 55%, #475569 100%)",
        boxShadow: "0 0 16px rgba(203,213,225,0.5), 0 4px 10px rgba(0,0,0,0.45), inset 0 1px 2px rgba(255,255,255,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 22,
      }}>🥈</div>
    );
  }
  if (rank === 3) {
    return (
      <div style={{
        width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
        background: "radial-gradient(circle at 35% 30%, #fed7aa, #fb923c 55%, #7c2d12 100%)",
        boxShadow: "0 0 14px rgba(251,146,60,0.5), 0 4px 10px rgba(0,0,0,0.45), inset 0 1px 2px rgba(255,255,255,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 22,
      }}>🥉</div>
    );
  }
  return (
    <div style={{
      width: 44, height: 44, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "rgba(220,210,255,0.45)",
      fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em",
    }}>#{rank ?? "—"}</div>
  );
}

// One row of the leaderboard. Big medal/avatar/name/score, no clutter.
// YOU gets a soft violet outline so the player can locate themselves
// without colour-coding the rest of the list.
function LadderRow({
  rank, wallet, username, points, isMe,
}: {
  rank: number | null;
  wallet: string;
  username?: string | null;
  points: number;
  isMe: boolean;
  // Stats kept on the API but intentionally not rendered in the row.
  // Per-row chatter ("47 games · 8 wins") competes with the score; the
  // player's OWN breakdown lives in YOUR POSITION above.
  games?: number;
  wins?: number;
  claims?: number;
}) {
  // Same canonical seed format as /profile so the avatar matches across
  // the app — wallet always feeds in so empty username still resolves.
  const displayName = isMe ? "YOU" : (username || shortAddr(wallet));
  // Username gets a friendlier proportional font; wallet stays monospace
  // because hex reads better with a fixed-width family.
  const nameFont = username ? "system-ui, -apple-system, sans-serif" : "monospace";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "14px",
      padding: "12px 14px",
      borderRadius: "14px",
      background: isMe ? "rgba(167,139,250,0.08)" : "transparent",
      border: isMe ? "1.5px solid rgba(167,139,250,0.55)" : "1.5px solid transparent",
      boxShadow: isMe ? "0 0 16px rgba(167,139,250,0.25)" : "none",
    }}>
      <MedalSlot rank={rank} />
      <div style={{
        width: 44, height: 44, minWidth: 44, borderRadius: "50%",
        background: "#1a0550",
        border: `2px solid ${isMe ? "rgba(167,139,250,0.55)" : "rgba(255,255,255,0.15)"}`,
        boxShadow: isMe ? "0 0 10px rgba(167,139,250,0.35)" : "0 2px 6px rgba(0,0,0,0.35)",
        overflow: "hidden", flexShrink: 0,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarUrl(wallet, username)} alt="" width={44} height={44}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: isMe ? "#c4b5fd" : "white",
          fontSize: "16px", fontWeight: 900, lineHeight: 1.1,
          fontFamily: nameFont,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textShadow: isMe ? "0 0 8px rgba(167,139,250,0.5)" : "none",
          letterSpacing: "0.01em",
        }}>{displayName}</div>
      </div>
      <div style={{
        flexShrink: 0,
        color: "#fbbf24",
        fontSize: "18px", fontWeight: 900,
        fontFamily: "monospace",
        textShadow: "0 0 8px rgba(251,191,36,0.45)",
        letterSpacing: "-0.01em",
      }}>{points.toLocaleString()}</div>
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
  const myUsername = me?.username ?? null;

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
            border: "1.5px solid rgba(167,139,250,0.4)",
            boxShadow: "0 0 18px rgba(167,139,250,0.18), 0 6px 14px rgba(0,0,0,0.4)",
            padding: "14px 14px 12px",
          }}>
            {/* Compact "YOUR POSITION" caption above the row makes it
                clear which row is yours when you're not in top 10. */}
            <div style={{
              color: "rgba(220,210,255,0.55)",
              fontSize: "9.5px", fontWeight: 900, letterSpacing: "0.2em",
              marginBottom: "8px",
            }}>YOUR POSITION</div>
            <div style={{
              display: "flex", alignItems: "center", gap: "14px",
            }}>
              {/* Rank pill — amber rounded chip */}
              <div style={{
                minWidth: 48, height: 38,
                borderRadius: 999,
                padding: "0 12px",
                background: "linear-gradient(160deg, #fed7aa 0%, #fb923c 60%, #c2410c 100%)",
                color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 900,
                textShadow: "0 1px 2px rgba(0,0,0,0.45)",
                boxShadow: "0 0 12px rgba(251,146,60,0.45), inset 0 1px 0 rgba(255,255,255,0.35)",
                flexShrink: 0,
              }}>{myRank ? `#${myRank}` : "—"}</div>

              {/* Avatar — same seed rule as the leaderboard rows so
                  the player sees the same character that represents
                  them across every leaderboard surface in the app. */}
              <div style={{
                width: 44, height: 44, minWidth: 44, borderRadius: "50%",
                background: "#1a0550",
                border: "2px solid rgba(167,139,250,0.55)",
                boxShadow: "0 0 10px rgba(167,139,250,0.35)",
                overflow: "hidden", flexShrink: 0,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarUrl(address, myUsername)}
                  alt=""
                  width={44}
                  height={44}
                  style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: "#c4b5fd",
                  fontSize: "16px", fontWeight: 900, lineHeight: 1.1,
                  fontFamily: myUsername ? "system-ui, -apple-system, sans-serif" : "monospace",
                  textShadow: "0 0 8px rgba(167,139,250,0.5)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  letterSpacing: "0.01em",
                }}>{myUsername || shortAddr(address)}</div>
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
                  username={r.username}
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
