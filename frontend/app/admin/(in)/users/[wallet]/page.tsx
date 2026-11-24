import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { Card, Grid, GAME_NAME, Page, Problem, Stat, Table, addrUrl, num, txUrl, when, C } from "@/components/admin/ui";

interface Player {
  wallet: string; user: Record<string, unknown> | null; first_seen: { first_at: string } | null; verification: { verified: boolean; first_verified_at: string | null; checked_at: string | null } | null;
  games: { game: string; runs: number; completed: number; best: number | null; last_at: string }[];
  recent_runs: { game: string; started_at: string; used: boolean; score: number | null; tx_hash: string | null; saved_at: string | null }[];
  payouts: { id: number; amount: number; token: string; reason: string | null; status: string; tx_hash: string | null; paid_at: string | null; created_at: string }[];
  purchases?: { sku: string; amount_wei: string; tx_hash: string; created_at: string }[]; events: { at: string; kind: string; game: string | null; ref: string | null; tx_hash: string | null }[];
}
const Tx = ({ h }: { h: string | null }) => (h ? <a href={txUrl(h)} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{h.slice(0, 10)}…</a> : <span style={{ color: C.dim }}>–</span>);

export default async function OnePlayer({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const r = await adminRead<Player>("player", { wallet });
  if (!r.ok || !r.data) return <Page title="Player"><Problem error={r.error} /></Page>;
  const p = r.data; const u = p.user ?? {}; const runs = p.games.reduce((a, g) => a + Number(g.runs), 0); const done = p.games.reduce((a, g) => a + Number(g.completed), 0);
  const paid = p.payouts.filter((x) => x.status === "sent" || x.status === "confirmed").reduce((a, x) => a + Number(x.amount), 0);
  return (
    <Page title="Player" sub={p.wallet} right={<span style={{ display: "flex", gap: 12, fontSize: 13.5 }}><a href={addrUrl(p.wallet)} target="_blank" rel="noreferrer" style={{ color: C.accent, fontWeight: 700 }}>On Celoscan</a><Link href={`/pass/${p.wallet}`} style={{ color: C.accent, fontWeight: 700 }}>Public passport</Link><Link href="/admin/users" style={{ color: C.accent, fontWeight: 700 }}>← All players</Link></span>}>
      <Grid>
        <Stat label="Verified" value={p.verification ? (p.verification.verified ? "Yes" : "No") : "Not checked"} tone={p.verification?.verified ? "good" : undefined} sub={p.verification?.first_verified_at ? `First seen verified ${when(p.verification.first_verified_at)}` : p.verification?.checked_at ? `Checked ${when(p.verification.checked_at)}` : undefined} />
        <Stat label="First seen" value={p.first_seen ? String(p.first_seen.first_at).slice(0, 10) : "–"} />
        <Stat label="Runs" value={num(runs)} sub={`${num(done)} completed`} />
        <Stat label="XP" value={num(u.xp)} sub={u.play_streak !== undefined ? `Streak ${num(u.play_streak)} · last played ${String(u.last_play_date ?? "–")}` : undefined} />
        <Stat label="Rewards paid" value={`${num(paid)}`} sub={`${p.payouts.length} recorded`} />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Card title="By game"><Table rows={p.games} cols={[{ head: "Game", cell: (g) => GAME_NAME[g.game] ?? g.game }, { head: "Runs", cell: (g) => num(g.runs), right: true }, { head: "Completed", cell: (g) => num(g.completed), right: true }, { head: "Best", cell: (g) => num(g.best), right: true }, { head: "Last played", cell: (g) => when(g.last_at) }]} empty="No runs." /></Card>
        <Card title="Rewards"><Table rows={p.payouts} cols={[{ head: "When", cell: (x) => when(x.paid_at ?? x.created_at) }, { head: "Amount", cell: (x) => `${num(x.amount)} ${x.token}`, right: true }, { head: "For", cell: (x) => x.reason ?? "–" }, { head: "Status", cell: (x) => x.status }, { head: "Transaction", cell: (x) => <Tx h={x.tx_hash} /> }]} empty="No payout recorded for this player." /></Card>
      </div>
      <Card title="Last 60 runs"><Table rows={p.recent_runs} cols={[{ head: "Started", cell: (x) => when(x.started_at) }, { head: "Game", cell: (x) => GAME_NAME[x.game] ?? x.game }, { head: "Finished", cell: (x) => (x.used ? "Yes" : <span style={{ color: C.warn }}>Abandoned</span>) }, { head: "Score", cell: (x) => num(x.score), right: true }, { head: "Saved", cell: (x) => (x.saved_at ? "Yes" : x.used ? <span style={{ color: C.warn }}>Not yet</span> : "–") }, { head: "Transaction", cell: (x) => <Tx h={x.tx_hash} /> }]} empty="No runs." /></Card>
      <div style={{ height: 14 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <Card title="Purchases"><Table rows={p.purchases ?? []} cols={[{ head: "When", cell: (x) => when(x.created_at) }, { head: "Item", cell: (x) => x.sku }, { head: "G$", cell: (x) => num(Number(x.amount_wei) / 1e18), right: true }, { head: "Transaction", cell: (x) => <Tx h={x.tx_hash} /> }]} empty="No purchases." /></Card>
        <Card title="Other events"><Table rows={p.events} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "What", cell: (x) => x.kind.replace(/_/g, " ") }, { head: "Detail", cell: (x) => x.ref ?? x.game ?? "–" }, { head: "Transaction", cell: (x) => <Tx h={x.tx_hash} /> }]} empty="Nothing else recorded." /></Card>
      </div>
    </Page>
  );
}
