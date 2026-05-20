import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side capture of a player's chosen referrer at GamePass mint
// time. Replaces the previous localStorage stash which lost the value
// across devices, incognito sessions, and cache clears.
//
// Idempotent: first write wins. The mint screen is the lock-in moment
// by product design — once a row exists for this wallet, subsequent
// posts return ok=true but leave the original referrer alone. That
// matches the "ONE-TIME · LOCKS ON MINT" caption shown to the player.

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
  let body: { wallet?: unknown; referrer?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body — fall through to validation */ }

  const wallet = normWallet(body.wallet);
  const referrer = normWallet(body.referrer);
  if (!wallet) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  if (!referrer) return NextResponse.json({ error: "invalid referrer" }, { status: 400 });
  if (wallet === referrer) return NextResponse.json({ error: "can't refer yourself" }, { status: 400 });

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
