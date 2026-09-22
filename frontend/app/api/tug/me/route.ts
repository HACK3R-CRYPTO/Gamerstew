import { NextResponse } from "next/server";

// Per-player Tug of War state → games-backend /api/tug/me.
//
// Served UNCACHED and per-wallet. The public standings can be cached for
// everyone, but "am I in the money" must never be: caching it risks serving one
// player another player's rank, which is unacceptable when a bounty slot
// depends on it.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const secret = process.env.INTERNAL_SECRET || "";
  const wallet = new URL(req.url).searchParams.get("wallet") || "";
  try {
    const r = await fetch(`${backend}/api/tug/me${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`, {
      cache: "no-store",
      headers: { "x-internal-secret": secret },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    return NextResponse.json(await r.json(), {
      // Private and short-lived, never shared. It must not be edge-cached —
      // serving one player another player's rank is unacceptable when a bounty
      // slot depends on it — but a few seconds in the player's OWN browser
      // costs nothing and absorbs double-fires from remounts and tab wakes.
      headers: { "Cache-Control": "private, max-age=5" },
    });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
