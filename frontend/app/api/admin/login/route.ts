import { NextResponse } from "next/server";
import { adminPost } from "@/lib/server/adminApi";
import { ADMIN_COOKIE, sealSession, type AdminRole } from "@/lib/server/adminSession";

export const dynamic = "force-dynamic";

// POST { email, password } → sets the signed session cookie
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!b.email || !b.password) return NextResponse.json({ error: "missing" }, { status: 400 });
  const r = await adminPost("admin/login", { email: b.email, password: b.password }, "");
  if (!r.ok) return NextResponse.json({ error: r.error || "wrong" }, { status: r.error === "locked" ? 429 : r.error === "unreachable" ? 502 : 401 });
  const s = sealSession({ email: String(r.body.email), name: (r.body.name as string | null) ?? null, role: r.body.role as AdminRole });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: s.maxAge });
  return res;
}
