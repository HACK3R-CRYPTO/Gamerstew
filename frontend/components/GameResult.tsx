"use client";

// ─── The result screen every skill game ends on ──────────────────────────────
// The partner of GameLobby: one screen, in the app's look, shared by Stack
// Tower, Simon Memory and Rhythm Rush. The game passes what is its own (the
// grade, the numbers, the save status); the order and the layout live here.
//
// The order is what a player wants next, top to bottom: how did I do, the two
// or three numbers behind it, PLAY AGAIN, then what happened to the score, then
// the extras. Play again is reachable without scrolling on a phone.

import type { ReactNode } from "react";

const DISPLAY = '"Melon Pop", "Fredoka", ui-sans-serif, system-ui, sans-serif';

export interface ResultStat { label: string; value: ReactNode; tone?: string }

export default function GameResult({
  eyebrow, tone = "#6d28d9", badge, score, scoreLabel = "Score", notes, chips, stats, meter,
  saving = false, playAgainLabel = "Play again", onPlayAgain, onExit, challengeLabel, onChallenge, status, after,
}: {
  /** one or two words on how the run went: "Great", "Tower down" */
  eyebrow: string;
  /** the colour of the grade; used for the ring and the eyebrow */
  tone?: string;
  /** a grade letter, or an emoji */
  badge: ReactNode;
  score: number;
  scoreLabel?: string;
  /** short lines under the score: a new best, a friend beaten */
  notes?: ReactNode;
  /** small pills under the notes (Rhythm's top speed) */
  chips?: ReactNode;
  stats: ResultStat[];
  /** a single bar under the stats (Rhythm's accuracy) */
  meter?: { label: string; pct: number };
  /** the score is still being saved: the buttons wait, so a reflex tap cannot cut the save short */
  saving?: boolean;
  playAgainLabel?: string;
  onPlayAgain: () => void;
  onExit: () => void;
  challengeLabel?: string | null;
  onChallenge?: () => void;
  /** what happened to the score: saved, rewards, or the prompt to sign in */
  status?: ReactNode;
  /** anything shown last: what is next this week, other games */
  after?: ReactNode;
}) {
  return (
    <div className="gr" role="dialog" aria-modal="true" aria-label="Your result">
      <main className="gr-main">
        <section className="gr-hero" style={{ ["--tone" as string]: tone }}>
          <div className="gr-eyebrow">{eyebrow}</div>
          <div className="gr-badge" style={{ fontFamily: DISPLAY }} aria-hidden>{badge}</div>
          <div className="gr-label">{scoreLabel}</div>
          <div className="gr-score" style={{ fontFamily: DISPLAY }}>{score.toLocaleString()}</div>
          {notes && <div className="gr-notes">{notes}</div>}
          {chips && <div className="gr-chips">{chips}</div>}
        </section>

        <section className="gr-stats" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(2, stats.length))}, 1fr)` }}>
          {stats.map((s) => <div key={s.label}><b style={s.tone ? { color: s.tone } : undefined}>{s.value}</b><span>{s.label}</span></div>)}
        </section>
        {meter && (
          <div className="gr-meter" role="img" aria-label={`${meter.label} ${meter.pct}%`}>
            <div><span>{meter.label}</span><b>{meter.pct}%</b></div>
            <i><u style={{ width: `${Math.max(0, Math.min(100, meter.pct))}%` }} /></i>
          </div>
        )}

        <section className="gr-actions">
          <button className="gr-play" style={{ fontFamily: DISPLAY }} onClick={onPlayAgain} disabled={saving}>{playAgainLabel}</button>
          <button className="gr-exit" onClick={onExit} disabled={saving}>Exit</button>
          {saving && <p className="gr-saving" role="status">Saving your score. One moment.</p>}
          {!saving && challengeLabel && onChallenge && <button className="gr-challenge" onClick={onChallenge}>{challengeLabel}</button>}
        </section>

        {status && <section className="gr-status">{status}</section>}
        {after && <section className="gr-after">{after}</section>}
      </main>
      <style>{`
        .gr { position: fixed; inset: 0; z-index: 9999; overflow-y: auto; overscroll-behavior: contain; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #f0e8ff 45%, #e2d6ff 100%); color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; animation: grIn .28s ease both; --line: rgba(76,29,149,0.16); --dim: rgba(34,16,79,0.66); }
        @keyframes grIn { from { opacity: 0; } }
        .gr button { font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .gr-main { width: 100%; max-width: 460px; margin: 0 auto; padding: max(18px, env(safe-area-inset-top)) 18px calc(28px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; }
        .gr-hero { display: flex; flex-direction: column; align-items: center; text-align: center; }
        .gr-eyebrow { font-size: 11.5px; font-weight: 900; letter-spacing: 0.2em; text-transform: uppercase; color: var(--tone); }
        .gr-badge { margin: 10px 0 12px; width: 92px; height: 92px; border-radius: 50%; display: grid; place-items: center; font-size: 46px; line-height: 1; color: #22104f; background: #fff; box-shadow: 0 0 0 4px var(--tone), 0 0 0 9px color-mix(in srgb, var(--tone) 18%, transparent), 0 22px 30px -18px rgba(76,29,149,0.8); animation: grPop .5s cubic-bezier(.2,.9,.3,1.3) .05s both; }
        @keyframes grPop { from { transform: scale(.6) rotate(-10deg); opacity: 0; } }
        .gr-label { font-size: 10.5px; font-weight: 900; letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim); }
        .gr-score { font-size: clamp(44px, 13vw, 60px); line-height: 1; font-weight: 400; font-variant-numeric: tabular-nums; }
        .gr-notes { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; font-size: 13.5px; line-height: 1.35; font-weight: 700; color: var(--dim); }
        .gr-notes b { color: #22104f; } .gr-notes .good { color: #166534; } .gr-notes .warm { color: #9a3412; } .gr-notes .gold { color: #92400e; }
        .gr-chips { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
        .gr-chips span { padding: 5px 11px; border-radius: 999px; background: #fff; border: 1px solid var(--line); font-size: 11.5px; font-weight: 800; letter-spacing: 0.04em; color: #4c1d95; }
        .gr-stats { display: grid; gap: 8px; }
        .gr-stats div { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 10px 4px; border-radius: 16px; background: rgba(255,255,255,0.75); border: 1px solid var(--line); }
        .gr-stats b { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; color: #22104f; }
        .gr-stats span { font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
        .gr-meter { display: flex; flex-direction: column; gap: 5px; margin-top: -4px; }
        .gr-meter div { display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); } .gr-meter b { color: #22104f; }
        .gr-meter i { display: block; height: 8px; border-radius: 999px; background: rgba(76,29,149,0.12); overflow: hidden; } .gr-meter u { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #a78bfa, #6d28d9); }
        .gr-actions { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: start; margin-top: 2px; }
        .gr-play { padding: 16px 0 18px; border: none; border-radius: 20px; background: linear-gradient(180deg, #7c3aed, #6d28d9); color: #fff; font-size: 21px; letter-spacing: 0.02em; box-shadow: 0 7px 0 #4c1d95, 0 22px 30px -16px rgba(76,29,149,0.9); transition: transform .08s, box-shadow .08s; margin-bottom: 7px; }
        .gr-play:active { transform: translateY(5px); box-shadow: 0 2px 0 #4c1d95; }
        .gr-exit { padding: 16px 22px 18px; border-radius: 20px; border: 1px solid var(--line); background: #fff; color: #22104f; font-size: 16px; font-weight: 800; margin-bottom: 7px; }
        .gr-play:disabled, .gr-exit:disabled { opacity: 0.5; cursor: default; }
        .gr-saving { grid-column: 1 / -1; margin: 0; text-align: center; font-size: 13px; font-weight: 700; color: var(--dim); }
        .gr-challenge { grid-column: 1 / -1; padding: 13px 14px; border-radius: 16px; border: 1.5px solid #fdba74; background: #fff7ed; color: #9a3412; font-size: 14px; font-weight: 800; }
        .gr-status, .gr-after { display: flex; flex-direction: column; gap: 10px; }
        .gr-status > *, .gr-after > * { margin-top: 0 !important; }
        @media (max-height: 640px) { .gr-badge { width: 72px; height: 72px; font-size: 36px; margin: 6px 0 8px; } .gr-main { gap: 10px; } .gr-play, .gr-exit { padding-top: 13px; padding-bottom: 15px; } }
        @media (min-width: 900px) { .gr { display: grid; place-items: start center; } .gr-main { margin-top: 5vh; max-width: 520px; padding: 28px; border-radius: 30px; background: rgba(255,255,255,0.6); box-shadow: 0 0 0 1px var(--line), 0 40px 60px -50px rgba(76,29,149,0.9); margin-bottom: 5vh; } }
        @media (prefers-reduced-motion: reduce) { .gr, .gr-badge { animation: none; } .gr-play { transition: none; } }
      `}</style>
    </div>
  );
}

/** Shown in place of the save status after a free mode: nothing was sent. */
export function FreePlayNote({ mode }: { mode: string }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 16, textAlign: "center", background: "rgba(255,255,255,0.75)", border: "1px solid rgba(76,29,149,0.16)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6d28d9" }}>{mode} · free play</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(34,16,79,0.68)", marginTop: 3 }}>This run was for fun. Switch to Ranked to put a score on the board.</div>
    </div>
  );
}
