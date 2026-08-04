import { NextResponse } from "next/server";
import { CUP_START, CUP_END } from "@/lib/cup";

// Arena Cup ladder proxy → games-backend /api/cup (computes both ladders, the
// crowns, and the community pot). Passes ?wallet through for "my rank".

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const secret = process.env.INTERNAL_SECRET || "";
  const wallet = new URL(req.url).searchParams.get("wallet") || "";
  try {
    // Server-to-server (no browser origin) → the backend's origin gate requires
    // the internal secret, same as the markov-climb route.
    const r = await fetch(`${backend}/api/cup${wallet ? `?wallet=${wallet}` : ""}`, {
      cache: "no-store",
      headers: { "x-internal-secret": secret },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    const j = await r.json();
    return NextResponse.json(j, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch {
    // Backend unreachable → still return the real window so the page shows the
    // correct "upcoming/live" state (without startsAt/endsAt the client's phase
    // math falls through to "live" on NaN comparisons — the phantom-data bug).
    return NextResponse.json(
      { startsAt: CUP_START, endsAt: CUP_END, phase: "upcoming", human: [], agent: [], crowns: { connector: null, streak: null }, pot: null, me: null },
      { status: 200 },
    );
  }
}
