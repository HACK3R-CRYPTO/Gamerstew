"use client";

// ─── NextUp ──────────────────────────────────────────────────────────────────
// Shown when a run ends. Seven in ten players here play on one day and never
// return, and the end of a run is the moment they decide. So this is where the
// reasons to come back are put, in plain numbers:
//
//   this week   what this run just added toward the weekly pool
//   streak      what playing tomorrow keeps alive
//   mission     the nearest thing they can still finish today
//
// It shows only what is true right now, straight from the server, and it shows
// nothing at all if the server cannot be reached. It never blocks the screen:
// the result and the Play Again button do not wait for it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

interface Weekly { target: number; progress: number; hit: boolean; daysLeft: number; perGameG: number; capPerPlayer: number; myContribution: number | null; myProjectedG: number | null }
interface User { streak: number; playedToday: boolean }
interface Mission { id: number; label: string; progress: number; target: number; completed: boolean; claimed: boolean; rewardXp: number }

const get = async <T,>(path: string): Promise<T | null> => {
  try {
    const r = await fetch(`${BACKEND}${path}`);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
};

/** The mission worth mentioning: one ready to claim, else the closest to done. */
export function pickMission(list: Mission[]): Mission | null {
  const open = list.filter((m) => !m.claimed);
  const ready = open.find((m) => m.completed);
  if (ready) return ready;
  return open.filter((m) => !m.completed).sort((a, b) => b.progress / b.target - a.progress / a.target)[0] ?? null;
}

export default function NextUp({ accent = "#fbbf24" }: { accent?: string }) {
  const { address: connected } = useAccount();
  // dev only: lets an automated check see the signed-in rows without a wallet
  const address = connected ?? (process.env.NODE_ENV !== "production" && typeof window !== "undefined" ? (window as unknown as { __nextUpWallet?: `0x${string}` }).__nextUpWallet : undefined);
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const a = address?.toLowerCase();
      const [w, u, m] = await Promise.all([
        get<Weekly>(`/api/weekly-challenge${a ? `?wallet=${a}` : ""}`),
        a ? get<User>(`/api/user/${a}`) : Promise.resolve(null),
        a ? get<{ missions: Mission[] }>(`/api/missions/today/${a}`) : Promise.resolve(null),
      ]);
      if (!live) return;
      if (w && typeof w.target === "number" && w.target > 0) setWeekly(w);
      if (u && typeof u.streak === "number") setUser(u);
      if (m && Array.isArray(m.missions)) setMission(pickMission(m.missions));
    };
    // The run is still being saved when this appears. Read once quickly, then
    // again once the save has had time to land, so the numbers include this run.
    const first = setTimeout(load, 600);
    const second = setTimeout(load, 5000);
    return () => { live = false; clearTimeout(first); clearTimeout(second); };
  }, [address]);

  const rows: { icon: string; text: React.ReactNode; key: string }[] = [];

  if (weekly) {
    const mine = weekly.myContribution ?? 0;
    const left = Math.max(0, weekly.target - weekly.progress);
    const days = `${weekly.daysLeft} day${weekly.daysLeft === 1 ? "" : "s"} left`;
    rows.push({
      key: "weekly", icon: "🏆",
      text: !address
        ? <>This week every game earns <b>{weekly.perGameG} G$</b>. <Link href="/home?signin=1" style={{ color: "#6d28d9", fontWeight: 900 }}>Sign in</Link> and your games count.</>
        : weekly.hit
          ? <>Weekly target reached. You are on <b>{mine} game{mine === 1 ? "" : "s"}</b>{weekly.myProjectedG ? <> · <b>{weekly.myProjectedG.toLocaleString()} G$</b></> : null}. {days}.</>
          : mine >= weekly.capPerPlayer
            ? <>You have hit this week&apos;s cap of {weekly.capPerPlayer} games. <b>{left.toLocaleString()}</b> more from everyone unlocks the pool.</>
            : <>You are on <b>{mine} game{mine === 1 ? "" : "s"}</b> this week{weekly.myProjectedG ? <> · <b>{weekly.myProjectedG.toLocaleString()} G$</b> if we unlock it</> : null}. <b>{left.toLocaleString()}</b> to go together, {days}.</>,
    });
  }

  if (address && user) {
    const s = user.streak;
    rows.push({
      key: "streak", icon: "🔥",
      text: s >= 1
        ? <><b>{s}-day streak.</b> Play tomorrow to make it {s + 1}.</>
        : <>Play again tomorrow to start a streak.</>,
    });
  }

  if (address && mission) {
    const togo = mission.target - mission.progress;
    rows.push({
      key: "mission", icon: "🎯",
      text: mission.completed
        ? <><b>{mission.label}</b> is done. <Link href="/dashboard" style={{ color: "#6d28d9", fontWeight: 900 }}>Claim +{mission.rewardXp} XP</Link></>
        : <><b>{mission.label}</b>: {mission.progress}/{mission.target}{togo === 1 ? ", one more does it" : ""} · +{mission.rewardXp} XP</>,
    });
  }

  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 14, borderRadius: 14, padding: "4px 12px", textAlign: "left", background: "rgba(76,29,149,0.05)", border: "1px solid rgba(76,29,149,0.16)", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {rows.map((r, i) => (
        <div key={r.key} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "8px 0", borderTop: i ? "1px solid rgba(255,255,255,0.08)" : "none", fontSize: 12.5, lineHeight: 1.4, color: "#22104f" }}>
          <span aria-hidden style={{ fontSize: 15, lineHeight: 1.2, flexShrink: 0 }}>{r.icon}</span>
          <span style={{ minWidth: 0 }}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}
