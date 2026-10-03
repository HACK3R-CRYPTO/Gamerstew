# games-backend

Express + Supabase service that powers the off-chain side of GameArena. It writes and signs scores, runs the seasons and mission engine, serves leaderboards, hosts the MARKOV Instant Arena match loop, runs the Tug of War recruitment event, exposes a partner SDK, sends web push, and drips gas to fresh wallets. The Next.js frontend talks to this service server-to-server, guarded by a shared secret; partners and GoodAgents talk to it through their own scoped keys.

Everything lives in one file, `server.js` (~6400 lines), with helpers under `lib/` (arena match loop, tug scoring, partner SDK, duel rooms, subgraph client, scoring replays, push).

Production deploy: Railway · `https://game-backend-production-6130.up.railway.app`

---

## What this folder is

The chain holds the receipts. This service holds everything that would be too slow, too expensive, or too private to keep on-chain: session tickets, anti-cheat replay, points ledgers, mission state, notification history, and MARKOV's brain. The frontend never signs a score itself · it asks this service, which is the only holder of the validator key.

Games in scope:

- **Solo games** · Rhythm Rush (`rhythm`, gameType 0), Simon Memory (`simon`, 1), Stack Tower (`stack`, 2). Scores are validated here and written on-chain (gasless by default — see below).
- **Challenge AI (MARKOV)** · v3 Instant Arena (gameType 3). FREE, best-of-5 Rock-Paper-Scissors, commit-reveal fairness. No wager, no chain in the loop. G$ enters only through optional refill purchases.
- **Partner games** · external titles on-boarded through the partner SDK, each given a free GamePass gameType `4+`.

### Auth modes

Every request clears a global origin gate first (no browser Origin → must carry the internal secret; a browser Origin must be on the allowlist). Server-to-server domains — the live SSE feed, `/api/arena/agent/*`, `/api/partner/*`, `/api/faucet`, and the public `/api/verified-stats` — are exempted from the origin check and gated by their own key inside the route. Route-level auth:

- **`requireSecret`** · `x-internal-secret` must equal `INTERNAL_SECRET`. Used by the Next.js frontend's server actions (the browser never holds the secret).
- **`requireAgentKey`** · `x-agent-key` must equal `AGENT_PLAY_KEY`. GoodAgents' agent-play routes only. Unset key = routes closed.
- **`requirePartner`** · `x-partner-key` must be a configured partner key. Guards the `/api/partner/*` SDK router.
- **`requireSecretOrPartner`** · internal secret OR a valid partner key. The faucet only; a partner key flags `req.viaPartner` for the smaller drip.
- **public** · read-only endpoints (leaderboards, stats, seasons, SSE feed, duel feed).

### Data sources

- **Supabase (Postgres)** · off-chain state only: XP/points ledgers, missions, streaks, equipped cosmetics/habitats, referrals, faucet claims, tug teams, arena match history.
- **Goldsky subgraph** (`gamearena`, via `SUBGRAPH_URL`) · every on-chain read — scores, leaderboards, player population, tug play counts.
- **In-memory caches** with per-key TTLs sit in front of the heavier subgraph and verification reads.

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

`nonce` is read live from the GamePass contract (`scoreNonces(player)`), so a voucher is single-use on-chain too. `gameType` is `rhythm=0, simon=1, stack=2, challenge-AI=3, partners=4+`.

**`POST /api/submit-score`** (internal-secret) re-verifies the silent-session token (skipped for trusted server-action calls), runs speed-hack checks against reported vs elapsed time, then persists the score and fires downstream: season points, mission progress, achievements, streaks, and push triggers.

### On-chain write model

**Default is GASLESS** (`GASLESS_SKILL_GAMES`, on whenever a validator key exists). The backend submits `recordScore(player, gameType, score)` itself from the signer/validator wallet `0xc1cFA63135eA2fB5AB795cF10e4c79F4DD03c3f6` and pays the gas, so a player never signs or holds CELO to post a score. This wallet also funds the faucet unless a dedicated `FAUCET_PRIVATE_KEY` is set.

- `recordScore` requires `msg.sender == scoreValidator`, which is this wallet.
- Challenge AI match receipts are written the same way (gameType 3), as are partner on-chain mirrors (gameType `4+`).
- **Legacy player-pays path** (set `GASLESS_SKILL_GAMES=false`): `/api/sign-score` mints the EIP-712 `BackendApproval` voucher and the player submits `recordScoreWithBackendSig` themselves. Fully intact as an instant rollback.

**Every backend write serializes through one signer-nonce queue** (`enqueueScoreWrite`). All gasless writes send from the same signer, so without a single serialized chain two concurrent writes would grab the same nonce and all but one would revert. The queue advances on tx *submission* (~1-2s), not mining; callers that need a mined receipt wait outside the queue. A daily gasless budget (`GASLESS_MAX_PER_WALLET_DAY`, `GASLESS_MAX_GLOBAL_DAY`) bounds the worst-case signer spend.

---

## Seasons, competitions, missions

- **Seasons** · epoch math from `SEASON_EPOCH` in 7-day windows. `currentSeasonNumber()` and `seasonBounds(n)` derive the active window with no cron needed. (Season 4 is complete, with its targets beaten.) Score submits award capped Season points (max 15 per game). `GET /api/seasons` returns the active window + countdown.
- **Competition** · a multi-week cumulative cup over `COMPETITION_WEEKS = [10,11,12,13]`, id `gamearena-comp-s10-13`. `GET /api/competition` computes live standings and self-freezes past the deadline via `freezeCompetitionIfNeeded` · a cold-started process still freezes correctly on the first GET after the cutoff. `POST /api/competition/freeze` (internal-secret) forces it.
- **72-hour Arena Cup** · a fixed-window challenge (`CHALLENGE_*` constants, min plays + top-N + USDC prize). `GET /api/challenge` and `/api/challenges/past`.
- **Weekly community challenge** · a games-played milestone pool shared among everyone who hits the threshold (not placement-based). `GET /api/weekly-challenge`, payout list at `/api/weekly-challenge/payout-list` (internal-secret).
- **Daily missions** · `MISSION_TEMPLATES` defined inline, calibrated to real score ranges. Each day picks one mission per category (`count` / `skill` / `special`) so every set is balanced. Rewards are small (20-45 XP). Games are score-based so there are no "win" missions. `GET /api/missions/today/:address` returns today's set + claim state · `POST /api/missions/claim` (internal-secret) claims a reward.
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

**Agent play (GoodAgents partnership).** External agents play the same engine through scoped routes so the master secret never leaves the house:

- **`POST /api/arena/agent/start`** · **`/api/arena/agent/throw`** (header `x-agent-key` = `AGENT_PLAY_KEY`) mirror start/throw with no human daily limit. `/start` verifies on-chain that the address is a real deployed agent (non-zero operator on the GoodAgents vault) before opening a match. Unset `AGENT_PLAY_KEY` = routes closed.
- **`POST /api/arena/agent/play`** (agent key or internal secret) starts a match and drives it server-side at a watchable pace · exhibition/self-play driver, returns the `matchId` immediately.
- **`GET /api/arena/live/:matchId`** (public, CORS `*`) · SSE spectator stream. Every round broadcasts `{type:'round', …}` then `{type:'end', final:{…}}`; history buffers from round 1 (even before the first viewer connects) so late joiners replay the full match. Partner sites embed this directly.

The frontend's Challenge AI lobby has a YOU / YOUR AI switch built on these plus GoodAgents' partner API (owner lookup, signed play/configure/wake · see `frontend/app/actions/goodagents.ts`).

---

## Perks & cosmetics (PerkShop)

Perks are bought on-chain via the `PerkShop` contract (`0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5`, 80% treasury / 20% GoodCollective UBI split inside the contract). This service grants and tracks the off-chain half.

- **`POST /api/perks/buy-gasless`** (internal-secret) · the player signed an EIP-2612 permit for PerkShop; the relayer submits `buyPerkWithPermit` and pays gas, so the buy costs the player zero CELO and one signature. Body `{ wallet, perkId, deadline, v, r, s }`.
- **`POST /api/perks/grant`** (internal-secret) · verifies an on-chain `PerkPurchased` for the wallet from the buy tx receipt, then routes the grant: the Match Pack (perk `6`, `PERK_TICKET_ID`) adds +5 arena matches (`arena_daily.extra`), save/retry perks (`1`, `3`, `5`, `CONSUMABLE_STOCK_PERKS`) stock one unit into `perk_inventory`, and cosmetics need no grant (ownership is on-chain). Replay-safe: the buy tx hash is the `arena_purchases` primary key. Works for both gasless and direct buys.
- **`POST /api/perks/use`** (internal-secret) · spends one save/retry from a wallet's `perk_inventory` stock when the game uses it.
- **`GET /api/perks/inventory?wallet=`** (internal-secret) · a wallet's save/retry stock counts.
- **`GET /api/cosmetics/equip?wallet=`** · **`POST /api/cosmetics/equip`** (internal-secret) · the equip toggle for owned cosmetics (Crystal Blocks, Neon Trail). Cosmetic ownership is on-chain; this is a pure display preference keyed by wallet in the `cosmetic_equip` table, so the choice follows the account across browsers/devices. GET returns only explicitly-set rows; the client treats any owned cosmetic not in the map as equipped (default on). POST takes `{ wallet, perkId, equipped }`.

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

**`POST /api/faucet`** (`requireSecretOrPartner`, strict rate limit) sends a one-time **CELO gas drip** to fresh wallets so they don't hit the "insufficient gas" wall on GamePass mint or score submit. It is native CELO for gas, not G$. Two callers:

- **Frontend onboarding** (internal secret) → full drip `FAUCET_DRIP_CELO`, default **0.7** CELO.
- **Partner BFF** (valid `x-partner-key`, sets `req.viaPartner`) → smaller drip `FAUCET_PARTNER_DRIP_CELO`, default **0.1** CELO, for a player the partner just verified.

Drips come from the dedicated faucet wallet (`FAUCET_PRIVATE_KEY`) when set, otherwise the validator/signer wallet. A faucet self-balance gate returns `faucet_empty` (503) and logs a top-up alert rather than letting the send throw a phantom revert.

Sybil defense, all server-side and layered: one drip per wallet ever (unique on `faucet_claims.wallet`), one drip per Privy user (cross-wallet dedupe), balance gate (recipient must hold < `FAUCET_FRESH_THRESHOLD_CELO`, default 0.05), per-IP rolling-24h cap (`FAUCET_MAX_PER_IP_DAY`, default 5), global daily kill-switch (`FAUCET_MAX_PER_DAY`, default 50). The claim is persisted *before* success returns so a retry can't double-drip. GoodDollar verification is an optional gate (`FAUCET_REQUIRE_GOODDOLLAR`, default off).

---

## GoodDollar verification

Proof-of-humanity reads hit the GoodDollar identity contract. Three distinct notions, deliberately kept apart:

- **`isWhitelisted(wallet)` is the live gate.** It is the only thing that grants a current reward or badge. The gate is *not* `getWhitelistedRoot` — that was briefly used and is a hole, because a root resolves even for a wallet whose own verification has lapsed.
- **`getWhitelistedRoot(wallet)` is used ONLY as the identity-dedupe key** (`identityRootOf`): one real face maps to one root, so a player can't farm a reward from several linked wallets.
- **`everVerified(wallet)` is permanent** (once true, always true). It governs recruit credit — a referral counts if the recruit *ever* passed a face check, even if their verification later expires.

All three are cached (verification ~60 min, root/ever longer), and RPC errors are treated as *unknown*, never as `false`.

---

## Public impact stats

Cached, non-sensitive aggregates that bypass the origin gate (the `/impact` page and partners read them server-side):

- **`GET /api/verified-stats`** · total players (one per GamePass minter in the subgraph) vs the subset that passed GoodDollar verification, plus the percentage. Cached 1h.
- **`GET /api/impact-stats`** · live perk-economy totals (purchases + G$ spend) summed straight from `arena_purchases`. Cached 1h.
- **`GET /api/payouts`** · everything GameArena has paid out to players, read from the committed `data/competition-payouts.json` ledger where every row carries its on-chain tx hash. Amounts are what reached players; treasury/change legs are excluded.

---

## Tug of War

A recruitment event: verify a face, pull your system-assigned team's rope, bring friends. Engine in `lib/tugEvent.js` + `lib/tugScoring.js`; standings are built from the subgraph (play counts) joined with Supabase (teams, referrals) and cached.

- **Identity-root dedupe** · one face (one `getWhitelistedRoot`) is one seat, no matter how many wallets it links.
- **System-assigned stable teams** (red / blue) · a player keeps their team across the event.
- **Soft-capped daily pulls** · points accrue up to `TUG_DAILY_PULL_CAP` (default 10) per day, then keep accruing at a reduced rate past the cap — skill always pays, but a hard wall never tells a player to stop coming back.
- **Human bounty** · the first `TUG_BOUNTY_SLOTS` (default 160) players to verify + play the qualifying games (`TUG_QUALIFY_GAMES`, default 3) each earn `TUG_BOUNTY_G` (default 2,500 G$). Bounty credit goes to the recruiter's team.
- **Referral board** · recruiters ranked by qualified recruits (verified + played the bar).

Routes:

- **`GET /api/tug`** (secret) · team standings / rope position.
- **`GET /api/tug/me?wallet=`** (secret) · one player's team, pulls today vs cap, qualify progress, verification status + days left, within-team percentile and neighbours, recruit breakdown.
- **`GET /api/tug/payout-list`** (secret, **admin**) · computes the full payout — bounty (first 160) + team-split pool + referral prizes — from the frozen, ended event only. `?format=disperse` emits paste-ready Disperse.app text; `?rollUnclaimed=1` folds the unclaimed bounty of players who never claimed into the split pool.
- **`GET /api/referrals/leaderboard`** (public) · a *separate* windowed creator/thread contest ranking referrers by qualified recruits brought inside `?since`/`?until`; does not reuse the tug board's all-time counts.

---

## Partner SDK

External game studios on-board through a scoped router (`lib/partner.js`, mounted at `/api/partner`). Each partner gets an `x-partner-key` (`requirePartner`) that never exposes the master secret; configured via `PARTNER_GAMES=slug:Label[:gameType]`. A partner given a `gameType` (`4+`) also mirrors scores on-chain via the shared `enqueueScoreWrite` queue; omit it to stay off-chain only.

- **`POST /api/partner/score`** · record a wallet's score onto GameArena boards (and on-chain if the partner has a gameType).
- **`GET /api/partner/verified/:wallet`** · GoodDollar proof-of-humanity check.
- **`GET /api/partner/profile/:wallet`** · "sign in with GamePass" lookup.
- **`GET /api/partner/leaderboard?limit=`** · the partner's own board (best score per wallet).

---

## Selected routes

Internal-secret routes require the `x-internal-secret` header · the Next.js frontend forwards `INTERNAL_SECRET` server-to-server so browsers can't hit them. Partner (`x-partner-key`) and agent (`x-agent-key`) routes use their own scoped keys.

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/start-game` | secret | Create the `game_sessions` ticket for sign-score |
| `POST /api/start-session` | — | Issue the silent-session signed token |
| `POST /api/sign-score` | secret | Mint an EIP-712 score voucher |
| `POST /api/submit-score` | secret | Verify + persist a score, run downstream |
| `GET /api/leaderboard?game=` | — | Per-game current-season rankings (from subgraph) |
| `GET /api/activity` · `/api/stats` | — | Recent activity feed · aggregate stats |
| `GET /api/verified-stats` | — | Players vs GoodDollar-verified subset (+ %) |
| `GET /api/impact-stats` | — | Live perk-economy totals from `arena_purchases` |
| `GET /api/payouts` | — | On-chain-proven payout ledger to players |
| `GET /api/cup` · `/api/ref/summary/:wallet` | — | Cup window · a wallet's referral summary |
| `GET /api/seasons` | — | Active season window + countdown |
| `GET /api/competition` · `/api/competition/past` | — | Multi-week cup standings |
| `POST /api/competition/freeze` | secret | Force-freeze the active competition |
| `GET /api/challenge` · `/api/challenges/past` | — | 72-hour Arena Cup |
| `GET /api/weekly-challenge` | — | Community milestone progress |
| `GET /api/weekly-challenge/payout-list` | secret | Winners for payout |
| `GET /api/tug` | secret | Tug of War team standings / rope |
| `GET /api/tug/me?wallet=` | secret | A player's tug state (team, pulls, qualify) |
| `GET /api/tug/payout-list` | secret (admin) | Ended-event payout: bounty + split + referral (`?format=disperse`, `?rollUnclaimed=1`) |
| `GET /api/referrals/leaderboard` | — | Windowed creator-contest referral ranking |
| `GET /api/badges/:address` | — | Tier badges + championship NFTs |
| `GET /api/achievements/:address` | — | Unlocked achievements |
| `GET /api/missions/today/:address` | — | Daily missions + claim state |
| `POST /api/missions/claim` | secret | Claim a mission reward |
| `GET /api/notifications/:address` | — | In-app notification feed |
| `GET /api/user/:address` · `/api/streak/:address` | — | Profile + play streak |
| `POST /api/record-claim` | secret | Record a reward claim for a wallet |
| `GET /api/habitat/:address` · `POST /api/habitat/equip` | —/secret | Habitat ownership + equip |
| `GET /api/season/sync-habitats` | — | Reconcile habitat tiers to season state |
| `GET /api/usernames?wallets=` | — | Batch wallet → GamePass username (LRU-cached) |
| `POST /api/arena/start` · `/api/arena/throw` | secret | Instant match: open · play a round |
| `POST /api/arena/purchase` · `/api/arena/purchase-gasless` | secret | Refill via direct transfer or gasless permit |
| `GET /api/arena/ladder` | secret | Weekly MARKOV ladder + pool |
| `POST /api/arena/agent/start` · `/agent/throw` | agent key | External agent plays (on-chain verified) |
| `POST /api/arena/agent/play` | agent key / secret | Start + server-drive a paced exhibition match |
| `GET /api/arena/live/:matchId` | — | SSE live-match spectator stream (buffers from round 1) |
| `GET /api/arena/receipt` | secret | Finished-match receipt lookup |
| `POST /api/partner/score` | partner key | Record a partner wallet's score (+ on-chain mirror) |
| `GET /api/partner/verified/:wallet` | partner key | GoodDollar verification check |
| `GET /api/partner/profile/:wallet` | partner key | Sign-in-with-GamePass lookup |
| `GET /api/partner/leaderboard` | partner key | Partner's own board |
| `GET /api/duel/rooms` · `/my` · `/room/:id` · `/rivalry` | — | Duel-room feed, membership, detail, head-to-head |
| `POST /api/duel/sync/:id` | — | Mirror one duel room from chain |
| `POST /api/duel/resolve/:id` | secret | Manually resolve a duel room |
| `GET` · `POST /api/collective/*` | mixed | GoodCollective choice ledger (read / choose) |
| `POST /api/perks/buy-gasless` | secret | Buy a PerkShop perk via gasless EIP-2612 permit |
| `POST /api/perks/grant` | secret | Verify an on-chain perk buy and grant it off-chain |
| `POST /api/perks/use` · `GET /api/perks/inventory` | secret | Spend / read save-retry stock |
| `GET` · `POST /api/cosmetics/equip` | secret | Read / set the equip toggle for owned cosmetics |
| `POST /api/faucet` | secret / partner | One-time CELO gas drip (partner key → smaller drip) |
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
- `arena_purchases` · refill + perk purchases, `tx_hash` PK (replay-proof)
- `perk_inventory` · per-wallet save/retry stock counts (owned minus used)
- `cosmetic_equip` · per-wallet equip toggle for owned cosmetics (display preference only)
- `season_v1_meta` / `_players` / `_points` / `_results` · season window, joins, points ledger, sealed past seasons
- `faucet_claims` · one-drip-per-wallet ledger (unique on `wallet`), also keyed by Privy user + IP hash
- `tug_team` · system-assigned stable Tug of War team per wallet
- `season_v1_referrer_intent` · who referred whom (shared by Cup, tug recruiter board, creator contest)
- `push_subscriptions` · VAPID endpoints + opt-out state
- `notification_log` · once-per-day-per-category push cap
- `agent_*` tables (`agent_loss_caps`, `agent_provably_fair`, ...) are legacy from the wager era; v3 Instant Arena writes `arena_*` instead

---

## Configuration

| Key | Purpose |
|---|---|
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` | Supabase project + key (RLS off on `agent_*`, `arena_*`, `season_v1_*`) |
| `INTERNAL_SECRET` | Shared bearer for frontend → backend protected routes |
| `AGENT_PLAY_KEY` | Scoped key for GoodAgents' `/api/arena/agent/*` routes (unset = closed) |
| `PARTNER_GAMES` · `PARTNER_KEY_<SLUG>` | Partner SDK registration (`slug:Label[:gameType]`) + per-partner key |
| `VALIDATOR_PRIVATE_KEY` | Signer wallet · submits gasless `recordScore`, signs EIP-712 vouchers, default faucet sender + relayer |
| `GASLESS_SKILL_GAMES` | Default on · backend submits & pays for skill-game writes. `false` = legacy player-pays voucher path |
| `GASLESS_MAX_PER_WALLET_DAY` · `GASLESS_MAX_GLOBAL_DAY` | Daily gasless-write budget ceilings (default 60 / 3000) |
| `ARENA_RELAYER_KEY` | Gasless-refill relayer (falls back to validator key) |
| `ARENA_POOL_WALLET` · `G_TOKEN_ADDR` | Refill pool wallet + G$ token address |
| `ARENA_FREE_MATCHES_PER_DAY` | Free daily matches (default 10) |
| `ARENA_WEEKLY_POOL_GS` | Base weekly ladder pool (default 500 G$) |
| `TUG_BOUNTY_SLOTS` · `TUG_BOUNTY_G` · `TUG_DAILY_PULL_CAP` · `TUG_QUALIFY_GAMES` | Tug of War tuning (default 160 / 2,500 G$ / 10 / 3) |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_CONTACT_EMAIL` | Web push |
| `CELO_RPC_URL` | Celo RPC (defaults to public Forno) |
| `SUBGRAPH_URL` | Goldsky `gamearena` subgraph endpoint (all on-chain reads) |
| `GAME_PASS_ADDRESS` | GamePass NFT · voucher `verifyingContract` + username resolution |
| `PERK_SHOP_ADDRESS` | PerkShop contract · gasless perk buys + on-chain purchase verification |
| `FAUCET_PRIVATE_KEY` | Dedicated faucet wallet (falls back to the signer wallet) |
| `FAUCET_*` | Drip amounts (0.7 full / 0.1 partner) + sybil thresholds + `FAUCET_REQUIRE_GOODDOLLAR` (see Gas faucet) |

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
