import { NextResponse } from "next/server";

// Arena Cup ladder proxy → games-backend /api/cup (computes both ladders, the
// crowns, and the community pot). Passes ?wallet through for "my rank".

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const wallet = new URL(req.url).searchParams.get("wallet") || "";
  try {
    const r = await fetch(`${backend}/api/cup${wallet ? `?wallet=${wallet}` : ""}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    const j = await r.json();
    return NextResponse.json(j, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json(
      { phase: "upcoming", human: [], agent: [], crowns: { connector: null, streak: null }, pot: null, me: null },
      { status: 200 },
    );
  }
}
