# GameArena · Contract map (for Flow State + GoodBuilders dashboard indexer)

All on Celo mainnet (chain 42220). These are the addresses the GoodBuilders S4
dashboard needs so G$ volume and circulation stop underreporting. Today it
indexes only the gameplay contract (the 51,373 direct transactions), so it shows
~3.6K G$ volume instead of the real ~2M+. The G$ movers below are what it is
missing.

## Contracts where G$ moves (add these first — they drive circulation)

| Contract | Address | What it does |
|---|---|---|
| PerkShop (current) | `0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5` | G$ perk purchases; routes 20% to the GoodDollar UBI pool |
| PerkShop (earlier deploy) | `0x0fc6C5593B205b1c617CF33A236362B2c5c67650` | Earlier perk volume, same design |
| HabitatRegistry | `0x8888FEb43ac1833c683D0474204aa55A55BD010F` | G$ habitat unlocks; routes 20% to the UBI pool |
| Competition payout wallet | `0xa479b8c6030cBB01f8E9F6AcB2Ad2C757C81894d` | G$ paid to players; batches go through Disperse |
| Duel escrow | `0x5dd223edb320Bc7e5D1DbF0D68512D1917E0c557` | Staked G$ friend duels, winner takes 80% / 20% UBI |
| Solo wager | `0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb` | Solo G$ wager mode |

## Destination

| Contract | Address | What it does |
|---|---|---|
| GoodDollar UBI Pool | `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1` | Receives the 20% UBI split from PerkShop + HabitatRegistry |

## Gameplay + identity (already partly tracked)

| Contract | Address | What it does |
|---|---|---|
| Arena platform (scores) | `0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE` | Score submissions; source of the direct-transaction count |
| Game Pass (ERC-721) | `0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE` | Player pass mint |
| AI Agent (MARKOV / Challenge AI) | `0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1` | On-chain AI opponent matches |
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Agent identity |
| ERC-8004 Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Agent feedback/reputation |

## Reference

| Token | Address |
|---|---|
| G$ (GoodDollar) | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |

Public data sources: subgraph
`https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.2/gn`
· impact page https://gamearenahq.xyz/impact · Dune dune.com/ogazboiz/gamearena
