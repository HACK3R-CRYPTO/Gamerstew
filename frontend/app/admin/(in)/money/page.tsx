import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { Bars, Card, Chart, Grid, NotYet, Page, Problem, RangeLinks, Stat, Table, num, pivot, rangeOf, short, txUrl, when, C } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface Tot { purchases: number; buyers: number; spent: number; kept: number; ubi: number; first?: string | null }
interface Money {
  period: Tot; all_time: Tot; prizes_paid: number; prizes_paid_all_time: number; read_to_block: number | null; read_at: string | null;
  by_item: { kind: string; item: number; n: number; buyers: number; spent: number; kept: number }[];
  top_spenders: { wallet: string; n: number; spent: number; kept: number }[];
  recent: { at: string; kind: string; item: number; wallet: string; total: number; treasury: number; ubi: number; tx_hash: string }[];
}
interface CashTot { started?: number; paid: number; in_flight?: number; not_paid?: number; players: number; g_paid: number; naira_paid: number; first?: string | null }
interface Cash { period: CashTot; all_time: CashTot; test_count: number; by_status: { status: string; n: number; g: number; naira: number }[]; recent: { id: string; wallet: string | null; amount_g: number; naira: number; fee_percent: number | null; status: string; tx_hash: string | null; at: string; paid_at: string | null }[] }
const CASH_WORDS: Record<string, string> = { awaiting_signature: "Not sent", sent: "Sent", processing: "Paying the bank", paid: "Paid", failed: "Not paid", refunded: "Sent back", expired: "Ran out" };
// the names players see, by on-chain id (frontend/lib/perks.ts and lib/habitats.ts)
const PERK: Record<number, string> = { 1: "Rhythm Rush · Save your run", 2: "Rhythm Rush · Neon Trail", 3: "Stack Tower · Save your run", 4: "Stack Tower · Crystal Blocks", 5: "Simon Memory · Retry", 6: "Challenge AI · Match Pack" };
const HABITAT: Record<number, string> = { 6: "Celestial Arena", 7: "Mystic Garden", 8: "Astral Realm", 9: "Cosmic Throne", 10: "Eternal Sanctuary" };
const itemName = (kind: string, item: number) => (kind === "perk" ? PERK[item] ?? `Perk #${item}` : `Habitat · ${HABITAT[item] ?? `tier ${item}`}`);

export default async function MoneyPage({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const [mo, s, co] = await Promise.all([adminRead<Money>("money", { from: r.from, to: r.to }), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to }), adminRead<Cash>("cashouts", { from: r.from, to: r.to })]);
  const cash = co.ok ? co.data : null;
  if (!mo.ok || !mo.data) return <Page title="Money"><Problem error={mo.error} /></Page>;
  const d = mo.data; const m = pivot(s.data, r.from, r.to); const p = d.period; const a = d.all_time;
  const net = Number(p.kept) - Number(d.prizes_paid); const netAll = Number(a.kept) - Number(d.prizes_paid_all_time);
  return (
    <Page title="Money" sub="What players spend, what GameArena keeps, and what goes back out as prizes. In G$." right={<RangeLinks base="/admin/money" days={r.days} />}>
      {d.read_to_block === null
        ? <NotYet what="Reading the chain" why="every purchase is read from the PerkShop and HabitatRegistry contracts. The reader has not stored its first block yet; it starts a minute after the server does and takes about an hour and a half to read the full history." />
        : <p style={{ margin: "0 0 12px", fontSize: 13, color: C.dim }}>Purchases read from the chain up to block {num(d.read_to_block)}, last updated {when(d.read_at)}. {a.first ? `First purchase on record: ${String(a.first).slice(0, 10)}.` : ""}</p>}
      <Grid>
        <Stat label="GameArena kept" value={`${num(p.kept)} G$`} sub={`${num(a.kept)} G$ all time`} tone="good" />
        <Stat label="Players spent" value={`${num(p.spent)} G$`} sub={`${num(p.purchases)} purchases · ${num(p.buyers)} buyers`} />
        <Stat label="Sent to UBI" value={`${num(p.ubi)} G$`} sub={`${num(a.ubi)} G$ all time`} />
        <Stat label="Prizes paid out" value={`${num(d.prizes_paid)} G$`} sub={`${num(d.prizes_paid_all_time)} G$ all time, as recorded`} />
        <Stat label="Kept minus prizes" value={`${num(net)} G$`} sub={`${num(netAll)} G$ all time`} tone={net < 0 ? "bad" : "good"} />
        <Stat label="Average purchase" value={Number(p.purchases) ? `${num(Number(p.spent) / Number(p.purchases))} G$` : "–"} />
      </Grid>
      <NotYet what="What is and is not counted" why="Counted: every perk and habitat purchase, with the exact share the contract sent to the treasury (80% today, 20% to UBI). Prizes are only what has been entered on the Rewards page. Not counted yet: the fee on friend-room entries, the cost of gas the server pays for players, prizes paid in USDC, and anything earned outside these two contracts." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Card title="Kept and paid out, per day"><Chart series={[{ name: "GameArena kept", color: "#15803d", points: m.get("revenue_g") ?? [] }, { name: "Prizes paid", color: "#b45309", points: m.get("payouts_g") ?? [] }]} /></Card>
        <Card title="Players spent, per day"><Chart series={[{ name: "Spent", color: "#6d28d9", points: m.get("spent_g") ?? [] }, { name: "To UBI", color: "#0e7490", points: m.get("ubi_g") ?? [] }]} /></Card>
        <Card title="What earns the most"><Bars rows={d.by_item.map((x) => ({ label: itemName(x.kind, x.item), value: Number(x.kept), hint: `G$ · ${num(x.n)} sold` }))} /></Card>
        <Card title="Purchases per day"><Chart series={[{ name: "Purchases", color: "#6d28d9", points: m.get("purchases") ?? [] }, { name: "Buyers", color: "#16a34a", points: m.get("buyers") ?? [] }]} /></Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <Card title="Biggest spenders"><Table rows={d.top_spenders} cols={[{ head: "Player", cell: (x) => <Link href={`/admin/users/${x.wallet}`} style={{ color: C.accent, fontWeight: 700 }}>{short(x.wallet)}</Link> }, { head: "Purchases", cell: (x) => num(x.n), right: true }, { head: "Spent", cell: (x) => `${num(x.spent)} G$`, right: true }, { head: "Kept", cell: (x) => `${num(x.kept)} G$`, right: true }]} empty="No purchases in this period." /></Card>
        <Card title="Latest purchases"><Table rows={d.recent} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "Item", cell: (x) => itemName(x.kind, x.item) }, { head: "Player", cell: (x) => <Link href={`/admin/users/${x.wallet}`} style={{ color: C.accent, fontWeight: 700 }}>{short(x.wallet)}</Link> }, { head: "Paid", cell: (x) => `${num(x.total)} G$`, right: true }, { head: "Kept", cell: (x) => `${num(x.treasury)} G$`, right: true }, { head: "Transaction", cell: (x) => <a href={txUrl(x.tx_hash)} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{x.tx_hash.slice(0, 10)}…</a> }]} empty="No purchases in this period." /></Card>
      </div>
      <h2 style={{ margin: "26px 0 4px", fontSize: 19, color: C.ink, fontWeight: 800 }}>Cash outs to a bank</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: C.dim }}>Players turning G$ into naira through GoodCash. The money goes from the player&apos;s wallet to their bank: GameArena never holds it. Counted from what GoodCash reports to the server, real money only.</p>
      {!cash ? <NotYet what="Not set up yet" why="run the migration 2026-11-26d_cashouts.sql and set GOODCASH_WEBHOOK_SECRET on the game server (docs/cash-out.md). Until then cash outs still work for players; they are just not counted here." /> : (
        <>
          <Grid>
            <Stat label="Paid to banks" value={`₦${num(cash.period.naira_paid)}`} sub={`₦${num(cash.all_time.naira_paid)} all time`} tone="good" />
            <Stat label="G$ cashed out" value={`${num(cash.period.g_paid)} G$`} sub={`${num(cash.all_time.g_paid)} G$ all time`} />
            <Stat label="Cash outs paid" value={num(cash.period.paid)} sub={`${num(cash.period.started ?? 0)} started · ${num(cash.all_time.paid)} paid all time`} />
            <Stat label="Players who cashed out" value={num(cash.period.players)} sub={`${num(cash.all_time.players)} all time${cash.all_time.first ? ` · first on ${cash.all_time.first}` : ""}`} />
            <Stat label="On their way" value={num(cash.period.in_flight ?? 0)} sub="sent, bank not paid yet" tone={(cash.period.in_flight ?? 0) > 0 ? "warn" : undefined} />
            <Stat label="Not paid" value={num(cash.period.not_paid ?? 0)} sub="failed, sent back or ran out" tone={(cash.period.not_paid ?? 0) > 0 ? "bad" : undefined} />
          </Grid>
          {cash.test_count > 0 && <p style={{ margin: "0 0 12px", fontSize: 13, color: C.dim }}>{num(cash.test_count)} test cash {cash.test_count === 1 ? "out" : "outs"} in this period, not counted above. No money moved in them.</p>}
          <Card title="Latest cash outs"><Table rows={cash.recent} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "Player", cell: (x) => (x.wallet ? <Link href={`/admin/users/${x.wallet}`} style={{ color: C.accent, fontWeight: 700 }}>{short(x.wallet)}</Link> : "–") }, { head: "Sent", cell: (x) => `${num(x.amount_g)} G$`, right: true }, { head: "Gets", cell: (x) => `₦${num(x.naira)}`, right: true }, { head: "Status", cell: (x) => CASH_WORDS[x.status] ?? x.status }, { head: "Tx", cell: (x) => (x.tx_hash ? <a href={txUrl(x.tx_hash)} target="_blank" rel="noreferrer" style={{ color: C.accent }}>view</a> : "–") }, { head: "Reference", cell: (x) => <code style={{ fontSize: 12 }}>{x.id}</code> }]} empty="No cash outs in this period." /></Card>
        </>
      )}
    </Page>
  );
}
