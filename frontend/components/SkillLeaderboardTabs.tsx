"use client";

// Per-game leaderboard tabs · uses the project's previous leaderboard style.
// LIVE: 3-character StagePodium + neon-bordered pill rows for ranks 4+ with pagination.
// PAST: champion-card grid (one card per sealed season) matching the legacy /leaderboard.
//       Cards open into a detail sheet showing full standings for that season.
//
// Data sources (matches the legacy /leaderboard exactly):
//   LIVE rows         → SUBGRAPH (Goldsky)  · fetchLeaderboard(gameType, seasonStart)
//   season metadata   → BACKEND  /api/seasons (currentSeason number + currentEndsAt)
//   PAST seasons      → BACKEND  /api/seasons past[] (sealed historical snapshots)
//
// The subgraph is the source of truth for live on-chain scores. The
// backend only provides season boundaries + sealed past records.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { fetchLeaderboard, type LeaderboardEntry, type GameTypeId } from "@/lib/subgraph";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
const PAGE_SIZE = 16;

const T = {
  ink: "#22104f",
  inkDim: "rgba(34,16,79,0.8)",
  inkSoft: "rgba(34,16,79,0.55)",
  hairline: "rgba(76,29,149,0.14)",
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

type Tab = "live" | "past";
type GameKind = "rhythm" | "simon" | "stack" | "nepa" | "ladder" | "strike" | "nepa3d";

// gameType ID mirrors GamePass.sol uint8 + backend's GAME_TYPE map.
// Add a row here when a new game lands · everything else flows from it.
// (3 is Challenge AI, which has its own ladder; nepa is 4.)
const GAME_TYPE_ID: Record<GameKind, GameTypeId> = { rhythm: 0, simon: 1, stack: 2, nepa: 4, ladder: 5, strike: 6, nepa3d: 7 };
const GAME_HREF: Record<GameKind, string> = {
  rhythm: "/games/rhythm",
  simon: "/games/simon",
  stack: "/games/stack",
  nepa: "/games/nepa",
  ladder: "/games/ladder",
  strike: "/bowling",
  nepa3d: "/world",
};
// Friendly title used in the past-season detail sheet header. One row per
// game · add a new game and the sheet picks it up.
const GAME_LABEL: Record<GameKind, string> = {
  rhythm: "Rhythm Rush",
  simon: "Simon Memory",
  stack: "Stack Tower",
  nepa: "NEPA: Up Light",
  ladder: "Word Ladder",
  strike: "Street Strike",
  nepa3d: "UP NEPA 3D",
};
// Per-game accent for the detail sheet · matches each lobby's signature
// color so the sheet visually belongs to the game the player came from.
const GAME_ACCENT: Record<GameKind, string> = {
  rhythm: "#a21caf",
  simon: "#06b6d4",
  stack: "#9a3412",
  nepa: "#92400e",
  ladder: "#166534",
  strike: "#7e22ce",
  nepa3d: "#92400e",
};

// Entry shape matches both the subgraph's LeaderboardEntry and the
// backend's per-season entries. Both expose player + username + score.
type Entry = LeaderboardEntry;
type PastSeason = {
  season: number; startTs: number; endTs: number;
  prizePot: number; sealedAt: number; totalPlayers?: number;
} & Partial<Record<GameKind, Entry[]>>;
type SeasonsMetadata = {
  currentSeason: number;
  currentEndsAt: number;
  currentStartsAt?: number;  // not always set — fall back to currentEndsAt - 7d
  past: PastSeason[];
};

// ─── helpers ─────────────────────────────────────────────────────────────
function fmtName(player: string, username?: string): string {
  if (username && username.trim()) return `@${username.replace(/^@/, "")}`;
  return `${player.slice(0, 6)}…${player.slice(-4)}`;
}
function timeLeftLabel(endTs: number): string {
  const left = endTs - Math.floor(Date.now() / 1000);
  if (left <= 0) return "ENDED";
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  if (days >= 1) return `${days}d ${hours}h left`;
  const mins = Math.floor((left % 3600) / 60);
  return `${hours}h ${mins}m left`;
}
function dateRange(startTs: number, endTs: number): string {
  const s = new Date(startTs * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const e = new Date(endTs * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${s} – ${e}`;
}

// ─── confetti + podium · matches the previous leaderboard style 1:1 ──────
const CONFETTI = [
  { left: "8%",  top: "25%", color: "#be185d", size: 10, shape: "star",     dur: 3.5, delay: 0.0 },
  { left: "15%", top: "60%", color: "#92400e", size: 12, shape: "triangle", dur: 4.2, delay: 0.5 },
  { left: "22%", top: "20%", color: "#0e7490", size: 8,  shape: "dot",      dur: 3.0, delay: 1.0 },
  { left: "30%", top: "45%", color: "#9a3412", size: 11, shape: "note",     dur: 4.8, delay: 1.5 },
  { left: "38%", top: "15%", color: "#a21caf", size: 9,  shape: "star",     dur: 3.2, delay: 0.3 },
  { left: "48%", top: "35%", color: "#92400e", size: 13, shape: "sparkle",  dur: 4.0, delay: 0.8 },
  { left: "58%", top: "18%", color: "#1d4ed8", size: 10, shape: "triangle", dur: 3.6, delay: 1.3 },
  { left: "68%", top: "50%", color: "#be185d", size: 11, shape: "star",     dur: 4.5, delay: 0.2 },
  { left: "78%", top: "28%", color: "#047857", size: 9,  shape: "dot",      dur: 3.3, delay: 1.1 },
  { left: "86%", top: "55%", color: "#7e22ce", size: 12, shape: "note",     dur: 4.1, delay: 0.7 },
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

function StagePodium({ podium }: { podium: (Entry | undefined)[] }) {
  const placements = [
    { char: "/characters/char1.png", entry: podium[0], color: "#92400e", rank: 1, widthPct: 18, bottomPct: 38, leftPct: 50, z: 3 },
    { char: "/characters/char2.png", entry: podium[1], color: "#334155", rank: 2, widthPct: 16, bottomPct: 33, leftPct: 32, z: 2 },
    { char: "/characters/char3.png", entry: podium[2], color: "#9a3412", rank: 3, widthPct: 16, bottomPct: 32, leftPct: 67, z: 2 },
  ];
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 620, aspectRatio: "3 / 2", margin: "0 auto" }}>
      <img src="/characters/podium.png" alt="podium" style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        objectFit: "contain", filter: "drop-shadow(0 20px 30px rgba(76,29,149,0.35))", zIndex: 1,
      }} />
      {CONFETTI.map((p, i) => <ConfettiParticle key={i} p={p} />)}
      {placements.map(pl => (
        <div key={pl.rank} style={{
          position: "absolute", left: `${pl.leftPct}%`, bottom: `${pl.bottomPct}%`,
          transform: "translateX(-50%)", width: `${pl.widthPct}%`, zIndex: pl.z,
          display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          <img src={pl.char} alt={`rank ${pl.rank}`} style={{
            width: "100%", height: "auto", objectFit: "contain",
            filter: `drop-shadow(0 4px 8px rgba(76,29,149,0.22)) drop-shadow(0 0 14px ${pl.color}55)`,
          }} />
        </div>
      ))}
      {placements.map(pl => {
        const charHeightPct = pl.widthPct * 2.25;
        const labelBottom = pl.bottomPct + charHeightPct + 1;
        return (
          pl.entry ? (
          <div key={`label-${pl.rank}`} style={{
            position: "absolute", left: `${pl.leftPct}%`, bottom: `${labelBottom + (pl.rank === 1 ? 6 : 0)}%`,
            transform: "translateX(-50%)", textAlign: "center", zIndex: pl.rank === 1 ? 5 : 4, pointerEvents: "none", whiteSpace: "nowrap",
            padding: "4px 10px 5px", borderRadius: 12, background: "#fff", boxShadow: "0 0 0 1px rgba(76,29,149,0.14), 0 8px 14px -8px rgba(76,29,149,0.6)",
            maxWidth: "31%", overflow: "hidden",
          }}>
            <div style={{ color: "#22104f", fontFamily: T.body, fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis" }}>{fmtName(pl.entry.player, pl.entry.username)}</div>
            <div style={{ color: pl.color, fontFamily: T.body, fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{pl.entry.score.toLocaleString()}</div>
          </div>
          ) : null
        );
      })}
    </div>
  );
}

// ─── neon pill row · ranks 4+ ────────────────────────────────────────────
function PlayerRow({ entry, rank, isMe, accent }: { entry: Entry; rank: number; isMe: boolean; accent: string }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "34px 1fr auto", alignItems: "center", gap: 10, padding: "10px 14px 10px 10px", borderRadius: 16,
      background: isMe ? "#f3ecff" : "#fff", boxShadow: isMe ? `0 0 0 1.5px ${accent}` : "0 0 0 1px rgba(76,29,149,0.12)",
    }}>
      <span style={{ width: 30, height: 30, borderRadius: 999, display: "grid", placeItems: "center", background: "#ede9fe", color: "#4c1d95", fontFamily: T.body, fontSize: 12, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{rank}</span>
      <span style={{ fontFamily: T.body, fontSize: 14, color: T.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {fmtName(entry.player, entry.username)}{isMe && <span style={{ marginLeft: 8, padding: "2px 7px", borderRadius: 999, background: accent, color: "#fff", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.06em" }}>YOU</span>}
      </span>
      <span style={{ fontFamily: T.body, fontSize: 15, fontWeight: 900, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{entry.score.toLocaleString()}</span>
    </div>
  );
}

// ─── past-season champion card · matches previous /leaderboard card 1:1 ──
// Tap target · the card was previously a static read-only block which
// trained players to expect details on tap. onClick opens
// PastSeasonDetailSheet with the full standings + the player's finish.
function SeasonChampionCard({ season, gameKind, address, onClick }: { season: PastSeason; gameKind: GameKind; address?: string; onClick: () => void }) {
  const entries = season[gameKind] ?? [];
  const winner = entries[0];
  const myFinish = address ? entries.findIndex(e => e.player.toLowerCase() === address.toLowerCase()) + 1 : 0;
  const placedTop3 = myFinish > 0 && myFinish <= 3;
  const myMedalColor = myFinish === 1 ? "#92400e" : myFinish === 2 ? "#334155" : myFinish === 3 ? "#9a3412" : null;
  const myMedal = myFinish === 1 ? "🥇" : myFinish === 2 ? "🥈" : myFinish === 3 ? "🥉" : null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        borderRadius: 14,
        background: "rgba(255,255,255,0.96)",
        border: placedTop3 ? `1.5px solid ${myMedalColor}88` : "1px solid rgba(76,29,149,0.14)",
        boxShadow: placedTop3
          ? `0 0 12px ${myMedalColor}33, 0 6px 14px rgba(76,29,149,0.25)`
          : "0 6px 14px rgba(76,29,149,0.22)",
        padding: "12px 14px",
      }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ color: "#22104f", fontSize: 13, fontWeight: 900, letterSpacing: "0.06em" }}>SEASON {season.season}</div>
        {myMedal && (
          <div style={{ padding: "2px 8px", borderRadius: 999, background: `${myMedalColor}1a`, border: `1px solid ${myMedalColor}66` }}>
            <span style={{ fontSize: 10 }}>{myMedal}</span>
            <span style={{ color: myMedalColor!, fontSize: 11, fontWeight: 900, marginLeft: 4 }}>YOU</span>
          </div>
        )}
      </div>
      {winner ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 8px", borderRadius: 8,
          background: "#fffbeb", border: "1px solid #fcd34d",
          marginBottom: 8,
        }}>
          <span style={{ fontSize: 13 }}>🏆</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#92400e", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em" }}>WINNER</div>
            <div style={{ color: "#22104f", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fmtName(winner.player, winner.username)}
            </div>
          </div>
          <div style={{ color: "#92400e", fontSize: 13, fontWeight: 900 }}>{winner.score.toLocaleString()}</div>
        </div>
      ) : (
        <div style={{ color: "rgba(34,16,79,0.6)", fontSize: 11.5, textAlign: "center", padding: "12px 0" }}>
          No scores
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "rgba(34,16,79,0.62)", fontSize: 11, fontWeight: 700 }}>
        <span>👥 {season.totalPlayers || entries.length} player{(season.totalPlayers || entries.length) !== 1 ? "s" : ""}</span>
        <span style={{ color: "rgba(109,40,217,0.95)", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em" }}>
          {dateRange(season.startTs, season.endTs)}
        </span>
      </div>
      {/* "View details" affordance · subtle but tells the player the card
          is interactive. Sits below the date row so it doesn't compete
          with the winner block visually. */}
      <div style={{
        marginTop: 8, paddingTop: 8,
        borderTop: "1px dashed rgba(167,139,250,0.18)",
        color: "rgba(109,40,217,1)",
        fontSize: 11, fontWeight: 900, letterSpacing: "0.16em",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
      }}>
        VIEW STANDINGS
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>
    </button>
  );
}

// ─── past-season detail sheet · full standings + your finish ─────────────
// Mounted from SkillLeaderboardTabs when the player taps any past-season
// card. Portal-mounted so it escapes any backdrop-filter containers and
// renders above the AppHeader stack.
function PastSeasonDetailSheet({ season, gameKind, address, onClose }: {
  season: PastSeason;
  gameKind: GameKind;
  address?: string;
  onClose: () => void;
}) {
  const entries = season[gameKind] ?? [];
  const accent = GAME_ACCENT[gameKind];
  const label = GAME_LABEL[gameKind];

  // ESC closes · same pattern AccountSheet uses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock the page scroll while the sheet is open · prevents the
  // leaderboard behind from drag-scrolling under the modal on mobile.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  if (typeof document === "undefined") return null;

  // Show the full standings list · sheet has overflowY:auto so a long
  // tail just scrolls. Past seasons typically have ≤20 entries anyway,
  // and clipping the list hides the player's finish without telling
  // them their score was tracked.
  const medalFor = (rank: number) => rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  const medalColor = (rank: number) => rank === 1 ? "#92400e" : rank === 2 ? "#334155" : rank === 3 ? "#9a3412" : null;

  return createPortal(
    <>
      <style>{`
        @keyframes psd-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes psd-up   { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(34,16,79,0.5)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          animation: "psd-fade 0.22s ease both",
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`Season ${season.season} ${label} standings`}
          style={{
            width: "100%", maxWidth: 540, maxHeight: "88vh",
            borderRadius: "24px 24px 0 0",
            background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.96) 60%, rgba(255,255,255,0.96) 100%)",
            border: `1px solid ${accent}33`, borderBottom: "none",
            boxShadow: `0 0 60px ${accent}26, 0 -16px 50px rgba(76,29,149,0.22)`,
            display: "flex", flexDirection: "column", overflow: "hidden",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            animation: "psd-up 0.34s cubic-bezier(0.16, 1, 0.3, 1) both",
          }}
        >
          {/* Drag handle · the gestural close affordance */}
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px", flexShrink: 0 }}>
            <span style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(76,29,149,0.22)" }} />
          </div>

          {/* Header · season + game + sealed date + close */}
          <div style={{
            padding: "10px 18px 14px",
            borderBottom: `1px solid ${accent}1a`,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            flexShrink: 0,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: accent, fontSize: 16, fontWeight: 900, letterSpacing: "0.06em", fontFamily: T.body }}>
                SEASON {season.season} · {label.toUpperCase()}
              </div>
              <div style={{ color: T.inkSoft, fontSize: 11.5, fontWeight: 700, marginTop: 2, fontFamily: T.body, letterSpacing: "0.04em" }}>
                ENDED {new Date(season.endTs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {season.totalPlayers || entries.length} PLAYER{(season.totalPlayers || entries.length) !== 1 ? "S" : ""}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{
              width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
              background: "#fff", border: "1px solid rgba(76,29,149,0.16)",
              color: "#22104f", fontSize: 15, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>✕</button>
          </div>

          {/* Body · standings list, scrolls when long */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 20px", WebkitOverflowScrolling: "touch" }}>
            {entries.length === 0 && (
              <div style={{ color: T.inkSoft, fontSize: 12, fontWeight: 700, textAlign: "center", padding: "32px 0" }}>
                No scores recorded for this season.
              </div>
            )}

            {entries.length > 0 && (
              <>
                {/* Standings list · full season ranking · scrolls when long */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {entries.map((e, i) => {
                    const rank = i + 1;
                    const isMe = !!address && e.player.toLowerCase() === address.toLowerCase();
                    const medal = medalFor(rank);
                    const mColor = medalColor(rank);
                    return (
                      <div key={`${e.player}-${rank}`} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 12px", borderRadius: 10,
                        background: isMe
                          ? `${accent}1a`
                          : mColor
                            ? `${mColor}10`
                            : "#fff",
                        border: isMe
                          ? `1.5px solid ${accent}88`
                          : mColor
                            ? `1px solid ${mColor}44`
                            : "1px solid rgba(255,255,255,0.06)",
                      }}>
                        <span style={{
                          width: 26, textAlign: "center",
                          fontFamily: T.body, fontSize: 11, fontWeight: 900,
                          color: mColor || T.inkDim,
                        }}>
                          {medal || `#${rank}`}
                        </span>
                        <span style={{
                          flex: 1, minWidth: 0,
                          color: "#22104f", fontFamily: T.body, fontSize: 12, fontWeight: 700,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {fmtName(e.player, e.username)}
                          {isMe && <span style={{ marginLeft: 6, color: accent, fontSize: 11.5, fontWeight: 900, letterSpacing: "0.1em" }}>· YOU</span>}
                        </span>
                        <span style={{
                          color: mColor || "#22104f",
                          fontFamily: T.body, fontSize: 13, fontWeight: 900,
                          textShadow: mColor ? `0 0 8px ${mColor}55` : "none",
                        }}>
                          {e.score.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Empty footer · the row above already highlights the
                    player's finish via the "· YOU" tag and accent border.
                    No extra summary needed when the full list is visible. */}
              </>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── main tabs ──────────────────────────────────────────────────────────
export default function SkillLeaderboardTabs({ gameKind, accent }: { gameKind: GameKind; accent: string }) {
  const { address } = useAccount();
  const [tab, setTab] = useState<Tab>("live");
  // Season metadata + past seals come from backend; live rows come from subgraph.
  const [meta, setMeta] = useState<SeasonsMetadata | null>(null);
  const [liveEntries, setLiveEntries] = useState<Entry[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [page, setPage] = useState(0);
  // The past-season card the player tapped (null when no sheet is open).
  // Drives the PastSeasonDetailSheet mount below.
  const [selectedPastSeason, setSelectedPastSeason] = useState<PastSeason | null>(null);

  // 1) Backend gives us currentSeason + boundaries + sealed past[].
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/seasons`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (cancelled) return; if (d) setMeta(d as SeasonsMetadata); else setLoadErr(true); })
      .catch(() => { if (!cancelled) setLoadErr(true); });
    return () => { cancelled = true; };
  }, []);

  // 2) Subgraph gives us the live current-season rows for THIS specific game.
  //    Fires once we know when the season started — fallback to 7d window
  //    so the page renders even if the metadata response is slow.
  useEffect(() => {
    let cancelled = false;
    const seasonStart = meta?.currentStartsAt
      ?? (meta?.currentEndsAt ? meta.currentEndsAt - 7 * 24 * 60 * 60 : Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60);
    const gameType = GAME_TYPE_ID[gameKind];
    fetchLeaderboard(gameType, seasonStart) // no cap · every player who scored this season
      .then(rows => { if (!cancelled) setLiveEntries(rows); })
      .catch(() => { if (!cancelled) setLiveEntries([]); });
    return () => { cancelled = true; };
  }, [meta, gameKind]);

  const myLive = useMemo(() => {
    if (!address || !liveEntries || !liveEntries.length) return null;
    const i = liveEntries.findIndex(e => e.player.toLowerCase() === address.toLowerCase());
    return i >= 0 ? { rank: i + 1, score: liveEntries[i].score } : null;
  }, [address, liveEntries]);

  // Top 3 stay on the podium · pill rows below cover ranks 4+.
  const podium = (liveEntries ?? []).slice(0, 3);
  const restAll = (liveEntries ?? []).slice(3);
  const totalPages = Math.max(1, Math.ceil(restAll.length / PAGE_SIZE));
  const rest = restAll.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const myPage = myLive ? (myLive.rank <= 3 ? -1 : Math.floor((myLive.rank - 4) / PAGE_SIZE)) : -1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tab switcher */}
      <div style={{
        display: "inline-flex", padding: 4, gap: 4, borderRadius: 999,
        background: "#fff", border: `1px solid ${T.hairline}`,
        alignSelf: "flex-start",
      }}>
        {([
          { id: "live", label: "This week" },
          { id: "past", label: "Past seasons" },
        ] as Array<{ id: Tab; label: string }>).map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => { setTab(t.id); setPage(0); }} style={{
              padding: "8px 16px", borderRadius: 999, border: "none", cursor: "pointer",
              background: active ? accent : "transparent",
              color: active ? "#fff" : T.inkDim,
              fontFamily: T.body, fontSize: 13, fontWeight: 800,
              boxShadow: "none",
              transition: "all 0.15s",
            }}>{t.label}</button>
          );
        })}
      </div>

      {/* LIVE — current season: podium + pill rows + pagination */}
      {tab === "live" && (
        <>
          {loadErr && <div style={{ fontFamily: T.body, fontSize: 14, color: T.inkDim, padding: "12px 4px" }}>Could not load the standings. Check your connection and reload.</div>}
          {!loadErr && (!meta || liveEntries === null) && <div style={{ fontFamily: T.body, fontSize: 14, color: T.inkDim, padding: "12px 4px" }}>Loading this season…</div>}

          {meta && liveEntries !== null && (
            <>
              {/* Season header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
                <span style={{ fontFamily: T.body, fontSize: 12.5, fontWeight: 800, color: T.inkDim }}>Season {meta.currentSeason} · {liveEntries.length} {liveEntries.length === 1 ? "player" : "players"}</span>
                <span style={{ fontFamily: T.body, fontSize: 12.5, color: accent, fontWeight: 800 }}>{timeLeftLabel(meta.currentEndsAt)}</span>
              </div>

              {/* Personal-status chip · single slot, two states */}
              {address && myLive && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 14, background: "#fff", border: `1.5px solid ${accent}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 16, color: T.ink, lineHeight: 1, letterSpacing: "0.01em" }}>You&apos;re #{myLive.rank}</div>
                    <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, marginTop: 3 }}>Best this season: {myLive.score.toLocaleString()}</div>
                  </div>
                  {myPage >= 0 && myPage !== page && (
                    <button onClick={() => setPage(myPage)} style={{
                      padding: "7px 14px", borderRadius: 999,
                      background: `linear-gradient(180deg, #c084fc 0%, ${accent} 100%)`,
                      border: "none", color: "#22104f", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.1em",
                      cursor: "pointer", boxShadow: `0 0 12px ${accent}55`,
                    }}>JUMP TO MY ROW</button>
                  )}
                </div>
              )}
              {address && liveEntries && !myLive && (
                <a href={GAME_HREF[gameKind]} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 14, background: "rgba(255,255,255,0.7)", border: `1px dashed ${accent}88`, textDecoration: "none" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 16, color: T.ink, letterSpacing: "0.01em" }}>Not ranked this season</div>
                    <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, marginTop: 3 }}>Score this season to claim a spot</div>
                  </div>
                  <span style={{ padding: "7px 14px", borderRadius: 999, background: `linear-gradient(180deg, #c084fc 0%, ${accent} 100%)`, color: "#fff", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.1em", boxShadow: `0 0 12px ${accent}55` }}>PLAY ›</span>
                </a>
              )}

              {/* Podium · always visible · top 3 are the chase targets */}
              <StagePodium podium={podium} />

              {/* Pill rows · ranks 4+ */}
              {restAll.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                  {rest.map((e, i) => {
                    const rank = 4 + page * PAGE_SIZE + i;
                    const isMe = !!address && e.player.toLowerCase() === address.toLowerCase();
                    return <PlayerRow key={e.player + rank} entry={e} rank={rank} isMe={isMe} accent={accent} />;
                  })}
                </div>
              )}

              {liveEntries.length === 0 && (
                <div style={{ fontFamily: T.body, fontSize: 14, color: T.inkDim, textAlign: "center", padding: "12px 0" }}>No scores this week yet. Be first on the board.</div>
              )}

              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 4 }}>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{
                    padding: "8px 14px", borderRadius: 999,
                    background: "#fff",
                    border: `1px solid ${page === 0 ? "rgba(76,29,149,0.12)" : accent}`,
                    color: page === 0 ? "rgba(34,16,79,0.5)" : accent,
                    fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em",
                    cursor: page === 0 ? "not-allowed" : "pointer", fontFamily: T.body,
                  }}>‹ PREV</button>
                  <span style={{ color: T.inkDim, fontFamily: T.body, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>PAGE {page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{
                    padding: "8px 14px", borderRadius: 999,
                    background: "#fff",
                    border: `1px solid ${page === totalPages - 1 ? "rgba(76,29,149,0.12)" : accent}`,
                    color: page === totalPages - 1 ? "rgba(34,16,79,0.35)" : accent,
                    fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em",
                    cursor: page === totalPages - 1 ? "not-allowed" : "pointer", fontFamily: T.body,
                  }}>NEXT ›</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* PAST — champion cards grid, one per sealed season */}
      {tab === "past" && (
        <>
          {loadErr && <div style={{ fontFamily: T.body, fontSize: 14, color: T.inkDim, padding: "12px 4px" }}>Couldn&apos;t load past seasons.</div>}
          {!loadErr && !meta && <div style={{ fontFamily: T.body, fontSize: 14, color: T.inkDim, padding: "12px 4px" }}>Loading past seasons…</div>}
          {meta && meta.past.length === 0 && <div style={{ fontFamily: T.body, fontSize: 14, color: T.inkDim, padding: "12px 4px" }}>No past seasons sealed yet.</div>}
          {meta && meta.past.length > 0 && (
            <>
              <div style={{
                fontSize: 11.5, fontWeight: 900, letterSpacing: "0.2em",
                color: T.inkDim, marginBottom: 2,
              }}>COMPLETED SEASONS</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {meta.past.map(s => (
                  <SeasonChampionCard
                    key={s.season}
                    season={s}
                    gameKind={gameKind}
                    address={address}
                    onClick={() => setSelectedPastSeason(s)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Past-season detail · portal-mounted, scrolls internally when the
          standings list is long. Closes on backdrop tap, ESC, or the X. */}
      {selectedPastSeason && (
        <PastSeasonDetailSheet
          season={selectedPastSeason}
          gameKind={gameKind}
          address={address}
          onClose={() => setSelectedPastSeason(null)}
        />
      )}
    </div>
  );
}
