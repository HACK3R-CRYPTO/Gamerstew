"use client";

// ─── "Turn your phone sideways" ──────────────────────────────────────────────
// A small moving picture, shown while a 3D game loads and before a round, to a
// player holding a phone upright: the phone turns on its side, the street on
// its screen opens out to twice the width, and two thumbs settle on it, one
// each side. It says in two seconds what a sentence of text does not get read
// for: sideways shows more street and frees both thumbs.
//
// It is a suggestion. The game plays upright too, nothing waits on it, and it
// removes itself the moment the phone is turned (or on anything that is not a
// phone held upright). The picture is drawn here as shapes, so it is sharp on
// every screen and adds no download.

import { useEffect, useState } from "react";

// one small street, drawn to fit a screen `w` wide and `h` tall, centred on 0,0
function Street({ w, h, wide }: { w: number; h: number; wide: boolean }) {
  const x0 = -w / 2, y0 = -h / 2, horizon = y0 + h * (wide ? 0.44 : 0.4);
  const blocks = wide ? [[-50, 20, 26], [-27, 15, 34], [14, 14, 30], [30, 20, 22]] : [[-27, 15, 30], [13, 14, 24]];
  return (
    <g>
      <rect x={x0} y={y0} width={w} height={h} fill="url(#rhSky)" />
      <circle cx={wide ? 30 : 14} cy={y0 + h * 0.2} r={wide ? 7 : 6} fill="#ffd56b" opacity="0.9" />
      {blocks.map(([bx, bw, bh], i) => (
        <g key={i}>
          <rect x={bx} y={horizon - bh} width={bw} height={bh} rx="1.5" fill={i % 2 ? "#3b1d8f" : "#2a1466"} />
          {[0, 1, 2].map((r) => [0, 1].map((c) => <rect key={`${r}${c}`} x={bx + 3 + c * (bw / 2 - 1)} y={horizon - bh + 4 + r * 7} width="3.2" height="3.6" rx="0.6" fill={(r + c + i) % 3 ? "#ffd23f" : "#4c2aa8"} />))}
        </g>
      ))}
      <path d={`M ${x0} ${y0 + h} L ${-w * 0.07} ${horizon} L ${w * 0.07} ${horizon} L ${x0 + w} ${y0 + h} Z`} fill="#1b0d42" />
      <path d={`M 0 ${horizon + 3} L 0 ${y0 + h}`} stroke="#f4f1ea" strokeWidth="1.6" strokeDasharray="5 6" opacity="0.7" />
      {wide && <g><rect x="-36" y={horizon + 6} width="19" height="11" rx="2.5" fill="#f5b301" /><rect x="-33" y={horizon + 8} width="13" height="4" rx="1" fill="#2a1466" /><circle cx="-31" cy={horizon + 18} r="2.3" fill="#12052e" /><circle cx="-22" cy={horizon + 18} r="2.3" fill="#12052e" /></g>}
      <g transform={`translate(${wide ? 6 : 3} ${y0 + h * 0.7})`}><circle r="3.4" cy="-9" fill="#fde0c8" /><rect x="-3.4" y="-5.5" width="6.8" height="10" rx="2.6" fill="#f4f1ea" /><ellipse cy="7" rx="7.5" ry="2.4" fill="none" stroke="#ffd56b" strokeWidth="1.3" /></g>
    </g>
  );
}

export default function RotateHint({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const touch = "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
    const upright = window.matchMedia("(orientation: portrait)");
    const set = () => setShow(touch && upright.matches && window.innerWidth < 760);
    set(); upright.addEventListener("change", set); window.addEventListener("resize", set);
    return () => { upright.removeEventListener("change", set); window.removeEventListener("resize", set); };
  }, []);
  if (!show) return null;
  return (
    <div className={`rh ${tone}`} role="note">
      <svg viewBox="-80 -70 160 140" width="132" height="116" aria-hidden>
        <defs>
          <linearGradient id="rhSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b1391" /><stop offset="0.62" stopColor="#c0397a" /><stop offset="1" stopColor="#f08a3c" /></linearGradient>
          <clipPath id="rhTall"><rect x="-27" y="-50" width="54" height="100" rx="6" /></clipPath>
          <clipPath id="rhWide"><rect x="-50" y="-27" width="100" height="54" rx="6" /></clipPath>
        </defs>
        {/* the turn: an arc with an arrowhead, behind the phone */}
        <g className="rh-arc"><path d="M -52 -34 A 62 62 0 0 1 34 -52" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 7" opacity="0.55" /><path d="M 30 -60 L 41 -51 L 28 -46 Z" fill="currentColor" opacity="0.75" /></g>
        <g className="rh-phone">
          <rect x="-33" y="-60" width="66" height="120" rx="12" fill="#12052e" stroke="#fff" strokeWidth="2.5" />
          <rect x="-8" y="-56.5" width="16" height="3.4" rx="1.7" fill="#3b2a6b" />
          {/* upright: a narrow slice of the street */}
          <g className="rh-tall" clipPath="url(#rhTall)"><Street w={54} h={100} wide={false} /></g>
          {/* on its side: the same street, twice as wide, with a thumb each side. Drawn turned back, so it reads upright once the phone has turned. */}
          <g className="rh-wide" transform="rotate(90)">
            <g clipPath="url(#rhWide)"><Street w={100} h={54} wide /></g>
            <g className="rh-thumbs"><circle cx="-36" cy="13" r="9" fill="#fff" opacity="0.2" /><circle cx="-36" cy="13" r="5" fill="#ffd56b" /><circle cx="36" cy="10" r="9" fill="#fff" opacity="0.2" /><circle cx="36" cy="10" r="5" fill="#fff" /></g>
          </g>
        </g>
      </svg>
      <div className="rh-text"><b>Turn your phone sideways</b><span>See twice the street, with a thumb free on each side.</span><i>Or stay upright. It plays both ways.</i></div>
      <style>{`
        .rh { display: flex; align-items: center; gap: 12px; width: min(360px, calc(100vw - 32px)); padding: 10px 14px 10px 8px; border-radius: 22px; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; text-align: left; animation: rhIn .5s cubic-bezier(.2,.9,.3,1.1) both; }
        .rh.dark { background: rgba(14,6,34,0.78); color: #fff; box-shadow: 0 0 0 1px rgba(255,255,255,0.16), 0 20px 40px -18px #000; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
        .rh.light { background: #fff; color: #22104f; box-shadow: 0 0 0 1px rgba(76,29,149,0.14), 0 22px 36px -24px rgba(76,29,149,0.9); }
        .rh svg { flex: 0 0 auto; overflow: visible; }
        .rh-text { display: grid; gap: 3px; min-width: 0; } .rh-text b { font-family: "Melon Pop", "Fredoka", system-ui, sans-serif; font-weight: 400; font-size: 19px; line-height: 1.1; }
        .rh-text span { font-size: 13.5px; line-height: 1.35; opacity: 0.86; } .rh-text i { font-style: normal; font-size: 12px; opacity: 0.62; }
        @keyframes rhIn { from { opacity: 0; transform: translateY(12px) scale(0.97); } }
        /* one loop, 4.2 s: upright, turn, held on its side with the thumbs down, turn back */
        .rh-phone { transform-origin: 0 0; animation: rhTurn 4.2s cubic-bezier(.6,0,.2,1) infinite; }
        @keyframes rhTurn { 0%, 18% { transform: rotate(0deg); } 38%, 84% { transform: rotate(-90deg); } 100% { transform: rotate(0deg); } }
        .rh-tall { animation: rhTall 4.2s linear infinite; } @keyframes rhTall { 0%, 22% { opacity: 1; } 34%, 88% { opacity: 0; } 100% { opacity: 1; } }
        .rh-wide { animation: rhWide 4.2s linear infinite; } @keyframes rhWide { 0%, 24% { opacity: 0; } 36%, 86% { opacity: 1; } 98%, 100% { opacity: 0; } }
        .rh-thumbs { animation: rhThumbs 4.2s ease-out infinite; transform-origin: 0 12px; } @keyframes rhThumbs { 0%, 40% { opacity: 0; transform: scale(0.6); } 50%, 82% { opacity: 1; transform: scale(1); } 88%, 100% { opacity: 0; transform: scale(0.8); } }
        .rh-arc { transform-origin: 0 0; animation: rhArc 4.2s ease-in-out infinite; } @keyframes rhArc { 0%, 12% { opacity: 1; } 40%, 100% { opacity: 0; } }
        /* no movement wanted: show the phone already on its side, with the thumbs down */
        @media (prefers-reduced-motion: reduce) { .rh, .rh-phone, .rh-tall, .rh-wide, .rh-thumbs, .rh-arc { animation: none; } .rh-phone { transform: rotate(-90deg); } .rh-tall, .rh-arc { opacity: 0; } }
      `}</style>
    </div>
  );
}
