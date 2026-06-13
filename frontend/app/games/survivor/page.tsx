"use client";

// ─── SLIME SURVIVOR ───────────────────────────────────────────────────────────
// 60-second survival run. You play AS your pet slime — the same pet that
// evolves with your level, finally on the field instead of cheering from
// the sidelines. Collect coins, dodge spikes, survive the full minute.
//
// STEP 1 of the build plan: core game loop, fully playable, free-play
// (no wallet needed — same philosophy as Rhythm/Simon free play).
// Steps 2-5 (upgrades between runs, leaderboard submit via GamePass,
// G$ ranked entry via SoloWager, daily ranked limit) layer on top of
// this loop without changing it.
//
// Rendering follows the proven Rhythm Rush architecture: one <canvas>
// drawn imperatively from a RAF loop, React only for HUD/screens. No
// game objects in React state — refs everywhere, throttled HUD sync.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { petForLevel, PET_STAGES } from "@/lib/pets";
import {
  UPGRADES, type UpgradeId, type UpgradeLevels, type UpgradeEffects,
  loadCoins, saveCoins, loadLevels, saveLevels, effectsFor, nextCost, maxLevel,
} from "@/lib/survivorUpgrades";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// ─── Tuning ──────────────────────────────────────────────────────────────────
const RUN_SECONDS = 60;
const HEARTS = 3;
const PLAYER_R = 26;            // collision radius (px)
const COIN_R = 13;
const SPIKE_R = 16;
const GEM_R = 15;
const INVULN_MS = 1200;         // post-hit mercy window
const BASE_FALL = 170;          // px/sec at t=0
const FALL_RAMP = 3.2;          // extra px/sec per second elapsed
const BASE_SPAWN_GAP = 0.55;    // sec between spawns at t=0
const MIN_SPAWN_GAP = 0.22;
const SPIKE_CHANCE_START = 0.22;
const SPIKE_CHANCE_END = 0.42;  // ramps to this by t=60
const GEM_CHANCE = 0.06;        // rare, worth 5 coins

type Phase = "idle" | "countdown" | "playing" | "finished" | "shop";
type Drop = { id: number; kind: "coin" | "spike" | "gem"; x: number; y: number; r: number; spin: number };
type Burst = { x: number; y: number; color: string; born: number };

export default function SlimeSurvivorPage() {
  const router = useRouter();
  const { address } = useAccount();

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [hearts, setHearts] = useState(HEARTS);
  const [timeLeft, setTimeLeft] = useState(RUN_SECONDS);
  const [coinsGot, setCoinsGot] = useState(0);
  const [survived, setSurvived] = useState(false);
  const [localBest, setLocalBest] = useState(0);

  // ─── Upgrade economy (step 2) ─────────────────────────────────────────────
  // coinBank = persistent currency across runs; levels = owned upgrades.
  // Effects derived from levels feed the loop via refs (see startGame).
  const [coinBank, setCoinBank] = useState(0);
  const [levels, setLevels] = useState<UpgradeLevels>({ heart: 0, magnet: 0, shield: 0, value: 0 });
  const [lastEarned, setLastEarned] = useState(0);     // coins banked from the run just finished
  const effectsRef = useRef<UpgradeEffects>(effectsFor({ heart: 0, magnet: 0, shield: 0, value: 0 }, HEARTS));
  const shieldRef = useRef(0);                          // remaining shield charges this run
  const [shieldLeft, setShieldLeft] = useState(0);     // HUD mirror
  const [runMaxHearts, setRunMaxHearts] = useState(HEARTS); // hearts at run start (for HUD)
  useEffect(() => {
    setCoinBank(loadCoins());
    setLevels(loadLevels());
  }, []);

  // Pet = player character. Guests run as the egg — visible incentive to
  // sign in and level ("evolve your runner").
  const [playerLevel, setPlayerLevel] = useState(1);
  useEffect(() => {
    if (!address) return;
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.json())
      .then(d => setPlayerLevel(d.level || 1))
      .catch(() => {});
  }, [address]);
  const pet = petForLevel(playerLevel);

  // ─── Refs (the actual game state — never causes re-renders) ───────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const playerXRef = useRef(0.5);       // 0..1 across the width
  const targetXRef = useRef(0.5);
  const dropsRef = useRef<Drop[]>([]);
  const burstsRef = useRef<Burst[]>([]);
  const nextSpawnRef = useRef(0);
  const dropIdRef = useRef(1);
  const heartsRef = useRef(HEARTS);
  const scoreRef = useRef(0);
  const streakRef = useRef(0);
  const bestStreakRef = useRef(0);
  const coinsRef = useRef(0);
  const invulnUntilRef = useRef(0);
  const keysRef = useRef({ left: false, right: false });
  const petImgRef = useRef<HTMLImageElement | null>(null);

  // Preload all pet sprites once — evolution skins swap without a hitch.
  useEffect(() => {
    PET_STAGES.forEach(s => { const i = new Image(); i.src = s.src; });
  }, []);
  useEffect(() => {
    const img = new Image();
    img.src = pet.src;
    img.onload = () => { petImgRef.current = img; };
  }, [pet.src]);

  useEffect(() => {
    setLocalBest(Number(localStorage.getItem("survivor_best") || 0));
  }, []);

  // ─── Audio — tiny synth blips, same getAudioCtx pattern as Rhythm ─────────
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

  // ─── Canvas sizing ─────────────────────────────────────────────────────────
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

  // ─── Input: pointer drag + keyboard ───────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    const onPointer = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      targetXRef.current = Math.max(0.04, Math.min(0.96, (e.clientX - rect.left) / rect.width));
    };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") { keysRef.current.left = down; e.preventDefault(); }
      if (e.key === "ArrowRight" || e.key === "d") { keysRef.current.right = down; e.preventDefault(); }
    };
    const kd = onKey(true), ku = onKey(false);
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [phase]);

  // ─── Start / countdown ─────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    // Snapshot upgrade effects for this run from the latest owned levels.
    const eff = effectsFor(loadLevels(), HEARTS);
    effectsRef.current = eff;
    dropsRef.current = [];
    burstsRef.current = [];
    playerXRef.current = 0.5;
    targetXRef.current = 0.5;
    heartsRef.current = eff.startHearts;
    shieldRef.current = eff.shieldCharges;
    scoreRef.current = 0;
    streakRef.current = 0;
    bestStreakRef.current = 0;
    coinsRef.current = 0;
    invulnUntilRef.current = 0;
    nextSpawnRef.current = 0;
    setScore(0); setStreak(0); setBestStreak(0);
    setHearts(eff.startHearts); setRunMaxHearts(eff.startHearts);
    setShieldLeft(eff.shieldCharges);
    setTimeLeft(RUN_SECONDS); setCoinsGot(0);
    setSurvived(false);
    getAudioCtx(); // unlock audio on user gesture
    setCountdown(3);
    setPhase("countdown");
  }, [getAudioCtx]);

  // Buy the next level of an upgrade if the bank can afford it.
  const buyUpgrade = useCallback((id: UpgradeId) => {
    const cur = levels[id];
    const cost = nextCost(id, cur);
    if (cost === null) return;                          // maxed
    if (coinBank < cost) { blip(180, 0.18, 0.18, "sawtooth"); return; }
    const nextLevels = { ...levels, [id]: cur + 1 };
    const nextBank = coinBank - cost;
    setLevels(nextLevels); saveLevels(nextLevels);
    setCoinBank(nextBank); saveCoins(nextBank);
    blip(880, 0.12, 0.2); setTimeout(() => blip(1175, 0.16, 0.2), 90);
    haptic([12, 30, 12]);
  }, [levels, coinBank, blip, haptic]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      blip(784, 0.2, 0.2);
      startRef.current = performance.now();
      setPhase("playing");
      return;
    }
    blip(523, 0.15, 0.18);
    const t = setTimeout(() => setCountdown(c => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown, blip]);

  // ─── Game loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    let lastWall = performance.now();
    let lastHudSecond = -1;

    const finish = (didSurvive: boolean) => {
      setSurvived(didSurvive);
      setBestStreak(bestStreakRef.current);
      const finalScore = scoreRef.current;
      setLocalBest(prev => {
        const best = Math.max(prev, finalScore);
        localStorage.setItem("survivor_best", String(best));
        return best;
      });
      // Bank the coins caught this run (survival bonus: +50% if you made it).
      const earned = Math.round(coinsRef.current * (didSurvive ? 1.5 : 1));
      setLastEarned(earned);
      setCoinBank(prev => { const next = prev + earned; saveCoins(next); return next; });
      setPhase("finished");
      if (didSurvive) { blip(660, 0.3, 0.2); setTimeout(() => blip(880, 0.4, 0.2), 150); }
      else { blip(130, 0.5, 0.22, "sawtooth"); }
      haptic(didSurvive ? [30, 60, 90] : [60, 40, 120]);
    };

    const tick = () => {
      const wall = performance.now();
      const dt = Math.min(0.05, (wall - lastWall) / 1000); // clamp tab-switch jumps
      lastWall = wall;
      const elapsed = (wall - startRef.current) / 1000;
      const remaining = RUN_SECONDS - elapsed;
      const { w, h } = sizeRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx || w === 0) { rafRef.current = requestAnimationFrame(tick); return; }

      // Survived the minute!
      if (remaining <= 0) { finish(true); return; }

      // HUD timer — update once per second, not per frame
      const sec = Math.ceil(remaining);
      if (sec !== lastHudSecond) { lastHudSecond = sec; setTimeLeft(sec); }

      // ── Move player ──
      if (keysRef.current.left)  targetXRef.current = Math.max(0.04, targetXRef.current - 1.4 * dt);
      if (keysRef.current.right) targetXRef.current = Math.min(0.96, targetXRef.current + 1.4 * dt);
      // Critically-damped chase: fast but never jittery
      playerXRef.current += (targetXRef.current - playerXRef.current) * Math.min(1, 14 * dt);
      const px = playerXRef.current * w;
      const py = h - 74;

      // ── Spawn drops ──
      if (elapsed >= nextSpawnRef.current) {
        const t01 = elapsed / RUN_SECONDS;
        const spikeChance = SPIKE_CHANCE_START + (SPIKE_CHANCE_END - SPIKE_CHANCE_START) * t01;
        const roll = Math.random();
        const kind: Drop["kind"] = roll < GEM_CHANCE ? "gem" : roll < GEM_CHANCE + spikeChance ? "spike" : "coin";
        dropsRef.current.push({
          id: dropIdRef.current++,
          kind,
          x: (0.06 + Math.random() * 0.88) * w,
          y: -24,
          r: kind === "coin" ? COIN_R : kind === "gem" ? GEM_R : SPIKE_R,
          spin: Math.random() * Math.PI * 2,
        });
        const gap = Math.max(MIN_SPAWN_GAP, BASE_SPAWN_GAP - elapsed * 0.0055);
        nextSpawnRef.current = elapsed + gap;
      }

      // ── Move drops + collisions ──
      const fall = BASE_FALL + elapsed * FALL_RAMP;
      const invuln = wall < invulnUntilRef.current;
      const eff = effectsRef.current;
      const kept: Drop[] = [];
      for (const d of dropsRef.current) {
        d.y += fall * dt * (d.kind === "spike" ? 1.12 : 1);
        d.spin += dt * 3;
        // Magnet upgrade: coins/gems in range slide horizontally toward the
        // player. Spikes are never pulled (that would be cruel).
        if (eff.magnetRange > 0 && d.kind !== "spike") {
          const adx = d.x - px, ady = d.y - py;
          if (adx * adx + ady * ady < eff.magnetRange * eff.magnetRange) {
            d.x += (px - d.x) * Math.min(1, 6 * dt);
          }
        }
        const dx = d.x - px, dy = d.y - py;
        const hit = dx * dx + dy * dy < (d.r + PLAYER_R) * (d.r + PLAYER_R);
        if (hit) {
          if (d.kind === "spike") {
            if (!invuln) {
              // Shield upgrade absorbs the hit first — no heart lost, but
              // the streak still breaks and the mercy window still triggers.
              if (shieldRef.current > 0) {
                shieldRef.current -= 1;
                setShieldLeft(shieldRef.current);
                invulnUntilRef.current = wall + INVULN_MS;
                streakRef.current = 0; setStreak(0);
                blip(420, 0.18, 0.2, "sine");
                haptic(30);
                burstsRef.current.push({ x: d.x, y: d.y, color: "#38bdf8", born: wall });
              } else {
                heartsRef.current -= 1;
                streakRef.current = 0;
                invulnUntilRef.current = wall + INVULN_MS;
                setHearts(heartsRef.current);
                setStreak(0);
                blip(150, 0.25, 0.22, "sawtooth");
                haptic(60);
                burstsRef.current.push({ x: d.x, y: d.y, color: "#ef4444", born: wall });
                if (heartsRef.current <= 0) { finish(false); return; }
              }
            }
            continue; // spike consumed either way
          }
          // coin / gem
          const newStreak = streakRef.current + 1;
          streakRef.current = newStreak;
          if (newStreak > bestStreakRef.current) bestStreakRef.current = newStreak;
          const streakMult = 1 + Math.floor(newStreak / 10);   // every 10-coin streak = +1x
          const base = d.kind === "gem" ? 50 : 10;
          // Golden Touch upgrade scales score (not the coin bank count, so
          // the economy stays honest — you bank coins caught, not points).
          scoreRef.current += Math.round(base * streakMult * eff.coinMultiplier);
          coinsRef.current += d.kind === "gem" ? 5 : 1;       // gems bank as 5 coins
          setScore(scoreRef.current);
          setStreak(newStreak);
          setCoinsGot(coinsRef.current);
          blip(d.kind === "gem" ? 1046 : 740 + Math.min(newStreak, 12) * 18, 0.07, 0.13);
          haptic(d.kind === "gem" ? 16 : 8);
          burstsRef.current.push({ x: d.x, y: d.y, color: d.kind === "gem" ? "#86efac" : "#fbbf24", born: wall });
          continue;
        }
        if (d.y < h + 40) kept.push(d);
        else if (d.kind !== "spike") {
          // Missed a coin — streak breaks. Spikes exiting is good news.
          if (streakRef.current > 0) { streakRef.current = 0; setStreak(0); }
        }
      }
      dropsRef.current = kept;
      burstsRef.current = burstsRef.current.filter(b => wall - b.born < 450);

      // ── Draw ──
      ctx.clearRect(0, 0, w, h);

      // ground glow
      const ground = ctx.createLinearGradient(0, h - 56, 0, h);
      ground.addColorStop(0, "rgba(167,139,250,0)");
      ground.addColorStop(1, "rgba(167,139,250,0.18)");
      ctx.fillStyle = ground;
      ctx.fillRect(0, h - 56, w, 56);

      // drops
      for (const d of dropsRef.current) {
        if (d.kind === "coin" || d.kind === "gem") {
          const gold = d.kind === "coin";
          ctx.save();
          ctx.translate(d.x, d.y);
          // spin = horizontal squash, sells a 3D flip without 3D
          ctx.scale(Math.abs(Math.cos(d.spin)) * 0.65 + 0.35, 1);
          ctx.fillStyle = gold ? "#92610a" : "#14532d";
          ctx.beginPath(); ctx.arc(0, 2, d.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = gold ? "#fbbf24" : "#4ade80";
          ctx.beginPath(); ctx.arc(0, 0, d.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.65)";
          ctx.beginPath(); ctx.ellipse(-d.r * 0.3, -d.r * 0.35, d.r * 0.3, d.r * 0.18, -0.6, 0, Math.PI * 2); ctx.fill();
          if (!gold) {
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.font = `900 ${d.r}px monospace`;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("G", 0, 1);
          }
          ctx.restore();
        } else {
          // spike ball
          ctx.save();
          ctx.translate(d.x, d.y);
          ctx.rotate(d.spin);
          ctx.fillStyle = "#7f1d1d";
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * d.r * 1.45, Math.sin(a) * d.r * 1.45);
            ctx.lineTo(Math.cos(a + 0.32) * d.r * 0.8, Math.sin(a + 0.32) * d.r * 0.8);
            ctx.lineTo(Math.cos(a - 0.32) * d.r * 0.8, Math.sin(a - 0.32) * d.r * 0.8);
            ctx.closePath(); ctx.fill();
          }
          ctx.fillStyle = "#dc2626";
          ctx.beginPath(); ctx.arc(0, 0, d.r * 0.85, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.beginPath(); ctx.ellipse(-d.r * 0.25, -d.r * 0.3, d.r * 0.28, d.r * 0.16, -0.6, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      // bursts
      for (const b of burstsRef.current) {
        const age = (wall - b.born) / 450;
        ctx.save();
        ctx.globalAlpha = 1 - age;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(b.x, b.y, 10 + age * 26, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      // player (pet sprite, blinking during invulnerability)
      const blink = invuln && Math.floor(wall / 110) % 2 === 0;
      if (!blink) {
        const img = petImgRef.current;
        const size = PLAYER_R * 2.6;
        // soft shadow
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.ellipse(px, py + PLAYER_R + 8, PLAYER_R * 1.1, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (img) {
          // squash-and-stretch lean into movement direction
          const lean = (targetXRef.current - playerXRef.current) * 1.6;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.max(-0.22, Math.min(0.22, lean)));
          ctx.drawImage(img, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else {
          ctx.fillStyle = pet.color;
          ctx.beginPath(); ctx.arc(px, py, PLAYER_R, 0, Math.PI * 2); ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, blip, haptic, pet.color]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, height: "100dvh",
      background: "linear-gradient(180deg, #1e0762 0%, #12044a 55%, #0a0228 100%)",
      overflow: "hidden", touchAction: "none", userSelect: "none",
      fontFamily: "inherit",
    }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

      {/* HUD */}
      {(phase === "playing" || phase === "countdown") && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          padding: "max(12px, env(safe-area-inset-top)) 16px 0",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          pointerEvents: "none",
        }}>
          <div>
            <div style={{ color: "rgba(220,200,255,0.6)", fontSize: 9, fontWeight: 900, letterSpacing: "0.2em" }}>SCORE</div>
            <div style={{ color: "#fbbf24", fontSize: 32, fontWeight: 900, lineHeight: 1, textShadow: "0 0 16px rgba(251,191,36,0.6)" }}>{score}</div>
            {streak >= 5 && (
              <div style={{ color: "#f0abfc", fontSize: 11, fontWeight: 900, marginTop: 2, textShadow: "0 0 10px rgba(232,121,249,0.7)" }}>
                {streak} STREAK {streak >= 10 ? `· ${1 + Math.floor(streak / 10)}×` : ""}
              </div>
            )}
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{
              color: timeLeft <= 10 ? "#ef4444" : "white",
              fontSize: 26, fontWeight: 900, fontFamily: "monospace",
              textShadow: timeLeft <= 10 ? "0 0 14px rgba(239,68,68,0.8)" : "0 0 10px rgba(255,255,255,0.4)",
            }}>{timeLeft}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {Array.from({ length: runMaxHearts }).map((_, i) => (
                <span key={i} style={{
                  fontSize: 20,
                  filter: i < hearts ? "drop-shadow(0 0 6px rgba(239,68,68,0.8))" : "grayscale(1) brightness(0.4)",
                  transition: "filter 0.2s",
                }}>❤️</span>
              ))}
            </div>
            {shieldLeft > 0 && (
              <div style={{ display: "flex", gap: 3 }}>
                {Array.from({ length: shieldLeft }).map((_, i) => (
                  <span key={i} style={{ fontSize: 14, filter: "drop-shadow(0 0 5px rgba(56,189,248,0.8))" }}>🛡️</span>
                ))}
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

      {/* IDLE */}
      {phase === "idle" && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 26, padding: 24, textAlign: "center",
        }}>
          <button onClick={() => router.push("/games")} aria-label="Back" style={{
            position: "absolute", top: 18, left: 18, width: 40, height: 40,
            borderRadius: 12, border: "none", cursor: "pointer",
            background: "linear-gradient(160deg, #ff6060, #b00000)",
            color: "white", fontSize: 16, fontWeight: 900,
            boxShadow: "0 8px 16px -4px rgba(200,0,0,0.55)",
          }}>✕</button>

          {/* Coin bank — your upgrade currency, always visible top-right */}
          <CoinBankChip coins={coinBank} />

          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.4em", color: "rgba(232,121,249,0.7)", textShadow: "0 0 14px rgba(232,121,249,0.7)" }}>GAME ARENA</div>
            <div style={{ fontSize: "clamp(34px, 8vw, 60px)", fontWeight: 900, color: "white", marginTop: 6, lineHeight: 1.05, textShadow: "0 0 24px rgba(232,121,249,0.9)" }}>
              SLIME<br />SURVIVOR
            </div>
          </div>

          {/* Your runner */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pet.src} alt={pet.name} width={1024} height={1024} style={{
              width: 86, height: 86, objectFit: "contain",
              filter: `drop-shadow(0 0 18px ${pet.color})`,
              animation: "float-gentle 2.6s ease-in-out infinite",
            }} />
            <div style={{ color: pet.color, fontSize: 11, fontWeight: 900, letterSpacing: "0.12em" }}>
              YOUR RUNNER: {pet.name.toUpperCase()}
            </div>
            {!address && (
              <div style={{ color: "rgba(220,200,255,0.55)", fontSize: 10, fontWeight: 700 }}>
                Sign in &amp; level up to evolve your runner
              </div>
            )}
          </div>

          <div style={{ maxWidth: 340, color: "rgba(220,200,255,0.75)", fontSize: 13, fontWeight: 700, lineHeight: 1.6 }}>
            Survive 60 seconds. Catch coins 🪙, grab rare G$ gems 💚,
            dodge the spikes. Coin streaks multiply your score.
            <br />
            <span style={{ color: "rgba(251,191,36,0.85)" }}>Drag to move · or ← → keys</span>
          </div>

          {localBest > 0 && (
            <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 900, letterSpacing: "0.1em" }}>
              YOUR BEST: {localBest}
            </div>
          )}

          <div role="button" tabIndex={0} onClick={startGame}
            style={{ cursor: "pointer", width: "min(240px, 80vw)" }}>
            <div style={{ borderRadius: 18, background: "#14532d", paddingBottom: 6, boxShadow: "0 12px 28px -6px rgba(34,197,94,0.75)" }}>
              <div style={{
                borderRadius: "16px 16px 12px 12px",
                background: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
                padding: "18px 28px",
                border: "2px solid rgba(255,255,255,0.5)",
                boxShadow: "inset 0 6px 14px rgba(255,255,255,0.6)",
              }}>
                <span style={{ color: "white", fontSize: 20, fontWeight: 900, letterSpacing: "0.18em", textShadow: "0 2px 4px rgba(0,0,0,0.45)" }}>SURVIVE</span>
              </div>
            </div>
          </div>

          <button onClick={() => setPhase("shop")} style={{
            background: "rgba(20,10,50,0.7)", cursor: "pointer",
            border: "1.5px solid rgba(251,191,36,0.4)", borderRadius: 12,
            padding: "10px 20px", color: "#fde68a", fontFamily: "inherit",
            fontSize: 12, fontWeight: 900, letterSpacing: "0.12em",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            🛒 UPGRADE SHOP
          </button>
        </div>
      )}

      {/* FINISHED */}
      {phase === "finished" && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          background: "rgba(4,0,20,0.82)", backdropFilter: "blur(10px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 18, overflowY: "auto",
        }}>
          <div style={{
            width: "100%", maxWidth: 420,
            borderRadius: 26, background: "#1a0550", paddingBottom: 7,
            boxShadow: "0 0 0 3px #5b21b6, 0 0 50px rgba(109,40,217,0.6)",
          }}>
            <div style={{
              borderRadius: "24px 24px 20px 20px",
              background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 60%, #07021a 100%)",
              border: "2px solid rgba(255,255,255,0.12)",
              padding: "26px 22px", textAlign: "center",
            }}>
              <div style={{ fontSize: 38, marginBottom: 4 }}>{survived ? "🏆" : "💥"}</div>
              <div style={{ color: survived ? "#86efac" : "#fca5a5", fontSize: 15, fontWeight: 900, letterSpacing: "0.16em" }}>
                {survived ? "YOU SURVIVED!" : "WIPED OUT"}
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ color: "rgba(200,180,255,0.6)", fontSize: 10, fontWeight: 900, letterSpacing: "0.2em" }}>SCORE</div>
                <div style={{ color: "#fbbf24", fontSize: 44, fontWeight: 900, lineHeight: 1, textShadow: "0 0 20px rgba(251,191,36,0.8)" }}>{score}</div>
                {score >= localBest && score > 0 && (
                  <div style={{ color: "#22d3ee", fontSize: 11, fontWeight: 900, marginTop: 4, letterSpacing: "0.1em" }}>★ NEW PERSONAL BEST</div>
                )}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[
                  { label: "COINS", value: String(coinsGot), color: "#fbbf24" },
                  { label: "BEST STREAK", value: String(bestStreak), color: "#f0abfc" },
                  { label: "HEARTS LEFT", value: String(Math.max(0, hearts)), color: "#ef4444" },
                ].map(s => (
                  <div key={s.label} style={{
                    padding: "10px 4px", borderRadius: 10,
                    background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${s.color}33`,
                  }}>
                    <div style={{ color: s.color, fontSize: 19, fontWeight: 900 }}>{s.value}</div>
                    <div style={{ color: "rgba(200,180,255,0.55)", fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Coins banked — the upgrade hook. Survival bonus called out. */}
              <div style={{
                marginTop: 14, padding: "12px", borderRadius: 12,
                background: "linear-gradient(160deg, rgba(251,191,36,0.16) 0%, rgba(20,10,50,0.6) 100%)",
                border: "1.5px solid rgba(251,191,36,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <CoinIcon size={20} />
                <span style={{ color: "white", fontSize: 15, fontWeight: 900 }}>+{lastEarned}</span>
                <span style={{ color: "rgba(220,200,255,0.6)", fontSize: 10, fontWeight: 700 }}>
                  banked{survived ? " (incl. +50% survival bonus)" : ""} · {coinBank} total
                </span>
              </div>

              {/* Step 3 of the build plan replaces this note with the GamePass
                  voucher submit + rank/XP panel from Rhythm/Simon. */}
              <div style={{
                marginTop: 10, color: "rgba(200,180,255,0.5)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em",
              }}>
                Practice mode — ranked leaderboard runs coming next update.
              </div>

              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                <div role="button" tabIndex={0} onClick={startGame} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ borderRadius: 14, background: "#14532d", paddingBottom: 5, boxShadow: "0 8px 20px -6px rgba(34,197,94,0.7)" }}>
                    <div style={{
                      borderRadius: "12px 12px 9px 9px",
                      background: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
                      padding: "13px 8px", border: "2px solid rgba(255,255,255,0.5)",
                      boxShadow: "inset 0 4px 10px rgba(255,255,255,0.55)",
                    }}>
                      <span style={{ color: "white", fontSize: 14, fontWeight: 900, letterSpacing: "0.12em", textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>RUN IT BACK</span>
                    </div>
                  </div>
                </div>
                <div role="button" tabIndex={0} onClick={() => setPhase("shop")} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ borderRadius: 14, background: "#7c5004", paddingBottom: 5, boxShadow: "0 8px 20px -6px rgba(251,191,36,0.6)" }}>
                    <div style={{
                      borderRadius: "12px 12px 9px 9px",
                      background: "linear-gradient(160deg, #fde68a 0%, #fbbf24 50%, #d97706 100%)",
                      padding: "13px 8px", border: "2px solid rgba(255,255,255,0.45)",
                      boxShadow: "inset 0 4px 10px rgba(255,255,255,0.5)",
                    }}>
                      <span style={{ color: "#451a03", fontSize: 14, fontWeight: 900, letterSpacing: "0.1em" }}>🛒 UPGRADE</span>
                    </div>
                  </div>
                </div>
              </div>

              <button onClick={() => router.push("/games")} style={{
                marginTop: 12, background: "transparent", border: "none", cursor: "pointer",
                color: "rgba(200,180,255,0.55)", fontFamily: "inherit",
                fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
              }}>EXIT TO GAMES</button>
            </div>
          </div>
        </div>
      )}

      {/* UPGRADE SHOP */}
      {phase === "shop" && (
        <ShopScreen
          coins={coinBank}
          levels={levels}
          onBuy={buyUpgrade}
          onBack={() => setPhase("idle")}
          onPlay={startGame}
        />
      )}
    </div>
  );
}

// ─── Coin visual bits ─────────────────────────────────────────────────────────
function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      display: "inline-block",
      background: "radial-gradient(circle at 35% 30%, #fde68a, #d97706)",
      boxShadow: "inset 0 1px 2px rgba(255,255,255,0.6), 0 0 6px rgba(251,191,36,0.5)",
    }} />
  );
}

function CoinBankChip({ coins }: { coins: number }) {
  return (
    <div style={{
      position: "absolute", top: 18, right: 18,
      display: "flex", alignItems: "center", gap: 7,
      padding: "7px 13px 7px 9px", borderRadius: 999,
      background: "rgba(20,10,50,0.8)",
      border: "1.5px solid rgba(251,191,36,0.45)",
      boxShadow: "0 0 14px rgba(251,191,36,0.2)",
    }}>
      <CoinIcon size={18} />
      <span style={{ color: "white", fontSize: 14, fontWeight: 900 }}>{coins}</span>
    </div>
  );
}

// ─── Shop screen ──────────────────────────────────────────────────────────────
function ShopScreen({
  coins, levels, onBuy, onBack, onPlay,
}: {
  coins: number;
  levels: UpgradeLevels;
  onBuy: (id: UpgradeId) => void;
  onBack: () => void;
  onPlay: () => void;
}) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 12,
      background: "linear-gradient(180deg, #1e0762 0%, #0a0228 100%)",
      display: "flex", flexDirection: "column",
      padding: "max(16px, env(safe-area-inset-top)) 16px 16px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={onBack} aria-label="Back" style={{
          width: 38, height: 38, borderRadius: 11, border: "1.5px solid rgba(255,255,255,0.15)",
          background: "rgba(20,10,50,0.7)", color: "white", cursor: "pointer", fontSize: 16, fontWeight: 900,
        }}>‹</button>
        <div style={{ color: "white", fontSize: 16, fontWeight: 900, letterSpacing: "0.14em" }}>UPGRADE SHOP</div>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "7px 13px 7px 9px", borderRadius: 999,
          background: "rgba(20,10,50,0.8)", border: "1.5px solid rgba(251,191,36,0.45)",
        }}>
          <CoinIcon size={16} />
          <span style={{ color: "white", fontSize: 13, fontWeight: 900 }}>{coins}</span>
        </div>
      </div>

      <div style={{
        color: "rgba(220,200,255,0.55)", fontSize: 11, fontWeight: 700,
        textAlign: "center", marginBottom: 14, lineHeight: 1.5,
      }}>
        Spend coins you caught in runs. Upgrades are permanent.
      </div>

      {/* Upgrade list */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        {UPGRADES.map(u => {
          const lv = levels[u.id];
          const max = maxLevel(u.id);
          const cost = nextCost(u.id, lv);
          const maxed = cost === null;
          const afford = cost !== null && coins >= cost;
          return (
            <div key={u.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: 14, borderRadius: 16,
              background: "rgba(20,10,50,0.75)",
              border: `1.5px solid ${maxed ? "rgba(34,197,94,0.4)" : afford ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.08)"}`,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                background: "rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26,
              }}>{u.icon}</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "white", fontSize: 14, fontWeight: 900 }}>{u.name}</span>
                  {/* Level pips */}
                  <div style={{ display: "flex", gap: 3 }}>
                    {Array.from({ length: max }).map((_, i) => (
                      <span key={i} style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: i < lv ? "#fbbf24" : "rgba(255,255,255,0.18)",
                        boxShadow: i < lv ? "0 0 6px rgba(251,191,36,0.7)" : "none",
                      }} />
                    ))}
                  </div>
                </div>
                <div style={{ color: "rgba(220,200,255,0.6)", fontSize: 10.5, fontWeight: 700, marginTop: 3, lineHeight: 1.4 }}>
                  {u.blurb}
                </div>
                <div style={{ color: lv > 0 ? "#86efac" : "rgba(220,200,255,0.4)", fontSize: 10, fontWeight: 800, marginTop: 3 }}>
                  {lv > 0 ? `Now: ${u.effectLabel(lv)}` : "Not owned"}
                  {!maxed && <span style={{ color: "rgba(251,191,36,0.85)" }}>{`  →  ${u.effectLabel(lv + 1)}`}</span>}
                </div>
              </div>

              {maxed ? (
                <div style={{
                  flexShrink: 0, padding: "9px 14px", borderRadius: 10,
                  background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.45)",
                  color: "#86efac", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em",
                }}>MAX</div>
              ) : (
                <button
                  onClick={() => onBuy(u.id)}
                  disabled={!afford}
                  style={{
                    flexShrink: 0, cursor: afford ? "pointer" : "not-allowed",
                    padding: "9px 12px", borderRadius: 10, fontFamily: "inherit",
                    border: "none",
                    background: afford
                      ? "linear-gradient(160deg, #fde68a 0%, #fbbf24 50%, #d97706 100%)"
                      : "rgba(255,255,255,0.06)",
                    boxShadow: afford ? "inset 0 2px 5px rgba(255,255,255,0.5)" : "none",
                    display: "flex", alignItems: "center", gap: 5,
                    opacity: afford ? 1 : 0.6,
                  }}
                >
                  <CoinIcon size={13} />
                  <span style={{ color: afford ? "#451a03" : "rgba(220,200,255,0.7)", fontSize: 12, fontWeight: 900 }}>{cost}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Play CTA */}
      <div role="button" tabIndex={0} onClick={onPlay}
        style={{ cursor: "pointer", marginTop: 14, alignSelf: "center", width: "min(280px, 90vw)" }}>
        <div style={{ borderRadius: 16, background: "#14532d", paddingBottom: 5, boxShadow: "0 10px 24px -6px rgba(34,197,94,0.7)" }}>
          <div style={{
            borderRadius: "14px 14px 10px 10px",
            background: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
            padding: "15px 8px", textAlign: "center", border: "2px solid rgba(255,255,255,0.5)",
            boxShadow: "inset 0 5px 12px rgba(255,255,255,0.55)",
          }}>
            <span style={{ color: "white", fontSize: 16, fontWeight: 900, letterSpacing: "0.16em", textShadow: "0 2px 4px rgba(0,0,0,0.45)" }}>PLAY NOW</span>
          </div>
        </div>
      </div>
    </div>
  );
}
