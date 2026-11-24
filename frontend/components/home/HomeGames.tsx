"use client";

// ─── HomeGames ───────────────────────────────────────────────────────────────
// The home screen, rebuilt around one idea: the games ARE the page.
//
//   1. one Play button that takes you back into the game you played last
//   2. one slim line for this week's challenge
//   3. a gallery of the games, each a picture you tap to play
//
// Nothing else competes with those. The layout is a single CSS grid that goes
// from two columns on a phone to four on a desktop, so there is one design, not
// a phone version and a desktop version that drift apart.
//
// Tapping a card plays. For Stack and Simon that means the run starts; the
// others open their own screen.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Tag = "skill" | "3d" | "ai";
interface GameCard { id: string; title: string; tag: Tag; line: string; cover: string; focus: string; href: string; accent: string }

export const HOME_GAMES: GameCard[] = [
  { id: "stack", title: "Stack Tower", tag: "skill", line: "Drop the block. Stack it clean.", cover: "/games/covers/stack.jpg", focus: "50% 60%", href: "/games/stack?play=1", accent: "#fb923c" },
  { id: "ladder", title: "Word Ladder", tag: "skill", line: "Change one letter. Reach the word.", cover: "/games/covers/ladder.svg", focus: "50% 20%", href: "/games/ladder", accent: "#4ade80" },
  { id: "streetstrike", title: "Street Strike", tag: "3d", line: "Roll the tyre. Scatter the bottles.", cover: "/games/covers/streetstrike.jpg", focus: "50% 55%", href: "/bowling", accent: "#c084fc" },
  { id: "simon", title: "Simon Memory", tag: "skill", line: "Watch. Remember. Repeat.", cover: "/games/covers/simon.jpg", focus: "50% 45%", href: "/games/simon?play=1", accent: "#22d3ee" },
  { id: "upnepa3d", title: "UP NEPA 3D", tag: "3d", line: "Bring the light back to the street.", cover: "/games/covers/upnepa3d.jpg", focus: "58% 45%", href: "/world", accent: "#fbbf24" },
  { id: "arena", title: "Challenge AI", tag: "ai", line: "Beat MARKOV at mind games.", cover: "/games/covers/challenge-ai.jpg", focus: "50% 55%", href: "/games/challenge-ai", accent: "#fde68a" },
  { id: "rhythm", title: "Rhythm Rush", tag: "skill", line: "Tap the beat. Chain the combo.", cover: "/games/covers/rhythm.jpg", focus: "50% 40%", href: "/games/rhythm", accent: "#f0abfc" },
];
const FILTERS: { id: "all" | Tag; label: string }[] = [
  { id: "all", label: "All" },
  { id: "skill", label: "Skill" },
  { id: "3d", label: "3D" },
  { id: "ai", label: "vs AI" },
];
const TAG_LABEL: Record<Tag, string> = { skill: "SKILL", "3d": "3D", ai: "VS AI" };
const LAST_KEY = "gamearena:lastGame";

export interface WeeklyStrip { target: number; progress: number; hit: boolean; daysLeft: number; rewardG: number; perGameG: number; myContribution: number | null }

export default function HomeGames({ weekly, display }: { weekly: WeeklyStrip | null; display: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | Tag>("all");
  const [lastId, setLastId] = useState<string | null>(null);
  useEffect(() => { try { setLastId(localStorage.getItem(LAST_KEY)); } catch { /* private window */ } }, []);

  const last = HOME_GAMES.find((g) => g.id === lastId) ?? HOME_GAMES[0];
  const shown = useMemo(() => HOME_GAMES.filter((g) => filter === "all" || g.tag === filter), [filter]);
  const open = (g: GameCard) => {
    try { localStorage.setItem(LAST_KEY, g.id); } catch { /* ignore */ }
    router.push(g.href);
  };
  const pct = weekly ? Math.max(0, Math.min(100, Math.round((weekly.progress / weekly.target) * 100))) : 0;

  return (
    <div className="ga-home">
      <div className="ga-top">
      {/* 1 · the one button */}
      <button className="ga-play" onClick={() => open(last)} style={{ fontFamily: display }} aria-label={`Play ${last.title}`}>
        <span className="ga-play-cover" style={{ backgroundImage: `url(${last.cover})`, backgroundPosition: last.focus }} aria-hidden />
        <span className="ga-play-shade" aria-hidden />
        <span className="ga-play-text">
          <span className="ga-play-kicker">{lastId ? "JUMP BACK IN" : "START HERE"}</span>
          <span className="ga-play-title">{last.title}</span>
        </span>
        <span className="ga-play-go" aria-hidden>▶ PLAY</span>
      </button>

      {/* 2 · this week, in one line */}
      {weekly && (
        <button className="ga-week" onClick={() => router.push("/leaderboard")} aria-label="This week's challenge">
          <span className="ga-week-top">
            <span><b>🏆 This week</b> · {weekly.rewardG.toLocaleString()} G$ to share</span>
            <span className="ga-week-days">{weekly.daysLeft} day{weekly.daysLeft === 1 ? "" : "s"} left</span>
          </span>
          <span className="ga-week-bar" role="progressbar" aria-valuemin={0} aria-valuemax={weekly.target} aria-valuenow={weekly.progress}><i style={{ width: `${Math.max(pct, weekly.progress > 0 ? 3 : 0)}%` }} /></span>
          <span className="ga-week-sub">
            {weekly.hit ? `Unlocked: every game pays ${weekly.perGameG} G$` : `${weekly.progress.toLocaleString()} of ${weekly.target.toLocaleString()} games together · every game earns ${weekly.perGameG} G$`}
            {weekly.myContribution ? ` · you: ${weekly.myContribution}` : ""}
          </span>
        </button>
      )}
      </div>

      {/* 3 · the games */}
      <div className="ga-filters" role="tablist" aria-label="Kinds of game">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="ga-grid" key={filter}>
        {shown.map((g) => (
          <button key={g.id} className="ga-card" onClick={() => open(g)} aria-label={`Play ${g.title}`} style={{ ["--accent" as string]: g.accent }}>
            <span className="ga-card-cover" style={{ backgroundImage: `url(${g.cover})`, backgroundPosition: g.focus }} aria-hidden />
            <span className="ga-card-shade" aria-hidden />
            <span className="ga-card-tag">{TAG_LABEL[g.tag]}</span>
            <span className="ga-card-text">
              <span className="ga-card-title" style={{ fontFamily: display }}>{g.title}</span>
              <span className="ga-card-line">{g.line}</span>
            </span>
            <span className="ga-card-go" aria-hidden>▶</span>
          </button>
        ))}
      </div>

      <style>{`
        .ga-home { display: flex; flex-direction: column; gap: 14px; --ink: #22104f; --dim: rgba(34,16,79,0.62); --line: rgba(76,29,149,0.14); --brand: #6d28d9; }
        .ga-home button { -webkit-tap-highlight-color: transparent; font: inherit; color: inherit; }
        .ga-top { display: grid; gap: 12px; }

        .ga-play { position: relative; overflow: hidden; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; width: 100%; min-height: 168px; padding: 16px; border: none; border-radius: 26px; cursor: pointer; text-align: left; background: #1c0b45; box-shadow: 0 22px 44px -24px rgba(76,29,149,0.85); transition: transform .18s cubic-bezier(.2,.9,.3,1.2), box-shadow .2s ease; }
        .ga-play:hover { transform: translateY(-3px); box-shadow: 0 30px 54px -24px rgba(76,29,149,0.95); }
        .ga-play:active { transform: scale(0.98); }
        .ga-play-cover { position: absolute; inset: 0; background-size: cover; animation: gaDrift 14s ease-in-out infinite alternate; }
        @keyframes gaDrift { from { transform: scale(1.04); } to { transform: scale(1.14) translateY(-8px); } }
        .ga-play-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(20,6,56,0) 22%, rgba(20,6,56,0.86) 100%); }
        .ga-play-text { position: relative; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .ga-play-kicker { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 10.5px; font-weight: 900; letter-spacing: 0.18em; color: #d8ccff; }
        .ga-play-title { font-size: clamp(28px, 6.6vw, 44px); line-height: 1; color: #fff; text-shadow: 0 2px 14px rgba(0,0,0,0.5); }
        .ga-play-go { position: relative; overflow: hidden; flex-shrink: 0; padding: 12px 20px; border-radius: 999px; font-size: 16px; color: #fff; background: var(--brand); box-shadow: 0 12px 26px -8px rgba(109,40,217,0.95); }
        .ga-play-go::after { content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.5), transparent); animation: gaShine 3.2s ease-in-out infinite; }
        @keyframes gaShine { 0%, 60% { left: -60%; } 100% { left: 130%; } }

        .ga-week { display: flex; flex-direction: column; justify-content: center; gap: 8px; width: 100%; padding: 14px 16px; border-radius: 24px; cursor: pointer; text-align: left; background: #fff; border: 1px solid var(--line); box-shadow: 0 16px 34px -26px rgba(76,29,149,0.7); font-family: ui-sans-serif, system-ui, sans-serif; transition: transform .18s ease, box-shadow .2s ease; }
        .ga-week:hover { transform: translateY(-2px); box-shadow: 0 22px 40px -26px rgba(76,29,149,0.9); }
        .ga-week-top { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; color: var(--ink); }
        .ga-week-days { color: var(--brand); font-weight: 800; white-space: nowrap; }
        .ga-week-bar { display: block; height: 9px; border-radius: 6px; background: rgba(76,29,149,0.12); overflow: hidden; }
        .ga-week-bar i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, #6d28d9, #a78bfa); transform-origin: left; animation: gaGrow 1.1s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes gaGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .ga-week-sub { font-size: 12px; font-weight: 600; color: var(--dim); line-height: 1.4; }

        .ga-filters { display: flex; gap: 7px; margin-top: 4px; overflow-x: auto; scrollbar-width: none; }
        .ga-filters::-webkit-scrollbar { display: none; }
        .ga-filters button { flex-shrink: 0; padding: 9px 16px; border-radius: 999px; cursor: pointer; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; font-weight: 800; color: var(--dim); background: transparent; border: 1px solid var(--line); transition: background .18s ease, color .18s ease; }
        .ga-filters button:hover { background: rgba(109,40,217,0.08); color: var(--ink); }
        .ga-filters button.on { color: #fff; background: var(--ink); border-color: var(--ink); }

        .ga-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .ga-card { position: relative; overflow: hidden; aspect-ratio: 1 / 1.08; padding: 0; border-radius: 24px; cursor: pointer; text-align: left; background: #1c0b45; border: none; box-shadow: 0 18px 34px -24px rgba(76,29,149,0.9); transition: transform .2s cubic-bezier(.2,.9,.3,1.3), box-shadow .22s ease; animation: gaIn .5s cubic-bezier(.2,.8,.2,1) both; }
        .ga-card:nth-child(2) { animation-delay: .05s; } .ga-card:nth-child(3) { animation-delay: .1s; } .ga-card:nth-child(4) { animation-delay: .15s; } .ga-card:nth-child(5) { animation-delay: .2s; } .ga-card:nth-child(6) { animation-delay: .25s; } .ga-card:nth-child(7) { animation-delay: .3s; }
        @keyframes gaIn { from { opacity: 0; transform: translateY(16px) scale(0.96); } to { opacity: 1; transform: none; } }
        .ga-card:hover { transform: translateY(-5px); box-shadow: 0 28px 44px -24px rgba(76,29,149,1); }
        .ga-card:active { transform: scale(0.96); }
        .ga-card-cover { position: absolute; inset: 0; background-size: cover; transition: transform .7s ease; }
        .ga-card:hover .ga-card-cover { transform: scale(1.08); }
        .ga-card-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(20,6,56,0) 36%, rgba(20,6,56,0.9) 100%); }
        .ga-card-tag { position: absolute; top: 10px; left: 10px; padding: 4px 9px; border-radius: 999px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 9.5px; font-weight: 800; letter-spacing: 0.12em; color: #fff; background: rgba(0,0,0,0.46); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .ga-card-text { position: absolute; left: 12px; right: 46px; bottom: 11px; display: flex; flex-direction: column; gap: 2px; }
        .ga-card-title { font-size: clamp(17px, 4.4vw, 22px); line-height: 1.05; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.6); }
        .ga-card-line { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11.5px; font-weight: 600; line-height: 1.3; color: rgba(255,255,255,0.82); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
        .ga-card-go { position: absolute; right: 11px; bottom: 11px; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; color: var(--brand); background: #fff; box-shadow: 0 6px 14px -6px rgba(0,0,0,0.6); transition: transform .2s cubic-bezier(.2,.9,.3,1.4), background .2s ease, color .2s ease; }
        .ga-card:hover .ga-card-go { transform: scale(1.15); background: var(--brand); color: #fff; }

        @media (min-width: 700px) {
          .ga-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
          .ga-card { aspect-ratio: 4 / 3; }
          .ga-play { min-height: 220px; padding: 22px; }
        }
        @media (min-width: 1024px) {
          .ga-top { grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); gap: 18px; }
          .ga-play { min-height: 280px; padding: 28px; border-radius: 30px; }
          .ga-play-go { padding: 15px 28px; font-size: 19px; }
          .ga-week { padding: 26px; gap: 14px; border-radius: 30px; }
          .ga-week-top { flex-direction: column; gap: 6px; font-size: 19px; }
          .ga-week-bar { height: 12px; }
          .ga-week-sub { font-size: 14px; }
          .ga-grid { gap: 18px; }
          .ga-card { aspect-ratio: 16 / 10; border-radius: 28px; }
          .ga-card-title { font-size: 26px; }
          .ga-card-line { font-size: 13.5px; }
          .ga-card-text { left: 18px; bottom: 16px; }
          .ga-card-go { right: 16px; bottom: 16px; width: 40px; height: 40px; font-size: 14px; }
        }
        @media (max-width: 340px) { .ga-card-line { display: none; } .ga-play-go { padding: 10px 14px; font-size: 14px; } }
        @media (prefers-reduced-motion: reduce) { .ga-home * { animation: none !important; transition: none !important; } }
      
`}</style>
    </div>
  );
}
