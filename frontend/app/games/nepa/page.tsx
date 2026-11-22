"use client";

// ─── NEPA: UP LIGHT (gameType 4) ───────────────────────────────────────────────
// Power just came on. You have 3 sockets and a wall of devices that all need
// charging. Plug in the highest value-per-second devices and bank them before
// NEPA takes the light. Charging pauses while the light is OUT; a device mid-
// charge when the session ends banks nothing. Combo multiplier rewards clean,
// consecutive banks. ~40s burst.
//
// Build choices (siblings with rhythm/simon/stack):
//   • DOM/CSS + a light rAF timer (not heavy physics) — the grid + sockets are
//     plain elements; a single rAF ticks the clock, the light schedule, and
//     the charge bars.
//   • Phase machine: idle → ready (UP NEPA! intro) → playing → gameover.
//   • Server-issued SEED from /api/start-game drives the light-cut schedule so
//     the run is fair + replayable (games-backend/lib/nepaScoring.js). The
//     scoring here is a TS PORT of that module — the submitted score is a pure
//     replay of the recorded input log, so client + server points match by
//     construction (shadow-mode anti-cheat, see ANTICHEAT.md).
//   • Shared submit flow reused verbatim: startGame/signScore/submitScore,
//     recordScoreWithBackendSig, mint/guest overlays, useGameJuice.
//   • All visuals are inline SVG + CSS (neon purple/gold). An optional
//     /games/nepa-bg.png is layered in if present; a CSS gradient is the
//     fallback.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ATTRIBUTION_SUFFIX } from "@/lib/attribution";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import MintScorePrompt from "@/components/MintScorePrompt";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useAuthStatus } from "@/hooks/useRequireAuth";
import { PET_STAGES, petForLevel, type PetStage } from "@/lib/pets";
import { useGameJuice, JuiceOverlay } from "@/hooks/useGameJuice";
import { useAudioSettings } from "@/hooks/useAudioSettings";
import {
  playNepaPlug, playNepaBank, playNepaCombo,
  playNepaCut, playNepaReject, playNepaUnplug, playNepaBeep,
  playNepaGameOver, setNepaChargeIntensity,
  startNepaGroove, stopNepaGroove, nepaGrooveBlackout, nepaGrooveRelight,
  setNepaGrooveIntensity, setGeneratorOn, stopGenerator, playUpNepaFull,
  playNepaDip, playNepaVoiceUp, playNepaVoiceCut, playNepaVoiceCombo, playNepaCrowdCheer,
} from "@/hooks/useAppAudio";
import GuestScorePrompt from "@/components/GuestScorePrompt";
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
  type NepaInput,
} from "@/app/actions/game";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI, detectFeeSpread } from "@/lib/contracts";
import { type LeaderboardEntry } from "@/lib/subgraph";
import { fetchPreview, getCachedPreview } from "@/lib/leaderboardPreview";
import { GasHelpSheet } from "@/components/GasHelpSheet";
import { LowGasBanner } from "@/components/LowGasBanner";
import { useGasStatus } from "@/hooks/useGasStatus";
import { claimGas } from "@/app/actions/gas";
import { GASLESS_SKILL_GAMES } from "@/lib/gasless";

// Ambient, light-reactive canvas scene (procedural, zero assets). Lazy-loaded
// client-only — it touches canvas/rAF/ResizeObserver, so it must not prerender.
// `ssr: false` is valid here because this page is a Client Component (Next 16 /
// node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md). It is VISUALS
// ONLY: a pure function of its props, importing nothing from the game logic.
const NepaScene = dynamic(() => import("./NepaScene"), { ssr: false });

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// ═══ Scoring config · MUST mirror games-backend/lib/nepaScoring.js ═══════════
const SESSION_MS = 40_000;
const SOCKETS = 3;
const NAIRA_PER_POINT = 1_000;

type DeviceDef = {
  id: string; label: string; value: number; chargeMs: number;
  color: string; icon: (size: number) => React.ReactNode;
};

// Simple, legible inline-SVG glyphs per device. No external assets.
const DEVICES: DeviceDef[] = [
  { id: "phone",     label: "Phone",        value: 8_000,  chargeMs: 2_000, color: "#38bdf8",
    icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="7" y="2" width="10" height="20" rx="2.5" fill="#0ea5e9" stroke="#e0f2fe" strokeWidth="1.2"/><rect x="9" y="4.5" width="6" height="12" rx="1" fill="#0b1220"/><circle cx="12" cy="19" r="1.1" fill="#e0f2fe"/></svg> },
  { id: "lamp",      label: "Lamp",         value: 10_000, chargeMs: 2_500, color: "#f59e0b",
    icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M8 10a4 4 0 118 0c0 2-1.5 2.8-1.8 4H9.8C9.5 12.8 8 12 8 10z" fill="#fbbf24" stroke="#fde68a" strokeWidth="1"/><rect x="9.6" y="14.5" width="4.8" height="2" rx="0.6" fill="#a16207"/><rect x="10.2" y="16.5" width="3.6" height="4" rx="1" fill="#713f12"/></svg> },
  { id: "powerbank", label: "Power bank",   value: 12_000, chargeMs: 3_000, color: "#a78bfa",
    icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="5" y="5" width="14" height="14" rx="3" fill="#7c3aed" stroke="#ede9fe" strokeWidth="1.2"/><path d="M12 8l-2 4h3l-2 4" stroke="#fde68a" strokeWidth="1.6" fill="none" strokeLinejoin="round"/></svg> },
  { id: "fan",       label: "Rechg. fan",   value: 15_000, chargeMs: 4_000, color: "#34d399",
    icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="2" fill="#fde68a"/><path d="M12 10c-3-3-6-3-6-1s3 3 6 1zm0 4c3 3 6 3 6 1s-3-3-6-1zm-2-2c-3 3-3 6-1 6s3-3 1-6zm4 0c3-3 3-6 1-6s-3 3-1 6z" fill="#10b981" stroke="#d1fae5" strokeWidth="0.6"/></svg> },
  { id: "pump",      label: "Pump. machine",value: 25_000, chargeMs: 5_000, color: "#fb7185",
    icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="4" y="9" width="11" height="8" rx="1.5" fill="#e11d48" stroke="#fecdd3" strokeWidth="1.1"/><circle cx="9.5" cy="13" r="2.4" fill="#0b1220" stroke="#fecdd3" strokeWidth="0.8"/><rect x="15" y="11" width="5" height="3" rx="1" fill="#9f1239"/><rect x="18.4" y="7" width="1.6" height="5" rx="0.8" fill="#9f1239"/></svg> },
  { id: "inverter",  label: "Inverter batt",value: 30_000, chargeMs: 6_000, color: "#f472b6",
    icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="4" y="6" width="16" height="12" rx="2" fill="#be185d" stroke="#fbcfe8" strokeWidth="1.2"/><rect x="7" y="3.5" width="3" height="3" rx="0.8" fill="#fbcfe8"/><rect x="14" y="3.5" width="3" height="3" rx="0.8" fill="#fbcfe8"/><path d="M11 9l-2 4h3l-2 4" stroke="#fde68a" strokeWidth="1.5" fill="none" strokeLinejoin="round"/></svg> },
  { id: "fridge",    label: "Small fridge", value: 40_000, chargeMs: 8_000, color: "#fbbf24",
    icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="7" y="2.5" width="10" height="19" rx="2" fill="#f59e0b" stroke="#fef3c7" strokeWidth="1.2"/><path d="M7 10h10" stroke="#fef3c7" strokeWidth="1.1"/><rect x="14" y="5" width="1.4" height="3" rx="0.7" fill="#78350f"/><rect x="14" y="12" width="1.4" height="4" rx="0.7" fill="#78350f"/></svg> },
];
const DEVICE_BY_ID: Record<string, DeviceDef> = Object.fromEntries(DEVICES.map(d => [d.id, d]));

// Golden RARE device · the "ac" freezer. NOT part of the permanent tray — it
// only appears (and is pluggable) inside its seed-driven availability window.
// value/chargeMs MUST match nepaEvents.golden + the backend roster.
const GOLDEN_AC: DeviceDef = {
  id: "ac", label: "Freezer", value: 80_000, chargeMs: 7_000, color: "#fde68a",
  icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" fill="#fbbf24" stroke="#fffbeb" strokeWidth="1.2"/><path d="M5 11h14" stroke="#fffbeb" strokeWidth="1.1"/><path d="M12 5.5v3.5M10.4 6.6l3.2 1.8M13.6 6.6l-3.2 1.8" stroke="#b45309" strokeWidth="0.9" strokeLinecap="round"/><rect x="15.4" y="13" width="1.4" height="4" rx="0.7" fill="#78350f"/></svg>,
};
// Lookup that also resolves the golden device, for charge/value/color/label.
const deviceOrGolden = (id: string): DeviceDef | undefined => (id === "ac" ? GOLDEN_AC : DEVICE_BY_ID[id]);

// Photographic device sprite (transparent PNG in /public/games/nepa/devices/).
// id maps 1:1 to the filename. A fixed square box + object-fit:contain keeps the
// varied aspect ratios (tall phone, wide powerbank/pump) from distorting or
// overflowing. Plain <img> (not next/image) per frontend/AGENTS.md — same pattern
// the background uses. The inline SVG glyph stays as the onError fallback.
function DeviceSprite({ id, size }: { id: string; size: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <>{deviceOrGolden(id)?.icon(size) ?? null}</>;
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/games/nepa/devices/${id}.png`}
        alt=""
        draggable={false}
        onError={() => setOk(false)}
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}

function comboMult(combo: number) {
  return 1 + 0.15 * Math.min(Math.max(combo - 1, 0), 6);
}

// Combo depths that get the extra milestone sparkle on top of the bank chime.
const BANK_COMBO_MILESTONES = new Set([3, 5, 7, 10, 15, 20]);

// ─── Deterministic PRNG · byte-identical to the backend module ───────────────
function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function nepaRand(seed: string) {
  return mulberry32(xmur3(String(seed))());
}

type LightSeg = { on: boolean; start: number; end: number };
function nepaLightSchedule(seed: string, totalMs: number): LightSeg[] {
  const rand = nepaRand(String(seed) + "|light");
  const segs: LightSeg[] = [];
  let t = 0;
  let on = true;
  for (let guard = 0; guard < 1000 && t < totalMs; guard++) {
    let dur: number;
    if (on) {
      const frac = t / totalMs;
      const base = 6000 - frac * 3500;
      dur = base + (rand() - 0.5) * 1500;
      if (dur < 2000) dur = 2000;
    } else {
      dur = 1200 + rand() * 1800;
    }
    dur = Math.round(dur);
    const end = Math.min(totalMs, t + dur);
    segs.push({ on, start: t, end });
    t = end;
    on = !on;
  }
  return segs;
}
function lightOnAt(segs: LightSeg[], t: number): boolean {
  for (const s of segs) if (t >= s.start && t < s.end) return s.on;
  return false;
}
type GenWindow = { start: number; end: number } | null;
// A ms counts toward charge if the LIGHT is ON, OR it falls inside the optional
// gen window (the GENERATOR power-up charges THROUGH a light cut). genWindow
// null/absent → original ON-only accrual. MUST stay identical to the backend.
function chargeCompleteTime(segs: LightSeg[], startT: number, needMs: number, totalMs: number, genWindow?: GenWindow): number {
  let remaining = needMs;
  const gw = genWindow && typeof genWindow.start === "number" ? genWindow : null;
  for (const seg of segs) {
    if (seg.end <= startT) continue;
    const segStart = Math.max(seg.start, startT);
    if (segStart >= totalMs) break;
    if (seg.on) {
      const avail = seg.end - segStart;
      if (avail >= remaining) return segStart + remaining;
      remaining -= avail;
    } else if (gw) {
      const lo = Math.max(segStart, gw.start);
      const hi = Math.min(seg.end, gw.end);
      if (hi > lo) {
        const avail = hi - lo;
        if (avail >= remaining) return lo + remaining;
        remaining -= avail;
      }
    }
  }
  return Infinity;
}
// Cumulative charge time since plug, up to `now` — drives the live bar. Counts
// ON time plus any gen-window OUT time, matching chargeCompleteTime.
function chargedSoFar(segs: LightSeg[], startT: number, now: number, genWindow?: GenWindow): number {
  let acc = 0;
  const gw = genWindow && typeof genWindow.start === "number" ? genWindow : null;
  for (const seg of segs) {
    if (seg.end <= startT) continue;
    if (seg.start >= now) break;
    if (seg.on) acc += Math.min(seg.end, now) - Math.max(seg.start, startT);
    else if (gw) {
      const lo = Math.max(seg.start, startT, gw.start);
      const hi = Math.min(seg.end, now, gw.end);
      if (hi > lo) acc += hi - lo;
    }
  }
  return acc;
}

// ─── Chaos events · pure function of the seed · byte-identical to the backend ─
// SEPARATE PRNG stream ("<seed>:events") from the light schedule. Draw order is
// fixed (dm.start, golden.start, rat.start, rat.socket). Windows may overlap and
// their multipliers stack. See games-backend/lib/nepaScoring.js · nepaEvents.
type NepaEvents = {
  doubleMoney: { start: number; end: number };
  golden: { device: string; value: number; chargeMs: number; start: number; end: number };
  rat: { start: number; end: number; socket: number };
  frenzy: { start: number; mult: number };
};
function nepaEvents(seed: string, totalMs: number): NepaEvents {
  const rng = mulberry32(xmur3(String(seed) + ":events")());
  const dmStart = 8000 + Math.floor(rng() * 12000);
  const doubleMoney = { start: dmStart, end: dmStart + 5000 };
  const gStart = 10000 + Math.floor(rng() * 15000);
  const golden = { device: "ac", value: 80000, chargeMs: 7000, start: gStart, end: gStart + 8000 };
  const rStart = 13000 + Math.floor(rng() * 13000);
  const ratSocket = Math.floor(rng() * 3);
  const rat = { start: rStart, end: rStart + 4000, socket: ratSocket };
  const frenzy = { start: totalMs - 10000, mult: 1.5 };
  return { doubleMoney, golden, rat, frenzy };
}

// Pure TAP-TO-GRAB replay · identical algorithm to games-backend/lib/nepaScoring.js.
// No auto-bank: a full device sits READY in its socket until the player taps to
// BANK it. A bank credits only if t >= bankT (the device is really full) and the
// socket still holds that device; otherwise it is ignored. An early unplug (t <
// bankT) wastes the device and resets combo. Devices still in a socket at
// session end are forfeit. See the backend module for the full contract.
function computeNepaScore(seed: string, inputLog: NepaInput[]) {
  const segs = nepaLightSchedule(seed, SESSION_MS);
  // Chaos events for this seed. The golden "ac" is added to a LOCAL roster
  // (charge/value lookups only) — never a permanent device.
  const ev = nepaEvents(seed, SESSION_MS);
  const roster: Record<string, { value: number; chargeMs: number }> = {};
  for (const d of DEVICES) roster[d.id] = { value: d.value, chargeMs: d.chargeMs };
  roster.ac = { value: ev.golden.value, chargeMs: ev.golden.chargeMs };

  const events = inputLog
    .filter(e => e && (e.action === "plug" || e.action === "unplug" || e.action === "bank" || e.action === "gen") && typeof e.t === "number" && isFinite(e.t))
    .slice()
    .sort((a, b) => a.t - b.t);
  const sockets: ({ device: string; value: number; plugT: number; bankT: number } | null)[] = new Array(SOCKETS).fill(null);
  let nairaScore = 0, combo = 0, banked = 0, wasted = 0, maxCombo = 0;
  let genWindow: GenWindow = null;   // first 'gen' → [tg, tg+6000]
  let ratApplied = false;            // the rat fries its socket once

  for (const e of events) {
    const t = Math.max(0, Math.min(SESSION_MS, e.t));

    // RAT · one-time injection at the first event crossing rat.start.
    if (!ratApplied && t >= ev.rat.start) {
      ratApplied = true;
      if (sockets[ev.rat.socket]) { combo = 0; wasted += 1; sockets[ev.rat.socket] = null; }
    }

    const sock = e.socket;
    const sockOk = typeof sock === "number" && sock >= 0 && sock < sockets.length;

    if (e.action === "gen") {
      if (genWindow === null) {
        genWindow = { start: t, end: t + 6000 };
        for (let s = 0; s < sockets.length; s++) {
          const occ = sockets[s];
          if (occ) {
            const dev = roster[occ.device];
            if (dev) occ.bankT = chargeCompleteTime(segs, occ.plugT, dev.chargeMs, SESSION_MS, genWindow);
          }
        }
      }
      continue;
    }

    if (e.action === "plug") {
      const dev = e.device ? roster[e.device] : undefined;
      if (!dev) continue;
      if (!sockOk) continue;
      if (sockets[sock!]) continue;
      // GOLDEN · "ac" pluggable ONLY inside its window.
      if (e.device === "ac" && !(t >= ev.golden.start && t < ev.golden.end)) continue;
      // RAT · no plugging the rat socket while the rat owns it.
      if (sock === ev.rat.socket && t >= ev.rat.start && t < ev.rat.end) continue;
      sockets[sock!] = { device: e.device!, value: dev.value, plugT: t, bankT: chargeCompleteTime(segs, t, dev.chargeMs, SESSION_MS, genWindow) };
    } else if (e.action === "bank") {
      if (!sockOk) continue;
      const occ = sockets[sock!];
      if (occ && occ.device === e.device && t >= occ.bankT) {
        combo += 1; if (combo > maxCombo) maxCombo = combo;
        // Multipliers STACK: combo × double-money (×2) × frenzy (×1.5).
        let gain = occ.value * comboMult(combo);
        if (t >= ev.doubleMoney.start && t < ev.doubleMoney.end) gain *= 2;
        if (t >= ev.frenzy.start) gain *= ev.frenzy.mult;
        nairaScore += Math.round(gain);
        banked += 1; sockets[sock!] = null;
      }
    } else { // unplug
      if (!sockOk) continue;
      const occ = sockets[sock!];
      if (occ && occ.device === e.device) {
        if (t < occ.bankT) { combo = 0; wasted += 1; }
        sockets[sock!] = null;
      }
    }
  }
  // RAT fallback · fry a device parked in the rat socket if no event crossed.
  if (!ratApplied && sockets[ev.rat.socket]) { combo = 0; wasted += 1; sockets[ev.rat.socket] = null; }
  // Session end: no sweep. Any device still in a socket is forfeit.
  const points = Math.min(1_000_000, Math.max(0, Math.floor(nairaScore / NAIRA_PER_POINT)));
  return { nairaScore, points, banked, wasted, maxCombo };
}

const naira = (n: number) => "₦" + Math.round(n).toLocaleString();

// ─── Live socket state (UI) ──────────────────────────────────────────────────
type Slot = { device: string; plugT: number; bankT: number } | null;
type Phase = "idle" | "ready" | "playing" | "gameover";

// Pet reaction events — bank = celebrate, cut = wilt/cover, relight = cheer,
// panic = final-5s dread. Mirrors Simon's PetEvent pattern (ts retriggers it).
type NepaPetEvent = { type: "bank" | "cut" | "relight" | "panic"; ts: number };
// Visual-only pulse handed to the ambient <NepaScene> layer. Emitted at edges
// that ALREADY fire in the loop/tapSocket — never new game logic. `ts` retriggers.
type NepaSceneEvent = { type: "cut" | "relight" | "bank" | "dip"; ts: number };
// Coin-burst spawned on a bank — reused for the Stack-style shard particles.
type BankBurst = { id: number; socket: number; color: string };

type SubmitResult = {
  rank?: number; xpEarned?: number; xp?: number; level?: number;
  leveledUp?: boolean; isNewPb?: boolean; prevBest?: number;
  newAchievements?: { id: string; name: string; icon?: string; desc?: string }[];
};

export default function NepaGamePage() {
  const router = useRouter();
  const { address } = useAccount();
  const { authed, pending: authPending } = useAuthStatus();
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const needsMint = authed && hasMinted === false;
  const isGuest = !authed && !authPending;

  const { getAccessToken, user } = usePrivy();
  const { writeContractAsync } = useWriteContract();
  const isMiniPay = useIsMiniPay();
  const isEmbeddedWallet = user?.linkedAccounts?.some(
    (a: { type: string; walletClientType?: string }) => a.type === "wallet" && a.walletClientType === "privy",
  );

  const juice = useGameJuice();
  const { status: gasStatus } = useGasStatus();

  // Audio prefs (for haptics gating) + OS reduced-motion preference. Audio is
  // independent of motion — only decorative animation respects reduce.
  const audioSettings = useAudioSettings();
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => { reduceMotionRef.current = reduceMotion; }, [reduceMotion]);

  // ── Guest free-play limit ──
  const [guestLeft, setGuestLeft] = useState(3);
  const [guestLimitOpen, setGuestLimitOpen] = useState(false);
  const guestCountedRef = useRef(false);
  useEffect(() => { setGuestLeft(guestPlaysLeft("nepa")); }, []);

  // ── Player level (pet) ──
  const [playerLevel, setPlayerLevel] = useState(1);
  useEffect(() => {
    if (!address) return;
    fetch(`${BACKEND_URL}/api/user/${address}`).then(r => r.json()).then(d => setPlayerLevel(d.level || 1)).catch(() => {});
  }, [address]);

  // ── Phase + HUD state ──
  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);              // banked ₦ (display)
  const [combo, setCombo] = useState(0);
  const [lightOn, setLightOn] = useState(true);
  const [timeLeftMs, setTimeLeftMs] = useState(SESSION_MS);
  const [slots, setSlots] = useState<Slot[]>([null, null, null]);
  const [tick, setTick] = useState(0);                 // forces charge-bar repaint

  // ── Refs (game loop reads/writes these; HUD mirrors them) ──
  const seedRef = useRef<string>("");
  const scheduleRef = useRef<LightSeg[]>([]);
  // Chaos events for the run (seed-driven; mirrors the replay). The generator
  // window + one-shot flags live in refs the loop reads/writes.
  const eventsRef = useRef<NepaEvents | null>(null);
  const genWindowRef = useRef<GenWindow>(null);
  const genUsedRef = useRef(false);     // one generator pop per run
  const ratAppliedRef = useRef(false);  // the rat fries its socket once (live FX)
  const slotsRef = useRef<Slot[]>([null, null, null]);
  const comboRef = useRef(0);
  const scoreRef = useRef(0);
  const inputLogRef = useRef<NepaInput[]>([]);
  const startMsRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const loopRef = useRef<() => void>(() => {});
  const sessionTokenRef = useRef<string | null>(null);
  const submittedRef = useRef(false);
  const startingRef = useRef(false);

  // Edge-detection refs (one-shot drama, never per-frame):
  const prevLightOnRef = useRef(true);         // light ON/OFF transitions
  const prevSecsRef = useRef(SESSION_MS / 1000); // countdown-beep edges
  const chargeIntensityRef = useRef(-1);        // last hum intensity we pushed
  // Feel-tuning counters (reset in startGame). The FIRST cut flashes bigger and
  // the FIRST relight gets the full riser; later ones are lighter so the drama
  // doesn't fatigue across the 4-6 light cycles of a run.
  const cutCountRef = useRef(0);
  const relightCountRef = useRef(0);
  const intensityFiredRef = useRef(false);     // groove final-10s driving mode, once
  const fullPlayedRef = useRef(false);          // "UP NEPA" full voice — once per run, on the ready beat
  // Throttle the pet's bank celebration so a fast combo chain can't machine-gun
  // the poke animation (min interval between pet "bank" events).
  const lastPetBankRef = useRef(0);
  const PET_BANK_THROTTLE_MS = 450;
  // Pre-cut voltage dip — one tell per ON segment just before it ends. Reads
  // scheduleRef only (deterministic, scoring-neutral); dipSegStartRef keys the
  // "fired this segment" flag so it resets when the light segment changes.
  const dipFiredRef = useRef(false);
  const dipSegStartRef = useRef(-1);
  // Ambient street-gen swell timer — neighbours fire up their gen ~1.5s into a
  // blackout; cleared on relight / end so it never swells after the light's back.
  const genSwellTimerRef = useRef<number | null>(null);
  // Voice throttle — a pidgin line won't restack on rapid light toggles.
  const lastVoiceAtRef = useRef(0);
  const VOICE_THROTTLE_MS = 1200;
  const comboVoiceFiredRef = useRef(false);  // "charge sharp sharp" — once per run

  // Juice/FX state for the reactive layer.
  const [petEvent, setPetEvent] = useState<NepaPetEvent | null>(null);
  const firePetEvent = useCallback((type: NepaPetEvent["type"]) => setPetEvent({ type, ts: performance.now() }), []);
  // Ambient scene pulse — fired alongside the existing edge detections below.
  // Pure visual; drives nothing in scoring/replay.
  const [sceneEvent, setSceneEvent] = useState<NepaSceneEvent | null>(null);
  const fireSceneEvent = useCallback((type: NepaSceneEvent["type"]) => setSceneEvent({ type, ts: performance.now() }), []);
  // Fire a pidgin voice line unless one played < VOICE_THROTTLE_MS ago, so rapid
  // light toggles (or a bank landing on a cut) never stack two lines over each other.
  const tryVoice = useCallback((play: () => void) => {
    const now = performance.now();
    if (now - lastVoiceAtRef.current < VOICE_THROTTLE_MS) return;
    lastVoiceAtRef.current = now;
    play();
  }, []);
  const [flashKey, setFlashKey] = useState(0);              // light-cut power-trip flicker
  const [flashBig, setFlashBig] = useState(false);          // first cut flashes bigger
  const [relightKey, setRelightKey] = useState(0);          // relight filament surge
  const [dipKey, setDipKey] = useState(0);                  // pre-cut voltage-dip flicker
  const [bankBursts, setBankBursts] = useState<BankBurst[]>([]);
  const burstIdRef = useRef(1);
  const [plugKeys, setPlugKeys] = useState<number[]>([0, 0, 0]); // per-socket plug bounce
  const [rejectFx, setRejectFx] = useState<{ id: string; key: number } | null>(null); // device shake
  const rejectKeyRef = useRef(0);

  // One-time onboarding card (gated on a localStorage flag; see handleStart).
  const [howToOpen, setHowToOpen] = useState(false);

  // Generator button disabled-state mirror (ref drives the logic; state the UI).
  const [genUsed, setGenUsed] = useState(false);

  // Run stats threaded out of endGame's computeNepaScore result into the finish
  // screen — maxCombo + devices banked are computed anyway, this surfaces them.
  const [finalStats, setFinalStats] = useState<{ maxCombo: number; banked: number }>({ maxCombo: 0, banked: 0 });

  // ── Submission UI state ──
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signingOnChain, setSigningOnChain] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [levelUpToastLevel, setLevelUpToastLevel] = useState<number | null>(null);
  const [petEvolveToPet, setPetEvolveToPet] = useState<typeof PET_STAGES[number] | null>(null);
  const [petEvolveAtLevel, setPetEvolveAtLevel] = useState(1);
  const [gasHelpOpen, setGasHelpOpen] = useState(false);
  const [bgOk, setBgOk] = useState(true);
  // Blackout frame (nepa-bg-out.png) — a second painted bg that cross-fades in
  // when the light is OUT. If the asset 404s we fall back to the brightness-dim
  // on the lit frame (see the bg block), so a missing file never breaks the scene.
  const [bgOutOk, setBgOutOk] = useState(true);

  // Gated on the user's hapticsOn preference (was firing unconditionally).
  const haptic = useCallback((ms: number | number[] = 8) => {
    if (!audioSettings.hapticsOn) return;
    try { if ("vibrate" in navigator) navigator.vibrate(ms); } catch { /* no-op */ }
  }, [audioSettings.hapticsOn]);

  // Count a guest run once it finishes.
  useEffect(() => {
    if (phase === "gameover" && isGuest && !guestCountedRef.current) {
      guestCountedRef.current = true;
      bumpGuestPlayed("nepa");
      setGuestLeft(guestPlaysLeft("nepa"));
    }
  }, [phase, isGuest]);

  // ─── Core game loop ──────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    // Authoritative display score = pure replay of the recorded log (matches
    // the server). Keeps what the player sees identical to what they submit.
    const final = computeNepaScore(seedRef.current, inputLogRef.current);
    scoreRef.current = final.nairaScore;
    setScore(final.nairaScore);
    setFinalStats({ maxCombo: final.maxCombo, banked: final.banked });
    setPhase("gameover");
    // Game-over drama (bump reserved for cut + game-over only).
    playNepaGameOver();
    setNepaChargeIntensity(0);
    stopNepaGroove();      // kill the groove scheduler + fade the bus
    stopGenerator();       // tear down the generator idle
    if (genSwellTimerRef.current) { clearTimeout(genSwellTimerRef.current); genSwellTimerRef.current = null; }
    chargeIntensityRef.current = -1;
    if (!reduceMotionRef.current) juice.bump(20);
    firePetEvent("cut");
  }, [juice, firePetEvent]);

  const loop = useCallback(() => {
    // HIGH-1: end the run BEFORE reading the light. On the frame that crosses
    // SESSION_MS the schedule reports light OUT (past the last segment), which
    // used to register a phantom light→out cut on a clean finish. Bailing first
    // means the final frame never fires that false edge.
    const now = performance.now() - startMsRef.current;
    if (now >= SESSION_MS) { endGame(); return; }
    const segs = scheduleRef.current;
    const onNow = lightOnAt(segs, now);

    // ── EDGE-DETECT the light transitions — ONE-SHOT per edge, never per frame ──
    if (prevLightOnRef.current !== onNow) {
      prevLightOnRef.current = onNow;
      if (!onNow) {
        // true → false: NEPA takes the light. Signature cut composite.
        // First cut of the run flashes bigger so the mechanic lands; later cuts
        // use the standard flash so the whiteout doesn't become noise.
        cutCountRef.current += 1;
        setFlashBig(cutCountRef.current === 1);
        setFlashKey(k => k + 1);
        if (!reduceMotionRef.current) juice.bump(cutCountRef.current === 1 ? 22 : 18);
        juice.fireCallout({ text: "NEPA!", sub: "light don go", color: "#fb7185" });
        playNepaCut();
        nepaGrooveBlackout();     // groove snaps to silence (scheduler keeps running)
        tryVoice(playNepaVoiceCut); // "Ahhh NEPA don carry light" — real pidgin voice
        // AMBIENT street-gen INVERSION: the neighbours fire up their generator a
        // beat into the blackout (not on the light). popGenerator (the power-up)
        // is untouched; this only drives the light-tied ambient gen.
        if (genSwellTimerRef.current) clearTimeout(genSwellTimerRef.current);
        genSwellTimerRef.current = window.setTimeout(() => { setGeneratorOn(true); genSwellTimerRef.current = null; }, 1500);
        setNepaChargeIntensity(0);
        chargeIntensityRef.current = 0;
        firePetEvent("cut");
        fireSceneEvent("cut");
        haptic([30, 40, 60]);
      } else {
        // false → true: the light is back. The full riser + "UP NEPA!" callout
        // fires STRONG only on the first relight; later relights are callout-only
        // (no riser, lighter haptic) so 4-6 relights a run don't fatigue.
        relightCountRef.current += 1;
        setRelightKey(k => k + 1);
        nepaGrooveRelight();      // groove slams back in phase, every relight
        fireSceneEvent("relight"); // ambient scene: street windows flick back on
        tryVoice(playNepaVoiceUp); // "Up NEPA! dem don bring light" — signature pidgin voice
        playNepaCrowdCheer();     // short, quiet crowd "ayyy" under the voice
        // AMBIENT street-gen INVERSION: wind the neighbours' gen DOWN now the
        // light's back. Cancel any pending blackout swell. Leave it running if the
        // player's GEN power-up window is still open (that gen is theirs, not the street's).
        if (genSwellTimerRef.current) { clearTimeout(genSwellTimerRef.current); genSwellTimerRef.current = null; }
        {
          const gw = genWindowRef.current;
          if (!(gw && now < gw.end)) setGeneratorOn(false);
        }
        if (relightCountRef.current === 1) {
          juice.fireCallout({ text: "UP NEPA!", sub: "charge fast", color: "#86efac" });
          firePetEvent("relight");
          haptic(10);
        } else {
          juice.fireCallout({ text: "light's back", color: "#86efac" });
          haptic(6);
        }
      }
    }
    setLightOn(onNow);
    const remainMs = Math.max(0, SESSION_MS - now);
    setTimeLeftMs(remainMs);

    // ── PRE-CUT VOLTAGE DIP (the "tell") — deterministic, reads scheduleRef only.
    // On the ON segment just before it ends (and a real cut follows), flicker the
    // bulb + a soft low "vrrm" ~0.5s out. One-shot per segment; scoring-neutral.
    {
      let curSeg: LightSeg | null = null;
      for (const s of segs) { if (now >= s.start && now < s.end) { curSeg = s; break; } }
      if (curSeg) {
        if (curSeg.start !== dipSegStartRef.current) { dipSegStartRef.current = curSeg.start; dipFiredRef.current = false; }
        if (curSeg.on && !dipFiredRef.current && curSeg.end < SESSION_MS && (curSeg.end - now) <= 500) {
          dipFiredRef.current = true;
          setDipKey(k => k + 1);
          fireSceneEvent("dip");
          playNepaDip();
        }
      }
    }

    // ── RAT · fire ONCE when the run time crosses rat.start. Purely cosmetic —
    // it logs nothing; the replay re-derives the rat from the seed. It clears
    // the fried socket early so the player can't bank it (mirrors the replay,
    // which empties that socket before the first event at/after rat.start).
    const ev = eventsRef.current;
    if (ev && !ratAppliedRef.current && now >= ev.rat.start) {
      ratAppliedRef.current = true;
      const rs = ev.rat.socket;
      if (slotsRef.current[rs]) {
        slotsRef.current[rs] = null;
        setSlots([...slotsRef.current]);
        comboRef.current = 0; setCombo(0);
        juice.lossPopup(50, 70, "🐀 RAT!");
        playNepaUnplug();
        if (!reduceMotionRef.current) juice.bump(14);
        haptic([20, 30, 20]);
      }
    }

    // Groove shifts to driving mode for the final 10s — fire ONCE per run.
    if (!intensityFiredRef.current && remainMs <= 10_000) {
      intensityFiredRef.current = true;
      setNepaGrooveIntensity(1);
    }

    // TAP-TO-GRAB: no auto-bank. A full device stays READY in its socket until
    // the player taps to bank it (see tapSocket). The loop only advances time,
    // light, charge visuals and audio — crediting happens on the tap.

    // ── Charge hum intensity — push only when occupancy/light changes ──
    // Count only sockets still CHARGING (not yet full); a READY device makes no
    // charge hum. LOW-3: plain loop, no per-frame array allocation.
    let activeCharging = 0;
    if (onNow) {
      for (let s = 0; s < slotsRef.current.length; s++) {
        const occ = slotsRef.current[s];
        if (occ && now < occ.bankT) activeCharging += 1;
      }
    }
    if (activeCharging !== chargeIntensityRef.current) {
      chargeIntensityRef.current = activeCharging;
      setNepaChargeIntensity(activeCharging);
    }

    // ── Final-5s countdown beeps + pet panic — edge-detect on the second ──
    const secs = Math.ceil(Math.max(0, SESSION_MS - now) / 1000);
    if (secs !== prevSecsRef.current) {
      prevSecsRef.current = secs;
      if (secs <= 5 && secs > 0) { playNepaBeep(secs === 1); firePetEvent("panic"); }
    }

    setTick(t => (t + 1) % 1_000_000);

    rafRef.current = requestAnimationFrame(() => loopRef.current());
  }, [juice, endGame, haptic, firePetEvent, fireSceneEvent, tryVoice]);

  // Keep the latest loop in a ref so the rAF scheduling never depends on loop's
  // identity. juice returns a fresh object every render, so loop is recreated
  // every render; if the kick effect below listed loop as a dep, each frame's
  // setTick re-render would tear the effect down and reset startMsRef — which
  // freezes time (timer stuck, nothing charges or banks).
  useEffect(() => { loopRef.current = loop; }, [loop]);

  // Kick the loop when entering "playing" (depends on phase ONLY).
  useEffect(() => {
    if (phase !== "playing") return;
    startMsRef.current = performance.now();
    rafRef.current = requestAnimationFrame(() => loopRef.current());
    return () => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ─── Plug / unplug ─────────────────────────────────────────────────────────
  const plugDevice = useCallback((deviceId: string) => {
    if (phase !== "playing") return;
    // Use the ROUNDED offset as the canonical clock — the same value we log and
    // the same value the replay reads — so slot.bankT here is byte-identical to
    // the replay's bankT. Keeps the live full/charging decision in lockstep with
    // the authoritative score.
    const t = Math.round(performance.now() - startMsRef.current);
    const ev = eventsRef.current;

    const rejectBlip = () => {
      juice.lossPopup(50, 70, deviceId === "ac" ? "GONE" : "NO SOCKET");
      playNepaReject();
      const rk = ++rejectKeyRef.current;
      setRejectFx({ id: deviceId, key: rk });
      setTimeout(() => setRejectFx(f => (f && f.key === rk ? null : f)), 320);
      haptic(16);
    };

    // GOLDEN · "ac" is only pluggable inside its window (the card hides
    // otherwise, but stay honest with the replay which rejects out-of-window).
    if (deviceId === "ac" && !(ev && t >= ev.golden.start && t < ev.golden.end)) { rejectBlip(); return; }

    // Find a free socket, SKIPPING the rat socket while the rat owns it — the
    // replay rejects any plug there during the window, so live must never log one.
    const ratActive = !!(ev && t >= ev.rat.start && t < ev.rat.end);
    let free = -1;
    for (let i = 0; i < slotsRef.current.length; i++) {
      if (slotsRef.current[i] !== null) continue;
      if (ratActive && ev && i === ev.rat.socket) continue;
      free = i; break;
    }
    if (free === -1) { rejectBlip(); return; }

    const dev = deviceOrGolden(deviceId);
    if (!dev) return;
    const bankT = chargeCompleteTime(scheduleRef.current, t, dev.chargeMs, SESSION_MS, genWindowRef.current);
    slotsRef.current[free] = { device: deviceId, plugT: t, bankT };
    inputLogRef.current.push({ device: deviceId, socket: free, action: "plug", t });
    setSlots([...slotsRef.current]);
    // Retrigger the socket plug-in bounce for THIS socket only.
    setPlugKeys(k => { const n = [...k]; n[free] = (n[free] || 0) + 1; return n; });
    playNepaPlug();
    haptic(8);
  }, [phase, juice, haptic]);

  // Tapping an occupied socket: a FULL device BANKS (grab the charge), a still-
  // CHARGING device UNPLUGS (waste + combo reset). The full/charging split is the
  // player-facing meaning of the tap; both are logged so the replay credits the
  // same way (bank only credits when t >= bankT; the UI only banks when full, so
  // they agree by construction).
  const tapSocket = useCallback((socket: number) => {
    if (phase !== "playing") return;
    const occ = slotsRef.current[socket];
    if (!occ) return;
    // Decide full vs charging on the SAME rounded clock the replay credits on,
    // so the tap's meaning here matches what computeNepaScore will do with it.
    const t = Math.round(performance.now() - startMsRef.current);
    const ev = eventsRef.current;
    // RAT · the rat socket is un-bankable while the rat owns it. The replay
    // fries it before handling any event at/after rat.start, so a live bank
    // there would be rejected on replay — block it deterministically (the
    // render guard can lag a frame; this does not).
    if (ev && socket === ev.rat.socket && t >= ev.rat.start && t < ev.rat.end) return;

    if (t >= occ.bankT) {
      // ── BANK the full device ──
      inputLogRef.current.push({ device: occ.device, socket, action: "bank", t });
      const dev = deviceOrGolden(occ.device)!;
      comboRef.current += 1;
      // Multipliers STACK exactly as computeNepaScore: combo × double-money × frenzy.
      let gainF = dev.value * comboMult(comboRef.current);
      if (ev && t >= ev.doubleMoney.start && t < ev.doubleMoney.end) gainF *= 2;
      if (ev && t >= ev.frenzy.start) gainF *= ev.frenzy.mult;
      const gain = Math.round(gainF);
      scoreRef.current += gain;
      slotsRef.current[socket] = null;
      setSlots([...slotsRef.current]);
      setScore(scoreRef.current);
      setCombo(comboRef.current);
      juice.scorePopup(50, 42, Math.round(gain / 1000), "gem");
      if (comboRef.current >= 3) juice.fireCallout({ text: `COMBO ×${comboRef.current}`, sub: "clean charging", color: "#fbbf24" }, comboRef.current);
      playNepaBank(comboRef.current);
      fireSceneEvent("bank");   // ambient scene: gold sparkle burst near the sockets
      if (BANK_COMBO_MILESTONES.has(comboRef.current)) playNepaCombo();
      // COMBO voice callout — "Oya charge am sharp sharp" once per run, when the
      // streak hits 5 (not on every bank). Throttle shields it from stacking.
      if (comboRef.current === 5 && !comboVoiceFiredRef.current) {
        comboVoiceFiredRef.current = true;
        tryVoice(playNepaVoiceCombo);
      }
      // Throttle the pet's celebrate poke — a fast combo chain banks several
      // devices per second, which would strobe the pet. Cap how often it reacts.
      {
        const nowMs = performance.now();
        if (nowMs - lastPetBankRef.current >= PET_BANK_THROTTLE_MS) {
          lastPetBankRef.current = nowMs;
          firePetEvent("bank");
        }
      }
      if (!reduceMotionRef.current) {
        const id = burstIdRef.current++;
        setBankBursts(b => [...b, { id, socket, color: dev.color }]);
        setTimeout(() => setBankBursts(b => b.filter(x => x.id !== id)), 600);
      }
      haptic(12);
    } else {
      // ── UNPLUG a still-charging device: waste + combo reset ──
      inputLogRef.current.push({ device: occ.device, socket, action: "unplug", t });
      comboRef.current = 0; setCombo(0);
      slotsRef.current[socket] = null;
      setSlots([...slotsRef.current]);
      juice.lossPopup(50, 70, "UNPLUGGED");
      playNepaUnplug();
      haptic(10);
    }
  }, [phase, juice, haptic, firePetEvent, fireSceneEvent, tryVoice]);

  // ── GENERATOR power-up · one pop per run ──────────────────────────────────
  // Opens a 6s window where OUT segments still charge, and logs {action:"gen",t}
  // so the replay re-derives the same window. Recomputes bankT for anything
  // already in a socket (mirror of computeNepaScore's gen branch) so a device
  // mid-charge benefits immediately and the live READY state stays in lockstep.
  const popGenerator = useCallback(() => {
    if (phase !== "playing") return;
    if (genUsedRef.current) return;
    genUsedRef.current = true;
    setGenUsed(true);
    const t = Math.round(performance.now() - startMsRef.current);
    genWindowRef.current = { start: t, end: t + 6000 };
    inputLogRef.current.push({ action: "gen", t });
    for (let s = 0; s < slotsRef.current.length; s++) {
      const occ = slotsRef.current[s];
      if (occ) {
        const d = deviceOrGolden(occ.device);
        if (d) occ.bankT = chargeCompleteTime(scheduleRef.current, occ.plugT, d.chargeMs, SESSION_MS, genWindowRef.current);
      }
    }
    setSlots([...slotsRef.current]);
    setGeneratorOn(true);
    juice.fireCallout({ text: "GEN ON", sub: "charge through blackout", color: "#86efac" });
    playNepaPlug();
    if (!reduceMotionRef.current) juice.bump(10);
    haptic(12);
  }, [phase, juice, haptic]);

  // ── Intro riser on "UP NEPA!" + groove/generator lifecycle by phase ──
  // The groove bed + Lagos generator run ONLY while playing. Entering "playing"
  // starts them; any other phase (ready / gameover / idle) stops them — endGame
  // also stops them directly, so these calls are idempotent.
  useEffect(() => {
    if (phase === "ready" && !fullPlayedRef.current) {
      fullPlayedRef.current = true;
      playUpNepaFull();        // big "UP NEPA" meme voice opens the round (ducks the groove)
    }
    if (phase === "playing") {
      startNepaGroove();
      setGeneratorOn(false);   // light starts ON — the street gen stays quiet until a blackout (inverted)
    } else {
      setNepaChargeIntensity(0);
      chargeIntensityRef.current = -1;
      stopNepaGroove();
      stopGenerator();
    }
  }, [phase]);

  // Safety: kill the charge hum + groove + generator if the page unmounts mid-run.
  useEffect(() => () => {
    setNepaChargeIntensity(0); stopNepaGroove(); stopGenerator();
    if (genSwellTimerRef.current) { clearTimeout(genSwellTimerRef.current); genSwellTimerRef.current = null; }
  }, []);

  // ─── Start a run ─────────────────────────────────────────────────────────
  const startGame = useCallback(async () => {
    if (startingRef.current) return;
    if (isGuest && guestPlaysLeft("nepa") <= 0) { setGuestLimitOpen(true); return; }
    guestCountedRef.current = false;

    // Pre-game gas gate (player-pays only · gasless + guests bypass).
    if (!GASLESS_SKILL_GAMES && !needsMint && !isGuest && gasStatus === "block") {
      let topped = false;
      try {
        const token = await getAccessToken();
        if (token && address) topped = !!(await claimGas(token, address)).success;
      } catch { /* fall through */ }
      if (!topped) { setGasHelpOpen(true); return; }
    }
    startingRef.current = true;

    // Reset run state.
    slotsRef.current = [null, null, null];
    comboRef.current = 0;
    scoreRef.current = 0;
    inputLogRef.current = [];
    submittedRef.current = false;
    sessionTokenRef.current = null;
    seedRef.current = "";
    // Reset chaos-event run state (events set below once the seed is known).
    eventsRef.current = null;
    genWindowRef.current = null;
    genUsedRef.current = false;
    ratAppliedRef.current = false;
    setGenUsed(false);
    juice.reset();
    // Reset the edge-detection + FX refs so a fresh run starts clean.
    prevLightOnRef.current = true;
    prevSecsRef.current = SESSION_MS / 1000;
    chargeIntensityRef.current = -1;
    cutCountRef.current = 0;
    relightCountRef.current = 0;
    intensityFiredRef.current = false;
    fullPlayedRef.current = false;   // each new run opens with the full "UP NEPA" voice
    lastPetBankRef.current = 0;
    // Reactive-lighting / voice FX refs.
    dipFiredRef.current = false;
    dipSegStartRef.current = -1;
    lastVoiceAtRef.current = 0;
    comboVoiceFiredRef.current = false;
    if (genSwellTimerRef.current) { clearTimeout(genSwellTimerRef.current); genSwellTimerRef.current = null; }
    setFlashBig(false);
    setFinalStats({ maxCombo: 0, banked: 0 });
    setPetEvent(null);
    setBankBursts([]);
    setRejectFx(null);
    setPlugKeys([0, 0, 0]);   // LOW-5: clear per-socket plug/ready animation keys
    setSlots([null, null, null]);
    setScore(0); setCombo(0);
    setTimeLeftMs(SESSION_MS);
    setLightOn(true);
    setSubmitResult(null); setSubmitError(null); setTxError(null);

    // Session ticket + SEED. Signed-in minted players get a server seed bound
    // to the session so they can't choose it. Guests/unminted play free with a
    // local seed (their run won't submit).
    let seed: string | undefined;
    if (address && !needsMint) {
      try {
        let res;
        if (isMiniPay) res = await startGameMiniPayAction(address, "", "", "nepa");
        else {
          const token = await getAccessToken();
          if (!token) { setSubmitError("Sign in required to start a ranked run."); startingRef.current = false; return; }
          res = await startGameAction(token, address, "nepa");
        }
        if (!res.success) { setSubmitError(res.error || "Couldn't start session. Try again."); startingRef.current = false; return; }
        sessionTokenRef.current = res.sessionToken;
        seed = res.seed;
      } catch { setSubmitError("Couldn't start session. Try again."); startingRef.current = false; return; }
    }
    // Fallback local seed for free play (or if the backend omitted one).
    seedRef.current = seed || (Math.random().toString(36).slice(2) + Date.now().toString(36));
    scheduleRef.current = nepaLightSchedule(seedRef.current, SESSION_MS);
    eventsRef.current = nepaEvents(seedRef.current, SESSION_MS);

    setPhase("ready");
    startingRef.current = false;
    // "UP NEPA!" intro beat, then go.
    setTimeout(() => setPhase("playing"), 1300);
  }, [address, needsMint, isGuest, isMiniPay, getAccessToken, gasStatus, juice]);

  // First-time teach gate. New players see the HOW TO PLAY card once; the
  // localStorage flag means returning players go straight into a run. Both the
  // card's PLAY and its Skip set the flag and fall through to startGame.
  const beginAfterTeach = useCallback(() => {
    try { localStorage.setItem("nepa_onboarded_v1", "1"); } catch { /* private mode */ }
    setHowToOpen(false);
    startGame();
  }, [startGame]);

  const handleStart = useCallback(() => {
    let onboarded = false;
    try { onboarded = !!localStorage.getItem("nepa_onboarded_v1"); } catch { /* treat as not onboarded */ }
    if (!onboarded) { setHowToOpen(true); return; }
    startGame();
  }, [startGame]);

  // ─── Submit on gameover (same three-step flow as stack/simon) ──────────────
  useEffect(() => {
    if (phase !== "gameover") return;
    if (submittedRef.current) return;
    if (!address || needsMint) return;
    if (hasMinted === false) return;
    submittedRef.current = true;

    const elapsed = SESSION_MS;
    const final = computeNepaScore(seedRef.current, inputLogRef.current);
    const scoreToSubmit = Math.min(1_000_000, Math.max(0, final.points));

    if (scoreToSubmit === 0) {
      setSubmitting(false); setTxError(null);
      setSubmitError("No charge banked. Tap PLAY AGAIN and bank a device before the light goes.");
      return;
    }

    const baseScoreData = { game: "nepa" as const, score: scoreToSubmit, gameTime: elapsed };
    const nepaShadow = { inputLog: inputLogRef.current, bankedNaira: final.nairaScore, elapsedMs: elapsed };

    (async () => {
      setSubmitting(true); setTxError(null);
      try {
        const sessionToken = sessionTokenRef.current;
        if (!sessionToken) { setSubmitError("Session missing. Tap PLAY AGAIN to start a fresh run."); return; }

        let sig:
          | { success: true; gasless: true; txHash: string; gameType: number; score?: number }
          | { success: true; gasless?: false; signature: string; nonce: string; gameType: number; score?: number }
          | { success: false; error: string };
        let authToken: string | null = null;

        if (isMiniPay) {
          sig = await signScoreMiniPay(address, "", "", { game: "nepa", score: scoreToSubmit }, sessionToken, undefined, undefined, undefined, nepaShadow);
        } else {
          authToken = await getAccessToken();
          if (!authToken) { setSubmitError("Not signed in · score not recorded"); return; }
          sig = await signScore(authToken, address, { game: "nepa", score: scoreToSubmit }, sessionToken, undefined, undefined, undefined, nepaShadow);
        }

        if (!sig.success) { setSubmitError(sig.error || "Voucher signing failed"); return; }

        let txHash: string | null = null;
        if (sig.gasless) {
          txHash = sig.txHash;
        } else {
          setSigningOnChain(true);
          try {
            txHash = await writeContractAsync({
              dataSuffix: ATTRIBUTION_SUFFIX,
              address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
              abi: GAME_PASS_ABI,
              functionName: "recordScoreWithBackendSig",
              args: [sig.gameType, BigInt(scoreToSubmit), BigInt(sig.nonce), sig.signature as `0x${string}`],
              ...(isEmbeddedWallet ? { gas: 300000n } : {}),
              ...(await detectFeeSpread(isMiniPay, address as `0x${string}` | undefined)),
            });
          } catch (err: unknown) {
            const e = err as { name?: string; code?: number; message?: string; shortMessage?: string; details?: string; cause?: { name?: string; code?: string; message?: string } };
            const name = e?.name ?? ""; const code = e?.code ?? 0;
            const causeName = e?.cause?.name ?? ""; const causeCode = e?.cause?.code ?? "";
            const msg = (e?.message ?? e?.shortMessage ?? e?.details ?? e?.cause?.message ?? "").toLowerCase();
            const isRejected =
              name === "UserRejectedRequestError" || code === 4001 || code === -32003 ||
              causeName === "UserRejectedRequestError" || causeCode === "policy_violation" ||
              msg.includes("user rejected") || msg.includes("rejected the request") || msg.includes("user denied");
            const matchedGasPattern =
              name === "InsufficientFundsError" || name === "EstimateGasExecutionError" ||
              code === -32000 || code === -32010 || code === -32603 || causeCode === "insufficient_funds" ||
              msg.includes("insufficient funds") || msg.includes("insufficient balance") ||
              msg.includes("gas limit") || msg.includes("exceeds gas") || msg.includes("gas required") ||
              msg.includes("intrinsic gas") || msg.includes("cannot estimate") || msg.includes("estimate gas");
            const lowBalanceLikelyGas = !isRejected && !matchedGasPattern && (gasStatus === "warn" || gasStatus === "block");
            const isGasOrFunds = matchedGasPattern || lowBalanceLikelyGas;
            if (isRejected) setTxError("Transaction rejected. Tap PLAY AGAIN to try again.");
            else if (isGasOrFunds) setTxError("Score didn't save · needs a top up.");
            else setTxError("Score didn't save. Tap PLAY AGAIN to try again.");
            return;
          } finally { setSigningOnChain(false); }
        }

        let result;
        const fullScoreData = { ...baseScoreData, txHash };
        if (isMiniPay) result = await submitScoreMiniPay(address, "", "", fullScoreData);
        else if (authToken) result = await submitScore(authToken, address, fullScoreData);

        if (result?.success) {
          setSubmitResult({
            rank: result.rank, xpEarned: result.xpEarned, xp: result.xp, level: result.level,
            leveledUp: result.leveledUp, isNewPb: result.isNewPb, prevBest: result.prevBest,
            newAchievements: result.newAchievements || [],
          });
          if (result.leveledUp && typeof result.level === "number") {
            const newLv = result.level;
            const prevPet = petForLevel(playerLevel);
            const newPet = petForLevel(newLv);
            setTimeout(() => setLevelUpToastLevel(newLv), 700);
            if (prevPet.id !== newPet.id) { setPetEvolveAtLevel(newLv); setTimeout(() => setPetEvolveToPet(newPet), 700 + 3800); }
          }
        } else {
          setSubmitError(result?.error || "Score not recorded");
        }
      } catch { setSubmitError("Unexpected error · score not recorded"); }
      finally { setSubmitting(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ─── Render ─────────────────────────────────────────────────────────────
  const points = Math.floor(score / NAIRA_PER_POINT);
  const secsLeft = Math.ceil(timeLeftMs / 1000);
  const pet = petForLevel(playerLevel);   // corner companion stage
  const lightPct = (() => {
    // Progress through the CURRENT light segment, for the meter fill.
    const now = SESSION_MS - timeLeftMs;
    for (const s of scheduleRef.current) if (now >= s.start && now < s.end) return 1 - (now - s.start) / (s.end - s.start);
    return 0;
  })();
  // ── Chaos-event UI flags · derived each frame from the run time (setTick) ──
  const nowMs = SESSION_MS - timeLeftMs;
  const evNow = eventsRef.current;
  const playing = phase === "playing";
  const goldenAvail = !!(playing && evNow && nowMs >= evNow.golden.start && nowMs < evNow.golden.end);
  const dmActive = !!(playing && evNow && nowMs >= evNow.doubleMoney.start && nowMs < evNow.doubleMoney.end);
  const frenzyActive = !!(playing && evNow && nowMs >= evNow.frenzy.start);
  const ratActive = !!(playing && evNow && nowMs >= evNow.rat.start && nowMs < evNow.rat.end);
  const genWin = genWindowRef.current;
  const genActive = !!(playing && genWin && nowMs >= genWin.start && nowMs < genWin.end);
  const genSecsLeft = genActive && genWin ? Math.ceil((genWin.end - nowMs) / 1000) : 0;

  return (
    <div className="nepa-root">
      {/* Desktop-only backdrop: a blurred, dimmed copy of the bg so the framed
          9:16 stage sits in an atmospheric field instead of black bars. Hidden
          on phones (the stage goes full-bleed there). */}
      <div className="nepa-backdrop" />

      {/* The STAGE — a fixed 9:16 phone frame. ALL game layers (bg, canvas, CSS
          light, HUD, sockets, tray, pet, bulb, phase views) live inside it so
          they share ONE coordinate space. The gradient base is the no-image
          fallback that shows through if the painting fails to load. */}
      <div className="nepa-stage" style={{
        // Dark warm room base. Purple survives only as a faint edge vignette that
        // recedes BEHIND the painted room — no more bright purple void.
        background: "radial-gradient(ellipse 120% 100% at 50% 48%, #0a0610 52%, #150a26 82%, #1c0f33 100%)",
      }}>
      {/* Background art · TWO stacked painted frames that CROSS-FADE on lightOn:
          the LIT room when power's on, the BLACKOUT frame when NEPA takes it. A
          slow, barely-perceptible breath keeps the room alive. If the blackout
          frame 404s we fall back to dimming the lit frame so nothing breaks. */}
      {bgOk && (
        <div className={reduceMotion ? undefined : "nepa-breathe"} style={{
          position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
          transformOrigin: "center", willChange: "transform",
        }}>
          {/* LIT frame */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/games/nepa-bg.webp" alt="" onError={() => setBgOk(false)} style={{
            position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
            display: "block", transition: "opacity 300ms ease, filter 0.3s ease",
            // With the blackout frame present it carries the lights-out look, so
            // the lit frame simply fades out on a cut. Without it (asset missing),
            // keep the old brightness-dim so the blackout still reads.
            opacity: bgOutOk ? (lightOn ? 1 : 0) : 0.95,
            filter: bgOutOk
              ? "brightness(1) saturate(1.05) contrast(1.02)"
              : (lightOn ? "brightness(1) saturate(1.05) contrast(1.02)" : "brightness(0.16) saturate(0.4)"),
          }} />
          {/* BLACKOUT frame — stacked just above the lit frame (same z-band, drawn
              after → on top), opaque only when the light is OUT. */}
          {bgOutOk && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src="/games/nepa/nepa-bg-out.webp" alt="" onError={() => setBgOutOk(false)} style={{
              position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
              display: "block", transition: "opacity 300ms ease",
              opacity: lightOn ? 0 : 1,
            }} />
          )}
        </div>
      )}

      {/* Ambient light-reactive scene — procedural canvas layered OVER the bg
          image (zIndex 0) and BELOW the CSS glow (2) / blackout overlay (5) / HUD
          (10). zIndex 1 is set inside the component. Pure visual: driven only by
          lightOn / phase / reduceMotion / sceneEvent, never game state. */}
      <NepaScene lightOn={lightOn} phase={phase} reduceMotion={reduceMotion} sceneEvent={sceneEvent} />

      {/* Warm bulb-glow — a pool of amber light from the painted bulb when the
          power is ON. Screen-blended so it reads as light on the room, not paint. */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", mixBlendMode: "screen",
        background: "radial-gradient(ellipse 60% 45% at 51% 14%, rgba(255,196,92,0.30) 0%, rgba(255,196,92,0) 70%)",
        opacity: (playing && lightOn) ? 1 : 0, transition: "opacity 0.35s ease",
      }} />

      {/* Pre-cut voltage DIP — the bulb flickers/sags ~0.5s before a cut (the
          "tell"). Keyed one-shot; decorative (reduced-motion off). */}
      {playing && !reduceMotion && dipKey > 0 && (
        <div key={`dip-${dipKey}`} className="nepa-voltdip" style={{
          position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none", mixBlendMode: "screen", opacity: 0,
          background: "radial-gradient(ellipse 60% 45% at 51% 14%, rgba(255,196,92,0.30) 0%, rgba(255,196,92,0) 70%)",
        }} />
      )}

      {/* Relight SURGE — the filament warming up on the return. Keyed one-shot. */}
      {playing && !reduceMotion && relightKey > 0 && (
        <div key={`surge-${relightKey}`} className="nepa-relightsurge" style={{
          position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none", mixBlendMode: "screen", opacity: 0,
          background: "radial-gradient(ellipse 55% 42% at 51% 14%, rgba(255,214,140,0.55) 0%, rgba(255,214,140,0) 68%)",
        }} />
      )}

      {/* BLACKOUT vignette — a LIGHT edge-darkening now that the painted out-frame
          carries the real lights-out look. Kept soft so the art reads through;
          the deck scrim handles socket readability. Opacity-driven transition. */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none",
        background: "radial-gradient(ellipse 85% 70% at 50% 56%, rgba(6,10,26,0.12) 0%, rgba(2,3,12,0.55) 100%)",
        opacity: (playing && !lightOn) ? 1 : 0, transition: "opacity 0.28s ease",
      }} />

      {/* DOUBLE MONEY HUD tint — a soft green vignette while the ×2 window is live. */}
      {dmActive && (
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(52,211,153,0.16) 0%, rgba(52,211,153,0) 65%)", zIndex: 6, pointerEvents: "none", transition: "opacity 0.2s" }} />
      )}

      {/* Reactive ceiling bulb — hangs over the painted bulb, the top "alive" element */}
      {phase === "playing" && <CeilingBulb lightOn={lightOn} reduceMotion={reduceMotion} relightKey={relightKey} />}

      {/* CUT power-trip flicker — "it tripped, caught, died." Darker than the old
          whiteout; reads as a real power cut. Keyed one-shot (reduced-motion off). */}
      {phase === "playing" && !reduceMotion && flashKey > 0 && (
        <div key={`trip-${flashKey}`} className={flashBig ? "nepa-powertrip nepa-powertrip-big" : "nepa-powertrip"} style={{
          position: "absolute", inset: 0, background: "#05060f", zIndex: 6, pointerEvents: "none", opacity: 0,
        }} />
      )}

      {/* Corner pet companion — parked bottom-left, reacts in place */}
      {phase === "playing" && <NepaPet pet={pet} event={petEvent} reduceMotion={reduceMotion} />}

      {/* ─── IDLE ─── */}
      {phase === "idle" && (
        <IdleView
          onStart={handleStart}
          onExit={() => router.push("/games")}
          onLeaderboard={() => router.push("/games/nepa/leaderboard")}
          guest={isGuest}
          guestLeft={guestLeft}
          needsMint={needsMint}
          onFinishSetup={() => router.push("/home?ob=1")}
          gasBanner={needsMint || isGuest ? null : <LowGasBanner status={gasStatus} onOpenHelp={() => setGasHelpOpen(true)} />}
        />
      )}

      {/* ─── READY (UP NEPA!) ─── */}
      {phase === "ready" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 56, fontWeight: 900,
            color: "#fde68a", letterSpacing: "0.04em", textAlign: "center",
            textShadow: "0 0 24px rgba(251,191,36,0.9), 0 4px 10px rgba(0,0,0,0.8)",
            animation: "nepaPop 0.5s cubic-bezier(.2,1.4,.4,1) both",
          }}>
            UP NEPA!
            <div style={{ fontSize: 15, color: "#e9d5ff", marginTop: 10, letterSpacing: "0.1em", fontWeight: 700 }}>CHARGE FAST — BEAT THE BLACKOUT</div>
          </div>
        </div>
      )}

      {/* ─── PLAYING ─── */}
      {phase === "playing" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* TOP ZONE (~48%) — the painted room breathes here. Only the slim HUD +
              light-meter overlay it; pointer-events:none so taps pass straight
              through (no tappable sits over the painted people up top). */}
          <div style={{ flex: "0 0 42%", minHeight: 0, display: "flex", flexDirection: "column", padding: "max(12px, env(safe-area-inset-top)) 14px 0", pointerEvents: "none" }}>
          {/* HUD */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            {/* Indented clear of the top-left app logo so BANKED never sits under it. */}
            <div style={{ paddingLeft: 48 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.16em", color: "rgba(230,220,255,0.7)", fontWeight: 800 }}>BANKED</div>
              <div style={{ fontFamily: '"Melon Pop","Fredoka",system-ui,sans-serif', fontSize: 30, color: "#fde68a", lineHeight: 1, textShadow: "0 0 14px rgba(251,191,36,0.7)" }}><span key={score} className={reduceMotion ? undefined : "nepa-score-pop"} style={{ display: "inline-block" }}>{naira(score)}</span></div>
              <div style={{ fontSize: 10.5, color: "rgba(230,220,255,0.6)", fontWeight: 700 }}>{points} pts{combo > 1 ? ` · ×${comboMult(combo).toFixed(2)}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.16em", color: "rgba(230,220,255,0.7)", fontWeight: 800 }}>TIME</div>
              <div style={{ fontFamily: '"Melon Pop","Fredoka",system-ui,sans-serif', fontSize: 30, color: secsLeft <= 8 ? "#fb7185" : "#fff", lineHeight: 1 }}>{secsLeft}s</div>
            </div>
          </div>

          {/* Active chaos-event banners — the ×2 / ×1.5 math lives in scoring;
              these just tell the player a window is live. HUD tints via the
              double-money pill. (Minimal visuals — polish pass adds the juice.) */}
          {(dmActive || frenzyActive || genActive) && (
            <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {dmActive && (
                <span style={{ padding: "4px 12px", borderRadius: 999, background: "rgba(52,211,153,0.18)", border: "1px solid rgba(52,211,153,0.6)", color: "#86efac", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", boxShadow: "0 0 14px rgba(52,211,153,0.4)" }}>💰 DOUBLE MONEY!</span>
              )}
              {frenzyActive && (
                <span style={{ padding: "4px 12px", borderRadius: 999, background: "rgba(251,113,133,0.18)", border: "1px solid rgba(251,113,133,0.6)", color: "#fb7185", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", boxShadow: "0 0 14px rgba(251,113,133,0.4)" }}>🔥 FRENZY ×1.5</span>
              )}
              {genActive && (
                <span style={{ padding: "4px 12px", borderRadius: 999, background: "rgba(253,230,138,0.18)", border: "1px solid rgba(253,230,138,0.6)", color: "#fde68a", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", boxShadow: "0 0 14px rgba(253,230,138,0.4)" }}>⚙️ GEN ON · {genSecsLeft}s</span>
              )}
            </div>
          )}

          {/* LIGHT meter */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", marginBottom: 4 }}>
              <span style={{ color: lightOn ? "#86efac" : "#fb7185" }}>{lightOn ? "⚡ LIGHT ON" : "🕯️ NEPA CARRY LIGHT!"}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div style={{ height: "100%", width: `${Math.round(lightPct * 100)}%`, background: lightOn ? "linear-gradient(90deg,#fde68a,#22c55e)" : "linear-gradient(90deg,#be123c,#fb7185)", transition: "width 0.12s linear", boxShadow: lightOn ? "0 0 10px rgba(134,239,172,0.7)" : "0 0 10px rgba(251,113,133,0.7)" }} />
            </div>
          </div>
          </div>{/* end TOP ZONE */}

          {/* CONTROL DECK (~52%, flex:1) — sockets + generator + device tray +
              END RUN. A bottom-up scrim sits BEHIND the deck so the tappables
              read against the painted room without covering the people up top. */}
          <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
            {/* bottom-up scrim (behind the deck content) */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent, rgba(6,4,16,.78) 32%)", pointerEvents: "none" }} />
            {/* deck content — position:relative so it paints ABOVE the scrim */}
            <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 14px max(12px, env(safe-area-inset-bottom))" }}>

          {/* Sockets (position:relative so bank-bursts can sit over them) */}
          <div style={{ position: "relative", marginTop: 0, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {slots.map((slot, i) => {
              const now = SESSION_MS - timeLeftMs;
              const dev = slot ? deviceOrGolden(slot.device) ?? null : null;
              const prog = slot && dev ? Math.min(1, chargedSoFar(scheduleRef.current, slot.plugT, now, genWindowRef.current) / dev.chargeMs) : 0;
              // READY = fully charged (now >= bankT) — the exact test the replay
              // uses to credit a bank, so what reads as "grab me" is bankable.
              const ready = !!(slot && dev && now >= slot.bankT);
              // The gen window keeps a device charging through a cut, so it reads
              // as charging (not slumped) even while the light is OUT.
              const charging = !!(slot && dev && !ready && (lightOn || genActive));
              const slump = !!(slot && dev && !ready && !lightOn && !genActive);  // charging device slumps on a cut
              // RAT · this socket is seized while the rat owns it — un-tappable.
              const ratHere = ratActive && !!evNow && i === evNow.rat.socket;
              // ₦ the player grabs if they bank now (next combo step, with live multipliers).
              let readyGainF = ready && dev ? dev.value * comboMult(combo + 1) : 0;
              if (ready && dmActive) readyGainF *= 2;
              if (ready && frenzyActive) readyGainF *= 1.5;
              const readyGain = Math.round(readyGainF);
              return (
                <button key={i} onClick={() => { if (ratHere) return; tapSocket(i); }}
                  aria-label={ratHere ? `Socket ${i + 1} blocked by a rat` : slot && dev ? (ready ? `Bank ${dev.label}, full, grab ${readyGain.toLocaleString()} naira` : `Unplug ${dev.label}, charging ${Math.round(prog * 100)} percent`) : `Empty socket ${i + 1}`}
                  className={reduceMotion ? undefined : "nepa-press"} style={{
                  position: "relative", height: 84, borderRadius: 16, cursor: ratHere ? "not-allowed" : slot ? "pointer" : "default",
                  border: `2px solid ${ratHere ? "#fb7185" : ready ? "#fde68a" : slot && dev ? dev.color : "rgba(168,85,247,0.4)"}`,
                  background: ratHere ? "rgba(60,8,20,0.92)" : ready ? "rgba(46,30,6,0.92)" : slot ? "rgba(20,10,46,0.85)" : "rgba(255,255,255,0.03)",
                  boxShadow: ratHere ? "0 0 20px rgba(251,113,133,0.7)" : ready ? "0 0 22px rgba(251,191,36,0.85)" : slot && dev ? `0 0 16px ${dev.color}66` : "none",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                  fontFamily: "inherit", padding: 5,
                }}>
                  {ratHere ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 30, lineHeight: 1 }}>🐀</span>
                      <span style={{ fontSize: 10, color: "#fb7185", fontWeight: 900, letterSpacing: "0.1em" }}>RAT!</span>
                    </div>
                  ) : slot && dev ? (
                    <>
                      {/* READY pulse ring — compositor-only opacity animation (no filter) */}
                      {ready && !reduceMotion && (
                        <div className="nepa-ready" style={{ position: "absolute", inset: -2, borderRadius: 16, border: "2px solid #fde68a", pointerEvents: "none" }} />
                      )}
                      {/* plug-in bounce (keyed, one-shot) wraps the charging wiggle */}
                      <div key={`plug-${plugKeys[i]}`} className={reduceMotion ? undefined : "nepa-plug-bounce"} style={{
                        transition: "transform 0.18s ease, filter 0.18s ease",
                        transform: slump ? "translateY(3px) rotate(-4deg)" : ready ? "scale(1.06)" : "none",
                        filter: slump ? "grayscale(0.7) brightness(0.5)" : "none",
                      }}>
                        <div className={charging && !reduceMotion ? "nepa-charging" : undefined} style={{ display: "flex" }}>
                          <DeviceSprite id={dev.id} size={40} />
                        </div>
                      </div>
                      {ready ? (
                        <>
                          <div style={{ fontSize: 9.5, color: "#fde68a", fontWeight: 900, letterSpacing: "0.08em", lineHeight: 1 }}>TAP TO BANK</div>
                          <div style={{ fontSize: 11, color: "#86efac", fontWeight: 900, lineHeight: 1 }}>+{naira(readyGain)}</div>
                        </>
                      ) : (
                        <>
                          <div style={{ position: "absolute", left: 6, right: 6, bottom: 6, height: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.round(prog * 100)}%`, background: `linear-gradient(90deg, ${dev.color}, #fde68a)`, transition: "width 0.1s linear" }} />
                          </div>
                          <span style={{ position: "absolute", top: 4, right: 6, fontSize: 8.5, color: "rgba(230,220,255,0.65)", fontWeight: 800, letterSpacing: "0.08em" }}>TAP ✕</span>
                        </>
                      )}
                    </>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, opacity: 0.6 }}>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="4" stroke="#c084fc" strokeWidth="1.6"/><rect x="9" y="8.5" width="1.8" height="4" rx="0.9" fill="#c084fc"/><rect x="13" y="8.5" width="1.8" height="4" rx="0.9" fill="#c084fc"/></svg>
                      <span style={{ fontSize: 9, color: "rgba(200,180,255,0.6)", fontWeight: 800, letterSpacing: "0.1em" }}>EMPTY</span>
                    </div>
                  )}
                </button>
              );
            })}

            {/* BANK bursts — icon flies up + a small coin-shard spray, over the banked socket */}
            {!reduceMotion && bankBursts.map(b => {
              const leftPct = (b.socket + 0.5) / 3 * 100;
              return (
                <div key={b.id} style={{ position: "absolute", left: `${leftPct}%`, top: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 13 }}>
                  <div className="nepa-bankpop" style={{ width: 34, height: 34, borderRadius: 10, background: `radial-gradient(circle at 50% 40%, ${b.color}, ${b.color}00 70%)`, boxShadow: `0 0 18px ${b.color}` }} />
                  {[...Array(6)].map((_, k) => {
                    const ang = (k / 6) * Math.PI * 2;
                    return (
                      <span key={k} className="nepa-coin" style={{
                        position: "absolute", left: "50%", top: "50%", marginLeft: -3, marginTop: -3, width: 6, height: 6, borderRadius: 999,
                        background: "#fde68a", boxShadow: "0 0 6px #fbbf24",
                        ["--cx" as string]: `${Math.cos(ang) * 18}px`,
                        ["--cy" as string]: `${Math.sin(ang) * 18}px`,
                      } as React.CSSProperties} />
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* GENERATOR power-up · one use per run. Opens a 6s window where
              devices keep charging through a light cut (mirrors the replay). */}
          <button
            onClick={popGenerator}
            disabled={genUsed}
            aria-label={genUsed ? (genActive ? `Generator running, ${genSecsLeft} seconds left` : "Generator used") : "Use the generator to charge through a blackout, one use"}
            style={{
              marginTop: 8, alignSelf: "center", padding: "7px 16px", borderRadius: 999, fontFamily: "inherit",
              fontSize: 11.5, fontWeight: 900, letterSpacing: "0.08em",
              cursor: genUsed ? "default" : "pointer",
              border: `1.5px solid ${genActive ? "rgba(134,239,172,0.8)" : genUsed ? "rgba(255,255,255,0.12)" : "rgba(253,230,138,0.6)"}`,
              background: genActive ? "rgba(52,211,153,0.18)" : genUsed ? "rgba(255,255,255,0.04)" : "rgba(253,230,138,0.12)",
              color: genActive ? "#86efac" : genUsed ? "rgba(230,220,255,0.4)" : "#fde68a",
              boxShadow: genActive ? "0 0 16px rgba(134,239,172,0.5)" : "none",
              opacity: genUsed && !genActive ? 0.6 : 1,
            }}>
            {genActive ? `⚙️ GEN ON · ${genSecsLeft}s` : genUsed ? "⚙️ GENERATOR USED" : "⚙️ USE GENERATOR (1×)"}
          </button>

          {/* Device wall · minHeight:0 lets it shrink inside the fixed/overflow
              deck on short viewports instead of pushing END RUN off-screen. */}
          <div style={{ marginTop: 6, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.16em", color: "rgba(230,220,255,0.6)", fontWeight: 800, marginBottom: 2 }}>TAP A DEVICE TO PLUG IN</div>
            <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "rgba(253,230,138,0.75)", fontWeight: 800, marginBottom: 6 }}>TAP A FULL SOCKET TO BANK ₦ — BEFORE TIME RUNS OUT</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, minHeight: 0 }}>
              {DEVICES.map(d => {
                const vps = Math.round(d.value / (d.chargeMs / 1000));
                const secs = d.chargeMs / 1000;
                const isRejecting = rejectFx?.id === d.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => plugDevice(d.id)}
                    aria-label={`Charge ${d.label}, naira ${d.value.toLocaleString()}, ${secs} second${secs === 1 ? "" : "s"}`}
                    className={reduceMotion ? undefined : `nepa-press${isRejecting ? " nepa-reject" : ""}`}
                    style={{
                    borderRadius: 14, padding: "5px 4px 4px", cursor: "pointer", fontFamily: "inherit",
                    border: `1.5px solid ${d.color}66`, background: "rgba(20,10,46,0.7)",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                    boxShadow: `0 4px 12px -6px ${d.color}`,
                  }}>
                    <DeviceSprite id={d.id} size={28} />
                    <div style={{ fontSize: 9, color: "rgba(230,220,255,0.75)", fontWeight: 800, letterSpacing: "0.02em", textAlign: "center", lineHeight: 1.05 }}>{d.label}</div>
                    {/* ₦ value + ₦/s are the triage signal under time pressure — kept
                        prominent/legible; the "Ns charge" sublabel dropped to fit the deck. */}
                    <div style={{ fontSize: 14, color: d.color, fontWeight: 900, lineHeight: 1 }}>{naira(d.value)}</div>
                    <div style={{ fontSize: 12, color: "#fde68a", fontWeight: 900, lineHeight: 1 }}>{naira(vps)}<span style={{ fontSize: 9, color: "rgba(253,230,138,0.7)" }}>/s</span></div>
                  </button>
                );
              })}

              {/* GOLDEN RARE · the freezer only appears inside its window. A plug
                  logs a normal plug and banks via the same replay (₦80,000 / 7s). */}
              {goldenAvail && (
                <button
                  key="ac"
                  onClick={() => plugDevice("ac")}
                  aria-label={`Charge rare Freezer, naira 80,000, 7 seconds, available now`}
                  className={reduceMotion ? undefined : "nepa-press nepa-ready"}
                  style={{
                    position: "relative", borderRadius: 14, padding: "5px 4px 4px", cursor: "pointer", fontFamily: "inherit",
                    border: "1.5px solid #fde68a", background: "linear-gradient(180deg, rgba(60,44,8,0.85), rgba(20,10,46,0.8))",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                    boxShadow: "0 0 18px rgba(251,191,36,0.7)",
                  }}>
                  <span style={{ position: "absolute", top: -7, right: -4, fontSize: 8, fontWeight: 900, letterSpacing: "0.06em", color: "#231005", background: "#fde68a", borderRadius: 999, padding: "1px 6px", boxShadow: "0 0 10px rgba(251,191,36,0.9)" }}>RARE!</span>
                  <DeviceSprite id="ac" size={28} />
                  <div style={{ fontSize: 9, color: "#fde68a", fontWeight: 800, letterSpacing: "0.02em", textAlign: "center", lineHeight: 1.05 }}>Freezer</div>
                  <div style={{ fontSize: 14, color: "#fde68a", fontWeight: 900, lineHeight: 1 }}>{naira(80_000)}</div>
                  <div style={{ fontSize: 12, color: "#fde68a", fontWeight: 900, lineHeight: 1 }}>{naira(Math.round(80_000 / 7))}<span style={{ fontSize: 9, color: "rgba(253,230,138,0.7)" }}>/s</span></div>
                </button>
              )}
            </div>
          </div>

          <button onClick={endGame} style={{ marginTop: 8, alignSelf: "center", padding: "6px 16px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(230,220,255,0.8)", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" }}>END RUN</button>
            </div>{/* end deck content */}
          </div>{/* end CONTROL DECK */}
        </div>
      )}

      {/* Shared juice overlay */}
      {phase === "playing" && <JuiceOverlay popups={juice.popups} callout={juice.callout} shake={juice.shake} timeLeft={secsLeft} dangerSeconds={8} />}

      {/* ─── GAMEOVER ─── */}
      {phase === "gameover" && (
        <FinishedView
          naira={score}
          points={points}
          maxCombo={finalStats.maxCombo}
          banked={finalStats.banked}
          onPlayAgain={startGame}
          onExit={() => { setPhase("idle"); setScore(0); setCombo(0); setSubmitResult(null); setSubmitError(null); submittedRef.current = false; }}
          onLeaderboard={() => router.push("/games/nepa/leaderboard")}
          onTopUp={() => setGasHelpOpen(true)}
          submitting={submitting}
          signingOnChain={signingOnChain}
          submitResult={submitResult}
          submitError={submitError}
          txError={txError}
          guest={isGuest}
          needsMint={needsMint}
        />
      )}

      <LevelUpToast level={levelUpToastLevel} onClose={() => setLevelUpToastLevel(null)} />
      <PetEvolveToast pet={petEvolveToPet} newLevel={petEvolveAtLevel} onClose={() => setPetEvolveToPet(null)} />
      <PushOptInModal walletAddress={address} trigger={!!submitResult} />
      <GasHelpSheet open={gasHelpOpen} onClose={() => setGasHelpOpen(false)} intent="gas-help" game="nepa" />
      <GuestLimitPrompt open={guestLimitOpen} onClose={() => setGuestLimitOpen(false)} game="Up NEPA!" />

      {/* One-time HOW TO PLAY teach · gated on localStorage, skippable */}
      {howToOpen && (
        <HowToPlayCard reduceMotion={reduceMotion} onStart={beginAfterTeach} onSkip={beginAfterTeach} />
      )}

      <style>{`
        /* PHONE-STAGE LAYOUT — the fixed root hosts a centered 9:16 stage on a
           blurred backdrop (desktop); full-bleed on phones. All game layers live
           inside .nepa-stage so bg + canvas + UI share one coordinate space. */
        .nepa-root{ position:fixed; inset:0; overflow:hidden; touch-action:manipulation; display:flex; align-items:center; justify-content:center; background:#05060f; }
        .nepa-backdrop{ position:absolute; inset:0; z-index:0; pointer-events:none; background:url(/games/nepa-bg.webp) center/cover; filter:blur(44px) brightness(0.35) saturate(1.1); transform:scale(1.15); }
        .nepa-stage{ position:relative; z-index:1; width:min(100vw,460px); height:min(100dvh, calc(min(100vw,460px) * 16 / 9)); aspect-ratio:9/16; margin:auto; overflow:hidden; border-radius:26px; box-shadow:0 30px 80px -20px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.06), inset 0 0 0 1px rgba(255,255,255,.04); }
        @media (max-width:480px){ .nepa-backdrop{ display:none; } .nepa-stage{ width:100vw; height:100dvh; border-radius:0; box-shadow:none; } }

        @keyframes nepaPop { 0%{transform:scale(0.6);opacity:0} 100%{transform:scale(1);opacity:1} }

        /* Keyframes are harmless to declare always; the classes that USE the
           decorative ones live inside the reduced-motion guard below. */
        @keyframes nepa-bulb-swing { 0%,100%{transform:rotate(-3deg)} 50%{transform:rotate(3deg)} }
        @keyframes nepa-bulb-hardswing { 0%{transform:rotate(0)} 22%{transform:rotate(-9deg)} 55%{transform:rotate(7deg)} 80%{transform:rotate(-3deg)} 100%{transform:rotate(0)} }
        @keyframes nepa-wiggle { 0%,100%{transform:rotate(-2deg)} 50%{transform:rotate(2deg)} }
        /* READY "grab me" pulse — opacity only (compositor), never filter:brightness. */
        @keyframes nepa-readypulse { 0%,100%{opacity:0.35} 50%{opacity:1} }
        /* CUT power-trip — darken, catch, die. Reads as the breaker tripping. */
        @keyframes nepa-powertrip { 0%{opacity:0} 8%{opacity:.9} 16%{opacity:.1} 26%{opacity:.8} 40%{opacity:0} 100%{opacity:0} }
        @keyframes nepa-powertrip-big { 0%{opacity:0} 8%{opacity:1} 16%{opacity:.15} 26%{opacity:.92} 40%{opacity:0} 100%{opacity:0} }
        /* RELIGHT surge — the filament warming up as the power returns. */
        @keyframes nepa-relightsurge { 0%{opacity:0} 20%{opacity:.55} 45%{opacity:.15} 60%{opacity:.4} 100%{opacity:0} }
        /* Pre-cut voltage DIP — the bulb sags twice before it drops. */
        @keyframes nepa-voltdip { 0%{opacity:1} 30%{opacity:.45} 50%{opacity:.9} 70%{opacity:.4} 100%{opacity:1} }
        /* Barely-perceptible scene breath — ambient life, not motion sickness. */
        @keyframes nepa-breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.015)} }
        @keyframes nepa-plugbounce { 0%{transform:scale(0.92)} 55%{transform:scale(1.08)} 100%{transform:scale(1)} }
        @keyframes nepa-rejectshake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
        @keyframes nepa-petidle { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-4px) rotate(-2deg)} }
        @keyframes nepa-petpoke { 0%{transform:scale(1)} 30%{transform:scale(1.2) translateY(-6px)} 60%{transform:scale(0.95)} 100%{transform:scale(1)} }
        @keyframes nepa-coinfly { 0%{transform:translate(var(--cx,0px),var(--cy,0px)) scale(1);opacity:1} 100%{transform:translate(var(--cx,0px),calc(var(--cy,0px) - 40px)) scale(0.4);opacity:0} }
        @keyframes nepa-bankpop { 0%{transform:scale(1);opacity:1} 50%{transform:scale(1.25);opacity:1} 100%{transform:scale(0);opacity:0} }
        @keyframes nepa-scorepop { 0%{transform:scale(1)} 50%{transform:scale(1.12)} 100%{transform:scale(1)} }
        @keyframes nepa-teachpulse { 0%,100%{box-shadow:0 0 0 0 rgba(251,191,36,0)} 50%{box-shadow:0 0 0 4px rgba(251,191,36,0.25)} }

        @media (prefers-reduced-motion: no-preference) {
          .nepa-teach-pulse { animation: nepa-teachpulse 2s ease-in-out infinite; }
          .nepa-bulb-idle { animation: nepa-bulb-swing 3.2s ease-in-out infinite; transform-origin: top center; }
          .nepa-bulb-cut  { animation: nepa-bulb-hardswing 0.5s ease-out; transform-origin: top center; }
          .nepa-charging  { animation: nepa-wiggle 0.22s ease-in-out infinite; }
          .nepa-ready     { animation: nepa-readypulse 0.6s ease-in-out infinite; }
          .nepa-powertrip     { animation: nepa-powertrip 0.45s ease-out; }
          .nepa-powertrip-big { animation: nepa-powertrip-big 0.5s ease-out; }
          .nepa-relightsurge  { animation: nepa-relightsurge 0.7s ease-out; }
          .nepa-voltdip       { animation: nepa-voltdip 0.45s ease-in-out; }
          .nepa-breathe       { animation: nepa-breathe 7s ease-in-out infinite; }
          .nepa-plug-bounce { animation: nepa-plugbounce 0.26s cubic-bezier(0.34,1.56,0.64,1); }
          .nepa-reject    { animation: nepa-rejectshake 0.26s ease-in-out; }
          .nepa-press:active { transform: scale(0.92); }
          .nepa-pet-idle  { animation: nepa-petidle 3.2s ease-in-out infinite; }
          .nepa-pet-react { animation: nepa-petpoke 0.6s cubic-bezier(0.34,1.56,0.64,1); }
          .nepa-coin      { animation: nepa-coinfly 0.5s ease-out forwards; }
          .nepa-bankpop   { animation: nepa-bankpop 0.36s cubic-bezier(0.34,1.56,0.64,1) forwards; }
          .nepa-score-pop { animation: nepa-scorepop 0.18s ease-out; }
        }
      `}</style>
      </div>{/* end .nepa-stage */}
    </div>
  );
}

// ─── Reactive ceiling bulb ────────────────────────────────────────────────────
// Hangs top-center. Idle: gentle pendulum swing + warm glow (lightOn). Cut:
// hard swing + flicker to dark. Relight: glow ramps back in. All swing motion
// is decorative (gated via the .nepa-bulb-* classes under reduced-motion); the
// on/off brightness + opacity is informational and uses plain transitions.
function CeilingBulb({ lightOn, reduceMotion, relightKey }: { lightOn: boolean; reduceMotion: boolean; relightKey: number }) {
  const [swingKey, setSwingKey] = useState(0);
  const prev = useRef(lightOn);
  useEffect(() => {
    if (prev.current !== lightOn) { prev.current = lightOn; setSwingKey(k => k + 1); }
  }, [lightOn]);

  const swingClass = reduceMotion ? undefined : (lightOn ? "nepa-bulb-idle" : "nepa-bulb-cut");
  const glow = lightOn ? "#fde68a" : "#1a1030";

  return (
    <div style={{ position: "absolute", top: 2, left: "52%", transform: "translateX(-50%)", zIndex: 8, pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* cord */}
      <div style={{ width: 2, height: 26, background: "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0.08))" }} />
      {/* swinging bulb (keyed so the cut hard-swing + relight re-trigger) */}
      <div key={`${swingKey}-${relightKey}`} className={swingClass} style={{ transformOrigin: "top center", marginTop: -1 }}>
        <div style={{
          transition: "opacity 0.26s cubic-bezier(0.16,1,0.3,1), filter 0.26s cubic-bezier(0.16,1,0.3,1)",
          opacity: lightOn ? 1 : 0.32,
          filter: lightOn ? `drop-shadow(0 0 16px ${glow}) drop-shadow(0 0 32px ${glow}aa)` : "grayscale(0.8) brightness(0.5)",
        }}>
          <svg width="30" height="38" viewBox="0 0 30 38" fill="none">
            <rect x="11" y="1" width="8" height="6" rx="1.4" fill="#9ca3af" />
            <path d="M15 6c-6 0-10 4.2-10 9.4 0 3.9 2.3 6.2 3.8 7.9 1 1.1 1.6 2 1.7 3.2h9c0.1-1.2 0.7-2.1 1.7-3.2 1.5-1.7 3.8-4 3.8-7.9C25 10.2 21 6 15 6z"
              fill={lightOn ? "#fde68a" : "#2a2440"} stroke={lightOn ? "#fef3c7" : "#4b4568"} strokeWidth="1" />
            <rect x="10" y="27" width="10" height="3" rx="1" fill="#b45309" />
            <rect x="11" y="30" width="8" height="2.5" rx="1" fill="#92400e" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Corner pet companion ─────────────────────────────────────────────────────
// Parked bottom-left, reacts in place (never wanders). bank = celebrate,
// cut = wilt/cover, relight = cheer, panic = final-5s dread. Reuses the Simon
// PetEvent pattern; idle breathing + poke are decorative (reduced-motion gated).
function NepaPet({ pet, event, reduceMotion }: { pet: PetStage; event: NepaPetEvent | null; reduceMotion: boolean }) {
  type Reaction = "idle" | "bank" | "cut" | "relight" | "panic";
  const [reaction, setReaction] = useState<Reaction>("idle");
  const [bubble, setBubble] = useState<string | null>(null);

  useEffect(() => {
    if (!event) return;
    setReaction(event.type);
    const bubbles: Record<Reaction, string> = { idle: "", bank: "🎉", cut: "😱", relight: "⚡", panic: "😰" };
    setBubble(bubbles[event.type]);
    const hold = event.type === "cut" ? 1400 : event.type === "panic" ? 900 : 700;
    const t = setTimeout(() => { setReaction("idle"); setBubble(null); }, hold);
    return () => clearTimeout(t);
  }, [event]);

  const ringGlow = reaction === "bank" ? "rgba(134,239,172,0.95)"
    : reaction === "relight" ? "rgba(253,230,138,0.95)"
    : reaction === "cut" ? "rgba(71,85,105,0.85)"
    : reaction === "panic" ? "rgba(251,113,133,0.9)"
    : "rgba(200,205,230,0.5)";
  const wilt = reaction === "cut";
  const animClass = reduceMotion ? undefined
    : (reaction === "bank" || reaction === "relight" || reaction === "panic") ? "nepa-pet-react" : "nepa-pet-idle";

  return (
    <div style={{ position: "absolute", right: 12, bottom: "calc(58% + 10px)", zIndex: 12, pointerEvents: "none", width: 52, height: 52 }}>
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", padding: 3,
        boxShadow: `0 0 22px ${ringGlow}, 0 5px 12px rgba(0,0,0,0.5)`, transition: "box-shadow 0.15s",
        background: "linear-gradient(180deg, rgba(42,12,110,0.9), rgba(7,2,26,0.9))" }}>
        <div className={animClass} style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pet.src} alt="" draggable={false} style={{
            width: "84%", height: "84%", objectFit: "contain",
            filter: wilt ? "grayscale(0.9) brightness(0.6)" : `drop-shadow(0 0 6px ${pet.color}cc)`,
            transition: "filter 0.2s",
          }} />
        </div>
      </div>
      {bubble && (
        <div key={event?.ts} style={{
          position: "absolute", top: -22, left: "50%", transform: "translateX(-50%)",
          fontSize: 20, filter: `drop-shadow(0 0 8px ${ringGlow})`, whiteSpace: "nowrap",
          animation: reduceMotion ? undefined : "bubble-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
        }}>{bubble}</div>
      )}
    </div>
  );
}

// ─── Idle lobby ────────────────────────────────────────────────────────────
function IdleView({ onStart, onExit, onLeaderboard, guest, guestLeft, needsMint, onFinishSetup, gasBanner }: {
  onStart: () => void; onExit: () => void; onLeaderboard: () => void;
  guest?: boolean; guestLeft?: number; needsMint?: boolean; onFinishSetup?: () => void; gasBanner?: React.ReactNode;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, padding: 24 }}>
      <button onClick={onExit} aria-label="Back" style={{ position: "absolute", top: 18, left: 18, width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff", fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}>✕</button>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", color: "rgba(230,220,255,0.6)", fontWeight: 800 }}>SKILL ARENA · NEW</div>
        <h1 style={{ fontFamily: '"Melon Pop","Fredoka",system-ui,sans-serif', fontSize: 46, color: "#fde68a", margin: "6px 0 0", textShadow: "0 0 24px rgba(251,191,36,0.8)", letterSpacing: "0.02em" }}>NEPA: UP LIGHT</h1>
        <p style={{ fontSize: 13, color: "rgba(230,220,255,0.75)", maxWidth: 320, margin: "10px auto 0", lineHeight: 1.5 }}>
          Power&apos;s on. Plug in the devices that matter and bank them before NEPA takes the light. 40 seconds. Charge smart.
        </p>
      </div>

      {gasBanner}

      <NepaTopPlayersPreview onViewAll={onLeaderboard} />

      <button onClick={onStart} style={{
        padding: "16px 48px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: '"Melon Pop","Fredoka",system-ui,sans-serif',
        fontSize: 22, color: "#231005", letterSpacing: "0.04em",
        background: "linear-gradient(180deg,#fde68a 0%,#fbbf24 55%,#d97706 100%)",
        boxShadow: "0 10px 26px -8px rgba(251,191,36,0.9), inset 0 2px 0 rgba(255,255,255,0.6)",
      }}>UP NEPA! ▸</button>

      <button onClick={onLeaderboard} style={{ padding: "9px 22px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(230,220,255,0.85)", fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" }}>LEADERBOARD</button>

      {guest && (
        <div style={{ fontSize: 11, color: "rgba(230,220,255,0.6)", fontWeight: 700 }}>
          {typeof guestLeft === "number" ? `${guestLeft} free run${guestLeft === 1 ? "" : "s"} left · sign in to rank & win G$` : "Sign in to rank & win G$"}
        </div>
      )}
      {needsMint && (
        <button onClick={onFinishSetup} style={{ fontSize: 11, color: "#fbbf24", fontWeight: 800, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>
          Finish setup to save scores & win G$
        </button>
      )}
    </div>
  );
}

// ─── Finish screen · reward panel in the Stack StackRewardPanel mould ────────
function FinishedView({ naira: nairaScore, points, maxCombo, banked, onPlayAgain, onExit, onLeaderboard, onTopUp, submitting, signingOnChain, submitResult, submitError, txError, guest, needsMint }: {
  naira: number; points: number; maxCombo: number; banked: number;
  onPlayAgain: () => void; onExit: () => void; onLeaderboard: () => void; onTopUp?: () => void;
  submitting: boolean; signingOnChain: boolean; submitResult: SubmitResult | null; submitError: string | null; txError: string | null;
  guest?: boolean; needsMint?: boolean;
}) {
  const [shared, setShared] = useState(false);
  const onShare = useCallback(async () => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/games/nepa` : "https://gamearenahq.xyz/games/nepa";
    const text = `I charged ${naira(nairaScore)} before NEPA carried light ⚡ — play NEPA: Up Light on GameArena`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "NEPA: Up Light", text, url });
        return;
      }
    } catch { /* user dismissed the share sheet — fall through to clipboard */ }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch { /* clipboard blocked — nothing more we can do silently */ }
  }, [nairaScore]);

  const stat = (label: string, value: string, color: string, border: string) => (
    <div style={{ padding: "9px 4px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${border}`, textAlign: "center" }}>
      <div style={{ color, fontSize: 17, fontWeight: 900, lineHeight: 1 }}>{value}</div>
      <div style={{ color: "rgba(230,220,255,0.55)", fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", marginTop: 3 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "24px 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", color: "rgba(230,220,255,0.6)", fontWeight: 800 }}>NEPA DON CARRY LIGHT</div>
          <div style={{ fontFamily: '"Melon Pop","Fredoka",system-ui,sans-serif', fontSize: 50, color: "#fde68a", lineHeight: 1, margin: "8px 0 0", textShadow: "0 0 24px rgba(251,191,36,0.8)" }}>{"₦" + Math.round(nairaScore).toLocaleString()}</div>
          <div style={{ fontSize: 12.5, color: "rgba(230,220,255,0.7)", marginTop: 6, fontWeight: 700 }}>{points} points banked</div>
        </div>

        {/* Stat grid — the run's story, computed in endGame and threaded here. */}
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {stat("BANKED ₦", "₦" + Math.round(nairaScore).toLocaleString(), "#fde68a", "rgba(251,191,36,0.3)")}
          {stat("POINTS", points.toLocaleString(), "#86efac", "rgba(52,211,153,0.3)")}
          {stat("MAX COMBO", maxCombo > 0 ? `×${maxCombo}` : "—", "#f0abfc", "rgba(232,121,249,0.3)")}
          {stat("DEVICES BANKED", String(banked), "#67e8f9", "rgba(103,232,249,0.3)")}
        </div>

        {/* Guest / unminted funnels reuse the shared prompts. */}
        {guest && <div style={{ marginTop: 14 }}><GuestScorePrompt nextPath="/games/nepa" /></div>}
        {!guest && needsMint && <div style={{ marginTop: 14 }}><MintScorePrompt score={points} headline="Charge banked — mint to save it" /></div>}

        {/* Signed-in minted: the full reward panel (rank/XP/PB/achievements). */}
        {!guest && !needsMint && (
          <NepaRewardPanel
            submitting={submitting}
            signingOnChain={signingOnChain}
            result={submitResult}
            error={submitError}
            txError={txError}
            points={points}
            onTopUp={onTopUp}
          />
        )}

        {/* SHARE — brag with the banked total, native sheet or clipboard. */}
        <button onClick={onShare} style={{
          marginTop: 14, width: "100%", padding: "11px 14px", borderRadius: 12,
          background: "rgba(134,239,172,0.1)", border: "1px solid rgba(134,239,172,0.4)",
          color: "#86efac", fontSize: 12.5, fontWeight: 900, letterSpacing: "0.1em",
          cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          {shared ? "COPIED ✓" : (<><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>SHARE YOUR RUN</>)}
        </button>

        <div style={{ marginTop: 14, display: "flex", gap: 12, justifyContent: "center" }}>
          <button onClick={onPlayAgain} style={{
            padding: "14px 34px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: '"Melon Pop","Fredoka",system-ui,sans-serif',
            fontSize: 18, color: "#231005", background: "linear-gradient(180deg,#fde68a,#fbbf24 60%,#d97706)",
            boxShadow: "0 8px 20px -8px rgba(251,191,36,0.9)",
          }}>PLAY AGAIN</button>
          <button onClick={onLeaderboard} style={{ padding: "14px 24px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(230,220,255,0.85)", fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit" }}>BOARD</button>
        </div>
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={onExit} style={{ fontSize: 11.5, color: "rgba(230,220,255,0.55)", background: "none", border: "none", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>← Back to lobby</button>
        </div>
      </div>
    </div>
  );
}

// ─── Nepa reward panel · the submit-state machine inside the finish screen ───
// Mirrors Stack's StackRewardPanel: signing → saving → error/top-up → result
// grid (rank + XP) + new-best delta + unlocked achievements.
function NepaRewardPanel({ submitting, signingOnChain, result, error, txError, points, onTopUp }: {
  submitting: boolean; signingOnChain: boolean; result: SubmitResult | null;
  error: string | null; txError: string | null; points: number; onTopUp?: () => void;
}) {
  if (signingOnChain) {
    return (
      <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24", fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", textAlign: "center" }}>
        ✦ CONFIRM IN YOUR WALLET ✦
        <div style={{ color: "rgba(230,220,255,0.65)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginTop: 4 }}>Signing records your run on-chain</div>
      </div>
    );
  }
  if (submitting) {
    return (
      <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", color: "rgba(230,220,255,0.7)", fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textAlign: "center" }}>SAVING YOUR RUN…</div>
    );
  }
  if (txError) {
    const isGasError = txError.toLowerCase().includes("top up");
    if (isGasError && onTopUp) {
      return (
        <button onClick={onTopUp} style={{ width: "100%", marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.45)", color: "#fdba74", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
          <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>⛽</span>
          <span style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", lineHeight: 1.2 }}>Score not saved · needs a top up</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(253,186,116,0.85)", lineHeight: 1.35, marginTop: 3 }}>Tap to ask for gas in Telegram</div>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      );
    }
    return (
      <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(252,165,165,0.85)", fontSize: 11, fontWeight: 700, textAlign: "center", lineHeight: 1.45 }}>{txError}</div>
    );
  }
  if (error) {
    return (
      <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(252,165,165,0.85)", fontSize: 11, fontWeight: 700, textAlign: "center", lineHeight: 1.45 }}>{error}</div>
    );
  }
  if (!result) return null;

  const { rank, xpEarned, isNewPb, prevBest, newAchievements = [] } = result;
  const showPbDelta = isNewPb && typeof prevBest === "number" && prevBest > 0;
  const nairaDelta = showPbDelta && typeof prevBest === "number" ? Math.max(0, points - prevBest) * NAIRA_PER_POINT : 0;
  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {rank ? (
          <div style={{ padding: "10px 8px", borderRadius: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.28)", textAlign: "center" }}>
            <div style={{ color: "rgba(230,220,255,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.16em" }}>RANK THIS WEEK</div>
            <div style={{ color: "#fbbf24", fontSize: 22, fontWeight: 900, textShadow: "0 0 10px rgba(251,191,36,0.6)", marginTop: 2 }}>#{rank}</div>
          </div>
        ) : <div />}
        {typeof xpEarned === "number" ? (
          <div style={{ padding: "10px 8px", borderRadius: 10, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", textAlign: "center" }}>
            <div style={{ color: "rgba(230,220,255,0.6)", fontSize: 9, fontWeight: 800, letterSpacing: "0.16em" }}>XP GAINED</div>
            <div style={{ color: "#a78bfa", fontSize: 22, fontWeight: 900, textShadow: "0 0 10px rgba(167,139,250,0.7)", marginTop: 2 }}>+{xpEarned}</div>
          </div>
        ) : <div />}
      </div>

      {showPbDelta && (
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "linear-gradient(90deg, rgba(251,191,36,0.15) 0%, rgba(34,197,94,0.15) 100%)", border: "1px solid rgba(251,191,36,0.4)", textAlign: "center", boxShadow: "0 0 20px rgba(251,191,36,0.2)" }}>
          <div style={{ color: "#fde68a", fontSize: 12, fontWeight: 900, letterSpacing: "0.2em" }}>★ NEW PERSONAL BEST ★</div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 800, marginTop: 3 }}>
            Beat your best by <span style={{ color: "#86efac", fontWeight: 900 }}>+{naira(nairaDelta)}</span>
          </div>
        </div>
      )}
      {isNewPb && !showPbDelta && (
        <div style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(134,239,172,0.1)", border: "1px solid rgba(134,239,172,0.35)", textAlign: "center", color: "#86efac", fontSize: 12, fontWeight: 900, letterSpacing: "0.12em" }}>🏆 FIRST SCORE ON THE BOARD</div>
      )}

      {newAchievements.length > 0 && newAchievements.map(a => (
        <div key={a.id} style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.32)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 22 }}>{a.icon || "🏆"}</div>
          <div style={{ textAlign: "left" }}>
            <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em" }}>UNLOCKED</div>
            <div style={{ color: "#fff", fontSize: 12, fontWeight: 800 }}>{a.name}</div>
            {a.desc && <div style={{ color: "rgba(230,220,255,0.65)", fontSize: 10, fontWeight: 700 }}>{a.desc}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Lobby top-3 preview · reuses the shared leaderboardPreview cache (gt 4) ──
function NepaTopPlayersPreview({ onViewAll }: { onViewAll: () => void }) {
  const seed = getCachedPreview(4);
  const [top, setTop] = useState<LeaderboardEntry[] | null>(seed?.top ?? null);
  const [seasonNum, setSeasonNum] = useState<number | null>(seed?.seasonNum ?? null);

  useEffect(() => {
    let cancelled = false;
    fetchPreview(4).then(v => {
      if (cancelled) return;
      setTop(v.top);
      setSeasonNum(v.seasonNum);
    }).catch(() => { if (!cancelled && top === null) setTop([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tierColor = (i: number) => i === 0 ? "#fde68a" : i === 1 ? "#e2e8f0" : "#fb923c";
  const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
  const fmtName = (e: LeaderboardEntry) => e.username ? `@${e.username.replace(/^@/, "")}` : `${e.player.slice(0, 6)}…${e.player.slice(-4)}`;

  return (
    <div style={{ width: "min(320px, 86vw)", borderRadius: 18, padding: 2, background: "linear-gradient(135deg, rgba(251,191,36,0.6), rgba(251,191,36,0.16))", boxShadow: "0 8px 22px -8px rgba(251,191,36,0.55), 0 0 32px rgba(251,191,36,0.15)" }}>
      <div style={{ borderRadius: 16, background: "linear-gradient(180deg, rgba(20,10,46,0.92), rgba(7,2,26,0.95))", padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.18em", color: "rgba(253,230,138,0.9)", textTransform: "uppercase" }}>Top this week</span>
          <span style={{ fontSize: 9.5, color: "rgba(230,220,255,0.45)", fontWeight: 800, letterSpacing: "0.08em" }}>{seasonNum ? `SEASON ${seasonNum} · LIVE` : "LIVE"}</span>
        </div>

        {top === null && (
          <div style={{ fontSize: 11, color: "rgba(230,220,255,0.55)", padding: "6px 2px" }}>Loading…</div>
        )}
        {top !== null && top.length === 0 && (
          <div style={{ fontSize: 11.5, color: "rgba(253,230,138,0.8)", fontWeight: 800, padding: "8px 2px", textAlign: "center" }}>
            ⚡ Be the first on the board
          </div>
        )}
        {top !== null && top.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {top.map((e, i) => (
              <div key={e.player} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ width: 18, textAlign: "center", fontSize: 13, color: tierColor(i), textShadow: `0 0 6px ${tierColor(i)}88` }}>{medal(i)}</span>
                <span style={{ flex: 1, color: "rgba(255,255,255,0.95)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtName(e)}</span>
                <span style={{ color: tierColor(i), fontWeight: 900, textShadow: `0 0 6px ${tierColor(i)}55` }}>{e.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        <button onClick={onViewAll} style={{ marginTop: 2, padding: "7px 0", borderRadius: 10, background: "transparent", border: "none", color: "#fbbf24", fontFamily: "inherit", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", cursor: "pointer" }}>VIEW LEADERBOARD ›</button>
      </div>
    </div>
  );
}

// ─── One-time HOW TO PLAY teach card ─────────────────────────────────────────
// The owner literally didn't understand the loop, so new players get a crisp
// 4-beat walkthrough before their first run. A guided first-plug (paused clock,
// real sockets) was the richer option but would have meant threading a tutorial
// mode through the loop + anti-cheat replay — too invasive for a UI-only pass
// that must not touch the mechanic — so this is the safe illustrated fallback.
// Gated on localStorage by the caller; skippable; both buttons start the run.
function HowToPlayCard({ reduceMotion, onStart, onSkip }: { reduceMotion: boolean; onStart: () => void; onSkip: () => void }) {
  const socketSvg = (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="4" stroke="#c084fc" strokeWidth="1.6"/><rect x="9" y="8.5" width="1.8" height="4" rx="0.9" fill="#c084fc"/><rect x="13" y="8.5" width="1.8" height="4" rx="0.9" fill="#c084fc"/></svg>
  );
  const beats: { art: React.ReactNode; title: string; body: string }[] = [
    { art: DEVICES[0].icon(30), title: "Tap a device to plug it in", body: "It drops into a free socket and starts charging." },
    { art: (<svg width="30" height="30" viewBox="0 0 30 38"><path d="M15 6c-6 0-10 4.2-10 9.4 0 3.9 2.3 6.2 3.8 7.9 1 1.1 1.6 2 1.7 3.2h9c.1-1.2.7-2.1 1.7-3.2 1.5-1.7 3.8-4 3.8-7.9C25 10.2 21 6 15 6z" fill="#fde68a" stroke="#fef3c7" strokeWidth="1"/></svg>), title: "It charges only while the LIGHT is ON", body: "Watch the meter — plug the best value-per-second first." },
    { art: socketSvg, title: "Tap the FULL socket to BANK ₦", body: "Grab the cash before time runs out — unbanked devices are lost." },
    { art: (<span style={{ fontSize: 28 }}>🕯️</span>), title: "NEPA cuts the light at random", body: "Charging stops the instant it goes dark. Bank smart." },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(4,0,20,0.86)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 18px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 360, borderRadius: 22, padding: 2, background: "linear-gradient(135deg, rgba(251,191,36,0.6), rgba(168,85,247,0.4))", boxShadow: "0 18px 50px -10px rgba(0,0,0,0.7)" }}>
        <div style={{ borderRadius: 20, background: "linear-gradient(180deg, #221053 0%, #120733 70%, #07031c 100%)", border: "1.5px solid rgba(255,255,255,0.1)", padding: "22px 20px" }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "rgba(230,220,255,0.6)", fontWeight: 800 }}>HOW TO PLAY</div>
            <div style={{ fontFamily: '"Melon Pop","Fredoka",system-ui,sans-serif', fontSize: 30, color: "#fde68a", marginTop: 4, textShadow: "0 0 18px rgba(251,191,36,0.7)" }}>NEPA: UP LIGHT</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {beats.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className={reduceMotion ? undefined : "nepa-teach-pulse"} style={{
                  flexShrink: 0, width: 46, height: 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(168,85,247,0.35)",
                }}>{b.art}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#fff", fontWeight: 900, lineHeight: 1.2 }}><span style={{ color: "#fbbf24" }}>{i + 1}.</span> {b.title}</div>
                  <div style={{ fontSize: 11, color: "rgba(230,220,255,0.7)", fontWeight: 600, lineHeight: 1.35, marginTop: 2 }}>{b.body}</div>
                </div>
              </div>
            ))}
          </div>

          <button onClick={onStart} style={{
            marginTop: 20, width: "100%", padding: "15px", borderRadius: 14, border: "none", cursor: "pointer",
            fontFamily: '"Melon Pop","Fredoka",system-ui,sans-serif', fontSize: 20, color: "#231005", letterSpacing: "0.04em",
            background: "linear-gradient(180deg,#fde68a 0%,#fbbf24 55%,#d97706 100%)",
            boxShadow: "0 10px 26px -8px rgba(251,191,36,0.9), inset 0 2px 0 rgba(255,255,255,0.6)",
          }}>GOT IT — PLAY ▸</button>
          <button onClick={onSkip} style={{ marginTop: 10, width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, color: "rgba(230,220,255,0.55)" }}>Skip</button>
        </div>
      </div>
    </div>
  );
}
