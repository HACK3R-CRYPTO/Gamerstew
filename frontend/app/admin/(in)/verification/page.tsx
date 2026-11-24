import { adminRead } from "@/lib/server/adminApi";
import { Card, Chart, Grid, NotYet, Page, Problem, RangeLinks, Stat, num, pivot, rangeOf, sum, when } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface V { verified: number; unverified: number; not_checked_yet: number; verified_played: number; verified_never_played: number; last_checked: string | null }

export default async function Verification({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const [v, s] = await Promise.all([adminRead<V>("verification"), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to })]);
  if (!v.ok || !v.data) return <Page title="GoodDollar verification"><Problem error={v.error} /></Page>;
  const d = v.data; const m = pivot(s.data, r.from, r.to); const checked = Number(d.verified) + Number(d.unverified);
  return (
    <Page title="GoodDollar verification" sub={`Read from the GoodDollar Identity contract, 25 wallets every 5 minutes. Last check: ${when(d.last_checked)}.`} right={<RangeLinks base="/admin/verification" days={r.days} />}>
      {Number(d.not_checked_yet) > 0 && <NotYet what={`${num(d.not_checked_yet)} wallets still to check`} why="the first pass through every wallet takes a while. The numbers below are for the wallets checked so far and grow until it is done." />}
      <Grid>
        <Stat label="Verified" value={num(d.verified)} tone="good" sub={checked ? `${Math.round((Number(d.verified) / checked) * 100)}% of wallets checked` : undefined} />
        <Stat label="Not verified" value={num(d.unverified)} />
        <Stat label="Verified and played" value={num(d.verified_played)} />
        <Stat label="Verified, never played" value={num(d.verified_never_played)} sub="Finished no run" />
        <Stat label="Newly verified" value={num(sum(m.get("newly_verified")))} sub={`first seen in ${r.days} days`} />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <Card title="Newly seen as verified, per day" note="The day we first saw a wallet as verified. For wallets verified before this dashboard existed, that is the day of their first check, not the day they verified."><Chart series={[{ name: "Newly verified", color: "#16a34a", points: m.get("newly_verified") ?? [] }]} /></Card>
        <Card title="Verified in total" note="Recorded once a day from the day the dashboard went live. It cannot be rebuilt for earlier days."><Chart series={[{ name: "Verified wallets", color: "#6d28d9", points: (m.get("verified_total") ?? []).filter((p) => p.value > 0) }]} /></Card>
      </div>
      <div style={{ height: 14 }} />
      <NotYet what="Success rate" why="GoodDollar's face check runs on GoodDollar's side, so a failed attempt is never seen by GameArena. What can be measured is how many players who opened the verify page went on to become verified; that needs the verify page to record its opens, which is the next step." />
    </Page>
  );
}
