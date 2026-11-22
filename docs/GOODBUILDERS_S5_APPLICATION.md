# GoodBuilders application — revision 2, answering CHANGES_REQUESTED

All numbers re-pulled 6 November 2026 from the Goldsky subgraph, Celo mainnet and Supabase. Source for every figure at the bottom.

---

# Part A — reply to Rael (post in thread)

```
Thanks Rael. All four are fair, and the third one was the most useful thing anyone has told me this season. Answers in order.

1/ Build milestones. You are right, those were outcomes, not features. Reworked into four, and every one is either an improvement to something already live in GameArena or one feature added on top of rails that already exist. No new systems, because I am one person and incremental is the only plan I can actually hold. Each milestone now states what exists today, what I add, what changes for the player, and the number that makes it done. First one is a public metrics panel, which is also my answer to your question 3.

2/ Growth. Raised across the board: 1,000 verified users, 1,200 monthly actives, 10 communities onboarded, 5,000,000 G$ moved inside the product. I put the per-channel arithmetic in 6.3 so you can check whether it adds up rather than take my word for it. One ask. The fastest route to verified players is reaching people GoodDollar has already verified. A current G$ claimer has zero onboarding friction with us, the face check is done and they can earn on day one, and most of them have nothing to spend G$ on. That is your audience and the fit is exact. I would like your help getting in front of it.

3/ MAU and DAU. They did not line up because I pulled them from different windows and never defined them. Fixed: one definition, one source. An active user is a wallet that recorded at least one score on-chain in the window, which is a public subgraph query anyone can repeat. The real numbers today are 0 daily actives, 0 over 7 days, 17 over 30. My first submission said 126 because that 30-day window still had Tug of War inside it. The event ended, the window rolled past it, and the floor turned out to be zero. I would rather hand you that than a flattering chart, because it is precisely the problem this application is asking to fix, and from here it will come off the public panel in milestone 1 instead of off my own queries.

4/ G$ usage. Agreed, and 20% of a small number is a small number. 230,972 G$ has moved through the product so far and almost all of it went one way, players buying perks from me. The lever that changes the order of magnitude is recirculation: entry-fee tournaments where players stake G$, the pool is what the players put in, and winners stake it again. That is build milestone 4, and it is why the target is 5,000,000 rather than 500,000.

Resubmitted. Live at gamearenahq.xyz, repo at github.com/HACK3R-CRYPTO/Gamerstew, subgraph public.
```

---

# Part B — revised form answers

## Wallet to receive funding
```
0xa479b8c6030cBB01f8E9F6AcB2Ad2C757C81894d
```

## 1. Previous participation

**1.1** Yes · **1.2** 1 · **1.3** https://www.karmahq.org/project/gamearena

**1.4 Current state of your project today**

```
GameArena is live on Celo mainnet at gamearenahq.xyz. 974 wallets hold a GamePass, 130 are GoodDollar-verified today, and the contracts have recorded 68,394 on-chain transactions. Players have spent 230,972 G$ inside the product. 46,259 G$ of that routed to the GoodDollar UBI pool automatically, as a 20% cut of every perk and habitat purchase.

Season 4 shipped a G$ perk economy (PerkShop, 3,459 purchases), a Rhythm Rush rebuild, a Partner Game SDK, and a verified-only Tug of War event that paid 1,784,280 G$ to 76 wallets. 689 commits to production since 30 June. I attended all six Demo Days.

Now the part that matters. Tug of War week hit 152 weekly active wallets. The last 7 days hit zero. Thirty-day actives are 17. The product has no daily life of its own: it runs when I run an event and stops when I stop. 130 wallets are verified and only 21 have ever pressed the in-app G$ claim button.

I know why. Everything I built last season was an event. Events buy a spike and teach players to wait for the next one. There is no reason to open GameArena on a Tuesday when nothing is being given away, and no use for claimed G$ the same day you claim it.

So this season is not another event. It is three features that give a verified player something to do daily, somewhere to spend G$, and a way to compete without me funding the pool: Daily Claim Streak, Arena Mall, and G$ entry-fee tournaments where players stake their own G$. The third one is also how G$ volume stops being one-directional.

Blocker: I am one person, so distribution and build compete for the same hours. The honest fix is channels that do not need me present, which is why community leagues are the growth plan rather than more events I personally run.
```

## 2. Maturity and usage

| Field | Answer |
|---|---|
| **2.1 Project stage** | Live product |
| **2.2 Lifetime users** | `974` |
| **2.3 Active users** | `17` |
| **2.4 Frequency** | Monthly Active Users |
| **2.5 GoodDollar-verified users today** | `130` |
| **2.6 On-chain transactions to date** | `68394` |
| **2.7 Revenue earned to date** | `18` (USD) |

**2.8 Where do you track these numbers**
```
Subgraph, the source of truth for every figure above: https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.2/gn
Dune: https://dune.com/ogazboiz
Karma GAP: https://www.karmahq.org/project/gamearena
```

**2.9 Other relevant usage data** — this answers question 3 of the review
```
DEFINITION. An active user is a wallet that recorded at least one score on-chain inside the window. Every score in GameArena is EIP-712 signed and written to Celo before it counts, so this is not an analytics estimate, it is a chain query anyone can repeat against the public subgraph. One definition, one source, used for every number below.

RECONCILED, 6 November 2026:
DAU: 0
7-day actives: 0
30-day actives (MAU): 17
90-day actives: 320
Lifetime wallets: 974

WHY MY FIRST SUBMISSION SAID 126. That was a 30-day window that still contained the Tug of War event. The event ended on 8 October and the window has since rolled past it. Nothing was double-counted; the window moved. This is the clearest possible evidence of the problem I am applying to fix.

WEEKLY ACTIVE WALLETS, the full series:
Jul 03: 8 · Jul 10: 17 · Jul 17: 33 · Jul 24: 25 · Jul 31: 49 · Aug 07: 37 · Aug 14: 104 · Aug 21: 40 · Aug 28: 56 · Sep 04: 20 · Sep 11: 16 · Sep 18: 53 · Sep 25: 152 · Oct 02: 31 · Oct 09: 10 · Oct 16: 6 · Oct 23: 4 · Oct 30 onward: 0

WEEK-OVER-WEEK RETENTION ranges 13% to 68%, median 44%. It is highest in small quiet weeks, when only committed players are left, and collapses after a spike: the 152-wallet event week retained 13%. Events bring people who leave.

G$ FLOW TO DATE: 230,972 G$ spent inside the product across 3,459 perk purchases and 11 habitat unlocks. 46,259 G$ of that reached the GoodDollar UBI pool. 3,890,735 G$ has been paid out to players across events, plus $90 USDC.

CLAIM LOOP: 21 wallets have ever used the in-app daily claim, 2 reached a 3-day streak, none reached 7.

VERIFICATION DECAY: verified wallets went 137 to 130 in ten days with no new signups, because GoodDollar identity expires. That decay is itself an argument for a daily loop.
```

## 3. Integration

**3.1 Status:** Live

**3.2 Integration type** (tick four):
- Payments in G$ (rewards, services or subscriptions)
- Identity SDK
- Face verification with claim button
- Activity fees → UBI Pool

> Do not tick GoodCollective pools. GameArena routes to the GoodDollar UBI Scheme proxy `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1`, verified on-chain via `HabitatRegistry.ubiPool()`.

**3.3 Describe your G$ integration and why it matters**
```
GoodDollar face verification is the door to everything that pays: anyone can play free, but you must be verified to claim daily G$ in-app, rank on a reward ladder or collect a payout. G$ is the currency inside the arena, and 20% of every purchase routes on-chain to the GoodDollar UBI pool, 46,259 G$ so far, which flows back into daily claims for every GoodDollar user rather than just ours. It matters because a skill game cannot pay a leaderboard it cannot trust, and because it turns G$ holders into G$ spenders.
```

## 4. What you'll build — answers question 1 of the review

**4.1 Primary build goal**
```
Improve the surfaces GameArena already has until a verified player has a reason to open the app on a day with no event running, and add one feature, player-funded tournaments, that makes G$ circulate instead of flowing one way.
```

### 4.2 Build milestones

Each milestone below is either an improvement to a feature already live in GameArena or one feature added on top of existing rails. None of them require a new system. I have written what exists today, what I add, and what changes for the player, so the deliverable is checkable rather than aspirational. I expect to revise these with the GoodBuilders team as the season moves and the numbers come in.

**Milestone 1 — Improve: metrics anyone can check**
*Target: 30 November 2026*
```
Exists today: 16 scattered Dune queries and a public subgraph, with no single place that defines what an active user is. That is why my first submission reported numbers that did not line up.
What I add: one public panel with one definition per metric, built on the subgraph, refreshing daily.
What changes: you, I, and any player can check the same number and get the same answer, all season.
```
Deliverables:
1. Public dashboard: DAU, WAU, MAU, new wallets, week-over-week retention, G$ spent, G$ to UBI pool, verified wallet count
2. A written definition beside each metric, with the exact query it runs
3. Verified wallet count tracked daily, including lapses, since GoodDollar identity expires and the number falls on its own
4. Linked from the GameArena impact page and from my Flow State milestones
5. Done when: the panel is live, public, and I report from it in every Demo Day

**Milestone 2 — Improve: the daily G$ claim**
*Target: 15 December 2026*
```
Exists today: a claim card on the profile wired to GoodDollar. 130 wallets are verified and 21 have ever pressed it. It works and then nothing happens.
What I add: a streak counter, a reason to come back tomorrow, and something to spend the claim on today.
What changes: claiming becomes a daily habit with a visible number attached to it, and the G$ has somewhere to go within the hour.
```
Deliverables:
1. Streak counter on the claim card, the leaderboard row and the shareable profile card, using the `claim_streak` and `last_claim_date` columns already on the users table
2. Streak milestone rewards in G$ at days 3, 7, 14 and 30, paid from the community pool
3. New trigger `daily_g_claim` on the push system already shipped, firing once per verified wallet per day when entitlement is above zero, plus a loss-aversion push at hour 20 of a live streak
4. Daily Drop: one PerkShop item rotated each day, priced at about one day of claimed G$
5. Done when: 150 wallets have claimed in-app and 50 hold a 7-day streak

**Milestone 3 — Improve: turn the PerkShop into the Arena Mall**
*Target: 20 January 2027*
```
Exists today: the PerkShop contract with 3,459 purchases, selling consumables, and an XP system with levels, missions and a pet that evolves through five stages.
What I add: sections to the shop for things you keep rather than consume, and a public player stage built on the XP already being tracked.
What changes: status becomes visible on every leaderboard row, and claimed G$ buys identity instead of only refills.
```
Deliverables:
1. Five player stages with published XP thresholds, shown on profile, leaderboard row and share card, mapped to the pet stages already live
2. Identity section: frames, animated badges, arena titles, profile themes, priced in XP, no money barrier
3. Utility section: username change, rematch tokens, advanced stats, priced in G$, routed through the existing 80/20 PerkShop split so 20% reaches the UBI pool
4. Prestige section: achievement-only, not purchasable at any price
5. Rule held in contract and UI: nothing sold anywhere in the Mall affects competitive performance
6. Done when: 400 Mall purchases settled and 300 players sit at stage 2 or above

**Milestone 4 — Add: G$ entry-fee tournaments**
*Target: 20 February 2027*
```
Exists today: seasons, ladders, on-chain score verification, a payout script and a competition_winners table. Every prize pool so far came out of my treasury.
What I add: one feature where verified players stake G$ to enter and the pool is what the players put in.
What changes: G$ moves between players instead of one way into perks, and a prize event stops waiting on me to fund it.
```
Deliverables:
1. Tournament contract: G$ escrow on entry, payout on settlement, refund on cancellation, verified-only entry checked against GoodDollar identity at join
2. Entry tiers at 100, 500 and 2,000 G$, so the smallest tier costs about one day of UBI claim
3. Self-serve creation for players at stage 3 or above, reusing the season and ladder rails already built
4. Live bracket UI with on-chain settlement receipts, results pushed through the existing notification system
5. Platform fee 10%, of which 20% routes to the GoodDollar UBI pool, published on the impact page
6. Done when: 40 tournaments settled and 2,000,000 G$ has passed through tournament escrow

**4.3 Ecosystem impact** (500 char limit)
```
These changes turn GoodDollar verification from a one-time gate into a daily reason to hold and spend G$. The claim streak pulls verified users back every day, the Mall gives claimed G$ a use, and entry-fee tournaments make the same G$ circulate many times instead of once. Every purchase and every tournament fee routes 20% to the UBI pool, so the more the arena is played, the more G$ returns to every claimer on GoodDollar.
```

## 5. Your product in action

**5.1 Reason to return, beyond rewards**
```
Rank you cannot buy. Every score is signed and written on-chain, so the all-time leaderboard is a permanent public record of how good you are. Players defend a rank, protect a play streak and raise a pet that evolves through five stages off their own consistency. That is the honest answer to what exists today, and the honest second half is that it has not been enough: week-over-week retention is 44% at median and the last fortnight was zero. Status works on players already invested. It does nothing for a player on day two. The claim streak and the Daily Drop exist to cover day two.
```

| Field | Answer |
|---|---|
| **5.2 Target weekly retention by end of season** | `35` (%) |
| **5.3 Weekly retention today** | `44` (%) median W/W, measured on-chain |
| **5.5 Target users earning G$ by end of season** | `800` |
| **5.6 Users earning G$ today** | `109` |
| **5.7 G$ used inside your product so far** | `230972` |
| **5.9 Target G$ used by end of season** | `5000000` |

> 5.2 reads lower than 5.3 on purpose. Today's 44% is the median of mostly tiny weeks where only committed players remain. Holding 35% at 1,200 monthly actives is a much harder result than 44% at 17.

**5.4 How users earn G$ in your product**
```
Four ways, all gated on GoodDollar verification. Daily UBI claim through the in-app claim button. Weekly ladder payouts to top-ranked verified players. Community pool payouts, where the whole community hits a games-played target and the pool splits among everyone who qualified, so showing up pays rather than only placing first. Event prize pools, such as Tug of War, which paid 1,784,280 G$ to 76 wallets. 3,890,735 G$ has reached players to date. Adding this season: streak milestone rewards at days 3, 7, 14 and 30, and tournament winnings funded by other players.
```

**5.8 How users spend, unlock or share G$ inside your product**
```
Perks in the PerkShop: match packs against MARKOV, run saves, cosmetics. 3,459 purchases to date. Habitat unlocks that change a player's pet and profile. Every purchase splits on-chain, 80% treasury and 20% straight to the GoodDollar UBI pool. Adding this season: the Arena Mall utility section, the Daily Drop, and tournament entry fees, which is the first G$ sink where the money goes to another player rather than to me.
```

**5.10 New ways users will use G$ this season**
```
Entry-fee tournaments, where players stake G$ and win other players' G$, so the same tokens move several times instead of once. The Daily Drop, one rotating perk priced at about a day of claimed G$. Community-funded league pools, where a community owner stakes the prize G$ and GameArena runs the ladder, the verification gate and the payout. Streak milestone rewards, which pay G$ for consistency rather than for skill.
```

## 6. How you'll grow — answers question 2 of the review

**6.1 Primary growth goal**
```
Go from 17 monthly actives to 1,200, and from 130 verified wallets to 1,000, by reaching people GoodDollar has already verified and by letting communities run their own leagues instead of waiting on events I personally fund.
```

| Field | Answer |
|---|---|
| **6.2 Target communities or partners onboarded** | `10` |
| **6.7 Target GoodDollar-verified users** | `1000` |
| **6.8 Target active users** | `1200` |
| **6.9 Target on-chain transactions** | `250000` |
| **6.10 Target revenue** | `400` (USD) |

**6.3 What campaigns will drive this growth**
```
Here is the arithmetic rather than a wish. Target is 1,200 monthly actives and 1,000 verified.

1. Already-verified GoodDollar claimers, target 400. This is the channel that makes the rest reachable. Someone who already claims G$ has zero onboarding friction with GameArena: the face check is done, the wallet exists, and they can earn on day one. Nobody else in the cohort can say that about their users. I will run this through G$ community channels, the GoodDollar Telegram and X presence, and a claim-day campaign aimed at people who already hold G$ and have nothing to spend it on. I am asking GoodDollar directly for help reaching this audience, because it is your audience and the fit is exact.

2. Community leagues, target 500 across 10 communities at ~50 active players each. The community brings its own players and stakes its own G$ pool. GameArena provides the ladder, the verification gate and the payout. This scales without my treasury and without my time, which is the only kind of channel that works for a solo builder. Pipeline: Nigerian gaming communities, Celo Africa groups, GoodDollar community pods.

3. Referral engine, target 200. Already built and proven: the Tug of War referral board ran with 20 points per verified recruit. A recruit only counts once they verify and play, so the mechanic recruits verified humans by construction. This season it runs permanently rather than for one event.

4. Creator amplification, target 100. Amplify worked for Tug of War. Briefs stay skill-first.

Overlap and attrition between channels is real, which is why 400 + 500 + 200 + 100 targets 1,200 and not 1,200 exactly.

G$ VOLUME, 5,000,000 target, same approach. Entry-fee tournaments carry it: 800 earning players, four tournaments a month, a median entry around 500 G$, over three months is roughly 4,800,000 G$ through escrow. Mall and perk purchases add the rest. The difference from last season is recirculation, because a tournament pays the pool back out to players who stake it again.
```

### 6.4 Growth milestones

**Milestone 1 — Reach GoodDollar's verified base**
*Target: 20 December 2026*
```
Go where the verified humans already are instead of verifying new ones from scratch.
```
Activations:
1. Campaign across GoodDollar community channels aimed at existing G$ claimers, positioned as somewhere to spend the G$ you already claim
2. Referral board live permanently, 20 points per recruit, a recruit counting only once verified and playing
3. 400 verified wallets, up from 130

**Milestone 2 — Ten community leagues**
*Target: 10 February 2027*
```
Communities bring their own players and fund their own pools.
```
Activations:
1. Self-serve league tooling: a community owner opens a verified-only ladder and stakes its G$ pool without me
2. 10 communities onboarded and running
3. 2 external games live on the Partner Game SDK
4. 500 monthly actives arriving through leagues

**Milestone 3 — A week that holds with no event**
*Target: 28 February 2027*
```
Prove the product retains when nothing is being given away. This is the one that matters.
```
Activations:
1. Weekly community challenge run every week of the season with no gaps
2. 35% week-over-week retention measured on-chain in a week with no prize event running
3. 1,200 monthly actives and 300 wallets holding a 7-day claim streak
4. 5,000,000 G$ moved inside the product

**6.5 Ecosystem impact** (500 char limit)
```
GoodDollar verifies humans and GameArena gives them somewhere to spend what they claim. Growing to 1,000 verified players and 5,000,000 G$ of in-product volume means 20% of all of it returning to the UBI pool, and it means G$ circulating between players through tournaments instead of sitting in wallets. It also proves sybil-resistance is a product advantage rather than a compliance step, in Nigeria, one of Celo's largest markets.
```

**6.6 Sustainability plan**
```
Three streams, sequenced. Entry-fee tournaments are the main one: players fund the pool, the platform takes 10%, and it scales with player count rather than with my treasury. Community leagues come second, where the community funds the pool and GameArena charges for running the ladder, the verification gate and the payout. The G$ perk economy is already live, 3,459 purchases to date. The rule I hold to is that nothing which buys competitive advantage is ever for sale, because the leaderboard pays G$ and a purchasable rank would drain the pool. Sponsored cups are the one external stream I chase, and there the sponsor funds the prize while GameArena charges to run it.
```

## 7. Team

| Field | Answer |
|---|---|
| **7.1 Primary contact name** | **NEEDS YOUR INPUT** (legal name for KYC) |
| **7.3 Telegram** | https://t.me/ogazboiz |
| **7.4 GitHub** | https://github.com/HACK3R-CRYPTO |
| **7.5 Additional teammates** | None. Solo builder. |

**7.2 Primary contact role description**
```
Solo founder and sole developer. I write the Solidity contracts, the Node backend, the Next.js frontend, the Goldsky subgraph and MARKOV, the on-chain AI agent, and I run the community myself. 689 commits to production since 30 June. I am based in Nigeria and build for the market I live in, which is also one of MiniPay's largest. Celo Proof of Ship AI Track winner.
```

## 8. Additional

**8.1 Additional comments**
```
The uncomfortable numbers in this application are there on purpose. Daily actives are zero and thirty-day actives are 17, down from 152 in the week of the Tug of War event. I could have submitted a 90-day window and shown 320. I would rather you judge the plan against the real number, because a plan built on a flattering chart solves nothing.

Everything here is verifiable. Contracts on Celo mainnet, every score signed and written on-chain, payouts with tx hashes, subgraph public, repo public at github.com/HACK3R-CRYPTO/Gamerstew. Live at gamearenahq.xyz.
```

**8.2 Where did you hear about the program:** **PICK ONE** (returning from Season 4, so answer how you originally found it)

---

## Sources

| Number | Source |
|---|---|
| 974 lifetime | subgraph `globalStat.totalPlayers` |
| 0 DAU, 0 7-day, 17 MAU, 320 90-day | subgraph `Score`, distinct `player.id` per window, 6 Nov 2026 |
| Weekly series, 13-68% retention | same query, bucketed into 7-day windows |
| 130 verified | `getWhitelistedRoot` on `0xC361A6E6…` across all 974 wallets |
| 68,394 txs | 63,948 scores + 974 mints + 3,459 perk buys + 11 habitats + 2 wagers |
| 184,713 G$ revenue (~$18) | perk treasury 99,497.6 + habitat treasury 85,215, G$ at $0.00009994 |
| 230,972 G$ used · 46,259 to UBI | perkShopStat + globalStat, summed |
| 3,890,735 G$ to players | competition-payouts.json + marketing/tug-1-payout.md |
| 21 claimers, 2 streaks, 0 at 7 days | Supabase `users.last_claim_date`, `users.claim_streak` |
