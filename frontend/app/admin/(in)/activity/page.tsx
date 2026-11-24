import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { Card, GAME_NAME, Page, Problem, Table, Who, txUrl, when, C } from "@/components/admin/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface F { at: string; kind: string; wallet: string | null; username: string | null; game: string | null; detail: string | null; tx_hash: string | null }
const KINDS: [string, string][] = [["", "Everything"], ["registered", "New players"], ["verified", "Verifications"], ["game_completed", "Games played"], ["game_started", "Unfinished runs"], ["purchase", "Purchases"], ["payout", "Payouts"], ["tx_failed", "Failed transactions"]];
const WORD: Record<string, string> = { registered: "Joined GameArena", purchase: "Bought something", new_player: "New player", verified: "Verified with GoodDollar", game_started: "Started a game, not finished", game_completed: "Played a game", payout_sent: "Payout sent", payout_confirmed: "Payout confirmed", payout_pending: "Payout pending", payout_failed: "Payout failed", tx_failed: "Transaction failed", payout_recorded: "Payout recorded" };
const TONE: Record<string, string> = { tx_failed: C.bad, payout_failed: C.bad, verified: C.good, registered: C.good, game_started: C.dim, purchase: "#b45309" };

export default async function Activity({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const kind = typeof sp.kind === "string" ? sp.kind : ""; const before = typeof sp.before === "string" ? sp.before : "";
  const r = await adminRead<F[]>("feed", { kind, before, limit: 80 });
  if (!r.ok) return <Page title="Activity"><Problem error={r.error} /></Page>;
  const rows = r.data ?? []; const last = rows[rows.length - 1]?.at;
  return (
    <Page title="Activity" sub="What is happening across GameArena, newest first.">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {KINDS.map(([k, label]) => <Link key={k} href={k ? `/admin/activity?kind=${k}` : "/admin/activity"} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 700, textDecoration: "none", color: k === kind ? "#fff" : C.ink, background: k === kind ? C.accent : "#fff", border: `1px solid ${k === kind ? C.accent : C.line}` }}>{label}</Link>)}
      </div>
      <Card>
        <Table rows={rows} cols={[
          { head: "When", cell: (x) => when(x.at) },
          { head: "What", cell: (x) => <b style={{ color: TONE[x.kind] ?? C.ink }}>{WORD[x.kind] ?? x.kind.replace(/_/g, " ")}</b> },
          { head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} /> },
          { head: "Game", cell: (x) => (x.game ? GAME_NAME[x.game] ?? x.game : "–") }, { head: "Detail", cell: (x) => <span title={x.detail ?? ""}>{(x.detail ?? "–").slice(0, 70)}</span> },
          { head: "Transaction", cell: (x) => (x.tx_hash ? <a href={txUrl(x.tx_hash)} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{x.tx_hash.slice(0, 10)}…</a> : "–") },
        ]} empty="Nothing of this kind has been recorded." />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 13.5 }}>
          {before ? <Link href={`/admin/activity${kind ? `?kind=${kind}` : ""}`} style={{ color: C.accent, fontWeight: 700 }}>← Latest</Link> : <span />}
          {rows.length >= 80 && last ? <Link href={`/admin/activity?${new URLSearchParams({ ...(kind ? { kind } : {}), before: last }).toString()}`} style={{ color: C.accent, fontWeight: 700 }}>Older →</Link> : <span />}
        </div>
      </Card>
    </Page>
  );
}
