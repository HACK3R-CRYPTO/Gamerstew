import { NextResponse } from "next/server";

// Referral tally for a wallet. Proxies the backend, which returns BOTH:
//   count    = friends who JOINED through your code (lifetime, minted a pass)
//   verified = how many of those are GoodDollar-verified RIGHT NOW
// Verification lapses after mint, so `verified` is usually lower than `count` —
// the passport used to show `count` mislabelled as "verified", overstating it.
// Event referral POINTS are separate: the Cup requires a friend to be verified
// AND to have played the event (see the Cup referral lane).

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.toLowerCase().trim() ?? "";
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    // Server-to-server call has no browser Origin, so the backend origin gate
    // needs the internal secret.
    const r = await fetch(`${backend}/api/ref/summary/${wallet}`, {
      cache: "no-store",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    const j = (await r.json()) as { joined?: number; verified?: number };
    return NextResponse.json({ count: j.joined ?? 0, verified: j.verified ?? 0 });
  } catch {
    return NextResponse.json({ count: 0, verified: 0 });
  }
}
