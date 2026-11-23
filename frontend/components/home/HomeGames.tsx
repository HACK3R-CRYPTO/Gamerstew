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

      {/* 3 · the games */}
      <div className="ga-filters" role="tablist" aria-label="Kinds of game">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="ga-grid">
        {shown.map((g, i) => (
          <button key={g.id} className={`ga-card${i === 0 && filter === "all" ? " lead" : ""}`} onClick={() => open(g)} aria-label={`Play ${g.title}`} style={{ ["--accent" as string]: g.accent }}>
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
        .ga-home { display: flex; flex-direction: column; gap: 12px; }
        .ga-home button { -webkit-tap-highlight-color: transparent; font: inherit; color: inherit; }

        .ga-play { position: relative; overflow: hidden; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; width: 100%; min-height: 108px; padding: 14px; border: 1px solid rgba(255,255,255,0.18); border-radius: 22px; cursor: pointer; text-align: left; background: #12062e; box-shadow: 0 18px 40px -18px rgba(124,58,237,0.9); transition: transform .16s ease, box-shadow .2s ease; }
        .ga-play:hover { transform: translateY(-2px); box-shadow: 0 24px 46px -18px rgba(124,58,237,1); }
        .ga-play:active { transform: scale(0.985); }
        .ga-play-cover { position: absolute; inset: 0; background-size: cover; transition: transform .6s ease; }
        .ga-play:hover .ga-play-cover { transform: scale(1.05); }
        .ga-play-shade { position: absolute; inset: 0; background: linear-gradient(100deg, rgba(10,2,38,0.94) 0%, rgba(10,2,38,0.62) 48%, rgba(10,2,38,0.12) 100%); }
        .ga-play-text { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .ga-play-kicker { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 10.5px; font-weight: 900; letter-spacing: 0.18em; color: #fde68a; }
        .ga-play-title { font-size: clamp(26px, 6.4vw, 40px); line-height: 1; color: #fff; text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
        .ga-play-go { position: relative; flex-shrink: 0; padding: 12px 20px; border-radius: 14px; font-size: 16px; letter-spacing: 0.04em; color: #1a0b33; background: linear-gradient(180deg, #fde68a, #fbbf24); box-shadow: 0 4px 0 #b45309, 0 10px 22px rgba(251,191,36,0.35); animation: gaPulse 2.4s ease-in-out infinite; }
        @keyframes gaPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }

        .ga-week { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 11px 13px; border-radius: 16px; cursor: pointer; text-align: left; background: rgba(40,18,100,0.5); border: 1px solid rgba(251,191,36,0.3); font-family: ui-sans-serif, system-ui, sans-serif; transition: border-color .2s ease, background .2s ease; }
        .ga-week:hover { border-color: rgba(251,191,36,0.6); background: rgba(52,24,120,0.6); }
        .ga-week-top { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; color: #fff; }
        .ga-week-days { color: #fde68a; font-weight: 800; white-space: nowrap; }
        .ga-week-bar { display: block; height: 7px; border-radius: 6px; background: rgba(0,0,0,0.4); overflow: hidden; }
        .ga-week-bar i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, #fbbf24, #4ade80); transition: width .6s ease; }
        .ga-week-sub { font-size: 11.5px; font-weight: 600; color: rgba(220,210,255,0.72); line-height: 1.35; }

        .ga-filters { display: flex; gap: 6px; margin-top: 4px; overflow-x: auto; scrollbar-width: none; }
        .ga-filters::-webkit-scrollbar { display: none; }
        .ga-filters button { flex-shrink: 0; padding: 8px 15px; border-radius: 999px; cursor: pointer; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; font-weight: 800; color: rgba(220,210,255,0.75); background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); transition: background .18s ease, color .18s ease; }
        .ga-filters button:hover { background: rgba(255,255,255,0.12); color: #fff; }
        .ga-filters button.on { color: #1a0b33; background: #fff; border-color: #fff; }

        .ga-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .ga-card { position: relative; overflow: hidden; aspect-ratio: 1 / 1; padding: 0; border-radius: 18px; cursor: pointer; text-align: left; background: #12062e; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 24px -14px rgba(0,0,0,0.9); transition: transform .18s ease, box-shadow .22s ease, border-color .22s ease; animation: gaIn .38s ease both; }
        .ga-card:nth-child(2) { animation-delay: .04s; } .ga-card:nth-child(3) { animation-delay: .08s; } .ga-card:nth-child(4) { animation-delay: .12s; } .ga-card:nth-child(5) { animation-delay: .16s; } .ga-card:nth-child(6) { animation-delay: .2s; }
        @keyframes gaIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .ga-card:hover { transform: translateY(-4px); border-color: var(--accent); box-shadow: 0 18px 34px -16px var(--accent); }
        .ga-card:active { transform: scale(0.97); }
        .ga-card-cover { position: absolute; inset: 0; background-size: cover; transition: transform .7s ease; }
        .ga-card:hover .ga-card-cover { transform: scale(1.08); }
        .ga-card-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,2,38,0) 34%, rgba(10,2,38,0.9) 100%); }
        .ga-card-tag { position: absolute; top: 9px; left: 9px; padding: 4px 8px; border-radius: 8px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 9.5px; font-weight: 900; letter-spacing: 0.14em; color: #fff; background: rgba(10,2,38,0.66); border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
        .ga-card-text { position: absolute; left: 11px; right: 44px; bottom: 10px; display: flex; flex-direction: column; gap: 2px; }
        .ga-card-title { font-size: clamp(16px, 4.3vw, 22px); line-height: 1.05; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.7); }
        .ga-card-line { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11.5px; font-weight: 600; line-height: 1.3; color: rgba(255,255,255,0.8); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
        .ga-card-go { position: absolute; right: 10px; bottom: 10px; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; color: #1a0b33; background: var(--accent); box-shadow: 0 3px 0 rgba(0,0,0,0.35); transition: transform .18s ease; }
        .ga-card:hover .ga-card-go { transform: scale(1.14); }

        /* tablet */
        @media (min-width: 700px) {
          .ga-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
          .ga-card { aspect-ratio: 4 / 3; }
          .ga-card.lead { grid-column: span 2; aspect-ratio: auto; }
          .ga-card.lead .ga-card-title { font-size: clamp(22px, 3vw, 32px); }
          .ga-play { min-height: 170px; padding: 22px; }
        }
        /* desktop */
        @media (min-width: 1024px) {
          .ga-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
          .ga-card.lead { grid-row: span 2; }
          .ga-play { min-height: 200px; }
        }
        /* very small phones */
        @media (max-width: 340px) { .ga-card-line { display: none; } .ga-play-go { padding: 10px 14px; font-size: 14px; } }
        @media (prefers-reduced-motion: reduce) { .ga-play-go, .ga-card { animation: none; } .ga-card, .ga-play, .ga-card-cover, .ga-play-cover { transition: none; } }
      `}</style>
    </div>
  );
}
