import { NextResponse } from "next/server";

// Tug of War standings proxy → games-backend /api/tug.
//
// The backend computes this from the subgraph and the GoodDollar Identity
// contract rather than from a table, so every number here is re-derivable from
// chain state. It caches for 15s on its side; the short edge cache below keeps
// a burst of players from each triggering their own rebuild.

export const dynamic = "force-dynamic";

export async function GET() {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const secret = process.env.INTERNAL_SECRET || "";
  try {
    const r = await fetch(`${backend}/api/tug`, {
      cache: "no-store",
      headers: { "x-internal-secret": secret },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    return NextResponse.json(await r.json(), {
      // Every viewer gets the identical standing, so let the CDN serve it.
      // s-maxage=15 means one function invocation per 15s for the WHOLE
      // audience instead of one per player per poll; stale-while-revalidate
      // means nobody ever waits on the refresh.
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" },
    });
  } catch {
    // 503 rather than a fabricated standing: the page keeps its last good rope
    // and shows how stale it is. A blank or zeroed scoreboard mid-event reads
    // as "the event is broken", which is worse than a slightly old one.
    return NextResponse.json({ error: "standings unavailable" }, { status: 503 });
  }
}
