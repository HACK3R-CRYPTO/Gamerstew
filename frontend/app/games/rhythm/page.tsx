"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useAudioSettings, effectiveGains } from "@/hooks/useAudioSettings";
import { playRankReveal, playSaveSuccess, playLevelUp, playAchievementChime } from "@/hooks/useAppAudio";
import { signScore, signScoreMiniPay, submitScore, submitScoreMiniPay } from "@/app/actions/game";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import { hydrateAchievement } from "@/lib/achievements";
import LevelUpToast from "@/components/LevelUpToast";
import NoteCanvas, { type NoteCanvasHandle } from "@/components/rhythm/NoteCanvas";

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
const PERFECT_WINDOW = 0.12;      // ±120ms (slightly forgiving — better feel)
const GOOD_WINDOW = 0.28;      // ±280ms
const BPM = 120;       // 120 BPM → 0.5s per beat (readable)
const BEAT = 60 / BPM;

// Travel time PER SECTION — tuned for Magic Tiles / DJMAX readability.
// Longer = more time to see the tile coming. Never drop below 1.3s (too stressful).
const TRAVEL_INTRO = 2.5;   // slow — teach the mechanic
const TRAVEL_VERSE = 2.1;   // medium
const TRAVEL_BUILD = 1.7;   // faster — building tension
const TRAVEL_DROP = 1.4;   // fastest — but still readable

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

// ─── Lane palette (V2 discipline: magenta world + 3 supporting game colors) ──
type LaneTheme = { wall: string; face: string; glow: string; accent: string };
const LANES: LaneTheme[] = [
  { wall: "#7c1d5a", face: "linear-gradient(160deg, #f5a3ef 0%, #e879f9 50%, #c026d3 100%)", glow: "rgba(232,121,249,0.8)", accent: "#e879f9" },
  { wall: "#083a6b", face: "linear-gradient(160deg, #93c5fd 0%, #3b82f6 50%, #1d4ed8 100%)", glow: "rgba(59,130,246,0.8)", accent: "#3b82f6" },
  { wall: "#7c2d00", face: "linear-gradient(160deg, #fde68a 0%, #fbbf24 50%, #b45309 100%)", glow: "rgba(251,191,36,0.85)", accent: "#fbbf24" },
  { wall: "#003a00", face: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)", glow: "rgba(34,197,94,0.8)", accent: "#22c55e" },
];

// ─── Note chart — Ode to Joy in C major ──────────────────────────────────────
// Piano Tiles principle: the sequence of taps IS the melody. Every tile has
// a lane (visual) AND a freq (the note it plays when tapped). Lanes run
// low-left to high-right so tapping across the screen feels like walking
// up a piano keyboard.
//
// Mapping (diatonic, two notes per lane):
//   lane 0 → C5, D5   (bottom of the scale)
//   lane 1 → E5, F5   (mid-low)
//   lane 2 → G5, A5   (mid-high)
//   lane 3 → B5, C6   (top)
//
// Song: Beethoven's Ode to Joy. Four-bar phrases that repeat with small
// variations, classic verse / bridge / verse / climax shape, all in 4/4 at
// 120 BPM, which slots perfectly into the existing 45s game timeline and
// drum track.
type NoteDef = { id: number; lane: number; time: number; travel: number; freq: number };

// C major scale pitches — Ode to Joy sits between C5 and G5.
const P_C5 = 523.25, P_D5 = 587.33, P_E5 = 659.25, P_F5 = 698.46,
  P_G5 = 783.99;

function buildChart(): NoteDef[] {
  const notes: NoteDef[] = [];
  let id = 0;
  const push = (lane: number, time: number, travel: number, freq: number) =>
    notes.push({ id: id++, lane, time, travel, freq });

  // The full eight-phrase Ode to Joy right-hand melody, C major. Drawn
  // straight from Mantius Cazaubon's beginner piano tutorial:
  //   P1: E E F G G F E D        (8 notes)
  //   P2: C C D E E D D          (7)
  //   P3: E E F G G F E D        (8, same as P1)
  //   P4: C C D E D C C          (7, first resolution on C)
  //   P5: D D E C D E F E C      (9, bridge opens)
  //   P6: D E F E D C D G        (8, bridge closes on G to lift back to P7)
  //   P7: E E F G G F E D        (8, same as P1)
  //   P8: C C D E D C C          (7, final resolution)
  type Pitch = number;
  const P1: Pitch[] = [P_E5, P_E5, P_F5, P_G5, P_G5, P_F5, P_E5, P_D5];
  const P2: Pitch[] = [P_C5, P_C5, P_D5, P_E5, P_E5, P_D5, P_D5];
  const P3: Pitch[] = P1;
  const P4: Pitch[] = [P_C5, P_C5, P_D5, P_E5, P_D5, P_C5, P_C5];
  const P5: Pitch[] = [P_D5, P_D5, P_E5, P_C5, P_D5, P_E5, P_F5, P_E5, P_C5];
  const P6: Pitch[] = [P_D5, P_E5, P_F5, P_E5, P_D5, P_C5, P_D5, P_G5];
  const P7: Pitch[] = P1;
  const P8: Pitch[] = P4;

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

  // Phrase 1 (4.0s → 7.5s): E E F G G F E D
  stamp(P1, 4.0, TRAVEL_INTRO);

  // Phrase 2 (8.0s → 11.0s): C C D E E D D
  stamp(P2, 8.0, TRAVEL_INTRO);

  // Phrase 3 (11.5s → 15.0s): E E F G G F E D
  stamp(P3, 11.5, TRAVEL_VERSE);

  // Phrase 4 (15.5s → 18.5s): C C D E D C C — first resolution
  stamp(P4, 15.5, TRAVEL_VERSE);

  // Phrase 5 (19.0s → 23.0s): D D E C D E F E C — bridge opens
  stamp(P5, 19.0, TRAVEL_VERSE);

  // Phrase 6 (23.5s → 27.0s): D E F E D C D G — bridge closes on the G lift
  stamp(P6, 23.5, TRAVEL_BUILD);

  // Phrase 7 (27.5s → 31.0s): E E F G G F E D — return to the main theme
  stamp(P7, 27.5, TRAVEL_BUILD);

  // Phrase 8 (31.5s → 34.5s): C C D E D C C — final resolution on tonic
  stamp(P8, 31.5, TRAVEL_DROP);

  // ─── RITARDANDO (36.0s → 43.0s): held tonic — the "Freude!" resolution.
  //   The tutorial ends P8 with "C C" held; rhythm games need the timeline
  //   filled, so we lay three more C's at slowing intervals. Still canonical
  //   in spirit: the piece simply holds its tonic to close.
  const holds: number[] = [36.0, 38.0, 40.0, 42.5];
  holds.forEach(t => push(laneFor(P_C5), t, TRAVEL_BUILD, P_C5));

  return notes.sort((a, b) => a.time - b.time);
}

// ─── Grades ────────────────────────────────────────────────────────────────────
function gradeFor(score: number, total: number) {
  const pct = total === 0 ? 0 : score / total;
  if (pct >= 0.92) return { letter: "S", color: "#fbbf24", desc: "PERFECTION" };
  if (pct >= 0.78) return { letter: "A", color: "#e2e8f0", desc: "EXCELLENT" };
  if (pct >= 0.60) return { letter: "B", color: "#67e8f9", desc: "GREAT" };
  if (pct >= 0.40) return { letter: "C", color: "#22c55e", desc: "GOOD" };
  return { letter: "D", color: "#f97316", desc: "KEEP GOING" };
}

// ─── Particle burst — spawned on every hit ───────────────────────────────────
type Burst = { id: number; x: number; y: number; color: string; born: number };

// ─── Page ──────────────────────────────────────────────────────────────────────
type Phase = "idle" | "countdown" | "playing" | "encore" | "finished";

// Encore pool — loops the singable half of Ode to Joy (phrases 1 and 2)
// and the second-half answer (phrases 3 and 4). The player hears the real
// tune cycle underneath the accelerating tile pace.
//   P1 + P2: E E F G G F E D | C C D E E D D
//   P3 + P4: E E F G G F E D | C C D E D C C
// Lane mapping matches buildChart.laneFor:
//   C, D → lane 0   E → lane 1   F → lane 2   G → lane 3
const ENCORE_POOL: [number, number][] = [
  // Phrase 1 — E E F G G F E D
  [1, P_E5], [1, P_E5], [2, P_F5], [3, P_G5],
  [3, P_G5], [2, P_F5], [1, P_E5], [0, P_D5],
  // Phrase 2 — C C D E E D D
  [0, P_C5], [0, P_C5], [0, P_D5], [1, P_E5],
  [1, P_E5], [0, P_D5], [0, P_D5],
  // Phrase 3 — E E F G G F E D (same as P1)
  [1, P_E5], [1, P_E5], [2, P_F5], [3, P_G5],
  [3, P_G5], [2, P_F5], [1, P_E5], [0, P_D5],
  // Phrase 4 — C C D E D C C, resolves on the tonic
  [0, P_C5], [0, P_C5], [0, P_D5], [1, P_E5],
  [0, P_D5], [0, P_C5], [0, P_C5],
];

export default function RhythmGamePage() {
  const router = useRouter();
  const { address } = useAccount();
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

  // Initialize WebAudio context lazily (needs user gesture)
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
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
    scheduledNodesRef.current.push(osc);
  }, []);

  const scheduleHihat = useCallback((ctx: AudioContext, when: number, volume = 0.12) => {
    const v = volume * gainsRef.current.music;
    if (v <= 0) return;
    const bufferSize = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass"; filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(v, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    noise.start(when); noise.stop(when + 0.06);
    scheduledNodesRef.current.push(noise);
  }, []);

  // Schedule the 45-second backing track: a musical C major bassline + hi-hats.
  // Voiced in C major so it consonates with the Ode to Joy melody the player
  // taps out on top. Pitched bass plays the chord roots so a bell on top plus
  // a bass root = full triad in your ear.
  //
  // Sections follow the chart exactly (45s total):
  //   intro   (0–9s)    → hats only → soft C2 pulse starting t=4
  //   verse1  (9–15s)   → I-V-vi-IV classic Ode to Joy progression, beats 1 & 3
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
    // Classic Ode to Joy harmonisation in C major: C G Am F C G.
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
  const [activeNotes, setActiveNotes] = useState<(NoteDef & { spawnedAt: number })[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [comboToast, setComboToast] = useState<string | null>(null);
  const [flashLane, setFlashLane] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ lane: number; type: "perfect" | "good" | "miss"; ts: number } | null>(null);

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

  // Encore refs — drive the unbounded survival mode after the main track
  const encoreMissesRef = useRef(0);                  // 3 = game over
  const encoreNextSpawnRef = useRef(0);                  // wall-clock time for next tile
  const encorePoolIdxRef = useRef(0);                  // rotates through ENCORE_POOL
  const encoreIdRef = useRef(100000);             // high id base to avoid clashes
  const encoreLoopAtRef = useRef(0);                  // next audio loop reschedule time
  const [encoreLives, setEncoreLives] = useState(3);     // UI display

  // ─── Ambient starfield — same cosmic arcade vibe as Simon ────────────────
  // Client-only via useEffect to avoid SSR hydration mismatches from Math.random
  type Star = { x: number; y: number; size: number; delay: number; dur: number; alpha: number };
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
  const mainTrackStatsRef = useRef<{ misses: number; goods: number }>({ misses: 0, goods: 0 });

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
    mainTrackStatsRef.current = { misses: 0, goods: 0 };
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
    setScore(0); setCombo(0); setMaxCombo(0);
    setHits({ perfect: 0, good: 0, miss: 0 });
    setTimeLeft(TRACK_DURATION);
    setActiveNotes([]);
    setBursts([]);
    setComboToast(null);
    setFlashLane(null);
    setFeedback(null);
  }, []);

  // Countdown → playing
  const startGame = () => {
    reset();
    // Reset submission bookkeeping — a fresh run is a fresh submit
    submittedRef.current = false;
    setSubmitResult(null);
    setSubmitError(null);
    setPhase("countdown");
    setCountdown(3);
    // Warm up audio context (needs user gesture, so do it on START tap)
    getAudioCtx();
  };
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      // GO! — bright higher-octave bell to signal play starts
      playBell(783.99, 0.28);  // G5
      startRef.current = performance.now();
      gameStartMsRef.current = Date.now();  // wall-clock start for gameTime calculation
      setPhase("playing");
      // Schedule the full 30-second drum track aligned to the audio clock.
      // Same zero-point as startRef means tiles and drums share one timeline.
      const ctx = getAudioCtx();
      if (ctx) scheduleDrumTrack(ctx.currentTime);
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
    submittedRef.current = true;

    const gameTime = Math.max(5000, Date.now() - gameStartMsRef.current);
    // Clamp to the backend's global upper bound (1M). Uncapped scoring is fine
    // because the submission path requires two independent auth factors (internal
    // secret + Privy/MiniPay verification) before a voucher is signed.
    const scoreToSubmit = Math.min(1_000_000, Math.max(0, Math.round(score)));

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
          | { success: true; signature: string; nonce: string; gameType: number }
          | { success: false; error: string };
        let authToken: string | null = null;
        let miniPayMsg: string | null = null;
        let miniPaySig: string | null = null;

        if (isMiniPay) {
          miniPayMsg = `GameArena|rhythm|${scoreToSubmit}|${Date.now()}`;
          miniPaySig = await signMessageAsync({ message: miniPayMsg });
          sig = await signScoreMiniPay(address, miniPaySig, miniPayMsg, {
            game: "rhythm", score: scoreToSubmit,
          });
        } else {
          authToken = await getAccessToken();
          if (!authToken) {
            setSubmitError("Not signed in — score not recorded");
            return;
          }
          sig = await signScore(authToken, address, {
            game: "rhythm", score: scoreToSubmit,
          });
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
          const isGasOrFunds =
            name === "InsufficientFundsError" || name === "EstimateGasExecutionError" ||
            code === -32000 || code === -32010 || causeCode === "insufficient_funds" ||
            msg.includes("insufficient funds") || msg.includes("insufficient balance") ||
            msg.includes("gas limit") || msg.includes("exceeds gas");
          if (isRejected) setTxError("Transaction rejected — score not saved");
          else if (isGasOrFunds) setTxError("Insufficient CELO for gas — top up and try again");
          else setTxError("Transaction failed — score not saved");
          return;  // BAIL: don't call submitScore, nothing is saved anywhere
        } finally {
          setSigningOnChain(false);
        }

        // ── STEP 3: save off-chain (Supabase + XP + achievements + rank) ──
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
          // Trigger the full-screen LEVEL UP toast immediately when the
          // result lands. Slight delay so the finished-card scaleIn lands
          // first; the toast then overlays it as a hero moment, with its
          // own arpeggio (handled inside LevelUpToast).
          if (result.leveledUp && typeof result.level === "number") {
            const lv = result.level;
            setTimeout(() => setLevelUpToastLevel(lv), 700);
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

    const type: "perfect" | "good" = diff <= PERFECT_WINDOW ? "perfect" : "good";

    // ═══ SCORING — uncapped by design ═══
    // Multiplier grows with combo FOREVER (no cap). 50 combo = 11×, 100 combo = 21×.
    const multiplier = 1 + Math.floor(combo / 5);

    // Precision bonus: exact-on-beat = up to +8, edge of good window = +0.
    // Means two "all perfect" runs never score identically — tighter timing wins.
    const precision = Math.max(0, 1 - diff / GOOD_WINDOW);
    const precisionBonus = Math.round(precision * 8);
    const basePoints = type === "perfect" ? 10 : 5;
    const gained = (basePoints + precisionBonus) * multiplier;

    // Audio + haptic feedback — play THIS tile's own melody pitch (Piano Tiles style)
    playHitForNote(note.freq, type);
    haptic(type === "perfect" ? 12 : 8);

    setScore(s => s + gained);
    setCombo(c => {
      const next = c + 1;
      if (next > maxCombo) setMaxCombo(next);
      // Combo milestone toast
      if (next === 5) setComboToast("WARMED UP!");
      if (next === 10) setComboToast("ON FIRE 🔥");
      if (next === 15) setComboToast("UNSTOPPABLE!");
      if (next === 25) setComboToast("GOD MODE!");
      if ([5, 10, 15, 25].includes(next)) setTimeout(() => setComboToast(null), 1200);
      return next;
    });
    setHits(h => ({ ...h, [type]: h[type] + 1 }));
    setFeedback({ lane, type, ts: performance.now() });

    // Spawn particles
    const laneWidth = 100 / LANES.length;
    const xPct = laneWidth * lane + laneWidth / 2;
    const color = LANES[lane].accent;
    setBursts(bs => [...bs, { id: burstIdRef.current++, x: xPct, y: 90, color: type === "perfect" ? "#fbbf24" : color, born: performance.now() }]);

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
        mainTrackStatsRef.current = { misses: h.miss, goods: h.good };
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
    let lastVisibleSig = "";             // setActiveNotes only when id set changes (canvas draws tiles, React just mirrors state)
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
          mainTrackStatsRef.current = { misses: h.miss, goods: h.good };
          return h;
        });
        setPhase("finished");
        return;
      }
      lastWall = wall;

      const now = (wall - startRef.current) / 1000;
      if (phase === "playing") {
        const sec = Math.ceil(TRACK_DURATION - now);
        if (sec !== lastTimerSecond) {
          lastTimerSecond = sec;
          setTimeLeft(Math.max(0, TRACK_DURATION - now));
        }
      }

      // ── Encore: spawn new tiles dynamically, accelerating over time ──
      if (phase === "encore" && now >= encoreNextSpawnRef.current) {
        const encoreElapsed = now - TRACK_DURATION;
        // Travel time shrinks from 1.4s → 0.7s over 30s of encore (skill ceiling rises)
        const travel = Math.max(0.7, 1.4 - encoreElapsed * 0.023);
        // Spawn gap shrinks from 0.55s → 0.22s (tiles pack tighter)
        const nextGap = Math.max(0.22, 0.55 - encoreElapsed * 0.011);

        const [lane, freq] = ENCORE_POOL[encorePoolIdxRef.current % ENCORE_POOL.length];
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
      // components/rhythm/NoteCanvas.tsx. We still call setActiveNotes
      // (with a sig-compare skip) so any React-side consumer of
      // activeNotes stays consistent, but the TILES THEMSELVES are
      // no longer rendered from that state.
      canvasHandleRef.current?.draw(visible, now);

      const sig = visible.map(v => v.id).join(",");
      if (sig !== lastVisibleSig) {
        lastVisibleSig = sig;
        setActiveNotes(visible);
      }

      // Flag misses: notes that passed the good window without being hit
      for (const n of chartRef.current) {
        if (now > n.time + GOOD_WINDOW && !missedRef.current.has(n.id)) {
          missedRef.current.add(n.id);
          setCombo(0);
          setHits(h => ({ ...h, miss: h.miss + 1 }));
          setFeedback({ lane: n.lane, type: "miss", ts: performance.now() });
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
          mainTrackStatsRef.current = { misses: h.miss, goods: h.good };
          return h;
        });
        if (combo > 0) {
          setPhase("encore");
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

  const totalNotes = chartRef.current.length || buildChart().length;
  const maxScore = 10 * 5 * totalNotes; // perfect + max multiplier per note
  const grade = gradeFor(score, maxScore);

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
      {/* Starfield — 44 twinkling points, ambient depth behind the game */}
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

      {/* Splash icons — ambient texture at low opacity. We pause the
          float animation while a run is active (playing/encore) — the
          tiles ARE the animation, and 6+ infinite drop-shadow + transform
          keyframes running in parallel cooked low-end phones. Idle and
          finished phases still bob. */}
      {BG_ICONS.map((ic, i) => (
        <div key={i} className={phase === "playing" || phase === "encore" ? "" : "icon-float"} style={{
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

      {/* Magenta tint wash — intensifies as the track progresses, adds tension */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 45% 35% at 50% 55%, rgba(232,121,249,${Math.min(0.28, 0.08 + (TRACK_DURATION - timeLeft) / TRACK_DURATION * 0.25)}) 0%, transparent 70%)`,
        pointerEvents: "none", zIndex: 1,
      }} />

      {/* ═══ IDLE ═══ */}
      {phase === "idle" && <IdleView onStart={startGame} onExit={() => router.push("/games")} />}

      {/* ═══ COUNTDOWN ═══ */}
      {phase === "countdown" && <CountdownView n={countdown} />}

      {/* ═══ PLAYING + ENCORE (same view, different HUD treatment) ═══ */}
      {(phase === "playing" || phase === "encore") && (
        <PlayingView
          score={score} combo={combo} timeLeft={timeLeft}
          activeNotes={activeNotes} bursts={bursts}
          comboToast={comboToast} flashLane={flashLane} feedback={feedback}
          onTapLane={hitLane}
          // QUIT ends the run with the current score. Transitions to "finished"
          // which triggers the normal submit flow — player sees their grade
          // and whatever XP/achievements they earned.
          onQuit={() => {
            // Snapshot main-track stats if they quit before reaching the end,
            // so FC/AP flags stay accurate (they quit → they didn't FC).
            if (phase === "playing") {
              mainTrackStatsRef.current = { misses: hits.miss + 1, goods: hits.good };
            }
            setPhase("finished");
          }}
          startRef={startRef}
          canvasHandleRef={canvasHandleRef}
          pet={pet}
          isEncore={phase === "encore"}
          encoreLives={encoreLives}
        />
      )}

      {/* ═══ FINISHED ═══ */}
      {phase === "finished" && (
        <FinishedView
          grade={grade}
          score={score} maxCombo={maxCombo} hits={hits}
          total={totalNotes}
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

// ─── Idle: "GET READY" splash before game starts ──────────────────────────────
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
  score, combo, timeLeft, activeNotes, bursts,
  comboToast, flashLane, feedback,
  onTapLane, onQuit, startRef, canvasHandleRef,
  pet,
  isEncore, encoreLives,
}: {
  score: number; combo: number; timeLeft: number;
  activeNotes: (NoteDef & { spawnedAt: number })[]; bursts: Burst[];
  comboToast: string | null; flashLane: number | null;
  feedback: { lane: number; type: "perfect" | "good" | "miss"; ts: number } | null;
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
}) {
  const timePct = 1 - timeLeft / TRACK_DURATION;
  // Multiplier is uncapped now — display 5× as max to avoid HUD overflow but score uses real value
  const multiplier = 1 + Math.floor(combo / 5);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", flexDirection: "column" }}>

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
        <StatGem label="MULT" value={`×${multiplier}`} color="#67e8f9" wall="#083a6b" />
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
function Lane({ theme, laneIdx: _laneIdx, flashing, feedback }: { theme: LaneTheme; laneIdx: number; flashing: boolean; feedback: { type: "perfect" | "good" | "miss"; ts: number } | null }) {
  const feedbackLabel = feedback ? (feedback.type === "perfect" ? "PERFECT!" : feedback.type === "good" ? "GOOD" : "MISS") : null;
  const feedbackColor = feedback?.type === "perfect" ? "#fbbf24" : feedback?.type === "good" ? theme.accent : "#ef4444";
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
        }}>{feedbackLabel}</div>
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
  grade, score, maxCombo, hits, total,
  onPlayAgain, onExit,
  submitting, signingOnChain, submitResult, submitError, txError,
}: {
  grade: ReturnType<typeof gradeFor>;
  score: number; maxCombo: number;
  hits: { perfect: number; good: number; miss: number };
  total: number;
  onPlayAgain: () => void;
  onExit: () => void;
  submitting: boolean;
  signingOnChain: boolean;
  submitResult: FinishedSubmit | null;
  submitError: string | null;
  txError: string | null;
}) {
  const accuracy = total === 0 ? 0 : Math.round(((hits.perfect + hits.good * 0.5) / total) * 100);
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 15,
      background: "rgba(4,0,20,0.82)", backdropFilter: "blur(10px)",
      display: "flex",
      // Outer overlay must scroll when the finished modal is taller than
      // the viewport. On mobile, grade badge + score + 4 stat gems + PB
      // banner + achievements list pushes Play Again / Exit buttons below
      // the fold, and the card's own overflow:hidden made them unreachable.
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
          {/* Top gloss */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "100px",
            background: "linear-gradient(180deg, rgba(200,160,255,0.16) 0%, transparent 100%)",
            pointerEvents: "none",
          }} />

          {/* Confetti around grade */}
          {[...Array(6)].map((_, i) => {
            const angle = (i / 6) * Math.PI * 2;
            return (
              <span key={i} style={{
                position: "absolute",
                top: "25%", left: "50%",
                fontSize: "14px", color: grade.color,
                filter: `drop-shadow(0 0 8px ${grade.color})`,
                transform: `translate(${Math.cos(angle) * 90 - 50}%, ${Math.sin(angle) * 90 - 50}%)`,
                animation: `pet-sparkle ${2.4 + i * 0.2}s ease-in-out ${i * 0.3}s infinite`,
              }}>✦</span>
            );
          })}

          {/* Grade letter */}
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "11px", fontWeight: 900, letterSpacing: "0.2em", marginBottom: "8px" }}>
              {grade.desc}
            </div>
            <div style={{
              width: "140px", height: "140px", margin: "0 auto",
              borderRadius: "50%", padding: "5px",
              background: `conic-gradient(from 0deg, ${grade.color}, ${grade.color}aa, ${grade.color})`,
              boxShadow: `0 0 40px ${grade.color}88, 0 0 80px ${grade.color}44`,
            }}>
              <div style={{
                width: "100%", height: "100%", borderRadius: "50%",
                background: "linear-gradient(180deg, #13063a 0%, #07021a 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{
                  fontSize: "88px", fontWeight: 900, color: grade.color,
                  textShadow: `0 0 28px ${grade.color}, 0 4px 8px rgba(0,0,0,0.7)`,
                  lineHeight: 1,
                }}>{grade.letter}</span>
              </div>
            </div>
          </div>

          {/* Score */}
          <div style={{ marginTop: "20px" }}>
            <div style={{ color: "rgba(200,180,255,0.6)", fontSize: "10px", fontWeight: 900, letterSpacing: "0.2em" }}>SCORE</div>
            <div style={{
              color: "#fbbf24", fontSize: "42px", fontWeight: 900,
              textShadow: "0 0 20px rgba(251,191,36,0.8), 0 2px 6px rgba(0,0,0,0.6)",
              lineHeight: 1, marginTop: "3px",
            }}>{score}</div>
          </div>

          {/* Hits breakdown */}
          <div style={{
            marginTop: "20px",
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px",
          }}>
            <MiniStat label="PERFECT" value={hits.perfect} color="#fbbf24" />
            <MiniStat label="GOOD" value={hits.good} color="#e879f9" />
            <MiniStat label="MISS" value={hits.miss} color="#ef4444" />
            <MiniStat label="MAX×" value={maxCombo} color="#22c55e" />
          </div>

          {/* Accuracy bar */}
          <div style={{ marginTop: "16px" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", marginBottom: "4px",
              color: "rgba(200,180,255,0.65)", fontSize: "9px", fontWeight: 900, letterSpacing: "0.12em",
            }}>
              <span>ACCURACY</span>
              <span style={{ color: "#fbbf24" }}>{accuracy}%</span>
            </div>
            <div style={{
              height: "8px", borderRadius: "999px",
              background: "rgba(0,0,0,0.5)", overflow: "hidden",
              border: "1px solid rgba(167,139,250,0.18)",
            }}>
              <div style={{
                width: `${accuracy}%`, height: "100%", borderRadius: "999px",
                background: "linear-gradient(90deg, #c026d3 0%, #e879f9 50%, #fbbf24 100%)",
                boxShadow: "0 0 8px rgba(232,121,249,0.6)",
              }} />
            </div>
          </div>

          {/* Reward panel — rank, XP, level-up, new achievements */}
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
            <JuicyBtn label="PLAY AGAIN" wall="#7c1d5a"
              face="linear-gradient(160deg, #f5a3ef 0%, #e879f9 50%, #c026d3 100%)"
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

  // On-chain rejection — own red style with a hint to retry
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
