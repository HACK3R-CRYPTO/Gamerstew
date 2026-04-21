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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      // Cap DPR at 2 — mobile GPUs struggle with 3x backing stores
      // (iPhone Pro models report DPR 3) and the visual benefit past
      // 2x is invisible on falling tiles.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

      const laneCount = lanes.length;
      const laneW = w / laneCount;
      // Mirror the DOM tile sizing so the canvas draw lines up with
      // where the tap buttons expect a tile to be hit.
      const tileW = Math.max(54, Math.min(90, laneW * 0.78));
      const tileH = Math.round(tileW * 0.7);

      for (const n of notes) {
        const progress = (nowSec - (n.time - n.travel)) / n.travel;
        if (progress < 0 || progress > 1.05) continue; // off-screen
        const yCenter = progress * h;
        const xCenter = (n.lane + 0.5) * laneW;
        const x = Math.round(xCenter - tileW / 2);
        const y = Math.round(yCenter - tileH / 2);
        const theme = lanes[n.lane];

        // Fade-in during first 15% of travel — matches the DOM version
        const alpha = progress < 0.15 ? Math.max(0, progress / 0.15) : 1;
        ctx.globalAlpha = alpha;

        // Motion trail — a vertical gradient above the tile that fades
        // from transparent to the glow color. Sells the fall.
        // Use globalAlpha instead of string-concat-hex because the
        // lane theme `glow` values can be rgba() strings, where
        // `"rgba(…)" + "00"` produces garbage like "rgba(…)00" that
        // blows up addColorStop.
        const trailH = 26;
        const trail = ctx.createLinearGradient(0, y - trailH, 0, y);
        trail.addColorStop(0, "transparent");
        trail.addColorStop(1, theme.glow);
        ctx.save();
        ctx.globalAlpha = 0.5 * alpha;
        ctx.fillStyle = trail;
        ctx.fillRect(x + tileW * 0.2, y - trailH, tileW * 0.6, trailH);
        ctx.restore();

        // Glow halo — one outer shadow layer. Multi-layer shadows like
        // the DOM version's 3-stop box-shadow are too expensive per
        // tile on canvas; one layer at higher blur reads the same.
        ctx.save();
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = 22;
        ctx.shadowOffsetY = 0;
        // Wall (3D depth underneath — slightly taller, darker)
        ctx.fillStyle = theme.wall;
        roundRect(ctx, x, y + 3, tileW, tileH, 14);
        ctx.fill();
        ctx.restore();

        // Face (main tile surface)
        ctx.fillStyle = theme.accent;
        roundRect(ctx, x + 2, y + 1, tileW - 4, tileH - 5, 12);
        ctx.fill();

        // Gloss crescent — subtle white highlight at the top 45% of the
        // tile. Sells the glossy-button look without another shadow.
        const glossH = Math.round((tileH - 5) * 0.45);
        const gloss = ctx.createLinearGradient(0, y + 1, 0, y + 1 + glossH);
        gloss.addColorStop(0, "rgba(255,255,255,0.55)");
        gloss.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gloss;
        roundRect(ctx, x + 6, y + 2, tileW - 12, glossH, 9);
        ctx.fill();

        // Specular highlight dot — sells the plastic/resin sheen
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.beginPath();
        ctx.ellipse(
          x + tileW * 0.32,
          y + 6,
          tileW * 0.12,
          2.5,
          0, 0, Math.PI * 2
        );
        ctx.fill();
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
