import { NextResponse } from "next/server";

// Live perk economy figures for the impact page · real totals from
// arena_purchases (purchases + G$ spent), replacing the old hardcoded
// estimate. The aggregation + hour-long cache live in games-backend
// /api/impact-stats; this handler forwards to it, matching the pattern the
// other /api routes use.

export const dynamic = "force-dynamic";

export async function GET() {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    // Server-to-server call has no browser Origin, so the backend's origin gate
    // requires the internal secret — without it the endpoint 403s and the page
    // silently falls back to its pinned estimate (why it showed a stale count).
    const r = await fetch(`${backend}/api/impact-stats`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    const j = await r.json();
    return NextResponse.json(j, {
      // Backend already caches an hour; a short edge cache keeps the page snappy.
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    // Never break the page · the client falls back to its pinned estimate.
    return NextResponse.json({ perkPurchases: null, perkSpendG: null, updatedAt: null }, { status: 200 });
  }
}
