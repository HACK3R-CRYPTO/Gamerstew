import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Returns frozen past seasons (Team Wars + Solo Ladder format) ordered
// newest-first. Each row was sealed by seal_season_v1(p_season_id) once
// the season's ends_at passed, so the standings are immutable.
//
// Usernames are enriched at READ time from the GamePass NFT contract
// (same path /api/season/leaderboard uses) — the seal RPC stores only
// the raw wallets because the RPC has no on-chain read capability.
//
// Powers the "Completed Events" grid on /leaderboard alongside the legacy
// past challenges + past competitions cards.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

type Team = "alpha" | "nova" | "pulse";

type TeamStanding = {
  team: Team;
  counted: number;
  players: number;
  qualifiers: number;
};

type SoloEntry = {
  rank: number;
  wallet: string;
  username: string | null;
  points: number;
  games?: number;
  wins?: number;
  claims?: number;
  refs?: number;
  streak?: number;
};

type Standings = {
  teams: TeamStanding[];
  soloTop10: SoloEntry[];
};

type PrizeWinners = {
  closing_surprise?: {
    wallet: string;
    username?: string | null;
    amount_usdc?: number;
    tx_hash?: string;
  };
};

type ResultRow = {
  season_id: number;
  sealed_at: string;
  starts_at: string;
  ends_at: string;
  standings: Standings;
  prize_winners: PrizeWinners;
};

async function resolveUsernames(wallets: string[]): Promise<Map<string, string | null>> {
  if (wallets.length === 0) return new Map();
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const secret = process.env.INTERNAL_SECRET || "";
  const list = wallets.map(w => w.toLowerCase()).join(",");
  try {
    const r = await fetch(`${backend}/api/usernames?wallets=${list}`, {
      cache: "no-store",
      headers: { "x-internal-secret": secret },
    });
    if (!r.ok) return new Map();
    const j = (await r.json()) as { usernames: Record<string, string | null> };
    return new Map(Object.entries(j.usernames || {}));
  } catch {
    return new Map();
  }
}

export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await supabase
    .from("season_v1_results")
    .select("season_id, sealed_at, starts_at, ends_at, standings, prize_winners")
    .order("ends_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as ResultRow[] | null) ?? [];

  // Collect every wallet across every season's top-10 so we can resolve
  // usernames in a single backend call instead of one per season.
  const allWallets = new Set<string>();
  for (const r of rows) {
    for (const s of (r.standings?.soloTop10 ?? [])) {
      if (s.wallet) allWallets.add(s.wallet.toLowerCase());
    }
    const cs = r.prize_winners?.closing_surprise;
    if (cs?.wallet) allWallets.add(cs.wallet.toLowerCase());
  }
  const nameMap = await resolveUsernames(Array.from(allWallets));

  const seasons = rows.map(r => ({
    ...r,
    standings: {
      teams: r.standings?.teams ?? [],
      soloTop10: (r.standings?.soloTop10 ?? []).map(s => ({
        ...s,
        username: s.username ?? nameMap.get(s.wallet.toLowerCase()) ?? null,
      })),
    },
    prize_winners: {
      ...r.prize_winners,
      closing_surprise: r.prize_winners?.closing_surprise
        ? {
            ...r.prize_winners.closing_surprise,
            username:
              r.prize_winners.closing_surprise.username ??
              nameMap.get(r.prize_winners.closing_surprise.wallet.toLowerCase()) ??
              null,
          }
        : undefined,
    },
  }));

  return NextResponse.json({ seasons }, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
