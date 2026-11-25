"use client";

// ─── Minimap ─────────────────────────────────────────────────────────────────
// The street from above, on the right edge of the screen where neither thumb
// rests. The street is long and narrow, so the map is a tall strip: the player
// is an arrow, and everything worth running to is a dot.
//
//   Restore the Light   every breaker: a ring while dark, gold once lit, red and
//                       pulsing when it is about to trip
//   Charge Rush         every device still waiting (in its own colour) and the
//                       charging table, in green
//
// With the camera low behind the player, the far end of the street is out of
// sight. This is what tells a player the last dark breaker is behind them.
//
// Drawn on a small 2D canvas about eight times a second: it reads positions the
// game already keeps, adds nothing to the 3D scene, and costs next to nothing.
// The street is not to scale across its width (it would be a hairline): width
// is stretched so the two kerbs can be told apart.

import { useEffect, useRef } from "react";
import { worldControls } from "./controls";
import { DEVICES, STATION, live } from "./game";
import { POWER_POINTS, pointState } from "./restore";

const HALF_W = 5.6;

export default function Minimap({ mode }: { mode: "restore" | "charge" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const zs = mode === "restore" ? POWER_POINTS.map((p) => p[1]) : [...DEVICES.map((d) => d.pos[1]), STATION[1]];
    const z0 = Math.min(...zs) - 6, z1 = Math.max(...zs) + 6;
    let timer = 0; let alive = true;
    const draw = () => {
      if (!alive) return;
      const box = el.getBoundingClientRect(); const dpr = Math.min(3, window.devicePixelRatio || 1);
      const W = Math.round(box.width), H = Math.round(box.height);
      if (!W || !H) return;
      if (el.width !== W * dpr || el.height !== H * dpr) { el.width = W * dpr; el.height = H * dpr; }
      const c = el.getContext("2d"); if (!c) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
      const pad = 7; const X = (x: number) => W / 2 + (x / HALF_W) * (W / 2 - pad); const Y = (z: number) => pad + ((z - z0) / (z1 - z0)) * (H - pad * 2);
      // the road, with its centre line
      c.fillStyle = "rgba(255,255,255,0.10)"; c.beginPath(); c.roundRect(W / 2 - (W / 2 - pad) * 0.62, 3, (W / 2 - pad) * 1.24, H - 6, 6); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.22)"; c.setLineDash([4, 5]); c.lineWidth = 1; c.beginPath(); c.moveTo(W / 2, 6); c.lineTo(W / 2, H - 6); c.stroke(); c.setLineDash([]);
      const beat = 0.5 + 0.5 * Math.sin(performance.now() / 140);
      if (mode === "restore") {
        POWER_POINTS.forEach(([x, z], i) => {
          const s = pointState[i]; const warn = s.warnT > 0 && s.on;
          c.beginPath(); c.arc(X(x), Y(z), warn ? 4 + beat * 1.5 : 3.6, 0, Math.PI * 2);
          if (warn) { c.fillStyle = "#ef4444"; c.fill(); }
          else if (s.on) { c.fillStyle = "#ffd23f"; c.shadowColor = "#ffd23f"; c.shadowBlur = 6; c.fill(); c.shadowBlur = 0; }
          else { c.strokeStyle = "#5ee6ff"; c.lineWidth = 1.8; c.stroke(); }
        });
      } else {
        // the charging table
        c.fillStyle = "#22c55e"; c.beginPath(); c.roundRect(X(STATION[0]) - 5, Y(STATION[1]) - 4, 10, 8, 2.5); c.fill();
        DEVICES.forEach((d, i) => { if (live[i].where !== "home") return; c.fillStyle = d.color; c.beginPath(); c.arc(X(d.pos[0]), Y(d.pos[1]), 3.6, 0, Math.PI * 2); c.fill(); });
      }
      // the player: an arrow pointing the way they face, kept inside the strip
      const px = Math.max(pad, Math.min(W - pad, X(worldControls.playerPos.x))), py = Math.max(pad, Math.min(H - pad, Y(worldControls.playerPos.z)));
      c.save(); c.translate(px, py); c.rotate(Math.PI - worldControls.playerYaw); // the arrow is drawn pointing up; the character at yaw 0 faces down the map
      c.fillStyle = "#fff"; c.strokeStyle = "#1b0d42"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, -6.5); c.lineTo(4.6, 5); c.lineTo(0, 2.4); c.lineTo(-4.6, 5); c.closePath(); c.fill(); c.stroke(); c.restore();
    };
    const loop = () => { draw(); timer = window.setTimeout(loop, 120); };
    loop();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [mode]);

  return (
    <div className="mm" aria-hidden style={{ ["--mm-top" as string]: mode === "charge" ? "198px" : "132px" } as React.CSSProperties}>
      <canvas ref={ref} />
      <style>{`
        .mm { position: absolute; z-index: 11; pointer-events: none; right: max(8px, env(safe-area-inset-right)); top: calc(var(--mm-top, 150px) + env(safe-area-inset-top)); width: 46px; height: min(210px, 34dvh); border-radius: 14px; background: rgba(14,6,34,0.58); box-shadow: 0 0 0 1px rgba(255,255,255,0.16), 0 8px 20px -10px #000; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); overflow: hidden; }
        .mm canvas { display: block; width: 100%; height: 100%; }
        /* phone on its side: little height to spare, so it sits lower on the right edge and is shorter */
        @media (orientation: landscape) and (max-height: 520px) { .mm { top: calc(64px + env(safe-area-inset-top)); height: min(150px, 46dvh); width: 42px; } }
        @media (min-width: 900px) { .mm { width: 58px; height: 260px; top: 120px; right: 22px; } }
      `}</style>
    </div>
  );
}
