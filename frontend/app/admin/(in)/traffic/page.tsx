import { adminRead } from "@/lib/server/adminApi";
import { Bars, Card, Chart, Grid, NotYet, Page, Problem, RangeLinks, Stat, Table, num, pivot, rangeOf, sum } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface Traffic { pages: { path: string; views: number; visitors: number }[]; sources: { source: string; visitors: number }[]; devices: { device: string; visitors: number }[]; embeds: { where_: string; visitors: number }[]; events: { kind: string; n: number; visitors: number }[]; funnel: { visited: number; opened_a_game: number; started_a_run: number; signed_in: number } }

/** What players' devices are, and how the 3D games ran on them (reported once per visit by the game itself). */
interface Devices { visits: number; visitors: number; slow: number; smooth: number; chips: { chip: string; visits: number; visitors: number; fps: number | null; dpr: number | null; slow: number }[]; phones: { gpu: string; chip: string; visits: number; visitors: number; fps: number | null; worst: number | null; dpr: number | null; memory: number | null }[]; games: { game: string; visits: number; fps: number | null; slow: number }[]; choices: { choice: string; visitors: number }[] }
const CHIP: Record<string, string> = { strong: "Strong chip", mid: "Mid chip", weak: "Weak chip", unknown: "Not named by the browser" };

export default async function TrafficPage({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const [t, dev, s] = await Promise.all([adminRead<Traffic>("traffic", { from: r.from, to: r.to }), adminRead<Devices>("devices", { from: r.from, to: r.to }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to })]);
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
        {/* how the 3D games ran on real phones: the report that says whether "it looks bad on my phone" is one person or a third of the players */}
        {!dev.ok || !dev.data ? (
          <Card title="Devices in 3D games"><NotYet what="Not set up yet" why="run games-backend/supabase-migrations/2026-11-26b_admin_devices.sql in Supabase. After that, every visit to a 3D game reports the device it ran on." /></Card>
        ) : dev.data.visits === 0 ? (
          <Card title="Devices in 3D games"><NotYet what="Nothing yet" why="a 3D game reports its device after twenty seconds of play. Open UP NEPA 3D or Street Strike on a phone and this fills in." /></Card>
        ) : (
          <>
            <Card title="How 3D ran" note={`From ${num(dev.data.visits)} visits to a 3D game by ${num(dev.data.visitors)} visitors. Smooth is 50 frames a second or more. Slow is under 24, where a game stops feeling playable.`}>
              <Bars rows={[{ label: "Smooth", value: Number(dev.data.smooth) }, { label: "In between", value: Math.max(0, Number(dev.data.visits) - Number(dev.data.smooth) - Number(dev.data.slow)) }, { label: "Slow", value: Number(dev.data.slow) }]} />
            </Card>
            <Card title="By graphics chip" note="The chip decides how 3D runs. Sharpness is how many screen pixels were drawn per point: 2 is crisp, 1 is soft.">
              <Table rows={dev.data.chips} cols={[{ head: "Chip", cell: (x) => CHIP[x.chip] ?? x.chip }, { head: "Visitors", cell: (x) => num(x.visitors), right: true }, { head: "Frames/s", cell: (x) => (x.fps == null ? "–" : num(x.fps)), right: true }, { head: "Sharpness", cell: (x) => (x.dpr == null ? "–" : String(x.dpr)), right: true }, { head: "Slow visits", cell: (x) => num(x.slow), right: true }]} />
            </Card>
            <Card title="The actual phones" note="The graphics chip each browser named, most common first. A low 'worst' on a common chip is the one to fix.">
              <Table rows={dev.data.phones} cols={[{ head: "Graphics chip", cell: (x) => x.gpu }, { head: "Visitors", cell: (x) => num(x.visitors), right: true }, { head: "Frames/s", cell: (x) => (x.fps == null ? "–" : num(x.fps)), right: true }, { head: "Worst", cell: (x) => (x.worst == null ? "–" : num(x.worst)), right: true }, { head: "Sharpness", cell: (x) => (x.dpr == null ? "–" : String(x.dpr)), right: true }, { head: "Memory GB", cell: (x) => (x.memory == null ? "–" : String(x.memory)), right: true }]} />
            </Card>
            <Card title="By game"><Table rows={dev.data.games} cols={[{ head: "Game", cell: (x) => x.game }, { head: "Visits", cell: (x) => num(x.visits), right: true }, { head: "Frames/s", cell: (x) => (x.fps == null ? "–" : num(x.fps)), right: true }, { head: "Slow visits", cell: (x) => num(x.slow), right: true }]} /></Card>
            <Card title="Graphics setting chosen" note="Auto fits the phone by itself. A lot of players on Smooth means Auto is starting too high."><Bars rows={dev.data.choices.map((x) => ({ label: x.choice, value: Number(x.visitors) }))} /></Card>
          </>
        )}
        <Card title="Events"><Table rows={d.events} cols={[{ head: "Event", cell: (x) => x.kind.replace(/_/g, " ") }, { head: "Times", cell: (x) => num(x.n), right: true }, { head: "Visitors", cell: (x) => num(x.visitors), right: true }]} empty="No events yet." /></Card>
      </div>
    </Page>
  );
}
