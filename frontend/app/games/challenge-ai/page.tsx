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
import { useWriteContract } from "wagmi";
import { parseEther } from "viem";
import { startArenaMatch, throwArenaMove, getArenaLadder, purchaseArenaRefill, type RoundResult, type LadderData, type RefillOffer } from "@/app/actions/arena";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

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
  { id: 0, name: "ROCK",     art: "/games/challenge-ai-v2/moves/rock.png" },
  { id: 1, name: "PAPER",    art: "/games/challenge-ai-v2/moves/paper.png" },
  { id: 2, name: "SCISSORS", art: "/games/challenge-ai-v2/moves/scissors.png" },
] as const;
const FIST_ART = "/games/challenge-ai-v2/moves/fist.png";

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
@keyframes stampSlam { 0% { transform: scale(3) rotate(-18deg); opacity: 0 } 60% { transform: scale(0.9) rotate(-12deg); opacity: 1 } 100% { transform: scale(1) rotate(-12deg); opacity: 1 } }
@keyframes handEnterL { 0% { transform: translateX(-140px) scale(0.6); opacity: 0 } 100% { transform: translateX(0) scale(1); opacity: 1 } }
@keyframes handEnterR { 0% { transform: translateX(140px) scale(0.6) scaleX(-1); opacity: 0 } 100% { transform: translateX(0) scale(1) scaleX(-1); opacity: 1 } }
@keyframes handPumpL { 0%,100% { transform: translateY(0) rotate(0deg) } 45% { transform: translateY(-30px) rotate(-8deg) } 62% { transform: translateY(6px) rotate(2deg) } }
@keyframes handPumpR { 0%,100% { transform: scaleX(-1) translateY(0) rotate(0deg) } 45% { transform: scaleX(-1) translateY(-30px) rotate(8deg) } 62% { transform: scaleX(-1) translateY(6px) rotate(-2deg) } }
@keyframes clashL { 0% { transform: translateX(-90px) scale(1.5); opacity: 0 } 45% { transform: translateX(26px) scale(1.05); opacity: 1 } 65% { transform: translateX(-8px) scale(1) } 100% { transform: translateX(0) scale(1) } }
@keyframes clashR { 0% { transform: translateX(90px) scale(1.5) scaleX(-1); opacity: 0 } 45% { transform: translateX(-26px) scale(1.05) scaleX(-1); opacity: 1 } 65% { transform: translateX(8px) scaleX(-1) } 100% { transform: translateX(0) scaleX(-1) } }
@keyframes clashBurst { 0% { transform: scale(0.2); opacity: 1 } 100% { transform: scale(2.6); opacity: 0 } }
@keyframes readPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.55 } }
@keyframes dangerPulse { 0%,100% { box-shadow: inset 0 0 40px rgba(239,68,68,0.12) } 50% { box-shadow: inset 0 0 80px rgba(239,68,68,0.3) } }
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

  // Pet level from the games-backend (same source as simon/rhythm pages —
  // the Next app has no /api/user route, so this must hit BACKEND_URL).
  useEffect(() => {
    if (!address) return;
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    fetch(`${base}/api/user/${address}`)
      .then((r) => r.json())
      .then((d) => setPet(petForLevel(Number(d?.level) || 1)))
      .catch(() => {});
  }, [address]);

  // Weekly ladder — refreshed on lobby entry and after each match result.
  const [ladder, setLadder] = useState<LadderData | null>(null);
  useEffect(() => {
    if (phase !== "lobby" && phase !== "result") return;
    getArenaLadder(address).then((l) => { if (!l.error) setLadder(l); }).catch(() => {});
  }, [phase, address]);

  // Daily limit + refill purchase state
  const [remaining, setRemaining] = useState<number | null>(null);
  const [refillOffer, setRefillOffer] = useState<RefillOffer | null>(null);
  const [buying, setBuying] = useState(false);
  const { writeContractAsync } = useWriteContract();

  const buyRefill = useCallback(async () => {
    if (!address || !refillOffer || buying) return;
    setBuying(true);
    setError(null);
    try {
      // 1. Player sends the G$ transfer to the pool wallet from their own
      //    wallet — the spend IS the pool contribution, visible on-chain.
      const txHash = await writeContractAsync({
        address: refillOffer.gToken as `0x${string}`,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [refillOffer.poolWallet as `0x${string}`, parseEther(String(refillOffer.priceGs))],
      });
      // 2. Backend verifies the receipt on-chain and grants the matches.
      const granted = await purchaseArenaRefill(address, txHash);
      if (granted.ok) {
        setRefillOffer(null);
        setRemaining(granted.remaining ?? null);
      } else {
        setError("Payment sent but not verified yet · try Start again in a few seconds");
      }
    } catch {
      setError("Purchase cancelled");
    }
    setBuying(false);
  }, [address, refillOffer, buying, writeContractAsync]);

  // ─── Start a match ─────────────────────────────────────────────────────────
  const startMatch = useCallback(async () => {
    if (!address || busy) return;
    setBusy(true);
    setError(null);
    const res = await startArenaMatch(address);
    setBusy(false);
    if (res.error === "daily_limit" && res.refill) {
      setRefillOffer(res.refill);
      setRemaining(0);
      setPhase("lobby");
      return;
    }
    if (res.error || !res.matchId) {
      setError("MARKOV is unreachable · try again in a moment");
      setPhase("lobby");
      return;
    }
    if (typeof res.remainingToday === "number") setRemaining(res.remainingToday);
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
          <Lobby
            record={record}
            busy={busy}
            error={error}
            onStart={startMatch}
            ladder={ladder}
            myAddress={address}
            remaining={remaining}
            refillOffer={refillOffer}
            buying={buying}
            onBuyRefill={buyRefill}
          />
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
  record, busy, error, onStart, ladder, myAddress, remaining, refillOffer, buying, onBuyRefill,
}: {
  record: { w: number; l: number; t: number; streak: number };
  busy: boolean;
  error: string | null;
  onStart: () => void;
  ladder: LadderData | null;
  myAddress?: string;
  remaining: number | null;
  refillOffer: RefillOffer | null;
  buying: boolean;
  onBuyRefill: () => void;
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

      {/* weekly ladder — where matches turn into G$ */}
      {ladder && (
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(134,239,172,0.25)",
            background: "rgba(8,2,32,0.75)",
            padding: "14px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#86efac" }}>
              🏆 WEEKLY LADDER · {ladder.week.split("-")[1]}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 900, color: "#86efac", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)", borderRadius: 999, padding: "3px 10px" }}>
              {ladder.poolGs} G$ POOL
            </span>
          </div>
          {ladder.top.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "rgba(220,210,255,0.6)", textAlign: "center", padding: "6px 0" }}>
              Fresh week — first win tops the board. Pool pays Sunday.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ladder.top.slice(0, 5).map((e) => {
                const mine = myAddress && e.wallet === myAddress.toLowerCase();
                return (
                  <div
                    key={e.wallet}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 12.5,
                      padding: "5px 10px",
                      borderRadius: 10,
                      background: mine ? "rgba(251,191,36,0.12)" : "transparent",
                      border: mine ? "1px solid rgba(251,191,36,0.4)" : "1px solid transparent",
                    }}
                  >
                    <span style={{ width: 22, fontWeight: 900, color: e.rank === 1 ? RIM : "rgba(220,210,255,0.6)" }}>
                      {e.rank === 1 ? "👑" : `#${e.rank}`}
                    </span>
                    <span style={{ flex: 1, fontFamily: "monospace", color: mine ? RIM : "rgba(230,222,255,0.85)" }}>
                      {mine ? "YOU" : `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}`}
                    </span>
                    <span style={{ color: "rgba(220,210,255,0.55)", fontSize: 11.5 }}>{e.wins}W</span>
                    <span style={{ fontWeight: 900, color: "#86efac" }}>{e.points} pts</span>
                  </div>
                );
              })}
              {ladder.me && ladder.me.rank > 5 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "5px 10px", borderRadius: 10, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", marginTop: 2 }}>
                  <span style={{ width: 22, fontWeight: 900, color: "rgba(220,210,255,0.6)" }}>#{ladder.me.rank}</span>
                  <span style={{ flex: 1, fontFamily: "monospace", color: RIM }}>YOU</span>
                  <span style={{ color: "rgba(220,210,255,0.55)", fontSize: 11.5 }}>{ladder.me.wins}W</span>
                  <span style={{ fontWeight: 900, color: "#86efac" }}>{ladder.me.points} pts</span>
                </div>
              )}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "rgba(220,210,255,0.45)", marginTop: 8, textAlign: "center" }}>
            Win matches → earn points → top climbers split the pool every Sunday
          </div>
        </div>
      )}

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

      {refillOffer ? (
        // Out of free matches — the refill offer. The buy is a plain G$
        // transfer to the transparent pool wallet; spent G$ feeds the same
        // pool the ladder pays out on Sunday.
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(251,191,36,0.45)",
            background: "rgba(251,191,36,0.08)",
            padding: "16px 18px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 900, color: RIM }}>OUT OF FREE MATCHES TODAY</div>
          <div style={{ fontSize: 12.5, color: "rgba(230,222,255,0.8)", marginTop: 6, lineHeight: 1.6 }}>
            Fresh {`${refillOffer.grants}`} matches for <b style={{ color: "#86efac" }}>{refillOffer.priceGs} G$</b> —
            your G$ goes straight into this week's prize pool, not to us.
          </div>
          <button
            onClick={onBuyRefill}
            disabled={buying}
            style={{
              marginTop: 12,
              width: "100%",
              background: buying ? "rgba(34,197,94,0.4)" : "linear-gradient(180deg, #4ade80, #16a34a)",
              color: "#04160a",
              border: "none",
              borderRadius: 14,
              padding: "14px 0",
              fontSize: 15,
              fontWeight: 900,
              letterSpacing: "0.05em",
              cursor: buying ? "wait" : "pointer",
            }}
          >
            {buying ? "CONFIRMING ON CELO…" : `🎟 +${refillOffer.grants} MATCHES · ${refillOffer.priceGs} G$`}
          </button>
          <div style={{ fontSize: 10.5, color: "rgba(220,210,255,0.5)", marginTop: 8 }}>
            Or come back tomorrow — {`${10}`} free matches reset daily
          </div>
        </div>
      ) : (
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
      )}

      {remaining !== null && !refillOffer && (
        <div style={{ fontSize: 11.5, color: remaining <= 2 ? "#fca5a5" : "rgba(220,210,255,0.55)", textAlign: "center", fontWeight: 700 }}>
          {remaining} free {remaining === 1 ? "match" : "matches"} left today
        </div>
      )}

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
  // Read meter + sudden death derive from the latest server response.
  const readLevel = lastRound?.readLevel ?? 8;
  const sudden = !!lastRound?.suddenDeath && !lastRound?.final && beat !== "impact";
  const hint = !impact ? lastRound?.mindGame?.text : null;

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
        <div style={{ fontSize: 12, fontWeight: 800, color: sudden ? "#fca5a5" : "rgba(220,210,255,0.6)", letterSpacing: "0.1em", textShadow: sudden ? "0 0 14px #ef4444" : undefined }}>
          {sudden ? "FINAL ROUND" : `ROUND ${Math.min(roundNum, 9)}`}
        </div>
        <ScorePips label="MARKOV" color={RIM} count={score.ai} align="right" />
      </div>

      {/* MARKOV's read meter — the model's grip on you, visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", color: readLevel >= 60 ? "#fca5a5" : "rgba(220,210,255,0.5)", whiteSpace: "nowrap" }}>
          🧠 MARKOV'S READ
        </span>
        <div style={{ flex: 1, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${readLevel}%`,
              borderRadius: 999,
              background: readLevel >= 60
                ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                : `linear-gradient(90deg, ${RIM}, #f59e0b)`,
              boxShadow: readLevel >= 60 ? "0 0 12px rgba(239,68,68,0.7)" : `0 0 8px ${RIM}66`,
              transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)",
              animation: readLevel >= 75 ? "readPulse 1.1s ease-in-out infinite" : undefined,
            }}
          />
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 900, color: readLevel >= 60 ? "#fca5a5" : "rgba(220,210,255,0.6)", width: 34, textAlign: "right" }}>
          {readLevel}%
        </span>
      </div>

      {/* THE STAGE — combatants always present */}
      <div
        style={{
          position: "relative",
          minHeight: 300,
          borderRadius: 22,
          background: "linear-gradient(180deg, rgba(8,2,32,0.55) 0%, rgba(15,8,44,0.85) 100%)",
          border: `1px solid ${sudden ? "rgba(239,68,68,0.45)" : "rgba(255,255,255,0.1)"}`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          animation: sudden ? "dangerPulse 1.4s ease-in-out infinite" : undefined,
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
                background: sudden
                  ? "linear-gradient(90deg, transparent, rgba(239,68,68,0.25) 20%, rgba(239,68,68,0.45) 50%, rgba(239,68,68,0.25) 80%, transparent)"
                  : `linear-gradient(90deg, transparent, ${RIM}33 20%, ${RIM}55 50%, ${RIM}33 80%, transparent)`,
                padding: "10px 46px",
                fontSize: 26,
                fontWeight: 900,
                letterSpacing: "0.18em",
                color: "#fff",
                textShadow: sudden ? "0 0 26px #ef4444" : `0 0 24px ${RIM}`,
              }}
            >
              {sudden ? "⚔️ FINAL ROUND ⚔️" : `ROUND ${roundNum}`}
            </span>
          </div>
        )}

        {/* combatants — corners, watching the fight */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "14px 20px 22px", position: "relative", zIndex: 2 }}>
          <div style={{ textAlign: "center", width: 104 }}>
            <img
              src={pet.src}
              alt="you"
              style={{
                width: 88,
                height: 88,
                objectFit: "contain",
                filter: `drop-shadow(0 0 18px ${pet.color}66)`,
                animation: playerWonRound
                  ? "winnerBounce 0.7s cubic-bezier(0.22,1.4,0.36,1)"
                  : aiWonRound
                    ? "loserDim 0.5s ease both"
                    : "idleBob 2.6s ease-in-out infinite",
              }}
            />
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(220,210,255,0.6)" }}>YOU</div>
          </div>

          {/* center: armed-state prompts only — the clash overlay owns shake/impact */}
          <div style={{ flex: 1, textAlign: "center", alignSelf: "center", minHeight: 90, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {armed && (
              <>
                <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", color: sudden ? "#fca5a5" : "rgba(220,210,255,0.75)", animation: "chantPop 0.3s ease both" }}>
                  {sudden ? "WINNER TAKES ALL 💀" : "PICK YOUR THROW ⚡"}
                </div>
                {hint && (
                  <div
                    style={{
                      background: "rgba(0,0,0,0.55)",
                      border: "1px dashed rgba(251,191,36,0.5)",
                      borderRadius: 12,
                      padding: "6px 12px",
                      fontSize: 11.5,
                      fontStyle: "italic",
                      color: RIM,
                      maxWidth: 230,
                      animation: "linePop 0.35s 0.15s ease both",
                    }}
                  >
                    MARKOV: “{hint}” <span style={{ color: "rgba(220,210,255,0.45)", fontStyle: "normal" }}>· truth or bluff?</span>
                  </div>
                )}
                {matchStreak >= 2 && (
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#fb923c", animation: "streakFlame 0.9s ease-in-out infinite" }}>
                    🔥 {matchStreak} ROUND STREAK
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ textAlign: "center", width: 104 }}>
            <img
              src={MARKOV_ART}
              alt="MARKOV"
              style={{
                width: 88,
                height: 88,
                objectFit: "contain",
                filter: `drop-shadow(0 0 18px ${RIM}66)`,
                animation: aiWonRound
                  ? "winnerBounce 0.7s cubic-bezier(0.22,1.4,0.36,1)"
                  : playerWonRound
                    ? "loserDim 0.5s ease both"
                    : "idleBobAlt 2.6s ease-in-out infinite",
              }}
            />
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: "rgba(220,210,255,0.6)" }}>MARKOV</div>
          </div>
        </div>

        {/* THE CLASH — Mortal Kombat center stage. Two big hands face off,
            pump in sync, then the thrown moves smash together mid-screen. */}
        {(beat === "shaking" || impact) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 3,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              pointerEvents: "none",
            }}
          >
            {/* chant above the hands */}
            {beat === "shaking" && (
              <div
                key={chantIdx}
                style={{
                  fontSize: 26,
                  fontWeight: 900,
                  letterSpacing: "0.16em",
                  color: chantIdx === 2 ? RIM : "rgba(237,233,254,0.95)",
                  textShadow: chantIdx === 2 ? `0 0 24px ${RIM}` : "0 2px 8px rgba(0,0,0,0.6)",
                  animation: "chantPop 0.3s cubic-bezier(0.22,1.5,0.36,1) both",
                }}
              >
                {CHANT[chantIdx]}
              </div>
            )}
            {impact && lastRound!.called && (
              <div
                style={{
                  border: "3px solid #ef4444",
                  color: "#fca5a5",
                  borderRadius: 8,
                  padding: "3px 12px",
                  fontSize: 13,
                  fontWeight: 900,
                  letterSpacing: "0.14em",
                  background: "rgba(239,68,68,0.2)",
                  textShadow: "0 0 12px #ef4444",
                  animation: "stampSlam 0.45s 0.2s cubic-bezier(0.22,1.3,0.36,1) both",
                }}
              >
                CALLED IT
              </div>
            )}

            {/* the hands / the clash */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: impact ? 4 : 26, position: "relative" }}>
              {impact && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 90,
                    height: 90,
                    marginLeft: -45,
                    marginTop: -45,
                    borderRadius: "50%",
                    background: `radial-gradient(circle, rgba(255,255,255,0.9) 0%, ${RIM}66 40%, transparent 70%)`,
                    animation: "clashBurst 0.5s 0.28s ease-out both",
                  }}
                />
              )}
              {beat === "shaking" ? (
                <>
                  <img src={FIST_ART} alt="" style={{ height: 110, filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.6))", animation: "handEnterL 0.25s ease-out both, handPumpL 0.35s 0.25s ease-in-out 3" }} />
                  <img src={FIST_ART} alt="" style={{ height: 110, filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.6))", animation: "handEnterR 0.25s ease-out both, handPumpR 0.35s 0.25s ease-in-out 3" }} />
                </>
              ) : (
                <>
                  <img src={MOVES[lastRound!.playerMove]!.art} alt={MOVES[lastRound!.playerMove]!.name} style={{ height: 118, filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.65))", animation: "clashL 0.5s cubic-bezier(0.22,1.2,0.36,1) both" }} />
                  <img src={MOVES[lastRound!.aiMove]!.art} alt={MOVES[lastRound!.aiMove]!.name} style={{ height: 118, filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.65))", animation: "clashR 0.5s cubic-bezier(0.22,1.2,0.36,1) both" }} />
                </>
              )}
            </div>

            {impact && (
              <>
                <div
                  style={{
                    fontSize: 25,
                    fontWeight: 900,
                    letterSpacing: "0.06em",
                    color: lastRound!.result === "win" ? "#86efac" : lastRound!.result === "loss" ? "#fca5a5" : "#c4b5fd",
                    textShadow: "0 0 22px currentColor, 0 2px 8px rgba(0,0,0,0.7)",
                    animation: "resultPunch 0.5s 0.25s cubic-bezier(0.22,1.4,0.36,1) both",
                  }}
                >
                  {lastRound!.result === "win" ? "YOU TAKE IT!" : lastRound!.result === "loss" ? "MARKOV TAKES IT" : "TIE"}
                </div>
                <div
                  style={{
                    background: "rgba(0,0,0,0.65)",
                    border: "1px solid rgba(251,191,36,0.35)",
                    borderRadius: 12,
                    padding: "7px 13px",
                    fontSize: 12,
                    fontStyle: "italic",
                    color: "rgba(240,230,255,0.92)",
                    maxWidth: 250,
                    animation: "linePop 0.35s 0.45s ease both",
                  }}
                >
                  “{lastRound!.markovLine}”
                </div>
              </>
            )}
          </div>
        )}
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
            <img src={m.art} alt={m.name} style={{ height: 44, filter: armed ? "drop-shadow(0 3px 8px rgba(0,0,0,0.5))" : "grayscale(0.5)" }} />
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
            {typeof final.calledCount === "number" && (final.calledCount ?? 0) > 0 && (
              <div style={{ marginBottom: 6 }}>
                MARKOV <b style={{ color: "#fca5a5" }}>called your exact throw {final.calledCount}×</b> in{" "}
                {final.totalRounds} rounds this match.
              </div>
            )}
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
