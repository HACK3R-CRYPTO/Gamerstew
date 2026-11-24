"use client";

// Interactive charts for the admin dashboard, drawn in SVG with no library.
// Hover (or touch) a chart to read the exact numbers for that day.

import { useMemo, useRef, useState } from "react";

export type Point = { day: string; value: number };
export interface Series { name: string; color: string; points: Point[] }
const INK = "#1b0d42"; const DIM = "rgba(27,13,66,0.6)"; const GRID = "rgba(76,29,149,0.10)";
const nf = (v: number) => (Math.abs(v) >= 1_000_000 ? (v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0) + "M" : Math.abs(v) >= 10_000 ? Math.round(v / 1000) + "k" : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(Math.round(v * 100) / 100));
const full = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const label = (day: string) => { const d = new Date(day + "T00:00:00Z"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

/** Group days into weeks when there are too many to read one by one. */
function bucket(series: Series[], mode: "sum" | "last"): { series: Series[]; unit: "day" | "week" } {
  const n = series[0]?.points.length ?? 0;
  if (n <= 100) return { series, unit: "day" };
  return { unit: "week", series: series.map((s) => { const out: Point[] = []; for (let i = 0; i < s.points.length; i += 7) { const chunk = s.points.slice(i, i + 7); out.push({ day: chunk[0].day, value: mode === "last" ? chunk[chunk.length - 1].value : chunk.reduce((a, p) => a + p.value, 0) }); } return { ...s, points: out }; }) };
}
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4; const pow = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = []; for (let v = 0; v <= max + step * 0.001; v += step) out.push(v); if (out[out.length - 1] < max) out.push(out[out.length - 1] + step); return out;
}

/**
 * Lines with a soft fill, or bars. `mode` says how days are combined when a long
 * range is shown by week: "sum" for things that happen (games, new players),
 * "last" for running totals (registered so far).
 */
export function TimeChart({ series, height = 240, kind = "area", mode = "sum", stacked = false, unit: unitWord = "", narrow = false }: { series: Series[]; height?: number; kind?: "area" | "bar"; mode?: "sum" | "last"; stacked?: boolean; unit?: string; /** drawn in a column about a third of the page wide: fewer pixels across, so the labels stay readable */ narrow?: boolean }) {
  const { series: S, unit } = useMemo(() => bucket(series.filter((s) => s.points.length), mode), [series, mode]);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const n = S[0]?.points.length ?? 0;
  if (n < 2) return <div style={{ height, display: "grid", placeItems: "center", color: DIM, fontSize: 14 }}>Not enough days yet to draw this.</div>;
  const W = narrow ? 460 : 760; const H = height; const L = 40; const R = 12; const T = 12; const B = 26;
  const totals = Array.from({ length: n }, (_, i) => S.reduce((a, s) => a + (s.points[i]?.value ?? 0), 0));
  const max = Math.max(1, ...(stacked ? totals : S.flatMap((s) => s.points.map((p) => p.value))));
  const tk = ticks(max); const top = tk[tk.length - 1];
  const x = (i: number) => L + (kind === "bar" ? (i + 0.5) / n : i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const bw = Math.max(1.5, ((W - L - R) / n) * 0.72);
  const nx = Math.min(narrow ? 4 : 6, n); const xt = Array.from({ length: nx }, (_, k) => Math.round((k / (nx - 1)) * (n - 1)));
  const move = (cx: number) => { const r = box.current?.getBoundingClientRect(); if (!r) return; const px = ((cx - r.left) / r.width) * W; const i = kind === "bar" ? Math.floor(((px - L) / (W - L - R)) * n) : Math.round(((px - L) / (W - L - R)) * (n - 1)); setHover(Math.max(0, Math.min(n - 1, i))); };
  return (
    <div>
      <div ref={box} style={{ position: "relative", touchAction: "pan-y" }} onMouseMove={(e) => move(e.clientX)} onMouseLeave={() => setHover(null)} onTouchStart={(e) => move(e.touches[0].clientX)} onTouchMove={(e) => move(e.touches[0].clientX)}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={S.map((s) => s.name).join(", ")}>
          <defs>{S.map((s, k) => <linearGradient key={k} id={`g${k}-${s.color.slice(1)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity="0.28" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>)}</defs>
          {tk.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={DIM}>{nf(v)}</text></g>)}
          {xt.map((i) => <text key={i} x={x(i)} y={H - 7} textAnchor="middle" fontSize="11" fill={DIM}>{label(S[0].points[i].day)}</text>)}
          {kind === "bar"
            ? Array.from({ length: n }, (_, i) => { let base = 0; return S.map((s, k) => { const v = s.points[i]?.value ?? 0; if (!v) return null; const y0 = stacked ? y(base + v) : y(v); const h = (stacked ? y(base) : y(0)) - y0; const xx = stacked ? x(i) - bw / 2 : x(i) - bw / 2 + (k * bw) / S.length; if (stacked) base += v; return <rect key={`${i}-${k}`} x={xx} y={y0} width={stacked ? bw : bw / S.length} height={Math.max(0, h)} rx={Math.min(3, bw / 3)} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />; }); })
            : S.map((s, k) => { const pts = s.points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" "); return <g key={k}><polygon points={`${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`} fill={`url(#g${k}-${s.color.slice(1)})`} /><polyline points={pts} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" /></g>; })}
          {hover !== null && <g><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke={INK} strokeOpacity="0.25" strokeDasharray="3 3" />{kind !== "bar" && S.map((s, k) => <circle key={k} cx={x(hover)} cy={y(s.points[hover]?.value ?? 0)} r="4.5" fill="#fff" stroke={s.color} strokeWidth="2.4" />)}</g>}
        </svg>
        {hover !== null && (
          <div style={{ position: "absolute", top: 6, left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > n * 0.6 ? "calc(-100% - 12px)" : "12px"})`, background: INK, color: "#fff", borderRadius: 12, padding: "9px 11px", fontSize: 12.5, pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 12px 30px -12px rgba(27,13,66,0.7)", zIndex: 2 }}>
            <div style={{ fontWeight: 800, marginBottom: 4, opacity: 0.8 }}>{unit === "week" ? "Week of " : ""}{label(S[0].points[hover].day)}</div>
            {S.map((s) => <div key={s.name} style={{ display: "flex", gap: 8, alignItems: "center", lineHeight: 1.5 }}><i style={{ width: 8, height: 8, borderRadius: 3, background: s.color, display: "inline-block" }} /><span style={{ opacity: 0.85 }}>{s.name}</span><b style={{ marginLeft: "auto", paddingLeft: 14 }}>{full(s.points[hover]?.value ?? 0)}{unitWord}</b></div>)}
            {stacked && S.length > 1 && <div style={{ borderTop: "1px solid rgba(255,255,255,0.2)", marginTop: 4, paddingTop: 4, display: "flex" }}><span style={{ opacity: 0.85 }}>Total</span><b style={{ marginLeft: "auto", paddingLeft: 14 }}>{full(totals[hover])}{unitWord}</b></div>}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
        {S.map((s) => <span key={s.name} style={{ fontSize: 12.5, color: INK, display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }} />{s.name}</span>)}
        {unit === "week" && <span style={{ fontSize: 12, color: DIM, marginLeft: "auto" }}>shown by week</span>}
      </div>
    </div>
  );
}

/** A ring split into parts, with the total in the middle. */
export function Donut({ parts, center, sub }: { parts: { label: string; value: number; color: string }[]; center: string; sub?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0); const R = 64; const C = 2 * Math.PI * R; let off = 0;
  const [on, setOn] = useState<number | null>(null);
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox="0 0 180 180" style={{ width: 168, height: 168, flex: "0 0 auto" }} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(76,29,149,0.08)" strokeWidth="22" />
        {total > 0 && parts.map((p, i) => { const len = (p.value / total) * C; const el = <circle key={i} cx="90" cy="90" r={R} fill="none" stroke={p.color} strokeWidth={on === i ? 27 : 22} strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 90 90)" strokeLinecap="butt" style={{ transition: "stroke-width .15s" }} onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)} />; off += len; return el; })}
        <text x="90" y="86" textAnchor="middle" fontSize="26" fontWeight="800" fill={INK}>{on === null ? center : full(parts[on].value)}</text>
        <text x="90" y="106" textAnchor="middle" fontSize="11.5" fill={DIM}>{on === null ? sub : parts[on].label}</text>
      </svg>
      <div style={{ display: "grid", gap: 8, flex: "1 1 150px", minWidth: 0 }}>
        {parts.map((p, i) => <div key={p.label} onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: INK }}><i style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} /><span>{p.label}</span><b style={{ marginLeft: "auto" }}>{full(p.value)}</b><span style={{ color: DIM, width: 40, textAlign: "right" }}>{total ? Math.round((p.value / total) * 100) : 0}%</span></div>)}
      </div>
    </div>
  );
}
