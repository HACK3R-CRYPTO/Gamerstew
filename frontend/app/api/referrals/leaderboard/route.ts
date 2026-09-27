import { NextResponse } from "next/server";

// Creator/thread contest referral leaderboard · forwards to games-backend,
// windowed by ?since / ?until (ISO). Qualified referral = referred player
// verified and played the qualifying games, brought inside the window.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const qs = new URL(req.url).search;
  try {
    const r = await fetch(`${backend}/api/referrals/leaderboard${qs}`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    return NextResponse.json(await r.json(), {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" },
    });
  } catch {
    return NextResponse.json({ leaderboard: [], entrants: 0, updatedAt: null }, { status: 200 });
  }
}
