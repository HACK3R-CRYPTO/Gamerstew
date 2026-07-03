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
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { renderArenaShareCard, canNativeShare, nativeShareCard, downloadCard } from "@/lib/arenaShareCard";
import { startWaapiFallback } from "@/lib/waapiFallback";
import {
  playFightSlam, playWin, playLose, playTie,
  playFistPump, playChantTick, playRevealSlam,
  playRoundWin, playRoundLose, playRoundTie,
  playCalledIt, playSuddenDeath, playWhooshIn,
} from "@/hooks/useAppAudio";
import { useWriteContract, useSignTypedData } from "wagmi";
import { parseEther, parseSignature } from "viem";
import { startArenaMatch, throwArenaMove, getArenaLadder, purchaseArenaRefill, purchaseArenaRefillGasless, type RoundResult, type LadderData, type RefillOffer } from "@/app/actions/arena";

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

// ─── app design tokens (in sync with /games, /dashboard, leaderboards) ──────
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};
// Challenge AI's identity from the games hub card: deep green + #22c55e glow
const AI_GREEN = "#22c55e";

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


export default function ChallengeAiPage() {
  useRequireAuth();
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
    getArenaLadder(address).then((l) => {
      if (l.error) return;
      setLadder(l);
      // Counter on lobby entry — don't wait for the first match to start.
      if (typeof l.remainingToday === "number") setRemaining(l.remainingToday);
    }).catch(() => {});
  }, [phase, address]);

  // Desktop breakpoint · same 900px rule as /games and the leaderboards,
  // so AppBottomNav renders its wide (docked-rail) variant on web.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Daily limit + refill purchase state
  const [remaining, setRemaining] = useState<number | null>(null);
  const [refillOffer, setRefillOffer] = useState<RefillOffer | null>(null);
  const [buying, setBuying] = useState(false);
  const { writeContractAsync } = useWriteContract();

  const { signTypedDataAsync } = useSignTypedData();

  const buyRefill = useCallback(async () => {
    if (!address || !refillOffer || buying) return;
    setBuying(true);
    setError(null);
    try {
      let granted: { ok?: boolean; remaining?: number } = {};

      if (refillOffer.relayer && refillOffer.permitNonce !== null && refillOffer.permitNonce !== undefined) {
        // Gasless path (preferred): sign an EIP-2612 permit — one signature,
        // zero gas, zero CELO. The backend relays and pays. Domain verified
        // on-chain: GoodDollar / 1 / 42220.
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const signature = await signTypedDataAsync({
          domain: {
            name: "GoodDollar",
            version: "1",
            chainId: 42220,
            verifyingContract: refillOffer.gToken as `0x${string}`,
          },
          types: {
            Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "Permit",
          message: {
            owner: address,
            spender: refillOffer.relayer as `0x${string}`,
            value: parseEther(String(refillOffer.priceGs)),
            nonce: BigInt(refillOffer.permitNonce),
            deadline,
          },
        });
        const { v, r, s } = parseSignature(signature);
        granted = await purchaseArenaRefillGasless(address, {
          deadline: deadline.toString(), v: Number(v), r, s,
        });
      } else {
        // Direct-transfer fallback: player sends the G$ themselves (needs a
        // little gas · MiniPay covers it via the fee-currency adapter).
        const txHash = await writeContractAsync({
          address: refillOffer.gToken as `0x${string}`,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [refillOffer.poolWallet as `0x${string}`, parseEther(String(refillOffer.priceGs))],
        });
        granted = await purchaseArenaRefill(address, txHash);
      }

      if (granted.ok) {
        setRefillOffer(null);
        setRemaining(granted.remaining ?? null);
        toast.success(
          `🎟 +5 matches added${typeof granted.remaining === "number" ? ` · ${granted.remaining} left today` : ""}`,
          { duration: 4000 },
        );
      } else {
        setError("Payment sent but not verified yet · try Start again in a few seconds");
      }
    } catch {
      setError("Purchase cancelled");
    }
    setBuying(false);
  }, [address, refillOffer, buying, writeContractAsync, signTypedDataAsync]);

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
      // Chant + pump are one audiovisual beat: word pops as the fists rise.
      setChantIdx(0); playChantTick(0); playFistPump();
      later(() => { setChantIdx(1); playChantTick(1); playFistPump(); }, 350);
      later(() => { setChantIdx(2); playChantTick(2); playFistPump(); }, 700);

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
        // Impact = slam first (the physical hit), stinger rides on top a
        // beat later (the emotional read), CALLED IT stabs last if the
        // model predicted the throw. Layered, not simultaneous — mixes
        // clean and reads as cause → effect.
        playRevealSlam();
        later(() => {
          if (res.result === "win") playRoundWin();
          else if (res.result === "loss") playRoundLose();
          else playRoundTie();
        }, 120);
        if (res.called) later(() => playCalledIt(), 300);

        if (res.final) {
          const fin = res.final;
          later(() => {
            setFinalData(fin);
            updateRecord(fin.outcome);
            setPhase("result");
            // Match-end fanfare — the big stingers stay reserved for this.
            if (fin.outcome === "player_won") playWin();
            else if (fin.outcome === "ai_won") playLose();
            else playTie();
            throwLock.current = false;
          }, IMPACT_HOLD_MS);
        } else {
          later(() => {
            setRoundNum((n) => n + 1);
            setBeat("banner");
            // Banner sweep whoosh · sudden death gets the ominous sting.
            if (res.suddenDeath) playSuddenDeath();
            else playWhooshIn();
            later(() => { setBeat("armed"); throwLock.current = false; }, BANNER_MS);
          }, IMPACT_HOLD_MS);
        }
      }, wait);
    },
    [matchId, beat, later, updateRecord],
  );

  // WAAPI fallback: devices where CSS animations are suppressed (iOS
  // Reduce Motion, content blockers - see /animtest) get the same
  // animations replayed through element.animate(). No-op elsewhere.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rootRef.current) return;
    return startWaapiFallback(rootRef.current);
  }, []);

  const inMatch = phase === "vs" || phase === "match";

  return (
    <div
      ref={rootRef}
      style={{
        minHeight: "100dvh",
        background: T.bg,
        color: T.ink,
        fontFamily: T.body,
        position: "relative",
        overflow: "hidden",
      }}
    >

      {/* App shell on browse screens · fullscreen immersion during the fight */}
      {!inMatch && <AppHeader />}

      {/* match-phase header: quit + format badge */}
      {inMatch && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", position: "relative", zIndex: 2 }}>
          <button
            onClick={() => setPhase("lobby")}
            style={{
              background: "rgba(0,0,0,0.45)", border: `1px solid ${T.hairline}`,
              color: T.inkDim, borderRadius: 999, padding: "7px 14px",
              fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: T.body,
            }}
          >
            ← Quit match
          </button>
          <div style={{ background: "rgba(34,197,94,0.12)", border: `1px solid ${AI_GREEN}55`, color: "#86efac", borderRadius: 999, padding: "6px 14px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", fontFamily: T.body }}>
            BEST OF 5
          </div>
        </div>
      )}

      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          padding: inMatch ? "8px 16px 40px" : "12px 16px 110px",
          position: "relative",
          zIndex: 2,
        }}
      >
        {phase === "lobby" && (
          <Lobby
            pet={pet}
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

      {!inMatch && <AppBottomNav wide={isDesktop} />}
    </div>
  );
}

// ═══ Lobby ════════════════════════════════════════════════════════════════════
function Lobby({
  pet, record, busy, error, onStart, ladder, myAddress, remaining, refillOffer, buying, onBuyRefill,
}: {
  pet: PetStage;
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
  // Rotating taunt · MARKOV talks at the gate like a boss NPC.
  const TAUNTS = [
    "bring your best pattern. i've already modeled it.",
    "humans open with rock 41% of the time. just saying.",
    "i remember every throw you've ever made.",
    "the ladder resets. my memory doesn't.",
    "you're not random. nobody is.",
  ];
  const [tauntIdx, setTauntIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTauntIdx((i) => (i + 1) % TAUNTS.length), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myRank = ladder?.me?.rank ?? (ladder && myAddress ? ladder.top.find((e) => e.wallet === myAddress.toLowerCase())?.rank : undefined);
  const myPts = ladder?.me?.points ?? (ladder && myAddress ? ladder.top.find((e) => e.wallet === myAddress.toLowerCase())?.points : undefined);
  const leader = ladder?.top?.[0];

  return (
    <div
      style={{
        // Full scene: fills the viewport between AppHeader and bottom nav.
        minHeight: "calc(100dvh - 230px)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        animation: "riseIn 0.35s ease both",
      }}
    >
      {/* ambient floating game icons · same texture as /home */}
      {[
        { src: "/splash_screen_icons/dice.png", top: "4%", left: -18, size: 84, rot: -18, glow: "#c026d3", delay: 0 },
        { src: "/splash_screen_icons/joystick.png", top: "30%", right: -14, size: 74, rot: 14, glow: "#06b6d4", delay: 1.2 },
        { src: "/splash_screen_icons/gamepad.png", top: "58%", left: -10, size: 64, rot: -8, glow: "#a78bfa", delay: 2.0 },
      ].map((ic, i) => (
        <img
          key={i}
          src={ic.src}
          alt=""
          aria-hidden
          style={{
            position: "absolute", top: ic.top, left: ic.left as number | undefined, right: (ic as { right?: number }).right,
            width: ic.size, opacity: 0.13, pointerEvents: "none",
            ["--rot" as string]: `${ic.rot}deg`,
            animation: `iconDrift ${4.5 + i}s ease-in-out ${ic.delay}s infinite`,
            zIndex: 0,
          }}
        />
      ))}

      {/* top chips row: record + ladder rank · info ON the scene, not cards */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, position: "relative", zIndex: 2 }}>
        {/* this week's record · same source of truth as the ladder */}
        {(() => {
          const mine = ladder?.me ?? (ladder && myAddress ? ladder.top.find((e) => e.wallet === myAddress.toLowerCase()) : undefined);
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999, background: "rgba(0,0,0,0.4)", border: `1px solid ${T.hairline}`, fontFamily: T.body, fontSize: 11, fontWeight: 800 }}>
              <span style={{ color: T.inkSoft, letterSpacing: "0.06em" }}>WEEK</span>
              <span style={{ color: "#86efac" }}>{mine?.wins ?? 0}W</span>
              <span style={{ color: T.inkDim }}>{mine?.matches ?? 0} played</span>
              {record.streak > 1 && <span style={{ color: RIM }}>⚡{record.streak}</span>}
            </span>
          );
        })()}

        {/* match tickets · the energy counter, always visible */}
        {remaining !== null && (
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "6px 13px", borderRadius: 999,
              background: remaining === 0 ? "rgba(239,68,68,0.18)" : "rgba(0,0,0,0.4)",
              border: `1px solid ${remaining === 0 ? "rgba(239,68,68,0.6)" : remaining <= 2 ? "rgba(251,191,36,0.55)" : T.hairline}`,
              fontFamily: T.display, fontSize: 12.5, letterSpacing: "0.04em",
              color: remaining === 0 ? "#fca5a5" : remaining <= 2 ? RIM : "#fff",
            }}
          >
            🎟 {remaining === 0 ? "NO MATCHES" : remaining}
          </span>
        )}
        <Link href="/games/challenge-ai/leaderboard" style={{ textDecoration: "none" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, background: "rgba(0,0,0,0.4)", border: `1px solid ${myRank === 1 ? "rgba(251,191,36,0.5)" : T.hairline}`, fontFamily: T.body, fontSize: 11, fontWeight: 800, color: T.inkDim, cursor: "pointer" }}>
            🏆 {myRank ? (myRank === 1 ? <span style={{ color: RIM }}>#1 · {myPts} pts</span> : `#${myRank} · ${myPts} pts`) : leader ? `${leader.wallet.slice(0, 4)}… leads` : "Weekly ladder"}
            <span style={{ color: T.inkSoft }}>›</span>
          </span>
        </Link>
      </div>

      {/* THE STAGE · MARKOV owns the center */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1, padding: "10px 0 0" }}>
        {/* speech bubble */}
        <div
          key={tauntIdx}
          style={{
            maxWidth: 270,
            background: "rgba(0,0,0,0.6)",
            border: "1px solid rgba(251,191,36,0.4)",
            borderRadius: 14,
            padding: "9px 14px",
            fontFamily: T.body,
            fontSize: 12.5,
            fontStyle: "italic",
            color: "rgba(240,230,255,0.92)",
            textAlign: "center",
            animation: "bubblePop 0.4s cubic-bezier(0.22,1.4,0.36,1) both",
            position: "relative",
            marginBottom: 6,
          }}
        >
          “{TAUNTS[tauntIdx]}”
          <span style={{ position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%) rotate(45deg)", width: 12, height: 12, background: "rgba(0,0,0,0.6)", borderRight: "1px solid rgba(251,191,36,0.4)", borderBottom: "1px solid rgba(251,191,36,0.4)" }} />
        </div>

        {/* MARKOV · the boss */}
        <img
          src={MARKOV_ART}
          alt="MARKOV"
          style={{
            width: "min(62vw, 250px)",
            height: "auto",
            objectFit: "contain",
            animation: "idleBob 3.2s ease-in-out infinite",
            position: "relative",
            zIndex: 1,
          }}
        />
        {/* stage floor glow */}
        <div aria-hidden style={{ width: "min(58vw, 240px)", height: 30, borderRadius: "50%", background: `radial-gradient(ellipse, ${AI_GREEN}44 0%, transparent 70%)`, filter: "blur(5px)", marginTop: -14, animation: "floorPulse 3.2s ease-in-out infinite" }} />

        {/* name plate */}
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <div style={{ fontFamily: T.display, fontSize: 26, color: "#fff", letterSpacing: "0.05em", textShadow: `0 0 24px ${RIM}66` }}>
            MARKOV
          </div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, fontWeight: 700, marginTop: 2 }}>
            Free · Best of 5 · it learns your patterns
          </div>
        </div>

        {/* your pet · you're in the scene too, facing the boss */}
        <img
          src={pet.src}
          alt={pet.name}
          style={{
            position: "absolute",
            bottom: -4,
            left: "6%",
            width: 74,
            height: 74,
            objectFit: "contain",
            transform: "scaleX(-1)",
            animation: "idleBobAlt 2.8s ease-in-out infinite",
            zIndex: 2,
          }}
        />
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 12, padding: "9px 14px", fontFamily: T.body, fontSize: 12, color: "#fca5a5", textAlign: "center", position: "relative", zIndex: 2, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {/* thumb zone · one giant action */}
      <div style={{ position: "relative", zIndex: 2, paddingTop: 8 }}>
        {refillOffer ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: T.display, fontSize: 14, color: RIM, letterSpacing: "0.03em" }}>OUT OF MATCHES FOR TODAY</div>
            <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim, fontWeight: 700, margin: "5px 0 8px" }}>
              🎟 0 left → pay {refillOffer.priceGs} G$ → play {refillOffer.grants} more right now
            </div>
            <div
              role="button"
              onClick={buying ? undefined : onBuyRefill}
              style={{ cursor: buying ? "wait" : "pointer", userSelect: "none", borderRadius: 18, background: "#052e16", paddingBottom: 6, boxShadow: "0 12px 26px -6px rgba(34,197,94,0.6), inset 0 -3px 8px rgba(0,0,0,0.4)" }}
            >
              <div style={{ borderRadius: "16px 16px 12px 12px", background: buying ? "rgba(34,197,94,0.45)" : "linear-gradient(160deg, #6ee76e 0%, #22c55e 50%, #15803d 100%)", padding: "16px 20px", position: "relative", overflow: "hidden", border: "2px solid rgba(255,255,255,0.4)", boxShadow: "inset 0 8px 18px rgba(255,255,255,0.6), inset 0 -4px 10px rgba(0,0,0,0.25)", textAlign: "center" }}>
                <div style={{ position: "absolute", top: 2, left: "4%", right: "4%", height: "48%", background: "linear-gradient(180deg, rgba(255,255,255,0.65) 0%, transparent 100%)", borderRadius: "14px 14px 60px 60px", pointerEvents: "none" }} />
                <span style={{ position: "relative", zIndex: 1, fontFamily: T.display, fontSize: 16, color: "#fff", letterSpacing: "0.04em", textShadow: "0 2px 4px rgba(0,0,0,0.45)" }}>
                  {buying ? "CONFIRMING ON CELO…" : `🎟 +${refillOffer.grants} MATCHES · ${refillOffer.priceGs} G$`}
                </span>
              </div>
            </div>
            <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, marginTop: 7 }}>
              Resets daily · G$ feeds the prize pool
            </div>
          </div>
        ) : (
          <>
            <div
              role="button"
              onClick={busy ? undefined : onStart}
              style={{ cursor: busy ? "wait" : "pointer", userSelect: "none", borderRadius: 18, background: "#052e16", paddingBottom: 6, boxShadow: "0 12px 26px -6px rgba(34,197,94,0.6), inset 0 -3px 8px rgba(0,0,0,0.4)", transition: "transform 0.15s cubic-bezier(0.34,1.56,0.64,1)" }}
              onMouseDown={(e) => { if (!busy) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97) translateY(3px)"; }}
              onMouseUp={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
            >
              <div style={{ borderRadius: "16px 16px 12px 12px", background: busy ? "rgba(34,197,94,0.45)" : "linear-gradient(160deg, #6ee76e 0%, #22c55e 50%, #15803d 100%)", padding: "18px 20px", position: "relative", overflow: "hidden", border: "2px solid rgba(255,255,255,0.4)", boxShadow: "inset 0 8px 18px rgba(255,255,255,0.6), inset 0 -4px 10px rgba(0,0,0,0.25)", textAlign: "center" }}>
                <div style={{ position: "absolute", top: 2, left: "4%", right: "4%", height: "48%", background: "linear-gradient(180deg, rgba(255,255,255,0.65) 0%, transparent 100%)", borderRadius: "14px 14px 60px 60px", pointerEvents: "none" }} />
                <div style={{ position: "absolute", top: 7, left: 14, width: 28, height: 10, background: "rgba(255,255,255,0.85)", borderRadius: "50%", filter: "blur(2px)", transform: "rotate(-14deg)", pointerEvents: "none" }} />
                <span style={{ position: "relative", zIndex: 1, fontFamily: T.display, fontSize: 19, color: "#fff", letterSpacing: "0.05em", textShadow: "0 2px 4px rgba(0,0,0,0.45)" }}>
                  {busy ? "SUMMONING MARKOV…" : "⚔️ FIGHT"}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 8, fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>
              <span>🔒 provably fair</span>
            </div>
          </>
        )}
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
                  {sudden ? "NEXT ROUND DECIDES IT 💀" : "PICK YOUR THROW ⚡"}
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
                    ⚡ {matchStreak} ROUND STREAK
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
                  <div style={{ animation: "handEnterL 0.25s ease-out both" }}>
                    <img src={FIST_ART} alt="" style={{ height: 110, display: "block", animation: "handPumpL 0.35s 0.25s ease-in-out infinite", willChange: "transform", transform: "translateZ(0)" }} />
                  </div>
                  <div style={{ animation: "handEnterR 0.25s ease-out both" }}>
                    <img src={FIST_ART} alt="" style={{ height: 110, display: "block", transform: "scaleX(-1) translateZ(0)", animation: "handPumpR 0.35s 0.25s ease-in-out infinite", willChange: "transform" }} />
                  </div>
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
  // Share preview modal state — show the card BEFORE sharing/saving.
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const closeShare = () => {
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    setShareUrl(null); setShareBlob(null);
  };

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

      {/* Share card · free forever — every shared win is an ad. Most
          prominent after a victory (that's the shareable moment); still
          available on losses (the "it read my mind" stat is share-bait too). */}
      <button
        onClick={async () => {
          const blob = await renderArenaShareCard({
            outcome: final.outcome,
            playerScore: score.player,
            aiScore: score.ai,
            calledCount: final.calledCount,
            totalRounds: final.totalRounds,
            favoriteMove: reveal?.favoriteMove ?? null,
            favoritePct: reveal?.favoritePct ?? null,
          });
          setShareBlob(blob);
          setShareUrl(URL.createObjectURL(blob));
        }}
        style={{
          background: won ? "rgba(134,239,172,0.1)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${won ? "rgba(134,239,172,0.45)" : "rgba(255,255,255,0.14)"}`,
          color: won ? "#86efac" : "rgba(220,210,255,0.8)",
          borderRadius: 14,
          padding: "12px 0",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.06em",
          cursor: "pointer",
          animation: "riseIn 0.45s 0.45s ease both",
        }}
      >
        📸 SHARE {won ? "YOUR WIN" : "THE MATCH"}
      </button>

      {/* Card preview modal · show-then-share */}
      {shareUrl && shareBlob && (
        <div
          onClick={closeShare}
          style={{
            position: "fixed", inset: 0, zIndex: 60,
            background: "rgba(4,0,26,0.85)", backdropFilter: "blur(6px)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: 20, gap: 14, animation: "arenaFadeIn 0.2s ease",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shareUrl}
            alt="Match card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(86vw, 420px)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.7)", animation: "riseIn 0.3s ease both" }}
          />
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 10, width: "min(86vw, 420px)" }}>
            <button
              onClick={async () => {
                if (canNativeShare()) {
                  const ok = await nativeShareCard(shareBlob);
                  if (ok) toast.success("Shared! ⚔️");
                } else {
                  downloadCard(shareBlob);
                  toast.success("Saved to your downloads 📸");
                }
              }}
              style={{
                flex: 2, background: "linear-gradient(180deg, #4ade80, #16a34a)", color: "#04160a",
                border: "none", borderRadius: 14, padding: "14px 0", fontSize: 14, fontWeight: 900,
                letterSpacing: "0.05em", cursor: "pointer",
              }}
            >
              {canNativeShare() ? "SHARE ›" : "⬇ SAVE IMAGE"}
            </button>
            <button
              onClick={closeShare}
              style={{
                flex: 1, background: "rgba(15,11,38,0.9)", border: "1px solid rgba(255,255,255,0.16)",
                color: "#ede9fe", borderRadius: 14, padding: "14px 0", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: "rgba(220,210,255,0.4)", textAlign: "center" }}>
        Record vs MARKOV: {record.w}W · {record.l}L · {record.t}T
        {record.streak > 1 ? ` · ⚡ ${record.streak} win streak` : ""}
      </div>
    </div>
  );
}
