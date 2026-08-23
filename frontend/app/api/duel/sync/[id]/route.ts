import { NextResponse } from "next/server";

// Mirror one room from chain (trustless read) → games-backend /api/duel/sync/:id
// Called by the client right after create/join so the hub reflects it fast.
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const body = await req.text().catch(() => "");
  try {
    const r = await fetch(`${backend}/api/duel/sync/${id}`, {
      method: "POST",
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "", "content-type": "application/json" },
      body: body || undefined,
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
