"use client";

// ─── Weekly MARKOV Ladder ────────────────────────────────────────────────────
// One board, one competition: this ISO week's arena standings. The old
// wager-era "all-time by match count" archive was retired with the wagers —
// a dead competition on a live screen was pure confusion. Simple readable
// rows, your standing pinned on top, reset countdown, points legend.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { getArenaLadder, type LadderData } from "@/app/actions/arena";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};
const GREEN = "#4ade80";
const GOLD = "#fbbf24";
const MARKOV_ART = "/games/challenge-ai-v2/ai-bot-medium.png";

function untilSundayUtc(): string {
  const now = new Date();
  const end = new Date(now);
  const day = now.getUTCDay() || 7;
  end.setUTCDate(now.getUTCDate() + (7 - day));
  end.setUTCHours(23, 59, 59, 999);
  const ms = end.getTime() - now.getTime();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export default function ArenaLadderPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [ladder, setLadder] = useState<LadderData | null>(null);
  const [loading, setLoading] = useState(true);
  const resetIn = useMemo(untilSundayUtc, []);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    getArenaLadder(address)
      .then((l) => { if (!l.error) setLadder(l); })
      .finally(() => setLoading(false));
  }, [address]);

  const me = ladder?.me ?? null;
  const top = ladder?.top ?? [];
  const showPool = (ladder?.poolGs ?? 0) > 0;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 640 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 14 }}>

        <button
          onClick={() => router.push("/games/challenge-ai")}
          style={{ alignSelf: "flex-start", padding: "6px 12px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim, fontFamily: T.body, fontSize: 11.5, fontWeight: 700 }}
        >
          ‹ Back to arena
        </button>

        {/* header */}
        <div style={{ textAlign: "center", padding: "4px 0 2px" }}>
          <img src={MARKOV_ART} alt="" style={{ width: 64, height: 64, objectFit: "contain", filter: `drop-shadow(0 0 18px ${GOLD}44)` }} />
          <h1 style={{ fontFamily: T.display, fontSize: 22, margin: "4px 0 2px", letterSpacing: "0.03em" }}>
            WEEKLY LADDER
          </h1>
          <div style={{ fontSize: 12, color: T.inkDim, fontWeight: 700 }}>
            {ladder?.players ?? "—"} climbers · resets in {resetIn}
            {showPool && <> · <b style={{ color: GREEN }}>{ladder!.poolGs} G$ pool</b></>}
          </div>
        </div>

        {/* your standing · pinned on top */}
        {me && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 14, border: `1px solid ${GOLD}66`, background: "rgba(251,191,36,0.1)", padding: "12px 16px" }}>
            <span style={{ fontFamily: T.display, fontSize: 20, color: GOLD, minWidth: 40 }}>#{me.rank}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>You</div>
              <div style={{ fontSize: 11, color: T.inkDim, fontWeight: 700 }}>{me.wins} wins · {me.matches} matches</div>
            </div>
            <span style={{ fontFamily: T.display, fontSize: 18, color: GREEN }}>{me.points} pts</span>
          </div>
        )}

        {/* board */}
        {loading ? (
          <div style={{ textAlign: "center", color: T.inkSoft, padding: "36px 0", fontSize: 13 }}>Loading standings…</div>
        ) : top.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 20px", borderRadius: 16, background: "rgba(255,255,255,0.03)", border: `1px dashed ${GREEN}44` }}>
            <div style={{ fontSize: 38, marginBottom: 8 }}>🤖</div>
            <div style={{ fontSize: 14.5, fontWeight: 900 }}>Fresh week — the board is empty</div>
            <div style={{ color: T.inkDim, fontSize: 12, marginTop: 6 }}>First win claims the crown.</div>
            <button onClick={() => router.push("/games/challenge-ai")} style={{ marginTop: 16, padding: "11px 26px", borderRadius: 999, background: "linear-gradient(160deg, #6ee76e 0%, #22c55e 60%, #15803d 100%)", border: "none", color: "#fff", fontFamily: T.display, fontSize: 13, letterSpacing: "0.08em", cursor: "pointer", boxShadow: "0 6px 16px rgba(34,197,94,0.45)" }}>
              FIGHT MARKOV
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {top.map((e) => {
              const mine = !!address && e.wallet === address.toLowerCase();
              const medal = e.rank === 1 ? "👑" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : null;
              return (
                <div
                  key={e.wallet}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    borderRadius: 13,
                    padding: e.rank <= 3 ? "12px 15px" : "9px 15px",
                    background: mine ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${mine ? GOLD + "66" : e.rank === 1 ? GOLD + "44" : T.hairline}`,
                  }}
                >
                  <span style={{ minWidth: 34, fontFamily: T.display, fontSize: e.rank <= 3 ? 17 : 13, color: e.rank === 1 ? GOLD : T.inkDim }}>
                    {medal ?? `#${e.rank}`}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: mine ? GOLD : T.ink, fontFamily: T.body }}>
                    {mine ? "You" : `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}`}
                  </span>
                  <span style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700 }}>{e.wins}W</span>
                  <span style={{ fontFamily: T.display, fontSize: e.rank <= 3 ? 16 : 14, color: GREEN, minWidth: 58, textAlign: "right" }}>
                    {e.points} pts
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 10.5, color: T.inkSoft, textAlign: "center", fontWeight: 700 }}>
          Win +10 · flawless +3 · tie +4 · loss +2
        </div>
      </div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
