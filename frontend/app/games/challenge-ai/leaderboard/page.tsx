"use client";

// ─── Weekly MARKOV Ladder ────────────────────────────────────────────────────
// The arena's competition board, wearing the app's signature leaderboard
// skin: character podium + confetti for the top 3, glowing pill rows for
// the rest — same visual grammar as the Rhythm/Simon boards. Weeks are
// permanent: a selector browses every past week, so a crown won in week
// 27 is still visible in week 40. Bragging rights don't expire.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { getArenaLadder, type LadderData, type LadderEntry } from "@/app/actions/arena";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};
const ACCENT = "#4ade80"; // arena-green board identity

function fmtName(e: LadderEntry): string {
  if (e.username && e.username.trim()) return `@${e.username.replace(/^@/, "")}`;
  return `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}`;
}

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

// ─── confetti + podium · same system as the other leaderboards ──────────────
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

function StagePodium({ podium }: { podium: (LadderEntry | undefined)[] }) {
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
              {pl.entry ? fmtName(pl.entry) : "—"}
            </div>
            <div style={{ color: pl.color, fontSize: 13, fontWeight: 900, textShadow: `0 0 14px ${pl.color}, 0 2px 4px rgba(0,0,0,0.8)`, marginTop: 2 }}>
              {pl.entry ? `${pl.entry.points} pts` : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── pill row · ranks 4+ · same construction as the other boards ────────────
function LadderRow({ entry, isMe }: { entry: LadderEntry; isMe: boolean }) {
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
        }}>#{entry.rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isMe ? `You · ${fmtName(entry)}` : fmtName(entry)}
          </div>
          <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.04em", marginTop: 1 }}>
            {entry.wins}W · {entry.matches} matches
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontFamily: T.display, fontSize: 15, color: ACCENT, letterSpacing: "0.02em" }}>{entry.points}</span>
          <span style={{ fontFamily: T.body, fontSize: 9, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.08em" }}>PTS</span>
        </div>
      </div>
    </div>
  );
}

export default function ArenaLadderPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  const [ladder, setLadder] = useState<LadderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selWeek, setSelWeek] = useState<string | undefined>(undefined); // undefined = current
  const resetIn = useMemo(untilSundayUtc, []);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    setLoading(true);
    getArenaLadder(address, selWeek)
      .then((l) => { if (!l.error) setLadder(l); })
      .finally(() => setLoading(false));
  }, [address, selWeek]);

  const isCurrentWeek = !ladder?.currentWeek || ladder.week === ladder.currentWeek;
  const me = ladder?.me ?? null;
  const podium = ladder?.top?.slice(0, 3) ?? [];
  const rest = ladder?.top?.slice(3) ?? [];
  const showPool = (ladder?.poolGs ?? 0) > 0 && isCurrentWeek;
  const weeks = ladder?.weeks ?? [];

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: isDesktop ? 760 : 480, margin: "0 auto", padding: isDesktop ? "16px 32px 130px" : "12px 16px 110px", display: "flex", flexDirection: "column", gap: 14 }}>

        <button
          onClick={() => router.push("/games/challenge-ai")}
          style={{ alignSelf: "flex-start", padding: "6px 12px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim, fontFamily: T.body, fontSize: 11.5, fontWeight: 700 }}
        >
          ‹ Back to arena
        </button>

        {/* Header strip · arena identity + week status */}
        <div style={{
          padding: "14px 18px", borderRadius: 16,
          background: "linear-gradient(180deg, rgba(34,197,94,0.16) 0%, rgba(20,10,50,0.7) 100%)",
          border: "1px solid rgba(74,222,128,0.4)",
          boxShadow: "0 0 22px rgba(34,197,94,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 22 }}>🏆</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#fff", fontSize: 14, fontWeight: 900, letterSpacing: "0.06em", fontFamily: T.display }}>MARKOV LADDER</div>
              <div style={{ color: "rgba(134,239,172,0.7)", fontSize: 10, fontWeight: 700, marginTop: 2 }}>
                {isCurrentWeek
                  ? <>Live · resets in {resetIn}{showPool && <> · {ladder!.poolGs} G$ pool pays Sunday</>}</>
                  : <>Final standings · week {ladder?.week?.split("-W")[1]}</>}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "rgba(134,239,172,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em" }}>CLIMBERS</div>
              <div style={{ color: ACCENT, fontSize: 16, fontWeight: 900 }}>{ladder?.players ?? "—"}</div>
            </div>
          </div>

          {/* week selector · finished boards stay viewable forever */}
          {weeks.length > 1 && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingTop: 4 }}>
              {weeks.map((w) => {
                const active = w === ladder?.week;
                const isCur = w === ladder?.currentWeek;
                return (
                  <button
                    key={w}
                    onClick={() => setSelWeek(isCur ? undefined : w)}
                    style={{
                      flexShrink: 0, padding: "5px 12px", borderRadius: 999, cursor: "pointer",
                      background: active ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${active ? "rgba(74,222,128,0.6)" : T.hairline}`,
                      color: active ? "#bbf7d0" : T.inkDim,
                      fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em",
                    }}
                  >
                    {isCur ? "THIS WEEK" : `W${w.split("-W")[1]}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Personal-status chip */}
        {address && me && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 14, background: `linear-gradient(90deg, ${ACCENT}1f, rgba(0,0,0,0.25))`, border: `1px solid ${ACCENT}55` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: T.display, fontSize: 16, color: T.ink }}>
                {isCurrentWeek ? <>You&apos;re #{me.rank}</> : <>You finished #{me.rank}</>}
              </div>
              <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkDim, marginTop: 2 }}>
                {me.points} pts · {me.wins}W · {me.matches} matches
              </div>
            </div>
            {isCurrentWeek && (
              <button onClick={() => router.push("/games/challenge-ai")} style={{
                padding: "7px 14px", borderRadius: 999,
                background: "linear-gradient(180deg, #6ee76e 0%, #22c55e 100%)",
                border: "none", color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em",
                cursor: "pointer", boxShadow: "0 0 12px rgba(34,197,94,0.5)", fontFamily: T.body,
              }}>CLIMB ›</button>
            )}
          </div>
        )}

        {loading && <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkSoft, padding: "12px 4px" }}>Loading standings…</div>}

        {!loading && ladder && ladder.top.length === 0 && (
          <div style={{
            width: "100%", maxWidth: 440, margin: "20px auto",
            padding: "32px 24px", borderRadius: 20,
            background: "linear-gradient(180deg, rgba(34,197,94,0.12) 0%, rgba(20,10,50,0.8) 100%)",
            border: "1.5px solid rgba(74,222,128,0.4)",
            boxShadow: "0 0 30px rgba(34,197,94,0.15)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🤖</div>
            <div style={{ color: "#fff", fontSize: 16, fontWeight: 900 }}>
              {isCurrentWeek ? "Fresh week — the board is empty" : "No matches this week"}
            </div>
            {isCurrentWeek && (
              <>
                <div style={{ color: "rgba(200,255,220,0.75)", fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
                  Beat MARKOV once, claim the crown.
                </div>
                <button onClick={() => router.push("/games/challenge-ai")} style={{
                  marginTop: 18, padding: "11px 24px", borderRadius: 999,
                  background: "linear-gradient(90deg, #22c55e 0%, #4ade80 100%)",
                  border: "none", color: "#fff", fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", cursor: "pointer",
                  boxShadow: "0 0 20px rgba(34,197,94,0.5)", fontFamily: T.body,
                }}>FIGHT MARKOV →</button>
              </>
            )}
          </div>
        )}

        {!loading && ladder && ladder.top.length > 0 && (
          <>
            {/* Podium · the crown moment */}
            <StagePodium podium={[podium[0], podium[1], podium[2]]} />

            {/* Rows 4+ */}
            {rest.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                {rest.map((e) => (
                  <LadderRow key={e.wallet} entry={e} isMe={!!address && e.wallet === address.toLowerCase()} />
                ))}
              </div>
            )}

            <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center", fontWeight: 700 }}>
              Win +10 · flawless +3 · tie +4 · loss +2
            </div>
          </>
        )}
      </div>
      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
