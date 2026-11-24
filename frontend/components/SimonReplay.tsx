"use client";

// ─── Simon Memory, as a spectator sees it ────────────────────────────────────
// The player's phone sends the pattern when it starts being shown (with the
// game's own flash and gap times), then a message for every pad the player
// presses (app/games/simon → tellRoom). This lights the pad the same way: the
// pattern plays through at the player's speed, then each press lights its pad
// as it happens. A wrong press lights the pad that was pressed, in red.

import { useEffect, useRef, useState } from "react";
import type { LiveState } from "@/hooks/useFriendRoom";

// the game's pad colours, in the game's order: red, cyan, yellow, green, and the bonus pad in the middle
const PAD = ["#ef4444", "#06b6d4", "#eab308", "#10b981", "#a855f7"];
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);

export default function SimonReplay({ live, done }: { live?: LiveState; done: boolean }) {
  const seq = Array.isArray(live?.seq) ? (live!.seq as number[]).filter((x) => typeof x === "number") : [];
  const round = num(live?.round), show = num(live?.show) === 1, n = num(live?.n), bad = num(live?.bad), fd = Math.max(120, num(live?.fd, 400)), sd = Math.max(160, num(live?.sd, 550));
  const [lit, setLit] = useState(-1); const [wrong, setWrong] = useState(false); const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const key = seq.join("");

  // the pattern being shown: play it through at the player's own speed
  useEffect(() => {
    if (!show || done) return;
    clear(); setWrong(false); setLit(-1);
    seq.forEach((pad, i) => { timers.current.push(setTimeout(() => setLit(pad), i * sd)); timers.current.push(setTimeout(() => setLit(-1), i * sd + fd)); });
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, round, key, done]);

  // The player's turn: each press lights its pad. The page hears from the room
  // less often than a fast player taps, so several presses can arrive at once:
  // they are played one after another, in order, so none is skipped.
  const heard = useRef({ round: -1, n: 0 });
  useEffect(() => {
    if (show) { heard.current = { round, n: 0 }; return; }
    const from = heard.current.round === round ? heard.current.n : 0;
    heard.current = { round, n };
    if (n <= from && bad === 0) return;
    clear();
    const offset = round - seq.length; // a long pattern arrives as its last twelve
    const pads: { pad: number; wrong: boolean }[] = [];
    for (let k = from; k < n; k++) { const last = k === n - 1; const pad = last && bad > 0 ? bad - 1 : seq[k - offset]; if (typeof pad === "number") pads.push({ pad, wrong: last && bad > 0 }); }
    pads.forEach((x, i) => {
      timers.current.push(setTimeout(() => { setWrong(x.wrong); setLit(x.pad); }, i * 240));
      timers.current.push(setTimeout(() => setLit(-1), i * 240 + (x.wrong ? 900 : 180)));
    });
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, bad, show, round]);

  const what = !live || !seq.length ? "Getting ready" : done ? `Out on round ${round}` : bad > 0 ? "Wrong pad" : show ? "Watching the pattern" : `Their turn · ${Math.min(n, round)} of ${round}`;
  return (
    <div className={`sm${wrong ? " wrong" : ""}`}>
      <div className="sm-pad" role="img" aria-label={`Simon Memory, round ${round}. ${what}`}>
        {[0, 1, 2, 3].map((k) => <i key={k} className={lit === k ? "on" : ""} style={{ ["--c" as string]: wrong && lit === k ? "#ef4444" : PAD[k] }} />)}
        <b className={lit === 4 ? "on" : ""}><span>{round || "–"}</span><small>round</small></b>
      </div>
      <div className="sm-cap">{what}</div>
      <div className="sm-dots" aria-hidden>{Array.from({ length: Math.min(round, 14) }, (_, k) => <u key={k} className={!show && k < n ? "on" : ""} />)}</div>
      <style>{`
        .sm { display: grid; gap: 12px; justify-items: center; align-content: center; min-height: 300px; padding: 16px; border-radius: 18px; background: radial-gradient(120% 90% at 50% 20%, #2a1466 0%, #12052e 100%); color: #fff; }
        .sm-pad { position: relative; width: 190px; height: 190px; border-radius: 50%; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; background: #0c0326; box-shadow: 0 0 0 7px #3b1d8f, 0 18px 40px -10px rgba(0,0,0,0.8); }
        .sm-pad i { background: var(--c); opacity: 0.34; transition: opacity .09s ease, filter .09s ease, box-shadow .09s ease; }
        .sm-pad i.on { opacity: 1; filter: brightness(1.35) saturate(1.2); box-shadow: inset 0 0 34px rgba(255,255,255,0.75), 0 0 40px var(--c); }
        .sm-pad b { position: absolute; inset: 0; margin: auto; width: 76px; height: 76px; border-radius: 50%; background: #0c0326; display: grid; place-items: center; align-content: center; box-shadow: 0 0 0 4px #1b0d42; transition: box-shadow .1s ease; }
        .sm-pad b.on { box-shadow: 0 0 0 4px #a855f7, 0 0 30px #a855f7; } .sm-pad b span { font-size: 28px; font-weight: 900; color: #fde047; line-height: 1; } .sm-pad b small { font-size: 9px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(255,255,255,0.6); }
        .sm.wrong .sm-pad { animation: smShake .4s ease; } @keyframes smShake { 20% { transform: translateX(-7px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(4px); } }
        .sm-cap { font-size: 14px; font-weight: 800; color: rgba(255,255,255,0.92); } .sm.wrong .sm-cap { color: #fca5a5; }
        .sm-dots { display: flex; gap: 5px; min-height: 8px; } .sm-dots u { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.22); } .sm-dots u.on { background: #4ade80; }
        @media (min-width: 900px) { .sm { min-height: 360px; } .sm-pad { width: 220px; height: 220px; } }
        @media (prefers-reduced-motion: reduce) { .sm-pad i { transition: none; } .sm.wrong .sm-pad { animation: none; } }
      `}</style>
    </div>
  );
}
