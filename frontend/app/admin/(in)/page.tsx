import { adminRead } from "@/lib/server/adminApi";
import { Card, Chart, Grid, NotYet, Page, Problem, RangeLinks, Stat, num, pivot, rangeOf, sum, dayOf } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
type Overview = Record<string, number | string | null>;

export default async function Overview({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  // the same number of days just before the range, to say whether things are growing
  const prevTo = new Date(Date.parse(r.from) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(r.from) - r.days * 86400000).toISOString().slice(0, 10);
  const [o, s, p] = await Promise.all([adminRead<Overview>("overview"), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: prevFrom, to: prevTo })]);
  if (!o.ok || !o.data) return <Page title="Overview"><Problem error={o.error} /></Page>;
  const d = o.data; const m = pivot(s.data, r.from, r.to); const before = pivot(p.data, prevFrom, prevTo);
  const growth = (k: string) => { const a = sum(m.get(k)); const b = sum(before.get(k)); if (!b) return a ? "new in this period" : "no change"; const pct = ((a - b) / b) * 100; return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% on the ${r.days} days before`; };
  return (
    <Page title="Overview" sub={`Everything since ${dayOf(String(d.history_from ?? ""))}. Days are counted in UTC.`} right={<RangeLinks base="/admin" days={r.days} />}>
      <Grid>
        <Stat label="Registered users" value={num(d.registered)} sub="Have a player record" />
        <Stat label="Players, ever" value={num(d.players_ever)} sub="Started at least one run" />
        <Stat label="Verified" value={num(d.verified)} sub={`${num(d.unverified)} not verified · ${num(Number(d.players_ever) - Number(d.verification_checked))} still to check`} />
        <Stat label="Active today" value={num(d.dau)} sub={`${num(d.wau)} this week · ${num(d.mau)} this month`} />
        <Stat label="Visitors today" value={num(d.visitors_day)} sub={d.visits_tracked_from ? `${num(d.visitors_week)} this week · ${num(d.visitors_month)} this month` : "Counting starts when this ships"} />
        <Stat label="Games played" value={num(d.runs_completed)} sub={`${num(d.runs_started)} started`} />
        <Stat label="Score transactions" value={num(d.score_transactions)} sub={`${num(d.tx_failed)} failed`} tone={Number(d.tx_failed) > 0 ? "warn" : undefined} />
        <Stat label="Rewards paid" value={`${num(d.payouts_g)} G$`} sub={`${num(d.payouts)} payouts recorded · ${num(d.payouts_pending)} pending`} />
      </Grid>
      {!d.visits_tracked_from && <NotYet what="Visits" why="visitor counts begin on the day this dashboard goes live. Nothing recorded them before, so earlier days cannot be filled in." />}
      {Number(d.payouts) === 0 && <NotYet what="Rewards" why="no payouts have been recorded yet. Prizes paid by hand before now are not in the system until they are entered on the Rewards page." />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <Card title={`Players per day · ${growth("active_players")}`}><Chart series={[{ name: "Active players", color: "#6d28d9", points: m.get("active_players") ?? [] }, { name: "New players", color: "#16a34a", points: m.get("new_players") ?? [] }]} /></Card>
        <Card title={`Games per day · ${growth("runs_started")}`}><Chart series={[{ name: "Started", color: "#a78bfa", points: m.get("runs_started") ?? [] }, { name: "Completed", color: "#6d28d9", points: m.get("runs_completed") ?? [] }]} /></Card>
        <Card title={`Visitors per day · ${growth("visitors")}`}><Chart series={[{ name: "Visitors", color: "#0e7490", points: m.get("visitors") ?? [] }, { name: "Of them, signed in", color: "#6d28d9", points: m.get("visitors_signed_in") ?? [] }]} /></Card>
        <Card title="New and returning players"><Chart series={[{ name: "Returning", color: "#6d28d9", points: m.get("returning_players") ?? [] }, { name: "New", color: "#16a34a", points: m.get("new_players") ?? [] }]} /></Card>
        <Card title="Score transactions per day"><Chart series={[{ name: "Recorded on-chain", color: "#6d28d9", points: m.get("runs_onchain") ?? [] }, { name: "Failed", color: "#b91c1c", points: m.get("tx_failed") ?? [] }]} /></Card>
        <Card title="Rewards and verification"><Chart series={[{ name: "G$ paid", color: "#b45309", points: m.get("payouts_g") ?? [] }, { name: "Newly verified", color: "#16a34a", points: m.get("newly_verified") ?? [] }]} /></Card>
      </div>
    </Page>
  );
}
