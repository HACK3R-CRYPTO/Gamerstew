"use client";

// Per-game leaderboard list. Reads from the existing subgraph helpers
// (fetchLeaderboard for skill games, fetchAllTimeLeaderboard for the
// combined ladder). Highlights the connected player's row when they're
// ranked. Stays styling-consistent with /dashboard + /profile.

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { fetchLeaderboard, fetchAllTimeLeaderboard, type LeaderboardEntry, type AllTimeEntry } from "@/lib/subgraph";

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

type Row = (LeaderboardEntry & { rank: number }) | (AllTimeEntry & { rank: number });

export type LeaderboardKind = "rhythm" | "simon" | "all-time";

const KIND_GAMETYPE: Record<Exclude<LeaderboardKind, "all-time">, 0 | 1> = {
  rhythm: 0,
  simon: 1,
};

export default function LeaderboardList({
  kind,
  accent = T.accent,
  limit = 25,
}: {
  kind: LeaderboardKind;
  accent?: string;
  limit?: number;
}) {
  const { address } = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setLoadErr(false);
    const promise = kind === "all-time"
      ? fetchAllTimeLeaderboard(limit)
      // Pass weekStartUnix = 0 so the subgraph returns every score above zero,
      // which we then dedupe per-wallet to get the all-time per-game board.
      : fetchLeaderboard(KIND_GAMETYPE[kind], 0, limit);
    promise
      .then((entries: (LeaderboardEntry | AllTimeEntry)[]) => {
        if (cancelled) return;
        const ranked = entries.map((e, i) => ({ ...e, rank: i + 1 })) as Row[];
        setRows(ranked);
      })
      .catch(() => { if (!cancelled) setLoadErr(true); });
    return () => { cancelled = true; };
  }, [kind, limit]);

  const myRow = useMemo(() => {
    if (!address || !rows) return null;
    const me = rows.find(r => r.player.toLowerCase() === address.toLowerCase());
    return me || null;
  }, [rows, address]);

  if (loadErr) {
    return <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px" }}>Couldn&apos;t load standings. Try again in a moment.</div>;
  }
  if (!rows) {
    return <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px" }}>Loading standings…</div>;
  }
  if (rows.length === 0) {
    return <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px" }}>No scores yet — be first on the board.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.slice(0, limit).map((r, i) => {
        const isMe = !!address && r.player.toLowerCase() === address.toLowerCase();
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
        const name = r.username || `${r.player.slice(0, 6)}…${r.player.slice(-4)}`;
        return (
          <div key={r.player} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 13,
            background: isMe ? `${accent}1f` : T.surface,
            border: `1px solid ${isMe ? accent + "66" : T.hairline}`,
            boxShadow: isMe ? `0 0 12px ${accent}33` : "none",
          }}>
            <span style={{ width: 26, textAlign: "center", fontFamily: T.display, fontSize: 14, color: i < 3 ? "#fde68a" : T.inkSoft, lineHeight: 1, textShadow: i < 3 ? "0 0 8px rgba(251,191,36,0.6)" : "none" }}>
              {medal || `#${r.rank}`}
            </span>
            <span style={{ flex: 1, fontFamily: T.body, fontSize: 12.5, color: T.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isMe ? `You · ${name}` : name}
            </span>
            <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink, letterSpacing: "0.02em" }}>{r.score.toLocaleString()}</span>
          </div>
        );
      })}

      {/* If you're connected but not in the top N, surface your rank below. */}
      {address && !myRow && (
        <div style={{ marginTop: 4, padding: "10px 12px", borderRadius: 13, background: T.surface, border: `1px dashed ${T.hairline}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 26, textAlign: "center", fontFamily: T.display, fontSize: 14, color: T.inkSoft }}>—</span>
          <span style={{ flex: 1, fontFamily: T.body, fontSize: 12, color: T.inkDim, fontWeight: 700 }}>You haven&apos;t scored yet</span>
          <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, letterSpacing: "0.08em" }}>PLAY TO ENTER</span>
        </div>
      )}
    </div>
  );
}
