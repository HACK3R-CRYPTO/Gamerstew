"use client";

// Today's pot, on the home screen: how big it is, which game carries it, how
// long is left, and where this player stands. Shown only while the pot is
// switched on (the server says so); otherwise it renders nothing.
//
// The number is public and read straight from the backend, which works it out
// at most twice a minute however many players are looking.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { timeUntil } from "@/lib/energy";

interface Pot {
  on: boolean; game: string | null; pot: number; endsAt: number; players: number; paidPlaces: number; firstPrize: number; minPlayers: number;
  top: { rank: number; name: string | null; wallet: string; score: number; prize: number }[];
  you: { rank: number; score: number; prize: number } | null;
  yesterday: { status: "paid" | "rolled"; pot: number; winners: number } | null;
}
const GAME: Record<string, { name: string; href: string }> = {
  rhythm: { name: "Rhythm Rush", href: "/games/rhythm" }, simon: { name: "Simon Memory", href: "/games/simon" }, ladder: { name: "Word Ladder", href: "/games/ladder" },
  strike: { name: "Street Strike", href: "/bowling" }, stack: { name: "Stack Tower", href: "/games/stack" },
};
const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';
const ord = (n: number) => { const s = ["th", "st", "nd", "rd"]; const v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

export default function PotCard() {
  const router = useRouter(); const { address } = useAccount();
  const [pot, setPot] = useState<Pot | null>(null); const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    const look = () => fetch(`${base}/api/pot${address ? `?wallet=${address}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setPot(d as Pot); }).catch(() => {});
    void look();
    const t = setInterval(() => { if (document.visibilityState === "visible") { void look(); tick((n) => n + 1); } }, 45_000);
    return () => { live = false; clearInterval(t); };
  }, [address]);
  if (!pot?.on || !pot.game) return null;
  const g = GAME[pot.game] ?? { name: pot.game, href: "/games" };
  const short2 = pot.players < pot.minPlayers;
  return (
    <section className="pot" aria-label="Today's pot">
      <div className="pot-main">
        <div className="pot-kick">TODAY&apos;S POT · ends in {timeUntil(pot.endsAt)}</div>
        {pot.pot > 0
          ? <div className="pot-num" style={{ fontFamily: DISPLAY }}>{pot.pot.toLocaleString()} <small>G$</small></div>
          : <div className="pot-num empty" style={{ fontFamily: DISPLAY }}>Opens with the first energy pack</div>}
        <div className="pot-line">
          {pot.you
            ? pot.you.prize > 0 ? <>You are <b>{ord(pot.you.rank)}</b> of {pot.players}, in line for <b>{pot.you.prize.toLocaleString()} G$</b>.</> : <>You are <b>{ord(pot.you.rank)}</b> of {pot.players}. The top {pot.paidPlaces || Math.max(1, Math.ceil(pot.players / 3))} are paid.</>
            : pot.pot > 0 ? <>Play one ranked run of <b>{g.name}</b> to enter. The top third split it.</> : <>Most of every energy pack goes into the pot. Play <b>{g.name}</b> today to be in it.</>}
        </div>
        {short2 && <div className="pot-note">{pot.players} of the {pot.minPlayers} verified players needed today. If it falls short, the pot rolls into tomorrow.</div>}
      </div>
      <div className="pot-side">
        <button onClick={() => router.push(g.href)} style={{ fontFamily: DISPLAY }}>Play {g.name}</button>
        {pot.top.length > 0 && (
          <ol>
            {pot.top.slice(0, 3).map((t) => <li key={t.wallet}><i>{t.rank}</i><span>{t.name || short(t.wallet)}</span><b>{t.score.toLocaleString()}</b></li>)}
          </ol>
        )}
        <div className="pot-note">Prizes go to verified players, on confirmed scores.</div>
      </div>
      <style>{`
        .pot { display: grid; grid-template-columns: 1fr; gap: 14px; padding: 18px; border-radius: 22px; color: #fff; background: radial-gradient(120% 140% at 0% 0%, #7c3aed 0%, #4c1d95 55%, #2e1065 100%); box-shadow: 0 10px 30px rgba(76,29,149,0.28); }
        .pot-kick { font-size: 11.5px; font-weight: 700; letter-spacing: 0.14em; color: rgba(255,255,255,0.78); }
        .pot-num { font-size: clamp(38px, 11vw, 54px); line-height: 1.05; margin-top: 2px; color: #fde68a; text-shadow: 0 2px 0 rgba(0,0,0,0.18); }
        .pot-num small { font-size: 0.42em; color: #fff; }
        .pot-num.empty { font-size: clamp(22px, 6.4vw, 30px); line-height: 1.15; margin-top: 4px; }
        .pot-line { margin-top: 6px; font-size: 15px; line-height: 1.4; color: rgba(255,255,255,0.92); }
        .pot-line b { color: #fff; }
        .pot-note { margin-top: 8px; font-size: 12.5px; line-height: 1.4; color: rgba(255,255,255,0.7); }
        .pot-side button { width: 100%; min-height: 50px; border: none; border-radius: 16px; background: #fde68a; color: #3b0764; font-size: 18px; cursor: pointer; box-shadow: 0 4px 0 rgba(0,0,0,0.18); }
        .pot-side ol { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
        .pot-side li { display: flex; align-items: center; gap: 8px; font-size: 14px; }
        .pot-side li i { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 12px; font-weight: 800; background: rgba(255,255,255,0.18); }
        .pot-side li span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,0.92); }
        .pot-side li b { font-variant-numeric: tabular-nums; }
        @media (min-width: 760px) { .pot { grid-template-columns: 1.3fr 1fr; align-items: center; padding: 22px 24px; gap: 28px; } }
      `}</style>
    </section>
  );
}
