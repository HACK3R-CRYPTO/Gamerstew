// ─── /home data preloader ─────────────────────────────────────────────────────
// The splash screen plays a ~4s typing animation while doing zero useful
// work — then /home mounts and fires its three fetches from scratch, so
// players stare at "Loading live standings…" AFTER already waiting through
// a splash. This module lets the splash start those exact fetches the
// moment it mounts; by the time the animation finishes, the data is
// sitting in memory and /home paints instantly.
//
// Module-level promise cache: survives the client-side navigation from
// / to /home (same JS session). One flight, shared by both surfaces.
// TTL keeps a long-idle splash tab from serving stale numbers.

import { fetchAllTimeLeaderboard, type AllTimeEntry } from "@/lib/subgraph";

const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.2/gn";

export type HomePreload = {
  stat: { totalPlayers: number; totalScores: number; totalUbiDonatedG: number } | null;
  top3: AllTimeEntry[];
  climb: { phase: string; endsAt: string } | null;
};

export async function fetchGlobalStat(): Promise<HomePreload["stat"]> {
  try {
    const r = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{ globalStat(id: "global") { totalPlayers totalScores totalUbiDonatedG } }` }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const g = j?.data?.globalStat;
    if (!g) return null;
    return {
      totalPlayers: Number(g.totalPlayers),
      totalScores: Number(g.totalScores),
      totalUbiDonatedG: Math.round(Number(g.totalUbiDonatedG) / 1e18),
    };
  } catch {
    return null;
  }
}

const TTL_MS = 60_000;
let inflight: Promise<HomePreload> | null = null;
let startedAt = 0;

function startFetch(): Promise<HomePreload> {
  const climbReq = fetch("/api/markov-climb", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then(d => (d?.event ? { phase: String(d.event.phase ?? ""), endsAt: String(d.event.endsAt ?? "") } : null))
    .catch(() => null);

  return Promise.all([fetchGlobalStat(), fetchAllTimeLeaderboard(3).catch(() => [] as AllTimeEntry[]), climbReq])
    .then(([stat, top3, climb]) => ({ stat, top3, climb }));
}

// Fire-and-forget from the splash. Idempotent — repeated calls inside the
// TTL share one flight.
export function preloadHomeData(): void {
  if (!inflight || Date.now() - startedAt > TTL_MS) {
    startedAt = Date.now();
    inflight = startFetch();
  }
}

// Awaited by /home. Joins the splash's flight when one is warm, otherwise
// starts fresh (direct navigation to /home, hard refresh, expired TTL).
export function getHomeData(): Promise<HomePreload> {
  preloadHomeData();
  return inflight!;
}
