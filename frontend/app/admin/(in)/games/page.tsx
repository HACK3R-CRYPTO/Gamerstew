import { adminRead } from "@/lib/server/adminApi";
import { Bars, Card, Grid, GAME_NAME, Kpi, Page, Problem, RangeLinks, Table, num, pivot, rangeOf, sum, when, C } from "@/components/admin/ui";
import { Donut, TimeChart } from "@/components/admin/charts";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface G { game: string; played: number; players: number; avg_score: number | null; best_score: number | null; started: number; completed: number; abandoned: number; last_at: string | null }
const COLORS = ["#6d28d9", "#16a34a", "#f59e0b", "#0e7490", "#db2777", "#4338ca", "#64748b", "#84cc16"];

export default async function Games({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const prevTo = new Date(Date.parse(r.from) - 86400000).toISOString().slice(0, 10); const prevFrom = new Date(Date.parse(r.from) - r.days * 86400000).toISOString().slice(0, 10);
  const [g, s, b0] = await Promise.all([adminRead<G[]>("games", { from: r.from, to: r.to }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: prevFrom, to: prevTo })]);
  if (!g.ok) return <Page title="Games"><Problem error={g.error} /></Page>;
  const rows = g.data ?? []; const m = pivot(s.data, r.from, r.to); const b = pivot(b0.data, prevFrom, prevTo);
  const played = rows.reduce((a, x) => a + Number(x.played), 0); const started = rows.reduce((a, x) => a + Number(x.started), 0); const abandoned = rows.reduce((a, x) => a + Number(x.abandoned), 0);
  const live = rows.filter((x) => Number(x.played) > 0);
  return (
    <Page title="Games" sub="Games played and players come from the chain. Started and abandoned come from run tickets, which only exist for the skill games." right={<RangeLinks base="/admin/games" days={r.days} />}>
      <Grid min={200}>
        <Kpi dark label="Games played" value={num(played)} spark={m.get("games_played")} delta={{ now: sum(m.get("games_played")), before: sum(b.get("games_played")) }} sub={`in ${r.days} days, each one a transaction`} />
        <Kpi label="Most played" value={live[0] ? GAME_NAME[live[0].game] ?? live[0].game : "–"} sub={live[0] ? `${num(live[0].played)} games · ${played ? Math.round((Number(live[0].played) / played) * 100) : 0}% of all` : undefined} />
        <Kpi label="Abandoned" value={started ? `${Math.round((abandoned / started) * 100)}%` : "–"} sub={`${num(abandoned)} of ${num(started)} runs started were not finished`} color="#b45309" />
        <Kpi label="Games live" value={num(live.length)} sub="With at least one game in this period" />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1fr)", gap: 14, marginBottom: 14 }} className="gm-two">
        <Card title="Games per day, by game"><TimeChart height={280} kind="bar" stacked series={live.slice(0, 8).map((x, i) => ({ name: GAME_NAME[x.game] ?? x.game, color: COLORS[i % COLORS.length], points: m.get(`plays:${x.game}`) ?? [] }))} /></Card>
        <Card title="Share of play"><Donut center={num(played)} sub="games" parts={live.slice(0, 8).map((x, i) => ({ label: GAME_NAME[x.game] ?? x.game, value: Number(x.played), color: COLORS[i % COLORS.length] }))} /></Card>
      </div>
      <Card title="Game by game">
        <Table rows={rows} cols={[
          { head: "Game", cell: (x) => <b>{GAME_NAME[x.game] ?? x.game}</b> }, { head: "Games played", cell: (x) => <b>{num(x.played)}</b>, right: true }, { head: "Players", cell: (x) => num(x.players), right: true },
          { head: "Games per player", cell: (x) => (Number(x.players) ? (Number(x.played) / Number(x.players)).toFixed(1) : "–"), right: true }, { head: "Average score", cell: (x) => num(x.avg_score), right: true }, { head: "Best score", cell: (x) => num(x.best_score), right: true },
          { head: "Runs started", cell: (x) => (Number(x.started) ? num(x.started) : <span style={{ color: C.dim }}>–</span>), right: true },
          { head: "Abandoned", cell: (x) => (Number(x.started) ? <span style={{ color: Number(x.abandoned) / Number(x.started) > 0.35 ? C.warn : C.ink }}>{Math.round((Number(x.abandoned) / Number(x.started)) * 100)}%</span> : <span style={{ color: C.dim }}>–</span>), right: true },
          { head: "Last played", cell: (x) => when(x.last_at) },
        ]} empty="No games in this period." />
      </Card>
      <div style={{ height: 14 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <Card title="Players per game"><Bars rows={[...live].sort((a, c) => Number(c.players) - Number(a.players)).map((x) => ({ label: GAME_NAME[x.game] ?? x.game, value: Number(x.players) }))} /></Card>
        <Card title="Engagement: games per player"><Bars rows={[...live].sort((a, c) => Number(c.played) / Math.max(1, Number(c.players)) - Number(a.played) / Math.max(1, Number(a.players))).map((x) => ({ label: GAME_NAME[x.game] ?? x.game, value: Math.round((Number(x.played) / Math.max(1, Number(x.players))) * 10) / 10 }))} /></Card>
        <Card title="Started and finished, per day"><TimeChart narrow height={240} series={[{ name: "Runs started", color: "#a78bfa", points: m.get("runs_started") ?? [] }, { name: "Finished", color: "#6d28d9", points: m.get("runs_completed") ?? [] }]} /></Card>
      </div>
      <style>{`@media (max-width: 1100px) { .gm-two { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </Page>
  );
}
