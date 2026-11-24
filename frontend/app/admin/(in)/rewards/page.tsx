import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { currentAdmin } from "@/lib/server/adminSession";
import { Card, Chart, Grid, Page, Problem, RangeLinks, Stat, Table, button, input, num, pivot, rangeOf, short, sum, txUrl, when, C } from "@/components/admin/ui";
import { recordPayout, setPayoutStatus } from "../actions";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface P { id: number; created_at: string; wallet: string; amount: number; token: string; reason: string | null; status: string; tx_hash: string | null; paid_at: string | null; note: string | null; recorded_by: string | null }
const ERR: Record<string, string> = { bad_wallet: "That is not a wallet address.", bad_amount: "Enter an amount above zero.", bad_tx: "That is not a transaction hash.", tx_needed: "A payout marked sent needs its transaction hash.", already_recorded: "That transfer to that wallet is already recorded.", not_allowed: "Your role cannot record payouts.", unavailable: "The database could not save it." };

export default async function Rewards({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const r = rangeOf(sp); const me = await currentAdmin();
  const [list, o, s] = await Promise.all([adminRead<P[]>("payouts", { limit: 100 }), adminRead<Record<string, number>>("overview"), adminRead<{ day: string; metric: string; value: number }[]>("series", { from: r.from, to: r.to })]);
  if (!list.ok) return <Page title="Rewards and payouts"><Problem error={list.error} /></Page>;
  const rows = list.data ?? []; const d = o.data ?? {}; const m = pivot(s.data, r.from, r.to); const canPay = me?.role === "admin" || me?.role === "super_admin";
  const label: React.CSSProperties = { display: "grid", gap: 5, fontSize: 13, fontWeight: 700, color: C.ink };
  return (
    <Page title="Rewards and payouts" sub="Every prize paid to a player. Prizes are sent by hand, so this is the record of them: enter each one as it is paid." right={<RangeLinks base="/admin/rewards" days={r.days} />}>
      {typeof sp.ok === "string" && <div style={{ background: "#dcfce7", color: "#166534", borderRadius: 12, padding: "10px 13px", fontSize: 14, marginBottom: 12, fontWeight: 600 }}>Saved.</div>}
      {typeof sp.err === "string" && <div role="alert" style={{ background: "#fef2f2", color: C.bad, borderRadius: 12, padding: "10px 13px", fontSize: 14, marginBottom: 12, fontWeight: 600 }}>{ERR[sp.err] ?? "That could not be saved."}</div>}
      <Grid>
        <Stat label="Paid in G$" value={num(d.payouts_g)} sub={`${num(sum(m.get("payouts_g")))} in the last ${r.days} days`} />
        <Stat label="Payouts recorded" value={num(d.payouts)} />
        <Stat label="Pending" value={num(d.payouts_pending)} tone={Number(d.payouts_pending) > 0 ? "warn" : undefined} sub="Owed, not sent yet" />
        <Stat label="Failed" value={num(d.payouts_failed)} tone={Number(d.payouts_failed) > 0 ? "bad" : undefined} />
        <Stat label="G$ players spent" value={num(sum(m.get("perk_g_spent")))} sub={`${num(sum(m.get("perk_purchases")))} purchases in ${r.days} days`} />
        <Stat label="Gas given" value={num(d.gas_grants)} sub="Grants to new players, all time" />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Card title="G$ paid per day"><Chart series={[{ name: "G$ paid", color: "#b45309", points: m.get("payouts_g") ?? [] }]} /></Card>
        {canPay ? (
          <Card title="Record a payout" note="For a prize already sent, paste the transaction hash. For one still owed, choose Pending and leave the hash empty.">
            <form action={recordPayout} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <label style={{ ...label, gridColumn: "1 / -1" }}>Wallet<input name="wallet" required placeholder="0x…" style={input} /></label>
              <label style={label}>Amount<input name="amount" required type="number" min="0" step="any" style={input} /></label>
              <label style={label}>Token<select name="token" style={input}><option>G$</option><option>USDC</option><option>CELO</option></select></label>
              <label style={label}>Status<select name="status" style={input}><option value="sent">Sent</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="failed">Failed</option></select></label>
              <label style={label}>Paid on<input name="paidAt" type="date" style={input} /></label>
              <label style={{ ...label, gridColumn: "1 / -1" }}>What it was for<input name="reason" placeholder="Weekly ladder, week 42, 1st place" style={input} /></label>
              <label style={{ ...label, gridColumn: "1 / -1" }}>Transaction hash<input name="txHash" placeholder="0x…" style={input} /></label>
              <label style={{ ...label, gridColumn: "1 / -1" }}>Note<input name="note" style={input} /></label>
              <button style={{ ...button, gridColumn: "1 / -1" }}>Record payout</button>
            </form>
          </Card>
        ) : <Card title="Record a payout"><p style={{ margin: 0, color: C.dim, fontSize: 14 }}>Your role can read payouts but not record them.</p></Card>}
      </div>
      <Card title={`Payouts · ${num(list.total ?? rows.length)}`}>
        <Table rows={rows} cols={[
          { head: "When", cell: (x) => when(x.paid_at ?? x.created_at) }, { head: "Player", cell: (x) => <Link href={`/admin/users/${x.wallet}`} style={{ color: C.accent, fontWeight: 700 }}>{short(x.wallet)}</Link> },
          { head: "Amount", cell: (x) => <b>{num(x.amount)} {x.token}</b>, right: true }, { head: "For", cell: (x) => x.reason ?? "–" },
          { head: "Status", cell: (x) => <span style={{ fontWeight: 700, color: x.status === "failed" ? C.bad : x.status === "pending" ? C.warn : C.good }}>{x.status}</span> },
          { head: "Transaction", cell: (x) => (x.tx_hash ? <a href={txUrl(x.tx_hash)} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{x.tx_hash.slice(0, 10)}…</a> : "–") },
          { head: "Recorded by", cell: (x) => x.recorded_by ?? "–" },
          ...(canPay ? [{ head: "Change", cell: (x: P) => (
            <form action={setPayoutStatus} style={{ display: "flex", gap: 6 }}><input type="hidden" name="id" value={x.id} />
              <select name="status" defaultValue={x.status} style={{ ...input, width: "auto", padding: "5px 8px", fontSize: 13 }}><option value="pending">pending</option><option value="sent">sent</option><option value="confirmed">confirmed</option><option value="failed">failed</option></select>
              <button style={{ ...button, padding: "5px 10px", fontSize: 13 }}>Set</button></form>) }] : []),
        ]} empty="No payouts recorded yet. Use the form above to enter the first one." />
        <p style={{ margin: "12px 0 0", fontSize: 13.5 }}><a href="/api/admin/export?kind=payouts" style={{ color: C.accent, fontWeight: 700 }}>Download as CSV</a></p>
      </Card>
    </Page>
  );
}
