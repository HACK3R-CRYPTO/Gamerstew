import { NextResponse } from "next/server";

// GoodDollar-verified player count · the true "real humans" number, not just
// GamePass minters. The heavy lifting (one on-chain isWhitelisted read per
// wallet, hour-long cache) lives in games-backend /api/verified-stats; this
// handler just forwards to it, matching the pattern the other /api routes use.

export const dynamic = "force-dynamic";

export async function GET() {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    const r = await fetch(`${backend}/api/verified-stats`, { cache: "no-store" });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    const j = await r.json();
    return NextResponse.json(j, {
      // Verification is sticky and the backend already caches an hour, so a
      // short edge cache is safe and keeps the page snappy.
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    // Never break the page · the client falls back to its pinned floor.
    return NextResponse.json({ totalPlayers: 0, verifiedPlayers: 0, verifiedPct: 0, updatedAt: null }, { status: 200 });
  }
}
