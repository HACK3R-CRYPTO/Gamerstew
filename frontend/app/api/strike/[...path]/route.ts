import { NextResponse } from "next/server";

// Street Strike online rooms → games-backend /api/strike/rooms/*
// The browser talks to this route; this route talks to the backend with the
// internal secret. Only the room shapes the game uses are let through.
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["join", "start", "roll", "rematch", "leave", "say"]);

function target(path: string[], search: string): string | null {
  if (path[0] !== "rooms" || path.length > 3) return null;
  if (path.length === 1) return "/api/strike/rooms";
  // the list of lanes being played, and a lane by its public watch name (look only)
  if (path.length === 2 && path[1] === "live") return "/api/strike/live";
  if (path.length === 2 && /^[0-9a-f]{8}$/.test(path[1])) return `/api/strike/rooms/${path[1]}${search}`;
  if (!/^[A-Za-z0-9]{5}$/.test(path[1])) return null;
  if (path.length === 2) return `/api/strike/rooms/${path[1].toUpperCase()}${search}`;
  return ACTIONS.has(path[2]) ? `/api/strike/rooms/${path[1].toUpperCase()}/${path[2]}` : null;
}

async function forward(req: Request, path: string[], method: "GET" | "POST") {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const to = target(path, /^[0-9a-f]{32}$/.test(token) ? `?token=${token}` : url.searchParams.get("watch") === "1" ? "?watch=1" : "");
  if (!to) return NextResponse.json({ error: "bad_path" }, { status: 400 });
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    let body: string | undefined;
    if (method === "POST") {
      const raw = await req.text();
      if (raw.length > 8000) return NextResponse.json({ error: "too_big" }, { status: 413 });
      body = raw || "{}";
    }
    const r = await fetch(`${backend}${to}`, {
      method,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_SECRET || "",
        // the player's own address, so the backend can cap how many rooms one person makes
        "x-client-ip": (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64) || "unknown",
      },
      body,
    });
    const data = await r.json().catch(() => ({ error: "bad_reply" }));
    return NextResponse.json(data, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, "GET");
}
export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, "POST");
}
