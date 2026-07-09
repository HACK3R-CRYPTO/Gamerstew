"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAccount, useSignMessage, useWriteContract, useReadContract } from "wagmi";
import MintScorePrompt from "@/components/MintScorePrompt";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useAuthStatus } from "@/hooks/useRequireAuth";
import GuestScorePrompt, { GuestPlayChip } from "@/components/GuestScorePrompt";
import { useAudioSettings, effectiveGains } from "@/hooks/useAudioSettings";
import { playRankReveal, playSaveSuccess, playLevelUp, playAchievementChime } from "@/hooks/useAppAudio";
import {
  signScore, signScoreMiniPay,
  submitScore, submitScoreMiniPay,
  startGame as startGameAction,
  startGameMiniPay as startGameMiniPayAction,
  type RhythmTap,
} from "@/app/actions/game";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI, detectFeeSpread } from "@/lib/contracts";
import { fetchLeaderboard, type LeaderboardEntry } from "@/lib/subgraph";
import { fetchPreview, getCachedPreview } from "@/lib/leaderboardPreview";
import { hydrateAchievement } from "@/lib/achievements";
import LevelUpToast from "@/components/LevelUpToast";
import PetEvolveToast from "@/components/PetEvolveToast";
import { PushOptInModal } from "@/components/PushOptInModal";
import NoteCanvas, { type NoteCanvasHandle } from "@/components/rhythm/NoteCanvas";
import { useGameJuice, JuiceOverlay } from "@/hooks/useGameJuice";
import { GasHelpSheet } from "@/components/GasHelpSheet";
import { LowGasBanner } from "@/components/LowGasBanner";
import { useGasStatus } from "@/hooks/useGasStatus";
import ArenaCrossPromo from "@/components/ArenaCrossPromo";

// Only used for browser-safe READ endpoints (user level lookup). Write paths
// go through server actions so the games-backend URL is never sent to the client.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// ─── Pet stages (same data as profile — pet evolves with your level) ──────────
type PetStage = { id: string; name: string; src: string; minLevel: number; color: string };
const PET_STAGES: PetStage[] = [
  { id: "egg", name: "Mystery Egg", src: "/pets/stage-1-egg.png", minLevel: 1, color: "#e2e8f0" },
  { id: "baby", name: "Baby Slime", src: "/pets/stage-2-baby.png", minLevel: 5, color: "#22c55e" },
  { id: "teen", name: "Teen Slime", src: "/pets/stage-3-teen.png", minLevel: 15, color: "#a78bfa" },
  { id: "crystal", name: "Crystal Slime", src: "/pets/stage-4-crystal.png", minLevel: 30, color: "#06b6d4" },
  { id: "king", name: "King Slime", src: "/pets/stage-5-king.png", minLevel: 50, color: "#fbbf24" },
];
function petForLevel(level: number): PetStage {
  let stage = PET_STAGES[0];
  for (const s of PET_STAGES) if (level >= s.minLevel) stage = s;
  return stage;
}

// ─── Game constants ───────────────────────────────────────────────────────────
const TRACK_DURATION = 45;        // seconds — gives space for verse/hook to repeat
// PERFECT was ±120ms — too forgiving, players were hitting near-100% perfect
// runs without effort. Tightened to ±80ms, which matches Magic Tiles 3 and
// most mobile rhythm games. GOOD stays at ±280ms so casual play still feels
// fair; the gap between PERFECT and GOOD is now where skill matters.
const PERFECT_WINDOW = 0.08;      // ±80ms — skill threshold
const GOOD_WINDOW = 0.28;      // ±280ms — casual safety net
const BPM = 120;       // 120 BPM → 0.5s per beat (readable)
const BEAT = 60 / BPM;

// Travel time PER SECTION — tuned for Magic Tiles / DJMAX readability.
// Longer = more time to see the tile coming. Never drop below 1.3s (too stressful).
const TRAVEL_INTRO = 2.5;   // slow — teach the mechanic
const TRAVEL_VERSE = 2.1;   // medium
const TRAVEL_BUILD = 1.7;   // faster — building tension
const TRAVEL_DROP = 1.4;   // fastest — but still readable

// ─── Scoring 2.0 · addition only ──────────────────────────────────────────────
// The two laws: points only ADD (no standing multipliers), difficulty only
// RISES (the encore accelerates until it beats you). The old design multiplied
// points by an uncapped combo multiplier AND let a flat encore run forever —
// stacked, those produced quadratic million-point scores that measured
// patience, not skill. New math: Perfect=10, Good=5, flat. FEVER is the only
// multiplier in the game — ×2 for 6 seconds, earned by a streak of PERFECTs,
// killed instantly by a miss. Temporary by nature, so it can't compound.
// A perfect main run lands ~600-900 with fever; deep encore survival adds a
// few hundred more before the speed wall ends the run. No caps anywhere —
// big numbers aren't forbidden, they're unreachable.
const FEVER_TRIGGER = 12;    // consecutive PERFECTs to ignite fever
const FEVER_DURATION = 6;    // seconds of ×2 once ignited
const FEVER_MULT = 2;        // the only multiplier in the game
const ENCORE_POINTS = 5;     // flat per encore tile — encore is for glory, not farming

// ─── V2 splash icons — ambient background ─────────────────────────────────────
const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";

const BG_ICONS = [
  { src: M, top: "5%", left: "-18px", size: 100, dur: 4.0, delay: 0, rotate: -12 },
  { src: D, top: "18%", right: "20px", size: 80, dur: 5.2, delay: 0.5, rotate: 15 },
  { src: M, top: "42%", left: "22px", size: 70, dur: 4.6, delay: 1.1, rotate: -8 },
  { src: G, top: "60%", right: "-10px", size: 95, dur: 5.8, delay: 0.3, rotate: 10 },
  { src: J, top: "76%", left: "-14px", size: 88, dur: 5.0, delay: 1.7, rotate: -18 },
  { src: M, top: "88%", right: "30px", size: 72, dur: 4.2, delay: 0.9, rotate: 20 },
];

// ─── Ambient starfield type (hoisted to module scope for the memo below) ──────
type Star = { x: number; y: number; size: number; delay: number; dur: number; alpha: number };

// ─── Ambient background layer — memoized so per-tap score/combo re-renders of
// the parent skip re-rendering these ~50 animated divs. `active` (true during
// live play) pauses the CSS animations. ────────────────────────────────────────
const AmbientLayer = React.memo(function AmbientLayer({ stars, active }: { stars: Star[]; active: boolean }) {
  return (
    <>
      {stars.map((s, i) => (
        <div key={i} className={active ? "" : "dot-pulse"} style={{
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

      {BG_ICONS.map((ic, i) => (
        <div key={i} className={active ? "" : "icon-float"} style={{
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
    </>
  );
});

// ─── Lane palette (V2 discipline: magenta world + 3 supporting game colors) ──
type LaneTheme = { wall: string; face: string; glow: string; accent: string };
const LANES: LaneTheme[] = [
  { wall: "#7c1d5a", face: "linear-gradient(160deg, #f5a3ef 0%, #e879f9 50%, #c026d3 100%)", glow: "rgba(232,121,249,0.8)", accent: "#e879f9" },
  { wall: "#083a6b", face: "linear-gradient(160deg, #93c5fd 0%, #3b82f6 50%, #1d4ed8 100%)", glow: "rgba(59,130,246,0.8)", accent: "#3b82f6" },
  { wall: "#7c2d00", face: "linear-gradient(160deg, #fde68a 0%, #fbbf24 50%, #b45309 100%)", glow: "rgba(251,191,36,0.85)", accent: "#fbbf24" },
  { wall: "#003a00", face: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)", glow: "rgba(34,197,94,0.8)", accent: "#22c55e" },
];

// ─── Note chart — London Bridge Is Falling Down, C major ────────────────────
// Piano Tiles principle: the sequence of taps IS the melody. Every tile has
// a lane (visual) AND a freq (the note it plays when tapped). Lanes run
// low-left to high-right so tapping across the screen feels like walking
// up a piano keyboard.
//
// Mapping (diatonic):
//   lane 0 → C5, D5   (bottom of the scale)
//   lane 1 → E5       (mid-low)
//   lane 2 → F5       (mid)
//   lane 3 → G5, A5   (top — both share since London Bridge climbs to A)
//
// Song: "London Bridge Is Falling Down" — traditional English nursery rhyme.
// Switched in for this new season. Stays in C major so the I-V-vi-IV-I-V
// chord progression and audio scheduling carry over without rework. London
// Bridge is one note higher than Saints (it climbs to A5), so the high
// lane (3) holds both G and A — the rocking back-and-forth between them
// at the start IS the song's recognizable hook.
type NoteDef = { id: number; lane: number; time: number; travel: number; freq: number };

// C major scale pitches — London Bridge spans D5 → A5.
const P_C5 = 523.25, P_D5 = 587.33, P_E5 = 659.25, P_F5 = 698.46,
  P_G5 = 783.99, P_A5 = 880.00;

function buildChart(): NoteDef[] {
  const notes: NoteDef[] = [];
  let id = 0;
  const push = (lane: number, time: number, travel: number, freq: number) =>
    notes.push({ id: id++, lane, time, travel, freq });

  // London Bridge canonical melody — exact pitches from noobnotes/Skoove,
  // no padding. Two full verses (P1-P4 and P5-P8), then an eighth-note
  // climax reprise (P9) of the opening hook for skill expression. The
  // half-step climax is THE place where "perfect" runs separate skilled
  // players from casual ones — coupled with the ±80ms PERFECT window,
  // the leaderboard gap forms here.
  //   P1: G A G F E F G         (7, "London Bridge is falling down")
  //   P2: D E F E F G           (6, "falling down, falling down")
  //   P3: G A G F E F G         (7, repeat opening line)
  //   P4: D G E C               (4, "my fair lady" — clean tonic resolve)
  //   P5: G A G F E F G         (7, verse 2 opening)
  //   P6: D E F E F G           (6, verse 2 second line)
  //   P7: G A G F E F G         (7, verse 2 third line)
  //   P8: D G E C               (4, verse 2 final cadence)
  //   P9: G A G F E F G         (7, eighth-note climax — half tempo, skill check)
  type Pitch = number;
  const P1: Pitch[] = [P_G5, P_A5, P_G5, P_F5, P_E5, P_F5, P_G5];
  const P2: Pitch[] = [P_D5, P_E5, P_F5, P_E5, P_F5, P_G5];
  const P3: Pitch[] = P1;
  const P4: Pitch[] = [P_D5, P_G5, P_E5, P_C5];
  const P5: Pitch[] = P1;
  const P6: Pitch[] = P2;
  const P7: Pitch[] = P1;
  const P8: Pitch[] = P4;
  const P9: Pitch[] = P1;  // climax reprise — same pitches, half the time

  // Lane map — low-left to high-right. C D on lane 0, E on lane 1, F on
  // lane 2, G on lane 3. Spreads the six-note Ode palette across all four
  // lanes so the player's hand visits every tile zone.
  const laneFor = (f: Pitch): number => {
    if (f === P_C5 || f === P_D5) return 0;
    if (f === P_E5) return 1;
    if (f === P_F5) return 2;
    return 3; // P_G5
  };

  // Section stamper — lays a phrase at `start` with the given `travel` and
  // `step` (seconds per note). Quarter notes on the first pass, eighth-note
  // reprise for the climb, which is how rhythm games build tension without
  // changing the tune.
  const stamp = (phrase: Pitch[], start: number, travel: number, step = BEAT) => {
    phrase.forEach((f, i) => push(laneFor(f), start + i * step, travel, f));
  };

  // ─── Full canonical play-through ─────────────────────────────────────────
  //   All 8 phrases end to end at quarter notes. One 0.5s breath between
  //   each phrase so the ear hears the phrasing. Travel tightens as the
  //   song progresses so early tiles are readable and the finale drives.

  // ─── Verse 1 — quarter notes, teaches the melody ─────────────────────────
  // Phrase 1 (4.0s → 7.5s): G A G F E F G — "London Bridge is falling down"
  stamp(P1, 4.0, TRAVEL_INTRO);

  // Phrase 2 (8.0s → 11.0s): D E F E F G — "falling down, falling down"
  stamp(P2, 8.0, TRAVEL_INTRO);

  // Phrase 3 (11.5s → 15.0s): G A G F E F G — repeat opening line
  stamp(P3, 11.5, TRAVEL_VERSE);

  // Phrase 4 (15.5s → 17.5s): D G E C — "my fair lady" cadence
  stamp(P4, 15.5, TRAVEL_VERSE);

  // ─── Verse 2 — same melody, internalisation phase ────────────────────────
  // Phrase 5 (18.0s → 21.5s): G A G F E F G
  stamp(P5, 18.0, TRAVEL_VERSE);

  // Phrase 6 (22.0s → 25.0s): D E F E F G
  stamp(P6, 22.0, TRAVEL_BUILD);

  // Phrase 7 (25.5s → 29.0s): G A G F E F G
  stamp(P7, 25.5, TRAVEL_BUILD);

  // Phrase 8 (29.5s → 31.5s): D G E C — verse 2 final cadence
  stamp(P8, 29.5, TRAVEL_DROP);

  // ─── Climax (32.5s → 34.25s): EIGHTH-NOTE reprise of the opening hook ────
  // Same 7 pitches as P1, played at half the time (250ms apart instead of
  // 500ms). This is THE skill check — coupled with the ±80ms PERFECT
  // window, it's where consistent perfect runs separate skilled players
  // from casual ones. The leaderboard gap forms here.
  stamp(P9, 32.5, TRAVEL_DROP, BEAT / 2);

  // ─── RITARDANDO (36.0s → 43.0s): held tonic — the "Freude!" resolution.
  //   The tutorial ends P8 with "C C" held; rhythm games need the timeline
  //   filled, so we lay three more C's at slowing intervals. Still canonical
  //   in spirit: the piece simply holds its tonic to close.
  const holds: number[] = [36.0, 38.0, 40.0, 42.5];
  holds.forEach(t => push(laneFor(P_C5), t, TRAVEL_BUILD, P_C5));

  return notes.sort((a, b) => a.time - b.time);
}

// ─── Grades ────────────────────────────────────────────────────────────────────
// Graded on MAIN-TRACK ACCURACY (perfect=1, good=½, over the chart's note
// count), not on raw score. Score includes fever bonuses + encore survival;
// the grade answers one question only: how well did you play the song?
// Encore depth gets its own badge on the finish screen instead.
const MAIN_NOTE_COUNT = 59; // buildChart() note count — keep in sync if the chart changes
function gradeFor(accuracy: number) {
  if (accuracy >= 0.95) return { letter: "S", color: "#fbbf24", desc: "PERFECTION" };
  if (accuracy >= 0.85) return { letter: "A", color: "#e2e8f0", desc: "EXCELLENT" };
  if (accuracy >= 0.70) return { letter: "B", color: "#67e8f9", desc: "GREAT" };
  if (accuracy >= 0.50) return { letter: "C", color: "#22c55e", desc: "GOOD" };
  return { letter: "D", color: "#f97316", desc: "KEEP GOING" };
}

// ─── Particle burst — spawned on every hit ───────────────────────────────────
type Burst = { id: number; x: number; y: number; color: string; born: number };

// ─── Page ──────────────────────────────────────────────────────────────────────
type Phase = "idle" | "countdown" | "playing" | "encore" | "finished";

// Encore pool — one full canonical verse of London Bridge: opening line,
// falling-down answer, repeat opening, my-fair-lady cadence. Player hears
// the unmodified nursery rhyme cycle as tile pace accelerates.
//   P1 + P2: G A G F E F G | D E F E F G
//   P3 + P4: G A G F E F G | D G E C
// Lane mapping matches buildChart.laneFor:
//   C, D → lane 0   E → lane 1   F → lane 2   G, A → lane 3
const ENCORE_POOL: [number, number][] = [
  // Phrase 1 — G A G F E F G (London Bridge is falling down)
  [3, P_G5], [3, P_A5], [3, P_G5], [2, P_F5],
  [1, P_E5], [2, P_F5], [3, P_G5],
  // Phrase 2 — D E F E F G (falling down, falling down)
  [0, P_D5], [1, P_E5], [2, P_F5], [1, P_E5],
  [2, P_F5], [3, P_G5],
  // Phrase 3 — G A G F E F G (repeat opening)
  [3, P_G5], [3, P_A5], [3, P_G5], [2, P_F5],
  [1, P_E5], [2, P_F5], [3, P_G5],
  // Phrase 4 — D G E C (my fair lady, clean tonic resolve)
  [0, P_D5], [3, P_G5], [1, P_E5], [0, P_C5],
];

export default function RhythmGamePage() {
  const router = useRouter();
  const { address } = useAccount();
  // Free-play route: guests can play full runs without connecting.
  // Score submission self-guards (the submit effect bails without an
  // address), and the finish screen shows a sign-in CTA instead of
  // the rank/XP panel. Signing in is the gate for SAVING, not PLAYING.
  const { authed } = useAuthStatus();
  // Has this connected wallet minted a GamePass? A whitelisted wallet can
  // come in to claim UBI and play without minting, but scores can't save
  // on-chain without a pass. needsMint drives the finish screen to show a
  // "mint to save" conversion prompt instead of firing a tx that reverts.
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const needsMint = authed && hasMinted === false;
  const [phase, setPhase] = useState<Phase>("idle");

  // User audio preferences from profile — persisted in localStorage.
  // We pull this into a ref so audio callbacks can read the latest value
  // without being re-created (which would break useCallback stability).
  const audioSettings = useAudioSettings();
  const gainsRef = useRef(effectiveGains(audioSettings));
  useEffect(() => { gainsRef.current = effectiveGains(audioSettings); }, [audioSettings]);

  // Fetch user level so the pet shown matches the player's actual pet stage
  const [playerLevel, setPlayerLevel] = useState(1);
  useEffect(() => {
    if (!address) return;
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.json())
      .then(d => setPlayerLevel(d.level || 1))
      .catch(() => { });
  }, [address]);
  const pet = petForLevel(playerLevel);

  // ═══ Audio: Web Audio API drum synth + hit SFX (no external files — guaranteed sync) ═══
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Track scheduled drum nodes so we can cut them off if the player exits early
  const scheduledNodesRef = useRef<AudioScheduledSourceNode[]>([]);
  // Reused hihat buffer — created once, shared across all 180+ hihat calls so we
  // don't spike the JS heap allocating a new AudioBuffer on every eighth note.
  // On low-RAM Android devices (Redmi etc.) repeated buffer allocation causes GC
  // pauses that produce the "cracking" audio stutter players reported.
  const hihatBufferRef = useRef<AudioBuffer | null>(null);

  // Initialize WebAudio context lazily (needs user gesture).
  // Also resumes the context if Android Chrome suspended it on a touch event —
  // suspended context causes audio scheduling to succeed silently while nothing
  // actually plays, perceived as cracking or silence by the player.
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    // Resume silently suspended contexts (common on Android Chrome after
    // background/foreground transitions or memory pressure events).
    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  // ─── Drum synth helpers ────────────────────────────────────────────────────
  // All three are scheduled using ctx.currentTime + offset — sample-accurate,
  // never drifts from the note chart because both use the same clock.

  // Bass note — clean pitched pulse playing the chord roots.
  // All three scheduler helpers (bass, lead, hat) are "music" — they multiply
  // their volume through the user's music gain so muting music kills them all.
  const scheduleBass = useCallback((ctx: AudioContext, when: number, freq: number, volume = 0.38) => {
    const v = volume * gainsRef.current.music;
    if (v <= 0) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    filter.type = "lowpass";
    filter.frequency.value = 420;
    filter.Q.value = 1;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(v, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(when); osc.stop(when + 0.24);
    osc.onended = () => { try { osc.disconnect(); filter.disconnect(); gain.disconnect(); } catch { /* already gone */ } };
    scheduledNodesRef.current.push(osc);
  }, []);

  // Lead melody — soft triangle synth through a lowpass, plays the song's hook
  // on top of the bass. This is what makes it sound like an actual tune instead
  // of just a beat. Volume stays below the bells so player hits always win.
  const scheduleLead = useCallback((ctx: AudioContext, when: number, freq: number, duration: number, volume = 0.12) => {
    const v = volume * gainsRef.current.music;
    if (v <= 0) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    filter.type = "lowpass";
    filter.frequency.value = 2800;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(v, when + 0.015);
    gain.gain.setValueAtTime(v, when + duration * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(when); osc.stop(when + duration + 0.02);
    osc.onended = () => { try { osc.disconnect(); filter.disconnect(); gain.disconnect(); } catch { /* already gone */ } };
    scheduledNodesRef.current.push(osc);
  }, []);

  const scheduleHihat = useCallback((ctx: AudioContext, when: number, volume = 0.12) => {
    const v = volume * gainsRef.current.music;
    if (v <= 0) return;
    // Reuse the hihat noise buffer — create it once on first call, then reuse.
    // Previously a new AudioBuffer was allocated on every hihat note (~180 times
    // over a 45s game). On low-RAM devices (Redmi, budget Android) this repeated
    // allocation causes GC pauses that produce audible cracking/stuttering.
    if (!hihatBufferRef.current || hihatBufferRef.current.sampleRate !== ctx.sampleRate) {
      const bufferSize = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      hihatBufferRef.current = buf;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = hihatBufferRef.current;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass"; filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(v, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    noise.start(when); noise.stop(when + 0.06);
    // Auto-disconnect once the node finishes to release the WebAudio graph
    // reference immediately instead of waiting for game-end cleanup.
    noise.onended = () => { try { noise.disconnect(); } catch { /* already disconnected */ } };
    scheduledNodesRef.current.push(noise);
  }, []);

  // Schedule the 45-second backing track: a musical C major bassline + hi-hats.
  // Voiced in C major so it consonates with the London Bridge melody the
  // player taps out on top. Pitched bass plays the chord roots so a bell on
  // top plus a bass root = full triad in your ear.
  //
  // Sections follow the chart exactly (45s total):
  //   intro   (0–9s)    → hats only → soft C2 pulse starting t=4
  //   verse1  (9–15s)   → I-V-vi-IV progression — works for any C-major
  //                       hymn/folk melody we slot in (Ode to Joy, Saints,
  //                       London Bridge all share the tonal centre)
  //   build1  (15–21s)  → C major arpeggio on every beat, ascending
  //   drop1   (21–29s)  → driving I-V pattern on every beat
  //   break   (29–30s)  → hats only — the calm before the reprise
  //   verse2  (30–35s)  → same progression as verse 1 (the earworm repeats)
  //   build2  (35–37s)  → short re-ramp
  //   drop2   (37–44s)  → final drop, loudest, resolves on C
  //   outro   (44–45s)  → hats tail
  const scheduleDrumTrack = useCallback((audioStartTime: number) => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const total = TRACK_DURATION;
    const eighth = BEAT / 2;

    // C major note frequencies — used by every bass call
    const C2 = 65.41;
    const E2 = 82.41;
    const F2 = 87.31;
    const G2 = 98.00;
    const A2 = 110.00;

    // ── INTRO pulse (4.0s–8.5s)
    for (let t = 4.0; t < 9.0; t += BEAT) {
      scheduleBass(ctx, audioStartTime + t, C2, 0.3);
    }

    // ── VERSE 1 progression (9.0s–15.0s): I-V-vi-IV-I-V
    // C G Am F C G in C major — generic enough to harmonise any folk/hymn
    // melody we slot into the chart. Resolves to the tonic; the Am passing
    // chord adds colour without dragging.
    const verseChords = [C2, G2, A2, F2, C2, G2];
    for (let i = 0; i < verseChords.length; i++) {
      scheduleBass(ctx, audioStartTime + 9.0 + i * BEAT, verseChords[i], 0.38);
    }

    // ── BUILD 1 (15.0s–21.0s): ascending C major arpeggio (C E G C) on every beat
    const buildScale = [C2, E2, G2, C2 * 2];
    for (let i = 0; i < 12; i++) {
      scheduleBass(ctx, audioStartTime + 15.0 + i * BEAT, buildScale[i % 4], 0.42);
    }

    // ── DROP 1 (21.0s–29.0s): driving I-V pattern on every beat, C major
    const dropPattern = [C2, C2, G2, G2];
    for (let i = 0; i < 16; i++) {
      scheduleBass(ctx, audioStartTime + 21.0 + i * BEAT, dropPattern[i % 4], 0.48);
    }

    // ── BREAK (29.0s–30.0s): silence on bass — hats carry the tempo alone

    // ── VERSE 2 (30.0s–35.0s): hook reprise, same progression as verse 1
    for (let i = 0; i < 10; i++) {
      scheduleBass(ctx, audioStartTime + 30.0 + i * BEAT, verseChords[i % 6], 0.42);
    }

    // ── BUILD 2 (35.0s–37.0s): short re-ramp into the final drop
    for (let i = 0; i < 4; i++) {
      scheduleBass(ctx, audioStartTime + 35.0 + i * BEAT, buildScale[i % 4], 0.5);
    }

    // ── DROP 2 (37.0s–44.0s): final drop — louder punch, 14 beats resolving on C
    for (let i = 0; i < 14; i++) {
      // Resolve on C on the last two beats instead of G-G
      const freq = i >= 12 ? C2 : dropPattern[i % 4];
      scheduleBass(ctx, audioStartTime + 37.0 + i * BEAT, freq, 0.56);
    }

    // ── FAST-RUN FILLS: bass on every off-beat eighth during eighth-note tile runs,
    //    so every fast tile lands on a bass pulse (not just hats). This is what fixes
    //    the "tiles come fast but don't groove with the music" feel during cascades.
    const fastFills: [number, number][] = [
      // Build burst (tiles 18.5→19.25): on-beats 18.5/19.0 already covered by main loop
      [18.75, G2], [19.25, G2],
      // Drop 1 eighth pair (tiles 23.5/23.75)
      [23.75, G2],
      // Drop 1 cascade (tiles 25.0→25.75)
      [25.25, G2], [25.75, C2],
      // Rebuild (tiles 35.5→36.25)
      [35.75, G2], [36.25, G2],
      // Drop 2 eighth pair (tiles 39.5→40.25)
      [39.75, G2], [40.25, G2],
      // Drop 2 cascade (tiles 41.0→41.75)
      [41.25, G2], [41.75, C2],
    ];
    for (const [t, f] of fastFills) {
      scheduleBass(ctx, audioStartTime + t, f, 0.44);
    }

    // ═══ No ghost melody — pure Piano Tiles feel ═══
    // Tiles ONLY make sound when the player taps them. Bass + hats carry the
    // song's rhythm underneath; bells (played from hitLane) carry the melody.
    // Missing a tile = silence on that note. That's the whole point of the
    // genre: the player IS playing the melody.

    // HATS — the tempo spine underneath everything
    for (let h = 2; h < total; h += eighth) {
      const when = audioStartTime + h;
      if (h < 9) scheduleHihat(ctx, when, 0.06);
      else if (h < 15) scheduleHihat(ctx, when, 0.09);
      else if (h < 21) scheduleHihat(ctx, when, 0.12);
      else if (h < 29) scheduleHihat(ctx, when, 0.14);       // drop 1
      else if (h < 30) scheduleHihat(ctx, when, 0.08);       // break
      else if (h < 35) scheduleHihat(ctx, when, 0.11);       // verse 2
      else if (h < 37) scheduleHihat(ctx, when, 0.14);       // build 2
      else if (h < 44) scheduleHihat(ctx, when, 0.16);       // final drop
      else scheduleHihat(ctx, when, 0.10);                   // outro
    }
  }, [getAudioCtx, scheduleBass, scheduleLead, scheduleHihat]);

  // Stop every still-playing scheduled drum hit (used on exit/end)
  const stopDrumTrack = useCallback(() => {
    for (const node of scheduledNodesRef.current) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    scheduledNodesRef.current = [];
  }, []);

  // Miss thud — counts as "music" since it's a scheduled non-tap sound.
  const playTone = useCallback((freq: number, duration: number, type: OscillatorType = "triangle", volume = 0.2) => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const v = volume * gainsRef.current.music;
    if (v <= 0) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }, [getAudioCtx]);

  // Bell/pluck for player taps — this is SFX, gated on the sfx gain.
  const playBell = useCallback((freq: number, volume = 0.18) => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const v = volume * gainsRef.current.sfx;
    if (v <= 0) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(v, now + 0.005);
    master.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    master.connect(ctx.destination);

    const o1 = ctx.createOscillator();
    o1.type = "sine"; o1.frequency.value = freq;
    o1.connect(master); o1.start(now); o1.stop(now + 0.5);

    const o2 = ctx.createOscillator();
    const o2Gain = ctx.createGain();
    o2Gain.gain.value = 0.35;
    o2.type = "triangle"; o2.frequency.value = freq * 2;
    o2.connect(o2Gain); o2Gain.connect(master);
    o2.start(now); o2.stop(now + 0.4);
  }, [getAudioCtx]);

  // Hit sound — plays the tile's OWN melody pitch (Piano Tiles style).
  // Each tile carries a freq in its NoteDef, so tapping the correct sequence of
  // tiles literally plays the song's hook note-by-note. Perfect hits ring out
  // loud; good hits are quieter but still play the same pitch (so missed timing
  // doesn't corrupt the melody).
  const playHitForNote = useCallback((freq: number, type: "perfect" | "good") => {
    playBell(freq, type === "perfect" ? 0.24 : 0.15);
  }, [playBell]);

  // Haptic buzz on mobile — gated on the hapticsOn user preference.
  // Reads from the settings object directly (not a ref) since haptic is small
  // and gets re-created cheaply when the preference flips.
  const haptic = useCallback((ms = 10) => {
    if (!audioSettings.hapticsOn) return;
    if ("vibrate" in navigator) navigator.vibrate(ms);
  }, [audioSettings.hapticsOn]);
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [hits, setHits] = useState({ perfect: 0, good: 0, miss: 0 });
  const [timeLeft, setTimeLeft] = useState(TRACK_DURATION);
  // activeNotes was the React-state mirror of currently-visible tiles.
  // Now the canvas draws them directly from the RAF tick's local
  // `visible` array, and nothing outside this component consumes the
  // list, so it's gone. One fewer setState per frame = one fewer
  // reconcile.
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [comboToast, setComboToast] = useState<string | null>(null);

  // Shared game-feel layer (popups + shake + big combo callouts + danger
  // vignette). Replaces the existing comboToast at higher milestones and
  // adds floating "+X" feedback per hit / "MISS" feedback per miss.
  const juice = useGameJuice();
  const [flashLane, setFlashLane] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ lane: number; type: "perfect" | "good" | "miss"; ts: number; ms?: number } | null>(null);

  const chartRef = useRef<NoteDef[]>([]);
  const startRef = useRef<number>(0);
  const spawnedRef = useRef<Set<number>>(new Set());
  const missedRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number>(0);
  const burstIdRef = useRef(0);
  // Imperative handle into the <NoteCanvas>. Every RAF tick we call
  // canvasHandleRef.current.draw(visible, now) to render the falling
  // tiles straight to a canvas, bypassing React reconcile. See
  // components/rhythm/NoteCanvas.tsx for rationale.
  const canvasHandleRef = useRef<NoteCanvasHandle | null>(null);

  // Encore refs — drive the accelerating survival mode after the main track
  const encoreMissesRef = useRef(0);                  // 3 = game over
  const encoreNextSpawnRef = useRef(0);                  // wall-clock time for next tile
  const encorePoolIdxRef = useRef(0);                  // rotates through ENCORE_POOL
  const encoreIdRef = useRef(100000);             // high id base to avoid clashes
  const encoreLoopAtRef = useRef(0);                  // next audio loop reschedule time
  const [encoreLives, setEncoreLives] = useState(3);     // UI display
  // Loop counter — 1-based once encore starts. Each completed pass through
  // ENCORE_POOL steps the speed up; the loop number is the survival brag
  // stat ("reached Loop 5") shown in the HUD and on the finish screen.
  const [encoreLoop, setEncoreLoop] = useState(0);

  // ─── FEVER — the game's only multiplier ────────────────────────────────────
  // Ignites after FEVER_TRIGGER consecutive PERFECTs, doubles points for
  // FEVER_DURATION seconds, dies instantly on a miss. perfectStreak is state
  // (not a ref) so the HUD can show progress toward ignition; feverUntilRef
  // holds the song-time expiry the RAF tick polls without re-rendering.
  const [perfectStreak, setPerfectStreak] = useState(0);
  const [feverActive, setFeverActive] = useState(false);
  const feverUntilRef = useRef(0);      // song-time (s) when fever expires · 0 = off
  const perfectStreakRef = useRef(0);   // synchronous mirror for scoring math

  // ─── Ambient starfield — same cosmic arcade vibe as Simon ────────────────
  // Client-only via useEffect to avoid SSR hydration mismatches from Math.random
  const [stars, setStars] = useState<Star[]>([]);
  useEffect(() => {
    setStars(Array.from({ length: 44 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 1.6 + 0.6,
      delay: Math.random() * 4,
      dur: Math.random() * 3 + 2.5,
      alpha: Math.random() * 0.5 + 0.4,
    })));
  }, []);

  // Snapshot of hit counters at the moment the main 45s track ends. Encore
  // misses/goods shouldn't disqualify FC/AP — those achievements reward
  // completing the chart cleanly, not surviving encore perfectly.
  const mainTrackStatsRef = useRef<{ misses: number; goods: number; perfects: number }>({ misses: 0, goods: 0, perfects: 0 });

  // ═══ Anti-cheat session state ═══
  // Server-issued session ticket from /api/start-game. Required by the
  // backend before it'll sign any score. Lives in a ref (not localStorage)
  // so it dies with the component — closing the tab forces a fresh session
  // next time, and it's invisible to other tabs / browser extensions.
  const sessionTokenRef = useRef<string | null>(null);
  // Re-entry guard for startGame — same pattern as simon. Blocks a
  // second dispatch while the ticket request is in flight so we don't
  // create duplicate game_sessions rows from a fast double-click.
  const startingRef = useRef<boolean>(false);
  // Full tap log captured during play. The server replays this to compute
  // the authoritative score — the client never claims a number.
  const tapLogRef = useRef<RhythmTap[]>([]);

  // ═══ Score submission (via server actions) ═══
  // Writes go through @/app/actions/game so the games-backend URL and
  // INTERNAL_SECRET are never shipped to the browser. Verification of the
  // player (Privy JWT or MiniPay wallet signature) happens server-side.
  const gameStartMsRef = useRef<number>(0);
  const submittedRef = useRef<boolean>(false);  // one-shot guard so we never double-submit
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
  // Full-screen level-up toast state. Set when the score-submit result
  // arrives carrying { leveledUp: true, level: N } so the celebration
  // overlays the finished card instead of being a tiny inline callout.
  const [levelUpToastLevel, setLevelUpToastLevel] = useState<number | null>(null);
  // Pet evolution celebration — separate moment from level-up. Fires
  // only when the new level crosses a pet-stage threshold
  // (5/15/30/50). Compares petForLevel(prev) vs petForLevel(new) at
  // submit-result time.
  const [petEvolveToPet, setPetEvolveToPet] = useState<typeof PET_STAGES[number] | null>(null);
  const [petEvolveAtLevel, setPetEvolveAtLevel] = useState<number>(1);

  // Auth context — Privy users provide a JWT, MiniPay users sign a message.
  // Both code paths live in the submit effect below.
  const { getAccessToken, user } = usePrivy();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const isMiniPay = useIsMiniPay();
  // Privy-embedded wallets sign transactions silently (no popup). External
  // wallets like MiniPay / injected show a confirmation. We use this to bump
  // the gas limit for embedded (their estimation is sometimes too tight).
  const isEmbeddedWallet = user?.linkedAccounts?.some(
    (a: { type: string; walletClientType?: string }) =>
      a.type === "wallet" && a.walletClientType === "privy"
  );

  // On-chain submission UI states — finish screen renders different messaging
  // for "waiting for wallet", "tx rejected", "insufficient gas", etc.
  const [signingOnChain, setSigningOnChain] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  // GasHelpSheet covers the pre-game lobby gate (player taps START while
  // CELO is below the block threshold). Rhythm's existing GasAwareTxError
  // card already covers the post-fail rescue path with its own Telegram
  // link · sheet here is gate-only.
  const [gasHelpOpen, setGasHelpOpen] = useState(false);
  const { status: gasStatus, approxSavesLeft } = useGasStatus();

  // Reset game state
  const reset = useCallback(() => {
    chartRef.current = buildChart();
    spawnedRef.current = new Set();
    missedRef.current = new Set();
    encoreMissesRef.current = 0;
    encoreNextSpawnRef.current = 0;
    encorePoolIdxRef.current = 0;
    encoreIdRef.current = 100000;
    encoreLoopAtRef.current = 0;
    mainTrackStatsRef.current = { misses: 0, goods: 0, perfects: 0 };
    // Zero the timeline anchor. If the user quit mid-run and hit START
    // again immediately, the RAF loop could mount with a stale
    // startRef from the PREVIOUS run (countdown's anchor-set can miss
    // the window under fast re-renders). `now` would compute as
    // "already 30+ seconds in" on the very first tick, every chart
    // note would instantly miss, and NO tile ever entered the spawn
    // window — exactly the "MISS at start with no tiles falling" bug
    // users reported. The RAF loop now also skips ticks while
    // startRef.current === 0 so the countdown effect is the only
    // writer.
    startRef.current = 0;
    setEncoreLives(3);
    setEncoreLoop(0);
    feverUntilRef.current = 0;
    perfectStreakRef.current = 0;
    setFeverActive(false);
    setPerfectStreak(0);
    setScore(0); setCombo(0); setMaxCombo(0);
    setHits({ perfect: 0, good: 0, miss: 0 });
    setTimeLeft(TRACK_DURATION);
    setBursts([]);
    setComboToast(null);
    setFlashLane(null);
    setFeedback(null);
    juice.reset();
    // Anti-cheat: clear session + tap log so a new run gets a fresh ticket
    sessionTokenRef.current = null;
    tapLogRef.current = [];
  }, [juice]);

  // Countdown → playing
  const startGame = async () => {
    // Re-entry guard: bail if a session ticket is already being
    // requested. Without it, two quick clicks during the ~500ms ticket
    // round trip insert two game_sessions rows for one actual play.
    if (startingRef.current) return;

    // ═══ Pre-game gas gate ═══════════════════════════════════════════════
    // Onchain finality is binary · we can't predict per-tx gas exactly, so
    // when the bucket reads "block" we stop the player here rather than
    // letting them play a full track and lose the score to a guaranteed
    // insufficient-funds throw. MiniPay (USDC fee adapter) and guests
    // (no submit at all) both come back "safe-equivalent" from useGasStatus.
    if (gasStatus === "block") {
      setGasHelpOpen(true);
      return;
    }
    startingRef.current = true;

    reset();
    // Reset submission bookkeeping — a fresh run is a fresh submit
    submittedRef.current = false;
    setSubmitResult(null);
    setSubmitError(null);

    // ═══ Anti-cheat: request a session ticket BEFORE the countdown ═══
    // No ticket = backend refuses to sign the score at submit time. If we
    // can't get one, surface a quiet error and don't enter the run.
    if (address) {
      try {
        let res;
        if (isMiniPay) {
          // MiniPay forbids personal_sign (celopedia minipay-guide §"No
          // message signing"). Identity is enforced by the on-chain
          // score-submission tx the player will sign later — forging a
          // session here has zero exploit value.
          res = await startGameMiniPayAction(address, "", "", "rhythm");
        } else {
          const token = await getAccessToken();
          if (!token) {
            setSubmitError("Sign in required to start a run.");
            startingRef.current = false;
            return;
          }
          res = await startGameAction(token, address, "rhythm");
        }
        if (!res.success) {
          setSubmitError(res.error || "Couldn't start session. Try again.");
          startingRef.current = false;
          return;
        }
        sessionTokenRef.current = res.sessionToken;
      } catch {
        setSubmitError("Couldn't start session. Try again.");
        startingRef.current = false;
        return;
      }
    }

    setPhase("countdown");
    setCountdown(3);
    // Warm up audio context (needs user gesture, so do it on START tap)
    getAudioCtx();
    // Lock releases once phase has flipped — the idle/replay button is
    // off-screen now, so a second dispatch is structurally impossible
    // until the next gameover surface.
    startingRef.current = false;
  };
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      // GO! — bright higher-octave bell to signal play starts
      playBell(783.99, 0.28);  // G5
      const ctx = getAudioCtx();
      // Latency-compensated start. The music is scheduled on the audio
      // clock (ctx.currentTime) but is not HEARD until baseLatency +
      // outputLatency later (100-250ms on Android). The falling notes,
      // anchored at performance.now(), have zero such delay. Anchoring
      // them at the same wall-clock instant makes the tiles run
      // latency-AHEAD of the beat, which players read as "the notes
      // don't follow the song." Fix: push BOTH anchors forward by the
      // measured audio latency so the first tile reaches the hit line
      // exactly when the first beat is heard.
      const outLat = ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0;
      const lead = Math.min(0.35, Math.max(0.12, outLat + 0.05)); // clamp 120-350ms
      startRef.current = performance.now() + lead * 1000;
      gameStartMsRef.current = Date.now() + lead * 1000;
      setPhase("playing");
      // Schedule the drum track at the SAME future audible moment.
      if (ctx) scheduleDrumTrack(ctx.currentTime + lead);
      return;
    }
    // 3 / 2 / 1 — steady bell tick on each count (same pitch, builds anticipation)
    playBell(523.25, 0.22);  // C5
    const t = setTimeout(() => setCountdown(c => c - 1), 750);
    return () => clearTimeout(t);
  }, [phase, countdown, getAudioCtx, scheduleDrumTrack, playBell]);

  // ═══ Submit score — mirrors v1's three-step gated flow ═══
  // 1. signScore           — server action returns the backend's EIP-712 voucher
  // 2. recordScoreWithBackendSig  — player's wallet signs the on-chain tx
  //                                 (Privy-embedded: silent; MiniPay/injected:
  //                                 shows a confirmation popup). This is the
  //                                 signature gate — if the user rejects here,
  //                                 NOTHING gets saved anywhere.
  // 3. submitScore         — only runs after on-chain tx succeeded; saves to
  //                          Supabase, awards XP, unlocks achievements
  useEffect(() => {
    if (phase !== "finished") return;
    if (submittedRef.current) return;
    if (!address) return;
    // No GamePass = the on-chain save would revert "No game pass". Don't
    // fire a wallet tx that's guaranteed to fail; the finish screen shows
    // the "mint to save" prompt instead. hasMinted is resolved well before
    // any run finishes, so `=== false` here is reliable.
    if (hasMinted === false) return;
    submittedRef.current = true;

    const rawGameTime = Date.now() - gameStartMsRef.current;
    const gameTime = Math.max(5000, rawGameTime);
    // Clamp to the backend's global upper bound (1M). Uncapped scoring is fine
    // because the submission path requires two independent auth factors (internal
    // secret + Privy/MiniPay verification) before a voucher is signed.
    const scoreToSubmit = Math.min(1_000_000, Math.max(0, Math.round(score)));

    // Quick-exit guard — 0-score, sub-5s ends are the player tapping
    // START and bailing before anything happened. There's no score to
    // save, so skip the network round-trip and surface a calm message.
    // The 5s threshold is an internal anti-fraud guard the player
    // never needs to know about — copy speaks to gameplay, not to a
    // hidden clock they're supposed to beat. Mirrors simon's guard.
    if (scoreToSubmit === 0 && rawGameTime < 5000) {
      setSubmitting(false);
      setTxError(null);
      setSubmitError("No score yet. Tap PLAY AGAIN and play a round to land on the board.");
      return;
    }

    // FC/AP computed from the main-track snapshot captured at t=TRACK_DURATION.
    // Encore misses don't disqualify the achievement — reaching the end of the
    // song without missing any of its notes is what unlocks it. If the player
    // never reached main-end (died before, e.g. pressed X), both stay false.
    const reachedMainEnd = mainTrackStatsRef.current.misses > 0 || mainTrackStatsRef.current.goods > 0 || phase === "finished";
    const mainChartLen = chartRef.current.filter(n => n.id < 100000).length;
    const mainHits = hits.perfect + hits.good; // cumulative, including encore
    // Conservative FC check: main-track snapshot had zero misses AND we
    // actually made it through the whole main chart (total hits - encore hits
    // ≥ main chart length).
    const mainPlusEncoreHits = mainHits; // setHits was monotonic with taps
    const fullCombo = reachedMainEnd
      && mainTrackStatsRef.current.misses === 0
      && mainPlusEncoreHits >= mainChartLen;
    const allPerfect = fullCombo && mainTrackStatsRef.current.goods === 0;

    const baseScoreData = {
      game: "rhythm" as const,
      score: scoreToSubmit,
      gameTime,
      fullCombo,
      allPerfect,
    };

    (async () => {
      setSubmitting(true);
      setTxError(null);
      try {
        // ── STEP 1: voucher ──
        let sig:
          | { success: true; signature: string; nonce: string; gameType: number; score?: number }
          | { success: false; error: string };
        let authToken: string | null = null;

        // Anti-cheat: the session ticket from /api/start-game is required.
        // Without it the backend refuses to sign. If we somehow got here
        // without one (shouldn't happen — startGame() guards entry), abort.
        const sessionToken = sessionTokenRef.current;
        if (!sessionToken) {
          setSubmitError("Session missing. Tap PLAY AGAIN to start a fresh run.");
          return;
        }
        // Snapshot the tap log so any late RAF tick after we read it won't
        // change the array the server replays.
        const tapLogSnapshot = tapLogRef.current.slice();

        if (isMiniPay) {
          // MiniPay forbids personal_sign. Identity is enforced by the
          // on-chain score-submission tx the player signs afterwards.
          sig = await signScoreMiniPay(
            address, "", "",
            { game: "rhythm", score: scoreToSubmit },
            sessionToken,
            tapLogSnapshot,
          );
        } else {
          authToken = await getAccessToken();
          if (!authToken) {
            setSubmitError("Not signed in — score not recorded");
            return;
          }
          sig = await signScore(
            authToken, address,
            { game: "rhythm", score: scoreToSubmit },
            sessionToken,
            tapLogSnapshot,
          );
        }

        if (!sig.success) {
          setSubmitError(sig.error || "Voucher signing failed");
          return;
        }

        // Server-authoritative score. The backend replays the tap log and
        // returns the canonical number — use that for on-chain submit and
        // the leaderboard, not the locally-counted display value.
        const officialScore = typeof sig.score === "number" ? sig.score : scoreToSubmit;

        // ── STEP 2: on-chain tx — THE SIGNATURE GATE ──
        let txHash: string | null = null;
        setSigningOnChain(true);
        try {
          txHash = await writeContractAsync({
            address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
            abi: GAME_PASS_ABI,
            functionName: "recordScoreWithBackendSig",
            // Server-authoritative score — must match the value the backend
            // signed inside the EIP-712 voucher, or the contract reverts.
            args: [sig.gameType, BigInt(officialScore), BigInt(sig.nonce), sig.signature as `0x${string}`],
            ...(isEmbeddedWallet ? { gas: 300000n } : {}),
            // MiniPay users have no CELO — pay the network fee in USDC via
            // Celo's fee-currency adapter. Non-MiniPay callers get {} here
            // so the tx uses CELO like any normal Celo wallet.
            ...(await detectFeeSpread(isMiniPay, address as `0x${string}` | undefined)),
          });
        } catch (err: unknown) {
          // Classify wallet errors so we can show something useful.
          const e = err as {
            name?: string; code?: number;
            message?: string; shortMessage?: string; details?: string;
            cause?: { name?: string; code?: string; message?: string };
          };
          const name = e?.name ?? "";
          const code = e?.code ?? 0;
          const causeName = e?.cause?.name ?? "";
          const causeCode = e?.cause?.code ?? "";
          const msg = (e?.message ?? e?.shortMessage ?? e?.details ?? e?.cause?.message ?? "").toLowerCase();
          const isRejected =
            name === "UserRejectedRequestError" || code === 4001 || code === -32003 ||
            causeName === "UserRejectedRequestError" ||
            causeCode === "policy_violation" ||
            msg.includes("user rejected") ||
            msg.includes("rejected the request") ||
            msg.includes("user denied");
          // Broad gas/funds detection. Catches the obvious cases AND the
          // JSON-RPC fallbacks Privy embedded wallets surface as generic
          // codes (-32000, -32603) when a no-CELO wallet tries to write.
          // Anything that's neither a rejection nor a clear gas case still
          // gets the gas-help card downstream (>90% accurate for new
          // accounts, harmless false positive for the rest).
          const matchedGasPattern =
            name === "InsufficientFundsError" || name === "EstimateGasExecutionError" ||
            code === -32000 || code === -32010 || code === -32603 ||
            causeCode === "insufficient_funds" ||
            msg.includes("insufficient funds") || msg.includes("insufficient balance") ||
            msg.includes("gas limit") || msg.includes("exceeds gas") ||
            msg.includes("gas required") || msg.includes("intrinsic gas") ||
            msg.includes("cannot estimate") || msg.includes("estimate gas");
          // Forno mask · Celo's RPC returns a generic revert when the real
          // cause is insufficient funds (per the celo-insufficient-funds-
          // trap reference). Privy embedded wallets surface generic errors
          // for the same shape. If the keyword match missed BUT the player's
          // gas bucket says they're below the warn floor, reclassify as gas
          // so the post-fail surface shows the help card instead of a
          // dead-end "try again."
          const lowBalanceLikelyGas =
            !isRejected && !matchedGasPattern &&
            (gasStatus === "warn" || gasStatus === "block");
          const isGasOrFunds = matchedGasPattern || lowBalanceLikelyGas;
          // Three buckets, three messages. The render layer keys off the
          // text to choose the correct UI variant — rejection (red banner),
          // gas (orange help card), other (red with retry hint).
          if (isRejected) setTxError("Transaction rejected. Tap PLAY AGAIN to try again.");
          else if (isGasOrFunds) setTxError("Score didn't save — needs a top up.");
          else setTxError("Score didn't save. Tap PLAY AGAIN to try again.");
          return;  // BAIL: don't call submitScore, nothing is saved anywhere
        } finally {
          setSigningOnChain(false);
        }

        // ── STEP 3: save off-chain (Supabase + XP + achievements + rank) ──
        // Replace the locally-claimed score with the server-authoritative
        // one so leaderboard / XP / achievements all reflect what the backend
        // actually signed. Also surface it to the UI in case the local count
        // drifted (e.g. encore scoring on the server differs by a few points).
        let result;
        const fullScoreData = { ...baseScoreData, score: officialScore, txHash };
        if (isMiniPay) {
          // MiniPay path: no client signature (celopedia minipay-guide
          // §"No message signing"). submitScoreMiniPay accepts empty
          // sig/msg and ignores them.
          result = await submitScoreMiniPay(address, "", "", fullScoreData);
        } else if (authToken) {
          result = await submitScore(authToken, address, fullScoreData);
        }
        // Reflect the server's number on the finish screen — never higher
        // than the local count for a real player; may be lower if the replay
        // disagreed about a borderline tap.
        if (officialScore !== score) setScore(officialScore);

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
          // Trigger the full-screen LEVEL UP celebration immediately
          // when the result lands. Slight delay so the finished-card
          // scaleIn lands first; the celebration then overlays it as
          // a hero moment with its own staged audio/visual.
          if (result.leveledUp && typeof result.level === "number") {
            const newLv = result.level;
            const prevLv = playerLevel;
            const prevPet = petForLevel(prevLv);
            const newPet = petForLevel(newLv);
            setTimeout(() => setLevelUpToastLevel(newLv), 700);
            // Pet evolution — fires AFTER the level-up celebration
            // dismisses so the two don't stack. If level crossed a
            // pet-stage boundary (Egg→Baby→Teen→Crystal→King), queue
            // the bigger evolution moment to play next.
            if (prevPet.id !== newPet.id) {
              setPetEvolveAtLevel(newLv);
              setTimeout(() => setPetEvolveToPet(newPet), 700 + 3800);
            }
          }
        } else {
          setSubmitError(result?.error || "Score not recorded");
        }
      } catch {
        setSubmitError("Unexpected error — score not recorded");
      } finally {
        setSubmitting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Stop scheduled drums whenever we leave active play (both playing and encore).
  // Transitioning playing → encore must NOT stop drums, so the encore handler
  // can reschedule new loops seamlessly over the existing ones.
  useEffect(() => {
    if (phase === "playing" || phase === "encore") return;
    stopDrumTrack();
  }, [phase, stopDrumTrack]);

  // Handle a hit (from tap or keyboard)
  const hitLane = useCallback((lane: number) => {
    if (phase !== "playing" && phase !== "encore") return;
    const now = (performance.now() - startRef.current) / 1000;
    // Find nearest active note in this lane
    const candidates = chartRef.current.filter(n =>
      n.lane === lane &&
      !missedRef.current.has(n.id) &&
      spawnedRef.current.has(n.id) &&
      now >= n.time - GOOD_WINDOW &&
      now <= n.time + GOOD_WINDOW
    );
    if (candidates.length === 0) return;

    const note = candidates.reduce((best, n) =>
      Math.abs(n.time - now) < Math.abs(best.time - now) ? n : best);
    const diff = Math.abs(note.time - now);

    // Mark as hit (so game loop doesn't flag it as miss)
    missedRef.current.add(note.id);

    // Anti-cheat: append every accepted tap to the log the server will replay.
    // `now` is seconds since startRef (game-start anchor), matching the chart
    // coords the server uses. Lane is 0-3.
    tapLogRef.current.push({ lane, time: now });

    const type: "perfect" | "good" = diff <= PERFECT_WINDOW ? "perfect" : "good";

    // ═══ SCORING 2.0 — addition only ═══
    // Perfect=10, Good=5, flat. FEVER (×2 for 6s after 12 straight perfects)
    // is the ONLY multiplier — temporary, earned, killed by a miss. Encore
    // tiles pay a flat 5: the encore is a survival exam, not a point mine.
    // No standing combo multiplier and no precision bonus — combo is pride
    // and fever fuel, and the millions the old quadratic math produced are
    // now simply unreachable.
    let gained: number;
    if (phase === "encore") {
      gained = ENCORE_POINTS;
    } else {
      const base = type === "perfect" ? 10 : 5;
      const inFever = feverUntilRef.current > 0 && now < feverUntilRef.current;
      gained = inFever ? base * FEVER_MULT : base;

      if (type === "perfect") {
        perfectStreakRef.current += 1;
        setPerfectStreak(perfectStreakRef.current);
        // Ignition — the 12th perfect lights fever for the NEXT 6 seconds.
        // The igniting tap itself scores un-doubled (checked above), so the
        // client and the server replay agree tap-for-tap.
        if (!inFever && perfectStreakRef.current >= FEVER_TRIGGER) {
          feverUntilRef.current = now + FEVER_DURATION;
          perfectStreakRef.current = 0;
          setPerfectStreak(0);
          setFeverActive(true);
          juice.fireCallout({ text: "FEVER!", sub: "×2 · DON'T MISS", color: "#fbbf24" }, 500);
          haptic(30);
        }
      } else {
        // A GOOD breaks the perfect chain (fever stays lit if already burning).
        perfectStreakRef.current = 0;
        setPerfectStreak(0);
      }
    }

    // Audio + haptic feedback — play THIS tile's own melody pitch (Piano Tiles style)
    playHitForNote(note.freq, type);
    haptic(type === "perfect" ? 12 : 8);

    setScore(s => s + gained);
    setCombo(c => {
      const next = c + 1;
      if (next > maxCombo) setMaxCombo(next);
      // Combo milestone toast (kept for the first few; the bigger
      // milestones at 50/100 are handled by the shared callout layer
      // so they punch in dramatically instead of as a thin top toast).
      if (next === 5) setComboToast("WARMED UP!");
      if (next === 10) setComboToast("ON FIRE 🔥");
      if (next === 15) setComboToast("UNSTOPPABLE!");
      if (next === 25) setComboToast("GOD MODE!");
      if ([5, 10, 15, 25].includes(next)) setTimeout(() => setComboToast(null), 1200);
      // Big center callouts at 50 and 100 (and the milestone in 50/100/250).
      if (next === 50 || next === 100 || next === 250) {
        juice.fireCallout({
          text: next === 250 ? "MYTHIC" : next === 100 ? "LEGENDARY" : "GOD MODE",
          sub:  `${next} COMBO`,
          color: "#fbbf24",
        }, next);
      }
      return next;
    });
    setHits(h => ({ ...h, [type]: h[type] + 1 }));
    // ms offset readout: GOODs carry a signed millisecond offset so players
    // can calibrate ("-40ms early" → tap later). Perfects stay clean.
    const signedMs = Math.round((now - note.time) * 1000);
    setFeedback({ lane, type, ts: performance.now(), ms: type === "good" ? signedMs : undefined });

    // Spawn particles
    const laneWidth = 100 / LANES.length;
    const xPct = laneWidth * lane + laneWidth / 2;
    const color = LANES[lane].accent;
    setBursts(bs => [...bs, { id: burstIdRef.current++, x: xPct, y: 90, color: type === "perfect" ? "#fbbf24" : color, born: performance.now() }]);

    // Floating "+X" reward popup at the tap zone. Y is 88% (right above
    // the hit line) so the number rises into the play area, not the HUD.
    juice.scorePopup(xPct, 86, gained, type);

    // Flash lane briefly
    setFlashLane(lane);
    setTimeout(() => setFlashLane(l => (l === lane ? null : l)), 100);
  }, [phase, combo, maxCombo, playHitForNote, haptic]);

  // Keyboard controls
  useEffect(() => {
    if (phase !== "playing" && phase !== "encore") return;
    const handler = (e: KeyboardEvent) => {
      const keyMap: Record<string, number> = {
        "a": 0, "s": 1, "d": 2, "f": 3,
        "1": 0, "2": 1, "3": 2, "4": 3,
        "ArrowLeft": 0, "ArrowDown": 1, "ArrowUp": 2, "ArrowRight": 3,
      };
      const lane = keyMap[e.key];
      if (lane !== undefined) { e.preventDefault(); hitLane(lane); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, hitLane]);

  // ── Tab-visibility / mobile-backgrounding guard ──
  //
  // The rhythm RAF loop reads `now = (performance.now() - startRef.current) / 1000`
  // every frame and compares it against each note's scheduled time. When
  // mobile browsers background the page (user switched apps, locked screen,
  // pulled down notifications), the page's RAF gets paused but the wall
  // clock keeps moving. On return, `now` jumps forward by tens of seconds
  // and EVERY pending note instantly satisfies `now > n.time + GOOD_WINDOW`.
  // Result: tiles "freeze" while the miss counter stampedes and combo
  // dies — exactly the bug users reported on mobile after coming back to
  // a paused game.
  //
  // Fix: when the tab hides during gameplay, kick the game to "finished"
  // so the player sees a clean game-over screen instead of a phantom
  // miss avalanche. We snapshot mid-game stats so on-chain submission
  // still has valid numbers (a graceful early-quit, not a crash).
  useEffect(() => {
    if (phase !== "playing" && phase !== "encore") return;
    const onHide = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "hidden") return;
      // Snapshot current hits for the finished screen, then bail to
      // finished. Same path the QUIT button takes mid-run.
      setHits(h => {
        mainTrackStatsRef.current = { misses: h.miss, goods: h.good, perfects: h.perfect };
        return h;
      });
      setPhase("finished");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [phase]);

  // Main RAF loop — handles both the scripted song AND the endless encore.
  // Encore is triggered when the 30s chart finishes while the player's combo is
  // alive. In encore, new tiles are spawned dynamically at accelerating speed
  // and 3 misses end the game. Score keeps growing — no cap, Tetris-style.
  useEffect(() => {
    if (phase !== "playing" && phase !== "encore") return;
    // Track wall-clock between frames. A gap > 1.5s means RAF was
    // paused (tab hidden, screen locked, app switched, OS throttled).
    // The earlier "slide startRef forward" recovery left the audio
    // schedule + chart timeline desynced — players came back to a
    // phantom session: timer ticking, no tiles, no score. Now we just
    // end the run; player gets a clean finished screen and can replay.
    //
    // lastWall is anchored at effect mount (not at first tick) so even
    // the very first RAF after a throttled resume can detect a stall.
    let lastWall = performance.now();
    const STALL_THRESHOLD_MS = 1500;
    // ── Render throttles ──
    // Mobile users reported tiles "skipping" + phones getting hot. Root
    // cause: setActiveNotes / setTimeLeft / setBursts were firing 60×/sec,
    // forcing React to reconcile the entire game tree every frame. On
    // thermal-throttled phones that spirals — slower frames mean tiles
    // skip past hit windows, scores tank, frustration climbs.
    //
    // Fix: physics still runs at full RAF cadence (so timing accuracy is
    // preserved), but the React-visible state only updates on a slower
    // cadence, AND only when the value actually changed.
    let lastTimerSecond = -1;            // setTimeLeft only when whole seconds change
    let lastBurstPrune = 0;              // setBursts cleanup max ~4×/sec
    const tick = () => {
      const wall = performance.now();
      // Anchor guard — under fast restart re-renders the RAF effect can
      // mount before the countdown effect has set startRef.current. If
      // we computed `now` against 0, `now` would be a huge epoch-ish
      // number and every chart note would stampede as a miss before
      // any tile rendered. Just idle the tick until the anchor lands.
      if (startRef.current === 0) {
        lastWall = wall;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const dt = wall - lastWall;
      if (dt > STALL_THRESHOLD_MS) {
        setHits(h => {
          mainTrackStatsRef.current = { misses: h.miss, goods: h.good, perfects: h.perfect };
          return h;
        });
        setPhase("finished");
        return;
      }
      lastWall = wall;

      // Timing source: performance.now() anchored at startRef. I
      // briefly tried ctx.currentTime as the authoritative clock
      // (cleaner in theory — audio and visual share one monotonic
      // timeline) but it introduced lag/skip regressions on laptop
      // and mobile. Suspect: AudioContext.currentTime doesn't always
      // advance at wall-clock rate under throttled backgrounds or
      // Web Audio implementations that buffer differently. Going back
      // to wall clock and relying on the stall guard below to end the
      // run cleanly when the thread pauses.
      const now = (wall - startRef.current) / 1000;
      if (phase === "playing") {
        const sec = Math.ceil(TRACK_DURATION - now);
        if (sec !== lastTimerSecond) {
          lastTimerSecond = sec;
          setTimeLeft(Math.max(0, TRACK_DURATION - now));
        }
      }

      // ── Fever expiry — poll the song clock; fires once, then idles ──
      if (feverUntilRef.current > 0 && now >= feverUntilRef.current) {
        feverUntilRef.current = 0;
        setFeverActive(false);
      }

      // ── Encore: loop-stepped acceleration until the game beats the player ──
      // Each full pass through ENCORE_POOL is one LOOP; every loop the tiles
      // fall 15% faster and pack 15% tighter. Loop 1 is comfortable, loop 5
      // is frantic, loop 7 is past human reaction time — the difficulty wall
      // does the score-bounding, no cap rule needed. Points stay flat at 5.
      if (phase === "encore" && now >= encoreNextSpawnRef.current) {
        const poolIdx = encorePoolIdxRef.current;
        const loop = Math.floor(poolIdx / ENCORE_POOL.length);   // 0-based
        const speed = Math.pow(0.85, loop);                       // 15% faster per loop
        const travel = Math.max(0.5, 1.5 * speed);
        const nextGap = Math.max(0.16, 0.5 * speed);

        // Loop boundary — announce the step-up so survival depth is felt
        // and legible ("LOOP 3 · +38% SPEED" punches in center-screen).
        if (poolIdx > 0 && poolIdx % ENCORE_POOL.length === 0) {
          setEncoreLoop(loop + 1);
          juice.fireCallout({
            text: `LOOP ${loop + 1}`,
            sub: `SPEED +${Math.round((1 / speed - 1) * 100)}%`,
            color: "#f97316",
          }, 400 + loop);
          haptic(20);
        }

        const [lane, freq] = ENCORE_POOL[poolIdx % ENCORE_POOL.length];
        encorePoolIdxRef.current++;
        chartRef.current.push({
          id: encoreIdRef.current++,
          lane, freq,
          time: now + travel,
          travel,
        });
        encoreNextSpawnRef.current = now + nextGap;

        // Reschedule the backing loop every 8 seconds so the rhythm never
        // drops. Bass + hats only — no lead melody, same Piano Tiles rule as
        // the main track: only player taps produce melodic notes.
        const ctx = getAudioCtx();
        if (ctx && ctx.currentTime >= encoreLoopAtRef.current) {
          const loopStart = ctx.currentTime;
          const C2 = 65.41, G2 = 98.00;
          for (let i = 0; i < 16; i++) {
            scheduleBass(ctx, loopStart + i * BEAT, i % 4 < 2 ? C2 : G2, 0.46);
          }
          for (let h = 0; h < 8; h += BEAT / 2) {
            scheduleHihat(ctx, loopStart + h, 0.14);
          }
          encoreLoopAtRef.current = loopStart + 7.8; // slight overlap to avoid gaps
        }
      }

      // Spawn notes that are now visible (notes whose fall window has started)
      const visible: (NoteDef & { spawnedAt: number })[] = [];
      for (const n of chartRef.current) {
        if (now >= n.time - n.travel && now <= n.time + GOOD_WINDOW + 0.3) {
          if (!spawnedRef.current.has(n.id)) spawnedRef.current.add(n.id);
          if (!missedRef.current.has(n.id)) visible.push({ ...n, spawnedAt: n.time - n.travel });
        }
      }

      // Canvas draw — imperative, single paint op per frame regardless
      // of tile count. React never reconciles the tiles; see
      // components/rhythm/NoteCanvas.tsx. Nothing outside this RAF
      // tick consumes the visible list, so we don't mirror it into
      // React state at all anymore (saves a reconcile per id change).
      canvasHandleRef.current?.draw(visible, now);

      // Flag misses: notes that passed the good window without being hit.
      // A miss kills everything fragile at once: combo, the perfect streak,
      // and — the cruellest part — an active FEVER. That instant loss is
      // what makes fever's 6 golden seconds tense instead of free.
      for (const n of chartRef.current) {
        if (now > n.time + GOOD_WINDOW && !missedRef.current.has(n.id)) {
          missedRef.current.add(n.id);
          setCombo(0);
          perfectStreakRef.current = 0;
          setPerfectStreak(0);
          if (feverUntilRef.current > 0) {
            feverUntilRef.current = 0;
            setFeverActive(false);
          }
          setHits(h => ({ ...h, miss: h.miss + 1 }));
          setFeedback({ lane: n.lane, type: "miss", ts: performance.now() });
          // Floating "MISS" popup at the lane + light screen shake.
          // Encore misses shake harder because each one costs a life.
          const laneWidth = 100 / LANES.length;
          juice.lossPopup(laneWidth * n.lane + laneWidth / 2, 86, "MISS");
          juice.bump(phase === "encore" ? 10 : 5);
          // No sound on miss — silence IS the feedback. The player should feel
          // the absence of a note they should have played. Visual cues (MISS
          // text + combo break + red lives in encore) carry the signal instead.

          // Encore: track lives, end on 3 misses
          if (phase === "encore") {
            encoreMissesRef.current++;
            setEncoreLives(3 - encoreMissesRef.current);
            if (encoreMissesRef.current >= 3) {
              setPhase("finished");
              return;
            }
          }
        }
      }

      // Clean up old particles — throttle to ~4×/sec instead of every
      // RAF frame. Bursts only live 600ms anyway, so a 250ms prune
      // cadence is invisible to the player but spares the React tree
      // 50+ pointless reconciles per second.
      if (wall - lastBurstPrune > 250) {
        lastBurstPrune = wall;
        setBursts(bs => {
          const filtered = bs.filter(b => wall - b.born < 600);
          return filtered.length === bs.length ? bs : filtered;
        });
      }

      // End of scripted track: if combo alive → ENCORE, else → finished.
      // Either way, snapshot the main-track hit stats so FC/AP achievements
      // reward clearing the chart cleanly, regardless of how encore plays out.
      // The setState callback is the safe way to read the latest `hits` from
      // inside a RAF closure without adding it to the effect's dep array
      // (which would tear down the RAF every time a hit registers).
      if (phase === "playing" && now >= TRACK_DURATION) {
        setHits(h => {
          mainTrackStatsRef.current = { misses: h.miss, goods: h.good, perfects: h.perfect };
          return h;
        });
        // Fever doesn't cross into encore — the survival exam has no
        // multipliers of any kind. (Matches the server replay exactly.)
        feverUntilRef.current = 0;
        setFeverActive(false);
        perfectStreakRef.current = 0;
        setPerfectStreak(0);
        if (combo > 0) {
          setPhase("encore");
          setEncoreLoop(1);
          setComboToast("ENCORE!");
          setTimeout(() => setComboToast(null), 1500);
          encoreNextSpawnRef.current = now + 0.8;  // first encore tile after brief beat
          encoreLoopAtRef.current = 0;             // trigger immediate drum reschedule
        } else {
          setPhase("finished");
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, combo, getAudioCtx, scheduleBass, scheduleHihat, scheduleLead, playTone]);

  // ─── Render helpers ──────────────────────────────────────────────────────────

  // Grade + accuracy come from the MAIN-TRACK snapshot (taken at every exit
  // path: track end, quit, stall, tab-hide), NOT from the live hits state —
  // hits keeps counting through encore, which would inflate accuracy past
  // 100%. The chart also grows during encore (dynamic tiles get pushed into
  // chartRef), so the note total uses the static main-chart count.
  const mainStats = mainTrackStatsRef.current;
  const accuracy = Math.min(1, (mainStats.perfects + mainStats.goods * 0.5) / MAIN_NOTE_COUNT);
  const grade = gradeFor(accuracy);

  // ─── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: "fixed", inset: 0,
      // Deep cosmic void — falling tiles read as bright lights against darkness,
      // matching the Simon chamber aesthetic for brand-wide visual consistency.
      background: "radial-gradient(ellipse 65% 55% at 50% 50%, #1a0a5a 0%, #0c0430 35%, #05021a 70%, #010008 100%)",
      overflow: "hidden",
      fontFamily: "inherit",
      touchAction: "manipulation",
      // Block iOS long-press callout (Save As / Show / Copy menu that
      // appears when a finger rests on a tappable region). Players were
      // accidentally triggering it mid-run and the menu blocked the lane,
      // wrecking the round.
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitTouchCallout: "none",
    }}>
      {/* Starfield — paused during active gameplay (same rationale as bg icons:
          44 animated box-shadow divs + canvas + particles = too much GPU work
          on low-end Android). Stars are purely ambient; players don't notice
          them mid-game. Resume on idle/finished phases. */}
      {/* Splash icons pause during active play too — see AmbientLayer. */}
      <AmbientLayer stars={stars} active={phase === "playing" || phase === "encore"} />

      {/* Magenta tint wash — intensifies as the track progresses, adds tension */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 45% 35% at 50% 55%, rgba(232,121,249,${Math.min(0.28, 0.08 + (TRACK_DURATION - timeLeft) / TRACK_DURATION * 0.25)}) 0%, transparent 70%)`,
        pointerEvents: "none", zIndex: 1,
      }} />

      {/* ═══ IDLE ═══ */}
      {phase === "idle" && (
        <IdleView
          onStart={startGame}
          onExit={() => router.push("/games")}
          onLeaderboard={() => router.push("/games/rhythm/leaderboard")}
          guest={!authed}
          /* Banner sits between the leaderboard preview and the START
             button on warn/block · null otherwise · keeping the lobby
             clean for the happy path. LowGasBanner self-hides for safe /
             guest / minipay buckets so this prop just passes through. */
          gasBanner={
            <LowGasBanner
              status={gasStatus}
              approxSavesLeft={approxSavesLeft}
              onOpenHelp={() => setGasHelpOpen(true)}
            />
          }
        />
      )}

      {/* ═══ COUNTDOWN ═══ */}
      {phase === "countdown" && <CountdownView n={countdown} />}

      {/* ═══ PLAYING + ENCORE (same view, different HUD treatment) ═══ */}
      {(phase === "playing" || phase === "encore") && (
        <PlayingView
          score={score} combo={combo} timeLeft={timeLeft}
          bursts={bursts}
          comboToast={comboToast} flashLane={flashLane} feedback={feedback}
          onTapLane={hitLane}
          // QUIT ends the run with the current score. Transitions to "finished"
          // which triggers the normal submit flow — player sees their grade
          // and whatever XP/achievements they earned.
          onQuit={() => {
            // Snapshot main-track stats if they quit before reaching the end,
            // so FC/AP flags stay accurate (they quit → they didn't FC).
            if (phase === "playing") {
              mainTrackStatsRef.current = { misses: hits.miss + 1, goods: hits.good, perfects: hits.perfect };
            }
            setPhase("finished");
          }}
          startRef={startRef}
          canvasHandleRef={canvasHandleRef}
          pet={pet}
          isEncore={phase === "encore"}
          encoreLives={encoreLives}
          encoreLoop={encoreLoop}
          fever={feverActive}
          perfectStreak={perfectStreak}
        />
      )}
      {/* Shared juice overlay — floating popups + screen shake + big combo
          callouts + danger vignette in the last 5 seconds of the main track.
          Sits over the PlayingView (fixed/absolute container at the page
          root), pointerEvents:none so input still falls through to lanes. */}
      {(phase === "playing" || phase === "encore") && (
        <JuiceOverlay {...juice} timeLeft={timeLeft} dangerSeconds={5} />
      )}

      {/* ═══ FINISHED ═══ */}
      {phase === "finished" && (
        <FinishedView
          grade={grade}
          score={score} maxCombo={maxCombo} hits={hits}
          accuracy={Math.round(accuracy * 100)}
          encoreLoop={encoreLoop}
          onPlayAgain={startGame}
          // Exit returns to THIS game's lobby (idle phase) instead of
          // bouncing out to the /games hub. The hub is a separate tap
          // from the bottom nav; players who finish a run almost always
          // want one of: play again, see their score linger on the
          // lobby, or check the leaderboard — all of which live on
          // this page's idle view.
          onExit={() => { reset(); setPhase("idle"); }}
          submitting={submitting}
          signingOnChain={signingOnChain}
          submitResult={submitResult}
          submitError={submitError}
          txError={txError}
          guest={!authed}
          needsMint={needsMint}
        />
      )}

      {/* ═══ LEVEL-UP CELEBRATION — full-screen staged moment ═══ */}
      <LevelUpToast
        level={levelUpToastLevel}
        onClose={() => setLevelUpToastLevel(null)}
      />

      {/* ═══ PET EVOLUTION CELEBRATION — queued after level-up when
              the new level crosses a pet-stage boundary ═══ */}
      <PetEvolveToast
        pet={petEvolveToPet}
        newLevel={petEvolveAtLevel}
        onClose={() => setPetEvolveToPet(null)}
      />

      {/* ═══ PUSH OPT-IN — asks after any successful submit, once per device ═══
              The modal's own localStorage gate prevents nagging, so the trigger
              just needs to mark "you finished a game and your score saved." */}
      <PushOptInModal
        walletAddress={address}
        trigger={!!submitResult}
      />

      {/* GasHelpSheet · pre-game gate destination. Opens when the player
          taps START while blocked or when they tap the LowGasBanner on
          the lobby. Score is omitted at the gate (no run has happened
          yet) so the message pre-fill stays a clean ask. */}
      <GasHelpSheet
        open={gasHelpOpen}
        onClose={() => setGasHelpOpen(false)}
        intent="gas-help"
        game="rhythm"
      />
    </div>
  );
}

// ─── Idle: "GET READY" splash before game starts ──────────────────────────────
function IdleView({ onStart, onExit, onLeaderboard, guest, gasBanner }: {
  onStart: () => void;
  onExit: () => void;
  onLeaderboard: () => void;
  guest?: boolean;
  // Optional slot for the LowGasBanner. The parent owns the gas state +
  // the GasHelpSheet, so IdleView just renders whatever node it gets.
  // Null is the common case (player is safely funded) · the layout
  // collapses gracefully.
  gasBanner?: React.ReactNode;
}) {
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
          textShadow: "0 0 24px rgba(232,121,249,0.9), 0 4px 10px rgba(0,0,0,0.7)",
          lineHeight: 1,
        }}>RHYTHM<br />RUSH</div>
      </div>

      <div style={{
        maxWidth: "360px", textAlign: "center",
        color: "rgba(220,200,255,0.75)", fontSize: "13px", fontWeight: 700, lineHeight: 1.6,
      }}>
        Tap the notes as they hit the bottom.
        Build combos for bigger multipliers.
        <br />
        <span style={{ color: "rgba(251,191,36,0.85)" }}>
          Desktop: A S D F or ← ↓ ↑ →
        </span>
      </div>

      {guest && <GuestPlayChip />}

      {/* Gas posture pill · only renders for warn/block. Empty otherwise
          so the lobby reads clean for the happy-path player. */}
      {gasBanner}

      {/* Top players preview · the leaderboard lives ON the play surface
          where the eye actually goes, not in a corner icon nobody scans.
          Showing who you're chasing is the START motivation. */}
      <RhythmTopPlayersPreview onViewAll={onLeaderboard} />

      {/* Juicy START button */}
      <div role="button" tabIndex={0} onClick={onStart}
        style={{ cursor: "pointer", userSelect: "none", width: "min(240px, 80vw)" }}>
        <div style={{
          borderRadius: "18px", background: "#7c1d5a", paddingBottom: "6px",
          boxShadow: "0 12px 28px -6px rgba(232,121,249,0.75), 0 0 40px rgba(232,121,249,0.3)",
        }}>
          <div style={{
            borderRadius: "16px 16px 12px 12px",
            background: "linear-gradient(160deg, #f5a3ef 0%, #e879f9 50%, #c026d3 100%)",
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
  const color = n <= 0 ? "#fbbf24" : "#e879f9";
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

// ─── Pet center — visible during gameplay, reacts to hits + combos ───────────
function PetCenter({
  pet, combo, feedback,
}: {
  pet: PetStage;
  combo: number;
  feedback: { lane: number; type: "perfect" | "good" | "miss"; ts: number } | null;
}) {
  // Reaction state driven by feedback timestamp. Wilt holds longer than jump
  // so misses actually register visually — previously 420ms was too brief for
  // players focused on the tiles to notice.
  const [reaction, setReaction] = useState<"idle" | "jump" | "wilt">("idle");
  const [bubble, setBubble] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    if (feedback.type === "perfect") {
      setReaction("jump");
      const t = setTimeout(() => setReaction("idle"), 550);
      return () => clearTimeout(t);
    }
    if (feedback.type === "miss") {
      setReaction("wilt");
      setBubble("💔");
      const t1 = setTimeout(() => setReaction("idle"), 900);
      const t2 = setTimeout(() => setBubble(null), 900);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [feedback?.ts, feedback?.type]);

  // Combo milestone speech bubbles — pet cheers on every 10-streak.
  // Different emoji per tier so the ceiling feels earned.
  useEffect(() => {
    if (combo > 0 && combo % 10 === 0) {
      const emoji = combo >= 40 ? "👑" : combo >= 30 ? "🔥" : combo >= 20 ? "⭐" : "✨";
      setBubble(emoji);
      const t = setTimeout(() => setBubble(null), 1100);
      return () => clearTimeout(t);
    }
  }, [combo]);

  // Combo-driven aura + pulse — more dramatic progression than before so the
  // pet visibly grows and glows as you chain streaks. Max at 1.3x scale.
  const showAura = combo >= 10;
  const bigAura = combo >= 25;
  const celebrate = combo > 0 && combo % 10 === 0 && combo >= 10;
  const pulseScale = 1 + Math.min(combo, 40) * 0.0075; // 1.0 → 1.30 across 0→40 combo

  const animClass = reaction === "jump" ? "pet-poke" : "slime-idle";

  return (
    <div style={{
      flexShrink: 0, position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "0 0 6px",
      pointerEvents: "none",
    }}>
      <div style={{
        position: "relative",
        width: "84px", height: "84px",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        transform: `scale(${pulseScale})`,
        transition: "transform 0.2s",
      }}>
        {/* Outer tier-style aura at combo 10+ */}
        {showAura && (
          <div style={{
            position: "absolute", inset: "-10px",
            borderRadius: "50%",
            background: bigAura
              ? "conic-gradient(from 0deg, #fbbf24, #f97316, #c026d3, #06b6d4, #fbbf24)"
              : `conic-gradient(from 0deg, ${pet.color}, ${pet.color}88, ${pet.color})`,
            opacity: 0.85,
            filter: "blur(3px)",
            animation: "bounce-scale-in 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
          }} />
        )}
        {/* Soft ground glow — intensifies with combo */}
        <div style={{
          position: "absolute", bottom: "-4px", left: "50%", transform: "translateX(-50%)",
          width: "82%", height: "18px",
          borderRadius: "50%",
          background: `radial-gradient(ellipse at 50% 50%, ${pet.color}cc 0%, transparent 70%)`,
          filter: "blur(3px)",
          opacity: 0.6 + Math.min(combo, 20) * 0.02,
        }} />
        {/* Celebration sparkles burst on every 10th combo — now 8 sparkles, wider */}
        {celebrate && (
          <>
            {[...Array(8)].map((_, i) => {
              const angle = (i / 8) * Math.PI * 2;
              return (
                <span key={`${combo}-${i}`} style={{
                  position: "absolute", top: "50%", left: "50%",
                  color: "#fbbf24", fontSize: "14px",
                  filter: "drop-shadow(0 0 8px rgba(251,191,36,0.95))",
                  transform: `translate(${Math.cos(angle) * 34 - 50}%, ${Math.sin(angle) * 34 - 50}%)`,
                  animation: `pet-sparkle 0.9s ease-out both`,
                }}>✦</span>
              );
            })}
          </>
        )}
        {/* Pet */}
        <div className={animClass} style={{
          width: "100%", height: "100%",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          transformOrigin: "50% 100%",
          filter: reaction === "wilt"
            ? "grayscale(0.85) brightness(0.5) saturate(0.4)"
            : "none",
          transition: "filter 0.2s",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pet.src} alt="" draggable={false}
            style={{
              width: "100%", height: "100%", objectFit: "contain",
              filter: `drop-shadow(0 0 12px ${pet.color}cc) drop-shadow(0 4px 6px rgba(0,0,0,0.5))`,
            }} />
        </div>
        {/* Speech bubble — floats above on misses + combo milestones */}
        {bubble && (
          <div key={bubble + (feedback?.ts ?? combo)} style={{
            position: "absolute",
            top: "-22px", left: "50%", transform: "translateX(-50%)",
            fontSize: "22px",
            filter: "drop-shadow(0 0 10px rgba(255,255,255,0.6))",
            animation: "bubble-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 3,
          }}>{bubble}</div>
        )}
      </div>
    </div>
  );
}

// ─── Playing: the actual game ─────────────────────────────────────────────────
function PlayingView({
  score, combo, timeLeft, bursts,
  comboToast, flashLane, feedback,
  onTapLane, onQuit, startRef, canvasHandleRef,
  pet,
  isEncore, encoreLives, encoreLoop,
  fever, perfectStreak,
}: {
  score: number; combo: number; timeLeft: number;
  bursts: Burst[];
  comboToast: string | null; flashLane: number | null;
  feedback: { lane: number; type: "perfect" | "good" | "miss"; ts: number; ms?: number } | null;
  onTapLane: (lane: number) => void;
  onQuit: () => void;
  startRef: React.MutableRefObject<number>;
  // Parent RAF calls canvasHandleRef.current.draw() every tick.
  // PlayingView owns the JSX that mounts the canvas, then stashes the
  // handle into this shared ref so the parent can reach it.
  canvasHandleRef: React.MutableRefObject<NoteCanvasHandle | null>;
  pet: PetStage;
  isEncore: boolean;
  encoreLives: number;
  encoreLoop: number;
  fever: boolean;
  perfectStreak: number;
}) {
  const timePct = 1 - timeLeft / TRACK_DURATION;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", flexDirection: "column" }}>
      {/* ═══ FEVER VIGNETTE — the whole screen ignites gold for the 6
          doubled seconds. pointerEvents:none so lanes stay tappable. ═══ */}
      {fever && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none",
          background: "radial-gradient(ellipse 90% 80% at 50% 50%, transparent 40%, rgba(251,191,36,0.16) 75%, rgba(251,191,36,0.32) 100%)",
          boxShadow: "inset 0 0 90px rgba(251,191,36,0.4)",
        }} />
      )}

      {/* ═══ TOP HUD ═══ */}
      <div style={{
        padding: "14px 16px 10px",
        display: "flex", alignItems: "center", gap: "10px",
      }}>
        {/* QUIT — ends the run, submits what the player has, shows finish screen */}
        <button onClick={onQuit} aria-label="Quit run"
          style={{
            flexShrink: 0,
            borderRadius: "10px",
            background: "linear-gradient(180deg, #3a0a0a 0%, #2a0606 100%)",
            border: "1.5px solid rgba(255,80,80,0.45)",
            color: "#fca5a5",
            fontSize: "10px", fontWeight: 900, letterSpacing: "0.14em",
            cursor: "pointer", fontFamily: "inherit",
            padding: "8px 12px",
            boxShadow: "0 0 14px rgba(239,68,68,0.3), 0 4px 10px rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", gap: "6px",
          }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          QUIT
        </button>

        {/* Timer bar during song, LIVES display during encore */}
        {!isEncore ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "rgba(200,180,255,0.6)", fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em", minWidth: "38px" }}>
              {timeLeft.toFixed(1)}s
            </span>
            <div style={{
              flex: 1, height: "10px", borderRadius: "999px",
              background: "rgba(0,0,0,0.5)",
              border: "1.5px solid rgba(160,100,255,0.25)",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${timePct * 100}%`, height: "100%", borderRadius: "999px",
                background: timeLeft < 5
                  ? "linear-gradient(90deg, #ef4444 0%, #f97316 100%)"
                  : "linear-gradient(90deg, #c026d3 0%, #e879f9 50%, #fbbf24 100%)",
                boxShadow: timeLeft < 5
                  ? "0 0 10px rgba(239,68,68,0.6)"
                  : "0 0 10px rgba(232,121,249,0.6)",
                transition: "width 0.05s linear",
              }} />
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px", justifyContent: "space-between" }}>
            <span style={{
              color: "#fbbf24",
              fontSize: "13px", fontWeight: 900, letterSpacing: "0.24em",
              textShadow: "0 0 12px rgba(251,191,36,0.9), 0 2px 4px rgba(0,0,0,0.6)",
              animation: "bounce-scale-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
            }}>★ ENCORE ★</span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: "16px", height: "16px", borderRadius: "50%",
                  background: i < encoreLives
                    ? "radial-gradient(circle at 30% 30%, #ff6b6b 0%, #dc2626 60%, #7f1d1d 100%)"
                    : "rgba(0,0,0,0.4)",
                  border: i < encoreLives ? "1.5px solid rgba(255,180,180,0.6)" : "1.5px solid rgba(255,255,255,0.1)",
                  boxShadow: i < encoreLives ? "0 0 8px rgba(239,68,68,0.6)" : "inset 0 2px 3px rgba(0,0,0,0.6)",
                  transition: "all 0.25s",
                }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ STATS STRIP ═══ */}
      <div style={{
        padding: "0 16px 10px",
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px",
      }}>
        <StatGem label="SCORE" value={String(score).padStart(4, "0")} color="#fbbf24" wall="#2a1800" />
        <StatGem label="COMBO" value={combo > 0 ? `${combo}x` : "—"} color={combo >= 15 ? "#fbbf24" : combo >= 5 ? "#e879f9" : "#a78bfa"} wall="#1a0550" emphasize={combo >= 5} />
        {/* Third gem tells the run's current story: encore shows survival
            depth (LOOP N), main track shows fever state — burning ×2, or
            progress toward ignition (perfect streak / trigger). */}
        {isEncore ? (
          <StatGem label="LOOP" value={`${Math.max(1, encoreLoop)}`} color="#f97316" wall="#3a1400" emphasize />
        ) : fever ? (
          <StatGem label="FEVER" value="×2 🔥" color="#fbbf24" wall="#2a1800" emphasize />
        ) : (
          <StatGem label="FEVER" value={`${perfectStreak}/${FEVER_TRIGGER}`} color="#67e8f9" wall="#083a6b" emphasize={perfectStreak >= FEVER_TRIGGER - 3} />
        )}
      </div>

      {/* ═══ PET — top center, reacts to hits ═══ */}
      <PetCenter pet={pet} combo={combo} feedback={feedback} />


      {/* ═══ PLAY FIELD (lanes + falling notes) ═══ */}
      <div style={{
        flex: 1,
        position: "relative",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        gap: "6px",
        padding: "0 10px 10px",
        overflow: "hidden",
      }}>
        {LANES.map((theme, i) => (
          <Lane
            key={i}
            theme={theme}
            laneIdx={i}
            flashing={flashLane === i}
            feedback={feedback && feedback.lane === i ? feedback : null}
          />
        ))}

        {/* Falling tiles — rendered on a single <canvas>, drawn
            imperatively from the parent's RAF loop via
            canvasHandleRef.current.draw(visible, now). React never
            reconciles the tiles. See components/rhythm/NoteCanvas.tsx
            for the full rationale (short version: DOM tiles melted
            phones once more than a few were on-screen; canvas stays
            smooth on mid-range Android + iPhone 13). */}
        <NoteCanvas
          ref={canvasHandleRef}
          lanes={LANES}
        />

        {/* Particle bursts */}
        {bursts.map(b => {
          const age = (performance.now() - b.born) / 600;
          return (
            <div key={b.id} style={{
              position: "absolute",
              left: `${b.x}%`, top: `${b.y}%`,
              width: "80px", height: "80px",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              opacity: 1 - age,
            }}>
              {[...Array(8)].map((_, i) => {
                const angle = (i / 8) * Math.PI * 2;
                const dist = age * 40;
                const x = Math.cos(angle) * dist;
                const y = Math.sin(angle) * dist;
                return (
                  <span key={i} style={{
                    position: "absolute", top: "50%", left: "50%",
                    width: "6px", height: "6px", borderRadius: "50%",
                    background: b.color,
                    boxShadow: `0 0 8px ${b.color}`,
                    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                  }} />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ═══ TAP ZONES (4 juicy buttons at bottom) ═══ */}
      <div style={{
        padding: "0 10px 16px",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px",
      }}>
        {LANES.map((theme, i) => (
          <TapButton
            key={i}
            theme={theme}
            laneIdx={i}
            isFlashing={flashLane === i}
            onPress={() => onTapLane(i)}
          />
        ))}
      </div>

      {/* ═══ COMBO TOAST (center) ═══
          Fluid padding + maxWidth so long strings like "50× COMBO!" or
          "ENCORE!" don't spill off the viewport on 360px phones. */}
      {comboToast && (
        <div style={{
          position: "absolute", top: "32%", left: "50%",
          transform: "translate(-50%, -50%)",
          padding: "clamp(9px, 2.6vw, 14px) clamp(16px, 5vw, 28px)",
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
            fontSize: "clamp(16px, 4.5vw, 30px)",
            fontWeight: 900,
            letterSpacing: "0.08em", textShadow: "0 2px 4px rgba(0,0,0,0.5)",
            whiteSpace: "nowrap",
          }}>{comboToast}</span>
        </div>
      )}
    </div>
  );
}

// ─── Stat gem (reused from profile pattern) ───────────────────────────────────
function StatGem({ label, value, color, wall, emphasize }: { label: string; value: string; color: string; wall: string; emphasize?: boolean }) {
  return (
    <div style={{
      borderRadius: "12px", background: wall, paddingBottom: "4px",
      boxShadow: `0 6px 14px -4px ${color}77, 0 0 0 1px ${color}66${emphasize ? `, 0 0 20px ${color}88` : ""}`,
    }}>
      <div style={{
        borderRadius: "10px 10px 8px 8px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.3) 100%)",
        padding: "8px 4px 6px", textAlign: "center",
        border: `1.5px solid ${color}55`, position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: 0, left: "10%", right: "10%", height: "40%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "relative", zIndex: 1,
          fontSize: "20px", fontWeight: 900, color, lineHeight: 1,
          textShadow: `0 0 12px ${color}, 0 2px 4px rgba(0,0,0,0.6)`,
        }}>{value}</div>
        <div style={{
          position: "relative", zIndex: 1,
          fontSize: "7px", fontWeight: 800, color: "rgba(200,180,255,0.55)",
          letterSpacing: "0.16em", marginTop: "4px",
        }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Lane — the vertical track where notes fall ──────────────────────────────
function Lane({ theme, laneIdx: _laneIdx, flashing, feedback }: { theme: LaneTheme; laneIdx: number; flashing: boolean; feedback: { type: "perfect" | "good" | "miss"; ts: number; ms?: number } | null }) {
  const feedbackLabel = feedback ? (feedback.type === "perfect" ? "PERFECT!" : feedback.type === "good" ? "GOOD" : "MISS") : null;
  const feedbackColor = feedback?.type === "perfect" ? "#fbbf24" : feedback?.type === "good" ? theme.accent : "#ef4444";
  // Calibration readout — GOODs show the signed ms offset so the player
  // learns WHY it wasn't perfect ("-40ms early" → tap later). This is the
  // detail that turns tappers into calibrators; perfects stay clean.
  const msLabel = feedback?.type === "good" && typeof feedback.ms === "number"
    ? `${feedback.ms > 0 ? "+" : ""}${feedback.ms}ms ${feedback.ms > 0 ? "late" : "early"}`
    : null;
  return (
    <div style={{
      position: "relative",
      borderRadius: "14px",
      background: flashing
        ? `linear-gradient(180deg, ${theme.accent}18 0%, rgba(0,0,0,0.2) 100%)`
        : "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.25) 100%)",
      border: `1.5px solid ${flashing ? theme.accent : "rgba(255,255,255,0.08)"}`,
      boxShadow: flashing ? `inset 0 0 24px ${theme.glow}` : "none",
      overflow: "hidden",
      transition: "border-color 0.08s, box-shadow 0.08s",
    }}>
      {/* Lane glow strip down center */}
      <div style={{
        position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
        width: "2px", height: "100%",
        background: `linear-gradient(180deg, transparent 0%, ${theme.accent}33 50%, transparent 100%)`,
        pointerEvents: "none",
      }} />

      {/* TAP TARGET — dashed tile shape matching the falling notes */}
      <div style={{
        position: "absolute", bottom: "0%", left: "50%",
        transform: "translate(-50%, 50%)",
        width: "78%", maxWidth: "90px", minWidth: "54px",
        height: "40px",
        borderRadius: "12px",
        border: `2px dashed ${theme.accent}88`,
        boxShadow: flashing ? `0 0 20px ${theme.glow}` : `inset 0 0 12px ${theme.accent}22`,
        background: flashing ? `${theme.accent}11` : "transparent",
        pointerEvents: "none",
        transition: "all 0.08s",
      }} />

      {/* Feedback label (floats up from bottom on hit).
          Fluid font — each lane on a 4-lane mobile layout is ~22vw wide;
          a fixed 14px "PERFECT!" clipped at the lane edges. */}
      {feedbackLabel && (
        <div key={feedback!.ts} style={{
          position: "absolute", bottom: "20%", left: "50%", transform: "translateX(-50%)",
          color: feedbackColor,
          fontSize: "clamp(10px, 3.2vw, 14px)",
          fontWeight: 900,
          letterSpacing: "0.06em",
          textShadow: `0 0 10px ${feedbackColor}`,
          animation: "bubble-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          pointerEvents: "none", zIndex: 2,
          whiteSpace: "nowrap",
          textAlign: "center",
        }}>
          {feedbackLabel}
          {msLabel && (
            <div style={{
              fontSize: "clamp(8px, 2.4vw, 10px)", fontWeight: 700,
              color: "rgba(255,255,255,0.65)", letterSpacing: "0.04em",
              textShadow: "0 1px 3px rgba(0,0,0,0.8)", marginTop: 1,
            }}>{msLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tap button (juicy wall + face — same pattern as game card START) ────────
function TapButton({ theme, laneIdx, isFlashing, onPress }: { theme: LaneTheme; laneIdx: number; isFlashing: boolean; onPress: () => void }) {
  const keyLabels = ["A", "S", "D", "F"];
  return (
    <div
      role="button" tabIndex={0}
      // Opt out of the global UI click blip — tapping a lane plays the bell
      // at the tile's pitch (melodic). A UI tick on top would muddle it.
      data-no-click-sound="true"
      onPointerDown={e => { e.preventDefault(); onPress(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        transition: "transform 0.05s",
        transform: isFlashing ? "scale(0.96) translateY(2px)" : "scale(1)",
        touchAction: "manipulation",
      }}>
      <div style={{
        borderRadius: "14px", background: theme.wall, paddingBottom: "5px",
        boxShadow: `0 10px 22px -4px ${theme.glow}, 0 0 18px ${theme.glow}55`,
      }}>
        <div style={{
          borderRadius: "12px 12px 10px 10px",
          background: theme.face,
          padding: "16px 4px", textAlign: "center",
          position: "relative", overflow: "hidden",
          border: "2px solid rgba(255,255,255,0.45)",
          boxShadow: isFlashing
            ? `inset 0 6px 14px rgba(255,255,255,0.9), 0 0 30px ${theme.glow}`
            : "inset 0 6px 14px rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.3)",
        }}>
          {/* Gloss */}
          <div style={{
            position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)",
            borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
          }} />
          <span style={{
            position: "relative", zIndex: 1,
            color: "white", fontSize: "22px", fontWeight: 900,
            textShadow: "0 2px 4px rgba(0,0,0,0.5)",
          }}>{keyLabels[laneIdx]}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Finished: results + grade ────────────────────────────────────────────────
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
  grade, score, maxCombo, hits, accuracy, encoreLoop,
  onPlayAgain, onExit,
  submitting, signingOnChain, submitResult, submitError, txError,
  guest, needsMint,
}: {
  grade: ReturnType<typeof gradeFor>;
  score: number; maxCombo: number;
  hits: { perfect: number; good: number; miss: number };
  // Main-track accuracy percentage (0-100) computed by the parent from the
  // snapshot taken when the chart ended — encore hits don't inflate it.
  accuracy: number;
  // Deepest encore loop survived · 0 = never reached encore. The survival
  // brag stat: shown as a badge next to the score.
  encoreLoop: number;
  onPlayAgain: () => void;
  onExit: () => void;
  submitting: boolean;
  signingOnChain: boolean;
  submitResult: FinishedSubmit | null;
  submitError: string | null;
  txError: string | null;
  guest?: boolean;
  needsMint?: boolean;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(2,0,12,0.78)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      animation: "rhythm-sheet-fade 0.28s ease both",
    }}>
      {/* Sheet · slides up from the bottom. Same iOS-spring curve as the
          Events bottom sheet so the app feels one piece across surfaces. */}
      <div style={{
        width: "100%", maxWidth: "520px",
        maxHeight: "92vh", overflowY: "auto",
        borderRadius: "26px 26px 0 0",
        background: "linear-gradient(180deg, rgba(20,8,52,0.98) 0%, rgba(8,2,28,0.99) 100%)",
        border: "1px solid rgba(232,121,249,0.18)",
        borderBottom: "none",
        boxShadow: "0 -24px 60px -10px rgba(232,121,249,0.22), 0 -2px 0 rgba(255,255,255,0.04) inset",
        paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))",
        animation: "rhythm-sheet-up 0.42s cubic-bezier(0.16, 1, 0.3, 1) both",
        position: "relative",
      }}>
        <style>{`
          @keyframes rhythm-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
          @keyframes rhythm-sheet-fade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes rhythm-grade-in { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          @keyframes rhythm-score-rise { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        `}</style>

        {/* Drag handle */}
        <div style={{ padding: "10px 0 4px", display: "flex", justifyContent: "center" }}>
          <div style={{ width: 44, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
        </div>

        <div style={{ padding: "8px 22px 22px", textAlign: "center", position: "relative" }}>
          {/* Faint confetti dots behind the grade · understated, not arcade */}
          {[...Array(8)].map((_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            return (
              <span key={i} aria-hidden style={{
                position: "absolute", top: "78px", left: "50%",
                width: 4, height: 4, borderRadius: 999,
                background: grade.color, opacity: 0.55,
                filter: `drop-shadow(0 0 6px ${grade.color})`,
                transform: `translate(${Math.cos(angle) * 96 - 2}px, ${Math.sin(angle) * 96 - 2}px)`,
                animation: `pet-sparkle ${2.4 + i * 0.18}s ease-in-out ${i * 0.25}s infinite`,
                pointerEvents: "none",
              }} />
            );
          })}

          {/* Eyebrow + grade letter */}
          <div style={{
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
            color: grade.color, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.24em",
            textTransform: "uppercase",
            opacity: 0.85, marginTop: 6,
          }}>{grade.desc}</div>

          <div style={{
            position: "relative", zIndex: 1,
            width: 116, height: 116, margin: "12px auto 0",
            borderRadius: "50%",
            padding: 2,
            background: `conic-gradient(from 220deg, ${grade.color}, ${grade.color}55, ${grade.color})`,
            boxShadow: `0 0 0 1px rgba(255,255,255,0.06), 0 0 38px ${grade.color}55`,
            animation: "rhythm-grade-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.08s both",
          }}>
            <div style={{
              width: "100%", height: "100%", borderRadius: "50%",
              background: "linear-gradient(180deg, rgba(20,8,52,0.96) 0%, rgba(8,2,28,1) 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{
                fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif',
                fontSize: 72, fontWeight: 900,
                color: "#fff",
                textShadow: `0 0 14px ${grade.color}, 0 0 30px ${grade.color}aa, 0 2px 4px rgba(0,0,0,0.7)`,
                WebkitTextStroke: `0.6px ${grade.color}`,
                lineHeight: 1,
              }}>{grade.letter}</span>
            </div>
          </div>

          {/* Score */}
          <div style={{
            marginTop: 16,
            animation: "rhythm-score-rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) 0.18s both",
          }}>
            <div style={{
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
              color: "rgba(220,210,255,0.5)", fontSize: 10, fontWeight: 800, letterSpacing: "0.22em",
            }}>SCORE</div>
            <div style={{
              fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif',
              color: "#fde68a",
              fontSize: "clamp(36px, 9vw, 46px)", fontWeight: 900,
              textShadow: "0 0 22px rgba(251,191,36,0.55), 0 2px 8px rgba(0,0,0,0.55)",
              lineHeight: 1, marginTop: 4,
              letterSpacing: "0.01em",
            }}>{score.toLocaleString()}</div>
            {/* Survival badge — how deep into the accelerating encore this
                run made it. The depth flex ("LOOP 5") replaces the old
                million-point flex the flat encore used to hand out. */}
            {encoreLoop > 0 && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                marginTop: 8, padding: "4px 12px", borderRadius: 999,
                background: "rgba(249,115,22,0.12)",
                border: "1px solid rgba(249,115,22,0.5)",
                boxShadow: "0 0 14px rgba(249,115,22,0.25)",
              }}>
                <span style={{ fontSize: 11 }}>⚡</span>
                <span style={{
                  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
                  color: "#fdba74", fontSize: 10.5, fontWeight: 900, letterSpacing: "0.16em",
                }}>REACHED LOOP {encoreLoop}</span>
              </div>
            )}
          </div>

          {/* Stats · refined chip row, 4 columns */}
          <div style={{
            marginTop: 18,
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7,
          }}>
            <StatChip label="PERFECT" value={hits.perfect} color="#fbbf24" />
            <StatChip label="GOOD" value={hits.good} color="#e879f9" />
            <StatChip label="MISS" value={hits.miss} color="#f43f5e" />
            <StatChip label="MAX×" value={maxCombo} color="#22c55e" />
          </div>

          {/* Accuracy */}
          <div style={{ marginTop: 14, textAlign: "left" }}>
            <div style={{
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginBottom: 5,
            }}>
              <span style={{ color: "rgba(220,210,255,0.55)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em" }}>ACCURACY</span>
              <span style={{ color: "#fde68a", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.04em" }}>{accuracy}%</span>
            </div>
            <div style={{
              height: 6, borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.04)",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${accuracy}%`, height: "100%", borderRadius: 999,
                background: "linear-gradient(90deg, #a78bfa 0%, #e879f9 55%, #fbbf24 100%)",
                boxShadow: "0 0 10px rgba(232,121,249,0.45)",
                transition: "width 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
              }} />
            </div>
          </div>

          {/* Save surface, three ways:
              · guest (no wallet)      → sign in to save
              · connected, no GamePass → mint to save (conversion moment)
              · full player            → normal reward/save panel */}
          {guest ? (
            <GuestScorePrompt nextPath="/games/rhythm" />
          ) : needsMint ? (
            <MintScorePrompt score={score} />
          ) : (
            <RewardPanel
              submitting={submitting}
              signingOnChain={signingOnChain}
              result={submitResult}
              error={submitError}
              txError={txError}
              score={score}
            />
          )}

          {/* CTAs. While the score is still saving (wallet signature +
              on-chain confirm), leaving would abort the save and the
              player loses a run they earned. Humans reflexively tap the
              game-over screen, so we LOCK the exits until the score is
              safe: dim + non-interactive while saving, plus a plain-
              language notice. Once saved (or failed), they unlock. */}
          {(() => {
            const saving = submitting || signingOnChain;
            return (
              <>
                <div style={{ marginTop: 22, display: "flex", gap: 10, opacity: saving ? 0.45 : 1, pointerEvents: saving ? "none" : "auto", transition: "opacity 0.25s ease" }}>
                  <SheetBtn label="PLAY AGAIN" variant="primary" onClick={onPlayAgain} />
                  <SheetBtn label="EXIT" variant="ghost" onClick={onExit} />
                </div>
                {saving && (
                  <div style={{ marginTop: 10, textAlign: "center", fontSize: 11.5, fontWeight: 700, color: "rgba(134,239,172,0.9)" }}>
                    💾 Saving your score · hold on a sec
                  </div>
                )}
                {/* MARKOV cross-promo is a navigation link · a tap-landmine
                    on the most reflexive screen in the game. Only show it
                    once the score is safely saved, never during the save
                    window. This is the button the player flagged. */}
                {!saving && <ArenaCrossPromo />}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Refined stat chip · replaces the old chunky MiniStat ─────────────────
function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      borderRadius: 11,
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${color}33`,
      padding: "9px 4px 7px",
      textAlign: "center",
      boxShadow: `inset 0 0 16px ${color}10`,
    }}>
      <div style={{
        fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif',
        color, fontSize: 17, fontWeight: 900,
        textShadow: `0 0 10px ${color}66`,
        lineHeight: 1,
      }}>{value}</div>
      <div style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
        color: "rgba(220,210,255,0.5)", fontSize: 8.5, fontWeight: 800,
        letterSpacing: "0.14em", marginTop: 4,
      }}>{label}</div>
    </div>
  );
}

// ─── Refined dual CTA · primary magenta-filled, ghost outline ────────────
function SheetBtn({ label, variant, onClick }: { label: string; variant: "primary" | "ghost"; onClick: () => void }) {
  const primary = variant === "primary";
  return (
    <button onClick={onClick} style={{
      flex: 1, cursor: "pointer", userSelect: "none",
      borderRadius: 14,
      padding: "13px 10px",
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
      fontSize: 12.5, fontWeight: 900, letterSpacing: "0.14em",
      color: "#fff",
      background: primary
        ? "linear-gradient(180deg, #f5a3ef 0%, #e879f9 50%, #c026d3 100%)"
        : "rgba(255,255,255,0.04)",
      border: primary ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(232,121,249,0.35)",
      boxShadow: primary
        ? "0 10px 22px -6px rgba(232,121,249,0.55), inset 0 1px 0 rgba(255,255,255,0.35)"
        : "inset 0 1px 0 rgba(255,255,255,0.06)",
      transition: "transform 0.15s ease",
    }}>{label}</button>
  );
}

// ─── Reward panel — shown on the finish screen after submitting ──────────────
// State machine:
//   signingOnChain → "CONFIRM IN WALLET…" (wallet popup is open)
//   submitting      → "SAVING SCORE…"       (off-chain save in flight)
//   txError        → "TRANSACTION REJECTED" (user said no to the on-chain tx)
//   error          → generic red error line (off-chain save failed)
//   result         → rank + XP + level-up + new achievements
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
  // Wallet popup is open — highest priority state
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

  // Off-chain save in flight (after on-chain tx confirmed)
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

  // Strict classification — only call it gas when the catch block tagged
  // the message with "top up". User-rejected and other failures get the
  // small red banner instead, with no misleading gas blame.
  if (txError) {
    const low = txError.toLowerCase();
    const isGasError = low.includes("top up");
    return <GasAwareTxError txError={txError} isGasError={isGasError} />;
  }

  if (error) {
    // Quick-exit prefix → calm neutral chip, NOT red error.
    // The handleGameOver guard sets submitError to "Quick exit. ..."
    // for sub-5s 0-point runs so the player isn't told their score
    // failed when there was no score in the first place.
    const isQuickExit = error.toLowerCase().startsWith("quick exit");
    return (
      <div style={{
        marginTop: "16px", padding: "10px 12px",
        borderRadius: "10px",
        background: isQuickExit ? "rgba(167,139,250,0.08)" : "rgba(239,68,68,0.08)",
        border: `1px solid ${isQuickExit ? "rgba(167,139,250,0.25)" : "rgba(239,68,68,0.2)"}`,
        color: isQuickExit ? "rgba(200,180,255,0.8)" : "rgba(252,165,165,0.85)",
        fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em",
        textAlign: "center", lineHeight: 1.45,
      }}>
        {error}
      </div>
    );
  }

  if (!result) return null;

  const { rank, xpEarned, level, leveledUp, isNewPb, prevBest, newAchievements = [] } = result;
  const showPbDelta = isNewPb && typeof prevBest === "number" && prevBest > 0;
  const showFirstPb = isNewPb && !showPbDelta;

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

// ─── RewardContent — separated so we can fire stings when callouts mount ────
// Each callout has its own short useEffect that plays its specific chime the
// first time the card renders. Order-sequenced with setTimeout so you hear
// PB -> level up -> achievement as stacked events instead of one blurry mush.
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
  // Stagger the stings so each one is individually audible. Rank hits first
  // (it's always there), PB second (if earned), level-up third, achievements
  // last. Each has its own chime — layered, they read as a celebration build.
  useEffect(() => {
    if (rank) playRankReveal();
  }, [rank]);
  useEffect(() => {
    if (isNewPb) {
      const t = setTimeout(() => playSaveSuccess(), 250);
      return () => clearTimeout(t);
    }
  }, [isNewPb]);
  useEffect(() => {
    if (leveledUp) {
      const t = setTimeout(() => playLevelUp(), 500);
      return () => clearTimeout(t);
    }
  }, [leveledUp]);
  useEffect(() => {
    if (newAchievements.length > 0) {
      const t = setTimeout(() => playAchievementChime(), 900);
      return () => clearTimeout(t);
    }
  }, [newAchievements.length]);

  return (
    <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Rank + XP strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px",
      }}>
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

      {/* Personal-best callout — beat your previous high score */}
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

      {/* Level-up callout */}
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

      {/* New achievements */}
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
              // Defensive hydrate — the live backend sometimes returns
              // just the id string (legacy shape), which used to render
              // as a bare trophy with no name. hydrateAchievement maps
              // any id through the local ACHIEVEMENT_META catalog.
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

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      borderRadius: "10px",
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${color}44`,
      padding: "8px 4px", textAlign: "center",
    }}>
      <div style={{ color, fontSize: "17px", fontWeight: 900, textShadow: `0 0 10px ${color}88` }}>{value}</div>
      <div style={{ color: "rgba(200,180,255,0.5)", fontSize: "7px", fontWeight: 800, letterSpacing: "0.1em", marginTop: "2px" }}>{label}</div>
    </div>
  );
}

function JuicyBtn({ label, wall, face, onClick }: { label: string; wall: string; face: string; onClick: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      style={{ flex: 1, cursor: "pointer", userSelect: "none" }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(3px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}>
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

// ─── GasAwareTxError ──────────────────────────────────────────────────────────
// Finish-screen error banner. Two variants:
//   • Plain (default): single-line "Transaction failed" with a retry hint.
//   • Gas-aware: rich card for insufficient-funds failures. One iconic
//     title, one short sentence, one primary CTA (Telegram), one secondary
//     inline link (Copy wallet ID). No jargon, no em dashes. Mirrors the
//     Simon finish screen — both games share the recovery path.
const TELEGRAM_URL = "https://t.me/+oY4inbBoglViNmE0";
// Two visual variants:
//   • Plain (default): generic failure or wallet rejection. Single-line
//     red message with a retry hint. Player decides what to do next.
//   • Gas-aware: triggered when the upstream classified the error as
//     insufficient funds. Rich orange card with one primary CTA
//     (Telegram help) plus a tiny secondary inline link (Copy wallet ID).
// The classification is done at the catch site, not here · so we don't
// overclaim "this was gas" when it was actually a different failure.
function GasAwareTxError({ txError, isGasError }: { txError: string; isGasError: boolean }) {
  const { address } = useAccount();
  const [copied, setCopied] = useState(false);

  if (!isGasError) {
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

  const copyWallet = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })
      .catch(() => {});
  };

  return (
    <div style={{
      marginTop: "16px",
      padding: "12px clamp(12px, 3.5vw, 14px)",
      borderRadius: "12px",
      background: "linear-gradient(180deg, rgba(249,115,22,0.12) 0%, rgba(120,50,0,0.18) 100%)",
      border: "1px solid rgba(249,115,22,0.45)",
      boxShadow: "0 0 14px rgba(249,115,22,0.12)",
      display: "flex", flexDirection: "column",
      gap: "8px",
      textAlign: "center",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: "8px",
        color: "#fed7aa",
        fontSize: "clamp(11px, 3vw, 12.5px)",
        fontWeight: 900, letterSpacing: "0.18em",
        textShadow: "0 0 10px rgba(249,115,22,0.5)",
      }}>
        <span style={{ fontSize: "14px" }}>⛽</span>
        NEEDS A TOP UP TO SAVE
      </div>

      <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer"
        style={{
          display: "block",
          padding: "10px 14px", borderRadius: "10px",
          background: "linear-gradient(160deg, #67e8f9 0%, #06b6d4 50%, #0e7490 100%)",
          color: "white",
          fontSize: "clamp(11px, 2.9vw, 12px)",
          fontWeight: 900, letterSpacing: "0.1em",
          textDecoration: "none",
          border: "1.5px solid rgba(255,255,255,0.4)",
          boxShadow: "0 6px 14px rgba(6,182,212,0.4), inset 0 2px 6px rgba(255,255,255,0.25)",
        }}>
        💬 GET HELP IN TELEGRAM
      </a>

      <button
        onClick={copyWallet}
        style={{
          background: "none", border: "none",
          padding: 0,
          color: copied ? "#86efac" : "rgba(200,170,255,0.7)",
          fontSize: "clamp(10px, 2.5vw, 10.5px)",
          fontWeight: 700, letterSpacing: "0.04em",
          cursor: "pointer", fontFamily: "inherit",
          textDecoration: copied ? "none" : "underline",
          textDecorationStyle: "dashed",
          textDecorationColor: "rgba(200,170,255,0.35)",
          textUnderlineOffset: "3px",
        }}>
        {copied ? "✓ Copied" : "Copy wallet ID"}
      </button>
    </div>
  );
}

// ─── Top players preview on the lobby ─────────────────────────────────────
// Sits between the description and the START button. The lobby's job is to
// recruit a tap; showing who you're chasing is the strongest recruiter top
// game lobbies have (Clash Royale, Brawl Stars, Pokémon Unite all do this).
//
// Reads the current-season Rhythm leaderboard directly from the SUBGRAPH
// (Goldsky · on-chain Score events). Season boundary fetched once from the
// backend; the rows themselves come from chain truth. NOT all-time — the
// lobby cares about the active competitive cycle.
const RHYTHM_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

function RhythmTopPlayersPreview({ onViewAll }: { onViewAll: () => void }) {
  // Seed from the shared cache so a warm cache renders the real data on
  // the first paint · no "Loading…" flash. The cache is populated by
  // prefetchPreview() on game-card tap from /games and /dashboard.
  const seed = getCachedPreview(0);
  const [top, setTop] = useState<LeaderboardEntry[] | null>(seed?.top ?? null);
  const [seasonNum, setSeasonNum] = useState<number | null>(seed?.seasonNum ?? null);

  useEffect(() => {
    let cancelled = false;
    // Stale-while-revalidate · always refetch on mount to keep the lobby
    // current, but the user already sees the cached data while this runs.
    fetchPreview(0).then(v => {
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
      background: "linear-gradient(135deg, rgba(232,121,249,0.6), rgba(232,121,249,0.18))",
      boxShadow: "0 8px 22px -8px rgba(232,121,249,0.55), 0 0 32px rgba(232,121,249,0.15)",
    }}>
      <div style={{
        borderRadius: 16,
        background: "linear-gradient(180deg, rgba(15,5,42,0.92), rgba(8,2,28,0.95))",
        padding: "12px 14px 10px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        <div style={{
          display: "flex", alignItems: "baseline", justifyContent: "space-between",
          fontFamily: "inherit",
        }}>
          <span style={{
            fontSize: 10, fontWeight: 900, letterSpacing: "0.18em",
            color: "rgba(232,121,249,0.85)",
            textTransform: "uppercase",
          }}>Top players</span>
          <span style={{ fontSize: 9.5, color: "rgba(220,200,255,0.45)", fontWeight: 800, letterSpacing: "0.08em" }}>{seasonNum ? `SEASON ${seasonNum} · LIVE` : "LIVE"}</span>
        </div>

        {top === null && (
          <div style={{ fontSize: 11, color: "rgba(220,200,255,0.55)", padding: "6px 2px" }}>Loading…</div>
        )}
        {top !== null && top.length === 0 && (
          <div style={{ fontSize: 11, color: "rgba(220,200,255,0.55)", padding: "6px 2px" }}>No scores yet — be first.</div>
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
          color: "#e879f9", fontFamily: "inherit",
          fontSize: 11, fontWeight: 900, letterSpacing: "0.12em",
          cursor: "pointer",
        }}>VIEW LEADERBOARD ›</button>
      </div>
    </div>
  );
}
