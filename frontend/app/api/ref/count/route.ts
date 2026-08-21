import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// How many people JOINED through this wallet's code (minted a GamePass via the
// first-write-wins row in season_v1_referrer_intent). This is a lifetime
// "joined" count — NOT a live verified count and NOT event-scoped. GoodDollar
// verification can lapse after mint, so surface this as "joined", never
// "verified" (event referral POINTS separately require the friend to be
// verified AND to have played the event — see the Cup referral lane).

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.toLowerCase().trim() ?? "";
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return NextResponse.json({ count: 0 });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { count } = await supabase
      .from("season_v1_referrer_intent")
      .select("wallet", { count: "exact", head: true })
      .ilike("referrer_wallet", wallet);
    return NextResponse.json({ count: count ?? 0 });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
