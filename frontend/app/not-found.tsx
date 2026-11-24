"use client";

// ─── Page not found ──────────────────────────────────────────────────────────
// NEPA took the light. Three buildings stand in a dark Lagos street; flip the
// breaker and their windows come on and spell 404, the sky turns to dawn, and
// the way back to the games appears. It is the game's own idea (UP NEPA) used
// to say "this page is not here" without a dead end.
//
// It works without the switch too: the links are on the page from the start,
// for anyone who does not tap, cannot see it, or has motion turned off.

import Link from "next/link";
import { useEffect, useState } from "react";

// each digit as windows, three across and five down: 1 = a window that lights
const FOUR = ["101", "101", "111", "001", "001"];
const ZERO = ["111", "101", "101", "101", "111"];
const DIGITS = [FOUR, ZERO, FOUR];
const BUILDINGS = [{ x: 62, w: 150, top: 150, wall: "#2a1a5e" }, { x: 245, w: 150, top: 118, wall: "#33206f" }, { x: 428, w: 150, top: 150, wall: "#2a1a5e" }];

export default function NotFound() {
  const [on, setOn] = useState(false);
  const [flicker, setFlicker] = useState(false);
  // one window keeps a candle going in the dark, so the scene is alive before the switch
  useEffect(() => { if (on) return; const id = window.setInterval(() => setFlicker((f) => !f), 900); return () => window.clearInterval(id); }, [on]);
  const flip = () => { setOn((v) => !v); try { navigator.vibrate?.(18); } catch { /* no vibration on this device */ } };

  return (
    <main className={`nf ${on ? "on" : ""}`}>
      <svg className="nf-art" viewBox="0 0 640 430" role="img" aria-label={on ? "Three buildings with their windows lit, spelling 404" : "Three dark buildings at night. The power is out."}>
        <defs>
          <linearGradient id="nf-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b0424" /><stop offset="1" stopColor="#2a1163" /></linearGradient>
          <linearGradient id="nf-dawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7c3aed" /><stop offset="0.55" stopColor="#f472b6" /><stop offset="1" stopColor="#fbbf24" /></linearGradient>
          <radialGradient id="nf-glow"><stop offset="0" stopColor="#fde68a" stopOpacity="0.9" /><stop offset="1" stopColor="#fde68a" stopOpacity="0" /></radialGradient>
        </defs>
        <rect width="640" height="430" fill="url(#nf-night)" />
        <rect className="nf-dawn" width="640" height="430" fill="url(#nf-dawn)" />
        {/* stars and a moon by night, a low sun by dawn */}
        <g className="nf-stars" fill="#fff">{[[40, 40], [118, 82], [200, 30], [300, 64], [372, 26], [455, 78], [530, 38], [598, 96], [86, 128], [565, 150]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? 1.6 : 2.4} />)}</g>
        <circle className="nf-moon" cx="552" cy="72" r="26" fill="#ede9fe" />
        <circle className="nf-sun" cx="320" cy="372" r="150" fill="url(#nf-glow)" />
        {/* the pole and its wires, cut where NEPA cut them */}
        <g stroke="#120733" strokeWidth="5" strokeLinecap="round" fill="none">
          <path d="M22 376V96" /><path d="M4 110h38" /><path d="M8 126h30" />
          <path className="nf-wire" d="M22 110 C 120 150, 180 120, 245 126" />
          <path className="nf-wire" d="M395 124 C 470 160, 540 128, 640 108" />
        </g>
        {BUILDINGS.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={b.top} width={b.w} height={376 - b.top} rx="6" fill={b.wall} />
            <rect x={b.x - 6} y={b.top - 12} width={b.w + 12} height="14" rx="4" fill="#1d1147" />
            {DIGITS[i].map((row, r) => row.split("").map((bit, c) => {
              const lit = bit === "1"; const candle = !on && i === 1 && r === 2 && c === 1;
              return <rect key={`${r}-${c}`} className={lit ? "nf-win lit" : "nf-win"} style={lit ? { transitionDelay: `${(i * 15 + r * 3 + c) * 22}ms` } : undefined}
                x={b.x + 18 + c * 40} y={b.top + 20 + r * 38} width="34" height="28" rx="4" fill={candle ? (flicker ? "#fbbf24" : "#b45309") : "#150a3a"} />;
            }))}
          </g>
        ))}
        {/* the street, the kerb in Lagos green and white */}
        <rect x="0" y="376" width="640" height="54" fill="#120733" />
        {Array.from({ length: 16 }, (_, i) => <rect key={i} x={i * 40} y="376" width="40" height="8" fill={i % 2 ? "#f5f5f4" : "#16a34a"} className="nf-kerb" />)}
        <g className="nf-dash" fill="#fde68a">{[40, 180, 320, 460, 600].map((x) => <rect key={x} x={x - 30} y="404" width="60" height="6" rx="3" />)}</g>
      </svg>

      <div className="nf-text">
        <p className="nf-kicker">{on ? "UP NEPA!" : "NEPA DON TAKE LIGHT"}</p>
        <h1>{on ? "Light don come. The page never did." : "This page is in the dark."}</h1>
        <p className="nf-sub">{on ? "There is nothing at this address. The games are this way." : "We could not find what you were looking for. Flip the breaker and see."}</p>

        <button className="nf-switch" onClick={flip} aria-pressed={on} aria-label={on ? "Turn the light off" : "Flip the breaker to bring the light back"}>
          <span className="nf-knob" aria-hidden />
          <span className="nf-switch-word">{on ? "ON" : "OFF"}</span>
        </button>

        <nav className="nf-links" aria-label="Where to go">
          <Link href="/dashboard" className="nf-go">Back to the games</Link>
          <Link href="/leaderboard" className="nf-alt">Rankings</Link>
          <Link href="/world" className="nf-alt">Play UP NEPA 3D</Link>
        </nav>
      </div>

      <style>{`
        .nf { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 20px 16px calc(28px + env(safe-area-inset-bottom)); background: #0b0424; color: #fff; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; text-align: center; transition: background .9s ease, color .6s ease; }
        .nf.on { background: #f3eeff; color: #22104f; }
        .nf-art { width: min(100%, 640px); height: auto; border-radius: 28px; box-shadow: 0 30px 60px -30px rgba(0,0,0,0.8); }
        .nf-dawn, .nf-sun { opacity: 0; transition: opacity 1.1s ease; }
        .nf.on .nf-dawn { opacity: 1; } .nf.on .nf-sun { opacity: 1; }
        .nf-stars, .nf-moon { transition: opacity .8s ease; } .nf.on .nf-stars, .nf.on .nf-moon { opacity: 0; }
        .nf-stars circle { animation: nfTwinkle 2.8s ease-in-out infinite; } .nf-stars circle:nth-child(2n) { animation-delay: 1.1s; } .nf-stars circle:nth-child(3n) { animation-delay: .5s; }
        @keyframes nfTwinkle { 50% { opacity: .25; } }
        .nf-win { transition: fill .35s ease, filter .35s ease; }
        .nf.on .nf-win.lit { fill: #fde68a !important; filter: drop-shadow(0 0 7px rgba(253,230,138,0.95)); }
        .nf-kerb, .nf-dash { opacity: .35; transition: opacity .8s ease; } .nf.on .nf-kerb, .nf.on .nf-dash { opacity: 1; }
        .nf-wire { stroke-dasharray: 9 9; opacity: .55; transition: stroke-dasharray .6s ease, opacity .6s ease; } .nf.on .nf-wire { stroke-dasharray: 400 0; opacity: 1; }
        .nf-text { max-width: 520px; display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 16px; }
        .nf-kicker { margin: 0; font-size: 13px; font-weight: 900; letter-spacing: .18em; color: #fbbf24; } .nf.on .nf-kicker { color: #6d28d9; }
        .nf h1 { margin: 0; font-family: "Melon Pop", "Fredoka", system-ui, sans-serif; font-weight: 400; font-size: clamp(26px, 6.4vw, 40px); line-height: 1.1; }
        .nf-sub { margin: 0; font-size: 15.5px; line-height: 1.5; opacity: .82; }
        .nf-switch { margin: 8px 0 4px; position: relative; width: 148px; height: 62px; border-radius: 999px; border: 3px solid #fbbf24; background: #1a0b3d; cursor: pointer; display: flex; align-items: center; padding: 0 7px; transition: background .4s ease, border-color .4s ease; animation: nfNudge 2.4s ease-in-out infinite; }
        .nf.on .nf-switch { background: #16a34a; border-color: #15803d; animation: none; }
        @keyframes nfNudge { 0%, 70%, 100% { transform: none; } 80% { transform: translateY(-4px); } 90% { transform: translateY(0); } }
        .nf-knob { width: 44px; height: 44px; border-radius: 999px; background: #fbbf24; box-shadow: 0 4px 0 rgba(0,0,0,0.35); transition: transform .35s cubic-bezier(.3,1.5,.5,1), background .35s ease; }
        .nf.on .nf-knob { transform: translateX(84px); background: #fff; }
        .nf-switch-word { position: absolute; left: 0; right: 0; text-align: center; font-family: "Melon Pop", "Fredoka", system-ui, sans-serif; font-size: 21px; color: #fbbf24; pointer-events: none; padding-left: 40px; transition: padding .35s ease, color .35s ease; }
        .nf.on .nf-switch-word { padding-left: 0; padding-right: 40px; color: #fff; }
        .nf-switch:focus-visible, .nf-links a:focus-visible { outline: 3px solid #a78bfa; outline-offset: 3px; }
        .nf-links { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 6px; }
        .nf-links a { text-decoration: none; font-weight: 800; font-size: 15px; padding: 13px 18px; border-radius: 16px; min-height: 48px; display: inline-flex; align-items: center; }
        .nf-go { background: linear-gradient(180deg, #7c3aed, #6d28d9); color: #fff; box-shadow: 0 5px 0 #4c1d95; }
        .nf-alt { color: #ede9fe; border: 1px solid rgba(237,233,254,0.35); } .nf.on .nf-alt { color: #22104f; border-color: rgba(76,29,149,0.25); background: #fff; }
        @media (prefers-reduced-motion: reduce) { .nf, .nf * { transition: none !important; animation: none !important; } }
      `}</style>
    </main>
  );
}
