import { NextResponse } from "next/server";

// Rooms this wallet is in (public + private) → games-backend /api/duel/my
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.toLowerCase() || "";
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ rooms: [] });
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    const r = await fetch(`${backend}/api/duel/my?wallet=${wallet}`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ rooms: [] });
  }
}
