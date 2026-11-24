import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { Card, Chart, Grid, Page, Problem, RangeLinks, Stat, Table, button, input, num, pivot, rangeOf, short, sum, when, C } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface Row { wallet: string; first_at: string; last_at: string | null; runs: number; completed: number; games: number; verified: boolean | null; total: number }
interface Top { wallet: string; runs: number; completed: number; games: number; days: number; last_at: string }
interface Ret { cohort: string; cohort_size: number; week_offset: number; players: number }

export default async function Users({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const r = rangeOf(sp);
  const q = typeof sp.q === "string" ? sp.q : ""; const who = typeof sp.who === "string" ? sp.who : "all"; const page = Math.max(0, Number(sp.page) || 0); const PER = 25;
  const [list, series, top, ret] = await Promise.all([
    adminRead<Row[]>("players", { q, who, limit: PER, offset: page * PER }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to }),
    adminRead<Top[]>("top", { from: r.from, to: r.to, limit: 10 }), adminRead<Ret[]>("retention", { weeks: 8 }),
  ]);
  if (!list.ok) return <Page title="Users & players"><Problem error={list.error} /></Page>;
  const rows = list.data ?? []; const total = rows[0]?.total ?? 0; const m = pivot(series.data, r.from, r.to);
  const cohorts = [...new Set((ret.data ?? []).map((x) => x.cohort))];
  const cell = (c: string, off: number) => (ret.data ?? []).find((x) => x.cohort === c && x.week_offset === off);
  const link = (o: Record<string, string | number>) => `/admin/users?${new URLSearchParams({ q, who, days: String(r.days), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) }).toString()}`;
  return (
    <Page title="Users & players" sub="A player is a wallet that has started at least one run." right={<RangeLinks base="/admin/users" days={r.days} />}>
      <Grid>
        <Stat label="New players" value={num(sum(m.get("new_players")))} sub={`in ${r.days} days`} />
        <Stat label="Active, busiest day" value={num(Math.max(0, ...(m.get("active_players") ?? []).map((p) => p.value)))} />
        <Stat label="Runs per active player" value={(() => { const a = sum(m.get("active_players")); return a ? (sum(m.get("runs_started")) / a).toFixed(1) : "–"; })()} sub="Per day they played" />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Card title="New players per day"><Chart series={[{ name: "New players", color: "#16a34a", points: m.get("new_players") ?? [] }]} /></Card>
        <Card title={`Most active · last ${r.days} days`}>
          <Table rows={top.data ?? []} cols={[{ head: "Player", cell: (x) => <Link href={`/admin/users/${x.wallet}`} style={{ color: C.accent, fontWeight: 700 }}>{short(x.wallet)}</Link> }, { head: "Runs", cell: (x) => num(x.runs), right: true }, { head: "Games", cell: (x) => num(x.games), right: true }, { head: "Days", cell: (x) => num(x.days), right: true }]} />
        </Card>
      </div>
      <Card title="Retention by week" note="Each row is the players first seen in that week. Each column is how many of them played again that many weeks later. Week 0 is their first week.">
        {cohorts.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, color: C.ink }}>
              <thead><tr><th style={{ textAlign: "left", padding: "6px 10px" }}>First seen (week of)</th><th style={{ padding: "6px 10px" }}>Players</th>{[0, 1, 2, 3, 4, 5, 6, 7].map((w) => <th key={w} style={{ padding: "6px 10px" }}>Wk {w}</th>)}</tr></thead>
              <tbody>{cohorts.map((c) => { const size = cell(c, 0)?.cohort_size ?? 0; return (
                <tr key={c}><td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{String(c).slice(0, 10)}</td><td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700 }}>{num(size)}</td>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((w) => { const x = cell(c, w); const pct = x && size ? Math.round((x.players / size) * 100) : null; return <td key={w} style={{ padding: "6px 10px", textAlign: "center", background: pct === null ? "transparent" : `rgba(109,40,217,${0.08 + (pct / 100) * 0.6})`, color: pct !== null && pct > 55 ? "#fff" : C.ink, borderRadius: 6 }}>{pct === null ? "" : `${pct}%`}</td>; })}
                </tr>); })}</tbody>
            </table>
          </div>
        ) : <p style={{ margin: 0, color: C.dim, fontSize: 14 }}>No players in the last eight weeks.</p>}
      </Card>
      <div style={{ height: 14 }} />
      <Card title={`All players · ${num(total)}`}>
        <form action="/admin/users" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input name="q" defaultValue={q} placeholder="Search by wallet (any part)" style={{ ...input, flex: "1 1 220px", width: "auto" }} />
          <select name="who" defaultValue={who} style={{ ...input, width: "auto" }}><option value="all">Everyone</option><option value="verified">Verified</option><option value="unverified">Not verified</option></select>
          <button style={button}>Search</button>
        </form>
        <Table rows={rows} cols={[
          { head: "Player", cell: (x) => <Link href={`/admin/users/${x.wallet}`} style={{ color: C.accent, fontWeight: 700 }}>{short(x.wallet)}</Link> },
          { head: "Verified", cell: (x) => (x.verified === true ? <span style={{ color: C.good, fontWeight: 700 }}>Yes</span> : x.verified === false ? "No" : <span style={{ color: C.dim }}>Not checked</span>) },
          { head: "First seen", cell: (x) => when(x.first_at) }, { head: "Last active", cell: (x) => when(x.last_at) },
          { head: "Runs", cell: (x) => num(x.runs), right: true }, { head: "Completed", cell: (x) => num(x.completed), right: true }, { head: "Games tried", cell: (x) => num(x.games), right: true },
        ]} empty="No player matches that search." />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13.5 }}>
          {page > 0 ? <Link href={link({ page: page - 1 })} style={{ color: C.accent, fontWeight: 700 }}>← Newer</Link> : <span />}
          <span style={{ color: C.dim }}>{total ? `${page * PER + 1} to ${Math.min(total, (page + 1) * PER)} of ${num(total)}` : ""}</span>
          {(page + 1) * PER < total ? <Link href={link({ page: page + 1 })} style={{ color: C.accent, fontWeight: 700 }}>Older →</Link> : <span />}
        </div>
      </Card>
    </Page>
  );
}
