"use client";

// ─── A player's game, as a spectator sees it ─────────────────────────────────
// Each game sends a few numbers about its screen while a round is played
// (hooks/useFriendRoom → progress(n, live)). This draws the game from them: a
// tower that grows, a ladder whose tiles turn green, a Simon pad on its round,
// a Rhythm combo, a street lighting up. It is a picture of the play, not a
// video of it, so it costs almost nothing to send and works on a weak line.
//
// Word Ladder shows which letters are in place and never the letters: everyone
// in the room has the same words, so the letters would be the answer.

import { score as strikeScore } from "@/app/bowling/scoring";
import type { LiveState } from "@/hooks/useFriendRoom";
import StackReplay from "@/components/StackReplay";
import RhythmReplay from "@/components/RhythmReplay";
import SimonReplay from "@/components/SimonReplay";

const n = (v: unknown, d = 0) => (typeof v === "number" ? v : d);

const STRIKE_FRAMES = 5; // a Street Strike card (app/bowling)
export default function LiveBoard({ game, live, done, progress, goal }: { game: string; live?: LiveState; done: boolean; progress: number; goal: number }) {
  if (game === "ladder") {
    const rows = (Array.isArray(live?.rows) ? (live!.rows as number[][]) : []).filter((r) => Array.isArray(r)); const ix = Math.min(5, n(live?.ix, progress));
    return (
      <div className="lb ladder">
        <div className="lb-cap">{done ? "All 5 ladders done" : `Ladder ${Math.min(5, ix + 1)} of 5`}</div>
        <div className="lb-rows">{(rows.length ? rows : [[0, 0, 0, 0]]).slice(-6).map((r, i, all) => <div key={i} className={i === all.length - 1 ? "cur" : ""}>{[0, 1, 2, 3].map((k) => <i key={k} className={r[k] ? "hit" : ""} />)}</div>)}</div>
        <div className="lb-dots">{[0, 1, 2, 3, 4].map((k) => <i key={k} className={k < ix ? "on" : ""} />)}</div>
      </div>
    );
  }
  // Stack Tower sends its real tower: draw the game itself
  if (game === "stack" && Array.isArray(live?.blocks)) return <StackReplay live={live} done={done} />;
  if (game === "stack") {
    const lv = n(live?.lv, progress); const combo = n(live?.combo); const show = Math.min(lv, 11);
    return (
      <div className="lb stack">
        <div className="lb-cap">{lv} {lv === 1 ? "block" : "blocks"}{combo >= 3 ? <b> · {combo}× perfect</b> : null}</div>
        <div className="lb-tower">{Array.from({ length: show }, (_, k) => { const from = lv - show + k; return <i key={from} style={{ background: `hsl(${(250 + from * 14) % 360} 78% 62%)`, width: `${Math.max(34, 92 - Math.min(from, 20) * 2.4)}%` }} />; }).reverse()}{lv === 0 && <em>Waiting for the first drop</em>}</div>
      </div>
    );
  }
  // Simon Memory sends its pattern and every press: light the pad as the player's lights
  if (game === "simon" && Array.isArray(live?.seq)) return <SimonReplay live={live} done={done} />;
  if (game === "simon") {
    const round = n(live?.round, progress);
    return (
      <div className="lb simon">
        <div className="lb-pad"><i style={{ background: "#ef4444" }} /><i style={{ background: "#14b8a6" }} /><i style={{ background: "#eab308" }} /><i style={{ background: "#22c55e" }} /><b>{round + 1}</b></div>
        <div className="lb-cap">{done ? `Out on round ${round + 1}` : `Round ${round + 1} · ${round + 1} to remember`}</div>
      </div>
    );
  }
  // Rhythm Rush sends its tiles and its clock: draw the song itself
  if (game === "rhythm" && Array.isArray(live?.notes)) return <RhythmReplay live={live} done={done} />;
  if (game === "rhythm") {
    const combo = n(live?.combo); const streak = n(live?.streak);
    return (
      <div className="lb rhythm">
        <div className="lb-lanes">{["#e879f9", "#38bdf8", "#facc15", "#4ade80"].map((c, k) => <i key={k} style={{ background: c, height: `${28 + ((combo * (k + 3) * 7) % 62)}%` }} />)}</div>
        <div className="lb-cap">{combo > 1 ? <b>{combo}× combo</b> : "Finding the beat"}{streak >= 4 ? " · on fire" : ""}</div>
      </div>
    );
  }
  // Street Strike: the card, frame by frame, as it fills in
  if (game === "strike") {
    const rolls = Array.isArray(live?.rolls) ? (live!.rolls as number[]).filter((n) => typeof n === "number") : [];
    const card = strikeScore(rolls, STRIKE_FRAMES);
    return (
      <div className="lb">
        <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
          {card.frames.map((f, i) => (
            <div key={i} style={{ flex: 1, maxWidth: 58, borderRadius: 9, padding: "5px 2px", textAlign: "center", background: f.marks.length ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", minHeight: 16 }}>{f.marks.join(" ") || "·"}</div>
              <div style={{ fontSize: 15, fontWeight: 900 }}>{f.total ?? ""}</div>
            </div>
          ))}
        </div>
        <div className="lb-cap">{done ? `Final: ${card.total}` : rolls.length ? `${card.total} so far` : "At the line"}</div>
      </div>
    );
  }
  if (game === "nepa3d") {
    const lit = n(live?.lit, progress); const lives = n(live?.lives, 3);
    return (
      <div className="lb nepa">
        <div className="lb-street">{Array.from({ length: 10 }, (_, k) => <i key={k} className={k < lit ? "on" : ""} />)}</div>
        <div className="lb-cap">{lit} of 10 shops lit · {"♥".repeat(Math.max(0, Math.min(3, lives)))}</div>
      </div>
    );
  }
  return <div className="lb"><div className="lb-cap">{Math.round((progress / Math.max(1, goal)) * 100)}% done</div></div>;
}

/** The styles, once per page (the watch page renders several boards). */
export const LIVE_BOARD_CSS = `
  .lb { display: grid; gap: 10px; justify-items: center; align-content: center; min-height: 300px; padding: 14px; border-radius: 18px; background: linear-gradient(180deg, #1b0d42, #2a1466); color: #fff; }
  .lb-cap { font-size: 13.5px; font-weight: 700; color: rgba(255,255,255,0.86); text-align: center; } .lb-cap b { color: #fde047; }
  .lb-rows { display: grid; gap: 6px; } .lb-rows div { display: flex; gap: 6px; opacity: 0.55; } .lb-rows div.cur { opacity: 1; }
  .lb-rows i { width: 30px; height: 30px; border-radius: 8px; background: rgba(255,255,255,0.92); transition: background .3s ease, transform .3s ease; } .lb-rows i.hit { background: #22c55e; transform: scale(1.04); }
  .lb-dots { display: flex; gap: 6px; } .lb-dots i { width: 22px; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.22); } .lb-dots i.on { background: #a78bfa; }
  .lb-tower { width: 100%; max-width: 220px; height: 140px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; } .lb-tower i { display: block; height: 10px; border-radius: 3px; animation: lbDrop .28s ease both; } .lb-tower em { font-style: normal; font-size: 13px; color: rgba(255,255,255,0.6); margin-bottom: 50px; }
  @keyframes lbDrop { from { transform: translateY(-14px); opacity: 0; } }
  .lb-pad { position: relative; width: 132px; height: 132px; border-radius: 50%; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; gap: 3px; background: #0f0630; box-shadow: 0 0 0 5px #3b1d8f; } .lb-pad i { opacity: 0.9; }
  .lb-pad b { position: absolute; inset: 0; margin: auto; width: 52px; height: 52px; border-radius: 50%; background: #0f0630; display: grid; place-items: center; font-size: 22px; color: #fde047; }
  .lb-lanes { width: 150px; height: 112px; display: flex; align-items: flex-end; gap: 8px; } .lb-lanes i { flex: 1; border-radius: 8px 8px 3px 3px; transition: height .45s cubic-bezier(.3,1.4,.5,1); }
  .lb-street { display: grid; grid-template-columns: repeat(5, 26px); gap: 9px; } .lb-street i { height: 30px; border-radius: 7px 7px 3px 3px; background: rgba(255,255,255,0.14); transition: background .4s ease, box-shadow .4s ease; } .lb-street i.on { background: #fde047; box-shadow: 0 0 16px rgba(253,224,71,0.8); }
  @media (prefers-reduced-motion: reduce) { .lb-tower i { animation: none; } .lb-rows i, .lb-lanes i, .lb-street i { transition: none; } }
`;
