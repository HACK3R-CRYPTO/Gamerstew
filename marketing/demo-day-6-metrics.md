# Demo Day 6 · Live metrics snapshot

Pulled from production the day of Demo Day. Every number is on-chain or from a
tx-linked ledger — nothing self-reported. Re-pull the morning of the session and
update Flow State to match before presenting.

**Snapshot time:** 2026-09-29 11:34 UTC

## Sources
- **Subgraph (chain truth):** `https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.2/gn`
- **Verified humans:** `https://gamearenahq.xyz/api/verified-stats` (on-chain isWhitelisted per wallet)
- **Competition payouts:** `https://gamearenahq.xyz/api/payouts` (committed, tx-linked ledger)
- **Public page:** https://gamearenahq.xyz/impact · Dune: dune.com/ogazboiz/gamearena

## Players
- Total players: **879**
- Verified humans (GoodDollar isWhitelisted): **163** (19%)

## Activity
- Games played (on-chain score txs): **61,966** — each one a Celo transaction

## G$ economy (from PerkShop + HabitatRegistry contracts via subgraph)
- Perk purchases: **3,422** · perk spend: **121,922 G$**
- Habitat unlocks: **11** · habitat spend: **106,600 G$**
- Total G$ spent in-app: **228,522 G$**
- **G$ routed to the GoodDollar UBI pool: 45,769 G$**
  - Habitat 20% side: 21,385 G$
  - Perk shop 20% side: 24,384 G$

## Competition payouts to verified players (ledger, /api/payouts)
- **Total: 2,106,455 G$ + $50 USDC** across 43 player slots
  - Community Pool (Aug 24–Sep 6): 366,135 G$ · 28 players · tx 0x1b12…366a
  - Loyalty Pool (most consistent): 320,000 G$ · 5 players
  - Arena Cup (14-day event): 1,420,320 G$ (~$150 in G$)
  - Skill Sprint (top 10, private): $50 USDC · 10 players · tx 0xdc43…3d84

## Growth arc · Demo Day 1 → Demo Day 6 (how far we've come)
Baselines frozen from chain at each demo day; DD6 is live now.

| Metric | DD1 | DD2 | DD3 | DD4 | DD5 | **DD6 (now)** |
|---|---|---|---|---|---|---|
| Players | 227 | 392 | 487 | 664 | 737 | **879** |
| Games on-chain | 12,483 | 14,416 | 20,448 | 51,000 | 57,000 | **61,966** |
| Perk spend (G$) | 0 | 3,766 | 12,722 | — | — | **121,922** |
| G$ to UBI | 385 | 1,217 | 13,029 | 21,385 | 21,385 | **45,769** |

Headline arc: **227 → 879 players (3.9×)**, **12,483 → 61,966 games (5×)**,
**385 → 45,769 G$ to UBI (119×)** from Demo Day 1 to now.

## Total G$ circulation in GameArena (on-chain, from payout wallet + subgraph)
Answering Rael's "total G$ circulation" question (she recalled ~1M before).
Payout wallet: `0xa479b8c6030cBB01f8E9F6AcB2Ad2C757C81894d` · G$ token `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`.

- Payout wallet total G$ sent out: **5,984,115 G$** (204 txs), of which:
  - **4,000,000 G$ → UniswapV3Pool** (`0x3d9e…b341`) — liquidity/market-making, NOT player payouts, excluded from circulation
  - **1,442,427 G$ → Disperse contract** (`0xd152…2150`) — batch-fanned to 149 player wallets (≈ Arena Cup). Confirms Arena Cup IS on-chain (hash just not logged in /api/payouts)
  - remainder direct to players
- **G$ paid to players (on-chain): ~1,984,000 G$**
- **G$ spent by players in-game (perks + habitats): 228,522 G$**
- **Total game circulation ≈ 2.2M G$** (up from ~1M pre-Arena-Cup)
  - of which to GoodDollar UBI pool: 45,769 G$

Note: the /api/payouts ledger shows 2,106,455 G$ with Arena Cup + Loyalty marked
`tx: null`. On-chain the payments DID settle (via Disperse) — backfill the tx
hashes into the ledger so it matches the chain.

## vs GoodBuilders season targets (all beaten)
- Players: 879 vs 200 target — **4.4×**
- Verified humans: 163 vs 75 target — **2.2×**
- G$ to UBI: 45,769 vs 2,500 target — **18×**
- Competition payouts: 2,106,455 vs 400,000 G$ target — **5.3×**
