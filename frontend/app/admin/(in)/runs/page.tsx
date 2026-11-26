import { createPublicClient, http, formatEther } from "viem";
import { celo } from "viem/chains";
import { adminRead } from "@/lib/server/adminApi";
import { Bars, Card, Chart, Grid, NotYet, Page, Problem, RangeLinks, Stat, Table, GAME_NAME, num, rangeOf, type Point } from "@/components/admin/ui";
import { PERKS, UPCOMING_PERKS } from "@/lib/perks";
import { perkShopAbi } from "@/lib/abis/perkShop";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface GameRow { game: string; started: number; finished: number; unfinished: number; unfinished_onchain: number; players: number; best: number | null; average: number | null }
interface Runs {
  started: number; finished: number; unfinished: number; unfinished_onchain: number; players: number;
  games: GameRow[]; days: { day: string; started: number; finished: number; unfinished_onchain: number }[];
  ladder: { rounds: number; over_100: number; best: number | null; average: number | null };
  quits: { game: string; quits: number; saved: number; players: number }[];
  continues: { game: string; offered: number; bought: number; declined: number; bought_ranked: number; buyers: number }[];
  pokes: { times: number; players: number }; moods: { happy: number; sad: number; sleepy: number; breaks_today: number };
  shop: { item: number; sold: number; buyers: number; total: number; treasury: number; ubi: number }[];
}
interface PotReport { days: { day: string; game: string; spend: number; seed: number; carried_in: number; pot: number; players: number; winners: number; status: "paid" | "rolled"; carried_out: number }[]; paid_out: number; energy_spend: number; owed: number; owed_to: number; prizes: { day: string; wallet: string; amount: number; reason: string; status: string; tx_hash: string | null }[] }
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const gameName = (g: string) => GAME_NAME[g] ?? g;

/** What each shop item costs on the contract right now. 0 means the owner has not switched it on. Read by this server, not the subgraph. */
async function shopPrices(ids: number[]): Promise<Map<number, bigint> | null> {
  try {
    const client = createPublicClient({ chain: celo, transport: http(process.env.CELO_RPC_URL || "https://forno.celo.org") });
    const out = await client.multicall({ contracts: ids.map((id) => ({ address: CONTRACT_ADDRESSES.PERK_SHOP as `0x${string}`, abi: perkShopAbi, functionName: "perkPrice" as const, args: [id] as const })) });
    return new Map(ids.map((id, i) => [id, out[i].status === "success" ? (out[i].result as bigint) : 0n]));
  } catch { return null; }
}

export default async function RunsPage({ searchParams }: { searchParams: SP }) {
  const r = rangeOf(await searchParams);
  const items = [...PERKS, ...UPCOMING_PERKS].sort((a, b) => a.id - b.id);
  const [res, prices, potRes, frz] = await Promise.all([adminRead<Runs>("runs", { from: r.from, to: r.to }), shopPrices(items.map((p) => p.id)), adminRead<PotReport>("pot", { from: r.from, to: r.to }), adminRead<{ saved: number; players_saved: number; held: number; holders: number }>("freezes", { from: r.from, to: r.to })]);
  const pot = potRes.ok ? potRes.data : null;
  if (!res.ok || !res.data) {
    return (
      <Page title="Runs and shop" right={<RangeLinks base="/admin/runs" days={r.days} />}>
        {res.status === 401 || res.status === 403 ? <Problem error={res.error} /> : <NotYet what="Not set up yet" why="run games-backend/supabase-migrations/2026-11-27_admin_runs.sql in Supabase, then reload this page." />}
      </Page>
    );
  }
  const d = res.data;
  const days = (key: "started" | "finished" | "unfinished_onchain"): Point[] => d.days.map((x) => ({ day: x.day, value: Number(x[key]) }));
  const offered = d.continues.reduce((a, x) => a + Number(x.offered), 0), bought = d.continues.reduce((a, x) => a + Number(x.bought), 0);
  const quits = d.quits.reduce((a, x) => a + Number(x.quits), 0), quitsSaved = d.quits.reduce((a, x) => a + Number(x.saved), 0);
  const sold = new Map(d.shop.map((x) => [Number(x.item), x]));
  const shopTotal = d.shop.reduce((a, x) => a + Number(x.total), 0), shopKept = d.shop.reduce((a, x) => a + Number(x.treasury), 0);
  const moods = d.moods; const withPets = Number(moods.happy) + Number(moods.sad) + Number(moods.sleepy);
  return (
    <Page title="Runs and shop" sub="What happens to a run after it starts, what a continue does, how the pets feel, and what the shop sold. Runs are the server's own record of every ranked run that was opened." right={<RangeLinks base="/admin/runs" days={r.days} />}>
      <Grid>
        <Stat label="Runs started" value={num(d.started)} sub={`${num(d.players)} players`} />
        <Stat label="Finished" value={num(d.finished)} sub={`${pct(d.finished, d.started)} of runs started`} tone="good" />
        <Stat label="Left unfinished" value={num(d.unfinished)} sub={`${pct(d.unfinished, d.started)} of runs started`} tone={d.started && d.unfinished / d.started > 0.3 ? "warn" : undefined} />
        <Stat label="Unfinished, with a transaction" value={num(d.unfinished_onchain)} sub={d.unfinished ? `${pct(d.unfinished_onchain, d.unfinished)} of unfinished runs` : "none to send"} />
        <Stat label="Continues bought" value={num(bought)} sub={offered ? `${pct(bought, offered)} of ${num(offered)} offers` : "none offered yet"} />
        <Stat label="Shop sales" value={`${num(shopTotal)} G$`} sub={`${num(shopKept)} G$ kept by the treasury`} />
      </Grid>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1", minWidth: 0 }}><Card title="By game" note="Started = Finished + Unfinished, apart from runs opened in the last 15 minutes, which are still being played.">
          <Table rows={d.games} cols={[
            { head: "Game", cell: (x) => gameName(x.game) }, { head: "Started", cell: (x) => num(x.started), right: true }, { head: "Finished", cell: (x) => `${num(x.finished)} (${pct(x.finished, x.started)})`, right: true },
            { head: "Unfinished", cell: (x) => num(x.unfinished), right: true }, { head: "Sent", cell: (x) => num(x.unfinished_onchain), right: true }, { head: "Players", cell: (x) => num(x.players), right: true },
            { head: "Average", cell: (x) => num(x.average), right: true }, { head: "Best", cell: (x) => num(x.best), right: true },
          ]} empty="No runs in these days." />
        </Card></div>
        <Card title="Runs per day" note="A run is finished when its score was handed in. One left unfinished for 15 minutes gets a note transaction of its own, so every run a player opens is on the chain.">
          <Chart series={[{ name: "Started", color: "#6d28d9", points: days("started") }, { name: "Finished", color: "#16a34a", points: days("finished") }, { name: "Unfinished, sent", color: "#b45309", points: days("unfinished_onchain") }]} />
        </Card>
        <Card title="Word Ladder has no ceiling" note="A round used to be out of 100. A solo round is now three minutes with ladders that keep coming, so a score above 100 is the new rule at work.">
          <Grid min={120}>
            <Stat label="Rounds" value={num(d.ladder.rounds)} />
            <Stat label="Above 100" value={num(d.ladder.over_100)} sub={pct(Number(d.ladder.over_100), Number(d.ladder.rounds))} />
            <Stat label="Best" value={num(d.ladder.best)} />
            <Stat label="Average" value={num(d.ladder.average)} />
          </Grid>
        </Card>
        <Card title="Leaving a ranked round" note="A player who leaves is asked once, then the score so far is handed in. 'Saved' had something to hand in; the rest left with nothing scored. Counted by the page, so it starts from the day this went live.">
          {quits === 0 ? <NotYet what="Nothing yet" why="no one has ended a ranked round early in these days." /> : (
            <Table rows={d.quits} cols={[{ head: "Game", cell: (x) => gameName(x.game) }, { head: "Ended early", cell: (x) => num(x.quits), right: true }, { head: "Score saved", cell: (x) => `${num(x.saved)} (${pct(x.saved, x.quits)})`, right: true }, { head: "Players", cell: (x) => num(x.players), right: true }]} />
          )}
          {quits > 0 && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "rgba(27,13,66,0.62)" }}>{num(quitsSaved)} of {num(quits)} early ends kept a score.</p>}
        </Card>
        <Card title="Continues" note="Offered when a run dies. A ranked run keeps the score it had before the continue; what is added after is for fun. 'Bought in ranked' is how many buyers were in a ranked run.">
          {offered === 0 ? <NotYet what="Nothing yet" why="a continue is counted from the day this went live. Offers appear when a signed-in player's run ends in Stack Tower, Rhythm Rush or Simon Memory." /> : (
            <Table rows={d.continues} cols={[{ head: "Game", cell: (x) => gameName(x.game) }, { head: "Offered", cell: (x) => num(x.offered), right: true }, { head: "Bought", cell: (x) => `${num(x.bought)} (${pct(x.bought, x.offered)})`, right: true }, { head: "Turned down", cell: (x) => num(x.declined), right: true }, { head: "Bought in ranked", cell: (x) => num(x.bought_ranked), right: true }, { head: "Buyers", cell: (x) => num(x.buyers), right: true }]} />
          )}
        </Card>
        <Card title="How the pets feel today" note={`A pet is happy when its player has played today, sad when a streak would break, asleep when there is no streak and no play. ${num(moods.breaks_today)} players have a streak that ends tonight unless they play: the people a reminder is for.`}>
          {withPets === 0 ? <NotYet what="Nothing yet" why="no players yet." /> : <Bars rows={[{ label: "Happy", value: Number(moods.happy) }, { label: "Sad", value: Number(moods.sad) }, { label: "Asleep", value: Number(moods.sleepy) }]} />}
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "rgba(27,13,66,0.62)" }}>Pets poked in these days: {num(d.pokes.times)} times by {num(d.pokes.players)} players.</p>
        </Card>
        <Card title="Streak freezes" note="A freeze is a shop item held in advance. When a player comes back after a missed day, one is spent for each day missed and the streak carries on. 'Saved' is how many times that happened.">
          {!frz.ok || !frz.data ? <NotYet what="Not set up yet" why="run games-backend/supabase-migrations/2026-11-27d_streak_freeze.sql in Supabase." /> : (
            <Grid min={120}>
              <Stat label="Streaks saved" value={num(frz.data.saved)} sub={`${num(frz.data.players_saved)} players`} />
              <Stat label="Held now" value={num(frz.data.held)} sub={`by ${num(frz.data.holders)} players`} />
            </Grid>
          )}
        </Card>
        <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
          <Card title="Daily pot" note="One game a day carries a pot: 70% of that day's energy spend, plus whatever rolled over. A tenth of each paid pot is held to open the next day's, so the pot needs no money from the treasury. The top third of verified players split it. The server never pays: each prize is written as a pending payout, and shows as owed here until it is paid on the Payouts page.">
            {!pot ? <NotYet what="Not set up yet" why="run games-backend/supabase-migrations/2026-11-27b_pot.sql in Supabase. The pot itself stays off until POT_ENABLED is set to true on the server." />
              : pot.days.length === 0 ? <NotYet what="No pot has closed yet" why="a day is closed just after midnight UTC, once POT_ENABLED is true on the server." />
              : (
                <>
                  <Grid min={150}>
                    <Stat label="Paid to players" value={`${num(pot.paid_out)} G$`} sub="pots that closed and paid" />
                    <Stat label="Energy bought" value={`${num(pot.energy_spend)} G$`} sub="on the days shown" />
                    <Stat label="Still owed" value={`${num(pot.owed)} G$`} sub={`${num(pot.owed_to)} players waiting`} tone={Number(pot.owed) > 0 ? "warn" : "good"} />
                  </Grid>
                  <div style={{ height: 10 }} />
                  <Table rows={pot.days} cols={[
                    { head: "Day", cell: (x) => x.day }, { head: "Game", cell: (x) => gameName(x.game) }, { head: "Energy bought", cell: (x) => `${num(x.spend)} G$`, right: true }, { head: "Seed", cell: (x) => `${num(x.seed)} G$`, right: true },
                    { head: "Rolled in", cell: (x) => `${num(x.carried_in)} G$`, right: true }, { head: "Pot", cell: (x) => `${num(x.pot)} G$`, right: true }, { head: "Players", cell: (x) => num(x.players), right: true },
                    { head: "Result", cell: (x) => (x.status === "paid" ? `${num(x.winners)} prizes${Number(x.carried_out) > 0 ? `, ${num(x.carried_out)} G$ held for the next day` : ""}` : `rolled ${num(x.carried_out)} G$ forward`), right: true },
                  ]} />
                </>
              )}
          </Card>
        </div>
        <div style={{ gridColumn: "1 / -1", minWidth: 0 }}><Card title="Shop items" note="The price is read from the shop contract now. An item with no price is built but not on sale: its owner switches it on with scripts/set-perk.sh. Sales are read from the chain by our own reader.">
          <Table rows={items} cols={[
            { head: "Item", cell: (x) => `${x.id} · ${x.name}` }, { head: "Game", cell: (x) => x.gameLabel },
            { head: "Price on the contract", cell: (x) => { const p = prices?.get(x.id); return prices == null ? "could not read" : p && p > 0n ? `${num(Number(formatEther(p)))} G$` : "not switched on"; }, right: true },
            { head: "Sold", cell: (x) => num(sold.get(x.id)?.sold ?? 0), right: true }, { head: "Buyers", cell: (x) => num(sold.get(x.id)?.buyers ?? 0), right: true },
            { head: "Paid", cell: (x) => `${num(sold.get(x.id)?.total ?? 0)} G$`, right: true }, { head: "Treasury", cell: (x) => `${num(sold.get(x.id)?.treasury ?? 0)} G$`, right: true }, { head: "UBI pool", cell: (x) => `${num(sold.get(x.id)?.ubi ?? 0)} G$`, right: true },
          ]} />
        </Card></div>
      </div>
    </Page>
  );
}
