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
await arena.submitScore("0xPlayerWallet...", 41280 /* score */, {
  name: "neo",        // the player's name on YOUR side (optional but recommended)
  txHash: "0x...",    // optional on-chain proof
});
// → { success: true, game: "blockslide", onchain: true, txHash: "0x..." }
```

**Pass `name`** whenever you have it. A player might have joined through *your*
website and never minted a GamePass — sending their name means they still show up
named on GameArena's boards instead of as a bare wallet address. The wallet is the
join key; the name is however *you* name them.

Every score lands on GameArena's leaderboard instantly. When your game is set up as an
**on-chain partner**, that same call also records the score on-chain on GameArena
(GameArena sponsors the gas), so `onchain: true` and a `txHash` come back. Your own game
and settlement are untouched — this is an extra write on GameArena's side, not yours.

## 2. Check GoodDollar verification (proof-of-humanity)
Use it to gate rewards or show a "verified human" badge — no need to build your own.

```js
const verified = await arena.isVerified("0xPlayerWallet...");
// → true / false
```

## 3. Shared identity, both directions
A player can join through **your website** (they get a name your way) or through
**GameArena** (they get a GamePass name). Either way the **wallet** is the shared key,
so the same person is the same identity on both games — neither side has to adopt the
other's username. Two directions:

- **Their name → GameArena:** pass `name` on `submitScore` (above). Players who came
  in through your site show up named on GameArena.
- **GamePass name → you:** if a player has a GamePass, read it and greet them by it.

Once they connect a wallet on your side, resolve their GameArena identity from it:

```js
const p = await arena.profile("0xPlayerWallet...");
// → { wallet, hasPass: true, username: "neo", verified: true, joinUrl: "https://gamearenahq.xyz" }

if (p.hasPass) {
  // greet them as p.username — they're signed in with their GamePass
} else {
  // no pass yet → send them to p.joinUrl to mint one (becomes a GameArena user)
}
```

Their BlockSlide username and their GamePass username reconcile through the one wallet,
so the same person is the same identity on both games.

## 4. Read your leaderboard back
```js
const board = await arena.leaderboard(20);
// → { game: "blockslide", rows: [{ rank, wallet, score }, ...] }
```

## Endpoints (if you'd rather call the API directly)
Base: `https://game-backend-production-6130.up.railway.app`
Header on every call: `x-partner-key: <your key>`

| Method | Path | Body / Params | Returns |
|---|---|---|---|
| POST | `/api/partner/score` | `{ wallet, score, name?, txHash? }` | `{ success, game, onchain, txHash }` |
| GET  | `/api/partner/verified/:wallet` | — | `{ wallet, verified }` |
| GET  | `/api/partner/profile/:wallet` | — | `{ wallet, hasPass, username, verified, joinUrl }` |
| GET  | `/api/partner/leaderboard` | `?limit=20` | `{ game, rows[] }` |

Rate limit: 120 requests / minute / key.

## Notes
- Scores always feed GameArena's leaderboards. On-chain partners also get each score
  mirrored on-chain on GameArena (gas sponsored by GameArena) — your plays lift
  GameArena's on-chain activity while your own game and settlement stay untouched.
- Identity is **on-chain and per-wallet**: the same wallet verified on either platform
  is verified on both. Nothing to double-sign.
- This is genuinely two-way: your players show up on GameArena, and their plays count
  as activity on both sides.
