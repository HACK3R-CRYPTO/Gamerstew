import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Player joins the active season's team. Idempotent: if the wallet
// already has a team, returns the existing assignment. Enforces the
// 1.5x soft cap so balance stays automatic.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

type JoinBody = {
  wallet?: string;
  team?: string;
  referrerWallet?: string | null;
};

const VALID_TEAMS = new Set(["alpha", "nova", "pulse"]);

export async function POST(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }

  let body: JoinBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }

  const wallet = body.wallet?.toLowerCase().trim();
  const team = body.team?.toLowerCase().trim();
  let referrer = body.referrerWallet?.toLowerCase().trim() || null;

  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  if (!team || !VALID_TEAMS.has(team)) {
    return NextResponse.json({ error: "invalid team" }, { status: 400 });
  }
  if (referrer && (!/^0x[a-f0-9]{40}$/.test(referrer) || referrer === wallet)) {
    return NextResponse.json({ error: "invalid referrer" }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Fallback: if the request doesn't carry a referrer (typical for a
  // returning player who clicked their own deep link or pasted the URL
  // without ?ref), pull from the server-side intent table written at
  // /mint time. Same shape — a single 0x wallet or null.
  if (!referrer) {
    const { data: intent } = await supabase
      .from("season_v1_referrer_intent")
      .select("referrer_wallet")
      .eq("wallet", wallet)
      .maybeSingle();
    const fromIntent = intent?.referrer_wallet?.toLowerCase().trim();
    if (fromIntent && /^0x[a-f0-9]{40}$/.test(fromIntent) && fromIntent !== wallet) {
      referrer = fromIntent;
    }
  }

  // Pull the active season config first. If no active season, fail loud.
  const { data: meta, error: metaErr } = await supabase
    .from("season_v1_meta")
    .select("starts_at, ends_at, lock_at, active")
    .eq("active", true)
    .maybeSingle();
  if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 500 });
  if (!meta) return NextResponse.json({ error: "no active season" }, { status: 404 });

  const now = new Date();
  if (now > new Date(meta.ends_at)) {
    return NextResponse.json({ error: "season has ended" }, { status: 410 });
  }

  // Idempotent: if the wallet is already in the season, return their
  // existing team rather than erroring or moving them.
  const { data: existing } = await supabase
    .from("season_v1_players")
    .select("team, joined_at, team_locked")
    .eq("wallet", wallet)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      wallet,
      team: existing.team,
      joinedAt: existing.joined_at,
      alreadyJoined: true,
    });
  }

  // Past lock_at, no new joiners. (Late joiners pre-lock can still
  // pick any open team. Post-lock the field is permanently frozen.)
  if (now > new Date(meta.lock_at)) {
    return NextResponse.json({ error: "team picks have locked" }, { status: 410 });
  }

  // Soft cap: a team is closed when it has 1.5x or more players than
  // the smallest team. Computed inside Postgres so the read + check is
  // atomic enough for the small race window we care about.
  const { data: openRes, error: openErr } = await supabase
    .rpc("season_v1_team_open", { p_team: team });
  if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });
  if (!openRes) {
    return NextResponse.json({
      error: "team_full",
      message: `Team ${team} is currently at the soft cap. Pick another team or wait for the cap to widen.`,
    }, { status: 409 });
  }

  // Insert. Unique violation on wallet means a parallel request beat us
  // to it; re-read and return the now-existing row.
  const { error: insertErr } = await supabase
    .from("season_v1_players")
    .insert({ wallet, team, referrer_wallet: referrer });
  if (insertErr) {
    if (insertErr.code === "23505") {
      const { data: after } = await supabase
        .from("season_v1_players")
        .select("team, joined_at")
        .eq("wallet", wallet)
        .maybeSingle();
      if (after) {
        return NextResponse.json({
          wallet, team: after.team, joinedAt: after.joined_at, alreadyJoined: true,
        });
      }
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    wallet,
    team,
    joinedAt: new Date().toISOString(),
    alreadyJoined: false,
  }, { status: 201 });
}
