import { adminRead } from "@/lib/server/adminApi";
import { Card, Grid, Page, Problem, Stat, Table, button, input, num, pivot, rangeOf, sum, C } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Reports({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const r = rangeOf(sp); const by = sp.by === "week" || sp.by === "month" ? sp.by : "day";
  const s = await adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to });
  if (!s.ok) return <Page title="Reports"><Problem error={s.error} /></Page>;
  const m = pivot(s.data, r.from, r.to); const total = (k: string) => sum(m.get(k));
  // group the days into weeks (starting Monday) or months
  const bucket = (day: string) => { if (by === "month") return day.slice(0, 7); if (by === "week") { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return "week of " + d.toISOString().slice(0, 10); } return day; };
  const COLS: [string, string][] = [["new_players", "New players"], ["active_players", "Active (sum of days)"], ["visitors", "Visitors (sum of days)"], ["runs_started", "Runs started"], ["runs_completed", "Completed"], ["runs_onchain", "On-chain"], ["newly_verified", "Newly verified"], ["payouts_g", "G$ paid"], ["tx_failed", "Failed tx"]];
  const groups = new Map<string, Record<string, number>>();
  for (const [metric] of COLS) for (const p of m.get(metric) ?? []) { const g = groups.get(bucket(p.day)) ?? {}; g[metric] = (g[metric] ?? 0) + p.value; groups.set(bucket(p.day), g); }
  const rows = [...groups.entries()].map(([period, v]) => ({ period, ...v })).reverse() as (Record<string, number> & { period: string })[];
  const q = `from=${r.from}&to=${r.to}`;
  const link: React.CSSProperties = { color: C.accent, fontWeight: 700, fontSize: 14 };
  return (
    <Page title="Reports" sub={`${r.from} to ${r.to} · ${r.days} days`}>
      <Card title="Period">
        <form action="/admin/reports" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>From<input type="date" name="from" defaultValue={r.from} style={{ ...input, width: "auto" }} /></label>
          <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>To<input type="date" name="to" defaultValue={r.to} style={{ ...input, width: "auto" }} /></label>
          <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>Group by<select name="by" defaultValue={by} style={{ ...input, width: "auto" }}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
          <button style={button}>Show</button>
        </form>
      </Card>
      <div style={{ height: 14 }} />
      <Grid>
        <Stat label="New players" value={num(total("new_players"))} /><Stat label="Runs started" value={num(total("runs_started"))} /><Stat label="Completed" value={num(total("runs_completed"))} />
        <Stat label="Newly verified" value={num(total("newly_verified"))} /><Stat label="G$ paid" value={num(total("payouts_g"))} /><Stat label="Visitors (sum of days)" value={num(total("visitors"))} />
      </Grid>
      <Card title={`By ${by}`} note="'Sum of days' columns add each day's count, so a person active on three days is counted three times. For unique people in a period, use the Overview's week and month figures.">
        <Table rows={rows} cols={[{ head: by === "day" ? "Day" : by === "week" ? "Week" : "Month", cell: (x) => <b>{x.period}</b> }, ...COLS.map(([k, label]) => ({ head: label, cell: (x: Record<string, number>) => num(x[k] ?? 0), right: true }))]} empty="No data in this period." />
      </Card>
      <div style={{ height: 14 }} />
      <Card title="Download" note="CSV files open in Excel and Google Sheets. Each uses the period chosen above.">
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <a style={link} href={`/api/admin/export?kind=daily&${q}`}>Every daily metric</a>
          <a style={link} href={`/api/admin/export?kind=games&${q}`}>Game performance</a>
          <a style={link} href={`/api/admin/export?kind=top&${q}`}>Most active players</a>
          <a style={link} href={`/api/admin/export?kind=players`}>Players (first 300)</a>
          <a style={link} href={`/api/admin/export?kind=payouts`}>Payouts</a>
          <a style={link} href={`/api/admin/export?kind=feed`}>Latest activity</a>
        </div>
      </Card>
    </Page>
  );
}
