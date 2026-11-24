"use client";

// ─── What happened to the score ──────────────────────────────────────────────
// The part of the result screen a signed-in player reads after a ranked run:
// waiting on the wallet, saving, saved (rank, XP, bests, level, achievements),
// or what went wrong and what to do about it. One component for every game, so
// the three old copies cannot drift apart.

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { playRankReveal, playSaveSuccess, playLevelUp, playAchievementChime } from "@/hooks/useAppAudio";
import { hydrateAchievement } from "@/lib/achievements";

const TELEGRAM_URL = "https://t.me/+oY4inbBoglViNmE0";

export interface RunSaved {
  rank?: number; xpEarned?: number; xp?: number; level?: number; leveledUp?: boolean; isNewPb?: boolean; prevBest?: number;
  newAchievements?: (string | { id?: string; name?: string; icon?: string; desc?: string })[];
}

export default function RunSaveStatus({ submitting, signingOnChain, result, error, txError, score, onTopUp }: {
  submitting: boolean; signingOnChain: boolean; result: RunSaved | null; error: string | null; txError: string | null; score: number;
  /** opens the game's own top-up help, when it has one */
  onTopUp?: () => void;
}) {
  let body: React.ReactNode = null;
  if (signingOnChain) body = <Waiting title="Confirm in your wallet" text="Signing records your score on-chain." />;
  else if (submitting) body = <Waiting title="Saving your score" text="This takes a few seconds." />;
  // Only called a gas problem when the save itself said so ("top up"). A
  // rejected signature or any other failure is not blamed on gas.
  else if (txError) body = txError.toLowerCase().includes("top up") ? <NeedsTopUp onTopUp={onTopUp} /> : <Note tone="bad" title="Your score was not saved" text={txError} hint="Tap Play again to try once more." />;
  // a run abandoned in the first seconds has no score to fail: say so calmly
  else if (error) body = error.toLowerCase().startsWith("quick exit") ? <Note tone="calm" title="No score this time" text={error} /> : <Note tone="bad" title="Your score was not saved" text={error} />;
  else if (result) body = <Saved result={result} score={score} />;
  if (!body) return null;
  return (
    <div className="rs">
      {body}
      <style>{`
        .rs { display: flex; flex-direction: column; gap: 8px; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #22104f; text-align: left; }
        .rs-card { padding: 13px 15px; border-radius: 18px; background: rgba(255,255,255,0.8); border: 1px solid rgba(76,29,149,0.16); }
        .rs-card em { display: block; font-style: normal; font-size: 10.5px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #6d28d9; }
        .rs-card b { display: block; font-size: 15px; font-weight: 800; line-height: 1.3; } .rs-card p { margin: 3px 0 0; font-size: 13px; line-height: 1.4; color: rgba(34,16,79,0.7); }
        .rs-wait { display: flex; align-items: center; gap: 12px; }
        .rs-spin { flex: none; width: 22px; height: 22px; border-radius: 50%; border: 3px solid rgba(76,29,149,0.18); border-top-color: #6d28d9; animation: rsSpin .7s linear infinite; }
        @keyframes rsSpin { to { transform: rotate(360deg); } }
        .rs-card.bad { background: #fff1f2; border-color: #fda4af; } .rs-card.bad em, .rs-card.bad b { color: #9f1239; }
        .rs-card.warn { background: #fff7ed; border-color: #fdba74; } .rs-card.warn em, .rs-card.warn b { color: #9a3412; }
        .rs-card.good { background: #f0fdf4; border-color: rgba(22,163,74,0.45); } .rs-card.good em { color: #166534; }
        .rs-card.gold { background: #fffbeb; border-color: #fcd34d; } .rs-card.gold em { color: #92400e; }
        .rs-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .rs-tile { padding: 11px 6px; border-radius: 18px; background: #fff; border: 1px solid rgba(76,29,149,0.16); text-align: center; animation: rsIn .35s ease both; }
        .rs-tile span { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(34,16,79,0.66); }
        .rs-tile b { display: block; font-size: 24px; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; }
        @keyframes rsIn { from { opacity: 0; transform: translateY(6px); } }
        .rs-list { margin: 6px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
        .rs-list li { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
        .rs-btn { display: block; margin-top: 10px; padding: 12px 0; border-radius: 14px; border: none; background: #c2410c; color: #fff; font: inherit; font-size: 14.5px; font-weight: 800; text-align: center; text-decoration: none; cursor: pointer; width: 100%; }
        .rs-link { display: block; margin: 8px auto 0; padding: 0; border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 700; color: #9a3412; text-decoration: underline; cursor: pointer; }
        @media (prefers-reduced-motion: reduce) { .rs-spin, .rs-tile { animation: none; } }
      `}</style>
    </div>
  );
}

function Waiting({ title, text }: { title: string; text: string }) {
  return <div className="rs-card rs-wait" role="status"><i className="rs-spin" aria-hidden /><div><b>{title}</b><p>{text}</p></div></div>;
}
function Note({ tone, title, text, hint }: { tone: "bad" | "calm"; title: string; text: string; hint?: string }) {
  return <div className={`rs-card${tone === "bad" ? " bad" : ""}`} role={tone === "bad" ? "alert" : "status"}><b>{title}</b><p>{text}</p>{hint && <p>{hint}</p>}</div>;
}
function NeedsTopUp({ onTopUp }: { onTopUp?: () => void }) {
  const { address } = useAccount();
  const [copied, setCopied] = useState(false);
  const copy = () => { if (address) navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); };
  return (
    <div className="rs-card warn" role="alert">
      <b>Your wallet needs a top-up to save this score</b>
      <p>It was not recorded this time. Top up, then play again.</p>
      {onTopUp
        ? <button className="rs-btn" onClick={onTopUp}>How to top up</button>
        : <a className="rs-btn" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">Get help in Telegram</a>}
      <button className="rs-link" onClick={copy}>{copied ? "Copied" : "Copy my wallet address"}</button>
    </div>
  );
}

function Saved({ result, score }: { result: RunSaved; score: number }) {
  const { rank, xpEarned, level, leveledUp, isNewPb, prevBest, newAchievements = [] } = result;
  // each sound lands by itself: rank, then best, then level, then achievement
  useEffect(() => { if (rank) playRankReveal(); }, [rank]);
  useEffect(() => { if (isNewPb) { const t = setTimeout(() => playSaveSuccess(), 250); return () => clearTimeout(t); } }, [isNewPb]);
  useEffect(() => { if (leveledUp) { const t = setTimeout(() => playLevelUp(), 500); return () => clearTimeout(t); } }, [leveledUp]);
  useEffect(() => { if (newAchievements.length > 0) { const t = setTimeout(() => playAchievementChime(), 900); return () => clearTimeout(t); } }, [newAchievements.length]);
  const beat = isNewPb && typeof prevBest === "number" && prevBest > 0;
  return (
    <>
      <div className="rs-card good"><em>Saved</em><b>Your score is on the board.</b></div>
      {(rank || typeof xpEarned === "number") && (
        <div className="rs-two">
          {rank ? <div className="rs-tile"><span>Rank this week</span><b style={{ color: "#92400e" }}>#{rank}</b></div> : <div />}
          {typeof xpEarned === "number" ? <div className="rs-tile" style={{ animationDelay: "80ms" }}><span>XP gained</span><b style={{ color: "#6d28d9" }}>+{xpEarned}</b></div> : <div />}
        </div>
      )}
      {isNewPb && <div className="rs-card gold"><em>{beat ? "New personal best" : "First personal best"}</em><b>{beat ? `You beat your old ${prevBest!.toLocaleString()} by ${Math.max(0, score - prevBest!).toLocaleString()}.` : "This is the score to beat next time."}</b></div>}
      {leveledUp && level && <div className="rs-card"><em>Level up</em><b>You are now level {level}.</b></div>}
      {newAchievements.length > 0 && (
        <div className="rs-card good">
          <em>New achievement{newAchievements.length > 1 ? "s" : ""}</em>
          <ul className="rs-list">{newAchievements.map((raw, i) => { const a = hydrateAchievement(raw); return <li key={a.id || i}><span aria-hidden>{a.icon}</span>{a.name}</li>; })}</ul>
        </div>
      )}
    </>
  );
}
