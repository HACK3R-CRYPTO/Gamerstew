"use client";

// ─── Stack Tower, as a spectator sees it ─────────────────────────────────────
// The player's phone sends the top of its real tower after every drop: where
// each block sits, how wide it was cut, and how fast the next block slides
// (app/games/stack → tellRoom). This draws that tower with the game's own
// block painter (lib/stackDraw), scaled to fit, and slides a block of its own
// at the same speed. When the next drop arrives, the block lands exactly where
// the player's did: the same overhang, the same narrowing.
//
// The sliding block between drops is this page's own animation at the real
// speed, not the player's exact position at each instant. Sending that would
// need many messages a second; what matters, where each block lands, is real.

import { useEffect, useRef } from "react";
import type { LiveState } from "@/hooks/useFriendRoom";
import { BLOCK_H, HUES, drawSlab } from "@/lib/stackDraw";

type Tower = { lv: number; cw: number; spd: number; mw: number; over: boolean; combo: number; blocks: [number, number][] };
const read = (live?: LiveState): Tower | null => {
  if (!live || !Array.isArray(live.blocks) || typeof live.cw !== "number" || live.cw < 50) return null;
  const blocks = (live.blocks as unknown[]).filter((b): b is number[] => Array.isArray(b) && b.length >= 2).map((b) => [b[0], b[1]] as [number, number]);
  if (!blocks.length) return null;
  const num = (k: string) => (typeof live[k] === "number" ? (live[k] as number) : 0);
  return { lv: num("lv"), cw: live.cw, spd: num("spd"), mw: num("mw"), over: num("over") === 1, combo: num("combo"), blocks };
};

export default function StackReplay({ live, done }: { live?: LiveState; done: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null); const tower = useRef<Tower | null>(null);
  const mover = useRef({ x: 0, dir: 1 as 1 | -1, lv: -1 }); const landed = useRef(0); const cam = useRef(0);
  const latest = read(live);
  // a new drop: take the tower as sent, and start the next block from its side
  if (latest && (latest.lv !== tower.current?.lv || latest.over !== tower.current?.over)) {
    if (tower.current && latest.lv > tower.current.lv) landed.current = typeof performance !== "undefined" ? performance.now() : 0;
    tower.current = latest;
    if (mover.current.lv !== latest.lv) { const fromLeft = latest.lv === 0 || latest.lv % 2 === 0; mover.current = { x: fromLeft ? (latest.lv === 0 ? 0 : -latest.mw) : latest.cw, dir: fromLeft ? 1 : -1, lv: latest.lv }; }
  } else if (latest && tower.current) tower.current = { ...tower.current, combo: latest.combo };
  const stopped = done;

  useEffect(() => {
    const el = canvas.current; if (!el) return;
    let raf = 0; let last = performance.now(); let alive = true;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const box = el.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(box.width)), H = Math.max(1, Math.round(box.height));
      if (el.width !== W * dpr || el.height !== H * dpr) { el.width = W * dpr; el.height = H * dpr; }
      const ctx = el.getContext("2d"); const t = tower.current;
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const climb = Math.min(1, (t?.lv ?? 0) / 40);
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `hsl(${240 - climb * 80} 50% ${8 + climb * 10}%)`); g.addColorStop(1, "hsl(262 60% 14%)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        if (t) {
          const s = W / t.cw; // the player's screen, scaled to this panel
          ctx.save(); ctx.scale(s, s);
          const h = H / s; const n = t.blocks.length; const firstLv = t.lv - (n - 1);
          // keep the top of the tower a little above the middle, as the game's camera does
          const want = Math.max(0, t.lv * BLOCK_H - h * 0.42); cam.current += (want - cam.current) * (still ? 1 : 0.12);
          const yOf = (lv: number) => h - 46 - lv * BLOCK_H + cam.current;
          if (firstLv <= 0) { ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fillRect(0, yOf(0) + BLOCK_H, t.cw, 3); }
          t.blocks.forEach(([x, w], i) => { const lv = firstLv + i; drawSlab(ctx, x, yOf(lv), w, HUES[((lv % HUES.length) + HUES.length) % HUES.length], false, false); });
          // the block that just landed flashes, so the eye catches each drop
          const since = now - landed.current;
          if (since < 320 && n) { const [x, w] = t.blocks[n - 1]; ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - since / 320)})`; ctx.fillRect(x, yOf(t.lv), w, BLOCK_H - 3); }
          if (!t.over && !stopped && t.mw > 0) {
            const m = mover.current;
            if (!still) { m.x += m.dir * t.spd * (dt * 60); if (m.dir === 1 && m.x + t.mw > t.cw + 4) m.dir = -1; if (m.dir === -1 && m.x < -4) m.dir = 1; } else m.x = (t.cw - t.mw) / 2;
            const y = yOf(t.lv + 1); const hue = HUES[(t.lv + 1) % HUES.length];
            ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = `hsl(${hue} 78% 56%)`; ctx.fillRect(m.x - 6, y - 4, t.mw + 12, BLOCK_H + 8); ctx.restore();
            drawSlab(ctx, m.x, y, t.mw, hue, false, true);
          }
          ctx.restore();
          if (t.over || stopped) { ctx.fillStyle = "rgba(10,2,32,0.55)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.font = "800 15px ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(`Tower stopped at ${t.lv}`, W / 2, H / 2); }
        } else { ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Waiting for the first block", W / 2, H / 2); }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [stopped]);

  const t = tower.current;
  return (
    <div className="sr">
      <canvas ref={canvas} role="img" aria-label={t ? `Stack Tower, ${t.lv} blocks high` : "Stack Tower, waiting to start"} />
      <div className="sr-cap">{t ? <>{t.lv} {t.lv === 1 ? "block" : "blocks"}{t.combo >= 3 ? <b> · {t.combo}× perfect</b> : null}</> : "Getting ready"}</div>
      <style>{`
        .sr { position: relative; border-radius: 18px; overflow: hidden; background: #1b0d42; } .sr canvas { display: block; width: 100%; height: 300px; }
        .sr-cap { position: absolute; left: 10px; top: 10px; padding: 5px 10px; border-radius: 999px; background: rgba(10,2,32,0.6); color: #fff; font-size: 12.5px; font-weight: 800; } .sr-cap b { color: #fde047; }
        @media (min-width: 900px) { .sr canvas { height: 360px; } }
      `}</style>
    </div>
  );
}
