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

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { petForLevel } from "@/lib/pets";
import { useGameJuice, JuiceOverlay } from "@/hooks/useGameJuice";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

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

type Phase = "idle" | "countdown" | "playing" | "finished";
type Block = { x: number; w: number; hue: number };
type Moving = { x: number; w: number; dir: 1 | -1; speed: number; hue: number };
type Shard = { x: number; y: number; w: number; vx: number; vy: number; rot: number; vr: number; hue: number };
type Sparkle = { x: number; y: number; born: number; life: number };

export default function StackTowerPage() {
  const router = useRouter();
  const { address } = useAccount();

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [localBest, setLocalBest] = useState(0);

  // Player level → pet sprite shown on the idle screen, same incentive
  // as Survivor: signing in and leveling unlocks evolutions.
  const [playerLevel, setPlayerLevel] = useState(1);
  useEffect(() => {
    if (!address) return;
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.json())
      .then(d => setPlayerLevel(d.level || 1))
      .catch(() => {});
  }, [address]);
  const pet = petForLevel(playerLevel);

  useEffect(() => {
    setLocalBest(Number(localStorage.getItem("stack_best") || 0));
  }, []);

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

    // Complete miss — block falls, run ends.
    if (overlap <= 0) {
      shardsRef.current.push({
        x: m.x + m.w / 2, y: yCenter,
        w: m.w, vx: m.dir * 1.5, vy: 0, rot: 0, vr: m.dir * 0.04, hue: m.hue,
      });
      finish();
      return;
    }

    const offset = Math.abs(m.x - below.x);
    const newLevel = levelRef.current + 1;

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
    setScore(scoreRef.current);
    setCombo(comboRef.current);

    // New moving block: alternate entry side, speed creeps up with height
    const top = stack[stack.length - 1];
    const fromLeft = newLevel % 2 === 0;
    const speed = BASE_SPEED + newLevel * SPEED_RAMP
      + Math.min(newLevel * newLevel * SPEED_RAMP_QUAD, SPEED_RAMP_QUAD_CAP);
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
  }, [phase, blip, haptic, juice]);

  // ─── Finish ───────────────────────────────────────────────────────────────
  const finish = useCallback(() => {
    blip(140, 0.4, 0.22, "sawtooth");
    haptic([30, 40, 60]);
    juice.bump(22);
    setLocalBest(prev => {
      const best = Math.max(prev, scoreRef.current);
      localStorage.setItem("stack_best", String(best));
      return best;
    });
    setPhase("finished");
  }, [blip, haptic, juice]);

  // ─── Start a fresh run ────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const { w } = sizeRef.current;
    const startW = Math.min(280, Math.max(START_W_MIN, w * START_W_FRAC));
    stackRef.current = [
      { x: (w - startW) / 2, w: startW, hue: HUES[0] },
    ];
    movingRef.current = {
      x: 0, w: startW, dir: 1, speed: BASE_SPEED, hue: HUES[1],
    };
    shardsRef.current = [];
    sparklesRef.current = [];
    camYRef.current = 0;
    camTargetRef.current = 0;
    scoreRef.current = 0;
    comboRef.current = 0;
    levelRef.current = 1;
    setScore(0); setCombo(0);
    juice.reset();
    getAudioCtx();
    setCountdown(3);
    setPhase("countdown");
  }, [getAudioCtx, juice]);

  // ─── Countdown → playing ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      blip(784, 0.2, 0.2);
      setPhase("playing");
      return;
    }
    blip(523, 0.15, 0.18);
    const t = setTimeout(() => setCountdown(c => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown, blip]);

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

  // ─── Draw ─────────────────────────────────────────────────────────────────
  const draw = (ctx: CanvasRenderingContext2D, wall: number) => {
    const { w, h } = sizeRef.current;

    // Background — shifts hue as you climb. Sells progress without a counter.
    const climb = Math.min(levelRef.current / 60, 1);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `hsl(${240 - climb * 80} 50% ${8 + climb * 10}%)`);
    grad.addColorStop(1, "#07021c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(0, camYRef.current);

    // Stack
    const stack = stackRef.current;
    for (let i = 0; i < stack.length; i++) {
      const b = stack[i];
      const y = blockCenterY(i + 1) - BLOCK_H / 2;
      // Side shadow under each slab
      ctx.fillStyle = `hsl(${b.hue} 80% 28%)`;
      ctx.fillRect(b.x, y + 3, b.w, BLOCK_H);
      // Face
      ctx.fillStyle = `hsl(${b.hue} 78% 56%)`;
      ctx.fillRect(b.x, y, b.w, BLOCK_H - 3);
      // Top gloss
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(b.x, y, b.w, 4);
    }

    // Moving block (with glow)
    const m = movingRef.current;
    if (m && phase === "playing") {
      const y = blockCenterY(levelRef.current + 1) - BLOCK_H / 2;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = `hsl(${m.hue} 78% 56%)`;
      ctx.fillRect(m.x - 6, y - 4, m.w + 12, BLOCK_H + 8);
      ctx.restore();
      ctx.fillStyle = `hsl(${m.hue} 80% 28%)`;
      ctx.fillRect(m.x, y + 3, m.w, BLOCK_H);
      ctx.fillStyle = `hsl(${m.hue} 78% 56%)`;
      ctx.fillRect(m.x, y, m.w, BLOCK_H - 3);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(m.x, y, m.w, 4);
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

      {/* HUD — minimal: score top-left, combo top-right, best score subtle */}
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

          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.4em", color: "rgba(34,211,238,0.7)", textShadow: "0 0 14px rgba(34,211,238,0.7)" }}>GAME ARENA</div>
            <div style={{ fontSize: "clamp(34px, 8vw, 60px)", fontWeight: 900, color: "white", marginTop: 6, lineHeight: 1.05, textShadow: "0 0 24px rgba(34,211,238,0.9)" }}>
              STACK<br />TOWER
            </div>
          </div>

          {/* Tiny preview tower — animates a few perfect drops to sell the loop */}
          <PreviewTower />

          <div style={{ maxWidth: 340, color: "rgba(220,200,255,0.75)", fontSize: 13, fontWeight: 700, lineHeight: 1.6 }}>
            Tap to drop the block on the tower.
            Overhang gets sliced off.
            Land it perfectly for a combo and full width.
            <br />
            <span style={{ color: "rgba(251,191,36,0.85)" }}>Tap anywhere · or SPACE to drop</span>
          </div>

          {localBest > 0 && (
            <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 900, letterSpacing: "0.1em" }}>
              YOUR BEST: {localBest}
            </div>
          )}

          {!address && (
            <div style={{ color: "rgba(220,200,255,0.55)", fontSize: 11, fontWeight: 700 }}>
              {pet.name} watches. Sign in &amp; level up to evolve.
            </div>
          )}

          <div role="button" tabIndex={0} onClick={startGame}
            style={{ cursor: "pointer", width: "min(240px, 80vw)" }}>
            <div style={{ borderRadius: 18, background: "#075985", paddingBottom: 6, boxShadow: "0 12px 28px -6px rgba(34,211,238,0.75)" }}>
              <div style={{
                borderRadius: "16px 16px 12px 12px",
                background: "linear-gradient(160deg, #a5f3fc 0%, #22d3ee 50%, #0e7490 100%)",
                padding: "18px 28px",
                border: "2px solid rgba(255,255,255,0.5)",
                boxShadow: "inset 0 6px 14px rgba(255,255,255,0.6)",
              }}>
                <span style={{ color: "white", fontSize: 20, fontWeight: 900, letterSpacing: "0.18em", textShadow: "0 2px 4px rgba(0,0,0,0.45)" }}>STACK IT</span>
              </div>
            </div>
          </div>
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
              <div style={{ fontSize: 38, marginBottom: 4 }}>🧱</div>
              <div style={{ color: "#67e8f9", fontSize: 15, fontWeight: 900, letterSpacing: "0.16em" }}>
                TOWER DOWN
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ color: "rgba(200,180,255,0.6)", fontSize: 10, fontWeight: 900, letterSpacing: "0.2em" }}>SCORE</div>
                <div style={{ color: "#fbbf24", fontSize: 44, fontWeight: 900, lineHeight: 1, textShadow: "0 0 20px rgba(251,191,36,0.8)" }}>{score}</div>
                {score >= localBest && score > 0 && (
                  <div style={{ color: "#22d3ee", fontSize: 11, fontWeight: 900, marginTop: 4, letterSpacing: "0.1em" }}>★ NEW PERSONAL BEST</div>
                )}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{
                  padding: "10px 4px", borderRadius: 10,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(103,232,249,0.33)",
                }}>
                  <div style={{ color: "#67e8f9", fontSize: 19, fontWeight: 900 }}>{Math.max(0, levelRef.current - 1)}</div>
                  <div style={{ color: "rgba(200,180,255,0.55)", fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", marginTop: 2 }}>BLOCKS STACKED</div>
                </div>
                <div style={{
                  padding: "10px 4px", borderRadius: 10,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(232,121,249,0.33)",
                }}>
                  <div style={{ color: "#f0abfc", fontSize: 19, fontWeight: 900 }}>{combo}</div>
                  <div style={{ color: "rgba(200,180,255,0.55)", fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", marginTop: 2 }}>LAST COMBO</div>
                </div>
              </div>

              <div style={{
                marginTop: 14, color: "rgba(200,180,255,0.5)", fontSize: 9.5,
                fontWeight: 700, letterSpacing: "0.04em",
              }}>
                Practice mode — ranked leaderboard runs coming next update.
              </div>

              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                <div role="button" tabIndex={0} onClick={startGame} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ borderRadius: 14, background: "#075985", paddingBottom: 5, boxShadow: "0 8px 20px -6px rgba(34,211,238,0.7)" }}>
                    <div style={{
                      borderRadius: "12px 12px 9px 9px",
                      background: "linear-gradient(160deg, #a5f3fc 0%, #22d3ee 50%, #0e7490 100%)",
                      padding: "13px 8px", border: "2px solid rgba(255,255,255,0.5)",
                      boxShadow: "inset 0 4px 10px rgba(255,255,255,0.55)",
                    }}>
                      <span style={{ color: "white", fontSize: 14, fontWeight: 900, letterSpacing: "0.12em", textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>BUILD AGAIN</span>
                    </div>
                  </div>
                </div>
                <div role="button" tabIndex={0} onClick={() => router.push("/games")} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ borderRadius: 14, background: "#1a0550", paddingBottom: 5 }}>
                    <div style={{
                      borderRadius: "12px 12px 9px 9px",
                      background: "linear-gradient(160deg, #c084fc 0%, #a78bfa 50%, #6b21a8 100%)",
                      padding: "13px 8px", border: "2px solid rgba(255,255,255,0.4)",
                      boxShadow: "inset 0 4px 10px rgba(255,255,255,0.45)",
                    }}>
                      <span style={{ color: "white", fontSize: 14, fontWeight: 900, letterSpacing: "0.12em", textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>EXIT</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Idle-screen preview tower ───────────────────────────────────────────────
// Static decorative stack: 5 cyan slabs in a tidy column, slight perspective
// so it reads as a tower not a barcode. Keeps the idle screen feeling like
// the game it's about to launch.
function PreviewTower() {
  const blocks = [
    { w: 120, off: 0 },
    { w: 110, off: 4 },
    { w: 100, off: -2 },
    { w: 92,  off: 3 },
    { w: 82,  off: 0 },
  ];
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      filter: "drop-shadow(0 6px 18px rgba(34,211,238,0.4))",
    }}>
      {blocks.map((b, i) => (
        <div key={i} style={{
          width: b.w, height: 20, marginLeft: b.off,
          background: `linear-gradient(160deg, hsl(${195 + i * 12} 78% 62%), hsl(${195 + i * 12} 78% 42%))`,
          borderRadius: 4,
          boxShadow: "inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.25)",
        }} />
      ))}
    </div>
  );
}
