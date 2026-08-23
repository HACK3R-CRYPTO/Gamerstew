import { NextResponse } from "next/server";

// One room's detail + participants → games-backend /api/duel/room/:id
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    const r = await fetch(`${backend}/api/duel/room/${id}`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    if (!r.ok) return NextResponse.json({ error: "not_found" }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
