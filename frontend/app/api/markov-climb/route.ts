import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// MARKOV Climb · 23-day leaderboard event ranked by Challenge-AI match
// count vs MARKOV during the event window. Top 3 by match count at
// deadline take the pool.
//
// Source of truth: agent_match_state. The agent writes one row per
// resolved match with challenger + resolved_at, so the count query is
// a simple WHERE + GROUP BY · no extra indexing or backfill needed.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Hackathon-aligned window in WAT (UTC+1, no DST · the team's home
// timezone). 8:00 AM WAT June 3 = 07:00 UTC. Window closes end of
// June 25 WAT = 22:59 UTC. Ten days past the hackathon submission
// deadline so retention momentum carries past judging.
const EVENT_START_ISO = "2026-06-03T08:00:00+01:00";
const EVENT_END_ISO   = "2026-06-25T23:59:59+01:00";
const MIN_MATCHES_TO_QUALIFY = 30;

const PRIZES = {
  first:  { usdc: 5,  g_dollar: 1000 },
  second: { usdc: 0,  g_dollar: 500  },
  third:  { usdc: 0,  g_dollar: 250  },
};

type LeaderboardEntry = {
  rank: number;
  wallet: string;
  username: string | null;
  matches: number;
  qualified: boolean;
};

export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Pull every resolved match in the window. Counts roll up below.
  // agent_match_state has one row per resolved match; resolved_at is
  // written when resolveMatch confirms. Cap at 5000 to bound the read
  // · realistic event volume tops out an order of magnitude lower.
  const { data: rows, error } = await supabase
    .from("agent_match_state")
    .select("challenger, resolved_at")
    .gte("resolved_at", EVENT_START_ISO)
    .lte("resolved_at", EVENT_END_ISO)
    .limit(5000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    const c = (r.challenger as string | null)?.toLowerCase();
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }

  // Sort, take top 20 for the public surface (we don't need more than
  // that for the UI · top 3 are the only prized tiers).
  const sorted = Array.from(counts.entries())
    .map(([wallet, matches]) => ({ wallet, matches }))
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 20);

  // Resolve usernames via games-backend, same pattern other endpoints
  // use. Internal secret gates no-origin server-to-server calls.
  let nameMap = new Map<string, string | null>();
  if (sorted.length > 0) {
    const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    const secret = process.env.INTERNAL_SECRET || "";
    try {
      const r = await fetch(`${backend}/api/usernames?wallets=${sorted.map(s => s.wallet).join(",")}`, {
        cache: "no-store",
        headers: { "x-internal-secret": secret },
      });
      if (r.ok) {
        const j = (await r.json()) as { usernames: Record<string, string | null> };
        nameMap = new Map(Object.entries(j.usernames || {}));
      }
    } catch { /* leave nameMap empty · rows render short wallet */ }
  }

  const leaderboard: LeaderboardEntry[] = sorted.map((s, i) => ({
    rank: i + 1,
    wallet: s.wallet,
    username: nameMap.get(s.wallet) ?? null,
    matches: s.matches,
    qualified: s.matches >= MIN_MATCHES_TO_QUALIFY,
  }));

  const now = Date.now();
  const startMs = Date.parse(EVENT_START_ISO);
  const endMs   = Date.parse(EVENT_END_ISO);
  const phase: "upcoming" | "live" | "ended" =
    now < startMs ? "upcoming" : now > endMs ? "ended" : "live";

  return NextResponse.json({
    event: {
      id: "markov-climb-1",
      name: "MARKOV Climb",
      tagline: "23-day leaderboard · top 3 win",
      startsAt: EVENT_START_ISO,
      endsAt: EVENT_END_ISO,
      phase,
      minMatchesToQualify: MIN_MATCHES_TO_QUALIFY,
      prizes: PRIZES,
    },
    leaderboard,
  }, {
    headers: {
      // Edge cache · 30s s-maxage with 60s SWR. Match counts roll up
      // monotonically so brief staleness is invisible to users.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
