"use client";

// ─── UP NEPA lobby ───────────────────────────────────────────────────────────
// The lobby is a gate: nothing is playable until a mode is chosen. The street
// turns slowly behind it as a backdrop; the stick is hidden and keys are ignored
// (World.tsx locks input while this is open).
//
// Each mode is one card that carries everything needed to decide and to play:
// a small drawn scene of what the mode looks like, its name, the goal in one
// line, the three things you do, and its own Start button. Start goes straight
// into the round. There is no second "how to play" screen to tap through.
//
// The scenes are drawn in the game's own sky and street colours (theme.ts), so
// the blackout card is the blackout and the dusk card is the dusk. On a phone
// the cards are a swipe row that snaps one card at a time; on a wide screen all
// three sit side by side.

import { useRef, useState, type ReactNode } from "react";
import { BLACKOUT, DUSK, GA } from "./theme";

export type LobbyChoice = "restore" | "charge" | "roam";

const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';

// Windows on the skyline. `d` staggers when each one lights (Restore) so the
// street comes back one building at a time.
const WINDOWS: [number, number, number][] = [
  [22, 52, 0], [34, 52, 3], [22, 66, 5], [34, 66, 1], [22, 80, 6],
  [66, 38, 2], [78, 38, 7], [90, 38, 4], [66, 54, 8], [78, 54, 0], [90, 54, 5], [66, 70, 3], [90, 70, 9],
  [124, 60, 6], [136, 60, 2], [124, 74, 9], [136, 74, 4],
  [168, 46, 1], [180, 46, 8], [168, 62, 5], [180, 62, 3], [168, 78, 7],
];
function Skyline({ lit }: { lit: "seq" | "on" }) {
  return (
    <g>
      <rect x="14" y="42" width="34" height="68" fill="#120c22" />
      <rect x="58" y="28" width="46" height="82" fill="#160e2a" />
      <rect x="116" y="50" width="34" height="60" fill="#120c22" />
      <rect x="160" y="36" width="34" height="74" fill="#160e2a" />
      {WINDOWS.map(([x, y, d], i) => (
        <rect key={i} x={x} y={y} width="7" height="8" rx="1" className={lit === "seq" ? "nl-win seq" : "nl-win on"} style={{ animationDelay: `${d * 0.42}s` }} />
      ))}
    </g>
  );
}

function RestoreArt() {
  return (
    <svg viewBox="0 0 208 120" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs><linearGradient id="nl-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={BLACKOUT.skyTop} /><stop offset="0.6" stopColor={BLACKOUT.skyMid} /><stop offset="1" stopColor={BLACKOUT.skyBottom} /></linearGradient></defs>
      <rect width="208" height="120" fill="url(#nl-night)" />
      {[[12, 14], [48, 8], [96, 16], [140, 10], [186, 20], [120, 26], [30, 28]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="0.9" fill="#fff" opacity="0.8" />)}
      <circle cx="176" cy="18" r="7" fill={BLACKOUT.disc} opacity="0.9" />
      <Skyline lit="seq" />
      <rect y="110" width="208" height="10" fill="#0b0716" />
      {/* the breaker box you run to */}
      <g className="nl-breaker">
        <rect x="100" y="84" width="16" height="24" rx="2" fill="#2b2440" stroke={GA.gold} strokeWidth="1.4" />
        <rect x="106" y="89" width="4" height="10" rx="1.5" fill={GA.gold} />
      </g>
    </svg>
  );
}

function ChargeArt() {
  return (
    <svg viewBox="0 0 208 120" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs><linearGradient id="nl-dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={DUSK.skyTop} /><stop offset="0.55" stopColor={DUSK.skyMid} /><stop offset="1" stopColor={DUSK.skyBottom} /></linearGradient></defs>
      <rect width="208" height="120" fill="url(#nl-dusk)" />
      <circle cx="40" cy="74" r="20" fill={DUSK.disc} opacity="0.95" />
      <Skyline lit="on" />
      <rect y="110" width="208" height="10" fill="#2a1a3a" />
      {/* the thing you are filling before the light goes */}
      <g transform="translate(122 12)">
        <rect x="0" y="0" width="70" height="30" rx="7" fill="rgba(10,1,32,0.72)" stroke="#fff" strokeWidth="1.6" />
        <rect x="70" y="10" width="5" height="10" rx="2" fill="#fff" />
        <rect x="5" y="5" width="60" height="20" rx="3.5" fill={GA.green} className="nl-fill" />
      </g>
      <rect width="208" height="120" fill="#070414" className="nl-flicker" />
    </svg>
  );
}

function RoamArt() {
  return (
    <svg viewBox="0 0 208 120" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs><linearGradient id="nl-dusk2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={DUSK.skyTop} /><stop offset="0.6" stopColor={DUSK.skyMid} /><stop offset="1" stopColor={DUSK.skyBottom} /></linearGradient></defs>
      <rect width="208" height="120" fill="url(#nl-dusk2)" />
      <circle cx="104" cy="62" r="16" fill={DUSK.disc} opacity="0.95" />
      {/* the road running away, with the green and white Lagos kerb */}
      <polygon points="0,120 208,120 124,62 84,62" fill="#3d3a4a" />
      <polygon points="0,120 22,120 86,62 84,62" fill={GA.green} /><polygon points="208,120 186,120 122,62 124,62" fill="#f4f1ea" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x="102.5" width="3" height="9" fill="#f4e9c8" className="nl-dash" style={{ animationDelay: `${i * -0.45}s` }} />)}
      {/* a keke, the yellow three-wheeler you can ride */}
      <g className="nl-keke" transform="translate(84 76)">
        <rect x="2" y="6" width="36" height="20" rx="6" fill={GA.gold} />
        <path d="M6 8 Q20 -6 34 8 Z" fill="#1c1430" />
        <rect x="9" y="9" width="22" height="8" rx="2" fill="#24203a" />
        <rect x="2" y="19" width="36" height="3" fill="#1c1430" />
        <circle cx="10" cy="28" r="4" fill="#111" /><circle cx="30" cy="28" r="4" fill="#111" />
        <circle cx="20" cy="22" r="1.8" fill="#fff6d0" />
      </g>
    </svg>
  );
}

interface Mode { id: LobbyChoice; kicker: string; title: string; goal: string; steps: string[]; cta: string; art: ReactNode; tone: "gold" | "green" | "plain" }
const MODES: Mode[] = [
  {
    id: "restore", kicker: "The whole area is dark", title: "Restore the Light", tone: "gold", art: <RestoreArt />,
    goal: "Bring the power back, one breaker at a time.",
    steps: ["Run to a glowing breaker box", "Tap when the marker is in the green", "Light the whole street before time runs out"],
    cta: "Start",
  },
  {
    id: "charge", kicker: "Light is on, not for long", title: "Charge Rush", tone: "green", art: <ChargeArt />,
    goal: "Charge what you can and cash it in before the cut.",
    steps: ["Walk into a device to pick it up, then carry it to the sockets", "It charges by itself while the light is on. Bigger devices pay more and take longer", "Collect what is full before NEPA cuts. Anything still charging is lost"],
    cta: "Start",
  },
  {
    id: "roam", kicker: "No timer, no score", title: "Free Roam", tone: "plain", art: <RoamArt />,
    goal: "Walk the street and learn where things are.",
    steps: ["Move around at your own pace", "Walk up to a keke and tap it to ride", "Come back here whenever you want a round"],
    cta: "Walk around",
  },
];

// Modes that are planned but not built. Names only: no dates are promised.
const SOON = ["Torch in the Dark", "Generator Hustle", "Power Thief"];

export default function ModeSelect({ onPick, touch, friends }: { onPick: (m: LobbyChoice) => void; touch: boolean; /** the play-with-friends entry, shown under the cards */ friends?: React.ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const onScroll = () => {
    const el = rail.current; if (!el) return;
    const card = el.firstElementChild as HTMLElement | null; if (!card) return;
    setAt(Math.max(0, Math.min(MODES.length, Math.round(el.scrollLeft / (card.offsetWidth + 12)))));
  };
  const go = (i: number) => {
    const el = rail.current; const card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2, behavior: "smooth" });
  };

  return (
    <div className="nl" role="dialog" aria-modal="true" aria-label="Choose a mode">
      <header className="nl-head">
        <div className="nl-eyebrow">GAME ARENA · LAGOS</div>
        <h1 style={{ fontFamily: DISPLAY }}>UP <span>NEPA</span></h1>
        <p>Choose how you want to play</p>
      </header>

      <div className="nl-rail" ref={rail} onScroll={onScroll}>
        {MODES.map((m, i) => (
          <article key={m.id} className={`nl-card ${m.tone}`} style={{ animationDelay: `${i * 70}ms` }}>
            <div className="nl-art">{m.art}</div>
            <div className="nl-body">
              <div className="nl-kicker">{m.kicker}</div>
              <h2 style={{ fontFamily: DISPLAY }}>{m.title}</h2>
              <p className="nl-goal">{m.goal}</p>
              <ol>
                {m.steps.map((s, k) => <li key={k}><i>{k + 1}</i><span>{s}</span></li>)}
              </ol>
              <button className="nl-cta" style={{ fontFamily: DISPLAY }} onClick={() => onPick(m.id)} aria-label={`${m.cta}: ${m.title}`}>{m.cta}</button>
            </div>
          </article>
        ))}
        {/* What is being built next. Shown as a card of its own so nobody thinks
            three modes is all there will ever be. Nothing on it can be pressed. */}
        <article className="nl-card soon" style={{ animationDelay: `${MODES.length * 70}ms` }} aria-label="More modes coming soon">
          <div className="nl-body">
            <div className="nl-kicker">Not open yet</div>
            <h2 style={{ fontFamily: DISPLAY }}>Coming soon</h2>
            <p className="nl-goal">Three more ways to play are being built.</p>
            <ul>
              {SOON.map((name) => (
                <li key={name}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span><b>{name}</b></span>
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>

      <div className="nl-dots" aria-hidden>
        {[...MODES.map((m) => m.id), "soon"].map((id, i) => <button key={id} className={i === at ? "on" : ""} onClick={() => go(i)} tabIndex={-1} />)}
      </div>
      {friends && <div className="nl-friends">{friends}</div>}
      <p className="nl-foot">{touch ? "In a round: left stick moves, drag the screen to look" : "In a round: W A S D to move, drag to look, Space to act"}</p>

      <style>{`
        .nl { position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column; justify-content: flex-end; gap: 10px; padding: 14px 0 calc(env(safe-area-inset-bottom, 0px) + 14px); color: #f4f1ea; font-family: "Fredoka", system-ui, sans-serif; background: linear-gradient(180deg, rgba(10,1,32,0.5) 0%, rgba(10,1,32,0.3) 26%, rgba(10,1,32,0.86) 100%); touch-action: pan-x; }
        .nl-head { text-align: center; padding: 0 16px; margin-bottom: auto; padding-top: 58px; }
        .nl-eyebrow { font-size: 10.5px; letter-spacing: 0.24em; font-weight: 600; opacity: 0.7; }
        .nl-head h1 { margin: 4px 0 0; font-size: clamp(38px, 11vw, 60px); line-height: 0.95; color: #fff; text-shadow: 0 4px 0 rgba(10,1,32,0.55); }
        .nl-head h1 span { color: ${GA.goldLight}; }
        .nl-head p { margin: 6px 0 0; font-size: 14.5px; font-weight: 500; opacity: 0.85; }

        .nl-rail { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 4px max(16px, calc(50% - 160px)) 8px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
        .nl-rail::-webkit-scrollbar { display: none; }
        .nl-card { flex: 0 0 min(320px, 82vw); scroll-snap-align: center; display: flex; flex-direction: column; overflow: hidden; border-radius: 22px; background: #150a2c; border: 2px solid rgba(255,255,255,0.14); box-shadow: 0 22px 44px -22px #000; animation: nlIn .45s cubic-bezier(.2,.8,.2,1) both; }
        .nl-card.gold { border-color: ${GA.goldLight}; }
        .nl-card.green { border-color: #4ade80; }
        @keyframes nlIn { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
        .nl-art { height: clamp(104px, 20vh, 150px); }
        .nl-art svg { display: block; width: 100%; height: 100%; }
        .nl-body { display: flex; flex-direction: column; flex: 1; padding: 12px 14px 14px; }
        .nl-kicker { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(244,241,234,0.62); }
        .nl-card.gold .nl-kicker { color: ${GA.goldLight}; } .nl-card.green .nl-kicker { color: #86efac; }
        .nl-card h2 { margin: 2px 0 0; font-size: 25px; line-height: 1.05; font-weight: 400; color: #fff; }
        .nl-goal { margin: 5px 0 0; font-size: 14px; line-height: 1.35; font-weight: 500; color: rgba(244,241,234,0.88); }
        .nl-card ol { list-style: none; margin: 10px 0 12px; padding: 10px 0 0; border-top: 1px solid rgba(255,255,255,0.12); display: flex; flex-direction: column; gap: 7px; }
        .nl-card li { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; line-height: 1.35; font-weight: 500; color: rgba(244,241,234,0.8); }
        .nl-card li i { flex: none; width: 19px; height: 19px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 11px; font-weight: 700; color: #150a2c; background: rgba(244,241,234,0.85); }
        .nl-cta { margin-top: auto; width: 100%; padding: 13px 0; border: none; border-radius: 14px; cursor: pointer; font-size: 19px; color: #f4f1ea; background: rgba(255,255,255,0.12); box-shadow: 0 4px 0 rgba(0,0,0,0.35); transition: transform .12s ease, box-shadow .12s ease, filter .15s ease; -webkit-tap-highlight-color: transparent; }
        .nl-card.gold .nl-cta { color: #2a1602; background: linear-gradient(180deg, ${GA.goldLight}, ${GA.gold}); box-shadow: 0 4px 0 #a16207; }
        .nl-card.green .nl-cta { color: #06230f; background: linear-gradient(180deg, #4ade80, ${GA.green}); box-shadow: 0 4px 0 ${GA.greenDeep}; }
        .nl-cta:hover { filter: brightness(1.08); }
        .nl-cta:active { transform: translateY(3px); box-shadow: 0 1px 0 rgba(0,0,0,0.35); }

        .nl-card.soon { flex-basis: min(270px, 74vw); background: rgba(21,10,44,0.72); border-style: dashed; border-color: rgba(255,255,255,0.28); box-shadow: none; justify-content: center; }
        .nl-card.soon h2 { color: rgba(255,255,255,0.92); }
        .nl-card.soon ul { list-style: none; margin: 12px 0 0; padding: 12px 0 0; border-top: 1px solid rgba(255,255,255,0.12); display: flex; flex-direction: column; gap: 11px; }
        .nl-card.soon li { display: flex; gap: 10px; align-items: flex-start; color: rgba(244,241,234,0.55); }
        .nl-card.soon li svg { flex: none; margin-top: 1px; }
        .nl-card.soon li span { font-size: 12.5px; line-height: 1.35; font-weight: 500; }
        .nl-card.soon li b { display: block; font-size: 14.5px; font-weight: 600; color: rgba(244,241,234,0.9); }
        [data-ride-prompt] { display: none !important; } /* nothing in the world can be pressed behind the lobby */
        .nl-friends { display: flex; justify-content: center; padding: 0 16px; }
        .nl-dots { display: flex; justify-content: center; gap: 6px; }
        .nl-dots button { width: 7px; height: 7px; padding: 0; border: none; border-radius: 99px; background: rgba(255,255,255,0.3); transition: width .25s ease, background .25s ease; }
        .nl-dots button.on { width: 22px; background: #fff; }
        .nl-foot { margin: 0; text-align: center; font-size: 12px; font-weight: 500; color: rgba(244,241,234,0.62); padding: 0 16px; }

        /* the drawn scenes */
        .nl-win { fill: #2a2440; }
        .nl-win.on { fill: ${GA.gold}; }
        .nl-win.seq { animation: nlLight 5.2s ease-in-out infinite; }
        @keyframes nlLight { 0%, 8% { fill: #2a2440; } 16%, 82% { fill: ${GA.gold}; } 92%, 100% { fill: #2a2440; } }
        .nl-breaker { animation: nlPulse 1.3s ease-in-out infinite; transform-origin: 108px 96px; }
        @keyframes nlPulse { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; filter: drop-shadow(0 0 5px ${GA.gold}); } }
        .nl-fill { transform-box: fill-box; transform-origin: left; animation: nlFill 4.4s linear infinite; }
        @keyframes nlFill { 0% { transform: scaleX(0.06); fill: #f87171; } 45% { fill: ${GA.gold}; } 78%, 100% { transform: scaleX(1); fill: ${GA.green}; } }
        .nl-flicker { opacity: 0; animation: nlFlick 4.4s linear infinite; }
        @keyframes nlFlick { 0%, 84% { opacity: 0; } 86% { opacity: 0.55; } 88% { opacity: 0; } 91% { opacity: 0.7; } 94% { opacity: 0.1; } 100% { opacity: 0.85; } }
        .nl-dash { animation: nlDash 1.8s linear infinite; }
        @keyframes nlDash { from { transform: translateY(62px) scaleY(0.3); opacity: 0.2; } to { transform: translateY(118px) scaleY(1.5); opacity: 1; } }
        .nl-keke { animation: nlBob 0.5s ease-in-out infinite alternate; }
        @keyframes nlBob { from { transform: translate(84px, 76px); } to { transform: translate(84px, 77.5px); } }

        /* wide screens: all three side by side, centred */
        @media (min-width: 1040px) {
          .nl { justify-content: center; gap: 18px; }
          .nl-head { margin-bottom: 0; padding-top: 0; }
          .nl-rail { justify-content: center; overflow: visible; padding: 0 24px; gap: 18px; }
          .nl-card { flex: 0 1 300px; }
          .nl-card.soon { flex: 0 1 230px; }
          .nl-art { height: 150px; }
          .nl-card:hover { transform: translateY(-6px); transition: transform .2s ease; }
          .nl-dots { display: none; }
        }
        /* short phones: tighter, so the Start button never falls off the screen */
        @media (max-height: 700px) {
          .nl-head { padding-top: 50px; } .nl-head h1 { font-size: 34px; } .nl-head p { display: none; }
          .nl-art { height: 84px; } .nl-card h2 { font-size: 21px; } .nl-goal { font-size: 13px; }
          .nl-card ol { margin: 7px 0 9px; padding-top: 7px; gap: 4px; } .nl-card li { font-size: 12px; }
          .nl-cta { padding: 10px 0; font-size: 17px; } .nl-foot { display: none; }
        }
        @media (prefers-reduced-motion: reduce) { .nl *, .nl-card { animation: none !important; } .nl-win.seq { fill: ${GA.gold}; } }
      `}</style>
    </div>
  );
}
