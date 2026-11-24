# Admin Dashboard. Audit + Plan + Status

> One place to see GameArena's users, players, games, verification, rewards and on-chain activity, with history, built only on real data.
>
> Status: FIRST VERSION BUILT on branch `nepa-up-light` (25 November 2026). Sign-in, roles, ten pages, history rebuilt from launch, stored verification, a payout ledger, first-party visit tracking and CSV export are done and were run end to end on a local database with sample data. NOT yet run against the production database: the migration has to be applied first. Purchases are read from the chain (section 7). Not built: an index of the other contract events (GamePass mints, transfers). Author: GameArena · Updated 2026-11-25

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

## 6. What was built

| Piece | Where |
|---|---|
| Tables and every metric's SQL | `games-backend/supabase-migrations/2026-11-25_admin_dashboard.sql` |
| Sign-in, roles, reads, payout ledger, visit intake, verification sweep | `games-backend/src/modules/admin/` (`service.ts`, `adapters.ts`, `routes.ts`, `admin.test.ts`) |
| Wiring and the two jobs (hourly rollup; verification, 25 wallets every 5 minutes) | `games-backend/legacy/notifications.js` |
| Session cookie, server-side API helper | `frontend/lib/server/adminSession.ts`, `frontend/lib/server/adminApi.ts` |
| Pages | `frontend/app/admin/` (`login`, and under `(in)`: overview, users, one player, games, traffic, verification, rewards, onchain, activity, reports, admins) |
| Visit tracking | `frontend/lib/track.ts`, `frontend/components/Track.tsx`, `frontend/app/api/t/route.ts` |
| Purchases read from the chain | `games-backend/src/modules/admin/chain.ts`, wired in `legacy/notifications.js` (job `chainPurchases`) |

### 6.1 Turning it on

1. Run the migration in the Supabase SQL editor.
2. Run `select admin_backfill();` once. It rebuilds every past day from the runs already recorded.
3. Insert the first Super Admin (the hash is made with `hashPassword` from the backend build; it is never committed).
4. Open `/admin` and sign in. More admins are added from the Admins page.

### 6.2 How it stays safe

- A signed, HTTP-only, same-site cookie holds the session for 12 hours. It is signed with a key derived from the server secret.
- The browser never talks to the backend's admin routes. The site's server does, with the internal secret, and names the admin by email. The backend looks that admin up again on every request and takes the role from the database, never from the request.
- Five wrong passwords lock an email for 15 minutes. Passwords are stored as salted scrypt hashes.
- Every sign-in and every change an admin makes is written to `admin_actions`.
- All admin tables have row level security on with no policies, so the public database key can read none of them.

### 6.3 What each decision became

- **Admins** sign in with email and password.
- **Visits count,** signed in or not: a random id kept in the browser, no network address stored, no third-party script. Counting starts the day it ships; earlier visits were never recorded and cannot be rebuilt.
- **Active** means played. Visitors are shown beside it, not mixed into it.
- **Prizes are paid by hand,** so the Rewards page has a form to record each payout with its transaction. Past payouts appear once they are entered.

### 6.4 Honest limits

- "Verified on" dates before the dashboard existed are the day of the first check, not the day the player verified.
- The verified total per day is recorded from go-live onward and cannot be rebuilt for earlier days.
- The On-chain page counts what our backend sent or stored. It does not read contract events from the chain yet.
- Verification success rate is not measurable from our side (section 2, row 5).
- "Sum of days" columns in Reports count a person once per day they were active.

## 7. Money

What players spend, what GameArena keeps, and what goes back out.

- **Source.** The PerkShop and HabitatRegistry contracts emit an event for every purchase with the exact split. Read on-chain on 25 November 2026, both send 80% to the treasury and 20% to the UBI pool, and the treasury is the server wallet `0xc1cFA63135eA2fB5AB795cF10e4c79F4DD03c3f6`. The amounts come from each event, so a change to the split is followed automatically.
- **Reader.** `chainPurchases` runs every minute and reads 40 ranges of 5,000 blocks (the public Celo node's limit) from block 65,552,895, where the HabitatRegistry was deployed. That is about 3,600 ranges, roughly an hour and a half for the first catch-up, then it keeps pace. The cursor moves in the same database call that stores a range, a failed range is retried smaller, it stays five blocks behind the head, and it logs loudly if it stalls. `CHAIN_INDEX=false` switches it off.
- **Checked against the real chain** (read-only): the first 400,000 blocks after the PerkShop's deployment held 61 purchases, 2,098 G$ paid, exactly 80% kept.
- **Page.** `/admin/money`: kept, spent, sent to UBI, prizes paid, kept minus prizes, per day, by item, biggest spenders, latest purchases with their transactions.

Not counted yet: the fee on friend-room entries, the gas the server pays for players, prizes paid in USDC, and income outside these two contracts.

