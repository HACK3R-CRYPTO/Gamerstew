# GameArena — AI-Powered Gaming on Celo with GoodDollar

> Play skill games. Wager G$. Fund global UBI. Every game matters.

GameArena is a competitive gaming platform on **Celo Mainnet** powered by **GoodDollar G$**. Players compete in solo skill games and Human vs AI matches against an adaptive AI agent — with real G$ stakes, weekly seasons, and on-chain proof of every play.

Built as part of the **GoodBuilders Program** — expanding real G$ usage through competitive gaming.

---

## G$ Integration

| Integration | How It Works |
|---|---|
| **G$ Wagering (Human vs AI)** | Wager G$ against Markov-1 AI in RPS & Coin Flip via `ArenaPlatform.sol` |
| **G$ Wagering (Solo)** | Wager G$ on score targets in Rhythm Rush (350 pts) and Simon Memory (7 sequences) via `SoloWager.sol` — win 1.3x |
| **GoodDollar Identity** | Face verification via Identity SDK — Sybil-resistant, no bots in wager mode |
| **UBI Pool Fees** | 2% of every wager routes to [GoodCollective UBI Pool](https://celoscan.io/address/0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1) on-chain |
| **G$ Claim Button** | Verified UBI recipients claim daily G$ directly in the app |
| **ERC-8004 Agent Identity** | AI agent registered on official [Celo Agent Trust Protocol](https://celoscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) (Token #6386) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   CELO MAINNET (42220)                        │
│                                                              │
│  ArenaPlatform.sol      SoloWager.sol        GamePass.sol    │
│  0x5C0eafE7834...       0xc78A8A027e0...     0xBB044d678...  │
│  HvAI match escrow      Solo wager escrow    Soulbound NFT   │
│                                              + on-chain scores│
│  G$ Token               ERC-8004 Registry                    │
│  0x62B8B11039...        0x8004A169FB4...                     │
│                         Agent #6386                          │
│  GoodCollective UBI Pool                                     │
│  0x43d72Ff177...        2% fee recipient                     │
└──────────────────────────────────────────────────────────────┘
           ↕ wagmi / viem / ethers.js
┌──────────────────────────────────────────────────────────────┐
│                FRONTEND (React + Vite)                        │
│                                                              │
│  GamesHub.jsx    — game selection, wager, GamePass mint      │
│  ArenaGame.jsx   — Human vs AI (Markov-1 agent)               │
│  RhythmRush.jsx  — solo rhythm game with anti-cheat          │
│  SimonGame.jsx   — solo memory game                          │
│  Leaderboard.jsx — rankings, seasons, match history          │
└──────────────────────────────────────────────────────────────┘
           ↕ REST API
┌──────────────────────────────────────────────────────────────┐
│             GAMES BACKEND (Express.js + Supabase)             │
│                                                              │
│  POST /api/submit-score   validate → Supabase + on-chain tx  │
│  GET  /api/leaderboard    top scores per game                │
│  GET  /api/stats          users, seasons, prize pot           │
│  GET  /api/seasons        weekly history + badges             │
│  GET  /api/badges/:addr   player badges + streaks             │
│  resolveWager()           calls SoloWager on-chain           │
│  recordScore()            calls GamePass on-chain (tx hash)  │
└──────────────────────────────────────────────────────────────┘
           ↕ Markov-chain strategy
┌──────────────────────────────────────────────────────────────┐
│               AI AGENT (Node.js / TypeScript)                 │
│                                                              │
│  ArenaAgent.ts   — monitors chain for match proposals        │
│  OpponentModel   — adaptive Markov pattern prediction        │
│  Auto-accepts, plays, resolves matches autonomously          │
│  Registered on ERC-8004 with verifiable on-chain identity    │
└──────────────────────────────────────────────────────────────┘
```

---

## Play Modes

### Solo — Skill-Based Wagering
- **Rhythm Rush** — tap the glowing button in time. Score 350+ pts to win 1.3x your wager
- **Simon Memory** — repeat color sequences. Complete 7+ rounds to win 1.3x
- Free play available — no wallet or G$ required
- Every play recorded on-chain via GamePass contract (verifiable tx hash)

### Human vs AI — Challenge Markov-1
- Games: Rock-Paper-Scissors, Coin Flip
- Wager any amount of G$ — AI auto-accepts and plays
- Winner takes 95% of the pot; 5% platform fee
- AI uses adaptive Markov-chain prediction — it learns your patterns
- *(Player vs Player coming in a future phase)*

### Weekly Seasons
- 7-day competitive seasons with automatic reset
- Top 3 per game earn Gold / Silver / Bronze badges
- Streak detection: "3-WEEK CHAMPION" for consecutive wins
- Season history preserved permanently in database

### GamePass NFT
- Soulbound (non-transferable) NFT minted on first play
- Choose a username — shows on leaderboard instead of wallet address
- `totalSupply()` = verifiable on-chain user count
- Stores best scores per game on-chain

---

## Smart Contracts

| Contract | Address | Purpose |
|---|---|---|
| `ArenaPlatform.sol` | [`0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE`](https://celoscan.io/address/0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE) | Human vs AI match escrow |
| `SoloWager.sol` | [`0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb`](https://celoscan.io/address/0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb) | Solo wager escrow (3% dev fee, 2% UBI) |
| `GamePass.sol` | [`0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE`](https://celoscan.io/address/0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE) | Soulbound NFT + on-chain scores |
| GoodDollar G$ | [`0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A`](https://celoscan.io/address/0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A) | Wager & payout currency |
| ERC-8004 Registry | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://celoscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | Agent identity (Token #6386) |
| GoodCollective UBI | [`0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1`](https://celoscan.io/address/0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1) | 2% fee destination |

---

## G$ Token Economics

| Event | You (Dev) | UBI Pool | Player |
|---|---|---|---|
| Player wins solo wager | 3% dev fee | 2% of payout | Gets 1.3x minus fees |
| Player loses solo wager | 3% dev fee + treasury keeps wager | 2% | Loses wager |
| Player wins vs AI | 5% platform fee | — | Gets 95% of pot |
| Player loses vs AI | 5% platform fee | — | Loses wager |
| UBI recipient plays | — | — | Can claim daily G$ in-app |

Every wager contributes to both platform revenue and the GoodDollar UBI pool.

---

## Quick Start

### 1. Frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### 2. Games Backend
```bash
cd games-backend
npm install
node server.js     # http://localhost:3005
```

### 3. AI Agent
```bash
cd agent
npm install
npm start          # monitors Celo for match proposals
```

### 4. Deploy Contracts (if needed)
```bash
cd contracts
forge build
forge script script/DeploySoloWager.s.sol \
  --rpc-url https://forno.celo.org \
  --broadcast --account deployer
```

---

## Environment Variables

### Frontend (`frontend/.env`)
```bash
VITE_WEB3AUTH_CLIENT_ID=<your web3auth client id>
VITE_REOWN_PROJECT_ID=<your reown project id>
VITE_RPC_URL=https://forno.celo.org
VITE_GAMES_BACKEND_URL=http://localhost:3005
VITE_SOLO_WAGER_ADDRESS=0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb
VITE_ARENA_PLATFORM_ADDRESS=0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE
VITE_GAME_PASS_ADDRESS=0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE
VITE_AI_AGENT_ADDRESS=0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1
VITE_ARENA_TOKEN_ADDRESS=0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A
VITE_ERC8004_REGISTRY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
VITE_ERC8004_REPUTATION=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
VITE_AGENT_TOKEN_ID=6386
```

### Games Backend (`games-backend/.env`)
```bash
PORT=3005
CELO_RPC_URL=https://forno.celo.org
SOLO_WAGER_ADDRESS=0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb
GAME_PASS_ADDRESS=0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE
VALIDATOR_PRIVATE_KEY=<your validator private key>
SUPABASE_URL=<your supabase url>
SUPABASE_ANON_KEY=<your supabase anon key>
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Celo Mainnet |
| Smart Contracts | Solidity, Foundry, OpenZeppelin v4 |
| Frontend | React, Vite, wagmi, viem |
| Backend | Express.js, ethers.js v6 |
| Database | Supabase (PostgreSQL) |
| Identity | GoodDollar Identity SDK, ERC-8004 |
| AI Agent | TypeScript, Markov chains |
| Wallet | WalletConnect (Reown), Web3Auth |

---

## Project Structure

| Directory | Description | Docs |
|---|---|---|
| [`frontend/`](frontend/) | React + Vite — game UI, wallet, wager flow | [Frontend README](frontend/README.md) |
| [`games-backend/`](games-backend/) | Express.js + Supabase — scores, seasons, on-chain resolver | [Backend .env.example](games-backend/.env.example) |
| [`contracts/`](contracts/) | Foundry / Solidity — ArenaPlatform, SoloWager, GamePass | [Contracts README](contracts/README.md) |
| [`agent/`](agent/) | TypeScript AI agent — Markov-chain opponent | — |

```
GameArenaCelo-/
├── frontend/                    React + Vite
│   └── src/
│       ├── pages/
│       │   ├── ArenaGame.jsx         PvP arena vs AI
│       │   ├── GamesHub.jsx          Solo games hub
│       │   ├── RhythmRush.jsx        Rhythm game
│       │   ├── SimonGame.jsx         Memory game
│       │   └── Leaderboard.jsx       Rankings + seasons + PvP
│       ├── components/
│       │   └── LandingOverlay.jsx    Splash screen
│       ├── contexts/
│       │   └── SelfVerificationContext.jsx
│       └── config/
│           └── contracts.js          Addresses + ABIs
├── games-backend/               Express.js + Supabase
│   └── server.js
├── agent/                       AI agent
│   └── ArenaAgent.ts
└── contracts/                   Foundry / Solidity
    └── src/
        ├── ArenaPlatform.sol         PvP escrow
        ├── SoloWager.sol             Solo wager (3% dev + 2% UBI)
        └── GamePass.sol              Soulbound NFT + scores
```

---

## GoodBuilders Program

GameArena participates in **GoodBuilders** — GoodDollar's grant program for projects building meaningful G$ usage.

**Our integrations:**
- G$ wagering with real economic flow (solo + PvP)
- GoodDollar Identity SDK for Sybil resistance
- 2% of all wager activity routed to GoodCollective UBI Pool
- G$ claim button for verified UBI recipients
- AI agent registered on ERC-8004 Agent Trust Protocol
- Open source, deployed on Celo Mainnet

---

---

## Roadmap

### Phase 2: Player-Signed Score Transactions (Anti-Cheat) ✅ (shipped — GamePass v3)

#### 2b — Player-Signed Score Transactions (Solo Games) ✅
Previously the backend wallet submitted score transactions on-chain (players couldn't fake scores, but all txs appeared from the dev address).

**Shipped:**
- **Backend** signs verified game result via EIP-712: `sign(playerAddress + score + gameType + nonce)`
- **Frontend** calls `/api/sign-score`, then `writeContractAsync` with `recordScoreWithBackendSig()` — player submits and pays their own gas
- **Contract** verifies `ecrecover(hash, sig) == trustedSigner` before recording score
- **GamePass v3** (`0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE`) deployed with signature verification

Every on-chain score tx now comes from the actual player's wallet. Scores can't be faked without the backend EIP-712 signature.

#### 2a — Signed Dice Oracle (Arena) — dropped
Dice Roll was removed from Arena (game simplified to RPS + Coin Flip). Dice oracle is no longer needed.

### Phase 3: MiniPay Full Integration ✅ (shipped on `feat/minipay`)
- Auto-connect injected wallet when inside MiniPay
- Stablecoin balance display (USDm / cUSD) in account modal for MiniPay users
- Hide CELO gas faucet for MiniPay users (they pay gas in USDm natively)

### Phase 4: On-Chain Weekly Seasons
Currently `GamePass.sol` only stores a player's **all-time best score** — it never resets. When a new week starts the contract still shows last week's best, so Supabase is used to track weekly competition separately.

The upgrade changes the contract to store scores **per season**:

```solidity
// Current (all-time best only)
mapping(address => uint256) public bestScore;

// Phase 4 (score per week per player)
mapping(uint256 season => mapping(address => uint256)) public weeklyScores;

function currentSeason() public view returns (uint256) {
    return block.timestamp / 7 days; // auto-resets every week, no admin needed
}
```

- Week 1 scores at `weeklyScores[1][player]`, week 2 at `weeklyScores[2][player]`, etc.
- Any past season queryable directly from the chain
- Supabase becomes optional (cache for speed) — not the source of truth
- Badges and season history fully verifiable on-chain

> This makes GameArena fully trustless — competitive integrity enforced by the contract, not the backend.

### Phase 5: Player vs Player (True PvP)
Currently players can only challenge the Markov-1 AI. The upgrade introduces real human vs human matches:

- Players create a match and stake G$ — another player accepts
- Smart contract holds escrow, winner takes the pot
- GoodDollar Identity required for both players — no bots on either side
- Matchmaking lobby: open challenges, private matches, stake size filtering
- All match results recorded on-chain

> Turns GameArena into a full esports protocol — same Sybil-resistant, UBI-funding loop but between real humans.

---

*Open source. Built on Celo. Powered by GoodDollar G$.*
