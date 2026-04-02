# GameArena — Autonomous AI Gaming on Celo with GoodDollar

> "Where skill meets probability. Where play earns real value."

GameArena is a fully on-chain gaming platform built on **Celo Mainnet**, powered by **GoodDollar G$**. Players compete against a Markov-chain AI agent in strategy games, wager G$ on solo skill games, and contribute to the GoodDollar UBI ecosystem — every match, every play.

Built as part of the **GoodBuilders Program** — expanding real G$ usage through competitive gaming.

---

## What Makes This a Real G$ Integration

GameArena integrates GoodDollar in four distinct ways — not a trivial token wrapper:

| Integration | How It Works |
|---|---|
| **G$ Wagering (PvP)** | Players wager G$ against Markov-1 AI in RPS, Dice, Coin Flip, and Strategy via `ArenaPlatform.sol` |
| **G$ Wagering (Solo)** | Players wager G$ on Rhythm Rush and Simon Memory score targets via `SoloWager.sol` — win 1.8x back |
| **GoodDollar Identity SDK** | Face verification required for wager mode — Sybil resistance, no bots |
| **UBI Pool Contribution** | 2% of every wager (win or lose) routes to the GoodCollective UBI Pool on-chain |
| **G$ Claim Button** | Verified UBI recipients can claim their daily G$ entitlement directly in the app |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 CELO MAINNET (Chain ID: 42220)           │
│                                                         │
│  ArenaPlatform.sol          SoloWager.sol               │
│  0x5C0eafE7834...           (deploy pending)            │
│  PvP match escrow           Solo game wager escrow      │
│                                                         │
│  GoodDollar G$ Token                                    │
│  0x62B8B11039...            Wager & payout currency     │
│                                                         │
│  GoodCollective UBI Pool    2% fee recipient            │
└─────────────────────────────────────────────────────────┘
          ↕ wagmi / viem / ethers.js
┌─────────────────────────────────────────────────────────┐
│               FRONTEND (React + Vite)                   │
│                                                         │
│  GamesHub.jsx    — choose game, set wager, verify ID    │
│  ArenaGame.jsx   — PvP vs Markov-1 AI agent             │
│  RhythmRush.jsx  — solo rhythm game with wager mode     │
│  SimonGame.jsx   — solo memory game with wager mode     │
│  Leaderboard.jsx — live scores, rank, near-miss display │
└─────────────────────────────────────────────────────────┘
          ↕ REST API
┌─────────────────────────────────────────────────────────┐
│              GAMES BACKEND (Express.js)                  │
│                                                         │
│  POST /api/submit-score   validate + persist score      │
│  GET  /api/leaderboard    top 10 per game               │
│  GET  /api/activity       live feed of recent plays     │
│  GET  /api/stats          player counts, top scores     │
│  resolveWager()           calls SoloWager on-chain      │
└─────────────────────────────────────────────────────────┘
          ↕ Markov-chain strategy
┌─────────────────────────────────────────────────────────┐
│              AI AGENT (Node.js / TypeScript)             │
│                                                         │
│  ArenaAgent.ts   — monitors chain for match proposals   │
│  OpponentModel   — Markov pattern prediction            │
│  Auto-accepts, plays, resolves matches autonomously     │
└─────────────────────────────────────────────────────────┘
```

---

## Play Modes

### PvP — Challenge Markov-1
- Games: Rock-Paper-Scissors, Dice, Coin Flip, Strategy Battle
- Wager any amount of G$ — AI auto-accepts and plays back
- Winner takes the pot; 2% fee funds GoodCollective UBI Pool
- AI uses Markov-chain prediction — it learns your patterns

### Solo — Skill-Based Wagering
- **Rhythm Rush** — tap the glowing button in time with the beat. Score 50+ pts to win
- **Simon Memory** — repeat the color sequence. Complete 5+ rounds to win
- Win condition met: 1.8x payout. Lose: wager stays in treasury
- Free play mode available — no G$ required

### Leaderboard
- Global ranking per game, live-refreshing every 15 seconds
- Near-miss rank display: "You are 3 pts from #4 — play again"
- Live activity feed on Games Hub showing recent plays in real time

---

## GoodDollar Identity Flow

```
User visits wager mode
  → If not verified: "VERIFY IDENTITY" button appears
  → GoodDollar face scan via @goodsdks/citizen-sdk
  → On success: isVerified = true, wager mode unlocked
  → Verified UBI recipients: "CLAIM G$" button shows claimable amount
```

Sybil resistance is enforced at the UI level. The smart contract does not restrict by identity (so free play always works), but wager mode in the UI gates behind verification.

---

## Smart Contracts

| Contract | Network | Address |
|---|---|---|
| `ArenaPlatform.sol` | Celo Mainnet | `0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE` |
| `SoloWager.sol` | Celo Mainnet | *(deploy pending — see below)* |
| GoodDollar G$ Token | Celo Mainnet | `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` |

### SoloWager.sol — Key Logic

```solidity
// Win: score >= threshold → 1.8x payout (2% to GoodCollective)
// Lose: wager stays in treasury (2% to GoodCollective)
uint256 rhythmWinThreshold = 50;   // score >= 50 in Rhythm Rush
uint256 simonWinThreshold  = 5;    // sequences >= 5 in Simon Memory
```

---

## Quick Start

### 1. Frontend
```bash
cd frontend
npm install
cp .env.example .env   # set VITE_ARENA_PLATFORM_ADDRESS, VITE_SOLO_WAGER_ADDRESS
npm run dev
```

### 2. Games Backend
```bash
cd games-backend
npm install
node server.js         # runs on port 3005
```

### 3. AI Agent
```bash
cd agent
npm install
npm start              # monitors Celo Mainnet for match proposals
```

### 4. Deploy SoloWager.sol
```bash
cd contracts
forge build
forge script script/DeploySoloWager.s.sol \
  --rpc-url https://forno.celo.org \
  --broadcast \
  --private-key $PRIVATE_KEY
```

---

## Environment Variables

```bash
# frontend/.env
VITE_ARENA_PLATFORM_ADDRESS=0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE
VITE_SOLO_WAGER_ADDRESS=<deployed address>
VITE_AI_AGENT_ADDRESS=<agent wallet>
VITE_AGENT_REGISTRY_ADDRESS=0x30e56137F118EE75D64b13C322261f8AB955A5d1
VITE_GAMES_BACKEND_URL=http://localhost:3005
```

---

## Project Structure

```
GameArenaCelo-/
├── frontend/                  React + Vite + Wagmi
│   └── src/
│       ├── pages/
│       │   ├── ArenaGame.jsx        PvP arena
│       │   ├── GamesHub.jsx         Solo game hub + wager
│       │   ├── RhythmRush.jsx       Rhythm game
│       │   ├── SimonGame.jsx        Memory game
│       │   └── Leaderboard.jsx      Live rankings
│       ├── contexts/
│       │   └── SelfVerificationContext.jsx  GoodDollar identity
│       └── config/
│           └── contracts.js         Addresses + ABIs
├── games-backend/             Express.js score server
│   └── server.js
├── agent/                     TypeScript AI agent
│   └── ArenaAgent.ts
└── contracts/                 Foundry / Solidity
    └── src/
        ├── ArenaPlatform.sol        PvP match escrow
        └── SoloWager.sol            Solo game wager escrow
```

---

## G$ Token Economics

| Event | G$ Flow |
|---|---|
| Player wins PvP match | Gets opponent's wager minus 2% fee |
| Player loses PvP match | Loses wager; 2% of wager to UBI Pool |
| Player wins solo (score threshold met) | Gets 1.8x wager back; 2% of gross to UBI Pool |
| Player loses solo | Wager stays in treasury; 2% to UBI Pool |
| UBI recipient plays | Can claim daily G$ entitlement in-app, then wager it |

Every transaction — win or lose — contributes to the GoodCollective UBI pool. The more the platform is used, the more UBI flows.

---

## GoodBuilders Program

GameArena is participating in **GoodBuilders Season 4** — GoodDollar's program for projects building real G$ usage and adoption.

Our G$ integrations:
- Rewards/services via G$ token (wagering)
- Face-verification flow with claim button
- G$ Identity SDK for Sybil resistance
- UBI Pool contribution via activity-based fees

---

*Open source. Built on Celo. Powered by GoodDollar.*
