import { NextResponse } from "next/server";

// Competition payouts to players · forwards to games-backend /api/payouts, which
// reads the committed, tx-linked ledger. Same server-to-server pattern as
// /api/impact-stats: the backend origin gate needs the internal secret.

export const dynamic = "force-dynamic";

export async function GET() {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    const r = await fetch(`${backend}/api/payouts`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    const j = await r.json();
    return NextResponse.json(j, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    // Never break the page · the client falls back to its pinned constants.
    return NextResponse.json({ payouts: [], totals: {}, playerSlotsPaid: 0, updatedAt: null }, { status: 200 });
  }
}
