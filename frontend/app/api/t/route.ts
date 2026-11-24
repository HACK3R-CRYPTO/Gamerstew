import { NextResponse } from "next/server";

// Visit and event tracking, first party. The browser posts a small batch here;
// this passes it to the backend with the internal secret. Nothing about the
// visitor's network address is stored. Always answers 204: tracking must never
// be something a page waits on or fails because of.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 6000) return new NextResponse(null, { status: 204 });
    const b = JSON.parse(raw || "{}") as { events?: unknown[] };
    if (Array.isArray(b.events) && b.events.length) {
      await fetch(`${process.env.BACKEND_URL || "http://localhost:3005"}/internal/track`, {
        method: "POST", cache: "no-store",
        headers: { "content-type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
        body: JSON.stringify({ events: b.events.slice(0, 20) }),
      }).catch(() => {});
    }
  } catch { /* a malformed beacon is dropped */ }
  return new NextResponse(null, { status: 204 });
}
