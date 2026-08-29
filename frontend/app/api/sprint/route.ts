import { NextResponse } from "next/server";

// Private Sprint board → games-backend /api/sprint. Pass ?wallet so the backend
// can gate to the roster/host and mark "you".
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const wallet = new URL(req.url).searchParams.get("wallet") || "";
  try {
    const r = await fetch(`${backend}/api/sprint?wallet=${encodeURIComponent(wallet)}`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    return NextResponse.json(await r.json(), {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch {
    return NextResponse.json({ event: null, viewer: { allowed: false }, board: [] });
  }
}
