import { NextResponse } from "next/server";
import { adminRead } from "@/lib/server/adminApi";

export const dynamic = "force-dynamic";

// GET /api/admin/export?kind=daily|games|players|payouts|feed&from=&to=  → a CSV file
const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows: Record<string, unknown>[], cols?: string[]) => { const c = cols ?? [...new Set(rows.flatMap((r) => Object.keys(r)))]; return [c.join(","), ...rows.map((r) => c.map((k) => cell(r[k])).join(","))].join("\n"); };

export async function GET(req: Request) {
  const u = new URL(req.url); const kind = u.searchParams.get("kind") || "daily";
  const from = u.searchParams.get("from") || undefined; const to = u.searchParams.get("to") || undefined;
  let rows: Record<string, unknown>[] = [];
  if (kind === "daily") {
    // one row per day, one column per metric
    const r = await adminRead<{ day: string; metric: string; value: number }[]>("series", { from, to, days: 90 });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const byDay = new Map<string, Record<string, unknown>>();
    for (const x of r.data ?? []) { const d = byDay.get(x.day) ?? { day: x.day }; d[x.metric] = x.value; byDay.set(x.day, d); }
    rows = [...byDay.values()];
  } else {
    if (kind === "purchases") { const r = await adminRead<{ recent: Record<string, unknown>[] }>("money", { from, to, days: 90 }); if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status }); return new NextResponse(csv(r.data?.recent ?? []), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="gamearena-purchases.csv"`, "cache-control": "no-store" } }); }
    const what = kind === "games" ? "games" : kind === "players" ? "players" : kind === "payouts" ? "payouts" : kind === "top" ? "top" : kind === "feed" ? "feed" : null;
    if (!what) return NextResponse.json({ error: "unknown" }, { status: 400 });
    const r = await adminRead<Record<string, unknown>[]>(what, { from, to, days: 90, limit: 300 });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    rows = r.data ?? [];
  }
  return new NextResponse(csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="gamearena-${kind}-${from ?? "last90"}-${to ?? "today"}.csv"`, "cache-control": "no-store" } });
}
