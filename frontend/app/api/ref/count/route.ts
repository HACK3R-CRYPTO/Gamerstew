import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// How many people this wallet has referred. A referral counts when the
// referred player MINTS their GamePass (mint requires GoodDollar
// verification) — that's when /api/season/intent writes the first-write-wins
// row. Not tied to any season event.

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
