import { NextResponse } from "next/server";
import { checkedWallet } from "@/lib/server/roomWallet";

// Friends → games-backend /api/friends/*
// The wallet a request acts as is the one the sign-in proves (the same check a
// friend room uses), never one the browser names in the body or the path.
export const dynamic = "force-dynamic";
const POSTS = new Set(["request", "accept", "remove", "invite", "ping"]);

async function forward(req: Request, action: string, method: "GET" | "POST") {
  if (method === "GET" ? action !== "list" && action !== "search" : !POSTS.has(action)) return NextResponse.json({ error: "bad_path" }, { status: 400 });
  const wallet = await checkedWallet(req);
  if (!wallet) return NextResponse.json({ error: "sign_in" }, { status: 401 });
  let body: string | undefined;
  if (method === "POST") { body = await req.text(); if (body.length > 2000) return NextResponse.json({ error: "too_big" }, { status: 413 }); }
  const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  try {
    const r = await fetch(`${backend}/api/friends/${wallet}${action === "list" ? "" : `/${action}`}${action === "search" ? `?q=${encodeURIComponent((new URL(req.url).searchParams.get("q") || "").slice(0, 60))}` : ""}`, { method, cache: "no-store", headers: { "content-type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" }, body: body || (method === "POST" ? "{}" : undefined) });
    const data = await r.json().catch(() => ({ error: "bad_reply" }));
    return NextResponse.json(data, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "unreachable" }, { status: 502 }); }
}
export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) { return forward(req, (await params).action, "GET"); }
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) { return forward(req, (await params).action, "POST"); }
