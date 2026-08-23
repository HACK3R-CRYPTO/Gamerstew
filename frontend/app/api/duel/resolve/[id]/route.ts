import { NextResponse } from "next/server";

// Trigger resolution → games-backend /api/duel/resolve/:id (validator submits the
// scoreboard on-chain). Internal; the backend gates on the internal secret.
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    const r = await fetch(`${backend}/api/duel/resolve/${id}`, {
      method: "POST",
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
