import { adminRead } from "@/lib/server/adminApi";
import { Bars, Card, Chart, Grid, GAME_NAME, Page, Problem, RangeLinks, Stat, Table, num, pivot, rangeOf, sum } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface G { game: string; started: number; completed: number; abandoned: number; saved: number; players: number; avg_score: number | null; best_score: number | null }
const COLORS = ["#6d28d9", "#16a34a", "#0e7490", "#b45309", "#be185d", "#4338ca", "#64748b"];

export default async function Games({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const [g, s] = await Promise.all([adminRead<G[]>("games", { from: r.from, to: r.to }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to })]);
  if (!g.ok) return <Page title="Games"><Problem error={g.error} /></Page>;
  const rows = g.data ?? []; const m = pivot(s.data, r.from, r.to);
  const started = rows.reduce((a, x) => a + Number(x.started), 0); const completed = rows.reduce((a, x) => a + Number(x.completed), 0);
  return (
    <Page title="Games" sub={`${rows.length} games had at least one run in this period. Challenge AI is counted separately below.`} right={<RangeLinks base="/admin/games" days={r.days} />}>
      <Grid>
        <Stat label="Runs started" value={num(started)} />
        <Stat label="Completed" value={num(completed)} sub={started ? `${Math.round((completed / started) * 100)}% of those started` : undefined} />
        <Stat label="Abandoned" value={num(started - completed)} sub="Started and never finished" tone={started && (started - completed) / started > 0.35 ? "warn" : undefined} />
        <Stat label="Most played" value={rows[0] ? GAME_NAME[rows[0].game] ?? rows[0].game : "–"} sub={rows[0] ? `${num(rows[0].started)} runs` : undefined} />
        <Stat label="Challenge AI matches" value={num(sum(m.get("markov_matches")))} sub={`${num(Math.max(0, ...(m.get("markov_players") ?? []).map((p) => p.value)))} players on the busiest day`} />
      </Grid>
      <Card title="Game by game">
        <Table rows={rows} cols={[
          { head: "Game", cell: (x) => <b>{GAME_NAME[x.game] ?? x.game}</b> }, { head: "Started", cell: (x) => num(x.started), right: true }, { head: "Completed", cell: (x) => num(x.completed), right: true },
          { head: "Abandoned", cell: (x) => `${num(x.abandoned)} (${x.started ? Math.round((Number(x.abandoned) / Number(x.started)) * 100) : 0}%)`, right: true },
          { head: "Players", cell: (x) => num(x.players), right: true }, { head: "Runs per player", cell: (x) => (Number(x.players) ? (Number(x.started) / Number(x.players)).toFixed(1) : "–"), right: true },
          { head: "Average score", cell: (x) => num(x.avg_score), right: true }, { head: "Best score", cell: (x) => num(x.best_score), right: true },
        ]} empty="No runs in this period." />
      </Card>
      <div style={{ height: 14 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <Card title="Runs per day, by game"><Chart height={190} series={rows.slice(0, 6).map((x, i) => ({ name: GAME_NAME[x.game] ?? x.game, color: COLORS[i % COLORS.length], points: m.get(`plays:${x.game}`) ?? [] }))} /></Card>
        <Card title="Players per game"><Bars rows={rows.map((x) => ({ label: GAME_NAME[x.game] ?? x.game, value: Number(x.players) }))} /></Card>
        <Card title="Engagement: runs per player"><Bars rows={[...rows].sort((a, b) => Number(b.started) / Math.max(1, Number(b.players)) - Number(a.started) / Math.max(1, Number(a.players))).map((x) => ({ label: GAME_NAME[x.game] ?? x.game, value: Math.round((Number(x.started) / Math.max(1, Number(x.players))) * 10) / 10 }))} /></Card>
      </div>
    </Page>
  );
}
