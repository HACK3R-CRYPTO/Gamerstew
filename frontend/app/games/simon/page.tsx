"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAudioSettings, effectiveGains } from "@/hooks/useAudioSettings";
import { playRankReveal, playSaveSuccess, playLevelUp, playAchievementChime } from "@/hooks/useAppAudio";
import { signScore, signScoreMiniPay, submitScore, submitScoreMiniPay } from "@/app/actions/game";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI, celoFeeSpread } from "@/lib/contracts";
import { hydrateAchievement } from "@/lib/achievements";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// ─── Pet stages (same data as rhythm — pet evolves with your level) ──────────
type PetStage = { id: string; name: string; src: string; minLevel: number; color: string };
const PET_STAGES: PetStage[] = [
  { id: "egg",     name: "Mystery Egg",   src: "/pets/stage-1-egg.png",     minLevel: 1,  color: "#e2e8f0" },
  { id: "baby",    name: "Baby Slime",    src: "/pets/stage-2-baby.png",    minLevel: 5,  color: "#22c55e" },
  { id: "teen",    name: "Teen Slime",    src: "/pets/stage-3-teen.png",    minLevel: 15, color: "#a78bfa" },
  { id: "crystal", name: "Crystal Slime", src: "/pets/stage-4-crystal.png", minLevel: 30, color: "#06b6d4" },
  { id: "king",    name: "King Slime",    src: "/pets/stage-5-king.png",    minLevel: 50, color: "#fbbf24" },
];
function petForLevel(level: number): PetStage {
  let stage = PET_STAGES[0];
  for (const s of PET_STAGES) if (level >= s.minLevel) stage = s;
  return stage;
}

// ─── Game constants ───────────────────────────────────────────────────────────
const BASE_FLASH = 500;   // ms — how long each sequence button stays lit
const BASE_DELAY = 700;   // ms — gap between sequence flashes
const MIN_FLASH  = 200;   // ms — floor on flash as rounds get long
const MIN_DELAY  = 350;   // ms — floor on gap
const BASE_SCORE = 10;    // points per cleared round
const BONUS_UNLOCK_ROUND = 5; // round at which the 5th (purple) button appears

// ─── V2 splash icons — ambient background ─────────────────────────────────────
const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";

const BG_ICONS = [
  { src: G, top: "4%",  left: "-16px", size: 100, dur: 4.4, delay: 0,   rotate: -12 },
  { src: D, top: "20%", right: "24px", size: 80,  dur: 5.0, delay: 0.5, rotate: 14  },
  { src: J, top: "44%", left: "26px",  size: 90,  dur: 4.8, delay: 1.1, rotate: -8  },
  { src: M, top: "62%", right: "-12px",size: 80,  dur: 5.6, delay: 0.3, rotate: 10  },
  { src: G, top: "76%", left: "-16px", size: 95,  dur: 5.0, delay: 1.7, rotate: -16 },
  { src: D, top: "90%", right: "32px", size: 72,  dur: 4.2, delay: 0.9, rotate: 20  },
];

// ─── Button palette — retro Simon colors styled in the V2 wall+face language ─
// Four base colors (each a C minor scale root note) + one purple bonus unlocked
// at round 5. Keeping classic Simon colors for instant recognition, rendered
// with V2's 3D button discipline so they match the app's visual identity.
type BtnTheme = {
  id: string;
  wall: string;
  face: string;
  glow: string;
  accent: string;
  freq: number;
};
const BASE_COLORS: BtnTheme[] = [
  { id: "red",    wall: "#5e0000", face: "linear-gradient(160deg, #fecaca 0%, #ef4444 50%, #991b1b 100%)", glow: "rgba(239,68,68,0.85)", accent: "#ef4444", freq: 261.63 }, // C4
  { id: "cyan",   wall: "#083a6b", face: "linear-gradient(160deg, #a5f3fc 0%, #06b6d4 50%, #155e75 100%)", glow: "rgba(6,182,212,0.85)", accent: "#06b6d4", freq: 329.63 }, // E4
  { id: "yellow", wall: "#5c3900", face: "linear-gradient(160deg, #fde68a 0%, #eab308 50%, #854d0e 100%)", glow: "rgba(234,179,8,0.85)",  accent: "#eab308", freq: 392.00 }, // G4
  { id: "green",  wall: "#013220", face: "linear-gradient(160deg, #86efac 0%, #10b981 50%, #14532d 100%)", glow: "rgba(16,185,129,0.85)", accent: "#10b981", freq: 523.25 }, // C5
];
const BONUS_COLOR: BtnTheme = {
  id: "purple", wall: "#3a005c",
  face: "linear-gradient(160deg, #e9d5ff 0%, #a855f7 50%, #6b21a8 100%)",
  glow: "rgba(168,85,247,0.9)", accent: "#a855f7", freq: 659.25, // E5
};
const ALL_COLORS: BtnTheme[] = [...BASE_COLORS, BONUS_COLOR];

// ─── Grades — same bands as rhythm for UI consistency ────────────────────────
function gradeFor(rounds: number) {
  if (rounds >= 15) return { letter: "S", color: "#fbbf24", desc: "LEGENDARY" };
  if (rounds >= 10) return { letter: "A", color: "#e2e8f0", desc: "EXCELLENT" };
  if (rounds >= 7)  return { letter: "B", color: "#67e8f9", desc: "GREAT" };
  if (rounds >= 4)  return { letter: "C", color: "#22c55e", desc: "GOOD" };
  return { letter: "D", color: "#f97316", desc: "KEEP PRACTICING" };
}

// ─── Page ──────────────────────────────────────────────────────────────────────
type Phase = "idle" | "countdown" | "showing" | "playing" | "finished";

// ─── Pet reaction event — shared by the page state + PetCompanion ─────────
// Correct = green bounce, Wrong = red wilt, Clear = gold sparkle, Bonus =
// rainbow celebration. Timestamp forces re-render/re-animate even when the
// same event type repeats (two correct taps in a row, for example).
type PetEvent = { type: "correct" | "wrong" | "clear" | "bonus"; ts: number };

export default function SimonGamePage() {
  const router = useRouter();
  const { address } = useAccount();
  // Mobile flag drives lighter-weight GPU effects on the Simon device.
  // Stacked 80/160/240px box-shadow blurs + triple drop-shadow filters
  // cause "Aww, snap!" renderer OOMs on low-end Android and the MiniPay
  // webview. Mobile gets slimmer shadows; desktop keeps the full drama.
  const isMobile = useIsMobile();
  const [phase, setPhase] = useState<Phase>("idle");

  // User audio preferences (same pattern as rhythm page)
  const audioSettings = useAudioSettings();
  const gainsRef = useRef(effectiveGains(audioSettings));
  useEffect(() => { gainsRef.current = effectiveGains(audioSettings); }, [audioSettings]);

  // Fetch player level so pet matches
  const [playerLevel, setPlayerLevel] = useState(1);
  useEffect(() => {
    if (!address) return;
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.json())
      .then(d => setPlayerLevel(d.level || 1))
      .catch(() => {});
  }, [address]);
  const pet = petForLevel(playerLevel);

  // ═══ Audio — Web Audio synth for tones + hit feedback ═══
  const audioCtxRef = useRef<AudioContext | null>(null);
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  }, []);

  // Bell-like tone used for both sequence reveal AND player taps. Rich
  // fundamental + 2nd harmonic for a pleasant pluck. Gated on the sfx setting.
  const playBell = useCallback((freq: number, volume = 0.22) => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const v = volume * gainsRef.current.sfx;
    if (v <= 0) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(v, now + 0.005);
    master.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    master.connect(ctx.destination);

    const o1 = ctx.createOscillator();
    o1.type = "sine"; o1.frequency.value = freq;
    o1.connect(master); o1.start(now); o1.stop(now + 0.45);

    const o2 = ctx.createOscillator();
    const o2Gain = ctx.createGain();
    o2Gain.gain.value = 0.3;
    o2.type = "triangle"; o2.frequency.value = freq * 2;
    o2.connect(o2Gain); o2Gain.connect(master);
    o2.start(now); o2.stop(now + 0.35);
  }, [getAudioCtx]);

  // Wrong-tap "buzz" — low sawtooth descending, clearly "bad"
  const playWrong = useCallback(() => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const v = 0.18 * gainsRef.current.music;
    if (v <= 0) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.35);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(v, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.42);
  }, [getAudioCtx]);

  // Haptic — gated on user's hapticsOn preference
  const haptic = useCallback((ms = 10) => {
    if (!audioSettings.hapticsOn) return;
    if ("vibrate" in navigator) navigator.vibrate(ms);
  }, [audioSettings.hapticsOn]);

  // ═══ Game state ═══
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [sequences, setSequences] = useState(0);        // cleared rounds
  const [bonusUnlocked, setBonusUnlocked] = useState(false);
  const [activeBtn, setActiveBtn] = useState<string | null>(null); // flashing button id
  const [tappedCount, setTappedCount] = useState(0);     // taps this round (for progress dots)
  const [isShowingSequence, setIsShowingSequence] = useState(false);
  const [roundFlash, setRoundFlash] = useState<string | null>(null);

  // Pet reaction events — drives the companion's bounce/wilt/celebrate states.
  // Timestamps let the component re-fire animations when the same event type
  // repeats back-to-back (e.g. two correct taps in a row).
  const [petEvent, setPetEvent] = useState<PetEvent | null>(null);
  const firePetEvent = useCallback((type: PetEvent["type"]) => {
    setPetEvent({ type, ts: performance.now() });
  }, []);

  // ─── Ambient starfield — cosmic atmosphere behind the device ─────────────
  // Lazily generated on mount so server and client render the same initial
  // empty array (no hydration mismatch from Math.random).
  type Star = { x: number; y: number; size: number; delay: number; dur: number; alpha: number };
  const [stars, setStars] = useState<Star[]>([]);
  useEffect(() => {
    // 44 animated dots on desktop; mobile gets 18 to cut the composite-
    // layer count and keep the phone cool. Each star runs an infinite
    // dot-pulse animation — at 44 that's 44 always-running GPU timers.
    const count = isMobile ? 18 : 44;
    setStars(Array.from({ length: count }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 1.6 + 0.6,
      delay: Math.random() * 4,
      dur: Math.random() * 3 + 2.5,
      alpha: Math.random() * 0.5 + 0.4,
    })));
  }, [isMobile]);

  const patternRef     = useRef<string[]>([]);       // sequence the player must match
  const userPatternRef = useRef<string[]>([]);       // what they've tapped so far this round
  const scoreRef       = useRef(0);
  const sequencesRef   = useRef(0);
  const colorsRef      = useRef<BtnTheme[]>(BASE_COLORS);
  const startTimeRef   = useRef(0);                  // wall-clock start (for speed bonus)
  const timeoutsRef    = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);
  useEffect(() => () => clearTimeouts(), [clearTimeouts]);

  // ═══ Score submission state (mirrors rhythm) ═══
  const submittedRef = useRef<boolean>(false);
  type SubmitResult = {
    rank?: number;
    xpEarned?: number;
    xp?: number;
    level?: number;
    leveledUp?: boolean;
    isNewPb?: boolean;
    prevBest?: number;
    newAchievements?: { id: string; name: string; icon?: string; desc?: string }[];
  };
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signingOnChain, setSigningOnChain] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [gameTimeMs, setGameTimeMs] = useState(0);

  const { getAccessToken, user } = usePrivy();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const isMiniPay = useIsMiniPay();
  const isEmbeddedWallet = user?.linkedAccounts?.some(
    (a: { type: string; walletClientType?: string }) =>
      a.type === "wallet" && a.walletClientType === "privy"
  );

  // ─── Timing helpers — flashes get faster each round (skill ceiling) ──────────
  const getFlashDur = (round: number) => Math.max(MIN_FLASH, BASE_FLASH - round * 30);
  const getSeqDelay = (round: number) => Math.max(MIN_DELAY, BASE_DELAY - round * 35);

  // ─── Flash a single button: light it up, play its tone, then unlight ────────
  const flashButton = useCallback((colorId: string, duration: number, onDone: (() => void) | null) => {
    const btn = ALL_COLORS.find(b => b.id === colorId);
    if (!btn) return;
    setActiveBtn(colorId);
    playBell(btn.freq, 0.22);
    const t = setTimeout(() => { setActiveBtn(null); onDone?.(); }, duration);
    timeoutsRef.current.push(t);
  }, [playBell]);

  // ─── Show the full sequence — flashes each color in order, then hands over ─
  const showSequence = useCallback((pattern: string[], round: number) => {
    setIsShowingSequence(true);
    userPatternRef.current = [];
    const flashDur = getFlashDur(round);
    const seqDelay = getSeqDelay(round);
    pattern.forEach((colorId, i) => {
      const t = setTimeout(() => flashButton(colorId, flashDur, null), i * seqDelay);
      timeoutsRef.current.push(t);
    });
    const doneAt = pattern.length * seqDelay + flashDur;
    const done = setTimeout(() => setIsShowingSequence(false), doneAt);
    timeoutsRef.current.push(done);
  }, [flashButton]);

  // ─── Append a new random color to the sequence, then show it ─────────────────
  const addNext = useCallback((current: string[]) => {
    const colors = colorsRef.current;
    const next   = colors[Math.floor(Math.random() * colors.length)].id;
    const newPat = [...current, next];
    patternRef.current = newPat;
    setTappedCount(0);  // reset progress dots for the new round
    const t = setTimeout(() => showSequence(newPat, newPat.length), 600);
    timeoutsRef.current.push(t);
  }, [showSequence]);

  // ─── Game over — dispatches the 3-step on-chain-gated score submission ─────
  const handleGameOver = useCallback(async (finalScore: number, gameTime: number) => {
    playWrong();
    firePetEvent("wrong");  // pet wilts — the run ended badly
    setPhase("finished");
    setIsShowingSequence(false);
    setActiveBtn(null);
    setGameTimeMs(gameTime);
    clearTimeouts();

    if (submittedRef.current) return;
    if (!address) return;
    submittedRef.current = true;

    const scoreToSubmit = Math.min(1_000_000, Math.max(0, Math.round(finalScore)));
    const clampedGameTime = Math.max(5000, gameTime);
    const baseScoreData = { game: "simon" as const, score: scoreToSubmit, gameTime: clampedGameTime };

    setSubmitting(true);
    setTxError(null);
    try {
      // ── STEP 1: backend voucher ──
      let sig:
        | { success: true; signature: string; nonce: string; gameType: number }
        | { success: false; error: string };
      let authToken: string | null = null;
      let miniPayMsg: string | null = null;
      let miniPaySig: string | null = null;

      if (isMiniPay) {
        miniPayMsg = `GameArena|simon|${scoreToSubmit}|${Date.now()}`;
        miniPaySig = await signMessageAsync({ message: miniPayMsg });
        sig = await signScoreMiniPay(address, miniPaySig, miniPayMsg, { game: "simon", score: scoreToSubmit });
      } else {
        authToken = await getAccessToken();
        if (!authToken) {
          setSubmitError("Not signed in — score not recorded");
          return;
        }
        sig = await signScore(authToken, address, { game: "simon", score: scoreToSubmit });
      }

      if (!sig.success) {
        setSubmitError(sig.error || "Voucher signing failed");
        return;
      }

      // ── STEP 2: on-chain tx — THE SIGNATURE GATE ──
      let txHash: string | null = null;
      setSigningOnChain(true);
      try {
        txHash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
          abi: GAME_PASS_ABI,
          functionName: "recordScoreWithBackendSig",
          args: [sig.gameType, BigInt(scoreToSubmit), BigInt(sig.nonce), sig.signature as `0x${string}`],
          ...(isEmbeddedWallet ? { gas: 300000n } : {}),
          // MiniPay pays network fees in USDC via Celo's fee-currency
          // adapter since the wallet holds no CELO.
          ...celoFeeSpread(isMiniPay),
        });
      } catch (err: unknown) {
        const e = err as {
          name?: string; code?: number;
          message?: string; shortMessage?: string; details?: string;
          cause?: { name?: string; code?: string; message?: string };
        };
        const name      = e?.name ?? "";
        const code      = e?.code ?? 0;
        const causeName = e?.cause?.name ?? "";
        const causeCode = e?.cause?.code ?? "";
        const msg       = (e?.message ?? e?.shortMessage ?? e?.details ?? e?.cause?.message ?? "").toLowerCase();
        const isRejected =
          name === "UserRejectedRequestError" || code === 4001 || code === -32003 ||
          causeName === "UserRejectedRequestError" ||
          causeCode === "policy_violation" ||
          msg.includes("user rejected") ||
          msg.includes("rejected the request") ||
          msg.includes("user denied");
        const isGasOrFunds =
          name === "InsufficientFundsError" || name === "EstimateGasExecutionError" ||
          code === -32000 || code === -32010 || causeCode === "insufficient_funds" ||
          msg.includes("insufficient funds") || msg.includes("insufficient balance") ||
          msg.includes("gas limit") || msg.includes("exceeds gas");
        if (isRejected)        setTxError("Transaction rejected — score not saved");
        else if (isGasOrFunds) setTxError("Insufficient CELO for gas — top up and try again");
        else                   setTxError("Transaction failed — score not saved");
        return;
      } finally {
        setSigningOnChain(false);
      }

      // ── STEP 3: save off-chain ──
      let result;
      const fullScoreData = { ...baseScoreData, txHash };
      if (isMiniPay && miniPaySig && miniPayMsg) {
        result = await submitScoreMiniPay(address, miniPaySig, miniPayMsg, fullScoreData);
      } else if (authToken) {
        result = await submitScore(authToken, address, fullScoreData);
      }

      if (result?.success) {
        setSubmitResult({
          rank: result.rank,
          xpEarned: result.xpEarned,
          xp: result.xp,
          level: result.level,
          leveledUp: result.leveledUp,
          isNewPb: result.isNewPb,
          prevBest: result.prevBest,
          newAchievements: result.newAchievements || [],
        });
      } else {
        setSubmitError(result?.error || "Score not recorded");
      }
    } catch {
      setSubmitError("Unexpected error — score not recorded");
    } finally {
      setSubmitting(false);
    }
  }, [playWrong, firePetEvent, clearTimeouts, address, isMiniPay, signMessageAsync, getAccessToken, writeContractAsync, isEmbeddedWallet]);

  // ─── Button click handler — validates against the pattern ────────────────────
  const handleButtonClick = useCallback((colorId: string) => {
    if (phase !== "playing" || isShowingSequence) return;
    const btn = ALL_COLORS.find(b => b.id === colorId);
    if (!btn) return;
    playBell(btn.freq, 0.24);
    haptic(8);
    setActiveBtn(colorId);
    setTimeout(() => setActiveBtn(null), 150);

    const newUserPat = [...userPatternRef.current, colorId];
    userPatternRef.current = newUserPat;
    const idx = newUserPat.length - 1;

    // Wrong tap → game over (pet wilts in handleGameOver)
    if (patternRef.current[idx] !== colorId) {
      handleGameOver(scoreRef.current, Date.now() - startTimeRef.current);
      return;
    }

    // Correct tap — update progress dots + pet cheers
    setTappedCount(newUserPat.length);
    firePetEvent("correct");

    // Completed the round → award points, unlock bonus at round 5, advance
    if (newUserPat.length === patternRef.current.length) {
      const newSeqs = sequencesRef.current + 1;
      sequencesRef.current = newSeqs;
      setSequences(newSeqs);
      const elapsed    = Date.now() - startTimeRef.current;
      const speedBonus = Math.max(0, Math.floor((60000 - elapsed) / 1000));
      const roundBonus = newSeqs * 2;
      const newScore   = newSeqs * BASE_SCORE + speedBonus + roundBonus;
      scoreRef.current = newScore;
      setScore(newScore);

      setRoundFlash(`ROUND ${newSeqs} CLEAR!`);
      setTimeout(() => setRoundFlash(null), 800);
      firePetEvent("clear");  // pet celebrates the round

      // Unlock the purple bonus button at round 5
      if (newSeqs === BONUS_UNLOCK_ROUND && !bonusUnlocked) {
        setBonusUnlocked(true);
        colorsRef.current = ALL_COLORS;
        setTimeout(() => setRoundFlash("5TH COLOR UNLOCKED!"), 900);
        setTimeout(() => setRoundFlash(null), 2100);
        setTimeout(() => firePetEvent("bonus"), 900);  // rainbow celebration
      }

      const t = setTimeout(() => addNext(patternRef.current), 700);
      timeoutsRef.current.push(t);
    }
  }, [phase, isShowingSequence, playBell, haptic, handleGameOver, addNext, bonusUnlocked, firePetEvent]);

  // ─── Countdown → showing → playing ───────────────────────────────────────────
  const startGame = useCallback(() => {
    // Reset everything for a fresh run
    patternRef.current = [];
    userPatternRef.current = [];
    scoreRef.current = 0;
    sequencesRef.current = 0;
    colorsRef.current = BASE_COLORS;
    submittedRef.current = false;
    setScore(0);
    setSequences(0);
    setTappedCount(0);
    setBonusUnlocked(false);
    setActiveBtn(null);
    setRoundFlash(null);
    setIsShowingSequence(false);
    setSubmitResult(null);
    setSubmitError(null);
    setTxError(null);
    setGameTimeMs(0);
    setPhase("countdown");
    setCountdown(3);
    getAudioCtx();  // warm up audio on user gesture
  }, [getAudioCtx]);

  // Countdown ticks (same pattern as rhythm)
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      playBell(783.99, 0.28);  // GO = G5
      startTimeRef.current = Date.now();
      setPhase("playing");
      // Kick off the first round after a brief delay
      const t = setTimeout(() => addNext([]), 500);
      timeoutsRef.current.push(t);
      return;
    }
    playBell(523.25, 0.22);  // tick = C5
    const t = setTimeout(() => setCountdown(c => c - 1), 750);
    return () => clearTimeout(t);
  }, [phase, countdown, playBell, addNext]);

  // ─── Render helpers ──────────────────────────────────────────────────────────
  const grade = gradeFor(sequences);

  return (
    <div style={{
      position: "fixed", inset: 0,
      // Deep cosmic void — the device is the ONLY bright thing in the scene.
      // Background darkens outward so the glow from the Simon orb reads as
      // the room's light source, not just a colored sticker on a web page.
      background: "radial-gradient(ellipse 65% 55% at 50% 50%, #1a0a5a 0%, #0c0430 35%, #05021a 70%, #010008 100%)",
      overflow: "hidden",
      fontFamily: "inherit",
      touchAction: "manipulation",
    }}>
      {/* Starfield — 44 ambient points, each twinkling on its own cadence */}
      {stars.map((s, i) => (
        <div key={i} className="dot-pulse" style={{
          position: "absolute",
          top: `${s.y}%`,
          left: `${s.x}%`,
          width: `${s.size}px`,
          height: `${s.size}px`,
          borderRadius: "50%",
          background: "white",
          boxShadow: `0 0 ${s.size * 3}px rgba(232,121,249,0.85)`,
          ["--dur" as string]: `${s.dur}s`,
          ["--delay" as string]: `${s.delay}s`,
          opacity: s.alpha,
          pointerEvents: "none", zIndex: 1,
        }} />
      ))}

      {/* Subtle splash icons — kept at very low opacity as ambient texture */}
      {BG_ICONS.map((ic, i) => (
        <div key={i} className="icon-float" style={{
          position: "absolute",
          top: ic.top,
          ...("left" in ic ? { left: ic.left } : { right: ic.right }),
          width: ic.size, height: ic.size,
          transform: `rotate(${ic.rotate}deg)`,
          filter: "drop-shadow(0 0 6px rgba(232,121,249,0.4))",
          ["--dur" as string]: `${ic.dur}s`, ["--delay" as string]: `${ic.delay}s`,
          opacity: 0.22, pointerEvents: "none", zIndex: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ic.src} alt="" width={ic.size} height={ic.size} style={{ objectFit: "contain" }} />
        </div>
      ))}

      {/* Magenta halo behind the device — intensifies with rounds for tension */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 40% 30% at 50% 55%, rgba(232,121,249,${Math.min(0.28, 0.1 + sequences * 0.012)}) 0%, transparent 70%)`,
        pointerEvents: "none", zIndex: 1,
      }} />

      {/* IDLE */}
      {phase === "idle" && <IdleView onStart={startGame} onExit={() => router.push("/games")} />}

      {/* COUNTDOWN */}
      {phase === "countdown" && <CountdownView n={countdown} />}

      {/* PLAYING (shows the sequence OR accepts input, same layout either way) */}
      {(phase === "playing" || phase === "showing") && (
        <PlayingView
          score={score}
          round={sequences + 1}
          bonusUnlocked={bonusUnlocked}
          activeBtn={activeBtn}
          isShowingSequence={isShowingSequence}
          roundFlash={roundFlash}
          pet={pet}
          petEvent={petEvent}
          tappedCount={tappedCount}
          totalInRound={Math.max(1, sequences + 1)}
          isMobile={isMobile}
          onButtonClick={handleButtonClick}
          onQuit={() => handleGameOver(scoreRef.current, Date.now() - startTimeRef.current)}
        />
      )}

      {/* FINISHED */}
      {phase === "finished" && (
        <FinishedView
          grade={grade}
          score={score}
          rounds={sequences}
          gameTimeMs={gameTimeMs}
          onPlayAgain={startGame}
          onExit={() => router.push("/games")}
          submitting={submitting}
          signingOnChain={signingOnChain}
          submitResult={submitResult}
          submitError={submitError}
          txError={txError}
        />
      )}
    </div>
  );
}

// ─── Idle: "GET READY" splash ────────────────────────────────────────────────
function IdleView({ onStart, onExit }: { onStart: () => void; onExit: () => void }) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 10,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: "32px", padding: "24px",
    }}>
      {/* Back X */}
      <button onClick={onExit} style={{
        position: "absolute", top: "18px", left: "18px",
        width: "40px", height: "40px", borderRadius: "12px",
        background: "#6b0000", paddingBottom: "4px",
        border: "none", cursor: "pointer", fontFamily: "inherit",
        boxShadow: "0 8px 16px -4px rgba(200,0,0,0.55)",
      }}>
        <div style={{
          width: "100%", height: "36px", borderRadius: "10px 10px 8px 8px",
          background: "linear-gradient(160deg, #ff6060 0%, #ee1111 50%, #b00000 100%)",
          border: "2px solid rgba(255,255,255,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "inset 0 4px 8px rgba(255,255,255,0.55)",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </div>
      </button>

      <div style={{ textAlign: "center" }}>
        <div style={{
          fontSize: "12px", fontWeight: 900, letterSpacing: "0.4em",
          color: "rgba(232,121,249,0.7)",
          textShadow: "0 0 14px rgba(232,121,249,0.7)",
        }}>GAME ARENA</div>
        <div style={{
          fontSize: "clamp(36px, 8vw, 64px)", fontWeight: 900, letterSpacing: "0.04em",
          color: "white", marginTop: "6px",
          textShadow: "0 0 24px rgba(6,182,212,0.85), 0 4px 10px rgba(0,0,0,0.7)",
          lineHeight: 1,
        }}>SIMON<br/>MEMORY</div>
      </div>

      <div style={{
        maxWidth: "360px", textAlign: "center",
        color: "rgba(220,200,255,0.75)", fontSize: "13px", fontWeight: 700, lineHeight: 1.6,
      }}>
        Watch the sequence.
        Tap the buttons back in order.
        Each round adds one more.
        <br/>
        <span style={{ color: "rgba(251,191,36,0.85)" }}>
          One mistake ends the run
        </span>
      </div>

      {/* START button */}
      <div role="button" tabIndex={0} onClick={onStart}
        style={{ cursor: "pointer", userSelect: "none", width: "min(240px, 80vw)" }}>
        <div style={{
          borderRadius: "18px", background: "#083a6b", paddingBottom: "6px",
          boxShadow: "0 12px 28px -6px rgba(6,182,212,0.75), 0 0 40px rgba(6,182,212,0.3)",
        }}>
          <div style={{
            borderRadius: "16px 16px 12px 12px",
            background: "linear-gradient(160deg, #a5f3fc 0%, #06b6d4 50%, #0e4f6b 100%)",
            padding: "18px 28px", textAlign: "center",
            border: "2px solid rgba(255,255,255,0.5)",
            position: "relative", overflow: "hidden",
            boxShadow: "inset 0 6px 14px rgba(255,255,255,0.65), inset 0 -3px 8px rgba(0,0,0,0.3)",
          }}>
            <div style={{
              position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)",
              borderRadius: "16px 16px 60px 60px", pointerEvents: "none",
            }} />
            <span style={{
              position: "relative", zIndex: 1,
              color: "white", fontSize: "20px", fontWeight: 900, letterSpacing: "0.18em",
              textShadow: "0 2px 4px rgba(0,0,0,0.45)",
            }}>START</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Countdown: 3 · 2 · 1 · GO ────────────────────────────────────────────────
function CountdownView({ n }: { n: number }) {
  const label = n <= 0 ? "GO!" : String(n);
  const color = n <= 0 ? "#fbbf24" : "#06b6d4";
  return (
    <div key={label} style={{
      position: "absolute", inset: 0, zIndex: 10,
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "bounce-scale-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both",
    }}>
      <div style={{
        fontSize: "clamp(120px, 24vw, 200px)", fontWeight: 900, color: "white",
        textShadow: `0 0 40px ${color}, 0 0 80px ${color}aa, 0 4px 12px rgba(0,0,0,0.6)`,
        letterSpacing: "0.04em", lineHeight: 1,
      }}>{label}</div>
    </div>
  );
}

// ─── PetCompanion — small mascot with real reactions to gameplay events ────
// Stays in the top-right corner so it doesn't compete with the Simon device,
// but becomes VERY alive when events fire:
//   correct  → green ring + bouncing pet-poke + "✓" emoji bubble
//   wrong    → red ring + grayscale wilt + "💔" emoji bubble (longer)
//   clear    → gold ring + sparkles + "⭐" emoji bubble
//   bonus    → rainbow ring + bigger pop + "🎉" emoji bubble
// Each event lasts 700ms (longer than the old 420ms so players actually notice).
function PetCompanion({ pet, event }: { pet: PetStage; event: PetEvent | null }) {
  type Reaction = "idle" | "correct" | "wrong" | "clear" | "bonus";
  const [reaction, setReaction] = useState<Reaction>("idle");
  const [bubble, setBubble] = useState<string | null>(null);

  useEffect(() => {
    if (!event) return;
    setReaction(event.type);
    // Emojis chosen to avoid echoing button colors — no single-color stars.
    // ✓ / 💔 / ✨ / 🎉 all render as multi-chromatic glyphs that don't imply
    // "this was the red / green / yellow button" to a color-primed player.
    const bubbles: Record<Reaction, string> = {
      idle: "", correct: "✓", wrong: "💔", clear: "✨", bonus: "🎉",
    };
    setBubble(bubbles[event.type]);
    // Wrong (game over) holds a bit longer — players should SEE the wilt
    const hold = event.type === "wrong" ? 1600 : event.type === "bonus" ? 1100 : 700;
    const t = setTimeout(() => { setReaction("idle"); setBubble(null); }, hold);
    return () => clearTimeout(t);
  }, [event]);

  // Ring palette avoids the 4 Simon button colors (red / cyan / yellow / green)
  // AND the purple bonus button. Using the same hues as the buttons would
  // leak information and blur the visual language of the memory game.
  //
  //   correct → WHITE (universal success, no hue overlap)
  //   wrong   → SLATE / dark (universal failure)
  //   clear   → PINK #ec4899 (festive but NOT in the palette)
  //   bonus   → rainbow conic (the one moment where color explosion is fine)
  //   idle    → soft SILVER (neutral, doesn't mimic any pet stage's own color)
  const ringBg = reaction === "correct"
    ? "linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%)"
    : reaction === "wrong"
    ? "linear-gradient(180deg, #64748b 0%, #1e293b 100%)"
    : reaction === "clear"
    ? "linear-gradient(180deg, #f9a8d4 0%, #ec4899 100%)"
    : reaction === "bonus"
    ? "conic-gradient(from 0deg, #ffffff, #f9a8d4, #ec4899, #c084fc, #ffffff)"
    : "linear-gradient(180deg, #e2e8f0cc 0%, #94a3b888 100%)";

  const ringGlow = reaction === "correct"
    ? "rgba(255,255,255,0.95)"
    : reaction === "wrong"
    ? "rgba(71,85,105,0.85)"
    : reaction === "clear"
    ? "rgba(236,72,153,0.95)"
    : reaction === "bonus"
    ? "rgba(236,72,153,0.95)"
    : "rgba(200,205,230,0.65)";

  const animClass = reaction === "correct" || reaction === "clear" || reaction === "bonus"
    ? "pet-poke"
    : "pet-breathe";

  const wilt = reaction === "wrong";
  const popScale = reaction === "bonus" ? 1.35 : reaction === "clear" ? 1.2 : reaction === "correct" ? 1.1 : 1;

  return (
    <div style={{
      flexShrink: 0, position: "relative",
      width: "84px", height: "84px",
      transform: `scale(${popScale})`,
      transition: "transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)",
    }}>
      {/* Color-coded ring — this is what makes the reaction legible at a glance */}
      <div style={{
        width: "100%", height: "100%",
        borderRadius: "50%", padding: "4px",
        background: ringBg,
        boxShadow: `0 0 26px ${ringGlow}, 0 6px 14px rgba(0,0,0,0.55)`,
        transition: "background 0.15s, box-shadow 0.15s",
      }}>
        <div style={{
          width: "100%", height: "100%", borderRadius: "50%",
          background: "linear-gradient(180deg, #2a0c6e 0%, #07021a 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}>
          <div className={animClass} style={{
            width: "88%", height: "88%",
            filter: wilt ? "grayscale(0.9) brightness(0.6) saturate(0.5)" : "none",
            transition: "filter 0.2s",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pet.src} alt="" draggable={false}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                filter: `drop-shadow(0 0 6px ${pet.color}cc)`,
              }} />
          </div>
        </div>
      </div>

      {/* Emoji bubble — floats above the pet on every reaction */}
      {bubble && (
        <div key={event?.ts} style={{
          position: "absolute",
          top: "-26px", left: "50%", transform: "translateX(-50%)",
          fontSize: reaction === "bonus" ? "28px" : "22px",
          filter: `drop-shadow(0 0 10px ${ringGlow})`,
          animation: "bubble-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}>{bubble}</div>
      )}
    </div>
  );
}

// ─── Playing view — the iconic Simon device ──────────────────────────────────
// Top-left: QUIT. Top-right: tiny pet + status chip.
// Center of screen: the CIRCULAR 4-quadrant Simon device with a glowing
//   center dome showing the round number (and acting as the bonus button
//   once unlocked at round 5).
// Bottom: SCORE chip + progress dots showing taps remaining this round.
function PlayingView({
  score, round, bonusUnlocked, activeBtn, isShowingSequence, roundFlash,
  pet, petEvent, tappedCount, totalInRound, isMobile, onButtonClick, onQuit,
}: {
  score: number;
  round: number;
  bonusUnlocked: boolean;
  activeBtn: string | null;
  isShowingSequence: boolean;
  roundFlash: string | null;
  pet: PetStage;
  petEvent: PetEvent | null;
  tappedCount: number;
  totalInRound: number;
  isMobile: boolean;
  onButtonClick: (id: string) => void;
  onQuit: () => void;
}) {
  const statusLabel = isShowingSequence ? "WATCH" : "YOUR TURN";
  const statusColor = isShowingSequence ? "#fbbf24" : "#67e8f9";

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", flexDirection: "column" }}>

      {/* ═══ TOP HUD — quit (left) · score pill (right). Pet moves to its own
               centered stage below so it's a present companion, not a corner widget. */}
      <div style={{ padding: "14px 16px 6px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={onQuit} aria-label="Quit run"
          style={{
            flexShrink: 0, borderRadius: "10px",
            background: "linear-gradient(180deg, #3a0a0a 0%, #2a0606 100%)",
            border: "1.5px solid rgba(255,80,80,0.45)",
            color: "#fca5a5",
            fontSize: "10px", fontWeight: 900, letterSpacing: "0.14em",
            cursor: "pointer", fontFamily: "inherit",
            padding: "8px 12px",
            display: "flex", alignItems: "center", gap: "6px",
            boxShadow: "0 0 12px rgba(239,68,68,0.25), 0 4px 10px rgba(0,0,0,0.4)",
          }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          QUIT
        </button>

        <div style={{ flex: 1 }} />

        {/* Score pill — moved from bottom to top-right so bottom stays calm */}
        <div style={{
          flexShrink: 0,
          padding: "7px 16px", borderRadius: "999px",
          background: "linear-gradient(180deg, rgba(251,191,36,0.16) 0%, rgba(251,191,36,0.06) 100%)",
          border: "1.5px solid rgba(251,191,36,0.4)",
          display: "flex", alignItems: "center", gap: "8px",
          boxShadow: "0 0 14px rgba(251,191,36,0.2)",
        }}>
          <span style={{
            color: "rgba(200,180,255,0.55)", fontSize: "9px", fontWeight: 900, letterSpacing: "0.18em",
          }}>SCORE</span>
          <span style={{
            color: "#fbbf24", fontSize: "16px", fontWeight: 900, lineHeight: 1,
            textShadow: "0 0 10px rgba(251,191,36,0.75)",
            fontVariantNumeric: "tabular-nums",
          }}>{score}</span>
        </div>
      </div>

      {/* ═══ PET + STATUS ZONE — the companion is center-stage, a present
               character, not a widget. Status chip sits under it so they read
               as a single unit ("your pet says: WATCH"). */}
      <div style={{
        padding: "6px 16px 4px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
      }}>
        <PetCompanion pet={pet} event={petEvent} />
        <span style={{
          display: "inline-block", padding: "6px 18px", borderRadius: "999px",
          background: isShowingSequence ? "rgba(251,191,36,0.12)" : "rgba(6,182,212,0.14)",
          border: `1.5px solid ${statusColor}80`,
          color: statusColor,
          fontSize: "11px", fontWeight: 900, letterSpacing: "0.22em",
          textShadow: `0 0 12px ${statusColor}88`,
          boxShadow: `0 0 14px ${statusColor}33`,
          transition: "all 0.2s",
        }}>
          {statusLabel}
        </span>
      </div>

      {/* ═══ CENTER STAGE — the Simon device ═══ */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "0 16px", position: "relative",
      }}>
        <SimonCircle
          round={round}
          statusLabel={statusLabel}
          bonusUnlocked={bonusUnlocked}
          activeBtn={activeBtn}
          disabled={isShowingSequence}
          isMobile={isMobile}
          onTap={onButtonClick}
        />

        {roundFlash && (
          <div style={{
            position: "absolute", top: "6%", left: "50%",
            transform: "translateX(-50%)",
            // Fluid padding — static 12/26 wrapped or clipped on small
            // phones for long strings like "5TH COLOR UNLOCKED!"
            padding: "clamp(8px, 2.4vw, 12px) clamp(14px, 4.5vw, 26px)",
            maxWidth: "92vw",
            borderRadius: "999px",
            background: "linear-gradient(180deg, #fbbf24 0%, #d97706 100%)",
            border: "3px solid rgba(255,255,255,0.6)",
            boxShadow: "0 0 40px rgba(251,191,36,0.8), 0 0 80px rgba(251,191,36,0.4), 0 12px 24px rgba(0,0,0,0.5)",
            animation: "bounce-scale-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both",
            zIndex: 8,
          }}>
            <span style={{
              color: "white",
              fontSize: "clamp(13px, 3.8vw, 24px)",
              fontWeight: 900,
              letterSpacing: "0.08em", textShadow: "0 2px 4px rgba(0,0,0,0.5)",
              whiteSpace: "nowrap",
            }}>{roundFlash}</span>
          </div>
        )}
      </div>

      {/* ═══ BOTTOM STRIP — progress dots only (score moved to top HUD) ═══ */}
      <div style={{ padding: "12px 18px 20px", minHeight: "22px" }}>
        {/* Progress dots — shown during the player's turn, hidden during WATCH */}
        {!isShowingSequence && (
          <div style={{
            display: "flex", justifyContent: "center", gap: "7px",
            flexWrap: "wrap",
          }}>
            {Array.from({ length: Math.min(totalInRound, 12) }).map((_, i) => {
              const done = i < tappedCount;
              return (
                <div key={i} style={{
                  width: "10px", height: "10px", borderRadius: "50%",
                  background: done
                    ? "radial-gradient(circle at 30% 30%, #86efac, #22c55e)"
                    : "rgba(167,139,250,0.15)",
                  border: done ? "none" : "1px solid rgba(167,139,250,0.35)",
                  boxShadow: done ? "0 0 8px rgba(34,197,94,0.8)" : "inset 0 1px 2px rgba(0,0,0,0.5)",
                  transition: "all 0.15s",
                }} />
              );
            })}
            {totalInRound > 12 && (
              <span style={{
                marginLeft: "8px",
                color: "rgba(200,180,255,0.6)",
                fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em",
              }}>{tappedCount}/{totalInRound}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SimonCircle — 4 colored pie slices + glowing center dome ────────────────
// The center dome shows the current round number and doubles as the purple
// bonus button once unlocked at round 5. Tapping outside the slices does
// nothing. Slices dim when the sequence is being revealed (to discourage
// premature taps) and pop with a full-bright glow when the active one fires.
function SimonCircle({
  round, statusLabel, bonusUnlocked, activeBtn, disabled, isMobile, onTap,
}: {
  round: number;
  statusLabel: string;
  bonusUnlocked: boolean;
  activeBtn: string | null;
  disabled: boolean;
  isMobile: boolean;
  onTap: (id: string) => void;
}) {
  // Halo color is ALWAYS neutral magenta — out of Simon's button palette
  // (red / cyan / yellow / green / purple-bonus). The slice itself carries
  // the button color (gameplay info). The surrounding halo only pulses in
  // INTENSITY when anything fires, never hue. This clean split means the
  // device's ambient glow can never leak which color was played, in either
  // WATCH or YOUR TURN phases.
  const activeTheme = ALL_COLORS.find(c => c.id === activeBtn);
  const haloColor = "rgba(232, 121, 249, 0.55)";  // magenta — NOT in the palette
  const haloActive = !!activeTheme;                // pulse on ANY flash

  return (
    <div style={{
      position: "relative",
      width: "min(380px, 88vw)",
      aspectRatio: "1",
      // Desktop: triple drop-shadow for depth + colored bleed + wide ambient.
      // Mobile: single modest shadow — the 200px blur filter was causing
      // renderer OOMs ("Aww, snap!" / "Can't open this page") on low-end
      // phones and the MiniPay webview. Each filter creates a full-screen
      // composite layer; a 200px blur radius paints ~160,000px² per frame.
      filter: isMobile
        ? `drop-shadow(0 18px 24px rgba(0,0,0,0.85))`
        : `drop-shadow(0 40px 50px rgba(0,0,0,0.9)) drop-shadow(0 0 80px ${haloColor}) drop-shadow(0 0 200px ${haloColor}${haloActive ? "" : "44"})`,
      transition: "filter 0.12s ease-out",
    }}>
      {/* Floor glow pool — device reads as floating above a surface */}
      <div style={{
        position: "absolute",
        bottom: "-14%", left: "8%",
        width: "84%", height: "18%",
        borderRadius: "50%",
        background: `radial-gradient(ellipse at 50% 50%, ${haloColor} 0%, transparent 72%)`,
        filter: "blur(8px)",
        opacity: haloActive ? 0.85 : 0.4,
        transition: "opacity 0.15s, background 0.15s",
        pointerEvents: "none",
      }} />

      {/* Outer bezel — dark ring that frames the "screen" */}
      <div style={{
        position: "absolute", inset: "-12px",
        borderRadius: "50%",
        background: "radial-gradient(circle at 30% 25%, #3a1a7a 0%, #1a0a45 45%, #05011a 100%)",
        boxShadow: `
          0 0 60px ${haloColor}88,
          inset 0 0 40px rgba(0,0,0,0.95),
          inset 0 0 0 2px rgba(167,139,250,0.4),
          inset 0 0 0 5px rgba(0,0,0,0.75),
          inset 0 0 0 7px rgba(167,139,250,0.2)
        `,
        transition: "box-shadow 0.15s",
      }} />

      {/* Recessed inner panel — the "screen" where the slices live */}
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: "50%",
        background: "radial-gradient(circle at 50% 50%, #0a0428 0%, #03010f 100%)",
        boxShadow: "inset 0 0 60px rgba(0,0,0,0.95), inset 0 4px 12px rgba(0,0,0,0.9)",
      }} />

      {/* 4 pie-slice buttons around the circle */}
      <Slice pos="tl" theme={BASE_COLORS[0]} active={activeBtn === BASE_COLORS[0].id} disabled={disabled} isMobile={isMobile} onTap={() => onTap(BASE_COLORS[0].id)} />
      <Slice pos="tr" theme={BASE_COLORS[1]} active={activeBtn === BASE_COLORS[1].id} disabled={disabled} isMobile={isMobile} onTap={() => onTap(BASE_COLORS[1].id)} />
      <Slice pos="bl" theme={BASE_COLORS[2]} active={activeBtn === BASE_COLORS[2].id} disabled={disabled} isMobile={isMobile} onTap={() => onTap(BASE_COLORS[2].id)} />
      <Slice pos="br" theme={BASE_COLORS[3]} active={activeBtn === BASE_COLORS[3].id} disabled={disabled} isMobile={isMobile} onTap={() => onTap(BASE_COLORS[3].id)} />

      {/* Center dome — round number + bonus purple button */}
      <CenterDome
        round={round}
        statusLabel={statusLabel}
        bonusUnlocked={bonusUnlocked}
        isBonusActive={activeBtn === BONUS_COLOR.id}
        disabled={disabled}
        onTap={bonusUnlocked ? () => onTap(BONUS_COLOR.id) : undefined}
      />
    </div>
  );
}

// ─── Slice — a single pie-quadrant button ────────────────────────────────────
// Classic CSS trick: a 50% × 50% square in the quadrant with the OUTER corner
// rounded to 100%, which carves a quarter-circle shape. Insetting from center
// creates a visible gap between neighbours.
type SlicePos = "tl" | "tr" | "bl" | "br";
function Slice({ pos, theme, active, disabled, isMobile, onTap }: {
  pos: SlicePos;
  theme: BtnTheme;
  active: boolean;
  disabled: boolean;
  isMobile: boolean;
  onTap: () => void;
}) {
  const posStyle: Record<SlicePos, React.CSSProperties> = {
    tl: { top: 0,    left: 0,   borderRadius: "100% 0 0 0" },
    tr: { top: 0,    right: 0,  borderRadius: "0 100% 0 0" },
    bl: { bottom: 0, left: 0,   borderRadius: "0 0 0 100%" },
    br: { bottom: 0, right: 0,  borderRadius: "0 0 100% 0" },
  };
  return (
    <button
      type="button"
      aria-label={`${theme.id} button`}
      // Opts out of the app-wide UI click blip. Simon's bell tone carries
      // the color info; a UI tick on top would muddle that audio cue.
      data-no-click-sound="true"
      data-game-pad="true"
      onPointerDown={(e) => {
        if (disabled) return;
        // Belt-and-suspenders against mobile refresh:
        //   - preventDefault cancels the default tap behavior
        //   - stopPropagation keeps the event off the document where
        //     pull-to-refresh is tracked on iOS Safari.
        e.preventDefault();
        e.stopPropagation();
        onTap();
      }}
      disabled={disabled}
      style={{
        position: "absolute",
        ...posStyle[pos],
        width: "calc(50% - 5px)",
        height: "calc(50% - 5px)",
        border: "none",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        background: theme.face,
        // Dim-to-bright delta is THE most important visual for rhythm game feel.
        // Idle slices sit at 45% brightness — almost silhouetted — so they're
        // visibly "off". When active, slices JUMP to 200% brightness with a
        // massive glow that bleeds onto neighbours. That's what reads as "the
        // light turned on" — classic Simon device drama.
        filter: active
          ? "brightness(2.0) saturate(1.5)"
          : (disabled ? "brightness(0.45) saturate(0.65)" : "brightness(0.75) saturate(0.9)"),
        boxShadow: active
          // Mobile: single 30px glow. Desktop: the original stacked
          // 80/160/240px bleed. Stacking three large blur radii forces
          // the renderer to paint giant offscreen buffers — on low-end
          // phones and the MiniPay webview this crashed the tab.
          ? (isMobile
              ? `0 0 30px ${theme.glow}, inset 0 0 40px rgba(255,255,255,0.65), inset 0 0 0 2px rgba(255,255,255,0.8)`
              : `0 0 80px ${theme.glow}, 0 0 160px ${theme.glow}88, 0 0 240px ${theme.glow}55, inset 0 0 60px rgba(255,255,255,0.7), inset 0 0 0 2px rgba(255,255,255,0.8)`)
          : `inset 0 2px 22px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.4), 0 0 14px ${theme.glow}22`,
        transform: active ? "scale(1.015)" : "scale(1)",
        transformOrigin: "center",
        transition: "filter 0.08s ease-out, box-shadow 0.08s ease-out, transform 0.08s ease-out",
        // `none` — block every native gesture starting on the pad. With
        // `manipulation`, a vertical finger travel at tap-start gave iOS
        // Safari the first frame it needed to trigger pull-to-refresh.
        touchAction: "none",
        fontFamily: "inherit",
      }}
    />
  );
}

// ─── CenterDome — round display (and bonus button once unlocked) ─────────────
function CenterDome({
  round, statusLabel, bonusUnlocked, isBonusActive, disabled, onTap,
}: {
  round: number;
  statusLabel: string;
  bonusUnlocked: boolean;
  isBonusActive: boolean;
  disabled: boolean;
  onTap?: () => void;
}) {
  const tappable = !!onTap && !disabled;
  return (
    <button
      type="button"
      aria-label={bonusUnlocked ? "Purple bonus button" : "Round display"}
      data-no-click-sound="true"
      data-game-pad="true"
      onPointerDown={(e) => {
        if (!tappable) return;
        e.preventDefault();
        e.stopPropagation();
        onTap?.();
      }}
      disabled={!tappable}
      style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "38%", aspectRatio: "1",
        borderRadius: "50%",
        border: "none", padding: 0,
        cursor: tappable ? "pointer" : "default",
        // Glass-orb gradients: radial with bright top-left for specular feel.
        // Pre-bonus: cosmic dark core. Post-bonus: deep purple core that can
        // flare to full purple when tapped.
        background: bonusUnlocked
          ? (isBonusActive
              ? BONUS_COLOR.face
              : "radial-gradient(circle at 32% 28%, #5a0099 0%, #2a0060 35%, #10002a 75%, #030010 100%)")
          : "radial-gradient(circle at 32% 28%, #2a1560 0%, #15083a 40%, #08031c 75%, #020008 100%)",
        filter: isBonusActive ? "brightness(1.8) saturate(1.4)" : "brightness(1)",
        boxShadow: isBonusActive
          ? `0 0 80px ${BONUS_COLOR.glow}, 0 0 160px ${BONUS_COLOR.glow}88, inset 0 0 50px rgba(255,255,255,0.6), 0 0 0 3px rgba(255,255,255,0.8), inset 0 4px 30px rgba(255,255,255,0.4)`
          : (bonusUnlocked
              ? `0 0 24px ${BONUS_COLOR.glow}66, inset 0 0 30px rgba(0,0,0,0.9), inset 0 0 0 2px ${BONUS_COLOR.accent}88, inset 0 -6px 20px rgba(0,0,0,0.7)`
              : "inset 0 0 40px rgba(0,0,0,0.95), 0 0 18px rgba(167,139,250,0.35), inset 0 0 0 2px rgba(167,139,250,0.4), inset 0 -8px 24px rgba(0,0,0,0.75)"),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1px",
        transition: "filter 0.1s, box-shadow 0.1s, background 0.1s",
        fontFamily: "inherit",
        color: "white",
        overflow: "hidden",
      }}
    >
      {/* Specular highlight — the "gloss" on top of a glass ball */}
      <div style={{
        position: "absolute",
        top: "8%", left: "18%",
        width: "58%", height: "38%",
        borderRadius: "50%",
        background: "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.35) 0%, transparent 65%)",
        filter: "blur(4px)",
        pointerEvents: "none",
        opacity: isBonusActive ? 0.85 : 0.45,
        transition: "opacity 0.15s",
      }} />

      <div style={{
        position: "relative", zIndex: 1,
        fontSize: "8px", fontWeight: 900, letterSpacing: "0.28em",
        color: isBonusActive ? "rgba(255,255,255,0.95)" : "rgba(200,180,255,0.55)",
        textShadow: isBonusActive ? "0 0 8px white" : undefined,
        marginBottom: "2px",
      }}>{statusLabel}</div>
      <div style={{
        position: "relative", zIndex: 1,
        fontSize: "clamp(44px, 12vw, 62px)",
        fontWeight: 900, lineHeight: 0.95,
        letterSpacing: "0.03em",
        fontVariantNumeric: "tabular-nums",
        color: isBonusActive ? "white" : "#fbbf24",
        textShadow: isBonusActive
          ? "0 0 22px white, 0 0 40px rgba(255,255,255,0.6)"
          : "0 0 18px rgba(251,191,36,0.95), 0 0 36px rgba(251,191,36,0.4), 0 2px 4px rgba(0,0,0,0.6)",
      }}>{round}</div>
      <div style={{
        position: "relative", zIndex: 1,
        fontSize: "8px", fontWeight: 800, letterSpacing: "0.3em",
        color: isBonusActive ? "rgba(255,255,255,0.75)" : "rgba(200,180,255,0.45)",
        marginTop: "3px",
      }}>ROUND</div>
      {bonusUnlocked && !isBonusActive && (
        <div style={{
          position: "absolute", bottom: "9%", left: "50%",
          transform: "translateX(-50%)",
          fontSize: "8px", fontWeight: 900, letterSpacing: "0.22em",
          color: BONUS_COLOR.accent,
          textShadow: `0 0 10px ${BONUS_COLOR.glow}`,
          whiteSpace: "nowrap",
        }}>★ TAP ★</div>
      )}
    </button>
  );
}

// ─── Finished view ─────────────────────────────────────────────────────────────
type FinishedSubmit = {
  rank?: number;
  xpEarned?: number;
  xp?: number;
  level?: number;
  leveledUp?: boolean;
  isNewPb?: boolean;
  prevBest?: number;
  newAchievements?: { id: string; name: string; icon?: string; desc?: string }[];
};

function FinishedView({
  grade, score, rounds, gameTimeMs,
  onPlayAgain, onExit,
  submitting, signingOnChain, submitResult, submitError, txError,
}: {
  grade: ReturnType<typeof gradeFor>;
  score: number; rounds: number; gameTimeMs: number;
  onPlayAgain: () => void;
  onExit: () => void;
  submitting: boolean;
  signingOnChain: boolean;
  submitResult: FinishedSubmit | null;
  submitError: string | null;
  txError: string | null;
}) {
  const seconds = Math.max(0, Math.floor(gameTimeMs / 1000));
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 15,
      background: "rgba(4,0,20,0.82)", backdropFilter: "blur(10px)",
      display: "flex",
      // Same fix as Rhythm's FinishedView: scroll the overlay so all
      // callouts + Play Again / Exit stay reachable on short viewports.
      alignItems: "flex-start", justifyContent: "center",
      overflowY: "auto",
      padding: "clamp(12px, 4vw, 20px)",
      paddingTop: "max(clamp(12px, 4vw, 20px), env(safe-area-inset-top, 0px))",
      paddingBottom: "max(clamp(24px, 6vw, 40px), env(safe-area-inset-bottom, 0px))",
      animation: "fadeIn 0.3s ease both",
    }}>
      <div style={{
        width: "100%", maxWidth: "440px",
        borderRadius: "26px", background: "#1a0550", paddingBottom: "7px",
        boxShadow: "0 0 0 3px #5b21b6, 0 0 50px rgba(109,40,217,0.6), 0 30px 60px rgba(0,0,0,0.9)",
        animation: "scaleIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        marginTop: "auto", marginBottom: "auto",
      }}>
        <div style={{
          borderRadius: "24px 24px 20px 20px",
          background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 50%, #07021a 100%)",
          border: "2px solid rgba(255,255,255,0.12)",
          padding: "clamp(18px, 5vw, 28px) clamp(16px, 5vw, 24px)",
          textAlign: "center",
          overflow: "hidden", position: "relative",
        }}>
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "100px",
            background: "linear-gradient(180deg, rgba(200,160,255,0.16) 0%, transparent 100%)",
            pointerEvents: "none",
          }} />

          {/* Grade */}
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "11px", fontWeight: 900, letterSpacing: "0.2em", marginBottom: "8px" }}>
              {grade.desc}
            </div>
            <div style={{
              width: "clamp(108px, 32vw, 140px)",
              height: "clamp(108px, 32vw, 140px)",
              margin: "0 auto",
              borderRadius: "50%", padding: "5px",
              background: `conic-gradient(from 0deg, ${grade.color}, ${grade.color}aa, ${grade.color})`,
              boxShadow: `0 0 40px ${grade.color}88, 0 0 80px ${grade.color}44`,
            }}>
              <div style={{
                width: "100%", height: "100%", borderRadius: "50%",
                background: "linear-gradient(180deg, #13063a 0%, #07021a 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {/* Letter: white core with colored glow around it.
                    Colored-on-colored (e.g. cyan text + cyan shadow) blurs
                    into itself and reads as a washed-out smear on mobile.
                    White inside + colored halo outside = high contrast
                    letter AND the grade color still dominates the badge. */}
                <span style={{
                  fontSize: "clamp(68px, 22vw, 92px)",
                  fontWeight: 900,
                  color: "white",
                  textShadow: `0 0 16px ${grade.color}, 0 0 34px ${grade.color}bb, 0 0 60px ${grade.color}66, 0 3px 6px rgba(0,0,0,0.8)`,
                  WebkitTextStroke: `1px ${grade.color}`,
                  lineHeight: 1,
                }}>{grade.letter}</span>
              </div>
            </div>
          </div>

          {/* Score */}
          <div style={{ marginTop: "20px" }}>
            <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em" }}>SCORE</div>
            <div style={{
              color: "#fbbf24",
              fontSize: "clamp(32px, 10vw, 46px)",
              fontWeight: 900,
              textShadow: "0 0 20px rgba(251,191,36,0.8), 0 2px 6px rgba(0,0,0,0.6)",
              lineHeight: 1, marginTop: "3px",
            }}>{score}</div>
          </div>

          {/* Rounds + time */}
          <div style={{
            marginTop: "16px",
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px",
          }}>
            <MiniStat label="ROUNDS"  value={String(rounds)}      color="#a78bfa" />
            <MiniStat label="TIME"    value={`${seconds}s`}       color="#22c55e" />
          </div>

          {/* Reward panel (same as rhythm) */}
          <RewardPanel
            submitting={submitting}
            signingOnChain={signingOnChain}
            result={submitResult}
            error={submitError}
            txError={txError}
            score={score}
          />

          {/* CTAs */}
          <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
            <JuicyBtn label="PLAY AGAIN" wall="#083a6b"
              face="linear-gradient(160deg, #a5f3fc 0%, #06b6d4 50%, #0e4f6b 100%)"
              onClick={onPlayAgain} />
            <JuicyBtn label="EXIT" wall="#1a0550"
              face="linear-gradient(160deg, #c084fc 0%, #a78bfa 50%, #6b21a8 100%)"
              onClick={onExit} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      borderRadius: "10px",
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${color}44`,
      padding: "8px 4px", textAlign: "center",
    }}>
      <div style={{ color, fontSize: "17px", fontWeight: 900, textShadow: `0 0 10px ${color}88` }}>{value}</div>
      <div style={{ color: "rgba(200,180,255,0.5)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.12em", marginTop: "2px" }}>{label}</div>
    </div>
  );
}

function JuicyBtn({ label, wall, face, onClick }: { label: string; wall: string; face: string; onClick: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      style={{ flex: 1, cursor: "pointer", userSelect: "none" }}>
      <div style={{
        borderRadius: "14px", background: wall, paddingBottom: "5px",
        boxShadow: "0 10px 22px -4px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          borderRadius: "12px 12px 10px 10px",
          background: face,
          padding: "12px 8px", textAlign: "center",
          border: "2px solid rgba(255,255,255,0.45)",
          boxShadow: "inset 0 6px 14px rgba(255,255,255,0.55), inset 0 -3px 6px rgba(0,0,0,0.3)",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: "2px", left: "4%", right: "4%", height: "46%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.65) 0%, transparent 100%)",
            borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
          }} />
          <span style={{
            position: "relative", zIndex: 1,
            color: "white", fontSize: "13px", fontWeight: 900, letterSpacing: "0.14em",
            textShadow: "0 1px 2px rgba(0,0,0,0.4)",
          }}>{label}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Reward panel — same state machine as rhythm's finish screen ─────────────
function RewardPanel({
  submitting, signingOnChain, result, error, txError, score,
}: {
  submitting: boolean;
  signingOnChain: boolean;
  result: FinishedSubmit | null;
  error: string | null;
  txError: string | null;
  score: number;
}) {
  if (signingOnChain) {
    return (
      <div style={{
        marginTop: "16px", padding: "12px",
        borderRadius: "10px",
        background: "rgba(251,191,36,0.1)",
        border: "1px solid rgba(251,191,36,0.35)",
        color: "#fbbf24",
        fontSize: "11px", fontWeight: 900, letterSpacing: "0.16em",
        textAlign: "center",
        boxShadow: "0 0 16px rgba(251,191,36,0.2)",
      }}>
        ✦ CONFIRM IN YOUR WALLET ✦
        <div style={{
          color: "rgba(200,180,255,0.65)", fontSize: "9px", fontWeight: 700,
          letterSpacing: "0.1em", marginTop: "4px",
        }}>Signing records your score on-chain</div>
      </div>
    );
  }

  if (submitting) {
    return (
      <div style={{
        marginTop: "16px", padding: "10px 12px",
        borderRadius: "10px",
        background: "rgba(167,139,250,0.08)",
        border: "1px solid rgba(167,139,250,0.2)",
        color: "rgba(200,180,255,0.7)",
        fontSize: "11px", fontWeight: 900, letterSpacing: "0.14em",
        textAlign: "center",
      }}>
        SAVING SCORE…
      </div>
    );
  }

  if (txError) {
    return (
      <div style={{
        marginTop: "16px", padding: "10px 12px",
        borderRadius: "10px",
        background: "rgba(239,68,68,0.1)",
        border: "1px solid rgba(239,68,68,0.35)",
        color: "#fca5a5",
        fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em",
        textAlign: "center",
      }}>
        {txError}
        <div style={{
          color: "rgba(252,165,165,0.65)", fontSize: "9px", fontWeight: 700,
          letterSpacing: "0.1em", marginTop: "4px",
        }}>Tap PLAY AGAIN to try again</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        marginTop: "16px", padding: "10px 12px",
        borderRadius: "10px",
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.2)",
        color: "rgba(252,165,165,0.85)",
        fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
        textAlign: "center",
      }}>
        {error}
      </div>
    );
  }

  if (!result) return null;

  const { rank, xpEarned, level, leveledUp, isNewPb, prevBest, newAchievements = [] } = result;
  const showPbDelta = isNewPb && typeof prevBest === "number" && prevBest > 0;
  const showFirstPb = isNewPb && !showPbDelta;

  // Stagger reward-screen stings so each lands individually (rank → PB →
  // level-up → achievement). Each plays once when its callout mounts.
  return (
    <RewardContent
      rank={rank}
      xpEarned={xpEarned}
      level={level}
      leveledUp={leveledUp}
      isNewPb={isNewPb}
      showPbDelta={showPbDelta}
      showFirstPb={showFirstPb}
      prevBest={prevBest}
      newAchievements={newAchievements}
      score={score}
    />
  );
}

type RewardContentProps = {
  rank: number | undefined;
  xpEarned: number | undefined;
  level: number | undefined;
  leveledUp: boolean | undefined;
  isNewPb: boolean | undefined;
  showPbDelta: boolean | undefined;
  showFirstPb: boolean | undefined;
  prevBest: number | undefined;
  newAchievements: { id: string; name: string; icon?: string; desc?: string }[];
  score: number;
};

function RewardContent({
  rank, xpEarned, level, leveledUp, isNewPb, showPbDelta, showFirstPb, prevBest, newAchievements, score,
}: RewardContentProps) {
  useEffect(() => { if (rank) playRankReveal(); }, [rank]);
  useEffect(() => {
    if (isNewPb) { const t = setTimeout(() => playSaveSuccess(), 250); return () => clearTimeout(t); }
  }, [isNewPb]);
  useEffect(() => {
    if (leveledUp) { const t = setTimeout(() => playLevelUp(), 500); return () => clearTimeout(t); }
  }, [leveledUp]);
  useEffect(() => {
    if (newAchievements.length > 0) { const t = setTimeout(() => playAchievementChime(), 900); return () => clearTimeout(t); }
  }, [newAchievements.length]);

  return (
    <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        {rank ? (
          <div style={{
            padding: "10px 8px", borderRadius: "10px",
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.28)",
            textAlign: "center",
          }}>
            <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.16em" }}>RANK</div>
            <div style={{ color: "#fbbf24", fontSize: "22px", fontWeight: 900, textShadow: "0 0 10px rgba(251,191,36,0.6)", marginTop: "2px" }}>
              #{rank}
            </div>
          </div>
        ) : <div />}
        {typeof xpEarned === "number" ? (
          <div style={{
            padding: "10px 8px", borderRadius: "10px",
            background: "rgba(167,139,250,0.1)",
            border: "1px solid rgba(167,139,250,0.3)",
            textAlign: "center",
          }}>
            <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "9px", fontWeight: 800, letterSpacing: "0.16em" }}>XP GAINED</div>
            <div style={{ color: "#a78bfa", fontSize: "22px", fontWeight: 900, textShadow: "0 0 10px rgba(167,139,250,0.7)", marginTop: "2px" }}>
              +{xpEarned}
            </div>
          </div>
        ) : <div />}
      </div>

      {showPbDelta && typeof prevBest === "number" && (
        <div style={{
          padding: "10px 12px", borderRadius: "10px",
          background: "linear-gradient(90deg, rgba(6,182,212,0.15) 0%, rgba(34,197,94,0.15) 100%)",
          border: "1px solid rgba(6,182,212,0.4)",
          textAlign: "center",
          boxShadow: "0 0 20px rgba(6,182,212,0.25)",
          animation: "bounce-scale-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        }}>
          <div style={{ color: "#67e8f9", fontSize: "12px", fontWeight: 900, letterSpacing: "0.2em" }}>
            ★ NEW PERSONAL BEST ★
          </div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "12px", fontWeight: 800, marginTop: "3px" }}>
            Beat your previous {prevBest} by{" "}
            <span style={{ color: "#86efac", fontWeight: 900 }}>
              +{Math.max(0, score - prevBest)}
            </span>
          </div>
        </div>
      )}
      {showFirstPb && (
        <div style={{
          padding: "10px 12px", borderRadius: "10px",
          background: "rgba(6,182,212,0.1)",
          border: "1px solid rgba(6,182,212,0.35)",
          textAlign: "center",
          animation: "bounce-scale-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        }}>
          <div style={{ color: "#67e8f9", fontSize: "12px", fontWeight: 900, letterSpacing: "0.2em" }}>
            ★ FIRST PERSONAL BEST ★
          </div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700, marginTop: "3px" }}>
            Your score is now on the leaderboard
          </div>
        </div>
      )}

      {leveledUp && level && (
        <div style={{
          padding: "10px 12px", borderRadius: "10px",
          background: "linear-gradient(90deg, rgba(251,191,36,0.15) 0%, rgba(232,121,249,0.15) 100%)",
          border: "1px solid rgba(251,191,36,0.4)",
          textAlign: "center",
          boxShadow: "0 0 20px rgba(251,191,36,0.2)",
          animation: "bounce-scale-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        }}>
          <div style={{ color: "#fbbf24", fontSize: "12px", fontWeight: 900, letterSpacing: "0.2em" }}>
            ★ LEVEL UP ★
          </div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "13px", fontWeight: 800, marginTop: "3px" }}>
            You&apos;re now Level {level}
          </div>
        </div>
      )}

      {newAchievements.length > 0 && (
        <div style={{
          padding: "10px 12px", borderRadius: "10px",
          background: "rgba(34,197,94,0.1)",
          border: "1px solid rgba(34,197,94,0.35)",
          animation: "bounce-scale-in 0.55s cubic-bezier(0.34,1.56,0.64,1) both",
        }}>
          <div style={{ color: "#86efac", fontSize: "10px", fontWeight: 900, letterSpacing: "0.18em", textAlign: "center", marginBottom: "6px" }}>
            ✦ NEW ACHIEVEMENT{newAchievements.length > 1 ? "S" : ""} ✦
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {newAchievements.map((raw, i) => {
              // Defensive hydrate — see rhythm/page.tsx comment. Handles
              // both the legacy string-only response and the new hydrated
              // object shape without relying on the backend being fresh.
              const a = hydrateAchievement(raw);
              return (
                <div key={a.id || i} style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  color: "rgba(255,255,255,0.9)", fontSize: "12px", fontWeight: 800,
                }}>
                  <span style={{ fontSize: "16px" }}>{a.icon}</span>
                  <span>{a.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
