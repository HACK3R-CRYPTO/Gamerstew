import { NextResponse } from "next/server";

// Broadcast-push proxy. Lets you send a push through the stable gamearenahq.xyz
// domain instead of the Railway backend URL directly — Railway regenerates that
// domain and it periodically fails to resolve from local machines, which was
// blocking push sends. The frontend server always reaches the backend via
// BACKEND_URL, so routing through here is reliable.
//
// Same security as the backend endpoint: the caller must present the
// x-internal-secret; we verify it, then forward with the secret. No secret in,
// no broadcast out.
//
// Usage:
//   curl -X POST https://gamearenahq.xyz/api/push \
//     -H "x-internal-secret: $INTERNAL_SECRET" -H "Content-Type: application/json" \
//     -d '{"title":"...","body":"...","url":"/events","tag":"..."}'

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.INTERNAL_SECRET ?? "";
  const provided = req.headers.get("x-internal-secret") ?? "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const backend =
    process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const body = await req.text();

  try {
    const r = await fetch(`${backend}/api/push/broadcast`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body,
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
