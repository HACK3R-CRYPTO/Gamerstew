"use client";

// ─── /games/challenge-ai/rps ──────────────────────────────────────────────────
// Rock-Paper-Scissors vs an AI opponent. The whole point of this screen is the
// SIMULTANEOUS REVEAL moment — both moves locked together, both flip at the
// exact same animation frame. Without that beat the game feels like a slot
// machine. With it, the player feels they actually played someone.
//
// Phase machine: IDLE → PICK → LOCK → REVEAL → RESOLVE → PICK (or FINISHED)
//
// Anti-cheat: each round is logged with timestamps and outcomes. At game end
// the full RoundLog[] gets shipped to /api/sign-score along with the opponent
// id, so the server can replay the AI strategy and confirm both sides match.
// Same shape as rhythm rush's tap log.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MOVES, MOVE_EMOJI, MOVE_LABEL,
  rpsOutcome, scoreForWin, narrativeFor,
  opponentById, OPPONENT_BONUS,
  type Move, type Phase, type Opponent, type RoundLog,
} from "@/lib/challengeAi";

const STARTING_LIVES = 3;

export default function RpsPage() {
  const router = useSearchParams();
  const navRouter = useRouter();
  // ?opp=oracle in the URL picks the opponent. Default to ORACLE so a
  // direct link without query still gets the headline experience.
  const oppId = router.get("opp") ?? "oracle";
  const opp = useMemo(() => opponentById(oppId) ?? opponentById("oracle")!, [oppId]);

  // ─── Match state ───────────────────────────────────────────────────────────
  const [phase,       setPhase]       = useState<Phase>("PICK");
  const [round,       setRound]       = useState(0);
  const [score,       setScore]       = useState(0);
  const [lives,       setLives]       = useState(STARTING_LIVES);
  const [streak,      setStreak]      = useState(0);
  const [playerMove,  setPlayerMove]  = useState<Move | null>(null);
  const [aiMove,      setAiMove]      = useState<Move | null>(null);
  const [lastResult,  setLastResult]  = useState<-1 | 0 | 1 | null>(null);

  // ─── Anti-cheat log ────────────────────────────────────────────────────────
  // Every round gets pushed in here. Sent at game end as the replay log so the
  // backend can recompute the AI moves and confirm the player's win count.
  const logRef        = useRef<RoundLog[]>([]);
  const playerHistory = useRef<Move[]>([]);
  const matchStartRef = useRef<number>(0);

  // ─── Phase timers (held so we can cancel on unmount) ──────────────────────
  const lockTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    matchStartRef.current = Date.now();
    return () => {
      [lockTimer, revealTimer, resolveTimer].forEach(t => {
        if (t.current) clearTimeout(t.current);
      });
    };
  }, []);

  // ─── Tap handler — player picks a move ────────────────────────────────────
  // The moment they tap, the AI's move is already determined. We intentionally
  // hold the LOCK phase so both sides reveal at the same instant — that's the
  // emotional beat the whole game hangs on.
  function onPickMove(m: Move) {
    if (phase !== "PICK") return;

    const ai = opp.strategy(playerHistory.current);
    const result = rpsOutcome(m, ai);

    setPlayerMove(m);
    setAiMove(ai);
    setLastResult(result);
    setPhase("LOCK");

    // Push round to log immediately — t is ms since match start so the server
    // can verify pacing later (no taps under the human-reaction floor).
    logRef.current.push({
      t:          Date.now() - matchStartRef.current,
      playerMove: m,
      aiMove:     ai,
      result,
    });
    playerHistory.current.push(m);

    // Phase pacing — opp.lockMs is personality-specific (1.2s gambler,
    // 1.5s mirror, 2.0s oracle). Then a fixed 400ms reveal animation hold
    // and a 1200ms resolve view before advancing.
    lockTimer.current = setTimeout(() => {
      setPhase("REVEAL");
      revealTimer.current = setTimeout(() => {
        setPhase("RESOLVE");
        // Apply the round result during RESOLVE phase.
        if (result === 1) {
          setScore(s => s + scoreForWin(streak));
          setStreak(s => s + 1);
        } else if (result === -1) {
          setLives(l => l - 1);
          setStreak(0);
        } else {
          // tie — streak holds, lives hold
        }
        resolveTimer.current = setTimeout(advance, 1200);
      }, 400);
    }, opp.lockMs);
  }

  // ─── Advance to next round or finish ──────────────────────────────────────
  function advance() {
    // Check loss condition first using the lives state that was just set
    // by the RESOLVE branch above. We read state via the setter callback
    // to avoid stale-state issues across the chained timeouts.
    setLives(currentLives => {
      if (currentLives <= 0) {
        // Out of lives — final state, ready to submit
        setPhase("FINISHED");
        return currentLives;
      }
      setRound(r => r + 1);
      setPlayerMove(null);
      setAiMove(null);
      setLastResult(null);
      setPhase("PICK");
      return currentLives;
    });
  }

  // ─── Submit final score ───────────────────────────────────────────────────
  // For v1 this just logs the result and routes back. Backend wiring goes in
  // after the UX is locked.
  const [submitting, setSubmitting] = useState(false);
  async function submitScore() {
    if (submitting) return;
    setSubmitting(true);
    const finalScore = Math.floor(score * OPPONENT_BONUS[opp.id]);
    // TODO: wire to /api/sign-score with sessionToken + logRef.current
    console.log("[challenge-ai/rps] final", {
      opponent: opp.id,
      rounds:   logRef.current.length,
      score:    finalScore,
      log:      logRef.current,
    });
    setTimeout(() => navRouter.push("/leaderboard"), 800);
  }

  function playAgain() {
    setPhase("PICK");
    setRound(0);
    setScore(0);
    setLives(STARTING_LIVES);
    setStreak(0);
    setPlayerMove(null);
    setAiMove(null);
    setLastResult(null);
    logRef.current = [];
    playerHistory.current = [];
    matchStartRef.current = Date.now();
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  const showingResult = phase === "RESOLVE";

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #07021a 0%, #04001a 100%)",
      display: "flex", flexDirection: "column",
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      {/* Background glow tinted by opponent color */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
      }}>
        <div style={{
          position: "absolute", top: "-15%", left: "50%", transform: "translateX(-50%)",
          width: "min(80vw, 600px)", height: "min(80vw, 600px)", borderRadius: "50%",
          background: `radial-gradient(circle, ${opp.glow} 0%, transparent 60%)`,
          filter: "blur(40px)",
          transition: "opacity 0.5s",
          opacity: phase === "REVEAL" || phase === "RESOLVE" ? 1 : 0.5,
        }} />
      </div>

      {/* Header — back, score, lives */}
      <div style={{
        position: "relative", zIndex: 1,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 18px",
        maxWidth: "640px", margin: "0 auto", width: "100%",
      }}>
        <button
          onClick={() => navRouter.push("/games/challenge-ai")}
          style={{
            width: 36, height: 36, borderRadius: "999px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "white", fontSize: 16, fontWeight: 900, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >←</button>

        <div style={{
          display: "flex", alignItems: "center", gap: 16,
        }}>
          <Stat label="SCORE" value={String(score)} color="#fbbf24" />
          <Stat
            label="LIVES"
            value={"❤️".repeat(lives) + "♡".repeat(Math.max(0, STARTING_LIVES - lives))}
            color="#ef4444"
          />
        </div>
      </div>

      {/* Main arena */}
      <div style={{
        flex: 1,
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 16, padding: "8px 16px 24px",
        maxWidth: "640px", margin: "0 auto", width: "100%",
        position: "relative", zIndex: 1,
      }}>
        {/* Opponent banner */}
        <OpponentBanner
          opp={opp}
          phase={phase}
          narrative={narrativeFor(opp, round)}
        />

        {/* THE REVEAL — two cards side by side */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
          width: "100%", maxWidth: 440,
        }}>
          <MoveCard
            side="YOU"
            sideColor="#86efac"
            phase={phase}
            move={playerMove}
            won={lastResult === 1 && showingResult}
            lost={lastResult === -1 && showingResult}
          />
          <MoveCard
            side={opp.name}
            sideColor={opp.color}
            phase={phase}
            move={aiMove}
            won={lastResult === -1 && showingResult}
            lost={lastResult === 1 && showingResult}
          />
        </div>

        {/* Result banner — only during RESOLVE */}
        <ResultBanner phase={phase} result={lastResult} playerMove={playerMove} aiMove={aiMove} streak={streak} />

        {/* Move picker — only during PICK */}
        {phase === "PICK" && (
          <div style={{
            width: "100%", display: "flex", flexDirection: "column", gap: 12,
            marginTop: 12,
          }}>
            <div style={{
              color: "rgba(229,231,235,0.62)",
              fontSize: 11, fontWeight: 800, letterSpacing: "0.18em",
              textAlign: "center",
            }}>PICK YOUR MOVE</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {MOVES.map(m => (
                <MoveButton key={m} move={m} onClick={() => onPickMove(m)} />
              ))}
            </div>
          </div>
        )}

        {/* End-of-match panel */}
        {phase === "FINISHED" && (
          <FinishedPanel
            score={Math.floor(score * OPPONENT_BONUS[opp.id])}
            rawScore={score}
            opp={opp}
            rounds={logRef.current.length}
            wins={logRef.current.filter(l => l.result === 1).length}
            onPlayAgain={playAgain}
            onSubmit={submitScore}
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}

// ─── Stat chip (score / lives) ─────────────────────────────────────────────
function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "flex-end",
    }}>
      <div style={{
        color: "rgba(255,255,255,0.55)", fontSize: 9, fontWeight: 800,
        letterSpacing: "0.14em",
      }}>{label}</div>
      <div style={{
        color, fontSize: 18, fontWeight: 900, lineHeight: 1,
        textShadow: `0 0 10px ${color}88`,
        marginTop: 2,
      }}>{value}</div>
    </div>
  );
}

// ─── Opponent banner — portrait card with name + narrative ──────────────────
function OpponentBanner({ opp, phase, narrative }: {
  opp: Opponent; phase: Phase; narrative: string;
}) {
  const active = phase === "LOCK" || phase === "REVEAL";
  return (
    <div style={{
      width: "100%", maxWidth: 440,
      borderRadius: 18, background: opp.wall, paddingBottom: 5,
      boxShadow: `0 10px 28px -4px ${opp.glow}, 0 0 0 1.5px ${opp.color}66`,
      transition: "transform 0.3s",
      transform: active ? "scale(1.02)" : "scale(1)",
    }}>
      <div style={{
        borderRadius: "16px 16px 14px 14px",
        background: opp.face,
        padding: "12px 18px",
        position: "relative", overflow: "hidden",
        border: "2px solid rgba(255,255,255,0.4)",
        boxShadow: "inset 0 6px 16px rgba(255,255,255,0.5), inset 0 -3px 6px rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          position: "absolute", top: 2, left: "5%", right: "5%", height: "44%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 100%)",
          borderRadius: "14px 14px 60px 60px", pointerEvents: "none",
        }} />
        <div style={{
          fontSize: 42, lineHeight: 1, position: "relative", zIndex: 1,
          filter: `drop-shadow(0 4px 10px ${opp.glow})`,
          transform: active ? "scale(1.05)" : "scale(1)",
          transition: "transform 0.3s",
        }}>{opp.emoji}</div>
        <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0 }}>
          <div style={{
            color: "white", fontSize: 18, fontWeight: 900,
            letterSpacing: "0.06em", textShadow: "0 2px 4px rgba(0,0,0,0.4)",
          }}>{opp.name}</div>
          <div style={{
            color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: 700,
            marginTop: 2, lineHeight: 1.25,
            textShadow: "0 1px 2px rgba(0,0,0,0.3)",
            overflow: "hidden", textOverflow: "ellipsis",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>{narrative}</div>
        </div>
      </div>
    </div>
  );
}

// ─── MoveCard — the LOCK + REVEAL beat ──────────────────────────────────────
// During PICK: shows `?` placeholder for both
// During LOCK: both show `?` with a subtle pulse
// During REVEAL/RESOLVE: shows actual move emoji with scale-pop animation
function MoveCard({ side, sideColor, phase, move, won, lost }: {
  side: string; sideColor: string; phase: Phase;
  move: Move | null;
  won: boolean; lost: boolean;
}) {
  const isLocked = phase === "LOCK";
  const isRevealed = phase === "REVEAL" || phase === "RESOLVE";
  // Show emoji only after reveal — even if move is set during LOCK, we keep it
  // hidden behind the `?` until REVEAL phase flips both cards together.
  const display = isRevealed && move !== null ? MOVE_EMOJI[move] : "?";

  return (
    <div style={{
      borderRadius: 18,
      background: won ? "linear-gradient(180deg, #fde68a 0%, #f59e0b 100%)"
                : lost ? "linear-gradient(180deg, #7f1d1d 0%, #1a0550 100%)"
                : sideColor + "55",
      paddingBottom: 5,
      boxShadow: won
        ? `0 0 36px ${sideColor}, 0 0 0 2px ${sideColor}`
        : `0 10px 24px -6px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(255,255,255,0.08)`,
      transition: "all 0.3s",
      transform: won ? "scale(1.06)" : lost ? "scale(0.97)" : "scale(1)",
      opacity: lost ? 0.7 : 1,
    }}>
      <div style={{
        borderRadius: "16px 16px 14px 14px",
        background: "linear-gradient(180deg, rgba(30,15,80,0.85) 0%, rgba(10,5,30,0.95) 100%)",
        border: "2px solid rgba(255,255,255,0.15)",
        padding: "14px 12px",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 8, minHeight: 140,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          color: sideColor, fontSize: 10, fontWeight: 900,
          letterSpacing: "0.18em",
          textShadow: `0 0 8px ${sideColor}88`,
        }}>{side}</div>

        {/* The big emoji — animated on REVEAL */}
        <div
          key={`${phase}-${display}`}
          style={{
            fontSize: 64,
            lineHeight: 1,
            animation: isRevealed ? "rpsPop 380ms cubic-bezier(0.22, 1, 0.36, 1)" : (isLocked ? "rpsLock 600ms ease-in-out infinite alternate" : "none"),
            filter: isRevealed ? `drop-shadow(0 6px 14px ${sideColor})` : "none",
          }}
        >
          {display}
        </div>

        {/* Move label when revealed */}
        {isRevealed && move !== null && (
          <div style={{
            color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: 900,
            letterSpacing: "0.14em",
          }}>{MOVE_LABEL[move]}</div>
        )}
        {phase === "LOCK" && (
          <div style={{
            color: "rgba(229,231,235,0.5)", fontSize: 10, fontWeight: 800,
            letterSpacing: "0.16em",
          }}>{side === "YOU" ? "LOCKED" : "CALCULATING"}</div>
        )}
      </div>

      <style jsx>{`
        @keyframes rpsPop {
          0%   { transform: scale(0.5) rotate(-12deg); opacity: 0; }
          55%  { transform: scale(1.18) rotate(4deg);  opacity: 1; }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
        @keyframes rpsLock {
          0%   { opacity: 0.55; transform: scale(1); }
          100% { opacity: 1;    transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}

// ─── ResultBanner — shows "ROCK BEATS SCISSORS — YOU WIN" during RESOLVE ────
function ResultBanner({ phase, result, playerMove, aiMove, streak }: {
  phase: Phase; result: -1 | 0 | 1 | null;
  playerMove: Move | null; aiMove: Move | null; streak: number;
}) {
  if (phase !== "RESOLVE" || result === null || playerMove === null || aiMove === null) {
    return <div style={{ height: 44 }} />; // reserve space so layout doesn't jump
  }

  const text =
    result === 0 ? "TIE — NO CHANGE"
    : result === 1 ? `${MOVE_LABEL[playerMove]} BEATS ${MOVE_LABEL[aiMove]} — YOU WIN`
    : `${MOVE_LABEL[aiMove]} BEATS ${MOVE_LABEL[playerMove]} — YOU LOSE`;

  const color = result === 1 ? "#86efac" : result === -1 ? "#fca5a5" : "rgba(255,255,255,0.7)";

  return (
    <div style={{
      padding: "10px 16px", borderRadius: 999,
      background: result === 1 ? "rgba(134,239,172,0.12)" : result === -1 ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
      border: `1px solid ${result === 1 ? "rgba(134,239,172,0.4)" : result === -1 ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.12)"}`,
      color,
      fontSize: 12, fontWeight: 900, letterSpacing: "0.08em",
      animation: "rpsResultIn 280ms cubic-bezier(0.22, 1, 0.36, 1)",
      textAlign: "center",
    }}>
      {text}
      {result === 1 && streak >= 1 && (
        <span style={{ marginLeft: 8, color: "#fbbf24" }}>🔥 {streak + 1}</span>
      )}

      <style jsx>{`
        @keyframes rpsResultIn {
          from { transform: translateY(-6px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── MoveButton — three large pickable buttons ──────────────────────────────
function MoveButton({ move, onClick }: { move: Move; onClick: () => void }) {
  return (
    <div
      role="button" tabIndex={0} onClick={onClick}
      onKeyDown={e => { if (e.key === "Enter") onClick(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        borderRadius: 16,
        background: "linear-gradient(180deg, #312e81 0%, #1e1b4b 100%)",
        paddingBottom: 5,
        boxShadow: "0 8px 18px rgba(0,0,0,0.6)",
        transition: "transform 0.12s",
      }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(3px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onTouchStart={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(3px)"; }}
      onTouchEnd={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{
        borderRadius: "14px 14px 12px 12px",
        background: "linear-gradient(160deg, #818cf8 0%, #6366f1 50%, #4338ca 100%)",
        padding: "14px 8px",
        textAlign: "center",
        border: "2px solid rgba(255,255,255,0.4)",
        boxShadow: "inset 0 6px 14px rgba(255,255,255,0.55), inset 0 -3px 6px rgba(0,0,0,0.3)",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: 2, left: "8%", right: "8%", height: "44%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, transparent 100%)",
          borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
        }} />
        <div style={{ fontSize: 36, position: "relative", zIndex: 1 }}>
          {MOVE_EMOJI[move]}
        </div>
        <div style={{
          color: "white", fontSize: 10, fontWeight: 900,
          letterSpacing: "0.14em", marginTop: 4,
          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          position: "relative", zIndex: 1,
        }}>{MOVE_LABEL[move]}</div>
      </div>
    </div>
  );
}

// ─── FinishedPanel — out of lives, submit or replay ─────────────────────────
function FinishedPanel({
  score, rawScore, opp, rounds, wins, onPlayAgain, onSubmit, submitting,
}: {
  score: number; rawScore: number; opp: Opponent;
  rounds: number; wins: number;
  onPlayAgain: () => void; onSubmit: () => void; submitting: boolean;
}) {
  return (
    <div style={{
      width: "100%", maxWidth: 440, marginTop: 20,
      borderRadius: 20,
      background: opp.wall, paddingBottom: 5,
      boxShadow: `0 0 36px ${opp.glow}, 0 0 0 2px ${opp.color}66`,
    }}>
      <div style={{
        borderRadius: "18px 18px 14px 14px",
        background: "linear-gradient(180deg, rgba(30,15,80,0.92) 0%, rgba(10,5,30,0.96) 100%)",
        border: "2px solid rgba(255,255,255,0.15)",
        padding: "22px 20px",
        display: "flex", flexDirection: "column", gap: 14,
        textAlign: "center",
      }}>
        <div style={{
          color: opp.color, fontSize: 11, fontWeight: 900,
          letterSpacing: "0.2em",
        }}>{opp.name} BEAT YOU</div>

        <div style={{
          color: "white", fontSize: 36, fontWeight: 900, lineHeight: 1,
          textShadow: `0 0 18px ${opp.glow}`,
        }}>{score}</div>

        <div style={{
          color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 700,
          letterSpacing: "0.04em",
        }}>
          {wins} wins · {rounds} rounds · {opp.name} bonus ×{OPPONENT_BONUS[opp.id].toFixed(1)}
          {rawScore !== score && (
            <span style={{ color: opp.color }}> · base {rawScore}</span>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
          <button
            onClick={onPlayAgain}
            style={{
              padding: "12px", borderRadius: 14,
              background: "rgba(255,255,255,0.08)",
              border: "1.5px solid rgba(255,255,255,0.18)",
              color: "white", fontSize: 12, fontWeight: 900,
              letterSpacing: "0.14em", cursor: "pointer",
            }}
          >PLAY AGAIN</button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            style={{
              padding: "12px", borderRadius: 14,
              background: `linear-gradient(160deg, ${opp.color}, ${opp.color}aa)`,
              border: "2px solid rgba(255,255,255,0.4)",
              color: "white", fontSize: 12, fontWeight: 900,
              letterSpacing: "0.14em",
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
              boxShadow: `0 4px 14px ${opp.glow}`,
            }}
          >{submitting ? "SAVING…" : "SAVE SCORE"}</button>
        </div>
      </div>
    </div>
  );
}
