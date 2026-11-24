"use client";

// ─── STACK TOWER ──────────────────────────────────────────────────────────────
// Tap to drop sliding blocks onto a tower. Whatever hangs over the edge
// gets sliced off, so the block gets narrower. Land it perfectly aligned
// and you keep full width + a combo. Game ends when a drop misses
// completely, or when the tower gets sliced down to nothing.
//
// Build choices (mirror Slime Survivor so the games feel like siblings):
//   • Canvas + RAF imperative rendering — same architecture as Rhythm
//     and Survivor. Refs for game state, throttled HUD sync
//   • Same phase machine: idle → countdown → playing → finished
//   • Same juice pattern (popup hook from useGameJuice for big combo
//     callouts + screen shake on slice; in-canvas particles for slice
//     shards and perfect-drop sparkles)
//   • Free-play (no wallet, no on-chain). localStorage best score.
//     Step-up to ranked submit comes later (same path Rhythm/Simon use)
//   • Back button + idle/finished screens visually match the other games

import { toast, startProblem } from "@/lib/toast";
import { useCallback, useEffect, useRef, useState } from "react";
import { ATTRIBUTION_SUFFIX } from "@/lib/attribution";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage, useWriteContract, useReadContract } from "wagmi";
import MintScorePrompt from "@/components/MintScorePrompt";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useAuthStatus } from "@/hooks/useRequireAuth";
import { PET_STAGES, petForLevel } from "@/lib/pets";
import { useGameJuice, JuiceOverlay } from "@/hooks/useGameJuice";
import GuestScorePrompt, { GuestPlayChip, SetupPlayChip } from "@/components/GuestScorePrompt";
import GameLobby from "@/components/GameLobby";
import RunSaveStatus from "@/components/RunSaveStatus";

import GameResult, { FreePlayNote } from "@/components/GameResult";
import { useFriendRoom } from "@/hooks/useFriendRoom";
import FriendsPlay from "@/components/FriendsPlay";
import GuestLimitPrompt from "@/components/GuestLimitPrompt";
import { guestPlaysLeft, bumpGuestPlayed } from "@/lib/guestLimit";
import LevelUpToast from "@/components/LevelUpToast";
import PetEvolveToast from "@/components/PetEvolveToast";
import { PushOptInModal } from "@/components/PushOptInModal";
import {
  signScore, signScoreMiniPay,
  submitScore, submitScoreMiniPay,
  startGame as startGameAction,
  startGameMiniPay as startGameMiniPayAction,
} from "@/app/actions/game";
import { useIsEmbedded, getVatarSession, vatarSubmitScore } from "@/lib/vatar";
import { startVatarGame, signVatarScore } from "@/app/actions/vatar";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI, detectFeeSpread } from "@/lib/contracts";
import { fetchLeaderboard, type LeaderboardEntry } from "@/lib/subgraph";
import { fetchPreview, getCachedPreview } from "@/lib/leaderboardPreview";
import { GasHelpSheet } from "@/components/GasHelpSheet";
import { LowGasBanner } from "@/components/LowGasBanner";
import { useGasStatus } from "@/hooks/useGasStatus";
import { claimGas } from "@/app/actions/gas";
import { GASLESS_SKILL_GAMES } from "@/lib/gasless";
import ArenaCrossPromo from "@/components/ArenaCrossPromo";
import SaveRunOverlay from "@/components/SaveRunOverlay";
import { usePerks } from "@/hooks/usePerks";
import { useEquipped } from "@/lib/cosmetics";
import NextUp from "@/components/NextUp";

// Crystal Blocks cosmetic (PerkShop perk 4) — owned forever, re-skins the
// tower in icy glass. Purely visual, zero gameplay effect.
const CRYSTAL_PERK_ID = 4;

// Draws one tower slab. Default skin shifts hue as you climb; the Crystal
// Blocks cosmetic swaps in an icy-glass palette — a fixed cyan face with a
// brighter top gloss and a translucent inner highlight that reads as glass.
// `hue` is kept for the default skin; crystal ignores it so the whole tower
// stays a single cohesive material.
function drawSlab(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, hue: number, crystal: boolean, moving: boolean,
) {
  // Every slab is a solid block seen slightly from above and to the left: a lit
  // top face and a shaded right side are drawn behind the front face. The front
  // face is still the one that counts for alignment, so the game plays exactly
  // as before; the tower just looks like a real stack with ledges where a block
  // was cut short.
  const DX = 13, DY = 8;
  ctx.fillStyle = crystal ? "hsl(188 90% 78%)" : `hsl(${hue} 88% ${moving ? 74 : 70}%)`;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w + DX, y - DY); ctx.lineTo(x + DX, y - DY); ctx.closePath(); ctx.fill();
  ctx.fillStyle = crystal ? "hsl(200 70% 18%)" : `hsl(${hue} 78% 20%)`;
  ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w + DX, y - DY); ctx.lineTo(x + w + DX, y - DY + BLOCK_H); ctx.lineTo(x + w, y + BLOCK_H); ctx.closePath(); ctx.fill();
  if (crystal) {
    const fh = BLOCK_H - 3;                           // face height
    ctx.fillStyle = "hsl(200 65% 24%)";              // deep ice shadow
    ctx.fillRect(x, y + 3, w, BLOCK_H);
    ctx.fillStyle = "hsl(190 80% 56%)";              // cyan glass face
    ctx.fillRect(x, y, w, fh);
    // Cut-gem facets — a bright upper-left triangle and a darker lower-right
    // one split the face diagonally, so it reads as a faceted crystal, not a
    // flat cyan slab. This is the "I clearly paid for this" difference.
    ctx.fillStyle = "rgba(236,254,255,0.22)";        // lit facet
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x, y + fh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(8,42,64,0.28)";            // shaded facet
    ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + fh); ctx.lineTo(x, y + fh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(230,252,255,0.7)";         // bright top edge
    ctx.fillRect(x, y, w, 3);
    // Specular sparkle — a small 4-point glint near the top-left corner
    const gx = x + Math.min(14, w * 0.22), gy = y + 7, s = 3.2;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.moveTo(gx, gy - s * 1.8); ctx.lineTo(gx + s * 0.7, gy); ctx.lineTo(gx + s * 1.8, gy);
    ctx.lineTo(gx + s * 0.7, gy + s * 0.4); ctx.lineTo(gx, gy + s * 1.8); ctx.lineTo(gx - s * 0.7, gy + s * 0.4);
    ctx.lineTo(gx - s * 1.8, gy); ctx.lineTo(gx - s * 0.7, gy); ctx.closePath(); ctx.fill();
    return;
  }
  ctx.fillStyle = `hsl(${hue} 80% 28%)`;
  ctx.fillRect(x, y + 3, w, BLOCK_H);
  ctx.fillStyle = `hsl(${hue} 78% 56%)`;
  ctx.fillRect(x, y, w, BLOCK_H - 3);
  ctx.fillStyle = `rgba(255,255,255,${moving ? 0.3 : 0.25})`;
  ctx.fillRect(x, y, w, 4);
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// Hard session cap · matches simon. Backend rejects vouchers from sessions
// older than 11 minutes (server.js:963), so 10 minutes leaves a safety margin
// for the on-chain tx + voucher round trip to land.
const GAME_DURATION_MS = 10 * 60 * 1000;

// ─── Tuning ──────────────────────────────────────────────────────────────────
const BLOCK_H = 28;                 // pixel height of each stacked slab
const START_W_MIN = 180;            // initial block width on narrow phones
const START_W_FRAC = 0.62;          // …scaled to 62% of viewport on wider
const PERFECT_TOL = 7;              // px tolerance to count as a perfect drop
const BASE_SPEED = 2.4;             // px / frame at level 1
const SPEED_RAMP = 0.12;            // extra px / frame per stacked block
const SPEED_RAMP_QUAD = 0.002;      // tiny quadratic component (caps at 2)
const SPEED_RAMP_QUAD_CAP = 2;
const CAM_FOLLOW = 0.08;            // 0..1 — camera ease toward target
const SHARD_GRAVITY = 0.45;
const HUES = [195, 215, 245, 275, 300, 330, 0, 30, 50];

type Phase = "idle" | "countdown" | "playing" | "saving" | "finished";

// ─── MODES ───────────────────────────────────────────────────────────────────
// RANKED is the game as it has always been and the only mode that is signed
// and submitted. The others change the rules for fun and never leave the
// device: no gas check, no session ticket, no score signing, no save prompt.
// "room" is a friend-room round: nothing is signed or sent to the chain, and the
// result goes to the room instead.
type ModeId = "ranked" | "practice" | "turbo" | "thin" | "room";
const MODES: { id: ModeId; name: string; tag: string; blurb: string; color: string }[] = [
  { id: "ranked", name: "Ranked", tag: "COUNTS", blurb: "The real thing. Your score goes on the weekly board.", color: "#fbbf24" },
  { id: "practice", name: "Practice", tag: "FREE", blurb: "Same game, no pressure. Nothing is saved or signed.", color: "#67e8f9" },
  { id: "turbo", name: "Turbo", tag: "FREE", blurb: "Every block moves 60% faster. Blink and it is gone.", color: "#f43f5e" },
  { id: "thin", name: "Thin Ice", tag: "FREE", blurb: "You start with a block half the width. No room for error.", color: "#c084fc" },
];
const modeById = (id: ModeId) => MODES.find((m) => m.id === id) ?? MODES[0];
const TURBO = 1.6;
const THIN = 0.5;

// A challenge from a friend arrives as a link: /games/stack?beat=14&mode=ranked&by=Tunde
type Challenge = { blocks: number; mode: ModeId; by: string };
function readChallenge(): Challenge | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const blocks = Number(q.get("beat"));
  if (!Number.isFinite(blocks) || blocks < 1 || blocks > 2000) return null;
  const mode = (q.get("mode") || "ranked") as ModeId;
  const by = (q.get("by") || "A friend").replace(/[^\p{L}\p{N} _.@-]/gu, "").slice(0, 18) || "A friend";
  return { blocks: Math.floor(blocks), mode: MODES.some((m) => m.id === mode) ? mode : "ranked", by };
}
type Block = { x: number; w: number; hue: number };
type Moving = { x: number; w: number; dir: 1 | -1; speed: number; hue: number };
type Shard = { x: number; y: number; w: number; vx: number; vy: number; rot: number; vr: number; hue: number };
type Sparkle = { x: number; y: number; born: number; life: number };
// One entry per drop · fed to the backend shadow re-scorer (ANTICHEAT.md).
// `t` is a coarse timestamp for a FUTURE humanness check · NOT used for scoring.
type DropLogEntry = { dropIndex: number; level: number; landed: boolean; perfect: boolean; offset: number; t: number };

export default function StackTowerPage() {
  const router = useRouter();
  const { address } = useAccount();

  // Crystal Blocks — applied only when the player OWNS it and has it EQUIPPED
  // (owning doesn't force the skin on; they can toggle it off in the shop).
  // Mirrored into a ref so the RAF draw loop always sees the live value.
  const { ownsCosmetic } = usePerks();
  const [crystalEquipped] = useEquipped(CRYSTAL_PERK_ID);
  const hasCrystalRef = useRef(false);
  hasCrystalRef.current = ownsCosmetic(CRYSTAL_PERK_ID) && crystalEquipped;

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [localBest, setLocalBest] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(GAME_DURATION_MS);
  // GasHelpSheet covers both the pre-game gate (player taps START while
  // blocked) and the post-fail rescue (existing txError "needs a top up"
  // becomes tappable). Same sheet, intent set to "gas-help" with the
  // last attempted score baked into the pre-fill so the community can
  // see what got lost.
  const [gasHelpOpen, setGasHelpOpen] = useState(false);
  const { status: gasStatus, approxSavesLeft } = useGasStatus();

  // Player level drives the pet-evolution celebration after a successful
  // submit (petForLevel diff at submit-result time).
  const [playerLevel, setPlayerLevel] = useState(1);
  useEffect(() => {
    if (!address) return;
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.json())
      .then(d => setPlayerLevel(d.level || 1))
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    setLocalBest(Number(localStorage.getItem("stack_best") || 0));
  }, []);

  // ═══ Score submission — mirrors simon's three-step gated flow ═══════════
  // Signed-in players land on the same on-chain ladder as Rhythm and Simon
  // (gameType=2). Guests keep the local-best fallback above so the practice
  // loop still feels rewarding before they sign in.
  type SubmitResult = {
  txHash?: string | null; // the transaction that recorded the score
    rank?: number;
    xpEarned?: number;
    xp?: number;
    level?: number;
    leveledUp?: boolean;
    isNewPb?: boolean;
    prevBest?: number;
    newAchievements?: { id: string; name: string; icon?: string; desc?: string }[];
  };
  const sessionTokenRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const submittedRef = useRef(false);
  const gameStartMsRef = useRef(0);

  // ═══ Save-your-run (M1 perk) ═════════════════════════════════════════════
  // A miss opens the SaveRunOverlay. Buying/using a save keeps the tower and
  // resumes play — the run still submits normally (using a save counts on the
  // weekly board). savePausedAtRef marks when the clock froze so we can hand
  // the paused seconds back on resume.
  const savePausedAtRef = useRef(0);

  const [submitting, setSubmitting] = useState(false);
  const [signingOnChain, setSigningOnChain] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [levelUpToastLevel, setLevelUpToastLevel] = useState<number | null>(null);
  const [petEvolveToPet, setPetEvolveToPet] = useState<typeof PET_STAGES[number] | null>(null);
  const [petEvolveAtLevel, setPetEvolveAtLevel] = useState<number>(1);

  const { authed, pending: authPending } = useAuthStatus();
  // Connected wallet without a GamePass (e.g. a whitelisted UBI claimer)
  // can play but scores can't save on-chain. needsMint shows a "mint to
  // save" invite instead of firing a tx that reverts "No game pass".
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const needsMint = authed && hasMinted === false;

  // ─── Guest free-play limit ───────────────────────────────────────────────
  // Guests (not signed in) get GUEST_PLAY_LIMIT free runs, then a sign-in
  // gate — mirrors Challenge AI's demo limit. Signed-in players are unlimited.
  const isGuest = !authed && !authPending;
  // Vatar embed player (inside the Lagos Life iframe) · distinct from Privy's
  // isEmbeddedWallet below. They have no browser wallet but a custodial GamePass,
  // so their runs record on-chain via the Vatar session (see the effects below).
  const inVatar = useIsEmbedded();
  const [guestLeft, setGuestLeft] = useState<number>(3);
  const [guestLimitOpen, setGuestLimitOpen] = useState(false);
  const guestCountedRef = useRef(false);
  useEffect(() => { setGuestLeft(guestPlaysLeft("stack")); }, []);
  useEffect(() => {
    if (phase === "finished" && isGuest && !guestCountedRef.current) {
      guestCountedRef.current = true;
      bumpGuestPlayed("stack");
      setGuestLeft(guestPlaysLeft("stack"));
    }
  }, [phase, isGuest]);

  const { getAccessToken, user } = usePrivy();
  // signMessageAsync is unused for stack (no tap-log replay) but kept here
  // so the import shape matches simon · easier diff when we add anti-replay.
  useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const isMiniPay = useIsMiniPay();
  const isEmbeddedWallet = user?.linkedAccounts?.some(
    (a: { type: string; walletClientType?: string }) =>
      a.type === "wallet" && a.walletClientType === "privy"
  );

  // ─── Game state refs (never re-renders) ──────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rafRef = useRef(0);
  const stackRef = useRef<Block[]>([]);
  const movingRef = useRef<Moving | null>(null);
  const shardsRef = useRef<Shard[]>([]);
  const sparklesRef = useRef<Sparkle[]>([]);
  const camYRef = useRef(0);
  const camTargetRef = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const levelRef = useRef(1);   // how many blocks are on the tower

  // ─── Anti-cheat: per-drop log (SHADOW MODE) ───────────────────────────────
  // Accumulate one entry per drop so the backend can recompute the score from
  // discrete drop events (NOT from timestamps · see games-backend/ANTICHEAT.md
  // Trap 2). `t` is a coarse timestamp reserved for a FUTURE humanness check
  // and does not feed scoring. Additive + optional · an empty log changes
  // nothing about what score the client submits.
  const dropLogRef = useRef<DropLogEntry[]>([]);

  const juice = useGameJuice();

  // ─── Audio — same shape as Survivor's blip() ─────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  }, []);
  const blip = useCallback((freq: number, dur = 0.08, gain = 0.15, type: OscillatorType = "triangle") => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now + dur);
  }, [getAudioCtx]);
  const haptic = useCallback((ms: number | number[]) => {
    try { navigator.vibrate?.(ms); } catch {}
  }, []);

  // ─── Canvas sizing (DPR-aware, ResizeObserver-driven) ─────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr); }
      sizeRef.current = { w: rect.width, h: rect.height };
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas); else window.addEventListener("resize", resize);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener("resize", resize); };
  }, []);

  // ─── Geometry helper ─────────────────────────────────────────────────────
  // For block `level` (1-indexed, level 1 = base), this is the world-Y of
  // its CENTER, measured down from a fixed sky reference. The camera then
  // pans up as the tower grows. Keeps math simple — no recomputing every
  // block's position on every drop.
  const blockCenterY = (level: number) => {
    const { h } = sizeRef.current;
    return h - 90 - level * BLOCK_H;
  };

  // ─── Finish ───────────────────────────────────────────────────────────────
  // Declared before drop() so drop can list it as a dependency without a TDZ.
  // Friends in a room all build at the same time; the room ranks the towers.
  const room = useFriendRoom("stack");
  const roomRef = useRef(room);
  roomRef.current = room;
  const roomRound = useRef(0);

  const finish = useCallback(() => {
    blip(140, 0.4, 0.22, "sawtooth");
    haptic([30, 40, 60]);
    juice.bump(22);
    setLocalBest(prev => {
      const best = Math.max(prev, scoreRef.current);
      localStorage.setItem("stack_best", String(best));
      return best;
    });
    // tallest tower ever built on this device: the line you climb toward next time
    try {
      const built = Math.max(0, levelRef.current - 1);
      if (built > bestHeightRef.current) { bestHeightRef.current = built; localStorage.setItem(heightKey(runModeRef.current), String(built)); }
    } catch { /* ignore */ }
    if (runModeRef.current === "room") void roomRef.current.finish({ dropLog: dropLogRef.current.slice(), score: scoreRef.current });
    setPhase("finished");
  }, [blip, haptic, juice]);

  // ─── Drop (the whole game in one function) ───────────────────────────────
  const drop = useCallback(() => {
    if (phase !== "playing" || !movingRef.current) return;
    const stack = stackRef.current;
    const below = stack[stack.length - 1];
    const m = movingRef.current;

    const overlapL = Math.max(m.x, below.x);
    const overlapR = Math.min(m.x + m.w, below.x + below.w);
    const overlap = overlapR - overlapL;
    const yCenter = blockCenterY(levelRef.current);

    // Complete miss — block falls. Offer a save (casual mode) before ending.
    if (overlap <= 0) {
      // Shadow-mode drop log · record the miss (landed=false ends the run).
      dropLogRef.current.push({
        dropIndex: dropLogRef.current.length, level: levelRef.current,
        landed: false, perfect: false, offset: Math.abs(m.x - below.x), t: Date.now(),
      });
      shardsRef.current.push({
        x: m.x + m.w / 2, y: yCenter,
        w: m.w, vx: m.dir * 1.5, vy: 0, rot: 0, vr: m.dir * 0.04, hue: m.hue,
      });
      movingRef.current = null;
      // Only signed-in, minted players can buy a save on-chain. Guests and
      // not-yet-minted players fall straight through to the finish screen.
      // So does every free mode: paying to save a run that is never submitted makes no sense.
      if (runModeRef.current === "ranked" && address && !needsMint) {
        savePausedAtRef.current = Date.now();
        setPhase("saving");
      } else {
        finish();
      }
      return;
    }

    const offset = Math.abs(m.x - below.x);
    const newLevel = levelRef.current + 1;

    // Shadow-mode drop log · one landed entry per drop (ANTICHEAT.md Step 1).
    dropLogRef.current.push({
      dropIndex: dropLogRef.current.length, level: levelRef.current,
      landed: true, perfect: offset <= PERFECT_TOL, offset, t: Date.now(),
    });

    if (offset <= PERFECT_TOL) {
      // PERFECT — snap aligned, no slice, combo + bonus
      stack.push({ x: below.x, w: below.w, hue: m.hue });
      comboRef.current += 1;
      const c = comboRef.current;
      const points = 2 + Math.min(c, 8);
      scoreRef.current += points;
      // Sparkles at the top corners — sells the "perfect" tactile snap
      sparklesRef.current.push({ x: below.x, y: yCenter, born: performance.now(), life: 600 });
      sparklesRef.current.push({ x: below.x + below.w, y: yCenter, born: performance.now(), life: 600 });
      // Shared juice: floating "+X PERFECT" + milestone callouts
      const wPct = (m.x + m.w / 2) / sizeRef.current.w * 100;
      const yPct = (yCenter / sizeRef.current.h) * 100;
      juice.scorePopup(wPct, yPct, points, "perfect");
      if (c >= 2 && (c === 3 || c === 5 || c === 10 || c === 20)) {
        juice.fireCallout({
          text: c === 20 ? "ARCHITECT" : c === 10 ? "MASTER MASON" : c === 5 ? "ON FIRE 🔥" : "STREAK!",
          sub: `${c} perfects in a row`,
          color: c >= 10 ? "#fbbf24" : "#f0abfc",
        }, c);
      }
      blip(660 + Math.min(c, 8) * 60, 0.12, 0.2);
      haptic(18);
    } else {
      // Normal drop — slice the overhang into a falling shard
      const shardW = m.w - overlap;
      const shardX = m.x < below.x ? m.x : overlapR;
      const sliceLeftSide = m.x < below.x;
      shardsRef.current.push({
        x: shardX + shardW / 2, y: yCenter,
        w: shardW, vx: (sliceLeftSide ? -1 : 1) * 1.2, vy: 0,
        rot: 0, vr: (sliceLeftSide ? -1 : 1) * 0.05, hue: m.hue,
      });
      stack.push({ x: overlapL, w: overlap, hue: m.hue });
      comboRef.current = 0;
      scoreRef.current += 1;
      blip(330, 0.07, 0.14);
      haptic(8);
      juice.bump(Math.min(8, Math.round(shardW / 8)));
    }

    levelRef.current = newLevel;
    if (runModeRef.current === "room") roomRef.current.progress(newLevel - 1, { lv: newLevel - 1, pts: scoreRef.current, combo: comboRef.current }); // friends see how tall you are
    // the moment the tower tops your best ever
    if (!passedBestRef.current && lineHeightRef.current >= 3 && newLevel - 1 > lineHeightRef.current) {
      passedBestRef.current = true;
      juice.fireCallout({ text: "NEW HEIGHT!", sub: `PAST YOUR BEST OF ${lineHeightRef.current}`, color: "#4ade80" }, 900);
      haptic([20, 30, 60]);
    }
    setScore(scoreRef.current);
    setCombo(comboRef.current);

    // New moving block: alternate entry side, speed creeps up with height
    const top = stack[stack.length - 1];
    const fromLeft = newLevel % 2 === 0;
    const speed = (BASE_SPEED + newLevel * SPEED_RAMP
      + Math.min(newLevel * newLevel * SPEED_RAMP_QUAD, SPEED_RAMP_QUAD_CAP)) * (runModeRef.current === "turbo" ? TURBO : 1);
    const { w: cw } = sizeRef.current;
    movingRef.current = {
      x: fromLeft ? -top.w : cw,
      w: top.w,
      dir: fromLeft ? 1 : -1,
      speed,
      hue: HUES[newLevel % HUES.length],
    };
    // Camera follows the tower up
    camTargetRef.current = Math.max(0, newLevel * BLOCK_H - sizeRef.current.h * 0.45);
  }, [phase, blip, haptic, juice, address, needsMint, finish]);

  // ─── Resume after a bought save ────────────────────────────────────────────
  // Re-arm a moving block from the current top of the tower and hand back the
  // seconds the save decision cost. The run continues and still submits.
  const resumeAfterSave = useCallback(() => {
    const stack = stackRef.current;
    const top = stack[stack.length - 1];
    const level = levelRef.current;
    const fromLeft = level % 2 === 0;
    const speed = (BASE_SPEED + level * SPEED_RAMP
      + Math.min(level * level * SPEED_RAMP_QUAD, SPEED_RAMP_QUAD_CAP)) * (runModeRef.current === "turbo" ? TURBO : 1);
    const { w: cw } = sizeRef.current;
    movingRef.current = {
      x: fromLeft ? -top.w : cw,
      w: top.w,
      dir: fromLeft ? 1 : -1,
      speed,
      hue: HUES[level % HUES.length],
    };
    // Give back the paused decision time so the clock stays fair.
    if (savePausedAtRef.current) {
      gameStartMsRef.current += Date.now() - savePausedAtRef.current;
      savePausedAtRef.current = 0;
    }
    setPhase("playing");
  }, []);

  // Declined / timed out on the save → end the run through the normal path.
  const declineSave = useCallback(() => {
    savePausedAtRef.current = 0;
    finish();
  }, [finish]);

  // ─── Start a fresh run ────────────────────────────────────────────────────
  const startGame = useCallback(async (roomStart?: unknown) => {
    // a room round passes true; a tap on Play passes a click event
    const inRoom = roomStart === true;
    // Re-entry guard — bails if a session ticket request is already in flight.
    // Without this a double-click during the ~500ms /api/start-game round
    // trip inserts two game_sessions rows for one actual run.
    if (startingRef.current) return;

    // ═══ Guest free-play gate ════════════════════════════════════════════
    // Block a new run once a guest is out of free plays; offer sign-in.
    if (!inRoom && isGuest && guestPlaysLeft("stack") <= 0) {
      setGuestLimitOpen(true);
      return;
    }
    guestCountedRef.current = false;

    // ═══ Pre-game gas gate ═══════════════════════════════════════════════
    // Onchain finality is binary · either the score got recorded or it
    // doesn't exist. We can't predict per-tx gas perfectly, so when the
    // bucket says "block" we block the run instead of letting the player
    // grind a 10-minute tower into a guaranteed insufficient-funds throw.
    // useGasStatus returns "minipay" for MiniPay (USDC fee adapter pays
    // gas) and "guest" for free-play (no submit happens anyway), so this
    // only triggers for funded-CELO players whose balance dipped under
    // the block threshold.
    // Unminted players play the GUEST path: no gas gate (they submit
    // nothing on-chain), no session ticket (the backend would refuse it
    // anyway). Play is free — the finish screen sells the mint.
    runModeRef.current = inRoom ? "room" : modeRef.current; // pinned for the whole run
    const ranked = runModeRef.current === "ranked";
    if (ranked && !GASLESS_SKILL_GAMES && !needsMint && gasStatus === "block") {
      // Low on gas · try a one-tap faucet top-up before sending them to beg for
      // CELO in Telegram. If the drip lands, the wallet now has gas so the score
      // will save — proceed into play. Only if it can't help do we open the sheet.
      let topped = false;
      try {
        const token = await getAccessToken();
        if (token && address) topped = !!(await claimGas(token, address)).success;
      } catch { /* fall through to the help sheet */ }
      if (!topped) {
        setGasHelpOpen(true);
        return;
      }
    }
    startingRef.current = true;

    const { w } = sizeRef.current;
    const startW = Math.min(280, Math.max(START_W_MIN, w * START_W_FRAC)) * (runModeRef.current === "thin" ? THIN : 1);
    stackRef.current = [
      { x: (w - startW) / 2, w: startW, hue: HUES[0] },
    ];
    movingRef.current = {
      x: 0, w: startW, dir: 1, speed: BASE_SPEED * (runModeRef.current === "turbo" ? TURBO : 1), hue: HUES[1],
    };
    shardsRef.current = [];
    sparklesRef.current = [];
    camYRef.current = 0;
    camTargetRef.current = 0;
    scoreRef.current = 0;
    comboRef.current = 0;
    levelRef.current = 1;
    lineHeightRef.current = bestHeightRef.current;
    passedBestRef.current = false;
    dropLogRef.current = [];
    setScore(0); setCombo(0);
    juice.reset();
    submittedRef.current = false;
    vatarSubmittedRef.current = false;
    savePausedAtRef.current = 0;
    sessionTokenRef.current = null;
    setSubmitResult(null);
    setSubmitError(null);
    setTxError(null);

    // ═══ Anti-cheat: request a session ticket BEFORE the countdown ═══════
    // No ticket = backend refuses to sign the score at submit time. Guests
    // skip this branch and the run stays local-only (localStorage best).
    // Free modes submit nothing, so they need no ticket either.
    if (ranked && address && !needsMint) {
      try {
        let res;
        if (isMiniPay) {
          // MiniPay forbids personal_sign · identity is enforced on-chain
          // when the player signs the score-submit tx later.
          res = await startGameMiniPayAction(address, "", "", "stack");
        } else {
          const token = await getAccessToken();
          if (!token) {
            setSubmitError("Sign in required to start a ranked run.");
            startingRef.current = false;
            return;
          }
          res = await startGameAction(token, address, "stack");
        }
        if (!res.success) {
          setSubmitError(res.error || "Couldn't start session. Try again.");
          toast(startProblem(res.error));
          startingRef.current = false;
          return;
        }
        sessionTokenRef.current = res.sessionToken;
      } catch {
        setSubmitError("Couldn't start session. Try again.");
        toast(startProblem());
        startingRef.current = false;
        return;
      }
    } else if (inVatar) {
      // Vatar embed · no browser wallet. Bind a session ticket to the player's
      // custodial wallet (the backend resolves it from the Vatar session) so the
      // finished run can record on-chain. Non-blocking: if it fails, play still
      // runs and the run just won't post to the ladder.
      try {
        const vs = await getVatarSession();
        if (vs) {
          const r = await startVatarGame(vs, "stack");
          if (r.success) sessionTokenRef.current = r.sessionToken;
        }
      } catch { /* ignore · play continues */ }
    }

    getAudioCtx();
    setCountdown(3);
    setPhase("countdown");
    startingRef.current = false;
  }, [address, isMiniPay, getAccessToken, getAudioCtx, juice, gasStatus, needsMint, isGuest, inVatar]);

  // the host pressed start: everyone builds now
  useEffect(() => {
    const v = room.view;
    if (!v || v.status !== "playing" || v.round === roomRound.current || v.players[v.you]?.done) return;
    roomRound.current = v.round;
    startingRef.current = false;
    void startGame(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.view]);
  // leaving the room, or a rematch being called, returns to the start screen
  useEffect(() => {
    if (runModeRef.current !== "room") return;
    if (!room.inRoom || room.view?.status === "waiting") { setPhase("idle"); runModeRef.current = modeRef.current; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.inRoom, room.view?.status]);

  // ── Straight into play ─────────────────────────────────────────────────────
  // Arriving with ?play=1 (the landing page's "Play free", or any "play now"
  // link) starts a run at once: no menu to read, no second button to find. The
  // start screen is still there after the run, with the modes and the board.
  // The flag is taken off the address so a refresh does not start another run.
  const autoStartRef = useRef(false);
  const [showHowTo, setShowHowTo] = useState(false);
  useEffect(() => {
    if (autoStartRef.current || authPending) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("play") !== "1") return;
    autoStartRef.current = true;
    q.delete("play");
    window.history.replaceState(null, "", window.location.pathname + (q.toString() ? `?${q}` : ""));
    setShowHowTo(true); // they skipped the screen that explains the game, so say it in the game
    startGame();
  }, [authPending, startGame]);
  useEffect(() => {
    if (!showHowTo || phase !== "playing") return;
    const t = setTimeout(() => setShowHowTo(false), 6000);
    return () => clearTimeout(t);
  }, [showHowTo, phase]);

  // ─── Countdown → playing ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      blip(784, 0.2, 0.2);
      gameStartMsRef.current = Date.now();   // wall-clock anchor for submit gameTime
      setTimeLeftMs(GAME_DURATION_MS);
      setPhase("playing");
      return;
    }
    blip(523, 0.15, 0.18);
    const t = setTimeout(() => setCountdown(c => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown, blip]);

  // ─── Hard 10-minute timer · matches backend's 11-min session TTL ─────────
  // Ticks 4×/sec, computes remaining time off gameStartMsRef so animation
  // pauses don't desync the countdown. At 0, finish() ends the run with the
  // current score (same path as a missed drop).
  useEffect(() => {
    if (phase !== "playing") return;
    const tick = () => {
      const remaining = GAME_DURATION_MS - (Date.now() - gameStartMsRef.current);
      if (remaining <= 0) {
        setTimeLeftMs(0);
        finish();
        return;
      }
      setTimeLeftMs(remaining);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, finish]);

  // ═══ Vatar embed · record the finished run ═══════════════════════════════
  // The embed player has no browser wallet, so the on-chain submit effect below
  // (gated on `address`) skips them. This records their run to the GameArena
  // on-chain ladder (backend-signed gasless write, keyed to their custodial
  // wallet via the Vatar session) AND to Vatar's own in-world leaderboard.
  // Best-effort: a failure never blocks the finish screen.
  const vatarSubmittedRef = useRef(false);
  useEffect(() => {
    if (phase !== "finished" || !inVatar) return;
    if (vatarSubmittedRef.current) return;
    vatarSubmittedRef.current = true;
    const token = sessionTokenRef.current;
    const scoreToSave = Math.min(1_000_000, Math.max(0, Math.round(scoreRef.current)));
    void (async () => {
      // Vatar's in-world board (always, even without an on-chain ticket).
      void vatarSubmitScore(scoreToSave);
      // GameArena on-chain ladder (needs the ticket from startGame + a real score).
      if (!token || scoreToSave <= 0) return;
      const vs = await getVatarSession();
      if (!vs) return;
      await signVatarScore(vs, "stack", scoreToSave, token).catch(() => {});
    })();
  }, [phase, inVatar]);

  // ═══ Submit score · same three-step flow as simon ════════════════════════
  // 1. signScore                    backend EIP-712 voucher
  // 2. recordScoreWithBackendSig    on-chain tx · the signature gate
  // 3. submitScore                  off-chain save (Supabase, XP, achievements)
  // Guests with no wallet skip this entirely · their best stays in localStorage.
  useEffect(() => {
    if (phase !== "finished") return;
    if (runModeRef.current !== "ranked") return; // free modes are never signed or sent
    if (submittedRef.current) return;
    // A saved run submits normally — using a save counts on the weekly board.
    // Unminted: nothing to submit — the finish screen shows the mint
    // prompt instead of a bogus 'session missing' error.
    if (!address || needsMint) return;
    if (hasMinted === false) return; // no pass · show mint prompt, don't revert
    submittedRef.current = true;

    const rawGameTime = Date.now() - gameStartMsRef.current;
    const gameTime = Math.max(5000, rawGameTime);
    const scoreToSubmit = Math.min(1_000_000, Math.max(0, Math.round(scoreRef.current)));

    // 0-score + sub-5s ends are the player tapping START and bailing.
    // Skip the network round-trip and surface a calm message.
    if (scoreToSubmit === 0 && rawGameTime < 5000) {
      setSubmitting(false);
      setTxError(null);
      setSubmitError("No score yet. Tap BUILD AGAIN and stack a few blocks to land on the board.");
      return;
    }

    const baseScoreData = { game: "stack" as const, score: scoreToSubmit, gameTime };

    (async () => {
      setSubmitting(true);
      setTxError(null);
      try {
        // ── STEP 1: voucher ──
        let sig:
          | { success: true; gasless: true; txHash: string | null; queued?: boolean; gameType: number; score?: number }
          | { success: true; gasless?: false; signature: string; nonce: string; gameType: number; score?: number }
          | { success: false; error: string };
        let authToken: string | null = null;

        const sessionToken = sessionTokenRef.current;
        if (!sessionToken) {
          setSubmitError("Session missing. Tap BUILD AGAIN to start a fresh run.");
          return;
        }

        if (isMiniPay) {
          sig = await signScoreMiniPay(
            address, "", "",
            { game: "stack", score: scoreToSubmit },
            sessionToken,
            undefined, // tapLog · unused by stack
            // Optional + additive · shadow re-scoring only, does not change the
            // signed score (see games-backend/ANTICHEAT.md).
            dropLogRef.current,
          );
        } else {
          authToken = await getAccessToken();
          if (!authToken) {
            setSubmitError("Not signed in · score not recorded");
            return;
          }
          sig = await signScore(
            authToken, address,
            { game: "stack", score: scoreToSubmit },
            sessionToken,
            undefined, // tapLog · unused by stack
            // Optional + additive · shadow re-scoring only, does not change the
            // signed score (see games-backend/ANTICHEAT.md).
            dropLogRef.current,
          );
        }

        if (!sig.success) {
          setSubmitError(sig.error || "Voucher signing failed");
          return;
        }

        // ── STEP 2: on-chain tx ──
        let txHash: string | null = null;
        if (sig.gasless) {
          // Gasless: backend already recorded the score on-chain — no wallet
          // prompt, no CELO. Just take the tx hash it submitted.
          txHash = sig.txHash;
        } else {
        setSigningOnChain(true);
        try {
          txHash = await writeContractAsync({
            dataSuffix: ATTRIBUTION_SUFFIX,
            address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
            abi: GAME_PASS_ABI,
            functionName: "recordScoreWithBackendSig",
            args: [sig.gameType, BigInt(typeof sig.score === "number" ? sig.score : scoreToSubmit), BigInt(sig.nonce), sig.signature as `0x${string}`],
            ...(isEmbeddedWallet ? { gas: 300000n } : {}),
            ...(await detectFeeSpread(isMiniPay, address as `0x${string}` | undefined)),
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
          const matchedGasPattern =
            name === "InsufficientFundsError" || name === "EstimateGasExecutionError" ||
            code === -32000 || code === -32010 || code === -32603 ||
            causeCode === "insufficient_funds" ||
            msg.includes("insufficient funds") || msg.includes("insufficient balance") ||
            msg.includes("gas limit") || msg.includes("exceeds gas") ||
            msg.includes("gas required") || msg.includes("intrinsic gas") ||
            msg.includes("cannot estimate") || msg.includes("estimate gas");
          // Forno mask · Celo's RPC returns a generic revert when the real
          // cause is insufficient funds (per celo-insufficient-funds-trap).
          // Privy embedded wallets surface generic errors for the same shape.
          // If the keyword match missed BUT the player's gas bucket says
          // they're below the warn floor, reclassify as gas so the help
          // card fires instead of a dead-end "try again."
          const lowBalanceLikelyGas =
            !isRejected && !matchedGasPattern &&
            (gasStatus === "warn" || gasStatus === "block");
          const isGasOrFunds = matchedGasPattern || lowBalanceLikelyGas;
          if (isRejected)        setTxError("Transaction rejected. Tap BUILD AGAIN to try again.");
          else if (isGasOrFunds) setTxError("Score didn't save · needs a top up.");
          else                   setTxError("Score didn't save. Tap BUILD AGAIN to try again.");
          return;
        } finally {
          setSigningOnChain(false);
        }
        } // end legacy (player-pays) on-chain path

        // ── STEP 3: save off-chain ──
        let result;
        // the score the server approved (it may be lower than the claim), and the
        // run's ticket so a queued score can be saved before its transaction exists
        const fullScoreData = { ...baseScoreData, score: typeof sig.score === "number" ? sig.score : baseScoreData.score, txHash, sessionToken: sessionTokenRef.current };
        if (isMiniPay) {
          result = await submitScoreMiniPay(address, "", "", fullScoreData);
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
            txHash, // so the result screen can show whether the chain confirmed it
          });
          if (result.leveledUp && typeof result.level === "number") {
            const newLv = result.level;
            const prevLv = playerLevel;
            const prevPet = petForLevel(prevLv);
            const newPet = petForLevel(newLv);
            setTimeout(() => setLevelUpToastLevel(newLv), 700);
            if (prevPet.id !== newPet.id) {
              setPetEvolveAtLevel(newLv);
              setTimeout(() => setPetEvolveToPet(newPet), 700 + 3800);
            }
          }
        } else {
          setSubmitError(result?.error || "Score not recorded");
        }
      } catch {
        setSubmitError("Unexpected error · score not recorded");
      } finally {
        setSubmitting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ─── Input ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    const onTap = (e: PointerEvent) => { e.preventDefault(); drop(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); drop(); }
    };
    window.addEventListener("pointerdown", onTap);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onTap);
      window.removeEventListener("keydown", onKey);
    };
  }, [phase, drop]);

  // ─── Game loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    let lastWall = performance.now();
    const tick = () => {
      const wall = performance.now();
      const dt = Math.min(0.05, (wall - lastWall) / 1000);
      lastWall = wall;
      const { w, h } = sizeRef.current;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx || w === 0) { rafRef.current = requestAnimationFrame(tick); return; }

      // Move slider (frame-rate-independent via dt scaled to 60fps)
      const m = movingRef.current;
      if (m) {
        m.x += m.dir * m.speed * (dt * 60);
        if (m.dir === 1 && m.x + m.w > w + 4) m.dir = -1;
        if (m.dir === -1 && m.x < -4) m.dir = 1;
      }
      // Camera ease
      camYRef.current += (camTargetRef.current - camYRef.current) * CAM_FOLLOW;
      // Shards
      for (const s of shardsRef.current) {
        s.vy += SHARD_GRAVITY;
        s.x += s.vx; s.y += s.vy; s.rot += s.vr;
      }
      shardsRef.current = shardsRef.current.filter(s => s.y < h + camYRef.current + 200);
      // Sparkles
      sparklesRef.current = sparklesRef.current.filter(s => wall - s.born < s.life);

      draw(ctx, wall);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Background gradient cache — creating a CanvasGradient is an expensive
  // allocation, and the old code did it EVERY frame (60×/s). The hue only
  // moves when the level changes, so cache by (level, height): one
  // allocation per stacked block instead of ~3,600/minute.
  // dev only: lets an automated test build a tower (drop when the block lines up)
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __stack?: unknown }).__stack = {
      phase, drop, level: () => levelRef.current, setMode, runMode: () => runModeRef.current, topW: () => stackRef.current[0]?.w, speed: () => movingRef.current?.speed,
      offset: () => { const m = movingRef.current, st = stackRef.current; return m && st.length ? m.x - st[st.length - 1].x : null; },
      setBest: (n: number) => { bestHeightRef.current = n; lineHeightRef.current = n; },
    };
  });

  const bgGradRef = useRef<{ key: string; grad: CanvasGradient } | null>(null);
  // Tallest tower so far (blocks), drawn as a gold line across the sky. It is
  // fixed for the whole run, so passing it mid-run is a moment you can see.
  const bestHeightRef = useRef(0);
  // Mode + an incoming friend challenge. runModeRef is the mode a run is PLAYED
  // with, pinned when it starts: the rules and whether it submits read that.
  const [mode, setMode] = useState<ModeId>("ranked");
  const modeRef = useRef<ModeId>("ranked");
  const runModeRef = useRef<ModeId>("ranked");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const challengeRef = useRef<Challenge | null>(null);
  const heightKey = (m: ModeId) => (m === "ranked" ? "stack_best_height" : `stack_best_height_${m}`);
  useEffect(() => { const c = readChallenge(); if (c) { setChallenge(c); challengeRef.current = c; setMode(c.mode); } }, []);
  useEffect(() => {
    modeRef.current = mode;
    try { const n = Number(localStorage.getItem(heightKey(mode))); bestHeightRef.current = Number.isFinite(n) && n > 0 ? n : 0; } catch { bestHeightRef.current = 0; }
    lineHeightRef.current = bestHeightRef.current;
  }, [mode]);
  const lineHeightRef = useRef(0);   // the height the line shows this run
  const passedBestRef = useRef(false);
  const skyRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => { skyRef.current = img; };
    img.src = "/games/stack-sky.webp";
  }, []);

  // ─── Draw ─────────────────────────────────────────────────────────────────
  const draw = (ctx: CanvasRenderingContext2D, wall: number) => {
    const { w, h } = sizeRef.current;

    // Background — shifts hue as you climb. Sells progress without a counter.
    const climb = Math.min(levelRef.current / 60, 1);
    const gradKey = `${levelRef.current}|${h}`;
    if (!bgGradRef.current || bgGradRef.current.key !== gradKey) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `hsl(${240 - climb * 80} 50% ${8 + climb * 10}%)`);
      grad.addColorStop(1, "#07021c");
      bgGradRef.current = { key: gradKey, grad };
    }
    ctx.fillStyle = bgGradRef.current.grad;
    ctx.fillRect(0, 0, w, h);
    // The night sky over Lagos. The skyline sits at the bottom when you start,
    // and the picture slides down as the tower rises (slower than the tower, so
    // it reads as distance), until you are stacking up among the stars.
    const sky = skyRef.current;
    if (sky) {
      const scale = Math.max(w / sky.width, (h * 1.45) / sky.height);
      const dw = sky.width * scale, dh = sky.height * scale;
      const pan = Math.min(dh - h, camYRef.current * 0.3);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(sky, (w - dw) / 2, h - dh + pan, dw, dh);
      ctx.globalAlpha = 0.34; // keep the hue shift that shows the climb
      ctx.fillStyle = bgGradRef.current.grad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(0, camYRef.current);

    // YOUR BEST line: the top of the tallest tower you have ever built.
    const bestH = lineHeightRef.current;
    if (bestH >= 3) {
      const ly = blockCenterY(bestH + 1) + BLOCK_H / 2; // top face of block number bestH
      const passed = levelRef.current - 1 > bestH;
      ctx.save();
      ctx.strokeStyle = passed ? "rgba(74,222,128,0.9)" : "rgba(251,191,36,0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 7]);
      ctx.shadowColor = passed ? "#4ade80" : "#fbbf24";
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.font = '900 11px ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif';
      ctx.fillStyle = passed ? "#86efac" : "#fde68a";
      ctx.textBaseline = "bottom";
      ctx.fillText(passed ? `BEATEN · WAS ${bestH}` : `YOUR BEST · ${bestH}`, 10, ly - 4);
      ctx.restore();
    }

    // A friend's tower to beat, drawn as its own line in the sky.
    const ch = challengeRef.current;
    if (ch && ch.blocks >= 1) {
      const ly = blockCenterY(ch.blocks + 1) + BLOCK_H / 2;
      const beaten = levelRef.current - 1 > ch.blocks;
      ctx.save();
      ctx.strokeStyle = beaten ? "rgba(74,222,128,0.9)" : "rgba(251,146,60,0.95)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '900 11px ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif';
      ctx.fillStyle = beaten ? "#86efac" : "#fdba74";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "right";
      ctx.fillText(beaten ? `${ch.by.toUpperCase()} BEATEN` : `${ch.by.toUpperCase()} · ${ch.blocks}`, w - 10, ly - 4);
      ctx.restore();
    }

    // Stack
    const crystal = hasCrystalRef.current;
    const stack = stackRef.current;
    for (let i = 0; i < stack.length; i++) {
      const b = stack[i];
      const y = blockCenterY(i + 1) - BLOCK_H / 2;
      drawSlab(ctx, b.x, y, b.w, b.hue, crystal, false);
    }

    // Moving block (with glow)
    const m = movingRef.current;
    if (m && phase === "playing") {
      const y = blockCenterY(levelRef.current + 1) - BLOCK_H / 2;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = crystal ? `hsl(188 85% 62%)` : `hsl(${m.hue} 78% 56%)`;
      ctx.fillRect(m.x - 6, y - 4, m.w + 12, BLOCK_H + 8);
      ctx.restore();
      drawSlab(ctx, m.x, y, m.w, m.hue, crystal, true);
    }

    // Falling shards (sliced-off overhangs)
    for (const s of shardsRef.current) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = `hsl(${s.hue} 78% 50%)`;
      ctx.fillRect(-s.w / 2, -BLOCK_H / 2, s.w, BLOCK_H - 3);
      ctx.restore();
    }

    // Perfect-drop sparkles — small expanding circles at the corners
    for (const sp of sparklesRef.current) {
      const age = (wall - sp.born) / sp.life;
      ctx.save();
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 6 + age * 22, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, height: "100dvh",
      background: "linear-gradient(180deg, #1e0762 0%, #12044a 55%, #0a0228 100%)",
      overflow: "hidden", touchAction: "none", userSelect: "none",
      fontFamily: "inherit",
    }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

      {/* HUD — score top-left, time + combo top-right */}
      {(phase === "playing" || phase === "countdown") && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          padding: "max(12px, env(safe-area-inset-top)) 16px 0",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          pointerEvents: "none",
        }}>
          <div>
            <div style={{ color: "rgba(220,200,255,0.6)", fontSize: 9, fontWeight: 900, letterSpacing: "0.2em" }}>SCORE</div>
            <div style={{ color: "#fbbf24", fontSize: 36, fontWeight: 900, lineHeight: 1, textShadow: "0 0 18px rgba(251,191,36,0.7)" }}>{score}</div>
            {localBest > 0 && (
              <div style={{ color: "rgba(220,200,255,0.5)", fontSize: 10, fontWeight: 700, marginTop: 3 }}>
                BEST {localBest}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            {phase === "playing" && showHowTo && (
              <div aria-live="polite" style={{ position: "absolute", left: 0, right: 0, top: "22%", zIndex: 6, textAlign: "center", pointerEvents: "none", fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
                <div style={{ display: "inline-block", padding: "9px 16px", borderRadius: 999, background: "rgba(4,0,20,0.72)", border: "1px solid rgba(103,232,249,0.5)", color: "#fff", fontSize: 15, fontWeight: 900, letterSpacing: "0.04em" }}>👆 TAP TO DROP THE BLOCK</div>
                <div style={{ marginTop: 6, color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 700, textShadow: "0 1px 4px #000" }}>Line it up. Whatever hangs over gets cut off.</div>
              </div>
            )}
            {phase === "playing" && (
              <div style={{
                padding: "6px 12px", borderRadius: 12,
                background: timeLeftMs < 60_000 ? "rgba(239,68,68,0.18)" : "rgba(34,211,238,0.14)",
                border: `1.5px solid ${timeLeftMs < 60_000 ? "rgba(239,68,68,0.55)" : "rgba(34,211,238,0.45)"}`,
                color: timeLeftMs < 60_000 ? "#fca5a5" : "#67e8f9",
                fontSize: 12, fontWeight: 900, letterSpacing: "0.1em",
                textShadow: `0 0 8px ${timeLeftMs < 60_000 ? "rgba(239,68,68,0.6)" : "rgba(34,211,238,0.6)"}`,
              }}>
                {Math.floor(timeLeftMs / 60000)}:{String(Math.floor((timeLeftMs % 60000) / 1000)).padStart(2, "0")}
              </div>
            )}
            {combo >= 2 && (
              <div style={{
                padding: "8px 12px", borderRadius: 12,
                background: "rgba(232,121,249,0.18)",
                border: "1.5px solid rgba(232,121,249,0.55)",
                color: "#f0abfc",
                fontSize: 13, fontWeight: 900, letterSpacing: "0.1em",
                textShadow: "0 0 10px rgba(232,121,249,0.7)",
              }}>
                {combo}× PERFECT
              </div>
            )}
          </div>
        </div>
      )}

      {/* COUNTDOWN */}
      {phase === "countdown" && (
        <div key={countdown} style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <span style={{
            fontSize: "clamp(110px, 22vw, 180px)", fontWeight: 900, color: "white",
            textShadow: "0 0 40px #e879f9, 0 0 80px #e879f9aa",
            animation: "bounce-scale-in 0.32s cubic-bezier(0.34,1.56,0.64,1) both",
          }}>{countdown <= 0 ? "GO!" : countdown}</span>
        </div>
      )}

      {/* Shared juice overlay (popups + shake + callouts) */}
      {(phase === "playing" || phase === "countdown") && (
        <JuiceOverlay {...juice} />
      )}

      {/* IDLE · same shape as rhythm/simon · back X, title, copy, guest chip,
            leaderboard preview, START. No decorative preview tower or stray
            "YOUR BEST" line · the leaderboard preview shows where you stand. */}
      {phase === "idle" && (
        <GameLobby
          title="Stack Tower"
          headline={<>Drop the block.<br />Stack it clean.</>}
          rules={<>Tap to drop. Anything hanging over the edge gets sliced off. <b>A perfect drop keeps the full width</b> and builds a combo.</>}
          cover="/games/covers/stack.jpg" focus="50% 60%"
          onExit={() => router.push("/dashboard")}
          onStart={startGame}
          modes={MODES} mode={mode} onPickMode={setMode}
          gameType={2} scoreWord="Tallest towers"
          onLeaderboard={() => router.push("/games/stack/leaderboard")}
          guest={!authed && !authPending} guestLeft={guestLeft}
          needsSetup={needsMint} onFinishSetup={() => router.push("/home?ob=1")}
          /* out of gas is the wrong message for a player who has not finished setup */
          gasBanner={needsMint ? null : <LowGasBanner status={gasStatus} approxSavesLeft={approxSavesLeft} onOpenHelp={() => setGasHelpOpen(true)} />}
          challenge={challenge ? <>{challenge.by} stacked <b>{challenge.blocks} blocks</b>. Build higher.</> : null}
          friends={<FriendsPlay room={room} gameName="Stack Tower" sharePath="/games/stack" atStart part="button" />}
        />
      )}

      <FriendsPlay room={room} gameName="Stack Tower" sharePath="/games/stack" atStart={phase === "idle"} progressWord="block" part="overlays" />

      {/* FINISHED */}
      {/* SAVE YOUR RUN · the M1 hero moment (casual mode only). Mounted only
          while saving so each open is a fresh, clean countdown. */}
      {phase === "saving" && (
        <SaveRunOverlay
          open
          score={score}
          game="stack"
          headline="TOWER TOPPLED"
          onSaved={resumeAfterSave}
          onDecline={declineSave}
        />
      )}

      {/* in a friend room the room's standings are the result screen */}
      {phase === "finished" && runModeRef.current !== "room" && (() => {
        const built = Math.max(0, levelRef.current - 1);
        const saving = submitting || signingOnChain;
        const d = challenge ? built - challenge.blocks : 0;
        return (
          <GameResult
            eyebrow="Tower down" tone="#0e7490" badge="🧱" score={score}
            notes={<>
              {score >= localBest && score > 0 && <span className="gold">New personal best</span>}
              {challenge && built > 0 && (
                <span className={d > 0 ? "good" : "warm"}>{d > 0 ? `You beat ${challenge.by} by ${d} block${d === 1 ? "" : "s"}!` : d === 0 ? `Level with ${challenge.by}. One more block takes it` : `${-d} block${d === -1 ? "" : "s"} short of ${challenge.by}. Build again`}</span>
              )}
            </>}
            stats={[{ label: "Blocks stacked", value: built }, { label: "Last combo", value: combo }]}
            saving={saving}
            playAgainLabel="Build again"
            onPlayAgain={startGame}
            onExit={() => {
              setPhase("idle");
              setScore(0); setCombo(0);
              setSubmitResult(null); setSubmitError(null); setTxError(null);
              submittedRef.current = false;
            }}
            challengeLabel={built > 0 ? `Challenge a friend to beat ${built} blocks` : null}
            onChallenge={() => {
              const url = `${window.location.origin}/games/stack?beat=${built}&mode=${runModeRef.current}&by=${encodeURIComponent("A friend")}`;
              const text = `I stacked ${built} blocks in Stack Tower. Build higher if you can 🔥`;
              if (navigator.share) navigator.share({ title: "Stack Tower", text, url }).catch(() => {});
              else window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank");
            }}
            status={mode !== "ranked"
              ? <FreePlayNote mode={modeById(mode).name} />
              : !authed ? <GuestScorePrompt nextPath="/games/stack" />
              : needsMint ? <MintScorePrompt score={score} />
              : <RunSaveStatus submitting={submitting} signingOnChain={signingOnChain} result={submitResult} error={submitError} txError={txError} score={score} onTopUp={() => setGasHelpOpen(true)} />}
            after={<>
              {submitResult && <button onClick={() => router.push("/games/stack/leaderboard")} style={{ padding: "10px 0", border: "none", background: "none", color: "#6d28d9", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>See the leaderboard ›</button>}
              <NextUp />
              {!saving && <ArenaCrossPromo />}
            </>}
          />
        );
      })()}

      {/* ═══ LEVEL-UP CELEBRATION ═══ */}
      <LevelUpToast
        level={levelUpToastLevel}
        onClose={() => setLevelUpToastLevel(null)}
      />

      {/* ═══ PET EVOLUTION CELEBRATION ═══ */}
      <PetEvolveToast
        pet={petEvolveToPet}
        newLevel={petEvolveAtLevel}
        onClose={() => setPetEvolveToPet(null)}
      />

      {/* ═══ PUSH OPT-IN · fires only after a successful submit so the ask
            lands after value is delivered, gated to once per device. ═══ */}
      <PushOptInModal
        walletAddress={address}
        trigger={!!submitResult}
      />

      {/* GasHelpSheet · the single destination for the lobby gate (player
          tapped START while blocked), the LowGasBanner on idle, and the
          post-fail rescue banner. Score is passed so the gas-help message
          includes "Last run: Stack Tower · 47" when the rescue fired
          after a real attempt, making the community ask actionable. */}
      <GasHelpSheet
        open={gasHelpOpen}
        onClose={() => setGasHelpOpen(false)}
        intent="gas-help"
        game="stack"
        score={score > 0 ? score : undefined}
      />

      {/* Guest free-play limit · sign-in gate once the free runs are used. */}
      <GuestLimitPrompt open={guestLimitOpen} onClose={() => setGuestLimitOpen(false)} game="Stack Tower" />
    </div>
  );
}

// ─── Lobby top-3 preview · same pattern as Rhythm/Simon ─────────────────────
// Pulls live top 3 from the subgraph using the current season's window. The
// season-window fetch goes through the backend so the cutoff matches sealed
// /api/seasons data; falls back to a 7d window if the backend is slow.
function StackTopPlayersPreview({ onViewAll }: { onViewAll: () => void }) {
  // Cache-seeded initial state · prefetch from /games or /dashboard
  // tap warms the cache, so on mount we already have data to paint.
  const seed = getCachedPreview(2);
  const [top, setTop] = useState<LeaderboardEntry[] | null>(seed?.top ?? null);
  const [seasonNum, setSeasonNum] = useState<number | null>(seed?.seasonNum ?? null);

  useEffect(() => {
    let cancelled = false;
    fetchPreview(2).then(v => {
      if (cancelled) return;
      setTop(v.top);
      setSeasonNum(v.seasonNum);
    }).catch(() => { if (!cancelled && top === null) setTop([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tierColor = (i: number) => i === 0 ? "#fbbf24" : i === 1 ? "#e2e8f0" : "#f97316";
  const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
  const fmtName = (e: LeaderboardEntry) => e.username ? `@${e.username.replace(/^@/, "")}` : `${e.player.slice(0, 6)}…${e.player.slice(-4)}`;

  return (
    <div style={{
      width: "min(320px, 86vw)",
      borderRadius: 18,
      padding: 2,
      background: "linear-gradient(135deg, rgba(251,146,60,0.6), rgba(251,146,60,0.16))",
      boxShadow: "0 8px 22px -8px rgba(251,146,60,0.55), 0 0 32px rgba(251,146,60,0.15)",
    }}>
      <div style={{
        borderRadius: 16,
        background: "linear-gradient(180deg, rgba(15,5,42,0.92), rgba(8,2,28,0.95))",
        padding: "12px 14px 10px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{
            fontSize: 10, fontWeight: 900, letterSpacing: "0.18em",
            color: "rgba(253,186,116,0.9)", textTransform: "uppercase",
          }}>Tallest this week</span>
          <span style={{ fontSize: 9.5, color: "rgba(220,200,255,0.45)", fontWeight: 800, letterSpacing: "0.08em" }}>{seasonNum ? `SEASON ${seasonNum} · LIVE` : "LIVE"}</span>
        </div>

        {top === null && (
          <div style={{ fontSize: 11, color: "rgba(220,200,255,0.55)", padding: "6px 2px" }}>Loading…</div>
        )}
        {top !== null && top.length === 0 && (
          <div style={{ fontSize: 11, color: "rgba(220,200,255,0.55)", padding: "6px 2px" }}>No towers yet · be first.</div>
        )}
        {top !== null && top.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {top.map((e, i) => (
              <div key={e.player} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ width: 18, textAlign: "center", fontSize: 13, color: tierColor(i), textShadow: `0 0 6px ${tierColor(i)}88` }}>{medal(i)}</span>
                <span style={{ flex: 1, color: "rgba(255,255,255,0.95)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtName(e)}</span>
                <span style={{ color: tierColor(i), fontWeight: 900, textShadow: `0 0 6px ${tierColor(i)}55`, letterSpacing: "0.02em" }}>{e.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        <button onClick={onViewAll} style={{
          marginTop: 2, padding: "7px 0", borderRadius: 10,
          background: "transparent", border: "none",
          color: "#fb923c", fontFamily: "inherit",
          fontSize: 11, fontWeight: 900, letterSpacing: "0.12em",
          cursor: "pointer",
        }}>VIEW LEADERBOARD ›</button>
      </div>
    </div>
  );
}
