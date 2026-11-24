import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { Card, GAME_NAME, Grid, Kpi, Page, Problem, RangeLinks, Table, Who, button, input, num, pivot, rangeOf, sum, when, C } from "@/components/admin/ui";
import { TimeChart } from "@/components/admin/charts";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface Row { wallet: string; username: string | null; first_at: string; last_at: string | null; games: number; kinds: number; days: number; best: number | null; verified: boolean | null; state: string | null; total: number }
const STATE: Record<string, [string, string]> = { verified: ["Verified", "#15803d"], lapsed: ["Lapsed", "#b45309"], none: ["Never", "rgba(27,13,66,0.62)"], blacklisted: ["Blacklisted", "#b91c1c"] };
interface NewP { wallet: string; username: string | null; first_at: string; verified: boolean | null; games: number; first_game: string | null; last_at: string | null; came_back: boolean }
interface Ret { cohort: string; cohort_size: number; week_offset: number; players: number }
const FILTERS: [string, string][] = [["all", "Everyone"], ["new7", "New, 7 days"], ["new30", "New, 30 days"], ["verified", "Verified"], ["lapsed", "Lapsed"], ["unverified", "Not verified"]];
const SORTS: [string, string][] = [["recent", "Last active"], ["games", "Most games"], ["new", "Newest"]];

export default async function Users({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const r = rangeOf(sp);
  const q = typeof sp.q === "string" ? sp.q : ""; const who = typeof sp.who === "string" ? sp.who : "all"; const sort = typeof sp.sort === "string" ? sp.sort : "recent"; const page = Math.max(0, Number(sp.page) || 0); const PER = 30;
  const prevTo = new Date(Date.parse(r.from) - 86400000).toISOString().slice(0, 10); const prevFrom = new Date(Date.parse(r.from) - r.days * 86400000).toISOString().slice(0, 10);
  const [list, series, before, fresh, ret] = await Promise.all([
    adminRead<Row[]>("players", { q, who, sort, limit: PER, offset: page * PER }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to }),
    adminRead<{ day: string; metric: string; value: number }[]>("series", { from: prevFrom, to: prevTo }), adminRead<NewP[]>("new_players", { from: r.from, to: r.to, limit: 200 }), adminRead<Ret[]>("retention", { weeks: 10 }),
  ]);
  if (!list.ok) return <Page title="Players"><Problem error={list.error} /></Page>;
  const rows = list.data ?? []; const total = rows[0]?.total ?? 0; const m = pivot(series.data, r.from, r.to); const b = pivot(before.data, prevFrom, prevTo);
  const news = fresh.data ?? []; const back = news.filter((x) => x.came_back).length; const never = news.filter((x) => Number(x.games) === 0).length;
  const cohorts = [...new Set((ret.data ?? []).map((x) => x.cohort))]; const cell = (c: string, off: number) => (ret.data ?? []).find((x) => x.cohort === c && x.week_offset === off);
  const link = (o: Record<string, string | number>) => `/admin/users?${new URLSearchParams({ q, who, sort, days: String(r.days), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) }).toString()}`;
  const pill = (active: boolean): React.CSSProperties => ({ padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 700, textDecoration: "none", color: active ? "#fff" : C.ink, background: active ? C.accent : "#fff", border: `1px solid ${active ? C.accent : C.line}` });
  return (
    <Page title="Players" sub="Everyone who has minted a GamePass or played, by name. Joined dates and games come from the chain." right={<RangeLinks base="/admin/users" days={r.days} />}>
      <Grid min={200}>
        <Kpi label="New players" value={num(news.length >= 200 ? sum(m.get("new_players")) : news.length)} spark={m.get("new_players")} color="#16a34a" delta={{ now: sum(m.get("new_players")), before: sum(b.get("new_players")) }} sub={`first seen in the last ${r.days} days`} />
        <Kpi label="Came back" value={news.length ? `${Math.round((back / news.length) * 100)}%` : "–"} sub={`${num(back)} of the new players played on a second day`} />
        <Kpi label="Joined, never played" value={num(never)} sub="Minted a GamePass and recorded no score" color="#b45309" />
        <Kpi label="Busiest day" value={num(Math.max(0, ...(m.get("active_players") ?? []).map((p) => p.value)))} spark={m.get("active_players")} color="#0e7490" sub="Players active on one day" />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
        <Card title="New and returning, per day"><TimeChart narrow height={250} kind="bar" stacked series={[{ name: "Returning", color: "#6d28d9", points: m.get("returning_players") ?? [] }, { name: "New", color: "#16a34a", points: m.get("new_players") ?? [] }]} /></Card>
        <Card title="Retention by week" note="Each row is the players first seen in that week. Each column is the share who played again that many weeks later.">
          {cohorts.length ? (
            <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "separate", borderSpacing: 3, fontSize: 12.5, color: C.ink }}>
              <thead><tr><th style={{ textAlign: "left", color: C.dim, padding: "2px 8px 2px 0" }}>Joined, week of</th><th style={{ color: C.dim }}>Size</th>{[1, 2, 3, 4, 5, 6, 7].map((w) => <th key={w} style={{ color: C.dim }}>+{w}w</th>)}</tr></thead>
              <tbody>{cohorts.map((c) => { const size = cell(c, 0)?.cohort_size ?? 0; return (<tr key={c}><td style={{ whiteSpace: "nowrap", padding: "2px 8px 2px 0" }}>{String(c).slice(0, 10)}</td><td style={{ textAlign: "center", fontWeight: 700 }}>{num(size)}</td>
                {[1, 2, 3, 4, 5, 6, 7].map((w) => { const x = cell(c, w); const pct = x && size ? Math.round((x.players / size) * 100) : null; return <td key={w} style={{ width: 44, height: 27, textAlign: "center", borderRadius: 7, background: pct === null ? "rgba(76,29,149,0.04)" : `rgba(109,40,217,${0.1 + (pct / 100) * 0.75})`, color: pct !== null && pct > 45 ? "#fff" : C.ink, fontWeight: 700 }}>{pct === null ? "" : `${pct}%`}</td>; })}</tr>); })}</tbody>
            </table></div>) : <p style={{ margin: 0, color: C.dim, fontSize: 14 }}>No new players in the last ten weeks.</p>}
        </Card>
      </div>
      <Card title={`Who is new · ${num(news.length)}${news.length >= 200 ? "+" : ""} in ${r.days} days`} note="Newest first. 'Came back' means they played on a later day than the day they joined.">
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <Table rows={news} cols={[
            { head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} verified={x.verified} /> }, { head: "Joined", cell: (x) => when(x.first_at) },
            { head: "First game", cell: (x) => (x.first_game ? GAME_NAME[x.first_game] ?? x.first_game : <span style={{ color: C.warn }}>none yet</span>) }, { head: "Games", cell: (x) => num(x.games), right: true },
            { head: "Came back", cell: (x) => (x.came_back ? <b style={{ color: C.good }}>Yes</b> : "No") }, { head: "Verified", cell: (x) => (x.verified === true ? <b style={{ color: C.good }}>Yes</b> : x.verified === false ? "No" : <span style={{ color: C.dim }}>not checked</span>) },
            { head: "Last played", cell: (x) => when(x.last_at) },
          ]} empty="Nobody new in this period." />
        </div>
      </Card>
      <div style={{ height: 14 }} />
      <Card title={`All players · ${num(total)}`} right={<a href="/api/admin/export?kind=players" style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>Download CSV</a>}>
        <form action="/admin/users" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input name="q" defaultValue={q} placeholder="Search a username or wallet" style={{ ...input, flex: "1 1 240px", width: "auto" }} /><input type="hidden" name="who" value={who} /><input type="hidden" name="sort" value={sort} />
          <button style={button}>Search</button>
        </form>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>{FILTERS.map(([k, label]) => <Link key={k} href={link({ who: k, page: 0 })} style={pill(k === who)}>{label}</Link>)}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}><span style={{ fontSize: 12.5, color: C.dim }}>Sort by</span>{SORTS.map(([k, label]) => <Link key={k} href={link({ sort: k, page: 0 })} style={pill(k === sort)}>{label}</Link>)}</div>
        <Table rows={rows} cols={[
          { head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} verified={x.verified} /> }, { head: "Joined", cell: (x) => String(x.first_at).slice(0, 10) }, { head: "Last played", cell: (x) => when(x.last_at) },
          { head: "Games", cell: (x) => <b>{num(x.games)}</b>, right: true }, { head: "Different games", cell: (x) => num(x.kinds), right: true }, { head: "Days active", cell: (x) => num(x.days), right: true }, { head: "Best score", cell: (x) => num(x.best), right: true },
          { head: "GoodDollar", cell: (x) => { const st = x.state ?? (x.verified === true ? "verified" : x.verified === false ? "none" : null); return st && STATE[st] ? <b style={{ color: STATE[st][1] }}>{STATE[st][0]}</b> : <span style={{ color: C.dim }}>not checked</span>; } },
        ]} empty="No player matches." />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13.5 }}>
          {page > 0 ? <Link href={link({ page: page - 1 })} style={{ color: C.accent, fontWeight: 700 }}>← Previous</Link> : <span />}
          <span style={{ color: C.dim }}>{total ? `${page * PER + 1} to ${Math.min(total, (page + 1) * PER)} of ${num(total)}` : ""}</span>
          {(page + 1) * PER < total ? <Link href={link({ page: page + 1 })} style={{ color: C.accent, fontWeight: 700 }}>Next →</Link> : <span />}
        </div>
      </Card>
    </Page>
  );
}
