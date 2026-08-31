# GameArena Partner SDK

Plug your onchain game into GameArena without rebuilding it. You keep your game, your
contract, and your G$ rewards. GameArena becomes your **distribution + identity layer**:
your players show up on GameArena's leaderboards, and you get shared GoodDollar
proof-of-humanity for free.

## What you keep vs what you get
- **Keep:** your game, your UI, your contract, your on-chain rewards and settlement.
- **Get:** a home on GameArena, your scores on GameArena leaderboards, GoodDollar
  verification checks, and cross-promotion to GameArena's player base.

## Get a key
GameArena issues you a **partner API key** (one per game). Keep it server-side, it can
write scores under your game's name. Ask the GameArena team to add your game.

## Install
No package needed — copy `gamearena.js` (zero dependencies, browser + Node 18+).

```js
import { GameArena } from "./gamearena.js";
const arena = new GameArena({ apiKey: process.env.GAMEARENA_KEY });
```

## 1. Push a score onto GameArena boards
Call this from your **server** when a run ends (keeps your key private). Best score per
wallet is kept automatically.

```js
await arena.submitScore("0xPlayerWallet...", 41280 /* score */, txHash /* optional */);
// → { success: true, game: "blockslide" }
```

## 2. Check GoodDollar verification (proof-of-humanity)
Use it to gate rewards or show a "verified human" badge — no need to build your own.

```js
const verified = await arena.isVerified("0xPlayerWallet...");
// → true / false
```

## 3. Read your leaderboard back
```js
const board = await arena.leaderboard(20);
// → { game: "blockslide", rows: [{ rank, wallet, score }, ...] }
```

## Endpoints (if you'd rather call the API directly)
Base: `https://game-backend-production-6130.up.railway.app`
Header on every call: `x-partner-key: <your key>`

| Method | Path | Body / Params | Returns |
|---|---|---|---|
| POST | `/api/partner/score` | `{ wallet, score, txHash? }` | `{ success, game }` |
| GET  | `/api/partner/verified/:wallet` | — | `{ wallet, verified }` |
| GET  | `/api/partner/leaderboard` | `?limit=20` | `{ game, rows[] }` |

Rate limit: 120 requests / minute / key.

## Notes
- Scores are **off-chain** on GameArena's side (they feed the leaderboards). Your own
  on-chain settlement stays exactly as it is — GameArena never touches it.
- Identity is **on-chain and per-wallet**: the same wallet verified on either platform
  is verified on both. Nothing to double-sign.
- Two-way scoring (GameArena activity flowing back into your game) is a Phase 2 addition
  — this SDK covers your scores flowing into GameArena first.
