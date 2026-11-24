import { NextResponse } from "next/server";

// Local development only: lets `npm run dev` SHOW live data without being able
// to change it. Reads (GET) are passed to the live backend; nothing else is.
// In a production build this route answers 404.
//
// To use it, in .env.local:
//   NEXT_PUBLIC_BACKEND_URL=http://localhost:3001/api/dev-live
//   DEV_LIVE_BACKEND=<the live backend's address>
//   DEV_LIVE_ORIGIN=<the live site's address>
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const live = process.env.DEV_LIVE_BACKEND;
  if (process.env.NODE_ENV !== "development" || !live) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { path } = await ctx.params;
  if (path[0] !== "api" || path.some((p) => p === ".." || p.includes("/"))) return NextResponse.json({ error: "bad_path" }, { status: 400 });
  try {
    const res = await fetch(`${live.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`, {
      headers: process.env.DEV_LIVE_ORIGIN ? { Origin: process.env.DEV_LIVE_ORIGIN } : {},
      cache: "no-store",
    });
    return new NextResponse(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  } catch {
    return NextResponse.json({ error: "live_backend_unreachable" }, { status: 502 });
  }
}
