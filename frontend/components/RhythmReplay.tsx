"use client";

// ─── Rhythm Rush, as a spectator sees it ─────────────────────────────────────
// The player's phone sends, a little more than once a second, its clock and the
// tiles around the hit line: each one's lane, the moment it reaches the line,
// how long it falls and whether it was missed (app/games/rhythm). This lets the
// tiles fall between messages, on the player's own clock, in the four lane
// colours of the game. A tile that was played bursts on the line; a missed one
// falls through, dimmed.
//
// Whether a hit was "perfect" or "good" is not sent, so both burst the same.
// The combo and score beside the lanes carry that.

import { useEffect, useRef } from "react";
import type { LiveState } from "@/hooks/useFriendRoom";

const LANE = ["#e879f9", "#3b82f6", "#fbbf24", "#22c55e"]; // the game's own lane colours
type Note = { lane: number; at: number; fall: number; hold: number; missed: boolean };
type Song = { t: number; got: number; notes: Note[]; combo: number };

const read = (live: LiveState | undefined, now: number): Song | null => {
  if (!live || typeof live.t !== "number" || !Array.isArray(live.notes)) return null;
  const notes = (live.notes as unknown[]).filter((r): r is number[] => Array.isArray(r) && r.length >= 5).map((r) => ({ lane: Math.max(0, Math.min(3, r[0])), at: r[1] / 100, fall: Math.max(0.4, r[2] / 100), hold: r[3] / 100, missed: r[4] === 1 }));
  return { t: live.t, got: now, notes, combo: typeof live.combo === "number" ? live.combo : 0 };
};

export default function RhythmReplay({ live, done }: { live?: LiveState; done: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null); const song = useRef<Song | null>(null); const lastT = useRef(-1);
  const t = typeof live?.t === "number" ? live.t : -1;
  if (t !== lastT.current) { lastT.current = t; const s = read(live, typeof performance !== "undefined" ? performance.now() : 0); if (s) song.current = s; }
  const combo = typeof live?.combo === "number" ? live.combo : 0;

  useEffect(() => {
    const el = canvas.current; if (!el) return;
    let raf = 0; let alive = true; const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (now: number) => {
      if (!alive) return;
      const box = el.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(box.width)), H = Math.max(1, Math.round(box.height));
      if (el.width !== W * dpr || el.height !== H * dpr) { el.width = W * dpr; el.height = H * dpr; }
      const ctx = el.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#0b0424"); bg.addColorStop(1, "#1f0d4d"); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        const pad = 14, lw = (W - pad * 2) / 4, lineY = H - 62, keyH = 40;
        for (let k = 0; k < 4; k++) { const x = pad + k * lw; ctx.fillStyle = k % 2 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.06)"; ctx.fillRect(x + 2, 0, lw - 4, lineY + 10); }
        const s = song.current; const lit = [0, 0, 0, 0];
        if (s) {
          // the player's clock, carried forward since their last message (frozen when the run is over)
          const tn = done || still ? s.t : s.t + Math.min(1.6, (now - s.got) / 1000);
          for (const n of s.notes) {
            const x = pad + n.lane * lw + 6, w = lw - 12; const until = n.at - tn; const y = lineY * (1 - until / n.fall);
            const tail = n.hold > 0 ? (n.hold / n.fall) * lineY : 0;
            if (until > n.fall || y - tail > H) continue;
            if (until <= 0 && !n.missed) { // played: a burst on the line that fades, and its key lights
              const age = -until; if (age < (n.hold > 0 ? n.hold + 0.3 : 0.32)) { const a = Math.max(0, 1 - age / (n.hold > 0 ? n.hold + 0.3 : 0.32)); lit[n.lane] = Math.max(lit[n.lane], a); ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = LANE[n.lane]; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x + w / 2, lineY, 16 + (1 - a) * 22, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
              continue;
            }
            ctx.save(); ctx.globalAlpha = n.missed ? 0.28 : 1;
            if (tail) { ctx.fillStyle = LANE[n.lane] + "66"; ctx.beginPath(); ctx.roundRect(x + w * 0.3, y - tail, w * 0.4, tail, 8); ctx.fill(); }
            const g = ctx.createLinearGradient(0, y - 24, 0, y); g.addColorStop(0, "#fff"); g.addColorStop(0.25, LANE[n.lane]); g.addColorStop(1, LANE[n.lane]);
            ctx.shadowColor = LANE[n.lane]; ctx.shadowBlur = n.missed ? 0 : 14; ctx.fillStyle = n.missed ? "#7f1d1d" : g; ctx.beginPath(); ctx.roundRect(x, y - 24, w, 24, 9); ctx.fill();
            ctx.restore();
          }
        } else { ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Waiting for the first note", W / 2, H / 2); }
        ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(pad, lineY, W - pad * 2, 2);
        for (let k = 0; k < 4; k++) { const x = pad + k * lw + 4; ctx.save(); ctx.globalAlpha = 0.5 + lit[k] * 0.5; ctx.fillStyle = LANE[k]; ctx.shadowColor = LANE[k]; ctx.shadowBlur = lit[k] * 22; ctx.beginPath(); ctx.roundRect(x, lineY + 12, lw - 8, keyH, 10); ctx.fill(); ctx.restore(); }
        if (done) { ctx.fillStyle = "rgba(10,2,32,0.55)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.font = "800 15px ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Song finished", W / 2, H / 2); }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [done]);

  return (
    <div className="rr">
      <canvas ref={canvas} role="img" aria-label={`Rhythm Rush, ${combo > 1 ? `${combo} combo` : "playing"}`} />
      <div className="rr-cap">{combo > 1 ? <b>{combo}× combo</b> : "Finding the beat"}</div>
      <style>{`
        .rr { position: relative; border-radius: 18px; overflow: hidden; background: #0b0424; } .rr canvas { display: block; width: 100%; height: 300px; }
        .rr-cap { position: absolute; left: 10px; top: 10px; padding: 5px 10px; border-radius: 999px; background: rgba(10,2,32,0.6); color: #fff; font-size: 12.5px; font-weight: 800; } .rr-cap b { color: #fde047; }
        @media (min-width: 900px) { .rr canvas { height: 360px; } }
      `}</style>
    </div>
  );
}
