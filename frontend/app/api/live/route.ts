import { NextResponse } from "next/server";

// Where the live line is. A socket cannot pass through this site's server, so
// the browser connects to the game server itself; this tells it where that is.
// The address is not a secret: a connection can do nothing without a room's
// seat key or watch name, and the game server only accepts this site's pages.
export const dynamic = "force-dynamic";

export function GET() {
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "";
  let url = "";
  try { const u = new URL(backend); u.protocol = u.protocol === "https:" ? "wss:" : "ws:"; u.pathname = "/live"; u.search = ""; url = u.toString(); } catch { /* not configured: phones fall back to asking */ }
  return NextResponse.json({ url }, { headers: { "Cache-Control": "public, max-age=300" } });
}
