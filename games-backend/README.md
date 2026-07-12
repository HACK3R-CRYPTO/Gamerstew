# games-backend

Express + Supabase service that powers the off-chain side of GameArena. It signs score vouchers, runs the seasons and mission engine, serves leaderboards, hosts the MARKOV Instant Arena match loop, sends web push, and drips gas to fresh wallets. The Next.js frontend talks to this service server-to-server, guarded by a shared secret.

Everything lives in one file, `server.js` (~3700 lines), with a few helpers under `lib/`.

Production deploy: Railway · `https://game-backend-production-6130.up.railway.app`

---

## What this folder is

The chain holds the receipts. This service holds everything that would be too slow, too expensive, or too private to keep on-chain: session tickets, anti-cheat replay, points ledgers, mission state, notification history, and MARKOV's brain. The frontend never signs a score itself · it asks this service, which is the only holder of the validator key.

Games in scope:

- **Solo games** · Rhythm Rush (`rhythm`), Simon Memory (`simon`), Stack Tower (`stack`). Scores are signed here, then submitted on-chain by the GamePass contract.
- **Challenge AI (MARKOV)** · v3 Instant Arena. FREE, best-of-5 Rock-Paper-Scissors, commit-reveal fairness. No wager, no chain in the loop. G$ enters only through optional refill purchases.

---

## Score pipeline

Two independent session mechanisms guard scores. Don't confuse them.

1. **`POST /api/start-game`** (internal-secret) writes a `game_sessions` row with a `token`, `wallet`, `game`, and `started_at`. This DB ticket is what `/api/sign-score` consumes. Single-use · marked `used=true` once signed.
2. **`POST /api/start-session`** returns a validator-signed message token (`wallet:timestamp:nonce`). This is the lighter "silent session" that `/api/submit-score` re-verifies for speed-hack detection.

**`POST /api/sign-score`** (internal-secret) is the only path that mints a fresh voucher:

- Loads the `game_sessions` row, checks it exists, is unused, matches the wallet and game, and sits inside the duration window (min 5s, max 11min).
- For `rhythm`: replays the submitted `tapLog` through physics + jitter checks (`lib/rhythmScoring.js`) and signs the **server-computed** score. The client's claimed score is ignored.
- For `simon` and `stack`: replay is not implemented, so the client-claimed score is signed. The session ticket is the gate.
- Signs an EIP-712 `BackendApproval` struct with the validator key.

EIP-712 voucher:

```
domain = { name: "GameArena Pass", version: "3", chainId: 42220, verifyingContract: GamePass }
BackendApproval = { player: address, gameType: uint8, score: uint256, nonce: uint256 }
```

`nonce` is read live from the GamePass contract (`scoreNonces(player)`), so a voucher is single-use on-chain too. `gameType` is `rhythm=0, simon=1, stack=2`.

**`POST /api/submit-score`** (internal-secret) re-verifies the silent-session token (skipped for trusted server-action calls), runs speed-hack checks against reported vs elapsed time, then persists the score and fires downstream: season points, mission progress, achievements, streaks, and push triggers.

---

## Seasons, competitions, missions

- **Seasons** · epoch math from `SEASON_EPOCH` in 7-day windows. `currentSeasonNumber()` and `seasonBounds(n)` derive the active window with no cron needed. Score submits award capped Season points (max 15 per game). `GET /api/seasons` returns the active window + countdown.
- **Competition** · a multi-week cumulative cup over `COMPETITION_WEEKS = [10,11,12,13]`, id `gamearena-comp-s10-13`. `GET /api/competition` computes live standings and self-freezes past the deadline via `freezeCompetitionIfNeeded` · a cold-started process still freezes correctly on the first GET after the cutoff. `POST /api/competition/freeze` (internal-secret) forces it.
- **72-hour Arena Cup** · a fixed-window challenge (`CHALLENGE_*` constants, min plays + top-N + USDC prize). `GET /api/challenge` and `/api/challenges/past`.
- **Weekly community challenge** · a games-played milestone pool shared among everyone who hits the threshold (not placement-based). `GET /api/weekly-challenge`, payout list at `/api/weekly-challenge/payout-list` (internal-secret).
- **Daily missions** · `DAILY_MISSIONS` defined inline, calibrated to real score ranges. `GET /api/missions/today/:address` returns today's set + claim state · `POST /api/missions/claim` (internal-secret) claims a reward.
- **Achievements** · milestone list checked on each score submit. `GET /api/achievements/:address`.

---

## MARKOV Instant Arena

The arena engine lives in `lib/arenaMatch.js` · a port of the on-chain agent's opponent model into an instant, in-memory best-of-5 loop. No wager, no chain in the round loop. The chain is only a receipt layer (an ERC-8004 oracle attests finished matches asynchronously).

Match flow:

- **`POST /api/arena/start`** (internal-secret) consumes a daily match slot, then opens a match. It generates a 32-byte `seed`, returns `keccak256(seed)` as `commitHash` **before any round is played**, plus `bestOf: 5` and `winsNeeded: 3`. If the daily limit is hit it returns HTTP 402 with refill metadata (SKU, price, pool wallet, G$ token, relayer, permit nonce).
- **`POST /api/arena/throw`** (internal-secret) plays one round. MARKOV decides its move from a PRNG derived only from `(seed, matchId, counter)` and the player's observed move history, then observes the throw. Returns the round result, read level, mind-game hint, persona line, and on match end the revealed `seed` so anyone can replay and verify every AI move against `commitHash`.

Fairness is commit-reveal: the seed is committed before round 1 and revealed at match end, and every MARKOV decision is a deterministic function of the seed plus history. Moves are Rock-Paper-Scissors only (`0=rock, 1=paper, 2=scissors`). The model mixes a per-player Markov chain (70%) with randomness (30%), with a cold-start opening bias.

Finished matches are best-effort persisted to `arena_free_matches` (history, ladder, oracle) via the `onMatchComplete` hook. In-memory sessions expire after 10 minutes if abandoned.

**Refills · how G$ enters.** Free matches default to 10/day (`ARENA_FREE_MATCHES_PER_DAY`). The only SKU is `refill_5`: 2 G$ for +5 matches. Two purchase paths, both grant idempotently (the transfer tx hash is the `arena_purchases` primary key):

- **`POST /api/arena/purchase`** · player already sent G$ to the pool wallet; the backend verifies the on-chain `Transfer(player → pool, ≥ price)` from the receipt, then grants.
- **`POST /api/arena/purchase-gasless`** · player signs an EIP-2612 permit for the relayer; the backend submits `permit` + `transferFrom(player → pool)` paying gas itself, then grants. Zero CELO needed from the player.

**`GET /api/arena/ladder`** (internal-secret) aggregates a given ISO week (`arena_free_matches`): points desc then wins desc, top 20 + own standing, remaining matches today, and the live pool (`ARENA_WEEKLY_POOL_GS` base, default 500 G$, plus this week's player purchases). Past weeks stay viewable. Fails soft to an empty board if the migration hasn't run.

---

## Push notifications

Web push via VAPID (`lib/push.js`). The pet is the narrator · copy adapts to the player's pet stage, streak-loss aversion is the primary loop, and each notification category is capped once per day (enforced by the `notification_log` primary key).

- `GET /api/push/vapid-key` · public key for the browser to subscribe.
- `POST /api/push/subscribe` · `/unsubscribe` · register or drop an endpoint.
- `GET /api/push/prefs/:address` · `POST /api/push/prefs` · per-category opt-in state.
- `POST /api/push/broadcast` (internal-secret) · fan out to every active subscription; response telemetry reports `sent/skipped/cleaned` (stale endpoints are pruned).

Crons: `sendStreakWarnings` runs hourly, a cup-deadline cron runs on its own timer, and `indexOnChainScores` polls the chain every 5 minutes to mirror on-chain score events into the `activity`/leaderboard data.

---

## Gas faucet

**`POST /api/faucet`** (internal-secret, strict rate limit) sends a one-time **CELO gas drip** (`FAUCET_DRIP_CELO`, default 0.7) to fresh wallets so they don't hit the "insufficient gas" wall on GamePass mint or score submit. It is native CELO for gas, not G$.

Sybil defense, all server-side: internal-secret only, Privy-JWT-bound caller, one drip per wallet ever (unique on `faucet_claims.wallet`), one drip per Privy user, balance gate (< `FAUCET_FRESH_THRESHOLD_CELO`, default 0.001), per-IP daily cap (`FAUCET_MAX_PER_IP_DAY`, default 5), global daily kill-switch (`FAUCET_MAX_PER_DAY`, default 50). GoodDollar verification is optional (`FAUCET_REQUIRE_GOODDOLLAR`, default off).

---

## Selected routes

Internal-secret routes require the `x-internal-secret` header · the Next.js frontend forwards `INTERNAL_SECRET` server-to-server so browsers can't hit them.

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/start-game` | secret | Create the `game_sessions` ticket for sign-score |
| `POST /api/start-session` | — | Issue the silent-session signed token |
| `POST /api/sign-score` | secret | Mint an EIP-712 score voucher |
| `POST /api/submit-score` | secret | Verify + persist a score, run downstream |
| `GET /api/leaderboard?game=` | — | Per-game current-season rankings (from subgraph) |
| `GET /api/activity` · `/api/stats` | — | Recent activity feed · aggregate stats |
| `GET /api/seasons` | — | Active season window + countdown |
| `GET /api/competition` · `/api/competition/past` | — | Multi-week cup standings |
| `POST /api/competition/freeze` | secret | Force-freeze the active competition |
| `GET /api/challenge` · `/api/challenges/past` | — | 72-hour Arena Cup |
| `GET /api/weekly-challenge` | — | Community milestone progress |
| `GET /api/weekly-challenge/payout-list` | secret | Winners for payout |
| `GET /api/badges/:address` | — | Tier badges + championship NFTs |
| `GET /api/achievements/:address` | — | Unlocked achievements |
| `GET /api/missions/today/:address` | — | Daily missions + claim state |
| `POST /api/missions/claim` | secret | Claim a mission reward |
| `GET /api/notifications/:address` | — | In-app notification feed |
| `GET /api/user/:address` · `/api/streak/:address` | — | Profile + play streak |
| `GET /api/habitat/:address` · `POST /api/habitat/equip` | — | Habitat ownership + equip |
| `GET /api/usernames?wallets=` | — | Batch wallet → GamePass username (LRU-cached) |
| `POST /api/arena/start` · `/api/arena/throw` | secret | Instant match: open · play a round |
| `POST /api/arena/purchase` · `/api/arena/purchase-gasless` | secret | Refill via direct transfer or gasless permit |
| `GET /api/arena/ladder` | secret | Weekly MARKOV ladder + pool |
| `POST /api/faucet` | secret | One-time CELO gas drip |
| `GET /api/push/vapid-key` | — | VAPID public key |
| `POST /api/push/subscribe` · `/unsubscribe` · `/prefs` | — | Manage push endpoints + prefs |
| `POST /api/push/broadcast` | secret | Broadcast to all subscribers |
| `GET /health` | — | Liveness + readiness for Railway |

---

## Storage

Postgres on Supabase. Schema lives in `supabase-migrations/` (applied in order) with `migrations/` for later additions and `supabase-migrations.sql` as a one-shot snapshot.

Selected tables:

- `game_sessions` · sign-score tickets + anti-cheat forensics
- `activity` · score submissions mirrored from chain
- `arena_free_matches` · finished Instant Arena matches (ladder, history, oracle)
- `arena_daily` · per-wallet daily match slot accounting
- `arena_purchases` · refill purchases, `tx_hash` PK (replay-proof)
- `season_v1_meta` / `_players` / `_points` / `_results` · season window, joins, points ledger, sealed past seasons
- `faucet_claims` · one-drip-per-wallet ledger (unique on `wallet`)
- `push_subscriptions` · VAPID endpoints + opt-out state
- `notification_log` · once-per-day-per-category push cap
- `agent_*` tables (`agent_loss_caps`, `agent_provably_fair`, ...) are legacy from the wager era; v3 Instant Arena writes `arena_*` instead

---

## Configuration

| Key | Purpose |
|---|---|
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` | Supabase project + key (RLS off on `agent_*`, `arena_*`, `season_v1_*`) |
| `INTERNAL_SECRET` | Shared bearer for frontend → backend protected routes |
| `VALIDATOR_PRIVATE_KEY` | EIP-712 score signer · also the faucet sender and default relayer |
| `ARENA_RELAYER_KEY` | Gasless-refill relayer (falls back to validator key) |
| `ARENA_POOL_WALLET` · `G_TOKEN_ADDR` | Refill pool wallet + G$ token address |
| `ARENA_FREE_MATCHES_PER_DAY` | Free daily matches (default 10) |
| `ARENA_WEEKLY_POOL_GS` | Base weekly ladder pool (default 500 G$) |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_CONTACT_EMAIL` | Web push |
| `FORNO_RPC_URL` | Celo RPC (defaults to public Forno) |
| `GAME_PASS_ADDR` | GamePass NFT · voucher `verifyingContract` + username resolution |
| `FAUCET_*` | Drip amount + sybil thresholds (see Gas faucet) |

---

## Running locally

```bash
cd games-backend
npm install
cp .env.example .env   # fill in keys
node server.js         # http://localhost:3005
```

The frontend points here via `NEXT_PUBLIC_BACKEND_URL` (or `BACKEND_URL` server-side).

---

## Operational notes

- **`/api/sign-score` is the only voucher minter.** A `game_sessions` ticket must exist first (from `/api/start-game`), the payload binds wallet + gameType + score + on-chain nonce, and the ticket is burned on sign.
- **Anti-cheat lives in two layers**: `lib/rhythmScoring.js` replay for rhythm, and the silent-session speed-hack check in `submit-score`. Simon and Stack have no replay yet · they lean on the session ticket.
- **Season and competition freezes self-gate on epoch math**, so a cold-started process freezes correctly on the first GET after the deadline.
- **Arena persistence is best-effort.** Gameplay never depends on `arena_free_matches` writing · the ladder just shows a fresh week if a match failed to persist. Chain attestation is asynchronous and non-blocking.

---

## Related

- Main project README: [../README.md](../README.md)
- On-chain agent (source of the arena opponent model): [../agent/README.md](../agent/README.md)
