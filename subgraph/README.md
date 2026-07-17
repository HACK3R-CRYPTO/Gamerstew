# GameArena Subgraph

Turns GameArena's on-chain events into a clean GraphQL API. Instead of the Express backend recomputing leaderboards and stats from Supabase, this subgraph indexes the events straight from Celo Mainnet and serves them · leaderboards, per-player stats, habitat ownership, wager history, and daily + all-time aggregates.

## Indexed contracts

Four data sources on Celo Mainnet (network `celo`):

| Contract | Address | Start block | Events indexed |
|---|---|---|---|
| GamePass | `0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE` | 63000000 | `PassMinted`, `UsernameChanged`, `ScoreRecorded` |
| HabitatRegistry | `0x8888FEb43ac1833c683D0474204aa55A55BD010F` | 65552895 | `HabitatUnlocked` |
| SoloWager | `0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb` | 63222929 | `WagerCreated`, `WagerResolved` |
| PerkShop | `0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5` | 72287000 | `PerkPurchased` |

An `ArenaPlatform.json` ABI also sits in `abis/`, but ArenaPlatform is not wired as a data source · it is kept for reference only.

## Entities

Defined in `schema.graphql`, written by the AssemblyScript handlers in `src/`:

- **`Player`** · one row per wallet (id = lowercase address). Holds username, GamePass token id, per-game play counts and best scores (rhythm, simon, stack), habitat totals, and wager win/loss aggregates. Created lazily on the first event that touches a wallet, so a Player can exist before it mints a GamePass.
- **`PlayerHabitat`** · one row per habitat unlock (id = `${wallet}-${tier}`). Records tier, timestamp, amount paid, and the UBI / treasury split. Reachable from `Player.ownedHabitats` via `@derivedFrom`.
- **`Score`** · immutable audit row per `ScoreRecorded` event (id = `txHash-logIndex`). Stores game type, score, season, and the running total-games count at that moment.
- **`Wager`** · one row per on-chain wager (id = the contract wager id). Created on `WagerCreated` with `status: 0` (pending), then mutated by `WagerResolved` to won (`1`) or lost (`2`) with the payout.
- **`DailyStat`** · one row per UTC day (id = day-start timestamp). Buckets new players, scores, per-game plays, habitat unlocks, UBI donated, and wagers created. Charts read this directly, no client-side aggregation.
- **`GlobalStat`** · a single row (id = `"global"`) with running platform totals, updated by every handler.
- **`PerkPurchase`** · immutable row per `PerkPurchased` event (id = `${txHash}-${logIndex}`). Records the buyer `player`, `perkId`, whether it was a `cosmetic`, `totalPaid`, the `ubiAmount` / `treasuryAmount` split, `timestamp`, and `txHash`.
- **`PerkShopStat`** · a single row (id = `"global"`) with PerkShop totals: `totalPurchases`, `totalUbiG` (cumulative G$ routed to UBI through perks), `totalTreasuryG`, and `lastUpdatedAt`.

`gameType` is an integer across the schema · `0` = rhythm, `1` = simon, `2` = stack.

## Setup

```sh
cd subgraph
npm install
npm run codegen   # generates TypeScript bindings from schema + ABIs
npm run build     # compiles the AssemblyScript handlers
```

## Deploy to Goldsky

```sh
# One-time login (uses GOLDSKY_API_KEY env var or interactive)
npx goldsky login

# Deploy. Slug is `gamearena/1.0.2` in package.json · bump the version on schema changes.
npm run deploy:goldsky
```

After deploy Goldsky returns a GraphQL endpoint like:

```
https://api.goldsky.com/api/public/<PROJECT_ID>/subgraphs/gamearena/1.0.2/gn
```

Drop that into the frontend as `NEXT_PUBLIC_SUBGRAPH_URL` and start querying.

## Sample queries

Top 10 leaderboard by best Rhythm score:

```graphql
{
  players(first: 10, orderBy: bestRhythmScore, orderDirection: desc, where: { bestRhythmScore_gt: "0" }) {
    id
    username
    bestRhythmScore
    rhythmPlays
    highestHabitatTier
  }
}
```

A wallet's habitat collection:

```graphql
{
  player(id: "0xabc...") {
    username
    totalUbiDonated
    highestHabitatTier
    ownedHabitats(orderBy: tier) {
      tier
      unlockedAt
      ubiAmount
    }
  }
}
```

Daily activity for the last 30 days:

```graphql
{
  dailyStats(first: 30, orderBy: date, orderDirection: desc) {
    date
    habitatUnlocks
    ubiDonatedG
    scoresRecorded
    newPlayers
  }
}
```

Global totals (one row, id = `"global"`):

```graphql
{
  globalStat(id: "global") {
    totalPlayers
    totalScores
    totalHabitatUnlocks
    totalUbiDonatedG
    totalTreasuryG
    totalWageredG
  }
}
```

PerkShop UBI + purchase totals (one row, id = `"global"`):

```graphql
{
  perkShopStat(id: "global") {
    totalPurchases
    totalUbiG
    totalTreasuryG
    lastUpdatedAt
  }
}
```

## Adding a new contract

1. Drop the ABI into `abis/`
2. Add a `dataSource` block to `subgraph.yaml` with the address and start block
3. Write a handler in `src/`
4. Add any new entities to `schema.graphql`
5. `npm run codegen && npm run build && npm run deploy:goldsky`

## Notes

- `startBlock` for each contract is set just before its first known activity to skip empty blocks. Keep these accurate so re-indexes stay fast.
- `Player.username` is set on `PassMinted` and updated on `UsernameChanged` · the latest value always wins.
- `Player.totalUbiDonated` and `GlobalStat.totalUbiDonatedG` sum the UBI portion of every habitat unlock. `GlobalStat.totalTreasuryG` tracks the treasury portion separately.
- Only paid habitat tiers surface as `PlayerHabitat` rows. Free tiers are level-derived and live off-chain.
- The PerkShop data source is self-contained · `PerkPurchase` and `PerkShopStat` don't touch `Player` or `GlobalStat`, so perk UBI totals (`PerkShopStat.totalUbiG`) are read separately from habitat UBI (`GlobalStat.totalUbiDonatedG`). The app sums the two for a unified community-UBI figure.
- A `Wager` row mutates on `WagerResolved`. If the create event was somehow missed, `handleWagerResolved` skips rather than fabricate a row with no amount data.
