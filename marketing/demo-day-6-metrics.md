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

## vs GoodBuilders season targets (all beaten)
- Players: 879 vs 200 target — **4.4×**
- Verified humans: 163 vs 75 target — **2.2×**
- G$ to UBI: 45,769 vs 2,500 target — **18×**
- Competition payouts: 2,106,455 vs 400,000 G$ target — **5.3×**
