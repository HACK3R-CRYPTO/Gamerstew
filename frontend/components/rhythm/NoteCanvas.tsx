"use client";

// ─── NoteCanvas ───────────────────────────────────────────────────────────────
// Production-style rhythm tile renderer. Draws every falling note onto a
// single <canvas> element that React renders ONCE. The parent's RAF loop
// calls `draw(notes, now)` on this canvas's imperative handle every
// frame. React never reconciles during gameplay — the browser's render
// thread composites the canvas layer at 60fps no matter how much other
// work React is doing.
//
// Why: our DOM-based falling tiles worked on desktop but on mid-range
// Android AND iPhone 13 they stutter/skip once more than a few tiles
// are on-screen. Each DOM tile is its own composite layer, each inline
// style write triggers style recalc, and box-shadow + drop-shadow on
// every tile is an expensive paint. This is the exact reason every
// serious web rhythm game (Magic Tiles 3, Piano Tiles ports, osu!web,
// Clone Hero web) uses a single canvas instead of DOM nodes.
//
// Scope of this file: JUST the falling tiles. Lane dividers, tap
// buttons, HUD, pet, and burst particles stay as React DOM — they're
// cheap and cleanly expressed in JSX.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type LaneTheme = {
  face: string;   // tile face gradient CSS (we parse for solid fallback in canvas)
  glow: string;   // hex color, e.g. "#fb7185"
  wall: string;   // darker base color for the wall
  accent: string; // solid color used for the canvas face (since we can't
                  // easily tile a CSS linear-gradient in canvas 2D, we
                  // use the accent as the solid face — the DOM tap
                  // button below still carries the full gradient, so
                  // the visual language is consistent)
};

export type ActiveNote = {
  id: number;
  lane: number;
  time: number;   // scheduled hit time (seconds from start)
  travel: number; // seconds the tile takes to fall from top to bottom
  hold?: number;  // sustain duration (seconds) — draws a stem above the head
};

export type NoteCanvasHandle = {
  draw: (notes: ActiveNote[], nowSec: number) => void;
};

type Props = {
  lanes: LaneTheme[];
};

const NoteCanvas = forwardRef<NoteCanvasHandle, Props>(function NoteCanvas({ lanes }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Measured canvas size in CSS pixels + the DPR we scaled the backing
  // store to. Cached here so the per-frame draw doesn't have to query
  // getBoundingClientRect (which forces layout) every tick.
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  // Pre-rendered tile sprites — one offscreen canvas per lane. The whole
  // glossy tile (glow halo + wall + face + gloss + specular) is drawn
  // ONCE here; the per-frame loop just blits the bitmap with drawImage.
  // This is the difference between smooth and skipping on low-end: the
  // old loop rebuilt ~5 roundRect paths + 2 gradient allocations PER TILE
  // PER FRAME (≈64 ops/frame with 8 tiles). drawImage of a cached sprite
  // is one GPU blit — an order of magnitude cheaper.
  const spritesRef = useRef<{ tileW: number; tileH: number; pad: number; sprites: HTMLCanvasElement[] } | null>(null);

  const buildSprites = (tileW: number, tileH: number, dpr: number) => {
    const pad = 12; // room for the glow halo around the tile
    const sw = tileW + pad * 2;
    const sh = tileH + pad * 2 + 4;
    const sprites = lanes.map((theme) => {
      const off = document.createElement("canvas");
      off.width = Math.ceil(sw * dpr);
      off.height = Math.ceil(sh * dpr);
      const c = off.getContext("2d")!;
      c.scale(dpr, dpr);
      const x = pad, y = pad;

      // Glow halo (fake, no shadowBlur — software rasterization killer)
      c.globalAlpha = 0.28;
      c.fillStyle = theme.glow;
      roundRect(c, x - 8, y - 4, tileW + 16, tileH + 10, 18);
      c.fill();
      c.globalAlpha = 1;

      // Wall (3D depth)
      c.fillStyle = theme.wall;
      roundRect(c, x, y + 3, tileW, tileH, 14);
      c.fill();

      // Face
      c.fillStyle = theme.accent;
      roundRect(c, x + 2, y + 1, tileW - 4, tileH - 5, 12);
      c.fill();

      // Gloss crescent
      const glossH = Math.round((tileH - 5) * 0.45);
      const gloss = c.createLinearGradient(0, y + 1, 0, y + 1 + glossH);
      gloss.addColorStop(0, "rgba(255,255,255,0.55)");
      gloss.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = gloss;
      roundRect(c, x + 6, y + 2, tileW - 12, glossH, 9);
      c.fill();

      // Specular dot
      c.fillStyle = "rgba(255,255,255,0.8)";
      c.beginPath();
      c.ellipse(x + tileW * 0.32, y + 6, tileW * 0.12, 2.5, 0, 0, Math.PI * 2);
      c.fill();

      return off;
    });
    spritesRef.current = { tileW, tileH, pad, sprites };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      // DPR policy: cap at 2 (iPhone Pro reports 3, mobile GPUs choke on
      // 3x backing stores and the gain is invisible on falling tiles).
      // On low-core devices (budget Android is typically 4 cores or
      // fewer) drop to 1.5 — halves the pixels the GPU fills every frame,
      // the single biggest lever for the "tiles skip" reports on weak
      // hardware, with no visible quality loss in motion.
      const cores = (navigator.hardwareConcurrency || 8);
      const dprCap = cores <= 4 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Reset then apply DPR scale so 1 canvas unit == 1 CSS pixel
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
      sizeRef.current = { w: rect.width, h: rect.height, dpr };

      // Rebuild tile sprites at the new size (rare — resize/orientation).
      const laneW = rect.width / lanes.length;
      const tileW = Math.max(54, Math.min(90, laneW * 0.78));
      const tileH = Math.round(tileW * 0.7);
      buildSprites(tileW, tileH, dpr);
    };

    resize();
    // ResizeObserver catches layout changes (lane wrapper resizes,
    // orientation change, soft-keyboard appearance). Falls back to
    // window resize on older browsers.
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(resize)
      : null;
    if (ro) ro.observe(canvas);
    else window.addEventListener("resize", resize);

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    draw(notes, nowSec) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) return; // not yet measured

      // Clear — single op per frame beats per-tile DOM removal.
      ctx.clearRect(0, 0, w, h);

      const built = spritesRef.current;
      if (!built) return;
      const { tileW, tileH, pad, sprites } = built;
      const laneCount = lanes.length;
      const laneW = w / laneCount;

      // Per frame we do exactly ONE cheap fillRect (trail) + ONE drawImage
      // (the whole glossy tile) per visible note. No gradients, no
      // roundRect path building, no ellipse — all of that was baked into
      // the sprite once. This is what keeps 60fps on budget Android.
      for (const n of notes) {
        const progress = (nowSec - (n.time - n.travel)) / n.travel;
        // Hold tiles stay on-screen while their stem is still crossing
        // the line — extend the cull window by the hold's travel share.
        const holdProg = n.hold ? n.hold / n.travel : 0;
        if (progress < 0 || progress > 1.05 + holdProg) continue; // off-screen
        const yCenter = progress * h;
        const xCenter = (n.lane + 0.5) * laneW;
        const x = Math.round(xCenter - tileW / 2);
        const y = Math.round(yCenter - tileH / 2);
        const theme = lanes[n.lane];

        // Fade-in during first 15% of travel — matches the DOM version
        const alpha = progress < 0.15 ? Math.max(0, progress / 0.15) : 1;

        // HOLD STEM — a translucent ribbon extending UP from the head
        // (the tail arrives later, so it sits above). Two flat rects:
        // wide soft body + bright core line. No gradients, no paths —
        // same cheap-ops discipline as the rest of the renderer.
        if (n.hold) {
          const pxPerSec = h / n.travel;
          const stemH = n.hold * pxPerSec;
          const stemY = Math.round(yCenter - stemH);
          ctx.globalAlpha = 0.30 * alpha;
          ctx.fillStyle = theme.glow;
          ctx.fillRect(Math.round(xCenter - tileW * 0.28), stemY, Math.round(tileW * 0.56), Math.round(stemH));
          ctx.globalAlpha = 0.75 * alpha;
          ctx.fillStyle = theme.accent;
          ctx.fillRect(Math.round(xCenter - 2), stemY, 4, Math.round(stemH));
          // Tail cap — marks where the finger can let go
          ctx.globalAlpha = 0.9 * alpha;
          ctx.fillRect(Math.round(xCenter - tileW * 0.28), stemY - 3, Math.round(tileW * 0.56), 4);
        }

        // Motion trail — a single flat rect (no gradient allocation). The
        // fade-to-transparent is faked with a low globalAlpha; cheaper
        // than a per-frame createLinearGradient and visually identical in
        // motion. Hold tiles skip it — the stem IS their trail.
        if (!n.hold) {
          const trailH = 26;
          ctx.globalAlpha = 0.32 * alpha;
          ctx.fillStyle = theme.glow;
          ctx.fillRect(x + tileW * 0.2, y - trailH, tileW * 0.6, trailH);
        }

        // The tile itself — one bitmap blit. Sprite includes glow, wall,
        // face, gloss and specular, so this single call replaces the old
        // ~8 draw operations.
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[n.lane], x - pad, y - pad, tileW + pad * 2, tileH + pad * 2 + 4);
      }

      ctx.globalAlpha = 1;
    },
  }), [lanes]);

  return (
    <canvas
      ref={canvasRef}
      // Positioned to cover the entire lanes container; React parent
      // owns layout. pointerEvents: none so taps fall through to the
      // DOM tap buttons below.
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        // GPU-hint layer — mobile browsers will keep this on its own
        // compositor layer so drawing doesn't invalidate siblings.
        willChange: "transform",
      }}
    />
  );
});

export default NoteCanvas;

// Cross-browser roundRect polyfill. Safari < 16 and older Android don't
// support the spec `CanvasRenderingContext2D.roundRect` yet.
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}
