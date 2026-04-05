# GameArena Smart Contracts

Solidity contracts for GameArena on Celo Mainnet. Built with Foundry and OpenZeppelin v4.

## Contracts

| Contract | Purpose | Address |
|---|---|---|
| `ArenaPlatform.sol` | PvP match escrow — players wager G$ against Markov-1 AI | [`0x5C0eafE7834...`](https://celoscan.io/address/0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE) |
| `SoloWager.sol` | Solo game wager escrow — 1.3x payout, 3% dev fee, 2% UBI | [`0xc78A8A027e0...`](https://celoscan.io/address/0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb) |
| `GamePass.sol` | Soulbound NFT — username, on-chain score recording | [`0xBB044d678...`](https://celoscan.io/address/0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE) |

## How They Work

**SoloWager.sol** — Players lock G$ before playing Rhythm Rush or Simon Memory. Backend validator calls `resolveWager()` with the final score. If score meets threshold (350 pts rhythm, 7 sequences simon), player gets 1.3x back. 3% dev fee taken upfront, 2% routed to GoodCollective UBI pool on resolution.

**ArenaPlatform.sol** — Player creates a match by locking G$. AI agent auto-accepts and locks matching amount. After both play their moves, winner takes 95% of the pot. 5% platform fee to contract owner.

**GamePass.sol** — Soulbound (non-transferable) ERC-721. Players mint once with a username. Backend calls `recordScore()` after every game — creates on-chain proof. `totalSupply()` = total registered users. `bestScore()` = verifiable high score per player.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Celo wallet with CELO for gas

## Build & Deploy

```bash
forge build

# Deploy SoloWager
forge script script/DeploySoloWager.s.sol \
  --rpc-url https://forno.celo.org \
  --broadcast --account deployer
```

## Configuration

Create `.env`:
```bash
PRIVATE_KEY=<your deployer key>
CELO_RPC_URL=https://forno.celo.org
```

## Owner Functions

```bash
# Set payout multiplier (130 = 1.3x)
cast send <SoloWager> "setPayoutMultiplier(uint256)" 130

# Set GoodCollective UBI pool
cast send <SoloWager> "setGoodCollective(address)" 0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1

# Withdraw treasury profits
cast send <SoloWager> "withdrawTreasury(uint256)" <amount>

# Fund treasury
cast send <SoloWager> "fundTreasury(uint256)" <amount>
```

## Security

- **ReentrancyGuard** on all state-changing functions
- **Ownable** for admin operations
- **SafeERC20** for token transfers
- Backend validator pattern — only authorized wallet can resolve wagers

## Project Structure

```
contracts/
├── src/
│   ├── ArenaPlatform.sol      PvP match escrow
│   ├── SoloWager.sol          Solo wager (3% dev + 2% UBI)
│   └── GamePass.sol           Soulbound NFT + scores
├── script/
│   └── DeploySoloWager.s.sol  Deployment script
└── lib/
    └── openzeppelin-contracts  OpenZeppelin v4.9
```
