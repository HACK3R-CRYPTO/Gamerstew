"use client";

// ─── /games/challenge-ai · v3 "Instant Arena" ────────────────────────────────
// MARKOV goes free, instant, and reads you.
//
// The wager-era flow (propose tx → agent accept tx → move txs → resolve tx,
// 35-60s per single throw) is gone. Matches run against the backend match
// engine (games-backend/lib/arenaMatch.js) — the same Markov-2/1/histogram
// opponent model the on-chain agent used, served over HTTP. A full best-of-5
// plays in ~20 seconds.
//
// Fairness: commit-reveal. The backend returns keccak256(seed) BEFORE round 1;
// every MARKOV decision derives deterministically from that seed + your
// observed history; the seed is revealed at match end so the match can be
// replayed and verified.
//
// Phases: lobby → vs (slam cinematic) → match (bo5 rounds) → result
// (outcome + "how MARKOV read you" model reveal + fairness proof + rematch).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { playFightSlam, playWin, playLose, playTie } from "@/hooks/useAppAudio";
import { startArenaMatch, throwArenaMove, type RoundResult } from "@/app/actions/arena";

// ─── Player pet (mirrors simon/rhythm pages) ─────────────────────────────────
type PetStage = { id: string; name: string; src: string; minLevel: number; color: string };
const PET_STAGES: PetStage[] = [
  { id: "egg",     name: "Mystery Egg",   src: "/pets/stage-1-egg.png",     minLevel: 1,  color: "#e2e8f0" },
  { id: "baby",    name: "Baby Slime",    src: "/pets/stage-2-baby.png",    minLevel: 5,  color: "#22c55e" },
  { id: "teen",    name: "Teen Slime",    src: "/pets/stage-3-teen.png",    minLevel: 15, color: "#a78bfa" },
  { id: "crystal", name: "Crystal Slime", src: "/pets/stage-4-crystal.png", minLevel: 30, color: "#06b6d4" },
  { id: "king",    name: "King Slime",    src: "/pets/stage-5-king.png",    minLevel: 50, color: "#fbbf24" },
];
function petForLevel(level: number): PetStage {
  let stage = PET_STAGES[0]!;
  for (const s of PET_STAGES) if (level >= s.minLevel) stage = s;
  return stage;
}

const MARKOV_ART = "/games/challenge-ai-v2/ai-bot-medium.png";
const RIM = "#fbbf24";
const BG = "#04001a";

const MOVES = [
  { id: 0, name: "ROCK",     emoji: "🪨" },
  { id: 1, name: "PAPER",    emoji: "📄" },
  { id: 2, name: "SCISSORS", emoji: "✂️" },
] as const;

type Phase = "lobby" | "vs" | "match" | "result";

// Persistent local record vs MARKOV (client-side flavor; ladder comes in Phase B)
function useLocalRecord() {
  const [record, setRecord] = useState({ w: 0, l: 0, t: 0, streak: 0 });
  useEffect(() => {
    try {
      const raw = localStorage.getItem("arena_v3_record");
      if (raw) setRecord(JSON.parse(raw));
    } catch {}
  }, []);
  const update = useCallback((outcome: "player_won" | "ai_won" | "tie") => {
    setRecord((r) => {
      const next = {
        w: r.w + (outcome === "player_won" ? 1 : 0),
        l: r.l + (outcome === "ai_won" ? 1 : 0),
        t: r.t + (outcome === "tie" ? 1 : 0),
        streak: outcome === "player_won" ? r.streak + 1 : 0,
      };
      try { localStorage.setItem("arena_v3_record", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  return { record, update };
}

export default function ChallengeAiPage() {
  useRequireAuth();
  const router = useRouter();
  const { address } = useAccount();

  const [phase, setPhase] = useState<Phase>("lobby");
  const [pet, setPet] = useState<PetStage>(PET_STAGES[0]!);
  const { record, update: updateRecord } = useLocalRecord();

  // Match state
  const [matchId, setMatchId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  const [lastRound, setLastRound] = useState<RoundResult | null>(null);
  const [finalData, setFinalData] = useState<NonNullable<RoundResult["final"]> | null>(null);
  const [score, setScore] = useState({ player: 0, ai: 0, ties: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [revealing, setRevealing] = useState(false);
  const throwLock = useRef(false);

  // Pet level from backend (best-effort)
  useEffect(() => {
    if (!address) return;
    fetch(`/api/user/${address}`)
      .then((r) => r.json())
      .then((d) => setPet(petForLevel(Number(d?.level) || 1)))
      .catch(() => {});
  }, [address]);

  // ─── Start a match ─────────────────────────────────────────────────────────
  const startMatch = useCallback(async () => {
    if (!address || busy) return;
    setBusy(true);
    setError(null);
    const res = await startArenaMatch(address);
    setBusy(false);
    if (res.error || !res.matchId) {
      setError("MARKOV is unreachable · try again in a moment");
      setPhase("lobby");
      return;
    }
    setMatchId(res.matchId);
    setRounds([]);
    setLastRound(null);
    setFinalData(null);
    setScore({ player: 0, ai: 0, ties: 0 });
    setPhase("vs");
    playFightSlam();
    // Slam cinematic → straight into round 1 countdown
    setTimeout(() => {
      setPhase("match");
      setCountdown(3);
    }, 1700);
  }, [address, busy]);

  // ─── Round countdown (3·2·1 → buttons unlock) ──────────────────────────────
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 550);
    return () => clearTimeout(t);
  }, [countdown]);

  // ─── Throw a move ──────────────────────────────────────────────────────────
  const throwMove = useCallback(
    async (move: number) => {
      if (!matchId || throwLock.current || revealing || (countdown ?? 0) > 0) return;
      throwLock.current = true;
      setRevealing(true);

      const res = await throwArenaMove(matchId, move);
      if (res.error) {
        setError(
          res.error === "match_not_found"
            ? "Match expired · start a fresh one"
            : "Connection hiccup · try again",
        );
        setPhase("lobby");
        setRevealing(false);
        throwLock.current = false;
        return;
      }

      setLastRound(res);
      setRounds((r) => [...r, res]);
      setScore(res.score);
      if (res.result === "win") playWin();
      else if (res.result === "loss") playLose();
      else playTie();

      if (res.final) {
        const fin = res.final;
        setTimeout(() => {
          setFinalData(fin);
          updateRecord(fin.outcome);
          setPhase("result");
          setRevealing(false);
          throwLock.current = false;
        }, 1500);
      } else {
        // Reveal beat, then auto-arm the next round
        setTimeout(() => {
          setRevealing(false);
          setCountdown(3);
          throwLock.current = false;
        }, 1400);
      }
    },
    [matchId, revealing, countdown, updateRecord],
  );

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: BG,
        color: "#ede9fe",
        fontFamily: "inherit",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ambient glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(60% 40% at 50% 0%, rgba(167,139,250,0.16) 0%, transparent 70%), radial-gradient(50% 35% at 50% 100%, rgba(251,191,36,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          position: "relative",
          zIndex: 2,
        }}
      >
        <button
          onClick={() => (phase === "lobby" ? router.push("/games") : setPhase("lobby"))}
          style={{
            background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "#ede9fe",
            borderRadius: 12,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ← {phase === "lobby" ? "Games" : "Quit match"}
        </button>
        <div
          style={{
            background: "rgba(251,191,36,0.14)",
            border: "1px solid rgba(251,191,36,0.4)",
            color: RIM,
            borderRadius: 999,
            padding: "6px 14px",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
          }}
        >
          FREE · INSTANT · BEST OF 5
        </div>
      </div>

      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          padding: "8px 16px 40px",
          position: "relative",
          zIndex: 2,
        }}
      >
        {phase === "lobby" && (
          <Lobby
            record={record}
            busy={busy}
            error={error}
            onStart={startMatch}
          />
        )}
        {phase === "vs" && <VsSting pet={pet} />}
        {phase === "match" && (
          <MatchStage
            pet={pet}
            score={score}
            round={rounds.length + (revealing ? 0 : 1)}
            countdown={countdown}
            revealing={revealing}
            lastRound={lastRound}
            onThrow={throwMove}
          />
        )}
        {phase === "result" && finalData && (
          <ResultStage
            pet={pet}
            final={finalData}
            score={score}
            record={record}
            onRematch={startMatch}
            onLobby={() => setPhase("lobby")}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}

// ═══ Lobby ════════════════════════════════════════════════════════════════════
function Lobby({
  record, busy, error, onStart,
}: {
  record: { w: number; l: number; t: number; streak: number };
  busy: boolean;
  error: string | null;
  onStart: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* MARKOV hero */}
      <div
        style={{
          position: "relative",
          borderRadius: 24,
          overflow: "hidden",
          border: "1px solid rgba(251,191,36,0.35)",
          background:
            "radial-gradient(circle at 50% 30%, rgba(251,191,36,0.18) 0%, rgba(8,2,32,0.9) 65%)",
          padding: "28px 20px 20px",
          textAlign: "center",
        }}
      >
        <img
          src={MARKOV_ART}
          alt="MARKOV"
          style={{
            width: 180,
            height: 180,
            objectFit: "contain",
            filter: `drop-shadow(0 0 34px ${RIM}66)`,
          }}
        />
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: "0.04em", marginTop: 6 }}>
          MARKOV
        </div>
        <div style={{ fontSize: 13, color: "rgba(220,210,255,0.75)", marginTop: 4 }}>
          The AI that learns your patterns · every throw trains it
        </div>
        <div
          style={{
            display: "inline-block",
            marginTop: 12,
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 12,
            padding: "8px 14px",
            fontSize: 12.5,
            color: "rgba(220,210,255,0.85)",
            fontStyle: "italic",
          }}
        >
          “bring your best pattern. i've already modeled it.”
        </div>
      </div>

      {/* record strip */}
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        {[
          { label: "WINS", value: record.w, color: "#86efac" },
          { label: "LOSSES", value: record.l, color: "#fca5a5" },
          { label: "TIES", value: record.t, color: "#c4b5fd" },
          { label: "STREAK", value: record.streak, color: RIM },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              background: "rgba(8,2,32,0.7)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: "10px 0",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "rgba(220,210,255,0.55)" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div
          style={{
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            color: "#fca5a5",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={onStart}
        disabled={busy}
        style={{
          background: busy
            ? "rgba(251,191,36,0.4)"
            : `linear-gradient(180deg, ${RIM}, #f59e0b)`,
          color: "#04001a",
          border: "none",
          borderRadius: 18,
          padding: "18px 0",
          fontSize: 18,
          fontWeight: 900,
          letterSpacing: "0.06em",
          cursor: busy ? "wait" : "pointer",
          boxShadow: `0 8px 30px ${RIM}44`,
        }}
      >
        {busy ? "SUMMONING MARKOV…" : "⚔️ ENTER ARENA"}
      </button>

      <div
        style={{
          fontSize: 11.5,
          color: "rgba(220,210,255,0.5)",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        Provably fair · MARKOV's moves are hash-committed before round 1
        <br />
        and the seed is revealed after the match so you can verify every throw.
      </div>
    </div>
  );
}

// ═══ VS sting ═════════════════════════════════════════════════════════════════
function VsSting({ pet }: { pet: PetStage }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        minHeight: 380,
        animation: "arenaFadeIn 0.3s ease",
      }}
    >
      <style>{`
        @keyframes arenaFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slamL { from { transform: translateX(-80px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes slamR { from { transform: translateX(80px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes vsPop { 0% { transform: scale(0.2); opacity: 0 } 70% { transform: scale(1.25) } 100% { transform: scale(1); opacity: 1 } }
      `}</style>
      <div style={{ textAlign: "center", animation: "slamL 0.5s cubic-bezier(0.22,1.4,0.36,1) both" }}>
        <img src={pet.src} alt={pet.name} style={{ width: 120, height: 120, objectFit: "contain", filter: `drop-shadow(0 0 24px ${pet.color}88)` }} />
        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>YOU</div>
      </div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 900,
          color: RIM,
          textShadow: `0 0 30px ${RIM}aa`,
          animation: "vsPop 0.6s 0.45s cubic-bezier(0.22,1.6,0.36,1) both",
        }}
      >
        VS
      </div>
      <div style={{ textAlign: "center", animation: "slamR 0.5s cubic-bezier(0.22,1.4,0.36,1) both" }}>
        <img src={MARKOV_ART} alt="MARKOV" style={{ width: 120, height: 120, objectFit: "contain", filter: `drop-shadow(0 0 24px ${RIM}88)` }} />
        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>MARKOV</div>
      </div>
    </div>
  );
}

// ═══ Match stage ══════════════════════════════════════════════════════════════
function MatchStage({
  pet, score, round, countdown, revealing, lastRound, onThrow,
}: {
  pet: PetStage;
  score: { player: number; ai: number; ties: number };
  round: number;
  countdown: number | null;
  revealing: boolean;
  lastRound: RoundResult | null;
  onThrow: (m: number) => void;
}) {
  const locked = revealing || (countdown ?? 0) > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`
        @keyframes throwPop { 0% { transform: scale(0.3) } 70% { transform: scale(1.2) } 100% { transform: scale(1) } }
        @keyframes linePop { from { transform: translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } }
      `}</style>

      {/* score pips */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <ScorePips label="YOU" color={pet.color} count={score.player} align="left" />
        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(220,210,255,0.6)", letterSpacing: "0.1em" }}>
          ROUND {Math.min(round, 9)}
        </div>
        <ScorePips label="MARKOV" color={RIM} count={score.ai} align="right" />
      </div>

      {/* reveal area */}
      <div
        style={{
          minHeight: 190,
          borderRadius: 22,
          background: "rgba(8,2,32,0.7)",
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          padding: 16,
        }}
      >
        {revealing && lastRound ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
              <div style={{ textAlign: "center", animation: "throwPop 0.35s cubic-bezier(0.22,1.5,0.36,1) both" }}>
                <div style={{ fontSize: 54 }}>{MOVES[lastRound.playerMove]!.emoji}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(220,210,255,0.6)" }}>YOU</div>
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 900,
                  color:
                    lastRound.result === "win" ? "#86efac"
                    : lastRound.result === "loss" ? "#fca5a5" : "#c4b5fd",
                  textShadow: "0 0 18px currentColor",
                }}
              >
                {lastRound.result === "win" ? "YOU TAKE IT" : lastRound.result === "loss" ? "MARKOV TAKES IT" : "TIE"}
              </div>
              <div style={{ textAlign: "center", animation: "throwPop 0.35s 0.08s cubic-bezier(0.22,1.5,0.36,1) both" }}>
                <div style={{ fontSize: 54 }}>{MOVES[lastRound.aiMove]!.emoji}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(220,210,255,0.6)" }}>MARKOV</div>
              </div>
            </div>
            <div
              style={{
                background: "rgba(0,0,0,0.5)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 12,
                padding: "7px 14px",
                fontSize: 12.5,
                fontStyle: "italic",
                color: "rgba(240,230,255,0.9)",
                animation: "linePop 0.3s 0.25s ease both",
              }}
            >
              MARKOV: “{lastRound.markovLine}”
            </div>
          </div>
        ) : (countdown ?? 0) > 0 ? (
          <div
            key={countdown}
            style={{
              fontSize: 72,
              fontWeight: 900,
              color: RIM,
              textShadow: `0 0 40px ${RIM}88`,
              animation: "throwPop 0.4s cubic-bezier(0.22,1.5,0.36,1) both",
            }}
          >
            {countdown}
          </div>
        ) : (
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.08em", color: "rgba(220,210,255,0.85)" }}>
            THROW! ⚡
          </div>
        )}
      </div>

      {/* move buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        {MOVES.map((m) => (
          <button
            key={m.id}
            onClick={() => onThrow(m.id)}
            disabled={locked}
            style={{
              flex: 1,
              background: locked ? "rgba(30,20,60,0.6)" : "rgba(15,11,38,0.9)",
              border: `1px solid ${locked ? "rgba(255,255,255,0.06)" : "rgba(167,139,250,0.45)"}`,
              borderRadius: 18,
              padding: "18px 0 14px",
              cursor: locked ? "default" : "pointer",
              opacity: locked ? 0.55 : 1,
              transition: "transform 0.1s ease",
            }}
          >
            <div style={{ fontSize: 38 }}>{m.emoji}</div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(220,210,255,0.75)", marginTop: 4 }}>
              {m.name}
            </div>
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "rgba(220,210,255,0.4)", textAlign: "center" }}>
        First to 3 round wins takes the match
      </div>
    </div>
  );
}

function ScorePips({ label, color, count, align }: { label: string; color: string; count: number; align: "left" | "right" }) {
  return (
    <div style={{ textAlign: align }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(220,210,255,0.55)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 5, flexDirection: align === "right" ? "row-reverse" : "row" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: i < count ? color : "rgba(255,255,255,0.1)",
              boxShadow: i < count ? `0 0 10px ${color}88` : "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ═══ Result stage ═════════════════════════════════════════════════════════════
function ResultStage({
  pet, final, score, record, onRematch, onLobby, busy,
}: {
  pet: PetStage;
  final: NonNullable<RoundResult["final"]>;
  score: { player: number; ai: number; ties: number };
  record: { w: number; l: number; t: number; streak: number };
  onRematch: () => void;
  onLobby: () => void;
  busy: boolean;
}) {
  const won = final.outcome === "player_won";
  const tied = final.outcome === "tie";
  const reveal = final.modelReveal;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "arenaFadeIn 0.35s ease" }}>
      <style>{`@keyframes arenaFadeIn { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }`}</style>

      {/* outcome hero */}
      <div
        style={{
          borderRadius: 24,
          border: `1px solid ${won ? "rgba(134,239,172,0.4)" : tied ? "rgba(196,181,253,0.4)" : "rgba(252,165,165,0.35)"}`,
          background: `radial-gradient(circle at 50% 20%, ${won ? "rgba(34,197,94,0.16)" : tied ? "rgba(167,139,250,0.14)" : "rgba(239,68,68,0.12)"} 0%, rgba(8,2,32,0.9) 70%)`,
          padding: "26px 20px",
          textAlign: "center",
        }}
      >
        <img
          src={won ? pet.src : MARKOV_ART}
          alt=""
          style={{ width: 110, height: 110, objectFit: "contain", filter: `drop-shadow(0 0 26px ${won ? pet.color : RIM}77)` }}
        />
        <div style={{ fontSize: 30, fontWeight: 900, marginTop: 8, color: won ? "#86efac" : tied ? "#c4b5fd" : "#fca5a5" }}>
          {won ? "VICTORY" : tied ? "DEAD EVEN" : "MARKOV WINS"}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(220,210,255,0.8)", marginTop: 4 }}>
          {score.player} — {score.ai}{score.ties > 0 ? ` · ${score.ties} tied` : ""}
        </div>
        <div
          style={{
            display: "inline-block",
            marginTop: 12,
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 12,
            padding: "8px 14px",
            fontSize: 12.5,
            fontStyle: "italic",
            color: "rgba(240,230,255,0.9)",
          }}
        >
          MARKOV: “{final.matchLine}”
        </div>
      </div>

      {/* how MARKOV read you */}
      {reveal && (
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(251,191,36,0.3)",
            background: "rgba(8,2,32,0.75)",
            padding: "16px 18px",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: RIM, marginBottom: 8 }}>
            🧠 HOW MARKOV READ YOU
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "rgba(230,222,255,0.9)" }}>
            Across <b>{reveal.totalObserved}</b> observed throws your favorite is{" "}
            <b style={{ color: RIM }}>{reveal.favoriteMove}</b> ({reveal.favoritePct}%).
            {reveal.pattern && (
              <>
                {" "}After throwing <b>{reveal.pattern.after}</b> you play{" "}
                <b style={{ color: RIM }}>{reveal.pattern.plays}</b> {reveal.pattern.pct}% of the
                time — that's the pattern it hunted.
              </>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "rgba(220,210,255,0.5)", marginTop: 8 }}>
            Break your pattern. Run it back.
          </div>
        </div>
      )}

      {/* fairness proof */}
      <details
        style={{
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(8,2,32,0.6)",
          padding: "10px 14px",
          fontSize: 11.5,
          color: "rgba(220,210,255,0.6)",
        }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>🔒 Fairness proof (commit-reveal)</summary>
        <div style={{ marginTop: 8, lineHeight: 1.7, wordBreak: "break-all" }}>
          Committed before round 1: <code>{final.commitHash}</code>
          <br />
          Seed revealed: <code>{final.seed}</code>
          <br />
          keccak256(seed) must equal the commitment — MARKOV's moves derive
          deterministically from this seed, so the whole match is replayable.
        </div>
      </details>

      {/* CTAs */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onRematch}
          disabled={busy}
          style={{
            flex: 2,
            background: `linear-gradient(180deg, ${RIM}, #f59e0b)`,
            color: "#04001a",
            border: "none",
            borderRadius: 16,
            padding: "15px 0",
            fontSize: 15,
            fontWeight: 900,
            letterSpacing: "0.05em",
            cursor: "pointer",
            boxShadow: `0 6px 24px ${RIM}44`,
          }}
        >
          ⚔️ REMATCH
        </button>
        <button
          onClick={onLobby}
          style={{
            flex: 1,
            background: "rgba(15,11,38,0.9)",
            border: "1px solid rgba(255,255,255,0.16)",
            color: "#ede9fe",
            borderRadius: 16,
            padding: "15px 0",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Lobby
        </button>
      </div>

      <div style={{ fontSize: 11, color: "rgba(220,210,255,0.4)", textAlign: "center" }}>
        Record vs MARKOV: {record.w}W · {record.l}L · {record.t}T
        {record.streak > 1 ? ` · 🔥 ${record.streak} streak` : ""}
      </div>
    </div>
  );
}
