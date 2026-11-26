"use client";

// The streak, as a flame that shows how it is doing. A streak is fire: it burns
// while the player keeps playing. One picture, four states, so nobody has to
// read anything to know where they stand:
//
//   lit      played today              a steady orange flame
//   dying    not played yet today      a small flame that gutters: play, or it goes out tonight
//   frozen   a missed day, held by     the flame inside a block of ice: a streak freeze is
//            a streak freeze           keeping it, and playing sets it free
//   out      no streak                 a grey ember
//
// (The header used to draw every streak as a blue flame, which read as ice.)

export type FlameState = "lit" | "dying" | "frozen" | "out";
export function flameState(p: { streak: number; playedToday: boolean; frozen?: boolean }): FlameState {
  if (!p.streak || p.streak <= 0) return "out";
  if (p.playedToday) return "lit";
  return p.frozen ? "frozen" : "dying";
}
const SAY: Record<FlameState, (n: number) => string> = {
  lit: (n) => `${n} day streak. You played today.`,
  dying: (n) => `${n} day streak. Play today or it goes out.`,
  frozen: (n) => `${n} day streak, held by a streak freeze. Play to keep it.`,
  out: () => "No streak yet. Play today to start one.",
};
const INK: Record<FlameState, string> = { lit: "#c2410c", dying: "#b45309", frozen: "#0369a1", out: "rgba(34,16,79,0.5)" };

export default function StreakFlame({ streak, playedToday, frozen = false, size = 13, number = true, suffix = "", empty = "0" }: { streak: number; playedToday: boolean; frozen?: boolean; size?: number; /** show the count beside the flame */ number?: boolean; suffix?: string; /** what to print when there is no streak */ empty?: string }) {
  const st = flameState({ streak, playedToday, frozen });
  return (
    <span className={`sf sf-${st}`} title={SAY[st](streak)} aria-label={SAY[st](streak)} role="img" style={{ display: "inline-flex", alignItems: "center", gap: Math.max(2, size * 0.22), lineHeight: 1 }}>
      <svg width={size} height={size * 1.15} viewBox="0 0 24 28" aria-hidden style={{ overflow: "visible", flex: "none" }}>
        {st === "frozen" && <rect className="sf-ice" x="1.5" y="3" width="21" height="23.5" rx="5.5" />}
        <g className="sf-fire">
          <path className="sf-outer" d="M12 2.5c.8 3.6 5.6 6.4 5.6 12.2a5.6 5.6 0 0 1-11.2 0c0-2 .7-3.6 1.8-4.9.3 1.5 1 2.6 2 3.2C9.6 9.3 10.3 5.4 12 2.5z" />
          <path className="sf-inner" d="M12 12.2c.4 1.7 2.4 2.8 2.4 5.2a2.4 2.4 0 0 1-4.8 0c0-1.9 1.6-2.9 2.4-5.2z" />
        </g>
        {st === "frozen" && <path className="sf-shine" d="M5 7.5 9 5.5M5 11.5l2-1" />}
      </svg>
      {number && <b style={{ font: `800 ${Math.max(10, Math.round(size * 0.85))}px "Fredoka", system-ui, sans-serif`, color: INK[st], lineHeight: 1 }}>{streak > 0 ? `${streak}${suffix}` : empty}</b>}
      <style>{`
        .sf-fire { transform-origin: 50% 92%; transform-box: fill-box; }
        .sf-lit .sf-outer { fill: #f97316; } .sf-lit .sf-inner { fill: #fde047; }
        .sf-lit .sf-fire { animation: sfLit 1.6s ease-in-out infinite; }
        .sf-dying .sf-outer { fill: #d97706; } .sf-dying .sf-inner { fill: #fde68a; }
        .sf-dying .sf-fire { animation: sfDying 1.1s ease-in-out infinite; }
        .sf-frozen .sf-outer { fill: #fb923c; } .sf-frozen .sf-inner { fill: #fef08a; }
        .sf-frozen .sf-fire { transform: scale(0.74); }
        .sf-ice { fill: rgba(125,211,252,0.55); stroke: #38bdf8; stroke-width: 1.6; }
        .sf-shine { fill: none; stroke: #fff; stroke-width: 1.6; stroke-linecap: round; opacity: 0.9; }
        .sf-out .sf-outer { fill: rgba(34,16,79,0.28); } .sf-out .sf-inner { fill: rgba(34,16,79,0.14); }
        .sf-out .sf-fire { transform: scale(0.8); }
        @keyframes sfLit { 0%, 100% { transform: scale(1, 1); } 40% { transform: scale(1.06, 0.96) skewX(2deg); } 70% { transform: scale(0.96, 1.05) skewX(-2deg); } }
        @keyframes sfDying { 0%, 100% { transform: scale(0.7, 0.62); opacity: 0.75; } 35% { transform: scale(0.82, 0.9) skewX(5deg); opacity: 1; } 60% { transform: scale(0.62, 0.5) skewX(-6deg); opacity: 0.55; } }
        @media (prefers-reduced-motion: reduce) { .sf-fire { animation: none !important; } .sf-dying .sf-fire { transform: scale(0.72, 0.68); opacity: 0.8; } }
      `}</style>
    </span>
  );
}
