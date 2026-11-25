"use client";

// "How to play", for every game. One sheet, three steps, each with a small
// moving picture of the action itself, drawn from the game's own pieces.
//
// Why it is built this way (docs/how-to-play.md has the sources): people skip
// tutorials they have to read, and learn a game by doing the action. So this is
// not shown before a first run. It is a button on every start screen, there for
// whoever wants it and every time they want it, and the words are kept to one
// line a step. Where a game has a practice round (Word Ladder), the sheet's main
// button starts it.
//
// Every rule stated here is the game's real rule. Do not add a step for
// something the game does not do.

import { useEffect, useState, type ReactNode } from "react";
import { track } from "@/lib/track";

export type HowToGame = "ladder" | "stack" | "rhythm" | "simon" | "strike" | "nepa3d";
interface Step { title: string; text: ReactNode; art: ReactNode }
const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';

/* ── the pictures ─────────────────────────────────────────────────────────────
   Each is drawn on a stage 120px square, and the whole stage is scaled to fit
   its box (.ht-stage), so a picture is laid out once and looks the same at any size. */
const Tap = ({ x, y, d = 0, hold = false }: { x: number; y: number; d?: number; hold?: boolean }) => <i className={hold ? "ht-tap ht-hold" : "ht-tap"} style={{ left: x, top: y, animationDelay: `${d}s` }} />;
const Tile = ({ ch, x, y, on, sel }: { ch: string; x: number; y: number; on?: boolean; sel?: boolean }) => <b className={`ht-tile${on ? " on" : ""}${sel ? " sel" : ""}`} style={{ left: x, top: y }}>{ch}</b>;

const ART: Record<HowToGame, ReactNode[]> = {
  ladder: [
    <>{"COLD".split("").map((c, i) => <Tile key={i} ch={c} x={8 + i * 27} y={46} sel={i === 2} on={i === 1 || i === 3} />)}<Tap x={62} y={60} /></>,
    <>
      {"CO".split("").map((c, i) => <Tile key={i} ch={c} x={8 + i * 27} y={22} on={i === 1} />)}
      <b className="ht-tile sel ht-swap-a" style={{ left: 62, top: 22 }}>L</b><b className="ht-tile on ht-swap-b" style={{ left: 62, top: 22 }}>R</b>
      <Tile ch="D" x={89} y={22} on />
      {"ERT".split("").map((c, i) => <b key={c} className={`ht-key${c === "R" ? " hot" : ""}`} style={{ left: 22 + i * 27, top: 76 }}>{c}</b>)}
      <Tap x={49} y={88} />
    </>,
    <>
      {["COLD", "CORD", "WORD"].map((w, r) => w.split("").map((c, i) => <b key={`${r}${i}`} className={`ht-tile sm ht-row${r}${c === "WORD"[i] ? " on" : ""}`} style={{ left: 18 + i * 22, top: 12 + r * 26 }}>{c}</b>))}
      <em className="ht-clock">3:00</em>
    </>,
  ],
  stack: [
    <><i className="ht-blk" style={{ left: 32, top: 94, width: 56 }} /><i className="ht-blk b2" style={{ left: 32, top: 78, width: 56 }} /><i className="ht-blk b3 ht-slide" style={{ left: 32, top: 40, width: 56 }} /><Tap x={60} y={104} /></>,
    <><i className="ht-blk" style={{ left: 26, top: 94, width: 56 }} /><i className="ht-blk b2" style={{ left: 26, top: 78, width: 56 }} /><i className="ht-blk b3 ht-land" style={{ left: 44, top: 62, width: 38 }} /><i className="ht-blk b3 ht-cut" style={{ left: 82, top: 62, width: 18 }} /></>,
    <><i className="ht-blk" style={{ left: 32, top: 94, width: 56 }} /><i className="ht-blk b2" style={{ left: 32, top: 78, width: 56 }} /><i className="ht-blk b3 ht-perfect" style={{ left: 32, top: 62, width: 56 }} /><em className="ht-word ht-pop">PERFECT</em></>,
  ],
  rhythm: [
    <>{[0, 1, 2, 3].map((l) => <i key={l} className="ht-lane" style={{ left: 18 + l * 28 }} />)}<i className="ht-line" /><i className="ht-note ht-fall" style={{ left: 35 }} /><Tap x={46} y={96} d={0.98} /></>,
    <>{[0, 1, 2, 3].map((l) => <i key={l} className="ht-lane" style={{ left: 18 + l * 28 }} />)}<i className="ht-line" /><i className="ht-note ht-fall" style={{ left: 7 }} /><i className="ht-note n2 ht-fall" style={{ left: 63, animationDelay: "0.5s" }} /><em className="ht-word ht-combo"><span>x2</span><span>x3</span><span>x4</span></em></>,
    <>{[0, 1, 2, 3].map((l) => <i key={l} className="ht-lane" style={{ left: 18 + l * 28 }} />)}<i className="ht-line" /><i className="ht-note long ht-fall-long" style={{ left: 63 }} /><Tap x={74} y={96} hold /></>,
  ],
  simon: [
    <>{["r", "c", "y", "g"].map((p, i) => <i key={p} className={`ht-pad ${p} ht-lit${i}`} style={{ left: 22 + (i % 2) * 40, top: 20 + Math.floor(i / 2) * 40 }} />)}<em className="ht-cap">WATCH</em></>,
    <>{["r", "c", "y", "g"].map((p, i) => <i key={p} className={`ht-pad ${p} ht-lit${i}`} style={{ left: 22 + (i % 2) * 40, top: 20 + Math.floor(i / 2) * 40 }} />)}<Tap x={41} y={39} d={0} /><Tap x={41} y={79} d={0.9} /><Tap x={81} y={39} d={1.8} /><em className="ht-cap">YOUR TURN</em></>,
    <><em className="ht-round">Round 3</em><span className="ht-dots">{[0, 1, 2].map((k) => <i key={k} />)}<i className="ht-newdot" /></span><em className="ht-cap warn">One mistake ends it</em></>,
  ],
  strike: [
    <><i className="ht-road" />{[0, 1, 2].map((k) => <i key={k} className="ht-bottle" style={{ left: 48 + k * 10, top: 20 }} />)}<i className="ht-tyre ht-roll" /><i className="ht-swipe" /></>,
    <><i className="ht-road" />{[0, 1, 2].map((k) => <i key={k} className="ht-bottle" style={{ left: 48 + k * 10, top: 20 }} />)}<i className="ht-tyre ht-hook" /><i className="ht-swipe curve" /></>,
    <><i className="ht-road" />{[0, 1, 2, 3, 4].map((k) => <i key={k} className={`ht-bottle ht-fly${k}`} style={{ left: 40 + k * 10, top: 22 }} />)}<em className="ht-word ht-pop">5 frames</em></>,
  ],
  nepa3d: [
    <><i className="ht-stick"><u /></i><i className="ht-look" /><em className="ht-cap l">MOVE</em><em className="ht-cap r">LOOK</em></>,
    <><i className="ht-breaker" /><i className="ht-bar"><u /><b /></i><Tap x={60} y={100} d={0.72} /></>,
    <>{[0, 1, 2, 3, 4].map((k) => <i key={k} className={`ht-lamp ht-lamp${k}`} style={{ left: 12 + k * 22 }} />)}<i className="ht-carx" /><em className="ht-cap warn">Cars cost a life</em></>,
  ],
};

const STEPS: Record<HowToGame, { name: string; steps: Omit<Step, "art">[] }> = {
  ladder: { name: "Word Ladder", steps: [
    { title: "Tap a letter", text: "Pick the letter you want to change." },
    { title: "Tap its new letter", text: <>The word you make has to be <b>a real word</b>. One letter at a time.</> },
    { title: "Reach the target", text: <>Solve as many as you can in <b>3 minutes</b>. Each is worth up to 20. Stuck? Skip.</> },
  ] },
  stack: { name: "Stack Tower", steps: [
    { title: "Tap to drop", text: "The block slides. Tap anywhere to drop it on the tower." },
    { title: "Overhang is sliced", text: "Whatever hangs over the edge is cut off, so the next block is smaller." },
    { title: "Land it exactly", text: <>A <b>perfect</b> drop keeps the full width and builds a combo.</> },
  ] },
  rhythm: { name: "Rhythm Rush", steps: [
    { title: "Tap on the line", text: "Tap a note as it reaches the line, in its own lane." },
    { title: "Chain a combo", text: <>Every hit in a row grows the combo, and <b>combos multiply your score</b>.</> },
    { title: "Hold the long ones", text: "A long note is held down until it ends. On a keyboard: A S D F." },
  ] },
  simon: { name: "Simon Memory", steps: [
    { title: "Watch", text: "The pads light up in an order. Do not tap yet." },
    { title: "Tap it back", text: "When it is your turn, tap the pads in the same order." },
    { title: "It gets longer", text: <>Each round adds one more. <b>One mistake ends the run.</b></> },
  ] },
  strike: { name: "Street Strike", steps: [
    { title: "Swipe up to roll", text: "Start where you want to let go, and swipe up toward the bottles." },
    { title: "Curve to hook", text: "Bend your swipe and the tyre bends on the far half of the road." },
    { title: "Knock them all down", text: <>Five frames, two throws a frame. Each <b>tyre</b> rolls differently: pick one that suits you.</> },
  ] },
  nepa3d: { name: "UP NEPA 3D", steps: [
    { title: "Two thumbs", text: "Left thumb moves you. Right thumb turns the view. It plays best with the phone sideways." },
    { title: "Flip the breaker", text: <>Run to a glowing breaker and tap when the marker is <b>in the green</b>.</> },
    { title: "Light the street", text: "Light every breaker as fast as you can, and stay out of the road." },
  ] },
};

export default function HowToPlay({ game, open, onClose, onPractice }: { game: HowToGame; open: boolean; onClose: () => void; onPractice?: () => void }) {
  useEffect(() => {
    if (!open) return;
    track("howto_open", { game: STEPS[game].name });
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [open, game, onClose]);
  if (!open) return null;
  const g = STEPS[game];
  return (
    <div className="ht" role="dialog" aria-modal="true" aria-label={`How to play ${g.name}`} onClick={onClose}>
      <div className="ht-card" onClick={(e) => e.stopPropagation()}>
        <header>
          <div><small>HOW TO PLAY</small><h2 style={{ fontFamily: DISPLAY }}>{g.name}</h2></div>
          <button className="ht-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <ol>
          {g.steps.map((s, i) => (
            <li key={s.title}>
              <div className={`ht-art ht-${game}`} aria-hidden><div className="ht-stage">{ART[game][i]}</div></div>
              <div className="ht-say"><i>{i + 1}</i><b>{s.title}</b><p>{s.text}</p></div>
            </li>
          ))}
        </ol>
        <footer>
          {onPractice && <button className="ht-main" style={{ fontFamily: DISPLAY }} onClick={() => { track("howto_practice", { game: g.name }); onPractice(); }}>Try a practice round</button>}
          <button className={onPractice ? "ht-ghost" : "ht-main"} style={onPractice ? undefined : { fontFamily: DISPLAY }} onClick={onClose}>Got it</button>
        </footer>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

/** The button for a start screen. `dark` for a button that sits on a game scene. */
export function HowToButton({ game, onPractice, dark = false, full = false, label = "How to play" }: { game: HowToGame; onPractice?: () => void; dark?: boolean; full?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={dark ? "ht-open dark" : "ht-open"} style={full ? { width: "100%" } : undefined} onClick={() => setOpen(true)}><i aria-hidden>?</i>{label}
        <style>{`.ht-open { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: 14px; border: 1px solid rgba(76,29,149,0.2); background: #fff; color: #4c1d95; font: 700 14.5px "Fredoka", system-ui, sans-serif; cursor: pointer; }
        .ht-open i { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 13px; font-weight: 800; background: #6d28d9; color: #fff; }
        .ht-open.dark { background: rgba(20,8,40,0.55); border-color: rgba(255,255,255,0.24); color: #fff; backdrop-filter: blur(4px); } .ht-open.dark i { background: #fde68a; color: #3b0764; }`}</style>
      </button>
      <HowToPlay game={game} open={open} onClose={() => setOpen(false)} onPractice={onPractice ? () => { setOpen(false); onPractice(); } : undefined} />
    </>
  );
}

const CSS = `
.ht { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: flex-end; justify-content: center; background: rgba(27,13,66,0.58); animation: htIn 0.18s ease-out; font-family: "Fredoka", system-ui, sans-serif; }
.ht-card { text-align: left; width: 100%; max-width: 520px; max-height: 92dvh; overflow: auto; padding: 18px 16px calc(16px + env(safe-area-inset-bottom, 0px)); border-radius: 28px 28px 0 0; background: linear-gradient(180deg, #fbf8ff, #f0e8ff); color: #22104f; box-shadow: 0 -10px 50px rgba(27,13,66,0.35); animation: htUp 0.26s cubic-bezier(0.2, 0.9, 0.3, 1); }
.ht-card header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ht-card small { font-size: 11px; font-weight: 700; letter-spacing: 0.16em; color: rgba(34,16,79,0.62); }
.ht-card h2 { margin: 0; font-size: 26px; line-height: 1.1; color: #22104f; }
.ht-x { flex: none; width: 44px; height: 44px; border-radius: 14px; border: 1px solid rgba(76,29,149,0.16); background: #fff; color: #22104f; font-size: 24px; line-height: 1; cursor: pointer; }
.ht-card ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.ht-card li { display: flex; align-items: center; gap: 14px; padding: 10px; border-radius: 20px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.1), 0 6px 16px rgba(76,29,149,0.07); }
.ht-say { flex: 1; min-width: 0; }
.ht-say i { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 8px; border-radius: 50%; background: #6d28d9; color: #fff; font-style: normal; font-size: 12.5px; font-weight: 800; vertical-align: 2px; }
.ht-say b { font-size: 17px; color: #22104f; }
.ht-say p { margin: 4px 0 0; font-size: 14px; line-height: 1.4; color: rgba(34,16,79,0.74); }
.ht-say p b { font-size: inherit; }
.ht-card footer { display: grid; gap: 8px; margin-top: 14px; }
.ht-main { min-height: 52px; border: none; border-radius: 16px; background: linear-gradient(180deg, #7c3aed, #6d28d9); box-shadow: 0 4px 0 #4c1d95; color: #fff !important; font-size: 19px; cursor: pointer; }
.ht-ghost { min-height: 46px; border-radius: 16px; border: 1px solid rgba(76,29,149,0.2); background: #fff; color: #4c1d95; font: 700 15px "Fredoka", system-ui, sans-serif; cursor: pointer; }
@keyframes htIn { from { opacity: 0; } } @keyframes htUp { from { transform: translateY(30px); opacity: 0; } }
@media (min-width: 760px) {
  .ht { align-items: center; padding: 24px; }
  .ht-card { max-width: 860px; border-radius: 28px; padding: 24px; }
  .ht-card ol { grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .ht-card li { flex-direction: column; align-items: stretch; padding: 14px; gap: 12px; }
  .ht-card li .ht-art { width: 216px; height: 216px; margin: 0 auto; border-radius: 22px; }
  .ht-card li .ht-stage { transform: scale(1.8); }
  .ht-card footer { grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); max-width: 520px; margin: 18px auto 0; }
}

/* the stage */
.ht-art { position: relative; flex: none; width: 108px; height: 108px; border-radius: 16px; overflow: hidden; background: radial-gradient(120% 120% at 30% 10%, #3b1a8f 0%, #1b0d42 70%); }
.ht-stage { position: absolute; left: 0; top: 0; width: 120px; height: 120px; transform: scale(0.9); transform-origin: 0 0; }
.ht-stage > * { position: absolute; font-style: normal; text-decoration: none; }
.ht-stage em { left: 0; width: 120px; text-align: center; font-weight: 800; }
.ht-tap { width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 2.5px solid #fff; background: rgba(255,255,255,0.28); opacity: 0; animation: htTap 1.8s ease-out infinite; }
.ht-tap.ht-hold { animation: htHold 2.4s linear infinite; }
@keyframes htTap { 0% { opacity: 0; transform: scale(1.5); } 15% { opacity: 1; transform: scale(0.8); } 35% { opacity: 0.9; transform: scale(1); } 60%, 100% { opacity: 0; transform: scale(1.7); } }
@keyframes htHold { 0%, 30% { opacity: 0; transform: scale(1.5); } 40%, 86% { opacity: 1; transform: scale(0.85); } 100% { opacity: 0; transform: scale(1.5); } }
.ht-cap { top: 102px; font-size: 9.5px; letter-spacing: 0.12em; color: rgba(255,255,255,0.86); }
.ht-cap.warn { color: #fca5a5; font-size: 8.5px; letter-spacing: 0.03em; } .ht-stage em.ht-cap.l { width: 60px; } .ht-stage em.ht-cap.r { left: 60px; width: 60px; }
.ht-word { top: 28px; font-size: 14px; color: #fde68a; text-shadow: 0 2px 0 rgba(0,0,0,0.3); }
.ht-pop { opacity: 0; animation: htPop 2.4s ease-out infinite; }
@keyframes htPop { 0%, 32% { opacity: 0; transform: scale(0.5); } 40% { opacity: 1; transform: scale(1.25); } 50%, 86% { opacity: 1; transform: scale(1); } 100% { opacity: 0; } }

/* Word Ladder */
.ht-tile { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; background: #fff; color: #22104f; font: 800 13px "Fredoka", system-ui, sans-serif; box-shadow: 0 2px 0 rgba(0,0,0,0.28); }
.ht-tile.on { background: #43a047; color: #fff; }
.ht-tile.sel { box-shadow: 0 0 0 2.5px #fde68a, 0 2px 0 rgba(0,0,0,0.28); animation: htSel 1.8s ease-in-out infinite; }
.ht-tile.sm { width: 20px; height: 20px; font-size: 11px; border-radius: 5px; }
@keyframes htSel { 50% { transform: scale(1.12); } }
.ht-swap-a { animation: htSwapA 2.4s linear infinite; } .ht-swap-b { animation: htSwapB 2.4s linear infinite; }
@keyframes htSwapA { 0%, 44% { opacity: 1; transform: scaleX(1); } 50%, 100% { opacity: 0; transform: scaleX(0); } }
@keyframes htSwapB { 0%, 49% { opacity: 0; transform: scaleX(0); } 56% { opacity: 1; transform: scale(1.2); } 64%, 100% { opacity: 1; transform: scale(1); } }
.ht-key { width: 22px; height: 26px; display: grid; place-items: center; border-radius: 5px; background: #fff; color: #22104f; font: 700 12px "Fredoka", system-ui, sans-serif; box-shadow: 0 2px 0 rgba(0,0,0,0.3); }
.ht-key.hot { background: #fde68a; }
.ht-ladder .ht-tap { animation-duration: 2.4s; }
.ht-row1 { animation: htRow1 3.2s linear infinite; } .ht-row2 { animation: htRow2 3.2s linear infinite; }
@keyframes htRow1 { 0%, 22% { opacity: 0; transform: translateY(-6px); } 30%, 100% { opacity: 1; transform: none; } }
@keyframes htRow2 { 0%, 52% { opacity: 0; transform: translateY(-6px); } 60%, 100% { opacity: 1; transform: none; } }
.ht-stage em.ht-clock { left: auto; right: 8px; width: auto; top: 96px; padding: 2px 7px; border-radius: 999px; background: rgba(255,255,255,0.14); font-size: 11px; color: #fde68a; }

/* Stack Tower */
.ht-blk { height: 15px; border-radius: 3px; background: linear-gradient(180deg, #22d3ee, #0891b2); box-shadow: 0 2px 0 rgba(0,0,0,0.3); }
.ht-blk.b2 { background: linear-gradient(180deg, #a78bfa, #7c3aed); } .ht-blk.b3 { background: linear-gradient(180deg, #f9a8d4, #db2777); }
.ht-slide { animation: htSlide 1.5s ease-in-out infinite alternate; } @keyframes htSlide { from { transform: translateX(-28px); } to { transform: translateX(28px); } }
.ht-land { animation: htLand 2.4s ease-in infinite; } @keyframes htLand { 0% { transform: translateY(-30px); } 28%, 100% { transform: none; } }
.ht-cut { border-radius: 0 3px 3px 0; animation: htCut 2.4s ease-in infinite; } @keyframes htCut { 0% { transform: translateY(-30px); opacity: 1; } 28%, 40% { transform: none; opacity: 1; } 90%, 100% { transform: translate(8px, 60px) rotate(50deg); opacity: 0; } }
.ht-perfect { animation: htPerfect 2.4s ease-in infinite; } @keyframes htPerfect { 0% { transform: translateY(-30px); } 28% { transform: none; filter: brightness(1); box-shadow: 0 2px 0 rgba(0,0,0,0.3); } 36% { filter: brightness(1.7); box-shadow: 0 0 18px #fde68a; } 70%, 100% { filter: brightness(1); box-shadow: 0 2px 0 rgba(0,0,0,0.3); } }

/* Rhythm Rush */
.ht-lane { top: 0; width: 1px; height: 120px; background: rgba(255,255,255,0.14); }
.ht-line { left: 6px; top: 94px; width: 108px; height: 3px; border-radius: 2px; background: #fde68a; box-shadow: 0 0 10px rgba(253,230,138,0.7); }
.ht-note { top: 0; width: 22px; height: 12px; border-radius: 4px; background: #f472b6; }
.ht-note.n2 { background: #22d3ee; }
.ht-fall { animation: htFall 1.8s linear infinite; } @keyframes htFall { 0% { transform: translateY(-14px); opacity: 1; } 55% { transform: translateY(84px); opacity: 1; } 62%, 100% { transform: translateY(84px) scale(1.5); opacity: 0; } }
.ht-note.long { height: 44px; background: linear-gradient(180deg, #c4b5fd, #7c3aed); }
.ht-fall-long { animation: htFallLong 2.4s linear infinite; } @keyframes htFallLong { 0% { transform: translateY(-46px); height: 44px; } 40% { transform: translateY(50px); height: 44px; } 86%, 100% { transform: translateY(94px); height: 0; } }
.ht-combo span { position: absolute; left: 0; width: 120px; opacity: 0; font-size: 20px; animation: htSeq 2.7s ease-out infinite; }
.ht-combo span:nth-child(2) { animation-delay: 0.9s; } .ht-combo span:nth-child(3) { animation-delay: 1.8s; }
@keyframes htSeq { 0% { opacity: 0; transform: scale(0.6); } 8% { opacity: 1; transform: scale(1.2); } 28% { opacity: 1; transform: scale(1); } 34%, 100% { opacity: 0; } }

/* Simon Memory */
.ht-pad { width: 36px; height: 36px; border-radius: 9px; opacity: 0.32; }
.ht-pad.r { background: #ef4444; } .ht-pad.c { background: #06b6d4; } .ht-pad.y { background: #facc15; } .ht-pad.g { background: #22c55e; }
.ht-lit0, .ht-lit1, .ht-lit2 { animation: htLit 2.7s linear infinite; } .ht-lit2 { animation-delay: 0.9s; } .ht-lit1 { animation-delay: 1.8s; }
@keyframes htLit { 0% { opacity: 0.32; } 4%, 24% { opacity: 1; box-shadow: 0 0 16px rgba(255,255,255,0.6); } 32%, 100% { opacity: 0.32; box-shadow: none; } }
.ht-simon .ht-tap { animation: htTapSlow 2.7s ease-out infinite; }
@keyframes htTapSlow { 0% { opacity: 0; transform: scale(1.5); } 8% { opacity: 1; transform: scale(0.8); } 22% { opacity: 0.9; transform: scale(1); } 34%, 100% { opacity: 0; transform: scale(1.7); } }
.ht-stage em.ht-round { top: 24px; font-size: 16px; color: #fff; }
.ht-dots { left: 0; top: 56px; width: 120px; display: flex; justify-content: center; gap: 7px; }
.ht-dots i { width: 13px; height: 13px; border-radius: 50%; background: #a78bfa; }
.ht-dots i.ht-newdot { background: #fde68a; animation: htNew 1.8s ease-out infinite; } @keyframes htNew { 0%, 30% { transform: scale(0); } 45% { transform: scale(1.4); } 60%, 100% { transform: scale(1); } }

/* Street Strike */
.ht-road { left: 0; top: 0; width: 120px; height: 120px; clip-path: polygon(40% 10%, 60% 10%, 94% 100%, 6% 100%); background: linear-gradient(180deg, #5b5475, #2a2540); }
.ht-bottle { width: 6px; height: 14px; border-radius: 2px 2px 1px 1px; background: #86efac; box-shadow: 0 1px 0 rgba(0,0,0,0.4); }
.ht-tyre { left: 49px; top: 90px; width: 22px; height: 22px; border-radius: 50%; border: 6px solid #111827; background: #9ca3af; box-sizing: border-box; }
.ht-roll { animation: htRoll 1.8s ease-out infinite; } @keyframes htRoll { 0%, 18% { transform: none; } 72%, 100% { transform: translateY(-64px) scale(0.5); } }
.ht-hook { animation: htHook 1.8s ease-out infinite; } @keyframes htHook { 0%, 18% { transform: none; } 45% { transform: translate(16px, -30px) scale(0.78); } 72%, 100% { transform: translate(1px, -64px) scale(0.5); } }
.ht-swipe { left: 58px; top: 66px; width: 4px; height: 46px; border-radius: 2px; background: linear-gradient(to top, rgba(253,230,138,0), #fde68a); transform-origin: 50% 100%; animation: htSwipe 1.8s ease-out infinite; }
.ht-swipe.curve { left: 58px; width: 22px; background: none; border-left: 4px solid #fde68a; border-top: 4px solid #fde68a; border-radius: 22px 0 0 0; border-right: 0; border-bottom: 0; box-sizing: border-box; transform-origin: 0 100%; }
@keyframes htSwipe { 0% { transform: scaleY(0); opacity: 1; } 16% { transform: scaleY(1); opacity: 1; } 40%, 100% { transform: scaleY(1); opacity: 0; } }
.ht-fly0, .ht-fly1 { animation: htFlyL 2.4s ease-out infinite; } .ht-fly2 { animation: htFlyU 2.4s ease-out infinite; } .ht-fly3, .ht-fly4 { animation: htFlyR 2.4s ease-out infinite; }
.ht-fly1 { animation-delay: 0.05s; } .ht-fly4 { animation-delay: 0.05s; }
@keyframes htFlyL { 0%, 30% { transform: none; opacity: 1; } 70%, 100% { transform: translate(-26px, 18px) rotate(-100deg); opacity: 0.2; } }
@keyframes htFlyR { 0%, 30% { transform: none; opacity: 1; } 70%, 100% { transform: translate(26px, 18px) rotate(100deg); opacity: 0.2; } }
@keyframes htFlyU { 0%, 30% { transform: none; opacity: 1; } 70%, 100% { transform: translate(2px, -14px) rotate(180deg); opacity: 0.2; } }
.ht-strike .ht-word { top: 66px; }

/* UP NEPA 3D */
.ht-stick { left: 10px; top: 46px; width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); background: rgba(255,255,255,0.08); box-sizing: border-box; }
.ht-stick u { position: absolute; left: 11px; top: 11px; width: 18px; height: 18px; border-radius: 50%; background: #fff; animation: htKnob 2.4s ease-in-out infinite; }
@keyframes htKnob { 0%, 100% { transform: none; } 30% { transform: translate(9px, -9px); } 65% { transform: translate(-8px, 6px); } }
.ht-look { left: 72px; top: 60px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: -10px 0 0 -4px rgba(255,255,255,0.35); animation: htLook 2.4s ease-in-out infinite; }
@keyframes htLook { 0%, 100% { transform: none; } 50% { transform: translateX(22px); } }
.ht-breaker { left: 44px; top: 12px; width: 32px; height: 42px; border-radius: 6px; background: #1f2937; border: 2px solid #fde68a; box-sizing: border-box; animation: htGlow 1.8s ease-in-out infinite; }
@keyframes htGlow { 0%, 100% { box-shadow: 0 0 6px rgba(253,230,138,0.5); } 50% { box-shadow: 0 0 18px rgba(253,230,138,0.95); } }
.ht-bar { left: 14px; top: 70px; width: 92px; height: 12px; border-radius: 6px; background: rgba(255,255,255,0.18); }
.ht-bar b { position: absolute; left: 34px; top: 0; width: 24px; height: 12px; background: #22c55e; }
.ht-bar u { position: absolute; left: 0; top: -3px; width: 4px; height: 18px; border-radius: 2px; background: #fff; animation: htMark 1.8s linear infinite alternate; } @keyframes htMark { to { transform: translateX(88px); } }
.ht-lamp { top: 30px; width: 13px; height: 13px; border-radius: 50%; background: #4b5563; animation: htLamp 3.2s linear infinite; }
.ht-lamp1 { animation-delay: 0.4s; } .ht-lamp2 { animation-delay: 0.8s; } .ht-lamp3 { animation-delay: 1.2s; } .ht-lamp4 { animation-delay: 1.6s; }
@keyframes htLamp { 0% { background: #4b5563; box-shadow: none; } 10%, 60% { background: #fde68a; box-shadow: 0 0 12px rgba(253,230,138,0.9); } 70%, 100% { background: #4b5563; box-shadow: none; } }
.ht-carx { left: 0; top: 64px; width: 28px; height: 14px; border-radius: 4px; background: #ef4444; box-shadow: inset -7px 0 0 rgba(255,255,255,0.25); animation: htCar 2.4s linear infinite; } @keyframes htCar { from { transform: translateX(-34px); } to { transform: translateX(126px); } }

@media (prefers-reduced-motion: reduce) { .ht, .ht-card, .ht-stage * { animation: none !important; } .ht-tap { opacity: 0.9; } .ht-pop, .ht-combo span:last-child { opacity: 1; } }
`;
