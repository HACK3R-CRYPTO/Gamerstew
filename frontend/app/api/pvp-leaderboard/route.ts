import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

// Platform contract on Celo Mainnet. matchCounter is the source of
// truth for total matches ever created · agent_match_state lags behind
// when off-chain upserts miss (network blips, agent restarts mid-flow).
const ARENA_ADDRESS = "0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE" as const;
const ARENA_ABI = [
  { type: "function", name: "matchCounter", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

// PVP arena lifetime leaderboard · ranks players by total matches played
// vs MARKOV across the entire history of agent_match_state. Includes a
// wins-vs-matches breakdown so the list reads as both a grind ranking
// and a skill ranking simultaneously.
//
// Same shape as /api/markov-climb's leaderboard so the PVP tab UI and
// the climb event card can render through similar primitives.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

type Row = { challenger: string | null; outcome: string | null };

export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Pull every resolved match. Aggregation happens in JS so we don't
  // need a custom Postgres function for this surface. With ~250 matches
  // today and ~10x growth expected through the event window, this stays
  // well under the 1000-row default and the response stays small.
  const { data: rows, error } = await supabase
    .from("agent_match_state")
    .select("challenger, outcome")
    .not("resolved_at", "is", null)
    .limit(5000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stats = new Map<string, { matches: number; wins: number; ties: number }>();
  for (const r of (rows as Row[] | null) ?? []) {
    const c = r.challenger?.toLowerCase();
    if (!c) continue;
    if (!stats.has(c)) stats.set(c, { matches: 0, wins: 0, ties: 0 });
    const s = stats.get(c)!;
    s.matches += 1;
    if (r.outcome === "player_won") s.wins += 1;
    else if (r.outcome === "tie") s.ties += 1;
  }

  const sorted = Array.from(stats.entries())
    .map(([wallet, s]) => ({
      wallet,
      matches: s.matches,
      wins: s.wins,
      ties: s.ties,
      winRate: s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0,
    }))
    .sort((a, b) => b.matches - a.matches || b.wins - a.wins)
    .slice(0, 50);

  // Resolve usernames in one batch via games-backend.
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
    } catch { /* fall through; rows render short wallet */ }
  }

  const leaderboard = sorted.map((s, i) => ({
    rank: i + 1,
    wallet: s.wallet,
    username: nameMap.get(s.wallet) ?? null,
    matches: s.matches,
    wins: s.wins,
    ties: s.ties,
    winRate: s.winRate,
  }));

  // On-chain matchCounter is the truth-source for total match count.
  // Falls back to the off-chain row count if the chain read fails so
  // the page never renders a blank stat.
  let chainTotal: number | null = null;
  try {
    const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
    const counter = await pub.readContract({
      address: ARENA_ADDRESS,
      abi: ARENA_ABI,
      functionName: "matchCounter",
    });
    chainTotal = Number(counter as bigint);
  } catch { /* fall through · use off-chain count */ }

  const offchainTotal = Array.from(stats.values()).reduce((sum, s) => sum + s.matches, 0);

  return NextResponse.json({
    totalPlayers: stats.size,
    totalMatches: chainTotal ?? offchainTotal,
    leaderboard,
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
