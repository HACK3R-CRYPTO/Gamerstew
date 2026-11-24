import { adminRead } from "@/lib/server/adminApi";
import { Card, Chart, Grid, NotYet, Page, Problem, RangeLinks, Stat, Table, GAME_NAME, num, pivot, rangeOf, short, sum, txUrl, when, C, addrUrl } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface F { at: string; kind: string; wallet: string | null; game: string | null; detail: string | null; tx_hash: string | null }
const CONTRACTS: [string, string, string][] = [
  ["GamePass", "0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE", "Usernames and every recorded score"],
  ["PerkShop", "0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5", "Perk purchases in G$"],
  ["HabitatRegistry", "0x8888FEb43ac1833c683D0474204aa55A55BD010F", "Habitat unlocks in G$"],
  ["GoodDollar G$", "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A", "The currency"],
  ["Score validator wallet", "0xc1cFA63135eA2fB5AB795cF10e4c79F4DD03c3f6", "Sends every gasless score"],
];

export default async function OnChain({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const [o, s, fails, recent] = await Promise.all([adminRead<Record<string, number>>("overview"), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to }), adminRead<F[]>("feed", { kind: "tx_failed", limit: 25 }), adminRead<F[]>("feed", { kind: "game_completed", limit: 25 })]);
  if (!o.ok || !o.data) return <Page title="On-chain"><Problem error={o.error} /></Page>;
  const d = o.data; const m = pivot(s.data, r.from, r.to);
  const total = Number(d.score_transactions) + Number(d.perk_purchases ?? 0) + Number(d.gas_grants ?? 0) + Number(d.payouts ?? 0);
  return (
    <Page title="On-chain" sub="Transactions GameArena sent or recorded, from our own records." right={<RangeLinks base="/admin/onchain" days={r.days} />}>
      <NotYet what="What this page does not show yet" why="scores and GamePass mints are read from the GamePass contract, and purchases from the PerkShop and HabitatRegistry, by our own reader. Gas grants and payouts are what the backend stored. G$ transfers made outside these contracts are not read." />
      <Grid>
        <Stat label="Transactions on record" value={num(total)} />
        <Stat label="Score transactions" value={num(d.score_transactions)} sub={`${num(sum(m.get("runs_onchain")))} in ${r.days} days · read from the GamePass contract`} />
        <Stat label="Failed" value={num(d.tx_failed)} tone={Number(d.tx_failed) > 0 ? "warn" : undefined} sub="Recorded from the day this went live" />
        <Stat label="Purchases" value={num(d.perk_purchases)} />
        <Stat label="Gas grants" value={num(d.gas_grants)} />
        <Stat label="Active wallets" value={num(d.mau)} sub="Recorded a score in 30 days" />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Card title="Score transactions per day"><Chart series={[{ name: "Recorded", color: "#6d28d9", points: m.get("runs_onchain") ?? [] }, { name: "Failed", color: "#b91c1c", points: m.get("tx_failed") ?? [] }]} /></Card>
        <Card title="Contracts">
          <Table rows={CONTRACTS} cols={[{ head: "Contract", cell: (x) => <b>{x[0]}</b> }, { head: "Address", cell: (x) => <a href={addrUrl(x[1])} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{short(x[1])}</a> }, { head: "Used for", cell: (x) => x[2] }]} />
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <Card title="Latest score transactions"><Table rows={(recent.data ?? []).filter((x) => x.tx_hash)} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "Player", cell: (x) => short(x.wallet) }, { head: "Game", cell: (x) => GAME_NAME[x.game ?? ""] ?? x.game ?? "–" }, { head: "Transaction", cell: (x) => <a href={txUrl(x.tx_hash!)} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{x.tx_hash!.slice(0, 10)}…</a> }]} empty="None yet." /></Card>
        <Card title="Failed transactions"><Table rows={fails.data ?? []} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "Player", cell: (x) => short(x.wallet) }, { head: "Game", cell: (x) => GAME_NAME[x.game ?? ""] ?? x.game ?? "–" }, { head: "Why", cell: (x) => <span title={x.detail ?? ""}>{(x.detail ?? "–").slice(0, 60)}</span> }]} empty="No failed transaction recorded." /></Card>
      </div>
    </Page>
  );
}
