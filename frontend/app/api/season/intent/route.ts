import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPrivyOwnership, verifyRecentGamePassMint, originAllowed } from "@/lib/walletProof";

// Server-side capture of a player's chosen referrer at GamePass mint
// time. Replaces the previous localStorage stash which lost the value
// across devices, incognito sessions, and cache clears.
//
// Idempotent: first write wins. The mint screen is the lock-in moment
// by product design — once a row exists for this wallet, subsequent
// posts return ok=true but leave the original referrer alone. That
// matches the "ONE-TIME · LOCKS ON MINT" caption shown to the player.
//
// AUTHENTICATION. This route previously had none at all — it validated that
// `wallet` and `referrer` were well-formed hex and wrote the row. Combined
// with first-write-wins that meant anyone could permanently assign themselves
// as the referrer of every wallet that had no row yet (~670 of 752), simply by
// enumerating players from the public subgraph. The referral lane and the
// connector crown both read this table, so that was a live scoreboard takeover
// for the cost of a few hundred POSTs.
//
// The caller must now prove control of `wallet`: a Privy token, or — for
// MiniPay, which cannot sign messages — the hash of the GamePass mint they
// just made. See lib/walletProof.ts.

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function normWallet(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.toLowerCase().trim();
  return /^0x[a-f0-9]{40}$/.test(v) ? v : null;
}

export async function POST(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }
  if (!originAllowed(req)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  }

  let body: { wallet?: unknown; referrer?: unknown; mintTx?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body — fall through to validation */ }

  const wallet = normWallet(body.wallet);
  const referrer = normWallet(body.referrer);
  if (!wallet) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  if (!referrer) return NextResponse.json({ error: "invalid referrer" }, { status: 400 });
  if (wallet === referrer) return NextResponse.json({ error: "can't refer yourself" }, { status: 400 });

  // ── Prove the caller controls `wallet` ──────────────────────────────────
  const accessToken = req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const mintTx = typeof body.mintTx === "string" ? body.mintTx : "";
  const proven =
    (accessToken && await verifyPrivyOwnership(accessToken, wallet)) ||
    (mintTx && await verifyRecentGamePassMint(wallet, mintTx));
  if (!proven) {
    return NextResponse.json(
      { error: "Could not verify this wallet. Reconnect and try again." },
      { status: 401 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // First write wins. If a row already exists for this wallet we treat
  // the call as a no-op so a refresh on /mint can't accidentally rewrite
  // the value the player committed to on their first successful mint.
  const { data: existing } = await supabase
    .from("season_v1_referrer_intent")
    .select("referrer_wallet")
    .eq("wallet", wallet)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, referrer: existing.referrer_wallet, locked: true });
  }

  const { error } = await supabase
    .from("season_v1_referrer_intent")
    .insert({ wallet, referrer_wallet: referrer });

  if (error) {
    // Unique-violation race: another tab/process wrote between our
    // SELECT and INSERT. Read the winner so the client still gets a
    // consistent answer.
    if (error.code === "23505") {
      const { data: winner } = await supabase
        .from("season_v1_referrer_intent")
        .select("referrer_wallet")
        .eq("wallet", wallet)
        .maybeSingle();
      return NextResponse.json({ ok: true, referrer: winner?.referrer_wallet ?? referrer, locked: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, referrer, locked: false });
}
