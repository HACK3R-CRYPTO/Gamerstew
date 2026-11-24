// Small building blocks for the admin dashboard. Server components: no state.
import Link from "next/link";
import type { ReactNode } from "react";
import { TimeChart } from "./charts";

export const C = { ink: "#1b0d42", dim: "rgba(27,13,66,0.62)", line: "rgba(76,29,149,0.13)", accent: "#6d28d9", soft: "#f3effc", good: "#15803d", bad: "#b91c1c", warn: "#b45309" };
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
export function Card({ title, children, note, right }: { title?: string; children: ReactNode; note?: string; right?: ReactNode }) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 20, padding: 18, minWidth: 0, boxShadow: "0 1px 0 rgba(76,29,149,0.04)" }}>
      {(title || right) && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, margin: "0 0 12px" }}>{title && <h2 style={{ margin: 0, fontSize: 16, color: C.ink, fontWeight: 800 }}>{title}</h2>}{right}</div>}
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
    : error === "server_key_missing" ? "The game server has no key for the admin tables. Add SUPABASE_SERVICE_ROLE_KEY to the backend on Railway (Supabase → Project Settings → API → service_role), then reload."
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

/** Kept for the pages written against the first version: the same props, the new chart. */
export function Chart({ series, height = 230, kind, mode, stacked, unit }: { series: { name: string; color: string; points: Point[] }[]; height?: number; kind?: "area" | "bar"; mode?: "sum" | "last"; stacked?: boolean; unit?: string }) {
  return <TimeChart series={series} height={height} kind={kind} mode={mode} stacked={stacked} unit={unit} narrow />;
}

/** A tiny trend line for a headline number. */
export function Spark({ points, color = "#6d28d9", w = 120, h = 36 }: { points: Point[]; color?: string; w?: number; h?: number }) {
  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((p) => p.value)); const min = Math.min(...points.map((p) => p.value)); const span = max - min || 1;
  const pts = points.map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 3 - ((p.value - min) / span) * (h - 6)).toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h, display: "block" }} aria-hidden><polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity="0.12" /><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
/** How a number moved against the period before it. */
export function Delta({ now, before, suffix = "vs the period before", dark = false }: { now: number; before: number; suffix?: string; dark?: boolean }) {
  const dim = dark ? "rgba(255,255,255,0.8)" : C.dim;
  if (!before && !now) return <span style={{ color: dim, fontSize: 12.5 }}>no activity in either period</span>;
  if (!before) return <span style={{ color: C.good, fontSize: 12.5, fontWeight: 700 }}>new {suffix.replace("vs the", "since the")}</span>;
  const pct = ((now - before) / before) * 100; const up = pct >= 0;
  return <span style={{ fontSize: 12.5 }}><b style={{ color: up ? C.good : C.bad, background: up ? "#dcfce7" : "#fee2e2", borderRadius: 999, padding: "2px 8px" }}>{up ? "▲" : "▼"} {Math.abs(pct) >= 1000 ? "10×+" : Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0) + "%"}</b> <span style={{ color: dim }}>{suffix}</span></span>;
}
/** A headline number with its trend and its change. */
export function Kpi({ label, value, sub, spark, color = "#6d28d9", delta, dark }: { label: string; value: ReactNode; sub?: ReactNode; spark?: Point[]; color?: string; delta?: { now: number; before: number }; dark?: boolean }) {
  return (
    <div style={{ background: dark ? "linear-gradient(150deg, #2a1163 0%, #4c1d95 60%, #6d28d9 100%)" : "#fff", color: dark ? "#fff" : C.ink, border: dark ? "none" : `1px solid ${C.line}`, borderRadius: 20, padding: "16px 16px 14px", minWidth: 0, boxShadow: dark ? "0 24px 40px -26px rgba(76,29,149,0.9)" : "0 1px 0 rgba(76,29,149,0.04)", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", opacity: dark ? 0.8 : 1, color: dark ? "#fff" : C.dim }}>{label}</div>
        {spark && <Spark points={spark} color={dark ? "#fde68a" : color} w={92} h={30} />}
      </div>
      <div style={{ fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 34, lineHeight: 1.05, overflowWrap: "anywhere" }}>{value}</div>
      {delta && <div><Delta now={delta.now} before={delta.before} dark={dark} /></div>}
      {sub !== undefined && <div style={{ fontSize: 12.5, opacity: dark ? 0.82 : 1, color: dark ? "#fff" : C.dim }}>{sub}</div>}
    </div>
  );
}
/** A player, by name when they have one. */
export function Who({ wallet, username, verified, href = true }: { wallet: string | null | undefined; username?: string | null; verified?: boolean | null; href?: boolean }) {
  if (!wallet) return <span style={{ color: C.dim }}>–</span>;
  const hue = parseInt(wallet.slice(2, 8), 16) % 360;
  const inner = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
      <span aria-hidden style={{ width: 28, height: 28, borderRadius: 999, flex: "0 0 auto", background: `linear-gradient(135deg, hsl(${hue} 80% 62%), hsl(${(hue + 60) % 360} 75% 48%))`, color: "#fff", fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center" }}>{(username || wallet.slice(2)).slice(0, 1).toUpperCase()}</span>
      <span style={{ display: "grid", lineHeight: 1.2, minWidth: 0 }}>
        <b style={{ color: C.ink, overflow: "hidden", textOverflow: "ellipsis" }}>{username ? `@${username}` : short(wallet)}{verified ? <span title="GoodDollar verified" style={{ color: C.good, marginLeft: 5 }}>✓</span> : null}</b>
        {username && <span style={{ fontSize: 11.5, color: C.dim }}>{short(wallet)}</span>}
      </span>
    </span>
  );
  return href ? <Link href={`/admin/users/${wallet}`} style={{ textDecoration: "none" }}>{inner}</Link> : inner;
}
/** Steps people drop out of, widest first. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {steps.map((s, i) => { const pct = (s.value / top) * 100; const from = i ? steps[i - 1].value : 0; return (
        <div key={s.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.ink, marginBottom: 4 }}><span style={{ fontWeight: 700 }}>{s.label}</span><span><b>{num(s.value)}</b>{i > 0 && from > 0 ? <span style={{ color: C.dim }}> · {Math.round((s.value / from) * 100)}% of the step before</span> : null}</span></div>
          <div style={{ height: 26, borderRadius: 9, background: C.soft, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(pct, s.value ? 2 : 0)}%`, borderRadius: 9, background: `linear-gradient(90deg, #6d28d9, ${["#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd"][Math.min(i, 3)]})` }} /></div>
        </div>); })}
    </div>
  );
}
/** A calendar of squares, one per day, darker for busier days. Newest week on the right. */
export function Heat({ points, color = "109,40,217", word = "games" }: { points: Point[]; color?: string; word?: string }) {
  if (!points.length) return <p style={{ color: C.dim, fontSize: 14, margin: 0 }}>Nothing recorded yet.</p>;
  const max = Math.max(1, ...points.map((p) => p.value));
  const first = new Date(points[0].day + "T00:00:00Z"); const pad = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const cells: (Point | null)[] = [...Array.from({ length: pad }, () => null), ...points]; const weeks = Math.ceil(cells.length / 7);
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateRows: "repeat(7, 16px)", gridAutoFlow: "column", gridAutoColumns: "16px", gap: 4, width: "max-content" }}>
        {Array.from({ length: weeks * 7 }, (_, i) => { const c = cells[i]; return <span key={i} title={c ? `${c.day}: ${num(c.value)} ${word}` : ""} style={{ borderRadius: 3, background: !c ? "transparent" : c.value === 0 ? "rgba(76,29,149,0.07)" : `rgba(${color},${0.22 + (Math.sqrt(c.value) / Math.sqrt(max)) * 0.78})` }} />; })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.dim, marginTop: 6, minWidth: 200 }}><span>{points[0].day}</span><span>busiest day: {num(max)} {word}</span><span>{points[points.length - 1].day}</span></div>
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
