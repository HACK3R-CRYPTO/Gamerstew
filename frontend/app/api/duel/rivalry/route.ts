import { NextResponse } from "next/server";

// Head-to-head record between two wallets → games-backend /api/duel/rivalry
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const a = url.searchParams.get("a") || "";
  const b = url.searchParams.get("b") || "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(a) || !/^0x[0-9a-fA-F]{40}$/.test(b)) {
    return NextResponse.json({ error: "two wallets required" }, { status: 400 });
  }
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    const r = await fetch(`${backend}/api/duel/rivalry?a=${a}&b=${b}`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ a, b, winsA: 0, winsB: 0, ties: 0, lastPlayed: null });
  }
}
