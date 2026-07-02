"use client";

// ─── /games/challenge-ai · v3 "Instant Arena" ────────────────────────────────
// MARKOV goes free, instant, and reads you.
//
// Game-feel architecture: the round loop is anticipation → impact.
//   1. Round banner pops ("ROUND N") · buttons armed immediately
//   2. Player taps a move → request fires AND the shake starts: both
//      combatants pump fists in sync with a ROCK·PAPER·SCISSORS chant
//      (~1.05s). The network round-trip hides inside the shake, so the
//      reveal is always instant when the fists open.
//   3. Impact frame: white flash + screen shake + oversized move slam +
//      result text punch + MARKOV persona line.
//   4. Beat, then next round banner (or match result with confetti).
//
// Fairness: commit-reveal. keccak256(seed) arrives BEFORE round 1; the seed
// is revealed at match end; every MARKOV decision derives deterministically
// from seed + observed history, so the match is replayable and verifiable.

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

const CHANT = ["ROCK", "PAPER", "SCISSORS"];
const SHAKE_MS = 1050;        // 3 fist pumps · network hides inside this
const IMPACT_HOLD_MS = 1900;  // reveal + persona line on screen
const BANNER_MS = 700;        // ROUND N banner

type Phase = "lobby" | "vs" | "match" | "result";
type RoundBeat = "banner" | "armed" | "shaking" | "impact";

// Persistent local record vs MARKOV (client-side flavor; ladder = Phase B)
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

// ─── Global keyframes (mounted once) ─────────────────────────────────────────
const KEYFRAMES = `
@keyframes arenaFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes riseIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
@keyframes idleBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
@keyframes idleBobAlt { 0%,100% { transform: translateY(-6px) } 50% { transform: translateY(2px) } }
@keyframes fistPump { 0%,100% { transform: translateY(0) scale(1) } 45% { transform: translateY(-26px) scale(1.06) } 60% { transform: translateY(4px) scale(0.98) } }
@keyframes chantPop { 0% { transform: scale(0.4); opacity: 0 } 60% { transform: scale(1.18); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
@keyframes moveSlam { 0% { transform: scale(2.6); opacity: 0; filter: blur(6px) } 55% { transform: scale(0.92); opacity: 1; filter: blur(0) } 75% { transform: scale(1.08) } 100% { transform: scale(1) } }
@keyframes resultPunch { 0% { transform: scale(0.2) rotate(-6deg); opacity: 0 } 60% { transform: scale(1.25) rotate(2deg); opacity: 1 } 100% { transform: scale(1) rotate(0) } }
@keyframes screenShake { 0%,100% { transform: translate(0,0) } 15% { transform: translate(-7px,3px) } 30% { transform: translate(6px,-4px) } 45% { transform: translate(-5px,-3px) } 60% { transform: translate(4px,3px) } 75% { transform: translate(-3px,1px) } 90% { transform: translate(2px,-1px) } }
@keyframes impactFlash { 0% { opacity: 0.85 } 100% { opacity: 0 } }
@keyframes bannerSweep { 0% { transform: translateX(-120%) skewX(-12deg); opacity: 0 } 25% { transform: translateX(0) skewX(-12deg); opacity: 1 } 75% { transform: translateX(0) skewX(-12deg); opacity: 1 } 100% { transform: translateX(120%) skewX(-12deg); opacity: 0 } }
@keyframes pipPop { 0% { transform: scale(0.4) } 60% { transform: scale(1.6) } 100% { transform: scale(1) } }
@keyframes linePop { from { transform: translateY(10px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes winnerBounce { 0%,100% { transform: scale(1) } 30% { transform: scale(1.18) rotate(-3deg) } 60% { transform: scale(0.95) rotate(2deg) } }
@keyframes loserDim { from { filter: none } to { filter: grayscale(0.6) brightness(0.7) } }
@keyframes streakFlame { 0%,100% { transform: scale(1) rotate(-4deg) } 50% { transform: scale(1.25) rotate(4deg) } }
@keyframes confettiFall { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1 } 100% { transform: translateY(105vh) rotate(720deg); opacity: 0.6 } }
@keyframes glowPulse { 0%,100% { box-shadow: 0 8px 30px rgba(251,191,36,0.27) } 50% { box-shadow: 0 8px 44px rgba(251,191,36,0.55) } }
@keyframes slamL { from { transform: translateX(-90px) scale(0.8); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes slamR { from { transform: translateX(90px) scale(0.8); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes vsPop { 0% { transform: scale(0.2); opacity: 0 } 70% { transform: scale(1.3) } 100% { transform: scale(1); opacity: 1 } }
`;

export default function ChallengeAiPage() {
  useRequireAuth();
  const router = useRouter();
  const { address } = useAccount();

  const [phase, setPhase] = useState<Phase>("lobby");
  const [pet, setPet] = useState<PetStage>(PET_STAGES[0]!);
  const { record, update: updateRecord } = useLocalRecord();

  // Match state
  const [matchId, setMatchId] = useState<string | null>(null);
  const [roundNum, setRoundNum] = useState(1);
  const [beat, setBeat] = useState<RoundBeat>("banner");
  const [chantIdx, setChantIdx] = useState(0);
  const [lastRound, setLastRound] = useState<RoundResult | null>(null);
  const [finalData, setFinalData] = useState<NonNullable<RoundResult["final"]> | null>(null);
  const [score, setScore] = useState({ player: 0, ai: 0, ties: 0 });
  const [matchStreak, setMatchStreak] = useState(0); // consecutive round wins inside this match
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const throwLock = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  }, []);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

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
    setLastRound(null);
    setFinalData(null);
    setScore({ player: 0, ai: 0, ties: 0 });
    setMatchStreak(0);
    setRoundNum(1);
    setBeat("banner");
    setPhase("vs");
    playFightSlam();
    later(() => {
      setPhase("match");
      later(() => setBeat("armed"), BANNER_MS);
    }, 1700);
  }, [address, busy, later]);

  // ─── Throw: fire request + run the shake in parallel ───────────────────────
  const throwMove = useCallback(
    async (move: number) => {
      if (!matchId || throwLock.current || beat !== "armed") return;
      throwLock.current = true;
      setBeat("shaking");
      setChantIdx(0);
      later(() => setChantIdx(1), 350);
      later(() => setChantIdx(2), 700);

      const started = Date.now();
      const res = await throwArenaMove(matchId, move);
      if (res.error) {
        setError(res.error === "match_not_found" ? "Match expired · start a fresh one" : "Connection hiccup · try again");
        setPhase("lobby");
        throwLock.current = false;
        return;
      }

      // Hold the reveal until the shake finishes — latency hides in the pumps.
      const wait = Math.max(0, SHAKE_MS - (Date.now() - started));
      later(() => {
        setLastRound(res);
        setScore(res.score);
        setMatchStreak((s) => (res.result === "win" ? s + 1 : 0));
        setBeat("impact");
        if (res.result === "win") playWin();
        else if (res.result === "loss") playLose();
        else playTie();

        if (res.final) {
          const fin = res.final;
          later(() => {
            setFinalData(fin);
            updateRecord(fin.outcome);
            setPhase("result");
            throwLock.current = false;
          }, IMPACT_HOLD_MS);
        } else {
          later(() => {
            setRoundNum((n) => n + 1);
            setBeat("banner");
            later(() => { setBeat("armed"); throwLock.current = false; }, BANNER_MS);
          }, IMPACT_HOLD_MS);
        }
      }, wait);
    },
    [matchId, beat, later, updateRecord],
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
      <style>{KEYFRAMES}</style>
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
          <Lobby record={record} busy={busy} error={error} onStart={startMatch} />
        )}
        {phase === "vs" && <VsSting pet={pet} />}
        {phase === "match" && (
          <MatchStage
            pet={pet}
            score={score}
            roundNum={roundNum}
            beat={beat}
            chantIdx={chantIdx}
            lastRound={lastRound}
            matchStreak={matchStreak}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "riseIn 0.35s ease both" }}>
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
            animation: "idleBob 3.2s ease-in-out infinite",
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
          background: busy ? "rgba(251,191,36,0.4)" : `linear-gradient(180deg, ${RIM}, #f59e0b)`,
          color: "#04001a",
          border: "none",
          borderRadius: 18,
          padding: "18px 0",
          fontSize: 18,
          fontWeight: 900,
          letterSpacing: "0.06em",
          cursor: busy ? "wait" : "pointer",
          animation: busy ? "none" : "glowPulse 2.2s ease-in-out infinite",
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
      <div style={{ textAlign: "center", animation: "slamL 0.5s cubic-bezier(0.22,1.4,0.36,1) both" }}>
        <img src={pet.src} alt={pet.name} style={{ width: 130, height: 130, objectFit: "contain", filter: `drop-shadow(0 0 24px ${pet.color}88)` }} />
        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>YOU</div>
      </div>
      <div
        style={{
          fontSize: 48,
          fontWeight: 900,
          color: RIM,
          textShadow: `0 0 30px ${RIM}aa`,
          animation: "vsPop 0.6s 0.45s cubic-bezier(0.22,1.6,0.36,1) both",
        }}
      >
        VS
      </div>
      <div style={{ textAlign: "center", animation: "slamR 0.5s cubic-bezier(0.22,1.4,0.36,1) both" }}>
        <img src={MARKOV_ART} alt="MARKOV" style={{ width: 130, height: 130, objectFit: "contain", filter: `drop-shadow(0 0 24px ${RIM}88)` }} />
        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>MARKOV</div>
      </div>
    </div>
  );
}

// ═══ Match stage ══════════════════════════════════════════════════════════════
function MatchStage({
  pet, score, roundNum, beat, chantIdx, lastRound, matchStreak, onThrow,
}: {
  pet: PetStage;
  score: { player: number; ai: number; ties: number };
  roundNum: number;
  beat: RoundBeat;
  chantIdx: number;
  lastRound: RoundResult | null;
  matchStreak: number;
  onThrow: (m: number) => void;
}) {
  const armed = beat === "armed";
  const impact = beat === "impact" && lastRound;
  const playerWonRound = impact && lastRound!.result === "win";
  const aiWonRound = impact && lastRound!.result === "loss";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: impact ? "screenShake 0.35s ease" : undefined }}>
      {/* impact flash overlay */}
      {impact && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            pointerEvents: "none",
            background:
              lastRound!.result === "win"
                ? "radial-gradient(circle, rgba(134,239,172,0.55), transparent 65%)"
                : lastRound!.result === "loss"
                  ? "radial-gradient(circle, rgba(252,165,165,0.5), transparent 65%)"
                  : "radial-gradient(circle, rgba(255,255,255,0.5), transparent 65%)",
            animation: "impactFlash 0.5s ease-out both",
          }}
        />
      )}

      {/* score pips */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <ScorePips label="YOU" color={pet.color} count={score.player} align="left" />
        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(220,210,255,0.6)", letterSpacing: "0.1em" }}>
          ROUND {Math.min(roundNum, 9)}
        </div>
        <ScorePips label="MARKOV" color={RIM} count={score.ai} align="right" />
      </div>

      {/* THE STAGE — combatants always present */}
      <div
        style={{
          position: "relative",
          minHeight: 300,
          borderRadius: 22,
          background: "linear-gradient(180deg, rgba(8,2,32,0.55) 0%, rgba(15,8,44,0.85) 100%)",
          border: "1px solid rgba(255,255,255,0.1)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        {/* arena floor glow */}
        <div aria-hidden style={{ position: "absolute", left: "10%", right: "10%", bottom: 18, height: 26, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(167,139,250,0.28), transparent 70%)", filter: "blur(4px)" }} />

        {/* round banner sweep */}
        {beat === "banner" && (
          <div
            style={{
              position: "absolute",
              top: "42%",
              left: 0,
              right: 0,
              textAlign: "center",
              zIndex: 5,
              animation: `bannerSweep ${BANNER_MS}ms cubic-bezier(0.4,0,0.2,1) both`,
            }}
          >
            <span
              style={{
                display: "inline-block",
                background: `linear-gradient(90deg, transparent, ${RIM}33 20%, ${RIM}55 50%, ${RIM}33 80%, transparent)`,
                padding: "10px 46px",
                fontSize: 26,
                fontWeight: 900,
                letterSpacing: "0.18em",
                color: "#fff",
                textShadow: `0 0 24px ${RIM}`,
              }}
            >
              ROUND {roundNum}
            </span>
          </div>
        )}

        {/* combatants row */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "18px 26px 30px", position: "relative", zIndex: 2 }}>
          {/* player side */}
          <div style={{ textAlign: "center", width: 120 }}>
            <img
              src={pet.src}
              alt="you"
              style={{
                width: 96,
                height: 96,
                objectFit: "contain",
                filter: `drop-shadow(0 0 18px ${pet.color}66)`,
                animation: playerWonRound
                  ? "winnerBounce 0.7s cubic-bezier(0.22,1.4,0.36,1)"
                  : aiWonRound
                    ? "loserDim 0.5s ease both"
                    : "idleBob 2.6s ease-in-out infinite",
              }}
            />
            {/* fist / thrown move */}
            <div style={{ height: 62, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {beat === "shaking" ? (
                <span style={{ fontSize: 46, display: "inline-block", animation: "fistPump 0.35s ease-in-out 3" }}>✊</span>
              ) : impact ? (
                <span style={{ fontSize: 52, display: "inline-block", animation: "moveSlam 0.45s cubic-bezier(0.22,1.3,0.36,1) both" }}>
                  {MOVES[lastRound!.playerMove]!.emoji}
                </span>
              ) : (
                <span style={{ fontSize: 40, opacity: 0.4 }}>✊</span>
              )}
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(220,210,255,0.6)" }}>YOU</div>
          </div>

          {/* center column: chant / verdict */}
          <div style={{ flex: 1, textAlign: "center", alignSelf: "center", minHeight: 90, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {beat === "shaking" && (
              <div
                key={chantIdx}
                style={{
                  fontSize: 24,
                  fontWeight: 900,
                  letterSpacing: "0.14em",
                  color: chantIdx === 2 ? RIM : "rgba(237,233,254,0.9)",
                  textShadow: chantIdx === 2 ? `0 0 22px ${RIM}` : "none",
                  animation: "chantPop 0.3s cubic-bezier(0.22,1.5,0.36,1) both",
                }}
              >
                {CHANT[chantIdx]}
              </div>
            )}
            {impact && (
              <>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 900,
                    letterSpacing: "0.06em",
                    color: lastRound!.result === "win" ? "#86efac" : lastRound!.result === "loss" ? "#fca5a5" : "#c4b5fd",
                    textShadow: "0 0 22px currentColor",
                    animation: "resultPunch 0.5s cubic-bezier(0.22,1.4,0.36,1) both",
                  }}
                >
                  {lastRound!.result === "win" ? "YOU TAKE IT!" : lastRound!.result === "loss" ? "MARKOV TAKES IT" : "TIE"}
                </div>
                <div
                  style={{
                    background: "rgba(0,0,0,0.55)",
                    border: "1px solid rgba(251,191,36,0.35)",
                    borderRadius: 12,
                    padding: "7px 13px",
                    fontSize: 12,
                    fontStyle: "italic",
                    color: "rgba(240,230,255,0.92)",
                    maxWidth: 230,
                    animation: "linePop 0.35s 0.3s ease both",
                  }}
                >
                  “{lastRound!.markovLine}”
                </div>
              </>
            )}
            {armed && (
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(220,210,255,0.75)", animation: "chantPop 0.3s ease both" }}>
                PICK YOUR THROW ⚡
              </div>
            )}
            {matchStreak >= 2 && !impact && (
              <div style={{ fontSize: 13, fontWeight: 900, color: "#fb923c", animation: "streakFlame 0.9s ease-in-out infinite" }}>
                🔥 {matchStreak} ROUND STREAK
              </div>
            )}
          </div>

          {/* MARKOV side */}
          <div style={{ textAlign: "center", width: 120 }}>
            <img
              src={MARKOV_ART}
              alt="MARKOV"
              style={{
                width: 96,
                height: 96,
                objectFit: "contain",
                filter: `drop-shadow(0 0 18px ${RIM}66)`,
                animation: aiWonRound
                  ? "winnerBounce 0.7s cubic-bezier(0.22,1.4,0.36,1)"
                  : playerWonRound
                    ? "loserDim 0.5s ease both"
                    : "idleBobAlt 2.6s ease-in-out infinite",
              }}
            />
            <div style={{ height: 62, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {beat === "shaking" ? (
                <span style={{ fontSize: 46, display: "inline-block", transform: "scaleX(-1)", animation: "fistPump 0.35s ease-in-out 3" }}>✊</span>
              ) : impact ? (
                <span style={{ fontSize: 52, display: "inline-block", animation: "moveSlam 0.45s 0.08s cubic-bezier(0.22,1.3,0.36,1) both" }}>
                  {MOVES[lastRound!.aiMove]!.emoji}
                </span>
              ) : (
                <span style={{ fontSize: 40, opacity: 0.4, transform: "scaleX(-1)", display: "inline-block" }}>✊</span>
              )}
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(220,210,255,0.6)" }}>MARKOV</div>
          </div>
        </div>
      </div>

      {/* move buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        {MOVES.map((m) => (
          <button
            key={m.id}
            onClick={() => onThrow(m.id)}
            disabled={!armed}
            style={{
              flex: 1,
              background: armed ? "rgba(15,11,38,0.92)" : "rgba(30,20,60,0.55)",
              border: `1px solid ${armed ? "rgba(167,139,250,0.5)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 18,
              padding: "16px 0 12px",
              cursor: armed ? "pointer" : "default",
              opacity: armed ? 1 : 0.5,
              transform: "scale(1)",
              transition: "transform 0.12s cubic-bezier(0.22,1.4,0.36,1), opacity 0.2s ease",
            }}
            onMouseDown={(e) => { if (armed) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.92)"; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
          >
            <div style={{ fontSize: 36 }}>{m.emoji}</div>
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
            key={`${i}-${i < count ? "on" : "off"}`}
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: i < count ? color : "rgba(255,255,255,0.1)",
              boxShadow: i < count ? `0 0 10px ${color}88` : "none",
              animation: i === count - 1 ? "pipPop 0.45s cubic-bezier(0.22,1.5,0.36,1)" : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ═══ Result stage ═════════════════════════════════════════════════════════════
const CONFETTI_COLORS = ["#fbbf24", "#a78bfa", "#22c55e", "#38bdf8", "#fb7185", "#f59e0b"];

function Confetti() {
  // 26 deterministic pieces — indexes drive position/timing so SSR + client agree.
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 30, overflow: "hidden" }}>
      {Array.from({ length: 26 }, (_, i) => {
        const left = (i * 37) % 100;
        const delay = (i % 9) * 0.14;
        const dur = 2.4 + ((i * 13) % 10) / 6;
        const size = 7 + ((i * 7) % 8);
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              top: 0,
              left: `${left}%`,
              width: size,
              height: size * 0.45,
              borderRadius: 2,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              animation: `confettiFall ${dur}s ${delay}s linear both`,
            }}
          />
        );
      })}
    </div>
  );
}

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
    <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "riseIn 0.4s ease both" }}>
      {won && <Confetti />}

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
          style={{
            width: 110,
            height: 110,
            objectFit: "contain",
            filter: `drop-shadow(0 0 26px ${won ? pet.color : RIM}77)`,
            animation: "winnerBounce 0.9s 0.15s cubic-bezier(0.22,1.4,0.36,1)",
          }}
        />
        <div
          style={{
            fontSize: 32,
            fontWeight: 900,
            marginTop: 8,
            color: won ? "#86efac" : tied ? "#c4b5fd" : "#fca5a5",
            textShadow: "0 0 26px currentColor",
            animation: "resultPunch 0.55s 0.1s cubic-bezier(0.22,1.4,0.36,1) both",
          }}
        >
          {won ? "VICTORY!" : tied ? "DEAD EVEN" : "MARKOV WINS"}
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
            animation: "linePop 0.4s 0.5s ease both",
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
            animation: "riseIn 0.45s 0.25s ease both",
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
          animation: "riseIn 0.45s 0.35s ease both",
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
      <div style={{ display: "flex", gap: 10, animation: "riseIn 0.45s 0.4s ease both" }}>
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
            animation: "glowPulse 2.2s ease-in-out infinite",
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
