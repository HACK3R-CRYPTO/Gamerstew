import Link from "next/link";
import { adminRead } from "@/lib/server/adminApi";
import { Card, Funnel, GAME_NAME, Heat, Kpi, NotYet, Page, Problem, RangeLinks, Table, Who, num, pivot, rangeOf, sum, when, C, type Point } from "@/components/admin/ui";
import { Donut, TimeChart } from "@/components/admin/charts";

type SP = Promise<Record<string, string | string[] | undefined>>;
type Rows = { day: string; metric: string; value: number }[];
interface G { game: string; played: number; players: number }
interface NewP { wallet: string; username: string | null; first_at: string; verified: boolean | null; games: number; first_game: string | null; came_back: boolean }
interface Top { wallet: string; username: string | null; games: number; kinds: number; days: number; verified: boolean | null }
interface Feed { at: string; kind: string; wallet: string | null; username: string | null; game: string | null; detail: string | null }
interface Ret { cohort: string; cohort_size: number; week_offset: number; players: number }
const COLORS = ["#6d28d9", "#16a34a", "#f59e0b", "#0e7490", "#db2777", "#4338ca", "#64748b", "#84cc16"];
const WORD: Record<string, string> = { registered: "joined", verified: "verified with GoodDollar", game_completed: "played", game_started: "left a run unfinished", purchase: "bought", payout_sent: "was paid", payout_confirmed: "was paid", payout_pending: "is owed", tx_failed: "had a failed transaction" };
const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

export default async function Overview({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const prevTo = day(Date.parse(r.from) - 86400000); const prevFrom = day(Date.parse(r.from) - r.days * 86400000); const heatFrom = day(Date.now() - 181 * 86400000);
  const [o, s, p, heat, games, fresh, top, feed, ret, traffic] = await Promise.all([
    adminRead<Record<string, number | string | null>>("overview"), adminRead<Rows>("series", { from: r.from, to: r.to }), adminRead<Rows>("series", { from: prevFrom, to: prevTo }),
    adminRead<Rows>("series", { from: heatFrom, to: r.to }), adminRead<G[]>("games", { from: r.from, to: r.to }), adminRead<NewP[]>("new_players", { from: r.from, to: r.to, limit: 7 }),
    adminRead<Top[]>("top", { from: r.from, to: r.to, limit: 7 }), adminRead<Feed[]>("feed", { limit: 9 }), adminRead<Ret[]>("retention", { weeks: 8 }),
    adminRead<{ funnel: { visited: number; opened_a_game: number; started_a_run: number; signed_in: number } }>("traffic", { from: r.from, to: r.to }),
  ]);
  if (!o.ok || !o.data) return <Page title="Overview"><Problem error={o.error} /></Page>;
  const d = o.data; const m = pivot(s.data, r.from, r.to); const b = pivot(p.data, prevFrom, prevTo); const h = pivot(heat.data, heatFrom, r.to);
  const g = (k: string): Point[] => m.get(k) ?? []; const was = (k: string) => sum(b.get(k));
  const gm = (games.data ?? []).filter((x) => Number(x.played) > 0); const played = gm.reduce((a, x) => a + Number(x.played), 0);
  const verified = Number(d.verified); const checked = Number(d.verification_checked); const reg = Number(d.registered);
  const cohorts = [...new Set((ret.data ?? []).map((x) => x.cohort))].slice(-6); const cell = (c: string, off: number) => (ret.data ?? []).find((x) => x.cohort === c && x.week_offset === off);
  const f = traffic.data?.funnel; const reading = (d.chain as unknown as Record<string, { block: number }> | null)?.gamepass;
  const perPlayer = Number(d.players_scored) ? Number(d.games_played) / Number(d.players_scored) : 0;
  return (
    <Page title="Overview" sub={`GameArena since ${String(d.history_from ?? "").slice(0, 10) || "launch"}. Every figure comes from the chain or the database. Days are UTC.`} right={<RangeLinks base="/admin" days={r.days} />}>
      {!reading && <NotYet what="History is still being read" why="players and games are copied in from the GamePass contract, about an hour and a half the first time. Until it finishes, the totals below are short and grow every minute." />}

      <div className="ov-hero">
        <Kpi dark label="Registered players" value={num(reg)} spark={g("registered_total")} delta={{ now: sum(g("registered_new")), before: was("registered_new") }} sub={`${num(sum(g("registered_new")))} joined in the last ${r.days} days`} />
        <Kpi label="Games played" value={num(d.games_played)} spark={g("games_played")} color="#16a34a" delta={{ now: sum(g("games_played")), before: was("games_played") }} sub={`${num(sum(g("games_played")))} in ${r.days} days · every one on-chain`} />
        <Kpi label="Active players" value={num(d.mau)} spark={g("active_players")} color="#0e7490" delta={{ now: sum(g("active_players")), before: was("active_players") }} sub={`in 30 days · ${num(d.wau)} this week · ${num(d.dau)} today`} />
        <Kpi label="Verified humans" value={num(verified)} spark={g("verified_total")} color="#b45309" sub={checked ? `${Math.round((verified / Math.max(1, checked)) * 100)}% of the ${num(checked)} wallets checked${checked < Number(d.players_ever) ? ` · ${num(Number(d.players_ever) - checked)} to go` : ""}` : "The first check is under way"} />
      </div>

      <div className="ov-two">
        <Card title="Growth" right={<span style={{ fontSize: 12.5, color: C.dim }}>running totals</span>}>
          <TimeChart height={280} mode="last" series={[{ name: "Registered", color: "#6d28d9", points: g("registered_total") }, { name: "Verified", color: "#f59e0b", points: g("verified_total") }]} />
        </Card>
        <Card title="At a glance">
          <div className="ov-facts">
            <div><b>{num(perPlayer)}</b><span>games per player, all time</span></div>
            <div><b>{num(d.players_scored)}</b><span>players have recorded a score</span></div>
            <div><b>{reg ? Math.round((Number(d.players_scored) / reg) * 100) : 0}%</b><span>of registered players have played</span></div>
            <div><b>{num(d.markov_matches)}</b><span>matches against MARKOV</span></div>
            <div><b>{num(sum(g("revenue_g")))} G$</b><span>kept in {r.days} days</span></div>
            <div><b>{num(d.payouts_g)} G$</b><span>paid in prizes, as recorded</span></div>
          </div>
        </Card>
      </div>

      <div className="ov-two">
        <Card title="Games played per day" right={<Link href="/admin/games" style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>All games →</Link>}>
          <TimeChart height={260} kind="bar" stacked series={gm.slice(0, 7).map((x, i) => ({ name: GAME_NAME[x.game] ?? x.game, color: COLORS[i % COLORS.length], points: g(`plays:${x.game}`) }))} />
        </Card>
        <Card title="What gets played">
          <Donut center={num(played)} sub={`games in ${r.days} days`} parts={gm.slice(0, 7).map((x, i) => ({ label: GAME_NAME[x.game] ?? x.game, value: Number(x.played), color: COLORS[i % COLORS.length] }))} />
        </Card>
      </div>

      <div className="ov-three">
        <Card title="Players per day"><TimeChart narrow height={250} series={[{ name: "Active", color: "#0e7490", points: g("active_players") }, { name: "New", color: "#16a34a", points: g("new_players") }]} /></Card>
        <Card title="Humans, verified"><Donut center={checked ? `${Math.round((verified / Math.max(1, checked)) * 100)}%` : "–"} sub="verified" parts={[{ label: "Verified", value: verified, color: "#16a34a" }, { label: "Not verified", value: Number(d.unverified), color: "#c4b5fd" }, { label: "Not checked yet", value: Math.max(0, Number(d.players_ever) - checked), color: "#e5e7eb" }]} /></Card>
        <Card title="From visit to player" note={f && f.visited ? undefined : "Visits are counted from the day this went live."}>
          <Funnel steps={[{ label: "Opened the app", value: f?.visited ?? 0 }, { label: "Opened a game", value: f?.opened_a_game ?? 0 }, { label: "Started a run", value: f?.started_a_run ?? 0 }, { label: "Signed in", value: f?.signed_in ?? 0 }]} />
        </Card>
      </div>

      <div className="ov-two">
        <Card title="Every day, last 6 months" note="One square a day. Darker means more games recorded on-chain."><Heat points={h.get("games_played") ?? []} /></Card>
        <Card title="Do players come back?" note="Of the players first seen in a week, the share who played again in each later week." right={<Link href="/admin/users" style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>Detail →</Link>}>
          {cohorts.length ? (
            <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "separate", borderSpacing: 3, fontSize: 12.5, color: C.ink }}>
              <thead><tr><th style={{ textAlign: "left", fontWeight: 700, color: C.dim, padding: "2px 8px 2px 0" }}>Joined</th><th style={{ color: C.dim, fontWeight: 700 }}>Size</th>{[1, 2, 3, 4, 5].map((w) => <th key={w} style={{ color: C.dim, fontWeight: 700 }}>+{w}w</th>)}</tr></thead>
              <tbody>{cohorts.map((c) => { const size = cell(c, 0)?.cohort_size ?? 0; return (<tr key={c}><td style={{ whiteSpace: "nowrap", padding: "2px 8px 2px 0" }}>{String(c).slice(5, 10)}</td><td style={{ textAlign: "center", fontWeight: 700 }}>{num(size)}</td>
                {[1, 2, 3, 4, 5].map((w) => { const x = cell(c, w); const pct = x && size ? Math.round((x.players / size) * 100) : null; return <td key={w} style={{ width: 46, height: 28, textAlign: "center", borderRadius: 7, background: pct === null ? "rgba(76,29,149,0.04)" : `rgba(109,40,217,${0.1 + (pct / 100) * 0.75})`, color: pct !== null && pct > 45 ? "#fff" : C.ink, fontWeight: 700 }}>{pct === null ? "" : `${pct}%`}</td>; })}</tr>); })}</tbody>
            </table></div>) : <p style={{ margin: 0, color: C.dim, fontSize: 14 }}>No new players in the last eight weeks.</p>}
        </Card>
      </div>

      <div className="ov-three">
        <Card title={`New in ${r.days} days`} right={<Link href="/admin/users?who=new30&sort=new" style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>See all →</Link>}>
          <Table rows={fresh.data ?? []} cols={[{ head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} verified={x.verified} /> }, { head: "Joined", cell: (x) => String(x.first_at).slice(0, 10) }, { head: "Games", cell: (x) => num(x.games), right: true }]} empty="Nobody new in this period." />
        </Card>
        <Card title="Most active" right={<Link href="/admin/users?sort=games" style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>See all →</Link>}>
          <Table rows={top.data ?? []} cols={[{ head: "Player", cell: (x) => <Who wallet={x.wallet} username={x.username} verified={x.verified} /> }, { head: "Games", cell: (x) => num(x.games), right: true }, { head: "Days", cell: (x) => num(x.days), right: true }]} empty="No games in this period." />
        </Card>
        <Card title="Happening now" right={<Link href="/admin/activity" style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>Full feed →</Link>}>
          <div style={{ display: "grid", gap: 10 }}>
            {(feed.data ?? []).map((x, i) => <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13.5, minWidth: 0 }}><Who wallet={x.wallet} username={x.username} /><span style={{ color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{WORD[x.kind] ?? x.kind.replace(/_/g, " ")} {x.game ? GAME_NAME[x.game] ?? x.game : ""} {x.kind === "game_completed" || x.kind === "purchase" ? `· ${x.detail ?? ""}` : ""}</span><span style={{ marginLeft: "auto", color: C.dim, fontSize: 12, whiteSpace: "nowrap" }} title={when(x.at)}>{ago(x.at)}</span></div>)}
            {!(feed.data ?? []).length && <p style={{ margin: 0, color: C.dim, fontSize: 14 }}>Nothing recorded yet.</p>}
          </div>
        </Card>
      </div>
      <style>{`
        .ov-hero { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
        .ov-two { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 14px; margin-bottom: 14px; }
        .ov-three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
        .ov-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 12px; }
        .ov-facts b { display: block; font-family: "Melon Pop", "Fredoka", system-ui, sans-serif; font-size: 24px; font-weight: 400; color: #1b0d42; line-height: 1.1; }
        .ov-facts span { font-size: 12.5px; color: rgba(27,13,66,0.62); line-height: 1.35; display: block; margin-top: 3px; }
        @media (max-width: 1180px) { .ov-hero { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ov-two, .ov-three { grid-template-columns: minmax(0, 1fr); } }
        @media (max-width: 520px) { .ov-hero { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </Page>
  );
}
