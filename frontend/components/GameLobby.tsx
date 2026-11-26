"use client";
import { HowToButton, type HowToGame } from "@/components/HowToPlay";
import EnergyLine from "@/components/EnergyLine";
import { track } from "@/lib/track";

// ─── The lobby every skill game opens on ─────────────────────────────────────
// One start screen, in the app's Lilac look, shared by Stack Tower, Simon
// Memory and Rhythm Rush (Word Ladder's own start screen is the model). The
// game passes what is its own: art, one line of rules, its modes, and any
// extra controls. Nothing here starts a run; that only happens on Play.
//
// Phone: one column, Play reachable without hunting. Desktop: art and the
// leaderboard on the left, the controls in a card on the right.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { GameTypeId, LeaderboardEntry } from "@/lib/subgraph";
import { fetchPreview, getCachedPreview } from "@/lib/leaderboardPreview";

const DISPLAY = '"Melon Pop", "Fredoka", ui-sans-serif, system-ui, sans-serif';

export interface LobbyMode { id: string; name: string; tag: string; blurb: string }

export default function GameLobby<M extends string>({
  title, headline, rules, cover, focus = "50% 50%", onExit, onStart, startLabel = "Play",
  modes, mode, onPickMode, gameType, onLeaderboard, scoreWord = "Top players",
  guest, guestLeft, needsSetup, onFinishSetup, gasBanner, challenge, extra, friends, howTo,
}: {
  /** which game's "How to play" sheet the lobby offers */
  howTo?: HowToGame;
  title: string;
  /** the game in one short line */
  headline: ReactNode;
  /** how to play, a sentence or two */
  rules: ReactNode;
  cover: string;
  focus?: string;
  onExit: () => void;
  onStart: () => void;
  startLabel?: string;
  modes: (LobbyMode & { id: M })[];
  mode: M;
  onPickMode: (m: M) => void;
  gameType: GameTypeId;
  onLeaderboard: () => void;
  scoreWord?: string;
  guest?: boolean;
  guestLeft?: number;
  needsSetup?: boolean;
  onFinishSetup?: () => void;
  gasBanner?: ReactNode;
  /** "Tunde reached round 9. Go deeper." */
  challenge?: ReactNode;
  /** game-specific controls shown above Play (Rhythm's song picker) */
  extra?: ReactNode;
  /** play-with-friends entry, shown under Play */
  friends?: ReactNode;
}) {
  const current = modes.find((m) => m.id === mode) ?? modes[0];
  return (
    <div className="gl">
      <header className="gl-top">
        <button className="gl-back" onClick={onExit} aria-label="Back">←</button>
        <b style={{ fontFamily: DISPLAY }}>{title}</b>
        <span />
      </header>

      <main className="gl-main">
        <section className="gl-show">
          <div className="gl-art" style={{ backgroundImage: `url(${cover})`, backgroundPosition: focus }} role="img" aria-label={title} />
          <h1 style={{ fontFamily: DISPLAY }}>{headline}</h1>
          <p className="gl-rules">{rules}</p>
          {howTo && <div className="gl-how"><HowToButton game={howTo} /></div>}
          <div className="gl-board gl-wide"><TopPlayers gameType={gameType} label={scoreWord} onViewAll={onLeaderboard} /></div>
        </section>

        <section className="gl-panel">
          {challenge && <div className="gl-challenge"><em>You have been challenged</em><span>{challenge}</span></div>}

          <div className="gl-modes" role="radiogroup" aria-label="How to play">
            {modes.map((m) => (
              <button key={m.id} role="radio" aria-checked={m.id === mode} className={m.id === mode ? "on" : ""} onClick={() => onPickMode(m.id)}>
                {m.name}<i>{m.tag}</i>
              </button>
            ))}
          </div>
          <p className="gl-blurb">{current.blurb}</p>

          {extra}

          <button className="gl-play" style={{ fontFamily: DISPLAY }} onClick={() => { track("game_start", { game: title }); onStart(); }}>{startLabel}</button>
          {mode === "ranked" && <div className="gl-energy"><EnergyLine /></div>}
          {friends}

          {guest && (
            <p className="gl-note">
              {typeof guestLeft === "number" ? (guestLeft > 0 ? `Playing as a guest. ${guestLeft} free ${guestLeft === 1 ? "play" : "plays"} left. ` : "Free plays used. ") : "Playing as a guest. "}
              <Link href="/home?signin=1">Sign in</Link> to rank your scores.
            </p>
          )}
          {needsSetup && onFinishSetup && (
            <p className="gl-note">You can play now. <button onClick={onFinishSetup}>Finish setup</button> to save your scores.</p>
          )}
          {gasBanner && <div className="gl-gas">{gasBanner}</div>}
        </section>

        <div className="gl-board gl-narrow"><TopPlayers gameType={gameType} label={scoreWord} onViewAll={onLeaderboard} /></div>
      </main>

      <style>{`
        .gl { position: absolute; inset: 0; z-index: 10; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #f0e8ff 45%, #e2d6ff 100%); color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; text-align: left; --brand: #6d28d9; --line: rgba(76,29,149,0.16); --dim: rgba(34,16,79,0.64); }
        .gl button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .gl-top { flex: none; display: grid; grid-template-columns: 56px 1fr 56px; align-items: center; padding: calc(10px + env(safe-area-inset-top)) 14px 4px; text-align: center; }
        .gl-top b { font-size: 20px; font-weight: 400; }
        .gl-back { width: 40px; height: 40px; border-radius: 14px; border: 1px solid var(--line); background: #fff; font-size: 18px; }
        .gl-main { width: 100%; max-width: 460px; margin: 0 auto; padding: 8px 18px 28px; display: flex; flex-direction: column; gap: 14px; }
        .gl-show { display: flex; flex-direction: column; gap: 10px; text-align: center; }
        .gl-art { align-self: center; width: min(100%, 300px); aspect-ratio: 16 / 9; border-radius: 26px; background-size: cover; background-color: #1a0b3d; box-shadow: 0 30px 50px -30px rgba(76,29,149,0.85), 0 0 0 5px #fff, 0 0 0 6px var(--line); transform: rotate(-2deg); margin: 6px 0 8px; animation: glIn .5s cubic-bezier(.2,.9,.3,1.2) both; }
        @keyframes glIn { from { opacity: 0; transform: rotate(-6deg) scale(.9); } }
        .gl h1 { margin: 0; font-size: clamp(28px, 7.4vw, 38px); line-height: 1.02; font-weight: 400; }
        .gl-rules { margin: 0; font-size: 14.5px; line-height: 1.45; color: var(--dim); }
        .gl-rules b { color: #22104f; }
        .gl-how { display: flex; justify-content: center; }
        .gl-energy { display: flex; justify-content: center; margin-top: 2px; }
        @media (min-width: 900px) { .gl-how { justify-content: flex-start; } }
        .gl-panel { display: flex; flex-direction: column; gap: 10px; }
        .gl-modes { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px; margin: 0 -2px; }
        .gl-modes::-webkit-scrollbar { display: none; }
        .gl-modes button { flex: none; display: flex; align-items: center; gap: 6px; padding: 9px 13px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255,255,255,0.75); font-size: 13.5px; font-weight: 800; color: var(--dim); white-space: nowrap; }
        .gl-modes i { font-style: normal; font-size: 9px; font-weight: 900; letter-spacing: 0.1em; padding: 2px 6px; border-radius: 999px; background: rgba(76,29,149,0.09); color: rgba(34,16,79,0.7); }
        .gl-modes button.on { background: #22104f; border-color: #22104f; color: #fff; }
        .gl-modes button.on i { background: #a78bfa; color: #22104f; }
        .gl-blurb { margin: -2px 0 2px; min-height: 18px; font-size: 13px; line-height: 1.35; color: var(--dim); text-align: center; }
        .gl-play { width: 100%; padding: 17px 0 19px; border: none; border-radius: 20px; background: linear-gradient(180deg, #7c3aed, #6d28d9); color: #fff !important; font-size: 21px; letter-spacing: 0.02em; box-shadow: 0 7px 0 #4c1d95, 0 22px 30px -16px rgba(76,29,149,0.9); transition: transform .08s, box-shadow .08s; margin-bottom: 7px; }
        .gl-play:active { transform: translateY(5px); box-shadow: 0 2px 0 #4c1d95, 0 10px 18px -12px rgba(76,29,149,0.9); }
        .gl-note { margin: 0; font-size: 12.5px; line-height: 1.4; color: var(--dim); text-align: center; }
        .gl-note a, .gl-note button { color: var(--brand); font-weight: 800; text-decoration: none; background: none; border: none; padding: 0; }
        .gl-gas { display: flex; justify-content: center; }
        .gl-challenge { display: flex; flex-direction: column; gap: 2px; padding: 11px 14px; border-radius: 16px; background: #fff7ed; border: 1px solid #fdba74; text-align: center; }
        .gl-challenge em { font-style: normal; font-size: 10.5px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #c2410c; }
        .gl-challenge span { font-size: 15px; font-weight: 700; color: #431407; }
        .gl-challenge b { color: #c2410c; }
        .gl-songs { display: flex; flex-direction: column; gap: 7px; }
        .gl-songs > em { font-style: normal; font-size: 10.5px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); text-align: center; }
        .gl-songs > div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .gl-song { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 16px; border: 1px solid var(--line); background: rgba(255,255,255,0.75); text-align: left; }
        .gl-song b { font-size: 14px; font-weight: 800; line-height: 1.15; } .gl-song span { font-size: 11.5px; font-weight: 600; color: var(--dim); }
        .gl-song.on { background: #fff; border-color: var(--brand); box-shadow: 0 0 0 1.5px var(--brand); }
        .gl-song u { position: absolute; top: -8px; right: 10px; padding: 2px 8px; border-radius: 999px; background: #22104f; color: #fff; font-size: 9px; font-weight: 900; letter-spacing: 0.1em; text-decoration: none; }
        .gl-top-card { padding: 14px 16px 8px; border-radius: 20px; background: #fff; box-shadow: 0 0 0 1px var(--line), 0 18px 30px -26px rgba(76,29,149,0.8); text-align: left; }
        .gl-top-head { display: flex; align-items: baseline; justify-content: space-between; font-size: 10.5px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brand); margin-bottom: 6px; }
        .gl-top-head span { color: rgba(34,16,79,0.7); }
        .gl-top-row { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 6px 0; font-size: 14px; font-weight: 700; border-top: 1px solid rgba(76,29,149,0.08); }
        .gl-top-row:first-of-type { border-top: none; }
        .gl-top-row i { font-style: normal; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 900; background: #ede9fe; color: #4c1d95; }
        .gl-top-row:first-of-type i { background: #fde68a; color: #713f12; }
        .gl-top-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .gl-top-row b { font-variant-numeric: tabular-nums; }
        .gl-top-empty { padding: 6px 0 4px; font-size: 13px; color: var(--dim); }
        .gl-top-all { display: block; width: 100%; padding: 10px 0 6px; border: none; background: none; font-size: 13px; font-weight: 800; color: var(--brand) !important; text-align: center; }
        .gl-panel .fp-btn { width: 100%; }
        .gl-wide { display: none; }
        /* short phones: Play must stay on the first screen */
        @media (max-height: 620px) and (max-width: 899px) { .gl-art { width: min(100%, 150px); transform: none; margin: 0; } .gl h1 { font-size: 24px; } .gl-rules { display: none; } .gl-songs > em { display: none; } .gl-song { padding: 7px 10px; } .gl-song span { display: none; } }
        @media (max-height: 720px) and (max-width: 899px) { .gl-art { width: min(100%, 230px); margin: 2px 0 4px; } .gl-main { gap: 10px; } .gl-play { padding: 14px 0 16px; } }
        @media (min-width: 900px) {
          .gl-top { padding: 18px 28px 0; }
          .gl-main { max-width: 980px; flex: 1; display: grid; grid-template-columns: 1.05fr 1fr; align-items: center; gap: 56px; padding: 12px 28px 40px; }
          .gl-show { text-align: left; gap: 14px; }
          .gl-art { align-self: flex-start; width: min(100%, 400px); margin: 0 0 14px 6px; }
          .gl h1 { font-size: 48px; } .gl-rules { font-size: 16px; max-width: 420px; }
          .gl-panel { padding: 24px; border-radius: 28px; background: rgba(255,255,255,0.6); box-shadow: 0 0 0 1px var(--line), 0 40px 60px -50px rgba(76,29,149,0.9); gap: 12px; }
          .gl-modes { flex-wrap: wrap; overflow: visible; }
          .gl-blurb { text-align: left; }
          .gl-wide { display: block; max-width: 400px; margin-top: 6px; } .gl-narrow { display: none; }
        }
        @media (prefers-reduced-motion: reduce) { .gl-art { animation: none; } .gl-play { transition: none; } }
      `}</style>
    </div>
  );
}

// This week's top three, read from the same cache the home page warms.
function TopPlayers({ gameType, label, onViewAll }: { gameType: GameTypeId; label: string; onViewAll: () => void }) {
  const seed = getCachedPreview(gameType);
  const [top, setTop] = useState<LeaderboardEntry[] | null>(seed?.top ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetchPreview(gameType).then((v) => { if (live) setTop(v.top); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [gameType]);
  const name = (e: LeaderboardEntry) => (e.username ? `@${e.username.replace(/^@/, "")}` : `${e.player.slice(0, 6)}…${e.player.slice(-4)}`);
  return (
    <div className="gl-top-card">
      <div className="gl-top-head">{label}<span>This week</span></div>
      {top === null && <div className="gl-top-empty">{failed ? "Could not load the board." : "Loading…"}</div>}
      {top !== null && top.length === 0 && <div className="gl-top-empty">No scores yet this week. Be first.</div>}
      {top !== null && top.map((e, i) => (
        <div key={e.player} className="gl-top-row"><i>{i + 1}</i><span>{name(e)}</span><b>{e.score.toLocaleString()}</b></div>
      ))}
      <button className="gl-top-all" onClick={onViewAll}>See the full leaderboard ›</button>
    </div>
  );
}
