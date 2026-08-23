import { NextResponse } from "next/server";

// Challenges hub feed → games-backend /api/duel/rooms (public, open rooms only).
export const dynamic = "force-dynamic";

export async function GET() {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    const r = await fetch(`${backend}/api/duel/rooms`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    return NextResponse.json(await r.json(), {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch {
    return NextResponse.json({ rooms: [] });
  }
}
