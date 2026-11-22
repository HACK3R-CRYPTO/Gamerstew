"use client";

// ─── NEPA: UP LIGHT — ambient scene layer ───────────────────────────────────
// A PURE-VISUAL canvas that draws light REACTIONS over the painted room behind
// the DOM HUD/sockets. It is a pure function of four read-only props and imports
// NOTHING from the game's scoring / replay / submission / wallet modules. It
// mirrors how NepaPet/CeilingBulb take an event prop: the parent emits a small
// `sceneEvent` pulse at edges that ALREADY fire in the game loop, and this
// component only paints a reaction.
//
// Scaffolding is copied from app/games/stack/page.tsx:
//   • DPR-aware canvas sizing via ResizeObserver
//   • a requestAnimationFrame loop gated on phase === "playing"
//   • refs for actors (never re-renders), a draw(ctx,w,h) function
//   • cached CanvasGradients (allocating a gradient every frame is the trap)
// Plus: pause on document-hidden / window-blur, and prefers-reduced-motion
// support (freeze motion, drop particles, keep the static lit/dark lighting).
//
// Everything is PROCEDURAL — zero assets. The scene ONLY paints light on the
// real painting; it never draws furniture, windows or people. Coordinates are
// normalized (0..1) and anchored to the 9:16 painted composition:
//   bulb       ~x0.54 / y0.11  (hanging bulb glow + dust/moths/surge)
//   man+phone  ~x0.60 / y0.33  (steady cool phone-screen glow, survives a cut)

import { useEffect, useRef } from "react";

// PROPS-ONLY interface — the hard constraint. The scene has NO access to game
// internals; it is a pure function of these values (ts retriggers an event).
export type NepaSceneEvent = { type: "cut" | "relight" | "bank" | "dip"; ts: number };
type Props = {
  lightOn: boolean;
  phase: string;
  reduceMotion: boolean;
  sceneEvent: NepaSceneEvent | null;
};

// ─── Composition anchors (normalized to the painted bg) ──────────────────────
const BULB = { x: 0.54, y: 0.11 };
const PHONE = { x: 0.6, y: 0.33 };

// ─── Hard perf caps (MiniPay / low-end Android target) ───────────────────────
const DUST_MAX = 22; // <= 25
const MOTH_MAX = 3; // <= 3
const SPARK_POOL = 48; // short-lived gold burst on a bank
const SPARK_PER_BANK = 10;

// ─── Actor types (all mutated in place — near-zero per-frame allocation) ─────
type Mote = { x: number; y: number; vx: number; vy: number; r: number; a: number };
type Moth = { cx: number; cy: number; rx: number; ry: number; phase: number; speed: number; size: number };
type Spark = { x: number; y: number; vx: number; vy: number; born: number; life: number };

export default function NepaScene({ lightOn, phase, reduceMotion, sceneEvent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rafRef = useRef(0);

  // Props mirrored into refs so the long-lived RAF loop (which depends on
  // `phase` only, like Stack's) always reads live values without re-subscribing.
  const lightOnRef = useRef(lightOn);
  const reduceRef = useRef(reduceMotion);
  useEffect(() => { lightOnRef.current = lightOn; }, [lightOn]);
  useEffect(() => { reduceRef.current = reduceMotion; }, [reduceMotion]);

  // Actors.
  const dustRef = useRef<Mote[]>([]);
  const mothsRef = useRef<Moth[]>([]);
  const sparksRef = useRef<Spark[]>([]);

  // Eased lighting state (bloom follows the bulb; surge/dip are short decays).
  const bloomRef = useRef(lightOn ? 1 : 0);
  const surgeRef = useRef(0); // relight overshoot, decays to 0
  const dipUntilRef = useRef(0); // brief voltage-dip dim until this wall-time

  // Cached gradients — created once per size, reused every frame. Variable
  // intensity is applied with globalAlpha, never by re-allocating the gradient.
  const bloomGradRef = useRef<{ key: string; grad: CanvasGradient } | null>(null);
  const phoneGradRef = useRef<{ key: string; grad: CanvasGradient } | null>(null);

  // ─── Init actors (deterministic enough; visual only — Math.random is fine) ──
  const initActors = () => {
    // Dust / embers — seeded across the bulb's light cone (below the bulb).
    const dust = dustRef.current;
    dust.length = 0;
    for (let i = 0; i < DUST_MAX; i++) {
      dust.push({
        x: 0.40 + Math.random() * 0.22,
        y: BULB.y + 0.02 + Math.random() * 0.34,
        vx: (Math.random() - 0.5) * 0.004,
        vy: -(0.004 + Math.random() * 0.006),
        r: 0.8 + Math.random() * 1.6,
        a: 0.25 + Math.random() * 0.5,
      });
    }
    // Moths — lazy sinusoidal orbits around the bulb.
    const moths = mothsRef.current;
    moths.length = 0;
    for (let i = 0; i < MOTH_MAX; i++) {
      moths.push({
        cx: BULB.x, cy: BULB.y + 0.01,
        rx: 0.03 + Math.random() * 0.03,
        ry: 0.018 + Math.random() * 0.02,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 0.5,
        size: 1.6 + Math.random() * 1.2,
      });
    }
    sparksRef.current.length = 0;
    bloomRef.current = lightOnRef.current ? 1 : 0;
    surgeRef.current = 0;
    dipUntilRef.current = 0;
  };

  // ─── React to a sceneEvent edge (one-shot; mirrors NepaPet's petEvent) ──────
  const lastEvtRef = useRef(0);
  useEffect(() => {
    if (!sceneEvent) return;
    if (sceneEvent.ts === lastEvtRef.current) return;
    lastEvtRef.current = sceneEvent.ts;
    const now = performance.now();
    const reduce = reduceRef.current;
    switch (sceneEvent.type) {
      case "relight": {
        // Filament overshoot on the return — the bulb bloom surges, then settles.
        surgeRef.current = reduce ? 0 : 1;
        break;
      }
      case "bank": {
        if (reduce) break; // no particles under reduced-motion
        const sp = sparksRef.current;
        for (let i = 0; i < SPARK_PER_BANK && sp.length < SPARK_POOL; i++) {
          sp.push({
            x: 0.5 + (Math.random() - 0.5) * 0.24, // sockets sit upper-centre
            y: 0.5 + (Math.random() - 0.5) * 0.04,
            vx: (Math.random() - 0.5) * 0.06,
            vy: -(0.12 + Math.random() * 0.14),
            born: now,
            life: 420 + Math.random() * 220,
          });
        }
        break;
      }
      case "dip": {
        if (!reduce) dipUntilRef.current = now + 260; // brief bloom dim
        break;
      }
      // "cut" needs no actor work — the bulb bloom follows lightOn in step().
    }
  }, [sceneEvent]);

  // ─── DPR-aware canvas sizing (copied from Stack) ────────────────────────────
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
      // Size changed → invalidate cached gradients so they re-key.
      bloomGradRef.current = null;
      phoneGradRef.current = null;
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas); else window.addEventListener("resize", resize);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener("resize", resize); };
  }, []);

  // ─── Step: advance actors (frame-rate-independent via dt scaled to 60fps) ───
  const step = (dt: number, wall: number) => {
    const reduce = reduceRef.current;
    const on = lightOnRef.current;
    const f = dt * 60;

    // Bulb bloom — breathe when ON, snap dark fast on a cut, surge on relight.
    const breath = reduce ? 1 : 0.9 + 0.1 * Math.sin(wall / 1400);
    const target = on ? breath : 0;
    // Darkness snaps (fast ease down); lighting eases in gently.
    const ease = target < bloomRef.current ? 0.35 : 0.1;
    bloomRef.current += (target - bloomRef.current) * ease * f;
    if (surgeRef.current > 0.001) surgeRef.current *= Math.pow(0.86, f); else surgeRef.current = 0;

    if (reduce) {
      // Static mode: bloom snaps; no particle motion.
      bloomRef.current = target;
      return;
    }

    // Dust / embers rise and sway inside the cone; respawn at the bottom.
    const dust = dustRef.current;
    for (let i = 0; i < dust.length; i++) {
      const m = dust[i];
      m.x += m.vx * f;
      m.y += m.vy * f;
      m.x += Math.sin(wall / 900 + i) * 0.00018 * f;
      if (m.y < BULB.y - 0.02 || m.x < 0.36 || m.x > 0.66) {
        m.x = 0.40 + Math.random() * 0.22;
        m.y = BULB.y + 0.30 + Math.random() * 0.06;
      }
    }

    // Moths orbit the bulb.
    const moths = mothsRef.current;
    for (let i = 0; i < moths.length; i++) moths[i].phase += moths[i].speed * 0.03 * f;

    // Bank sparkles rise + fade; in-place compaction (no per-frame alloc).
    const sp = sparksRef.current;
    let w = 0;
    for (let i = 0; i < sp.length; i++) {
      const s = sp[i];
      if (wall - s.born < s.life) {
        s.x += s.vx * 0.001 * f;
        s.y += s.vy * 0.001 * f;
        s.vy += 0.004 * f; // gentle gravity
        sp[w++] = s;
      }
    }
    sp.length = w;
  };

  // ─── Draw ───────────────────────────────────────────────────────────────────
  const draw = (ctx: CanvasRenderingContext2D, W: number, H: number, wall: number) => {
    ctx.clearRect(0, 0, W, H);
    const reduce = reduceRef.current;
    const on = lightOnRef.current;

    // 1 ── PHONE-SCREEN GLOW — cool white, steady; one of the only lights in a
    // blackout (NOT gated on lightOn, so it survives the cut).
    const phoneKey = `${W}|${H}`;
    if (!phoneGradRef.current || phoneGradRef.current.key !== phoneKey) {
      const pr = Math.max(28, W * 0.12);
      const g = ctx.createRadialGradient(PHONE.x * W, PHONE.y * H, 0, PHONE.x * W, PHONE.y * H, pr);
      g.addColorStop(0, "rgba(186,230,255,0.9)");
      g.addColorStop(0.4, "rgba(140,200,255,0.4)");
      g.addColorStop(1, "rgba(120,180,255,0)");
      phoneGradRef.current = { key: phoneKey, grad: g };
    }
    ctx.globalAlpha = on ? 0.5 : 0.85; // brighter in the dark so it reads through
    ctx.fillStyle = phoneGradRef.current.grad;
    ctx.fillRect(0, 0, W, H);

    // 2 ── BULB CAST-LIGHT BLOOM — warm radial at the bulb, intensity = bloom.
    const bloom = Math.max(0, Math.min(1.25, bloomRef.current + surgeRef.current * 0.5));
    const dipped = !reduce && wall < dipUntilRef.current;
    const bloomA = (dipped ? bloom * 0.55 : bloom);
    if (bloomA > 0.02) {
      const bloomKey = `${W}|${H}`;
      if (!bloomGradRef.current || bloomGradRef.current.key !== bloomKey) {
        const br = Math.max(80, H * 0.34);
        const g = ctx.createRadialGradient(BULB.x * W, BULB.y * H, 0, BULB.x * W, BULB.y * H, br);
        g.addColorStop(0, "rgba(255,210,130,0.9)");
        g.addColorStop(0.35, "rgba(255,180,90,0.45)");
        g.addColorStop(1, "rgba(255,160,70,0)");
        bloomGradRef.current = { key: bloomKey, grad: g };
      }
      ctx.globalAlpha = Math.min(1, bloomA);
      ctx.fillStyle = bloomGradRef.current.grad;
      ctx.fillRect(0, 0, W, H);
    }

    if (!reduce) {
      // 3 ── DUST / EMBERS — in the bulb cone, fade with the bloom.
      const dust = dustRef.current;
      if (bloom > 0.08) {
        ctx.fillStyle = "rgba(255,214,150,1)";
        for (let i = 0; i < dust.length; i++) {
          const m = dust[i];
          ctx.globalAlpha = m.a * Math.min(1, bloom) * 0.8;
          ctx.beginPath();
          ctx.arc(m.x * W, m.y * H, m.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 4 ── MOTHS — pale dots orbiting the bulb (gone when dark).
      if (bloom > 0.15) {
        const moths = mothsRef.current;
        ctx.fillStyle = "rgba(245,240,220,1)";
        for (let i = 0; i < moths.length; i++) {
          const mo = moths[i];
          const mx = (mo.cx + Math.cos(mo.phase) * mo.rx) * W;
          const my = (mo.cy + Math.sin(mo.phase * 1.3) * mo.ry) * H;
          ctx.globalAlpha = Math.min(1, bloom) * 0.85;
          ctx.beginPath();
          ctx.arc(mx, my, mo.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 5 ── BANK SPARKLE — gold particles rising near the sockets.
      const sp = sparksRef.current;
      if (sp.length) {
        ctx.fillStyle = "rgba(251,191,36,1)";
        for (let i = 0; i < sp.length; i++) {
          const s = sp[i];
          const age = (wall - s.born) / s.life;
          ctx.globalAlpha = Math.max(0, 1 - age);
          ctx.beginPath();
          ctx.arc(s.x * W, s.y * H, 2.4 * (1 - age * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1;
  };

  // ─── RAF loop — gated on phase === "playing", paused on hidden / blur ───────
  useEffect(() => {
    if (phase !== "playing") {
      // Not playing: clear any stale frame and don't run the loop.
      const ctx = canvasRef.current?.getContext("2d");
      const { w, h } = sizeRef.current;
      if (ctx && w > 0) ctx.clearRect(0, 0, w, h);
      return;
    }
    initActors();
    let lastWall = performance.now();
    let paused = typeof document !== "undefined" && document.hidden;
    const tick = () => {
      const wall = performance.now();
      const dt = Math.min(0.05, (wall - lastWall) / 1000);
      lastWall = wall;
      const ctx = canvasRef.current?.getContext("2d");
      const { w, h } = sizeRef.current;
      if (ctx && w > 0 && !paused) {
        step(dt, wall);
        draw(ctx, w, h, wall);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const onVis = () => { paused = document.hidden; lastWall = performance.now(); };
    const onBlur = () => { paused = true; };
    const onFocus = () => { paused = document.hidden; lastWall = performance.now(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [phase]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 1, pointerEvents: "none" }}
    />
  );
}
