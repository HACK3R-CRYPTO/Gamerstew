import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { Card, Grid, Kpi, NotYet, Page, Problem, RangeLinks, Table, Who, num, pivot, rangeOf, sum, when, C } from "@/components/admin/ui";
import { Donut, TimeChart } from "@/components/admin/charts";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface P { wallet: string; username: string | null; at: string | null; games?: number; self_verified?: boolean | null; expires_at?: string | null; probation?: boolean | null }
interface V { verified: number; lapsed: number; never: number; blacklisted: number; via_linked: number; on_probation: number; expiring_14d: number; not_checked_yet: number; verified_played: number; verified_never_played: number; last_checked: string | null; recent: P[]; expiring: P[]; lapsed_list: P[]; never_played: P[] }
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "–");
const left = (v: string | null | undefined) => { if (!v) return "–"; const d = Math.ceil((Date.parse(v) - Date.now()) / 86400000); return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`; };

export default async function Verification({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const [v, s] = await Promise.all([adminRead<V>("verification"), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to })]);
  if (!v.ok || !v.data) return <Page title="GoodDollar verification"><Problem error={v.error} /></Page>;
  const d = v.data; const m = pivot(s.data, r.from, r.to); const checked = Number(d.verified) + Number(d.lapsed) + Number(d.never) + Number(d.blacklisted);
  const everVerified = Number(d.verified) + Number(d.lapsed);
  return (
    <Page title="GoodDollar verification" sub={`Read from the GoodDollar Identity contract, wallet by wallet. Last check: ${when(d.last_checked)}.`} right={<RangeLinks base="/admin/verification" days={r.days} />}>
      {Number(d.not_checked_yet) > 0 && <NotYet what={`${num(d.not_checked_yet)} wallets still to check`} why={`40 wallets are checked every minute, the ones never checked first, so about ${Math.max(1, Math.ceil(Number(d.not_checked_yet) / 40))} minutes remain. The list also grows while older players are still being read in from the chain. Reload to see it move.`} />}
      <Grid min={190}>
        <Kpi dark label="Verified now" value={num(d.verified)} spark={m.get("verified_total")} sub={checked ? `${Math.round((Number(d.verified) / checked) * 100)}% of the ${num(checked)} wallets checked` : "The first check is under way"} />
        <Kpi label="Lapsed" value={num(d.lapsed)} color="#b45309" sub={everVerified ? `${Math.round((Number(d.lapsed) / everVerified) * 100)}% of everyone who ever verified. They passed the face check and the window ran out` : "Passed the face check, window ran out"} />
        <Kpi label="Never verified" value={num(d.never)} sub="No face check on record" />
        <Kpi label="Expiring in 14 days" value={num(d.expiring_14d)} color="#dc2626" sub={`${num(d.on_probation)} are on the short 3-day window`} />
        <Kpi label="Verified, never played" value={num(d.verified_never_played)} sub={`${num(d.verified_played)} verified players have played`} />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
        <Card title="Where every player stands"><Donut center={checked ? `${Math.round((Number(d.verified) / checked) * 100)}%` : "–"} sub="verified now" parts={[{ label: "Verified", value: Number(d.verified), color: "#16a34a" }, { label: "Lapsed", value: Number(d.lapsed), color: "#f59e0b" }, { label: "Never verified", value: Number(d.never), color: "#c4b5fd" }, { label: "Blacklisted", value: Number(d.blacklisted), color: "#dc2626" }, { label: "Not checked yet", value: Number(d.not_checked_yet), color: "#e5e7eb" }].filter((x) => x.value > 0 || x.label === "Verified")} /></Card>
        <Card title="Verified in total"><TimeChart narrow height={250} mode="last" series={[{ name: "Verified", color: "#16a34a", points: m.get("verified_total") ?? [] }]} /></Card>
        <Card title="New verifications per day" note="By the date the GoodDollar contract holds for the wallet."><TimeChart narrow height={250} kind="bar" series={[{ name: "Newly verified", color: "#f59e0b", points: m.get("newly_verified") ?? [] }]} /></Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
        <Card title={`Lapsed · ${num(d.lapsed)}`} note="They were verified and it ran out. A re-check brings them back. Most active first." right={<Link href="/admin/users?who=lapsed&sort=games" style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>See all →</Link>}>
          <div style={{ maxHeight: 380, overflowY: "auto" }}><Table rows={d.lapsed_list ?? []} cols={[{ head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} /> }, { head: "Ran out", cell: (x) => day(x.at) }, { head: "Games", cell: (x) => num(x.games), right: true }]} empty="Nobody has lapsed." /></div>
        </Card>
        <Card title={`Expiring soon · ${num(d.expiring_14d)}`} note="Verified now, with 14 days or fewer left.">
          <div style={{ maxHeight: 380, overflowY: "auto" }}><Table rows={d.expiring ?? []} cols={[{ head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} verified /> }, { head: "Time left", cell: (x) => <b style={{ color: C.bad }}>{left(x.at)}</b> }, { head: "Window", cell: (x) => (x.probation ? "3 days" : "180 days") }, { head: "Games", cell: (x) => num(x.games), right: true }]} empty="Nobody is about to expire." /></div>
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
        <Card title="Latest verified"><div style={{ maxHeight: 380, overflowY: "auto" }}><Table rows={d.recent ?? []} cols={[{ head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} verified /> }, { head: "Last face check", cell: (x) => day(x.at) }, { head: "Valid until", cell: (x) => day(x.expires_at) }, { head: "How", cell: (x) => (x.self_verified === false ? "Linked wallet" : "Own wallet") }, { head: "Games", cell: (x) => num(x.games), right: true }]} empty="None found yet." /></div></Card>
        <Card title="Verified, but never played" note="They passed the face check and recorded no score."><div style={{ maxHeight: 380, overflowY: "auto" }}><Table rows={d.never_played ?? []} cols={[{ head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} verified /> }, { head: "Last face check", cell: (x) => day(x.at) }]} empty="Every verified player has played." /></div></Card>
      </div>
      <Card title="How to read this">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.65, color: C.ink }}>
          <li>GoodDollar verification runs on a repeating ladder: a fresh face check lasts <b>3 days</b>, the next one <b>180 days</b>, then it starts again.</li>
          <li><b>Lapsed</b> means the window ran out. On the contract it looks the same as never verified, so it is worked out from the wallet&apos;s own record.</li>
          <li><b>Linked wallet</b> means the player verified with another wallet and connected this one to it. {num(d.via_linked)} verified players are like this. Prizes are still only paid to a wallet that is itself verified.</li>
          <li>A failed face check happens on GoodDollar&apos;s side and is never seen here, so a success rate cannot be shown.</li>
        </ul>
      </Card>
    </Page>
  );
}
