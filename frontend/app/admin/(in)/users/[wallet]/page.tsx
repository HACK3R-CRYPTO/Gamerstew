import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { Card, Grid, GAME_NAME, Heat, Kpi, Page, Problem, Table, addrUrl, num, txUrl, when, C } from "@/components/admin/ui";

interface Player {
  wallet: string; mint: { username: string | null; at: string; tx_hash: string; token_id: number } | null; user: Record<string, unknown> | null; first_seen: { first_at: string } | null;
  verification: { verified: boolean; first_verified_at: string | null; verified_at: string | null; checked_at: string | null } | null;
  games: { game: string; games: number; best: number | null; avg: number | null; first_at: string; last_at: string }[]; recent_scores: { at: string; game: string; score: number; tx_hash: string }[];
  by_day: { day: string; games: number }[]; tickets: { started: number; abandoned: number } | null;
  payouts: { id: number; amount: number; token: string; reason: string | null; status: string; tx_hash: string | null; paid_at: string | null; created_at: string }[];
  purchases: { at: string; kind: string; item: number; total: number; treasury: number; tx_hash: string }[]; events: { at: string; kind: string; game: string | null; ref: string | null; tx_hash: string | null }[];
}
const Tx = ({ h }: { h: string | null }) => (h ? <a href={txUrl(h)} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{h.slice(0, 10)}…</a> : <span style={{ color: C.dim }}>–</span>);

export default async function OnePlayer({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const r = await adminRead<Player>("player", { wallet });
  if (!r.ok || !r.data) return <Page title="Player"><Problem error={r.error} /></Page>;
  const p = r.data; const u = p.user ?? {}; const games = p.games.reduce((a, g) => a + Number(g.games), 0);
  const paid = p.payouts.filter((x) => x.status === "sent" || x.status === "confirmed").reduce((a, x) => a + Number(x.amount), 0); const spent = p.purchases.reduce((a, x) => a + Number(x.total), 0);
  // a filled calendar for the last 120 days
  const byDay = new Map(p.by_day.map((d) => [String(d.day).slice(0, 10), Number(d.games)])); const days = Array.from({ length: 120 }, (_, i) => { const day = new Date(Date.now() - (119 - i) * 86400000).toISOString().slice(0, 10); return { day, value: byDay.get(day) ?? 0 }; });
  const vdate = p.verification?.verified_at ?? p.verification?.first_verified_at;
  return (
    <Page title={p.mint?.username ? `@${p.mint.username}` : "Player"} sub={p.wallet} right={<span style={{ display: "flex", gap: 14, fontSize: 13.5, flexWrap: "wrap" }}><a href={addrUrl(p.wallet)} target="_blank" rel="noreferrer" style={{ color: C.accent, fontWeight: 700 }}>Celoscan</a><Link href={`/pass/${p.wallet}`} style={{ color: C.accent, fontWeight: 700 }}>Public passport</Link><Link href="/admin/users" style={{ color: C.accent, fontWeight: 700 }}>← All players</Link></span>}>
      <Grid min={180}>
        <Kpi label="Joined" value={p.mint ? String(p.mint.at).slice(0, 10) : p.first_seen ? String(p.first_seen.first_at).slice(0, 10) : "–"} sub={p.mint ? <>GamePass #{num(p.mint.token_id)} · <Tx h={p.mint.tx_hash} /></> : "No GamePass minted"} />
        <Kpi label="Verified" value={p.verification ? (p.verification.verified ? "Yes" : "No") : "Not checked"} color="#16a34a" sub={vdate ? `since ${String(vdate).slice(0, 10)}` : p.verification?.checked_at ? `checked ${when(p.verification.checked_at)}` : undefined} />
        <Kpi label="Games played" value={num(games)} sub={`${p.games.length} different games${p.tickets?.abandoned ? ` · ${num(p.tickets.abandoned)} runs left unfinished` : ""}`} />
        <Kpi label="Level" value={u.xp !== undefined ? `${num(u.xp)} XP` : "–"} sub={u.play_streak !== undefined ? `streak ${num(u.play_streak)} · last played ${String(u.last_play_date ?? "–")}` : undefined} />
        <Kpi label="Spent" value={`${num(spent)} G$`} sub={`${p.purchases.length} purchases`} />
        <Kpi label="Prizes received" value={`${num(paid)} G$`} sub={`${p.payouts.length} recorded`} />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
        <Card title="Last 120 days"><Heat points={days} /></Card>
        <Card title="By game"><Table rows={p.games} cols={[{ head: "Game", cell: (g) => <b>{GAME_NAME[g.game] ?? g.game}</b> }, { head: "Games", cell: (g) => num(g.games), right: true }, { head: "Best", cell: (g) => num(g.best), right: true }, { head: "Average", cell: (g) => num(g.avg), right: true }, { head: "Last played", cell: (g) => when(g.last_at) }]} empty="No scores recorded." /></Card>
      </div>
      <Card title="Latest scores, on-chain"><div style={{ maxHeight: 380, overflowY: "auto" }}><Table rows={p.recent_scores} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "Game", cell: (x) => GAME_NAME[x.game] ?? x.game }, { head: "Score", cell: (x) => <b>{num(x.score)}</b>, right: true }, { head: "Transaction", cell: (x) => <Tx h={x.tx_hash} /> }]} empty="No scores recorded." /></div></Card>
      <div style={{ height: 14 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <Card title="Purchases"><Table rows={p.purchases} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "Item", cell: (x) => `${x.kind} #${x.item}` }, { head: "Paid", cell: (x) => `${num(x.total)} G$`, right: true }, { head: "Transaction", cell: (x) => <Tx h={x.tx_hash} /> }]} empty="No purchases." /></Card>
        <Card title="Prizes"><Table rows={p.payouts} cols={[{ head: "When", cell: (x) => when(x.paid_at ?? x.created_at) }, { head: "Amount", cell: (x) => `${num(x.amount)} ${x.token}`, right: true }, { head: "For", cell: (x) => x.reason ?? "–" }, { head: "Status", cell: (x) => x.status }, { head: "Transaction", cell: (x) => <Tx h={x.tx_hash} /> }]} empty="No payout recorded." /></Card>
        <Card title="Other events"><Table rows={p.events} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "What", cell: (x) => x.kind.replace(/_/g, " ") }, { head: "Detail", cell: (x) => x.ref ?? x.game ?? "–" }]} empty="Nothing else recorded." /></Card>
      </div>
    </Page>
  );
}
