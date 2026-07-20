# GameArena Smart Contracts

Solidity contracts for GameArena on Celo Mainnet (chain 42220). Built with Foundry and OpenZeppelin v4.

These contracts cover three jobs: proving who a player is on-chain (GamePass), recording game scores on-chain, and moving GoodDollar (G$) for wagers and cosmetic unlocks. Most day-to-day player value now lives in GamePass and HabitatRegistry. The two wager contracts are older and kept around for the AI-agent match flow and legacy players.

## Deployed contracts (Celo Mainnet)

| Contract | Purpose | Address |
|---|---|---|
| `GamePass.sol` | Soulbound identity NFT: username, tiers, on-chain scores | [`0xBB044d67...`](https://celoscan.io/address/0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE) |
| `HabitatRegistry.sol` | G$ cosmetic sink: unlock paid habitat tiers, split to UBI + treasury | [`0x8888FEb4...`](https://celoscan.io/address/0x8888FEb43ac1833c683D0474204aa55A55BD010F) |
| `PerkShop.sol` | G$ perk sink: saves, retries, cosmetics, match tickets, split to treasury + UBI | [`0xe451Ab21...`](https://celoscan.io/address/0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5) |
| `ArenaPlatform.sol` | 1v1 G$ match escrow, used by A2A agent counterparties, legacy for human players | [`0x5C0eafE7...`](https://celoscan.io/address/0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE) |
| `SoloWager.sol` | Solo score wager escrow (legacy) | [`0xc78A8A02...`](https://celoscan.io/address/0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb) |

## How they work

### GamePass.sol · soulbound identity + scores

A non-transferable ERC-721 ("GameArena Pass", symbol `GAPASS`). One per wallet.

- `mint(username)` registers a player. Usernames are 3-16 chars, `a-z 0-9 _`, case-insensitive unique. `hasMinted[player]` gates everything else. `totalSupply` is the count of registered players.
- `changeUsername(newName)`, plus views `getUsername(player)` and `isUsernameAvailable(name)`.
- Scores are stored two ways: `bestScore[player][gameType]` (all-time, never resets) and `weeklyBest[season][player][gameType]` (per-week). `currentSeason()` returns `block.timestamp / 7 days`, so seasons roll over automatically with no admin call.
- `gameType` is a `uint8`: `0` = Rhythm Rush, `1` = Simon Memory.

Score-save paths:

- `recordScoreWithBackendSig(gameType, score, nonce, backendSignature)` is the current player path. The backend signs an EIP-712 `BackendApproval` voucher off-chain, the player submits it and pays gas, so the tx shows under the player's own address. Requires `hasMinted[msg.sender]`. `scoreNonces` makes each voucher single-use.
- `recordScoreSigned(player, gameType, score, nonce, signature)` is the inverse: the player signs, the backend (`scoreValidator`) submits and pays gas.
- `recordScore(player, gameType, score)` is a direct backend call, kept for backwards compatibility.

All three require the player to have minted and go through `_saveScore`, which bumps `gamesPlayed` / `totalGamesPlayed` and emits `ScoreRecorded`.

Admin: `setScoreValidator`, `adminSetScore` (correct an inflated score for a season), and a one-time `migrate` / `finalizeMigration` for importing players from the old contract.

### HabitatRegistry.sol · G$ cosmetic sink

Records which paid habitat tiers a player owns. The art is frontend-only, this contract just gates it behind a G$ donation and never holds G$.

- `unlockHabitat(tier)` pulls the tier cost in G$ from the player and splits it in one tx: treasury portion first (`treasuryBps`), UBI pool takes the remainder (`ubiBps`), so rounding always favors UBI. The live split is **80% treasury / 20% UBI** (`treasuryBps = 8000`, set via `setSplit`; the source default is 85% UBI but the deployed contract runs 20%). Marks `ownedTiers[player][tier]`.
- Free tiers 1-5 are level-based and tracked off-chain. Only paid tiers `>= FIRST_PAID_TIER` (6) are recorded here.
- Default tiers (18-decimal G$): 6 = 300, 7 = 1,000, 8 = 3,000, 9 = 10,000, 10 = 30,000.
- View `ownsHabitat(player, tier)`. Aggregates: `playerUbiDonated`, `totalCommunityContribution`.
- Admin: `setTierCost` (add or disable tiers), `setSplit` (must sum to 10000 bps), `setUbiPool`, `setTreasury`, `pause` / `unpause`, and `recoverToken` (G$ excluded so UBI flow can never be drained).

Constructor takes `(gToken, ubiPool, treasury)`.

### PerkShop.sol · G$ perk sink

In-game perks paid in G$ across GameArena's casual modes: saves ("continue your run"), retries, cosmetics, and Challenge AI match tickets. Ranked play never touches this shop, so ranked stays pure skill. Like HabitatRegistry, the contract never holds G$ · every purchase splits it in one tx.

- Perks are either **consumable** (saves/retries/tickets: one purchase = one use, granted off-chain by the game backend, re-buyable) or **cosmetic** (a one-time on-chain unlock, owned forever).
- Six default perks configured in the constructor (18-decimal G$, all tunable via `setPerk`):

  | Perk id | Perk | Type | Price |
  |---|---|---|---|
  | 1 | Rhythm Rush · Save | consumable | 30 G$ |
  | 2 | Rhythm Rush · Neon Trail | cosmetic | 300 G$ |
  | 3 | Stack Tower · Save | consumable | 30 G$ |
  | 4 | Stack Tower · Crystal Blocks | cosmetic | 250 G$ |
  | 5 | Simon Memory · Retry | consumable | 20 G$ |
  | 6 | Challenge AI · Match Pack (+5 matches) | consumable | 2 G$ |

- `buyPerk(perkId)` pulls the price in G$ from the caller and splits it in one tx: treasury portion first (`treasuryBps`, default 80%), UBI pool takes the remainder (`ubiBps`, default 20%), so rounding always favors UBI. Cosmetics mark `ownedCosmetic[player][perkId]`; consumables just emit `PerkPurchased` for the backend to grant.
- `buyPerkWithPermit(player, perkId, deadline, v, r, s)` is the gasless path: the player signs one EIP-2612 permit and a relayer submits + pays CELO, so the buy is a single transaction with zero CELO from the player. The permit is wrapped in try/catch so a pre-set allowance can't brick the purchase.
- Views: `ownsCosmetic(player, perkId)`, `perkPrice(perkId)`. Aggregates: `playerUbiContributed`, `totalCommunityContribution`, `perksBought`.
- Admin: `setPerk` (price > 0 enables, 0 disables), `setSplit` (must sum to 10000 bps), `setUbiPool`, `setTreasury`, `pause` / `unpause`, and `recoverToken` (G$ excluded so UBI flow can never be drained).

Constructor takes `(gToken, ubiPool, treasury)`.

### ArenaPlatform.sol · 1v1 match escrow

Escrows G$ for 1v1 matches. Used by A2A agent counterparties against MARKOV, legacy for human players.

- Propose with `proposeMatch(opponent, gameType, wager)` (needs prior approval) or in one tx via the ERC-677 `onTokenTransfer` hook. `opponent = address(0)` is an open challenge.
- Accept with `acceptMatch(matchId)` or the ERC-677 hook. Both sides lock equal G$.
- `playMove(matchId, move)` records each player's move, validated per `GameType` (RockPaperScissors, DiceRoll, StrategyBattle, CoinFlip, TicTacToe).
- `resolveMatch(matchId, winner)` is `onlyOwner`. It takes `platformFeePercent` (2%, routed to `platformTreasury` / GoodCollective UBI) off the `wager * 2` pool and sends the remaining 98% to the winner.
- `cancelMatch(matchId)` refunds the challenger while still `Proposed`. View `getPlayerMatches(player)`.

Constructor takes `(treasury, wagerToken)`.

### SoloWager.sol · solo score wager (legacy)

Players wager G$ on a solo score. The backend validates the score and resolves.

- `createWager(amount, gameType)` locks G$, takes a `devFeePercent` (3%) cut to the owner upfront, and stores the net. Registers new wallets in `registeredUser` / `totalUsers`.
- `resolveWager(wagerId, score)` is called by `backendValidator`. Win threshold is `rhythmWinThreshold` (350) or `simonWinThreshold` (7). On a win the payout is `payoutMultiplier` (default 130 = 1.3x) of the net wager, minus a 2% fee to `goodCollective`. If the treasury cannot cover it, the wager is refunded instead. On a loss the wager stays in the treasury and 2% goes to `goodCollective`.
- Owner: `fundTreasury`, `withdrawTreasury`, `cancelWager`, `distributeSeasonPrizes`, and setters (`setThresholds`, `setPayoutMultiplier` [100-300], `setDevFee` [max 10], `setBackendValidator`, `setGoodCollective`).

Constructor takes `(gToken, goodCollective, backendValidator)`.

> Note: the SoloWager NatSpec header says "1.8x", but the deployed default `payoutMultiplier` is `130` (1.3x). The setter caps it at 100-300.

## Other contracts

`src/` also holds earlier or experimental contracts not covered above (for example `TournamentPlatform.sol`, `GameLottery.sol`, `AgentRegistry.sol`, `EIP8004Registry.sol`, `ArenaToken.sol`, `GameAssets.sol`). They are not part of the four deployed addresses listed here.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- A Celo wallet with CELO for gas

## Build & deploy

```bash
forge build

# Example: deploy a single contract
forge script script/DeployGamePass.s.sol \
  --rpc-url https://forno.celo.org \
  --broadcast --account deployer
```

Deploy scripts live in `script/` (one per contract, e.g. `DeployGamePass.s.sol`, `DeployHabitatRegistry.s.sol`, `DeployPerkShop.s.sol`, `DeployArenaOnly.s.sol`, `DeploySoloWager.s.sol`).

Both `DeployPerkShop.s.sol` and `DeployHabitatRegistry.s.sol` default the treasury to the real GameArena wallet `0xc1cFA63135eA2fB5AB795cF10e4c79F4DD03c3f6` (overridable via `GAMEARENA_TREASURY`) and hard-revert if the treasury resolves to the Foundry placeholder sender `0x1804c8AB...` · a guard against the earlier bug where an unset treasury silently routed funds to an unowned address. The live PerkShop and HabitatRegistry `treasury()` both point to that wallet, set via `setTreasury`.

## Configuration

Create `.env`:

```bash
PRIVATE_KEY=<your deployer key>
CELO_RPC_URL=https://forno.celo.org
CELOSCAN_API_KEY=<for verification>
```

`foundry.toml` pins `solc 0.8.20`, `via_ir = true`, and a `celo` RPC endpoint at `https://forno.celo.org`.

## Verification

```bash
forge verify-contract <address> src/GamePass.sol:GamePass \
  --chain celo --etherscan-api-key $CELOSCAN_API_KEY
```

## Security

- **ReentrancyGuard** on state-changing wager and unlock functions.
- **Ownable** for admin operations, **Pausable** on HabitatRegistry and PerkShop.
- **SafeERC20** for all token transfers.
- **EIP-712 signatures** for GamePass score recording, with single-use nonces to block replays.
- Backend-validator pattern: only an authorized wallet can resolve wagers or act as `scoreValidator`.

## Project structure

```
contracts/
├── src/
│   ├── GamePass.sol           Soulbound identity NFT + on-chain scores
│   ├── HabitatRegistry.sol    Paid habitat tiers, G$ split to UBI + treasury
│   ├── PerkShop.sol           G$ perks (saves/retries/cosmetics/tickets), split to treasury + UBI
│   ├── ArenaPlatform.sol      1v1 G$ match escrow
│   ├── SoloWager.sol          Solo score wager escrow (legacy)
│   └── ...                    earlier / experimental contracts
├── script/                    Foundry deploy scripts (one per contract)
└── lib/
    ├── openzeppelin-contracts  OpenZeppelin v4
    └── forge-std
```
</content>
</invoke>
