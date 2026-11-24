// Small building blocks for the admin dashboard. Server components: no state.
import Link from "next/link";
import type { ReactNode } from "react";

export const C = { ink: "#22104f", dim: "rgba(34,16,79,0.68)", line: "rgba(76,29,149,0.16)", accent: "#6d28d9", soft: "#f3effc", good: "#15803d", bad: "#b91c1c", warn: "#b45309" };
export const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "–");
export const short = (w: string | null | undefined) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "–");
export const when = (v: string | null | undefined) => (v ? new Date(v).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "–");
export const dayOf = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "–");
export const txUrl = (h: string) => `https://celoscan.io/tx/${h}`;
export const addrUrl = (a: string) => `https://celoscan.io/address/${a}`;

export function Page({ title, sub, children, right }: { title: string; sub?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div><h1 style={{ margin: 0, fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 28, color: C.ink, fontWeight: 400 }}>{title}</h1>{sub && <p style={{ margin: "4px 0 0", color: C.dim, fontSize: 14 }}>{sub}</p>}</div>
        {right}
      </div>
      {children}
    </div>
  );
}
export function Card({ title, children, note }: { title?: string; children: ReactNode; note?: string }) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: 16, minWidth: 0 }}>
      {title && <h2 style={{ margin: "0 0 10px", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: C.dim, fontWeight: 800 }}>{title}</h2>}
      {children}
      {note && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: C.dim, lineHeight: 1.45 }}>{note}</p>}
    </section>
  );
}
export function Grid({ children, min = 170 }: { children: ReactNode; min?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12, marginBottom: 14 }}>{children}</div>;
}
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16, padding: "13px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.dim }}>{label}</div>
      <div style={{ fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 28, lineHeight: 1.15, color: tone ? C[tone] : C.ink, marginTop: 4, overflowWrap: "anywhere" }}>{value}</div>
      {sub !== undefined && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
/** A number is missing because nothing records it yet: say so, never show a zero. */
export function NotYet({ what, why }: { what: string; why: string }) {
  return <div style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.3)", borderRadius: 14, padding: "11px 13px", color: "#7c2d12", fontSize: 13.5, lineHeight: 1.45, marginBottom: 14 }}><b>{what}:</b> {why}</div>;
}
export function Problem({ error }: { error?: string }) {
  const text = error === "migration_needed" ? "The database migration has not been run yet. Run games-backend/supabase-migrations/2026-11-25_admin_dashboard.sql in Supabase, then select admin_backfill();"
    : error === "unreachable" ? "The game server cannot be reached." : error === "not_allowed" ? "Your role cannot see this page." : `This could not be loaded (${error ?? "unknown"}).`;
  return <div role="alert" style={{ background: "#fef2f2", border: "1px solid rgba(185,28,28,0.3)", borderRadius: 14, padding: "12px 14px", color: C.bad, fontSize: 14, marginBottom: 14 }}>{text}</div>;
}

export interface Col<T> { head: string; cell: (row: T) => ReactNode; right?: boolean }
export function Table<T>({ rows, cols, empty = "Nothing here yet." }: { rows: T[]; cols: Col<T>[]; empty?: string }) {
  if (!rows.length) return <p style={{ color: C.dim, fontSize: 14, margin: 0 }}>{empty}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, color: C.ink }}>
        <thead><tr>{cols.map((c) => <th key={c.head} style={{ textAlign: c.right ? "right" : "left", padding: "7px 10px", fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.dim, borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{c.head}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.head} style={{ textAlign: c.right ? "right" : "left", padding: "8px 10px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{c.cell(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ── series ───────────────────────────────────────────────────────────────────
export type Point = { day: string; value: number };
/** Rows of (day, metric, value) → one filled list of days per metric. A day with no row is zero. */
export function pivot(rows: { day: string; metric: string; value: number | string }[] | null, from: string, to: string): Map<string, Point[]> {
  const days: string[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const by = new Map<string, Map<string, number>>();
  for (const r of rows ?? []) { const m = by.get(r.metric) ?? new Map<string, number>(); m.set(String(r.day).slice(0, 10), Number(r.value)); by.set(r.metric, m); }
  const out = new Map<string, Point[]>();
  for (const [metric, m] of by) out.set(metric, days.map((day) => ({ day, value: m.get(day) ?? 0 })));
  return out;
}
export const sum = (p: Point[] | undefined) => (p ?? []).reduce((a, b) => a + b.value, 0);
export function rangeOf(sp: Record<string, string | string[] | undefined>): { from: string; to: string; days: number } {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = new Date().toISOString().slice(0, 10);
  const ok = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (ok(one("from")) && ok(one("to")) && one("from") <= one("to")) return { from: one("from"), to: one("to"), days: Math.round((Date.parse(one("to")) - Date.parse(one("from"))) / 86400000) + 1 };
  const days = [7, 30, 90, 365].includes(Number(one("days"))) ? Number(one("days")) : 30;
  return { from: new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10), to: today, days };
}
export function RangeLinks({ base, days, extra = "" }: { base: string; days: number; extra?: string }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[7, 30, 90, 365].map((d) => (
        <Link key={d} href={`${base}?days=${d}${extra}`} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 700, textDecoration: "none", color: d === days ? "#fff" : C.ink, background: d === days ? C.accent : "#fff", border: `1px solid ${d === days ? C.accent : C.line}` }}>{d === 365 ? "1 year" : `${d} days`}</Link>
      ))}
    </div>
  );
}

/** A plain line chart. One or two series on one scale, first and last day labelled. */
export function Chart({ series, height = 150 }: { series: { name: string; color: string; points: Point[] }[]; height?: number }) {
  const n = Math.max(...series.map((s) => s.points.length), 0);
  if (n < 2) return <p style={{ color: C.dim, fontSize: 14, margin: 0 }}>Not enough days yet to draw a line.</p>;
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const W = 600; const H = height; const px = (i: number) => (i / (n - 1)) * W; const py = (v: number) => H - 4 - (v / max) * (H - 14);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }} role="img" aria-label={series.map((s) => s.name).join(" and ")}>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="0" x2={W} y1={py(max * f)} y2={py(max * f)} stroke={C.line} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {series.map((s) => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={s.points.map((p, i) => `${px(i).toFixed(1)},${py(p.value).toFixed(1)}`).join(" ")} />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.dim, marginTop: 4 }}><span>{series[0].points[0]?.day}</span><span>peak {num(max)}</span><span>{series[0].points[n - 1]?.day}</span></div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
        {series.map((s) => <span key={s.name} style={{ fontSize: 12.5, color: C.ink, display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }} />{s.name} · {num(sum(s.points))} in total</span>)}
      </div>
    </div>
  );
}
/** Horizontal bars for a ranked list. */
export function Bars({ rows }: { rows: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p style={{ color: C.dim, fontSize: 14, margin: 0 }}>Nothing recorded yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 34%) 1fr auto", gap: 10, alignItems: "center", fontSize: 13.5, color: C.ink }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
          <span style={{ height: 10, borderRadius: 999, background: C.soft, overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: `${(r.value / max) * 100}%`, background: C.accent, borderRadius: 999 }} /></span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{num(r.value)}{r.hint ? <span style={{ color: C.dim, fontWeight: 500 }}> {r.hint}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
export const GAME_NAME: Record<string, string> = { stack: "Stack Tower", ladder: "Word Ladder", simon: "Simon Memory", rhythm: "Rhythm Rush", strike: "Street Strike", nepa3d: "UP NEPA 3D", nepa: "UP NEPA (2D)", "challenge-ai": "Challenge AI" };
export const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, fontSize: 14, color: C.ink, background: "#fff", width: "100%", minWidth: 0 };
export const button: React.CSSProperties = { padding: "10px 16px", borderRadius: 12, border: "none", background: "linear-gradient(180deg,#7c3aed,#6d28d9)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" };
