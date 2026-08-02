import { NextResponse } from "next/server";

// Resolve a referral code to a wallet. Codes are GamePass usernames (unique
// on-chain, memorable, speakable — "use my code ogazboiz") with raw 0x
// addresses still accepted for backwards compatibility. Case-insensitive:
// usernames are checked as typed and lowercased.

const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.2/gn";

export const dynamic = "force-dynamic";

async function byUsername(name: string): Promise<{ id: string; username: string } | null> {
  try {
    const r = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query Ref($u: String!) { players(where: { username: $u }, first: 1) { id username } }`,
        variables: { u: name },
      }),
    });
    const json = await r.json();
    return json?.data?.players?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim() ?? "";
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  // Raw address passes through untouched.
  if (/^0x[0-9a-fA-F]{40}$/.test(code)) {
    return NextResponse.json({ address: code.toLowerCase(), username: null });
  }

  // Username code: sane shape only, then as-typed → lowercased.
  if (!/^[a-zA-Z0-9_]{2,24}$/.test(code)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const hit = (await byUsername(code)) ?? (await byUsername(code.toLowerCase()));
  if (!hit) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ address: hit.id.toLowerCase(), username: hit.username });
}
