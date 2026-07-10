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
  hold?: number;  // sustain duration (seconds) — renders as a long capsule bar
  // Hold lifecycle set by the game loop after the head is hit:
  //   "held"    → finger is down: bar anchors at the line and gets consumed
  //   "dropped" → released early / head missed: bar falls away dimmed
  holdState?: "held" | "dropped";
};

export type NoteCanvasHandle = {
  // heldIds: note ids currently being sustained by a finger — their hold
  // bars render brighter so the player feels the connection.
  draw: (notes: ActiveNote[], nowSec: number, heldIds?: Set<number>) => void;
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

  // Candy shapes, one per lane — square / triangle / coin / star. Shape +
  // color double-codes the lanes (reads faster at speed, works for
  // colorblind players) and matches the brand's candy-arcade art. Each
  // sprite still renders ONCE here; the per-frame loop stays a single
  // drawImage blit per tile.
  const buildSprites = (tileW: number, tileH: number, dpr: number) => {
    const pad = 12; // room for the glow halo around the shape
    const sw = tileW + pad * 2;
    const sh = tileH + pad * 2 + 4;

    // Path helpers — all centered in the sprite box
    const tracePath = (c: CanvasRenderingContext2D, kind: number, cx: number, cy: number, w: number, h: number) => {
      c.beginPath();
      if (kind === 0) {
        // Rounded square (magenta lane)
        const s = Math.min(w, h);
        roundRect(c, cx - s / 2, cy - s / 2, s, s, s * 0.28);
      } else if (kind === 1) {
        // Triangle (blue lane) — softened joins via lineJoin round stroke
        const s = Math.min(w, h) * 1.06;
        c.moveTo(cx, cy - s / 2);
        c.lineTo(cx + s / 2, cy + s / 2);
        c.lineTo(cx - s / 2, cy + s / 2);
        c.closePath();
      } else if (kind === 2) {
        // Coin (gold lane)
        c.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2);
      } else {
        // 5-point star (green lane)
        const R = Math.min(w, h) * 0.58;
        const r = R * 0.5;
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 5;
          const rad = i % 2 === 0 ? R : r;
          const px = cx + Math.cos(ang) * rad;
          const py = cy + Math.sin(ang) * rad;
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.closePath();
      }
    };

    const sprites = lanes.map((theme, laneIdx) => {
      const off = document.createElement("canvas");
      off.width = Math.ceil(sw * dpr);
      off.height = Math.ceil(sh * dpr);
      const c = off.getContext("2d")!;
      c.scale(dpr, dpr);
      const cx = pad + tileW / 2;
      const cy = pad + tileH / 2;
      const shapeW = tileW * 0.82;
      const shapeH = tileH * 1.12;

      // Glow halo (fake, no shadowBlur — software rasterization killer)
      c.globalAlpha = 0.3;
      c.fillStyle = theme.glow;
      tracePath(c, laneIdx, cx, cy + 1, shapeW + 14, shapeH + 14);
      c.fill();
      c.globalAlpha = 1;

      // Drop wall (3D depth under the candy)
      c.fillStyle = theme.wall;
      tracePath(c, laneIdx, cx, cy + 3, shapeW, shapeH);
      c.fill();

      // Candy body — radial gradient for the glossy jelly look
      const grad = c.createRadialGradient(cx - shapeW * 0.22, cy - shapeH * 0.28, 2, cx, cy, Math.max(shapeW, shapeH) * 0.75);
      grad.addColorStop(0, "rgba(255,255,255,0.85)");
      grad.addColorStop(0.25, theme.accent);
      grad.addColorStop(1, theme.wall);
      c.fillStyle = grad;
      c.lineJoin = "round";
      c.lineWidth = 3;
      c.strokeStyle = "rgba(255,255,255,0.5)";
      tracePath(c, laneIdx, cx, cy, shapeW, shapeH);
      c.fill();
      c.stroke();

      // Specular dot — the candy shine
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.ellipse(cx - shapeW * 0.2, cy - shapeH * 0.24, shapeW * 0.12, shapeH * 0.08, -0.5, 0, Math.PI * 2);
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
    draw(notes, nowSec, heldIds) {
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

        // HOLD BAR — one continuous glowing capsule, Synthesia/Magic Tiles
        // style: the tile IS the long bar. Three lives:
        //   falling  → translucent capsule approaching the line
        //   held     → BRIGHT, and visually CONSUMED: everything below the
        //               hit line is clipped away, so the bar shrinks into
        //               the line as the sustain progresses — the "keep
        //               holding" feeling, drawn
        //   dropped  → dim ghost falling away (released early/head missed)
        if (n.hold) {
          const pxPerSec = h / n.travel;
          const barH = n.hold * pxPerSec;
          // Full tile width — hold bars are first-class tiles that happen
          // to be long, not skinny ribbons. Solid body + stroked border
          // reads instantly as "this one is different: pin it".
          const barW = tileW;
          const bx = Math.round(xCenter - barW / 2);
          const held = heldIds?.has(n.id) || n.holdState === "held";
          const dropped = n.holdState === "dropped";

          // Bar geometry: bottom edge = the head (falls past the line
          // while holding), top edge = the tail. While HELD, clip the
          // bottom at the hit line so the consumed part disappears.
          const rawBottom = yCenter + tileH / 2;
          const top = Math.round(yCenter - barH);
          const hitLineY = h - tileH * 0.5; // where the judgment line sits
          const bottom = held ? Math.min(rawBottom, hitLineY + tileH / 2) : rawBottom;
          const visH = Math.max(6, bottom - top);
          if (bottom <= top) continue; // fully consumed — RAF resolves it this frame

          const dim = dropped ? 0.16 : 1;

          // Outer glow — swells while held
          ctx.globalAlpha = (held ? 0.6 : 0.3) * alpha * dim;
          ctx.fillStyle = theme.glow;
          roundRect(ctx, bx - 7, top - 7, barW + 14, visH + 14, 22);
          ctx.fill();

          // Solid body — near-opaque. A hold bar is a wall, not a mist.
          ctx.globalAlpha = (held ? 1 : 0.82) * alpha * dim;
          ctx.fillStyle = theme.accent;
          roundRect(ctx, bx, top, barW, visH, 16);
          ctx.fill();

          // Stroked border — the crisp edge that separates it from taps
          ctx.globalAlpha = (held ? 1 : 0.7) * alpha * dim;
          ctx.lineWidth = held ? 3 : 2;
          ctx.strokeStyle = held ? "#ffffff" : "rgba(255,255,255,0.65)";
          roundRect(ctx, bx, top, barW, visH, 16);
          ctx.stroke();

          // Inner gloss — top-lit like the tap tile sprites, so both tile
          // families share one material language
          ctx.globalAlpha = (held ? 0.5 : 0.35) * alpha * dim;
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          roundRect(ctx, bx + 6, top + 5, barW - 12, Math.min(14, Math.max(5, visH * 0.16)), 8);
          ctx.fill();

          // While held: a hot consumption edge where the bar meets the
          // judgment line — the anchor that says "being eaten right here,
          // don't let go".
          if (held) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(bx - 5, Math.round(bottom) - 3, barW + 10, 6);
            ctx.globalAlpha = 0.55 * alpha;
            ctx.fillStyle = theme.glow;
            ctx.fillRect(bx - 12, Math.round(bottom) - 8, barW + 24, 16);
          }
          continue; // the capsule replaces the head sprite entirely
        }

        // Motion trail — a single flat rect (no gradient allocation). The
        // fade-to-transparent is faked with a low globalAlpha; cheaper
        // than a per-frame createLinearGradient and visually identical in
        // motion.
        const trailH = 26;
        ctx.globalAlpha = 0.32 * alpha;
        ctx.fillStyle = theme.glow;
        ctx.fillRect(x + tileW * 0.2, y - trailH, tileW * 0.6, trailH);

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
