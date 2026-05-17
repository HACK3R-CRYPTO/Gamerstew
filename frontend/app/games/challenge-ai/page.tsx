"use client";

// ─── /games/challenge-ai (hub) ────────────────────────────────────────────────
// Opponent picker for Challenge AI. Each card represents a personality the
// player can challenge. Tap a card → routes to the actual game with the
// opponent baked into the query string.
//
// Layout mirrors /games (the main games list) so it feels like a sibling
// surface — same juicy 3D cards, same header structure, same tap behavior.
//
// V1 ships RPS only. The card UI is built to extend cleanly to coinflip and
// other game modes later (extra mini-pills under each opponent showing the
// games they play, e.g. RPS / COINFLIP / NUMBERGUESS).

import { useRouter } from "next/navigation";
import { OPPONENTS, type Opponent } from "@/lib/challengeAi";

export default function ChallengeAiHubPage() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #07021a 0%, #04001a 100%)",
      paddingBottom: "calc(80px + env(safe-area-inset-bottom))",
    }}>
      {/* Background ambient glow — subtle, doesn't fight the cards */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{
          position: "absolute", top: "10%", left: "-10%", width: 400, height: 400, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.12) 0%, transparent 70%)",
          filter: "blur(40px)",
        }} />
        <div style={{
          position: "absolute", bottom: "10%", right: "-10%", width: 400, height: 400, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(103,232,249,0.10) 0%, transparent 70%)",
          filter: "blur(40px)",
        }} />
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 640, margin: "0 auto",
        padding: "20px 16px 24px",
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => router.push("/games")}
            style={{
              width: 36, height: 36, borderRadius: "999px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "white", fontSize: 16, fontWeight: 900, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >←</button>
          <div style={{
            color: "rgba(229,231,235,0.9)",
            fontSize: 16, fontWeight: 900, letterSpacing: "0.12em",
          }}>CHALLENGE AI</div>
          <div style={{ width: 36 }} />
        </div>

        {/* Intro line */}
        <div style={{
          padding: "14px 16px", borderRadius: 14,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(229,231,235,0.78)",
          fontSize: 12, fontWeight: 700, lineHeight: 1.5,
          textAlign: "center",
        }}>
          Three opponents. Three minds. Pick one and play. Score counts toward your season.
        </div>

        {/* Opponent cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {OPPONENTS.map(opp => (
            <OpponentCard
              key={opp.id}
              opp={opp}
              onChallenge={() => router.push(`/games/challenge-ai/rps?opp=${opp.id}`)}
            />
          ))}
        </div>

        {/* Footer note */}
        <div style={{
          color: "rgba(200,180,255,0.45)",
          fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
          textAlign: "center", marginTop: 8,
          lineHeight: 1.5,
        }}>
          Game: Rock-Paper-Scissors. 3 lives. Score scales with win streak and opponent difficulty.
          <br />More games coming.
        </div>
      </div>
    </div>
  );
}

// ─── OpponentCard — one personality, one tap target ─────────────────────────
function OpponentCard({ opp, onChallenge }: {
  opp: Opponent;
  onChallenge: () => void;
}) {
  return (
    <div
      role="button" tabIndex={0} onClick={onChallenge}
      onKeyDown={e => { if (e.key === "Enter") onChallenge(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        borderRadius: 18, background: opp.wall, paddingBottom: 5,
        boxShadow: `0 10px 28px -6px ${opp.glow}, 0 0 0 1.5px ${opp.color}55`,
        transition: "transform 0.15s",
      }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.985) translateY(2px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onTouchStart={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.985) translateY(2px)"; }}
      onTouchEnd={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{
        borderRadius: "16px 16px 14px 14px",
        background: opp.face,
        padding: "16px 18px",
        position: "relative", overflow: "hidden",
        border: "2px solid rgba(255,255,255,0.4)",
        boxShadow: "inset 0 6px 16px rgba(255,255,255,0.5), inset 0 -3px 6px rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        {/* Top gloss */}
        <div style={{
          position: "absolute", top: 2, left: "5%", right: "5%", height: "44%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 100%)",
          borderRadius: "14px 14px 60px 60px", pointerEvents: "none",
        }} />

        {/* Emoji portrait */}
        <div style={{
          fontSize: 48, lineHeight: 1, position: "relative", zIndex: 1,
          filter: `drop-shadow(0 4px 10px ${opp.glow})`,
          flexShrink: 0,
        }}>{opp.emoji}</div>

        {/* Name + tagline + difficulty */}
        <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 3,
          }}>
            <div style={{
              color: "white", fontSize: 18, fontWeight: 900,
              letterSpacing: "0.06em",
              textShadow: "0 2px 4px rgba(0,0,0,0.4)",
            }}>{opp.name}</div>
            <DifficultyChip level={opp.difficulty} />
          </div>
          <div style={{
            color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: 700,
            lineHeight: 1.3,
            textShadow: "0 1px 2px rgba(0,0,0,0.3)",
            overflow: "hidden", textOverflow: "ellipsis",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>{opp.tagline}</div>
        </div>

        {/* Challenge arrow */}
        <div style={{
          width: 38, height: 38, borderRadius: "999px",
          background: "rgba(0,0,0,0.25)",
          border: "1.5px solid rgba(255,255,255,0.3)",
          color: "white", fontSize: 18, fontWeight: 900,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, position: "relative", zIndex: 1,
        }}>→</div>
      </div>
    </div>
  );
}

// ─── DifficultyChip — three little bars showing 1/2/3 ───────────────────────
function DifficultyChip({ level }: { level: 1 | 2 | 3 }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 2,
      padding: "2px 6px", borderRadius: 999,
      background: "rgba(0,0,0,0.3)",
      border: "1px solid rgba(255,255,255,0.25)",
    }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          width: 4, height: i * 3 + 4,
          background: i <= level ? "white" : "rgba(255,255,255,0.25)",
          borderRadius: 2,
        }} />
      ))}
    </div>
  );
}
