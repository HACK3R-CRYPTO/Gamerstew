import { adminRead } from "@/lib/server/adminApi";
import { Bars, Card, Chart, Grid, NotYet, Page, Problem, RangeLinks, Stat, Table, num, pivot, rangeOf, sum } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface Traffic { pages: { path: string; views: number; visitors: number }[]; sources: { source: string; visitors: number }[]; devices: { device: string; visitors: number }[]; embeds: { where_: string; visitors: number }[]; events: { kind: string; n: number; visitors: number }[]; funnel: { visited: number; opened_a_game: number; started_a_run: number; signed_in: number } }

export default async function TrafficPage({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const [t, s] = await Promise.all([adminRead<Traffic>("traffic", { from: r.from, to: r.to }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to })]);
  if (!t.ok || !t.data) return <Page title="Visits"><Problem error={t.error} /></Page>;
  const d = t.data; const m = pivot(s.data, r.from, r.to); const f = d.funnel; const pct = (n: number) => (f.visited ? `${Math.round((n / f.visited) * 100)}% of visitors` : "");
  return (
    <Page title="Visits" sub="Everyone who opened the app, signed in or not. A visitor is one browser. No network address is stored." right={<RangeLinks base="/admin/traffic" days={r.days} />}>
      {f.visited === 0 && <NotYet what="Nothing yet" why="visits are counted from the day this goes live on the site. Open the app in another tab and this page will start to fill." />}
      <Grid>
        <Stat label="Visitors" value={num(f.visited)} sub={`${num(sum(m.get("new_visitors")))} for the first time`} />
        <Stat label="Opened a game" value={num(f.opened_a_game)} sub={pct(f.opened_a_game)} />
        <Stat label="Started a run" value={num(f.started_a_run)} sub={pct(f.started_a_run)} />
        <Stat label="Signed in" value={num(f.signed_in)} sub={pct(f.signed_in)} />
        <Stat label="Page views" value={num(sum(m.get("page_views")))} />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <Card title="Visitors per day"><Chart series={[{ name: "Visitors", color: "#0e7490", points: m.get("visitors") ?? [] }, { name: "Guests", color: "#a78bfa", points: m.get("visitors_guest") ?? [] }, { name: "Started a run", color: "#16a34a", points: m.get("visitors_who_played") ?? [] }]} /></Card>
        <Card title="Where they came from" note="The site a visitor arrived from, or the utm_source in the link. 'direct' means none was given."><Bars rows={d.sources.map((x) => ({ label: x.source, value: Number(x.visitors) }))} /></Card>
        <Card title="Pages"><Table rows={d.pages} cols={[{ head: "Page", cell: (x) => x.path }, { head: "Views", cell: (x) => num(x.views), right: true }, { head: "Visitors", cell: (x) => num(x.visitors), right: true }]} empty="No page views yet." /></Card>
        <Card title="Device"><Bars rows={d.devices.map((x) => ({ label: x.device, value: Number(x.visitors) }))} /></Card>
        <Card title="Opened in"><Bars rows={d.embeds.map((x) => ({ label: x.where_ === "web" ? "Browser" : x.where_ === "minipay" ? "MiniPay" : "Vatar world", value: Number(x.visitors) }))} /></Card>
        <Card title="Events"><Table rows={d.events} cols={[{ head: "Event", cell: (x) => x.kind.replace(/_/g, " ") }, { head: "Times", cell: (x) => num(x.n), right: true }, { head: "Visitors", cell: (x) => num(x.visitors), right: true }]} empty="No events yet." /></Card>
      </div>
    </Page>
  );
}
