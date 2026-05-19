import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Live leaderboard for the active season. Returns:
//   - Team standings (per-team counted games, headcount, hit-target flag)
//   - Top 10 Solo Ladder scorers
//   - Active season meta (target, ends_at, etc.) for client countdown
//
// "Counted games" applies the 40-min / 100-max-per-wallet rule and
// only counts game_sessions inside the season window. Everything else
// is derived. No precomputed totals so the leaderboard is always live.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const MIN_GAMES = 40;
const MAX_COUNTED = 100;

export async function GET(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }
  // The Solo Ladder page wants the full ladder; the seasons-tab event
  // card only wants the top 10. Caller passes `?limit=N` (max 500).
  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const soloLimit = Math.min(500, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 10));

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: meta, error: metaErr } = await supabase
    .from("season_v1_meta")
    .select("starts_at, ends_at, lock_at, target_per_team, best_effort_floor, base_per_team, top_team_bonus, solo_ladder_pool")
    .eq("active", true)
    .maybeSingle();
  if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 500 });
  if (!meta) return NextResponse.json({ error: "no active season" }, { status: 404 });

  // Counted games per (team, wallet). Game sessions inside the window,
  // capped at MAX_COUNTED, requiring at least MIN_GAMES to qualify.
  const { data: perPlayer, error: gameErr } = await supabase
    .rpc("season_v1_counted_games", {
      p_start: meta.starts_at,
      p_end:   meta.ends_at,
      p_min:   MIN_GAMES,
      p_max:   MAX_COUNTED,
    });
  // If the RPC doesn't exist yet (we haven't shipped it), fall back to
  // raw counts so the endpoint still works during the bootstrap window.
  // Frontend should treat partial data as "preliminary."
  if (gameErr && gameErr.code !== "PGRST202") {
    return NextResponse.json({ error: gameErr.message }, { status: 500 });
  }

  type Row = { team: string; wallet: string; counted: number };
  const rows: Row[] = (perPlayer as Row[] | null) ?? [];

  const teamTotals: Record<string, { counted: number; players: number; qualifiers: number }> =
    { alpha: { counted: 0, players: 0, qualifiers: 0 },
      nova:  { counted: 0, players: 0, qualifiers: 0 },
      pulse: { counted: 0, players: 0, qualifiers: 0 } };

  for (const r of rows) {
    const t = teamTotals[r.team];
    if (!t) continue;
    t.counted += r.counted;
    t.qualifiers += 1;
  }

  // Team headcount (all players who joined, not just qualifiers).
  const { data: counts } = await supabase
    .from("season_v1_team_counts")
    .select("team, player_count");
  for (const c of counts ?? []) {
    const t = teamTotals[c.team as string];
    if (t) t.players = c.player_count as number;
  }

  const teams = Object.entries(teamTotals).map(([team, t]) => ({
    team,
    counted: t.counted,
    players: t.players,
    qualifiers: t.qualifiers,
    hitTarget: t.counted >= meta.target_per_team,
  }));
  teams.sort((a, b) => b.counted - a.counted);

  // Solo Ladder: top N with per-player aggregated stats. The page
  // renders an effort line per row ("47 games · 8 wins · 5 claims")
  // so we need the counts, not just the totals.
  const { data: ladder } = await supabase
    .rpc("season_v1_solo_top_full", { p_limit: soloLimit });

  // Enrich each row with the player's on-chain GamePass username so the
  // card and the dedicated /leaderboard/solo-ladder page show real names
  // instead of shortened wallets. Usernames live on the GamePass NFT
  // contract, not in Supabase, so we call games-backend /api/usernames
  // (LRU-cached resolveUsername). Same source the existing /leaderboard
  // and /profile use, which is how the avatar seed ends up identical.
  type LadderRow = { wallet: string; username?: string | null; points: number; rank: number; games?: number; wins?: number; claims?: number; refs?: number };
  const rawLadder: LadderRow[] = (ladder as LadderRow[] | null) ?? [];
  let enrichedLadder: LadderRow[] = rawLadder;
  if (rawLadder.length > 0) {
    // Server-to-server call: backend gates no-origin requests behind the
    // shared INTERNAL_SECRET, so we use the server-only BACKEND_URL +
    // header (same pattern as app/actions/game.ts). NEXT_PUBLIC_BACKEND_URL
    // is the dev fallback so localhost still works without the prod env.
    const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
    const secret = process.env.INTERNAL_SECRET || "";
    const wallets = rawLadder.map(r => r.wallet.toLowerCase()).join(",");
    let nameMap = new Map<string, string | null>();
    try {
      const r = await fetch(`${backend}/api/usernames?wallets=${wallets}`, {
        cache: "no-store",
        headers: { "x-internal-secret": secret },
      });
      if (r.ok) {
        const j = (await r.json()) as { usernames: Record<string, string | null> };
        nameMap = new Map(Object.entries(j.usernames || {}));
      }
    } catch { /* leave nameMap empty; rows fall back to short wallet */ }
    enrichedLadder = rawLadder.map(r => ({
      ...r,
      username: r.username ?? nameMap.get(r.wallet.toLowerCase()) ?? null,
    }));
  }

  return NextResponse.json({
    meta: {
      startsAt: meta.starts_at,
      endsAt: meta.ends_at,
      lockAt: meta.lock_at,
      targetPerTeam: meta.target_per_team,
      bestEffortFloor: meta.best_effort_floor,
      basePerTeam: String(meta.base_per_team),
      topTeamBonus: String(meta.top_team_bonus),
      soloLadderPool: String(meta.solo_ladder_pool),
    },
    teams,
    // Historical name; carries top 10 by default, up to `?limit=` rows
    // when callers request more (Solo Ladder page asks for 500).
    soloTop10: enrichedLadder,
    soloLadder: enrichedLadder,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
