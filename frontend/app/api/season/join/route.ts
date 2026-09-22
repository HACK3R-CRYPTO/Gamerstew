import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPrivyOwnership, verifyRecentGamePassMint, originAllowed } from "@/lib/walletProof";

// Player joins the active season's team. Idempotent: if the wallet
// already has a team, returns the existing assignment. Enforces the
// 1.5x soft cap so balance stays automatic.
//
// Wallet ownership verification:
//   - Browser users: must pass a valid Privy access token whose linked
//     wallet matches the claimed wallet. Without this, anyone with curl
//     could put any wallet on any team — discovered during the Season 1
//     reminder dry-run.
//   - MiniPay users: MiniPay genuinely cannot sign messages, so they prove
//     ownership with the hash of their GamePass mint tx instead (see
//     lib/walletProof.ts). Requests that prove nothing are still accepted —
//     otherwise legacy MiniPay players could not join at all — but they land
//     UNPROVEN (team_locked = false) and a later proven request from the real
//     owner overwrites them. So a grief is always correctable and can never
//     outrank the owner's own pick.
//
//     The previous version took `isMiniPay` straight from the request BODY and
//     skipped the Privy check whenever it was true, so `{"isMiniPay":true}`
//     disabled auth entirely. The Origin check behind it was `if (origin)`,
//     which does not run at all when the header is absent — and curl omits it
//     by default. Both are fixed: the body flag is gone and origin fails closed.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

type JoinBody = {
  wallet?: string;
  team?: string;
  referrerWallet?: string | null;
  accessToken?: string | null;
  mintTx?: string;
};

const VALID_TEAMS = new Set(["alpha", "nova", "pulse"]);
export async function POST(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }

  // Origin check — first layer of defence. Browser requests carry an
  // Origin header set by the browser; curl-from-anywhere usually
  // doesn't (and spoofing it requires intent). Localhost stays open
  // for dev. Same posture the games-backend uses.
  if (!originAllowed(req)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  }

  let body: JoinBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }

  const wallet = body.wallet?.toLowerCase().trim();
  const team = body.team?.toLowerCase().trim();
  let referrer = body.referrerWallet?.toLowerCase().trim() || null;
  const accessToken = body.accessToken?.trim();
  const mintTx = typeof body.mintTx === "string" ? body.mintTx : "";

  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  if (!team || !VALID_TEAMS.has(team)) {
    return NextResponse.json({ error: "invalid team" }, { status: 400 });
  }
  if (referrer && (!/^0x[a-f0-9]{40}$/.test(referrer) || referrer === wallet)) {
    return NextResponse.json({ error: "invalid referrer" }, { status: 400 });
  }

  // Auth gate. A request is PROVEN when the caller demonstrated control of
  // `wallet` — a Privy token, or a recent GamePass mint tx for MiniPay. An
  // unproven request may still join (legacy MiniPay players have no proof to
  // offer) but it cannot lock, and cannot displace a proven assignment.
  // STRONG vs WEAK, kept separate on purpose (see lib/walletProof.ts).
  // A mint tx hash is public on-chain and therefore replayable, so it may
  // narrow an attack but must never produce an irreversible effect.
  const strong = Boolean(accessToken && await verifyPrivyOwnership(accessToken, wallet));
  const weak = Boolean(!strong && mintTx && await verifyRecentGamePassMint(wallet, mintTx));

  // A presented Privy token that does not match the claimed wallet is always a
  // hard failure. The previous condition was
  // `if (accessToken && !proven && !mintTx)`, which any attacker defeated by
  // sending a junk mintTx alongside — the one case it caught was the only one
  // a real attacker never produces.
  if (accessToken && !strong) {
    return NextResponse.json({ error: "Wallet does not match your session. Reconnect and try again." }, { status: 401 });
  }

  // Only a strong proof may LOCK a team. A weak or absent proof can still join
  // (legacy MiniPay players have nothing else to offer) but stays correctable.
  const proven = strong;

  // Referrer is contested state — it decides who gets credit, and under the
  // event it decides team composition. An unproven caller must never be able to
  // write it for somebody else's wallet. This was the remaining open door into
  // season_v1_referrer_intent's sibling column after /api/season/intent was
  // hardened: ~670 wallets had no row and /join wrote referrer_wallet with no
  // proof at all, permanently.
  if (referrer && !strong && !weak) {
    referrer = null;
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
    // A proven owner may correct an assignment that was never proven — that is
    // the escape hatch that makes the unproven path safe to keep open.
    if (!existing.team_locked && proven && existing.team !== team) {
      const { error: fixErr } = await supabase
        .from("season_v1_players")
        .update({ team, team_locked: true, ...(referrer ? { referrer_wallet: referrer } : {}) })
        .eq("wallet", wallet)
        .eq("team_locked", false); // no-op if someone proved it first
      if (!fixErr) {
        return NextResponse.json({ wallet, team, joinedAt: existing.joined_at, corrected: true });
      }
    }
    // Proven request, same team already recorded — lock it so it can't be moved.
    if (!existing.team_locked && proven) {
      await supabase.from("season_v1_players").update({ team_locked: true }).eq("wallet", wallet);
    }
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
    .insert({ wallet, team, referrer_wallet: referrer, team_locked: proven });
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
