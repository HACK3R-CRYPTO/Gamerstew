import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Per-wallet season status. Powers the "your stats" panel on /season.
// Returns: which team (or null if not joined), counted games + qualified
// flag, solo ladder points + rank, referral credit count.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const MIN_GAMES = 40;
const MAX_COUNTED = 100;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ wallet: string }> },
) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }

  const { wallet: rawWallet } = await params;
  const wallet = rawWallet?.toLowerCase().trim();
  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: meta } = await supabase
    .from("season_v1_meta")
    .select("starts_at, ends_at, target_per_team")
    .eq("active", true)
    .maybeSingle();
  if (!meta) return NextResponse.json({ error: "no active season" }, { status: 404 });

  // Team assignment.
  const { data: player } = await supabase
    .from("season_v1_players")
    .select("team, joined_at, referrer_wallet")
    .eq("wallet", wallet)
    .maybeSingle();

  // Username + avatar identity. Source of truth is the GamePass NFT
  // (on-chain), exposed through games-backend /api/usernames (LRU-cached
  // resolveUsername). Using the same source the existing /leaderboard
  // and /profile use means the same person shows up under the same
  // character — and the same DiceBear avatar — across the app.
  let username: string | null = null;
  try {
    // Server-to-server: backend gates no-origin requests on INTERNAL_SECRET
    // (see app/actions/game.ts). Without the header Railway returns 403,
    // we'd swallow it, and the ladder would show short wallets instead of
    // real names.
    const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    const secret = process.env.INTERNAL_SECRET || "";
    const r = await fetch(`${backend}/api/usernames?wallets=${wallet}`, {
      cache: "no-store",
      headers: { "x-internal-secret": secret },
    });
    if (r.ok) {
      const j = (await r.json()) as { usernames: Record<string, string | null> };
      username = j.usernames?.[wallet] ?? null;
    }
  } catch { /* fall through with null username — UI shows short wallet */ }

  // Completed-game count for this wallet — same source the team-total RPC
  // now uses: season_v1_points rows with action_type='game_played'. The
  // points ledger only records games that passed the 8s duration gate in
  // /api/sign-score, so it represents real completed plays. The old
  // implementation counted game_sessions starts which include abandoned
  // and double-fired sessions, inflating the displayed count beyond what
  // the user remembers playing.
  const { count: rawGames } = await supabase
    .from("season_v1_points")
    .select("id", { count: "exact", head: true })
    .ilike("wallet", wallet)
    .eq("action_type", "game_played")
    .gte("occurred_at", meta.starts_at)
    .lte("occurred_at", meta.ends_at);

  const games = rawGames ?? 0;
  const counted = Math.min(games, MAX_COUNTED);
  const qualified = games >= MIN_GAMES;

  // Per-action breakdown for the UI ("10 games × 4 = 40", etc.). Pulled
  // straight from the ledger so callers can render a familiar table.
  const { data: pointsRow } = await supabase
    .from("season_v1_points")
    .select("points, action_type")
    .ilike("wallet", wallet)
    .gte("occurred_at", meta.starts_at)
    .lte("occurred_at", meta.ends_at);
  const breakdown: Record<string, { count: number; points: number }> = {};
  for (const r of pointsRow ?? []) {
    const t = (r.action_type as string) ?? "unknown";
    const p = (r.points as number) ?? 0;
    if (!breakdown[t]) breakdown[t] = { count: 0, points: 0 };
    breakdown[t].count += 1;
    breakdown[t].points += p;
  }

  // Solo Ladder canonical points + rank — both come from the same RPC
  // the public leaderboard uses, so YOUR SCORE on the card and the YOU
  // row on the ladder always agree. The old "sum the ledger" path
  // missed the refs × 100 and active-day × 5 bonuses, which produced an
  // 8 vs 13 mismatch for the test wallet.
  const RANK_FETCH = 500;
  const { data: ladder } = await supabase.rpc("season_v1_solo_top_full", { p_limit: RANK_FETCH });
  type LadderRow = {
    wallet: string; points: number; rank: number;
    games?: number; wins?: number; claims?: number;
    refs?: number; streak?: number;
  };
  const rankRow = (ladder as LadderRow[] | null)?.find(r => r.wallet?.toLowerCase() === wallet);
  const rank = rankRow ? rankRow.rank : null;
  const points = rankRow ? rankRow.points : 0;
  const referralCount = rankRow?.refs ?? 0;
  // Surface refs + streak in the breakdown so the breakdown card can
  // render them alongside the ledger-sourced rows (no ledger rows exist
  // for these — they're computed in the RPC).
  if (referralCount > 0) {
    breakdown["referral_qualified"] = { count: referralCount, points: referralCount * 100 };
  }
  if (rankRow?.streak && rankRow.streak > 0) {
    breakdown["active_day"] = { count: rankRow.streak, points: rankRow.streak * 5 };
  }

  return NextResponse.json({
    wallet,
    username,
    team: player?.team ?? null,
    joinedAt: player?.joined_at ?? null,
    referrerWallet: player?.referrer_wallet ?? null,
    games,
    counted,
    qualified,
    minGames: MIN_GAMES,
    maxCounted: MAX_COUNTED,
    soloPoints: points,
    soloRank: rank,
    soloBreakdown: breakdown, // { action_type: { count, points } }
    referralCount,
    target: meta.target_per_team,
    seasonEndsAt: meta.ends_at,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
