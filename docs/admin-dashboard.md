# Admin Dashboard. Audit + Plan + Status

> One place to see GameArena's users, players, games, verification, rewards and on-chain activity, with history, built only on real data.
>
> Status: PLAN. Nothing is built. This is the audit of what the system records today and what has to be added. Author: GameArena · Updated 2026-11-24

---

## 1. What exists today

There is no admin area, no admin sign-in, and no analytics tool (no PostHog, Plausible or similar). The only operator views are `/internal/metrics` (server health and database egress) and the public `/api/stats` and `/api/impact-stats`.

The audit below was made from the code and the migration files. It has not been checked against the production database: the tables `users`, `activity`, `scores`, `badges` and `competition_winners` were created outside the migrations folder, so their full column lists are not in the repository.

### 1.1 What is recorded

| Data | Where | Good for |
|---|---|---|
| A player row per wallet: XP, play streak, last play date, claim streak, habitat | `users` | Registered users, last active |
| Every run that was started: game, start time, whether it finished, score, transaction, saved or not | `game_sessions` | Games started, completed, abandoned; activity by day; per-game comparison |
| Every saved run with its transaction | `activity` | Games played, players, activity feed |
| Best scores | `scores` | Leaderboards |
| Challenge AI matches | `arena_free_matches`, `arena_daily` | MARKOV play |
| Gas given to players, with transaction | `faucet_claims` | Onboarding cost |
| Perk purchases, with transaction | `arena_purchases`, `perk_inventory` | G$ spent |
| Season points ledger, with reason and time | `season_v1_points` | Engagement by action |
| Frozen winner lists | `competition_winners`, `challenge_winners` | Who won what |
| Missions and achievements | `daily_missions`, `achievements_unlocked` | Engagement |
| Notifications sent | `notification_log`, `notifications_feed` | Reach |
| Friend rooms, including stake results | `friend_rooms` | Multiplayer |
| Referrals | `season_v1_referrer_intent` | Growth source |
| On-chain: GamePass mint and score events, PerkShop, HabitatRegistry, G$ transfers | Celo | Registration date, every score, every payment |

### 1.2 What is not recorded

| Gap | Why it matters |
|---|---|
| **Verification is never stored.** It is read from the GoodDollar contract when needed and kept in memory. | No verified/unverified totals without asking the chain for every wallet, and no history of when someone verified |
| **No payout ledger.** Winners are frozen in a table; the transfer that paid them is not tied to them anywhere. | "Total rewards distributed", pending, failed and per-player reward history cannot be answered from our data |
| **No daily history.** Every number is "now". | No look-back by day, week or month |
| **No event feed.** Events live in server logs, which are not kept. | No activity feed, no record of failed transactions |
| **Guests are invisible.** A guest's plays are counted on their device only. | Visitors who never sign in cannot be counted |
| **No visit or sign-in record.** | "Active" can only mean "played", not "opened the app" |
| **No registration date we can rely on** (to be confirmed in the database). The GamePass mint event has it on-chain. | User growth over time |
| **The subgraph stopped on 30 October 2026.** | On-chain totals need another source |
| **No admin accounts, roles or audit log.** | Nothing to sign in to |

## 2. Each area you asked for

"Now" means the data is already there. "After step" names the step in section 3 that makes it possible.

| # | Area | Now | Needs |
|---|---|---|---|
| 1 | Platform overview | Registered users, active players, games played, transactions (score transactions) | Verified counts (step 2), rewards total (step 3), growth over time (step 1) |
| 2 | User analytics | Last active, activity history per wallet | Registration history and growth (step 1 backfill from mint events), retention and returning users (step 1), verified split (step 2) |
| 3 | Player analytics | Unique players, most active, games per player, per-player history | First-time vs returning by day (step 1) |
| 4 | Game analytics | Games available, plays per game per day, completed vs abandoned, comparison | Games per session needs a definition (proposal: plays within 30 minutes of each other) |
| 5 | GoodDollar verification | Nothing stored | All of it (step 2). "Success rate" needs us to record verification attempts, which we do not see today: GoodDollar's flow runs outside our app. We can show "started verify" (our button) against "became verified" |
| 6 | Rewards and payouts | Winner lists, faucet and perk transactions | Payout ledger (step 3) |
| 7 | On-chain analytics | Score transactions we sent, by hash | Our own index of contract events (step 4) |
| 8 | Activity feed | Saved runs only | Event table (step 1) |
| 9 | Reports | None | Daily table (step 1), export (step 5) |
| 10 | Admin management | None | Step 5 |

## 3. Plan

### Step 1. History and events (the foundation)

- `platform_events`: an append-only table. One row per thing that happened: `at`, `kind`, `wallet`, `game`, `ref`, `tx_hash`, `data`. Written from the places that already do the work: user created, run started, run saved, room round, mission claimed, perk bought, faucet sent, transaction failed.
- `daily_metrics`: one row per day per metric (new users, active players, runs started, runs saved, runs per game, new verified, G$ out, transactions, failures). A job fills yesterday every night.
- **Backfill.** Rebuild every past day from `game_sessions`, `activity`, `faucet_claims`, `arena_purchases`, `season_v1_points` and the GamePass mint events, back to launch. History then starts at launch, not at the day this ships.
- Retention is worked out from the same rows: of the players first seen in a week, how many played in each later week.

### Step 2. Verification, stored

- `verification_status`: wallet, verified or not, when first seen verified, when last checked.
- A job checks every known wallet against the GoodDollar Identity contract, in batches, and records changes.
- Backfill the date each wallet was verified from the contract's own whitelist events.
- Record when a player taps our Verify button, so "started" can be compared with "verified".

### Step 3. Payout ledger

- `payouts`: who, how much, which token, for what (event and place), status (pending, sent, confirmed, failed), transaction hash, who triggered it.
- Every payout from now on is written here first and updated when the transaction confirms.
- **Past payouts** have to be matched: G$ and USDC transfers out of the treasury and server wallets on-chain, joined to the winner lists. I need to know which wallets paid prizes and how (script or by hand) to do this properly.
- Friend-room entries are already recorded with their transactions and are added to the ledger as their own kind.

### Step 4. Our own index of on-chain events

- A small indexer in the backend: reads logs from GamePass, PerkShop, HabitatRegistry and G$ transfers involving our wallets, in block ranges, into `chain_events`. It remembers the last block and logs loudly if it falls behind, which the subgraph never did.
- Gives total, successful and failed transactions, unique active wallets and contract interactions, without the subgraph.

### Step 5. The dashboard

- Lives at `/admin` in the existing Next.js app, server-rendered, never cached publicly.
- **Sign-in and roles.** Privy sign-in, then a server-side check against `admin_users` (wallet or email, role). Roles: Super Admin (manages admins, can trigger payouts and announcements), Admin (everything except managing admins), Analyst (read and export only). `admin_actions` records every admin action. The backend routes it reads are behind the internal secret and never called from the browser.
- **Pages:** Overview, Users (list, search, one user's history), Players, Games, Verification, Rewards, On-chain, Activity feed, Reports (date range, CSV export), Admins.
- Every chart reads `daily_metrics` or a counted SQL query. No mock numbers; a metric that is not collected yet says so instead of showing zero.
- Queries are aggregated in the database and cached briefly, in line with the egress work already done.

### Order and size

| Step | Depends on | Rough size |
|---|---|---|
| 1 History and events | A look at the production tables | 2 to 3 days |
| 2 Verification | Step 1 | 1 day |
| 3 Payout ledger | Answers about past payouts | 1 to 2 days |
| 4 Chain index | None | 2 days |
| 5 Dashboard and roles | Steps 1 and 2 for the first useful version | 3 to 4 days |

A first useful dashboard (overview, users, players, games, activity feed, with history) needs steps 1, 2 and 5. Rewards and on-chain pages follow with 3 and 4.

## 4. Decisions needed

1. **Who are the first admins,** and by wallet or by email?
2. **May I read the production database** (read-only) to confirm the real columns of `users`, `activity`, `scores` and `competition_winners`? The plan assumes them from the code.
3. **How were prizes paid so far:** from which wallets, by script or by hand? This decides how far back the payout ledger can go.
4. **Should guests be counted?** It means giving each browser an anonymous id and recording plays against it.
5. **Should opening the app count as active,** or only playing? Counting visits means recording a daily visit per signed-in player.

## 5. Risks

- Backfilled history is only as complete as the tables it is rebuilt from. Runs lost before the save-once fix (24 November) are missing from `activity` but present in `game_sessions`.
- Checking verification for every wallet costs chain reads. Batched and spread out, it is small, but it is not free.
- The admin area exposes wallet-level history. Access has to be role-checked on the server for every request, not hidden behind a link.
